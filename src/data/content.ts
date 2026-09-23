import type { HazardKind, ModeId, SurfaceKind } from '../core/types'

export interface SolidDef {
  id: string
  shape: 'circle' | 'ring' | 'poly'
  x: number
  y: number
  r: number
  inner: number
  points: { x: number; y: number }[]
  surface: SurfaceKind
  primary: boolean
  shrinkable: boolean
  orbit?: { cx: number; cy: number; arm: number; speed: number; phase: number }
  toggle?: { period: number; duty: number; warn: number }
}

export interface WallDef {
  x1: number
  y1: number
  x2: number
  y2: number
  restitution: number
  spin: number
  lethal: boolean
}

export interface HazardDef {
  kind: HazardKind
  x: number
  y: number
  r: number
  w: number
  h: number
  angle: number
  speed: number
  amp: number
  delay: number
  period: number
  link: string
  grow: number
  maxR: number
  color: string
}

export interface ArenaDef {
  id: string
  name: string
  tagline: string
  blurb: string
  floor: string
  rim: string
  accent: string
  view: number
  solids: SolidDef[]
  walls: WallDef[]
  hazards: HazardDef[]
  spawns: { x: number; y: number }[]
  final: 'laser' | 'lava' | 'shrink' | 'none'
  shrinkRate: number
  shrinkDelay: number
}

export interface ModeDef {
  id: ModeId
  name: string
  blurb: string
  players: number
  minPlayers: number
  maxPlayers: number
  stocks: number
  duration: number
  teams: boolean
  win: 'last' | 'score'
  suddenDeath: boolean
  respawn: 'stocks' | 'always' | 'never'
  events: 'standard' | 'chaos' | 'quiet' | 'survivor'
  zone: boolean
  scoreLimit: number
  ranked: boolean
}

export interface CosmeticDef {
  id: string
  slot: 'trail' | 'impact' | 'emote' | 'banner' | 'title' | 'frame' | 'skin'
  name: string
  detail: string
  earn: string
  price: number
}

export interface ChallengeDef {
  id: string
  name: string
  detail: string
  stat: string
  target: number
  mode: 'sum' | 'best'
  cadence: 'daily' | 'weekly'
  coins: number
  grant?: string
}

export interface SeasonTier {
  xp: number
  cosmetic?: string
  coins?: number
  name: string
}

export interface SeasonDef {
  id: string
  name: string
  start: string
  end: string
  tiers: SeasonTier[]
}

export const PALETTE = [
  '#ff4d3a',
  '#ffc14d',
  '#3ee6a0',
  '#4cc9ff',
  '#b388ff',
  '#ff6b9a',
  '#d6ff4a',
  '#f4f7fb',
]

export const BOT_NAMES = [
  'Pebble', 'Ricochet', 'Comet', 'Juno', 'Orbit', 'Kip', 'Vesper', 'Nock',
  'Slugger', 'Halo', 'Quarry', 'Lumen', 'Sling', 'Cinder', 'Puck', 'Gyro',
  'Axiom', 'Bankshot', 'Marrow', 'Flick', 'Dribble', 'Quark', 'Nimbus', 'Rook',
]

function circle(
  id: string,
  x: number,
  y: number,
  r: number,
  surface: SurfaceKind,
  extra: Partial<SolidDef> = {},
): SolidDef {
  return {
    id,
    shape: 'circle',
    x,
    y,
    r,
    inner: 0,
    points: [],
    surface,
    primary: true,
    shrinkable: true,
    ...extra,
  }
}

function ring(id: string, r: number, inner: number, surface: SurfaceKind): SolidDef {
  return {
    id,
    shape: 'ring',
    x: 0,
    y: 0,
    r,
    inner,
    points: [],
    surface,
    primary: true,
    shrinkable: true,
  }
}

function spawns(n: number, radius: number, phase = -Math.PI / 2): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius }
  })
}

function wall(x1: number, y1: number, x2: number, y2: number, restitution = 1.05): WallDef {
  return { x1, y1, x2, y2, restitution, spin: 0, lethal: false }
}

export const ARENAS: ArenaDef[] = [
  {
    id: 'classic',
    name: 'Classic',
    tagline: 'Open circle',
    blurb: 'Nothing but balls, speed, and the edge. The pure fight.',
    floor: '#14343c',
    rim: '#ff4d3a',
    accent: '#7ee0ff',
    view: 560,
    solids: [circle('floor', 0, 0, 450, 'normal')],
    walls: [],
    hazards: [],
    spawns: spawns(8, 190),
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'ring',
    name: 'Ring',
    tagline: 'Donut',
    blurb: 'Orbit the hole. A bad line falls in or out.',
    floor: '#241838',
    rim: '#b388ff',
    accent: '#ffc14d',
    view: 580,
    solids: [ring('band', 470, 168, 'rubber')],
    walls: [],
    hazards: [],
    spawns: spawns(8, 310),
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'islands',
    name: 'Islands',
    tagline: 'Gaps',
    blurb: 'Four platforms and a flickering center. Dash the gaps.',
    floor: '#12301f',
    rim: '#3ee6a0',
    accent: '#ffc14d',
    view: 640,
    solids: [
      circle('n', 0, -250, 148, 'normal'),
      circle('e', 250, 0, 148, 'normal'),
      circle('s', 0, 250, 148, 'rubber'),
      circle('w', -250, 0, 148, 'normal'),
      circle('c', 0, 0, 78, 'launch', {
        toggle: { period: 6.5, duty: 0.62, warn: 1 },
      }),
    ],
    walls: [],
    hazards: [
      { kind: 'launcher', x: 0, y: -250, r: 36, w: 0, h: 0, angle: Math.PI / 2, speed: 520, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ffc14d' },
      { kind: 'launcher', x: 0, y: 250, r: 36, w: 0, h: 0, angle: -Math.PI / 2, speed: 520, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ffc14d' },
    ],
    spawns: [
      { x: 0, y: -250 },
      { x: 250, y: 0 },
      { x: 0, y: 250 },
      { x: -250, y: 0 },
      { x: 70, y: -250 },
      { x: 250, y: 70 },
      { x: -70, y: 250 },
      { x: -250, y: -70 },
    ],
    final: 'shrink',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'pinball',
    name: 'Pinball',
    tagline: 'Bumpers',
    blurb: 'The arena hits back. Use the bumpers, or they use you.',
    floor: '#3a1424',
    rim: '#ff6b9a',
    accent: '#ffc14d',
    view: 560,
    solids: [circle('floor', 0, 0, 450, 'rubber')],
    walls: [
      wall(-120, -40, 40, -160, 1.08),
      wall(120, 40, -40, 160, 1.08),
    ],
    hazards: [
      { kind: 'bumper', x: 0, y: 0, r: 42, w: 0, h: 0, angle: 0, speed: 640, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ffc14d' },
      { kind: 'bumper', x: -160, y: -120, r: 34, w: 0, h: 0, angle: 0, speed: 600, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ff8a5b' },
      { kind: 'bumper', x: 170, y: -90, r: 34, w: 0, h: 0, angle: 0, speed: 600, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ff8a5b' },
      { kind: 'bumper', x: -150, y: 140, r: 30, w: 0, h: 0, angle: 0, speed: 580, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#7ee0ff' },
      { kind: 'bumper', x: 140, y: 150, r: 30, w: 0, h: 0, angle: 0, speed: 580, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#7ee0ff' },
    ],
    spawns: spawns(8, 250),
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'hazard-core',
    name: 'Hazard Core',
    tagline: 'Center lava',
    blurb: 'The middle wakes up and grows. Camping the center is a trap.',
    floor: '#24160f',
    rim: '#ff6a2a',
    accent: '#ff4d3a',
    view: 560,
    solids: [circle('floor', 0, 0, 460, 'normal')],
    walls: [],
    hazards: [
      { kind: 'lava', x: 0, y: 0, r: 78, w: 0, h: 0, angle: 0, speed: 0, amp: 0, delay: 12, period: 0, link: '', grow: 2.4, maxR: 210, color: '#ff4d3a' },
    ],
    spawns: spawns(8, 280),
    final: 'lava',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'conveyor',
    name: 'Conveyor',
    tagline: 'Moving floor',
    blurb: 'Belts drag your line. Fight them or ride them into a hit.',
    floor: '#142433',
    rim: '#4cc9ff',
    accent: '#ffc14d',
    view: 620,
    solids: [{
      id: 'floor',
      shape: 'poly',
      x: 0,
      y: 0,
      r: 0,
      inner: 0,
      points: [
        { x: -500, y: -300 },
        { x: 500, y: -300 },
        { x: 500, y: 300 },
        { x: -500, y: 300 },
      ],
      surface: 'normal',
      primary: true,
      shrinkable: true,
    }],
    walls: [],
    hazards: [
      { kind: 'conveyor', x: 0, y: -120, r: 0, w: 760, h: 90, angle: 0, speed: 150, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#ffc14d' },
      { kind: 'conveyor', x: 0, y: 120, r: 0, w: 760, h: 90, angle: Math.PI, speed: 150, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#7ee0ff' },
      { kind: 'launcher', x: -360, y: 0, r: 40, w: 0, h: 0, angle: 0, speed: 560, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#3ee6a0' },
      { kind: 'launcher', x: 360, y: 0, r: 40, w: 0, h: 0, angle: Math.PI, speed: 560, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#3ee6a0' },
    ],
    spawns: [
      { x: -280, y: -180 },
      { x: 280, y: -180 },
      { x: -280, y: 180 },
      { x: 280, y: 180 },
      { x: 0, y: -180 },
      { x: 0, y: 180 },
      { x: -120, y: 0 },
      { x: 120, y: 0 },
    ],
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'gravity',
    name: 'Gravity',
    tagline: 'Split weight',
    blurb: 'The left side floats. The right side sticks. Cross with intent.',
    floor: '#162033',
    rim: '#7ee0ff',
    accent: '#d6ff4a',
    view: 560,
    solids: [circle('floor', 0, 0, 450, 'normal')],
    walls: [wall(0, -430, 0, 430, 1.02)],
    hazards: [
      { kind: 'gravity', x: -180, y: 0, r: 0, w: 340, h: 860, angle: 0, speed: 0.55, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#7ee0ff' },
      { kind: 'gravity', x: 180, y: 0, r: 0, w: 340, h: 860, angle: 0, speed: 1.45, amp: 0, delay: 0, period: 0, link: '', grow: 0, maxR: 0, color: '#d6ff4a' },
    ],
    spawns: spawns(8, 240),
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'collapse',
    name: 'Collapse',
    tagline: 'Shrinking floor',
    blurb: 'The arena gives itself away. Early comfort becomes a late knife-edge.',
    floor: '#3a2a14',
    rim: '#ffc14d',
    accent: '#ff4d3a',
    view: 620,
    solids: [circle('floor', 0, 0, 500, 'normal')],
    walls: [],
    hazards: [],
    spawns: spawns(8, 220),
    final: 'shrink',
    shrinkRate: 4.2,
    shrinkDelay: 8,
  },
  {
    id: 'portal',
    name: 'Portal',
    tagline: 'Two rooms',
    blurb: 'Two islands linked by portals. Learn the exit or eat it.',
    floor: '#1a1638',
    rim: '#b388ff',
    accent: '#4cc9ff',
    view: 680,
    solids: [
      circle('left', -250, 0, 200, 'normal', { shrinkable: true }),
      circle('right', 250, 0, 200, 'rubber', { shrinkable: true }),
    ],
    walls: [],
    hazards: [
      { kind: 'portal', x: -250, y: 90, r: 34, w: 0, h: 0, angle: 0, speed: 0, amp: 0, delay: 0, period: 0, link: 'ab', grow: 0, maxR: 0, color: '#4cc9ff' },
      { kind: 'portal', x: 250, y: -90, r: 34, w: 0, h: 0, angle: 0, speed: 0, amp: 0, delay: 0, period: 0, link: 'ab', grow: 0, maxR: 0, color: '#ff6b9a' },
      { kind: 'portal', x: -120, y: 40, r: 28, w: 0, h: 0, angle: 0, speed: 0, amp: 0, delay: 0, period: 0, link: 'cd', grow: 0, maxR: 0, color: '#ffc14d' },
      { kind: 'portal', x: 120, y: -40, r: 28, w: 0, h: 0, angle: 0, speed: 0, amp: 0, delay: 0, period: 0, link: 'cd', grow: 0, maxR: 0, color: '#3ee6a0' },
    ],
    spawns: [
      { x: -320, y: -60 },
      { x: -180, y: 60 },
      { x: -250, y: -80 },
      { x: 320, y: 60 },
      { x: 180, y: -60 },
      { x: 250, y: 80 },
      { x: -250, y: 0 },
      { x: 250, y: 0 },
    ],
    final: 'shrink',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'ricochet',
    name: 'Ricochet',
    tagline: 'Bank shots',
    blurb: 'Angled walls keep the speed. The open rim collects mistakes.',
    floor: '#1c2430',
    rim: '#f4f7fb',
    accent: '#ff4d3a',
    view: 560,
    solids: [circle('floor', 0, 0, 450, 'rubber')],
    walls: [
      wall(-220, -180, -40, -300, 1.14),
      wall(40, -300, 220, -180, 1.14),
      wall(230, -40, 300, 140, 1.12),
      wall(-300, 140, -230, -40, 1.12),
      wall(-80, 80, 90, 210, 1.16),
      wall(40, 40, 180, -20, 1.1),
    ],
    hazards: [],
    spawns: spawns(8, 200),
    final: 'laser',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
  {
    id: 'moving',
    name: 'Moving',
    tagline: 'Orbiting platforms',
    blurb: 'The floor moves under you and keeps its speed when you leave.',
    floor: '#102830',
    rim: '#3ee6a0',
    accent: '#4cc9ff',
    view: 640,
    solids: [0, 1, 2].map((i) => circle(`p${i}`, 0, 0, 128, i === 1 ? 'rubber' : 'normal', {
      orbit: { cx: 0, cy: 0, arm: 250, speed: 0.42, phase: (i / 3) * Math.PI * 2 },
    })),
    walls: [],
    hazards: [],
    spawns: [0, 1, 2, 0, 1, 2, 0, 1].map((i, n) => {
      const a = (i / 3) * Math.PI * 2
      const jitter = (n % 2 === 0 ? 18 : -18)
      return { x: Math.cos(a) * 250 + jitter, y: Math.sin(a) * 250 }
    }),
    final: 'shrink',
    shrinkRate: 0,
    shrinkDelay: 0,
  },
]

export const MODES: ModeDef[] = [
  {
    id: 'ffa',
    name: 'Free-for-All',
    blurb: 'Three stocks. Last ball in wins. The clock ends in sudden death.',
    players: 6,
    minPlayers: 4,
    maxPlayers: 8,
    stocks: 3,
    duration: 80,
    teams: false,
    win: 'last',
    suddenDeath: true,
    respawn: 'stocks',
    events: 'standard',
    zone: false,
    scoreLimit: 0,
    ranked: true,
  },
  {
    id: 'team',
    name: 'Team Knockout',
    blurb: '2v2 or 3v3. Bump your partner. Do not launch them.',
    players: 4,
    minPlayers: 4,
    maxPlayers: 6,
    stocks: 3,
    duration: 90,
    teams: true,
    win: 'last',
    suddenDeath: true,
    respawn: 'stocks',
    events: 'standard',
    zone: false,
    scoreLimit: 0,
    ranked: true,
  },
  {
    id: 'score',
    name: 'Score Rush',
    blurb: 'Points for launches and eliminations. The edge is a tool, not the only one.',
    players: 6,
    minPlayers: 4,
    maxPlayers: 8,
    stocks: 99,
    duration: 75,
    teams: false,
    win: 'score',
    suddenDeath: false,
    respawn: 'always',
    events: 'standard',
    zone: false,
    scoreLimit: 700,
    ranked: true,
  },
  {
    id: 'king',
    name: 'King of the Arena',
    blurb: 'Hold the zone alone. Sharing it is almost worthless.',
    players: 6,
    minPlayers: 4,
    maxPlayers: 8,
    stocks: 3,
    duration: 80,
    teams: false,
    win: 'score',
    suddenDeath: false,
    respawn: 'stocks',
    events: 'quiet',
    zone: true,
    scoreLimit: 0,
    ranked: true,
  },
  {
    id: 'survivor',
    name: 'Survivor',
    blurb: 'One life. The floor retreats. Do not donate yourself to the void.',
    players: 8,
    minPlayers: 4,
    maxPlayers: 8,
    stocks: 1,
    duration: 70,
    teams: false,
    win: 'last',
    suddenDeath: true,
    respawn: 'never',
    events: 'survivor',
    zone: false,
    scoreLimit: 0,
    ranked: false,
  },
  {
    id: 'chaos',
    name: 'Chaos',
    blurb: 'Meteors, wells, and blasts on a short fuse. Read the warnings.',
    players: 6,
    minPlayers: 4,
    maxPlayers: 8,
    stocks: 3,
    duration: 80,
    teams: false,
    win: 'last',
    suddenDeath: true,
    respawn: 'stocks',
    events: 'chaos',
    zone: false,
    scoreLimit: 0,
    ranked: false,
  },
  {
    id: 'duel',
    name: 'Duel',
    blurb: 'One opponent. Three stocks. No excuses in the geometry.',
    players: 2,
    minPlayers: 2,
    maxPlayers: 2,
    stocks: 3,
    duration: 60,
    teams: false,
    win: 'last',
    suddenDeath: true,
    respawn: 'stocks',
    events: 'quiet',
    zone: false,
    scoreLimit: 0,
    ranked: true,
  },
  {
    id: 'practice',
    name: 'Practice',
    blurb: 'No clock. Bots respawn. Leave when you have the touch.',
    players: 4,
    minPlayers: 2,
    maxPlayers: 6,
    stocks: 99,
    duration: 0,
    teams: false,
    win: 'score',
    suddenDeath: false,
    respawn: 'always',
    events: 'quiet',
    zone: false,
    scoreLimit: 0,
    ranked: false,
  },
  {
    id: 'tutorial',
    name: 'Tutorial',
    blurb: 'One rival. Hints only when you need them.',
    players: 2,
    minPlayers: 2,
    maxPlayers: 2,
    stocks: 99,
    duration: 0,
    teams: false,
    win: 'last',
    suddenDeath: false,
    respawn: 'always',
    events: 'quiet',
    zone: false,
    scoreLimit: 0,
    ranked: false,
  },
]

export const COSMETICS: CosmeticDef[] = [
  { id: 'trail_none', slot: 'trail', name: 'No Trail', detail: 'Clean.', earn: 'Starter', price: 0 },
  { id: 'trail_comet', slot: 'trail', name: 'Comet', detail: 'A bright streak that sells your speed.', earn: 'First match', price: 0 },
  { id: 'trail_ribbon', slot: 'trail', name: 'Ribbon', detail: 'A wide band behind the ball.', earn: 'Season 1', price: 500 },
  { id: 'trail_spark', slot: 'trail', name: 'Spark', detail: 'Short electric ticks.', earn: 'Coins', price: 350 },
  { id: 'trail_ember', slot: 'trail', name: 'Ember', detail: 'Hot flakes for heavy players.', earn: 'Heavy mastery', price: 0 },
  { id: 'trail_ion', slot: 'trail', name: 'Ion', detail: 'A thin twin line.', earn: 'Account level', price: 0 },
  { id: 'trail_hex', slot: 'trail', name: 'Hex', detail: 'Geometric shards.', earn: 'Season 1', price: 800 },
  { id: 'impact_ring', slot: 'impact', name: 'Ring', detail: 'A clean shock ring.', earn: 'Starter', price: 0 },
  { id: 'impact_burst', slot: 'impact', name: 'Burst', detail: 'A harder flash on big hits.', earn: 'Account level', price: 0 },
  { id: 'impact_shatter', slot: 'impact', name: 'Shatter', detail: 'Splinters on impact.', earn: 'Coins', price: 450 },
  { id: 'impact_glyph', slot: 'impact', name: 'Glyph', detail: 'A marked ring for ranked wins.', earn: 'Reach Gold', price: 0 },
  { id: 'emote_nice', slot: 'emote', name: 'Nice hit', detail: 'Say it.', earn: 'Starter', price: 0 },
  { id: 'emote_again', slot: 'emote', name: 'Again', detail: 'Ask for the rematch in the arena.', earn: 'Account level', price: 0 },
  { id: 'emote_close', slot: 'emote', name: 'Close', detail: 'For the ones that almost left.', earn: 'Coins', price: 200 },
  { id: 'emote_watch', slot: 'emote', name: 'Watch this', detail: 'Call the line.', earn: 'Season 1', price: 0 },
  { id: 'banner_plain', slot: 'banner', name: 'Plain', detail: 'A quiet card.', earn: 'Starter', price: 0 },
  { id: 'banner_stripe', slot: 'banner', name: 'Stripe', detail: 'A coral slash.', earn: 'Account level', price: 0 },
  { id: 'banner_orbit', slot: 'banner', name: 'Orbit', detail: 'Rings on your result card.', earn: 'Season 1', price: 400 },
  { id: 'title_rookie', slot: 'title', name: 'Rookie', detail: 'You showed up.', earn: 'Starter', price: 0 },
  { id: 'title_first_bounce', slot: 'title', name: 'First Bounce', detail: 'Finished a match.', earn: 'First match', price: 0 },
  { id: 'title_regular', slot: 'title', name: 'Regular', detail: 'The arena knows your line.', earn: 'Account level', price: 0 },
  { id: 'title_anchor', slot: 'title', name: 'Immovable', detail: 'Heavy mastery.', earn: 'Heavy mastery', price: 0 },
  { id: 'title_ghost', slot: 'title', name: 'Untouchable', detail: 'Light mastery.', earn: 'Light mastery', price: 0 },
  { id: 'title_bank', slot: 'title', name: 'Bank Shot', detail: 'Elastic mastery.', earn: 'Elastic mastery', price: 0 },
  { id: 'title_dash', slot: 'title', name: 'Dash Hand', detail: 'Aggressive mastery.', earn: 'Aggressive mastery', price: 0 },
  { id: 'title_hazard', slot: 'title', name: 'Hazard Minded', detail: 'Let the arena finish it.', earn: 'Weekly challenge', price: 0 },
  { id: 'title_gold', slot: 'title', name: 'Gold Line', detail: 'Reached Gold.', earn: 'Reach Gold', price: 0 },
  { id: 'frame_plain', slot: 'frame', name: 'Plain Frame', detail: 'Starter frame.', earn: 'Starter', price: 0 },
  { id: 'frame_bronze', slot: 'frame', name: 'Bronze Frame', detail: 'A first competitive frame.', earn: 'Account level', price: 0 },
  { id: 'frame_signal', slot: 'frame', name: 'Signal', detail: 'A bright corner mark.', earn: 'Coins', price: 600 },
  { id: 'skin_classic', slot: 'skin', name: 'Classic', detail: 'Gloss and a hard rim.', earn: 'Starter', price: 0 },
  { id: 'skin_glass', slot: 'skin', name: 'Glass', detail: 'A clearer core. Color stays yours.', earn: 'Account level', price: 0 },
  { id: 'skin_ember', slot: 'skin', name: 'Ember', detail: 'A hot inner core.', earn: 'Coins', price: 550 },
  { id: 'skin_chrome', slot: 'skin', name: 'Chrome', detail: 'Hard highlight, same identity color.', earn: 'Season 1', price: 0 },
  { id: 'skin_hollow', slot: 'skin', name: 'Hollow', detail: 'A ring instead of a filled ball.', earn: 'Mastery', price: 700 },
]

export const CHALLENGES: ChallengeDef[] = [
  { id: 'd_hazard', name: 'Use the room', detail: 'Eliminate 1 opponent with a hazard or the environment after your hit.', stat: 'hazardElims', target: 1, mode: 'best', cadence: 'daily', coins: 80 },
  { id: 'd_momentum', name: 'Stay fast', detail: 'Reach 80% momentum and survive 20 seconds in one match.', stat: 'fastSurvival', target: 1, mode: 'best', cadence: 'daily', coins: 80 },
  { id: 'd_no_ability', name: 'Body only', detail: 'Win a match without casting your ability.', stat: 'winNoAbility', target: 1, mode: 'best', cadence: 'daily', coins: 90 },
  { id: 'd_dash', name: 'Dash strike', detail: 'Land 2 dash hits in one match.', stat: 'dashHits', target: 2, mode: 'best', cadence: 'daily', coins: 70 },
  { id: 'd_escape', name: 'Get back', detail: 'Recover from a fall 1 time.', stat: 'escapes', target: 1, mode: 'best', cadence: 'daily', coins: 70 },
  { id: 'd_elims', name: 'Clean hits', detail: 'Eliminate 3 opponents in one match.', stat: 'elims', target: 3, mode: 'best', cadence: 'daily', coins: 90 },
  { id: 'd_launch', name: 'Send them', detail: 'Launch someone at least 8 meters.', stat: 'launch8', target: 1, mode: 'best', cadence: 'daily', coins: 80 },
  { id: 'w_hazard3', name: 'Hazard route', detail: 'Get 3 hazard eliminations this week.', stat: 'hazardElims', target: 3, mode: 'sum', cadence: 'weekly', coins: 160, grant: 'title_hazard' },
  { id: 'w_dash_elims', name: 'Dash closer', detail: 'Eliminate 5 opponents with a dash this week.', stat: 'dashElims', target: 5, mode: 'sum', cadence: 'weekly', coins: 160 },
  { id: 'w_walls', name: 'Bank it', detail: 'Land 12 wall kicks this week.', stat: 'wallKicks', target: 12, mode: 'sum', cadence: 'weekly', coins: 140 },
  { id: 'w_matches', name: 'Stay for the set', detail: 'Finish 8 matches this week.', stat: 'matches', target: 8, mode: 'sum', cadence: 'weekly', coins: 120 },
  { id: 'w_perfect', name: 'On the beat', detail: 'Land 6 perfect dashes this week.', stat: 'perfectDashes', target: 6, mode: 'sum', cadence: 'weekly', coins: 150 },
  { id: 'w_survive', name: 'Long life', detail: 'Survive 40 seconds in a single life.', stat: 'longLife', target: 1, mode: 'best', cadence: 'weekly', coins: 140 },
]

export const SEASON: SeasonDef = {
  id: 's1',
  name: 'First Orbit',
  start: '2026-09-01',
  end: '2026-12-15',
  tiers: [
    { xp: 0, name: 'Arrive', coins: 50 },
    { xp: 120, name: 'Warmup', coins: 80 },
    { xp: 280, name: 'Comet trail', cosmetic: 'trail_ribbon' },
    { xp: 460, name: 'Pocket coins', coins: 120 },
    { xp: 680, name: 'Watch this', cosmetic: 'emote_watch' },
    { xp: 920, name: 'Orbit banner', cosmetic: 'banner_orbit' },
    { xp: 1200, name: 'Stash', coins: 160 },
    { xp: 1550, name: 'Chrome', cosmetic: 'skin_chrome' },
    { xp: 1950, name: 'Hex trail', cosmetic: 'trail_hex' },
    { xp: 2400, name: 'First Orbit', coins: 200 },
  ],
}

export const LEVEL_REWARDS: Record<number, string> = {
  2: 'banner_stripe',
  3: 'impact_burst',
  4: 'emote_again',
  6: 'skin_glass',
  8: 'trail_ion',
  10: 'frame_bronze',
  12: 'title_regular',
}

export const MASTERY_REWARDS: Record<string, { xp: number; cosmetic: string }[]> = {
  heavy: [
    { xp: 160, cosmetic: 'title_anchor' },
    { xp: 520, cosmetic: 'trail_ember' },
  ],
  light: [{ xp: 160, cosmetic: 'title_ghost' }],
  elastic: [{ xp: 160, cosmetic: 'title_bank' }],
  aggressive: [{ xp: 160, cosmetic: 'title_dash' }],
  stable: [{ xp: 400, cosmetic: 'skin_hollow' }],
}

export const RANK_TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0 },
  { id: 'silver', name: 'Silver', min: 1100 },
  { id: 'gold', name: 'Gold', min: 1300 },
  { id: 'platinum', name: 'Platinum', min: 1500 },
  { id: 'diamond', name: 'Diamond', min: 1700 },
  { id: 'master', name: 'Master', min: 1900 },
  { id: 'grandmaster', name: 'Grandmaster', min: 2100 },
] as const

export function arenaById(id: string): ArenaDef {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0]!
}

export function modeById(id: string): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0]!
}

export function cosmeticById(id: string): CosmeticDef | undefined {
  return COSMETICS.find((c) => c.id === id)
}

export function rankName(rating: number): { tier: string; division: number; label: string } {
  let tier: (typeof RANK_TIERS)[number] = RANK_TIERS[0]
  for (const t of RANK_TIERS) {
    if (rating >= t.min) tier = t
  }
  const next = RANK_TIERS.find((t) => t.min > tier.min)
  const span = (next?.min ?? tier.min + 200) - tier.min
  const into = Math.max(0, rating - tier.min)
  const division = Math.min(3, Math.floor((into / span) * 3) + 1)
  const divLabel = tier.id === 'grandmaster' ? '' : ` ${['I', 'II', 'III'][division - 1]}`
  return { tier: tier.name, division, label: `${tier.name}${divLabel}` }
}

export function currentSeason(now = new Date()): SeasonDef | null {
  const t = now.getTime()
  const start = Date.parse(SEASON.start)
  const end = Date.parse(SEASON.end)
  if (t >= start && t <= end) return SEASON
  return null
}

export function dateKey(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function weekKey(now = new Date()): string {
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${week}`
}
