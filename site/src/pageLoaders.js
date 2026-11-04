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
   App.js, which offers a retry instead of a blank page.

   Each page renders through a holder. Once its chunk has loaded, the holder
   keeps the page's component and a page mounted after that renders it
   directly: no suspending, so no empty page while React's Suspense reveal
   throttle (up to 300 ms in React 19) runs out. src/index.js uses this for
   the opening page by waiting for its chunk before the first render. Until
   then the page renders through React.lazy. React.lazy remembers a failed
   load for good, so a failed holder gets a fresh lazy: the boundary calls
   resetFailedPages() when the visitor moves on or presses Try again, and the
   next visit fetches afresh. The swap happens there and never inside the
   failing load itself, so React retrying a render while offline cannot start
   a fetch loop. A mounted page keeps the component it mounted with, so a
   chunk landing mid-visit never swaps the component type and remounts it. */
import { lazy, useState } from "react";

const LOADERS = {
  "/skills": () => import(/* webpackChunkName: "page-skills" */ "./pages/SkillsMap"),
  "/projects": () => import(/* webpackChunkName: "page-projects" */ "./pages/Projects"),
  "/about": () => import(/* webpackChunkName: "page-about" */ "./pages/About"),
  "/resume": () => import(/* webpackChunkName: "page-resume" */ "./pages/Resume"),
};

/* smallest first, the resume's pdf.js last */
export const PREFETCH_ORDER = ["/projects", "/about", "/skills", "/resume"];

const pending = {};

/* The page a path belongs to ("/projects/spim" -> "/projects"), or null.
   Case-insensitive, like the router's own matching. */
export function pageFor(pathname) {
  const p = (pathname || "").toLowerCase().replace(/\/+$/, "") || "/";
  return Object.keys(LOADERS).find((k) => p === k || p.startsWith(k + "/")) || null;
}

/* Start (or join) the fetch of a page's chunk. Resolves to the module; null
   for paths that are not a split page (the landing, unknown routes). */
export function preloadPage(pathname) {
  const key = pageFor(pathname);
  if (!key) return null;
  if (!pending[key]) {
    pending[key] = LOADERS[key]().then(
      (mod) => {
        const h = holders[key];
        if (h && mod && mod.default) h.module = mod.default;
        return mod;
      },
      (err) => {
        delete pending[key];
        throw err;
      }
    );
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

const holders = {};
function makeLazy(key) {
  return lazy(() =>
    preloadPage(key).catch((err) => {
      if (isChunkError(err) && reloadOnce()) return new Promise(() => {}); // the page is reloading
      holders[key].failed = true;
      throw err;
    })
  );
}

/* Give every page that failed to load a fresh lazy component, so its next
   render fetches again instead of replaying the old failure. */
export function resetFailedPages() {
  for (const key of Object.keys(holders)) {
    const h = holders[key];
    if (h.failed) {
      h.current = makeLazy(key);
      h.failed = false;
    }
  }
}

/* The component for a route path: renders whichever lazy the holder has now */
export function lazyPage(path) {
  const key = pageFor(path);
  const holder = (holders[key] = { current: makeLazy(key), failed: false, module: null });
  function Page(props) {
    const [Current] = useState(() => holder.module || holder.current);
    return <Current {...props} />;
  }
  Page.displayName = `Page(${key})`;
  return Page;
}
