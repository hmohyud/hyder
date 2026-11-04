// keep-recent-assets.mjs
// Deploy step (CI, between the build and the publish): carry forward the
// script, stylesheet and font files that were live on the site within the
// last day, so a page that is still running an earlier build can load them.
//
// Why: `gh-pages -d build` replaces the whole site, and GitHub Pages lets
// browsers and its CDN cache the HTML for 10 minutes. For a while after a
// deploy a visitor can hold the previous build's page, and since pages load
// their own chunks on demand (src/pageLoaders.js), that page asks for chunk
// files the new build no longer has - a 404, then one automatic reload,
// possibly into the same cached page. Keeping recently live files removes
// the gap instead of recovering from it.
//
// How: the live site's asset-manifest.json lists the build that is being
// replaced; retained-assets.json (written here, published at the site root)
// lists files carried forward before, each with the last time it was live.
// Anything live within MAX_AGE and missing from the new build is copied in
// from the gh-pages branch. Source maps are left out. Any failure here only
// warns: the deploy goes ahead without carrying anything forward.
//
//   node keep-recent-assets.mjs        (run from site/, after `npm run build`)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BUILD = path.resolve("build");
const BRANCH = "gh-pages";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEEP = /^static\/(js|css|media)\/[^/]+$/;
const now = new Date();

const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 1 << 28, ...opts });
const show = (file, encoding) =>
  git(["show", `origin/${BRANCH}:${file}`], { stdio: ["ignore", "pipe", "ignore"], ...(encoding ? { encoding } : {}) });

function main() {
  if (!fs.existsSync(path.join(BUILD, "asset-manifest.json"))) throw new Error("no build/asset-manifest.json - run the build first");
  git(["fetch", "--quiet", "--depth=1", "origin", BRANCH], { stdio: ["ignore", "ignore", "inherit"] });

  const live = new Map(); // file -> ISO time it was last live
  try {
    const prev = JSON.parse(show("retained-assets.json", "utf8"));
    for (const [file, at] of Object.entries(prev.files || {})) live.set(file, at);
  } catch (e) {
    // first run with this step: nothing carried yet
  }
  const manifest = JSON.parse(show("asset-manifest.json", "utf8"));
  for (const url of Object.values(manifest.files || {})) {
    const file = String(url).replace(/^\//, "");
    live.set(file, now.toISOString()); // live until this deploy replaces it
  }

  const kept = {};
  let copied = 0;
  let bytes = 0;
  for (const [file, at] of live) {
    if (!KEEP.test(file) || file.endsWith(".map")) continue;
    if (now - new Date(at) > MAX_AGE_MS) continue;
    const dest = path.join(BUILD, ...file.split("/"));
    if (fs.existsSync(dest)) continue; // still part of the new build
    let data;
    try {
      data = show(file);
    } catch (e) {
      continue; // not on the branch any more
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    kept[file] = at;
    copied++;
    bytes += data.length;
  }
  fs.writeFileSync(
    path.join(BUILD, "retained-assets.json"),
    JSON.stringify({ note: "files from recent builds, kept for pages still running them; see keep-recent-assets.mjs", files: kept }, null, 1) + "\n"
  );
  console.log(`kept ${copied} recently live asset file(s), ${(bytes / 1024).toFixed(0)} KB`);
}

try {
  main();
} catch (e) {
  console.log(`::warning title=old assets not kept::${String(e.message || e).split("\n")[0]}`);
}
