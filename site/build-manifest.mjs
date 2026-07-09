// build-manifest.mjs — DEPRECATED, does nothing.
//
// This scanner used to regenerate public/art/manifest.json from scratch, but it
// was a footgun:
//   - it emitted only { src, title }, wiping the thumb/w/h/lqip enrichment that
//     the gallery (public/art/index.html) and Projects.js now depend on, and
//   - it used a stale "/hyder/art/artworks" URL prefix (an old GitHub Pages
//     project path) that 404s on the current domain-root deploy.
//
// Its folder-discovery job now lives inside build-art-assets.mjs, which is the
// single source of truth: it discovers new artwork folders/files AND preserves
// curated order/titles AND (re)generates the enrichment.
//
// This file intentionally writes nothing.

console.error(
  [
    "build-manifest.mjs is deprecated and no longer writes manifest.json.",
    "",
    "Use build-art-assets.mjs instead — it now scans public/art/artworks for new",
    "art, preserves your curated order/titles, and enriches the manifest:",
    "",
    "  node build-art-assets.mjs            # discover + enrich (incremental)",
    "  node build-art-assets.mjs --force    # also regenerate every thumbnail",
    "  node build-art-assets.mjs --prune    # drop entries whose file was deleted",
  ].join("\n")
);
process.exit(1);
