// scripts/build-art-manifest.mjs
import { promises as fs } from "fs";
import path from "path";

// ----- Your hard paths (Windows) -----
const ART_DIR = "C:\\Users\\hyder\\Desktop\\hyder\\site\\public\\art\\artworks";
const OUT     = "C:\\Users\\hyder\\Desktop\\hyder\\site\\public\\art\\manifest.json";

// We will emit URLs like: /hyder/art/artworks/<folder>/<file>
const URL_PREFIX = "/hyder/art/artworks";

const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

function toTitle(file) {
  return path
    .basename(file)
    .replace(/\.[^.]+$/i, "")   // strip extension
    .replace(/[_-]+/g, " ");    // tidy underscores/dashes
}

function enc(seg) {
  // encode each path segment (handles spaces, apostrophes, etc.)
  return encodeURIComponent(seg).replace(/%2F/g, "/");
}

async function main() {
  const groups = [];
  try {
    const dirents = await fs.readdir(ART_DIR, { withFileTypes: true });
    const folders = dirents.filter(d => d.isDirectory()).map(d => d.name);

    for (const folder of folders) {
      const abs = path.join(ART_DIR, folder);
      const files = await fs.readdir(abs);

      // stable ordering
      files.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );

      const items = files
        .filter(f => exts.has(path.extname(f).toLowerCase()))
        .map(file => {
          const url = `${URL_PREFIX}/${enc(folder)}/${enc(file)}`.replace(/\\/g, "/");
          return { src: url, title: toTitle(file) };
        });

      if (items.length) groups.push({ name: folder, items });
    }

    // optional: sort groups by name
    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const json = JSON.stringify({ groups }, null, 2);
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, json, "utf8");

    console.log("✅ Wrote manifest:", OUT);
    console.log(groups.map(g => `${g.name}(${g.items.length})`).join(", "));
  } catch (err) {
    console.error("❌ Failed:", err);
    process.exit(1);
  }
}

main();
