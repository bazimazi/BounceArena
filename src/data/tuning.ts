/**
 * Gameplay tuning lives here so feel can change without rewriting systems.
 * Speed creates power: a slow ball is controllable and weak, a fast ball hits harder and turns worse.
 */
export const TUNE = {
  accel: 540,
  brake: 7.2,
  coast: 0.72,
  turnLow: 7.6,
  turnHigh: 2.35,
  maxSpeed: 680,
  momentumRef: 700,
  dashSpeed: 690,
  dashBlend: 0.38,
  dashWindow: 0.18,
  dashCooldown: 2.55,
  perfectDashWindow: 0.1,
  perfectDashRefund: 0.4,
  perfectDashBoost: 1.08,
  bouncePeriod: 0.5,
  bounceAmp: 20,
  landingBurst: 78,
  coyote: 0.2,
  fallGravity: 1680,
  fallKill: -32,
  spawnInvuln: 1.35,
  respawnDelay: 0.8,
  hitCreditWindow: 3.4,
  strikeRatio: 1.18,
  glanceAngle: 0.3,
  strikeRetain: 0.82,
  dashStrikeMul: 1.42,
  dashRetain: 0.9,
  abilityCooldown: 7.6,
  finalLead: 18,
  suddenTime: 16,
  celebrate: 1.25,
  pxPerMeter: 40,
  substeps: 2,
  friendlyBump: 0.28,
  edgeWarn: 86,
} as const

export interface CoreDef {
  id: string
  name: string
  blurb: string
  mass: number
  accel: number
  radius: number
  maxSpeed: number
  outgoing: number
  incoming: number
  turn: number
  dash: number
  dashCd: number
  restitution: number
}

export interface ShellDef {
  id: string
  name: string
  blurb: string
  restitution: number
  period: number
  land: number
  incoming: number
  outgoing: number
  mass: number
  dashCd: number
  magnet: number
  reactive: boolean
}

export interface PassiveDef {
  id: string
  name: string
  blurb: string
}

export interface AbilityDef {
  id: string
  name: string
  blurb: string
  cooldown: number
  key: string
}

export const CORES: CoreDef[] = [
  {
    id: 'stable',
    name: 'Stable',
    blurb: 'Balanced mass, accel, and control. The competitive baseline.',
    mass: 1,
    accel: 1,
    radius: 22,
    maxSpeed: 1,
    outgoing: 1,
    incoming: 1,
    turn: 1,
    dash: 1,
    dashCd: 1,
    restitution: 1,
  },
  {
    id: 'heavy',
    name: 'Heavy',
    blurb: 'You launch people and hate being moved. Turning at speed is a commitment.',
    mass: 1.36,
    accel: 0.84,
    radius: 26,
    maxSpeed: 0.92,
    outgoing: 1.14,
    incoming: 0.76,
    turn: 0.88,
    dash: 0.94,
    dashCd: 1.05,
    restitution: 0.96,
  },
  {
    id: 'light',
    name: 'Light',
    blurb: 'Fast and slippery. You set up angles, then get sent if you trade head-on.',
    mass: 0.7,
    accel: 1.22,
    radius: 18,
    maxSpeed: 1.14,
    outgoing: 0.84,
    incoming: 1.22,
    turn: 1.14,
    dash: 1.06,
    dashCd: 0.92,
    restitution: 1.04,
  },
  {
    id: 'elastic',
    name: 'Elastic',
    blurb: 'Walls and landings give speed back. Live on the bounce.',
    mass: 0.94,
    accel: 1.04,
    radius: 21,
    maxSpeed: 1.04,
    outgoing: 0.96,
    incoming: 1.06,
    turn: 1.04,
    dash: 1,
    dashCd: 1,
    restitution: 1.08,
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    blurb: 'A harder dash and a worse habit of flying off the edge.',
    mass: 1.05,
    accel: 1.08,
    radius: 22,
    maxSpeed: 1.06,
    outgoing: 1.08,
    incoming: 1.06,
    turn: 0.84,
    dash: 1.22,
    dashCd: 0.86,
    restitution: 0.98,
  },
]

export const SHELLS: ShellDef[] = [
  {
    id: 'rubber',
    name: 'Rubber',
    blurb: 'Lively landings and clean bounces. The competitive baseline.',
    restitution: 1.05,
    period: 0.94,
    land: 1.22,
    incoming: 1,
    outgoing: 1,
    mass: 1,
    dashCd: 1,
    magnet: 0,
    reactive: false,
  },
  {
    id: 'armored',
    name: 'Armored',
    blurb: 'Incoming hits shrink. Your own launches shrink a little too.',
    restitution: 0.94,
    period: 1.05,
    land: 0.9,
    incoming: 0.8,
    outgoing: 0.9,
    mass: 1.12,
    dashCd: 1.1,
    magnet: 0,
    reactive: false,
  },
  {
    id: 'spiked',
    name: 'Spiked',
    blurb: 'Contact hurts more in both directions. Win the angle or pay for it.',
    restitution: 0.92,
    period: 1,
    land: 1,
    incoming: 1.1,
    outgoing: 1.2,
    mass: 1,
    dashCd: 1,
    magnet: 0,
    reactive: false,
  },
  {
    id: 'magnetic',
    name: 'Magnetic',
    blurb: 'Nearby balls drift toward you. Useful, and a beacon for anyone faster.',
    restitution: 1,
    period: 1,
    land: 1,
    incoming: 1,
    outgoing: 1,
    mass: 1,
    dashCd: 1,
    magnet: 70,
    reactive: false,
  },
  {
    id: 'reactive',
    name: 'Reactive',
    blurb: 'A heavy hit pops a small shock around you. It has its own short cooldown.',
    restitution: 1,
    period: 1,
    land: 1,
    incoming: 0.96,
    outgoing: 1,
    mass: 1,
    dashCd: 1,
    magnet: 0,
    reactive: true,
  },
]

export const PASSIVES: PassiveDef[] = [
  { id: 'none', name: 'None', blurb: 'No passive. Used in ranked.' },
  { id: 'second-wind', name: 'Second Wind', blurb: 'After a heavy hit, you surge forward for a moment.' },
  { id: 'edge-guard', name: 'Edge Guard', blurb: 'Near the boundary you turn harder. The edge is still the edge.' },
  { id: 'dash-refund', name: 'Dash Refund', blurb: 'A dash that connects comes back faster.' },
  { id: 'momentum-bank', name: 'Momentum Bank', blurb: 'High speed steals less of your turning.' },
  { id: 'heavy-hitter', name: 'Heavy Hitter', blurb: 'Slightly harder hits, slightly slower pickup.' },
  { id: 'glider', name: 'Glider', blurb: 'You fall slower off the rim, so a bad line is recoverable.' },
]

export const ABILITIES: AbilityDef[] = [
  { id: 'shockwave', name: 'Shockwave', blurb: 'Push everyone nearby away. A panic button and a setup tool.', cooldown: 7.2, key: 'F' },
  { id: 'magnet', name: 'Magnet', blurb: 'Pull nearby balls in. They arrive with their speed intact.', cooldown: 8.2, key: 'F' },
  { id: 'phase', name: 'Phase', blurb: 'Slip through other balls. Hazards and the edge still exist.', cooldown: 8, key: 'F' },
  { id: 'overdrive', name: 'Overdrive', blurb: 'Raise your speed cap and pickup. Control gets worse.', cooldown: 9, key: 'F' },
  { id: 'anchor', name: 'Anchor', blurb: 'Become a wall. Hits bounce off you, and you barely move.', cooldown: 8.4, key: 'F' },
  { id: 'repulse', name: 'Repulse', blurb: 'A directional blast along your steer. Aim it.', cooldown: 7.2, key: 'F' },
  { id: 'blink', name: 'Blink', blurb: 'Teleport a short distance along your steer, staying on the floor.', cooldown: 6.6, key: 'F' },
  { id: 'gravity-well', name: 'Gravity Well', blurb: 'Drop a well that drags other balls. You are not pulled.', cooldown: 9.2, key: 'F' },
  { id: 'mirror', name: 'Mirror', blurb: 'The next solid hit rebounds onto the attacker.', cooldown: 8.6, key: 'F' },
  { id: 'split', name: 'Split', blurb: 'Throw a decoy with your momentum. It hits once, then pops.', cooldown: 8, key: 'F' },
]

export function coreById(id: string): CoreDef {
  return CORES.find((c) => c.id === id) ?? CORES[0]!
}

export function shellById(id: string): ShellDef {
  return SHELLS.find((c) => c.id === id) ?? SHELLS[0]!
}

export function abilityById(id: string): AbilityDef {
  return ABILITIES.find((c) => c.id === id) ?? ABILITIES[0]!
}

export function passiveById(id: string): PassiveDef {
  return PASSIVES.find((c) => c.id === id) ?? PASSIVES[0]!
}
