import React, { useEffect, useState } from 'react';

const projects = [
  {
    title: 'SPIM (Salavon’s Pathology Inducing Machine)',
    color: '#00d1ff',
    image: '/images/spim-placeholder.png',
    description: [
      `An experimental platform that lets users manipulate the internal layers of diffusion models to generate off-manifold, dreamlike imagery.`,
      `I built the full-stack system: secure Python backend, custom memory management, tensor manipulation pipelines, and a React-based interface.`,
      `Also implemented filtering tools for statistical novelty, interpolation modules, and Voronoi-based ultra-high-res generation techniques.`
    ],
    links: [
      { label: 'Visit Site', href: 'https://latentculture.com/spim/' }
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

  // NEW: ComfyUI character pipeline
  {
    title: 'ComfyUI Character Pipeline — Consistent Kids’ Book Art',
    color: '#b48bff',
    image: '/images/comfyui-kidsbook.jpg', // add a screenshot/export
    description: [
      'A reproducible ComfyUI workflow to keep a main character consistent across a whole picture book: poses, outfits, angles, scenes.',
      'Techniques: identity conditioning (IP-Adapter / LoRA) blending, ControlNet pose, prompt/seed scheduling, palette locks, and layout templates.',
      'Exports print-ready spreads (bleed & safe margins) and auto-generates a “character bible” sheet from the same graph.'
    ],
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
  },

  // Jar Jar bot
  {
    title: 'Jar Jar Quote Bot (Twitter/X)',
    color: '#ff6b9d',
    image: '/images/jarjar-placeholder.jpg',
    description: [
      `Daily pipeline that scrapes a random historical quote, translates it into Jar Jar Binks (Gungan) speech, and posts the result.`,
      `To bypass character limits, the text is rendered onto an AI-generated background image before posting.`,
      `Includes basic scheduling, retries/rate-limit handling, and content moderation checks.`,
    ],
    links: [
      { label: 'View on X', href: 'https://x.com/JarJarbinksays' }
    ]
  },

  // Aerospace project with repo link
  {
    title: 'Aerospace Part Finder (Async Scraper + Local LLM)',
    color: '#b3fff2ff',
    image: '/images/aero-placeholder.jpg',
    description: [
      `Personal convenience tool to search suppliers for exact aerospace part numbers and officially documented equivalents.`,
      `Stack: async DuckDuckGo fallback, trafilatura (static) + Playwright (JS) scraping, concurrency, deduping, and a local llama.cpp model for structured JSON review.`,
      `Streams progress and tallies results; resilient to blocks with multiple fetch strategies and timeouts.`,
    ],
    links: [
      { label: 'Visit Site', href: 'https://hmohyud.github.io/azizproj/' },
      { label: 'GitHub', href: 'https://github.com/hmohyud/azizproj' },
      // If you put up a hosted demo later, add it here:
      // { label: 'Live demo', href: 'https://your-demo-url.example' },
    ]
  },

  {
    title: 'Client Sites & Revamps',
    color: '#c3ff7f',
    image: '/images/sites-placeholder.jpg',
    description: [
      `Edited and refreshed sites for several people: accessibility passes, responsive layouts, perf budgets, and SEO fixes.`,
      `Typical stack: React/Vite/Next or lightweight static builds (Eleventy). Integrated forms, CMS where needed, and CI deploys.`,
    ]
  },
  {
    title: 'Motām — Poetry Collection',
    color: '#ffd166',
    image: '/images/motam-preview.jpg',
    description: [
      `A simple, quiet website to present my grandmother’s poetry collection across the years.`,
      `Typography-focused, accessible, and easy to maintain.`,
    ],
    links: [
      { label: 'Visit Site', href: 'https://hmohyud.github.io/motam/' }
    ]
  },

  {
    title: 'AutoLens — Visual Vehicle ID (Expo)',
    color: '#6bff9d',
    image: '/images/autolens-preview.jpg',
    description: [
      'Mobile app that identifies cars from a photo (or live camera) and breaks down model trims, years, and key specs.',
      'Built with Expo + React Native; on-device pre/post-processing, server-side model inference, and a clean results UI.',
      'Preview it on your phone with Expo.'
    ],
    links: [
      {
        // Opens a web page that lets users open the app if they have Expo Go installed.
        label: 'Open preview (Expo Go installed)',
        href: 'https://expo.dev/preview/update?message=Initial+commit%0A%0AGenerated+by+create-expo-app+3.4.2.&updateRuntimeVersion=1.0.0&createdAt=2025-06-30T12%3A23%3A53.766Z&slug=exp&projectId=bf485ddb-a27e-47b0-b8ba-444f4dbde301&group=ee75b629-263a-4bc1-aa43-7aa4a5313843'
      },
    ],
    // For the fullscreen QR overlay button
    qrData: 'https://expo.dev/preview/update?message=Initial+commit%0A%0AGenerated+by+create-expo-app+3.4.2.&updateRuntimeVersion=1.0.0&createdAt=2025-06-30T12%3A23%3A53.766Z&slug=exp&projectId=bf485ddb-a27e-47b0-b8ba-444f4dbde301&group=ee75b629-263a-4bc1-aa43-7aa4a5313843'
  }
];

// Build a QR image URL (no extra deps)
const qrSrc = (data, size = 520) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;

export default function Projects() {
  const [qrOpen, setQrOpen] = useState(null); // { title, data, color } | null

  // Lock background scroll when overlay is open
  useEffect(() => {
    if (qrOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [qrOpen]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setQrOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{
      padding: '0 2rem',
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
          <div
            role="img"
            aria-label={`${proj.title} preview`}
            style={{
              flex: '0 0 280px',
              height: '180px',
              backgroundColor: '#1a1a1a',
              backgroundImage: `url(${proj.image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              borderRadius: '8px',
              border: `1px solid ${proj.color}`,
              boxShadow: '0 0 10px rgba(255, 255, 255, 0.04)'
            }}
          />

          <div style={{ flex: '1 1 500px' }}>
            <h2 style={{ color: proj.color, margin: '0 0 0.5rem 0', fontSize: '1.3rem' }}>
              {proj.title}
            </h2>
            {proj.description.map((line, j) => (
              <p key={j} style={{ margin: '0 0 0.75rem 0' }}>{line}</p>
            ))}

            {proj.links?.length ? (
              <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {proj.links.map((l, k) => (
                  <a
                    key={k}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '6px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${proj.color}`,
                      color: proj.color,
                      textDecoration: 'none',
                      fontSize: '0.9rem',
                      transition: 'all .2s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.backgroundColor = `${proj.color}22`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {l.label}
                  </a>
                ))}

                {/* Fullscreen QR overlay trigger (only for items with qrData) */}
                {proj.qrData ? (
                  <button
                    type="button"
                    onClick={() => setQrOpen({ title: proj.title, data: proj.qrData, color: proj.color })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${proj.color}`,
                      background: 'transparent',
                      color: proj.color,
                      fontSize: '0.9rem',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${proj.color}22`; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    aria-haspopup="dialog"
                    aria-expanded={qrOpen ? true : false}
                  >
                    Show QR (scan in Expo Go)
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}

      <p style={{ fontStyle: 'italic', marginTop: '2rem' }}>
        More projects — including visual experiments, creative tools, and exploratory AI work — coming soon.
      </p>

      {/* Fullscreen QR overlay */}
      {qrOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR code overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQrOpen(null); // close on backdrop click
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'grid',
            placeItems: 'center',
            padding: '24px'
          }}
        >
          <div
            style={{
              width: 'min(92vw, 720px)',
              borderRadius: 16,
              border: `1px solid ${qrOpen.color || '#4af'}`,
              background: '#0b0f14',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              padding: '20px',
              display: 'grid',
              gap: '14px',
              animation: 'zoomIn .15s ease'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, color: '#eaeaea', fontSize: 18 }}>
                Scan to open: <span style={{ color: qrOpen.color }}>{qrOpen.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setQrOpen(null)}
                style={{
                  border: '1px solid #2a2f3a',
                  background: 'transparent',
                  color: '#bfc6d6',
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#151a21'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Close (Esc)
              </button>
            </div>

            <p style={{ margin: 0, color: '#bfc6d6', fontSize: 14 }}>
              Tip: Install <b>Expo Go</b> on iOS/Android. Then scan this QR to open the preview.
            </p>

            <div style={{ display: 'grid', placeItems: 'center', padding: '8px 0 2px' }}>
              <img
                src={qrSrc(qrOpen.data, 720)}
                alt="QR code for Expo preview"
                style={{
                  width: 'min(80vw, 70vh)',
                  height: 'auto',
                  maxWidth: 560,
                  borderRadius: 12,
                  border: '1px solid #2a2f3a',
                  background: '#0f141c',
                  padding: 12
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <a
                href={qrOpen.data}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: `1px solid ${qrOpen.color}`,
                  color: qrOpen.color,
                  textDecoration: 'none',
                  background: 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${qrOpen.color}22`; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                Open preview in browser
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(qrOpen.data);
                    alert('Preview URL copied to clipboard');
                  } catch {
                    prompt('Copy this URL:', qrOpen.data);
                  }
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #2a2f3a',
                  background: 'transparent',
                  color: '#eaeaea',
                  cursor: 'pointer'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#151a21'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Copy preview URL
              </button>
            </div>
          </div>

          <style>{`
            @keyframes zoomIn {
              from { transform: scale(0.98); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
