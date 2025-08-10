import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
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

export default function Landing() {
  const cursorRef = useRef(null);
  const dotRef = useRef(null);
  const glowRef = useRef(null);
  const particlesRef = useRef(null);
  const floatRef = useRef(null);

  useEffect(() => {
    const prefersReduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isTouch =
      window.matchMedia?.("(pointer: coarse)").matches ||
      "ontouchstart" in window;

    // Build particles & floating blobs once
    const buildParticles = () => {
      if (!particlesRef.current) return;
      const frag = document.createDocumentFragment();
      const count = prefersReduced ? 20 : 70;
      for (let i = 0; i < count; i++) {
        const p = document.createElement("span");
        p.className = "particle";
        p.style.left = Math.random() * 100 + "%";
        p.style.top = Math.random() * 100 + "%";
        p.style.width = `${1 + Math.random() * 2}px`;
        p.style.height = p.style.width;
        p.style.animationDuration = `${10 + Math.random() * 18}s`;
        p.style.animationDelay = `${Math.random() * 5}s`;
        p.style.opacity = String(0.2 + Math.random() * 0.6);
        frag.appendChild(p);
      }
      particlesRef.current.appendChild(frag);
    };

    const buildFloaters = () => {
      if (!floatRef.current) return;
      const frag = document.createDocumentFragment();
      const count = prefersReduced ? 4 : 10;
      for (let i = 0; i < count; i++) {
        const el = document.createElement("span");
        el.className = "floating-element";
        const size = 30 + Math.random() * 80;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.left = Math.random() * 100 + "%";
        el.style.top = Math.random() * 100 + "%";
        el.style.setProperty("--h", String([340, 260, 200, 140][Math.floor(Math.random() * 4)]));
        el.style.animationDelay = `${Math.random() * 8}s`;
        el.style.animationDuration = `${15 + Math.random() * 16}s`;
        frag.appendChild(el);
      }
      floatRef.current.appendChild(frag);
    };

    buildParticles();
    buildFloaters();

    if (prefersReduced || isTouch) {
      document.documentElement.classList.add("reduced");
      return; // skip fancy cursor
    }

    const cursor = cursorRef.current;
    const dot = dotRef.current;
    const glow = glowRef.current;
    if (!cursor || !dot || !glow) return;

    let rafId = 0;
    let targetX = 0,
      targetY = 0;
    let dx = 0,
      dy = 0;

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      glow.style.transform = `translate(${targetX - 100}px, ${targetY - 100}px)`; // center-ish
      if (!rafId) rafId = requestAnimationFrame(update);
    };

    const update = () => {
      const rect = cursor.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      dx = (targetX - cx) * 0.2;
      dy = (targetY - cy) * 0.2;
      cursor.style.transform = `translate(${cx + dx - 12}px, ${cy + dy - 12}px)`; // ring ~24px
      dot.style.transform = `translate(${targetX - 4}px, ${targetY - 4}px)`; // dot ~8px
      rafId = requestAnimationFrame(update);
    };

    const onDown = () => {
      cursor.classList.add("down");
      dot.classList.add("down");
    };
    const onUp = () => {
      cursor.classList.remove("down");
      dot.classList.remove("down");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      particlesRef.current && (particlesRef.current.innerHTML = "");
      floatRef.current && (floatRef.current.innerHTML = "");
    };
  }, []);

  return (
    <div className="landing">
      {/* FX layers */}
      <div className="cursor" ref={cursorRef} aria-hidden="true" />
      <div className="cursor-dot" ref={dotRef} aria-hidden="true" />
      <div className="mouse-glow" ref={glowRef} aria-hidden="true" />
      <div className="magic-circle" aria-hidden="true" />
      <div className="magic-circle alt" aria-hidden="true" />
      <div className="magic-circle slow" aria-hidden="true" />
      <div className="floating-elements" ref={floatRef} aria-hidden="true" />
      <div className="particles" ref={particlesRef} aria-hidden="true" />

      <div className="wrap">
        <header className="hero">
          <h1 className="title">Hyder Mohyuddin</h1>
          <p className="subtitle">AI &amp; Software • Systems • Interfaces</p>

          <p className="mission">
            I build dependable AI tools and interfaces. Recent work: real-time tensor
            devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing,
            layer-targeted transforms, node instrumentation) and a production
            <strong> SPIM research UI</strong> (controls + analysis). I’m also experienced
            with <strong>GPT models</strong> and <strong>modern web development </strong>
            (React/JS, D3, Flask). For the full toolset and stack, see my resume.
          </p>
        </header>

        <section className="grid" aria-label="Site sections">
          {/* Skills */}
          <Link to="/skills" className="card card-1 portal" aria-label="Go to Skills">
            <span className="portal-glow portal-1" aria-hidden="true" />
            <div className="card-head">
              <span className="icon">
                <IconGraph />
              </span>
              <h2>Skills</h2>
            </div>
            <p className="card-copy">
              A visual and interactive map of my skills
            </p>
            <div className="peek">
              <img
                src={process.env.PUBLIC_URL + "/previews/skills.jpg"}
                alt="Preview of Skills page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* Projects */}
          <Link to="/projects" className="card card-2 portal" aria-label="Go to Projects">
            <span className="portal-glow portal-2" aria-hidden="true" />
            <div className="card-head">
              <span className="icon">
                <IconLayers />
              </span>
              <h2>Projects</h2>
            </div>
            <p className="card-copy">See my write-ups on past projects</p>
            <div className="peek">
              <img
                src={process.env.PUBLIC_URL + "/previews/projects.jpg"}
                alt="Preview of Projects page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* About */}
          <Link to="/about" className="card card-3 portal" aria-label="Go to About">
            <span className="portal-glow portal-3" aria-hidden="true" />
            <div className="card-head">
              <span className="icon">
                <IconUser />
              </span>
              <h2>About</h2>
            </div>
            <p className="card-copy">Background, approach, and what I'm exploring</p>
            <div className="peek">
              <img
                src={process.env.PUBLIC_URL + "/previews/about.jpg"}
                alt="Preview of About page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* Resume */}
          <Link to="/resume" className="card card-4 portal" aria-label="Go to Résumé">
            <span className="portal-glow portal-4" aria-hidden="true" />
            <div className="card-head">
              <span className="icon">
                <IconDoc />
              </span>
              <h2>Resume</h2>
            </div>
            <p className="card-copy">Experience, education, and highlights</p>
            <div className="peek">
              <img
                src={process.env.PUBLIC_URL + "/previews/resume.jpg"}
                alt="Preview of Resume page"
                loading="lazy"
              />
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}
