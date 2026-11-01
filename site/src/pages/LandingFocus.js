import React, { useRef, useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import BgVariantB from "../components/BgVariantB";
import TubesCursorOverlay from "../components/TubesCursorOverlay";
import { ContribLabel, ContribGrid } from "../components/GithubContributions";
import FloatingHead from "../components/FloatingHead";
import CopyEmail from "../components/CopyEmail";
import "./Landing.css";
import "./LandingFocus.css";

/* The landing: the portrait at the centre of the four cards. A cloud-shaped window around the head shows the page's
   own background through the cards. The window is a small canvas drawn
   over the cards each frame: inside the cloud it paints exactly what the
   page has underneath (the landing's gradient, its corner glows, and the
   background's particles, copied from their canvas), and nothing outside.
   The cards themselves are never clipped or repainted, which is what keeps
   it cheap. Where the cloud's edge crosses a card, the card's own border
   is drawn along the cut. A hovered card comes in front of everything and
   the rest of the page darkens around it. */

/* the head's front silhouette (traced from the point cloud), used only in
   the moments before the portrait is drawn */
const HEAD_PROFILE = [0.86, 0.864, 0.851, 0.807, 0.762, 0.768, 0.811, 0.861, 0.917, 0.968, 1.013, 1.058, 1.085, 1.102, 1.13, 1.167, 1.188, 1.187, 1.191, 1.2, 1.198, 1.189, 1.178, 1.16, 1.103, 1.009, 0.931, 0.886, 0.856, 0.843, 0.852, 0.861, 0.859, 0.852, 0.852, 0.857, 0.861, 0.862, 0.87, 0.899, 0.937, 0.976, 1.027, 1.117, 1.206, 1.23, 1.212, 1.194, 1.186, 1.192, 1.212, 1.242, 1.286, 1.318, 1.238, 1.037, 0.876, 0.791, 0.759, 0.789, 0.823, 0.837, 0.846, 0.853];
const HOST_PX = 360;
const PX_PER_UNIT = (HOST_PX * 3.6) / (2 * 9.4 * Math.tan((42 / 2) * (Math.PI / 180)));
const CLOUD_SCALE = 1.2;
const CLOUD_PAD_PX = 8;
/* the live window: the head's footprint grown by this radius (CSS px) on
   every side, concavities and neck included */
const LIVE_PAD_PX = 34;
const RAYS = 96;
const DOT_STEP = 10; // every 10th dot: ~15 px apart, well inside the padding radius
const CARD_RADIUS = 16;

/* what the page has under the cards (Landing.css): the landing's gradient
   and the two corner glows, in viewport terms */
const PAGE_GRADIENT = [[0, "#0a0c11"], [0.55, "#0f131b"], [1, "#0b0f16"]];
const PAGE_GLOWS = [
  { x: 0.7, y: 0.15, rx: 900, ry: 600, color: "120,160,255", a: 0.06, end: 0.55 },
  { x: 0.2, y: 0.8, rx: 1000, ry: 700, color: "108,255,204", a: 0.05, end: 0.6 },
];

function profileAt(screenAngle) {
  const n = HEAD_PROFILE.length;
  const u = ((-screenAngle / (Math.PI * 2)) % 1 + 1) % 1 * n;
  const i = Math.floor(u), f = u - i;
  return HEAD_PROFILE[i % n] * (1 - f) + HEAD_PROFILE[(i + 1) % n] * f;
}

/* the cloud's points at time t: the live outline (radii per ray, already
   padded) or the traced profile, with the padding breathing by a hair */
function cloudPoints(t, live, ox, oy) {
  const n = live ? live.length : 64;
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = live ? live[i] : CLOUD_SCALE * PX_PER_UNIT * profileAt(a) + CLOUD_PAD_PX;
    pts[i * 2] = ox + r * Math.cos(a);
    pts[i * 2 + 1] = oy + r * Math.sin(a);
  }
  return pts;
}

/* a closed Catmull-Rom curve through the points, as a Path2D */
function cloudPath2D(pts) {
  const n = pts.length / 2;
  const p = new Path2D();
  const X = (i) => pts[((i + n) % n) * 2], Y = (i) => pts[((i + n) % n) * 2 + 1];
  p.moveTo(X(0), Y(0));
  for (let i = 0; i < n; i++) {
    const c1x = X(i) + (X(i + 1) - X(i - 1)) / 6, c1y = Y(i) + (Y(i + 1) - Y(i - 1)) / 6;
    const c2x = X(i + 1) - (X(i + 2) - X(i)) / 6, c2y = Y(i + 1) - (Y(i + 2) - Y(i)) / 6;
    p.bezierCurveTo(c1x, c1y, c2x, c2y, X(i + 1), Y(i + 1));
  }
  p.closePath();
  return p;
}

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

function CardPreview({ imgSrc, videoSrc, alt, isHovered, lazy }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [armed, setArmed] = useState(!lazy);
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isHovered) {
      setArmed(true);
      vid.currentTime = 0;
      vid.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setPlaying(false);
    }
  }, [isHovered]);
  return (
    <div className="peek">
      <img src={imgSrc} alt={alt} loading="lazy" className={playing ? "peek-hidden" : ""} />
      {/* a lazy preview (the front twins, the hidden copies) holds no video
          until it is first hovered: four idle decoders otherwise */}
      <video ref={videoRef} src={armed ? videoSrc : undefined} muted loop playsInline preload={lazy ? "none" : "auto"} className={`peek-video ${playing ? "peek-visible" : ""}`} />
    </div>
  );
}

/* a card's inside: the card layer and the front layer draw the same thing */
function CardBody({ title, copy, Icon, img, isHovered, lazy }) {
  const PU = process.env.PUBLIC_URL;
  return (
    <>
      <div className="card-head">
        <span className="icon"><Icon /></span>
        <h2>{title}</h2>
      </div>
      <p className="card-copy">{copy}</p>
      <CardPreview imgSrc={PU + `/previews/${img}.jpg`} videoSrc={PU + `/previews/${img}.mp4`} alt={`Preview of ${title} page`} isHovered={isHovered} lazy={lazy} />
    </>
  );
}

const CARDS = [
  { id: 1, to: "/skills", title: "Skills", copy: "A visual and interactive map of my skills", Icon: IconGraph, img: "skills", label: "Go to Skills" },
  { id: 2, to: "/projects", title: "Projects", copy: "See my write-ups on past projects", Icon: IconLayers, img: "projects", label: "Go to Projects" },
  { id: 3, to: "/about", title: "About", copy: "Background, approach, and what I'm exploring", Icon: IconUser, img: "about", label: "Go to About" },
  { id: 4, to: "/resume", title: "Resume", copy: "Experience, education, and highlights", Icon: IconDoc, img: "resume", label: "Go to Résumé" },
];

export default function LandingFocus() {
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const winRef = useRef(null);
  const rootRef = useRef(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [vortexTarget, setVortexTarget] = useState(null);
  const [headFocus, setHeadFocus] = useState(false);
  const [gridFocus, setGridFocus] = useState(false);
  const [gridEl, setGridEl] = useState(null);

  const cardRefs = useRef({});
  const setCardRef = useCallback((id) => (el) => { cardRefs.current[id] = el; }, []);
  const magnetTarget = hoveredCard ? cardRefs.current[hoveredCard] : null;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      wrap.style.transform = "none";
      const natural = wrap.scrollHeight;
      const s = Math.min(1, window.innerHeight / natural);
      wrap.style.transform = s < 1 ? `scale(${s})` : "none";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    const win = winRef.current;
    const root = rootRef.current;
    if (!grid || !win || !root) return undefined;
    const ctx = win.getContext("2d");
    if (!ctx) return undefined;
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* geometry, measured once and on resize: the grid's size, the window
       canvas's place on screen (with the wrap's scale), the cards' boxes */
    let gw = 0, gh = 0, dpr = 1, left = 0, top = 0, scale = 1;
    let cardsPath = new Path2D();
    let pageGrad = null;
    let glowGrads = [];
    let W = 0, H = 0;
    const makeGradients = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      const half = (W + H) / 4; // half the 135deg gradient line, projected on each axis
      pageGrad = ctx.createLinearGradient(W / 2 - half, H / 2 - half, W / 2 + half, H / 2 + half);
      for (const [at, col] of PAGE_GRADIENT) pageGrad.addColorStop(at, col);
      glowGrads = PAGE_GLOWS.map((gl) => {
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, gl.ry);
        rg.addColorStop(0, `rgba(${gl.color},${gl.a})`);
        rg.addColorStop(gl.end, `rgba(${gl.color},0)`);
        return rg;
      });
    };
    const measure = () => {
      makeGradients();
      gw = grid.offsetWidth;
      gh = grid.offsetHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      win.width = Math.round(gw * dpr);
      win.height = Math.round(gh * dpr);
      win.style.width = gw + "px";
      win.style.height = gh + "px";
      const r = win.getBoundingClientRect();
      left = r.left;
      top = r.top;
      scale = gw ? r.width / gw : 1;
      cardsPath = new Path2D();
      for (const c of grid.querySelectorAll(".card")) {
        cardsPath.roundRect(c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight, CARD_RADIUS);
      }
    };

    /* the head's footprint, grown by the padding, read directly from the
       dots: along each ray from the centre, the farthest point of any disc
       of radius LIVE_PAD_PX centred on a dot the ray crosses - the outer
       edge of the union of those discs. ~1200 dots x 96 rays is a fraction
       of a millisecond. A short sliding average and a light ease settle
       the small shifts as the head sways. */
    const pts = new Float32Array(2 * 1400);
    const cosT = new Float32Array(RAYS), sinT = new Float32Array(RAYS);
    for (let r = 0; r < RAYS; r++) {
      cosT[r] = Math.cos((r / RAYS) * Math.PI * 2);
      sinT[r] = Math.sin((r / RAYS) * Math.PI * 2);
    }
    const pad2 = LIVE_PAD_PX * LIVE_PAD_PX;
    const steady = new Float32Array(RAYS);
    /* no temporal filter: the envelope of discs is smooth by construction,
       and any averaging puts the window a few frames behind the head - at
       60 Hz that lag is what reads as the window chasing and catching up.
       The portrait's own frame runs first (it mounted first), so this reads
       the pose the head is drawn with in the same frame. */
    const readLive = () => {
      if (!window.__fhProject) return null;
      const count = window.__fhProject(pts, DOT_STEP);
      if (count < 100) return null;
      for (let r = 0; r < RAYS; r++) {
        const dx = cosT[r], dy = sinT[r];
        let reach = 0;
        for (let i = 0; i < count; i++) {
          const x = pts[i * 2], y = pts[i * 2 + 1];
          const perp = x * dy - y * dx;
          const p2 = perp * perp;
          if (p2 >= pad2) continue;
          const along = x * dx + y * dy + Math.sqrt(pad2 - p2);
          if (along > reach) reach = along;
        }
        steady[r] = reach;
      }
      return steady;
    };

    const stats = { ms: 0, frames: 0 };
    window.__focusStats = stats; // local: the window's cost per frame, in ms
    /* local diagnostics (?stats in the address): a readout of frame timing,
       and keys that switch parts of the page off so a stutter can be traced
       to its source: 1 the window, 2 the particles in it, 3 the cursor
       tubes, 4 the background canvas, 5 the head */
    const diag = { noWindow: false, noParticles: false };
    const wantStats = process.env.NODE_ENV === "development" && /[?&]stats(=|&|$)/.test(window.location.search);
    let readout = null;
    let longFrames = 0, frameCount = 0, lastFrameAt = 0, worst = 0, windowStart = performance.now();
    const onKey = (e) => {
      if (!wantStats) return;
      const tubes = document.querySelector(".tubes-cursor-canvas");
      const bgEl = document.querySelector("canvas.bg-particles");
      const head = document.querySelector(".focus-head");
      if (e.key === "1") diag.noWindow = !diag.noWindow;
      if (e.key === "2") diag.noParticles = !diag.noParticles;
      if (e.key === "3" && tubes) tubes.style.display = tubes.style.display === "none" ? "" : "none";
      if (e.key === "4" && bgEl) bgEl.style.visibility = bgEl.style.visibility === "hidden" ? "" : "hidden";
      if (e.key === "5" && head) head.style.visibility = head.style.visibility === "hidden" ? "" : "hidden";
    };
    if (wantStats) {
      readout = document.createElement("pre");
      readout.className = "focus-stats";
      document.body.appendChild(readout);
      window.addEventListener("keydown", onKey);
    }
    const noteFrame = () => {
      const now = performance.now();
      if (lastFrameAt) {
        const gap = now - lastFrameAt;
        frameCount++;
        if (gap > 25) longFrames++;
        if (gap > worst) worst = gap;
      }
      lastFrameAt = now;
      if (readout && now - windowStart > 1000) {
        const fps = (frameCount * 1000) / (now - windowStart);
        readout.textContent =
          `fps ${fps.toFixed(0)}   long frames (>25ms) ${longFrames}   worst ${worst.toFixed(0)}ms   window ${stats.ms.toFixed(2)}ms\n` +
          `keys: 1 window ${diag.noWindow ? "OFF" : "on"}  2 particles ${diag.noParticles ? "OFF" : "on"}  3 tubes  4 background  5 head`;
        windowStart = now;
        frameCount = 0;
        longFrames = 0;
        worst = 0;
      }
    };
    const ringColor = getComputedStyle(grid.querySelector(".card")).borderTopColor || "rgba(255,255,255,0.1)";
    const bgCanvas = () => document.querySelector("canvas.bg-particles");

    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      noteFrame();
      const tDraw = performance.now();
      const t = still ? 0 : (performance.now() - t0) / 1000;
      const cx = gw / 2;
      const cy = gh / 2;
      const blob = cloudPath2D(cloudPoints(t, readLive(), cx, cy));
      const dim = root.classList.contains("card-focus");
      if (diag.noWindow) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, gw, gh);
        stats.frames++;
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, gw, gh);

      /* inside the cloud: the page as it is underneath, drawn in viewport
         terms through the canvas's own placement on screen */
      ctx.save();
      ctx.clip(blob);
      ctx.scale(1 / scale, 1 / scale);
      ctx.translate(-left, -top);
      ctx.fillStyle = pageGrad;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < PAGE_GLOWS.length; i++) {
        const gl = PAGE_GLOWS[i];
        ctx.save();
        ctx.translate(gl.x * W, gl.y * H);
        ctx.scale(gl.rx / gl.ry, 1);
        ctx.fillStyle = glowGrads[i];
        ctx.fillRect(-gl.rx, -gl.ry, gl.rx * 2, gl.ry * 2);
        ctx.restore();
      }
      const bg = diag.noParticles ? null : bgCanvas();
      if (bg && bg.width > 0) {
        ctx.globalAlpha = dim ? 0.35 : 1; // the background dims while a card is in front (Landing.css)
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      /* the cut edge: the cards' own border along the cloud, on the card
         side only (2px stroke, the inner half clipped away), where the
         cloud crosses a card */
      ctx.save();
      ctx.clip(cardsPath);
      const outside = new Path2D();
      outside.rect(0, 0, gw, gh);
      outside.addPath(blob);
      ctx.clip(outside, "evenodd");
      ctx.lineWidth = 2;
      ctx.strokeStyle = ringColor;
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.stroke(blob);
      ctx.restore();

      stats.ms = stats.ms * 0.9 + (performance.now() - tDraw) * 0.1;
      stats.frames++;
    };
    measure();
    draw();
    /* the window is drawn from inside the portrait's own frame, right after
       the head has moved and rendered, so the two never disagree by a frame.
       A watchdog keeps it drawing on its own if the portrait is not there. */
    let lastHook = 0;
    window.__fhAfterFrame = () => {
      lastHook = performance.now();
      if (!still) draw();
    };
    const tick = () => {
      if (!still && performance.now() - lastHook > 150) draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ro = window.ResizeObserver ? new ResizeObserver(() => { measure(); if (still) draw(); }) : null;
    if (ro) ro.observe(grid);
    const onResize = () => { measure(); if (still) draw(); };
    window.addEventListener("resize", onResize);
    // the wrap's scale settles a frame after layout; measure again then
    const settle = setTimeout(measure, 300);
    return () => {
      cancelAnimationFrame(raf);
      if (window.__fhAfterFrame) delete window.__fhAfterFrame;
      if (readout) readout.remove();

      window.removeEventListener("keydown", onKey);
      clearTimeout(settle);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`landing landing-focus${hoveredCard ? " card-focus" : ""}${headFocus ? " head-focus" : ""}${gridFocus ? " gh-focus" : ""}`}
    >
      <BgVariantB magnetTarget={magnetTarget} magnetCardId={hoveredCard} vortexTarget={vortexTarget} />
      <TubesCursorOverlay hoveredCard={hoveredCard} />

      <div className="wrap focus-wrap" ref={wrapRef}>
        <header className="hero focus-hero">
          <h1 className="title">Hyder Mohyuddin</h1>
          <ContribLabel username="hmohyud" />
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
          <div className="hero-meta">
            <p className="subtitle">
              <span className="subtitle-text">AI &amp; Software • Systems • Interfaces</span>
            </p>
            <div className="hero-contact" role="group" aria-label="Contact links">
              <CopyEmail className="hero-gh-link" email="hyder.mohyuddin@gmail.com" />
              <span className="hero-contact-sep" aria-hidden="true">·</span>
              <a className="hero-gh-link gh" href="https://github.com/hmohyud" target="_blank" rel="noopener noreferrer" aria-label="Open GitHub profile">
                <span className="gh-url-long">github.com/hmohyud</span>
                <span className="gh-url-short">github</span>
              </a>
            </div>
          </div>
        </header>

        <section className="focus-stage" aria-label="Site sections">
          {/* the cards: untouched, never clipped; these take the pointer */}
          <div className="grid focus-grid" ref={gridRef}>
            {CARDS.map(({ id, to, title, copy, Icon, img, label }) => (
              <Link
                key={id}
                ref={setCardRef(id)}
                to={to}
                className={`card card-${id} portal${hoveredCard === id ? " card-hover-active" : ""}`}
                aria-label={label}
                onMouseEnter={() => setHoveredCard(id)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <span className={`portal-glow portal-${id}`} aria-hidden="true" />
                <CardBody title={title} copy={copy} Icon={Icon} img={img} isHovered={false} lazy />
              </Link>
            ))}
          </div>

          {/* the window: the page's background painted inside the cloud */}
          <canvas className="focus-window" ref={winRef} aria-hidden="true" />

          {/* the front layer: an unmasked twin of each card on the same
              grid, shown only while its card is hovered */}
          <div className="grid focus-grid focus-front" aria-hidden="true">
            {CARDS.map(({ id, title, copy, Icon, img }) => (
              <div key={id} className={`card card-${id} portal${hoveredCard === id ? " card-hover-active" : ""}`}>
                <span className={`portal-glow portal-${id}`} />
                <CardBody title={title} copy={copy} Icon={Icon} img={img} isHovered={hoveredCard === id} lazy />
              </div>
            ))}
          </div>

          {/* the portrait, centred over the window */}
          <div className="focus-head">
            <FloatingHead
              big
              hoveredCard={hoveredCard}
              lookTarget={gridFocus ? gridEl : null}
              onHoverChange={(el) => {
                setVortexTarget(el);
                setHeadFocus(!!el);
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
