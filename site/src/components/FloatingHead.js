import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { projects, projectSlug, projectShortName } from "../pages/Projects";
import {
  parseActToken,
  resolveAction,
  couldBeToken,
  tokenCap,
  stripExtraTokens,
  parseTourToken,
  splitTourSteps,
  tourCommand,
  parseThinkOpen,
  splitThink,
  tailHold,
  parseStatsTail,
  splitMore,
  spokenText,
} from "../utils/chatActions";
import { getAttention, noteAttention, onAttention } from "../utils/chatContext";
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
/* on a tour the canvas is this many times the disc, drawn centred over it: a
   shaken head's chunks fly out over the card and the page instead of hitting
   the disc's square; the shader dissolves them before the canvas edge */
const TOUR_PAD = 2.6;
const MINI_POINTS = 9000;
/* the tour caption's head is smaller than the portrait: all 16k points in
   ~95px of head is several times the portrait's density and reads bright,
   so it draws at the portrait's density instead - points per CSS pixel of
   head area, from the 9000 points a 145px portrait shows */
/* the occlusion shell sits this far behind the dots (view space). Along
   grazing creases the shell at a pixel is a different, nearer patch of
   surface than the dot's, and hides it; direct rendering buries the voids
   in grain, the supersampled small heads average them into visible dark
   paths, so those use a deeper setting. */
const SHELL_BIAS = 0.06;
const SHELL_BIAS_SMALL = 0.14; // from a bias sweep on 3x captures of the portrait: 0.10 still showed paths, 0.20 gained nothing

// The head starts watching the cursor once it comes within 1.5x the radius of
// the ring the background embers orbit at (90px in BgVariantB). Scaled down
// with the portrait so it stays proportionate on small layouts.
const GAZE_RADIUS_BASE = 135;
/* the big portrait's gaze origin: this much of the host's height above its
   centre, between the brows */
const GAZE_ORIGIN_UP = 0.1;

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

/* ---------- looks ----------
   Two of the head's tricks are LOOKS rather than moments: the ghost (the
   cloud goes see-through) and the lattice (the cloud re-rendered as a
   halftone - dots on a fixed screen grid, sized by tone, like a print of it).
   A look stays until the visitor asks for the default back ([[cloud]]), and
   it is remembered across visits, so a returning visitor finds the head the
   way they left it. localStorage rather than a cookie: nothing here is ever
   sent to a server. */
const LOOK_KEY = "fh-look";
function readLook() {
  try {
    const j = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}");
    /* the halftone stands alone (a solid print: no ghost through it, no wire
       with it); a look saved before that was enforced comes back as what
       was on screen, which was the halftone */
    const lattice = !!(j && j.lattice);
    return { ghost: !lattice && !!(j && j.ghost), lattice, wire: !lattice && !!(j && j.wire) };
  } catch (err) {
    return { ghost: false, lattice: false, wire: false };
  }
}
function writeLook(look) {
  try {
    if (look.ghost || look.lattice || look.wire) localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    else localStorage.removeItem(LOOK_KEY);
  } catch (err) {
    // private mode: the look lasts the visit
  }
}
const lookName = (look) =>
  [look.ghost ? "ghost" : "", look.lattice ? "lattice" : "", look.wire ? "wire" : ""].filter(Boolean).join("+");

/* ---------- small-host rendering ----------
   At a hundred pixels the cloud's ~16k one-pixel dots crowd into a few
   thousand pixels and read as grain. The small hosts - the corner portrait,
   the tour caption's head - are therefore rendered at several times their
   size into a texture with mipmaps and drawn down from it, so the grain
   averages into tone and the head reads like its lightbox self, calmer.
   The same texture path serves the lattice look at any size: the halftone
   shader samples the rendered cloud's tone per grid cell. */
const SUPER = (dpr) => Math.max(2, Math.min(4, Math.round(4 / dpr)));
/* the performed tricks: shader id and length in ms */
const FX = { scatter: [1, 2400], melt: [2, 6400], shatter: [3, 2600], ember: [4, 3000], glitch: [5, 2600], hue: [6, 2200] };
/* the warps take the face apart, so while one plays the head neither blinks
   nor talks (the words still arrive; the mouth picks up what is left after).
   The glitch keeps talking: a stutter through the slices is in character. */
const WARP_IDS = new Set([FX.scatter[0], FX.melt[0], FX.shatter[0], FX.ember[0]]);
/* these move the dots, so the occlusion shell (which stays put) would hide
   whatever drifts behind it: dots cut off at the chin as they sag, sparks
   cut off at the brow as they rise. The shell steps aside for the duration. */
const MOVING_IDS = new Set([FX.scatter[0], FX.melt[0], FX.shatter[0], FX.ember[0], FX.glitch[0]]);
const LATTICE_GAIN = 2.2;
const LATTICE_FILL = 0.74; // the largest dot's diameter as a share of its cell
/* The cell tone is read from a texture that is averaged over the last few
   frames (an exponential filter with this weight on the newest frame, about
   a tenth of a second to settle). The head sways and breathes, so dots drift
   across cell edges and a single frame's tone jumps cell by cell - the
   static the lab never showed, because its head sat still. */
const TONE_K = 0.16;
/* the accumulation pass: the cloud's mip sample, blended with last frame's */
const TONE_FRAG = [
  "out vec4 fragColor;",
  "uniform sampler2D tSrc; uniform sampler2D tPrev; uniform float uLod; uniform float uK;",
  "varying vec2 vUv;",
  "void main() { fragColor = mix(texture(tPrev, vUv), textureLod(tSrc, vUv, uLod), uK); }",
].join("\n");
const latticeCell = (headCss) => Math.max(3.5, Math.min(8, 0.02 * headCss)); // CSS px per grid cell
const QUAD_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
/* The direct render saturates: dozens of additive sprites per pixel clamp at
   white, and that clamping is part of how the lightbox head looks. Averaged
   at 4x, far fewer sprites overlap per texel, nothing clamps, and the small
   head comes out brighter than its big self. The copy pass scales it back. */
const SMALL_EXPOSURE = 1.0; // averaging no longer clamps, and dimming it read as dull
/* the halftone prints the filled head (the shell wearing the dots' colours);
   the numbers were chosen by eye in the lab at the lightbox size, where the
   base cell is 8 px: 12.5 px cells, marks half a cell wide, gain 1.4 */
const SOLID_GAIN = 1.4;
const SOLID_CELL = 12.5 / 8; // times latticeCell(): 12.5 px at the lightbox, scaled down with small heads
const SOLID_FILL = 0.52; // the largest mark's width as a share of its cell
const TOUR_DIM = 0.78; // the plain cloud on a tour sits over the words, so it is turned down a little
const COPY_FRAG =
  "uniform sampler2D tSrc; uniform float uExposure; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv) * uExposure; }";

/* ---------- the wire look ----------
   The head's own surface (the occlusion shell) cut by three families of
   planes, x = k*d, y = k*d, z = k*d: a cubic lattice drawn on the face.
   Each triangle a plane crosses yields one segment between its two edge
   crossings; the segment carries the triangle's normal so edges facing
   away fade, and the shell's depth hides the far side. The shell is the
   whole scan, neck and shoulder included, where the cloud was cut at the
   neck, so segments are kept only where the cloud has points: `near` is a
   voxel occupancy test built from the cloud, so the wire ends where the
   dots do. Spacing is chosen per head size (layout) so lines sit a few
   pixels apart at every size, and each spacing is sliced once and cached. */
const NEAR_R = 0.045; // cloud units; shell-to-dot gaps over the head are ~0.012 (median), 0.022 (98th pct)
const NEAR_CELL = 0.05;
/* a test for "the cloud has dots here": true within NEAR_R of any dot. The
   scan's shell carries a neck base and a shoulder the cloud never had, and
   the wire is cut where the dots stop. A hashed grid keeps each query to the
   27 cells around it. */
function cloudOccupancy(pos, neck = NECK_DEFAULT) {
  const grid = new Map();
  const key = (x, y, z) => x * 4194304 + y * 2048 + z;
  const cell = (v) => Math.floor(v / NEAR_CELL) + 1000;
  for (let i = 0; i < pos.length; i += 3) {
    if (!neckKeep(neck, pos[i], pos[i + 1], pos[i + 2])) continue;
    const k = key(cell(pos[i]), cell(pos[i + 1]), cell(pos[i + 2]));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  const r2 = NEAR_R * NEAR_R;
  return (x, y, z) => {
    const cx = cell(x), cy = cell(y), cz = cell(z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const ex = pos[i] - x, ey = pos[i + 1] - y, ez = pos[i + 2] - z;
        if (ex * ex + ey * ey + ez * ez <= r2) return true;
      }
    }
    return false;
  };
}

/* the dots' colours as a field: the mean colour of the dots within SOLID_R
   of a point, or the nearest dot's when none is that close. Same hashed grid
   as the occupancy test. */
const SOLID_R = 0.07;
function cloudSampler(pos, col) {
  const grid = new Map();
  const key = (x, y, z) => x * 4194304 + y * 2048 + z;
  const cell = (v) => Math.floor(v / SOLID_R) + 1000;
  for (let i = 0; i < pos.length; i += 3) {
    const k = key(cell(pos[i]), cell(pos[i + 1]), cell(pos[i + 2]));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  const r2 = SOLID_R * SOLID_R;
  return (x, y, z, out) => {
    const cx = cell(x), cy = cell(y), cz = cell(z);
    let r = 0, g = 0, b = 0, n = 0, best = Infinity, bi = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const ex = pos[i] - x, ey = pos[i + 1] - y, ez = pos[i + 2] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 <= r2) { r += col[i]; g += col[i + 1]; b += col[i + 2]; n++; }
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    if (n > 0) { out[0] = r / n; out[1] = g / n; out[2] = b / n; }
    else if (bi >= 0) { out[0] = col[bi]; out[1] = col[bi + 1]; out[2] = col[bi + 2]; }
    else { out[0] = 0; out[1] = 0; out[2] = 0; }
    return out;
  };
}

function sliceShell(verts, idx, d, near) {
  const tri = idx.length / 3;
  const segs = [];
  const nrm = [];
  const col = [];
  const mid = [];
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < verts.length; i += 3) {
    if (verts[i] < lo) lo = verts[i];
    if (verts[i] > hi) hi = verts[i];
  }
  const span = Math.max(1e-6, hi - lo);
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const i = idx[t * 3 + k];
      v[k][0] = verts[i * 3];
      v[k][1] = verts[i * 3 + 1];
      v[k][2] = verts[i * 3 + 2];
    }
    if (near && !near(v[0][0], v[0][1], v[0][2]) && !near(v[1][0], v[1][1], v[1][2]) && !near(v[2][0], v[2][1], v[2][2])) continue;
    const ax = v[1][0] - v[0][0], ay = v[1][1] - v[0][1], az = v[1][2] - v[0][2];
    const bx = v[2][0] - v[0][0], by = v[2][1] - v[0][1], bz = v[2][2] - v[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    for (let a = 0; a < 3; a++) {
      const tlo = Math.min(v[0][a], v[1][a], v[2][a]);
      const thi = Math.max(v[0][a], v[1][a], v[2][a]);
      for (let kk = Math.ceil(tlo / d); kk * d <= thi; kk++) {
        const c = kk * d;
        const pts = [];
        for (let e = 0; e < 3; e++) {
          const p0 = v[e], p1 = v[(e + 1) % 3];
          const s0 = p0[a] - c, s1 = p1[a] - c;
          if ((s0 < 0 && s1 >= 0) || (s1 < 0 && s0 >= 0)) {
            const tt = s0 / (s0 - s1);
            pts.push([p0[0] + (p1[0] - p0[0]) * tt, p0[1] + (p1[1] - p0[1]) * tt, p0[2] + (p1[2] - p0[2]) * tt]);
          }
        }
        if (pts.length !== 2) continue;
        if (near && !near((pts[0][0] + pts[1][0]) * 0.5, (pts[0][1] + pts[1][1]) * 0.5, (pts[0][2] + pts[1][2]) * 0.5)) continue;
        segs.push(pts[0][0], pts[0][1], pts[0][2], pts[1][0], pts[1][1], pts[1][2]);
        nrm.push(nx, ny, nz, nx, ny, nz);
        /* both ends share the segment's midpoint as their anchor, so a
           performed trick moves each line as one rigid piece */
        const mx = (pts[0][0] + pts[1][0]) * 0.5, my = (pts[0][1] + pts[1][1]) * 0.5, mz = (pts[0][2] + pts[1][2]) * 0.5;
        mid.push(mx, my, mz, mx, my, mz);
        for (const q of pts) {
          const band = Math.max(0, Math.min(3, Math.floor(((q[1] - lo) / span) * 4)));
          const rgb = EMBERS[band];
          col.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));
  g.setAttribute("aNormal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("aMid", new THREE.BufferAttribute(new Float32Array(mid), 3));
  return g;
}
/* the wire dissolves over the neck's last stretch (cloud units, rest
   height). The scan's neck base widens into a shoulder on one side; the dots
   there are sparse and dim, but contour lines pile up on the slope and read
   as a piece jutting out, so the lines go before the dots do. */
const WIRE_NECK = [-9, -8.9]; // retired: the cut planes (NECK_PLANES) do this now
/* the neck cut: planes through three points each, in the head's own rest
   frame (cloud units; the cloud spans y -1.2..1.2, the face toward +z). A
   dot on the far side of ANY plane - away from the face's centre - is not
   drawn in any look, and is left out of the wire's clip, the solid print
   and the silhouette. The /cut editor moves the points live
   (window.__fhCutEditor); the chosen sets go here. Up to NECK_MAX planes. */
const NECK_PLANES = [
  [[0.65, -1.476, 1.744], [0.484, -1.142, -0.143], [0.308, -1.116, -0.829]], // the owner's cuts, 2026-11-01
  [[-1.269, -1.645, 0.533], [1.396, -1.424, 0.823], [0.829, -0.553, -1.159]],
];
const NECK_MAX = 4;
const NECK_BAND = 0.06; // the cut fades over this much distance from a plane
/* a plane as a normal and an offset, the normal pointing toward the kept
   side (the side the middle of the face is on): keep where n.p - d >= 0 */
function planeFrom(pts) {
  const [a, b, c] = pts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  let d = nx * a[0] + ny * a[1] + nz * a[2];
  if (ny * 0.2 - d < 0) { nx = -nx; ny = -ny; nz = -nz; d = -d; } // the face's middle (0, 0.2, 0) is kept
  return { n: [nx, ny, nz], d };
}
const planesFrom = (sets) => sets.slice(0, NECK_MAX).map(planeFrom);
/* the same test in GLSL, for the shell (the occluder and the solid print):
   the signed distance to the nearest cutting plane (negative = cut). It is
   computed per vertex and interpolated, and a plane's distance is linear
   across a triangle, so the fragment-side cut lands exactly on the plane. */
const PLANE_GLSL =
  "uniform vec4 uPlanes[4]; uniform int uPlaneCount;" +
  " float planeDist(vec3 p){ float k = 9.0; for (int i = 0; i < 4; i++) { if (i < uPlaneCount) { k = min(k, dot(uPlanes[i].xyz, p) - uPlanes[i].w); } } return k; }";
const NECK_DEFAULT = planesFrom(NECK_PLANES);
const neckKeep = (planes, x, y, z) => {
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i];
    if (pl.n[0] * x + pl.n[1] * y + pl.n[2] * z - pl.d < 0) return false;
  }
  return true;
};
const wireSpacing = (headCss) => Math.round(Math.max(0.08, Math.min(0.3, 7 / (Math.max(20, headCss) / 2.6))) * 100) / 100;
/* ---------- the performed tricks, shared by the dots and the wire ----------
   uFx picks one, uFxT runs 0..1 through it; everything is a function of the
   vertex's rest position, so each dot (or line end) keeps its own path from
   frame to frame. applyFx() displaces; the varyings carry colour work to the
   fragment side, where applyFxColor() finishes it. */
const FX_VERT_GLSL = `
uniform float uFx;
uniform float uFxT;
uniform float uFxSeed;
uniform float uTime;
varying float vFxFade;
varying float vFxGlow;
varying float vFxHue;
varying float vFxW;
varying float vGlitch;
varying vec2 vNdc;

float hash1(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719)) + uFxSeed * 17.0) * 43758.5453); }
vec3 hash3(vec3 q) { return vec3(hash1(q), hash1(q + 1.7), hash1(q + 3.1)); }
float env(float t) { return sin(3.14159 * clamp(t, 0.0, 1.0)); }
mat3 rotAxis(vec3 a, float ang) {
  float c = cos(ang), s = sin(ang), ic = 1.0 - c;
  return mat3(
    c + a.x * a.x * ic, a.x * a.y * ic - a.z * s, a.x * a.z * ic + a.y * s,
    a.y * a.x * ic + a.z * s, c + a.y * a.y * ic, a.y * a.z * ic - a.x * s,
    a.z * a.x * ic - a.y * s, a.z * a.y * ic + a.x * s, c + a.z * a.z * ic);
}
vec3 applyFx(vec3 p, vec3 rest) {
  vFxFade = 1.0;
  vFxGlow = 0.0;
  vFxHue = 0.0;
  vFxW = 0.0;
  vGlitch = 0.0;
  if (uFx > 0.5 && uFx < 1.5) {
    /* scatter: every dot flies outward, hangs, and glides home */
    vec3 h = hash3(rest);
    vec3 dir = normalize(p - vec3(0.0, 0.1, 0.0)) + (h - 0.5) * 0.8;
    float e = pow(env(uFxT), 0.8);
    p += dir * e * (0.3 + 0.45 * h.x);
  } else if (uFx > 1.5 && uFx < 2.5) {
    /* melt: sag, drip, pool below the chin, climb back */
    float h = hash1(rest);
    float e = env(uFxT);
    float drop = e * (1.6 + 0.8 * h);
    float ny = max(p.y - drop, -1.45 - 0.05 * h);
    float pool = 1.0 - smoothstep(-1.45, -1.1, ny);
    p.xz *= 1.0 + 0.7 * pool * e;
    p.y = ny;
  } else if (uFx > 2.5 && uFx < 3.5) {
    /* shatter: chunks of the cloud tumble outward and reassemble */
    vec3 cid = floor((rest + 2.0) * 3.0);
    vec3 ch = hash3(cid);
    vec3 cc = (cid + 0.5) / 3.0 - 2.0;
    float e = env(uFxT);
    vec3 dir = normalize(cc - vec3(0.0, 0.1, 0.0)) + (ch - 0.5) * 0.8;
    p = cc + rotAxis(normalize(ch - 0.5 + 0.01), (ch.x - 0.5) * 6.0 * e) * (p - cc) + dir * e * (1.2 + 0.6 * ch.y);
  } else if (uFx > 3.5 && uFx < 4.5) {
    /* ember rise: the dots glow and drift up like sparks, then settle */
    float h = hash1(rest);
    float e = env(uFxT);
    p.y += e * (0.6 + 1.6 * h);
    p.x += sin(uTime * 2.0 + h * 20.0) * 0.08 * e;
    p.z += cos(uTime * 1.7 + h * 13.0) * 0.08 * e;
    vFxGlow = e * (0.8 + h);
    vFxFade = 1.0 - 0.75 * e * h;
  } else if (uFx > 4.5 && uFx < 5.5) {
    /* glitch: slices jolt sideways in bursts, with a colour split */
    float slice = floor(p.y * 9.0 + uFxSeed);
    float frame = floor(uTime * 18.0);
    float gate = step(0.55, hash1(vec3(slice, frame, 1.0)));
    float off = (hash1(vec3(slice, frame, 2.0)) - 0.5) * 0.9;
    float e = 1.0 - smoothstep(0.75, 1.0, uFxT);
    p.x += off * gate * e;
    vGlitch = gate * e * (1.0 + step(0.5, hash1(vec3(slice, frame, 3.0))));
  } else if (uFx > 5.5 && uFx < 6.5) {
    /* hue sweep: a rainbow band crosses the head once, left to right */
    float c = mix(-2.0, 2.0, uFxT);
    float u = clamp((p.x - c + 0.55) / 1.1, 0.0, 1.0);
    float w = 1.0 - smoothstep(0.0, 0.55, abs(p.x - c));
    vFxHue = u * 6.2832;
    vFxW = w;
  }
  return p;
}
`;
/* the colour side: the sweep's spectrum, the sparks' glow in the look's
   temperature (uFxTint), the glitch's split */
const FX_FRAG_GLSL = `
uniform vec3 uFxTint;
uniform float uEdgeFade;
varying float vFxFade;
varying float vFxGlow;
varying float vFxHue;
varying float vFxW;
varying float vGlitch;
varying vec2 vNdc;
/* a soft round edge inside the canvas (on when the canvas is a padded tour
   host): whatever a trick throws that far dissolves instead of being cut */
float edgeFade() { return 1.0 - uEdgeFade * smoothstep(0.8, 0.98, length(vNdc)); }
vec3 hueRotate(vec3 c, float ang) { const vec3 k = vec3(0.57735); float ca = cos(ang); float sa = sin(ang); return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca); }
vec3 applyFxColor(vec3 col, float lum) {
  if (vFxW > 0.0) col = mix(col, hueRotate(vec3(1.0, 0.12, 0.12), vFxHue) * (0.5 + 0.9 * lum), vFxW);
  col = mix(col, col * uFxTint * 1.3 + uFxTint * 0.25, clamp(vFxGlow, 0.0, 1.0));
  if (vGlitch > 0.0) col = mix(col, (vGlitch > 1.5 ? vec3(1.0, 0.2, 0.8) : vec3(0.2, 1.0, 1.0)) * max(lum, 0.7), 0.85);
  return col;
}
`;

/* GLSL3 for textureLod: the cell's tone is the average over its own area,
   read from the mip level that matches the cell. Premultiplied output: the
   canvas composites as premultiplied, and this pass does not blend. */
const LATTICE_FRAG = [
  "out vec4 fragColor;",
  "uniform sampler2D tSrc; uniform vec2 uSize; uniform float uCell; uniform float uGain; uniform float uMax; uniform float uLod; uniform float uShape; uniform float uStagger;",
  "varying vec2 vUv;",
  "void main() {",
  "  vec2 p = vUv * uSize;",
  "  float row = floor(p.y / uCell);",
  "  float shift = uStagger * mod(row, 2.0) * 0.5 * uCell;",
  "  float colI = floor((p.x - shift) / uCell);",
  "  vec2 center = vec2((colI + 0.5) * uCell + shift, (row + 0.5) * uCell);",
  "  vec4 s = textureLod(tSrc, center / uSize, uLod);",
  "  float tone = clamp(dot(s.rgb, vec3(0.33, 0.5, 0.17)) * uGain, 0.0, 1.0);",
  "  float r = sqrt(tone) * uMax * uCell * 0.5;",
  // the mark's shape: 0 round, 1 square, 2 diamond, 3 hexagon (r is its half-width)
  "  vec2 q = abs(p - center);",
  "  float d = uShape < 0.5 ? length(q) : uShape < 1.5 ? max(q.x, q.y) : uShape < 2.5 ? (q.x + q.y) * 0.7071 : max(q.x, dot(q, vec2(0.5, 0.866)));",
  "  float a = (1.0 - smoothstep(r - 0.75, r + 0.25, d)) * step(0.02, tone);",
  "  vec3 hue = s.rgb / max(max(s.r, max(s.g, s.b)), 1e-3);",
  "  vec3 col = hue * (0.55 + 0.45 * tone);",
  "  fragColor = vec4(col * a, a);",
  "}",
].join("\n");

/* The model id the worker reports, made readable for the hint line - family,
   tier, version and at most one qualifier: "claude-sonnet-5-5" -> "claude sonnet 5.5",
   "gemini-3.5-flash-lite" -> "gemini 3.5 flash lite",
   "@cf/meta/llama-3.3-70b-instruct-fp8-fast" -> "llama 3.3 70b instruct". */
function prettyModel(id) {
  const parts = String(id || "").replace(/^@cf[/][^/]+[/]/, "").toLowerCase().split("-");
  const out = [];
  for (const p of parts) {
    if (!p || /^[0-9]{6,}$/.test(p)) continue; // empty, or a date stamp
    const prev = out[out.length - 1];
    if (/^[0-9]{1,2}$/.test(p) && prev && /^[0-9]+$/.test(prev)) out[out.length - 1] = prev + "." + p;
    else out.push(p);
  }
  return out.slice(0, 4).join(" ");
}

/* the workings drawer's numbers: compact, one decimal past a thousand */
const kfmt = (n) => (typeof n !== "number" || !Number.isFinite(n) ? "-" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
/* the record carries cents; the drawer says dollars */
const usd = (cents) => {
  if (typeof cents !== "number") return "";
  if (cents <= 0) return "$0";
  const d = cents / 100;
  // four places for anything a Sonnet call costs; five for the small calls, so they read as figures rather than "<"
  const str = d.toFixed(d < 0.001 ? 5 : 4).replace(/0+$/, "").replace(/\.$/, ".0");
  return str === "0.0" ? "<$0.00001" : "$" + str;
};
/* what the sizer's words mean to a visitor, and what each figure is */
const KIND_WORDS = {
  chat: "small talk",
  fact: "fact lookup",
  explain: "explanation",
  compare: "comparison",
  tour: "tour",
  trick: "trick",
  other: "other",
};
const EFFORT_WORDS = { low: "direct", medium: "weighed it", high: "thought hard", xhigh: "thought hard", max: "thought hard" };
const WK_TIPS = {
  complexity: "A small, fast model (Claude Haiku) rates the question 1 to 5. It answers 1 and 2 itself; 3 to 5 are handed to Claude Sonnet.",
  effort: "How hard the answering model was told to think: low for 1-2, medium for 3, high for 4-5.",
  cache: "The 21k-token site prompt is cached for an hour; a hit costs a tenth of a fresh read. After an idle hour the next question writes it again, at twice the fresh price.",
  cost: "API fees for this reply: prompt, question, reasoning, answer and sizing. Writing the cache after an idle hour is a one-off, shown on the cache line and kept out of this figure.",
  time: "Grey is sizing, purple thinking, green writing; the steps beside carry the same colours and seconds.",
  steps: "Who did what: each call, its model, its time and its cost. Open one for the detail.",
  size: "Haiku rates the question 1 to 5 and names its kind, then hands it on: to itself for 1-2, to Sonnet for 3-5 with effort set by the rating.",
  pill: "A trick pressed in the help sheet: the page did the trick, so there is nothing to rate. The line about it goes straight to Haiku.",
  think: "Sonnet reasons before it writes (extended thinking at the effort set above): it weighs the facts, settles an order, checks the rules. This is its own summary of that, as it streamed. It is part of the answer's call, so its cost sits in that line. Haiku's small answers skip it.",
  reply: "Not a step: the reply itself, below in the chat. The model that wrote it, its length, the time it took and what that call cost.",
  tokens: "In is what was read fresh (the question and page context); out is the answer written. The cached prompt is the row above.",
  backup: "Claude was unavailable or over its daily cap, so a backup model answered: no sizing, reasoning, cache or cost to show.",
  answer: "The backup answered in one pass: no sizing, no reasoning.",
};

/* the help sheet: what the head can do, as tiles. Each is a thing to try,
   not a paragraph: an icon, a name, one line, and the question it sends. */
const HELP = [
  { id: "ask", c: "#9ed8ff", t: "ask", d: "projects, skills, how things were built", q: "what's the hardest thing you've built?" },
  { id: "rank", c: "#ffcb05", t: "rank", d: "a committed order, one reason each", q: "rank your three biggest projects" },
  { id: "go", c: "#b48bff", t: "go", d: "name a page or a project; it opens", q: "show me SPIM" },
  { id: "tour", c: "#78ffa8", t: "tour", d: "a few stops, one page at a time", q: "give me a tour" },
  { id: "here", c: "#ffb86b", t: "pick", d: "choose a project card on the page; I tell you about it", q: null, act: "pick" },
  { id: "work", c: "#c3a6ff", t: "workings", d: "who answered, how long, what it cost", q: null, act: "workings" },
];
/* the tricks, as pills: each performs its trick on the page and sends its
   words as the question for one line about it. The three looks are toggles:
   pressed while on, they switch the look off and send `off` instead. */
const LOOKS = [
  { id: "cloud", t: "cloud", q: "back to the cloud" },
  { id: "ghost", t: "ghost", q: "go ghost", off: "solid again" },
  { id: "lattice", t: "lattice", q: "lattice look", off: "drop the halftone" },
  { id: "wire", t: "wire", q: "go wireframe", off: "lose the wireframe" },
  { id: "spin", t: "spin", q: "give me a spin" },
  { id: "fire", t: "fire", q: "set yourself on fire" },
  { id: "tint", t: "colour", q: "make yourself blue" },
  { id: "scatter", t: "scatter", q: "scatter yourself" },
  { id: "melt", t: "melt", q: "melt" },
  { id: "shatter", t: "shatter", q: "shatter" },
  { id: "ember", t: "sparks", q: "turn to sparks" },
  { id: "glitch", t: "glitch", q: "glitch out" },
  { id: "hue", t: "rainbow", q: "run a rainbow across your face" },
];
const ICON = {
  ask: <path d="M4 5h16v10h-9l-5 4v-4H4z" />,
  rank: <path d="M3 20v-7h5v7M9.5 20V5h5v15M16 20v-10h5v10" />,
  go: <path d="M6 18L18 6M9 6h9v9" />,
  tour: (
    <>
      <path d="M5 17c5 0 3-10 8-10s3 10 8 10" />
      <circle cx="5" cy="17" r="2" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="21" cy="17" r="2" />
    </>
  ),
  here: (
    <>
      <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  work: (
    <>
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path d="M12 17l4-5" />
      <circle cx="12" cy="17" r="1.2" />
    </>
  ),
  cloud: (
    <>
      <circle cx="8" cy="9" r="1.1" />
      <circle cx="13" cy="7" r="1.1" />
      <circle cx="17" cy="11" r="1.1" />
      <circle cx="9" cy="14" r="1.1" />
      <circle cx="14" cy="13" r="1.1" />
      <circle cx="12" cy="18" r="1.1" />
      <circle cx="17" cy="16" r="1.1" />
      <circle cx="6" cy="18" r="1.1" />
    </>
  ),
  ghost: <circle cx="12" cy="12" r="7" strokeDasharray="2 3" />,
  lattice: (
    <>
      <circle cx="7" cy="8" r="1.4" />
      <circle cx="12" cy="8" r="1.4" />
      <circle cx="17" cy="8" r="1.4" />
      <circle cx="9.5" cy="12.5" r="1.4" />
      <circle cx="14.5" cy="12.5" r="1.4" />
      <circle cx="7" cy="17" r="1.4" />
      <circle cx="12" cy="17" r="1.4" />
      <circle cx="17" cy="17" r="1.4" />
    </>
  ),
  wire: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M4.5 12h15M12 4.5v15M6.5 7.5h11M6.5 16.5h11" />
    </>
  ),
  spin: <path d="M19 12a7 7 0 1 1-2-4.9M19 4v4h-4" />,
  fire: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-2-1-5 1-9z" />,
  tint: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  scatter: (
    <>
      <circle cx="12" cy="12" r="2" />
      <circle cx="4.5" cy="5" r="1.3" />
      <circle cx="19.5" cy="5.5" r="1.3" />
      <circle cx="5" cy="19" r="1.3" />
      <circle cx="19" cy="18.5" r="1.3" />
    </>
  ),
  melt: <path d="M4 7c3-3 13-3 16 0v4c0 3-3 3-5 1-1 3-1 6-3 8-2-2-2-5-3-8-2 2-5 2-5-1z" />,
  shatter: <path d="M12 3l7 5-2 9-5 4-5-4-2-9zM12 3l-1 8 5 1M11 11l-4 3M16 12l1 5" />,
  ember: <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />,
  glitch: <path d="M4 7h11M7 12h13M4 17h9M16 7h4M3 12h2" />,
  hue: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5v15M6.5 7l11 10M6.5 17l11-10" />
    </>
  ),
};
const Icon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON[id]}
  </svg>
);

/* the "?" sheet: tiles to click, swatches for the looks, the keys */
function HelpSheet({ onTry, onTrick, onWorkings, onPick, onClose, look }) {
  return (
    <section className="fh-help" aria-label="What this can do">
      <p className="fh-help-head">
        what I can do
        <button type="button" className="fh-wk-latest" onClick={onClose}>
          got it
        </button>
      </p>
      <div className="fh-help-grid">
        {HELP.map((h) => (
          <button
            key={h.id}
            type="button"
            className="fh-help-tile"
            style={chipStyle(h.c)}
            onClick={() => (h.act === "pick" ? onPick() : h.act === "workings" ? onWorkings() : onTry(h.q))}
          >
            <span className="fh-help-row">
              <span className="fh-help-ic">
                <Icon id={h.id} />
              </span>
              <span className="fh-help-t">{h.t}</span>
            </span>
            <span className="fh-help-d">{h.d}</span>
            <span className="fh-help-try">{h.q ? "\u201c" + h.q + "\u201d" : h.act === "pick" ? "pick a project \u203a" : "open the drawer \u203a"}</span>
          </button>
        ))}
      </div>
      <div className="fh-help-looks" role="group" aria-label="Tricks">
        <span className="fh-help-label">tricks</span>
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={"fh-help-look" + (look && look[l.id] ? " on" : "")}
            onClick={() => onTrick(l.id === "tint" ? "tint:#4f8cff" : l.id)}
            title={(() => {
              if (look && look[l.id]) return l.t + " (on - press again to turn it off)";
              /* what this press would switch off: the halftone stands alone */
              const swaps = { ghost: ["lattice"], lattice: ["ghost", "wire"], wire: ["lattice"] }[l.id] || [];
              const gone = look ? swaps.filter((k) => look[k]) : [];
              const word = { ghost: "ghost", lattice: "halftone", wire: "wireframe" };
              return gone.length ? l.t + " (takes the " + gone.map((k) => word[k]).join(" and the ") + " off)" : l.t;
            })()}
          >
            <Icon id={l.id} />
            <span>{l.t}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
const secs = (ms) => (typeof ms !== "number" || ms < 0 ? "" : ms < 50 ? "<0.1 s" : (ms / 1000).toFixed(1) + " s");
/* hover readings for the drawer's symbols and bar segments: the figure the
   mark stands for, in words ("1/5 (low) complexity", "46% tokens input") */
const CX_WORDS = ["", "low", "light", "medium", "high", "very high"];
const readCx = (c) => c + "/5 (" + (CX_WORDS[c] || "") + ") complexity";
const readEffort = (effort, level) => effort + " effort (" + level + " of 3)";
const readCache = (st) =>
  !st || typeof st.cached !== "number"
    ? ""
    : st.cached > 0
      ? "prompt cached: " + kfmt(st.cached) + " tokens read back"
      : st.cacheWrite > 0
        ? "prompt cache written: " + kfmt(st.cacheWrite) + " tokens, kept 1 h"
        : "prompt not cached: " + kfmt(st.in) + " tokens sent in full";
const pctOf = (part, total) => (total > 0 ? Math.round((100 * part) / total) + "%" : "0%");
const replies = (n) => n + (n === 1 ? " reply" : " replies");
const WORKINGS_KEY = "fh-workings"; // the drawer stays the way the visitor left it
/* a pointer that cannot hover (a phone): tooltips and previews toggle by tap */
const COARSE = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: none)").matches;

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

/* shown above the field while the transcript is empty: a fresh draw of
   things to try each time - the tour first, then questions and tricks */
const STARTER_ASKS = [
  "what's the hardest thing you've built?",
  "what did you build SPIM with?",
  "rank your projects",
  "what are you looking for next?",
  "are you available for contract work?",
  "where am I?",
  "how does this site work?",
  "what stack do you reach for?",
  "why is your head made of dots?",
  "what was it like growing up?",
];
const STARTER_STAR = "do a cool trick"; // always there, and lit: the model picks the trick (the showy ones first)
const drawFrom = (pool, n) => pool.slice().sort(() => Math.random() - 0.5).slice(0, n);
const pickStarters = () => ["give me a tour", STARTER_STAR].concat(drawFrom(STARTER_ASKS, 3));
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
  "show me the halftone version",
  "show me the wireframe",
  "what are you looking for next?",
  "do you like teaching?",
  "can you work in the UK?",
  "do a spin",
  "why is your head made of dots?",
  "breathe fire",
  "what is SPIM?",
  "go blue",
  "scatter yourself",
  "glitch out",
  "melt",
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

/* ---------- the face, shared by the dots and the wire ----------
   A blink lowers the lids, speech parts the lips (jaw is the per-vertex
   weight baked around the mouth seam); uRegions gates on the real head,
   since the procedural stand-in has no regions to deform. */
const FACE_GLSL = `
uniform float uBlink;
uniform float uMouth;
uniform float uMouthW;
uniform float uRegions;
float eyeW(vec3 p, vec3 c, vec3 r) {
  return 1.0 - smoothstep(0.45, 1.0, length((p - c) / r));
}
vec3 applyFace(vec3 p, float jaw, out float glow) {
  glow = 0.0;
  if (uRegions > 0.5) {
    p.y = mix(p.y, ${g4(EYE_L.lid)}, eyeW(p, ${gv3(EYE_L.c)}, ${gv3(EYE_L.rad)}) * uBlink);
    p.y = mix(p.y, ${g4(EYE_R.lid)}, eyeW(p, ${gv3(EYE_R.c)}, ${gv3(EYE_R.rad)}) * uBlink);
    p.y += uMouth * ${g4(LIP_GAP)} * jaw;
    float wLip = smoothstep(0.02, 0.2, abs(jaw));
    float uAx = clamp((2.0 * p.x - (${g4(MOUTH_X0)}) - (${g4(MOUTH_X1)})) / ${g4(MOUTH_X1 - MOUTH_X0)}, -1.0, 1.0);
    float cornerW = smoothstep(0.1, 0.85, abs(uAx));
    p.x += (p.x - (${g4(MOUTH_CX)})) * (uMouthW - 1.0) * 0.6 * wLip * cornerW;
    p.z += (1.0 - uMouthW) * 0.1 * wLip;
    glow = uMouth * (1.0 - smoothstep(0.35, 1.0, length((p - ${gv3(MOUTH_GLOW.c)}) / ${gv3(MOUTH_GLOW.r)})));
  }
  return p;
}
`;

const WIRE_VERT = [
  "attribute vec3 aNormal; attribute vec3 aColor; attribute vec3 aMid; attribute float aJaw; uniform vec2 uNeck; varying vec3 vColor; varying float vA;",
  FX_VERT_GLSL,
  FACE_GLSL,
  "void main(){ vec3 n = normalize(normalMatrix * aNormal); float facing = smoothstep(-0.2, 0.6, n.z);",
  "  vA = (0.12 + 0.88 * facing) * smoothstep(uNeck.x, uNeck.y, position.y); vColor = aColor; float glow; vec3 p = applyFace(position, aJaw, glow); p = applyFx(p, aMid);",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); vNdc = gl_Position.xy / max(0.001, gl_Position.w); }",
].join("\n");
const WIRE_FRAG = [
  "uniform float uAlpha; varying vec3 vColor; varying float vA;",
  FX_FRAG_GLSL,
  "void main(){ vec3 col = applyFxColor(vColor, max(max(vColor.r, vColor.g), vColor.b)); gl_FragColor = vec4(col, uAlpha * vA * vFxFade * edgeFade()); }",
].join("\n");

const VERT = `
attribute vec3 aColor;
attribute float aJaw;
uniform float uSize;
uniform float uDpr;
varying vec3 vColor;
varying float vFacing;
varying float vGlow;
varying float vKey;
varying float vCut;
uniform vec4 uPlanes[4]; // the neck cut: normals (xyz) and offsets (w); kept where n.p - d >= 0 for every plane
uniform int uPlaneCount;
${FX_VERT_GLSL}
${FACE_GLSL}

void main() {
  vColor = aColor;
  vGlow = 0.0;
  vec3 p = position;
  float glow;
  p = applyFace(p, aJaw, glow);
  vGlow = glow;
  p = applyFx(p, position);
  /* distance from the crown: the colour trick's wash sweeps this field,
     so the tint pours down over the head instead of switching on */
  vKey = length(p - vec3(0.0, 1.35, 0.0));
  vCut = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i < uPlaneCount) vCut *= smoothstep(0.0, ${g4(NECK_BAND)}, dot(uPlanes[i].xyz, position) - uPlanes[i].w);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = smoothstep(-0.35, 0.55, n.z);
  /* speaking dots swell with the glow - additive sprites overlap and fuse,
     so the moving lip reads as a continuous band instead of separate dots */
  gl_PointSize = ((uSize * uDpr) / max(0.001, -mv.z)) * (1.0 + 0.4 * vGlow);
  gl_Position = projectionMatrix * mv;
  vNdc = gl_Position.xy / max(0.001, gl_Position.w);
}`;

const FRAG = [
  "uniform sampler2D uMap;",
  "uniform vec3 uTint;",
  "uniform float uTintMix;",
  "uniform float uTintEdge;",
  "uniform float uGhost;",
  "uniform float uAlpha;",
  "varying vec3 vColor;",
  "varying float vFacing;",
  "varying float vGlow;",
  "varying float vKey;",
  "varying float vCut;",
  FX_FRAG_GLSL,
  "void main() {",
  "  vec4 t = texture2D(uMap, gl_PointCoord);",
  // the back-face floor RISES while ghosted: the trick is showing the far
  // side, and at the solid-state floor of 2% there would be nothing to see
  "  float fl = 0.02 + 0.35 * uGhost;",
  "  float a = t.a * (fl + (1.0 - fl) * vFacing) * uAlpha;",
  "  a *= vCut;",
  "  if (a < 0.012) discard;",
  // keep each point's own brightness when tinting, so the shading survives
  "  float lum = max(max(vColor.r, vColor.g), vColor.b);",
  // wave front: dots the sweep has passed are tinted, dots ahead are not;
  // the hover tint parks the edge at 99 so it covers instantly as before
  "  float wave = 1.0 - smoothstep(uTintEdge - 0.35, uTintEdge + 0.05, vKey);",
  "  vec3 col = mix(vColor, uTint * lum, uTintMix * wave);",
  "  col *= 1.0 + 1.35 * vGlow;",
  // the performed tricks' colour work: the sweep, the sparks' glow, the glitch's split
  "  col = applyFxColor(col, lum);",
  "  a *= vFxFade * edgeFade();",
  "  gl_FragColor = vec4(col, a);",
  "}",
].join("\n");

/* ---------- project name -> write-up link ----------
   Superimposed on the finished reply, not asked of the model: it writes
   plain prose and never sees a URL or any markup, and any project it happens
   to name is turned into a link here. Nothing for the model to get wrong,
   and nothing to keep in sync - a new project becomes linkable the moment it
   is in the list.
   Matching is accent-blind BOTH ways ("Pokecompare" and "Pokecompare" with
   an accented e both find the same card, and a plain "Motam" finds Motam),
   and tolerant of odd spacing, because people and models spell these
   however they please. */
const COMBINING = /[\u0300-\u036f]/g;
const refKey = (t) =>
  t
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/\band\b/g, "&") // models write "and" where a title has "&"
    .replace(/\s+/g, " ")
    .trim();

/* every letter that commonly carries an accent matches its whole family */
const ACCENT_SETS = {
  a: "aàáâãäåā",
  c: "cç",
  e: "eèéêëē",
  i: "iìíîïī",
  n: "nñ",
  o: "oòóôõöō",
  u: "uùúûüū",
  y: "yýÿ",
};

const charPattern = (ch) => {
  if (/\s/.test(ch)) return "\\s+";
  if (ch === "&") return "(?:&|and)"; // "Tech & Curriculum" vs "Tech and Curriculum"
  const base = refKey(ch);
  if (ACCENT_SETS[base]) return "[" + ACCENT_SETS[base] + "]";
  return /[a-z0-9]/i.test(ch) ? ch : "\\" + ch;
};

const PROJECT_REFS = projects
  .flatMap((p) => {
    /* linkable by the short name AND any listed aliases - the names prose
       actually uses ("Compassion Course" for "Compassion Course Online") */
    const slug = projectSlug(p.title);
    return [projectShortName(p.title)]
      .concat(p.aliases || [])
      .map((name) => ({ name, slug, color: p.color }));
  })
  /* short names would fire on ordinary prose */
  .filter((p) => p.name.length >= 4)
  .map((p) => ({ key: refKey(p.name), to: "/projects#" + p.slug, pattern: null, name: p.name, color: p.color }));

/* a project chip wears its card's colour: the hex becomes the text colour
   and two translucent shades of itself for the border and the fill */
function chipStyle(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return {
    "--chip": "#" + m[1],
    "--chip-border": "rgba(" + r + "," + g + "," + b + ",0.45)",
    "--chip-bg": "rgba(" + r + "," + g + "," + b + ",0.1)",
  };
}

/* ---------- the site's own pages ----------
   Only QUALIFIED phrases: "about" and "skills" are ordinary English words and
   linking them bare would pepper every reply with false links, so a page word
   only counts when it comes with page/section/map, or is distinctive on its
   own ("diploma", "resume"). */
/* each page's chip wears its landing card's colour (Landing.css .card-N) */
const PAGE_COLORS = { "/skills": "#ff72a1", "/projects": "#b48bff", "/about": "#7fd3ff", "/resume": "#78ffa8" };
const PAGE_REFS = [
  { phrase: "skills map", to: "/skills" },
  { phrase: "skills page", to: "/skills" },
  { phrase: "skills section", to: "/skills" },
  { phrase: "projects page", to: "/projects" },
  { phrase: "projects section", to: "/projects" },
  { phrase: "project write-ups", to: "/projects" },
  { phrase: "write-ups", to: "/projects" },
  { phrase: "about page", to: "/about" },
  { phrase: "about section", to: "/about" },
  { phrase: "resume page", to: "/resume" },
  /* "resume" is also a verb ("I will resume that thought"), so it only
     counts when it is clearly the document */
  { phrase: "my resume", to: "/resume" },
  { phrase: "the resume", to: "/resume" },
  /* deep link: Resume.js opens on the diploma when the hash asks for it */
  { phrase: "diploma", to: "/resume#diploma" },
];

/* ---------- skills deep links ----------
   The skills map accepts /skills#sel=Python,PyTorch and preselects those
   nodes. When a reply names skills AND points at the skills map, the link
   carries the named ones. The id list is the same skillsData.json the map
   renders from - fetched lazily when the chat opens; until it arrives (or
   if it never does) skills links stay plain /skills, which always works. */
let SKILL_IDS = [];
let SKILL_IDS_ALL = []; // every id, for exact matches (action tokens)
let skillIdsRequested = false;
const ensureSkillIds = () => {
  if (skillIdsRequested) return;
  skillIdsRequested = true;
  fetch(process.env.PUBLIC_URL + "/skillsData.json")
    .then((r) => r.json())
    .then((j) => {
      const ids = (j.skillNodes || []).map((n) => String(n.id));
      SKILL_IDS_ALL = ids;
      /* "C" alone would fire on any stray capital letter in prose */
      SKILL_IDS = ids.filter((id) => id.length >= 3);
    })
    .catch(() => {});
};

const skillsHashFor = (text) => {
  if (!SKILL_IDS.length) return "";
  const found = [];
  for (const id of SKILL_IDS) {
    const pat = new RegExp(
      "(^|[^A-Za-z0-9])" +
        id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "($|[^A-Za-z0-9#+])",
      "i"
    );
    if (pat.test(text)) {
      found.push(id);
      if (found.length >= 6) break; // a link, not an inventory
    }
  }
  return found.length ? "#sel=" + found.map(encodeURIComponent).join(",") : "";
};

const phrasePattern = (t) =>
  t
    .split(/\s+/)
    .map((w) => w.replace(/[^\w-]/g, (c) => "\\" + c))
    .join("\\s+");

/* one ordered table drives both the matcher and the lookup; longest key first
   so "project write-ups" wins over "write-ups" and a long project name wins
   over any shorter name nested inside it */
const LINK_ENTRIES = PROJECT_REFS.map((p) => ({
  key: p.key,
  to: p.to,
  color: p.color,
  pattern: Array.from(p.name).map(charPattern).join(""),
}))
  .concat(
    PAGE_REFS.map((p) => ({
      key: refKey(p.phrase),
      to: p.to,
      color: PAGE_COLORS[p.to.split("#")[0]],
      pattern: phrasePattern(p.phrase),
    }))
  )
  .sort((a, b) => b.key.length - a.key.length);

/* word-bounded, or a name would match inside a longer word: "Simone"
   would light up "Simon" and "SPIMulator" would light up "SPIM". */
const REF_RX = new RegExp(
  "(" + LINK_ENTRIES.map((e) => "\\b" + e.pattern + "\\b").join("|") + ")",
  "gi"
);

/* E-mail addresses are linkified by US, deliberately: WebKit's data
   detectors (Safari, and every iPhone browser, since they all wrap WebKit)
   otherwise inject their own <a> around an address in text React believes
   it owns, and the next re-render reconciles against DOM that no longer
   matches - a commit-phase throw that unmounts the whole app. Text that is
   already inside an anchor is left alone by the detector, so rendering the
   real mailto link removes the crash AND makes the address tappable. */
const EMAIL_RX = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function emailifyText(text) {
  const parts = String(text).split(EMAIL_RX);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={"mailto:" + part} className="fh-mail">
        {part}
      </a>
    ) : (
      part
    )
  );
}

/* The reply cut into plain text, site links and e-mail addresses, in order:
   [{ text, to? , mailto? }]. The pieces concatenate back to the exact text,
   which is what lets renderReply keep character offsets while it wraps
   words. Same matching as before: longest name first, word-bounded, accent-
   blind; a skills-map link carries the skills the reply names. */
/* the words that do something when asked: in a reply each is a chip that
   asks for it; in the visitor's own line each is marked, so the word that
   set the head off is visible */
/* kind: the token the head performs on its own when the chip is clicked -
   no question is sent, no reply comes back, the trick just happens. The
   tour has no kind: it is a conversation, so it is still asked for. */
const TRICK_REFS = [
  { word: "ghost", q: "become a ghost", kind: "ghost" },
  { word: "halftone", q: "show me the halftone version", kind: "lattice" },
  { word: "wireframe", q: "show me the wireframe", kind: "wire" },
  { word: "spin", q: "do a spin", kind: "spin" },
  { word: "fire", q: "breathe fire", kind: "fire" },
  { word: "tour", q: "give me a tour" },
  { word: "scatter", q: "scatter yourself", kind: "scatter" },
  { word: "melt", q: "melt", kind: "melt" },
  { word: "shatter", q: "shatter", kind: "shatter" },
  { word: "sparks", q: "turn to sparks", kind: "ember" },
  { word: "glitch", q: "glitch out", kind: "glitch" },
  { word: "rainbow", q: "run a rainbow across your face", kind: "hue" },
];
const TRICK_RX = new RegExp("\\b(" + TRICK_REFS.map((t) => t.word).join("|") + ")\\b", "i");
const trickFor = (word) => TRICK_REFS.find((t) => t.word === String(word).toLowerCase());

function linkParts(text) {
  const parts = String(text).split(REF_RX);
  const out = [];
  let skillsHash = null; // computed once per reply, only if a skills link exists
  parts.forEach((part) => {
    if (!part) return;
    const hit = LINK_ENTRIES.find((e) => e.key === refKey(part));
    if (hit) {
      let to = hit.to;
      if (to === "/skills") {
        if (skillsHash === null) skillsHash = skillsHashFor(String(text));
        to = "/skills" + skillsHash;
      }
      out.push({ text: part, to, color: hit.color });
      return;
    }
    const sub = part.split(EMAIL_RX);
    for (let j = 0; j < sub.length; j++) {
      if (!sub[j]) continue;
      if (j % 2 === 1) {
        out.push({ text: sub[j], mailto: sub[j] });
        continue;
      }
      const words = sub[j].split(TRICK_RX);
      for (let k = 0; k < words.length; k++) {
        if (!words[k]) continue;
        const tr = k % 2 === 1 ? trickFor(words[k]) : null;
        out.push(tr ? { text: words[k], trick: tr.q, kind: tr.kind || null } : { text: words[k] });
      }
    }
  });
  return out;
}

/* the visitor's own line: the trick words marked, e-mail addresses linked */
function userText(text) {
  const words = String(text || "").split(TRICK_RX);
  return words.map((w, i) =>
    i % 2 === 1 && trickFor(w) ? (
      <span key={i} className="fh-trick-word">
        {w}
      </span>
    ) : (
      <React.Fragment key={i}>{emailifyText(w)}</React.Fragment>
    )
  );
}

/* ---------- reply typography ----------
   The first clause of each paragraph is set a shade brighter: the opening
   is where the answer is, the rest is the reasoning. A clause is text up to
   the first sentence end, or the first comma/colon/dash past the sixteenth
   character, within ninety; a paragraph with no boundary yet is left
   undecided while it streams (so nothing brightens and then dims as more
   arrives - the emphasis settles once, when the clause is known), and
   settled at a word boundary near 72 once the reply is complete.
   Returns [start, end) ranges in text offsets. */
const BOUNDARY_RX = /[.!?](?=\s|$)|[:;,](?=\s)|\s[-\u2013\u2014]\s/g;
function leadRanges(text, settled) {
  const ranges = [];
  const rx = /\n\s*\n/g;
  let at = 0;
  const paras = [];
  let m;
  while ((m = rx.exec(text))) {
    paras.push([at, m.index]);
    at = m.index + m[0].length;
  }
  paras.push([at, text.length]);
  paras.forEach(([start, end], i) => {
    const para = text.slice(start, end);
    const last = i === paras.length - 1;
    let lead = -1;
    BOUNDARY_RX.lastIndex = 0;
    let b;
    while ((b = BOUNDARY_RX.exec(para))) {
      if (b.index < 16) continue;
      lead = b.index <= 90 ? b.index + (b[0].length === 1 ? 1 : 0) : 0;
      break;
    }
    if (lead === -1) {
      if (!settled && last && para.length <= 90) return; // undecided for now
      if (para.length <= 72) lead = para.length;
      else {
        const cut = para.lastIndexOf(" ", 72);
        lead = cut > 16 ? cut : 72;
      }
    }
    if (lead > 0) ranges.push([start, start + lead]);
  });
  return ranges;
}

/* Words are wrapped one by one so each can fade in as it arrives (the
   stream delivers them a few at a time, which is pacing enough - the mouth
   follows behind at speaking speed), project and page names become chips
   that lead to their write-up, and e-mail addresses are OUR anchors, which
   is what keeps WebKit's data detectors from injecting their own into text
   React owns (see EMAIL_RX). Whitespace is left as-is so pre-wrap keeps the
   paragraph breaks. Only a reply still being spoken animates: a restored
   transcript renders settled. */
/* a reply: plain runs rendered inline, folds as closed sections */
function renderReply(text, onNavigate, live, onAsk) {
  if (!text) return null;
  const out = [];
  splitMore(text).forEach((seg, i) => {
    if (seg.title != null) {
      out.push(
        <details key={"d" + i} className={"fh-fold" + (live ? " fh-in" : "")}>
          <summary>{seg.title}</summary>
          <div className="fh-fold-body">{renderInline(seg.body, onNavigate, live, onAsk, "d" + i)}</div>
        </details>
      );
    } else {
      out.push(...renderInline(seg.text, onNavigate, live, onAsk, "s" + i));
    }
  });
  return out;
}

function renderInline(text, onNavigate, live, onAsk, keyBase) {
  if (!text) return [];
  const leads = leadRanges(String(text), !live);
  const isLead = (at) => leads.some(([a, b]) => at >= a && at < b);
  const out = [];
  let pos = 0;
  let key = 0;
  const fade = live ? " fh-in" : "";
  const k = (prefix) => keyBase + prefix + key++;
  for (const part of linkParts(text)) {
    if (part.to) {
      out.push(
        <Link key={k("l")} to={part.to} className={"fh-proj-link" + fade} style={chipStyle(part.color)} onClick={onNavigate}>
          {part.text}
        </Link>
      );
    } else if (part.mailto) {
      out.push(
        <a key={k("m")} href={"mailto:" + part.mailto} className={"fh-mail" + fade}>
          {part.text}
        </a>
      );
    } else if (part.trick) {
      out.push(
        <button
          key={k("t")}
          type="button"
          className={"fh-trick-link" + fade}
          title={part.kind ? part.text : "\u201c" + part.trick + "\u201d"}
          onClick={() => onAsk && onAsk(part.trick, part.kind)}
        >
          {part.text}
        </button>
      );
    } else {
      for (const piece of part.text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          out.push(piece);
        } else {
          out.push(
            <span key={k("w")} className={"fh-w" + (isLead(pos) ? " fh-lead" : "") + fade}>
              {piece}
            </span>
          );
        }
        pos += piece.length;
      }
      continue;
    }
    pos += part.text.length;
  }
  return out;
}

/* ---------- guided tours ----------
   A tour is one reply played as a sequence of stops: at each, the page
   behind the chat opens something (a project card, the skills map with a
   selection, the diploma, a page) and the head says a sentence or two about
   it, then moves on after a pause - or when the visitor presses Enter, or
   "next" - and stops on Escape, a click on the page, or "stop".
   The controller lives OUTSIDE React on purpose. Moving between the landing
   page and any other route swaps which FloatingHead is mounted (Landing
   renders its own, App.js the corner one), so the instance that started the
   tour is often gone by the second stop. The controller keeps the stops,
   the timer and the transcript; whichever head is mounted registers as its
   stage and receives the words. The transcript is written to localStorage
   before every move, which is how the next head wakes up mid-conversation. */
const TOUR = {
  running: false,
  streaming: false, // the reply is still arriving; later stops may follow
  steps: [],
  index: -1, // the stop on screen
  maxShown: -1, // the furthest stop reached, for the transcript
  waiting: false, // the pause has elapsed but the next stop is not complete yet
  manual: true, // the visitor drives: the tour never moves on by itself
  ended: false, // the last stop has had its time; the caption stays until dismissed
  timer: 0,
  stage: null, // the mounted head: { navigate, setMsgs, speak, onPage, onTour }
  pending: null, // words for the next stage to speak, when a move swaps heads
  transcript: null,
  replyAt: -1,
  shown: "",
  abort: null,
  stats: null, // the reply's stats record and reasoning, once the stream ends
  thinking: "",
};

/* the model that answered last, kept across head instances for the same
   reason: the hint line should not forget who is talking after a move */
let LAST_MODEL = "";

const tourPersist = () => {
  try {
    if (TOUR.transcript) localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(TOUR.transcript.slice(-40)));
  } catch (err) {
    // private mode, or the quota is full
  }
};

/* the transcript's copy of the tour: the words said so far (what the model
   sees later), plus the stops and the position, so the chat can show it as
   one compact card and reopen it from where it was left */
function tourRecord() {
  if (!TOUR.transcript || TOUR.replyAt >= TOUR.transcript.length) return;
  const steps = TOUR.steps.filter((st) => st.done).map(({ act, text }) => ({ act, text }));
  const m = { role: "assistant", content: TOUR.shown, tour: { steps, index: TOUR.index, ended: TOUR.ended } };
  if (TOUR.thinking) m.thinking = TOUR.thinking;
  if (TOUR.stats) m.stats = TOUR.stats;
  TOUR.transcript = TOUR.transcript.slice();
  TOUR.transcript[TOUR.replyAt] = m;
  tourPersist();
}

/* the stream has ended: its stats and reasoning ride with the tour's message */
function tourMeta(stats, thinking) {
  if (!TOUR.running) return;
  TOUR.stats = stats || null;
  TOUR.thinking = thinking || "";
  tourRecord();
}

/* what the caption shows: one stop at a time, never a growing stack */
const tourPage = () => ({
  i: TOUR.index,
  n: TOUR.steps.length,
  more: TOUR.streaming,
  waiting: TOUR.waiting,
  ended: TOUR.ended,
  text: TOUR.index >= 0 && TOUR.steps[TOUR.index] ? TOUR.steps[TOUR.index].text : "",
});

function tourStart(transcript, replyAt, abort) {
  clearTimeout(TOUR.timer);
  Object.assign(TOUR, {
    running: true, streaming: true, steps: [], index: -1, maxShown: -1, waiting: false, manual: true, ended: false,
    timer: 0, pending: null, transcript, replyAt, shown: "", abort, stats: null, thinking: "",
  });
  if (TOUR.stage) {
    TOUR.stage.onTour(true, "start");
    TOUR.stage.onPage(tourPage());
  }
}

/* called on every chunk of the tour reply with the raw text so far, and once
   more with final=true: a stop can begin before the next one has arrived */
function tourFeed(raw, final) {
  if (!TOUR.running) return;
  TOUR.steps = splitTourSteps(raw, final);
  if (final) TOUR.streaming = false;
  if (TOUR.index === -1 || TOUR.waiting) tourAdvance();
  else if (TOUR.stage) TOUR.stage.onPage(tourPage());
}

function tourDeliver() {
  const stage = TOUR.stage;
  if (!stage) return;
  if (TOUR.transcript) stage.setMsgs(TOUR.transcript.slice());
  if (TOUR.pending) {
    stage.speak(TOUR.pending);
    TOUR.pending = null;
  }
  stage.onPage(tourPage());
}

/* show stop i: move the page behind the caption, say the words. The
   transcript (what the model sees later, what a reload restores) grows only
   when a NEW stop is reached, so going back never duplicates a line. */
function tourShow(i) {
  const step = TOUR.steps[i];
  if (!step) return;
  TOUR.index = i;
  TOUR.waiting = false;
  if (i > TOUR.maxShown) {
    TOUR.maxShown = i;
    TOUR.shown = TOUR.shown ? TOUR.shown + "\n\n" + step.text : step.text;
  }
  tourRecord();
  const to = step.act ? resolveAction(step.act, { skillIds: SKILL_IDS_ALL, projectRefs: PROJECT_REFS }) : null;
  const here = window.location.pathname + window.location.hash;
  /* leaving or returning to "/" swaps heads: the words wait for the new one */
  const crosses = !!to && (window.location.pathname === "/") !== (to.split("#")[0] === "/");
  TOUR.pending = step.text;
  if (to && to !== here && TOUR.stage) TOUR.stage.navigate(to);
  if (!crosses) tourDeliver();
}

/* the next stop, by "next" (or the first one, as soon as it has arrived):
   the tour never moves on by itself - the visitor reads at their own pace
   and presses next and back */
function tourAdvance() {
  if (!TOUR.running || TOUR.ended) return;
  clearTimeout(TOUR.timer);
  const next = TOUR.index + 1;
  const step = TOUR.steps[next];
  if (!step || !step.done) {
    if (TOUR.streaming) {
      TOUR.waiting = true; // the rest is on its way
      if (TOUR.stage) TOUR.stage.onPage(tourPage());
      return;
    }
    tourFinish();
    return;
  }
  tourShow(next);
}

/* the last stop has had its time: the caption stays, with back and close,
   until the visitor dismisses it or asks something else */
function tourFinish() {
  clearTimeout(TOUR.timer);
  TOUR.ended = true;
  if (TOUR.stage) TOUR.stage.onPage(tourPage());
  tourRecord();
}

/* a tour left earlier, reopened from its card in the transcript at the stop
   it was on; the visitor drives it from there (no clock until "next") */
function tourResume(transcript, replyAt) {
  const m = transcript[replyAt];
  if (!m || !m.tour || !m.tour.steps.length) return;
  if (TOUR.running) tourEnd("stop");
  clearTimeout(TOUR.timer);
  const steps = m.tour.steps.map((st) => ({ act: st.act, text: st.text, done: true }));
  Object.assign(TOUR, {
    running: true, streaming: false, steps, index: -1, maxShown: steps.length - 1, waiting: false, manual: true,
    ended: false, timer: 0, pending: null, transcript, replyAt, shown: m.content, abort: null,
    stats: m.stats || null, thinking: m.thinking || "",
  });
  if (TOUR.stage) TOUR.stage.onTour(true, "resume");
  tourShow(Math.min(steps.length - 1, Math.max(0, m.tour.index || 0)));
}

function tourNext() {
  if (!TOUR.running || TOUR.ended) return;
  tourAdvance();
}

function tourBack() {
  if (!TOUR.running || TOUR.index <= 0) return;
  clearTimeout(TOUR.timer);
  TOUR.ended = false;
  tourShow(TOUR.index - 1);
}

function tourEnd(reason) {
  if (!TOUR.running) return;
  clearTimeout(TOUR.timer);
  tourRecord(); // where it was left, for the card in the transcript
  TOUR.running = false;
  TOUR.streaming = false;
  TOUR.waiting = false;
  TOUR.ended = false;
  TOUR.pending = null;
  if (TOUR.abort && reason !== "done") {
    try {
      TOUR.abort.abort(); // the rest of the reply is not wanted
    } catch (err) {
      // already finished
    }
  }
  TOUR.abort = null;
  if (TOUR.stage) {
    if (TOUR.transcript) TOUR.stage.setMsgs(TOUR.transcript.slice());
    TOUR.stage.onTour(false, reason);
  }
}

/* "pick": the chat shrinks to the caption on the projects page and asks the
   visitor to click a card; the click becomes "tell me about this one".
   Module-level like the tour, since reaching the projects page from the
   landing page swaps which head is mounted. */
const PICK = { running: false };
function pickStart() {
  PICK.running = true;
  if (TOUR.stage && TOUR.stage.onPick) TOUR.stage.onPick(true);
}
function pickEnd() {
  if (!PICK.running) return;
  PICK.running = false;
  if (TOUR.stage && TOUR.stage.onPick) TOUR.stage.onPick(false);
}

function tourRegister(stage) {
  TOUR.stage = stage;
  if (TOUR.running) {
    stage.onTour(true, "resume");
    tourDeliver();
  } else if (PICK.running && stage.onPick) {
    stage.onPick(true);
  }
}
function tourUnregister(stage) {
  if (TOUR.stage === stage) TOUR.stage = null;
}

/* Any render crash inside the chat would otherwise unmount the WHOLE app -
   React tears the tree down when a commit throws with no boundary above it,
   and the visitor sees a blank page. The chat is the one place third-party
   text (model replies, restored transcripts, browser-injected DOM) meets
   the renderer, so it gets a boundary: the fallback swaps in, the possibly
   poisoned saved transcript is dropped, and the site never notices. */
class ChatShield extends React.Component {
  constructor(props) {
    super(props);
    this.state = { broken: false };
  }
  static getDerivedStateFromError() {
    return { broken: true };
  }
  componentDidCatch() {
    try {
      localStorage.removeItem(CHAT_LOG_KEY);
    } catch (err) {
      // storage unavailable - nothing to clear
    }
  }
  render() {
    if (this.state.broken) {
      return (
        <div className="fh-chat" onClick={(e) => e.stopPropagation()}>
          <p className="fh-msg fh-assistant">
            <span className="fh-who">hyder</span>
            The chat hit a snag and cleared itself. Ask again?
          </p>
          <button type="button" className="fh-more" onClick={this.props.onReset}>
            restart chat
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  big = false, // a large parked portrait (the /focus prototype): drawn direct, not through the small-host texture
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
    look: readLook(), // persistent looks: { ghost, lattice }
    small: false, // the host is one of the small ones (portrait, tour head)
    rtFactor: -1, // supersampling factor for the texture path: 0 = draw direct, -1 = layout() has not decided yet
    headCss: 0, // the head's on-screen height, CSS px
    latticeSolid: true, // the halftone prints the filled head; the bare dots serve until the shell arrives
  });
  /* a head mounted while a tour is running (the move swapped heads) opens
     straight into it */
  const [open, setOpen] = useState(() => TOUR.running || PICK.running);
  const [tour, setTour] = useState(() => TOUR.running);
  const [pick, setPick] = useState(() => PICK.running);
  const [pickHover, setPickHover] = useState(""); // the card under the pointer while picking
  const [tourMin, setTourMin] = useState(false); // the caption folded to the head and a pill
  /* clearing the conversation takes a hold, not a click: the pill fills
     while the pointer (or Enter) is held, and lets go without harm before
     it is full */
  const HOLD_MS = 900;
  const [holdT, setHoldT] = useState(0); // 0..1, how far through the hold
  const holdRef = useRef({ timer: 0, start: 0, done: false });
  const clearChat = () => {
    if (TOUR.running) tourEnd("stop");
    if (PICK.running) pickEnd();
    setMsgs([]);
    setShowAll(false);
    setWkFocus(null);
    setWkTab("reply");
    setWkList(false);
    setWkPeek(null);
    setThinking("");
    setStats(null);
    try {
      localStorage.removeItem(CHAT_LOG_KEY);
    } catch (err) {
      // private mode
    }
  };
  const holdStart = (e) => {
    if (e && e.repeat) return; // a held key repeats its keydown
    if (e && e.preventDefault) e.preventDefault();
    const h = holdRef.current;
    if (h.timer) return;
    h.start = performance.now();
    h.done = false;
    /* a timer, not requestAnimationFrame: the fill is judged by the clock,
       so a throttled frame rate (a background tab, a busy phone) changes how
       smoothly it draws, never how long the hold takes */
    h.timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - h.start) / HOLD_MS);
      setHoldT(t);
      if (t >= 1) {
        clearInterval(h.timer);
        h.timer = 0;
        h.done = true;
        clearChat();
        setHoldT(0);
      }
    }, 30);
  };
  const holdEnd = () => {
    const h = holdRef.current;
    if (h.timer) clearInterval(h.timer);
    h.timer = 0;
    setHoldT(0);
  };
  const caption = tour || pick; // the small-head, page-visible layout
  const [tourPage, setTourPage] = useState({ i: -1, n: 0, more: false, waiting: false, ended: false, text: "" });
  const [lookEpoch, setLookEpoch] = useState(0); // bumped when a look changes, so layout() re-decides the draw path
  const navigate = useNavigate(); // action tokens open pages from the chat
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const chatRef = useRef(null);
  const tourHeadRef = useRef(null);
  const sendSeq = useRef(0);
  /* the mouth is mid-word: the reply's typing cue pulses with it */
  const [speaking, setSpeaking] = useState(false);
  /* behind the curtain: the model's summarised reasoning as it streams, and
     the stats record each reply ends with; the drawer that shows them */
  const [thinking, setThinking] = useState("");
  const [stats, setStats] = useState(null);
  const [workings, setWorkings] = useState(() => {
    try {
      return localStorage.getItem(WORKINGS_KEY) === "1";
    } catch (err) {
      return false;
    }
  });
  const [wkOpen, setWkOpen] = useState({}); // which pipeline steps are unfolded
  const [wkFocus, setWkFocus] = useState(null); // a particular reply's workings, by index in msgs; null = the latest
  const [help, setHelp] = useState(false); // the "what I can do" sheet
  /* "workings" pressed while the drawer is already open: its outline goes
     white for a moment, so the click still points at something */
  const [wkFlash, setWkFlash] = useState(false);
  const wkFlashT = useRef(0);
  const flashWorkings = () => {
    clearTimeout(wkFlashT.current);
    setWkFlash(false); // off now and on next frame, so a second press restarts the animation
    requestAnimationFrame(() => {
      setWkFlash(true);
      wkFlashT.current = setTimeout(() => setWkFlash(false), 1900);
    });
  };
  useEffect(() => () => clearTimeout(wkFlashT.current), []);
  const [starters, setStarters] = useState(pickStarters); // re-drawn whenever the transcript empties
  const [wkTab, setWkTab] = useState("reply"); // "reply" | "summary"
  const [wkList, setWkList] = useState(false); // the list of replies under the tab
  const [wkPeek, setWkPeek] = useState(null); // a reply whose question and answer are shown in the list (phones)
  const [wkHover, setWkHover] = useState(null); // the reply under the pointer: its words float at the top of the screen
  /* tooltips on a phone: nothing hovers, so a tap on the label toggles it */
  const [tipOn, setTipOn] = useState(null);
  const tipCls = (id) => (tipOn === id ? " fh-tip-on" : "");
  const tipTap = (id) => (COARSE ? () => setTipOn((v) => (v === id ? null : id)) : undefined);
  const tipTapStop = (id) =>
    COARSE
      ? (e) => {
          e.stopPropagation(); // the label, not the row's button
          setTipOn((v) => (v === id ? null : id));
        }
      : undefined;
  useEffect(() => {
    if (tipOn == null) return undefined;
    const off = (e) => {
      if (!(e.target && e.target.closest && e.target.closest(".fh-tip-on"))) setTipOn(null);
    };
    document.addEventListener("click", off, true);
    return () => document.removeEventListener("click", off, true);
  }, [tipOn]);
  /* readings: a bubble over a symbol or a bar segment with the figure it
     stands for ("3/5 (medium) complexity", "46% tokens input"). Hover on a
     fine pointer; on a coarse one a tap shows it and it goes by itself.
     Placed in the chat card's own frame, so it is never clipped by the
     drawer's scroll. */
  const [wkRead, setWkRead] = useState(null);
  const readTimer = useRef(0);
  const showRead = (el, text) => {
    const host = chatRef.current;
    if (!host || !text) return;
    const c = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // the card scrolls: an absolute child sits in its scrolled content box
    setWkRead({ text, x: r.left + r.width / 2 - c.left + host.scrollLeft, y: r.top - c.top + host.scrollTop });
  };
  const rd = (tapToo, text) => {
    if (typeof tapToo === "string") {
      text = tapToo;
      tapToo = true;
    }
    if (!COARSE) return { onMouseEnter: (e) => showRead(e.currentTarget, text), onMouseLeave: () => setWkRead(null) };
    if (!tapToo) return {};
    return {
      onClick: (e) => {
        e.stopPropagation(); // the reading, not the row's own tap tooltip
        showRead(e.currentTarget, text);
        clearTimeout(readTimer.current);
        readTimer.current = setTimeout(() => setWkRead(null), 2500);
      },
    };
  };
  useEffect(() => () => clearTimeout(readTimer.current), []);
  /* live timing while a reply is in flight: when the request went out, when
     the reasoning started, when the first word landed */
  const phaseRef = useRef({ sendAt: 0, thinkAt: 0, textAt: 0 });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setWkRead(null);
  }, [workings, wkTab, wkList, wkFocus]);
  const toggleWorkings = () =>
    setWorkings((v) => {
      try {
        localStorage.setItem(WORKINGS_KEY, v ? "0" : "1");
      } catch (err) {
        // private mode
      }
      return !v;
    });
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
  /* the free model behind the chat has slow days; past ~9 seconds the wait
     reads as a broken site unless the page owns the delay in words */
  const [slowNote, setSlowNote] = useState(false);
  // which model answered last, for the hint line under the input
  const [model, setModel] = useState(LAST_MODEL);
  /* bumped to remount the ChatShield after a crash reset */
  const [chatEpoch, setChatEpoch] = useState(0);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const ghostRef = useRef(""); // the question the placeholder is typing, for Tab to take

  useEffect(() => {
    if (busy) return;
    try {
      if (msgs.length) localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(msgs.slice(-40)));
      else localStorage.removeItem(CHAT_LOG_KEY);
    } catch (err) {
      // private mode, or the quota is full: the chat still works, it just forgets
    }
  }, [msgs, busy]);

  /* the workings drawer's live clock while a reply is in flight */
  useEffect(() => {
    if (!busy) return undefined;
    const id = setInterval(() => setElapsed(performance.now() - phaseRef.current.sendAt), 200);
    return () => clearInterval(id);
  }, [busy]);

  /* the skill-id list rides in lazily so a reply's "skills map" link can
     carry the skills it names; fetched at open, long before any reply */
  useEffect(() => {
    if (open && CHAT_ENDPOINT) ensureSkillIds();
  }, [open]);

  /* Typewriter placeholder: types a sample question, holds, backspaces, moves
     to the next. It drives the placeholder ATTRIBUTE directly - no re-renders,
     and the browser itself guarantees the "only when the field is empty" rule,
     since a placeholder is never shown over typed text. Skipped under
     prefers-reduced-motion; the static prompt stays. */
  useEffect(() => {
    if (!open || !CHAT_ENDPOINT) return undefined;
    const input = inputRef.current;
    if (!input) return undefined;
    ghostRef.current = "";
    if (caption) {
      /* set here, after the previous run's cleanup has had its say - React
         wrote the prop before that cleanup reset the attribute */
      input.placeholder = tour ? "next · stop · or ask something" : "or ask something";
      return undefined;
    }
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
      ghostRef.current = q;
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
          ghostRef.current = ""; // nothing showing, nothing for Tab to take
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
      ghostRef.current = "";
      input.placeholder = "Ask me about my work";
    };
  }, [open, tour, caption]);

  /* corner shows a subset; the lightbox shows every point */
  const applyDrawRange = useCallback(() => {
    const world = worldRef.current;
    if (!world || !world.total) return;
    const s = stateRef.current;
    /* the caption head draws the whole cloud like the lightbox: it is
       supersampled, so the overlap averages out instead of blowing out, and
       a thinned cloud at that size read as splotches */
    const shown = !s.open && !big ? Math.min(world.total, MINI_POINTS) : world.total; // a big parked portrait draws it all
    world.points.geometry.setDrawRange(0, shown);
  }, [big]);
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
    /* a remembered ghost is a ghost from the first frame - no peel replay on
       every page the head is rebuilt on */
    st.ghostTarget = st.look.ghost ? 1 : 0;
    st.ghost = st.ghostTarget;

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
    /* The canvas stays invisible until the real point cloud has replaced
       the procedural stand-in and the occlusion shell is in (or has had its
       chance): the stand-in was never meant to be seen, and the real cloud
       without its shell reads as a see-through blob for a moment. Then it
       fades in. The page can wait on window.__fhReal for the same moment. */
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity 0.35s ease";
    let realPoints = false, realShell = false;
    const showReal = () => {
      if (!realPoints || !realShell) return;
      canvas.style.opacity = "1";
      window.__fhReal = true;
    };
    const shellDone = () => { realShell = true; showReal(); };
    canvas.className = "fh-canvas";
    mini.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 3.6);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BufferGeometry();
    /* the cut planes, one set of uniform objects shared by the dots, the
       occluder and the solid print, so one update cuts all three */
    const planeUniforms = {
      uPlanes: { value: [0, 1, 2, 3].map((i) => (NECK_DEFAULT[i] ? new THREE.Vector4(...NECK_DEFAULT[i].n, NECK_DEFAULT[i].d) : new THREE.Vector4(0, 1, 0, -9))) },
      uPlaneCount: { value: NECK_DEFAULT.length },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeSprite() },
        uSize: { value: 8 },
        uDpr: { value: dpr },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTintMix: { value: 0 },
        uTintEdge: { value: 99 },
        uGhost: { value: 0 },
        uAlpha: { value: 1 },
        uEdgeFade: { value: 0 },
        uPlanes: planeUniforms.uPlanes,
        uPlaneCount: planeUniforms.uPlaneCount,
        uBlink: { value: 0 },
        uMouth: { value: 0 },
        uMouthW: { value: 1 },
        uRegions: { value: 0 },
        uFx: { value: 0 },
        uFxT: { value: 0 },
        uFxSeed: { value: 0 },
        uTime: { value: 0 },
        uFxTint: { value: new THREE.Vector3(1.0, 0.55, 0.25) },
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
      uniforms: { uShellBias: { value: 0.06 }, uPlanes: planeUniforms.uPlanes, uPlaneCount: planeUniforms.uPlaneCount },
      // the cut planes remove the shell too: nothing of the cut part occludes
      vertexShader:
        "uniform float uShellBias; varying float vKeep; " + PLANE_GLSL +
        " void main(){ vKeep = planeDist(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.z -= uShellBias; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "varying float vKeep; void main(){ if (vKeep < 0.0) discard; gl_FragColor = vec4(0.0); }",
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
        /* the weight as a function of position: baked into the dots here,
           and applied to the wire's line ends when the wire is sliced */
        const jawAt = (x, y, z) => {
          const u = (2 * x - x0 - x1) / (x1 - x0);
          const arch = Math.sqrt(Math.max(0, 1 - u * u));
          const g = arch * sm(0.4, 0.62, z);
          if (g <= 0) return 0;
          const cx = Math.min(x1, Math.max(x0, x));
          const dy = y - (q0 + q1 * cx + q2 * cx * cx);
          return g * (dy <= 0 ? -(1 - sm(0.06, 0.3, -dy)) : 0.35 * (1 - sm(0.04, 0.16, dy)));
        };
        for (let i = 0; i < n; i++) {
          jawW[i] = jawAt(data.position[i * 3], data.position[i * 3 + 1], data.position[i * 3 + 2]);
        }
        stateRef.current.jawAt = jawAt;
        // a wire cut before the fit knew nothing of the mouth (the loader can run before the world exists)
        if (worldRef.current && worldRef.current.resliceWire) worldRef.current.resliceWire();
      }
      geometry.setAttribute("aJaw", new THREE.BufferAttribute(jawW, 1));
      material.uniforms.uRegions.value = hasRegions; // the wire copies it each frame
      const colors = new Float32Array(n * 3);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const y = data.position[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const span = Math.max(1e-6, maxY - minY);
      /* the wire look clips to where the cloud has points; the procedural
         stand-in counts too, until the real cloud replaces it */
      stateRef.current.cloudPos = data.colorIndex ? data.position : null; // kept for a re-cut
      const near = data.colorIndex ? cloudOccupancy(data.position, stateRef.current.neck || NECK_DEFAULT) : null;
      if (worldRef.current) worldRef.current.cloudNear = near;
      else stateRef.current.pendingCloudNear = near;
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


    /* the texture path: the scene rendered into `rt`, then drawn to the
       canvas by one of two full-screen passes - a plain copy (supersampling)
       or the lattice halftone */
    const rt = new THREE.WebGLRenderTarget(16, 16, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    /* the halftone samples the filled head (the shell wearing the dots'
       colours, lightly lit) rather than the dots: smooth tone, a real print.
       window.__fhLatticeSolid(false) falls back to the dots. */
    const solidMat = new THREE.ShaderMaterial({
      uniforms: { uLift: { value: 1.0 }, uPlanes: planeUniforms.uPlanes, uPlaneCount: planeUniforms.uPlaneCount },
      /* aIn marks shell vertices near the cloud's dots (the scan's neck base,
         which the cloud never had, is cut away); aSolid is the colour of the
         dots around the vertex - the same posterised tone in the same place,
         so the print is the cloud's own picture, filled in. A touch of a
         lamp from the upper left keeps the surface from reading flat. */
      vertexShader: "attribute float aIn; attribute vec3 aSolid; varying vec3 vCol; varying float vL; varying float vIn; varying float vKeep; " + PLANE_GLSL + " void main(){ vCol = aSolid; vIn = aIn; vKeep = planeDist(position); vec3 n = normalize(normalMatrix * normal); vL = 0.55 + 0.2 * max(0.0, n.z) + 0.25 * max(0.0, dot(n, normalize(vec3(-0.45, 0.6, 0.65)))); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform float uLift; varying vec3 vCol; varying float vL; varying float vIn; varying float vKeep;",
        "void main(){ if (vIn < 0.5 || vKeep < 0.0) discard; gl_FragColor = vec4(vCol * vL * uLift, 1.0); }",
      ].join("\n"),
    });
    window.__fhLatticeSolid = (on) => { stateRef.current.latticeSolid = !!on; };
    /* the head's silhouette as the page sees it right now: the farthest
       projected dot in each of `bins` screen angles (x right, y down), in
       CSS px from the host's centre, following the head's turn and sway.
       Every fourth dot is enough for an outline. */
    const silM = new THREE.Matrix4();
    const silV = new THREE.Vector4();
    window.__fhSilhouette = (bins, out, neck = stateRef.current.neck || NECK_DEFAULT) => {
      const pos = geometry.attributes.position.array;
      const n = pos.length / 3;
      const step = Math.max(1, Math.floor(n / 4000));
      group.updateMatrixWorld();
      camera.updateMatrixWorld();
      silM.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld).premultiply(camera.projectionMatrix);
      const hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
      const res = out && out.length === bins ? out : new Float32Array(bins);
      res.fill(0);
      for (let i = 0; i < n; i += step) {
        if (!neckKeep(neck, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) continue; // the cut is not part of the outline
        silV.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 1).applyMatrix4(silM);
        if (silV.w <= 0) continue;
        const x = (silV.x / silV.w) * hw, y = (-silV.y / silV.w) * hh;
        const b = (((Math.round((Math.atan2(y, x) / (Math.PI * 2)) * bins) % bins) + bins) % bins);
        const r = Math.hypot(x, y);
        if (r > res[b]) res[b] = r;
      }
      return res;
    };
    /* the same projection as pairs of CSS px (x right, y down) about the
       host's centre, every `step`th dot, for a page that wants to draw the
       head's footprint itself; returns the number of pairs written */
    window.__fhProject = (out, step = 8, neck = stateRef.current.neck || NECK_DEFAULT) => {
      const pos = geometry.attributes.position.array;
      const n = pos.length / 3;
      group.updateMatrixWorld();
      camera.updateMatrixWorld();
      silM.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld).premultiply(camera.projectionMatrix);
      const hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
      let k = 0;
      for (let i = 0; i < n && k + 1 < out.length; i += step) {
        if (!neckKeep(neck, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) continue;
        silV.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 1).applyMatrix4(silM);
        if (silV.w <= 0) continue;
        out[k++] = (silV.x / silV.w) * hw;
        out[k++] = (-silV.y / silV.w) * hh;
      }
      return k / 2;
    };
    // the lab's dials: { latticeCellPx, latticeFill, latticeGain, latticeShape, latticeStagger, latticeSolid }
    window.__fhLattice = (o) => { Object.assign(stateRef.current, o || {}); };
    const bakeShellIn = (geo) => {
      const near = (worldRef.current && worldRef.current.cloudNear) || stateRef.current.pendingCloudNear;
      const pos = geo.attributes.position.array;
      const inArr = new Float32Array(pos.length / 3);
      for (let i = 0; i < inArr.length; i++) inArr[i] = !near || near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) ? 1 : 0;
      geo.setAttribute("aIn", new THREE.BufferAttribute(inArr, 1));
      /* the dots' colours, gathered onto the shell: the mean of the dots
         within SOLID_R of each vertex (a few, on a surface), or the nearest
         dot where none is that close */
      const dots = points.geometry.attributes.position.array;
      const dcol = points.geometry.attributes.aColor.array;
      const sample = cloudSampler(dots, dcol);
      const solid = new Float32Array(pos.length);
      const rgb = [0, 0, 0];
      for (let i = 0; i < inArr.length; i++) {
        sample(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], rgb);
        solid[i * 3] = rgb[0];
        solid[i * 3 + 1] = rgb[1];
        solid[i * 3 + 2] = rgb[2];
      }
      geo.setAttribute("aSolid", new THREE.BufferAttribute(solid, 3));
    };
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: rt.texture }, uExposure: { value: SMALL_EXPOSURE } },
      vertexShader: QUAD_VERT, fragmentShader: COPY_FRAG,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    const latticeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tSrc: { value: rt.texture }, uSize: { value: new THREE.Vector2(1, 1) },
        uCell: { value: 4 }, uGain: { value: LATTICE_GAIN }, uMax: { value: LATTICE_FILL }, uLod: { value: 2 },
        uShape: { value: 0 }, uStagger: { value: 1 },
      },
      vertexShader: QUAD_VERT, fragmentShader: LATTICE_FRAG,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    /* the tone's running average lives in a pair of targets at canvas size,
       written and read in turn; the lattice reads the newest */
    const toneOpts = { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    const toneA = new THREE.WebGLRenderTarget(16, 16, toneOpts);
    const toneB = new THREE.WebGLRenderTarget(16, 16, toneOpts);
    const toneMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { tSrc: { value: rt.texture }, tPrev: { value: toneB.texture }, uLod: { value: 2 }, uK: { value: 1 } },
      vertexShader: QUAD_VERT, fragmentShader: TONE_FRAG,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    window.__fhToneK = (k) => { stateRef.current.toneK = k; }; // tuning hook: 1 = no smoothing
    /* start a performed trick; the frame loop runs it from here */
    stateRef.current.startFx = (kind) => {
      const s = stateRef.current;
      const def = FX[kind];
      if (!def) return;
      if (s.reduced && kind !== "hue") return; // motion the visitor asked the system to spare
      s.fx = { id: def[0], t0: performance.now(), dur: def[1], seed: Math.random() * 100 };
    };
    window.__fhTrick = (kind) => stateRef.current.startFx && stateRef.current.startFx(kind); // tuning hook
    const quadScene = new THREE.Scene();
    const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    quadScene.add(quadMesh);
    window.__fhExposure = (v) => { stateRef.current.exposure = v; }; // tuning hook

    /* the wire look's lines: sliced from the shell once it arrives, per spacing */
    const wireMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: { value: 0.75 }, uEdgeFade: { value: 0 },
        uNeck: { value: new THREE.Vector2(WIRE_NECK[0], WIRE_NECK[1]) },
        uFx: { value: 0 }, uFxT: { value: 0 }, uFxSeed: { value: 0 }, uTime: { value: 0 },
        uFxTint: { value: new THREE.Vector3(1.0, 0.55, 0.25) },
        uBlink: { value: 0 }, uMouth: { value: 0 }, uMouthW: { value: 1 }, uRegions: { value: 0 },
      },
      vertexShader: WIRE_VERT, fragmentShader: WIRE_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    const wireLines = new THREE.LineSegments(new THREE.BufferGeometry(), wireMat);
    wireLines.visible = false;
    group.add(wireLines);
    const wireCache = new Map();
    const ensureWire = (d) => {
      const world = worldRef.current;
      if (!world || !world.shellVerts) return false;
      const key = d.toFixed(2);
      if (!wireCache.has(key)) {
        const g = sliceShell(world.shellVerts, world.shellIdx, d, world.cloudNear || null);
        /* each line end's mouth weight, so the wire talks like the dots */
        const jawAt = stateRef.current.jawAt;
        const pos = g.attributes.position.array;
        const jaw = new Float32Array(pos.length / 3);
        if (jawAt) for (let i = 0; i < jaw.length; i++) jaw[i] = jawAt(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        g.setAttribute("aJaw", new THREE.BufferAttribute(jaw, 1));
        wireCache.set(key, g);
      }
      const g = wireCache.get(key);
      if (wireLines.geometry !== g) wireLines.geometry = g;
      return true;
    };

    const resliceWire = () => {
      for (const g of wireCache.values()) g.dispose();
      wireCache.clear();
      if (shellMesh) bakeShellIn(shellMesh.geometry);
      if (stateRef.current.look.wire) ensureWire(wireSpacing(stateRef.current.headCss || 100));
    };
    worldRef.current = {
      renderer, scene, camera, group, points, material, canvas, total: 0, rt, dpr, wire: wireLines, ensureWire, resliceWire,
      cloudNear: stateRef.current.pendingCloudNear, shellMat: shellMaterial,
    };
    /* the neck cut, live: the dots' fade, the wire's dissolve, the clip the
       wire and the solid print share, and (through the hooks' default) the
       silhouette. Local tuning; the chosen height becomes NECK_CUT. */
    const setPlaneUniforms = (planes) => {
      const arr = planeUniforms.uPlanes.value;
      for (let i = 0; i < NECK_MAX; i++) {
        if (planes[i]) arr[i].set(planes[i].n[0], planes[i].n[1], planes[i].n[2], planes[i].d);
        else arr[i].set(0, 1, 0, -9);
      }
      planeUniforms.uPlaneCount.value = Math.min(NECK_MAX, planes.length);
    };
    window.__fhNeckCut = (sets, onTopOfBaked = false) => {
      const s = stateRef.current;
      // the editor cuts on top of the planes already baked in; a plain call replaces them
      s.neck = onTopOfBaked ? planesFrom([...NECK_PLANES, ...sets]) : planesFrom(sets);
      setPlaneUniforms(s.neck);
      if (s.cloudPos && worldRef.current) {
        worldRef.current.cloudNear = cloudOccupancy(s.cloudPos, s.neck);
        resliceWire();
      }
      return s.neck;
    };
    window.__fhNeckDefault = () => NECK_PLANES.map((set) => set.map((p) => p.slice()));
    // the dots at rest, [x, y, z, ...], for an editor that needs to know the head is in
    window.__fhRestPoints = () => stateRef.current.cloudPos || null;
    /* the cut editor (local): three handles per plane in the head's own
       frame, each with an arrow per axis to drag, and each plane shown as a
       pane. The head holds still; a right-button drag on the canvas turns
       it. Returns {setView, points, setPoints, screen, destroy}. */
    window.__fhCutEditor = async (sets, onChange) => {
      const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
      const s = stateRef.current;
      const palette = [[0xff72a1, 0x7fd3ff, 0x78ffa8], [0xffb347, 0xfff07a, 0xffffff], [0xc3a6ff, 0x9ed8ff, 0xb4ffd0], [0xff9ecb, 0xa0e0ff, 0xd0ffe0]];
      const markers = []; // [plane][3]
      const controls = [];
      const panes = [];
      const points = () => markers.map((set) => set.map((m) => [+m.position.x.toFixed(3), +m.position.y.toFixed(3), +m.position.z.toFixed(3)]));
      const apply = () => {
        const all = points();
        window.__fhNeckCut(all, true);
        const planes = planesFrom(all);
        all.forEach((p, j) => {
          const pane = panes[j], pl = planes[j];
          if (!pane || !pl) return;
          pane.position.set((p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3);
          pane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(pl.n[0], pl.n[1], pl.n[2]));
        });
        if (onChange) onChange(all);
      };
      sets.slice(0, NECK_MAX).forEach((set, j) => {
        const pane = new THREE.Mesh(
          new THREE.PlaneGeometry(3.4, 3.4),
          new THREE.MeshBasicMaterial({ color: palette[j][0], transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
        );
        group.add(pane);
        panes.push(pane);
        const row = [];
        set.forEach((p, i) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), new THREE.MeshBasicMaterial({ color: palette[j][i], depthTest: false }));
          m.position.set(p[0], p[1], p[2]);
          m.renderOrder = 10;
          group.add(m);
          row.push(m);
          const c = new TransformControls(camera, canvas);
          c.attach(m);
          c.setSpace("local");
          c.setSize(0.5);
          c.addEventListener("objectChange", apply);
          scene.add(c.getHelper());
          controls.push(c);
        });
        markers.push(row);
      });
      /* the canvas takes the pointer while editing; nothing of it reaches
         the host button (which would open the lightbox). A right-button
         drag turns the head. */
      const stop = (e) => e.stopPropagation();
      let turning = null;
      /* capture-phase, so a right-button press never reaches the arrows'
         own handlers (they would grab it as a drag) */
      const onDown = (e) => {
        if (e.button !== 2) return; // the arrows' own handlers take the left button
        e.stopImmediatePropagation();
        turning = { x: e.clientX, y: e.clientY, ty: s.targetY, tx: s.targetX };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
      };
      const onMove = (e) => {
        if (!turning) return;
        s.targetY = turning.ty + (e.clientX - turning.x) * 0.006;
        s.targetX = Math.max(-1.2, Math.min(1.2, turning.tx + (e.clientY - turning.y) * 0.006));
      };
      const onUp = (e) => {
        if (e.button !== 2) return;
        e.stopImmediatePropagation();
        turning = null;
      };
      const noMenu = (e) => e.preventDefault();
      canvas.addEventListener("pointerdown", onDown, true);
      canvas.addEventListener("pointermove", onMove, true);
      canvas.addEventListener("pointerup", onUp, true);
      canvas.addEventListener("pointercancel", onUp, true);
      canvas.addEventListener("click", stop);
      canvas.addEventListener("contextmenu", noMenu);
      canvas.style.pointerEvents = "auto";
      s.editor = true;
      s.lookLock = true;
      s.targetX = 0;
      s.targetY = 0;
      apply();
      const tmp = new THREE.Vector3();
      return {
        setView: (yaw, pitch = 0) => { s.targetY = yaw; s.targetX = pitch; },
        points,
        setPoints: (next) => {
          next.forEach((set, j) => set.forEach((p, i) => markers[j] && markers[j][i] && markers[j][i].position.set(p[0], p[1], p[2])));
          apply();
        },
        /* each handle's place on the page, CSS px, for a test or a hint */
        screen: () => markers.map((set) => set.map((m) => {
          m.getWorldPosition(tmp).project(camera);
          const r = canvas.getBoundingClientRect();
          return [r.left + ((tmp.x + 1) / 2) * r.width, r.top + ((1 - tmp.y) / 2) * r.height];
        })),
        destroy: () => {
          for (const c of controls) { scene.remove(c.getHelper()); c.dispose(); }
          for (const row of markers) for (const m of row) group.remove(m);
          for (const pane of panes) group.remove(pane);
          canvas.removeEventListener("pointerdown", onDown, true);
          canvas.removeEventListener("pointermove", onMove, true);
          canvas.removeEventListener("pointerup", onUp, true);
          canvas.removeEventListener("pointercancel", onUp, true);
          canvas.removeEventListener("click", stop);
          canvas.removeEventListener("contextmenu", noMenu);
          canvas.style.pointerEvents = "";
          s.editor = false;
          s.lookLock = false;
        },
      };
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
          if (worldRef.current.resliceWire) worldRef.current.resliceWire();
        }
        realPoints = true;
        showReal();
        /* a shell that is slow or missing does not keep the head hidden */
        setTimeout(() => { if (!cancelled) shellDone(); }, 1500);
      } catch (err) {
        /* stand-in head stays - shown after all, rather than nothing */
        if (!cancelled) { realPoints = true; shellDone(); }
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
        geo.computeVertexNormals(); // for the solid shading under the halftone
        bakeShellIn(geo);
        shellMesh = new THREE.Mesh(geo, shellMaterial);
        group.add(shellMesh);
        if (worldRef.current) {
          worldRef.current.shell = shellMesh;
          worldRef.current.shellVerts = verts;
          worldRef.current.shellIdx = idx;
          wireCache.clear();
          if (stateRef.current.look.wire) {
            ensureWire(wireSpacing(stateRef.current.headCss || 100));
            wireLines.visible = true;
          }
        }
        shellDone();
      } catch (err) {
        /* no shell = no occlusion; the head still renders */
        if (!cancelled) shellDone();
      }
    })();

    /* render loop, with a capability check over the first second of frames */
    let raf = 0;
    let last = 0;
    let firstFrameT = 0;
    const samples = [];
    let judged = window.__fhNoGuard === true;
    const RETURN = 0.9; // how firmly it eases back to facing forward
    /* once the pointer's influence ends, how slowly the gaze drifts home:
       a time constant of two and a half seconds, so the head keeps looking
       where it was and the sway carries on from there, nothing snapping */
    const HOME_RATE = 0.4;
    const sstep = (x) => x * x * (3 - 2 * x);
    let rectCalm = 0;
    /* The sway's rectifier, continuous in the look target. It used to key
       on the target's SIGN, so as the pointer crossed the head's centre
       line the multiplier jumped between its "with the look" and "against
       it" values and the pitch (or yaw) offset jumped with it - a visible
       seam right across the middle of the head. Now the agreement between
       a sway component and the look ramps over the first ~0.12 rad of
       target, and at zero target the two values meet halfway. */
    const rectify = (v, target) => {
      if (rectCalm <= 0.001) return v * (1 - 0.5 * rectCalm);
      /* soft on both sides: the look's direction ramps over ~0.12 rad and
         the component's over ~0.04 rad, so neither flips the multiplier */
      const agree = Math.max(-1, Math.min(1, target / 0.12)) * Math.max(-1, Math.min(1, v / 0.04)); // 1 with the look, -1 against it
      return v * (1 - rectCalm * (0.69 - 0.19 * agree));
    };

    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (!firstFrameT) firstFrameT = t;
      if (document.hidden) {
        last = t;
        return;
      }
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      const s = stateRef.current;
      /* nothing is drawn until layout() has sized the host and chosen the
         path: the first frames otherwise render direct, at the canvas's
         default size, and flash before the real head appears */
      if (s.rtFactor < 0) {
        last = t;
        return;
      }

      if (last && !judged && t - firstFrameT > 900 && !document.hidden) {
        /* the first ~0.9s after a scene build is layout/upload jank on even
           strong devices - judging it would condemn capable phones on the
           overlay-open transition. A gap of a quarter second or more is a
           pause (a tab switch, a throttled background page), not a slow
           machine, and is not a sample either. */
        if (t - last < 250) samples.push(t - last);
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
      /* a big portrait turns through more pixels for the same angle, so the
         same easing reads as lag there; it follows a little quicker */
      /* the pointer has left the window, or moved off everything that
         draws the gaze: the look it had becomes the state it floats around,
         and only slowly drifts back to forward */
      if (s.freeLook && !s.lookLock && !s.dragging) {
        const kr = 1 - Math.exp(-HOME_RATE * dt);
        s.targetY += (0 - s.targetY) * kr;
        s.targetX += (0 - s.targetX) * kr;
      }
      const k = 1 - Math.exp(-(s.big ? 8 : 6) * dt);
      s.rotY += (s.spin + s.targetY - s.rotY) * k;
      s.rotX += (s.targetX - s.rotX) * k;

      if (s.reduced || s.editor) {
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
        /* the rectified sway, smoothed over ~0.8 s: rectification changes
           the sway's speed as its components turn, and with the look far
           to one side (a card focused) that read as a twitch that way */
        const kSway = 1 - Math.exp(-dt / 0.8);
        s.swX = (s.swX || 0) + (rect(wx, s.targetX || 0) - (s.swX || 0)) * kSway;
        s.swY = (s.swY || 0) + (rect(wy, s.targetY || 0) - (s.swY || 0)) * kSway;
        group.rotation.x = s.rotX + s.swX;
        group.rotation.y = s.rotY + s.swY;
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
      shellMaterial.uniforms.uShellBias.value = (s.shellBias ?? SHELL_BIAS) + gS * 3.0;
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
      /* the performed tricks: one at a time, timed by the clock, on the dots
         and the wire alike; the sparks take the look's temperature - ember
         on the cloud and the halftone, cold blue-white as a ghost */
      if (s.fx) {
        const prog = (performance.now() - s.fx.t0) / s.fx.dur;
        if (prog >= 1) s.fx = null;
      }
      const ghostly = s.look.ghost && !s.look.wire;
      for (const mat of [material, wireMat]) {
        const u = mat.uniforms;
        u.uFx.value = s.fx ? s.fx.id : 0;
        u.uFxT.value = s.fx ? (performance.now() - s.fx.t0) / s.fx.dur : 0;
        u.uFxSeed.value = s.fx ? s.fx.seed : 0;
        u.uTime.value = performance.now() / 1000;
        u.uEdgeFade.value = s.tour ? 1 : 0;
        if (ghostly) u.uFxTint.value.set(0.55, 0.75, 1.0);
        else u.uFxTint.value.set(1.0, 0.55, 0.25);
      }
      /* under the wire the dots fade right out (the lines blink and talk on
         their own); once gone they are not drawn at all, so nothing of the
         cloud shows through the mesh */
      s.cloudAlpha = (s.cloudAlpha ?? 1) + ((s.look.wire ? 0 : 1) - (s.cloudAlpha ?? 1)) * (1 - Math.exp(-5 * dt));
      material.uniforms.uAlpha.value = s.cloudAlpha;
      points.visible = s.cloudAlpha > 0.01;

      /* ---- blink + talk ----
         Blink: a 160ms sine pulse at random 3-7s intervals, occasionally
         doubled - the double is most of what makes it read as alive rather
         than metronomic. Talk: the jaw flaps while reply chunks are actually
         arriving (send() stamps lastChunkAt), openness wandering on two
         incommensurate sines so it chews rather than oscillates; it eases
         shut in pauses and when the stream ends. window.__fhForce lets both
         values be pinned from the console for tuning. */
      if (s.reduced) {
        for (const mat of [material, wireMat]) {
          mat.uniforms.uBlink.value = 0;
          mat.uniforms.uMouth.value = 0;
          mat.uniforms.uMouthW.value = 1;
        }
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
        const warping = !!(s.fx && WARP_IDS.has(s.fx.id));
        let blink = 0;
        if (bp >= 0 && bp < 1 && !warping) {
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
        if (talking !== !!s.wasTalking) {
          s.wasTalking = talking; // twice per reply, not per frame
          setSpeaking(talking);
        }
        if (talking && !warping && t >= (s.talkNext || 0)) {
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
          if (!s.silent) speakBlip(key, s.voicePitch || 1); // a tour is read, not chirped
        }
        let mouthTarget = talking && !warping ? s.vOpen || 0 : 0;
        // breathing fire: the jaw drops for the burst, whatever else is said
        if (s.fireLive && t < (s.fireUntil || 0)) mouthTarget = Math.max(mouthTarget, 0.75);
        const widthTarget = talking && !warping ? s.vWidth || 1 : 1;
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
        for (const mat of [material, wireMat]) {
          mat.uniforms.uBlink.value = blink;
          mat.uniforms.uMouth.value = mouth;
          mat.uniforms.uMouthW.value = mouthW;
        }
        wireMat.uniforms.uRegions.value = material.uniforms.uRegions.value;
        /* the typing cue in the transcript breathes with the same number
           the lips use, so text and mouth read as one performance */
        if (chatRef.current && Math.abs(mouth - (s.cueMouth || 0)) > 0.02) {
          s.cueMouth = mouth;
          chatRef.current.style.setProperty("--fh-mouth", mouth.toFixed(2));
        }
      }

      const drawScene = () => {
        /* the filled print cannot perform (the shell stays put), so while a
           trick plays the halftone samples the dots instead, which do */
        const solid = !!(s.look.lattice && s.latticeSolid && shellMesh && !s.fx);
        latticeMat.uniforms.uGain.value = typeof s.latticeGain === "number" ? s.latticeGain : solid ? SOLID_GAIN : LATTICE_GAIN;
        if (shellMesh) shellMesh.visible = !(s.fx && MOVING_IDS.has(s.fx.id));
        const dotsShown = points.visible;
        if (solid) {
          shellMesh.material = solidMat;
          points.visible = false;
        }
        renderer.render(scene, camera);
        if (solid) {
          shellMesh.material = shellMaterial;
          points.visible = dotsShown;
        }
      };
      if (s.rtFactor > 0 && rt.width > 16) {
        renderer.setRenderTarget(rt);
        drawScene();
        renderer.setRenderTarget(null);
        if (s.look.lattice) {
          /* the filled shell carries more tone than scattered dots, so its
             print takes a finer screen */
          const solidNow = !!(s.latticeSolid && shellMesh);
          const cell = (typeof s.latticeCellPx === "number" ? s.latticeCellPx : latticeCell(s.headCss || 100) * (solidNow ? SOLID_CELL : 1)) * dpr;
          /* pass one: this frame's cell-sized average of the cloud, blended
             into the running tone */
          const write = s.toneFlip ? toneB : toneA;
          const read = s.toneFlip ? toneA : toneB;
          if (write.width !== canvas.width || write.height !== canvas.height) {
            toneA.setSize(canvas.width, canvas.height);
            toneB.setSize(canvas.width, canvas.height);
            s.toneReset = true;
          }
          const t = toneMat.uniforms;
          t.tPrev.value = read.texture;
          t.uLod.value = Math.log2(cell * s.rtFactor) - 0.5;
          t.uK.value = s.toneReset ? 1 : typeof s.toneK === "number" ? s.toneK : TONE_K;
          quadMesh.material = toneMat;
          renderer.setRenderTarget(write);
          renderer.render(quadScene, quadCam);
          renderer.setRenderTarget(null);
          s.toneFlip = !s.toneFlip;
          s.toneReset = false;
          /* pass two: the dots, from the steadied tone */
          const u = latticeMat.uniforms;
          u.tSrc.value = write.texture;
          u.uSize.value.set(canvas.width, canvas.height);
          u.uCell.value = cell;
          u.uMax.value = typeof s.latticeFill === "number" ? s.latticeFill : solidNow && !s.fx ? SOLID_FILL : LATTICE_FILL;
          u.uShape.value = s.latticeShape || 0;
          u.uStagger.value = s.latticeStagger === false ? 0 : 1;
          u.uLod.value = 0;
          quadMesh.material = latticeMat;
        } else {
          s.toneReset = true; // the next halftone frame starts clean
          const plain = !s.look.ghost && !s.look.lattice && !s.look.wire;
          copyMat.uniforms.uExposure.value = (typeof s.exposure === "number" ? s.exposure : SMALL_EXPOSURE) * (s.tour && plain ? TOUR_DIM : 1);
          quadMesh.material = copyMat;
        }
        renderer.render(quadScene, quadCam);
      } else {
        drawScene();
      }
      /* a page that draws something from the head's pose (the /focus
         window) does it here, after the head has moved and rendered, so
         the two never disagree by a frame */
      if (window.__fhAfterFrame) window.__fhAfterFrame();
    };
    raf = requestAnimationFrame(frame);

    /* Watch the cursor once it comes near, wherever it is on the page. */
    const onPointerMove = (e) => {
      const s = stateRef.current;
      if (s.open || s.reduced || !miniRef.current) return;
      if (s.lookLock) return; // attending something - the gaze holds

      /* the host's box, read at most a few times a second: a pointer can
         report hundreds of moves a second, and each read forces layout */
      const now = performance.now();
      if (!s.miniRect || now - (s.miniRectAt || 0) > 120) {
        s.miniRect = miniRef.current.getBoundingClientRect();
        s.miniRectAt = now;
      }
      const r = s.miniRect;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      const GAZE_RADIUS = GAZE_RADIUS_BASE * Math.min(1, r.width / 100);

      /* two parts that add up, so there is no seam at the close-range
         radius: a gentle whole-page follow (over a card, or everywhere for
         a big portrait that sits among the cards), and a close look that
         ramps in across the outer third of the radius and out again at
         its edge. Before, the two were either/or and the switch between
         them put a small jump in the gaze wherever the pointer crossed
         the radius - on a big portrait that is most of the head. */
      if (big) {
        /* the big portrait: one continuous mapping from the pointer's offset
           to a focal point between the brows, the same over the head as
           anywhere on the page - no close-range regime, so no seam and no
           deadzone. tanh keeps it responsive near the head and eases it
           toward the limits at the edges of the window. */
        const ox = dx;
        const oy = dy + r.height * GAZE_ORIGIN_UP;
        const u = ox / Math.max(1, window.innerWidth * 0.5);
        const v = oy / Math.max(1, window.innerHeight * 0.5);
        s.freeLook = false;
        s.targetY = Math.tanh(u * 1.6) * 1.1;
        s.targetX = Math.tanh(v * 1.6) * 0.6;
        return;
      }
      const overCard =
        e.target && e.target.closest && e.target.closest(".landing .card");
      /* nothing draws the gaze here: keep the look it has (the frame loop
         drifts it home slowly) rather than snapping it to forward */
      if (!overCard && dist >= GAZE_RADIUS) {
        s.freeLook = true;
        return;
      }
      s.freeLook = false;
      let ny = 0, nx = 0;
      if (overCard) {
        ny = (dx / Math.max(1, window.innerWidth / 2)) * 0.9;
        nx = (dy / Math.max(1, window.innerHeight / 2)) * 0.5;
      }
      if (dist < GAZE_RADIUS) {
        const strength = Math.min(1, (GAZE_RADIUS - dist) / (GAZE_RADIUS * 0.35));
        ny += (dx / GAZE_RADIUS) * 1.15 * strength;
        nx += (dy / GAZE_RADIUS) * 0.6 * strength;
      }
      s.targetY = Math.max(-1.25, Math.min(1.25, ny));
      s.targetX = Math.max(-0.6, Math.min(0.6, nx));
    };

    /* leaving the window: the look stays, and drifts home slowly */
    const onPointerOut = (e) => {
      if (e.relatedTarget) return;
      stateRef.current.freeLook = true;
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
      stateRef.current.ghostTarget = stateRef.current.look.ghost ? 1 : 0;
      stateRef.current.ghost = stateRef.current.ghostTarget;
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
      rt.dispose();
      copyMat.dispose();
      latticeMat.dispose();
      toneMat.dispose();
      toneA.dispose();
      toneB.dispose();
      quadMesh.geometry.dispose();
      for (const g of wireCache.values()) g.dispose();
      wireMat.dispose();
      window.__fhExposure = null;
      renderer.dispose();
      /* dispose() alone leaves the GL context alive until GC; fab-mode
         open/close cycles would pile contexts up to the browser's cap */
      renderer.forceContextLoss();
      canvas.remove();
      window.__fhU = window.__fhG = window.__fhS = window.__fhSay = null;
      delete window.__fhReal;
      worldRef.current = null;
    };
  }, [needsScene, big]);

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
    /* the big portrait tracks the pointer alone, continuously (see the
       pointer handler): attending the grid only tints it, and nothing here
       snaps the gaze to forward on the way out */
    if (big) {
      s.lookLock = false;
      return;
    }
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
  }, [lookTarget, big]);

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
    const host = open ? (caption && tourHeadRef.current) || stageRef.current : miniRef.current;
    if (!host) return;
    if (world.canvas.parentElement !== host) host.appendChild(world.canvas);
    const box = miniRef.current ? miniRef.current.clientWidth || 100 : 100;
    if (!open && !miniRef.current) return;
    const pad = open && caption ? TOUR_PAD : 1;
    const w = open ? Math.round((host.clientWidth || 150) * pad) : Math.round(box * CANVAS_SCALE);
    const h = open ? Math.round((host.clientHeight || 150) * pad) : Math.round(box * CANVAS_SCALE);
    world.renderer.setSize(w, h, false);
    world.canvas.style.width = w + "px";
    world.canvas.style.height = h + "px";
    world.camera.aspect = w / h;
    const z = open ? (caption ? 4.4 : 5.6) : MINI_Z;
    world.camera.position.z = z;
    world.camera.zoom = 1 / pad; // the padded canvas shows more of the scene; the head stays disc-sized
    world.camera.updateProjectionMatrix();
    const fov = (world.camera.fov * Math.PI) / 180;
    const headPx = (Math.min(h, w) * 2.6) / (2 * z * pad * Math.tan(fov / 2));
    const targetPx = Math.max(1.3, 0.0044 * headPx);
    world.material.uniforms.uSize.value = targetPx * z;
    /* small hosts go through the supersampled texture; the lattice look does
       at any size. The texture is sized here, once per layout, never per
       frame; the point sprites scale with it so they keep their CSS size. */
    const s = stateRef.current;
    s.small = (!open && !big) || caption;
    s.big = !!big;
    s.headCss = headPx;
    const viaRT = s.small || s.look.lattice;
    let f = 0;
    if (viaRT) {
      f = s.small ? SUPER(world.dpr) : 1;
      const cap = world.renderer.capabilities.maxTextureSize || 4096;
      while (f > 1 && Math.max(w, h) * world.dpr * f > cap) f -= 1;
      world.rt.setSize(Math.round(w * world.dpr * f), Math.round(h * world.dpr * f));
    }
    s.rtFactor = f;
    s.shellBias = f ? SHELL_BIAS_SMALL : SHELL_BIAS;
    s.tour = caption;
    world.material.uniforms.uDpr.value = world.dpr * (f || 1);
    /* the shell's slope-scaled offset is per PIXEL: at f times the
       resolution the per-pixel slope is f times smaller, so the factor
       scales up with it, or the shell starts hiding surface dots along
       creases - thin, patchy gaps */
    if (world.shellMat) world.shellMat.polygonOffsetFactor = 2 * (f || 1);
    if (world.wire) {
      s.wireOn = !!s.look.wire && world.ensureWire(wireSpacing(headPx));
      world.wire.visible = s.wireOn;
    }
    applyDrawRange();
  }, [open, caption, applyDrawRange, big]);

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
  }, [open, ready, layout, mode, missionEl, tour, pick, lookEpoch]);

  /* closing the chat by any route - Escape, the cross, a chip, the backdrop -
     also ends a running tour: a tour with no chat on screen is just a page
     changing by itself */
  const dismiss = useCallback(() => {
    if (TOUR.running) tourEnd("closed");
    if (PICK.running) pickEnd();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  /* this head is the tour's stage while it is mounted: it navigates, shows
     the transcript the controller keeps, and speaks each stop's words */
  useEffect(() => {
    const stage = {
      navigate: (to) => navigateRef.current(to),
      setMsgs: (m) => setMsgs(m),
      speak: (text) => {
        const s = stateRef.current;
        s.talkBuf = text; // each stop is mouthed from its first word, silently
        s.talkPos = 0;
        s.talkNext = 0;
        s.silent = true;
      },
      onPage: (page) => setTourPage(page),
      onPick: (on) => {
        setPick(on);
        if (on) setOpen(true);
        else setPickHover("");
      },
      onTour: (on, reason) => {
        setTour(on);
        setTourMin(false);
        if (!on) stateRef.current.silent = false;
        if (on) setOpen(true);
        else if (reason !== "stop" && reason !== "question") setOpen(false);
      },
    };
    tourRegister(stage);
    return () => tourUnregister(stage);
  }, []);

  /* while picking: the card under the pointer is named in the caption, and
     a click on a card (a tap, on a phone) becomes the question */
  const sendRef = useRef(null);
  useEffect(() => {
    if (!pick) return undefined;
    const off = onAttention((a) => setPickHover(a && a.kind === "project" ? a.name : ""));
    const onClick = (e) => {
      if (!(e.target && e.target.closest)) return;
      if (e.target.closest(".fh-chat, .fh-close")) return;
      const el = e.target.closest("[id]");
      const ref = el && PROJECT_REFS.find((r) => r.to === "/projects#" + el.id);
      if (!ref) return; // not a card: the page keeps the click
      e.preventDefault();
      e.stopPropagation();
      noteAttention({ kind: "project", name: ref.name, slug: el.id });
      pickEnd();
      if (sendRef.current) sendRef.current(null, "tell me about this one");
    };
    document.addEventListener("click", onClick, true);
    return () => {
      off();
      document.removeEventListener("click", onClick, true);
    };
  }, [pick]);

  /* during a tour the page behind the chat is live, and a click on it is
     the visitor taking over: the tour stops and the click goes through */
  useEffect(() => {
    if (!tour) return undefined;
    const onClick = (e) => {
      if (e.target && e.target.closest && e.target.closest(".fh-chat, .fh-close")) return;
      tourEnd("click");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [tour]);
  useEffect(() => {
    if (!open && TOUR.running) tourEnd("closed");
    if (!open && PICK.running) pickEnd();
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs, slowNote]);
  const empty = msgs.length === 0;
  useEffect(() => {
    if (empty) setStarters(pickStarters());
  }, [empty]);

  useEffect(() => {
    /* Not on a phone: focusing the field summons the keyboard the instant the
       portrait opens, covering the thing the visitor came to look at. They can
       tap the field when they actually want to type. */
    if (open && mode !== "phone" && inputRef.current) inputRef.current.focus();
  }, [open]);

  /* where the visitor is, for the worker: the route, and on the projects
     page the card under the pointer or last clicked (Projects.js notes it),
     else the one a deep link opened; on the landing page the hovered card */
  const pageContext = () => {
    const path = window.location.pathname + window.location.hash;
    let hovered = "";
    const att = getAttention();
    if (path.startsWith("/projects")) {
      if (att && att.kind === "project") hovered = att.name;
      else if (window.location.hash.length > 1) {
        let slug = "";
        try {
          slug = decodeURIComponent(window.location.hash.slice(1));
        } catch (err) {
          slug = "";
        }
        const ref = PROJECT_REFS.find((p) => p.to === "/projects#" + slug);
        if (ref) hovered = ref.name;
      }
    } else if (path === "/" && hoveredCard) {
      hovered = { 1: "Skills", 2: "Projects", 3: "About", 4: "Resume" }[hoveredCard] || "";
    }
    const look = lookName(stateRef.current.look);
    const ctx = look ? { path, hovered, look } : { path, hovered };
    /* what the previous reply cost, as the drawer shows it, so the model can
       explain its own figure when a visitor asks about it */
    const prev = [...msgs].reverse().find((m) => m.role === "assistant" && m.stats && typeof m.stats.cents === "number");
    ctx.tricks = stateRef.current.trickCount || 0; // the showy tricks come first (see the worker's roll)
    if (prev) {
      ctx.last = {
        cents: prev.stats.cents,
        wrote: prev.stats.cacheWrite > 0,
        wroteCents: typeof prev.stats.cacheWriteCents === "number" ? prev.stats.cacheWriteCents : 0,
        model: String(prev.stats.model || ""),
      };
    }
    return ctx;
  };

  /* one trick, by its token's name: the page-controlled effect behind each
     token the model may open a reply with (and the dev lab's buttons) */
  const performTrick = (kind) => {
    const s = stateRef.current;
    s.trickCount = (s.trickCount || 0) + 1;
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
    if (FX[kind]) {
      if (s.startFx) s.startFx(kind);
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
    /* the looks: remembered until the visitor asks for the default back.
       Changing the look re-runs layout() - the lattice needs the texture
       path at every size, and the path is chosen there. */
    if (kind === "cloud") {
      s.look = { ghost: false, lattice: false, wire: false };
      writeLook(s.look);
      s.ghostTarget = 0;
      setLookEpoch((n) => n + 1);
      return;
    }
    if (kind === "lattice" || kind === "wire") {
      /* the halftone and the wireframe are each a whole look, so one
         replaces the other (both on at once left the halftone path drawing
         a print of nothing). The halftone is a solid print with no gaps, so
         it switches a ghost off too; a ghost stays on with the wire, whose
         mesh it makes see-through. */
      s.look = { ...s.look, lattice: kind === "lattice", wire: kind === "wire", ghost: kind === "lattice" ? false : s.look.ghost };
      if (kind === "lattice") s.ghostTarget = 0;
      writeLook(s.look);
      setLookEpoch((n) => n + 1);
      return;
    }
    if (kind === "lattice-off" || kind === "wire-off") {
      /* that look's pill pressed while it is on: the look comes off and the
         dots come back; a ghost, if on, stays */
      s.look = { ...s.look, [kind.slice(0, -4)]: false };
      writeLook(s.look);
      setLookEpoch((n) => n + 1);
      return;
    }
    if (kind === "ghost-off") {
      /* the ghost pill pressed while the ghost is on: the ghost comes off,
         whatever else is on (lattice, wire) stays */
      s.look = { ...s.look, ghost: false };
      writeLook(s.look);
      s.ghostTarget = 0;
      return;
    }
    // ghost: the halftone, if on, comes off to make room - a solid print
    // has no gaps for a ghost to show through
    const hadLattice = !!s.look.lattice;
    s.look = { ...s.look, ghost: true, lattice: false };
    writeLook(s.look);
    s.ghostTarget = 1;
    if (hadLattice) setLookEpoch((n) => n + 1);
  };

  const send = async (e, asked, opts) => {
    if (e) e.preventDefault();
    /* a help-sheet trick: the trick has already run on the page, this is
       the one line about it. Any token the model opens with is ignored, a
       failure drops the exchange in silence, and the wait is short. */
    const pillMode = !!(opts && opts.performed);
    const question = (asked != null ? asked : draft).trim();
    let before = msgs; // the transcript the question follows
    if (PICK.running) pickEnd();
    if (TOUR.running) {
      /* a word to the tour rather than a question: Enter or "next" moves
         on, "stop" ends it with the chat still open; anything else ends it
         and is answered as usual */
      const cmd = tourCommand(question);
      if (!question || cmd === "next") {
        setDraft("");
        tourNext();
        return;
      }
      if (cmd === "back") {
        setDraft("");
        tourBack();
        return;
      }
      if (cmd === "stop") {
        setDraft("");
        tourEnd("stop");
        return;
      }
      tourEnd("question");
      if (TOUR.transcript) before = TOUR.transcript; // the tour's record, which the state may not hold yet
    } else if (busy) {
      return;
    }
    if (!question) return;
    setHelp(false);
    const seq = ++sendSeq.current; // an aborted tour reply must not clear a newer question's busy state

    /* the transcript keeps each reply's stats and reasoning; only the copy
       sent to the worker is stripped to role and content */
    const history = before.concat({ role: "user", content: question });
    setMsgs(history.concat({ role: "assistant", content: "" }));
    setDraft("");
    setBusy(true);
    setThinking("");
    setStats(null);
    setWkFocus(null);
    stateRef.current.silent = false; // a question is answered aloud
    setWkTab("reply");
    setWkList(false);
    setWkPeek(null);
    phaseRef.current = { sendAt: performance.now(), thinkAt: 0, textAt: 0, pill: pillMode };
    setElapsed(0);
    stateRef.current.busy = true; // timer callbacks cannot see React state
    /* the fire pill has just queued the scream: leave it to play, and the
       line about it goes unvoiced, as when the model breathes the fire */
    const screaming = pillMode && opts.performed === "fire";
    if (!screaming) {
      stateRef.current.talkBuf = "";
      stateRef.current.talkPos = 0;
      stateRef.current.talkNext = 0;
    }
    stateRef.current.voicePitch = 0.95 + Math.random() * 0.2;
    ensureAudio(); // sending IS the user gesture autoplay policy wants

    /* pinned to THIS reply's slot, not the last message: the ghost trick's
       re-solidify closer can append a bubble while a later reply is still
       streaming, and last-message indexing would overwrite the closer with
       stream chunks */
    const replyAt = history.length;
    let thought = ""; // the reasoning, kept with the message once it is done
    let gotStats = null;
    const replace = (content) =>
      setMsgs((prev) => {
        const copy = prev.slice();
        if (replyAt < copy.length) {
          copy[replyAt] = { role: "assistant", content };
          if (thought) copy[replyAt].thinking = thought;
          if (gotStats) copy[replyAt].stats = gotStats;
        }
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
      performTrick(kind);
    };

    /* a stalled stream (hung upstream, half-dead connection) would wedge
       busy=true forever and disable the chat until reload - cap the whole
       exchange at 70s. Long enough to survive the free tier's slow days,
       because the slow-model notice keeps the visitor informed meanwhile. */
    const ctrl = new AbortController();
    const killT = setTimeout(() => ctrl.abort(), pillMode ? 15000 : 70000); // a trick's line is garnish, not worth a long wait
    const slowT = pillMode ? 0 : setTimeout(() => setSlowNote(true), 9000);
    const context = pageContext();
    if (pillMode) {
      context.performed = opts.performed;
      if (opts.undid) context.undid = opts.undid;
      if (opts.from) context.from = opts.from;
    }
    /* a tour reply is not shown as it streams: the raw text, tokens and all,
       goes to the tour controller, which plays it stop by stop */
    let tourMode = false;
    let raw = "";
    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        /* a help-sheet press goes to the model as what it is - a report that
           the button was pressed - not as the pill's words, which read as a
           request and drew "already so" for a look the press had just set;
           the transcript still shows the pill's words */
        body: JSON.stringify({
          messages: history.map(({ role, content }, i) =>
            pillMode && i === history.length - 1
              ? { role, content: "(I pressed the '" + opts.performed.replace(/-off$/, "") + "' button in the help sheet.)" }
              : { role, content }
          ),
          context,
        }),
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
      const served = res.headers.get("x-chat-model");
      if (served) {
        LAST_MODEL = prettyModel(served);
        setModel(LAST_MODEL);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      /* A trick token can arrive SPLIT across stream chunks, so the head of
         the reply is held back from both the transcript and the mouth until
         it either is a complete token or provably is not one - "[[gho"
         flashing on screen would give the whole game away. */
      let acc = "";
      let held = "";
      let decided = false;
      let acted = false;
      let pendingAct = null;
      let pendingNav = null;
      let muteVoice = screaming; // the fire pill's scream replaces the narration
      let firstText = false;
      /* the envelope: "maybe" while the opening could still be [[think]],
         "in" inside the reasoning block, "done" once the reply proper begins */
      let thinkStage = "maybe";
      const flow = (final) => {
        /* the stats record closes every stream: held back while it may be
           arriving (tailHold), stripped and kept once the stream ends */
        if (final) {
          const t = parseStatsTail(held);
          held = t.text;
          if (t.stats) {
            gotStats = t.stats;
            setStats(t.stats);
          }
        }
        const cut = final ? held.length : tailHold(held);
        let work = held.slice(0, cut);
        const rest = held.slice(cut);

        if (thinkStage === "maybe") {
          const probe = work.replace(/^\s+/, "");
          const open = parseThinkOpen(probe);
          if (open) {
            thinkStage = "in";
            if (!phaseRef.current.thinkAt) phaseRef.current.thinkAt = performance.now();
            work = probe.slice(open.length);
          } else if (probe && (final || probe.length >= tokenCap(probe) || !couldBeToken(probe))) {
            thinkStage = "done";
          } else if (!probe && final) {
            thinkStage = "done";
          } else {
            held = work + rest; // could still become [[think]]
            return;
          }
        }
        if (thinkStage === "in") {
          const part = splitThink(work);
          if (part.thought) {
            thought += part.thought;
            setThinking(thought);
          }
          if (part.closed) {
            thinkStage = "done";
            work = part.rest;
          } else {
            held = final ? "" : part.hold + rest;
            if (final) thinkStage = "done";
            return;
          }
        }

        if (tourMode) {
          /* a tour: nothing is shown here. The controller cuts the raw text
             into stops as it arrives and plays them at its own pace. */
          raw += work;
          held = rest;
          tourFeed(raw, final);
          return;
        }
        if (!decided) {
          /* leading whitespace decides nothing: some models put a space or a
             newline before a token */
          const probe = work.replace(/^\s+/, "");
          const tourTok = pillMode ? null : parseTourToken(probe);
          if (tourTok) {
            tourMode = true;
            decided = true;
            firstText = true;
            clearTimeout(slowT);
            setSlowNote(false);
            tourStart(history.concat({ role: "assistant", content: "" }), replyAt, ctrl);
            raw = probe.slice(tourTok.length);
            held = rest;
            tourFeed(raw, final);
            return;
          }
          const m = probe.match(/^\[\[(ghost|spin|fire|tint:#[0-9a-fA-F]{6}|lattice|wire|cloud|scatter|melt|shatter|ember|glitch|hue)\]\]\s*/);
          const act = m ? null : parseActToken(probe);
          if (m) {
            if (!pillMode) {
              /* in pill mode the trick already ran: a token here is the
                 model disobeying, and it is simply dropped */
              if (m[1] === "fire") muteVoice = true; // the scream replaces the narration
              fireTrick(m[1]);
            }
            work = stripExtraTokens(probe.slice(m[0].length));
            decided = true;
          } else if (act) {
            /* an action token. The page opens when the chat steps aside after
               the sentence, not now: the words get read first, and a head
               rendered by the landing page is not unmounted mid-reply by its
               own navigation. A target that cannot be resolved is dropped
               silently - the sentence still reads as an answer. */
            const to = pillMode ? null : resolveAction(act, { skillIds: SKILL_IDS_ALL, projectRefs: PROJECT_REFS });
            if (to) {
              pendingAct = act;
              pendingNav = to;
              acted = true;
            }
            work = stripExtraTokens(probe.slice(act.length));
            decided = true;
          } else if (!probe) {
            if (final) decided = true; // nothing but whitespace
            else {
              held = work + rest;
              return;
            }
          } else if (final || probe.length >= tokenCap(probe) || !couldBeToken(probe)) {
            work = pillMode ? stripExtraTokens(probe) : probe; // pill mode: no token of any kind reaches the visitor
            decided = true; // provably not a directive - let it all through
          } else {
            held = work + rest; // could still be a token: keep holding
            return;
          }
        }
        if (decided && work) {
          if (!firstText) {
            // once real text is flowing the wait is over - retire the notice
            firstText = true;
            clearTimeout(slowT);
            setSlowNote(false);
            if (!phaseRef.current.textAt) phaseRef.current.textAt = performance.now();
          }
          acc += work;
          // feed the viseme sequencer - the mouth sounds out this exact text
          // (unless a fire scream owns the voice for this reply)
          if (!muteVoice) {
            stateRef.current.talkBuf = (stateRef.current.talkBuf || "") + spokenText(work);
          }
          replace(acc);
        }
        held = rest;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        held += decoder.decode(value, { stream: true });
        flow(false);
      }
      flow(true);
      if (tourMode) {
        // the controller owns the rest: the stops, the moves, the transcript
        tourMeta(gotStats, thought);
      } else if (acc.trim()) {
        replace(acc); // once more, so the reasoning and the stats ride with the message
      } else if (!acc.trim()) {
        if (pillMode) {
          /* a help-sheet trick whose line came back empty (a bare token,
             stripped): the trick was the answer, so the exchange goes,
             question and all, rather than "(no answer came back)" */
          setMsgs((prev) => prev.filter((_, i) => i !== replyAt - 1 && i !== replyAt));
          setStats(null); // and its workings: the drawer goes back to the reply before
          setThinking("");
        } else if (trickFired || acted) {
          // token-only reply: drop the empty bubble - the trick IS the answer
          setMsgs((prev) => prev.filter((_, i) => i !== replyAt));
        } else {
          const none = "(no answer came back)";
          replace(none);
          stateRef.current.talkBuf += none;
        }
      }
      if (acted) {
        /* give the sentence a moment to be read, then open the page and step
           aside. Resolved again here in case the skills list arrived late. */
        const act = pendingAct;
        const first = pendingNav;
        setTimeout(() => {
          const to = resolveAction(act, { skillIds: SKILL_IDS_ALL, projectRefs: PROJECT_REFS }) || first;
          if (to) navigate(to);
          setOpen(false);
        }, 1500);
      }
    } catch (err) {
      if (tourMode) {
        /* the visitor stopped the tour mid-reply (the request was aborted),
           or the stream broke: the stops already shown stay as they are and
           whatever arrived in full still plays */
        if (TOUR.running) tourFeed(raw, true);
      } else if (pillMode) {
        /* the line was garnish: a failure drops the exchange rather than
           apologising for a trick that already happened */
        setMsgs((prev) => prev.filter((_, i) => i !== replyAt - 1 && i !== replyAt)); // only this exchange: a closer appended meanwhile stays
        setStats(null);
        setThinking("");
      } else {
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
      }
    } finally {
      clearTimeout(killT);
      clearTimeout(slowT);
      if (sendSeq.current === seq) {
        setSlowNote(false);
        stateRef.current.busy = false;
        setBusy(false);
      }
    }
  };

  sendRef.current = send;
  window.__fhPerform = performTrick; // console hook: any trick or look by its token name

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
      if (s.startFx) s.startFx("shatter"); // rattled hard enough: it comes apart, then reassembles
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
  /* the landing's cloud-shaped hit area drives the same drag (it sits over
     the portrait and takes the pointer there) */
  window.__fhDrag = { down: onStageDown, move: onStageMove, up: endDrag };

  if (!capable) return null;

  /* on a tour the caption shows the question and the current stop only */
  const tourAsked = tour ? [...msgs].reverse().find((m) => m.role === "user") : null;

  /* what the workings drawer shows: the reply in flight, else the last
     answered one (restored transcripts carry their stats and reasoning) */
  const lastAnswer = [...msgs].reverse().find((m) => m.role === "assistant" && (m.stats || m.thinking));
  const focused = wkFocus != null && msgs[wkFocus] && msgs[wkFocus].role === "assistant" ? msgs[wkFocus] : null;
  const wk = focused
    ? { thinking: focused.thinking || "", stats: focused.stats || null }
    : busy || thinking || stats
      ? { thinking, stats }
      : lastAnswer
        ? { thinking: lastAnswer.thinking || "", stats: lastAnswer.stats || null }
        : null;
  /* "reply 3 of 5": which answered message the drawer is about */
  const answered = msgs.map((m, i) => (m.role === "assistant" && m.stats ? i : -1)).filter((i) => i >= 0);
  const wkAbout = focused ? answered.indexOf(wkFocus) + 1 : answered.length;
  /* the whole conversation, added up, for the summary tab */
  const summary = answered.reduce(
    (t, i) => {
      const st = msgs[i].stats;
      t.n += 1;
      t.ms += typeof st.ms === "number" ? st.ms : 0;
      t.cents += typeof st.cents === "number" ? st.cents : 0;
      if (st.provider && st.provider !== "anthropic") t.backup += 1;
      else if (/haiku/.test(String(st.model || ""))) t.light += 1;
      else t.full += 1;
      if (st.cached > 0) t.hits += 1;
      t.cached += st.cached || 0;
      t.in += st.in || 0;
      t.out += st.out || 0;
      if (st.size && typeof st.size.complexity === "number") {
        t.sized += 1;
        t.cx += st.size.complexity;
      }
      return t;
    },
    { n: 0, ms: 0, cents: 0, backup: 0, light: 0, full: 0, hits: 0, cached: 0, in: 0, out: 0, sized: 0, cx: 0 }
  );
  /* the question each answered reply followed */
  const askedBefore = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) if (msgs[k].role === "user") return msgs[k].content;
    return "";
  };
  const wkIsLatest = !focused || wkFocus === answered[answered.length - 1];
  const wkStats = wk ? wk.stats : null;
  const wkBusy = busy && !wkStats;
  const wkBackup = !!(wkStats && wkStats.provider && wkStats.provider !== "anthropic");
  const wkSize = wkStats && wkStats.size ? wkStats.size : null;
  /* a help-sheet trick's line skips the sizer by design: every part of the
     drawer says so, rather than "sizing…" and then "no verdict in time" */
  const wkPill = wkStats ? !!wkStats.pill : wkBusy && !!phaseRef.current.pill;
  const wkLight = !!(wkStats && /haiku/.test(String(wkStats.model || "")));
  const wkEffort = wkStats ? wkStats.effort : wkPill ? "low" : ""; // a pill line always runs at low, known from the start
  const wkLevel = { low: 1, medium: 2, high: 3, xhigh: 3, max: 3 }[wkEffort] || 0;
  /* the phase bar: the server's figures once they are in, the page's clock
     while the reply is still arriving */
  const wkSeg = (() => {
    if (wkBackup && typeof wkStats.ms === "number") {
      return { s: 0, t: 0, w: wkStats.ms, total: wkStats.ms, live: false };
    }
    if (wkStats && typeof wkStats.ms === "number") {
      const sz = wkSize ? wkSize.ms || 0 : 0;
      const ttfb = typeof wkStats.ttfb === "number" && wkStats.ttfb > 0 ? wkStats.ttfb : wkStats.ms;
      return { s: sz, t: Math.max(0, ttfb - sz), w: Math.max(0, wkStats.ms - ttfb), total: wkStats.ms, live: false };
    }
    const ph = phaseRef.current;
    const now = ph.sendAt ? ph.sendAt + elapsed : 0;
    const sEnd = ph.thinkAt || ph.textAt || now;
    /* a pill line has no sizing: its wait before the first word is the
       answering call's, as the finished bar will show it */
    const s0 = ph.pill ? 0 : Math.max(0, sEnd - ph.sendAt);
    const t0 = ph.pill ? Math.max(0, (ph.textAt || now) - ph.sendAt) : ph.thinkAt ? Math.max(0, (ph.textAt || now) - ph.thinkAt) : 0;
    const w0 = ph.textAt ? Math.max(0, now - ph.textAt) : 0;
    return { s: s0, t: t0, w: w0, total: Math.max(0, elapsed), live: true };
  })();
  /* the pipeline as steps, each with the model that ran it: the sizer, the
     reasoning, the writing. Every number is also said in words. */
  /* step rows name the model without the vendor: "sonnet 5.5", "haiku 5.5" */
  const shortModel = (m) => (prettyModel(m) || "").replace(/^claude /, "");
  const wkModel = wkStats ? shortModel(wkStats.model) || wkStats.provider : shortModel(model) || "sonnet 5.5";
  const wkSteps = (() => {
    if (!wk) return [];
    const out = [];
    const ph = phaseRef.current;
    if (wkBackup) {
      out.push({
        id: "write",
        label: "answered",
        model: wkModel,
        ms: wkStats.ms,
        live: false,
        tip: WK_TIPS.answer,
        status: kfmt(wkStats.out) + " tokens out",
        body: (
          <p className="fh-wk-body fh-wk-gloss">
            <span className="fh-wk-raw">
              {kfmt(wkStats.in || 0)} in · {kfmt(wkStats.out || 0)} out
            </span>
          </p>
        ),
      });
      return out;
    }
    out.push({
      id: "size",
      label: wkPill ? "not sized" : "sized",
      model: wkPill ? "" : shortModel((wkSize && wkSize.model) || "claude-haiku-5-5"),
      ms: wkPill ? null : wkSize ? wkSize.ms : wkBusy && !ph.thinkAt && !ph.textAt ? elapsed : wkStats ? 0 : null,
      live: !wkPill && wkBusy && !ph.thinkAt && !ph.textAt,
      tip: wkPill ? WK_TIPS.pill : WK_TIPS.size,
      cents: wkSize && typeof wkSize.cents === "number" ? wkSize.cents : null,
      status: wkPill ? "help-sheet trick" : wkSize ? wkSize.complexity + "/5 · " + (KIND_WORDS[wkSize.kind] || wkSize.kind) : wkBusy ? "sizing…" : "no verdict",
      body: (
        <p className="fh-wk-body fh-wk-verdict">
          {wkSize ? (
            <>
              <span className="fh-wk-raw">
                {wkSize.complexity} · {wkSize.kind}
              </span>
              <span className="fh-wk-gloss">
                {" → " + (wkStats ? (wkLight ? wkModel + " answers it" : "handed to " + wkModel + ", " + (wkEffort || "low") + " effort") : "…")}
              </span>
            </>
          ) : wkPill ? (
            <span className="fh-wk-gloss">the trick already ran → {wkStats ? wkModel : "haiku 5.5"} writes a line about it</span>
          ) : wkBusy ? (
            "…"
          ) : (
            <span className="fh-wk-gloss">no verdict in time → {wkModel || "sonnet"}, low effort</span>
          )}
        </p>
      ),
    });
    /* a row only when the model reasoned (or is reasoning now): an answer
       that came straight out, Haiku's usually, has no step to show */
    if (wk.thinking || (wkBusy && ph.thinkAt)) {
      out.push({
        id: "think",
        label: "thought",
        model: wkModel,
        ms: wkStats ? wkSeg.t : ph.thinkAt ? wkSeg.t : null,
        live: wkBusy && !!ph.thinkAt && !ph.textAt,
        tip: WK_TIPS.think,
        cents: null,
        costNote: "incl.",
        status: wk.thinking ? kfmt(wk.thinking.length) + " chars" : "thinking…",
        body: <p className="fh-wk-body fh-wk-think">{wk.thinking ? wk.thinking : "…"}</p>,
      });
    }
    return out;
  })();
  /* the answer line under the steps: what came out, not a step of the pipeline */
  const wkAnswer = wk && !wkBackup
    ? {
        ms: wkStats ? wkSeg.w : phaseRef.current.textAt ? wkSeg.w : null,
        live: wkBusy && !!phaseRef.current.textAt,
        /* the answering call's own cost: the total less the sizer's */
        cents: wkStats && typeof wkStats.cents === "number" ? Math.max(0, wkStats.cents - ((wkSize && wkSize.cents) || 0)) : null,
        detail: wkStats
          ? wkStats.stop && wkStats.stop !== "end_turn"
            ? "cut off"
            : ""
          : wkBusy && phaseRef.current.textAt
            ? "writing…"
            : "",
      }
    : null;

  const portrait = (
    <button
        type="button"
        className={
          "fh-mini" +
          (mode === "tablet" ? " fh-mini-inline" : "") +
          (open || mode === "phone" ? " fh-mini-hidden" : "")
        }
        ref={miniRef}
        /* a tap opens; a drag turns the head (and a rattle shakes it) and
           the click that follows a drag is swallowed. touch-action: none on
           the host keeps a finger-drag from panning the page instead. */
        onClick={() => {
          const s = stateRef.current;
          if (s.swallowClick) { s.swallowClick = false; return; }
          setOpen(true);
        }}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={() => {
          const s = stateRef.current;
          const dragged = s.dragging && s.moved > 8;
          endDrag();
          if (dragged) s.swallowClick = true;
        }}
        onPointerCancel={endDrag}
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
            className={"fh-overlay" + (caption ? " fh-tour" : "") + (pick ? " fh-pick" : "")}
            ref={overlayRef}
          role="dialog"
          aria-modal={caption ? "false" : "true"}
          aria-label="3D portrait"
          onClick={() => {
            if (stateRef.current.moved > 6) {
              stateRef.current.moved = 0;
              return;
            }
            dismiss();
          }}
        >
          <button
            type="button"
            className="fh-close"
            onClick={dismiss}
            aria-label="Close"
          >
            ×
          </button>
          {CHAT_ENDPOINT && !caption && (
            <button
              type="button"
              className={"fh-close fh-help-btn" + (help ? " on" : "")}
              onClick={(e) => {
                e.stopPropagation();
                setHelp((v) => !v);
              }}
              aria-expanded={help}
              aria-label="What this can do"
              title="What this can do"
            >
              ?
            </button>
          )}
          {!COARSE && wkList && wkHover != null && msgs[wkHover] && (
            <div className="fh-wk-peekcard" role="status">
              <span className="fh-wk-peekcard-n">reply {answered.indexOf(wkHover) + 1}</span>
              <span className="fh-wk-preview-q">{askedBefore(wkHover)}</span>
              <span className="fh-wk-preview-a">
                {String(msgs[wkHover].content || "").slice(0, 420)}
                {String(msgs[wkHover].content || "").length > 420 ? "…" : ""}
              </span>
            </div>
          )}
          <div
            className="fh-stage"
            ref={stageRef}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {CHAT_ENDPOINT ? (
            <ChatShield
              key={chatEpoch}
              onReset={() => {
                setMsgs([]);
                setChatEpoch((c) => c + 1);
              }}
            >
            <div
              className={"fh-chat" + (caption && tourMin ? " fh-tour-min" : "")}
              ref={chatRef}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {wkRead && (
                <span className="fh-read" role="tooltip" style={{ left: wkRead.x, top: wkRead.y }}>
                  {wkRead.text}
                </span>
              )}
              {/* on a tour the portrait shrinks to a caption-sized host above
                  the words, so the page behind can be seen changing */}
              {caption && (
                <div
                  className="fh-tour-head"
                  ref={tourHeadRef}
                  aria-hidden="true"
                  onPointerDown={onStageDown}
                  onPointerMove={onStageMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <i className="fh-tour-seam" />
                </div>
              )}
              {caption && (
                <div className="fh-tour-ctl">
                  <button
                    type="button"
                    className="fh-tour-ctlb"
                    onClick={() => setTourMin((v) => !v)}
                    aria-label={tourMin ? "Expand the tour" : "Minimise the tour"}
                    title={tourMin ? "expand" : "minimise"}
                  >
                    {tourMin ? "\u25B4" : "\u2013"}
                  </button>
                  <button type="button" className="fh-tour-ctlb" onClick={dismiss} aria-label="Close" title="close">
                    {"\u00D7"}
                  </button>
                </div>
              )}
              {caption && tourMin && (
                <button type="button" className="fh-tour-pill" onClick={() => setTourMin(false)}>
                  {tour
                    ? tourPage.ended
                      ? "end of the tour"
                      : tourPage.i < 0
                        ? "starting the tour"
                        : "stop " + (tourPage.i + 1) + (tourPage.more ? "" : " of " + tourPage.n)
                    : "choose a project"}
                  <span className="fh-caret open" aria-hidden="true">{"\u25B8"}</span>
                </button>
              )}
              {/* Outside the log on purpose: inside it, it scrolled away with
                  the transcript, so collapsing a long conversation meant
                  scrolling up to find the control that collapses it. The
                  workings toggle shares the row, on the right. */}
              {!caption && (msgs.length > 0 || wk) && (
                <div className="fh-tools">
                  {msgs.length > 2 ? (
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
                  ) : (
                    <span />
                  )}
                  <div className="fh-tools-r">
                  {msgs.length > 0 && (
                    <button
                      type="button"
                      className={"fh-more fh-clear" + (holdT > 0 ? " holding" : "")}
                      style={{ "--hold": holdT }}
                      onPointerDown={holdStart}
                      onPointerUp={holdEnd}
                      onPointerLeave={holdEnd}
                      onPointerCancel={holdEnd}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") holdStart(e);
                      }}
                      onKeyUp={(e) => {
                        if (e.key === "Enter" || e.key === " ") holdEnd();
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      aria-label="Hold to clear the conversation"
                      title="hold to clear"
                    >
                      <span className="fh-clear-fill" aria-hidden="true" />
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                      </svg>
                      <span className="fh-clear-t">{holdT > 0 ? "hold\u2026" : "clear"}</span>
                    </button>
                  )}
                  {wk && (
                    <button
                      type="button"
                      className="fh-more fh-wk-btn"
                      onClick={toggleWorkings}
                      aria-expanded={workings}
                      aria-controls="fh-workings"
                      aria-label={
                        workings
                          ? "hide the workings"
                          : "show the workings: " +
                            (wkSize ? "complexity " + wkSize.complexity + " of 5, " : "") +
                            (wkEffort ? wkEffort + " effort, " : "") +
                            secs(wkSeg.total) +
                            (wkStats && typeof wkStats.cents === "number" ? ", " + usd(wkStats.cents) : "")
                      }
                    >
                      {!workings && wkBackup && (
                        <span className="fh-wk-mini" aria-hidden="true">
                          <i className="fh-wk-dot miss" />
                          <span className="fh-wk-mini-t">backup · {secs(wkSeg.total)}</span>
                        </span>
                      )}
                      {!workings && !wkBackup && (
                        <span className="fh-wk-mini" aria-hidden="true">
                          <span className={"fh-wk-dots" + (wkBusy && !wkSize && !wkPill ? " fh-wk-live" : "")} {...rd(false, wkSize ? readCx(wkSize.complexity) : wkPill ? "not sized: a help-sheet trick" : wkBusy ? "sizing…" : "not sized")}>
                            {[1, 2, 3, 4, 5].map((i) => (
                              <i key={i} className={wkSize && i <= wkSize.complexity ? "on" : ""} />
                            ))}
                          </span>
                          <span className="fh-wk-steps" {...rd(false, wkEffort ? readEffort(wkEffort, wkLevel) : "default effort")}>
                            {[1, 2, 3].map((i) => (
                              <i key={i} className={i <= wkLevel ? "on" : ""} />
                            ))}
                          </span>
                          <i className={"fh-wk-dot" + (wkStats && wkStats.cached > 0 ? " hit" : wkStats ? " miss" : "")} {...rd(false, readCache(wkStats))} />
                          <span className="fh-wk-mini-t">{secs(wkSeg.total)}</span>
                          {wkStats && typeof wkStats.cents === "number" && <span className="fh-wk-mini-t">{usd(wkStats.cents)}</span>}
                        </span>
                      )}
                      workings
                      <span className={"fh-caret" + (workings ? " open" : "")}>▸</span>
                    </button>
                  )}
                  </div>
                </div>
              )}
              {!caption && wk && workings && (
                <section id="fh-workings" className={"fh-workings" + (wkFlash ? " fh-flash" : "")} aria-label="How the answer was made">
                  {answered.length > 0 && (
                    <div className="fh-wk-head" role="tablist" aria-label="Workings views">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={wkTab === "reply"}
                        aria-expanded={wkList}
                        className={"fh-wk-tab" + (wkTab === "reply" ? " on" : "")}
                        onClick={() => {
                          if (wkTab !== "reply") setWkTab("reply");
                          else setWkList((v) => !v);
                        }}
                      >
                        {wkBusy ? "this reply" : "reply " + wkAbout + " of " + answered.length}
                        <span className={"fh-caret" + (wkList ? " open" : "")} aria-hidden="true">▸</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={wkTab === "summary"}
                        className={"fh-wk-tab" + (wkTab === "summary" ? " on" : "")}
                        onClick={() => {
                          setWkTab("summary");
                          setWkList(false);
                        }}
                      >
                        summary
                      </button>
                      {wkTab === "reply" && !wkIsLatest && (
                        <button type="button" className="fh-wk-latest" onClick={() => setWkFocus(null)}>
                          latest
                        </button>
                      )}
                    </div>
                  )}
                  {wkTab === "reply" && wkList && (
                    <ul className="fh-wk-replies" aria-label="Replies">
                      {answered.map((idx, n) => {
                        const m = msgs[idx];
                        const q = askedBefore(idx);
                        const here = focused ? wkFocus === idx : idx === answered[answered.length - 1];
                        const peek = wkPeek === idx;
                        return (
                          <li key={idx} className={"fh-wk-reply" + (here ? " on" : "") + (peek ? " fh-peek" : "")}>
                            <button
                              type="button"
                              className="fh-wk-reply-go"
                              onClick={() => {
                                setWkFocus(idx);
                                setWkList(false);
                                setWkPeek(null);
                                setWkHover(null);
                              }}
                              onMouseEnter={COARSE ? undefined : () => setWkHover(idx)}
                              onMouseLeave={COARSE ? undefined : () => setWkHover(null)}
                              onFocus={COARSE ? undefined : () => setWkHover(idx)}
                              onBlur={COARSE ? undefined : () => setWkHover(null)}
                              aria-current={here ? "true" : undefined}
                            >
                              <span className="fh-wk-reply-n">{n + 1}</span>
                              <span className="fh-wk-reply-q">{q}</span>
                              <span className="fh-wk-reply-meta">
                                {shortModel(m.stats.model)} · {secs(m.stats.ms)}
                                {typeof m.stats.cents === "number" ? " · " + usd(m.stats.cents) : ""}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="fh-wk-reply-peek"
                              aria-expanded={peek}
                              aria-label="Show the question and the answer"
                              onClick={() => setWkPeek(peek ? null : idx)}
                            >
                              …
                            </button>
                            <div className="fh-wk-preview">
                              <span className="fh-wk-preview-q">{q}</span>
                              <span className="fh-wk-preview-a">{String(m.content || "").slice(0, 280)}{String(m.content || "").length > 280 ? "…" : ""}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {wkTab === "summary" && answered.length > 0 && (
                    <div className="fh-wk-sum" aria-label="This conversation, added up">
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">replies</span>
                        <span className="fh-wk-sum-v">{summary.n}</span>
                        <span className="fh-wk-sum-bar" aria-hidden="true">
                          <i className="light" style={{ flexGrow: summary.light }} {...rd(pctOf(summary.light, summary.n) + " by haiku: " + replies(summary.light))} />
                          <i className="full" style={{ flexGrow: summary.full }} {...rd(pctOf(summary.full, summary.n) + " by sonnet: " + replies(summary.full))} />
                          <i className="backup" style={{ flexGrow: summary.backup }} {...rd(pctOf(summary.backup, summary.n) + " by a backup model: " + replies(summary.backup))} />
                        </span>
                        <span className="fh-wk-sum-g">
                          {[summary.light ? summary.light + " haiku" : "", summary.full ? summary.full + " sonnet" : "", summary.backup ? summary.backup + " backup" : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">cost</span>
                        <span className="fh-wk-sum-v">{usd(summary.cents)}</span>
                        <span className="fh-wk-sum-g">{usd(summary.cents / summary.n)} per reply</span>
                      </div>
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">time</span>
                        <span className="fh-wk-sum-v">{secs(summary.ms)}</span>
                        <span className="fh-wk-sum-g">{secs(summary.ms / summary.n)} per reply</span>
                      </div>
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">cache</span>
                        <span className="fh-wk-sum-v">{Math.round((100 * summary.hits) / summary.n)}%</span>
                        <span className="fh-wk-sum-g">
                          {summary.hits} of {summary.n} hits
                        </span>
                      </div>
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">tokens</span>
                        <span className="fh-wk-sum-v">{kfmt(summary.cached + summary.in + summary.out)}</span>
                        <span className="fh-wk-sum-g">
                          {kfmt(summary.cached)} cached · {kfmt(summary.in)} in · {kfmt(summary.out)} out
                        </span>
                      </div>
                      <div className="fh-wk-sum-tile">
                        <span className="fh-wk-sum-k">complexity</span>
                        <span className="fh-wk-sum-v">{summary.sized ? (summary.cx / summary.sized).toFixed(1) + "/5" : "—"}</span>
                        <span className="fh-wk-dots" aria-hidden="true" {...rd(summary.sized ? "average " + (summary.cx / summary.sized).toFixed(1) + "/5 complexity over " + replies(summary.sized) : "none rated")}>
                          {[1, 2, 3, 4, 5].map((i) => (
                            <i key={i} className={summary.sized && i <= Math.round(summary.cx / summary.sized) ? "on" : ""} />
                          ))}
                        </span>
                        <span className="fh-wk-sum-g">{summary.sized ? "average of " + summary.sized + " rated" : "none rated"}</span>
                      </div>
                    </div>
                  )}
                  {wkTab === "reply" && (
                  <>
                  {wkBackup ? (
                    <div className={"fh-wk-backup fh-tip" + tipCls("backup")} tabIndex={0} aria-describedby="fh-tip-backup" onClick={tipTap("backup")}>
                      <i className="fh-wk-dot miss" aria-hidden="true" />
                      <span>
                        <span className="fh-wk-k">backup</span> model answered <span className="fh-wk-gloss">· {wkModel}</span>
                      </span>
                      
                      <span role="tooltip" id="fh-tip-backup" className="fh-tip-text">
                        {WK_TIPS.backup}
                      </span>
                    </div>
                  ) : (
                    <div className="fh-wk-grid">
                      <div className={"fh-wk-item fh-tip" + tipCls("complexity")} tabIndex={0} aria-describedby="fh-tip-complexity" onClick={tipTap("complexity")}>
                        <span className="fh-wk-k">
                          complexity
                        </span>
                        <span className={"fh-wk-dots" + (wkBusy && !wkSize && !wkPill ? " fh-wk-live" : "")} aria-hidden="true" {...rd(wkSize ? readCx(wkSize.complexity) : wkPill ? "not sized: a help-sheet trick" : wkBusy ? "sizing…" : "not sized")}>
                          {[1, 2, 3, 4, 5].map((i) => (
                            <i key={i} className={wkSize && i <= wkSize.complexity ? "on" : ""} />
                          ))}
                        </span>
                        <span className="fh-wk-val">
                          {wkSize ? (
                            <>
                              {wkSize.complexity}/5 <span className="fh-wk-gloss">· {KIND_WORDS[wkSize.kind] || wkSize.kind}</span>
                            </>
                          ) : wkPill ? (
                            <>
                              not sized <span className="fh-wk-gloss">· help-sheet trick</span>
                            </>
                          ) : wkBusy ? (
                            "sizing…"
                          ) : (
                            "not sized"
                          )}
                        </span>
                        <span role="tooltip" id="fh-tip-complexity" className="fh-tip-text">
                          {WK_TIPS.complexity}
                        </span>
                      </div>
                      <div className={"fh-wk-item fh-tip" + tipCls("effort")} tabIndex={0} aria-describedby="fh-tip-effort" onClick={tipTap("effort")}>
                        <span className="fh-wk-k">
                          effort
                        </span>
                        <span className="fh-wk-steps" aria-hidden="true" {...rd(wkEffort ? readEffort(wkEffort, wkLevel) : wkBusy && !wkPill ? "deciding…" : "default effort")}>
                          {[1, 2, 3].map((i) => (
                            <i key={i} className={i <= wkLevel ? "on" : ""} />
                          ))}
                        </span>
                        <span className="fh-wk-val">
                          {wkEffort ? (
                            <>
                              {wkEffort} <span className="fh-wk-gloss">· {EFFORT_WORDS[wkEffort] || ""}</span>
                            </>
                          ) : wkBusy && !wkPill ? (
                            "deciding…"
                          ) : (
                            "default"
                          )}
                        </span>
                        <span role="tooltip" id="fh-tip-effort" className="fh-tip-text">
                          {WK_TIPS.effort}
                        </span>
                      </div>
                      <div className={"fh-wk-item fh-tip" + tipCls("cache")} tabIndex={0} aria-describedby="fh-tip-cache" onClick={tipTap("cache")}>
                        <span className="fh-wk-k">
                          prompt
                        </span>
                        <i
                          className={
                            "fh-wk-dot" +
                            (wkStats && wkStats.cached > 0 ? " hit" : wkStats && wkStats.cacheWrite > 0 ? " wrote" : wkStats ? " miss" : "")
                          }
                          aria-hidden="true"
                          {...rd(readCache(wkStats))}
                        />
                        <span className="fh-wk-val">
                          {wkStats && typeof wkStats.cached === "number" ? (
                            wkStats.cached > 0 ? (
                              <>
                                cached <span className="fh-wk-gloss">· {kfmt(wkStats.cached)} tok</span>
                              </>
                            ) : wkStats.cacheWrite > 0 ? (
                              <>
                                cache written{" "}
                                <span className="fh-wk-gloss">
                                  · {kfmt(wkStats.cacheWrite)} tok · 1 h
                                  {typeof wkStats.cacheWriteCents === "number" && wkStats.cacheWriteCents > 0
                                    ? " · " + usd(wkStats.cacheWriteCents) + " to write, kept out of the cost"
                                    : ""}
                                </span>
                              </>
                            ) : (
                              <>
                                not cached <span className="fh-wk-gloss">· {kfmt(wkStats.in)} tok</span>
                              </>
                            )
                          ) : (
                            "…"
                          )}
                        </span>
                        <span role="tooltip" id="fh-tip-cache" className="fh-tip-text">
                          {WK_TIPS.cache}
                        </span>
                      </div>
                      <div className={"fh-wk-item fh-tip" + tipCls("tokens")} tabIndex={0} aria-describedby="fh-tip-tokens" onClick={tipTap("tokens")}>
                        <span className="fh-wk-k">tokens</span>
                        <span className="fh-wk-io" aria-hidden="true">
                          <i
                            className="in"
                            style={{ flexGrow: Math.max(1, (wkStats && wkStats.in) || 0) }}
                            {...rd(wkStats ? pctOf(wkStats.in || 0, (wkStats.in || 0) + (wkStats.out || 0)) + " tokens input: " + kfmt(wkStats.in || 0) : "")}
                          />
                          <i
                            className="out"
                            style={{ flexGrow: Math.max(1, (wkStats && wkStats.out) || 0) }}
                            {...rd(wkStats ? pctOf(wkStats.out || 0, (wkStats.in || 0) + (wkStats.out || 0)) + " tokens output: " + kfmt(wkStats.out || 0) : "")}
                          />
                        </span>
                        <span className="fh-wk-val">
                          {wkStats && typeof wkStats.in === "number" ? (
                            <>
                              {kfmt(wkStats.in)} in <span className="fh-wk-gloss">· {kfmt(wkStats.out || 0)} out</span>
                            </>
                          ) : (
                            "…"
                          )}
                        </span>
                        <span role="tooltip" id="fh-tip-tokens" className="fh-tip-text">
                          {WK_TIPS.tokens}
                        </span>
                      </div>
                      <div className={"fh-wk-item fh-tip" + tipCls("cost")} tabIndex={0} aria-describedby="fh-tip-cost" onClick={tipTap("cost")}>
                        <span className="fh-wk-k">
                          cost
                        </span>
                        <span aria-hidden="true" />
                        <span className="fh-wk-val fh-wk-cost">{wkStats && typeof wkStats.cents === "number" ? usd(wkStats.cents) : "…"}</span>
                        <span role="tooltip" id="fh-tip-cost" className="fh-tip-text">
                          {WK_TIPS.cost}
                        </span>
                      </div>
                      <div
                        className={"fh-wk-item fh-wk-time fh-tip" + tipCls("time")}
                        tabIndex={0}
                        aria-describedby="fh-tip-time"
                        onClick={tipTap("time")}
                        aria-label={
                          (wkSeg.total / 1000).toFixed(1) +
                          " seconds: sizing " + (wkSeg.s / 1000).toFixed(1) +
                          ", thinking " + (wkSeg.t / 1000).toFixed(1) +
                          ", writing " + (wkSeg.w / 1000).toFixed(1)
                        }
                      >
                        <span className="fh-wk-k">
                          time
                        </span>
                        <span className={"fh-wk-tbar" + (wkSeg.live ? " fh-wk-live" : "")} aria-hidden="true">
                          <i className="s" style={{ flexGrow: Math.max(0.02, wkSeg.s) }} {...rd(pctOf(wkSeg.s, wkSeg.total) + " sizing: " + secs(wkSeg.s))} />
                          <i className="k" style={{ flexGrow: Math.max(0.001, wkSeg.t) }} {...rd(pctOf(wkSeg.t, wkSeg.total) + " thinking: " + secs(wkSeg.t))} />
                          <i className="w" style={{ flexGrow: Math.max(0.001, wkSeg.w) }} {...rd(pctOf(wkSeg.w, wkSeg.total) + " writing: " + secs(wkSeg.w))} />
                        </span>
                        <span className="fh-wk-val fh-wk-secs">{secs(wkSeg.total)}</span>
                        <span role="tooltip" id="fh-tip-time" className="fh-tip-text">
                          {WK_TIPS.time}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="fh-wk-steps-list">
                    {wkSteps.map((st) => (
                      <div key={st.id} className={"fh-wk-step" + (wkOpen[st.id] ? " open" : "")}>
                        <div className={"fh-wk-step-row fh-tip" + tipCls("step-" + st.id)}>
                          <button
                            type="button"
                            className={"fh-wk-step-btn" + (st.live ? " fh-wk-live" : "")}
                            id={"fh-wk-h-" + st.id}
                            aria-expanded={!!wkOpen[st.id]}
                            aria-controls={"fh-wk-p-" + st.id}
                            aria-describedby={"fh-tip-step-" + st.id}
                            onClick={() => setWkOpen((o) => ({ ...o, [st.id]: !o[st.id] }))}
                          >
                            <i className={"fh-wk-sdot " + st.id} aria-hidden="true" />
                            <span className="fh-wk-slabel" onClick={tipTapStop("step-" + st.id)}>
                              {st.label}
                            </span>
                            <span className="fh-wk-smodel">{st.model}</span>
                            <span className="fh-wk-sms">{secs(st.ms)}</span>
                            <span className="fh-wk-scost">{typeof st.cents === "number" ? usd(st.cents) : st.costNote || ""}</span>
                            <span className={"fh-caret" + (wkOpen[st.id] ? " open" : "")} aria-hidden="true">▸</span>
                          </button>
                          <span role="tooltip" id={"fh-tip-step-" + st.id} className="fh-tip-text">
                            {st.tip}
                          </span>
                        </div>
                        {wkOpen[st.id] && (
                          <div className={"fh-wk-step-panel " + st.id} id={"fh-wk-p-" + st.id} role="region" aria-labelledby={"fh-wk-h-" + st.id}>
                            {st.body}
                          </div>
                        )}
                      </div>
                    ))}
                    {wkAnswer && (
                      <div className={"fh-wk-answer fh-tip" + tipCls("reply")} tabIndex={0} aria-describedby="fh-tip-reply" onClick={tipTap("reply")}>
                        <i className={"fh-wk-sdot write" + (wkAnswer.live ? " fh-wk-live" : "")} aria-hidden="true" />
                        <span className="fh-wk-slabel">answer</span>
                        <span className="fh-wk-smodel">
                          {wkModel}
                          {wkAnswer.detail ? <span className="fh-wk-gloss"> · {wkAnswer.detail}</span> : null}
                        </span>
                        <span className="fh-wk-sms">{secs(wkAnswer.ms)}</span>
                        <span className="fh-wk-scost">{typeof wkAnswer.cents === "number" ? usd(wkAnswer.cents) : ""}</span>
                        <span aria-hidden="true" />
                        <span role="tooltip" id="fh-tip-reply" className="fh-tip-text">
                          {WK_TIPS.reply}
                        </span>
                      </div>
                    )}
                  </div>
                  </>
                  )}
                </section>
              )}
              {help && !caption && (
                <HelpSheet
                  look={stateRef.current.look}
                  onTry={(q) => send(null, q)}
                  onTrick={(kind) => {
                    setHelp(false);
                    /* a look's pill is a toggle: pressed while that look is
                       on, it takes the look off - and the line says so */
                    const id = kind.startsWith("tint:") ? "tint" : kind;
                    const look = LOOKS.find((l) => l.id === id);
                    const before = { ...stateRef.current.look };
                    const off = !!(look && look.off && before[id]);
                    performTrick(off ? id + "-off" : kind);
                    /* a look that this press switched off on the side (the
                       halftone taking a ghost off, a ghost taking the
                       halftone off, one of halftone/wire replacing the
                       other), so the line can say so */
                    const after = stateRef.current.look;
                    const undid = off ? "" : ["ghost", "lattice", "wire"].filter((k) => k !== id && before[k] && !after[k]).join("+");
                    /* and a line about it: the pill's own words go as the
                       question, with the trick marked as already done, so
                       the model only remarks (see the worker's contextLine).
                       Skipped while a reply is in flight; never waited on. */
                    /* the form it was in before the press, so the line can say
                       what it went from and to */
                    const from = lookName(before) || "cloud";
                    if (look && CHAT_ENDPOINT) send(null, off ? look.off : look.q, { performed: off ? id + "-off" : id, undid, from });
                  }}
                  onWorkings={() => {
                    setHelp(false);
                    if (!workings) toggleWorkings();
                    else flashWorkings();
                  }}
                  onPick={() => {
                    setHelp(false);
                    if (window.location.pathname !== "/projects") navigate("/projects");
                    pickStart();
                  }}
                  onClose={() => setHelp(false)}
                />
              )}
              {(msgs.length > 0 || pick) && !help && (
                <div className="fh-log" ref={logRef}>
                  {pick && (
                    <p className="fh-msg fh-assistant fh-pick-line">
                      <span className="fh-who">hyder</span>
                      {pickHover ? (
                        <>
                          <span className="fh-lead">{pickHover}</span> {COARSE ? "- tap it and I'll tell you about it." : "- click it and I'll tell you about it."}
                        </>
                      ) : COARSE ? (
                        "Tap a project card and I'll tell you about it."
                      ) : (
                        "Point at a project card and click it; I'll tell you about it."
                      )}
                    </p>
                  )}
                  {tour && (
                    <>
                      {tourAsked && (
                        <p className="fh-msg fh-user">
                          <span className="fh-who">you</span>
                          {userText(tourAsked.content)}
                        </p>
                      )}
                      <p key={"tour-page-" + tourPage.i} className="fh-msg fh-assistant fh-live fh-tour-page">
                        <span className="fh-who">hyder</span>
                        {tourPage.text ? (
                          renderReply(tourPage.text, dismiss, true, (q, kind) => (kind ? performTrick(kind) : send(null, q)))
                        ) : (
                          <span className="fh-cue fh-cue-wait" role="status" aria-label="thinking" />
                        )}
                      </p>
                    </>
                  )}
                  {!caption && (showAll ? msgs : msgs.slice(-2)).map((m, i, shown) => {
                    const last = i === shown.length - 1;
                    const base = showAll ? 0 : Math.max(0, msgs.length - 2); // index into msgs
                    /* the reply being delivered: words fade in as they arrive
                       and a cue breathes with the mouth until it has said them */
                    const live = m.role === "assistant" && last && (busy || speaking || tour);
                    return (
                      <p key={i} className={"fh-msg fh-" + m.role + (live ? " fh-live" : "")}>
                        <span className="fh-who">
                          {m.role === "user" ? "you" : "hyder"}
                        </span>
                        {m.role === "assistant" && m.tour && m.tour.steps.length ? (
                          <button
                            type="button"
                            className="fh-tour-card"
                            onClick={() => tourResume(msgs, base + i)}
                            aria-label="Back to the guided tour"
                          >
                            <span className="fh-tour-card-t">
                              guided tour · {m.tour.steps.length + (m.tour.steps.length === 1 ? " stop" : " stops")}
                              {m.tour.ended || m.tour.index >= m.tour.steps.length - 1
                                ? " · seen"
                                : m.tour.index >= 0
                                  ? " · left at " + (m.tour.index + 1)
                                  : ""}
                            </span>
                            <span className="fh-tour-card-go">back to the tour ›</span>
                          </button>
                        ) : m.role === "assistant" ? (
                          renderReply(m.content, dismiss, live, (q, kind) => (kind ? performTrick(kind) : send(null, q)))
                        ) : (
                          userText(m.content)
                        )}
                        {m.role === "assistant" && last && busy ? (
                          <span
                            className={"fh-cue" + (m.content ? "" : " fh-cue-wait")}
                            role={m.content ? undefined : "status"}
                            aria-label={m.content ? undefined : "thinking"}
                          />
                        ) : null}
                        {m.role === "assistant" && m.stats && !(last && busy) ? (
                          <button
                            type="button"
                            className={"fh-msg-meta" + (workings && wkFocus === base + i ? " on" : "")}
                            onClick={() => {
                              /* the line under the answer is a toggle: open on
                                 this reply, or close if it is already showing */
                              if (workings && wkFocus === base + i) {
                                toggleWorkings();
                                return;
                              }
                              setWkFocus(base + i);
                              if (!workings) toggleWorkings();
                            }}
                            aria-expanded={workings && wkFocus === base + i}
                            aria-label="How this reply was made"
                          >
                            {[secs(m.stats.ms), usd(m.stats.cents), "workings"].filter(Boolean).join(" · ")}
                          </button>
                        ) : null}
                      </p>
                    );
                  })}
                  {busy && slowNote && (
                    <p className="fh-msg fh-assistant fh-slownote">
                      <span className="fh-who">hyder</span>
                      The model behind me is running slow right now — that's
                      it, not the site. Bear with me, or come back in a bit
                      and I'll be quicker.
                    </p>
                  )}
                </div>
              )}
              {tour && (
                <div className="fh-tour-bar">
                  <button type="button" className="fh-tour-btn" disabled={tourPage.i <= 0} onClick={() => tourBack()}>
                    ‹ back
                  </button>
                  <span className="fh-tour-pos">
                    {tourPage.ended
                      ? "end of the tour"
                      : tourPage.i < 0
                        ? "starting the tour"
                        : "stop " + (tourPage.i + 1) + (tourPage.more ? "" : " of " + tourPage.n) + (tourPage.waiting ? " · next is on its way" : "")}
                  </span>
                  <button
                    type="button"
                    className="fh-tour-btn"
                    disabled={tourPage.ended || (tourPage.waiting && tourPage.more) || tourPage.i < 0}
                    onClick={() => tourNext()}
                  >
                    next ›
                  </button>
                  <button type="button" className="fh-tour-btn" onClick={() => tourEnd("stop")}>
                    {tourPage.ended ? "done" : "stop"}
                  </button>
                </div>
              )}
              {msgs.length === 0 && !help && !caption && (
                <div className="fh-starters" aria-label="Things to try">
                  {starters.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={"fh-starter" + (q === STARTER_STAR ? " fh-starter-star" : "")}
                      onClick={() => send(null, q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {pick && (
                <div className="fh-tour-bar">
                  <span className="fh-tour-pos">choose a project</span>
                  <button type="button" className="fh-tour-btn" onClick={() => pickEnd()}>
                    cancel
                  </button>
                </div>
              )}
              <form className="fh-ask" ref={askRef} onSubmit={send}>
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    /* Tab takes the question the placeholder is typing, as
                       text to edit or send; it never sends */
                    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !draft && ghostRef.current && !TOUR.running) {
                      e.preventDefault();
                      setDraft(ghostRef.current);
                      return;
                    }
                    /* an empty Enter cannot submit while the Ask button is
                       disabled, so on a tour it is caught here: next stop */
                    if (TOUR.running && !draft.trim()) {
                      if (e.key === "Enter" || e.key === "ArrowRight") {
                        e.preventDefault();
                        tourNext();
                      } else if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        tourBack();
                      }
                    }
                  }}
                  placeholder={tour ? "next · stop · or ask something" : pick ? "or ask something" : "Ask me about my work"}
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
              <p className="fh-hint">
                {tour ? "← → move between stops · esc closes" : pick ? "click a project card · esc cancels" : "drag to rotate · esc to close"}
                {model ? " · " + model : ""}
                {!caption && wk && wk.stats && typeof wk.stats.ms === "number" ? " · " + (wk.stats.ms / 1000).toFixed(1) + " s" : ""}
              </p>
            </div>
            </ChatShield>
          ) : (
            <p className="fh-hint">drag to rotate · esc to close</p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
