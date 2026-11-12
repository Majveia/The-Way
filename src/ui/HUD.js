// Minimal, unobtrusive HUD: breadcrumb trail, contextual prompt, info card, world labels,
// subtitles/title cards for cinematics, toasts, and touch controls. Fades away when idle.

const ICONS = {
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><circle cx="12" cy="17" r=".6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>',
  view: '<svg viewBox="0 0 24 24"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><circle cx="12" cy="12" r="3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
};

export class HUD {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.visible = true;
    this._labelPool = new Map();
    this._hintTimer = 0;
    this._toastTimer = 0;
    this._idle = 0;
    root.innerHTML = `
      <div class="tw-trail"><span class="mark">THE WAY</span><span class="crumbs"></span></div>
      <div class="tw-corner">
        <button class="tw-icon" data-act="sound" title="Sound">${ICONS.sound}</button>
        <button class="tw-icon" data-act="photo" title="Hide interface (P)">${ICONS.eye}</button>
        <button class="tw-icon" data-act="full" title="Fullscreen">${ICONS.full}</button>
        <button class="tw-icon" data-act="help" title="Controls (?)">${ICONS.help}</button>
      </div>
      <div class="tw-labels"></div>
      <div class="tw-subtitle"></div>
      <div class="tw-title"><div class="big"></div><div class="small"></div></div>
      <div class="tw-prompt interactive"><span class="tw-key"></span><span class="txt"></span></div>
      <div class="tw-hint"></div>
      <div class="tw-card interactive"><h2></h2><div class="sub"></div><div class="rows"></div><div class="desc"></div><div class="actions"></div></div>
      <div class="tw-toast"></div>
      <div class="tw-touch">
        <div class="tw-stick avatar-only"><div class="knob"></div></div>
        <div class="tw-tbtns avatar-only">
          <button class="tw-tbtn" data-hold="interact">${ICONS.hand}</button>
          <button class="tw-tbtn" data-hold="jump">${ICONS.up}</button>
          <button class="tw-tbtn" data-hold="view">${ICONS.view}</button>
          <button class="tw-tbtn" data-hold="sprint">${ICONS.boost}</button>
        </div>
      </div>
      <div class="tw-help interactive"><div class="panel"><h3>Controls</h3><div class="grid">
        <div><span class="tw-key">Drag</span></div><div>Look / orbit</div>
        <div><span class="tw-key">Wheel</span></div><div>Zoom</div>
        <div><span class="tw-key">Click</span></div><div>Select · travel</div>
        <div><span class="tw-key">W A S D</span></div><div>Move · fly</div>
        <div><span class="tw-key">Shift</span></div><div>Sprint · boost</div>
        <div><span class="tw-key">Space</span></div><div>Jump · ascend</div>
        <div><span class="tw-key">F</span></div><div>Interact · enter vehicle · land</div>
        <div><span class="tw-key">V</span></div><div>First / third person</div>
        <div><span class="tw-key">Esc</span></div><div>Back out a level</div>
        <div><span class="tw-key">P</span></div><div>Photo mode</div>
        <div><span class="tw-key">[ ]</span></div><div>Time speed</div>
      </div></div></div>
    `;
    this.$ = (s) => root.querySelector(s);
    this.crumbs = this.$('.crumbs');
    this.hintEl = this.$('.tw-hint');
    this.promptEl = this.$('.tw-prompt');
    this.cardEl = this.$('.tw-card');
    this.toastEl = this.$('.tw-toast');
    this.labelsEl = this.$('.tw-labels');
    this.subEl = this.$('.tw-subtitle');
    this.titleEl = this.$('.tw-title');
    this.helpEl = this.$('.tw-help');
    this.stickEl = this.$('.tw-stick');
    this.knobEl = this.$('.tw-stick .knob');
    this._promptAction = null;

    root.querySelectorAll('.tw-icon').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this._corner(b.dataset.act, b); }));
    this.promptEl.addEventListener('click', () => this._promptAction?.());
    this.helpEl.addEventListener('click', () => this.helpEl.classList.remove('show'));
    root.querySelectorAll('[data-hold]').forEach((b) => {
      const act = b.dataset.hold;
      const on = (e) => { e.preventDefault(); e.stopPropagation(); ctx.input.virtualPress(act); b.classList.add('on'); };
      const off = (e) => { e.preventDefault(); ctx.input.virtualRelease(act); b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
    });
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
  }

  _corner(act, btn) {
    const ctx = this.ctx;
    if (act === 'sound') { const muted = ctx.audio?.toggleMute?.(); btn.innerHTML = muted ? ICONS.mute : ICONS.sound; }
    else if (act === 'photo') this.togglePhoto();
    else if (act === 'full') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); }
    else if (act === 'help') this.helpEl.classList.toggle('show');
  }

  togglePhoto() { this.visible = !this.visible; this.root.classList.toggle('hidden', !this.visible); }
  setVisible(v) { this.visible = v; this.root.classList.toggle('hidden', !v); }
  toggleHelp() { this.helpEl.classList.toggle('show'); }

  /** trail: [{ name, params, label }] */
  setTrail(trail) {
    this.crumbs.innerHTML = '';
    trail.forEach((t, i) => {
      if (i > 0) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; this.crumbs.appendChild(s); }
      const c = document.createElement('span');
      c.className = 'crumb' + (i === trail.length - 1 ? ' current' : '');
      c.textContent = t.label;
      if (i < trail.length - 1) c.addEventListener('click', () => this.ctx.director.go(t.name, t.params, { transition: 'rise' }));
      this.crumbs.appendChild(c);
    });
  }

  setHint(text, seconds = 7) {
    this.hintEl.textContent = text || '';
    this.hintEl.style.opacity = text ? '1' : '0';
    this._hintTimer = text ? seconds : 0;
  }

  /** Contextual action prompt, e.g. setPrompt('F', 'Land on Elaria', () => ...). Pass null to hide. */
  setPrompt(key, text, action) {
    if (!key) { this.promptEl.classList.remove('show'); this._promptAction = null; return; }
    this.promptEl.querySelector('.tw-key').textContent = key;
    this.promptEl.querySelector('.txt').textContent = text;
    this.promptEl.classList.add('show');
    this._promptAction = action || null;
  }

  /** info: { title, subtitle, rows: [[k, v]], description, actions: [{ label, onClick }] } or null */
  showCard(info) {
    if (!info) { this.cardEl.classList.remove('show'); return; }
    const c = this.cardEl;
    c.querySelector('h2').textContent = info.title || '';
    c.querySelector('.sub').textContent = info.subtitle || '';
    c.querySelector('.rows').innerHTML = (info.rows || []).map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
    c.querySelector('.desc').textContent = info.description || '';
    const actions = c.querySelector('.actions');
    actions.innerHTML = '';
    (info.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'tw-btn'; b.textContent = a.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
      actions.appendChild(b);
    });
    c.classList.add('show');
  }
  hideCard() { this.cardEl.classList.remove('show'); }

  toast(text, seconds = 2.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this._toastTimer = seconds;
  }

  /**
   * World-space labels. items: [{ id, text, x, y (CSS px), minor?, hot?, onClick? }]. Items not listed are hidden.
   */
  setLabels(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let el = this._labelPool.get(it.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tw-label';
        el.addEventListener('click', (e) => { e.stopPropagation(); el._onClick?.(); });
        this.labelsEl.appendChild(el);
        this._labelPool.set(it.id, el);
      }
      if (el._text !== it.text) { el.textContent = it.text; el._text = it.text; }
      el._onClick = it.onClick;
      el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) translate(-50%, -6px)`;
      el.classList.toggle('minor', !!it.minor);
      el.classList.toggle('hot', !!it.hot);
      el.style.opacity = it.opacity ?? 1;
      el.style.display = '';
    }
    for (const [id, el] of this._labelPool) if (!seen.has(id)) el.style.display = 'none';
  }
  clearLabels() { for (const el of this._labelPool.values()) el.remove(); this._labelPool.clear(); }

  subtitle(text) { if (!text) { this.subEl.classList.remove('show'); return; } this.subEl.textContent = text; this.subEl.classList.add('show'); }
  title(big, small) {
    if (!big) { this.titleEl.classList.remove('show'); return; }
    this.titleEl.querySelector('.big').textContent = big;
    this.titleEl.querySelector('.small').textContent = small || '';
    this.titleEl.classList.add('show');
  }

  update(dt) {
    if (this._hintTimer > 0) { this._hintTimer -= dt; if (this._hintTimer <= 0) this.hintEl.style.opacity = '0'; }
    if (this._toastTimer > 0) { this._toastTimer -= dt; if (this._toastTimer <= 0) this.toastEl.classList.remove('show'); }
    const st = this.ctx.input.stick;
    if (st.active) {
      this.stickEl.classList.add('show');
      this.stickEl.style.left = st.ox + 'px'; this.stickEl.style.top = st.oy + 'px';
      this.knobEl.style.transform = `translate(${st.x * 36}px, ${st.y * 36}px)`;
    } else this.stickEl.classList.remove('show');
  }
}
