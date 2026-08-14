import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import "./FloatingHead.css";

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

/* The deployed worker is the default so the chat works everywhere without a
   build-time variable — `npm start`, a bare `npm run build`, a fresh clone.
   Missing the variable used to hide the whole chat block, input bar included,
   with no visible error. REACT_APP_CHAT_ENDPOINT still overrides it (point it
   at `npm run chat:local` to develop against a local worker; set it empty to
   render the portrait with no chat at all). Not a secret: the worker only
   answers requests whose Origin it recognises, and the keys live in
   Cloudflare. */
const CHAT_LOG_KEY = "fh-chat-log";

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

const VERT = [
  "attribute vec3 aColor;",
  "uniform float uSize;",
  "uniform float uDpr;",
  "varying vec3 vColor;",
  "varying float vFacing;",
  "void main() {",
  "  vColor = aColor;",
  "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
  "  vec3 n = normalize(normalMatrix * normal);",
  "  vFacing = smoothstep(-0.35, 0.55, n.z);",
  "  gl_PointSize = (uSize * uDpr) / max(0.001, -mv.z);",
  "  gl_Position = projectionMatrix * mv;",
  "}",
].join("\n");

const FRAG = [
  "uniform sampler2D uMap;",
  "uniform vec3 uTint;",
  "uniform float uTintMix;",
  "varying vec3 vColor;",
  "varying float vFacing;",
  "void main() {",
  "  vec4 t = texture2D(uMap, gl_PointCoord);",
  "  float a = t.a * (0.10 + 0.90 * vFacing);",
  "  if (a < 0.012) discard;",
  // keep each point's own brightness when tinting, so the shading survives
  "  float lum = max(max(vColor.r, vColor.g), vColor.b);",
  "  vec3 col = mix(vColor, uTint * lum, uTintMix);",
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
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const load = (data) => {
      geometry.setAttribute("position", new THREE.BufferAttribute(data.position, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(data.normal, 3));
      const n = data.position.length / 3;
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

    /* render loop, with a capability check over the first second of frames */
    let raf = 0;
    let last = 0;
    const samples = [];
    let judged = window.__fhNoGuard === true;
    const RETURN = 0.9; // how firmly it eases back to facing forward

    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) {
        last = t;
        return;
      }
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;

      if (last && !judged) {
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
      if (!s.dragging && !s.reduced) {
        // ease back toward forward instead of spinning indefinitely
        s.spin += (0 - s.spin) * (1 - Math.exp(-RETURN * dt));
      }
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
        const amp = s.open ? 1 : 2.8;
        const shift = s.open ? 1 : 2.2;
        group.rotation.x =
          s.rotX + (Math.cos(w * 0.61) * 0.085 + Math.sin(w * 1.13) * 0.03) * amp;
        group.rotation.y =
          s.rotY + (Math.sin(w * 0.47) * 0.075 + Math.cos(w * 0.91) * 0.028) * amp;
        group.rotation.z =
          (Math.sin(w * 0.53) * 0.055 + Math.cos(w * 1.27) * 0.018) * amp;
        group.position.y =
          (Math.sin(w * 0.79) * 0.055 + Math.sin(w * 1.41) * 0.018) * shift;
        group.position.x = Math.cos(w * 0.67) * 0.03 * shift;
      }

      // ease the hover tint in and out
      if (s.wantTint) s.tint = s.wantTint;
      s.tintMix += ((s.wantTint ? 1 : 0) - s.tintMix) * (1 - Math.exp(-7 * dt));
      material.uniforms.uTintMix.value = s.tintMix;
      material.uniforms.uTint.value.set(s.tint[0], s.tint[1], s.tint[2]);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    /* Watch the cursor once it comes near, wherever it is on the page. */
    const onPointerMove = (e) => {
      const s = stateRef.current;
      if (s.open || s.reduced || !miniRef.current) return;

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
      if (material.uniforms.uMap.value) material.uniforms.uMap.value.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
      worldRef.current = null;
    };
  }, [needsScene]);

  /* hovering a card pulls the whole cloud toward that card's accent */
  useEffect(() => {
    stateRef.current.wantTint = hoveredCard ? CARD_TINT[hoveredCard] || null : null;
  }, [hoveredCard]);

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
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = async (e) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    const history = msgs.concat({ role: "user", content: question });
    setMsgs(history.concat({ role: "assistant", content: "" }));
    setDraft("");
    setBusy(true);

    const replace = (content) =>
      setMsgs((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: "assistant", content };
        return copy;
      });

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      /* The worker explains refusals in the body — the daily cap, an unknown
         origin — so show that rather than a generic network apology. Only 5xx
         is really "couldn't reach the model". */
      if (!res.ok) {
        const said = await res.text().catch(() => "");
        throw new Error(res.status < 500 && said.trim() ? said.trim() : String(res.status));
      }
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replace(acc);
      }
      if (!acc.trim()) replace("(no answer came back)");
    } catch (err) {
      const said = String((err && err.message) || "");
      replace(
        said.includes(" ")
          ? said
          : "I couldn't reach the model just now — email hyder.mohyuddin@gmail.com and you'll get a real reply."
      );
    } finally {
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
    s.spin += dx * 0.007;
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
        onMouseEnter={() => {
          stateRef.current.hovering = true;
          if (onHoverChange) onHoverChange(miniRef.current);
        }}
        onMouseLeave={() => {
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
