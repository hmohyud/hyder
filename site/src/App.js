import React, { useEffect, useState } from 'react';
import {
  HashRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from 'react-router-dom';
import './App.css';

import SkillsMap from './pages/SkillsMap';
import Projects from './pages/Projects';
import About from './pages/About';
import Resume from './pages/Resume';

const pages = {
  SkillsMap: { component: <SkillsMap />, path: '/', label: 'Skills' },
  Projects: { component: <Projects />, path: '/projects', label: 'Projects' },
  About: { component: <About />, path: '/about', label: 'About' },
  Resume: { component: <Resume />, path: '/resume', label: 'Resume' },
};

function NavBar() {
  const location = useLocation();

  return (
    <nav className="nav-bar" role="navigation" aria-label="Main Navigation">
      {Object.entries(pages).map(([key, { path, label }]) => (
        <Link
          key={key}
          to={path}
          className={`nav-link ${location.pathname === path ? 'active' : ''}`}
          aria-current={location.pathname === path ? 'page' : undefined}
        >
          <span className="nav-dot" />
          <span className="nav-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function AppContent() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsReady(true));
  }, []);

  return (
    <>
      <div id="bg-animation" />
      <div className={`App ${isReady ? 'visible' : ''}`}>
        <header className="App-header">
          <h1 className="site-title" tabIndex="0">Hyder Mohyuddin</h1>
          <NavBar />
        </header>
        <main className="App-main">
          <Routes>
            {Object.entries(pages).map(([key, { path, component }]) => (
              <Route key={key} path={path} element={component} />
            ))}
          </Routes>
        </main>
      </div>
    </>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
