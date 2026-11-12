// Cube-sphere quadtree terrain with worker-built chunks. Splits by camera distance, swaps parent ↔
// children only when the replacement is fully ready (no holes), caches meshes with an LRU budget.
// Exposes heightAt/sampleAt for gameplay (same function the workers use).
import * as THREE from 'three';
import { faceToSphere } from '../core/cubesphere.js';
import { createTerrainFn } from './terrainFn.js';
import { createTerrainMaterial, createOceanMaterial } from './materials.js';

let _uid = 0;

class Node {
  constructor(face, level, x0, y0, size, parent) {
    this.id = ++_uid;
    this.face = face; this.level = level; this.x0 = x0; this.y0 = y0; this.size = size; this.parent = parent;
    this.children = null;
    this.mesh = null; this.ocean = null;
    this.state = 0; // 0 none, 1 requested, 2 ready
    this.center = new THREE.Vector3();
    this.lastUsed = 0;
    this.minH = 0; this.maxH = 0;
    const d = [0, 0, 0];
    faceToSphere(face, x0 + size / 2, y0 + size / 2, d);
    this.dir = new THREE.Vector3(d[0], d[1], d[2]);
  }
}

export class TerrainSystem {
  constructor(world) {
    this.world = world;
    const planet = world.planet;
    this.planet = planet;
    this.R = planet.radius;
    this.fn = createTerrainFn(planet, world.sites.all);
    this.hasOcean = this.fn.hasOcean;
    this.N = world.ctx.quality === 'low' ? 24 : 32;
    this.splitK = world.ctx.quality === 'high' ? 2.4 : world.ctx.quality === 'medium' ? 2.0 : 1.6;
    // finest chunk ≈ 48 m on high quality
    const faceMeters = (Math.PI / 2) * this.R;
    this.maxLevel = Math.max(4, Math.ceil(Math.log2(faceMeters / (world.ctx.quality === 'low' ? 96 : 48))));
    this.material = createTerrainMaterial(planet);
    this.oceanMaterial = this.hasOcean ? createOceanMaterial(planet) : null;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    world.root.add(this.group);
    this.index = this._buildIndex(this.N);
    this.oceanIndex = this._buildGridIndex(this.N);
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(f, 0, -1, -1, 2, null));
    this.nodes = new Map();
    this.queue = []; // nodes waiting for a worker
    this.inflight = 0;
    this.frame = 0;
    this.meshCount = 0;
    this.maxCached = world.ctx.quality === 'high' ? 1400 : 900;
    this.workers = [];
    this._idle = [];
    this._sample = { h: 0 };
    this._tmp = new THREE.Vector3();
  }

  async init() {
    const count = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const planetData = JSON.parse(JSON.stringify({ ...this.planet, themeData: null, flora: null, fauna: null }));
    const sites = this.world.sites.all.map((s) => ({ dir: s.dir, radius: s.radius, elevation: s.elevation }));
    const ready = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      ready.push(new Promise((res) => { w.onmessage = (e) => { if (e.data.type === 'ready') { w.onmessage = (ev) => this._onChunk(w, ev.data); res(); } }; }));
      w.postMessage({ type: 'init', planet: planetData, sites });
      this.workers.push(w);
      w._busy = 0;
    }
    await Promise.all(ready);
  }

  /** Meters above sea level at unit direction (full detail). */
  heightAt(x, y, z) { return this.fn.sample(x, y, z, 0.5).h; }
  sampleAt(x, y, z, spacing = 0.5) { return this.fn.sample(x, y, z, spacing); }

  _buildIndex(N) {
    const V = N + 1, idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const base = V * V;
    const bottom = base, top = base + V, left = base + 2 * V, right = base + 3 * V;
    for (let i = 0; i < N; i++) {
      // bottom edge (j=0): outward -v
      { const e0 = i, e1 = i + 1, s0 = bottom + i, s1 = bottom + i + 1; idx.push(e0, s0, e1, s0, s1, e1); }
      // top edge (j=N): outward +v
      { const e0 = N * V + i, e1 = e0 + 1, s0 = top + i, s1 = top + i + 1; idx.push(e0, e1, s0, s0, e1, s1); }
      // left edge (i=0): outward -u
      { const e0 = i * V, e1 = (i + 1) * V, s0 = left + i, s1 = left + i + 1; idx.push(e0, e1, s0, s0, e1, s1); }
      // right edge (i=N): outward +u
      { const e0 = i * V + N, e1 = (i + 1) * V + N, s0 = right + i, s1 = right + i + 1; idx.push(e0, s0, e1, s0, s1, e1); }
    }
    return new THREE.BufferAttribute(new Uint32Array(idx), 1);
  }

  _buildGridIndex(N) {
    const V = N + 1, idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * V + i, b = a + 1, c = a + V, d = c + 1; idx.push(a, b, c, b, d, c); }
    return new THREE.BufferAttribute(new Uint32Array(idx), 1);
  }

  _nodeMeters(n) { return n.size * 0.5 * (Math.PI / 2) * this.R; }

  _request(n) {
    if (n.state !== 0) return;
    n.state = 1;
    this.nodes.set(n.id, n);
    this.queue.push(n);
  }

  _pump(camPos) {
    if (!this.queue.length) return;
    // closest first, coarser first on ties
    for (const n of this.queue) {
      this._tmp.copy(n.dir).multiplyScalar(this.R);
      n._prio = this._tmp.distanceTo(camPos) / Math.max(1, this._nodeMeters(n)) + n.level * 0.05;
    }
    this.queue.sort((a, b) => a._prio - b._prio);
    for (const w of this.workers) {
      while (w._busy < 2 && this.queue.length) {
        const n = this.queue.shift();
        if (n.state !== 1) continue;
        w._busy++;
        this.inflight++;
        const c = n.dir.clone().multiplyScalar(this.R);
        n.center.copy(c);
        w.postMessage({ type: 'chunk', id: n.id, face: n.face, x0: n.x0, y0: n.y0, size: n.size, N: this.N, cx: c.x, cy: c.y, cz: c.z });
      }
    }
  }

  _onChunk(w, m) {
    w._busy--; this.inflight--;
    const n = this.nodes.get(m.id);
    if (!n || n.state !== 1) return; // disposed meanwhile
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
    g.setAttribute('aTData', new THREE.BufferAttribute(m.data, 4));
    g.setAttribute('aDetail', new THREE.BufferAttribute(m.detail, 3));
    g.setAttribute('aSlope', new THREE.BufferAttribute(m.slope, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.copy(n.center);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.castShadow = n.level >= this.maxLevel - 3;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData.node = n;
    this.group.add(mesh);
    n.mesh = mesh;
    if (m.ocean && this.oceanMaterial) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(m.ocean.pos, 3));
      og.setAttribute('normal', new THREE.BufferAttribute(m.ocean.nrm, 3));
      og.setAttribute('aDepth', new THREE.BufferAttribute(m.ocean.depth, 1));
      og.setAttribute('aDetail', new THREE.BufferAttribute(m.ocean.detail, 3));
      og.setIndex(this.oceanIndex);
      og.computeBoundingSphere();
      const om = new THREE.Mesh(og, this.oceanMaterial);
      om.position.copy(n.center);
      om.matrixAutoUpdate = false; om.updateMatrix();
      om.renderOrder = 2; om.receiveShadow = true;
      om.visible = false;
      this.group.add(om);
      n.ocean = om;
    }
    n.minH = m.minH; n.maxH = m.maxH;
    n.state = 2;
    this.meshCount++;
  }

  _freeNode(n) {
    if (n.mesh) { n.mesh.geometry.dispose(); this.group.remove(n.mesh); n.mesh = null; }
    if (n.ocean) { n.ocean.geometry.dispose(); this.group.remove(n.ocean); n.ocean = null; }
    if (n.state === 2) this.meshCount--;
    n.state = 0;
    this.nodes.delete(n.id);
  }

  _freeSubtree(n) {
    if (n.children) for (const c of n.children) this._freeSubtree(c);
    n.children = null;
    this._freeNode(n);
  }

  _setVisible(n, v) { if (n.mesh) n.mesh.visible = v; if (n.ocean) n.ocean.visible = v; }

  _hideSubtree(n) { if (!n.children) return; for (const c of n.children) { this._setVisible(c, false); this._hideSubtree(c); } }

  _wantSplit(n, camPos) {
    if (n.level >= this.maxLevel) return false;
    const meters = this._nodeMeters(n);
    const c = this._tmp.copy(n.dir).multiplyScalar(this.R + (n.state === 2 ? (n.minH + n.maxH) * 0.5 : 0));
    const d = Math.max(0, c.distanceTo(camPos) - meters * 0.72);
    return d < meters * this.splitK;
  }

  _visit(n, camPos) {
    n.lastUsed = this.frame;
    if (this._wantSplit(n, camPos)) {
      if (!n.children) {
        const h = n.size / 2;
        n.children = [
          new Node(n.face, n.level + 1, n.x0, n.y0, h, n), new Node(n.face, n.level + 1, n.x0 + h, n.y0, h, n),
          new Node(n.face, n.level + 1, n.x0, n.y0 + h, h, n), new Node(n.face, n.level + 1, n.x0 + h, n.y0 + h, h, n),
        ];
      }
      let ready = true;
      for (const c of n.children) { if (c.state !== 2) { ready = false; this._request(c); } }
      if (ready || n.state !== 2) {
        if (n.state !== 2 && !ready) this._request(n);
        this._setVisible(n, false);
        for (const c of n.children) {
          if (c.state === 2) this._visit(c, camPos);
          else { c.lastUsed = this.frame; this._setVisible(c, false); }
        }
        return;
      }
      // children not ready yet: keep drawing this node
      this._setVisible(n, true);
      this._hideSubtree(n);
      for (const c of n.children) c.lastUsed = this.frame;
      return;
    }
    if (n.state !== 2) this._request(n);
    this._setVisible(n, n.state === 2);
    this._hideSubtree(n);
  }

  /** @param camPos camera position in PLANET frame */
  update(dt, camPos) {
    this.frame++;
    for (const r of this.roots) this._visit(r, camPos);
    this._pump(camPos);
    // LRU eviction of subtrees unused for a while
    if (this.meshCount > this.maxCached && this.frame % 30 === 0) this._evict(this.frame - 120);
    const t = this.world.time;
    if (this.material.userData.uniforms) this.material.userData.uniforms.uTime.value = t;
    if (this.oceanMaterial) this.oceanMaterial.userData.uniforms.uTime.value = t;
  }

  _evict(olderThan) {
    const walk = (n) => {
      if (!n.children) return;
      for (const c of n.children) {
        if (c.lastUsed < olderThan) this._freeSubtree(c);
        else walk(c);
      }
      if (n.children.every((c) => c.state === 0 && !c.children)) n.children = null;
    };
    for (const r of this.roots) walk(r);
  }

  /** True when nothing is queued/in flight (all wanted chunks built). */
  get settled() { return this.queue.length === 0 && this.inflight === 0; }

  /** Promise that resolves once the LOD for the current camera has fully loaded. */
  waitSettled(getCamPos, maxMs = 90000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let stable = 0;
      const tick = () => {
        this.update(0, getCamPos());
        if (this.settled) stable++; else stable = 0;
        if (stable > 6 || performance.now() - t0 > maxMs) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const r of this.roots) this._freeSubtree(r);
    this.material.dispose(); this.oceanMaterial?.dispose();
    this.world.root.remove(this.group);
  }
}
