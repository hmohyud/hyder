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

    const buildFloaters = (count) => {
      if (!floatRef.current) return;
      const frag = document.createDocumentFragment();
      const hues = [340, 260, 200, 140];
      for (let i = 0; i < count; i++) {
        const el = document.createElement("span");
        el.className = "floating-element";
        const size = 60 + Math.random() * 80;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.left = Math.random() * 100 + "%";
        el.style.top = Math.random() * 100 + "%";
        el.style.setProperty("--h", String(hues[(Math.random() * hues.length) | 0]));
        el.style.animationDelay = `${Math.random() * 8}s`;
        el.style.animationDuration = `${22 + Math.random() * 14}s`;
        frag.appendChild(el);
      }
      floatRef.current.innerHTML = "";
      floatRef.current.appendChild(frag);
    };

    buildParticles(60);
    buildFloaters(8);

    // --- Always-on custom cursor (pointer events) ---
    const cursor = cursorRef.current;
    const dot = dotRef.current;
    const glow = glowRef.current;
    if (!cursor || !dot || !glow) return;

    let rafId = 0;
    let targetX = -9999, targetY = -9999;
    let lerpX = -9999, lerpY = -9999;
    let isDown = false;
    let active = false;
    const ease = 0.2;

    const update = () => {
      // Lerp ring; dot snaps (visually tighter)
      lerpX += (targetX - lerpX) * ease;
      lerpY += (targetY - lerpY) * ease;

      const ringScale = isDown ? 0.85 : 1;
      const dotScale = isDown ? 1.6 : 1;

      cursor.style.transform = `translate3d(${lerpX - 12}px, ${lerpY - 12}px, 0) scale(${ringScale})`;
      dot.style.transform = `translate3d(${targetX - 4}px, ${targetY - 4}px, 0) scale(${dotScale})`;
      glow.style.transform = `translate3d(${targetX - 80}px, ${targetY - 80}px, 0)`;

      // Stop RAF when settled to save CPU
      if (Math.abs(lerpX - targetX) < 0.1 && Math.abs(lerpY - targetY) < 0.1) {
        active = false;
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(update);
    };

    const kick = () => {
      if (!active) {
        active = true;
        rafId = requestAnimationFrame(update);
      }
    };

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      kick();
    };
    const onDown = () => { isDown = true; kick(); };
    const onUp = () => { isDown = false; kick(); };

    const onLeave = () => {
      targetX = targetY = lerpX = lerpY = -9999;
      cursor.style.transform = `translate3d(-9999px,-9999px,0)`;
      dot.style.transform = `translate3d(-9999px,-9999px,0)`;
      glow.style.transform = `translate3d(-9999px,-9999px,0)`;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      active = false;
    };

    const onVisibility = () => {
      if (document.hidden) onLeave();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onLeave, { passive: true });
    window.addEventListener("mouseleave", onLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
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

          {/* <p className="mission">
            I build dependable AI tools and interfaces. Recent work: real-time tensor
            devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing,
            layer-targeted transforms, node instrumentation) and a production
            <strong> SPIM research UI</strong> (controls + analysis). I’m also experienced
            with <strong>GPT models</strong> and <strong>modern web development </strong>
            (React/JS, D3, Flask). For the full toolset and stack, see my resume.
          </p> */}
<p className="mission">
  I build dependable AI tools and interfaces. At UChicago with <strong>Professor Jason Salavon</strong>, I absorbed responsibilities previously held across three <strong>CS M.S. teammates</strong> and got comfortable being handed unknowns—researching, shipping, and owning production systems. Recent work: real-time tensor devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing, layer-targeted transforms, node instrumentation) and a production <strong>SPIM research UI</strong> (controls + analysis). Also experienced with <strong>GPT models</strong> and <strong>modern web development</strong> (React/JS, D3, Flask). I built this site to showcase my skills and how I work—see my <strong>resume</strong> for the full stack.
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
            <p className="card-copy">A visual and interactive map of my skills</p>
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
