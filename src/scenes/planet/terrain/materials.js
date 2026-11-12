// Baseline terrain + ocean materials: MeshStandardMaterial (so lights, shadows, IBL just work) with
// injected procedural albedo/normal logic. Attributes from the worker:
//   aTData  = (height m, moisture, temperature, rock-noise)     aDetail = wrap-safe local coords (m)
// Detail noise trick: aDetail = planetPos - anchor (anchor multiple of 4096 m). GLSL simplex has period
// 289, so noise(aDetail * 289.0*k/4096.0) is seamless across chunks for any integer k.
import * as THREE from 'three';
import { NOISE_GLSL, COMMON_GLSL } from '../../../engine/glsl/noise.glsl.js';

const DETAIL_F = 289.0 / 4096.0;

export function createTerrainMaterial(planet) {
  const P = planet.palette;
  const col = (h) => new THREE.Color(h);
  const uniforms = {
    uDeep: { value: col(P.deep) }, uShallow: { value: col(P.shallow) }, uBeach: { value: col(P.beach) },
    uLow: { value: col(P.low) }, uMid: { value: col(P.mid) }, uHigh: { value: col(P.high) },
    uRock: { value: col(P.rock) }, uCliff: { value: col(P.cliff) }, uSnow: { value: col(P.snow) }, uAccent: { value: col(P.accent) },
    uAmp: { value: planet.terrain ? planet.terrain.amplitude : 1 },
    uHasOcean: { value: planet.ocean && planet.terrain && planet.terrain.seaLevel >= 0 ? 1 : 0 },
    uLava: { value: planet.ocean?.lava ? 1 : 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTData; attribute vec3 aDetail; attribute float aSlope;
        varying vec4 vTData; varying vec3 vDetail; varying float vSlope;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTData = aTData; vDetail = aDetail; vSlope = aSlope;`);
    mat.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${COMMON_GLSL}
        ${NOISE_GLSL}
        uniform vec3 uDeep, uShallow, uBeach, uLow, uMid, uHigh, uRock, uCliff, uSnow, uAccent;
        uniform float uAmp, uHasOcean, uLava, uTime;
        varying vec4 vTData; varying vec3 vDetail; varying float vSlope;
        const float DF = ${DETAIL_F.toFixed(10)};
        vec3 terrainAlbedo(out float rough) {
          float h = vTData.x, moist = vTData.y, temp = vTData.z, rock = vTData.w;
          float hn = h / uAmp;
          float n1 = snoise(vDetail * DF * 2.0);
          float n2 = snoise(vDetail * DF * 16.0);
          float n3 = snoise(vDetail * DF * 128.0);
          float var = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
          vec3 c = mix(uLow, uMid, smoothstep(0.02, 0.22, hn + rock * 0.06 + n1 * 0.04));
          c = mix(c, uHigh, smoothstep(0.24, 0.5, hn + n1 * 0.05));
          c = mix(mix(c, uBeach, 0.45), c, smoothstep(0.18, 0.55, moist + n2 * 0.08));
          rough = 0.9;
          if (uHasOcean > 0.5) {
            float beach = 1.0 - smoothstep(1.5, 7.0, h + rock * 3.0 + n2 * 1.5);
            c = mix(c, uBeach, beach);
            rough = mix(rough, 0.55, beach * (1.0 - smoothstep(0.0, 1.5, h)));
            c = mix(c, mix(uBeach, uShallow, 0.35) * 0.8, 1.0 - smoothstep(-1.0, 0.2, h));
          }
          float sl = vSlope + rock * 0.06 + n2 * 0.05;
          float rockMask = smoothstep(0.22, 0.4, sl);
          vec3 rockC = mix(uRock, uCliff, smoothstep(0.45, 0.75, sl + n3 * 0.1));
          rockC *= 0.85 + 0.3 * (n3 * 0.5 + 0.5);
          c = mix(c, rockC, rockMask);
          float snow = smoothstep(0.26, 0.12, temp + rock * 0.05 + n1 * 0.04) * (1.0 - smoothstep(0.5, 0.72, sl));
          c = mix(c, uSnow, snow);
          rough = mix(rough, 0.55, snow);
          c *= 0.88 + 0.24 * (var * 0.5 + 0.5);
          return c;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tRough; diffuseColor.rgb = terrainAlbedo(tRough);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = tRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uLava > 0.5) { float hh = vTData.x; float lv = 1.0 - smoothstep(-2.0, 6.0, hh); float cr = smoothstep(0.82, 0.98, 1.0 - abs(snoise(vDetail * DF * 4.0))); totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * (lv * 6.0 + cr * smoothstep(0.0, 0.5, 1.0 - vSlope) * 2.0 * smoothstep(0.3, 0.0, vTData.x / uAmp)); }`);
  };
  mat.customProgramCacheKey = () => 'tw-terrain-v1';
  return mat;
}

export function createOceanMaterial(planet) {
  const O = planet.ocean;
  const uniforms = {
    uDeepC: { value: new THREE.Color(O.deep) }, uShallowC: { value: new THREE.Color(O.shallow) }, uFoamC: { value: new THREE.Color(O.foam) },
    uTime: { value: 0 }, uLava: { value: O.lava ? 1 : 0 }, uWaves: { value: O.waves || 1 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: O.lava ? 0.9 : 0.05, metalness: 0.0, transparent: !O.lava, depthWrite: true });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDepth; attribute vec3 aDetail; varying float vDepth; varying vec3 vDetail; varying vec3 vUpW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDepth = aDepth; vDetail = aDetail; vUpW = normalize(normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${COMMON_GLSL}
        ${NOISE_GLSL}
        uniform vec3 uDeepC, uShallowC, uFoamC; uniform float uTime, uLava, uWaves;
        varying float vDepth; varying vec3 vDetail; varying vec3 vUpW;
        const float DF = ${DETAIL_F.toFixed(10)};`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dep = max(vDepth, 0.0);
        vec3 wc = mix(uShallowC, uDeepC, 1.0 - exp(-dep / 28.0));
        float foam = (1.0 - smoothstep(0.0, 1.6, dep)) * (0.55 + 0.45 * snoise(vec3(vDetail.xy * DF * 64.0, uTime * 0.6)));
        wc = mix(wc, uFoamC, clamp(foam, 0.0, 1.0) * 0.8);
        diffuseColor.rgb = wc;
        diffuseColor.a = uLava > 0.5 ? 1.0 : mix(0.35, 0.96, smoothstep(0.0, 9.0, dep)) + foam * 0.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 p = vDetail * DF;
          float t = uTime;
          vec3 g = vec3(0.0);
          float e = 0.02;
          for (int i = 0; i < 3; i++) {
            float f = (i == 0 ? 24.0 : (i == 1 ? 96.0 : 384.0));
            vec3 q = p * f + vec3(t * 0.15 * (1.0 + float(i)), t * 0.11, -t * 0.13 * (1.0 + float(i)));
            float n0 = snoise(q);
            g += vec3(snoise(q + vec3(e, 0.0, 0.0)) - n0, snoise(q + vec3(0.0, e, 0.0)) - n0, snoise(q + vec3(0.0, 0.0, e)) - n0) / e / (1.0 + float(i) * 1.6);
          }
          vec3 upV = normalize((viewMatrix * vec4(vUpW, 0.0)).xyz);
          vec3 gV = (viewMatrix * vec4(g, 0.0)).xyz;
          gV -= upV * dot(gV, upV);
          normal = normalize(normal - gV * 0.035 * uWaves * (uLava > 0.5 ? 0.0 : 1.0));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uLava > 0.5) { float fl = 0.6 + 0.4 * snoise(vec3(vDetail.xz * DF * 6.0, uTime * 0.2)); float crust = smoothstep(0.1, 0.6, snoise(vDetail * DF * 20.0 + vec3(0.0, uTime * 0.05, 0.0))); totalEmissiveRadiance += mix(vec3(4.0, 0.9, 0.12), vec3(0.6, 0.08, 0.02), crust) * fl * 2.0; diffuseColor.rgb *= 0.15; }`);
  };
  mat.customProgramCacheKey = () => 'tw-ocean-v1';
  return mat;
}
