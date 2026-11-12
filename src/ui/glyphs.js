// Input glyphs: turn a key label or an action name into the right glyph for the current device
// (keyboard key cap, gamepad face button in the pad's own family, or a touch "tap" mark).
import { ICONS, PS_SHAPES } from './icons.js';

// Mirrors the bindings in src/engine/Input.js (keyboard + standard gamepad mapping).
const ACTION_KEY = {
  forward: 'W', back: 'S', left: 'A', right: 'D', up: 'Space', down: 'C', jump: 'Space', sprint: 'Shift',
  interact: 'F', view: 'V', map: 'M', back_out: 'Esc', rollLeft: 'Q', rollRight: 'E', photo: 'P',
  timeFaster: ']', timeSlower: '[', toggleHud: 'H', next: 'N',
};
// Positional pad names: S/E/W/N = bottom/right/left/top face buttons.
const ACTION_PAD = {
  jump: 'S', up: 'S', back_out: 'E', down: 'E', interact: 'W', view: 'N', map: 'SELECT', sprint: 'LS',
  rollLeft: 'LB', rollRight: 'RB', throttle: 'RT', brake: 'LT',
};
const KEY_ALIASES = {
  ESCAPE: 'Esc', ESC: 'Esc', SPACE: 'Space', ' ': 'Space', SPACEBAR: 'Space', ENTER: 'Enter', RETURN: 'Enter',
  SHIFT: 'Shift', SHIFTLEFT: 'Shift', SHIFTRIGHT: 'Shift', CONTROL: 'Ctrl', CTRL: 'Ctrl', CONTROLLEFT: 'Ctrl',
  TAB: 'Tab', BACKSPACE: 'Backspace', ARROWUP: '↑', ARROWDOWN: '↓', ARROWLEFT: '←', ARROWRIGHT: '→',
  BRACKETLEFT: '[', BRACKETRIGHT: ']', MINUS: '−', EQUAL: '+',
};
const KEY_ACTION = {
  W: 'forward', S: 'back', A: 'left', D: 'right', Space: 'jump', C: 'down', Ctrl: 'down', Shift: 'sprint', F: 'interact',
  Enter: 'interact', V: 'view', M: 'map', Tab: 'map', Esc: 'back_out', Backspace: 'back_out', Q: 'rollLeft', E: 'rollRight',
  P: 'photo', ']': 'timeFaster', '[': 'timeSlower', H: 'toggleHud', N: 'next',
};

const FAMILY_LABELS = {
  xbox: { S: 'A', E: 'B', W: 'X', N: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', LS: 'LS', RS: 'RS', SELECT: 'View', START: 'Menu' },
  ps: { S: '', E: '', W: '', N: '', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', LS: 'L3', RS: 'R3', SELECT: 'Create', START: 'Options' },
  nintendo: { S: 'B', E: 'A', W: 'Y', N: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', LS: 'LS', RS: 'RS', SELECT: '−', START: '+' },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 'xbox' | 'ps' | 'nintendo' from a Gamepad id string. */
export function padFamily(gamepad) {
  const id = gamepad?.id || '';
  if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-?con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** Normalise a key label ('KeyF', 'f', 'Escape', 'Space') to its display form ('F', 'Esc', 'Space'). */
export function keyLabel(key) {
  if (!key) return '';
  let k = String(key);
  if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
  if (/^Digit\d$/.test(k)) k = k.slice(5);
  const up = k.toUpperCase();
  if (KEY_ALIASES[up]) return KEY_ALIASES[up];
  return k.length === 1 ? up : k;
}

/** Accepts an action name ('interact') or a key label ('F') and returns { action, key }. */
export function resolve(keyOrAction) {
  if (ACTION_KEY[keyOrAction]) return { action: keyOrAction, key: ACTION_KEY[keyOrAction] };
  const key = keyLabel(keyOrAction);
  return { action: KEY_ACTION[key] || null, key };
}

export function kbd(label) {
  const l = keyLabel(label);
  const wide = l.length > 1 ? ' wide' : '';
  return `<kbd class="tw-kc${wide}">${esc(l)}</kbd>`;
}

export function pad(pos, family = 'xbox') {
  const lab = FAMILY_LABELS[family]?.[pos] ?? pos;
  const face = pos.length === 1;
  if (face && family === 'ps') return `<span class="tw-pad face ps ps-${pos}" aria-label="${pos}">${PS_SHAPES[pos]}</span>`;
  return `<span class="tw-pad ${face ? 'face' : 'pill'} ${family} ${family}-${pos}">${esc(lab)}</span>`;
}

/** Glyph markup for a prompt: keyboard cap, gamepad button or touch tap mark. */
export function glyph(keyOrAction, device, family) {
  const { action, key } = resolve(keyOrAction);
  if (device === 'gamepad' && action && ACTION_PAD[action]) return pad(ACTION_PAD[action], family);
  if (device === 'touch') return `<span class="tw-tapglyph">${ICONS.tap}</span>`;
  return kbd(key);
}

export function padFor(action, family) { return ACTION_PAD[action] ? pad(ACTION_PAD[action], family) : ''; }
