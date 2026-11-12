// Kerr black-hole physics on the CPU: geometry constants, Novikov–Thorne (Page–Thorne) disk
// temperature, circular-orbit kinematics, the static observer's tetrad in Kerr–Schild
// coordinates, and a CIE-integrated blackbody LUT. The GPU tracer (trace.glsl.js) integrates the
// same Hamiltonian; everything here is in units where the Schwarzschild radius rs = 1 (M = 0.5).
//
// Coordinates: Cartesian Kerr–Schild (x, y, z), spin axis +z, disk in z = 0 rotating prograde
// (counter-clockwise seen from +z). The BL radius r solves (x²+y²)/(r²+a²) + z²/r² = 1.
//   g_μν = η_μν + f l_μ l_ν,  f = 2M r³/(r⁴ + a²z²),  l = (1, (rx+ay)/(r²+a²), (ry−ax)/(r²+a²), z/r)

export const M = 0.5; // rs = 2M = 1

/** Geometry of a Kerr hole with dimensionless spin s (0..0.998) in rs units. */
export function kerrGeometry(spin) {
  const s = Math.min(0.998, Math.max(0, spin));
  const a = s * M;
  const rPlus = M + Math.sqrt(M * M - a * a);
  const z1 = 1 + Math.cbrt(1 - s * s) * (Math.cbrt(1 + s) + Math.cbrt(1 - s));
  const z2 = Math.sqrt(3 * s * s + z1 * z1);
  const rIsco = M * (3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2)));
  const rPhPro = 2 * M * (1 + Math.cos((2 / 3) * Math.acos(-s)));
  const rPhRetro = 2 * M * (1 + Math.cos((2 / 3) * Math.acos(s)));
  // radiative efficiency of a thin disk = 1 − E_isco
  const x = Math.sqrt(rIsco / M);
  const Eisco = (x * x * x - 2 * x + s) / (Math.pow(x, 1.5) * Math.sqrt(x * x * x - 3 * x + 2 * s));
  return { spin: s, a, M, rPlus, rIsco, rPhPro, rPhRetro, efficiency: Number.isFinite(Eisco) ? 1 - Eisco : 0.057 };
}

/** Prograde circular equatorial orbit at BL radius r (rs units): angular velocity Ω and u^t. */
export function circularOrbit(r, a) {
  const sm = Math.sqrt(M);
  const r15 = Math.pow(r, 1.5);
  const Omega = sm / (r15 + a * sm);
  const den = Math.pow(r, 0.75) * Math.sqrt(Math.max(1e-9, r15 - 3 * M * Math.sqrt(r) + 2 * a * sm));
  const ut = (r15 + a * sm) / den;
  return { Omega, ut };
}

/**
 * Page–Thorne (relativistic Novikov–Thorne) emitted flux at BL radius r (rs units), arbitrary scale.
 * F ∝ [x − x0 − (3/2)a ln(x/x0) − Σ 3(xi−a)²/(xi Π(xi−xj)) ln((x−xi)/(x0−xi))] / (x⁴ (x³ − 3x + 2a)), x = √(r/M).
 */
export function pageThorneFlux(r, spin, rIsco) {
  const s = Math.max(1e-4, Math.min(0.998, spin));
  const x = Math.sqrt(r / M), x0 = Math.sqrt(rIsco / M);
  if (x <= x0) return 0;
  const ac = Math.acos(s);
  const x1 = 2 * Math.cos((ac - Math.PI) / 3);
  const x2 = 2 * Math.cos((ac + Math.PI) / 3);
  const x3 = -2 * Math.cos(ac / 3);
  const term = (xi, xj, xk) => (3 * (xi - s) * (xi - s)) / (xi * (xi - xj) * (xi - xk)) * Math.log((x - xi) / (x0 - xi));
  const bracket = x - x0 - 1.5 * s * Math.log(x / x0) - term(x1, x2, x3) - term(x2, x1, x3) - term(x3, x1, x2);
  return Math.max(0, bracket / (x ** 4 * (x ** 3 - 3 * x + 2 * s)));
}

/** Kerr–Schild pieces at a point: { r, f, l:[lx,ly,lz] } */
export function ksPoint(x, y, z, a) {
  const a2 = a * a;
  const w = x * x + y * y + z * z - a2;
  const r2 = 0.5 * (w + Math.sqrt(w * w + 4 * a2 * z * z));
  const r = Math.sqrt(Math.max(r2, 1e-12));
  const S = r2 + a2;
  const f = (2 * M * r2 * r) / (r2 * r2 + a2 * z * z);
  return { r, f, l: [(r * x + a * y) / S, (r * y - a * x) / S, z / r] };
}

/** Covariant metric g_μν (4×4 nested arrays, index 0 = t) at (x, y, z). */
export function ksMetric(x, y, z, a) {
  const { f, l } = ksPoint(x, y, z, a);
  const L = [1, l[0], l[1], l[2]];
  const g = [];
  for (let m = 0; m < 4; m++) {
    g.push([]);
    for (let n = 0; n < 4; n++) g[m].push((m === n ? (m === 0 ? -1 : 1) : 0) + f * L[m] * L[n]);
  }
  return g;
}

const dot4 = (g, u, v) => { let s = 0; for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) s += g[m][n] * u[m] * v[n]; return s; };

/**
 * Camera setup for a static observer at `pos` with Euclidean axes right/up/fwd (unit 3-vectors).
 *
 * Time-reversal trick: tracing a photon *backward* in Kerr(+a) follows the same spatial path as
 * tracing it *forward* in Kerr(−a). Ingoing Kerr–Schild coordinates are regular on the future
 * horizon, so forward rays in Kerr(−a) fall through it cleanly (backward rays in Kerr(+a) would
 * pile up on the past horizon, where these coordinates are singular). So the tracer uses
 * aTrace = −a and a future-directed photon k'^μ = u^μ + n^i e_i^μ (lowered, normalised k'_t = −1).
 *
 * Returns the affine map k' = k0 + K·n (n = unit pixel direction, camera frame x right/y up/z fwd),
 * the observer redshift gObs = 1/√(−g_tt) and time-dilation √(−g_tt).
 * The physical photon's b = L_z/E = y k'_x − x k'_y (time reversal flips spatial momenta).
 */
export function staticObserver(pos, right, up, fwd, a) {
  const aT = -a;
  const g = ksMetric(pos[0], pos[1], pos[2], aT);
  const gtt = g[0][0];
  const u = [1 / Math.sqrt(-gtt), 0, 0, 0];
  const basis = [];
  for (const v3 of [right, up, fwd]) {
    let v = [0, v3[0], v3[1], v3[2]];
    const gu = dot4(g, v, u); // g(u,u) = −1 → v + g(v,u) u is ⟂ u
    v = v.map((c, i) => c + gu * u[i]);
    for (const e of basis) { const ge = dot4(g, v, e); v = v.map((c, i) => c - ge * e[i]); }
    const nn = Math.sqrt(Math.max(1e-12, dot4(g, v, v)));
    basis.push(v.map((c) => c / nn));
  }
  const lower = (v) => [0, 1, 2, 3].map((m) => g[m][0] * v[0] + g[m][1] * v[1] + g[m][2] * v[2] + g[m][3] * v[3]);
  const A = lower(u);
  const B = basis.map(lower);
  const E = -A[0]; // = √(−g_tt); B[i][0] = 0 since e_i ⟂ u ∥ ∂t
  const k0 = [A[1] / E, A[2] / E, A[3] / E];
  const K = [0, 1, 2].map((row) => [0, 1, 2].map((col) => B[col][row + 1] / E)); // K[row][col]
  return { k0, K, gObs: 1 / Math.sqrt(-gtt), dilation: Math.sqrt(-gtt), aTrace: aT };
}

/** Hamiltonian derivative for a future-directed photon (k_t = −1) in ingoing KS. Mirrors GLSL deriv(). */
export function deriv(x, q, a) {
  const a2 = a * a;
  const w = x[0] * x[0] + x[1] * x[1] + x[2] * x[2] - a2;
  const r2 = 0.5 * (w + Math.sqrt(w * w + 4 * a2 * x[2] * x[2]));
  const r = Math.sqrt(r2);
  const D = r2 * r2 + a2 * x[2] * x[2];
  const iD = 1 / D, S = r2 + a2, iS = 1 / S;
  const f = 2 * M * r2 * r * iD;
  const l = [(r * x[0] + a * x[1]) * iS, (r * x[1] - a * x[0]) * iS, x[2] / r];
  const L = l[0] * q[0] + l[1] * q[1] + l[2] * q[2] + 1;
  const k = r * iD;
  const gr = [x[0] * r2 * k, x[1] * r2 * k, x[2] * S * k];
  const c1 = 2 * M * r2 * iD * iD, c2 = 3 * a2 * x[2] * x[2] - r2 * r2;
  const gf = [c1 * gr[0] * c2, c1 * gr[1] * c2, c1 * (gr[2] * c2 - 2 * a2 * x[2] * r)];
  const C = (q[0] * x[0] + q[1] * x[1]) * iS - 2 * r * (l[0] * q[0] + l[1] * q[1]) * iS - q[2] * x[2] / r2;
  const V = [(r * q[0] - a * q[1]) * iS, (a * q[0] + r * q[1]) * iS, q[2] / r];
  const fL = f * L, hL2 = 0.5 * L * L;
  return {
    r,
    dx: [q[0] - fL * l[0], q[1] - fL * l[1], q[2] - fL * l[2]],
    dq: [hL2 * gf[0] + fL * (gr[0] * C + V[0]), hL2 * gf[1] + fL * (gr[1] * C + V[1]), hL2 * gf[2] + fL * (gr[2] * C + V[2])],
  };
}

// ---------------------------------------------------------------------------------------------
// Blackbody → linear sRGB via CIE 1931 2° CMFs (Wyman–Sloan–Shirley 2013 multi-lobe fit).
// LUT texel i ↔ T = 10^(lo + (hi−lo)·i/(n−1)). RGB = chromaticity (max component 1), A = log2(Y/Y(6500K)).
// ---------------------------------------------------------------------------------------------
function cie(lam) {
  const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
  const X = 1.056 * g(lam, 599.8, 37.9, 31.0) + 0.362 * g(lam, 442.0, 16.0, 26.7) - 0.065 * g(lam, 501.1, 20.4, 26.2);
  const Y = 0.821 * g(lam, 568.8, 46.9, 40.5) + 0.286 * g(lam, 530.9, 16.3, 31.1);
  const Z = 1.217 * g(lam, 437.0, 11.8, 36.0) + 0.681 * g(lam, 459.0, 26.0, 13.8);
  return [X, Y, Z];
}
function planck(lamNm, T) {
  const l = lamNm * 1e-9;
  const c1 = 3.741771852e-16, c2 = 1.438776877e-2;
  return c1 / (Math.pow(l, 5) * (Math.exp(c2 / (l * T)) - 1));
}
export function blackbodyXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  for (let lam = 380; lam <= 780; lam += 2) { const p = planck(lam, T); const c = cie(lam); X += p * c[0]; Y += p * c[1]; Z += p * c[2]; }
  return [X, Y, Z];
}
export const BB_LOG_T = [Math.log10(300), Math.log10(200000)];
export function blackbodyLUT(n = 512) {
  const ref = blackbodyXYZ(6500)[1];
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const T = Math.pow(10, BB_LOG_T[0] + (BB_LOG_T[1] - BB_LOG_T[0]) * (i / (n - 1)));
    const [X, Y, Z] = blackbodyXYZ(T);
    let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    let g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
    let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    // out-of-gamut (deep red / deep blue) → desaturate toward luminance rather than clip
    const lum = Y;
    const mn = Math.min(r, g, b);
    if (mn < 0) { const k = lum / (lum - mn); r = lum + (r - lum) * k; g = lum + (g - lum) * k; b = lum + (b - lum) * k; }
    const mx = Math.max(r, g, b, 1e-30);
    out[i * 4] = r / mx; out[i * 4 + 1] = g / mx; out[i * 4 + 2] = b / mx;
    // store luminance relative to 6500 K in log2, and the max-component scale so rgb*2^a ≈ linear radiance
    out[i * 4 + 3] = Math.log2(Math.max(1e-30, mx / ref));
  }
  return out;
}

/** Radial disk LUT over u = log(r/rin)/log(rout/rin) ∈ [0,1]: (T/Tmax, 1/u^t, Ω, unused). */
export function diskLUT(geom, rIn, rOut, n = 512) {
  const out = new Float32Array(n * 4);
  let Fmax = 0;
  const F = [];
  for (let i = 0; i < n; i++) {
    const r = rIn * Math.pow(rOut / rIn, i / (n - 1));
    const fl = pageThorneFlux(r, geom.spin, geom.rIsco);
    F.push(fl); Fmax = Math.max(Fmax, fl);
  }
  for (let i = 0; i < n; i++) {
    const r = rIn * Math.pow(rOut / rIn, i / (n - 1));
    const rc = Math.max(r, geom.rIsco * 1.0001);
    const { Omega, ut } = circularOrbit(rc, geom.a);
    out[i * 4] = Math.pow(F[i] / Fmax, 0.25);
    out[i * 4 + 1] = 1 / ut;
    out[i * 4 + 2] = Omega;
    out[i * 4 + 3] = r;
  }
  return out;
}

/** Radius (rs) where the Page–Thorne temperature peaks. */
export function peakRadius(geom) {
  let best = 0, rb = geom.rIsco;
  for (let i = 1; i < 400; i++) {
    const r = geom.rIsco * Math.pow(10, i / 400);
    const f = pageThorneFlux(r, geom.spin, geom.rIsco);
    if (f > best) { best = f; rb = r; }
  }
  return rb;
}
