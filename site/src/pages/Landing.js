import React, { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import BgVariantB from "../components/BgVariantB";
import TubesCursorOverlay from "../components/TubesCursorOverlay";
import { ContribLabel, ContribGrid } from "../components/GithubContributions";
import FloatingHead from "../components/FloatingHead";
import CopyEmail from "../components/CopyEmail";
/* the write-up count in the mission stays honest by reading the same array
   the Projects page renders - add a project, the sentence updates itself */
import { projects } from "./Projects";
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
  const wrapRef = useRef(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [vortexTarget, setVortexTarget] = useState(null);
  const [headFocus, setHeadFocus] = useState(false);
  const [gridFocus, setGridFocus] = useState(false);
  const [gridEl, setGridEl] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);

  /* Align the line-tail dots to the same 14px lattice as the block below.
     The tail starts wherever the text happens to end, so its grid phase is
     arbitrary - measured here (via the zero-width end-of-line marker) and
     corrected with a CSS variable, so both layers' columns coincide. */
  useEffect(() => {
    const compute = () => {
      const col = document.querySelector(".mission-text");
      if (!col) return;
      /* lattice pitch == the text's line-height, read from the type itself -
         dot rows share the text's rhythm by construction */
      const P = Math.round(parseFloat(getComputedStyle(col).lineHeight)) || 22;
      const colRect = col.getBoundingClientRect();
      /* the pseudo's width/height resolve in LAYOUT px, but client rects are
         in VISUAL px - scaled by any ancestor transform (the entrance
         animations run exactly when this computes, and ResizeObserver never
         re-fires for transform changes, so scaled readings would freeze in
         short). offsetWidth/Height are transform-immune layout truth; the
         ratio converts every rect-derived coordinate back to layout space. */
      const LW = col.offsetWidth;
      const LH = col.offsetHeight;
      if (!LW || !LH) return;
      const sx = colRect.width / LW || 1;
      const sy = colRect.height / LH || 1;
      /* horizontal pitch: stretched a hair (at most ~0.6px off the 22px
         vertical pitch, imperceptible) so a whole number of dot columns
         spans the text column edge to edge - first centre P/2 in from the
         left, last centre P/2 in from the right, at EVERY width. A fixed
         22px pitch left up to a stranded ~20px bare margin whenever the
         column width's remainder fell mid-tile (which it permanently does
         once the hero hits its max content width). */
      const W = Math.max(P * 2, LW);
      const cols = Math.max(2, Math.round((W - P) / P) + 1);
      const PX = (W - P) / (cols - 1);
      /* height still CEILs to whole rows - the slight overhang reads well */
      const H = Math.max(P, Math.ceil(LH / P) * P);
      const rows = H / P;
      /* each row's text-end, measured from the browser's own line boxes
         (Range.getClientRects covers text and the inline toggle alike) - x
         and y always describe the same boxes, so dots-behind-text cannot
         happen on any line, wrapped toggles included */
      const copy = document.querySelector(".mission-copy");
      const ends = new Array(rows).fill(-1);
      if (copy) {
        const range = document.createRange();
        range.selectNodeContents(copy);
        const boxes = Array.from(range.getClientRects());
        const btn = document.querySelector(".mission-toggle");
        if (btn) boxes.push(btn.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++) {
          const r = boxes[i];
          if (r.width <= 0 || r.height <= 0) continue;
          const row = Math.floor((r.top + r.height / 2 - colRect.top) / sy / P);
          if (row < 0 || row >= rows) continue;
          const endX = (r.right - colRect.left) / sx;
          if (endX > ends[row]) ends[row] = endX;
        }
      }
      /* a row's first dot needs half a pitch of clearance after the glyphs
         (centre at P/2 + k*PX, so first k with centre >= end + P/2); rows
         with no text fill from the left edge, rows past the last column get
         none */
      const xs = ends.map((e) => {
        if (e < 0) return 0;
        const k = Math.ceil(e / PX);
        if (k > cols - 1) return W;
        return P / 2 + k * PX - PX / 2;
      });
      const pts = [];
      for (let i = 0; i < rows; i++) {
        pts.push(`${xs[i]}px ${i * P}px`, `${xs[i]}px ${(i + 1) * P}px`);
      }
      pts.push(`${W}px ${H}px`, `${W}px 0px`);
      col.style.setProperty("--dg-w", `${W}px`);
      col.style.setProperty("--dg-px", `${PX}px`);
      /* shift the tiles so each tile's gradient centre lands on P/2 + k*PX */
      col.style.setProperty("--dg-ox", `${(P - PX) / 2}px`);
      col.style.setProperty("--dg-h", `${H}px`);
      col.style.setProperty("--dg-clip", `polygon(${pts.join(", ")})`);
    };
    compute();
    /* event-driven, not timer-guessed: late font swaps and any reflow of the
       column change where the text ends, and a stale phase misaligns the
       lattice by up to half a tile. The double-rAF re-measures once the first
       real paint has settled - initial mount measures a not-quite-final line. */
    requestAnimationFrame(() => requestAnimationFrame(compute));
    window.addEventListener("load", compute, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(compute);
    /* The one case events cannot see: the line's END moves without any
       element's SIZE changing (late canvas mount in the slot, a scrollbar
       appearing). Idempotent, so a few staggered retries are free. */
    const retries = [250, 800, 2000].map((ms) => setTimeout(compute, ms));
    let ro = null;
    const col = document.querySelector(".mission-text");
    if (window.ResizeObserver && col) {
      ro = new ResizeObserver(compute);
      ro.observe(col);
    }
    window.addEventListener("resize", compute);
    return () => {
      if (ro) ro.disconnect();
      retries.forEach(clearTimeout);
      window.removeEventListener("resize", compute);
    };
  }, [moreOpen]);

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

  /* The 60 ambient dots now live in BgVariantB's canvas - see the `floaters`
     block there. As DOM spans they were style-recalculated on the main thread
     every frame because Chrome declined to composite them; on the canvas they
     are 60 more fills in a loop that was already running. */

  const PU = process.env.PUBLIC_URL;

  return (
    <div className={`landing${hoveredCard ? " card-focus" : ""}${headFocus ? " head-focus" : ""}${gridFocus ? " gh-focus" : ""}`}>
      {/* Background */}
      <BgVariantB
        magnetTarget={magnetTarget}
        magnetCardId={hoveredCard}
        vortexTarget={vortexTarget}
      />
      {/* Tubes cursor */}
      <TubesCursorOverlay hoveredCard={hoveredCard} />

      <div className="wrap" ref={wrapRef}>
        <header className="hero">
          <FloatingHead
            hoveredCard={hoveredCard}
            lookTarget={gridFocus ? gridEl : null}
            onHoverChange={(el) => {
              setVortexTarget(el);
              setHeadFocus(!!el); // hovering the portrait quiets the rest, like a card
            }}
          />
          <h1 className="title">Hyder Mohyuddin</h1>
          <ContribLabel username="hmohyud" />
          {/* the grid is the trigger, deliberately not the links below it -
              inspecting a year of commits earns the focus, brushing past an
              email link should not make the page flinch */}
          <span
            style={{ display: "contents" }}
            onMouseEnter={(e) => {
              setGridFocus(true);
              setGridEl(e.target.closest(".gh-contrib-grid-wrap") || e.target);
            }}
            onMouseLeave={() => setGridFocus(false)}
          >
            <ContribGrid username="hmohyud" />
          </span>
          {/* Wrapper is display:contents by default, so on desktop these two
              still land in their own grid areas exactly as before. On a phone
              it becomes a flex row spanning the full width, which keeps the
              tagline and the contacts on one line WITHOUT squeezing the name -
              the title shares a grid column with the tagline, so narrowing that
              column to fit the contacts was clipping "Hyder Mohyuddin". */}
          <div className="hero-meta">
            <p className="subtitle">AI &amp; Software • Systems • Interfaces</p>
            <div className="hero-contact" role="group" aria-label="Contact links">
              <CopyEmail className="hero-gh-link" email="hyder.mohyuddin@gmail.com" />
              <span className="hero-contact-sep" aria-hidden="true">·</span>
              <a
                className="hero-gh-link gh"
                href="https://github.com/hmohyud"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open GitHub profile"
              >
                {/* The full URL will not share a line with the email and the
                    tagline on a phone, so the domain is dropped there. The href
                    and the aria-label are unchanged either way. */}
                <span className="gh-url-long">github.com/hmohyud</span>
                <span className="gh-url-short">github</span>
              </a>
            </div>
          </div>

          {/* <p className="mission">
            I build dependable AI tools and interfaces. Recent work: real-time tensor
            devtools for <strong>Stable Diffusion/ComfyUI</strong> (custom memory routing,
            layer-targeted transforms, node instrumentation) and a production
            <strong> SPIM research UI</strong> (controls + analysis). I'm also experienced
            with <strong>GPT models</strong> and <strong>modern web development </strong>
            (React/JS, D3, Flask). For the full toolset and stack, see my resume.
          </p> */}
          <p className="mission">
            {/* the text is its own span so focus states can dim it without
                dimming the portrait, which portals INTO this paragraph on
                tablet - the float wraps identically either way */}
            <span className="mission-text">
              <span className="mission-copy">
              I build AI tooling, web platforms, and the occasional strange
              experiment — I built this site to showcase that work and the
              thinking behind it. The cards are the tour;{" "}
              <span className="hint-head">the head takes questions.</span>
              <span className="hint-fab">
                the AI button in the corner takes questions.
              </span>
              {moreOpen && (
                <span>
                  {" "}
                  That work started with CS and visual arts at UChicago,
                  then two-ish years in Professor Jason Salavon's studio
                  building AI research tooling that modifies models at the
                  tensor level, then client platforms, mobile apps, and
                  indie tools — the {projects.length} write-ups below. I'm
                  comfortable being handed unknowns.
                </span>
              )}
              <button
                type="button"
                className="mission-toggle"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
              >
                <span className={"mission-caret" + (moreOpen ? " open" : "")}>▸</span>
                {moreOpen ? "less" : "more"}
              </button>
              </span>
            </span>
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
