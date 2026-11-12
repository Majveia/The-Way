// Life layer (flora + fauna). Baseline stub — the life team builds vegetation, grass, creatures here.
// Contract: createLife(world) → { ready: Promise, update(dt), dispose() }
export async function createLife(world) {
  return { ready: Promise.resolve(), update() {}, dispose() {} };
}
