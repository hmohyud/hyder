// build-project-thumbs.mjs
//
// Generates small webp thumbnails for every image in public/projects so the
// Projects page can show something instantly and lazy-load the full-res file
// only for the slide that's actually being looked at.
//
//   public/projects/<name>.{jpg,jpeg,png,gif}  ->  public/projects/thumbs/<name>.webp
//
// GIFs get a STATIC poster thumb (first frame) — the animated full-res file is
// swapped in by Projects.js once it finishes loading. The companion .mp4 files
// record-demo.mjs leaves next to a gif are ignored.
//
// Incremental: a thumb newer than its source is skipped. `--force` rebuilds all.
// Companion to build-art-assets.mjs (which owns the /art tree + manifest).
//
// Run:  node build-project-thumbs.mjs [--force]     (from the site/ directory)

import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";

const execFileP = promisify(execFile);

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(SITE_DIR, "public", "projects");
const OUT_DIR = path.join(SRC_DIR, "thumbs");

const THUMB_WIDTH = 560;   // px — covers 2x DPR of the ~280px slideshow box
const QUALITY = 72;        // libwebp quality
const EXTS = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const FORCE = process.argv.includes("--force");

async function main() {
  try {
    await execFileP("ffmpeg", ["-version"]);
  } catch {
    throw new Error("ffmpeg not found on PATH — install it and retry.");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SRC_DIR, { withFileTypes: true }))
    .filter((d) => d.isFile() && EXTS.has(path.extname(d.name).toLowerCase()))
    .map((d) => d.name)
    .sort();

  let built = 0, kept = 0, failed = 0;
  for (const name of files) {
    const src = path.join(SRC_DIR, name);
    const out = path.join(OUT_DIR, name.replace(/\.[^.]+$/, ".webp"));

    if (!FORCE) {
      try {
        const [s, o] = await Promise.all([fs.stat(src), fs.stat(out)]);
        if (o.mtimeMs > s.mtimeMs) { kept++; continue; }
      } catch { /* thumb missing — build it */ }
    }

    const isGif = /\.gif$/i.test(name);
    try {
      await execFileP("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", src,
        ...(isGif ? ["-frames:v", "1"] : []),   // gif -> static poster frame
        "-vf", `scale='min(${THUMB_WIDTH},iw)':-1`,
        "-c:v", "libwebp",
        "-quality", String(QUALITY),
        out,
      ]);
      built++;
      const kb = ((await fs.stat(out)).size / 1024).toFixed(0);
      console.log(`  ${name} -> thumbs/${path.basename(out)} (${kb} KB)`);
    } catch (err) {
      failed++;
      console.log(`  [fail] ${name} — ${err.message.split("\n")[0]}`);
    }
  }

  console.log(`\n✅ ${built} built, ${kept} already current${failed ? `, ${failed} failed` : ""}`);
  console.log(`   thumbs in ${OUT_DIR}`);
}

main().catch((e) => { console.error("❌ Failed:", e); process.exit(1); });
