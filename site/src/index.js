import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { preloadPage } from './pageLoaders';

/* A visit that opens on a page other than the landing starts fetching that
   page's own chunk now, alongside React's first render, rather than when the
   router first asks for it. */
const openingPage = preloadPage(window.location.pathname);
if (openingPage) openingPage.catch(() => {}); // a miss is handled where the page renders

// Background dot generation
document.addEventListener('DOMContentLoaded', () => {
  const NUM_DOTS = 60;
  const container = document.getElementById('bg-animation');
  if (container && container.childNodes.length === 0) {
    for (let i = 0; i < NUM_DOTS; i++) {
      const dot = document.createElement('div');
      dot.className = 'bg-dot';
      dot.style.left = `${Math.random() * 100}vw`;
      dot.style.top = `${100 + Math.random() * 100}vh`;
      dot.style.animationDuration = `${10 + Math.random() * 30}s`;
      container.appendChild(dot);
    }
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
