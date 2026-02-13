import React, { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import BgVariantB from "../components/BgVariantB";
import TubesCursorOverlay from "../components/TubesCursorOverlay";
import "./Landing.css";

/* Inline icons (no emojis) */
const IconGraph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 21V3" />
    <path d="M3 21h18" />
    <path d="M6 15l4-5 3 3 5-7" />
    <circle cx="6" cy="15" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="13" cy="13" r="1.4" />
    <circle cx="18" cy="6" r="1.4" />
  </svg>
);
const IconLayers = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4l8 4-8 4-8-4 8-4z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 16l8 4 8-4" />
  </svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
const IconDoc = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);

/**
 * CardPreview — shows a static JPG poster, lazy-loads and plays a looping
 * video on hover. The video src is only set on the first hover so the browser
 * never fetches it until needed.
 */
function CardPreview({ imgSrc, videoSrc, alt, isHovered }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isHovered) {
      vid.currentTime = 0;
      vid.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setPlaying(false);
    }
  }, [isHovered]);

  return (
    <div className="peek">
      <img
        src={imgSrc}
        alt={alt}
        loading="lazy"
        className={playing ? "peek-hidden" : ""}
      />
      <video
        ref={videoRef}
        src={videoSrc}
        muted
        loop
        playsInline
        preload="auto"
        className={`peek-video ${playing ? "peek-visible" : ""}`}
      />
    </div>
  );
}

export default function Landing() {
  const particlesRef = useRef(null);
  const wrapRef = useRef(null);
  const [hoveredCard, setHoveredCard] = useState(null);

  // Card refs for magnet targeting
  const cardRefs = useRef({});
  const setCardRef = useCallback((id) => (el) => { cardRefs.current[id] = el; }, []);

  // The actual DOM element to magnetize toward (or null)
  const magnetTarget = hoveredCard ? cardRefs.current[hoveredCard] : null;

  /* Scale .wrap uniformly so it always fits within 100vh */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const fit = () => {
      // Reset scale so we can measure natural height
      wrap.style.transform = "none";
      const natural = wrap.scrollHeight;
      const viewport = window.innerHeight;
      const s = Math.min(1, viewport / natural);
      wrap.style.transform = s < 1 ? `scale(${s})` : "none";
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    // --- Build ambience with fixed counts for consistent look ---
    const buildParticles = (count) => {
      if (!particlesRef.current) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const p = document.createElement("span");
        p.className = "particle";
        p.style.left = Math.random() * 100 + "%";
        p.style.top = Math.random() * 100 + "%";
        const s = 1 + Math.random() * 2;
        p.style.width = `${s}px`;
        p.style.height = `${s}px`;
        p.style.animationDuration = `${18 + Math.random() * 10}s`;
        p.style.animationDelay = `${Math.random() * 5}s`;
        p.style.opacity = String(0.25 + Math.random() * 0.5);
        frag.appendChild(p);
      }
      particlesRef.current.innerHTML = "";
      particlesRef.current.appendChild(frag);
    };

    buildParticles(60);

    return () => {
      particlesRef.current && (particlesRef.current.innerHTML = ""); // eslint-disable-line
    };
  }, []);

  const PU = process.env.PUBLIC_URL;

  return (
    <div className={`landing${hoveredCard ? " card-focus" : ""}`}>
      {/* Background */}
      <BgVariantB magnetTarget={magnetTarget} magnetCardId={hoveredCard} />
      {/* Tubes cursor */}
      <TubesCursorOverlay hoveredCard={hoveredCard} />
      <div className="magic-circle" aria-hidden="true" />
      <div className="magic-circle alt" aria-hidden="true" />
      <div className="magic-circle slow" aria-hidden="true" />
      <div className="particles" ref={particlesRef} aria-hidden="true" />

      <div className="wrap" ref={wrapRef}>
        <header className="hero">
          <h1 className="title">Hyder Mohyuddin</h1>
          <p className="subtitle">AI &amp; Software • Systems • Interfaces</p>

          {/* <p className="mission">
            I build dependable AI tools and interfaces. Recent work: real-time tensor
            devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing,
            layer-targeted transforms, node instrumentation) and a production
            <strong> SPIM research UI</strong> (controls + analysis). I'm also experienced
            with <strong>GPT models</strong> and <strong>modern web development </strong>
            (React/JS, D3, Flask). For the full toolset and stack, see my resume.
          </p> */}
          <p className="mission">
            I build dependable AI tools and interfaces. At UChicago with <strong>Professor Jason Salavon</strong>, I absorbed responsibilities previously held across three <strong>CS M.S. teammates</strong> and got comfortable being handed unknowns—researching, shipping, and owning production systems. Recent work: real-time tensor devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing, layer-targeted transforms, node instrumentation) and a production <strong>SPIM research UI</strong> (controls + analysis). Also experienced with <strong>GPT models</strong> and <strong>modern web development</strong> (React/JS, D3, Flask). I built this site to showcase my skills and how I work—see my <strong>resume</strong> for the full stack.
          </p>

        </header>

        <section className="grid" aria-label="Site sections">
          {/* Skills */}
          <Link ref={setCardRef(1)} to="/skills" className={`card card-1 portal${hoveredCard === 1 ? " card-hover-active" : ""}`} aria-label="Go to Skills" onMouseEnter={() => setHoveredCard(1)} onMouseLeave={() => setHoveredCard(null)}>
            <span className="portal-glow portal-1" aria-hidden="true" />
            <div className="card-head">
              <span className="icon"><IconGraph /></span>
              <h2>Skills</h2>
            </div>
            <p className="card-copy">A visual and interactive map of my skills</p>
            <CardPreview
              imgSrc={PU + "/previews/skills.jpg"}
              videoSrc={PU + "/previews/skills.mp4"}
              alt="Preview of Skills page"
              isHovered={hoveredCard === 1}
            />
          </Link>

          {/* Projects */}
          <Link ref={setCardRef(2)} to="/projects" className={`card card-2 portal${hoveredCard === 2 ? " card-hover-active" : ""}`} aria-label="Go to Projects" onMouseEnter={() => setHoveredCard(2)} onMouseLeave={() => setHoveredCard(null)}>
            <span className="portal-glow portal-2" aria-hidden="true" />
            <div className="card-head">
              <span className="icon"><IconLayers /></span>
              <h2>Projects</h2>
            </div>
            <p className="card-copy">See my write-ups on past projects</p>
            <CardPreview
              imgSrc={PU + "/previews/projects.jpg"}
              videoSrc={PU + "/previews/projects.mp4"}
              alt="Preview of Projects page"
              isHovered={hoveredCard === 2}
            />
          </Link>

          {/* About */}
          <Link ref={setCardRef(3)} to="/about" className={`card card-3 portal${hoveredCard === 3 ? " card-hover-active" : ""}`} aria-label="Go to About" onMouseEnter={() => setHoveredCard(3)} onMouseLeave={() => setHoveredCard(null)}>
            <span className="portal-glow portal-3" aria-hidden="true" />
            <div className="card-head">
              <span className="icon"><IconUser /></span>
              <h2>About</h2>
            </div>
            <p className="card-copy">Background, approach, and what I'm exploring</p>
            <CardPreview
              imgSrc={PU + "/previews/about.jpg"}
              videoSrc={PU + "/previews/about.mp4"}
              alt="Preview of About page"
              isHovered={hoveredCard === 3}
            />
          </Link>

          {/* Resume */}
          <Link ref={setCardRef(4)} to="/resume" className={`card card-4 portal${hoveredCard === 4 ? " card-hover-active" : ""}`} aria-label="Go to Résumé" onMouseEnter={() => setHoveredCard(4)} onMouseLeave={() => setHoveredCard(null)}>
            <span className="portal-glow portal-4" aria-hidden="true" />
            <div className="card-head">
              <span className="icon"><IconDoc /></span>
              <h2>Resume</h2>
            </div>
            <p className="card-copy">Experience, education, and highlights</p>
            <CardPreview
              imgSrc={PU + "/previews/resume.jpg"}
              videoSrc={PU + "/previews/resume.mp4"}
              alt="Preview of Resume page"
              isHovered={hoveredCard === 4}
            />
          </Link>
        </section>
      </div>
    </div>
  );
}
