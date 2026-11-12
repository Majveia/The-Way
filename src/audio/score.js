// Placeholder score: a soft drone so the pipeline is audible. Replaced by the full generative score.
export function installScore(audio) {
  audio.registerMood('default', (a) => {
    const c = a.ctx, out = c.createGain();
    out.gain.value = 0; out.connect(a.bus); out.connect(a.reverbSend);
    const oscs = [55, 82.5, 110, 164.8].map((f, i) => { const o = c.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; const g = c.createGain(); g.gain.value = 0.05 / (i + 1); o.connect(g).connect(out); o.start(); return o; });
    out.gain.setTargetAtTime(0.5, c.currentTime, 2.5);
    return { stop(f = 3) { out.gain.setTargetAtTime(0, c.currentTime, f / 3); setTimeout(() => oscs.forEach((o) => o.stop()), f * 1500); } };
  });
}
