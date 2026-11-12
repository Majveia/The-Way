// Renderer, frame loop, resolution management. Scenes render HDR into post.sceneTarget;
// PostFX handles bloom/tonemap/grade and presents.
import * as THREE from 'three';
import { PostFX } from './PostFX.js';

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ params: URLSearchParams, shot: boolean }} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.params = opts.params || new URLSearchParams();
    this.shot = !!opts.shot;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      reversedDepthBuffer: true,
      preserveDrawingBuffer: this.shot,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    /** true when depth is reversed (1 = near, 0 = far). Custom depth-reading shaders must respect this. */
    this.reversedDepth = renderer.capabilities.reversedDepthBuffer === true;

    this.post = new PostFX(renderer);
    const forcedDpr = parseFloat(this.params.get('dpr'));
    this.maxPixelRatio = Number.isFinite(forcedDpr) ? forcedDpr : Math.min(window.devicePixelRatio || 1, 2);
    this.renderScale = 1.0; // dynamic resolution multiplier on top of pixel ratio
    this.minRenderScale = 0.5;
    this.dynamicResolution = !this.shot && this.params.get('dynres') !== '0';
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
    if (this.isMobile && !Number.isFinite(forcedDpr)) this.maxPixelRatio = Math.min(this.maxPixelRatio, 1.75);
    /** Quality tier: 'low' | 'medium' | 'high' — scenes scale particle counts etc. */
    this.quality = this.params.get('quality') || (this.isMobile ? 'medium' : 'high');

    this.time = 0; // seconds of simulated time (deterministic in shot mode)
    this.frame = 0;
    this.dt = 1 / 60;
    this._last = performance.now();
    this._ftAccum = 0; this._ftCount = 0; this._dynTimer = 0;
    this.fps = 60;
    this.onFrame = null; // (dt, time) => void : update + render current scene
    this.paused = false;

    this.width = 1; this.height = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  get pixelRatio() { return this.maxPixelRatio * this.renderScale; }
  get aspect() { return this.width / this.height; }
  /** Size in device pixels of the HDR scene target. */
  get drawWidth() { return this.post.width; }
  get drawHeight() { return this.post.height; }

  resize() {
    const sw = parseInt(this.params.get('w')), sh = parseInt(this.params.get('h'));
    const w = this.shot && sw ? sw : window.innerWidth;
    const h = this.shot && sh ? sh : window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.floor(w * this.maxPixelRatio), Math.floor(h * this.maxPixelRatio), false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._applyScale();
    this._resizeListeners?.forEach((fn) => fn(w, h));
  }

  onResize(fn) { (this._resizeListeners ||= new Set()).add(fn); return () => this._resizeListeners.delete(fn); }

  _applyScale() {
    const pr = this.pixelRatio;
    this.post.setSize(this.width * pr, this.height * pr);
    // final output stays at native device resolution; FXAA when we are not supersampled enough, CAS when upscaling
    this.post.fxaa = this.maxPixelRatio * this.renderScale < 1.6;
    this.post.sharpen = this.renderScale < 0.95 ? 0.5 : 0.0;
  }

  _dynamicRes(frameMs) {
    if (!this.dynamicResolution) return;
    this._ftAccum += frameMs; this._ftCount++;
    this._dynTimer += frameMs;
    if (this._dynTimer < 900) return;
    const avg = this._ftAccum / this._ftCount;
    this._ftAccum = 0; this._ftCount = 0; this._dynTimer = 0;
    this.fps = 1000 / avg;
    let s = this.renderScale;
    if (avg > 22) s -= 0.12; // < ~45 fps
    else if (avg > 18.5) s -= 0.05;
    else if (avg < 14.5) s += 0.05; // > ~69 fps headroom
    s = Math.min(1, Math.max(this.minRenderScale, s));
    if (Math.abs(s - this.renderScale) > 0.001) { this.renderScale = s; this._applyScale(); }
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (this.shot) dt = 1 / 60; // deterministic stepping for screenshots
      dt = Math.min(dt, 1 / 15);
      if (this.paused) return;
      this.dt = dt;
      this.time += dt;
      this.frame++;
      this.renderer.info.reset();
      if (this.onFrame) this.onFrame(dt, this.time);
      this._dynamicRes(dt * 1000);
    };
    requestAnimationFrame(loop);
  }

  /** Render a scene/camera into the HDR target (helper for scenes without custom render()). */
  renderScene(scene, camera, target = this.post.sceneTarget) {
    const r = this.renderer;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
  }

  present() { this.post.render(this.time); }
}
