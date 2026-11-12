// Shared GLSL for the star-system scene: cube-face addressing for bakes, analytic sphere helpers,
// soft eclipse shadows, Planck colour, and a compact single-scattering atmosphere (Rayleigh + Mie +
// ozone) that uses Schüler's Chapman approximation for the sun path so it costs one loop per pixel.
import { COMMON_GLSL, NOISE_GLSL } from '../../engine/glsl/noise.glsl.js';

export { COMMON_GLSL, NOISE_GLSL };

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.5, 1.0); }
`;

// GL cube-map convention (OpenGL spec §8.13): (s,t) of a face texel -> direction. Rendering into face
// N with a full-screen pass where vUv = gl_FragCoord/size reproduces exactly what textureCube(dir) reads.
export const CUBE_GLSL = /* glsl */ `
vec3 cubeFaceDir(int face, vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  vec3 d;
  if (face == 0) d = vec3(1.0, -c.y, -c.x);
  else if (face == 1) d = vec3(-1.0, -c.y, c.x);
  else if (face == 2) d = vec3(c.x, 1.0, c.y);
  else if (face == 3) d = vec3(c.x, -1.0, -c.y);
  else if (face == 4) d = vec3(c.x, -c.y, 1.0);
  else d = vec3(-c.x, -c.y, -1.0);
  return normalize(d);
}
// any orthonormal tangent basis (only used for finite differences, so discontinuities do not matter)
void tangentBasis(vec3 n, out vec3 t1, out vec3 t2) {
  vec3 a = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  t1 = normalize(cross(a, n));
  t2 = cross(n, t1);
}
`;

export const SPHERE_GLSL = /* glsl */ `
// returns (t0, t1); miss when t1 < t0
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// Fraction of a light disc (direction L, angular radius aL) visible from p past a sphere (c, r).
float sphereShadow(vec3 p, vec3 L, vec3 c, float r, float aL) {
  vec3 oc = c - p;
  float d = dot(oc, L);
  if (d <= 0.0) return 1.0;
  float len = length(oc);
  float aO = asin(min(r / max(len, 1e-5), 1.0));
  float sep = acos(clamp(d / len, -1.0, 1.0));
  float cover = smoothstep(aO + aL, max(abs(aO - aL), 1e-4), sep);
  float maxCover = min(1.0, (aO * aO) / max(aL * aL, 1e-8));
  return 1.0 - cover * maxCover;
}
`;

// Planck radiance ratio per channel (610/550/465 nm) relative to green at temperature T.
export const PLANCK_GLSL = /* glsl */ `
vec3 planck(float T) {
  const vec3 lam = vec3(0.610, 0.550, 0.465); // micrometres
  vec3 x = 14388.0 / (lam * T);
  vec3 l5 = lam * lam * lam * lam * lam;
  return 1.0 / (l5 * (exp(min(x, vec3(80.0))) - 1.0));
}
// Planck colour normalised to unit luminance
vec3 planckColor(float T) {
  vec3 p = planck(T);
  return p / max(dot(p, vec3(0.2126, 0.7152, 0.0722)), 1e-12);
}
`;

// Single scattering through an exponential atmosphere, planet radius = 1.
// Uniform names are shared by the planet surface shader and the halo shell.
export const ATMOS_GLSL = /* glsl */ `
uniform vec3 uBetaR;   // Rayleigh scattering per unit radius at ground
uniform vec3 uBetaO;   // ozone absorption (follows Rayleigh profile, weighted to mid-heights)
uniform float uBetaM;  // Mie scattering per unit radius at ground
uniform float uMieG;
uniform float uHR;     // scale heights (planet radii)
uniform float uHM;
uniform float uAtmTop; // top radius
uniform vec3 uAtmTint;
uniform float uAtmBoost;

float chapmanH(float X, float h, float cosZ) {
  float c = sqrt(X + h);
  if (cosZ >= 0.0) {
    return c / (c * cosZ + 1.0) * exp(-h);
  }
  float x0 = sqrt(max(1.0 - cosZ * cosZ, 0.0)) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp(min(X - x0, 60.0)) - c / (1.0 - c * cosZ) * exp(-h);
}

// extinction optical depth from point p (|p| >= 1) towards the sun along L
vec3 sunOpticalDepth(vec3 p, vec3 L) {
  float r = length(p);
  float cz = dot(p, L) / r;
  float alt = max(r - 1.0, 0.0);
  float dR = uHR * chapmanH(1.0 / uHR, alt / uHR, cz);
  float dM = uHM * chapmanH(1.0 / uHM, alt / uHM, cz);
  return (uBetaR + uBetaO) * dR + vec3(uBetaM * 1.11) * dM;
}

float phaseRayleigh(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float phaseMie(float mu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// in-scattered radiance (per unit sun irradiance) along ro + rd*t, t in [tMin, tMax]; trans = view transmittance
vec3 atmosphereScatter(vec3 ro, vec3 rd, float tMax, vec3 L, float jitter, int steps, out vec3 trans) {
  trans = vec3(1.0);
  vec2 ts = raySphere(ro, rd, uAtmTop);
  if (ts.y < ts.x || ts.y < 0.0) return vec3(0.0);
  float t0 = max(ts.x, 0.0);
  float t1 = min(ts.y, tMax);
  if (t1 <= t0) return vec3(0.0);
  float dt = (t1 - t0) / float(steps);
  vec3 odV = vec3(0.0);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * t;
    float alt = max(length(p) - 1.0, 0.0);
    float rhoR = exp(-alt / uHR) * dt;
    float rhoM = exp(-alt / uHM) * dt;
    vec3 seg = (uBetaR + uBetaO) * rhoR + vec3(uBetaM * 1.11) * rhoM;
    vec3 odS = sunOpticalDepth(p, L);
    vec3 T = exp(-(odV + seg * 0.5 + odS));
    sumR += T * rhoR;
    sumM += T * rhoM;
    odV += seg;
  }
  trans = exp(-odV);
  float mu = dot(rd, L);
  return (sumR * uBetaR * phaseRayleigh(mu) + sumM * uBetaM * phaseMie(mu, uMieG)) * uAtmTint * uAtmBoost;
}
`;

// Mikkelsen-style bump from a scalar height without tangents (surface gradient via derivatives).
export const BUMP_GLSL = /* glsl */ `
vec3 perturbNormal(vec3 pos, vec3 n, float h) {
  vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}
`;
