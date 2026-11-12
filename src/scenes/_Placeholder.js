// Temporary placeholder scene used until the real scale scene is implemented.
import * as THREE from 'three';
import { OrbitRig } from '../engine/Director.js';

export function makePlaceholder(label, color = 0x88aaff) {
  return class Placeholder {
    constructor(ctx, params) {
      this.ctx = ctx; this.params = params;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(50, ctx.engine.aspect, 0.1, 1e5);
      this.rig = new OrbitRig(this.camera, ctx.input, { distance: 6 });
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.3 }));
      this.scene.add(m, new THREE.AmbientLight(0xffffff, 0.2));
      const l = new THREE.DirectionalLight(0xffffff, 3); l.position.set(3, 2, 4); this.scene.add(l);
      this.breadcrumb = { label };
      this._off = ctx.engine.onResize(() => { this.camera.aspect = ctx.engine.aspect; this.camera.updateProjectionMatrix(); });
    }
    enter() { this.ctx.hud.setHint(`${label} — under construction`); }
    update(dt) { this.rig.update(dt); }
    dispose() { this._off(); }
  };
}
