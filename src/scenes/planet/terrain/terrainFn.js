// Terrain height + climate function for a planet. Pure JS (no THREE) so it runs identically in the
// main thread (gameplay queries: heightAt) and in workers (chunk meshing).
//
// Convention: input is a UNIT direction (x,y,z) from the planet centre (y = rotation axis).
// h = meters above sea level (sea surface radius = planet.radius). Negative = under water.
// `spacing` (meters between samples) limits detail octaves to avoid aliasing on coarse LODs.
// Sites (cities/towns/monuments) are flattened into gentle plateaus so the civ layer can build.
import { Simplex3 } from '../../../engine/noise.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Inverse standard normal CDF (Acklam) — maps an ocean fraction to a noise threshold.
function invNorm(p) {
  p = Math.min(0.999, Math.max(0.001, p));
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : 0;
  if (p < 0.02425) return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p > 1 - 0.02425) return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  const r = p - 0.5, s = r * r;
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

export function createTerrainFn(planet, sites = []) {
  const R = planet.radius;
  const T = planet.terrain;
  const out = { h: 0, base: 0, moisture: 0, temperature: 0, rock: 0, coast: 0, mountain: 0 };
  if (!T) {
    // Gas giant / no solid surface: a perfect sphere.
    const flat = { radius: R, amplitude: 0, hasOcean: false, seaLevel: 0, sites,
      sample(x, y, z, spacing, o = out) { o.h = 0; o.base = 0; o.moisture = 0.5; o.temperature = 0.5; o.rock = 0; o.coast = 1; o.mountain = 0; return o; },
      height() { return 0; },
    };
    return flat;
  }

  const seed = T.seed >>> 0;
  const nC = new Simplex3(seed), nM = new Simplex3(seed ^ 0x9e3779b9), nW = new Simplex3(seed ^ 0x85ebca6b), nD = new Simplex3(seed ^ 0xc2b2ae35);
  const amp = T.amplitude;
  const hasOcean = !!planet.ocean && T.seaLevel >= 0;
  const shift = T.seaLevel >= 0 ? invNorm(T.seaLevel) * 0.2 : -0.45;

  // Wavelengths (meters)
  const fC = Math.max(0.3, T.continent) / 900000; // continents
  const fW = 1 / 520000, warpAmp = 140000 * T.warp; // domain warp
  const fMask = 1 / 380000; // where mountain ranges live
  const fM = 1 / 70000; // ridge base
  const fH = 1 / 14000; // hills
  const fD = 1 / 1800; // detail
  const fCan = 1 / 160000; // canyon/river network
  const fDune = 1 / 420; // dune spacing
  const windAng = ((seed % 628) / 100);
  const wdx = Math.cos(windAng), wdz = Math.sin(windAng);

  // Pre-pack sites
  const S = sites.map((s) => ({ x: s.dir[0], y: s.dir[1], z: s.dir[2], r: s.radius, e: s.elevation, cosOuter: Math.cos((s.radius * 1.7) / R) }));

  function ridgedOct(px, py, pz, oct) {
    let sum = 0, a = 0.5, f = 1, w = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(nM.noise(px * f, py * f, pz * f));
      n *= n; n *= w; w = Math.min(1, Math.max(0, n * 1.8));
      sum += n * a; norm += a; a *= 0.5; f *= 2.03;
    }
    return sum / norm;
  }

  function sample(x, y, z, spacing = 1, o = out) {
    const px = x * R, py = y * R, pz = z * R;
    // domain warp
    const wx = nW.fbm(px * fW, py * fW, pz * fW, 3) * warpAmp;
    const wy = nW.fbm(px * fW + 31.7, py * fW + 7.3, pz * fW - 11.1, 3) * warpAmp;
    const wz = nW.fbm(px * fW - 17.9, py * fW + 23.4, pz * fW + 5.6, 3) * warpAmp;
    const qx = px + wx, qy = py + wy, qz = pz + wz;

    // continents
    let c = nC.fbm(qx * fC, qy * fC, qz * fC, 6, 2.0, 0.52);
    if (T.islands > 0) c += T.islands * 0.22 * nC.fbm(qx * fC * 5.3 + 3.1, qy * fC * 5.3, qz * fC * 5.3, 4);
    const land = c - shift;
    let h;
    if (land < 0) h = -Math.pow(-land * 3.2, 0.75) * amp * 0.42 - 2; // ocean floor with shelves
    else h = Math.pow(land, 0.85) * amp * 0.32;

    const landMask = smooth(-0.02, 0.06, land);
    // mountains
    const oct = Math.max(2, Math.min(11, Math.floor(Math.log2(70000 / Math.max(2, spacing * 2))) + 1));
    const mm = smooth(-0.1, 0.45, nC.fbm(qx * fMask + 9.1, qy * fMask, qz * fMask, 3)) * T.mountains;
    let mountain = 0;
    if (mm > 0.001) {
      const r = ridgedOct(qx * fM, qy * fM, qz * fM, oct);
      mountain = Math.pow(r, 1.7) * mm * smooth(0.0, 0.25, land);
      h += mountain * amp * (0.75 + 0.5 * T.ridge);
    }
    // hills
    h += (nC.fbm(qx * fH, qy * fH, qz * fH, 4) * 0.5 + 0.5) * amp * 0.07 * T.hills * landMask;
    // plateaus / terraces (mesas)
    if (T.terraces > 0 && h > 0) {
      const step = amp * 0.09;
      const k = h / step, fl = Math.floor(k), fr = k - fl;
      const terr = (fl + smooth(0.35, 0.65, fr)) * step;
      const tmask = smooth(0.2, 0.6, nD.noise(px / 60000, py / 60000, pz / 60000) * 0.5 + 0.5) * T.terraces;
      h = lerp(h, terr, tmask);
    }
    // canyons / river valleys
    if (T.canyons > 0) {
      const v = Math.abs(nC.fbm(qx * fCan + 4.4, qy * fCan, qz * fCan, 4));
      const carve = (1 - smooth(0.0, 0.05, v)) * T.canyons * landMask;
      h -= carve * Math.min(h + 3, amp * 0.18);
    }
    // dunes
    if (T.dunes > 0 && h > 0) {
      const dn = nD.fbm(px / 3000, py / 3000, pz / 3000, 3);
      const s = (px * wdx + pz * wdz + py * 0.3) * fDune + dn * 6;
      const d = Math.abs(Math.sin(s));
      const crest = Math.pow(1 - d, 2.2);
      const duneMask = smooth(0.0, 0.1, land) * (1 - smooth(0.2, 0.6, mountain));
      h += crest * 38 * T.dunes * duneMask * (0.6 + 0.4 * dn);
    }
    // craters (barren worlds)
    if (T.craters > 0) {
      let cr = 0;
      for (let k = 0; k < 3; k++) {
        const sc = [1 / 60000, 1 / 18000, 1 / 5000][k];
        const ampk = [900, 260, 70][k] * T.craters;
        const gx = px * sc, gy = py * sc, gz = pz * sc;
        const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          let hh = (Math.imul(ix + dx, 73856093) ^ Math.imul(iy + dy, 19349663) ^ Math.imul(iz + dz, 83492791) ^ (seed + k)) >>> 0;
          hh = Math.imul(hh ^ (hh >>> 15), 2246822519) >>> 0;
          if ((hh & 7) > 3) continue; // sparse
          const cx = ix + dx + (hh & 1023) / 1023, cy = iy + dy + ((hh >>> 10) & 1023) / 1023, cz = iz + dz + ((hh >>> 20) & 1023) / 1023;
          const d2 = (cx - gx) ** 2 + (cy - gy) ** 2 + (cz - gz) ** 2;
          if (d2 < best) best = d2;
        }
        const d = Math.sqrt(best) / 0.42;
        if (d < 1.6) {
          const bowl = d < 1 ? (d * d - 1) : 0;
          const rim = Math.exp(-((d - 1) * (d - 1)) / 0.02) * 0.35;
          cr += (bowl + rim) * ampk;
        }
      }
      h += cr;
    }
    // fine detail (spacing-limited)
    const octD = Math.max(1, Math.min(9, Math.floor(Math.log2(1800 / Math.max(1, spacing * 2))) + 1));
    const rock = nD.fbm(px * fD, py * fD, pz * fD, octD);
    h += rock * (6 + amp * 0.004) * (0.4 + 0.6 * landMask);

    const base = h;
    // flatten sites into plateaus
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const dt = x * s.x + y * s.y + z * s.z;
      if (dt < s.cosOuter) continue;
      const dist = Math.acos(Math.min(1, dt)) * R;
      const t = smooth(s.r * 1.7, s.r * 0.85, dist);
      if (t > 0) h = lerp(h, s.e + (h - s.e) * 0.04, t);
    }

    // climate
    const lat = Math.abs(y);
    const tn = nC.noise(px / 300000 + 5.5, py / 300000, pz / 300000);
    const temperature = Math.min(1, Math.max(0, 1.08 - lat * lat * 1.15 + tn * 0.14 - Math.max(0, h) / (amp * 1.6)));
    const mn = nW.fbm(px / 420000 + 2.2, py / 420000, pz / 420000, 4);
    const coastal = hasOcean ? 0.3 * (1 - smooth(0.0, 0.25, land)) : 0;
    const moisture = Math.min(1, Math.max(0, 0.5 + mn * 0.75 + coastal - mountain * 0.2));

    o.h = h; o.base = base; o.moisture = moisture; o.temperature = temperature; o.rock = rock; o.coast = land; o.mountain = mountain;
    return o;
  }

  return {
    radius: R, amplitude: amp, hasOcean, seaLevel: 0, sites,
    sample,
    height(x, y, z, spacing = 0.5) { return sample(x, y, z, spacing).h; },
    baseHeight(x, y, z, spacing = 40) { return sample(x, y, z, spacing).base; },
  };
}
