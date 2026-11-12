// Baseline sky for planets: physically based single-scattering atmosphere (Rayleigh + Mie, planet
// shadow) applied as a full-screen pass over the opaque world (sky + aerial perspective in one),
// sun disc, starfield, sunlight/hemisphere colors from atmospheric transmittance, and an oriented
// PMREM sky environment for PBR materials.
//
// Module contract: createSky(world) → { update(dt), composite(renderer, srcTarget, dstTarget, camera), dispose(), ... }
import * as THREE from 'three';
import { COMMON_GLSL, NOISE_GLSL } from '../../../engine/glsl/noise.glsl.js';

const VERT = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
${COMMON_GLSL}
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform mat4 uProjInv; uniform mat4 uCamWorld;
uniform vec3 uCamPos; uniform vec3 uPlanetC; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform float uR, uRA, uHr, uHm, uMieG, uSunI, uReversed, uHasAtmo, uSunCos, uFrame;
uniform vec3 uBetaR; uniform float uBetaM;
varying vec2 vUv;
vec2 rs(vec3 ro, vec3 rd, float r) { float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c; if (d < 0.0) return vec2(1e30, -1e30); d = sqrt(d); return vec2(-b - d, -b + d); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).r;
  vec2 ndc = vUv * 2.0 - 1.0;
  bool isSky = uReversed > 0.5 ? depth <= 0.0 : depth >= 1.0;
  float z = uReversed > 0.5 ? max(depth, 1e-7) : min(depth * 2.0 - 1.0, 0.9999999);
  vec4 vp = uProjInv * vec4(ndc, z, 1.0); vp.xyz /= vp.w;
  vec3 rd = normalize(mat3(uCamWorld) * normalize(vp.xyz));
  vec3 ro = uCamPos - uPlanetC;
  float sceneT = isSky ? 1e30 : length(vp.xyz);
  vec2 tp = rs(ro, rd, uR - 30.0);
  if (isSky && tp.x > 0.0 && tp.x < tp.y) sceneT = tp.x;
  vec3 inscatter = vec3(0.0); vec3 trans = vec3(1.0);
  float mu = dot(rd, uSunDir);
  if (uHasAtmo > 0.5) {
    vec2 ta = rs(ro, rd, uRA);
    if (ta.x < ta.y && ta.y > 0.0) {
      float t0 = max(ta.x, 0.0), t1 = min(ta.y, sceneT);
      if (t1 > t0) {
        const int N = 16;
        float jit = ignT(gl_FragCoord.xy, uFrame);
        float odR = 0.0, odM = 0.0;
        vec3 sumR = vec3(0.0), sumM = vec3(0.0);
        float prevT = t0;
        for (int i = 0; i < N; i++) {
          // quadratic step distribution: dense near the camera for crisp aerial perspective
          float a = (float(i) + jit) / float(N), b = (float(i + 1)) / float(N);
          float tA = t0 + (t1 - t0) * a * a, tB = t0 + (t1 - t0) * b * b;
          float ds = tB - prevT; prevT = tB;
          vec3 p = ro + rd * tA;
          float h = max(length(p) - uR, 0.0);
          float dR = exp(-h / uHr) * ds, dM = exp(-h / uHm) * ds;
          odR += dR; odM += dM;
          vec2 tsh = rs(p, uSunDir, uR - 30.0);
          if (tsh.x > 0.0 && tsh.x < tsh.y) continue; // planet shadow (night side, terminator)
          vec2 tl = rs(p, uSunDir, uRA);
          float lds = tl.y / 6.0, lR = 0.0, lM = 0.0;
          for (int j = 0; j < 6; j++) { vec3 q = p + uSunDir * (float(j) + 0.5) * lds; float hq = max(length(q) - uR, 0.0); lR += exp(-hq / uHr) * lds; lM += exp(-hq / uHm) * lds; }
          vec3 att = exp(-(uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM)));
          sumR += att * dR; sumM += att * dM;
        }
        float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
        float g = uMieG;
        float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
        inscatter = (sumR * uBetaR * pR + sumM * uBetaM * pM) * uSunI * uSunColor;
        trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
      }
    }
  }
  if (isSky && !(tp.x > 0.0 && tp.x < tp.y)) {
    float d = smoothstep(uSunCos - 0.000004, uSunCos + 0.000004, mu);
    float limb = sqrt(max(0.0, 1.0 - clamp((1.0 - mu) / max(1.0 - uSunCos, 1e-7), 0.0, 1.0)));
    col += uSunColor * d * (0.45 + 0.55 * limb) * uSunI * 120.0 * trans;
  }
  col = col * trans + inscatter;
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function createSky(world) { const s = new Sky(world); await s.init(); return s; }

export class Sky {
  constructor(world) {
    this.world = world;
    const P = world.planet;
    const A = P.atmosphere;
    this.hasAtmo = !!A;
    const R = P.radius;
    const hMul = A ? A.height : 1;
    this.Hr = 8000 * hMul; this.Hm = 1200 * hMul;
    this.RA = R + this.Hr * 7.5;
    const dens = A ? A.density : 0;
    this.betaR = A ? new THREE.Vector3(...A.rayleigh).multiplyScalar(1e-6 * dens * 1.25) : new THREE.Vector3();
    this.betaM = A ? A.mie * 1e-6 * dens : 0;
    const distM = (P.orbit?.a || 1) * 1.495978707e11;
    const starR = world.star.radius * 6.957e8;
    this.sunAngular = Math.max(0.0035, Math.atan(starR / distM) * 1.6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uPlanetC: { value: new THREE.Vector3() }, uSunDir: { value: world.sunDir }, uSunColor: { value: world.starColor.clone() },
        uR: { value: R }, uRA: { value: this.RA }, uHr: { value: this.Hr }, uHm: { value: this.Hm }, uMieG: { value: A ? A.mieG : 0.76 },
        uSunI: { value: 3.6 }, uReversed: { value: world.ctx.engine.reversedDepth ? 1 : 0 }, uHasAtmo: { value: this.hasAtmo ? 1 : 0 },
        uSunCos: { value: Math.cos(this.sunAngular) }, uFrame: { value: 0 },
        uBetaR: { value: this.betaR }, uBetaM: { value: this.betaM },
      },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri, this.mat); this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._sunT = new THREE.Vector3(1, 1, 1);
    this._envTimer = 0;
    this._lastEnvSun = new THREE.Vector3();
    this._lastEnvUp = new THREE.Vector3();
  }

  async init() {
    this._buildStars();
    this.pmrem = new THREE.PMREMGenerator(this.world.ctx.renderer);
    this._envScene = new THREE.Scene();
    this._envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uUp: { value: new THREE.Vector3(0, 1, 0) }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uUp, uZen, uHor, uGnd, uSun, uSunC; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float e = dot(d, uUp);
          vec3 c = e > 0.0 ? mix(uHor, uZen, pow(clamp(e, 0.0, 1.0), 0.45)) : mix(uHor * 0.6, uGnd, clamp(-e * 4.0, 0.0, 1.0));
          float s = max(dot(d, uSun), 0.0); c += uSunC * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.4) * step(-0.05, e);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this._envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this._envMat));
    this.update(0);
    this._updateEnv(true);
  }

  _buildStars() {
    const n = this.world.ctx.quality === 'high' ? 9000 : 5000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos[i * 3] = r * Math.cos(a); pos[i * 3 + 1] = z; pos[i * 3 + 2] = r * Math.sin(a);
      const mag = Math.pow(rnd(), 6);
      const t = 3000 + Math.pow(rnd(), 1.5) * 12000;
      c.setHSL(t > 7000 ? 0.6 : t > 5000 ? 0.12 : 0.05, t > 5000 && t < 7000 ? 0.1 : 0.45, 0.75);
      const b = 0.12 + mag * 3.5;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
      size[i] = 1.0 + mag * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position * 5.0e7, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); float a = exp(-d * 4.0); gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.world.scene.add(this.stars);
  }

  /** Transmittance of sunlight reaching planet-frame point p (CPU, matches shader). */
  sunTransmittance(p, out) {
    if (!this.hasAtmo) return out.set(1, 1, 1);
    const sd = this.world.sunDir, R = this.world.radius;
    const b = p.dot(sd), c = p.lengthSq() - this.RA * this.RA, disc = b * b - c;
    // ground shadow
    const cg = p.lengthSq() - (R - 30) * (R - 30), dg = b * b - cg;
    if (dg > 0 && -b - Math.sqrt(dg) > 0) return out.set(0, 0, 0);
    if (disc < 0) return out.set(1, 1, 1);
    const tl = -b + Math.sqrt(disc);
    let odR = 0, odM = 0;
    const n = 10, ds = tl / n;
    const q = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      q.copy(sd).multiplyScalar((i + 0.5) * ds).add(p);
      const h = Math.max(0, q.length() - R);
      odR += Math.exp(-h / this.Hr) * ds; odM += Math.exp(-h / this.Hm) * ds;
    }
    return out.set(Math.exp(-(this.betaR.x * odR + this.betaM * 1.1 * odM)), Math.exp(-(this.betaR.y * odR + this.betaM * 1.1 * odM)), Math.exp(-(this.betaR.z * odR + this.betaM * 1.1 * odM)));
  }

  update(dt) {
    const w = this.world;
    const focus = w.focus.lengthSq() > 0 ? w.focus : w.cameraPlanetPos(new THREE.Vector3());
    const up = focus.clone().normalize();
    const T = this.sunTransmittance(focus.clone().addScaledVector(up, 2), this._sunT);
    const elev = up.dot(w.sunDir);
    const dayK = THREE.MathUtils.smoothstep(elev, -0.08, 0.12);
    // sunlight
    w.sun.color.copy(w.starColor).multiply(new THREE.Color(T.x, T.y, T.z));
    w.sun.intensity = 3.4 * Math.min(1, Math.max(0, (elev + 0.03) * 6));
    const fw = w.toWorld(focus, new THREE.Vector3());
    w.sun.position.copy(fw).addScaledVector(w.sunDir, 3000);
    w.sun.target.position.copy(fw);
    w.sun.target.updateMatrixWorld();
    // hemisphere ambient
    const sky = w.planet.themeData?.sky || { day: '#7fb3ff', horizon: '#dfeeff' };
    const zen = new THREE.Color(sky.day), hor = new THREE.Color(sky.horizon);
    w.hemi.color.copy(zen).lerp(hor, 0.35).multiplyScalar(0.55 * dayK + 0.012);
    w.hemi.groundColor.copy(new THREE.Color(w.planet.palette.low)).multiplyScalar(0.22 * dayK + 0.004);
    w.hemi.position.copy(up);
    w.hemi.intensity = this.hasAtmo ? 1.0 : 0.25;
    // stars follow the camera (rendered at "infinity")
    this.stars.position.copy(w.camera.position);
    this.stars.material.uniforms.uScale.value = Math.max(1, w.ctx.engine.pixelRatio);
    this._envTimer -= dt;
    if (this._envTimer <= 0) { this._updateEnv(false); this._envTimer = 1.2; }
  }

  _updateEnv(force) {
    const w = this.world;
    const focus = w.cameraPlanetPos(new THREE.Vector3());
    const up = focus.clone().normalize();
    if (!force && this._lastEnvSun.distanceTo(w.sunDir) < 0.01 && this._lastEnvUp.distanceTo(up) < 0.002) return;
    this._lastEnvSun.copy(w.sunDir); this._lastEnvUp.copy(up);
    const elev = up.dot(w.sunDir);
    const dayK = THREE.MathUtils.smoothstep(elev, -0.1, 0.15);
    const sunsetK = Math.exp(-Math.pow((elev - 0.02) / 0.12, 2));
    const sky = w.planet.themeData?.sky || { day: '#7fb3ff', horizon: '#dfeeff', night: '#020611' };
    const atm = w.planet.atmosphere;
    const u = this._envMat.uniforms;
    u.uUp.value.copy(up);
    u.uZen.value.set(sky.day).multiplyScalar(0.9 * dayK).lerp(new THREE.Color(sky.night || '#000'), 1 - dayK);
    u.uHor.value.set(sky.horizon).multiplyScalar(1.1 * dayK).lerp(new THREE.Color(atm?.sunset || '#ff9b54').multiplyScalar(0.9), sunsetK * 0.6);
    u.uGnd.value.set(w.planet.palette.low).multiplyScalar(0.25 * dayK + 0.003);
    u.uSun.value.copy(w.sunDir);
    u.uSunC.value.copy(w.sun.color).multiplyScalar(dayK);
    if (!this.hasAtmo) { u.uZen.value.setRGB(0, 0, 0); u.uHor.value.setRGB(0.002, 0.002, 0.002); }
    const rt = this.pmrem.fromScene(this._envScene, 0, 0.1, 100);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    w.scene.environment = rt.texture;
    w.scene.environmentIntensity = this.hasAtmo ? 0.9 : 0.3;
  }

  /** Full-screen atmosphere over the opaque world render. */
  composite(renderer, src, dst, camera) {
    const u = this.mat.uniforms;
    u.tColor.value = src.texture;
    u.tDepth.value = src.depthTexture;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uPlanetC.value.copy(this.world.origin).negate();
    u.uSunColor.value.copy(this.world.starColor);
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    renderer.setRenderTarget(dst);
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.world.scene.remove(this.stars);
    this.stars.geometry.dispose(); this.stars.material.dispose();
    this.mat.dispose(); this.envRT?.dispose(); this.pmrem?.dispose();
  }
}
