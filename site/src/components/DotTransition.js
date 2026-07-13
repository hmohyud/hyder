import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * DotTransition — page navigations dissolve into "Rising Ember" dots (the
 * landing background's palette) that shimmer in place, then fly directly to
 * the destination page's content once it has mounted.
 *
 * Rendering runs in a Web Worker on an OffscreenCanvas wherever supported,
 * so the animation cannot stutter while React mounts a heavy destination
 * page on the main thread. Falls back to a main-thread rAF loop otherwise.
 *
 * Skipped entirely (plain navigation) on touch/small screens and for users
 * with prefers-reduced-motion.
 */

// the landing page's ember palette, verbatim (BgVariantB.js)
const EMBERS = [
  [255, 114, 161], // pink
  [180, 139, 255], // purple
  [127, 211, 255], // blue
  [120, 255, 168], // green
  [200, 210, 235], // soft white-blue (double weight, like the landing bg)
  [200, 210, 235],
];

const SPA_PATHS = new Set(["/", "/skills", "/projects", "/about", "/resume"]);

const SAMPLE_SELECTOR =
  "h1,h2,h3,p,li,blockquote,img,button,a,.rot-img,.physics-block,.physics-heading";
// content that lives inside embedded surfaces rather than DOM text
// (Skills' physics canvas, Resume's <object> PDF viewer)
const SURFACE_SELECTOR = "canvas,svg,object,embed,iframe,video";

// Debug switch: when true, dots never fade — they park on their landing
// spots so target alignment can be inspected against the revealed page.
const DEBUG_HOLD = false;

const HOLD_MIN_MS = 220; // shimmer in place at least this long (covers route mount)
const HOME_MS = 420; // per-dot flight time onto the new page
const STAGGER_MS = 90; // rank-staggered departure — the reform reads as a wave
const SETTLE_MS = 140; // beat after the route mounts before first sampling
const FADE_MS = 600; // each dot starts fading the moment it lands
const TRACK_POLL_MS = 150; // live target re-resolution cadence (during the fade)
const BAIL_MS = 2200; // give up gracefully if the new page never settles

/* ── shared animation core, identical on both render paths ──
   Runs standalone inside the worker; string-injected there, called directly
   on the main-thread fallback. Everything is a pure function of time. */
const ANIMATION_CORE = `
  var sprites = {};
  function spriteFor(makeCanvas, r, g, b) {
    var k = r + "," + g + "," + b;
    if (sprites[k]) return sprites[k];
    var size = 24, c = makeCanvas(size), sc = c.getContext("2d");
    var grad = sc.createRadialGradient(12, 12, 0, 12, 12, 12);
    // crisp core, whisper of halo — reads like the landing embers, not bokeh
    grad.addColorStop(0, "rgba(" + k + ",1)");
    grad.addColorStop(0.62, "rgba(" + k + ",0.95)");
    grad.addColorStop(0.8, "rgba(" + k + ",0.22)");
    grad.addColorStop(1, "rgba(" + k + ",0)");
    sc.fillStyle = grad;
    sc.fillRect(0, 0, size, size);
    sprites[k] = c;
    return c;
  }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  // soft-edged "light" stamp used to punch reveal holes into the cover
  function makeHoleSprite(makeCanvas) {
    var size = 64, c = makeCanvas(size), sc = c.getContext("2d");
    var g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    sc.fillStyle = g;
    sc.fillRect(0, 0, size, size);
    return c;
  }
  // the incoming page hides under this cover; landing dots punch light into it.
  // Initialized the moment targets (and the cover spec) arrive, so the page
  // can safely unhide beneath it before the flight even begins.
  function initCover(a) {
    if (!a || !a.coverSpec || a.cover) return;
    a.coverTop = a.coverSpec.top;
    a.cover = a.makeCanvas(1);
    a.cover.width = Math.max(1, a.W);
    a.cover.height = Math.max(1, a.H - a.coverTop);
    var cctx = a.cover.getContext("2d");
    cctx.fillStyle = a.coverSpec.color;
    cctx.fillRect(0, 0, a.cover.width, a.cover.height);
    a.holeSprite = makeHoleSprite(a.makeCanvas);
    a.lamps = [];
    a.lampEvery = Math.max(1, Math.round(a.dots.length / 240));
  }
  // state: {dots, targets, t0, phase, homeStart, revealed, cfg, ctx, W, H}
  function animFrame(a, now, emit) {
    var ctx = a.ctx, dots = a.dots, n = dots.length;
    ctx.clearRect(0, 0, a.W, a.H);
    if (a.phase === "hold") {
      // cover goes down first — under the dots — as soon as it exists
      if (a.cover) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.drawImage(a.cover, 0, a.coverTop);
      }
      ctx.globalCompositeOperation = "lighter";
      var el = now - a.t0;
      var aIn = Math.min(1, el / 90);
      for (var i = 0; i < n; i++) {
        var d = dots[i];
        drawDot(ctx, d,
          d.x0 + Math.sin(el * d.fx + d.px) * d.ax,
          d.y0 + Math.sin(el * d.fy + d.py) * d.ay, aIn);
      }
      if (a.targets && el >= a.cfg.holdMin) {
        var m = a.targets.length;
        for (var j = 0; j < n; j++) {
          var dj = dots[j], ti = Math.min(m - 1, ((j / n) * m) | 0);
          var t = a.targets[ti];
          dj.ti = ti; // live index — target positions may keep moving
          dj.sx = dj.x0 + Math.sin(el * dj.fx + dj.px) * dj.ax;
          dj.sy = dj.y0 + Math.sin(el * dj.fy + dj.py) * dj.ay;
          dj.cx = dj.sx;
          dj.cy = dj.sy;
          dj.lit = false;
          // crossfade to the destination element's color mid-flight
          dj.sp2 = t.c ? spriteFor(a.makeCanvas, t.c[0], t.c[1], t.c[2]) : dj.sp;
        }
        a.phase = "home";
        a.homeStart = now;
      } else if (el > a.cfg.bailMs) {
        return "done";
      }
    } else {
      var sh = now - a.homeStart;
      var flight = a.cfg.homeMs + a.cfg.staggerMs;
      var totalDur = flight + a.cfg.fadeMs + 150;
      ctx.globalCompositeOperation = "lighter";

      // ── cover: punch the active lamps, then draw what remains ──
      if (a.cover) {
        var cc = a.cover.getContext("2d");
        cc.globalCompositeOperation = "destination-out";
        var keep = [];
        for (var li = 0; li < a.lamps.length; li++) {
          var L = a.lamps[li];
          var lt = Math.min(1, (now - L.t0) / 650);
          var lr = easeOutCubic(lt) * L.R;
          if (lr > 1) {
            cc.drawImage(a.holeSprite, L.x - lr, L.y - a.coverTop - lr, lr * 2, lr * 2);
          }
          if (lt < 1) keep.push(L);
        }
        a.lamps = keep;
        var coverAlpha = 1 - Math.min(1, Math.max(0, (sh - (flight + 300)) / 350));
        if (coverAlpha > 0) {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = coverAlpha;
          ctx.drawImage(a.cover, 0, a.coverTop);
          ctx.globalCompositeOperation = "lighter";
        }
      }

      for (var k = 0; k < n; k++) {
        var dk = dots[k];
        var tgt = a.targets[dk.ti];
        var tk = Math.min(1, Math.max(0, (sh - (k / n) * a.cfg.staggerMs) / a.cfg.homeMs));
        var alpha = 1;
        if (tk < 1) {
          // flight: tween toward the target's CURRENT position
          var e = easeInOut(tk);
          dk.cx = dk.sx + (tgt.x - dk.sx) * e;
          dk.cy = dk.sy + (tgt.y - dk.sy) * e;
        } else {
          if (!dk.lit) {
            dk.lit = true;
            dk.litAt = now;
            // this landing lights up the page around it
            if (a.cover && k % a.lampEvery === 0) {
              a.lamps.push({ x: dk.cx, y: dk.cy, t0: now, R: 110 + Math.random() * 70 });
            }
          }
          // landed: ride the glyph briefly while dissolving away
          dk.cx += (tgt.x - dk.cx) * 0.22;
          dk.cy += (tgt.y - dk.cy) * 0.22;
          if (!a.cfg.debugHold) {
            alpha = Math.max(0, 1 - (now - dk.litAt) / a.cfg.fadeMs);
          }
        }
        if (alpha > 0) drawCross(ctx, dk, dk.cx, dk.cy, alpha, easeInOut(tk));
      }
      if (!a.revealed && sh > flight * 0.55) {
        a.revealed = true;
        emit("reveal");
      }
      if (sh >= totalDur) return "done";
    }
    return "run";
  }
  function drawDot(ctx, d, x, y, alpha) {
    var s = d.size * 2.4; // sprite core fills ~62% — visible dot stays crisp
    ctx.globalAlpha = alpha * d.tw;
    ctx.drawImage(d.sp, x - s / 2, y - s / 2, s, s);
  }
  // start-color -> destination-color crossfade during the flight
  function drawCross(ctx, d, x, y, alpha, mix) {
    var s = d.size * 2.4;
    if (d.sp2 && d.sp2 !== d.sp) {
      ctx.globalAlpha = alpha * d.tw * (1 - mix);
      ctx.drawImage(d.sp, x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = alpha * d.tw * mix;
      ctx.drawImage(d.sp2, x - s / 2, y - s / 2, s, s);
    } else {
      ctx.globalAlpha = alpha * d.tw;
      ctx.drawImage(d.sp, x - s / 2, y - s / 2, s, s);
    }
  }
`;

const WORKER_SRC = `
  ${ANIMATION_CORE}
  var canvas = null, ctx = null, W = 0, H = 0;
  var anim = null;
  var makeCanvas = function (size) { return new OffscreenCanvas(size, size); };
  var raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
  function loop(now) {
    if (!anim) return;
    var state = animFrame(anim, now, function (type) { postMessage({ type: type }); });
    if (anim && anim.coverAckPending && anim.cover) {
      // the cover has now been painted at least once — safe to unhide the page
      anim.coverAckPending = false;
      postMessage({ type: "cover-ready" });
    }
    if (state === "done") {
      if (!anim.cfg.debugHold) {
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      anim = null;
      postMessage({ type: "done" });
      return;
    }
    raf(loop);
  }
  onmessage = function (e) {
    var msg = e.data;
    if (msg.type === "canvas") {
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
    } else if (msg.type === "size") {
      W = msg.w; H = msg.h;
      canvas.width = msg.w * msg.dpr;
      canvas.height = msg.h * msg.dpr;
      ctx.setTransform(msg.dpr, 0, 0, msg.dpr, 0, 0);
    } else if (msg.type === "start") {
      var dots = msg.dots.map(function (d) {
        d.sp = spriteFor(makeCanvas, d.r, d.g, d.b);
        d.sx = 0; d.sy = 0; d.tx = 0; d.ty = 0;
        return d;
      });
      anim = { dots: dots, targets: null, t0: performance.now(), phase: "hold",
               homeStart: 0, revealed: false, cfg: msg.cfg, ctx: ctx, W: W, H: H,
               makeCanvas: makeCanvas };
      raf(loop);
    } else if (msg.type === "targets") {
      if (anim) {
        anim.targets = msg.pts;
        anim.coverSpec = msg.cover || null;
        initCover(anim);
        anim.coverAckPending = !!anim.cover;
      }
    } else if (msg.type === "targets-move") {
      if (anim && anim.targets && anim.targets.length === msg.pts.length) {
        for (var i = 0; i < msg.pts.length; i++) {
          anim.targets[i].x = msg.pts[i].x;
          anim.targets[i].y = msg.pts[i].y;
        }
      }
    } else if (msg.type === "cancel") {
      anim = null;
      if (ctx) ctx.clearRect(0, 0, W, H);
    }
  };
`;

// an element's own color, when it actually has one (project accents, headings)
function elementAccent(el) {
  const m = getComputedStyle(el).color.match(/\d+/g);
  if (!m) return null;
  const [r, g, b] = m.map(Number);
  return Math.max(r, g, b) - Math.min(r, g, b) > 46 ? [r, g, b] : null;
}

function collectRects(root, selector) {
  const rects = [];
  for (const el of root.querySelectorAll(selector)) {
    // skip nested matches (a inside p, img inside .rot-img) — parents cover them
    if (el.parentElement && el.parentElement.closest(selector)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.right < 0 || r.left > window.innerWidth) continue;
    rects.push({
      r,
      el,
      accent: elementAccent(el),
      // cap an element's weight so big surfaces don't hog the whole budget
      area: Math.min(r.width * r.height, 90000),
    });
  }
  return rects;
}

const weightEdges = (x) => 2 * (x.r.width + x.r.height);

// the point a fraction `per` (0..1) of the way around a rect's perimeter —
// deterministic, so a tracked element's edge dots stay put as it moves
function edgePointAt(r, per) {
  const perim = 2 * (r.width + r.height);
  let d = per * perim;
  if (d < r.width) return { x: r.left + d, y: r.top };
  d -= r.width;
  if (d < r.height) return { x: r.right, y: r.top + d };
  d -= r.height;
  if (d < r.width) return { x: r.right - d, y: r.bottom };
  d -= r.width;
  return { x: r.left, y: r.bottom - d };
}

// re-resolve a tracked point's current position from its handle
// (text glyph via Range, element edge/fill via live bounding rect)
const trackRange = typeof document !== "undefined" ? document.createRange() : null;
function resolveHandle(h) {
  try {
    if (h.node) {
      trackRange.setStart(h.node, h.idx);
      trackRange.setEnd(h.node, h.idx + 1);
      const r = trackRange.getClientRects()[0];
      if (r && r.width >= 1) {
        h.x = r.left + h.nx * r.width;
        h.y = r.top + h.ny * r.height * 1.15;
      }
    } else if (h.el && h.el.isConnected) {
      const r = h.el.getBoundingClientRect();
      if (r.width >= 2) {
        if (h.per !== undefined) {
          const p = edgePointAt(r, h.per);
          h.x = p.x;
          h.y = p.y;
        } else {
          h.x = r.left + h.fx * r.width;
          h.y = r.top + h.fy * r.height;
        }
      }
    }
  } catch {
    /* node detached mid-track — keep last known position */
  }
  return h;
}

/* ── glyph-ink sampling: dots land on the letters' actual strokes ──
   Each unique character is rasterized ONCE per font (at a reference size) to
   a tiny offscreen canvas; its ink pixels are cached as normalized points.
   A sampled character then maps a random ink point into its on-page box. */
const GLYPH_REF = 64; // rasterization size (px) — normalized points reused at any size
const glyphInkCache = new Map();
let glyphScratch = null;
function glyphInk(ch, family, weight, style) {
  const key = ch + "|" + family + "|" + weight + "|" + style;
  let ink = glyphInkCache.get(key);
  if (ink !== undefined) return ink;
  if (!glyphScratch) {
    glyphScratch = document.createElement("canvas");
    glyphScratch.width = GLYPH_REF * 2;
    glyphScratch.height = GLYPH_REF * 2;
  }
  const g = glyphScratch.getContext("2d", { willReadFrequently: true });
  const W = (glyphScratch.width = GLYPH_REF * 2); // also clears
  const H = glyphScratch.height;
  g.font = `${style} ${weight} ${GLYPH_REF}px ${family}`;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";
  g.fillText(ch, GLYPH_REF * 0.25, GLYPH_REF * 1.2);
  const adv = Math.max(1, Math.min(g.measureText(ch).width, W));
  const data = g.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (data[(y * W + x) * 4 + 3] > 100) {
        // normalize: x over the glyph advance, y over ~1.5em line band
        pts.push([
          (x - GLYPH_REF * 0.25) / adv,
          (y - GLYPH_REF * 0.2) / (GLYPH_REF * 1.5),
        ]);
      }
    }
  }
  ink = pts.length ? pts : null;
  glyphInkCache.set(key, ink);
  return ink;
}

// dots on the letters themselves — random ink pixels of random characters,
// colored by the element's own text color (mono per element). Nodes are
// weighted by fontSize² so large headings visibly form their letterforms.
function collectTextPoints(root, budget) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim())
        return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || el.closest("script,style")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let total = 0;
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.right < 0 || r.left > window.innerWidth) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 14;
    const meta = {
      node: n,
      fs,
      family: cs.fontFamily,
      weight: cs.fontWeight,
      style: cs.fontStyle,
      weightTotal: n.nodeValue.length * fs * fs,
    };
    nodes.push(meta);
    total += meta.weightTotal;
  }
  if (!total) return [];

  const colorOf = new Map(); // one color per element
  const elementColor = (el) => {
    if (colorOf.has(el)) return colorOf.get(el);
    const c =
      elementAccent(el) || EMBERS[(Math.random() * EMBERS.length) | 0];
    colorOf.set(el, c);
    return c;
  };

  const range = document.createRange();
  const pts = [];
  for (const meta of nodes) {
    const { node, family, weight, style } = meta;
    const text = node.nodeValue;
    const len = text.length;
    const want = Math.max(1, Math.round((meta.weightTotal / total) * budget));
    const c = elementColor(node.parentElement);
    for (let i = 0; i < want; i++) {
      const idx = (Math.random() * len) | 0;
      const ch = text[idx];
      if (!ch || ch.trim() === "") continue; // whitespace has no ink
      const ink = glyphInk(ch, family, weight, style);
      if (!ink) continue;
      range.setStart(node, idx);
      range.setEnd(node, Math.min(len, idx + 1));
      const r = range.getClientRects()[0];
      if (!r || r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const [nx, ny] = ink[(Math.random() * ink.length) | 0];
      pts.push({
        x: r.left + nx * r.width,
        y: r.top + ny * r.height * 1.15, // char rects hug the em box
        c,
        node, // tracking handle: this glyph can be re-resolved as it moves
        idx,
        nx,
        ny,
      });
    }
  }
  return pts;
}

// points across the visible sampled elements of `root`, spatially sorted.
// mode "fill": random points inside each rect (dissolve).
// mode "edges": points along each rect's outline (the reform traces content).
// mode "text": points on the actual glyphs, plus edges of visual elements.
function samplePoints(root, budget, mode = "fill") {
  if (mode === "text") {
    const textPts = collectTextPoints(root, Math.round(budget * 0.8));
    // pictures/canvases have no glyphs — trace their outlines instead
    const visuals = collectRects(root, "img,.rot-img," + SURFACE_SELECTOR);
    const vBudget = Math.max(0, budget - textPts.length);
    const vTotal = visuals.reduce((s, x) => s + weightEdges(x), 0) || 1;
    const pts = textPts;
    for (const item of visuals) {
      const c =
        item.accent || EMBERS[(Math.random() * EMBERS.length) | 0];
      // document viewers (Resume's PDF <object>) have content everywhere —
      // fill them; images/canvases read better traced along their outline
      const isDoc = /^(OBJECT|EMBED|IFRAME)$/.test(item.el.tagName);
      const count = Math.max(
        3,
        Math.round(((weightEdges(item) * (isDoc ? 2 : 1)) / vTotal) * vBudget)
      );
      for (let i = 0; i < count; i++) {
        if (isDoc) {
          const fx = Math.random();
          const fy = Math.random();
          pts.push({
            x: item.r.left + fx * item.r.width,
            y: item.r.top + fy * item.r.height,
            c,
            el: item.el,
            fx,
            fy,
          });
        } else {
          const per = Math.random();
          const p = edgePointAt(item.r, per);
          pts.push({ x: p.x, y: p.y, c, el: item.el, per });
        }
      }
    }
    if (pts.length >= 8) {
      pts.sort((a, b) => a.y - b.y || a.x - b.x);
      return pts;
    }
    // fall through: no usable text (canvas-only pages) — use edges
    mode = "edges";
  }
  let rects = collectRects(root, SAMPLE_SELECTOR);
  const covered = rects.reduce((s, x) => s + x.r.width * x.r.height, 0);
  if (covered < window.innerWidth * window.innerHeight * 0.12) {
    rects = rects.concat(collectRects(root, SURFACE_SELECTOR));
  }
  const weight = (x) =>
    mode === "edges" ? 2 * (x.r.width + x.r.height) : x.area;
  const total = rects.reduce((s, x) => s + weight(x), 0) || 1;
  const pts = [];
  for (const item of rects) {
    const { r, el, accent } = item;
    // one color per element: its accent if it has one, else one ember
    const c = accent || EMBERS[(Math.random() * EMBERS.length) | 0];
    const n = Math.max(3, Math.round((weight(item) / total) * budget));
    for (let i = 0; i < n; i++) {
      if (mode === "edges") {
        const per = Math.random();
        const p = edgePointAt(r, per);
        pts.push({ x: p.x, y: p.y, c, el, per });
      } else {
        const fx = Math.random();
        const fy = Math.random();
        pts.push({
          x: r.left + fx * r.width,
          y: r.top + fy * r.height,
          c,
          el,
          fx,
          fy,
        });
      }
    }
  }
  // spatial rank order — rank-to-rank pairing keeps the flight coherent
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  return pts;
}

const makeDotData = (starts) =>
  starts.map((s) => ({
    x0: s.x,
    y0: s.y,
    r: s.c[0],
    g: s.c[1],
    b: s.c[2],
    size: 0.9 + Math.random() * 1.7,
    tw: 0.6 + Math.random() * 0.4,
    ax: 0.8 + Math.random() * 1.4,
    ay: 0.8 + Math.random() * 1.4,
    fx: 0.002 + Math.random() * 0.003,
    fy: 0.002 + Math.random() * 0.003,
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
  }));

export default function DotTransitionProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;

  const busyRef = useRef(false);
  const arrivedRef = useRef(null);

  useEffect(() => {
    if (arrivedRef.current) {
      const cb = arrivedRef.current;
      arrivedRef.current = null;
      cb();
    }
  }, [location.pathname]);

  useEffect(() => {
    // The canvas is created here, not in JSX: transferControlToOffscreen()
    // may only ever be called once per element, and dev StrictMode re-runs
    // effects against the same DOM node — a fresh node per run is safe.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      pointerEvents: "none",
    });
    document.body.appendChild(canvas);
    const offscreenOK = "transferControlToOffscreen" in canvas;

    // ── renderer: worker-backed when possible, main-thread otherwise ──
    let worker = null;
    let mainCtx = null;
    let mainAnim = null;
    let mainRaf = null;
    let onReveal = null;
    let onDone = null;
    let onCoverReady = null;

    // eslint-disable-next-line no-new-func
    const core = new Function(
      `${ANIMATION_CORE}; return { spriteFor, animFrame, initCover };`
    )();

    if (offscreenOK) {
      const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "canvas", canvas: off }, [off]);
      worker.onmessage = (e) => {
        if (e.data.type === "reveal") onReveal && onReveal();
        else if (e.data.type === "done") onDone && onDone();
        else if (e.data.type === "cover-ready") onCoverReady && onCoverReady();
      };
    } else {
      mainCtx = canvas.getContext("2d");
    }

    let dpr = 1;
    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = window.innerWidth;
      const h = window.innerHeight;
      // CSS size must be set explicitly — a canvas with only inset:0 displays
      // at its intrinsic (attribute) size, which is w*dpr: everything would
      // render scaled up by dpr and cropped (invisible at dpr 1, wildly
      // misaligned at Windows 125%/150% display scaling).
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      if (worker) {
        worker.postMessage({ type: "size", w, h, dpr });
      } else {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);

    const cfg = {
      holdMin: HOLD_MIN_MS,
      homeMs: HOME_MS,
      staggerMs: STAGGER_MS,
      fadeMs: FADE_MS,
      bailMs: BAIL_MS,
      debugHold: DEBUG_HOLD,
    };

    const startAnim = (dotData) => {
      if (worker) {
        worker.postMessage({ type: "start", dots: dotData, cfg });
      } else {
        const dots = dotData.map((d) => ({
          ...d,
          sp: core.spriteFor((s) => {
            const c = document.createElement("canvas");
            c.width = c.height = s;
            return c;
          }, d.r, d.g, d.b),
          sx: 0,
          sy: 0,
          tx: 0,
          ty: 0,
        }));
        mainAnim = {
          dots,
          targets: null,
          t0: performance.now(),
          phase: "hold",
          homeStart: 0,
          revealed: false,
          cfg,
          ctx: mainCtx,
          W: window.innerWidth,
          H: window.innerHeight,
          makeCanvas: (s) => {
            const c = document.createElement("canvas");
            c.width = c.height = s;
            return c;
          },
        };
        const loop = (now) => {
          if (!mainAnim) return;
          const state = core.animFrame(mainAnim, now, (type) => {
            if (type === "reveal") onReveal && onReveal();
          });
          if (state === "done") {
            if (!cfg.debugHold) {
              mainCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
              mainCtx.globalAlpha = 1;
              mainCtx.globalCompositeOperation = "source-over";
            }
            mainAnim = null;
            onDone && onDone();
            return;
          }
          mainRaf = requestAnimationFrame(loop);
        };
        mainRaf = requestAnimationFrame(loop);
      }
    };
    const sendTargets = (pts, cover) => {
      if (worker) worker.postMessage({ type: "targets", pts, cover });
      else if (mainAnim) {
        mainAnim.targets = pts;
        mainAnim.coverSpec = cover || null;
        core.initCover(mainAnim);
      }
    };
    const sendTargetsMove = (pts) => {
      if (worker) worker.postMessage({ type: "targets-move", pts });
      else if (mainAnim && mainAnim.targets && mainAnim.targets.length === pts.length) {
        for (let i = 0; i < pts.length; i++) {
          mainAnim.targets[i].x = pts[i].x;
          mainAnim.targets[i].y = pts[i].y;
        }
      }
    };
    const cancelAnim = () => {
      if (worker) worker.postMessage({ type: "cancel" });
      if (mainRaf) cancelAnimationFrame(mainRaf);
      if (mainCtx) mainCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      mainAnim = null;
    };

    // a transition can't survive the tab being hidden: rAF pauses (worker
    // included), timers desync, and the resume state is garbage. Abort to the
    // finished state instantly instead — set by runTransition per transition.
    let abortCurrent = null;
    // once the destination has revealed, the lingering dot ride is
    // interruptible: a new nav click aborts it and transitions normally
    let rideOnly = false;
    const onVisibility = () => {
      if (document.hidden && abortCurrent) abortCurrent();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ── the transition itself ──
    const revealMain = (main) => {
      main.style.visibility = "";
      main.style.opacity = "0";
      main.style.transition = "opacity 0.22s ease";
      requestAnimationFrame(() => {
        main.style.opacity = "1";
        setTimeout(() => {
          main.style.transition = "";
          main.style.opacity = "";
        }, 280);
      });
    };

    const runTransition = (path) => {
      const main = document.querySelector(".App-main");
      if (!main) {
        navigateRef.current(path);
        return;
      }
      // the illumination reveal carries the effect now — half the dots suffice
      const budget = Math.min(
        750,
        Math.round((window.innerWidth * window.innerHeight) / 1500)
      );
      const starts = samplePoints(main, budget, "text");
      if (starts.length < 8) {
        navigateRef.current(path);
        return;
      }

      busyRef.current = true;
      rideOnly = false;
      main.style.visibility = "hidden";
      let finished = false;
      let revealed = false;
      let trackTimer = null;

      const reveal = () => {
        if (revealed) return;
        revealed = true;
        rideOnly = true; // page is up — what remains is interruptible eye-candy
        const m = document.querySelector(".App-main");
        // in cover mode the page is already visible under the cover — only
        // fade it in if something left it hidden (bail / fallback paths)
        if (m && m.style.visibility === "hidden") revealMain(m);
      };
      const done = () => {
        if (finished) return;
        finished = true;
        if (trackTimer) {
          clearInterval(trackTimer);
          trackTimer = null;
        }
        reveal();
        busyRef.current = false;
        clearTimeout(safety);
        abortCurrent = null;
      };
      onReveal = reveal;
      onDone = done;
      abortCurrent = () => {
        arrivedRef.current = null; // pending sampling must not re-hide the page
        cancelAnim(); // clears the canvas — dots AND the reveal cover
        done();
      };
      // belt-and-braces: the page must reveal even if the worker misbehaves.
      // Must outlast the FULL timeline (incl. tracking) or it fires mid-run
      // and nulls the abort handle while dots are still on screen.
      const safety = setTimeout(
        done,
        BAIL_MS + HOME_MS + STAGGER_MS + FADE_MS + 800
      );

      startAnim(makeDotData(starts));

      arrivedRef.current = () => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            setTimeout(() => {
              const m = document.querySelector(".App-main");
              if (!m || finished) return;
              m.style.visibility = "hidden"; // same node, but be explicit
              const handles = samplePoints(m, starts.length, "text");
              // the page will sit under an opaque cover that landing dots
              // punch light into — match the app's backdrop color
              let bg = getComputedStyle(document.body).backgroundColor;
              if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent")
                bg = "#0a0d13";
              const cover = {
                top: Math.max(0, Math.round(m.getBoundingClientRect().top)),
                color: bg,
              };
              // unhide beneath the cover only once it is actually painted —
              // the worker acks after its first cover frame (no flash)
              const unhide = () => {
                if (!finished) m.style.visibility = "";
              };
              if (worker) {
                onCoverReady = unhide;
                setTimeout(unhide, 400); // belt-and-braces if the ack is lost
              }
              sendTargets(
                handles.length
                  ? handles.map((p) => ({ x: p.x, y: p.y, c: p.c }))
                  : [{ x: window.innerWidth / 2, y: window.innerHeight / 2 }],
                cover
              );
              if (!worker) {
                // fallback renders on this thread — cover paints next frame
                requestAnimationFrame(() => requestAnimationFrame(unhide));
              }
              if (!handles.length) return;
              // ride along: re-resolve every handle's live position while the
              // destination animates (Skills' drifting nodes, reveal effects)
              trackTimer = setInterval(() => {
                if (finished) {
                  clearInterval(trackTimer);
                  trackTimer = null;
                  return;
                }
                for (const h of handles) resolveHandle(h);
                sendTargetsMove(handles.map((p) => ({ x: p.x, y: p.y })));
              }, TRACK_POLL_MS);
              setTimeout(() => {
                if (trackTimer) {
                  clearInterval(trackTimer);
                  trackTimer = null;
                }
              }, HOME_MS + STAGGER_MS + FADE_MS + 300);
            }, SETTLE_MS)
          )
        );
      };
      navigateRef.current(path);
    };

    const onClick = (e) => {
      if (busyRef.current) {
        // mid-ride (page already revealed): abort the leftovers and let this
        // click start a fresh transition. Mid-flight: swallow the click.
        if (rideOnly && abortCurrent) abortCurrent();
        else return;
      }
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = e.target.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url;
      try {
        url = new URL(a.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const path = url.pathname;
      if (!SPA_PATHS.has(path)) return;
      if (path === locationRef.current.pathname) return;
      // touch / small screens / reduced motion: plain navigation
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(pointer: coarse)").matches ||
        window.innerWidth <= 640
      )
        return;

      e.preventDefault();
      e.stopPropagation();
      runTransition(path);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", sizeCanvas);
      cancelAnim();
      if (worker) worker.terminate();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
