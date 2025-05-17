import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import './App.css';

// ✅ Manually import pages
import SkillsMap from './pages/SkillsMap';
import Projects from './pages/Projects';
import About from './pages/About';

// ✅ Declare all page modules
const importedPages = {
  SkillsMap,
  Projects,
  About,
};

// ✅ Optional override config
const pagesConfig = {
  SkillsMap: { path: '/', label: 'Skills' }, // default route
  // others will fallback to "/componentName" and "componentName" as label
};

const pagesList = Object.entries(importedPages).map(([name, component]) => {
  const config = pagesConfig[name] || {};
  const path = config.path || `/${name.toLowerCase()}`;
  const label = config.label || name;
  return { name, path, label, component };
});

function NavBar() {
  const location = useLocation();
  return (
    <nav>
      {pagesList.map(({ path, label }) => (
        <Link
          key={label}
          to={path}
          className={location.pathname === path ? 'active' : ''}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <header className="App-header">
          <h1>Hyder Mohyuddin</h1>
          <NavBar />
        </header>
        <main>
          <Routes>
            {pagesList.map(({ path, component }, i) => (
              <Route key={i} path={path} element={component} />
            ))}
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
