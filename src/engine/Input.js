// Unified input: keyboard, mouse (pointer lock or drag-look), touch (dynamic stick + look pad + pinch),
// and gamepad. Scenes read normalized axes and edge-triggered actions; never raw DOM events.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['KeyC', 'ControlLeft'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyF', 'Enter'],
  view: ['KeyV'],
  map: ['KeyM', 'Tab'],
  back_out: ['Escape', 'Backspace'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  photo: ['KeyP'],
  timeFaster: ['BracketRight', 'Equal'],
  timeSlower: ['BracketLeft', 'Minus'],
  toggleHud: ['KeyH'],
  next: ['KeyN'],
};

// Standard gamepad mapping
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_ACTIONS = { jump: [PAD.A], up: [PAD.A], back_out: [PAD.B], interact: [PAD.X], view: [PAD.Y], map: [PAD.SELECT], sprint: [PAD.LS], rollLeft: [PAD.LB], rollRight: [PAD.RB], down: [PAD.B] };

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.lookDX = 0; this.lookDY = 0; // accumulated look deltas (pixels) this frame from any pointer source
    this.zoomDelta = 0; // accumulated zoom (wheel notches / pinch), + = zoom in
    this.pointerLocked = false;
    this.allowPointerLock = false; // set true by avatar/vehicle modes
    this.mode = 'orbit'; // 'orbit' | 'avatar' | 'vehicle' | 'cinematic'
    this.enabled = true;
    this.touchActive = false;
    this.lastDevice = 'mouse'; // 'mouse' | 'touch' | 'gamepad'
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 }; // left virtual stick (normalized -1..1)
    this.look = { active: false, id: -1, x: 0, y: 0 };
    this.pinch = { active: false, d: 0 };
    this._touches = new Map();
    this._tapHandlers = new Set();
    this._down = null; // pointer-down info for tap detection
    this.virtualButtons = new Set(); // actions held by on-screen buttons
    this._virtualPressed = new Set();
    this.gamepad = null;
    this._padPrev = [];
    this.sensitivity = 1.0;
    this.invertY = false;
    this._bind();
  }

  _bind() {
    const el = this.el;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this._pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'mouse';
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this._released.add(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.virtualButtons.clear(); });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // handled by touch events for multi-touch control
      this.lastDevice = 'mouse';
      this.mouse.buttons = e.buttons;
      this._down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (this.allowPointerLock && !this.pointerLocked && this.mode !== 'orbit' && el.requestPointerLock) {
        try { const p = el.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { el.requestPointerLock(); } catch (_) {} }); } catch (_) {}
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const m = this.mouse;
      m.x = e.clientX; m.y = e.clientY;
      m.nx = (e.clientX / window.innerWidth) * 2 - 1;
      m.ny = -(e.clientY / window.innerHeight) * 2 + 1;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (this.pointerLocked) { this.lookDX += dx; this.lookDY += dy; }
      else if (e.buttons & 3) { this.lookDX += dx; this.lookDY += dy; }
      m.dx += dx; m.dy += dy;
      if (this._down) this._down.moved += Math.abs(dx) + Math.abs(dy);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouse.buttons = e.buttons;
      if (this._down && this._down.moved < 6 && performance.now() - this._down.t < 450 && e.target === el) {
        this._emitTap(e.clientX, e.clientY, e.button);
      }
      this._down = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomDelta += -d / 100;
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === el; });

    // Touch: left half = dynamic movement stick (avatar/vehicle modes), right half = look; 2 fingers = pinch zoom.
    const opts = { passive: false };
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.lastDevice = 'touch'; this.touchActive = true;
      for (const t of e.changedTouches) {
        const info = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), moved: 0, role: 'look' };
        const leftSide = t.clientX < window.innerWidth * 0.42;
        if (this.mode !== 'orbit' && leftSide && !this.stick.active) {
          info.role = 'stick';
          Object.assign(this.stick, { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        } else if (!this.look.active) {
          info.role = 'look';
          Object.assign(this.look, { active: true, id: t.identifier, x: t.clientX, y: t.clientY });
        } else info.role = 'extra';
        this._touches.set(t.identifier, info);
      }
      this._updatePinch();
    }, opts);
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const info = this._touches.get(t.identifier);
        if (!info) continue;
        const dx = t.clientX - info.x, dy = t.clientY - info.y;
        info.moved += Math.abs(dx) + Math.abs(dy);
        info.x = t.clientX; info.y = t.clientY;
        if (info.role === 'stick') {
          const R = 56;
          let sx = (t.clientX - this.stick.ox) / R, sy = (t.clientY - this.stick.oy) / R;
          const len = Math.hypot(sx, sy);
          if (len > 1) { // drag the stick origin along so it never feels "stuck"
            this.stick.ox += (sx / len) * (len - 1) * R; this.stick.oy += (sy / len) * (len - 1) * R;
            sx /= len; sy /= len;
          }
          this.stick.x = sx; this.stick.y = sy;
        } else if (!this.pinch.active && info.role === 'look') {
          this.lookDX += dx * 1.6; this.lookDY += dy * 1.6;
        }
      }
      this._updatePinch(true);
    }, opts);
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const info = this._touches.get(t.identifier);
        if (!info) continue;
        if (info.role === 'stick') Object.assign(this.stick, { active: false, id: -1, x: 0, y: 0 });
        if (info.role === 'look') this.look.active = false;
        if (info.moved < 12 && performance.now() - info.t < 350 && !this.pinch.active && info.role !== 'stick') this._emitTap(t.clientX, t.clientY, 0);
        this._touches.delete(t.identifier);
      }
      if (this._touches.size < 2) this.pinch.active = false;
      if (this._touches.size === 0) { this.look.active = false; this.stick.active = false; this.stick.x = this.stick.y = 0; }
    };
    el.addEventListener('touchend', end, opts);
    el.addEventListener('touchcancel', end, opts);

    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
  }

  _updatePinch(moving = false) {
    const pts = [...this._touches.values()].filter((t) => t.role !== 'stick');
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinch.active && moving) this.zoomDelta += (d - this.pinch.d) / 60;
      this.pinch.active = true; this.pinch.d = d;
    }
  }

  _emitTap(x, y, button) {
    const nx = (x / window.innerWidth) * 2 - 1, ny = -(y / window.innerHeight) * 2 + 1;
    for (const fn of this._tapHandlers) fn({ x, y, nx, ny, button });
  }

  /** Subscribe to taps/clicks without drag. Returns unsubscribe fn. */
  onTap(fn) { this._tapHandlers.add(fn); return () => this._tapHandlers.delete(fn); }

  setMode(mode) {
    this.mode = mode;
    this.allowPointerLock = mode === 'avatar' || mode === 'vehicle';
    if (!this.allowPointerLock && this.pointerLocked) document.exitPointerLock?.();
    document.body.dataset.inputMode = mode;
  }

  releasePointer() { if (this.pointerLocked) document.exitPointerLock?.(); }

  _padButton(i) { const b = this.gamepad?.buttons?.[i]; return b ? (typeof b === 'object' ? b.value : b) : 0; }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) { this.gamepad = p; break; }
    if (!this.gamepad) return;
    const now = this.gamepad.buttons.map((b) => b.pressed);
    for (const [action, idxs] of Object.entries(PAD_ACTIONS)) {
      for (const i of idxs) if (now[i] && !this._padPrev[i]) { this._virtualPressed.add(action); this.lastDevice = 'gamepad'; }
    }
    this._padPrev = now;
    const ax = this.gamepad.axes;
    if (Math.abs(ax[2] || 0) > 0.15 || Math.abs(ax[3] || 0) > 0.15) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const curve = (v) => Math.sign(v) * v * v;
      this.lookDX += curve(dz(ax[2])) * 14; this.lookDY += curve(dz(ax[3])) * 10;
      this.lastDevice = 'gamepad';
    }
    const lt = this._padButton(PAD.LT), rt = this._padButton(PAD.RT);
    if (rt > 0.1 || lt > 0.1) this.lastDevice = 'gamepad';
  }

  /** Continuous action state (keyboard, gamepad, on-screen buttons). */
  down(action) {
    if (!this.enabled) return false;
    if (this.virtualButtons.has(action)) return true;
    const codes = BINDINGS[action];
    if (codes) for (const c of codes) if (this.keys.has(c)) return true;
    if (this.gamepad && PAD_ACTIONS[action]) for (const i of PAD_ACTIONS[action]) if (this._padButton(i) > 0.5) return true;
    return false;
  }

  /** Edge-triggered: true only on the frame the action began. */
  pressed(action) {
    if (!this.enabled) return false;
    if (this._virtualPressed.has(action)) return true;
    const codes = BINDINGS[action];
    if (codes) for (const c of codes) if (this._pressed.has(c)) return true;
    return false;
  }

  /** Called by on-screen buttons. */
  virtualPress(action) { this._virtualPressed.add(action); this.virtualButtons.add(action); }
  virtualRelease(action) { this.virtualButtons.delete(action); }

  /** Movement axes in [-1,1]: x = strafe right, y = forward. Merges keys, stick, gamepad. */
  move() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    if (this.stick.active) { x += this.stick.x; y += -this.stick.y; }
    if (this.gamepad) {
      const ax = this.gamepad.axes;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      x += dz(ax[0] || 0); y += -dz(ax[1] || 0);
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Analog triggers (gamepad) or keys for throttle/brake in [0,1]. */
  throttle() { return Math.max(this.down('forward') ? 1 : 0, this._padButton(PAD.RT)); }
  brake() { return Math.max(this.down('back') ? 1 : 0, this._padButton(PAD.LT)); }

  /** Look delta in pixels for this frame (consumed by endFrame). */
  lookDelta() {
    const s = this.sensitivity;
    return { x: this.lookDX * s, y: this.lookDY * s * (this.invertY ? -1 : 1) };
  }

  /** Zoom delta this frame (+ in). */
  zoom() { return this.zoomDelta; }

  /** Call once at end of each frame. */
  endFrame() {
    this._pressed.clear(); this._released.clear(); this._virtualPressed.clear();
    this.lookDX = 0; this.lookDY = 0; this.zoomDelta = 0;
    this.mouse.dx = 0; this.mouse.dy = 0;
  }
}
