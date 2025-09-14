import React, { useEffect, useMemo, useRef, useState } from 'react';

// ---------- Helper: build an array of SPIM images in /public/hyder/projects ----------
const SPIM_IMAGES = Array.from({ length: 5 }, (_, i) => `/hyder/projects/SPIM_${i + 1}.jpg`);
const JARJAR_IMAGES = Array.from({ length: 4 }, (_, i) => `/hyder/projects/JARJAR_${i + 1}.jpg`);
const SPEC_IMAGES = Array.from({ length: 5 }, (_, i) => `/hyder/projects/SPEC_${i + 1}.jpg`);
const COOK_IMAGES = Array.from({ length: 4 }, (_, i) => `/hyder/projects/COOK_${i + 1}.jpg`);

const projects = [
  {
    title: 'SPIM (Salavon’s Pathology Inducing Machine)',
    color: '#00d1ff',
    images: SPIM_IMAGES,
    description: [
      `An experimental platform that lets users manipulate the internal layers of diffusion models to generate off-manifold, dreamlike imagery.`,
      `I built the full-stack system: secure Python backend, custom memory management, tensor manipulation pipelines, and a React-based interface.`,
      `Also implemented filtering tools for statistical novelty, interpolation modules, and Voronoi-based ultra-high-res generation techniques.`
    ],
    links: [{ label: 'Visit Site', href: 'https://latentculture.com/spim/' }]
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
    image: '/images/comfyui-kidsbook.jpg',
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
    images: JARJAR_IMAGES,
    description: [
      `Daily pipeline that scrapes a random historical quote, translates it into Jar Jar Binks (Gungan) speech, and posts the result.`,
      `To bypass character limits, the text is rendered onto an AI-generated background image before posting.`,
      `Includes basic scheduling, retries/rate-limit handling, and content moderation checks.`,
    ],
    links: [{ label: 'View on X', href: 'https://x.com/JarJarbinksays' }]
  },

  // Aerospace project with repo link
  {
    title: 'Aerospace Part Finder (Async Scraper + Local LLM)',
    color: '#b3fff2ff',
    images: SPEC_IMAGES,
    description: [
      `Personal convenience tool to search suppliers for exact aerospace part numbers and officially documented equivalents.`,
      `Stack: async DuckDuckGo fallback, trafilatura (static) + Playwright (JS) scraping, concurrency, deduping, and a local llama.cpp model for structured JSON review.`,
      `Streams progress and tallies results; resilient to blocks with multiple fetch strategies and timeouts.`,
    ],
    links: [
      { label: 'Visit Site', href: 'https://hmohyud.github.io/azizproj/' },
      { label: 'GitHub', href: 'https://github.com/hmohyud/azizproj' },
    ]
  },

  {
    title: 'Client Sites & Revamps',
    color: '#fe5757ff',
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
    links: [{ label: 'Visit Site', href: 'https://hmohyud.github.io/motam/' }]
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
        label: 'Open preview (Expo Go installed)',
        href: 'https://expo.dev/preview/update?message=Initial+commit%0A%0AGenerated+by+create-expo-app+3.4.2.&updateRuntimeVersion=1.0.0&createdAt=2025-06-30T12%3A23%3A53.766Z&slug=exp&projectId=bf485ddb-a27e-47b0-b8ba-444f4dbde301&group=ee75b629-263a-4bc1-aa43-7aa4a5313843'
      },
    ],
    qrData: 'https://expo.dev/preview/update?message=Initial+commit%0A%0AGenerated+by+create-expo-app+3.4.2.&updateRuntimeVersion=1.0.0&createdAt=2025-06-30T12%3A23%3A53.766Z&slug=exp&projectId=bf485ddb-a27e-47b0-b8ba-444f4dbde301&group=ee75b629-263a-4bc1-aa43-7aa4a5313843'
  },
  {
  title: 'Pocket Sous Chef',
  color: '#c3ff7f',
  images: COOK_IMAGES,
  description: [
    'iOS recipe assistant that turns pantry photos or typed ingredients into step-by-step recipes.',
    'Built with SwiftUI + SwiftData; OpenAI proxy for text + vision; saved recipes with nutrition.',
    'Privacy-minded: no account; recipes saved on device.'
  ],
  links: [
    { label: 'App Store', href: 'https://apps.apple.com/us/app/pocket-sous-chef/id6751048251' },
    { label: 'Support', href: 'https://hmohyud.github.io/pocketsouschef-support/' }
  ]
},

];

// Build a QR image URL (no extra deps)
const qrSrc = (data, size = 520) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;

/** Preload a list of URLs and tell which ones succeeded */
function usePreloaded(srcs) {
  const [ok, setOk] = useState(() => srcs.map(() => false));

  useEffect(() => {
    let alive = true;
    setOk(srcs.map(() => false));

    srcs.forEach((src, i) => {
      if (!src) return;
      const img = new Image();

      const mark = () => alive && setOk(prev => {
        if (prev[i]) return prev;
        const next = [...prev];
        next[i] = true;
        return next;
      });

      img.onload = mark;
      img.onerror = () => {}; // ignore; failed ones stay false
      img.decoding = 'async';
      img.src = src;

      // handle already-cached
      if (img.complete && img.naturalWidth > 0) {
        // queue microtask to mimic async onload
        Promise.resolve().then(mark);
      }
    });

    return () => { alive = false; };
  }, [srcs]);

  return ok; // boolean per src
}

// --------- RotatingImage (background layers; no <img> icons; robust) ---------
function RotatingImage({
  images = [],
  width = 280,
  height = 180,
  borderColor = '#4af',
  altBase = 'project image',
  intervalMs = 5000,
  onClick,
  fit = 'height', // 'height' | 'contain' | 'cover' | 'width'
}) {
  const ok = usePreloaded(images);
  const visibleIdxs = useMemo(() => images.map((_, i) => (ok[i] ? i : -1)).filter(i => i >= 0), [images, ok]);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  // keep idx in bounds as visible set changes
  useEffect(() => {
    if (idx >= visibleIdxs.length) setIdx(0);
  }, [visibleIdxs.length, idx]);

  const next = () => setIdx(i => (i + 1) % Math.max(visibleIdxs.length, 1));

  // autoplay among visible
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (visibleIdxs.length > 1) {
      timerRef.current = setInterval(next, intervalMs);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [intervalMs, visibleIdxs.length]);

  // bg-size mapping
  const bgSize =
    fit === 'cover' ? 'cover' :
    fit === 'contain' ? 'contain' :
    fit === 'width' ? '100% auto' :
    'auto 100%'; // height

  const activeReal = visibleIdxs.length ? visibleIdxs[idx] : -1;
  const usable = visibleIdxs.length > 0;

  return (
    <div
      role="img"
      aria-label={`${altBase} — slideshow`}
      onMouseEnter={() => { if (timerRef.current) clearInterval(timerRef.current); }}
      onMouseLeave={() => {
        if (!timerRef.current && visibleIdxs.length > 1) {
          timerRef.current = setInterval(next, intervalMs);
        }
      }}
      onClick={() => { if (usable) onClick?.(idx); }}
      style={{
        position: 'relative',
        width,
        height,
        flex: `0 0 ${width}px`,
        cursor: usable ? 'pointer' : 'default',
        overflow: 'hidden',
        backgroundColor: '#1a1a1a', // clean placeholder
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        boxShadow: '0 0 10px rgba(255,255,255,0.04)'
      }}
    >
      {images.map((src, i) => {
        if (!ok[i]) return null; // never render failed/not-yet-loaded frames
        return (
          <div
            key={src + i}
            aria-hidden={activeReal !== i}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${src})`,
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: bgSize,
              transition: 'opacity 600ms ease',
              opacity: activeReal === i ? 1 : 0
            }}
          />
        );
      })}
      {!usable && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: '#1a1a1a' }} />}
    </div>
  );
}

export default function Projects() {
  const [qrOpen, setQrOpen] = useState(null);      // { title, data, color } | null
  const [lightbox, setLightbox] = useState(null);  // { title, color, images, index }

  // Lock background scroll when any overlay is open
  useEffect(() => {
    const anyOpen = Boolean(qrOpen || lightbox);
    const prev = document.body.style.overflow;
    if (anyOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [qrOpen, lightbox]);

  // Keyboard: Esc closes overlays, arrows navigate lightbox
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else if (qrOpen) setQrOpen(null);
      }
      if (lightbox) {
        if (e.key === 'ArrowRight') setLightbox((lb) => ({ ...lb, index: (lb.index + 1) % lb.images.length }));
        if (e.key === 'ArrowLeft')  setLightbox((lb) => ({ ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrOpen, lightbox]);

  const navButtonStyle = (color, side) => ({
    position: 'absolute',
    [side]: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 44,
    height: 44,
    padding: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '9999px',
    border: `1px solid ${color}`,
    background: 'rgba(0,0,0,0.45)',
    color,
    cursor: 'pointer',
    userSelect: 'none',
    lineHeight: 1,
    fontSize: 22,
  });

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

      {projects.map((proj, i) => {
        const images = proj.images || (proj.image ? [proj.image] : []);
        return (
          <div key={i} style={{
            display: 'flex',
            flexWrap: 'wrap',
            marginBottom: '3rem',
            gap: '1.5rem',
            alignItems: 'flex-start'
          }}>
            {/* Image box (slideshow if multiple images) */}
            <RotatingImage
              images={images}
              borderColor={proj.color}
              altBase={`${proj.title} preview`}
              fit="height" // fill height, centered (side-crop if needed)
              onClick={(index) => {
                if (!images.length) return;
                // Lightbox opens with the same list; it's okay if some are broken; previews no longer flash
                const start = Math.min(index, (images.length || 1) - 1);
                setLightbox({ title: proj.title, color: proj.color, images, index: start });
              }}
            />

            {/* Text/content */}
            <div style={{ flex: '1 1 500px' }}>
              <h2 style={{ color: proj.color, margin: '0 0 0.5rem 0', fontSize: '1.3rem' }}>
                {proj.title}
              </h2>
              {proj.description?.map((line, j) => (
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
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${proj.color}22`; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
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
        );
      })}

      <p style={{ fontStyle: 'italic', marginTop: '2rem' }}>
        More projects — including visual experiments, creative tools, and exploratory AI work — coming soon.
      </p>

      {/* Fullscreen QR overlay */}
      {qrOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR code overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setQrOpen(null); }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', zIndex: 9999,
            display: 'grid', placeItems: 'center', padding: 24
          }}
        >
          <div style={{
            width: 'min(92vw, 720px)',
            borderRadius: 16,
            border: `1px solid ${qrOpen.color || '#4af'}`,
            background: '#0b0f14',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            padding: 20, display: 'grid', gap: 14,
            animation: 'zoomIn .15s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, color: '#eaeaea', fontSize: 18 }}>
                Scan to open: <span style={{ color: qrOpen.color }}>{qrOpen.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setQrOpen(null)}
                style={{ border: '1px solid #2a2f3a', background: 'transparent', color: '#bfc6d6', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
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
                  width: 'min(80vw, 70vh)', height: 'auto', maxWidth: 560,
                  borderRadius: 12, border: '1px solid #2a2f3a', background: '#0f141c', padding: 12
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <a
                href={qrOpen.data}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '8px 12px', borderRadius: 10, border: `1px solid ${qrOpen.color}`,
                  color: qrOpen.color, textDecoration: 'none', background: 'transparent',
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
                  padding: '8px 12px', borderRadius: 10, border: '1px solid #2a2f3a',
                  background: 'transparent', color: '#eaeaea', cursor: 'pointer'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#151a21'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Copy preview URL
              </button>
            </div>
          </div>

          <style>{`
            @keyframes zoomIn { from { transform: scale(0.98); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          `}</style>
        </div>
      )}

      {/* Lightbox overlay for image previews */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.title} image viewer`}
          onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000,
                   display: 'grid', gridTemplateRows: 'auto 1fr auto', padding: 16 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, color: '#eaeaea', fontSize: 18 }}>{lightbox.title}</h3>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              style={{ border: '1px solid #2a2f3a', background: 'transparent', color: '#bfc6d6', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#151a21'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Close (Esc)
            </button>
          </div>

          <div style={{ position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            <img
              src={lightbox.images[lightbox.index]}
              alt={`${lightbox.title} ${lightbox.index + 1}`}
              style={{
                maxWidth: 'min(92vw, 1400px)',
                maxHeight: 'min(80vh, 90vh)',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                // borderRadius: 12,
                border: `1px solid ${lightbox.color}`,
                boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
              }}
              onError={() => {
                // If a lightbox image fails, advance to the next (avoid broken icon in overlay)
                setLightbox(lb => {
                  const n = lb.images.length || 1;
                  return { ...lb, index: (lb.index + 1) % n };
                });
              }}
            />
            {lightbox.images.length > 1 && (
              <>
                <button
                  aria-label="Previous image"
                  onClick={(e) => { e.stopPropagation(); setLightbox(lb => ({ ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length })); }}
                  style={navButtonStyle(lightbox.color, 'left')}
                >
                  ‹
                </button>
                <button
                  aria-label="Next image"
                  onClick={(e) => { e.stopPropagation(); setLightbox(lb => ({ ...lb, index: (lb.index + 1) % lb.images.length })); }}
                  style={navButtonStyle(lightbox.color, 'right')}
                >
                  ›
                </button>
              </>
            )}
          </div>

          <div style={{ textAlign: 'center', color: '#bfc6d6', fontSize: 14 }}>
            {lightbox.images.length > 1 ? `${lightbox.index + 1} / ${lightbox.images.length}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
