// Civilization layer (cities, towns, villages, monuments, roads, traffic, night lights).
// Baseline stub — the civ team builds here, using world.sites (core/sites.js).
// Contract: createCiv(world) → { ready: Promise, update(dt), dispose() }
export async function createCiv(world) {
  return { ready: Promise.resolve(), update() {}, dispose() {} };
}
