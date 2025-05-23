import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

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
