// HDR post-processing chain tuned for OLED: physically-based mip-chain bloom (CoD:AW 13-tap
// downsample + tent upsample), AgX/ACES/Neutral tone mapping, grading, vignette, film grain,
// chromatic aberration, warp/fade transitions, black-preserving dither, FXAA or CAS sharpening.
import * as THREE from 'three';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOWNSAMPLE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float kw(vec3 c) { return 1.0 / (1.0 + lum(c)); }
vec3 thresh(vec3 c) {
  if (uThreshold <= 0.0) return c;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / (4.0 * uKnee + 1e-5);
  return c * max(rq, br - uThreshold) / max(br, 1e-5);
}
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uKaris > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    col = thresh(col);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const UPSAMPLE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc; uniform vec2 uRadius; uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 r = uRadius;
  vec3 a = texture2D(tSrc, vUv + vec2(-r.x, r.y)).rgb, b = texture2D(tSrc, vUv + vec2(0.0, r.y)).rgb, c = texture2D(tSrc, vUv + vec2(r.x, r.y)).rgb;
  vec3 d = texture2D(tSrc, vUv + vec2(-r.x, 0.0)).rgb, e = texture2D(tSrc, vUv).rgb, f = texture2D(tSrc, vUv + vec2(r.x, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + vec2(-r.x, -r.y)).rgb, h = texture2D(tSrc, vUv + vec2(0.0, -r.y)).rgb, i = texture2D(tSrc, vUv + vec2(r.x, -r.y)).rgb;
  vec3 col = e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i);
  gl_FragColor = vec4(col * (uWeight / 16.0), 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform vec2 uResolution; uniform float uTime;
uniform float uExposure, uBloomStrength; uniform vec3 uBloomTint;
uniform int uToneMap;
uniform float uSaturation, uContrast, uTemperature;
uniform vec3 uLift, uGamma, uGain;
uniform float uVignette, uGrain, uChromatic;
uniform float uFade, uFlash, uZoomBlur; uniform vec3 uFadeColor;
uniform float uLetterbox;
varying vec2 vUv;

const mat3 LIN_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 LIN_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
vec3 agxContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 color) {
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = LIN_SRGB_TO_REC2020 * color;
  color = inset * color;
  color = max(color, 1e-10);
  color = clamp((log2(color) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LIN_REC2020_TO_SRGB * color;
  return clamp(color, 0.0, 1.0);
}
vec3 acesFit(vec3 v) {
  const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  v = i * v;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(o * (a / b), 0.0, 1.0);
}
vec3 neutral(vec3 color) {
  const float sc = 0.76, desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= off;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < sc) return color;
  float d = 1.0 - sc;
  float np = 1.0 - d * d / (peak + d - sc);
  color *= np / peak;
  float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(color, vec3(np), g);
}
vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 sampleHDR(vec2 uv) {
  vec2 dc = uv - 0.5;
  if (uChromatic > 0.0) {
    vec2 off = dc * dot(dc, dc) * uChromatic * 0.06;
    return vec3(texture2D(tScene, uv - off).r, texture2D(tScene, uv).g, texture2D(tScene, uv + off).b);
  }
  return texture2D(tScene, uv).rgb;
}

void main() {
  vec2 uv = vUv;
  vec3 col;
  if (uZoomBlur > 0.001) {
    vec2 dir = (uv - 0.5);
    float jit = h12(gl_FragCoord.xy + fract(uTime) * 91.0);
    col = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 24; i++) {
      float t = (float(i) + jit) / 24.0;
      float w = 1.0 - t * 0.6;
      vec2 suv = 0.5 + dir * (1.0 - uZoomBlur * t * 0.85);
      col += (texture2D(tScene, suv).rgb + texture2D(tBloom, suv).rgb * uBloomStrength * uBloomTint) * w; wsum += w;
    }
    col /= wsum;
  } else {
    col = sampleHDR(uv) + texture2D(tBloom, uv).rgb * uBloomStrength * uBloomTint;
  }
  col *= uExposure;
  // white balance (warm/cool) + saturation in scene-linear
  col *= vec3(1.0 + uTemperature * 0.10, 1.0, 1.0 - uTemperature * 0.10);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(L), col, uSaturation), 0.0);
  col = mix(col, vec3(1.0), uFlash);
  if (uToneMap == 1) col = acesFit(col);
  else if (uToneMap == 2) col = agx(col);
  else if (uToneMap == 3) col = neutral(col);
  else col = clamp(col, 0.0, 1.0);
  vec3 s = toSRGB(col);
  // contrast (pivot 0.5 in display space), lift/gamma/gain (CDL-like)
  s = clamp(mix(s, s * s * (3.0 - 2.0 * s), clamp(uContrast - 1.0, -1.0, 1.0)), 0.0, 1.0);
  s = pow(max(s * uGain + uLift * (1.0 - s), 0.0), 1.0 / max(uGamma, vec3(0.01)));
  // vignette
  vec2 vd = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float vig = smoothstep(1.25, 0.15, length(vd) * 1.1);
  s *= mix(1.0, vig, uVignette);
  // film grain (never lifts true black)
  float Ls = dot(s, vec3(0.299, 0.587, 0.114));
  float gn = h12(gl_FragCoord.xy * 0.97 + vec2(uTime * 37.0, uTime * 11.0)) - 0.5;
  s += gn * uGrain * smoothstep(0.0, 0.12, Ls) * (1.0 - Ls * 0.6);
  // fades
  s = mix(s, uFadeColor, uFade);
  // letterbox for cinematics
  if (uLetterbox > 0.0) { float bar = uLetterbox * 0.12; if (uv.y < bar || uv.y > 1.0 - bar) s = vec3(0.0); }
  // black-preserving triangular dither to kill banding on OLED gradients
  float dn = (h12(gl_FragCoord.xy + 0.37) + h12(gl_FragCoord.xy * 1.31 + 17.1) - 1.0) / 255.0;
  s += dn * step(0.0015, s);
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}
`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform int uMode; uniform float uSharpness;
varying vec2 vUv;
float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 fxaa(vec2 uv) {
  const float FXAA_REDUCE_MIN = 1.0 / 128.0, FXAA_REDUCE_MUL = 1.0 / 8.0, FXAA_SPAN_MAX = 8.0;
  vec3 rgbNW = texture2D(tSrc, uv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tSrc, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tSrc, uv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tSrc, uv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture2D(tSrc, uv).rgb;
  float lNW = lumaOf(rgbNW), lNE = lumaOf(rgbNE), lSW = lumaOf(rgbSW), lSE = lumaOf(rgbSE), lM = lumaOf(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX), dir * rcpDirMin)) * uTexel;
  vec3 rgbA = 0.5 * (texture2D(tSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tSrc, uv + dir * -0.5).rgb + texture2D(tSrc, uv + dir * 0.5).rgb);
  float lB = lumaOf(rgbB);
  return (lB < lMin || lB > lMax) ? rgbA : rgbB;
}
vec3 cas(vec2 uv) {
  vec3 a = texture2D(tSrc, uv + vec2(-1.0, -1.0) * uTexel).rgb, b = texture2D(tSrc, uv + vec2(0.0, -1.0) * uTexel).rgb, c = texture2D(tSrc, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 d = texture2D(tSrc, uv + vec2(-1.0, 0.0) * uTexel).rgb, e = texture2D(tSrc, uv).rgb, f = texture2D(tSrc, uv + vec2(1.0, 0.0) * uTexel).rgb;
  vec3 g = texture2D(tSrc, uv + vec2(-1.0, 1.0) * uTexel).rgb, h = texture2D(tSrc, uv + vec2(0.0, 1.0) * uTexel).rgb, i = texture2D(tSrc, uv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 mn = min(min(min(d, e), min(f, b)), h); vec3 mn2 = min(mn, min(min(a, c), min(g, i))); mn += mn2;
  vec3 mx = max(max(max(d, e), max(f, b)), h); vec3 mx2 = max(mx, max(max(a, c), max(g, i))); mx += mx2;
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, uSharpness));
  vec3 res = ((b + d + f + h) * w + e) / (1.0 + 4.0 * w);
  return mix(e, clamp(res, 0.0, 1.0), step(0.004, dot(e, vec3(1.0))));
}
void main() {
  vec3 c = uMode == 1 ? fxaa(vUv) : (uMode == 2 ? cas(vUv) : texture2D(tSrc, vUv).rgb);
  gl_FragColor = vec4(c, 1.0);
}
`;

export const DEFAULT_POST = Object.freeze({
  exposure: 1.0,
  bloomStrength: 0.08,
  bloomRadius: 1.0,
  bloomThreshold: 0.0,
  bloomTint: [1, 1, 1],
  toneMap: 'agx', // 'agx' | 'aces' | 'neutral' | 'none'
  saturation: 1.0,
  contrast: 1.0,
  temperature: 0.0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  vignette: 0.35,
  grain: 0.035,
  chromatic: 0.25,
});

const TONEMAPS = { none: 0, aces: 1, agx: 2, neutral: 3 };

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1; this.height = 1;
    this.samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    this.config = { ...DEFAULT_POST };
    this.fxaa = true;
    this.sharpen = 0.0;
    this.transition = { fade: 0, flash: 0, zoomBlur: 0, fadeColor: new THREE.Color(0, 0, 0), letterbox: 0 };

    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    depthTexture.format = THREE.DepthFormat;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      samples: this.samples, depthBuffer: true, depthTexture, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.ldrTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

    this.mips = [];
    this.mipCount = 7;
    for (let i = 0; i < this.mipCount; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }));
    }

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.downMat = mat(DOWNSAMPLE_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 }, uThreshold: { value: 0 }, uKnee: { value: 0.5 } });
    this.upMat = mat(UPSAMPLE_FRAG, { tSrc: { value: null }, uRadius: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true,
    });
    this.compositeMat = mat(COMPOSITE_FRAG, {
      tScene: { value: this.sceneTarget.texture }, tBloom: { value: null },
      uResolution: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uExposure: { value: 1 }, uBloomStrength: { value: 0.08 }, uBloomTint: { value: new THREE.Vector3(1, 1, 1) },
      uToneMap: { value: 2 }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uTemperature: { value: 0 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uVignette: { value: 0.35 }, uGrain: { value: 0.035 }, uChromatic: { value: 0.25 },
      uFade: { value: 0 }, uFlash: { value: 0 }, uZoomBlur: { value: 0 }, uFadeColor: { value: new THREE.Color(0, 0, 0) }, uLetterbox: { value: 0 },
    });
    this.finalMat = mat(FINAL_FRAG, { tSrc: { value: this.ldrTarget.texture }, uTexel: { value: new THREE.Vector2() }, uMode: { value: 1 }, uSharpness: { value: 0.4 } });
  }

  /** Merge a partial post config (scenes call this in enter()). */
  set(cfg = {}) { Object.assign(this.config, cfg); }
  reset(cfg = {}) { this.config = { ...DEFAULT_POST, ...cfg }; }

  setSize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.sceneTarget.setSize(w, h);
    this.ldrTarget.setSize(w, h);
    let mw = w, mh = h;
    for (const m of this.mips) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); m.setSize(mw, mh); }
  }

  _draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.camera);
  }

  /** Run bloom + composite + final AA, presenting to the canvas. */
  render(time) {
    const r = this.renderer;
    const cfg = this.config;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;

    // Bloom: downsample chain
    let src = this.sceneTarget.texture, sw = this.width, sh = this.height;
    const down = this.downMat.uniforms;
    for (let i = 0; i < this.mipCount; i++) {
      down.tSrc.value = src;
      down.uTexel.value.set(1 / sw, 1 / sh);
      down.uKaris.value = i === 0 ? 1 : 0;
      down.uThreshold.value = i === 0 ? cfg.bloomThreshold : 0;
      this._draw(this.downMat, this.mips[i]);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    // Upsample + accumulate (tent filter, additive)
    const up = this.upMat.uniforms;
    const aspect = this.width / this.height;
    for (let i = this.mipCount - 1; i > 0; i--) {
      up.tSrc.value = this.mips[i].texture;
      const rad = 0.0035 * cfg.bloomRadius;
      up.uRadius.value.set(rad / aspect, rad);
      up.uWeight.value = 1.0;
      this._draw(this.upMat, this.mips[i - 1]);
    }

    // Composite
    const u = this.compositeMat.uniforms;
    u.tBloom.value = this.mips[0].texture;
    u.uResolution.value.set(this.width, this.height);
    u.uTime.value = time;
    u.uExposure.value = cfg.exposure;
    u.uBloomStrength.value = cfg.bloomStrength / this.mipCount * 2.0;
    u.uBloomTint.value.set(...cfg.bloomTint);
    u.uToneMap.value = TONEMAPS[cfg.toneMap] ?? 2;
    u.uSaturation.value = cfg.saturation;
    u.uContrast.value = cfg.contrast;
    u.uTemperature.value = cfg.temperature;
    u.uLift.value.set(...cfg.lift);
    u.uGamma.value.set(...cfg.gamma);
    u.uGain.value.set(...cfg.gain);
    u.uVignette.value = cfg.vignette;
    u.uGrain.value = cfg.grain;
    u.uChromatic.value = cfg.chromatic;
    u.uFade.value = this.transition.fade;
    u.uFlash.value = this.transition.flash;
    u.uZoomBlur.value = this.transition.zoomBlur;
    u.uFadeColor.value.copy(this.transition.fadeColor);
    u.uLetterbox.value = this.transition.letterbox;

    const mode = this.fxaa ? 1 : (this.sharpen > 0 ? 2 : 0);
    if (mode === 0) {
      this._draw(this.compositeMat, null);
    } else {
      this._draw(this.compositeMat, this.ldrTarget);
      const f = this.finalMat.uniforms;
      f.uTexel.value.set(1 / this.width, 1 / this.height);
      f.uMode.value = mode;
      f.uSharpness.value = this.sharpen;
      this._draw(this.finalMat, null);
    }
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.sceneTarget.dispose(); this.ldrTarget.dispose();
    for (const m of this.mips) m.dispose();
    this.downMat.dispose(); this.upMat.dispose(); this.compositeMat.dispose(); this.finalMat.dispose();
  }
}
