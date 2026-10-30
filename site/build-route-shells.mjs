// build-route-shells.mjs
// Post-build step: give every SPA route its own static HTML shell so
// GitHub Pages serves direct visits (and crawlers / link-preview bots,
// which never run the 404.html redirect hack) a real 200 with
// route-specific <title>, description, Open Graph and canonical tags.
// Also emits sitemap.xml.
//
// Runs automatically via `npm run build`; safe to re-run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(ROOT, "build");
const ORIGIN = "https://hydermohyuddin.com";

const ROUTES = [
  {
    path: "/",
    title: "Hyder Mohyuddin | Portfolio",
    description:
      "AI & Software • Systems • Interfaces — A focused, evolving portfolio by Hyder Mohyuddin.",
    image: "/preview.png",
  },
  {
    path: "/projects",
    title: "Projects | Hyder Mohyuddin",
    description:
      "Selected work: SPIM (tensor-level diffusion-model research), a custom CMS with built-in TTS narration, the Lavoët brand revival & pattern studio, absurdly detailed typing analytics, and more.",
    image: "/previews/projects.jpg",
  },
  {
    path: "/skills",
    title: "Skills | Hyder Mohyuddin",
    description:
      "An interactive, physics-driven map of my stack — languages, frameworks, and tools, arranged as a playable soft-body graph.",
    image: "/previews/skills.jpg",
  },
  {
    path: "/about",
    title: "About | Hyder Mohyuddin",
    description:
      "Who I am, how I think about building software, and what I do when I'm not at a terminal — in a page you can physically take apart.",
    image: "/previews/about.jpg",
  },
  {
    path: "/resume",
    title: "Resume | Hyder Mohyuddin",
    description:
      "Resume and diploma — view inline or download the PDF.",
    image: "/previews/resume.jpg",
  },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

// GitHub Pages serves directory shells at the trailing-slash URL (the
// slash-less form 301s), so canonical/OG/sitemap all use the slash form.
const routeUrl = (p) => ORIGIN + (p === "/" ? "/" : p + "/");

function retag(html, route) {
  const url = routeUrl(route.path);
  const title = esc(route.title);
  const desc = esc(route.description);
  const image = ORIGIN + route.image;

  const replacements = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [/(<meta name="title" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`],
    [/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`],
    [/(<meta property="og:image" content=")[^"]*(")/, `$1${image}$2`],
    [/(<meta name="twitter:url" content=")[^"]*(")/, `$1${url}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`],
    [/(<meta name="twitter:image" content=")[^"]*(")/, `$1${image}$2`],
    [/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`],
  ];

  let out = html;
  for (const [re, sub] of replacements) {
    if (!re.test(out)) {
      throw new Error(`retag: pattern not found for ${route.path}: ${re}`);
    }
    out = out.replace(re, sub);
  }
  return out;
}

const indexHtml = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");

let shells = 0;
for (const route of ROUTES) {
  const html = retag(indexHtml, route);
  if (route.path === "/") {
    fs.writeFileSync(path.join(BUILD, "index.html"), html);
  } else {
    const dir = path.join(BUILD, ...route.path.split("/").filter(Boolean));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    shells++;
  }
}

// sitemap.xml
const today = new Date().toISOString().slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  ROUTES.map(
    (r) =>
      `  <url><loc>${routeUrl(r.path)}</loc><lastmod>${today}</lastmod></url>`
  ).join("\n") +
  `\n</urlset>\n`;
fs.writeFileSync(path.join(BUILD, "sitemap.xml"), sitemap);

console.log(
  `route shells: ${shells} written, root retagged, sitemap.xml with ${ROUTES.length} urls`
);
