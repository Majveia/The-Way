// Terrain chunk mesher (Web Worker). Builds one quadtree chunk: grid + skirts, analytic-quality
// normals from a bordered sample grid, climate attributes, wrap-safe detail coordinates, and an
// ocean patch with per-vertex water depth when the chunk touches the sea.
import { createTerrainFn } from './terrainFn.js';
import { faceToSphere } from '../core/cubesphere.js';

let terrain = null;
let R = 1;
let hasOcean = false;
const DETAIL_PERIOD = 4096; // detail coords are planetPos - anchor, anchor snapped to this period

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    terrain = createTerrainFn(m.planet, m.sites || []);
    R = m.planet.radius;
    hasOcean = terrain.hasOcean;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'chunk') {
    const res = build(m);
    const transfer = [res.pos.buffer, res.nrm.buffer, res.data.buffer, res.detail.buffer, res.slope.buffer];
    if (res.ocean) transfer.push(res.ocean.pos.buffer, res.ocean.nrm.buffer, res.ocean.depth.buffer, res.ocean.detail.buffer);
    self.postMessage(res, transfer);
  }
};

function build({ id, face, x0, y0, size, N, cx, cy, cz }) {
  const G = N + 3; // bordered grid
  const P = new Float64Array(G * G * 3);
  const Hs = new Float32Array(G * G);
  const C = new Float32Array(G * G * 3); // moisture, temperature, rock
  const spacing = (size * Math.PI * 0.25 * R) / N;
  const d = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < G; j++) {
    const v = y0 + (size * (j - 1)) / N;
    for (let i = 0; i < G; i++) {
      const u = x0 + (size * (i - 1)) / N;
      faceToSphere(face, u, v, d);
      const s = terrain.sample(d[0], d[1], d[2], spacing);
      const k = j * G + i;
      const rr = R + s.h;
      P[k * 3] = d[0] * rr; P[k * 3 + 1] = d[1] * rr; P[k * 3 + 2] = d[2] * rr;
      Hs[k] = s.h;
      C[k * 3] = s.moisture; C[k * 3 + 1] = s.temperature; C[k * 3 + 2] = s.rock;
      if (i > 0 && j > 0 && i < G - 1 && j < G - 1) { if (s.h < minH) minH = s.h; if (s.h > maxH) maxH = s.h; }
    }
  }
  const V = N + 1;
  const skirtCount = 4 * V;
  const total = V * V + skirtCount;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const data = new Float32Array(total * 4);
  const detail = new Float32Array(total * 3);
  const slope = new Float32Array(total);
  const ax = Math.floor(cx / DETAIL_PERIOD) * DETAIL_PERIOD, ay = Math.floor(cy / DETAIL_PERIOD) * DETAIL_PERIOD, az = Math.floor(cz / DETAIL_PERIOD) * DETAIL_PERIOD;
  const skirtDepth = Math.max(4, spacing * 1.5);

  const writeVertex = (o, k, drop) => {
    const px = P[k * 3], py = P[k * 3 + 1], pz = P[k * 3 + 2];
    const l = Math.hypot(px, py, pz);
    const ux = px / l, uy = py / l, uz = pz / l;
    pos[o * 3] = px - cx - ux * drop; pos[o * 3 + 1] = py - cy - uy * drop; pos[o * 3 + 2] = pz - cz - uz * drop;
    // normal from bordered neighbours (central differences on the mesh surface)
    const kl = k - 1, kr = k + 1, kd = k - G, ku = k + G;
    const tx = P[kr * 3] - P[kl * 3], ty = P[kr * 3 + 1] - P[kl * 3 + 1], tz = P[kr * 3 + 2] - P[kl * 3 + 2];
    const bx = P[ku * 3] - P[kd * 3], by = P[ku * 3 + 1] - P[kd * 3 + 1], bz = P[ku * 3 + 2] - P[kd * 3 + 2];
    let nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nrm[o * 3] = nx; nrm[o * 3 + 1] = ny; nrm[o * 3 + 2] = nz;
    slope[o] = 1 - Math.min(1, Math.max(0, nx * ux + ny * uy + nz * uz));
    data[o * 4] = Hs[k]; data[o * 4 + 1] = C[k * 3]; data[o * 4 + 2] = C[k * 3 + 1]; data[o * 4 + 3] = C[k * 3 + 2];
    detail[o * 3] = px - ax - ux * drop; detail[o * 3 + 1] = py - ay - uy * drop; detail[o * 3 + 2] = pz - az - uz * drop;
  };
  let o = 0;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) writeVertex(o++, (j + 1) * G + (i + 1), 0);
  // skirts: bottom (j=0), top (j=N), left (i=0), right (i=N)
  for (let i = 0; i < V; i++) writeVertex(o++, 1 * G + (i + 1), skirtDepth);
  for (let i = 0; i < V; i++) writeVertex(o++, (N + 1) * G + (i + 1), skirtDepth);
  for (let j = 0; j < V; j++) writeVertex(o++, (j + 1) * G + 1, skirtDepth);
  for (let j = 0; j < V; j++) writeVertex(o++, (j + 1) * G + (N + 1), skirtDepth);

  let ocean = null;
  if (hasOcean && minH < 2) {
    const opos = new Float32Array(V * V * 3), onrm = new Float32Array(V * V * 3), odepth = new Float32Array(V * V), odet = new Float32Array(V * V * 3);
    let q = 0;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = (j + 1) * G + (i + 1);
      const px = P[k * 3], py = P[k * 3 + 1], pz = P[k * 3 + 2];
      const l = Math.hypot(px, py, pz);
      const ux = px / l, uy = py / l, uz = pz / l;
      opos[q * 3] = ux * R - cx; opos[q * 3 + 1] = uy * R - cy; opos[q * 3 + 2] = uz * R - cz;
      onrm[q * 3] = ux; onrm[q * 3 + 1] = uy; onrm[q * 3 + 2] = uz;
      odepth[q] = -Hs[k];
      odet[q * 3] = ux * R - ax; odet[q * 3 + 1] = uy * R - ay; odet[q * 3 + 2] = uz * R - az;
      q++;
    }
    ocean = { pos: opos, nrm: onrm, depth: odepth, detail: odet };
  }
  return { type: 'chunk', id, pos, nrm, data, detail, slope, ocean, minH, maxH };
}
