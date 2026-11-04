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

/* The splash loader (public/index.html) has to be the first thing on screen
   and stay smooth, so the shell is reordered here, where the hashed asset
   names are known. Nothing is left that blocks parsing or the first paint:
   - The app bundle is preloaded, not run. The preload reports when the file
     has arrived (window.__jsReady, event "js-ready").
   - The page stylesheet moves from <head> to the end of <body>, below the
     loader and after #root, and reports when it has applied
     (window.__cssReady, event "css-ready"). Below the loader it cannot hold
     back the loader's paint. Chromium stops parsing at an in-body stylesheet
     until it loads, so #root comes before it: the bundle always finds its
     container, even if the release fallback runs it before the CSS is in.
   - A small release script, placed before the stylesheet, runs the bundle
     once the stylesheet has applied (the app never renders unstyled) and:
       * in a visible tab, the loader reports the logo has formed
         (window.__loaderDone, "loader-done"), so the bundle's first run - one
         long task, ~0.5 s on a mid phone, ~0.9 s on a slow one - never lands
         mid-animation and freezes the dots;
       * in a background or prerendering tab, the loader reports at once
         (window.__appGo, "app-go") and the release waits for the whole file,
         so the bundle runs while the tab is still hidden rather than
         whenever the download happens to finish, possibly mid-animation
         after the visitor has switched to it.
     A loader that never reports cannot strand the page: after 6 s the app
     runs once its stylesheet is in, after 20 s regardless.
   Idempotent: a shell that already has the release script is left alone. */
function holdAppForLoader(html) {
  if (html.includes("data-app-release")) return html;
  const js = html.match(/<script defer="defer" src="(\/static\/js\/main\.[0-9a-f]+\.js)"><\/script>/);
  const css = html.match(/<link href="(\/static\/css\/main\.[0-9a-f]+\.css)" rel="stylesheet">/);
  const ROOT_DIV = '<div id="root"></div>';
  if (!js || !css || html.split(ROOT_DIV).length !== 2) {
    throw new Error("holdAppForLoader: the CRA shell no longer has the expected main.js / main.css / #root tags");
  }
  const report = (flag, event) => `window.${flag}=1;window.dispatchEvent(new Event('${event}'))`;
  const preload =
    `<link rel="preload" as="script" href="${js[1]}" ` +
    `onload="${report("__jsReady", "js-ready")}" onerror="${report("__jsReady", "js-ready")}">`;
  const stylesheet =
    `<link href="${css[1]}" rel="stylesheet" ` +
    `onload="${report("__cssReady", "css-ready")}" onerror="${report("__cssReady", "css-ready")}">`;
  const release =
    "<script data-app-release>(function(){" +
    "var w=window,d=document,src=" + JSON.stringify(js[1]) + ",injected=0,forced=0;" +
    "function inject(){if(injected)return;if(!d.getElementById('root')){d.addEventListener('DOMContentLoaded',inject);return}" +
    "injected=1;var e=d.createElement('script');e.src=src;d.head.appendChild(e)}" +
    "function check(){if(injected||!w.__cssReady)return;if(forced)return inject();if(!w.__appGo)return;" +
    "var hidden=d.visibilityState==='hidden'||d.prerendering;" +
    "if(hidden?w.__jsReady:(w.__loaderDone||!d.getElementById('loader')))inject()}" +
    "['app-go','loader-done','css-ready','js-ready'].forEach(function(n){w.addEventListener(n,check)});" +
    "d.addEventListener('visibilitychange',check);" +
    "setTimeout(function(){forced=1;check()},6000);setTimeout(inject,20000);check()" +
    "})()</script>";
  return html
    .replace(js[0], preload)
    .replace(css[0], "")
    .replace(ROOT_DIV, ROOT_DIV + release + stylesheet);
}

const indexHtml = holdAppForLoader(fs.readFileSync(path.join(BUILD, "index.html"), "utf8"));

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
