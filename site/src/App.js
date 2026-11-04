import React, { Component, Suspense, lazy, useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import "./App.css";

import LandingFocus from "./pages/LandingFocus"; // the landing: the portrait at the centre of the cards
/* The other pages' stylesheets stay in the main stylesheet, in the order the
   pages were imported before they were split out. A page's CSS arriving later
   in its own chunk would land after FloatingHead.css and the rest, and quietly
   change which rule wins wherever two files style the same thing. */
import "./pages/SkillsMap.css";
import "./pages/About.css";
import "./pages/Resume.css";
import FloatingHead from "./components/FloatingHead";
import CopyEmail from "./components/CopyEmail";
import { lazyPage, preloadPage, PREFETCH_ORDER } from "./pageLoaders";

/* Every page but the landing loads its own code (src/pageLoaders.js) */
const SkillsMap = lazyPage("/skills");
const Projects = lazyPage("/projects");
const About = lazyPage("/about");
const Resume = lazyPage("/resume");
// development only: the head alone with the neck-cut editor (/cut)
const CutEditor =
  process.env.NODE_ENV === "development" ? lazy(() => import("./pages/CutEditor")) : null;

/**
 * Map each page to its accent pair (matches your card-1..4 colors)
 * card-1  -> #ff72a1 → #ffb8d0
 * card-2  -> #b48bff → #92a2ff
 * card-3  -> #7fd3ff → #9fe1ff
 * card-4  -> #78ffa8 → #c7ffd8
 */
const pages = {
  SkillsMap: {
    component: <SkillsMap />,
    path: "/skills",
    label: "Skills",
    accentA: "#ff72a1",
    accentB: "#ffb8d0",
  },
  Projects: {
    component: <Projects />,
    path: "/projects",
    label: "Projects",
    accentA: "#b48bff",
    accentB: "#92a2ff",
  },
  About: {
    component: <About />,
    path: "/about",
    label: "About",
    accentA: "#7fd3ff",
    accentB: "#9fe1ff",
  },
  Resume: {
    component: <Resume />,
    path: "/resume",
    label: "Resume",
    accentA: "#78ffa8",
    accentB: "#c7ffd8",
  },
};

function NavBar() {
  const location = useLocation();
  // A subpage (e.g. /projects/spim) keeps its section's nav link active
  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + "/");
  return (
    <nav className="nav-bar" role="navigation" aria-label="Main Navigation">
      {Object.entries(pages).map(([key, { path, label, accentA, accentB }]) => (
        <Link
          key={key}
          to={path}
          onMouseEnter={() => preloadPage(path)}
          onFocus={() => preloadPage(path)}
          onTouchStart={() => preloadPage(path)}
          className={`nav-link ${isActive(path) ? "active" : ""}`}
          aria-current={isActive(path) ? "page" : undefined}
          /* expose per-link accent colors to CSS */
          style={{
            // consumed by CSS for underline/hover/active
            "--accentA": accentA,
            "--accentB": accentB,
          }}
        >
          {/* <span className="nav-dot" /> */}
          <span className="nav-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

const CONTACT = {
  email: "hyder.mohyuddin@gmail.com",
  github: "https://github.com/hmohyud",
};

function SiteFooter({ flush = false }) {
  return (
    <footer className={`site-footer${flush ? " site-footer--flush" : ""}`}>
      <CopyEmail email={CONTACT.email} />
      <span className="site-footer-sep" aria-hidden="true">·</span>
      <a href={CONTACT.github} target="_blank" rel="noopener noreferrer">
        github
      </a>
    </footer>
  );
}

/* Start each page at the top — without this, deep pages hand their scroll
   position to the next route. Skipped on POP (back/forward) so the browser's
   own scroll restoration still works. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType === "POP") return;
    /* The window is not always what scrolled. On small screens .App-main is a
       scroll box of its own, so window.scrollTo left it exactly where the last
       page ended and the new route opened halfway down. Reset both, plus the
       document element, since which one owns the scroll depends on viewport. */
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    const main = document.querySelector(".App-main");
    if (main) main.scrollTop = 0;
  }, [pathname, navType]);
  return null;
}

/* A page that failed to load or crashed shows a way out instead of a blank
   window; moving to another page clears it. */
class PageBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev) {
    if (prev.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <div className="page-load-error" role="alert">
        <p>{offline ? "This page could not load - you look to be offline." : "This page could not load."}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
}

/* Once the site is up and the browser has a quiet moment, fetch the other
   pages' code one at a time, so a later click is instant and a deploy can no
   longer leave this tab without them. It waits a few seconds first so the
   landing's own downloads (the head's point cloud and shell) go first, and it
   stays off when the visitor has asked to save data or is on a 2G link. */
function usePrefetchPages(isReady) {
  useEffect(() => {
    if (!isReady) return;
    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ""))) return;
    const queue = [...PREFETCH_ORDER];
    let cancelled = false;
    let timer = 0;
    let idleId = 0;
    const whenIdle = (fn) => {
      if (window.requestIdleCallback) idleId = window.requestIdleCallback(fn, { timeout: 5000 });
      else timer = setTimeout(fn, 300);
    };
    const next = () => {
      if (cancelled || !queue.length) return;
      Promise.resolve(preloadPage(queue.shift()))
        .catch(() => {}) // a background miss is simply retried on the visit itself
        .then(() => {
          if (!cancelled) whenIdle(next);
        });
    };
    timer = setTimeout(() => whenIdle(next), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (idleId && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
    };
  }, [isReady]);
}

function AppContent() {
  const [isReady, setIsReady] = useState(false);
  const location = useLocation();

  /* Dismiss the raw-HTML splash loader once its logo has formed and the page
     under it has settled. The loader overlay and the page cross-fade
     simultaneously (no blank gap). Corner gradients are already gated behind
     .App.visible / #bg-animation.visible so they can never appear ahead of
     the page.
     The loader (public/index.html) sets window.__loaderDone and fires
     "loader-done" when the logo has formed. In a build this bundle only runs
     after that (build-route-shells.mjs), so it is normally already true here;
     in development, or in a tab that loaded in the background, it waits for
     the event. A visit that opens on another page also waits for that page's
     own chunk (already on its way, see src/index.js), so the loader never
     fades onto an empty page. Then two frames, so the page's first draw (the
     landing's WebGL shaders compile on it) happens under the cover rather
     than as a hitch at the start of the fade.
     window.__appUp tells the loader the app is already here: a tab opened in
     the background shows its finished logo when first seen instead of
     assembling it over the app's first frames.
     The cap is for a loader that never reports. It only counts while the
     page can be seen, so a background tab's splash is never cut off halfway
     by time that passed while nobody was looking. */
  useEffect(() => {
    const loader = document.getElementById("loader");

    const reveal = () => requestAnimationFrame(() => setIsReady(true));

    if (!loader) {
      reveal();
      return;
    }
    window.__appUp = true;

    let gone = false;
    let raf = 0;
    let cancelled = false;
    const exit = () => {
      if (gone) return;
      gone = true;
      loader.classList.add("loader-exit");
      reveal();
      const removeLoader = () => { if (loader.parentNode) loader.remove(); };
      loader.addEventListener("transitionend", removeLoader, { once: true });
      setTimeout(removeLoader, 700); // safety
    };
    const afterFirstFrames = () => {
      if (raf || gone) return;
      raf = requestAnimationFrame(() => { raf = requestAnimationFrame(exit); });
    };

    const whenFormed = () => {
      if (window.__loaderDone) afterFirstFrames();
      else window.addEventListener("loader-done", afterFirstFrames);
    };
    const opening = preloadPage(window.location.pathname);
    if (opening) opening.catch(() => {}).then(() => { if (!cancelled) whenFormed(); });
    else whenFormed();

    let cap = 0;
    const armCap = () => {
      clearTimeout(cap);
      cap = 0;
      if (!gone && document.visibilityState !== "hidden" && !document.prerendering) cap = setTimeout(exit, 4000);
    };
    armCap();
    document.addEventListener("visibilitychange", armCap);
    document.addEventListener("prerenderingchange", armCap);

    return () => {
      cancelled = true;
      window.removeEventListener("loader-done", afterFirstFrames);
      document.removeEventListener("visibilitychange", armCap);
      document.removeEventListener("prerenderingchange", armCap);
      clearTimeout(cap);
      cancelAnimationFrame(raf);
    };
  }, []);

  usePrefetchPages(isReady);

  const isLanding = location.pathname === "/" || location.pathname === "/cut";

  /* Keep the tab title in sync on client-side navigation (mirrors the
     per-route titles the build-route-shells script bakes into the shells). */
  useEffect(() => {
    const seg = location.pathname.match(/^\/[^/]*/)?.[0] || "/";
    const page = Object.values(pages).find((p) => p.path === seg);
    document.title = page
      ? `${page.label} | Hyder Mohyuddin`
      : "Hyder Mohyuddin | Portfolio";
  }, [location.pathname]);

  return (
    <>
      <div id="bg-animation" className={isReady ? "visible" : ""} />
      <div className={`App ${isReady ? "visible" : ""}`}>
        {!isLanding && (
          <header className="App-header">
            <Link to="/" className="site-title site-title-link" aria-label="Go to landing">
              Hyder Mohyuddin
            </Link>
            <NavBar />
          </header>
        )}
        <main className={`App-main${isLanding ? " App-main--landing" : ""}`}>
          <ScrollToTop />
          {/* null fallback: a first visit's page is loaded before the splash
              leaves, and a click inside the site is a transition, which keeps
              the current page up until the next one is ready */}
          <PageBoundary page={location.pathname}>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<LandingFocus />} />
                {CutEditor && <Route path="/cut" element={<CutEditor />} />}
                {Object.entries(pages).map(([key, { path, component }]) => (
                  <Route key={key} path={path} element={component} />
                ))}
              </Routes>
            </Suspense>
          </PageBoundary>
        </main>
        {/* About's physics floor sits at its container bottom — keep the
            footer flush there so no dead band appears under the blocks */}
        {!isLanding && (
          <SiteFooter flush={location.pathname.startsWith("/about")} />
        )}
        {!isLanding && <FloatingHead fabOnly />}
      </div>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
