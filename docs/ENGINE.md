# THE WAY — Engine guide for contributors (humans and agents)

A playable, simulated universe in Three.js (r0.187, WebGL2). Cosmic web → galaxies → black holes →
star systems → living planets you can walk, ride and fly across. Vite build, no backend, no runtime
network assets (everything is procedural; Google Fonts in index.html is the only external request).

## Commands
- `npm run dev` — dev server. Jump straight to any scene with URL params, e.g. `/?scene=galaxy&id=0`.
- `npm run build` — production build into `dist/` (relative base, works from any static host).
- `node tools/shoot.mjs --query "scene=cosmos&t=30" --out shots/cosmos/a.png [--w 1280 --h 720 --frames 3 --interval 800]`
  Headless Chromium (SwiftShader software GL — slow but faithful) in deterministic *shot mode*. Prints
  page console errors/warnings (shader compile errors included). View PNGs with your image-reading tool.
- `node tools/shoot.mjs --batch tools/shots.json --outdir shots/all` — many shots, one server.

## Layout
```
src/main.js                 wiring: Engine, Input, HUD, AudioEngine, Director, scene registry
src/engine/Engine.js        WebGL2 renderer (reversed-Z depth when supported), loop, dynamic resolution
src/engine/PostFX.js        HDR → mip-chain bloom → AgX/ACES/Neutral → grade → vignette/grain/CA → dither → FXAA/CAS
src/engine/Director.js      lazy scenes, transitions ('fade'|'warp'|'dive'|'rise'|'none'), breadcrumb trail, OrbitRig
src/engine/Input.js         keyboard/mouse/pointer-lock/touch stick+look+pinch/gamepad → axes + actions
src/engine/Universe.js      deterministic data: galaxies, systems, planets, moons, PLANET_THEMES (art direction!)
src/engine/rng.js noise.js  seeded PRNG, hash, CPU simplex/fbm/ridged/worley
src/engine/glsl/noise.glsl.js  COMMON_GLSL (blackbody, ign dither, helpers) + NOISE_GLSL (simplex 3D/4D, fbm, ridged, curl, worley)
src/ui/HUD.js hud.css       minimal HUD API (below)
src/audio/AudioEngine.js    WebAudio contract; score in src/audio/score.js + moods
src/scenes/<scale>/         one directory per scale scene (cosmos, galaxy, blackhole, system, planet)
src/intro/                  cinematic intro + narrator
```

## Scene contract (see Director.js header)
```js
export default class MyScene {
  constructor(ctx, params) {}   // ctx: { engine, renderer, input, director, audio, hud, params, shot, quality, universe }
  async init() {}               // heavy setup; awaited behind a transition
  enter() {}                    // set ctx.engine.post.set({...}), ctx.input.setMode(...), HUD, ctx.audio.setMood(...)
  update(dt, time) {}           // simulate + camera. time = engine time (deterministic in shot mode)
  render(renderer, target) {}   // OPTIONAL: custom multi-pass render INTO `target` (HDR, MSAA). Else scene+camera rendered.
  scene; camera;                // used when render() is absent
  ready;                        // OPTIONAL Promise — shot mode waits for it before capturing
  breadcrumb = { label };       // HUD trail label
  onBack() { return false; }    // OPTIONAL: return true if Esc was consumed (exit vehicle, close card…)
  exit() {} dispose() {}        // free GPU resources, DOM, listeners, audio
}
```
Navigate with `ctx.director.go('system', { galaxy: 0, index: 0 }, { transition: 'warp' })`.
Registered names: `intro`, `cosmos`, `galaxy` {id}, `blackhole` {galaxy}, `system` {galaxy, index}, `planet` {id, view}.

## Rendering rules
- Output **linear HDR** into the scene target. Do NOT tone-map in materials. Bright things may exceed 1.0 — bloom loves it.
- Post config per scene: `ctx.engine.post.set({ exposure, bloomStrength, bloomRadius, bloomThreshold, bloomTint:[r,g,b], toneMap:'agx'|'aces'|'neutral', saturation, contrast, temperature, lift:[], gamma:[], gain:[], vignette, grain, chromatic })`.
- **OLED black**: empty space must be exactly black (0,0,0). Never add ambient floor color to the void. Grain/dither already preserve black.
- Depth: `engine.reversedDepth === true` on most desktop GPUs (EXT_clip_control): depth 1 = near, 0 = far, float depth. Huge
  near/far ratios are fine (e.g. near 0.05, far 1e9). Any shader that *reads* depth must handle both conventions.
- Colors: `new THREE.Color('#hex')` is converted to linear automatically (ColorManagement on). Canvas textures that hold
  colors need `texture.colorSpace = THREE.SRGBColorSpace`.
- Precision: keep geometry near the origin. For planet-scale worlds use the floating origin provided by the planet core.
- Mobile: check `ctx.quality` ('low'|'medium'|'high') and scale particle counts / steps. Target 60 fps desktop, 30+ phones.
- Picking: `ctx.input.onTap(({nx, ny}) => …)` gives NDC coords of a click/tap without drag. Unsubscribe in dispose().

## Shot mode (deterministic screenshots)
`?shot=1` (added by the harness): fixed dt = 1/60, HUD hidden (unless `ui=1`), `w/h` set the viewport.
`t=<seconds>` should fast-forward/seed your simulation time so a shot shows a mature state without
simulating minutes in software GL. Add any scene-specific params you need (camera vantage, view mode, etc.)
and document them at the top of your scene file. Resolve `this.ready` when the image is complete.

## HUD API (ctx.hud)
`setHint(text, seconds)`, `setPrompt(key, text, onClick)` / `setPrompt(null)`, `showCard({ title, subtitle, rows:[[k,v]], description, actions:[{label,onClick}] })` / `hideCard()`,
`toast(text)`, `setLabels([{ id, text, x, y, minor, hot, opacity, onClick }])` (CSS px; call every frame), `clearLabels()`,
`subtitle(text)`, `title(big, small)`, `setVisible(bool)`. Keep on-screen text tiny and rare — immersion first.

## Input API (ctx.input)
`setMode('orbit'|'avatar'|'vehicle'|'cinematic')`, `move()` → {x,y}, `lookDelta()` → {x,y} px, `zoom()`, `down(action)`,
`pressed(action)` (edge), `throttle()`, `brake()`, `onTap(fn)`. Actions: forward back left right up down jump sprint
interact view map back_out rollLeft rollRight photo timeFaster timeSlower next.

## Audio API (ctx.audio)
`setMood('cosmos'|'galaxy'|'blackhole'|'system'|'planet:<ambience>'|'intro'|'silence')`, `cue(name)`, `setParam(name, v)`.

## Ownership & workflow rules (parallel agents)
- Only edit files inside the directory you own. Shared engine files (`src/engine/*`, `src/main.js`, `index.html`, `src/ui/*`
  unless you own UI) belong to the lead: if you truly need a change there, keep a local workaround and describe the exact
  change in your final report.
- Do **not** run `git commit`/`git push`/`git checkout`/`git stash` — the lead integrates.
- Do not add npm dependencies. Three.js only (`three` + `three/examples/jsm/*` addons are fine).
- Verify visually with `tools/shoot.mjs`, save to `shots/<your-area>/` (git-ignored), and look at every image you make.
  Be your own harshest critic: compare against the best real-time games you know. Iterate until it is genuinely stunning.
- `npm run build` must pass before you report.
