// build-art-assets.mjs
//
// Single source of truth for the art gallery's manifest + optimized derivatives.
// It does TWO jobs in one pass:
//
//   1. DISCOVER — scans public/art/artworks/<group>/<file> and folds any new
//      folders/files into public/art/manifest.json. Curation wins: existing
//      group order, item order, and hand-edited titles (e.g. "HyderEyesV1" for
//      Hyder'sV1.JPG) are preserved exactly. Newly found folders are appended
//      after the curated ones; newly found files are appended after the curated
//      items within their group.
//
//   2. ENRICH — for every artwork it makes sure the manifest carries:
//        - item.thumb : /art/thumbs/<group>/<file>.webp   (<=800px display webp)
//        - item.w / item.h : intrinsic pixel size (lets the grid reserve a box)
//        - item.lqip : inline base64 blurred placeholder (0 extra requests)
//      and (re)generates the thumbnail file under public/art/thumbs/.
//
// The original full-resolution file is left untouched (used only in the lightbox).
// The gallery (public/art/index.html) and Projects.js depend on the enriched
// fields, so this script is the ONLY thing that should ever write manifest.json.
// (It absorbs the old build-manifest.mjs folder scanner, now a deprecation shim.)
//
// Enrichment is INCREMENTAL: an item that already has thumb/w/h/lqip and a thumb
// file on disk is left byte-for-byte untouched, so re-running is a fast no-op.
//   --force   regenerate every thumbnail / dimension / lqip from scratch
//   --prune   drop manifest items whose source file no longer exists on disk
//
// Requires ffmpeg + ffprobe on PATH (no npm dependency added).
//
// Run:  node build-art-assets.mjs [--force] [--prune]     (from the site/ directory)

import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";

const execFileP = promisify(execFile);

// fileURLToPath decodes %-encoding and handles Windows drive letters/UNC,
// so this works even when the checkout path contains spaces.
const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(SITE_DIR, "public");
const ART_DIR = path.join(PUBLIC_DIR, "art", "artworks");
const MANIFEST = path.join(PUBLIC_DIR, "art", "manifest.json");
const THUMB_ROOT = path.join(PUBLIC_DIR, "art", "thumbs");

// The site is served at the domain root (package.json "homepage" is a bare
// domain), so manifest URLs are root-absolute. This MUST stay "/art/artworks":
// the thumb-URL derivation below rewrites this exact prefix to "/art/thumbs".
const URL_PREFIX = "/art/artworks";

const THUMB_WIDTH = 800;   // px, long-column display size (covers 2x DPR of ~280px columns)
const THUMB_QUALITY = 72;  // libwebp quality
const LQIP_WIDTH = 32;     // px, blurred placeholder — CSS does the blurring
const LQIP_QUALITY = 45;

// Extensions we treat as artworks when discovering files on disk.
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

const FORCE = process.argv.includes("--force");
const PRUNE = process.argv.includes("--prune");

// ---- URL <-> path helpers -------------------------------------------------

// decodeURIComponent throws on a malformed escape (a bare '%' not followed by
// two hex digits). A hand-edited manifest is a legitimate input, so tolerate it
// rather than crash the whole run — fall back to the raw segment.
function safeDecode(seg) {
  try { return decodeURIComponent(seg); } catch { return seg; }
}

// Encode one path segment the way the manifest does: space -> %20, & -> %26,
// etc. encodeURIComponent intentionally leaves apostrophes alone, matching the
// existing "Hyder'sV1.JPG" entry.
function encSeg(seg) {
  return encodeURIComponent(seg);
}

// The decoded [folder, file, ...] tail after the "artworks" segment, or null if
// the src isn't a gallery path. Anchoring on "artworks" makes a stale
// "/hyder/art/artworks/..." src (from the old scanner) map to the same tail as a
// clean "/art/artworks/..." one.
function relSegments(src) {
  const segs = String(src).replace(/^\/+/, "").split("/").map(safeDecode);
  const i = segs.lastIndexOf("artworks");
  return i >= 0 ? segs.slice(i + 1) : null;
}

// A prefix/encoding-independent identity for an item ("<folder>/<file>", decoded).
function srcToRelKey(src) {
  const rel = relSegments(src);
  return rel ? rel.join("/") : safeDecode(String(src).replace(/^\/+/, ""));
}

// The last path segment (bare filename) of an item's src, decoded.
function srcFileName(src) {
  return srcToRelKey(src).split("/").pop();
}

// Rewrite an item's src to the canonical, correctly-encoded root-absolute form
// "/art/artworks/<folder>/<file>". This HEALS a stale "/hyder/..." prefix (whose
// segments srcToRelKey already recognizes but urlToPublicPath would otherwise
// resolve to a nonexistent public/hyder/... path) so the merge, the on-disk
// resolution, and the written manifest all agree. A non-gallery src is left as-is.
// For today's already-canonical srcs this is a no-op (byte-identical output).
function canonicalSrc(src) {
  const rel = relSegments(src);
  if (!rel || !rel.length) return src;
  return `${URL_PREFIX}/${rel.map(encSeg).join("/")}`;
}

// Decode a (canonical) manifest URL like
// "/art/artworks/Speed%20Figure%20Drawings/DSC.JPG" into an absolute path under
// public/. Tolerant decode so a malformed escape can't crash resolution.
function urlToPublicPath(url) {
  const clean = url.replace(/^\//, "");                 // drop leading slash
  const decoded = clean.split("/").map(safeDecode).join(path.sep);
  return path.join(PUBLIC_DIR, decoded);
}

// Title for a freshly-discovered file: drop the extension and tidy _/- into
// spaces — the same rule the old scanner used, so new files read like the
// curated ones (e.g. DSC_4158.JPG -> "DSC 4158").
function toTitle(file) {
  return path.basename(file).replace(/\.[^.]+$/i, "").replace(/[_-]+/g, " ");
}

// ---- ffmpeg wrappers ------------------------------------------------------

// EXIF orientation (tag 0x0112) from the first IFD of a JPEG header buffer.
// Returns 1 (normal) for non-JPEG input or when the tag is absent.
function parseExifOrientation(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;      // not a JPEG
  let off = 2;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0xd9) { off += 2; continue; }
    if (marker >= 0xd0 && marker <= 0xd7) { off += 2; continue; }
    if (marker === 0xda) break;                          // start of scan — headers done
    const size = buf.readUInt16BE(off + 2);
    if (marker === 0xe1 && buf.toString("ascii", off + 4, off + 8) === "Exif") {
      const tiff = off + 10;                             // skip "Exif\0\0"
      const le = buf.toString("ascii", tiff, tiff + 2) === "II";
      const r16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const r32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd0 = tiff + r32(tiff + 4);
      const count = r16(ifd0);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (r16(entry) === 0x0112) return r16(entry + 8);
      }
    }
    off += 2 + size;
  }
  return 1;
}

// Reading just the header is enough — EXIF lives in the first APP1 segment.
async function exifOrientation(file) {
  let fh;
  try {
    fh = await fs.open(file, "r");
    const { buffer, bytesRead } = await fh.read({ buffer: Buffer.alloc(131072), position: 0 });
    return parseExifOrientation(buffer.subarray(0, bytesRead));
  } catch {
    return 1;                                            // unreadable / not a JPEG -> assume upright
  } finally {
    if (fh) await fh.close();
  }
}

async function probeSize(file) {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    file,
  ]);
  const [w, h] = stdout.trim().split(",").map((n) => parseInt(n, 10));
  // ffprobe reports coded (pre-rotation) pixels. EXIF orientations 5–8 rotate the
  // image 90°, and both the browser and ffmpeg's autorotated thumbnail show it
  // rotated — so store the DISPLAY dimensions, or the grid reserves a sideways box.
  const o = await exifOrientation(file);
  if (o >= 5 && o <= 8) return { w: h || 0, h: w || 0 };
  return { w: w || 0, h: h || 0 };
}

async function makeWebp(inFile, outFile, width, quality) {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await execFileP("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", inFile,
    "-vf", `scale='min(${width},iw)':-1`,
    "-c:v", "libwebp",
    "-quality", String(quality),
    outFile,
  ]);
}

let lqipCounter = 0;
async function makeLqipDataUri(inFile) {
  // Scratch file goes in the OS temp dir (never the served/committed public tree)
  // and is cleaned up in finally even if the read fails.
  const tmp = path.join(os.tmpdir(), `art-lqip-${process.pid}-${lqipCounter++}.webp`);
  await execFileP("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", inFile,
    "-vf", `scale=${LQIP_WIDTH}:-1`,
    "-c:v", "libwebp",
    "-quality", String(LQIP_QUALITY),
    tmp,
  ]);
  try {
    const buf = await fs.readFile(tmp);
    return `data:image/webp;base64,${buf.toString("base64")}`;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// Fail fast with a clear message if the required binaries are missing,
// rather than silently "skipping" every item and reporting success.
async function ensureFfmpeg() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      await execFileP(bin, ["-version"]);
    } catch {
      throw new Error(`${bin} not found on PATH — install ffmpeg (it includes ffprobe) and retry.`);
    }
  }
}

// ---- discovery / merge ----------------------------------------------------

// Scan public/art/artworks one level deep -> Map<folder, sortedImageFiles>.
async function scanArtDir() {
  const byFolder = new Map();
  const dirents = await fs.readdir(ART_DIR, { withFileTypes: true });
  const folders = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  for (const folder of folders) {
    const files = (await fs.readdir(path.join(ART_DIR, folder)))
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    if (files.length) byFolder.set(folder, files);
  }
  return byFolder;
}

// Fold disk contents into the manifest without disturbing curation:
//   - keep every curated group (in order) and every curated item (in order),
//   - append folders present on disk but absent from the manifest,
//   - append files present on disk but absent from their group.
// Returns the merged manifest and a count of newly discovered files.
function mergeManifestWithDisk(manifest, byFolder) {
  const existingGroups = Array.isArray(manifest.groups) ? manifest.groups : [];
  const curatedNames = existingGroups.map((g) => g.name);
  const newFolders = [...byFolder.keys()].filter((f) => !curatedNames.includes(f));
  const orderedNames = [...curatedNames, ...newFolders];

  let discovered = 0;
  const mergedGroups = [];

  for (const name of orderedNames) {
    const curated = existingGroups.find((g) => g.name === name);
    const diskFiles = byFolder.get(name) || [];

    const items = [];
    const seen = new Set();
    // The manifest lives on a case-insensitive filesystem (Windows), so match
    // disk files to curated items case-insensitively — otherwise a curated
    // "Photo.jpg" and an on-disk "Photo.JPG" (the same physical file) would be
    // treated as distinct and appended as a duplicate tile.
    const norm = (f) => f.toLowerCase();

    // 1. curated items first, in their curated order (title + enrichment kept).
    //    Heal each src to the canonical /art/artworks/... form so a stale
    //    "/hyder/..." prefix resolves on disk and is never written back broken
    //    (a no-op for today's already-canonical srcs — byte-identical output).
    for (const it of curated?.items || []) {
      it.src = canonicalSrc(it.src);
      items.push(it);
      seen.add(norm(srcFileName(it.src)));
    }

    // 2. then any files on disk this group didn't already list, in sorted order.
    for (const file of diskFiles) {
      if (seen.has(norm(file))) continue;
      items.push({ src: `${URL_PREFIX}/${encSeg(name)}/${encSeg(file)}`, title: toTitle(file) });
      seen.add(norm(file));
      discovered++;
      console.log(`  + discovered: ${name}/${file}`);
    }

    if (items.length) mergedGroups.push({ name, items });
  }

  return { manifest: { ...manifest, groups: mergedGroups }, discovered };
}

// ---- main -----------------------------------------------------------------

async function main() {
  await ensureFfmpeg();

  // Read the existing (curated) manifest, or start empty if this is a fresh tree.
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      manifest = { groups: [] };
      console.log("No manifest yet — building from the disk scan.");
    } else {
      throw err;
    }
  }

  // Scan disk for discovery. If the artworks dir can't be read, never nuke the
  // manifest — fall back to enriching whatever is already curated.
  let byFolder = new Map();
  try {
    byFolder = await scanArtDir();
  } catch (err) {
    console.warn(`⚠ Could not scan ${ART_DIR} (${err.message}) — enriching existing manifest only.`);
  }

  const { manifest: merged, discovered } = mergeManifestWithDisk(manifest, byFolder);
  const total = merged.groups.reduce((n, g) => n + g.items.length, 0);

  let done = 0, kept = 0, missing = 0, pruned = 0, failed = 0;
  const usedThumbs = new Set();   // guards against two sources mapping to one thumb

  for (const group of merged.groups) {
    const keptItems = [];
    for (const item of group.items) {
      const srcPath = urlToPublicPath(item.src);

      let srcExists = true;
      try { await fs.access(srcPath); } catch { srcExists = false; }

      if (!srcExists) {
        if (PRUNE) {
          pruned++;
          console.log(`  - pruned (no source file): ${item.src}`);
          continue;                                 // drop from manifest
        }
        missing++;
        console.log(`  [warn] source missing, keeping entry: ${item.src}  (use --prune to drop)`);
        keptItems.push(item);
        continue;
      }

      // Thumb URL mirrors the (already %-encoded) source path but under
      // /art/thumbs with a .webp extension. Derive it by string-replacement on
      // the encoded src so we never double-encode spaces/&/etc.
      let thumbUrl = item.src
        .replace("/art/artworks/", "/art/thumbs/")
        .replace(/\.[^./]+$/, ".webp");
      // Two sources sharing a stem but differing by extension (Foo.jpg + Foo.png)
      // would map to the same .webp and silently overwrite each other, leaving one
      // tile showing the wrong image. Keep the later one distinct.
      if (usedThumbs.has(thumbUrl)) {
        const ext = (item.src.match(/\.([^./]+)$/)?.[1] || "img").toLowerCase();
        const disambiguated = thumbUrl.replace(/\.webp$/, `-${ext}.webp`);
        console.log(`  [warn] thumb name collision — using ${disambiguated} for ${item.src}`);
        thumbUrl = disambiguated;
      }
      usedThumbs.add(thumbUrl);
      const thumbPath = urlToPublicPath(thumbUrl);

      let thumbExists = true;
      try { await fs.access(thumbPath); } catch { thumbExists = false; }

      // Incremental: leave fully-enriched items untouched (byte-identical output)
      // unless --force. Missing any field or a missing thumb file triggers a rebuild.
      const complete = item.thumb === thumbUrl && item.w && item.h && item.lqip && thumbExists;
      if (!FORCE && complete) {
        kept++;
        keptItems.push(item);
        continue;
      }

      try {
        // Generate the thumbnail first and claim it immediately, so a later
        // failure in the (secondary) probe or LQIP step doesn't discard a good
        // thumb and silently fall the grid back to the multi-MB original.
        await makeWebp(srcPath, thumbPath, THUMB_WIDTH, THUMB_QUALITY);
        item.thumb = thumbUrl;

        let dims = "";
        try {
          const { w, h } = await probeSize(srcPath);
          item.w = w; item.h = h; dims = `  ${w}x${h}`;
        } catch { /* dimensions optional — grid still works without a reserved box */ }
        try {
          item.lqip = await makeLqipDataUri(srcPath);
        } catch { /* placeholder optional */ }

        done++;
        keptItems.push(item);
        process.stdout.write(`  [${done}] ${item.title}${dims}  thumb ok\n`);
      } catch (err) {
        // Source exists but generation failed — keep the entry, report it.
        failed++;
        keptItems.push(item);
        process.stdout.write(`  [fail] ${item.src} — ${err.message}\n`);
      }
    }
    group.items = keptItems;
  }

  // Drop any group left empty by --prune.
  merged.groups = merged.groups.filter((g) => g.items.length);

  // Guard BEFORE writing: if nothing usable was processed (e.g. the artworks dir
  // went unreadable mid-run, or --prune would drop every item because no source
  // resolved), bail without touching manifest.json. Writing here would overwrite
  // a good, curated manifest with "{ groups: [] }" — the exact data-loss we must
  // never cause. Every healthy run has done>0 or kept>0, so this only trips on a
  // genuine failure.
  if (total > 0 && done === 0 && kept === 0) {
    console.error(`\n❌ Nothing usable processed (${missing} missing, ${failed} failed) — refusing to overwrite ${MANIFEST}. Check the source paths and ffmpeg.`);
    process.exit(1);
  }

  await fs.writeFile(MANIFEST, JSON.stringify(merged, null, 2), "utf8");

  console.log(`\n✅ Manifest written: ${MANIFEST}`);
  console.log(
    `   ${total} items — ${done} (re)built, ${kept} already current, ` +
    `${discovered} newly discovered, ${missing} missing` +
    (pruned ? `, ${pruned} pruned` : "") +
    (failed ? `, ${failed} failed` : "")
  );
  console.log(`   thumbs in ${THUMB_ROOT}`);
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
