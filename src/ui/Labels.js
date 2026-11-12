// World-anchored labels: a crisp leader dot on the object, a diagonal hairline leader, then tracked
// caps. Layout is greedy and priority ordered (hot → normal → minor, then caller order). Each label
// tries four callout directions, keeping its previous one while it still fits (hysteresis), and must
// not overlap other labels' text, other leader dots or interface chrome. A label that cannot fit
// collapses to its dot and comes back once there is room, so the scene never turns into a word cloud.
//
// Per frame: no allocations except transform strings, which are only rebuilt when a value changes.
// Positions are snapped to device pixels so hairlines stay crisp on 2x/3x and 4K displays.

const CX = [1, -1, 1, -1];
const CY = [-1, -1, 1, 1];
const ANG = [-45, -135, 45, 135];
const D45 = Math.SQRT1_2;
// [normal, minor]: leader length, gap from anchor centre to leader start, gap leader → text, font px, tracking em, line box
const GEO = [
  { L: 12, r0: 4.5, gap: 4, font: 10, track: 0.16, h: 11 },
  { L: 7, r0: 3.5, gap: 3.5, font: 9, track: 0.14, h: 10 },
];
const LEAD_T = GEO.map((g) => ANG.map((a) => `rotate(${a}deg) translateX(${g.r0}px)`));
const PAD = 3;
const MAX_BOXES = 512;

export class LabelLayer {
  constructor(container) {
    this.el = container;
    this.pool = new Map();
    this.all = []; // every record ever created (index iteration — no iterator allocation)
    this.active = []; this.nActive = 0;
    this.boxes = new Float32Array(MAX_BOXES * 4); this.nBoxes = 0;
    this.obst = new Map(); // name -> { x0, y0, x1, y1 }
    this._obstList = [];
    this.stamp = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.mctx = document.createElement('canvas').getContext('2d');
    const remeasure = () => this.remeasure();
    document.fonts?.ready?.then(remeasure).catch(() => {});
    document.fonts?.addEventListener?.('loadingdone', remeasure);
  }

  /** Interface rect labels must avoid (in CSS px), or null to remove. */
  setObstacle(name, rect) {
    if (rect && rect.width > 0) this.obst.set(name, { x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom });
    else this.obst.delete(name);
    this._obstList = [...this.obst.values()];
  }

  _create(id) {
    const el = document.createElement('div');
    el.className = 'tw-lb';
    el.innerHTML = '<i class="d"></i><i class="l"></i><span class="t"></span>';
    const r = {
      id, el, dot: el.children[0], line: el.children[1], txt: el.children[2],
      text: null, upper: '', w: 0, size: 0, x: 0, y: 0, minor: false, hot: false, inO: 1, onClick: null,
      stamp: -1, pos: 0, wpos: -1, fit: 0, placed: false, tv: 0, ov: 0, vis: false, edge: 1,
      wx: NaN, wy: NaN, wo: -1, wt: -1, wHot: null, wMinor: null, wClick: null, shown: false,
    };
    el.style.display = 'none';
    el.addEventListener('click', (e) => { e.stopPropagation(); r.onClick?.(); });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && r.onClick) { e.preventDefault(); r.onClick(); }
    });
    this.el.appendChild(el);
    this.pool.set(id, r);
    this.all.push(r);
    return r;
  }

  _measure(r) {
    const g = GEO[r.minor ? 1 : 0];
    const m = this.mctx;
    m.font = `500 ${g.font}px Inter, system-ui, sans-serif`;
    const n = r.upper.length;
    r.w = Math.ceil(m.measureText(r.upper).width + Math.max(0, n - 1) * g.font * g.track);
    r.size = r.minor ? 1 : 0;
    r.wpos = -1; // force text re-placement write
  }

  remeasure() { for (let i = 0; i < this.all.length; i++) { const r = this.all[i]; if (r.text != null) this._measure(r); } }

  set(items) {
    const stamp = ++this.stamp;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.id == null) continue;
      const r = this.pool.get(it.id) || this._create(it.id);
      r.stamp = stamp;
      r.x = +it.x || 0; r.y = +it.y || 0;
      r.hot = !!it.hot;
      const minor = !!it.minor && !r.hot;
      r.inO = it.opacity == null ? 1 : Math.max(0, Math.min(1, +it.opacity));
      r.onClick = it.onClick || null;
      const text = it.text == null ? '' : String(it.text);
      if (r.text !== text || r.minor !== minor) {
        if (r.text !== text) { r.txt.textContent = text; r.text = text; r.upper = text.toUpperCase(); r.el.setAttribute('aria-label', text); }
        r.minor = minor;
        this._measure(r);
      }
      this.active[n++] = r;
    }
    this.nActive = n;
  }

  clear() {
    for (let i = 0; i < this.all.length; i++) this.all[i].el.remove();
    this.pool.clear(); this.all.length = 0; this.nActive = 0;
  }

  _hitsBoxes(x0, y0, x1, y1) {
    const b = this.boxes;
    for (let i = 0, n = this.nBoxes * 4; i < n; i += 4) if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return true;
    const o = this._obstList;
    for (let i = 0; i < o.length; i++) if (x0 < o[i].x1 && x1 > o[i].x0 && y0 < o[i].y1 && y1 > o[i].y0) return true;
    return false;
  }

  _hitsDots(self, x0, y0, x1, y1) {
    const a = this.active;
    for (let i = 0; i < this.nActive; i++) {
      const o = a[i];
      if (o === self || !o.vis) continue;
      if (o.x + 4 > x0 && o.x - 4 < x1 && o.y + 4 > y0 && o.y - 4 < y1) return true;
    }
    return false;
  }

  _box(r, c, out) {
    const g = GEO[r.size];
    const reach = (g.r0 + g.L) * D45;
    const ex = CX[c] * reach, ey = CY[c] * reach;
    const tx = CX[c] > 0 ? ex + g.gap : ex - g.gap - r.w;
    const ty = ey - g.h / 2;
    out[0] = tx; out[1] = ty;
    out[2] = r.x + tx - PAD; out[3] = r.y + ty - PAD; out[4] = r.x + tx + r.w + PAD; out[5] = r.y + ty + g.h + PAD;
  }

  _place(r, W, H) {
    const t = this._tmp || (this._tmp = new Float32Array(6));
    let chosen = -1;
    for (let k = -1; k < 4; k++) {
      const c = k < 0 ? r.pos : k;
      if (k >= 0 && c === r.pos) continue;
      this._box(r, c, t);
      if (t[2] < 4 || t[4] > W - 4 || t[3] < 4 || t[5] > H - 4) continue;
      if (this._hitsBoxes(t[2], t[3], t[4], t[5]) || this._hitsDots(r, t[2], t[3], t[4], t[5])) continue;
      chosen = c; break;
    }
    if (chosen < 0 && r.hot) chosen = r.pos; // hot labels always speak
    if (chosen >= 0) {
      r.fit++;
      // a label that was collapsed waits a few frames of room before it returns (no flicker)
      r.placed = r.hot || r.tv > 0.5 || r.fit > 4;
      if (r.placed) {
        r.pos = chosen;
        this._box(r, chosen, t);
        if (this.nBoxes < MAX_BOXES) { const b = this.boxes, i = this.nBoxes++ * 4; b[i] = t[2]; b[i + 1] = t[3]; b[i + 2] = t[4]; b[i + 3] = t[5]; }
      }
    } else { r.fit = 0; r.placed = false; }
  }

  update(dt, W, H) {
    const k = 1 - Math.exp(-dt * 10);
    const kt = 1 - Math.exp(-dt * 16);
    const stamp = this.stamp;
    const a = this.active, n = this.nActive;
    // 1. anchor visibility + edge fade
    for (let i = 0; i < n; i++) {
      const r = a[i];
      const e = Math.min(r.x, W - r.x, r.y, H - r.y);
      r.vis = e > -2 && r.inO > 0.01;
      r.edge = Math.max(0, Math.min(1, e / 40));
    }
    // 2. greedy placement by priority
    this.nBoxes = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        const r = a[i];
        if (!r.vis) { r.placed = false; r.fit = 0; continue; }
        const p = r.hot ? 0 : r.minor ? 2 : 1;
        if (p === pass) this._place(r, W, H);
      }
    }
    // 3. animate + write (every record: departed ones fade out, then leave the layout)
    const dpr = this.dpr;
    const all = this.all;
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      const alive = r.stamp === stamp && r.vis;
      const target = alive ? r.inO * r.edge : 0;
      if (!alive && !r.shown) continue;
      r.ov += (target - r.ov) * k;
      if (Math.abs(target - r.ov) < 0.004) r.ov = target;
      r.tv += ((alive && r.placed ? 1 : 0) - r.tv) * kt;
      if (r.tv < 0.004) r.tv = 0; else if (r.tv > 0.996) r.tv = 1;
      const el = r.el;
      if (r.ov <= 0 && !alive) { if (r.shown) { el.style.display = 'none'; r.shown = false; r.wo = -1; } continue; }
      if (!r.shown) { el.style.display = ''; r.shown = true; }
      const px = Math.round(r.x * dpr) / dpr, py = Math.round(r.y * dpr) / dpr;
      if (px !== r.wx || py !== r.wy) { el.style.transform = `translate3d(${px}px,${py}px,0)`; r.wx = px; r.wy = py; }
      if (Math.abs(r.ov - r.wo) > 0.008 || (r.ov !== r.wo && (r.ov === 0 || r.ov === target))) { el.style.opacity = r.ov; r.wo = r.ov; }
      if (r.pos !== r.wpos) {
        const t = this._tmp || (this._tmp = new Float32Array(6));
        this._box(r, r.pos, t);
        r.txt.style.transform = `translate(${t[0]}px,${t[1]}px)`;
        r.line.style.transform = LEAD_T[r.size][r.pos];
        r.wpos = r.pos;
      }
      if (Math.abs(r.tv - r.wt) > 0.01 || (r.tv !== r.wt && (r.tv === 0 || r.tv === 1))) {
        r.txt.style.opacity = r.tv; r.line.style.opacity = r.tv; r.wt = r.tv;
      }
      const interactive = r.tv > 0.5 && !!r.onClick;
      if (interactive !== r.wClick) {
        el.classList.toggle('click', interactive);
        el.tabIndex = interactive ? 0 : -1;
        if (interactive) el.setAttribute('role', 'button'); else el.removeAttribute('role');
        r.wClick = interactive;
      }
      if (r.hot !== r.wHot) { el.classList.toggle('hot', r.hot); r.wHot = r.hot; }
      if (r.minor !== r.wMinor) { el.classList.toggle('minor', r.minor); r.wMinor = r.minor; }
    }
  }
}
