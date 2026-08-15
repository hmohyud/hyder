import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import "./App.css";

import Landing from "./pages/Landing";
import SkillsMap from "./pages/SkillsMap";
import Projects from "./pages/Projects";
import About from "./pages/About";
import Resume from "./pages/Resume";
import BgDemo from "./pages/BgDemo";
import FloatingHead from "./components/FloatingHead";
import CopyEmail from "./components/CopyEmail";

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

function AppContent() {
  const [isReady, setIsReady] = useState(false);
  const location = useLocation();

  /* Dismiss the raw-HTML splash loader after MINIMUM_SHOW ms. The loader
     overlay and the page cross-fade simultaneously (no blank gap). Corner
     gradients are already gated behind .App.visible / #bg-animation.visible
     so they can never appear ahead of the page. */
  useEffect(() => {
    const MINIMUM_SHOW = 1050;
    const loader = document.getElementById("loader");

    const reveal = () => requestAnimationFrame(() => setIsReady(true));

    if (!loader) {
      reveal();
      return;
    }

    const t = setTimeout(() => {
      loader.classList.add("loader-exit");
      reveal();
      const removeLoader = () => { if (loader.parentNode) loader.remove(); };
      loader.addEventListener("transitionend", removeLoader, { once: true });
      setTimeout(removeLoader, 700); // safety
    }, MINIMUM_SHOW);

    return () => clearTimeout(t);
  }, []);

  const isLanding = location.pathname === "/";

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
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bg-demo" element={<BgDemo />} />
            {Object.entries(pages).map(([key, { path, component }]) => (
              <Route key={key} path={path} element={component} />
            ))}
          </Routes>
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
