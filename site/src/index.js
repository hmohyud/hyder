import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { preloadPage } from './pageLoaders';

/* A visit that opens on a page other than the landing fetches that page's
   own chunk first and renders once it is in, so the page is part of React's
   first render (src/pageLoaders.js): nothing suspends, and the splash never
   leaves over an empty page. The splash covers the wait. A chunk that fails
   renders anyway, into the error handling; one that hangs gets 8 s. */
const openingPage = preloadPage(window.location.pathname);

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
let rendered = false;
const render = () => {
  if (rendered) return;
  rendered = true;
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};
if (openingPage) {
  openingPage.then(render, render);
  setTimeout(render, 8000);
} else {
  render();
}

reportWebVitals();
