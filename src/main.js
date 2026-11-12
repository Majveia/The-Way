// THE WAY — entry point. Wires engine, input, HUD, audio and the scene director together.
import './ui/hud.css';
import { Engine } from './engine/Engine.js';
import { Input } from './engine/Input.js';
import { Director } from './engine/Director.js';
import { HUD } from './ui/HUD.js';
import { AudioEngine } from './audio/AudioEngine.js';
import Universe from './engine/Universe.js';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
const canvas = document.getElementById('view');
const engine = new Engine(canvas, { params, shot });
const input = new Input(canvas);
const audio = new AudioEngine();
const ctx = { engine, renderer: engine.renderer, input, audio, params, shot, quality: engine.quality, universe: Universe };
const hud = new HUD(document.getElementById('hud'), ctx);
ctx.hud = hud;
const director = new Director(ctx);
ctx.director = director;
window.__THE_WAY = ctx; // handy for debugging & the screenshot harness

director.register('intro', () => import('./intro/IntroScene.js'));
director.register('cosmos', () => import('./scenes/cosmos/CosmosScene.js'));
director.register('galaxy', () => import('./scenes/galaxy/GalaxyScene.js'));
director.register('blackhole', () => import('./scenes/blackhole/BlackHoleScene.js'));
director.register('system', () => import('./scenes/system/SystemScene.js'));
director.register('planet', () => import('./scenes/planet/PlanetScene.js'));

// Audio score (moods + cues) loads lazily; failure must never block visuals.
import('./audio/score.js').then((m) => m.installScore?.(audio)).catch(() => {});

director.onChange((cur, trail) => hud.setTrail(trail));

engine.onFrame = (dt, t) => {
  input.pollGamepad();
  globalKeys();
  director.update(dt, t);
  hud.update(dt);
  audio.update(dt);
  input.endFrame();
};

function globalKeys() {
  if (input.pressed('back_out')) {
    const cur = director.current;
    if (cur?.inst?.onBack?.()) return; // scene consumed it (e.g. exit vehicle, close card)
    director.back();
  }
  if (input.pressed('photo')) hud.togglePhoto();
  if (input.pressed('toggleHud')) hud.toggleHelp();
}

// Scene params from the URL: ?scene=planet&id=0:0:3&view=surface …
const sceneParams = Object.fromEntries(params.entries());
const startScene = params.get('scene');
const gate = document.getElementById('gate');

async function begin(skipIntro) {
  gate.classList.add('gone');
  audio.unlock();
  if (document.documentElement.requestFullscreen && engine.isMobile) document.documentElement.requestFullscreen().catch(() => {});
  if (skipIntro) {
    await director.go('cosmos', {}, { transition: 'fade', duration: 2.0 });
  } else {
    await director.go('intro', {}, { transition: 'none' });
  }
}

engine.start();

if (startScene) {
  gate.classList.add('gone');
  if (!shot) audio.unlock().catch(() => {});
  director.go(startScene, sceneParams, { transition: 'none' }).then(() => shotReady());
} else if (shot) {
  gate.classList.add('gone');
  director.go('intro', sceneParams, { transition: 'none' }).then(() => shotReady());
} else {
  gate.addEventListener('click', (e) => { if (e.target.dataset.skip) return; begin(false); });
  gate.querySelector('[data-skip]')?.addEventListener('click', (e) => { e.stopPropagation(); begin(true); });
  window.addEventListener('keydown', function k(e) { if (!gate.classList.contains('gone')) { if (e.code === 'Escape') begin(true); else if (e.code === 'Enter' || e.code === 'Space') begin(false); } });
}

// Screenshot harness support: resolve when the scene says it's ready, then let N frames settle.
async function shotReady() {
  if (!shot) return;
  hud.setVisible(params.get('ui') === '1');
  const inst = director.current?.inst;
  try { if (inst?.ready) await Promise.race([inst.ready, new Promise((r) => setTimeout(r, 120000))]); } catch (e) { console.error(e); }
  const warm = parseInt(params.get('warm') || '24');
  const start = engine.frame;
  await new Promise((resolve) => { const tick = () => (engine.frame - start >= warm ? resolve() : requestAnimationFrame(tick)); tick(); });
  window.__THE_WAY_READY = true;
}
