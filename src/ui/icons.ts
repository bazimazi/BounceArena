/**
 * A small hand-drawn icon set. 24x24, stroke based, coloured by `currentColor`, so icons inherit
 * text colour and need no image files.
 */
const ICONS: Record<string, string> = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke-linejoin="round"/>',
  home: '<path d="M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M5 9.5c4 2 10 2 14 0M5.5 15.5c4-2 9-2 13 0"/>',
  loadout: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10.5" r="1.3" fill="currentColor"/><circle cx="15" cy="10.5" r="1.3" fill="currentColor"/><path d="M8.5 15c2 1.6 5 1.6 7 0"/>',
  career: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 4M17 6h2.5a2.5 2.5 0 0 1-3 4M12 14v3M8.5 20h7M9.5 17h5v3h-5z"/>',
  collection: '<path d="M6 3.5h12l3 5-9 12-9-12z"/><path d="M3 8.5h18M9 3.5l3 17M15 3.5l-3 17"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path d="M12 7.5v9M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" stroke="#3a2200" stroke-width="1.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.7l6-.7z" fill="currentColor" stroke-linejoin="round"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-4 3.5-5.5 3.5-10 3 1.5 4.5 4 4.5 6.5 1-1 1.5-2 1.5-3.5 2 1.8 3.5 4.3 3.5 7 0 3.4-2.5 6-6.5 6z"/>',
  bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" fill="currentColor" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9.5" r="2.7"/><path d="M17 14.5c2.5 0 4.2 1.6 4.5 4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  map: '<ellipse cx="12" cy="13" rx="9" ry="5"/><path d="M3 13v2.5c0 2.8 4 5 9 5s9-2.2 9-5V13"/>',
  crown: '<path d="M3.5 8l4 4 4.5-7 4.5 7 4-4-1.5 10.5h-14z" stroke-linejoin="round"/>',
  swords: '<path d="M4 4l9.5 9.5M4 4h3.5L17 13.5M4 4v3.5l9.5 9.5M20 4l-6.5 6.5M20 4h-3.5M20 4v3.5M14.5 17.5l3-3 3 3-3 3zM9.5 17.5l-3-3-3 3 3 3z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.5-7.5 10-7.5 10z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>',
  sparkle: '<path d="M12 3c.8 4.5 2.5 6.2 7 7-4.5.8-6.2 2.5-7 7-.8-4.5-2.5-6.2-7-7 4.5-.8 6.2-2.5 7-7z" fill="currentColor" stroke-linejoin="round"/><path d="M19 15.5c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5z" fill="currentColor"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" stroke-linejoin="round"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  gamepad: '<path d="M7 7.5h10a4.5 4.5 0 0 1 4.4 5.4l-1 4.6a2.5 2.5 0 0 1-4.3 1.1L14 16.5h-4l-2.1 2.1a2.5 2.5 0 0 1-4.3-1.1l-1-4.6A4.5 4.5 0 0 1 7 7.5z"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="16" cy="11" r="1" fill="currentColor"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 4M17 6h2.5a2.5 2.5 0 0 1-3 4M12 14v3M8.5 20h7"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5L6 3.5h4l2 4 2-4h4l-2.5 7"/><path d="M12 12.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke-linejoin="round"/>',
  exit: '<path d="M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14"/><path d="M10 8l-4 4 4 4M6 12h9.5"/>',
  skin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17c-2.5-2.5-2.5-14.5 0-17z" fill="currentColor"/>',
  trail: '<circle cx="17" cy="12" r="4"/><path d="M13 10H3.5M13 14H6M12.5 12H2"/>',
  impact: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8"/>',
  chat: '<path d="M4 5.5h16v10H10l-5 4v-4H4z" stroke-linejoin="round"/>',
  flag: '<path d="M5 21V4M5 4.5h12l-2.5 4 2.5 4H5"/>',
  frame: '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  tag: '<path d="M3.5 12.5l8-8.5h8.5v8.5l-8.5 8z" stroke-linejoin="round"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor"/>',
  // Abilities.
  shockwave: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4.5a10.5 10.5 0 0 0 0 15M20 4.5a10.5 10.5 0 0 1 0 15"/>',
  magnet: '<path d="M5.5 4v8a6.5 6.5 0 0 0 13 0V4h-4v8a2.5 2.5 0 0 1-5 0V4z" stroke-linejoin="round"/><path d="M5.5 8h4M14.5 8h4"/>',
  phase: '<path d="M6 20V11a6 6 0 0 1 12 0v9l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z" stroke-dasharray="2.5 2" stroke-linejoin="round"/><circle cx="9.8" cy="11" r="1.1" fill="currentColor"/><circle cx="14.2" cy="11" r="1.1" fill="currentColor"/>',
  overdrive: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13.5M7.5 10.5h9M4 13.5c0 4 3.5 7 8 7s8-3 8-7"/><path d="M2.5 15l1.5-1.5 1.5 1.5M18.5 15l1.5-1.5 1.5 1.5"/>',
  repulse: '<circle cx="5.5" cy="12" r="2.5" fill="currentColor"/><path d="M10 7.5l9-3.5v16l-9-3.5"/><path d="M12.5 10.5l4-1M12.5 13.5l4 1"/>',
  blink: '<circle cx="5" cy="12" r="2" stroke-dasharray="2 2"/><circle cx="18" cy="12" r="3.5" fill="currentColor"/><path d="M8.5 12h1.5M12 12h1.5" stroke-width="2.4"/>',
  'gravity-well': '<path d="M12 12m-1.5 0a1.5 1.5 0 1 0 3 0 3.5 3.5 0 1 0-7 0 5.5 5.5 0 1 0 11 0 7.5 7.5 0 1 0-15 0"/>',
  mirror: '<path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z" stroke-linejoin="round"/><path d="M9 9l6 6M15 9l-1.5 1.5"/>',
  split: '<circle cx="8" cy="13" r="5"/><circle cx="17" cy="9" r="3.5" stroke-dasharray="2 1.8"/>',
  // Cores and shells.
  stable: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
  heavy: '<path d="M8 8.5a4 4 0 0 1 8 0"/><path d="M5 8.5h14l2 11.5H3z" stroke-linejoin="round"/>',
  light: '<path d="M12 3c4 4 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8 7 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>',
  elastic: '<path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
  aggressive: '<path d="M12 2.5l3 6.5 6.5.8-5 4.4 1.5 6.8L12 17.5 6 21l1.5-6.8-5-4.4 6.5-.8z" stroke-linejoin="round"/>',
  rubber: '<ellipse cx="12" cy="14" rx="8" ry="5.5"/><path d="M12 3v5M9 5.5l3 2.5 3-2.5"/>',
  armored: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M12 7v10M8 10.5h8"/>',
  spiked: '<path d="M12 2l2 4.5 4.5-2-1.5 4.5 4.5 2-4.5 2 1.5 4.5-4.5-2-2 4.5-2-4.5-4.5 2 1.5-4.5-4.5-2 4.5-2L5.5 4.5l4.5 2z" stroke-linejoin="round"/>',
  magnetic: '<path d="M5.5 4v8a6.5 6.5 0 0 0 13 0V4h-4v8a2.5 2.5 0 0 1-5 0V4z" stroke-linejoin="round"/>',
  reactive: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>',
  // Passives.
  'second-wind': '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>',
  'edge-guard': '<path d="M3 20h18M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/>',
  'dash-refund': '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" stroke-linejoin="round"/><path d="M20 4.5a4 4 0 0 1 0 5"/>',
  'momentum-bank': '<path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 18l4.5-6"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/>',
  'heavy-hitter': '<path d="M6 10.5V7a2 2 0 0 1 4 0v3.5M10 9V5.5a2 2 0 0 1 4 0V9M14 9.5V7a2 2 0 0 1 4 0v6c0 4.5-3 7.5-7 7.5S4.5 18 4.5 14v-3.5a1.5 1.5 0 0 1 3 0V12"/>',
  glider: '<path d="M2.5 13L21.5 5 14 20l-3-6.5z" stroke-linejoin="round"/><path d="M11 13.5L21.5 5"/>',
  none: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
}

/** An inline SVG icon wrapped in an `<i class="ico">`. Unknown names render a dot. */
export function icon(name: string, className = ''): HTMLElement {
  const wrap = document.createElement('i')
  wrap.className = `ico${className ? ` ${className}` : ''}`
  wrap.setAttribute('aria-hidden', 'true')
  const body = ICONS[name] ?? '<circle cx="12" cy="12" r="3" fill="currentColor"/>'
  wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${body}</svg>`
  return wrap
}

export const MODE_ICON: Record<string, string> = {
  ffa: 'ball',
  team: 'shield',
  score: 'target',
  king: 'crown',
  survivor: 'heart',
  chaos: 'dice',
  duel: 'swords',
  practice: 'flag',
  tutorial: 'sparkle',
}
