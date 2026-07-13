import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import "./App.css";

import DotTransitionProvider from "./components/DotTransition";
import Landing from "./pages/Landing";
import SkillsMap from "./pages/SkillsMap";
import Projects from "./pages/Projects";
import About from "./pages/About";
import Resume from "./pages/Resume";
import BgDemo from "./pages/BgDemo";

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
  return (
    <nav className="nav-bar" role="navigation" aria-label="Main Navigation">
      {Object.entries(pages).map(([key, { path, label, accentA, accentB }]) => (
        <Link
          key={key}
          to={path}
          className={`nav-link ${location.pathname === path ? "active" : ""}`}
          aria-current={location.pathname === path ? "page" : undefined}
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
        <main className="App-main">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bg-demo" element={<BgDemo />} />
            {Object.entries(pages).map(([key, { path, component }]) => (
              <Route key={key} path={path} element={component} />
            ))}
          </Routes>
        </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <DotTransitionProvider>
        <AppContent />
      </DotTransitionProvider>
    </Router>
  );
}
