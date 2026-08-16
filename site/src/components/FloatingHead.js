import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import "./FloatingHead.css";
/* Hand-painted point regions (eyes, mouth seam, jaw) exported from
   point-picker.html. Regenerate with `node serve-picker.mjs` after any change
   to head-points.bin - the indices are only valid for the sampling they were
   painted on, which is why load() checks pointCount before using them. */
import headRegions from "./headRegions.json";

/**
 * A 3D portrait rendered as a cloud of ember-coloured points, parked in the
 * middle of the landing card grid. It looks toward the cursor, eases back to
 * facing forward when left alone, takes on a card's accent while that card is
 * hovered, and opens into a lightbox with the chat.
 *
 * Geometry is a pre-sampled point cloud (see build-head-points.mjs) with a
 * 4-colour posterised tone baked per point from the model's own texture.
 * Points carry normals so the shader can fade the ones facing away; without
 * that a point cloud reads as a transparent blob.
 *
 * One WebGL context lives for the lifetime of the component; the canvas is
 * re-parented (not recreated) when the lightbox opens.
 */

const EMBERS = [
  [255, 114, 161], // pink
  [180, 139, 255], // purple
  [127, 211, 255], // blue
  [120, 255, 168], // green
];

// Tone ramp for the four posterised buckets, darkest to lightest. Hue alone
// carries no shading — dimming the dark buckets is what makes eye sockets,
// brows and hairline read as features instead of noise.
const TONE = [0.4, 0.72, 1.0, 1.35];

// Landing card accents, keyed by the card ids Landing.js uses.
const CARD_TINT = {
  1: [1.0, 0.45, 0.63], // Skills
  2: [0.71, 0.55, 1.0], // Projects
  3: [0.5, 0.83, 1.0], // About
  4: [0.47, 1.0, 0.66], // Resume
};

/* When the page's attention is on something else (the contribution grid), the
   head goes with it: a soft off-white, deliberately shy of pure. */
const ATTEND_TINT = [0.93, 0.95, 1.0];

// The canvas is deliberately larger than the button so the head can wobble and
// turn without being clipped by its own box; the overflow is pointer-transparent.
// The canvas is drawn larger than its button so the head can turn and wobble
// without clipping; it is pointer-transparent. Both scale together, which is
// why the camera distance is a constant — the head keeps the same proportion
// of the button at every breakpoint.
const CANVAS_SCALE = 3.6;
const MINI_Z = 9.4;
const MINI_POINTS = 9000;

// The head starts watching the cursor once it comes within 1.5x the radius of
// the ring the background embers orbit at (90px in BgVariantB). Scaled down
// with the portrait so it stays proportionate on small layouts.
const GAZE_RADIUS_BASE = 135;

const POINT_COUNT = 4200; // procedural stand-in only
const POINTS_URL = process.env.PUBLIC_URL + "/head-points.bin";
/* the TRUE head surface, decimated and registered into the cloud's exact
   frame by build-head-shell.mjs (median registration residual ~0.009 in
   cloud units - a quarter of the dot spacing). Drawn depth-only, it makes
   the cloud self-occlude like the solid head it samples. */
const SHELL_URL = process.env.PUBLIC_URL + "/head-shell.bin";

/* The deployed worker is the default so the chat works everywhere without a
   build-time variable — `npm start`, a bare `npm run build`, a fresh clone.
   Missing the variable used to hide the whole chat block, input bar included,
   with no visible error. REACT_APP_CHAT_ENDPOINT still overrides it (point it
   at `npm run chat:local` to develop against a local worker; set it empty to
   render the portrait with no chat at all). Not a secret: the worker only
   answers requests whose Origin it recognises, and the keys live in
   Cloudflare. */
const CHAT_LOG_KEY = "fh-chat-log";

/* Typed into the empty input as a cycling ghost placeholder - questions the
   bot genuinely answers well, so the suggestion is also a promise kept. */
/* said when the visitor hand-spins the head hard enough - no dot-tracking
   needed, the drag deltas already flow through one number (s.spin), so an
   accumulator with a slow leak and a cooldown is the whole detector */
const SHAKE_LINES = [
  "Stop shaking me, please.",
  "Hey - careful, you'll knock the dots off.",
  "I'm a head, not a snow globe.",
  "Rattling. I am rattling.",
];

const DIZZY_LINES = [
  "Okay - I'm getting dizzy.",
  "The room is spinning. I am the room.",
  "Easy. I just got these dots lined up.",
  "Wheee. Right, that's plenty.",
];

/* closers for the ghost trick's re-solidify moment - page-timed (the model
   has long finished by then), varied because sameness reads as canned */
const SOLID_LINES = [
  "...and I'm solid again. That's the whole act.",
  "...and back to solid. Matter suits me better.",
  "...aaand I've re-materialised. Encores cost extra.",
  "...solid again. The dots missed each other.",
];

const GHOST_QUESTIONS = [
  "do you design websites?",
  "have you managed databases?",
  "do you build mobile apps?",
  "have you worked with LLMs?",
  "do a trick",
  "are you available for contract work?",
  "what stack do you usually reach for?",
  "how many projects have you shipped?",
  "become a ghost",
  "what are you looking for next?",
  "do you like teaching?",
  "can you work in the UK?",
  "do a spin",
  "why is your head made of dots?",
  "breathe fire",
  "what is SPIM?",
  "go blue",
];

const DEFAULT_CHAT_ENDPOINT = "https://hyder-chat.hmohyud.workers.dev";
const CHAT_ENDPOINT =
  process.env.REACT_APP_CHAT_ENDPOINT === undefined
    ? DEFAULT_CHAT_ENDPOINT
    : process.env.REACT_APP_CHAT_ENDPOINT;

/* ---------- procedural stand-in ---------- */

function shapeHead(x, y, z) {
  y *= 1.3;
  if (z < 0) z *= 0.88;
  if (y < -0.35) {
    const t = Math.min(1, (-y - 0.35) / 0.75);
    const k = 1 - 0.45 * t * t;
    x *= k;
    z *= k;
  }
  if (y > 0.75) {
    const t = (y - 0.75) / 0.55;
    const k = 1 - 0.25 * t * t;
    x *= k;
    z *= k;
  }
  const nose = Math.exp(-((x * x) / 0.01 + ((y - 0.02) * (y - 0.02)) / 0.025));
  if (z > 0) z += 0.3 * nose;
  return [x, y, z];
}

function proceduralPoints(count) {
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const nx = r * Math.cos(th);
    const nz = r * Math.sin(th);
    const p = shapeHead(nx, u, nz);
    position[i * 3] = p[0];
    position[i * 3 + 1] = p[1];
    position[i * 3 + 2] = p[2];
    normal[i * 3] = nx;
    normal[i * 3 + 1] = u;
    normal[i * 3 + 2] = nz;
  }
  return { position, normal };
}

/* ---------- sprite + shader ---------- */

function makeSprite() {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.75)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

/* Blink ellipsoids, derived from the painted eye regions. The paint marks the
   visible eyeball; the pads stretch each radius so the lids and a little brow
   come along, since a blink that only moves the eyeball line reads as a squint.
   The lid line each eye collapses toward sits just below the eye's centre. */
const eyeParams = (r) => {
  const c = r.center;
  const rad = [r.halfExtents[0] * 1.35, r.halfExtents[1] * 2.3, r.halfExtents[2] * 2.0];
  return { c, rad, lid: c[1] - 0.35 * rad[1] };
};
const EYE_L = eyeParams(headRegions.regions.eyeScreenLeft);
const EYE_R = eyeParams(headRegions.regions.eyeScreenRight);
/* While talking, the painted mouth-seam area glows with the speech envelope -
   on an additive point cloud, light reads as voice far better than mechanics
   do. The ellipsoid is the painted seam, padded tall so both lips catch it. */
const MOUTH_GLOW = (() => {
  const m = headRegions.regions.mouth;
  return {
    c: m.center,
    r: [m.halfExtents[0] * 1.25, m.halfExtents[1] * 3.0, m.halfExtents[2] * 1.8],
  };
})();
const LIP_GAP = 0.10; // how far the lower lip drops at uMouth = 1
const MOUTH_CX = headRegions.regions.mouth.center[0];
const MOUTH_X0 = headRegions.regions.mouth.min[0];
const MOUTH_X1 = headRegions.regions.mouth.max[0];

/* Two-letter sounds that deserve one mouth shape instead of two quick ones -
   "th" is in the most common word in the language. Consumed with a lookahead. */
const DIGRAPHS = {
  sh: [0.28, 0.72, 95], ch: [0.25, 0.88, 85], th: [0.3, 1.1, 80],
  ph: [0.12, 1.1, 70], wh: [0.3, 0.65, 85], qu: [0.3, 0.75, 85],
  ee: [0.38, 1.32, 110], oo: [0.5, 0.6, 110],
};

/* ---------- jibberish voice ----------
   Animalese / Hollow-Knight-style: a tiny pitched blip per viseme step,
   synthesised from nothing - no assets, no TTS, and perfectly in sync with
   the mouth because the same sequencer step fires both. Vowels are low and
   round, sibilants chirp high, plosives are short ticks, and spaces and
   punctuation are the rests. Each reply picks a slightly different base
   pitch so answers do not all sound identical. */
let audioCtx = null;
const ensureAudio = () => {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
};
const BLIP_PITCH = {
  a: 200, e: 250, i: 300, o: 168, u: 148,
  m: 140, n: 150,
  s: 900, z: 850, f: 800, c: 760, x: 780,
  t: 520, d: 480, k: 540, g: 460, p: 500, b: 440, q: 520,
  l: 260, r: 240, w: 190, y: 280, h: 230, j: 300, v: 320,
  sh: 700, ch: 640, th: 300, ph: 800, wh: 190, qu: 400, ee: 310, oo: 150,
};
function speakBlip(key, base) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const f0 = BLIP_PITCH[key];
  if (!f0) return; // spaces and punctuation are the rests
  const plosive = key.length === 1 && "tdkgpbq".indexOf(key) >= 0;
  const dur = plosive ? 0.035 : key.length > 1 ? 0.09 : 0.07;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = "triangle";
  const f = f0 * base * (0.94 + Math.random() * 0.12);
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f * 0.8, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(plosive ? 0.05 : 0.09, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/* Letter-class visemes: [openness, width, duration ms]. The reply text is the
   ground truth for what the head is "saying", so the mouth is shaped per
   character class at speaking pace - open for vowels, rounded (width < 1) for
   o/u/w, spread (width > 1) for e/i/s, fully closed for the bilabials m/b/p,
   longer closures on punctuation. Letter-level approximation, not phonemes,
   but at dot resolution the closures and the rounding are what read. */
const VISEMES = {
  a: [0.85, 1.0, 78], e: [0.5, 1.25, 70], i: [0.38, 1.3, 66],
  o: [0.7, 0.7, 84], u: [0.42, 0.6, 84],
  m: [0.03, 1.0, 70], b: [0.04, 1.0, 62], p: [0.04, 1.0, 62],
  f: [0.12, 1.12, 64], v: [0.12, 1.12, 64], w: [0.3, 0.62, 76],
  s: [0.16, 1.18, 70], z: [0.16, 1.15, 64], c: [0.2, 1.1, 62],
  t: [0.2, 1.05, 55], d: [0.22, 1.05, 55], n: [0.18, 1.05, 55],
  l: [0.28, 1.08, 60], r: [0.3, 0.9, 62],
  g: [0.32, 0.95, 60], k: [0.3, 0.95, 60], q: [0.3, 0.8, 64],
  j: [0.26, 1.1, 62], y: [0.3, 1.15, 62], h: [0.32, 1.0, 55], x: [0.2, 1.1, 62],
  " ": [0.06, 1.0, 95], "\n": [0.04, 1.0, 130],
  ".": [0.02, 1.0, 300], ",": [0.05, 1.0, 180], "!": [0.02, 1.0, 300],
  "?": [0.02, 1.0, 300], ";": [0.03, 1.0, 220], ":": [0.04, 1.0, 200],
};
const VISEME_OTHER = [0.3, 1.0, 62];

/* Digits had no viseme class and no pitch, so numbers played as silence with
   a generic mouth. Spoken as their names instead: the word is spliced into
   the talk buffer in place of the digit, and the ordinary letter machinery -
   visemes, lip width, blips - does the rest. Multi-digit numbers read
   digit-by-digit, which suits the voice. */
const DIGIT_WORDS = {
  0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
  5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
};

const g4 = (v) => v.toFixed(4);
const gv3 = (a) => `vec3(${g4(a[0])}, ${g4(a[1])}, ${g4(a[2])})`;

const VERT = `
attribute vec3 aColor;
attribute float aJaw;
uniform float uSize;
uniform float uDpr;
uniform float uBlink;
uniform float uMouth;
uniform float uMouthW;
uniform float uRegions;
varying vec3 vColor;
varying float vFacing;
varying float vGlow;
varying float vKey;

float eyeW(vec3 p, vec3 c, vec3 r) {
  return 1.0 - smoothstep(0.45, 1.0, length((p - c) / r));
}

void main() {
  vColor = aColor;
  vGlow = 0.0;
  vec3 p = position;
  /* uRegions gates on the real head: the procedural stand-in shares this
     shader, and without the gate a blink would dent a random patch of it. */
  if (uRegions > 0.5) {
    p.y = mix(p.y, ${g4(EYE_L.lid)}, eyeW(p, ${gv3(EYE_L.c)}, ${gv3(EYE_L.rad)}) * uBlink);
    p.y = mix(p.y, ${g4(EYE_R.lid)}, eyeW(p, ${gv3(EYE_R.c)}, ${gv3(EYE_R.rad)}) * uBlink);
    /* talk: the lips part locally. aJaw is a signed weight baked around the
       painted mouth seam - negative just below it (lower lip, drops), a
       smaller positive just above (upper lip, lifts) - fading out at the
       corners and within a short distance of the seam. The opening lives at
       the mouth and nowhere else; the jaw and chin do not move at all. */
    p.y += uMouth * ${g4(LIP_GAP)} * aJaw;
    /* width channel, corner-weighted: real lips round and spread from the
       CORNERS - the centre barely travels, so a uniform horizontal scale
       reads as the mouth shrink-wrapping. Rounding also puckers the lips
       forward (+z) and spreading flattens them back; that depth cue is most
       of what makes an "oo" look like an "oo". */
    float wLip = smoothstep(0.02, 0.2, abs(aJaw));
    float uAx = clamp((2.0 * p.x - (${g4(MOUTH_X0)}) - (${g4(MOUTH_X1)})) / ${g4(MOUTH_X1 - MOUTH_X0)}, -1.0, 1.0);
    float cornerW = smoothstep(0.1, 0.85, abs(uAx));
    p.x += (p.x - (${g4(MOUTH_CX)})) * (uMouthW - 1.0) * 0.6 * wLip * cornerW;
    p.z += (1.0 - uMouthW) * 0.1 * wLip;
    vGlow = uMouth * (1.0 - smoothstep(0.35, 1.0, length((p - ${gv3(MOUTH_GLOW.c)}) / ${gv3(MOUTH_GLOW.r)})));
  }
  /* distance from the crown: the colour trick's wash sweeps this field,
     so the tint pours down over the head instead of switching on */
  vKey = length(p - vec3(0.0, 1.35, 0.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = smoothstep(-0.35, 0.55, n.z);
  /* speaking dots swell with the glow - additive sprites overlap and fuse,
     so the moving lip reads as a continuous band instead of separate dots */
  gl_PointSize = ((uSize * uDpr) / max(0.001, -mv.z)) * (1.0 + 0.4 * vGlow);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = [
  "uniform sampler2D uMap;",
  "uniform vec3 uTint;",
  "uniform float uTintMix;",
  "uniform float uTintEdge;",
  "uniform float uGhost;",
  "varying vec3 vColor;",
  "varying float vFacing;",
  "varying float vGlow;",
  "varying float vKey;",
  "void main() {",
  "  vec4 t = texture2D(uMap, gl_PointCoord);",
  // the back-face floor RISES while ghosted: the trick is showing the far
  // side, and at the solid-state floor of 2% there would be nothing to see
  "  float fl = 0.02 + 0.35 * uGhost;",
  "  float a = t.a * (fl + (1.0 - fl) * vFacing);",
  "  if (a < 0.012) discard;",
  // keep each point's own brightness when tinting, so the shading survives
  "  float lum = max(max(vColor.r, vColor.g), vColor.b);",
  // wave front: dots the sweep has passed are tinted, dots ahead are not;
  // the hover tint parks the edge at 99 so it covers instantly as before
  "  float wave = 1.0 - smoothstep(uTintEdge - 0.35, uTintEdge + 0.05, vKey);",
  "  vec3 col = mix(vColor, uTint * lum, uTintMix * wave);",
  "  col *= 1.0 + 1.35 * vGlow;",
  "  gl_FragColor = vec4(col, a);",
  "}",
].join("\n");

/* ---------- component ---------- */

function detectMode() {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w <= 640) return "phone";
  if (w <= 1050) return "tablet";
  return "desktop";
}

export default function FloatingHead({
  hoveredCard = null,
  onHoverChange,
  lookTarget = null,
  fabOnly = false,
}) {
  const [mode, setMode] = useState(() => (fabOnly ? "phone" : detectMode()));
  const [missionEl, setMissionEl] = useState(null);
  const miniRef = useRef(null);
  const stageRef = useRef(null);
  const overlayRef = useRef(null);
  const askRef = useRef(null);
  const worldRef = useRef(null);
  const stateRef = useRef({
    open: false,
    spin: 0,
    targetX: 0,
    targetY: 0,
    rotX: 0,
    rotY: 0,
    dragging: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
    reduced: false,
    tint: [1, 1, 1],
    tintMix: 0,
    wantTint: null,
    hovering: false,
  });
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // Phone gets a plain button instead of a WebGL portrait, so the scene is
  // only built there once the lightbox is actually opened.
  const needsScene = mode !== "phone" || open;
  const [capable, setCapable] = useState(true);
  /* The transcript survives a reload. Written only when a reply has finished,
     so streaming does not hammer localStorage a chunk at a time, and trimmed to
     the last 40 turns so a long session cannot fill the quota. */
  const [msgs, setMsgs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((m) => m && m.role && m.content) : [];
    } catch (err) {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (busy) return;
    try {
      if (msgs.length) localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(msgs.slice(-40)));
      else localStorage.removeItem(CHAT_LOG_KEY);
    } catch (err) {
      // private mode, or the quota is full: the chat still works, it just forgets
    }
  }, [msgs, busy]);

  /* Typewriter placeholder: types a sample question, holds, backspaces, moves
     to the next. It drives the placeholder ATTRIBUTE directly - no re-renders,
     and the browser itself guarantees the "only when the field is empty" rule,
     since a placeholder is never shown over typed text. Skipped under
     prefers-reduced-motion; the static prompt stays. */
  useEffect(() => {
    if (!open || !CHAT_ENDPOINT) return undefined;
    const input = inputRef.current;
    if (!input) return undefined;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return undefined;
    let alive = true;
    let timer;
    let qi = Math.floor(Math.random() * GHOST_QUESTIONS.length);
    let pos = 0;
    let deleting = false;
    const tick = () => {
      if (!alive) return;
      const q = GHOST_QUESTIONS[qi];
      if (!deleting) {
        pos += 1;
        input.placeholder = q.slice(0, pos);
        if (pos >= q.length) {
          deleting = true;
          timer = setTimeout(tick, 7800); // hold the finished question a good while before cycling
          return;
        }
        timer = setTimeout(tick, 62 + Math.random() * 58);
      } else {
        pos -= 3;
        if (pos <= 0) {
          pos = 0;
          deleting = false;
          qi = (qi + 1) % GHOST_QUESTIONS.length;
          input.placeholder = "";
          timer = setTimeout(tick, 400);
          return;
        }
        input.placeholder = q.slice(0, pos);
        timer = setTimeout(tick, 26);
      }
    };
    timer = setTimeout(tick, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
      input.placeholder = "Ask me about my work";
    };
  }, [open]);

  /* corner shows a subset; the lightbox shows every point */
  const applyDrawRange = useCallback(() => {
    const world = worldRef.current;
    if (!world || !world.total) return;
    const shown = stateRef.current.open
      ? world.total
      : Math.min(world.total, MINI_POINTS);
    world.points.geometry.setDrawRange(0, shown);
  }, []);
  const drawRangeRef = useRef(applyDrawRange);
  drawRangeRef.current = applyDrawRange;

  useEffect(() => {
    if (fabOnly) return undefined;
    const onResize = () => setMode(detectMode());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fabOnly]);

  /* Tablet: sit inside the description so the copy wraps around the portrait.
     A portal appends, so a float would land after the text — we insert our own
     slot as the paragraph's first child and portal into that instead. */
  useEffect(() => {
    if (mode !== "tablet") {
      setMissionEl(null);
      return undefined;
    }
    const mission = document.querySelector(".landing .mission");
    if (!mission) return undefined;
    const slot = document.createElement("span");
    slot.className = "fh-slot";
    mission.insertBefore(slot, mission.firstChild);
    setMissionEl(slot);
    return () => {
      setMissionEl(null);
      if (slot.parentNode) slot.parentNode.removeChild(slot);
    };
  }, [mode]);

  /* scene setup */
  useEffect(() => {
    if (!needsScene) return undefined;
    const mini = miniRef.current || stageRef.current;
    if (!mini) return undefined;

    const st = stateRef.current;
    st.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    } catch (err) {
      setCapable(false);
      return undefined;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    const canvas = renderer.domElement;
    canvas.className = "fh-canvas";
    mini.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 3.6);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeSprite() },
        uSize: { value: 8 },
        uDpr: { value: dpr },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTintMix: { value: 0 },
        uTintEdge: { value: 99 },
        uGhost: { value: 0 },
        uBlink: { value: 0 },
        uMouth: { value: 0 },
        uMouthW: { value: 1 },
        uRegions: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    /* invisible, depth-only; opaque, so three.js renders it before the
       additive pass. DoubleSide: the far hemisphere is deeper and always
       loses the depth test, so winding never matters. */
    const shellMaterial = new THREE.ShaderMaterial({
      /* slope-scaled offset on top of the constant view-space bias below -
         handles grazing angles the constant term cannot (shadow-bias lesson) */
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      /* the shell IS the surface the dots sit on, so it is pushed back in
         view space; 0.06 clears crease walls at grazing angles while staying
         far under the ~0.3 chin-to-neck gap. It is a UNIFORM because the
         ghost trick eases it: sliding the shell far behind the head makes
         hidden dots reappear nearest-first - a visible depth peel rather
         than a snap. */
      uniforms: { uShellBias: { value: 0.06 } },
      vertexShader:
        "uniform float uShellBias; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.z -= uShellBias; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "void main(){ gl_FragColor = vec4(0.0); }",
      colorWrite: false,
      depthWrite: true,
    });

    /* ---- fire breath ----
       ~550 additive embers streamed from the painted mouth position, living
       in the head's group so the plume aims wherever the head faces. CPU-
       updated only while a breath is live; parked black-at-origin otherwise,
       which under additive blending is invisible and costs one draw call of
       nothing. Dead particles fade THROUGH the fire ramp (yellow - orange -
       red - black), so extinguishing is the same thing as disappearing. */
    const FIRE_N = 550;
    const firePos = new Float32Array(FIRE_N * 3);
    const fireCol = new Float32Array(FIRE_N * 3);
    const fireVel = new Float32Array(FIRE_N * 3);
    const fireLife = new Float32Array(FIRE_N);
    const fireMax = new Float32Array(FIRE_N);
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute("position", new THREE.BufferAttribute(firePos, 3));
    fireGeo.setAttribute("color", new THREE.BufferAttribute(fireCol, 3));
    const fireTex = makeSprite();
    const fireMat = new THREE.PointsMaterial({
      map: fireTex,
      size: 0.11,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    /* parked particles must live OFF-FRUSTUM, not merely black: on a
       transparent canvas an additive black point still writes destination
       alpha and punches a dark hole in the page behind the canvas */
    for (let i = 0; i < FIRE_N; i++) firePos[3 * i + 1] = -9999;
    const firePoints = new THREE.Points(fireGeo, fireMat);
    firePoints.frustumCulled = false;
    group.add(firePoints);
    let fireCursor = 0;
    let fireBudget = 0;
    /* tuning hooks: __fhU exposes the uniforms, __fhSay feeds text into the
       viseme sequencer without spending an API call */
    window.__fhU = material.uniforms;
    window.__fhG = group; // rotation inspection for tuning
    window.__fhS = stateRef.current; // gaze-state inspection for tuning
    window.__fhSay = (txt) => {
      ensureAudio();
      stateRef.current.talkBuf = (stateRef.current.talkBuf || "") + String(txt);
    };

    let shellMesh = null;
    const load = (data) => {
      geometry.setAttribute("position", new THREE.BufferAttribute(data.position, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(data.normal, 3));
      const n = data.position.length / 3;

      /* Signed per-point talk weight around the painted mouth seam.
         The seam dots are brush strokes, so using them raw makes the split
         line a staircase of nearest-dot steps - instead a least-squares
         quadratic is fitted through them, which keeps the seam's real curve
         while averaging the brush noise away. The corner tapers anchor at the
         seam's painted END points, not its mean - the paint is denser on one
         side, and a mean-centred taper is what made the gap lopsided.
         The opening's height follows an elliptical arch across the width -
         sqrt(1 - u^2), full at the centre, closing to points at the corners -
         so the gap is a vesica piscis rather than a slot: a constant-height
         gap with end-caps reads as a rectangle, not a mouth.
         Weights: -1 just below the curve (lower lip, drops), +0.35 just
         above (upper lip, lifts), scaled by the arch, gated away from the
         face's front, and fading within ~0.28 below / ~0.14 above. */
      const jawW = new Float32Array(n);
      let hasRegions = 0;
      if (n === headRegions.pointCount) {
        hasRegions = 1;
        const sm = (a, b, v) => {
          const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
          return t * t * (3 - 2 * t);
        };
        const m = headRegions.regions.mouth;
        let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
        const k = m.indices.length;
        for (const si of m.indices) {
          const X = data.position[si * 3];
          const Y = data.position[si * 3 + 1];
          const X2 = X * X;
          Sx += X; Sx2 += X2; Sx3 += X2 * X; Sx4 += X2 * X2;
          Sy += Y; Sxy += X * Y; Sx2y += X2 * Y;
        }
        const A = [[k, Sx, Sx2], [Sx, Sx2, Sx3], [Sx2, Sx3, Sx4]];
        const B = [Sy, Sxy, Sx2y];
        const det3 = (M) =>
          M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
          M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
          M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
        const D = det3(A) || 1;
        const rep = (M, c, v) => M.map((row, r) => row.map((val, cc) => (cc === c ? v[r] : val)));
        let q0 = det3(rep(A, 0, B)) / D;
        let q1 = det3(rep(A, 1, B)) / D;
        let q2 = det3(rep(A, 2, B)) / D;
        const x0 = m.min[0];
        const x1 = m.max[0];
        /* Expression control: the painted seam droops a little at the corners,
           and an opening whose midline droops reads as a frown on every word.
           Clamp the fitted curvature so the corners sit at worst level with
           the centre and at best a touch above - neutral to slight smile. The
           correction is anchored at the centre (adds zero there), so the gap
           stays on the painted seam where it is widest; the corners drift up
           at most ~0.02, where the arch has already closed the gap anyway. */
        const halfW = (x1 - x0) / 2;
        const cornerLift = q2 * halfW * halfW;   // corner height minus centre
        const target = Math.max(cornerLift, 0.018);
        const dq2 = (target - cornerLift) / (halfW * halfW);
        const xc = (x0 + x1) / 2;
        q0 += dq2 * xc * xc;
        q1 -= 2 * dq2 * xc;
        q2 += dq2;
        for (let i = 0; i < n; i++) {
          const x = data.position[i * 3];
          const y = data.position[i * 3 + 1];
          const z = data.position[i * 3 + 2];
          const u = (2 * x - x0 - x1) / (x1 - x0);
          const arch = Math.sqrt(Math.max(0, 1 - u * u));
          const gz = sm(0.4, 0.62, z);
          const g = arch * gz;
          if (g <= 0) continue;
          const cx = Math.min(x1, Math.max(x0, x));
          const dy = y - (q0 + q1 * cx + q2 * cx * cx);
          jawW[i] =
            g *
            (dy <= 0
              ? -(1 - sm(0.06, 0.3, -dy))
              : 0.35 * (1 - sm(0.04, 0.16, dy)));
        }
      }
      geometry.setAttribute("aJaw", new THREE.BufferAttribute(jawW, 1));
      material.uniforms.uRegions.value = hasRegions;
      const colors = new Float32Array(n * 3);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const y = data.position[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const span = Math.max(1e-6, maxY - minY);
      for (let i = 0; i < n; i++) {
        const idx = data.colorIndex
          ? data.colorIndex[i]
          : Math.floor(((data.position[i * 3 + 1] - minY) / span) * EMBERS.length);
        const safe = Math.max(0, Math.min(EMBERS.length - 1, idx));
        const rgb = EMBERS[safe];
        const j = (0.9 + Math.random() * 0.2) * (data.colorIndex ? TONE[safe] : 1);
        colors[i * 3] = Math.min(1, (rgb[0] / 255) * j);
        colors[i * 3 + 1] = Math.min(1, (rgb[1] / 255) * j);
        colors[i * 3 + 2] = Math.min(1, (rgb[2] / 255) * j);
      }
      geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
    };
    load(proceduralPoints(POINT_COUNT));

    const points = new THREE.Points(geometry, material);
    group.add(points);


    worldRef.current = {
      renderer, scene, camera, group, points, material, canvas, total: 0,
    };
    setReady(true);

    /* swap in the real head once its point cloud arrives */
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(POINTS_URL);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (cancelled || buf.byteLength < 12) return;
        const view = new DataView(buf);
        const magic =
          String.fromCharCode(view.getUint8(0)) +
          String.fromCharCode(view.getUint8(1)) +
          String.fromCharCode(view.getUint8(2)) +
          String.fromCharCode(view.getUint8(3));
        if (magic !== "HDP3") return;

        const n = view.getUint32(4, true);
        const quant = view.getFloat32(8, true) || 12000;
        const packedPos = new Int16Array(buf, 12, n * 3);
        const packedNrm = new Int8Array(buf, 12 + n * 6, n * 3);
        const colorIndex = new Uint8Array(buf, 12 + n * 9, n);

        const pos = new Float32Array(n * 3);
        const nrm = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) {
          pos[i] = packedPos[i] / quant;
          nrm[i] = packedNrm[i] / 127;
        }
        load({ position: pos, normal: nrm, colorIndex });
        if (worldRef.current) {
          worldRef.current.total = n;
          drawRangeRef.current();
        }
      } catch (err) {
        /* stand-in head stays */
      }
    })();

    /* exact-surface occlusion shell - fetched separately, so a miss just
       means no occlusion, never a broken head */
    (async () => {
      try {
        const res = await fetch(SHELL_URL);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (cancelled || buf.byteLength < 16) return;
        const view = new DataView(buf);
        const magic =
          String.fromCharCode(view.getUint8(0)) +
          String.fromCharCode(view.getUint8(1)) +
          String.fromCharCode(view.getUint8(2)) +
          String.fromCharCode(view.getUint8(3));
        if (magic !== "HSH2") return;
        const vCount = view.getUint32(4, true);
        const iCount = view.getUint32(8, true);
        const quant = view.getFloat32(12, true) || 12000;
        const packed = new Int16Array(buf, 16, vCount * 3);
        const verts = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount * 3; i++) verts[i] = packed[i] / quant;
        const IndexArr = vCount >= 65536 ? Uint32Array : Uint16Array;
        const idxOff = 16 + vCount * 6;
        const idx = new IndexArr(iCount);
        for (let i = 0; i < iCount; i++) {
          idx[i] = vCount >= 65536
            ? view.getUint32(idxOff + i * 4, true)
            : view.getUint16(idxOff + i * 2, true);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        if (shellMesh) {
          group.remove(shellMesh);
          shellMesh.geometry.dispose();
        }
        shellMesh = new THREE.Mesh(geo, shellMaterial);
        group.add(shellMesh);
        if (worldRef.current) worldRef.current.shell = shellMesh;
      } catch (err) {
        /* no shell = no occlusion; the head still renders */
      }
    })();

    /* render loop, with a capability check over the first second of frames */
    let raf = 0;
    let last = 0;
    let firstFrameT = 0;
    const samples = [];
    let judged = window.__fhNoGuard === true;
    const RETURN = 0.9; // how firmly it eases back to facing forward
    const sstep = (x) => x * x * (3 - 2 * x);
    let rectCalm = 0;
    const rectify = (v, dir) => {
      if (rectCalm <= 0.001 || dir === 0) return v * (1 - 0.5 * rectCalm);
      return v * (v * dir < 0 ? 1 - 0.88 * rectCalm : 1 - 0.5 * rectCalm);
    };

    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (!firstFrameT) firstFrameT = t;
      if (document.hidden) {
        last = t;
        return;
      }
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;

      if (last && !judged && t - firstFrameT > 900) {
        /* the first ~0.9s after a scene build is layout/upload jank on even
           strong devices - judging it would condemn capable phones on the
           overlay-open transition */
        samples.push(t - last);
        if (samples.length >= 70) {
          const sorted = samples.slice().sort((a, b) => a - b);
          judged = true;
          // ~18fps or worse: this machine should not spend frames on a
          // decorative portrait, so remove it rather than stutter the page
          if (sorted[Math.floor(sorted.length / 2)] > 55) {
            cancelAnimationFrame(raf);
            setCapable(false);
            return;
          }
        }
      }
      last = t;

      const s = stateRef.current;
      if (s.spinFeed) {
        // the spin trick's wind-up: smoothstepped delivery of the impulse
        const f = s.spinFeed;
        const p0 = sstep(Math.min(1, f.t / f.dur));
        f.t += dt;
        const p1 = sstep(Math.min(1, f.t / f.dur));
        s.spin += f.total * (p1 - p0);
        if (f.t >= f.dur) s.spinFeed = null;
      }
      if (!s.dragging) {
        // ease back toward forward instead of spinning indefinitely - under
        // reduced motion too, or a drag would leave the head stuck sideways
        s.spin += (0 - s.spin) * (1 - Math.exp(-RETURN * dt));
      }
      // dizziness leaks away: only sustained spinning crosses the threshold
      if (s.dizzy) s.dizzy -= Math.sign(s.dizzy) * Math.min(Math.abs(s.dizzy), 3.5 * dt);
      if (s.shake) s.shake = Math.max(0, s.shake - 2.2 * dt);
      const k = 1 - Math.exp(-6 * dt);
      s.rotY += (s.spin + s.targetY - s.rotY) * k;
      s.rotX += (s.targetX - s.rotX) * k;

      if (s.reduced) {
        group.rotation.set(s.rotX, s.rotY, 0);
        group.position.set(0, 0, 0);
      } else {
        // Persistent idle wobble, layered on top of wherever it is looking.
        // Two incommensurate frequencies per axis so it never repeats visibly
        // and reads as breathing rather than a loop.
        const w = t / 1000;
        // Parked, the head is ~100px across, so a subtle wobble reads as
        // nothing at all — swing it much harder when small and let the
        // lightbox keep the restrained version.
        /* Attention RECTIFIES the wobble rather than killing it. The idle
           sway's amplitude rivals a deliberate turn, so unfiltered it can
           rotate the head against where it is trying to look and cancel the
           turn. But uniform damping made it too still - so the filter is
           directional: sway components moving WITH the look direction keep
           half their swing, components fighting it are cut to ~12%. The head
           keeps oscillating, biased around the thing it is looking at, like
           leaning in. Roll and positional drift take a milder uniform cut -
           they do not oppose a turn, they are just liveliness. Driven by
           gaze-target magnitude, so cursor-tracking calms it the same way,
           and eased so the sway drains and refills rather than snapping. */
        const focusMag = Math.min(
          1,
          Math.hypot(s.targetX || 0, s.targetY || 0) * 2.5
        );
        s.calm = (s.calm || 0) + (focusMag - (s.calm || 0)) * (1 - Math.exp(-6 * dt));
        const calmT = s.calm;
        rectCalm = calmT;
        const ampBase = s.open ? 1 : 2.8;
        const shiftBase = s.open ? 1 : 2.2;
        const rect = rectify; // hoisted - no per-frame closure allocation
        const wx = (Math.cos(w * 0.61) * 0.085 + Math.sin(w * 1.13) * 0.03) * ampBase;
        const wy = (Math.sin(w * 0.47) * 0.075 + Math.cos(w * 0.91) * 0.028) * ampBase;
        group.rotation.x = s.rotX + rect(wx, Math.sign(s.targetX || 0));
        group.rotation.y = s.rotY + rect(wy, Math.sign(s.targetY || 0));
        const drift = 1 - 0.6 * calmT;
        group.rotation.z =
          (Math.sin(w * 0.53) * 0.055 + Math.cos(w * 1.27) * 0.018) * ampBase * drift;
        group.position.y =
          (Math.sin(w * 0.79) * 0.055 + Math.sin(w * 1.41) * 0.018) * shiftBase * drift;
        group.position.x = Math.cos(w * 0.67) * 0.03 * shiftBase * drift;
        // a faint nod while speaking - most of what sells "talking" is here,
        // not in the mouth itself
        group.rotation.x += (s.mouth || 0) * 0.035 * Math.sin(w * 5.1);
      }

      /* ghost trick: ease the shell's bias toward "far behind everything";
         the far side then fades in nearest-first as the shell recedes
         through the head - a depth peel the eye can follow. Reverses the
         same way. Reduced-motion visitors get the instant flip. */
      const gTarget = s.ghostTarget || 0;
      s.ghost = s.ghost || 0;
      s.ghost += (gTarget - s.ghost) * (s.reduced ? 1 : 1 - Math.exp(-0.75 * dt));
      /* smoothstepped, and mapped across just the head's ~1.7-unit depth -
         every frame of the ramp is visible change, so the dissolve reads as
         a wave moving through the head instead of a blink */
      const gS = s.ghost * s.ghost * (3 - 2 * s.ghost);
      /* 3.0 clears the head's depth extent at every reachable tilt (the
         cloud is 2.4 tall; pitched 40 degrees its view depth is ~2.9) */
      shellMaterial.uniforms.uShellBias.value = 0.06 + gS * 3.0;
      material.uniforms.uGhost.value = gS;

      /* ---- fire breath simulation ---- */
      if (s.fireLive) {
        const burning = t < (s.fireUntil || 0);
        if (burning) {
          fireBudget += dt * 260;
          while (fireBudget >= 1) {
            fireBudget -= 1;
            const i = fireCursor++ % FIRE_N;
            firePos[3 * i] = MOUTH_GLOW.c[0] + (Math.random() - 0.5) * 0.09;
            firePos[3 * i + 1] = MOUTH_GLOW.c[1] + (Math.random() - 0.5) * 0.05;
            firePos[3 * i + 2] = MOUTH_GLOW.c[2] - 0.02;
            fireVel[3 * i] = (Math.random() - 0.5) * 0.7;
            fireVel[3 * i + 1] = 0.05 + Math.random() * 0.3;
            fireVel[3 * i + 2] = 2.2 + Math.random() * 1.3;
            fireLife[i] = 0.0001;
            fireMax[i] = 0.45 + Math.random() * 0.45;
          }
        }
        let alive = 0;
        for (let i = 0; i < FIRE_N; i++) {
          if (!fireLife[i]) continue;
          fireLife[i] += dt;
          if (fireLife[i] >= fireMax[i]) {
            fireLife[i] = 0;
            fireCol[3 * i] = fireCol[3 * i + 1] = fireCol[3 * i + 2] = 0;
            firePos[3 * i + 1] = -9999; // off-frustum: zero fragments, zero alpha writes
            continue;
          }
          alive++;
          const age = fireLife[i] / fireMax[i];
          firePos[3 * i] += fireVel[3 * i] * dt;
          firePos[3 * i + 1] += fireVel[3 * i + 1] * dt;
          firePos[3 * i + 2] += fireVel[3 * i + 2] * dt;
          fireVel[3 * i + 1] += 0.45 * dt; // heat rises
          fireVel[3 * i] += Math.sin(t * 0.013 + i) * 0.55 * dt; // flicker
          /* yellow core -> orange -> ember red -> out */
          const g2 = Math.max(0, 0.85 - age * 1.15);
          const fade = 1 - age * age;
          fireCol[3 * i] = fade;
          fireCol[3 * i + 1] = g2 * fade;
          fireCol[3 * i + 2] = Math.max(0, 0.28 - age) * fade;
        }
        fireGeo.attributes.position.needsUpdate = true;
        fireGeo.attributes.color.needsUpdate = true;
        if (!burning && !alive) s.fireLive = false;
      }

      /* tint: the colour trick outranks the hover tint. The trick's wash
         SPREADS - uTintEdge sweeps the crown-distance field over ~1.4s -
         then holds, then fades out uniformly when trickTint clears. The
         hover tint keeps its old instant full-coverage behaviour. */
      const wantTint = s.trickTint || s.wantTint;
      if (wantTint) s.tint = wantTint;
      s.tintMix += ((wantTint ? 1 : 0) - s.tintMix) * (1 - Math.exp(-7 * dt));
      if (s.trickTint) s.tintWave = Math.min(1, (s.tintWave || 0) + dt / 1.4);
      material.uniforms.uTintEdge.value = s.trickTint ? (s.tintWave || 0) * 3.2 : 99;
      material.uniforms.uTintMix.value = s.tintMix;
      material.uniforms.uTint.value.set(s.tint[0], s.tint[1], s.tint[2]);

      /* ---- blink + talk ----
         Blink: a 160ms sine pulse at random 3-7s intervals, occasionally
         doubled - the double is most of what makes it read as alive rather
         than metronomic. Talk: the jaw flaps while reply chunks are actually
         arriving (send() stamps lastChunkAt), openness wandering on two
         incommensurate sines so it chews rather than oscillates; it eases
         shut in pauses and when the stream ends. window.__fhForce lets both
         values be pinned from the console for tuning. */
      if (s.reduced) {
        material.uniforms.uBlink.value = 0;
        material.uniforms.uMouth.value = 0;
        material.uniforms.uMouthW.value = 1;
      } else {
        if (!s.nextBlinkAt) s.nextBlinkAt = t + 1400 + Math.random() * 2600;
        if (t >= s.nextBlinkAt) {
          s.blinkStart = t;
          /* each blink draws its own duration from a tight band - the fixed
             160ms was metronomic, and two identical blinks in a row is
             exactly what the eye clocks as mechanical */
          s.blinkDur = 210 + Math.random() * 70;
          s.nextBlinkAt = t + 2800 + Math.random() * 4200;
          s.doubleBlinkAt = Math.random() < 0.22 ? t + s.blinkDur + 90 : 0;
        }
        if (s.doubleBlinkAt && t >= s.doubleBlinkAt) {
          s.blinkStart = t;
          s.blinkDur = (s.blinkDur || 240) * 0.85; // the second of a pair is quicker
          s.doubleBlinkAt = 0;
        }
        const bp = (t - (s.blinkStart || -1e9)) / (s.blinkDur || 240);
        /* asymmetric on purpose: lids snap shut in the first third and release
           slowly over the rest - a symmetric pulse reads as a camera shutter */
        let blink = 0;
        if (bp >= 0 && bp < 1) {
          blink =
            bp < 0.35
              ? Math.sin((bp / 0.35) * (Math.PI / 2))
              : Math.cos(((bp - 0.35) / 0.65) * (Math.PI / 2));
        }

        /* viseme sequencer: step through the streamed reply text at speaking
           pace, one character class at a time. The stream arrives far faster
           than speech, so the backlog is capped at 120 chars (the mouth ends
           within ~6s of the last chunk) and it hurries when more than 40
           behind - a fast talker rather than an endless one. */
        let buf = s.talkBuf || "";
        if (s.talkPos == null) s.talkPos = 0;
        if (buf.length - s.talkPos > 120) s.talkPos = buf.length - 120;
        const talking = s.talkPos < buf.length;
        if (talking && t >= (s.talkNext || 0)) {
          const dw = DIGIT_WORDS[buf.charAt(s.talkPos)];
          if (dw) {
            buf = buf.slice(0, s.talkPos) + dw + buf.slice(s.talkPos + 1);
            s.talkBuf = buf;
          }
          let key = buf.charAt(s.talkPos).toLowerCase();
          const pair = key + buf.charAt(s.talkPos + 1).toLowerCase();
          let v;
          if (DIGRAPHS[pair]) {
            v = DIGRAPHS[pair];
            key = pair;
            s.talkPos += 2;
          } else {
            v = VISEMES[key] || VISEME_OTHER;
            s.talkPos += 1;
          }
          const hurry = buf.length - s.talkPos > 40 ? 0.55 : 1;
          s.vOpen = v[0];
          s.vWidth = v[1];
          s.talkNext = t + v[2] * hurry * (0.85 + Math.random() * 0.3);
          speakBlip(key, s.voicePitch || 1);
        }
        let mouthTarget = talking ? s.vOpen || 0 : 0;
        // breathing fire: the jaw drops for the burst, whatever else is said
        if (s.fireLive && t < (s.fireUntil || 0)) mouthTarget = Math.max(mouthTarget, 0.75);
        const widthTarget = talking ? s.vWidth || 1 : 1;
        s.mouth = s.mouth || 0;
        /* gentle attack on purpose: sparse dots snapping between positions is
           what jitter looks like - they glide instead */
        s.mouth +=
          (mouthTarget - s.mouth) *
          (1 - Math.exp(-(mouthTarget > s.mouth ? 16 : 11) * dt));
        s.mouthW = s.mouthW == null ? 1 : s.mouthW;
        s.mouthW += (widthTarget - s.mouthW) * (1 - Math.exp(-12 * dt));
        let mouth = s.mouth;
        let mouthW = s.mouthW;

        const force = window.__fhForce;
        if (force) {
          if (force.blink != null) blink = force.blink;
          if (force.mouth != null) mouth = force.mouth;
          if (force.mouthW != null) mouthW = force.mouthW;
        }
        material.uniforms.uBlink.value = blink;
        material.uniforms.uMouth.value = mouth;
        material.uniforms.uMouthW.value = mouthW;
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    /* Watch the cursor once it comes near, wherever it is on the page. */
    const onPointerMove = (e) => {
      const s = stateRef.current;
      if (s.open || s.reduced || !miniRef.current) return;
      if (s.lookLock) return; // attending something - the gaze holds

      const r = miniRef.current.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      const GAZE_RADIUS = GAZE_RADIUS_BASE * Math.min(1, r.width / 100);

      if (dist > GAZE_RADIUS) {
        // Outside the close range it still follows the cursor across a card,
        // just more gently — that is the whole hero reacting, not the portrait
        // noticing you.
        const overCard =
          e.target && e.target.closest && e.target.closest(".landing .card");
        if (overCard) {
          const fx = dx / Math.max(1, window.innerWidth / 2);
          const fy = dy / Math.max(1, window.innerHeight / 2);
          s.targetY = Math.max(-0.8, Math.min(0.8, fx * 0.9));
          s.targetX = Math.max(-0.4, Math.min(0.4, fy * 0.5));
        } else {
          s.targetY = 0;
          s.targetX = 0;
        }
        return;
      }

      // ramp in across the outer third so the look does not snap on
      const strength = Math.min(1, (GAZE_RADIUS - dist) / (GAZE_RADIUS * 0.35));
      const ny = (dx / GAZE_RADIUS) * 1.15 * strength;
      const nx = (dy / GAZE_RADIUS) * 0.6 * strength;
      s.targetY = Math.max(-1.25, Math.min(1.25, ny));
      s.targetX = Math.max(-0.6, Math.min(0.6, nx));
    };

    /* leaving the window entirely returns it to forward too */
    const onPointerOut = (e) => {
      if (e.relatedTarget) return;
      stateRef.current.targetY = 0;
      stateRef.current.targetX = 0;
    };
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      geometry.dispose();
      /* the timers below were armed to RESTORE state - clearing them without
         also restoring it would strand a permanent ghost/tint across a phone
         overlay close (the scene tears down, stateRef survives) */
      clearTimeout(stateRef.current.trickTimer);
      clearTimeout(stateRef.current.trickTimer2);
      clearTimeout(stateRef.current.tintTimer);
      stateRef.current.ghostTarget = 0;
      stateRef.current.ghost = 0;
      stateRef.current.trickTint = null;
      stateRef.current.tintWave = 0;
      stateRef.current.fireLive = false;
      stateRef.current.fireUntil = 0;
      if (shellMesh) shellMesh.geometry.dispose();
      fireGeo.dispose();
      fireMat.dispose();
      fireTex.dispose();
      shellMaterial.dispose();
      if (material.uniforms.uMap.value) material.uniforms.uMap.value.dispose();
      material.dispose();
      renderer.dispose();
      /* dispose() alone leaves the GL context alive until GC; fab-mode
         open/close cycles would pile contexts up to the browser's cap */
      renderer.forceContextLoss();
      canvas.remove();
      window.__fhU = window.__fhG = window.__fhS = window.__fhSay = null;
      worldRef.current = null;
    };
  }, [needsScene]);

  /* hovering a card pulls the whole cloud toward that card's accent; attending
     something (lookTarget) overrides with the off-white */
  useEffect(() => {
    stateRef.current.wantTint = lookTarget
      ? ATTEND_TINT
      : hoveredCard
        ? CARD_TINT[hoveredCard] || null
        : null;
  }, [hoveredCard, lookTarget]);

  /* Turn toward whatever the visitor is inspecting. Computed geometrically
     from the two elements' centres, so it works wherever the head happens to
     live in the current layout. lookLock keeps the pointer-gaze handler from
     fighting it while the cursor moves around inside the target. */
  useEffect(() => {
    const s = stateRef.current;
    if (lookTarget && miniRef.current) {
      const a = miniRef.current.getBoundingClientRect();
      const b = lookTarget.getBoundingClientRect();
      const fx =
        (b.left + b.width / 2 - (a.left + a.width / 2)) /
        Math.max(1, window.innerWidth / 2);
      const fy =
        (b.top + b.height / 2 - (a.top + a.height / 2)) /
        Math.max(1, window.innerHeight / 2);
      s.targetY = Math.max(-0.9, Math.min(0.9, fx * 1.4));
      s.targetX = Math.max(-0.5, Math.min(0.5, fy * 0.9));
      s.lookLock = true;
    } else {
      s.lookLock = false;
      s.targetX = 0;
      s.targetY = 0;
    }
  }, [lookTarget]);

  /* size + re-parent the canvas when the lightbox opens or closes */
  const layout = useCallback(() => {
    /* Keep the portrait clear of the chat: the stage stops at the top of the
       input bar, so the head centres in what's left of the viewport. Measured
       from the input bar alone — the transcript grows upward over the stage
       rather than pushing it, so a long conversation never shoves the head. */
    if (open && overlayRef.current) {
      const ask = askRef.current;
      const reserve = ask
        ? Math.max(0, Math.round(window.innerHeight - ask.getBoundingClientRect().top + 10))
        : 0;
      overlayRef.current.style.setProperty("--fh-reserve", reserve + "px");
    }
    const world = worldRef.current;
    if (!world) return;
    const host = open ? stageRef.current : miniRef.current;
    if (!host) return;
    if (world.canvas.parentElement !== host) host.appendChild(world.canvas);
    const box = miniRef.current ? miniRef.current.clientWidth || 100 : 100;
    if (!open && !miniRef.current) return;
    const w = open ? host.clientWidth || 150 : Math.round(box * CANVAS_SCALE);
    const h = open ? host.clientHeight || 150 : Math.round(box * CANVAS_SCALE);
    world.renderer.setSize(w, h, false);
    world.canvas.style.width = w + "px";
    world.canvas.style.height = h + "px";
    world.camera.aspect = w / h;
    const z = open ? 5.6 : MINI_Z;
    world.camera.position.z = z;
    world.camera.updateProjectionMatrix();
    const fov = (world.camera.fov * Math.PI) / 180;
    const headPx = (Math.min(h, w) * 2.6) / (2 * z * Math.tan(fov / 2));
    const targetPx = Math.max(1.3, 0.0044 * headPx);
    world.material.uniforms.uSize.value = targetPx * z;
    applyDrawRange();
  }, [open, applyDrawRange]);

  useEffect(() => {
    stateRef.current.open = open;
    if (open) {
      stateRef.current.targetX = 0;
      stateRef.current.targetY = 0;
    }
    /* Run it now and again next frame. rAF alone is not enough: a browser does
       not service rAF in a hidden tab, so a resize that crosses a breakpoint
       while the tab is in the background would leave the canvas orphaned and
       the head invisible when the user came back. The immediate call re-parents
       regardless; the frame after is the settle pass. */
    layout();
    const t = requestAnimationFrame(layout);
    window.addEventListener("resize", layout);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("resize", layout);
    };
    /* mode and missionEl belong here even though the body never reads them.
       There is one canvas, moved between hosts by layout(); crossing a
       breakpoint destroys the old host button and mounts a new one (and the
       tablet portal swaps it again once .mission is found), leaving the canvas
       parented to a detached node - a head that silently vanishes. These deps
       are what re-runs the re-parent. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, layout, mode, missionEl]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    /* Not on a phone: focusing the field summons the keyboard the instant the
       portrait opens, covering the thing the visitor came to look at. They can
       tap the field when they actually want to type. */
    if (open && mode !== "phone" && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = async (e) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    const history = msgs.concat({ role: "user", content: question });
    setMsgs(history.concat({ role: "assistant", content: "" }));
    setDraft("");
    setBusy(true);
    stateRef.current.busy = true; // timer callbacks cannot see React state
    stateRef.current.talkBuf = "";
    stateRef.current.talkPos = 0;
    stateRef.current.talkNext = 0;
    stateRef.current.voicePitch = 0.95 + Math.random() * 0.2;
    ensureAudio(); // sending IS the user gesture autoplay policy wants

    /* pinned to THIS reply's slot, not the last message: the ghost trick's
       re-solidify closer can append a bubble while a later reply is still
       streaming, and last-message indexing would overwrite the closer with
       stream chunks */
    const replyAt = history.length;
    const replace = (content) =>
      setMsgs((prev) => {
        const copy = prev.slice();
        if (replyAt < copy.length) copy[replyAt] = { role: "assistant", content };
        return copy;
      });

    /* The model triggers tricks but never controls them: it may start a
       reply with [[ghost]] or [[spin]] (see the worker prompt), and each
       token maps to one typed, page-controlled effect here. The model's
       share is the two things it is good at - recognising a trick request
       in any phrasing, and writing a fresh line about it every time. */
    let trickFired = false;
    const fireTrick = (kind) => {
      trickFired = true;
      const s = stateRef.current;
      if (kind.startsWith("tint:")) {
        const hex = kind.slice(6);
        let r = parseInt(hex.slice(0, 2), 16) / 255;
        let g = parseInt(hex.slice(2, 4), 16) / 255;
        let b = parseInt(hex.slice(4, 6), 16) / 255;
        /* brightness floor: the tint multiplies each dot's own luminance,
           so "go black" would just switch the head off - keep the hue,
           lift the level */
        const m = Math.max(r, g, b);
        if (m === 0) r = g = b = 0.45;
        else if (m < 0.45) { r *= 0.45 / m; g *= 0.45 / m; b *= 0.45 / m; }
        s.trickTint = [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
        s.tintWave = 0;
        clearTimeout(s.tintTimer);
        s.tintTimer = setTimeout(() => {
          stateRef.current.trickTint = null;
        }, 10000);
        return;
      }
      if (kind === "fire") {
        s.fireLive = true;
        s.fireUntil = performance.now() + 3600;
        /* while breathing fire the head does not narrate - it yells. The
           reply text still lands in the transcript (flow() mutes its voice),
           and the sequencer screams vowels through the gaping jaw instead. */
        s.talkBuf = "AAAAAAAHHHHHAAAAAAAHHHHHHAAAAAHHH";
        s.talkPos = 0;
        s.talkNext = 0;
        return;
      }
      if (kind === "spin") {
        /* ~3 turns, POURED in over 1.6s with an ease-in-out rather than
           injected in one frame - the head visibly accelerates into the
           spin, peaks, and the frame loop's RETURN easing unwinds it,
           exactly like letting go after a hard drag */
        if (!s.reduced) s.spinFeed = { total: 33, t: 0, dur: 1.8 };
        return;
      }
      if (s.ghostTarget === 1) return; // already mid-ghost; the line still plays
      s.ghostTarget = 1;
      clearTimeout(s.trickTimer);
      clearTimeout(s.trickTimer2);
      s.trickTimer = setTimeout(() => {
        stateRef.current.ghostTarget = 0;
        s.trickTimer2 = setTimeout(() => {
          const back = SOLID_LINES[Math.floor(Math.random() * SOLID_LINES.length)];
          setMsgs((prev) => prev.concat({ role: "assistant", content: back }));
          /* voice it only when no newer reply is mid-stream - splicing
             words into another answer's viseme buffer reads as garbled */
          if (!stateRef.current.busy) {
            stateRef.current.talkBuf = (stateRef.current.talkBuf || "") + " " + back;
          }
        }, 2600);
      }, 8000);
    };

    /* a stalled stream (hung upstream, half-dead connection) would wedge
       busy=true forever and disable the chat until reload - cap the whole
       exchange at 45s */
    const ctrl = new AbortController();
    const killT = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });
      /* The worker explains refusals in the body — the daily cap, an unknown
         origin — so show that rather than a generic network apology. Only 5xx
         is really "couldn't reach the model". */
      if (!res.ok) {
        const said = await res.text().catch(() => "");
        /* worker-authored refusals carry a sentinel so the catch can tell
           them from browser noise ("Failed to fetch") with certainty */
        throw new Error(res.status < 500 && said.trim() ? "said:" + said.trim() : String(res.status));
      }
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      /* A trick token can arrive SPLIT across stream chunks, so the head of
         the reply is held back from both the transcript and the mouth until
         it either is a complete token or provably is not one - "[[gho"
         flashing on screen would give the whole game away. */
      let acc = "";
      let held = "";
      let decided = false;
      let muteVoice = false;
      const flow = (final) => {
        if (!decided) {
          const m = held.match(/^\[\[(ghost|spin|fire|tint:#[0-9a-fA-F]{6})\]\]\s*/);
          if (m) {
            if (m[1] === "fire") muteVoice = true; // the scream replaces the narration
            fireTrick(m[1]);
            held = held.slice(m[0].length);
            decided = true;
          } else if (final || held.length >= 18 || !/^\[\[?[a-z]*(:#?[0-9a-f]*)?\]?$/i.test(held)) {
            decided = true; // provably not a directive - let it all through
          }
        }
        if (decided && held) {
          acc += held;
          // feed the viseme sequencer - the mouth sounds out this exact text
          // (unless a fire scream owns the voice for this reply)
          if (!muteVoice) {
            stateRef.current.talkBuf = (stateRef.current.talkBuf || "") + held;
          }
          held = "";
          replace(acc);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        held += decoder.decode(value, { stream: true });
        flow(false);
      }
      flow(true);
      if (!acc.trim()) {
        if (trickFired) {
          // token-only reply: drop the empty bubble - the trick IS the answer
          setMsgs((prev) => prev.filter((_, i) => i !== replyAt));
        } else {
          const none = "(no answer came back)";
          replace(none);
          stateRef.current.talkBuf += none;
        }
      }
    } catch (err) {
      const said = String((err && err.message) || "");
      const msg = said.startsWith("said:")
        ? said.slice(5)
        : "I couldn't reach the model just now — email hyder.mohyuddin@gmail.com and you'll get a real reply.";
      replace(msg);
      /* refusals and failures go through the same mouth as answers - the head
         apologising in silence while text appears reads as broken, and the
         daily-cap message is the one visitors most deserve to be told out
         loud. The buffer was reset at send, so this voices exactly this. */
      stateRef.current.talkBuf += msg;
    } finally {
      clearTimeout(killT);
      stateRef.current.busy = false;
      setBusy(false);
    }
  };

  const onStageDown = (e) => {
    const s = stateRef.current;
    s.dragging = true;
    s.moved = 0;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onStageMove = (e) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const dy = e.clientY - s.lastY;
    s.moved += Math.abs(dx) + Math.abs(dy);
    /* shake vs spin: a shake is rapid direction REVERSALS - each flip of the
       drag direction (above a jitter floor) scores one, and the frame loop
       leaks the score, so only genuine rattling crosses the line */
    if (Math.abs(dx) > 4) {
      if (s.lastDx && Math.sign(dx) !== Math.sign(s.lastDx)) s.shake = (s.shake || 0) + 1;
      s.lastDx = dx;
    }
    if (Math.abs(dy) > 4) {
      if (s.lastDy && Math.sign(dy) !== Math.sign(s.lastDy)) s.shake = (s.shake || 0) + 1;
      s.lastDy = dy;
    }
    if (
      (s.shake || 0) >= 6 &&
      (!s.shakeAt || Date.now() - s.shakeAt > 10000) &&
      Date.now() - (s.dizzyAt || 0) > 1000
    ) {
      s.shake = 0;
      s.dizzy = 0; // a shake is not a spin - do not let it double-fire
      s.shakeAt = Date.now();
      const line = SHAKE_LINES[Math.floor(Math.random() * SHAKE_LINES.length)];
      setMsgs((prev) => prev.concat({ role: "assistant", content: line }));
      s.talkBuf = (s.talkBuf || "") + " " + line;
      ensureAudio();
    }
    s.spin += dx * 0.007;
    /* dizziness: hand-spun rotation accumulates (the frame loop leaks it
       away slowly, so only a real spree crosses the line), one complaint
       per minute at most, MANUAL spins only - the spin trick feeds s.spin
       elsewhere and does not count toward this */
    /* SIGNED accumulation: a shake's reversals cancel to near-zero net, so
       only genuine same-direction laps (2.5+ full turns) read as dizziness -
       rattling can never masquerade as spinning */
    s.dizzy = (s.dizzy || 0) + dx * 0.007;
    if (
      Math.abs(s.dizzy) > 16 &&
      (!s.dizzyAt || Date.now() - s.dizzyAt > 10000) &&
      Date.now() - (s.shakeAt || 0) > 1000
    ) {
      s.dizzy = 0;
      s.dizzyAt = Date.now();
      const line = DIZZY_LINES[Math.floor(Math.random() * DIZZY_LINES.length)];
      setMsgs((prev) => prev.concat({ role: "assistant", content: line }));
      s.talkBuf = (s.talkBuf || "") + " " + line;
      ensureAudio();
    }
    s.targetX = Math.max(-0.7, Math.min(0.7, s.targetX + dy * 0.005));
    s.lastX = e.clientX;
    s.lastY = e.clientY;
  };
  const endDrag = () => {
    stateRef.current.dragging = false;
  };

  if (!capable) return null;

  const portrait = (
    <button
        type="button"
        className={
          "fh-mini" +
          (mode === "tablet" ? " fh-mini-inline" : "") +
          (open || mode === "phone" ? " fh-mini-hidden" : "")
        }
        ref={miniRef}
        onClick={() => setOpen(true)}
        /* Mouse-only on purpose: on touch, this fires during the tap's
           synthetic hover phase, and mobile Safari withholds the click when a
           hover handler mutates the DOM (onHoverChange re-renders the page
           with the dim classes) - the dim would play and the panel never
           open. A tap should go straight to onClick. */
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          stateRef.current.hovering = true;
          if (onHoverChange) onHoverChange(miniRef.current);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          stateRef.current.hovering = false;
          if (onHoverChange) onHoverChange(null);
        }}
      /* No title attribute: the native tooltip just parks a grey box over the
         head and says nothing the picture doesn't. aria-label still covers
         screen readers. */
      aria-label="Open the 3D portrait"
    />
  );

  return (
    <>
      {/* Portalled to the body because it is position:fixed. Rendered in place
          it sits inside .hero > .landing, and an ancestor that clips (or that
          carries a transform) makes a fixed element resolve against that
          ancestor instead of the viewport - the button ends up cropped at the
          hero's edge rather than pinned to the corner of the screen. */}
      {mode === "phone" && !open &&
        createPortal(
          <button
            type="button"
            className="fh-fab"
            onClick={() => setOpen(true)}
            aria-label="Ask my site anything"
            title="Ask my site anything"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5l1.8 5.2 5.2 1.8-5.2 1.8L12 16.5l-1.8-5.2L5 9.5l5.2-1.8z" />
              <circle cx="18.5" cy="17.5" r="1.6" />
              <circle cx="6" cy="17" r="1.1" />
            </svg>
          </button>,
          document.body
        )}

      {mode === "phone" ? null : missionEl ? createPortal(portrait, missionEl) : portrait}

      {open &&
        createPortal(
          <div
            className="fh-overlay"
            ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label="3D portrait"
          onClick={() => {
            if (stateRef.current.moved > 6) {
              stateRef.current.moved = 0;
              return;
            }
            setOpen(false);
          }}
        >
          <button
            type="button"
            className="fh-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
          <div
            className="fh-stage"
            ref={stageRef}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {CHAT_ENDPOINT ? (
            <div
              className="fh-chat"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Outside the log on purpose: inside it, it scrolled away with
                  the transcript, so collapsing a long conversation meant
                  scrolling up to find the control that collapses it. */}
              {msgs.length > 2 && (
                <button
                  type="button"
                  className="fh-more"
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                >
                  <span className={"fh-caret" + (showAll ? " open" : "")}>▸</span>
                  {showAll
                    ? "hide earlier"
                    : msgs.length - 2 +
                      " earlier message" +
                      (msgs.length - 2 === 1 ? "" : "s")}
                </button>
              )}
              {msgs.length > 0 && (
                <div className="fh-log" ref={logRef}>
                  {(showAll ? msgs : msgs.slice(-2)).map((m, i, shown) => (
                    <p key={i} className={"fh-msg fh-" + m.role}>
                      <span className="fh-who">
                        {m.role === "user" ? "you" : "hyder"}
                      </span>
                      {m.content ||
                        (busy && i === shown.length - 1 ? "thinking…" : "")}
                    </p>
                  ))}
                </div>
              )}
              <form className="fh-ask" ref={askRef} onSubmit={send}>
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask me about my work"
                  aria-label="Ask a question"
                  maxLength={1500}
                  /* Deliberately not disabled while a reply streams. Disabling
                     an element blurs it, which threw the caret out of the box
                     after every message; send() already ignores submits while
                     busy, so the guard costs nothing to drop. */
                />
                <button type="submit" disabled={busy || !draft.trim()}>
                  Ask
                </button>
              </form>
              <p className="fh-hint">drag to rotate · esc to close</p>
            </div>
          ) : (
            <p className="fh-hint">drag to rotate · esc to close</p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
