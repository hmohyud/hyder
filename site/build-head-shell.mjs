// build-head-shell.mjs
// Exports the TRUE head surface as a small depth-occlusion mesh, registered
// into the shipped point cloud's exact coordinate frame.
//
//   node build-head-shell.mjs [assets/head.glb] [public/head-points.bin]
//
// The cloud was sampled from this GLB by build-head-points.mjs through a
// yaw-rotation + neck-cut + centre/scale whose parameters were partly
// data-dependent (and so are not recoverable by re-running the pipeline
// without orphaning the hand-painted regions). But every shipped point IS a
// point of this surface, so the 5-parameter transform (yaw, scale, centre)
// is recovered here by registration instead: a coarse yaw sweep, then ICP
// with the rotation constrained to yaw - closed form, no SVD needed. The
// cloud->mesh direction has no outliers by construction.
//
// Output: public/head-shell.bin
//   [ 'HSH1' | u32 vertCount | u32 triCount | f32 verts*3 | u16/u32 indices ]
//   (index width: u16 if vertCount < 65536, else u32 - flagged in triCount's
//    top bit being unused; the runtime just checks vertCount)

import fs from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";

const SRC = process.argv[2] || "assets/head.glb";
const CLOUD = process.argv[3] || "public/head-points.bin";
const OUT = "public/head-shell.bin";

/* ---------- GLB parsing (mirrors build-head-points.mjs) ---------- */

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

/* ---------- collect the mesh (verts + indices), world-transformed ---------- */

const { json, bin } = readGlb(SRC);
const meshVerts = [];   // flat xyz
const meshIdx = [];     // triangle indices into meshVerts
const walk = (nodeIndex, parent) => {
  const node = json.nodes[nodeIndex];
  const world = mul(parent, nodeMatrix(node));
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives) {
      if (prim.attributes.POSITION === undefined) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : null;
      const base = meshVerts.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        const p = applyPoint(world, [pos[i], pos[i + 1], pos[i + 2]]);
        meshVerts.push(p[0], p[1], p[2]);
      }
      const count = idx ? idx.length : pos.length / 3;
      for (let i = 0; i + 2 < count; i += 3) {
        meshIdx.push(
          base + (idx ? idx[i] : i),
          base + (idx ? idx[i + 1] : i + 1),
          base + (idx ? idx[i + 2] : i + 2)
        );
      }
    }
  }
  for (const child of node.children || []) walk(child, world);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const nodeIndex of json.scenes[json.scene || 0].nodes) walk(nodeIndex, identity);
console.log(`mesh: ${(meshVerts.length / 3).toLocaleString()} verts, ${(meshIdx.length / 3).toLocaleString()} tris`);

/* ---------- area-weighted surface samples for registration ---------- */

const SAMPLES = 140000;
const cum = new Float64Array(meshIdx.length / 3);
let totalArea = 0;
for (let t = 0; t < meshIdx.length / 3; t++) {
  const [ia, ib, ic] = [meshIdx[3 * t], meshIdx[3 * t + 1], meshIdx[3 * t + 2]];
  const ax = meshVerts[3 * ia], ay = meshVerts[3 * ia + 1], az = meshVerts[3 * ia + 2];
  const ux = meshVerts[3 * ib] - ax, uy = meshVerts[3 * ib + 1] - ay, uz = meshVerts[3 * ib + 2] - az;
  const vx = meshVerts[3 * ic] - ax, vy = meshVerts[3 * ic + 1] - ay, vz = meshVerts[3 * ic + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  totalArea += Math.hypot(nx, ny, nz) / 2;
  cum[t] = totalArea;
}
const samples = new Float32Array(SAMPLES * 3);
for (let i = 0; i < SAMPLES; i++) {
  const target = Math.random() * totalArea;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
  const [ia, ib, ic] = [meshIdx[3 * lo], meshIdx[3 * lo + 1], meshIdx[3 * lo + 2]];
  let u = Math.random(), v = Math.random();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  for (let k = 0; k < 3; k++) {
    const a = meshVerts[3 * ia + k];
    samples[3 * i + k] =
      a + u * (meshVerts[3 * ib + k] - a) + v * (meshVerts[3 * ic + k] - a);
  }
}

/* ---------- the shipped cloud ---------- */

const cbuf = fs.readFileSync(CLOUD);
if (cbuf.toString("ascii", 0, 4) !== "HDP3") throw new Error("bad cloud file");
const N = cbuf.readUInt32LE(4);
const CSCALE = cbuf.readFloatLE(8);
const cloud = new Float32Array(N * 3);
for (let i = 0; i < N * 3; i++) cloud[i] = cbuf.readInt16LE(12 + i * 2) / CSCALE;
let cMinY = Infinity;
for (let i = 0; i < N; i++) cMinY = Math.min(cMinY, cloud[3 * i + 1]);
console.log(`cloud: ${N.toLocaleString()} points`);

/* ---------- static NN hash over the GLB samples ---------- */

// cell size ~ twice the typical sample spacing
const glbH = (() => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < SAMPLES; i++) { lo = Math.min(lo, samples[3 * i + 1]); hi = Math.max(hi, samples[3 * i + 1]); }
  return hi - lo;
})();
const CELL = glbH / 160;
const hash = new Map();
const hkey = (x, y, z) =>
  ((Math.floor(x / CELL) * 73856093) ^ (Math.floor(y / CELL) * 19349663) ^ (Math.floor(z / CELL) * 83492791)) | 0;
for (let i = 0; i < SAMPLES; i++) {
  const k = hkey(samples[3 * i], samples[3 * i + 1], samples[3 * i + 2]);
  let b = hash.get(k);
  if (!b) hash.set(k, (b = []));
  b.push(i);
}
function nearest(x, y, z, R) {
  let best = -1, bd = Infinity;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
  for (let dx = -R; dx <= R; dx++)
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) {
        const b = hash.get((((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) | 0);
        if (!b) continue;
        for (const i of b) {
          const ddx = samples[3 * i] - x, ddy = samples[3 * i + 1] - y, ddz = samples[3 * i + 2] - z;
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < bd) { bd = d; best = i; }
        }
      }
  return best < 0 ? -1 : best;
}

/* ---------- transform: cloud = s * (R(theta) glb - centre) ----------
   inverse: glb = R(-theta) * (cloud / s + centre) */

let theta = 0, S = 1, C = [0, 0, 0];

const invTransform = (px, py, pz) => {
  const x = px / S + C[0], y = py / S + C[1], z = pz / S + C[2];
  const c = Math.cos(-theta), sn = Math.sin(-theta);
  return [x * c - z * sn, y, x * sn + z * c];
};

/* coarse init: scale/centre-y from heights (yaw leaves y untouched), then a
   yaw sweep scored by cloud->mesh distance */
{
  let gMaxY = -Infinity;
  for (let i = 0; i < SAMPLES; i++) gMaxY = Math.max(gMaxY, samples[3 * i + 1]);
  // try a range of cut fractions; each implies a scale - score at best yaw
  let best = { score: Infinity };
  for (let frac = 0.3; frac <= 0.75; frac += 0.05) {
    const cutY = gMaxY - glbH * frac;
    const sTry = 2.4 / (gMaxY - cutY);
    const cyTry = (gMaxY + cutY) / 2;
    for (let deg = 0; deg < 360; deg += 4) {
      const th = (deg * Math.PI) / 180;
      // centre-xz: bbox centre of kept samples after rotation
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const cth = Math.cos(th), sth = Math.sin(th);
      for (let i = 0; i < SAMPLES; i += 7) {
        if (samples[3 * i + 1] < cutY) continue;
        const x = samples[3 * i], z = samples[3 * i + 2];
        const rx = x * cth - z * sth, rz = x * sth + z * cth;
        if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
        if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
      }
      const cand = { theta: th, S: sTry, C: [(minX + maxX) / 2, cyTry, (minZ + maxZ) / 2] };
      // score on a small cloud subset
      let sum = 0, cnt = 0;
      const cI = Math.cos(-cand.theta), sI = Math.sin(-cand.theta);
      for (let i = 0; i < N; i += 37) {
        const x = cloud[3 * i] / cand.S + cand.C[0];
        const y = cloud[3 * i + 1] / cand.S + cand.C[1];
        const z = cloud[3 * i + 2] / cand.S + cand.C[2];
        const gx = x * cI - z * sI, gz = x * sI + z * cI;
        const j = nearest(gx, y, gz, 3);
        if (j < 0) { sum += CELL * CELL * 32; cnt++; continue; }
        const dx = samples[3 * j] - gx, dy = samples[3 * j + 1] - y, dz = samples[3 * j + 2] - gz;
        sum += dx * dx + dy * dy + dz * dz;
        cnt++;
      }
      const score = sum / cnt;
      if (score < best.score) best = { ...cand, score };
    }
  }
  theta = best.theta; S = best.S; C = best.C;
  console.log(
    `init: yaw ${((theta * 180) / Math.PI).toFixed(1)} deg, scale ${S.toFixed(4)}, ` +
      `rms ${(Math.sqrt(best.score) * S).toFixed(4)} (cloud units)`
  );
}

/* ---------- ICP, yaw-constrained (closed form, no SVD) ---------- */

for (let iter = 0; iter < 30; iter++) {
  // correspondences: every cloud point -> nearest GLB sample (no outliers by
  // construction; trim the worst 10% anyway to shrug off cut-edge effects)
  const pairs = [];
  for (let i = 0; i < N; i++) {
    const [gx, gy, gz] = invTransform(cloud[3 * i], cloud[3 * i + 1], cloud[3 * i + 2]);
    const j = nearest(gx, gy, gz, 2);
    if (j < 0) continue;
    const dx = samples[3 * j] - gx, dy = samples[3 * j + 1] - gy, dz = samples[3 * j + 2] - gz;
    pairs.push([j, i, dx * dx + dy * dy + dz * dz]);
  }
  if (pairs.length < N * 0.5) {
    throw new Error(`registration diverged: only ${pairs.length}/${N} correspondences`);
  }
  pairs.sort((a, b) => a[2] - b[2]);
  const keep = pairs.slice(0, Math.floor(pairs.length * 0.9));
  // solve cloud = s R(theta) g + t over kept pairs (g = glb sample, c = cloud)
  let mgx = 0, mgy = 0, mgz = 0, mcx = 0, mcy = 0, mcz = 0;
  for (const [j, i] of keep) {
    mgx += samples[3 * j]; mgy += samples[3 * j + 1]; mgz += samples[3 * j + 2];
    mcx += cloud[3 * i]; mcy += cloud[3 * i + 1]; mcz += cloud[3 * i + 2];
  }
  const n = keep.length;
  mgx /= n; mgy /= n; mgz /= n; mcx /= n; mcy /= n; mcz /= n;
  let sinSum = 0, cosSum = 0;
  for (const [j, i] of keep) {
    const ax = samples[3 * j] - mgx, az = samples[3 * j + 2] - mgz;
    const bx = cloud[3 * i] - mcx, bz = cloud[3 * i + 2] - mcz;
    sinSum += ax * bz - az * bx;
    cosSum += ax * bx + az * bz;
  }
  const th = Math.atan2(sinSum, cosSum);
  const cth = Math.cos(th), sth = Math.sin(th);
  let num = 0, den = 0;
  for (const [j, i] of keep) {
    const ax = samples[3 * j] - mgx, ay = samples[3 * j + 1] - mgy, az = samples[3 * j + 2] - mgz;
    const rx = ax * cth - az * sth, rz = ax * sth + az * cth;
    num += rx * (cloud[3 * i] - mcx) + ay * (cloud[3 * i + 1] - mcy) + rz * (cloud[3 * i + 2] - mcz);
    den += ax * ax + ay * ay + az * az;
  }
  const sNew = num / den;
  // t = mu_c - s R mu_g ; our form is cloud = s(R g - C) => C = R mu_g - mu_c/s
  const rmg = [mgx * cth - mgz * sth, mgy, mgx * sth + mgz * cth];
  theta = th; S = sNew;
  C = [rmg[0] - mcx / S, rmg[1] - mcy / S, rmg[2] - mcz / S];
  const med = Math.sqrt(keep[Math.floor(keep.length / 2)][2]) * S;
  if (iter % 5 === 4 || iter === 0) {
    console.log(`icp ${iter + 1}: yaw ${((theta * 180) / Math.PI).toFixed(2)} deg, scale ${S.toFixed(5)}, median ${med.toFixed(4)}`);
  }
}

/* final residual over ALL cloud points */
{
  const ds = [];
  for (let i = 0; i < N; i++) {
    const [gx, gy, gz] = invTransform(cloud[3 * i], cloud[3 * i + 1], cloud[3 * i + 2]);
    const j = nearest(gx, gy, gz, 2);
    if (j >= 0) {
      const dx = samples[3 * j] - gx, dy = samples[3 * j + 1] - gy, dz = samples[3 * j + 2] - gz;
      ds.push(Math.sqrt(dx * dx + dy * dy + dz * dz) * S);
    }
  }
  ds.sort((a, b) => a - b);
  console.log(
    `residual (cloud units): median ${ds[Math.floor(ds.length / 2)].toFixed(4)}, ` +
      `p95 ${ds[Math.floor(ds.length * 0.95)].toFixed(4)}, max ${ds[ds.length - 1].toFixed(4)}`
  );
}

/* ---------- transform mesh into cloud frame, trim, decimate ---------- */

const cth = Math.cos(theta), sth = Math.sin(theta);
const nv = meshVerts.length / 3;
const tv = new Float32Array(meshVerts.length);
for (let i = 0; i < nv; i++) {
  const x = meshVerts[3 * i], y = meshVerts[3 * i + 1], z = meshVerts[3 * i + 2];
  const rx = x * cth - z * sth, rz = x * sth + z * cth;
  tv[3 * i] = (rx - C[0]) * S;
  tv[3 * i + 1] = (y - C[1]) * S;
  tv[3 * i + 2] = (rz - C[2]) * S;
}

/* ---------- the cloud's bottom envelope ----------
   the pipeline's neck cut was a TILTED plane (raised at the back to shear
   the shoulders); rather than guess its parameters, read the achieved cut
   straight off the cloud: the lowest dot per z-band IS the cut line. */
const ZBINS = 24;
let cZlo = Infinity, cZhi = -Infinity;
for (let i = 0; i < N; i++) {
  cZlo = Math.min(cZlo, cloud[3 * i + 2]);
  cZhi = Math.max(cZhi, cloud[3 * i + 2]);
}
const envelope = new Float32Array(ZBINS).fill(Infinity);
for (let i = 0; i < N; i++) {
  const b = Math.min(ZBINS - 1, Math.max(0,
    Math.floor(((cloud[3 * i + 2] - cZlo) / (cZhi - cZlo)) * ZBINS)));
  envelope[b] = Math.min(envelope[b], cloud[3 * i + 1]);
}
for (let b = 0; b < ZBINS; b++) if (!isFinite(envelope[b])) envelope[b] = cMinY;
const bottomAt = (z) => {
  const t = ((z - cZlo) / (cZhi - cZlo)) * ZBINS - 0.5;
  const b0 = Math.max(0, Math.min(ZBINS - 1, Math.floor(t)));
  const b1 = Math.min(ZBINS - 1, b0 + 1);
  const f = Math.max(0, Math.min(1, t - b0));
  return envelope[b0] * (1 - f) + envelope[b1] * f;
};

/* ---------- trim to the envelope, then ERROR-BOUNDED simplification --------
   Vertex clustering (the previous decimator) is the "sloppy" family of
   simplifiers: it welds spatially-close but topologically-distinct sheets,
   which is exactly what bridged the eye sockets and smeared the scan's
   chaotic hair shells. meshoptimizer's QEM edge-collapse is topology-
   preserving and error-BOUNDED: the output surface provably stays within
   the given absolute distance of the input, so the runtime depth bias can
   be chosen against a known worst case instead of a guess. */
await MeshoptSimplifier.ready;

const keepIdx = [];
for (let t = 0; t < meshIdx.length / 3; t++) {
  const ia = meshIdx[3 * t], ib = meshIdx[3 * t + 1], ic = meshIdx[3 * t + 2];
  const keep =
    tv[3 * ia + 1] >= bottomAt(tv[3 * ia + 2]) - 0.12 ||
    tv[3 * ib + 1] >= bottomAt(tv[3 * ib + 2]) - 0.12 ||
    tv[3 * ic + 1] >= bottomAt(tv[3 * ic + 2]) - 0.12;
  if (keep) keepIdx.push(ia, ib, ic);
}
console.log(`trimmed to ${(keepIdx.length / 3).toLocaleString()} tris above the envelope`);

/* weld by position so scan attribute seams do not block edge collapses */
const remap = MeshoptSimplifier.generatePositionRemap(tv, 3);
const welded = new Uint32Array(keepIdx.length);
for (let i = 0; i < keepIdx.length; i++) welded[i] = remap[keepIdx[i]];

const TARGET_TRIS = 12000;
const ERR_ABS = 0.02; // cloud units; ~0.6x dot spacing - on a noisy scan this budget is spent smoothing, not feature-bridging (QEM preserves topology)
const [simplified, absErr] = MeshoptSimplifier.simplify(
  welded, tv, 3,
  TARGET_TRIS * 3,
  ERR_ABS,
  ["Prune", "ErrorAbsolute"] // no LockBorder: a scan has thousands of tiny hole borders, locking them blocks collapse everywhere
);
console.log(
  `simplified: ${(simplified.length / 3).toLocaleString()} tris, ` +
    `achieved error ${absErr.toFixed(4)} (bound ${ERR_ABS})`
);

/* compact - NOTE: compactMesh remaps `simplified` IN PLACE */
const [vremap, unique] = MeshoptSimplifier.compactMesh(simplified);
const outVerts = new Float32Array(unique * 3);
for (let v = 0; v < vremap.length; v++) {
  const nv = vremap[v];
  if (nv !== 0xffffffff) {
    outVerts[nv * 3] = tv[v * 3];
    outVerts[nv * 3 + 1] = tv[v * 3 + 1];
    outVerts[nv * 3 + 2] = tv[v * 3 + 2];
  }
}
const outIdx = simplified;

/* orient outward: the runtime culls back faces, so winding must be outward.
   The signed volume's sign says which way the scan winds; flip if inward. */
let vol = 0;
for (let t = 0; t < outIdx.length / 3; t++) {
  const a = outIdx[3 * t] * 3, b = outIdx[3 * t + 1] * 3, c = outIdx[3 * t + 2] * 3;
  vol +=
    outVerts[a] * (outVerts[b + 1] * outVerts[c + 2] - outVerts[b + 2] * outVerts[c + 1]) -
    outVerts[a + 1] * (outVerts[b] * outVerts[c + 2] - outVerts[b + 2] * outVerts[c]) +
    outVerts[a + 2] * (outVerts[b] * outVerts[c + 1] - outVerts[b + 1] * outVerts[c]);
}
if (vol < 0) {
  for (let t = 0; t < outIdx.length / 3; t++) {
    const tmp = outIdx[3 * t + 1];
    outIdx[3 * t + 1] = outIdx[3 * t + 2];
    outIdx[3 * t + 2] = tmp;
  }
  console.log("winding flipped to outward");
}

let sMinY = Infinity;
for (let c = 0; c < unique; c++) sMinY = Math.min(sMinY, outVerts[3 * c + 1]);
console.log(
  `shell: ${unique.toLocaleString()} verts, ${(outIdx.length / 3).toLocaleString()} tris, ` +
    `bottom ${sMinY.toFixed(3)} vs cloud ${cMinY.toFixed(3)}`
);

/* ---------- write: HSH2, int16-quantised positions ---------- */

const vCount = unique;
const iCount = outIdx.length;
const wide = vCount >= 65536;
const QS = 12000;
const header = Buffer.alloc(16);
header.write("HSH2", 0, "ascii");
header.writeUInt32LE(vCount, 4);
header.writeUInt32LE(iCount, 8);
header.writeFloatLE(QS, 12);
const vBuf = Buffer.alloc(vCount * 6);
for (let i = 0; i < vCount * 3; i++) {
  vBuf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(outVerts[i] * QS))), i * 2);
}
const iBuf = Buffer.alloc(iCount * (wide ? 4 : 2));
for (let i = 0; i < iCount; i++) {
  if (wide) iBuf.writeUInt32LE(outIdx[i], i * 4);
  else iBuf.writeUInt16LE(outIdx[i], i * 2);
}
fs.writeFileSync(OUT, Buffer.concat([header, vBuf, iBuf]));
console.log(`${OUT}: ${((16 + vBuf.length + iBuf.length) / 1024).toFixed(0)}KB (${wide ? "u32" : "u16"} indices)`);
