// src/pageLoaders.js
/* Every page but the landing ships as its own chunk, fetched the first time it
   is needed: on a visit to it, on hovering or touching a link to it, or in the
   background once the site is up (App.js). The landing's bundle carries none
   of their weight: pdf.js for the resume, matter-js and d3 for the skills map
   and the about page.

   One promise per page, shared by the route, the prefetch and the hover, so a
   page is never fetched twice; a failed fetch clears it so the next attempt
   starts over.

   A deploy replaces every file on GitHub Pages, so a tab opened before it can
   ask for a chunk that no longer exists. When that happens on a visit (not in
   the background), the page reloads once at the same URL and picks up the new
   build; a timestamp in sessionStorage stops a real outage from turning into a
   reload loop, and an offline browser is left alone (a reload would only show
   its offline page). Anything else falls through to the error boundary in
   App.js, which offers a retry instead of a blank page. */
import { lazy } from "react";

const LOADERS = {
  "/skills": () => import(/* webpackChunkName: "page-skills" */ "./pages/SkillsMap"),
  "/projects": () => import(/* webpackChunkName: "page-projects" */ "./pages/Projects"),
  "/about": () => import(/* webpackChunkName: "page-about" */ "./pages/About"),
  "/resume": () => import(/* webpackChunkName: "page-resume" */ "./pages/Resume"),
};

/* smallest first, the resume's pdf.js last */
export const PREFETCH_ORDER = ["/projects", "/about", "/skills", "/resume"];

const pending = {};

/* The page a path belongs to ("/projects/spim" -> "/projects"), or null */
export function pageFor(pathname) {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  return Object.keys(LOADERS).find((k) => p === k || p.startsWith(k + "/")) || null;
}

/* Start (or join) the fetch of a page's chunk. Resolves to the module; null
   for paths that are not a split page (the landing, unknown routes). */
export function preloadPage(pathname) {
  const key = pageFor(pathname);
  if (!key) return null;
  if (!pending[key]) {
    pending[key] = LOADERS[key]().catch((err) => {
      delete pending[key];
      throw err;
    });
  }
  return pending[key];
}

const RELOADED_AT = "page-chunk-reload";
function reloadOnce() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch (e) {
    return false; // no storage, no loop guard: don't reload
  }
  window.location.reload();
  return true;
}
const isChunkError = (err) =>
  !!err && (err.name === "ChunkLoadError" || /Loading (CSS )?chunk [\w-]+ failed/i.test(err.message || ""));

/* React.lazy page for a route path */
export function lazyPage(path) {
  return lazy(() =>
    preloadPage(path).catch((err) => {
      if (isChunkError(err) && reloadOnce()) return new Promise(() => {}); // the page is reloading
      throw err;
    })
  );
}
