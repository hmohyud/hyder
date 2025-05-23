import React from 'react';

const projects = [
  {
    title: 'SPIM (Salavon’s Pathology Inducing Machine)',
    color: '#00d1ff',
    image: '/images/spim-placeholder.png', // replace with actual image path
    description: [
      `An experimental platform that lets users manipulate the internal layers of diffusion models to generate off-manifold, dreamlike imagery.`,
      `I built the full-stack system: secure Python backend, custom memory management, tensor manipulation pipelines, and a React-based interface.`,
      `Also implemented filtering tools for statistical novelty, interpolation modules, and Voronoi-based ultra-high-res generation techniques.`
    ]
  },
  {
    title: 'Environmental Data Globe (Booth School of Business)',
    color: '#00ff88',
    image: '/images/globe-placeholder.png',
    description: [
      `Built an interactive globe for visualizing over 200GB of environmental data using JavaScript and Three.js.`,
      `Developed dynamic cluster filtering, palette switching, and automated SQL data preprocessing in Python to support visual clarity and performance.`,
    ]
  },
  {
    title: 'AI Research & Model Tools',
    color: '#ffaa00',
    image: '/images/ai-tools-placeholder.png',
    description: [
      `Created tooling for structured experimentation with diffusion models: formula generators, pixel-level perturbations, and statistical logging systems.`,
      `These tools were used to explore model interpretability, generative tuning, and output consistency.`
    ]
  },
  {
    title: 'Educational Tech & Curriculum',
    color: '#ff8888',
    image: '/images/teaching-placeholder.png',
    description: [
      `Taught programming through nonprofits (Code Platoon, Code Your Dreams) and private tutoring.`,
      `Built MIT App Inventor examples, interactive modules, and developed beginner-friendly teaching content for both students and veterans.`
    ]
  },
  {
    title: 'IT Support & Deployment Automation',
    color: '#bbbbbb',
    image: '/images/it-placeholder.png',
    description: [
      `Provided in-person IT support and automated OS/application setup for 100+ machines at the University of Chicago.`,
      `This early experience taught me about system maintenance, scripting, and hands-on problem-solving.`
    ]
  }
];

export default function Projects() {
  return (
    <div style={{
      padding: '0.1rem 2rem',
      maxWidth: '1000px',
      margin: '0 auto',
      fontFamily: 'monospace',
      color: '#eaeaea',
      lineHeight: 1.6
    }}>
      <h1 style={{
        fontSize: '2rem',
        marginBottom: '2rem',
        borderBottom: '1px solid #444',
        paddingBottom: '0.5rem'
      }}>
        Projects
      </h1>

      {projects.map((proj, i) => (
        <div key={i} style={{
          display: 'flex',
          flexWrap: 'wrap',
          marginBottom: '3rem',
          gap: '1.5rem',
          alignItems: 'flex-start'
        }}>
          <div style={{
            flex: '0 0 280px',
            height: '180px',
            backgroundColor: '#1a1a1a',
            backgroundImage: `url(${proj.image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            borderRadius: '8px',
            border: `1px solid ${proj.color}`,
            boxShadow: '0 0 10px rgba(255, 255, 255, 0.04)'
          }} />

          <div style={{ flex: '1 1 500px' }}>
            <h2 style={{ color: proj.color, margin: '0 0 0.5rem 0', fontSize: '1.3rem' }}>{proj.title}</h2>
            {proj.description.map((line, j) => (
              <p key={j} style={{ margin: '0 0 0.75rem 0' }}>{line}</p>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontStyle: 'italic', marginTop: '2rem' }}>
        More projects — including visual experiments, creative tools, and exploratory AI work — coming soon.
      </p>
    </div>
  );
}
