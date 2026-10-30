// build-head-points.mjs
// Turns a head GLB into the tiny point cloud the landing page actually needs.
//
//   node build-head-points.mjs [path/to/head.glb] [pointCount]
//
// The source mesh from a scan/generator is typically tens of MB with textures,
// tangents and a million-plus vertices. The site only ever draws points, so we
// area-sample the surface once, here, and ship ~100KB of positions + normals
// instead. Re-run this after editing the mesh (e.g. slicing it at the neck).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const SRC = process.argv[2] || "assets/head.glb";
const COUNT = Number(process.argv[3] || 24000);
// "auto" finds the narrowest slice between head and shoulders; a number is a
// fraction from the top; "none" keeps the whole bust.
const CUT = process.argv[4] || "auto";
// How far below the narrowest band to actually cut, as a fraction of the whole
// model's height. The narrowest point is the middle of the neck; cutting there
// leaves almost no neck, so drop below it.
const NECK_DROP = Number(process.argv[5] || 0.05);
// Extra yaw in degrees applied after auto-alignment, if it ever needs nudging.
const YAW_FIX = Number(process.argv[6] || 0);
// Absolute yaw in degrees. When given, auto-detection is skipped entirely —
// the detector reads the randomised cloud so it is not stable between runs.
const YAW_ABS = process.argv[7] !== undefined ? Number(process.argv[7]) : null;
// Tilt of the cutting plane, in units of y per unit of z. Positive raises the
// BACK of the slice, so the shoulders behind the head are taken off while the
// height at the chin stays where it is.
const CUT_TILT = Number(process.argv[8] || 0);
const OUT = "public/head-points.bin";

/* ---------- GLB parsing ---------- */

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("not a GLB");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.toString("utf8", start, start + len));
    else if (type === 0x004e4942) bin = buf.subarray(start, start + len);
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error("missing chunk");
  return { json, bin };
}

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const comp = COMPONENT[acc.componentType];
  const n = NUM_COMPONENTS[acc.type];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new comp.array(acc.count * n);
  const stride = view.byteStride || comp.size * n;
  for (let i = 0; i < acc.count; i++) {
    const base = start + i * stride;
    for (let c = 0; c < n; c++) {
      const at = base + c * comp.size;
      switch (acc.componentType) {
        case 5126: out[i * n + c] = bin.readFloatLE(at); break;
        case 5125: out[i * n + c] = bin.readUInt32LE(at); break;
        case 5123: out[i * n + c] = bin.readUInt16LE(at); break;
        case 5122: out[i * n + c] = bin.readInt16LE(at); break;
        case 5121: out[i * n + c] = bin.readUInt8(at); break;
        default: out[i * n + c] = bin.readInt8(at); break;
      }
    }
  }
  return out;
}

/* node transforms, so a model authored with a root rotation lands upright */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const applyPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/* ---------- collect triangles ---------- */

const { json, bin } = readGlb(SRC);
const tris = [];
let totalArea = 0;

const walk = (nodeIndex, parent) => {
  const node = json.nodes[nodeIndex];
  const world = mul(parent, nodeMatrix(node));
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives) {
      if (prim.attributes.POSITION === undefined) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const uvs =
        prim.attributes.TEXCOORD_0 !== undefined
          ? readAccessor(json, bin, prim.attributes.TEXCOORD_0)
          : null;
      const idx =
        prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : null;
      const count = idx ? idx.length : pos.length / 3;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = idx ? idx[i] : i;
        const ib = idx ? idx[i + 1] : i + 1;
        const ic = idx ? idx[i + 2] : i + 2;
        const a = applyPoint(world, [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]]);
        const b = applyPoint(world, [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]]);
        const c = applyPoint(world, [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]]);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (!(len > 0)) continue;
        totalArea += len / 2;
        tris.push({
          a, b, c,
          n: [nx / len, ny / len, nz / len],
          uv: uvs
            ? [
                [uvs[ia * 2], uvs[ia * 2 + 1]],
                [uvs[ib * 2], uvs[ib * 2 + 1]],
                [uvs[ic * 2], uvs[ic * 2 + 1]],
              ]
            : null,
          cum: totalArea,
        });
      }
    }
  }
  for (const child of node.children || []) walk(child, world);
};

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const nodeIndex of json.scenes[json.scene || 0].nodes) walk(nodeIndex, identity);
if (!tris.length) throw new Error("no triangles found");

/* ---------- base colour texture, decoded via ffmpeg ---------- */
// The renderer only needs a tone per point, so the texture is decoded once to
// a fixed-size raw RGB buffer and sampled at each point's UV.

const TEX = 1024;
function loadBaseColor() {
  try {
    const mat = json.materials && json.materials[0];
    const texRef = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
    if (!texRef) return null;
    const image = json.images[json.textures[texRef.index].source];
    if (image.bufferView === undefined) return null;
    const view = json.bufferViews[image.bufferView];
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const tmp = path.join(os.tmpdir(), "head-basecolor" + (image.mimeType === "image/png" ? ".png" : ".jpg"));
    fs.writeFileSync(tmp, bytes);
    const raw = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", tmp, "-vf", `scale=${TEX}:${TEX}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: TEX * TEX * 3 + 1024 }
    );
    fs.unlinkSync(tmp);
    return raw.length >= TEX * TEX * 3 ? raw : null;
  } catch (err) {
    console.warn("base colour texture unavailable (" + err.message.slice(0, 60) + ")");
    return null;
  }
}
const texture = loadBaseColor();

// Local-contrast map. Uniform-by-area sampling spreads points evenly, which
// buries small high-detail features (eyes, lashes, nostrils, lips) under the
// same density as a flat cheek. Weighting the sampler by how much a texel
// differs from its neighbourhood puts points where the face actually reads.
const contrast = (() => {
  if (!texture) return null;
  const lum = new Float32Array(TEX * TEX);
  for (let i = 0; i < TEX * TEX; i++) {
    lum[i] =
      (0.2126 * texture[i * 3] + 0.7152 * texture[i * 3 + 1] + 0.0722 * texture[i * 3 + 2]) / 255;
  }
  const out = new Float32Array(TEX * TEX);
  const R = 3;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const c = lum[y * TEX + x];
      let sum = 0;
      let n = 0;
      for (let dy = -R; dy <= R; dy += R) {
        for (let dx = -R; dx <= R; dx += R) {
          const yy = Math.min(TEX - 1, Math.max(0, y + dy));
          const xx = Math.min(TEX - 1, Math.max(0, x + dx));
          sum += lum[yy * TEX + xx];
          n++;
        }
      }
      out[y * TEX + x] = Math.abs(c - sum / n);
    }
  }
  // normalise against the 95th percentile so a few extremes do not flatten it
  const sorted = Float32Array.from(out).sort();
  const hi = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / hi);
  return out;
})();

const texelAt = (u, v) => {
  const px = Math.min(TEX - 1, Math.max(0, Math.round((((u % 1) + 1) % 1) * (TEX - 1))));
  const py = Math.min(TEX - 1, Math.max(0, Math.round((((v % 1) + 1) % 1) * (TEX - 1))));
  return py * TEX + px;
};

/* ---------- sampling: uniform spacing over the surface ---------- */
// Random area-weighted sampling clumps: you get dense knots and bare patches,
// which reads as noise. Poisson-disk sampling instead enforces a minimum
// distance between every pair of points, so the cloud sits on the model like
// an evenly spaced lattice pressed onto its surface.

function pickTriangle() {
  const target = Math.random() * totalArea;
  let lo = 0;
  let hi = tris.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tris[mid].cum < target) lo = mid + 1;
    else hi = mid;
  }
  return tris[lo];
}

function pointOn(t) {
  let u = Math.random();
  let v = Math.random();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const p = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p[k] = t.a[k] + u * (t.b[k] - t.a[k]) + v * (t.c[k] - t.a[k]);
  }
  return { p, u, v };
}

// spacing that should yield roughly COUNT points over the whole surface
// (hexagonal packing covers ~0.9 of the area)
let radius = Math.sqrt((totalArea * 0.9) / (COUNT * Math.PI)) * 2;

function poisson(count, r) {
  const cell = r / Math.sqrt(3);
  const grid = new Map();
  const key = (x, y, z) =>
    Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
  const accepted = [];
  const r2 = r * r;
  const attemptsCap = count * 90;

  for (let attempt = 0; attempt < attemptsCap && accepted.length < count; attempt++) {
    const t = pickTriangle();
    const { p, u, v } = pointOn(t);
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    const cz = Math.floor(p[2] / cell);
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++) {
      for (let dy = -2; dy <= 2 && ok; dy++) {
        for (let dz = -2; dz <= 2 && ok; dz++) {
          const bucket = grid.get(cx + dx + "," + (cy + dy) + "," + (cz + dz));
          if (!bucket) continue;
          for (const q of bucket) {
            const ddx = q[0] - p[0];
            const ddy = q[1] - p[1];
            const ddz = q[2] - p[2];
            if (ddx * ddx + ddy * ddy + ddz * ddz < r2) { ok = false; break; }
          }
        }
      }
    }
    if (!ok) continue;
    const k = key(p[0], p[1], p[2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
    accepted.push({ p, t, u, v });
  }
  return accepted;
}

let picked = poisson(COUNT, radius);
// if the spacing was too generous to reach the target, tighten once and retry
if (picked.length < COUNT * 0.75) {
  radius *= 0.8;
  picked = poisson(COUNT, radius);
}

const accepted = picked.length;
const position = new Float32Array(accepted * 3);
const normal = new Float32Array(accepted * 3);
const luma = new Float32Array(accepted);

for (let i = 0; i < accepted; i++) {
  const { p, t, u, v } = picked[i];
  for (let k = 0; k < 3; k++) {
    position[i * 3 + k] = p[k];
    normal[i * 3 + k] = t.n[k];
  }
  let tone = -1;
  if (texture && t.uv) {
    const su = t.uv[0][0] + u * (t.uv[1][0] - t.uv[0][0]) + v * (t.uv[2][0] - t.uv[0][0]);
    const sv = t.uv[0][1] + u * (t.uv[1][1] - t.uv[0][1]) + v * (t.uv[2][1] - t.uv[0][1]);
    const o = texelAt(su, sv) * 3;
    tone = (0.2126 * texture[o] + 0.7152 * texture[o + 1] + 0.0722 * texture[o + 2]) / 255;
  }
  luma[i] = tone;
}
console.log(
  `poisson: ${accepted.toLocaleString()} points at min spacing ${radius.toFixed(4)}`
);

/* ---------- align the face to camera-forward ---------- */
// The source model is not authored facing any particular way, so "rotation 0"
// ends up slightly off-centre. Find the head's own plane of symmetry, rotate
// that to be the YZ plane, then work out which side is the face.

function alignFacing() {
  const BINS = 26;
  const sampleCount = Math.min(accepted, 6000);
  const step = Math.max(1, Math.floor(accepted / sampleCount));

  const asymmetryAt = (theta) => {
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const hist = new Float32Array(BINS * BINS);
    for (let i = 0; i < accepted; i += step) {
      const x = position[i * 3];
      const y = position[i * 3 + 1];
      const z = position[i * 3 + 2];
      const rx = x * c - z * sn;
      const bx = Math.min(BINS - 1, Math.max(0, Math.floor(((rx + 1.6) / 3.2) * BINS)));
      const by = Math.min(BINS - 1, Math.max(0, Math.floor(((y + 1.6) / 3.2) * BINS)));
      hist[by * BINS + bx]++;
    }
    let diff = 0;
    for (let by = 0; by < BINS; by++) {
      for (let bx = 0; bx < BINS; bx++) {
        diff += Math.abs(hist[by * BINS + bx] - hist[by * BINS + (BINS - 1 - bx)]);
      }
    }
    return diff;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let deg = 0; deg < 180; deg += 1) {
    const score = asymmetryAt((deg * Math.PI) / 180);
    if (score < bestScore) {
      bestScore = score;
      best = deg;
    }
  }

  // Two candidates 180 apart: face forward or face away. The face carries the
  // eyes, brows and mouth, so its tone varies far more than the back of a head.
  const variance = (sign) => {
    const c = Math.cos((best * Math.PI) / 180);
    const sn = Math.sin((best * Math.PI) / 180);
    let n = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < accepted; i++) {
      if (luma[i] < 0) continue;
      const x = position[i * 3];
      const z = position[i * 3 + 2];
      const rz = x * sn + z * c;
      if (Math.sign(rz) !== sign) continue;
      n++;
      sum += luma[i];
      sumSq += luma[i] * luma[i];
    }
    return n > 50 ? sumSq / n - (sum / n) * (sum / n) : -1;
  };

  // Front vs back: the nose is a sharp protrusion close to the midline at
  // eye/mouth height. Whichever side reaches furthest there is the face.
  const protrusion = (sign) => {
    const c = Math.cos((best * Math.PI) / 180);
    const sn = Math.sin((best * Math.PI) / 180);
    let far = 0;
    for (let i = 0; i < accepted; i++) {
      const y = position[i * 3 + 1];
      if (y < -0.35 || y > 0.45) continue; // nose/mouth band
      const x = position[i * 3];
      const z = position[i * 3 + 2];
      const rx = x * c - z * sn;
      if (Math.abs(rx) > 0.18) continue; // near the midline only
      const rz = x * sn + z * c;
      if (Math.sign(rz) !== sign) continue;
      far = Math.max(far, Math.abs(rz));
    }
    return far;
  };

  let deg;
  if (YAW_ABS !== null) {
    deg = ((YAW_ABS % 360) + 360) % 360;
  } else {
    deg = best;
    if (protrusion(1) < protrusion(-1)) deg = (best + 180) % 360;
    deg = ((deg + YAW_FIX) % 360 + 360) % 360;
  }

  const c = Math.cos((deg * Math.PI) / 180);
  const sn = Math.sin((deg * Math.PI) / 180);
  for (let i = 0; i < accepted; i++) {
    const x = position[i * 3];
    const z = position[i * 3 + 2];
    position[i * 3] = x * c - z * sn;
    position[i * 3 + 2] = x * sn + z * c;
    const nx = normal[i * 3];
    const nz = normal[i * 3 + 2];
    normal[i * 3] = nx * c - nz * sn;
    normal[i * 3 + 2] = nx * sn + nz * c;
  }
  return deg;
}

const yawApplied = alignFacing();
console.log(`aligned facing: rotated ${yawApplied.toFixed(0)} degrees`);

/* ---------- cut at the neck ---------- */
// The source is a bust. The neck is the narrowest horizontal band between the
// head (wide at the cheeks) and the shoulders (widest of all), so slice the
// sampled cloud into bands, measure each one's horizontal spread, and cut at
// the minimum found in the upper-middle of the model.

function neckCut() {
  if (CUT === "none") return -Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < accepted; i++) {
    lo = Math.min(lo, position[i * 3 + 1]);
    hi = Math.max(hi, position[i * 3 + 1]);
  }
  if (CUT !== "auto") {
    const frac = Number(CUT);
    return hi - (hi - lo) * frac;
  }

  const BANDS = 48;
  const width = new Array(BANDS).fill(0);
  const minX = new Array(BANDS).fill(Infinity);
  const maxX = new Array(BANDS).fill(-Infinity);
  for (let i = 0; i < accepted; i++) {
    const t = (position[i * 3 + 1] - lo) / Math.max(1e-6, hi - lo);
    const b = Math.min(BANDS - 1, Math.max(0, Math.floor(t * BANDS)));
    minX[b] = Math.min(minX[b], position[i * 3]);
    maxX[b] = Math.max(maxX[b], position[i * 3]);
  }
  for (let b = 0; b < BANDS; b++) {
    width[b] = maxX[b] > minX[b] ? maxX[b] - minX[b] : Infinity;
  }

  // search the band range that spans "below the head, above the shoulders"
  const from = Math.floor(BANDS * 0.3);
  const to = Math.floor(BANDS * 0.75);
  let best = from;
  for (let b = from; b <= to; b++) if (width[b] < width[best]) best = b;
  const narrowest = lo + ((best + 0.5) / BANDS) * (hi - lo);
  return narrowest - NECK_DROP * (hi - lo);
}

const cutY = neckCut();
let kept = 0;
for (let i = 0; i < accepted; i++) {
  // Tilted plane: the threshold rises as z goes negative (toward the back of
  // the head), so the slice lifts at the back and shears the shoulders off
  // while leaving the front height alone.
  const behind = Math.max(0, -position[i * 3 + 2]);
  const threshold = cutY + CUT_TILT * behind;
  if (position[i * 3 + 1] < threshold) continue;
  for (let k = 0; k < 3; k++) {
    position[kept * 3 + k] = position[i * 3 + k];
    normal[kept * 3 + k] = normal[i * 3 + k];
  }
  luma[kept] = luma[i];
  kept++;
}
const FINAL = kept;

/* ---------- normalise into the unit box the renderer expects ---------- */

let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < FINAL; i++) {
  minX = Math.min(minX, position[i * 3]); maxX = Math.max(maxX, position[i * 3]);
  minY = Math.min(minY, position[i * 3 + 1]); maxY = Math.max(maxY, position[i * 3 + 1]);
  minZ = Math.min(minZ, position[i * 3 + 2]); maxZ = Math.max(maxZ, position[i * 3 + 2]);
}
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
const scale = 2.4 / Math.max(1e-6, maxY - minY);
for (let i = 0; i < FINAL; i++) {
  position[i * 3] = (position[i * 3] - cx) * scale;
  position[i * 3 + 1] = (position[i * 3 + 1] - cy) * scale;
  position[i * 3 + 2] = (position[i * 3 + 2] - cz) * scale;
}

/* ---------- posterise tone into 4 palette buckets ---------- */
// Equal-population thresholds (quartiles) so all four colours are used no
// matter how bright the texture is overall — hair, brow shadow, mid skin and
// highlight each land in their own band, which is what makes the features read.

const colorIndex = new Uint8Array(FINAL);
const usable = [];
for (let i = 0; i < FINAL; i++) if (luma[i] >= 0) usable.push(luma[i]);

if (usable.length > FINAL * 0.5) {
  usable.sort((a, b) => a - b);
  const q = [
    usable[Math.floor(usable.length * 0.25)],
    usable[Math.floor(usable.length * 0.5)],
    usable[Math.floor(usable.length * 0.75)],
  ];
  for (let i = 0; i < FINAL; i++) {
    const L = luma[i];
    colorIndex[i] = L < 0 ? 1 : L < q[0] ? 0 : L < q[1] ? 1 : L < q[2] ? 2 : 3;
  }
  console.log(
    `tone thresholds: ${q.map((v) => v.toFixed(3)).join(" / ")} ` +
      `(from ${usable.length.toLocaleString()} textured points)`
  );
} else {
  // no texture — fall back to a vertical ramp
  for (let i = 0; i < FINAL; i++) {
    const t = (position[i * 3 + 1] + 1.2) / 2.4;
    colorIndex[i] = Math.max(0, Math.min(3, Math.floor(t * 4)));
  }
  console.log("no texture: falling back to a vertical colour ramp");
}

/* ---------- write: [ 'HDP3', u32 count, f32 scale, i16 pos, i8 nrm, u8 colour ] ---------- */

const SCALE = 12000; // positions are within +/- ~1.4, so int16 has room to spare
const header = Buffer.alloc(12);
header.write("HDP3", 0, "ascii");
header.writeUInt32LE(FINAL, 4);
header.writeFloatLE(SCALE, 8);

const posBuf = Buffer.alloc(FINAL * 6);
for (let i = 0; i < FINAL * 3; i++) {
  posBuf.writeInt16LE(
    Math.max(-32767, Math.min(32767, Math.round(position[i] * SCALE))),
    i * 2
  );
}
const nrmBuf = Buffer.alloc(FINAL * 3);
for (let i = 0; i < FINAL * 3; i++) {
  nrmBuf.writeInt8(Math.max(-127, Math.min(127, Math.round(normal[i] * 127))), i);
}
const colBuf = Buffer.from(colorIndex);
fs.writeFileSync(OUT, Buffer.concat([header, posBuf, nrmBuf, colBuf]));

const srcMb = (fs.statSync(SRC).size / 1048576).toFixed(1);
const outKb = (fs.statSync(OUT).size / 1024).toFixed(0);
const spread = [0, 0, 0, 0];
for (let i = 0; i < FINAL; i++) spread[colorIndex[i]]++;
console.log(
  `${path.basename(SRC)} (${srcMb}MB, ${tris.length.toLocaleString()} tris) -> ` +
    `${OUT} (${outKb}KB, ${FINAL.toLocaleString()} points, cut=${CUT})`
);
console.log(
  `colour split: ${spread.map((n) => ((n / FINAL) * 100).toFixed(0) + "%").join(" / ")} ` +
    `| head ${((maxX - minX) * scale).toFixed(2)} wide x ${((maxZ - minZ) * scale).toFixed(2)} deep`
);
