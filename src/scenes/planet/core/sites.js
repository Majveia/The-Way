// Deterministic settlement & landmark sites for a planet: cities, towns, villages, monuments and a
// scenic spawn point. Computed from the planet seed + the terrain's base height, so terrain workers
// (which flatten sites into plateaus) and the civilization layer always agree.
import { Random, hash32 } from '../../../engine/rng.js';
import { makeName } from '../../../engine/names.js';

const KIND = {
  city: { radius: [1400, 2600], minSpacing: 40000 },
  town: { radius: [380, 700], minSpacing: 14000 },
  village: { radius: [110, 220], minSpacing: 6000 },
  monument: { radius: [60, 260], minSpacing: 9000 },
};

/**
 * @param planet  planet data from Universe
 * @param terrain terrain fn created WITHOUT sites (base height only)
 * @returns {{ cities, towns, villages, monuments, all, spawn: { dir, facing } }}
 */
export function computeSites(planet, terrain) {
  const civ = planet.civ || { level: 0, cities: 0, towns: 0, villages: 0, monuments: [] };
  const r = new Random(hash32(planet.seed, 0x517e));
  const R = planet.radius;
  const all = [];
  const isGas = planet.kind === 'gas';
  const amp = terrain.amplitude || 1;

  const okSpot = (dir, kind) => {
    if (isGas) return { e: 0 };
    const s = terrain.sample(dir[0], dir[1], dir[2], 60);
    const h = s.base;
    if (terrain.hasOcean && h < 6) return null;
    if (h > amp * (kind === 'monument' ? 0.85 : 0.55)) return null;
    // slope check: compare heights at ±300 m
    const e = 300 / R;
    const tx = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ax = [dir[1] * tx[2] - dir[2] * tx[1], dir[2] * tx[0] - dir[0] * tx[2], dir[0] * tx[1] - dir[1] * tx[0]];
    const al = Math.hypot(...ax); ax[0] /= al; ax[1] /= al; ax[2] /= al;
    const n1 = norm([dir[0] + ax[0] * e, dir[1] + ax[1] * e, dir[2] + ax[2] * e]);
    const n2 = norm([dir[0] - ax[0] * e, dir[1] - ax[1] * e, dir[2] - ax[2] * e]);
    const dh = Math.abs(terrain.sample(n1[0], n1[1], n1[2], 60).base - terrain.sample(n2[0], n2[1], n2[2], 60).base);
    if (dh / 600 > (kind === 'city' ? 0.18 : 0.3)) return null;
    return { e: Math.max(h, terrain.hasOcean ? 8 : h) };
  };

  const place = (kind, count, extra = {}) => {
    const def = KIND[kind];
    const placed = [];
    let tries = 0;
    while (placed.length < count && tries < count * 260) {
      tries++;
      const dir = r.unitVec();
      if (Math.abs(dir[1]) > (kind === 'city' ? 0.78 : 0.88)) continue; // avoid poles for big settlements
      let tooClose = false;
      for (const s of all) {
        const d = Math.acos(Math.min(1, dir[0] * s.dir[0] + dir[1] * s.dir[1] + dir[2] * s.dir[2])) * R;
        if (d < Math.max(def.minSpacing, KIND[s.kind].minSpacing) * 0.6) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const ok = okSpot(dir, kind);
      if (!ok) continue;
      const seed = hash32(planet.seed, kind.length, placed.length, 0x5173);
      const site = {
        kind, dir, radius: r.float(def.radius[0], def.radius[1]), elevation: ok.e, seed,
        name: makeName(seed, planet.themeData?.tongue || 'aelian', kind === 'city' ? 2 : 1),
        style: planet.civ?.style, ...extra,
      };
      placed.push(site); all.push(site);
    }
    return placed;
  };

  const lvl = civ.level || 0;
  const cities = lvl >= 2 ? place('city', Math.min(civ.cities || 0, 8)) : [];
  const towns = lvl >= 1 ? place('town', Math.min(civ.towns || 0, 14)) : [];
  const villages = lvl >= 1 ? place('village', Math.min(civ.villages || 0, 24)) : [];
  const monuments = [];
  (civ.monuments || []).forEach((type, i) => { const m = place('monument', 1, { type }); if (m[0]) monuments.push(m[0]); });

  // Spawn: a scenic spot just outside the most important settlement, facing it.
  let spawn = null;
  const anchor = cities[0] || towns[0] || monuments[0] || villages[0];
  if (anchor) {
    const R0 = anchor.radius * 1.9 + 250;
    for (let k = 0; k < 24 && !spawn; k++) {
      const a = (k / 24) * Math.PI * 2 + r.float(0, 0.3);
      const t = tangentBasis(anchor.dir);
      const ang = R0 / R;
      const d = norm([
        anchor.dir[0] * Math.cos(ang) + (t[0][0] * Math.cos(a) + t[1][0] * Math.sin(a)) * Math.sin(ang),
        anchor.dir[1] * Math.cos(ang) + (t[0][1] * Math.cos(a) + t[1][1] * Math.sin(a)) * Math.sin(ang),
        anchor.dir[2] * Math.cos(ang) + (t[0][2] * Math.cos(a) + t[1][2] * Math.sin(a)) * Math.sin(ang),
      ]);
      const s = terrain.sample(d[0], d[1], d[2], 20);
      if (!terrain.hasOcean || s.base > 4) spawn = { dir: d, facing: anchor.dir.slice(), anchor: anchor.name };
    }
  }
  if (!spawn) {
    for (let k = 0; k < 400 && !spawn; k++) {
      const d = r.unitVec();
      if (Math.abs(d[1]) > 0.7) continue;
      const s = terrain.sample(d[0], d[1], d[2], 20);
      if ((!terrain.hasOcean || s.base > 6) && s.base < amp * 0.4) spawn = { dir: d, facing: null, anchor: null };
    }
    if (!spawn) spawn = { dir: [0, 0, 1], facing: null, anchor: null };
  }
  return { cities, towns, villages, monuments, all, spawn };
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
export function tangentBasis(d) {
  const ref = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const e = norm([ref[1] * d[2] - ref[2] * d[1], ref[2] * d[0] - ref[0] * d[2], ref[0] * d[1] - ref[1] * d[0]]);
  const n = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]];
  return [e, n];
}
