// Line icons for THE WAY interface. 24×24 grid, stroke-only (stroke width is set in CSS so the
// same glyph can be a 1.25px hairline in the corner and a 1.6px stroke on a touch button).

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const DOT = (cx, cy, r = 0.9) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  sound: svg('<path d="M4.5 9.6v4.8h3.1L12 18V6L7.6 9.6H4.5z"/><path d="M15.4 9.3a3.9 3.9 0 0 1 0 5.4"/><path d="M17.9 6.9a7.3 7.3 0 0 1 0 10.2"/>'),
  mute: svg('<path d="M4.5 9.6v4.8h3.1L12 18V6L7.6 9.6H4.5z"/><path d="M16 9.6l4.8 4.8M20.8 9.6L16 14.4"/>'),
  full: svg('<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>'),
  unfull: svg('<path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5"/>'),
  photo: svg('<path d="M4.5 8.5V6.2c0-.9.8-1.7 1.7-1.7h2.3M15.5 4.5h2.3c.9 0 1.7.8 1.7 1.7v2.3M19.5 15.5v2.3c0 .9-.8 1.7-1.7 1.7h-2.3M8.5 19.5H6.2c-.9 0-1.7-.8-1.7-1.7v-2.3"/><circle cx="12" cy="12" r="3"/>'),
  help: svg(`<circle cx="12" cy="12" r="8.3"/><path d="M9.7 9.7a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1.1.9-1.1 1.6v.4"/>${DOT(12, 16.6, 0.8)}`),
  settings: svg('<path d="M4.5 8h8M17.5 8h2M4.5 16h2M11.5 16h8"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  chevron: svg('<path d="M10 7.5l4.5 4.5-4.5 4.5"/>'),
  chevronUp: svg('<path d="M7.5 14l4.5-4.5 4.5 4.5"/>'),
  headphones: svg('<path d="M4.5 15.5v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="4.5" y="14" width="3.6" height="5.6" rx="1.4"/><rect x="15.9" y="14" width="3.6" height="5.6" rx="1.4"/>'),
  // touch actions
  jump: svg('<path d="M12 18.5V6.5M7 11.5l5-5 5 5"/><path d="M7.5 20h9" opacity=".5"/>'),
  ascend: svg('<path d="M7 12.5l5-5 5 5M7 17.5l5-5 5 5"/>'),
  descend: svg('<path d="M7 6.5l5 5 5-5M7 11.5l5 5 5-5"/>'),
  interact: svg(`<circle cx="12" cy="12" r="6.5"/>${DOT(12, 12, 2)}`),
  view: svg('<path d="M4.5 8.5v-4h4M15.5 4.5h4v4M19.5 15.5v4h-4M8.5 19.5h-4v-4"/><circle cx="12" cy="10" r="2.2"/><path d="M8.3 16.2a4.2 4.2 0 0 1 7.4 0"/>'),
  sprint: svg('<path d="M6 7l5 5-5 5M12.5 7l5 5-5 5"/>'),
  boost: svg('<path d="M13.2 3.8L6.5 13h5l-1 7.2L17.5 11h-5l.7-7.2z"/>'),
  // gestures (help overlay, coach marks, prompts)
  tap: svg(`<circle cx="12" cy="12" r="6.8" opacity=".45"/>${DOT(12, 12, 2.4)}`),
  drag: svg(`${DOT(12, 12, 2.2)}<path d="M4.5 12h3M16.5 12h3M6.5 10l-2 2 2 2M17.5 10l2 2-2 2"/>`),
  pinch: svg(`${DOT(8.5, 15.5, 2)}${DOT(15.5, 8.5, 2)}<path d="M4.5 19.5l2-2M19.5 4.5l-2 2M4.5 17v2.5H7M17 4.5h2.5V7"/>`),
  stick: svg(`<circle cx="12" cy="12" r="7.5" opacity=".5"/><circle cx="12" cy="12" r="3.2"/>`),
  // devices
  mouse: svg('<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 7v3"/>'),
  scroll: svg('<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 6.5v4.5M10.6 8l1.4-1.5L13.4 8M10.6 9.5l1.4 1.5 1.4-1.5" opacity=".8"/>'),
  click: svg('<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M7 11h10M12 3.5V11"/><path d="M7.6 6.2A5 5 0 0 1 12 3.5V11H7z" fill="currentColor" stroke="none" opacity=".55"/>'),
  keyboard: svg(`<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M8 14.5h8"/>${DOT(7, 10, 0.75)}${DOT(10.3, 10, 0.75)}${DOT(13.7, 10, 0.75)}${DOT(17, 10, 0.75)}`),
  gamepad: svg(`<path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 3.6l.8 4.2a2.6 2.6 0 0 1-4.5 2.2L15.5 15.5h-7l-1.7 2a2.6 2.6 0 0 1-4.5-2.2l.8-4.2a4.5 4.5 0 0 1 4.4-3.6z"/><path d="M8 10v3M6.5 11.5h3"/>${DOT(15.5, 10.6, 0.8)}${DOT(17.3, 12.4, 0.8)}`),
  touch: svg('<rect x="6.5" y="3" width="11" height="18" rx="2.5"/><path d="M10.5 18h3"/>'),
};

// PlayStation face-button shapes (drawn, not font glyphs, so they stay crisp at 9px).
export const PS_SHAPES = {
  S: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6"/></svg>',
  E: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.1"/></svg>',
  W: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.2" y="3.2" width="5.6" height="5.6" rx=".3"/></svg>',
  N: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.9l3.3 5.6H2.7z"/></svg>',
};
