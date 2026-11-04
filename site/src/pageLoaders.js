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

/* Page chunks are fetched at high priority: a dynamically added script is
   otherwise fetched at low priority and queues behind the current page's
   images, which made a click on a slow link wait seconds for a few KB.
   (webpack sets one priority per chunk, so the background prefetch shares
   it; that prefetch waits until the landing's own downloads are under way
   and fetches one page at a time.) */
const LOADERS = {
  "/skills": () => import(/* webpackChunkName: "page-skills" */ /* webpackFetchPriority: "high" */ "./pages/SkillsMap"),
  "/projects": () => import(/* webpackChunkName: "page-projects" */ /* webpackFetchPriority: "high" */ "./pages/Projects"),
  "/about": () => import(/* webpackChunkName: "page-about" */ /* webpackFetchPriority: "high" */ "./pages/About"),
  "/resume": () => import(/* webpackChunkName: "page-resume" */ /* webpackFetchPriority: "high" */ "./pages/Resume"),
};

/* The resume's phone viewer (pdf.js), apart from the page: only screens up
   to 900 px wide use it */
export const loadResumePdf = () =>
  import(/* webpackChunkName: "resume-pdf" */ /* webpackFetchPriority: "high" */ "./pages/ResumePdfPages");

/* smallest first */
export const PREFETCH_ORDER = ["/projects", "/about", "/skills", "/resume"];

/* Fetch the resume's phone viewer in the background too, on screens that
   will use it */
export function prefetchExtras() {
  const phone = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  return phone ? loadResumePdf().catch(() => {}) : Promise.resolve();
}

/* The skills map fetches its data on mount; starting that download with the
   page's chunk saves a round trip (GitHub Pages lets the browser cache it,
   so the page's own request is answered from there). */
const PU = process.env.PUBLIC_URL || "";
let skillsDataWarm = null;
function warmPageData(key) {
  if (key === "/skills" && !skillsDataWarm && typeof fetch === "function") {
    skillsDataWarm = fetch(`${PU}/skillsData.json`).catch(() => {});
  }
}

const pending = {};

/* The page a path belongs to ("/projects/spim" -> "/projects"), or null.
   Case-insensitive, like the router's own matching. */
export function pageFor(pathname) {
  const p = (pathname || "").toLowerCase().replace(/\/+$/, "") || "/";
  return Object.keys(LOADERS).find((k) => p === k || p.startsWith(k + "/")) || null;
}

/* Start (or join) the fetch of a page's chunk. Resolves to the module; null
   for paths that are not a split page (the landing, unknown routes).
   background: true is the background prefetch (no data warm-up). */
export function preloadPage(pathname, { background = false } = {}) {
  const key = pageFor(pathname);
  if (!key) return null;
  if (!background) warmPageData(key);
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

/* A lazily loaded chunk inside a page (the resume's phone viewer), with the
   same once-only reload when a deploy removed it, and the same recovery as
   the pages: a failed load gets a fresh lazy on resetFailedPages(), which the
   page's boundaries call, so it is fetched again on the next try. */
const chunkHolders = [];
export function lazyChunk(load) {
  const holder = { failed: false, current: null };
  const make = () =>
    lazy(() =>
      load().catch((err) => {
        if (isChunkError(err) && reloadOnce()) return new Promise(() => {});
        holder.failed = true;
        throw err;
      })
    );
  holder.current = make();
  holder.make = make;
  chunkHolders.push(holder);
  /* A fresh mount (the page opened again, a rotation back to phone width, a
     Try again) retries a failed load; React's own re-renders keep the same
     component, so a failure can never turn into a fetch loop */
  function Chunk(props) {
    const [Current] = useState(() => {
      if (holder.failed) {
        holder.current = holder.make();
        holder.failed = false;
      }
      return holder.current;
    });
    return <Current {...props} />;
  }
  return Chunk;
}

/* Pages that need a moment after mounting before they look finished (the
   skills map builds its graph from data it fetches) say so, and the splash
   waits for that - briefly - so it never fades onto an empty graph. */
const NEEDS_READY = new Set(["/skills"]);
const readyPages = new Set();
export function markPageReady(path) {
  const key = pageFor(path);
  if (!key || readyPages.has(key)) return;
  readyPages.add(key);
  try {
    window.dispatchEvent(new CustomEvent("page-ready", { detail: key }));
  } catch (e) {
    // very old browsers: the splash's own cap moves on
  }
}
export function whenPageReady(pathname, maxMs) {
  const key = pageFor(pathname);
  if (!key || !NEEDS_READY.has(key) || readyPages.has(key)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("page-ready", onReady);
      clearTimeout(timer);
      resolve();
    };
    const onReady = (e) => {
      if (e.detail === key) done();
    };
    const timer = setTimeout(done, maxMs);
    window.addEventListener("page-ready", onReady);
  });
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
  for (const h of chunkHolders) {
    if (h.failed) {
      h.current = h.make();
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
