import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import BgVariantB from "../components/BgVariantB";
import TubesCursorOverlay from "../components/TubesCursorOverlay";
import { ContribLabel, ContribGrid } from "../components/GithubContributions";
import FloatingHead from "../components/FloatingHead";
import CopyEmail from "../components/CopyEmail";
/* the write-up count in the mission stays honest by reading the same array
   the Projects page renders - add a project, the sentence updates itself */
import { projects } from "./Projects";
import { useMissionDots } from "./useMissionDots";
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
/* the portrait sits among the cards only on desktop widths: at 1050px and
   below FloatingHead moves itself into the mission paragraph (its own
   "tablet" layout), so the cloud, its hit area and the boundary light have
   nothing to frame there and stay off. The same breakpoint as the portrait's. */
const DESKTOP_QUERY = "(min-width: 1051px)";
function useDesktop() {
  const [desktop, setDesktop] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(DESKTOP_QUERY).matches));
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

/* the boundary light: begins this far outside the cloud, reaches this far
   around the pointer, and peaks at this opacity on the line itself; as the
   pointer comes near, the card's part over the cloud also thins out, up to
   REVEAL_MAX, so the head shows through it */
const LIGHT_REACH = 240;
const LIGHT_RADIUS = 260;
const LIGHT_PEAK = 0.4;
const REVEAL_MAX = 0.7;
/* the background's embers get this much extra weight inside the window */
const INSIDE_LIFT = 0.6;
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

/* a closed Catmull-Rom curve through the points, as a Path2D (the canvas) */
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

/* the same curve as an SVG path string (the hit area's clip-path) */
function cloudPathStr(pts) {
  const n = pts.length / 2;
  const X = (i) => pts[((i + n) % n) * 2], Y = (i) => pts[((i + n) % n) * 2 + 1];
  const f = (v) => v.toFixed(1);
  let d = "M" + f(X(0)) + " " + f(Y(0));
  for (let i = 0; i < n; i++) {
    const c1x = X(i) + (X(i + 1) - X(i - 1)) / 6, c1y = Y(i) + (Y(i + 1) - Y(i - 1)) / 6;
    const c2x = X(i + 1) - (X(i + 2) - X(i)) / 6, c2y = Y(i + 1) - (Y(i + 2) - Y(i)) / 6;
    d += "C" + f(c1x) + " " + f(c1y) + " " + f(c2x) + " " + f(c2y) + " " + f(X(i + 1)) + " " + f(Y(i + 1));
  }
  return d + "Z";
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
  /* the source is set on the element itself, once, and never through a
     React prop: setting a video's src attribute - even to the same value -
     restarts its loading and aborts a play() in flight, which is what left
     the first hover silent. A lazy preview waits for its first hover. */
  const arm = () => {
    const vid = videoRef.current;
    if (vid && !vid.getAttribute("src")) {
      vid.setAttribute("src", videoSrc);
      vid.load();
    }
  };
  useEffect(() => {
    if (!lazy) arm();
  }, [lazy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isHovered) {
      arm();
      vid.currentTime = 0;
      vid.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setPlaying(false);
    }
  }, [isHovered]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="peek">
      <img src={imgSrc} alt={alt} loading="lazy" className={playing ? "peek-hidden" : ""} />
      <video ref={videoRef} muted loop playsInline preload={lazy ? "none" : "auto"} className={`peek-video ${playing ? "peek-visible" : ""}`} />
    </div>
  );
}

/* a card's inside: the card layer and the front layer draw the same thing */
function CardBody({ title, Icon, img, isHovered, lazy }) {
  const PU = process.env.PUBLIC_URL;
  return (
    <>
      <div className="card-head">
        <span className="icon"><Icon /></span>
        <h2>{title}</h2>
      </div>
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
  const hitRef = useRef(null);
  const lightRef = useRef(null);
  /* the head's hover is taken by a hit area shaped like the cloud (the
     portrait's own box is a square, which caught the pointer where there
     was no head); it hands the hover and the click to the portrait */
  const headHover = (on) => {
    const host = document.querySelector(".focus-head .fh-mini");
    setVortexTarget(on ? host : null);
    setHeadFocus(on);
  };
  const openHead = () => {
    const host = document.querySelector(".focus-head .fh-mini");
    if (host) host.click();
  };
  const [hoveredCard, setHoveredCard] = useState(null);
  const [vortexTarget, setVortexTarget] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const desktop = useDesktop();
  /* when a card loses the hover, the grid card beneath its twin goes dim at
     once (card-dim-now), so the twin's fade ends on the dimmed card and not
     a card still fading; before paint, so no frame shows otherwise */
  const prevHoverRef = useRef(null);
  const leaveTimers = useRef({}); // per card: the timer that clears its leaving marks
  useLayoutEffect(() => {
    const prev = prevHoverRef.current;
    prevHoverRef.current = hoveredCard;
    const twinOf = (id) => (rootRef.current ? rootRef.current.querySelector(".focus-front .card-" + id) : null);
    /* the card now hovered sheds any leaving marks at once (a quick return
       to it must fade in like any other hover) */
    if (hoveredCard && cardRefs.current[hoveredCard]) {
      clearTimeout(leaveTimers.current[hoveredCard]);
      cardRefs.current[hoveredCard].classList.remove("card-dim-now");
      const t = twinOf(hoveredCard);
      if (t) t.classList.remove("card-leaving");
    }
    if (!prev || prev === hoveredCard) return;
    const el = cardRefs.current[prev];
    if (!el) return;
    el.classList.add("card-dim-now");
    /* and its twin is marked for the fade's length: the cloud and the head
       stay painted over the twin's cloud part (see the light canvas), so
       the cloud does not jump while the twin fades. The timer is per card
       and never cancelled by a later hover - a cleanup that cancelled it
       left cards marked for good when the pointer moved straight from one
       card to the next, and they stopped fading. */
    const twin = twinOf(prev);
    if (twin) twin.classList.add("card-leaving");
    clearTimeout(leaveTimers.current[prev]);
    leaveTimers.current[prev] = setTimeout(() => {
      el.classList.remove("card-dim-now");
      if (twin) twin.classList.remove("card-leaving");
    }, 350);
  }, [hoveredCard]);
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);
  /* the dot fill after the mission's text, as the old landing has it */
  useMissionDots(moreOpen);
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
    const hit = hitRef.current;
    const light = lightRef.current;
    if (!grid || !win || !root || !hit || !light) return undefined;
    const lctx = light.getContext("2d");
    if (!lctx) return undefined;
    /* the pointer, for the light that gathers on the cloud's edge as it
       comes near: in viewport px, null when it has left the page */
    let pointer = null;
    let headRect = null, headRectAt = 0; // the head canvas's place on screen, read now and then
    const outlinePub = {
      cx: 0, cy: 0, live: null, scale: 1,
      radiusAt(a) {
        if (!this.live) return 0;
        const i = (((Math.round((a / (Math.PI * 2)) * RAYS) % RAYS) + RAYS) % RAYS);
        return this.live[i] * this.scale;
      },
    };
    const onPm = (e) => { pointer = { x: e.clientX, y: e.clientY }; };
    const onPl = () => { pointer = null; };
    window.addEventListener("pointermove", onPm, { passive: true });
    document.addEventListener("pointerleave", onPl);
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
      light.width = win.width;
      light.height = win.height;
      light.style.width = gw + "px";
      light.style.height = gh + "px";
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
    let focusT = 0, lastDrawT = 0; // the eased dim inside the window, and when it was last stepped
    const t0 = performance.now();
    const deskMq = window.matchMedia(DESKTOP_QUERY);
    let wasDesktop = true;
    /* the hit area's clip: when it was last set, and the points it was set to */
    let hitAt = -1e9;
    let hitPts = null;
    const hitMoved = (pts) => {
      if (!hitPts || hitPts.length !== pts.length) return true;
      for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i] - hitPts[i]) > 2) return true;
      return false;
    };
    const draw = () => {
      noteFrame();
      const tDraw = performance.now();
      /* below the desktop breakpoint the portrait is in the mission
         paragraph, not among the cards: the window, the light and the hit
         area are cleared once and left alone, and no outline is published
         (the dots then orbit the portrait where it is) */
      /* until the real head is in (window.__fhReal), there is no cloud to
         draw: the stand-in's outline is not the head's. The window, the
         light and the hit area fade in with the head once it is. */
      if (!window.__fhReal) {
        stats.frames++;
        return;
      }
      if (!root.classList.contains("head-real")) root.classList.add("head-real");
      if (!deskMq.matches) {
        if (wasDesktop) {
          wasDesktop = false;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, win.width, win.height);
          lctx.setTransform(1, 0, 0, 1, 0, 0);
          lctx.clearRect(0, 0, light.width, light.height);
          hit.style.clipPath = "";
          hitPts = null;
          delete window.__focusOutline;
        }
        stats.frames++;
        return;
      }
      wasDesktop = true;
      const t = still ? 0 : (performance.now() - t0) / 1000;
      const cx = gw / 2;
      const cy = gh / 2;
      const live = readLive();
      /* the outline for the background's dots (viewport px): the embers ride it */
      if (live) {
        outlinePub.cx = left + cx * scale;
        outlinePub.cy = top + cy * scale;
        outlinePub.live = live;
        outlinePub.scale = scale;
        window.__focusOutline = outlinePub;
      }
      const pts = cloudPoints(t, live, cx, cy);
      const blob = cloudPath2D(pts);
      /* The hit area's clip is a style change, and a style change every
         frame put the whole paint lifecycle (style, paint, layerize,
         commit) on every frame - about a fifth of the main thread's time
         at 240 Hz - plus a mask re-raster. The cloud sways slowly, so the
         hit shape follows it at most four times a second and only once it
         has moved: a hit edge a couple of pixels behind the drawn one is
         not something a pointer can notice. */
      if (tDraw - hitAt > 250 && hitMoved(pts)) {
        hit.style.clipPath = 'path("' + cloudPathStr(pts) + '")';
        hitAt = tDraw;
        hitPts = pts.slice();
      }
      /* the dim inside the window follows the page's: any focus (a card,
         the head, the grid) dims the background to 0.8 over 0.3 s, and the
         window's copy eases the same way instead of switching at once */
      const focused = root.classList.contains("card-focus") || root.classList.contains("head-focus") || root.classList.contains("gh-focus");
      const dtF = Math.min(0.1, (tDraw - (lastDrawT || tDraw)) / 1000);
      lastDrawT = tDraw;
      focusT += ((focused ? 1 : 0) - focusT) * (1 - Math.exp(-dtF / 0.1));
      const dimA = 1 - 0.2 * focusT;
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
        ctx.globalAlpha = dimA;
        ctx.drawImage(bg, 0, 0, W, H);
        /* a second, lighter pass: the embers are faint, and through the window
           they sit behind the head's own dots, so they get a little lift there */
        ctx.globalAlpha = dimA * INSIDE_LIFT;
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
      ctx.globalAlpha = 1 - 0.7 * focusT;
      ctx.stroke(blob);
      ctx.restore();


      /* the boundary light, on its own canvas above the lifted card: while a
         card is in front, the part of the cloud's edge that crosses that
         card shows faintly as the pointer comes near, brighter the closer
         it gets - the way a VR boundary fades in as you reach for it. Only
         there, only then; nowhere else on the page. */
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.clearRect(0, 0, gw, gh);
      const twin = pointer && live ? root.querySelector(".focus-front .card.card-hover-active") : null;
      if (twin) {
        const px = (pointer.x - left) / scale, py = (pointer.y - top) / scale;
        const ddx = px - cx, ddy = py - cy;
        const dist = Math.hypot(ddx, ddy);
        const ang = Math.atan2(ddy, ddx);
        const ri = (((Math.round((ang / (Math.PI * 2)) * RAYS) % RAYS) + RAYS) % RAYS);
        const edge = live[ri];
        const nearLin = Math.max(0, 1 - Math.max(0, dist - edge) / LIGHT_REACH);
        const near = nearLin * nearLin; // eases in: faint far out, present close by
        if (near > 0.02) {
          const tr = twin.getBoundingClientRect();
          const box = new Path2D();
          box.roundRect((tr.left - left) / scale, (tr.top - top) / scale, tr.width / scale, tr.height / scale, CARD_RADIUS);
          /* the card thins out over the cloud: what lies beneath (the window
             and the head) is painted over it, stronger the nearer the pointer */
          const headCanvas = document.querySelector(".focus-head canvas");
          if (headCanvas) {
            if (!headRect || performance.now() - headRectAt > 500) {
              headRect = headCanvas.getBoundingClientRect();
              headRectAt = performance.now();
            }
            lctx.save();
            lctx.clip(box);
            lctx.clip(blob);
            lctx.globalAlpha = REVEAL_MAX * near;
            lctx.drawImage(win, 0, 0, gw, gh);
            lctx.drawImage(headCanvas, (headRect.left - left) / scale, (headRect.top - top) / scale, headRect.width / scale, headRect.height / scale);
            lctx.restore();
          }
          const glow = lctx.createRadialGradient(px, py, 0, px, py, LIGHT_RADIUS);
          glow.addColorStop(0, `rgba(190,220,255,${LIGHT_PEAK * near})`);
          glow.addColorStop(1, "rgba(190,220,255,0)");
          lctx.save();
          lctx.clip(box);
          lctx.strokeStyle = glow;
          lctx.lineWidth = 16;
          lctx.globalAlpha = 0.16;
          lctx.stroke(blob);
          lctx.lineWidth = 1.25;
          lctx.globalAlpha = 1;
          lctx.stroke(blob);
          lctx.restore();
        }
      }

      /* a copy that is fading away (card-leaving, for the fade's length):
         the cloud and the head stay painted over its cloud part as they
         were while it was hovered, so the cloud does not jump back to solid
         for the fade's duration */
      const leaving = live ? root.querySelectorAll(".focus-front .card.card-leaving") : [];
      if (leaving.length) {
        const headCanvas = document.querySelector(".focus-head canvas");
        if (headCanvas) {
          if (!headRect || performance.now() - headRectAt > 500) {
            headRect = headCanvas.getBoundingClientRect();
            headRectAt = performance.now();
          }
          for (const el of leaving) {
            if (el.classList.contains("card-hover-active")) continue;
            const tr = el.getBoundingClientRect();
            const box = new Path2D();
            box.roundRect((tr.left - left) / scale, (tr.top - top) / scale, tr.width / scale, tr.height / scale, CARD_RADIUS);
            lctx.save();
            lctx.clip(box);
            lctx.clip(blob);
            lctx.globalAlpha = REVEAL_MAX;
            lctx.drawImage(win, 0, 0, gw, gh);
            lctx.drawImage(headCanvas, (headRect.left - left) / scale, (headRect.top - top) / scale, headRect.width / scale, headRect.height / scale);
            lctx.restore();
          }
        }
      }

      stats.ms = stats.ms * 0.9 + (performance.now() - tDraw) * 0.1;
      stats.frames++;
    };
    /* A throw inside draw must never stop the cloud: the portrait's own
       loop would carry on without it and the head would sit on the cards
       with no window behind it. Caught, reported once, drawn again next
       frame; and the watchdog re-arms whatever happens. */
    let drawErrors = 0;
    const safeDraw = () => {
      try {
        draw();
      } catch (err) {
        if (drawErrors++ < 1) console.error("landing window:", err);
      }
    };
    measure();
    safeDraw();
    /* the window is drawn from inside the portrait's own frame, right after
       the head has moved and rendered, so the two never disagree by a frame.
       A watchdog keeps it drawing on its own if the portrait is not there. */
    let lastHook = 0;
    window.__fhAfterFrame = () => {
      lastHook = performance.now();
      if (!still) safeDraw();
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (still) {
        /* reduced motion draws once, not per frame - but that once must come
           after the real head is in, or the window never appears */
        if (window.__fhReal && !root.classList.contains("head-real")) safeDraw();
        return;
      }
      if (performance.now() - lastHook > 150) safeDraw();
    };
    raf = requestAnimationFrame(tick);
    const ro = window.ResizeObserver ? new ResizeObserver(() => { measure(); if (still) safeDraw(); }) : null;
    if (ro) ro.observe(grid);
    const onResize = () => { measure(); if (still) safeDraw(); };
    window.addEventListener("resize", onResize);
    // the wrap's scale settles a frame after layout; measure again then
    const settle = setTimeout(measure, 300);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPm);
      document.removeEventListener("pointerleave", onPl);
      delete window.__focusOutline;
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
        {/* the hero as the old landing had it, less the portrait, which now
            sits among the cards */}
        <header className="hero focus-hero">
          {/* the name reloads the landing: a plain link, not a router one */}
          <h1 className="title">
            <a className="title-link" href="/" aria-label="Hyder Mohyuddin - reload the landing page">Hyder Mohyuddin</a>
          </h1>
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
          <div className="hero-meta">
            <p className="subtitle">
              <span className="subtitle-text">
                AI &amp; Software • Systems • Interfaces
              </span>
            </p>
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
                <span className="gh-url-long">github.com/hmohyud</span>
                <span className="gh-url-short">github</span>
              </a>
            </div>
          </div>
          <p className="mission">
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

        <section className="focus-stage" aria-label="Site sections">
          {/* the cards: untouched, never clipped; these take the pointer */}
          <div className="grid focus-grid" ref={gridRef}>
            {CARDS.map(({ id, to, title, copy, Icon, img, label }) => (
              <Link
                key={id}
                ref={setCardRef(id)}
                to={to}
                className={`card card-${id} portal${hoveredCard === id ? " card-hover-active" : ""}`}
                aria-label={label + " - " + copy}
                onMouseEnter={() => setHoveredCard(id)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <span className={`portal-glow portal-${id}`} aria-hidden="true" />
                <CardBody title={title} Icon={Icon} img={img} isHovered={false} lazy />
              </Link>
            ))}
          </div>

          {/* the window: the page's background painted inside the cloud */}
          <canvas className="focus-window" ref={winRef} aria-hidden="true" />

          {/* the head's hit area, clipped to the cloud each frame: hovering
              it is hovering the head, clicking it opens the portrait */}
          <div
            className="focus-hit"
            ref={hitRef}
            role="button"
            tabIndex={0}
            aria-label="Open the 3D portrait"
            onPointerEnter={() => headHover(true)}
            onPointerLeave={() => headHover(false)}
            onClick={openHead}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openHead();
              }
            }}
          />

          {/* the front layer: an unmasked twin of each card on the same
              grid, shown only while its card is hovered */}
          <div className="grid focus-grid focus-front" aria-hidden="true">
            {CARDS.map(({ id, title, Icon, img }) => (
              <div key={id} className={`card card-${id} portal${hoveredCard === id ? " card-hover-active" : ""}`}>
                <span className={`portal-glow portal-${id}`} />
                <CardBody title={title} Icon={Icon} img={img} isHovered={hoveredCard === id} lazy />
              </div>
            ))}
          </div>

          {/* the boundary light: above the lifted card, drawn only where the
              cloud's edge crosses it and only as the pointer comes near */}
          <canvas className="focus-light" ref={lightRef} aria-hidden="true" />

          {/* the portrait, centred over the window */}
          <div className="focus-head">
            <FloatingHead
              big={desktop}
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
