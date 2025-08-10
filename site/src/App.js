import React, { useEffect, useState } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import "./App.css";

import Landing from "./pages/Landing";
import SkillsMap from "./pages/SkillsMap";
import Projects from "./pages/Projects";
import About from "./pages/About";
import Resume from "./pages/Resume";

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

  useEffect(() => {
    requestAnimationFrame(() => setIsReady(true));
  }, []);

  const isLanding = location.pathname === "/";

  return (
    <>
      <div id="bg-animation" />
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
      <AppContent />
    </Router>
  );
}
