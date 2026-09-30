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
  /** Season xp paid on completion. */
  xp: number
  grant?: string
}

export type AchievementStat =
  | 'matches'
  | 'wins'
  | 'elims'
  | 'hazardElims'
  | 'dashElims'
  | 'comebacks'
  | 'perfectDashes'
  | 'wallKicks'
  | 'escapes'
  | 'arenas'
  | 'bestStreak'
  | 'biggestLaunch'
  | 'bestMulti'
  | 'rankedWins'
  | 'masteryLevel'

export interface AchievementDef {
  id: string
  name: string
  /** `{n}` is replaced by the target of the next tier. */
  detail: string
  stat: AchievementStat
  tiers: number[]
  coins: number[]
  /** Cosmetic granted with the final tier. */
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
  /** Granted at season end to anyone whose peak reached Gold. */
  endTitle: string
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
  { id: 'skin_hollow', slot: 'skin', name: 'Hollow', detail: 'A ring instead of a filled ball.', earn: 'Stable mastery 3', price: 700 },

  // Account levels past 12
  { id: 'banner_grid', slot: 'banner', name: 'Grid', detail: 'Arena floor lines.', earn: 'Level 14', price: 0 },
  { id: 'emote_gg', slot: 'emote', name: 'Good game', detail: 'Mean it.', earn: 'Level 16', price: 0 },
  { id: 'impact_ripple', slot: 'impact', name: 'Ripple', detail: 'Three soft rings.', earn: 'Level 18', price: 0 },
  { id: 'frame_silver', slot: 'frame', name: 'Silver Frame', detail: 'You kept coming back.', earn: 'Level 20', price: 0 },
  { id: 'trail_prism', slot: 'trail', name: 'Prism', detail: 'Splits light at speed.', earn: 'Level 22', price: 0 },
  { id: 'title_veteran', slot: 'title', name: 'Veteran', detail: 'Reached level 25.', earn: 'Level 25', price: 0 },
  { id: 'skin_nebula', slot: 'skin', name: 'Nebula', detail: 'Clouded core, bright rim.', earn: 'Level 28', price: 0 },
  { id: 'frame_apex', slot: 'frame', name: 'Apex Frame', detail: 'Reached level 30.', earn: 'Level 30', price: 0 },

  // Mastery
  { id: 'title_keel', slot: 'title', name: 'Even Keel', detail: 'Stable mastery.', earn: 'Stable mastery 5', price: 0 },
  { id: 'trail_wisp', slot: 'trail', name: 'Wisp', detail: 'Barely there.', earn: 'Light mastery 5', price: 0 },
  { id: 'impact_spring', slot: 'impact', name: 'Spring', detail: 'A coil that snaps back.', earn: 'Elastic mastery 5', price: 0 },
  { id: 'trail_blade', slot: 'trail', name: 'Blade', detail: 'A hard, thin edge.', earn: 'Aggressive mastery 5', price: 0 },
  { id: 'title_ab_shockwave', slot: 'title', name: 'Epicenter', detail: 'Shockwave mastery.', earn: 'Shockwave mastery 5', price: 0 },
  { id: 'title_ab_magnet', slot: 'title', name: 'Lodestone', detail: 'Magnet mastery.', earn: 'Magnet mastery 5', price: 0 },
  { id: 'title_ab_phase', slot: 'title', name: 'Not There', detail: 'Phase mastery.', earn: 'Phase mastery 5', price: 0 },
  { id: 'title_ab_overdrive', slot: 'title', name: 'Redline', detail: 'Overdrive mastery.', earn: 'Overdrive mastery 5', price: 0 },
  { id: 'title_ab_anchor', slot: 'title', name: 'Bedrock', detail: 'Anchor mastery.', earn: 'Anchor mastery 5', price: 0 },
  { id: 'title_ab_repulse', slot: 'title', name: 'Point Blank', detail: 'Repulse mastery.', earn: 'Repulse mastery 5', price: 0 },
  { id: 'title_ab_blink', slot: 'title', name: 'Blink Step', detail: 'Blink mastery.', earn: 'Blink mastery 5', price: 0 },
  { id: 'title_ab_gravity-well', slot: 'title', name: 'Event Horizon', detail: 'Gravity Well mastery.', earn: 'Gravity Well mastery 5', price: 0 },
  { id: 'title_ab_mirror', slot: 'title', name: 'Reflex', detail: 'Mirror mastery.', earn: 'Mirror mastery 5', price: 0 },
  { id: 'title_ab_split', slot: 'title', name: 'Double Take', detail: 'Split mastery.', earn: 'Split mastery 5', price: 0 },

  // Achievements
  { id: 'frame_iron', slot: 'frame', name: 'Iron Frame', detail: 'Finished 200 matches.', earn: 'Achievement', price: 0 },
  { id: 'title_champion', slot: 'title', name: 'Champion', detail: 'Won 100 matches.', earn: 'Achievement', price: 0 },
  { id: 'impact_nova', slot: 'impact', name: 'Nova', detail: 'A flare that lingers.', earn: 'Achievement', price: 0 },
  { id: 'trail_magma', slot: 'trail', name: 'Magma', detail: 'Drips where you have been.', earn: 'Achievement', price: 0 },
  { id: 'title_lancer', slot: 'title', name: 'Lancer', detail: 'Dash knockouts.', earn: 'Achievement', price: 0 },
  { id: 'title_unbroken', slot: 'title', name: 'Unbroken', detail: 'Comebacks.', earn: 'Achievement', price: 0 },
  { id: 'trail_pulse', slot: 'trail', name: 'Pulse', detail: 'Beats with every perfect dash.', earn: 'Achievement', price: 0 },
  { id: 'title_carom', slot: 'title', name: 'Carom', detail: 'Wall kicks.', earn: 'Achievement', price: 0 },
  { id: 'emote_phew', slot: 'emote', name: 'Phew', detail: 'Back from the rim.', earn: 'Achievement', price: 0 },
  { id: 'banner_atlas', slot: 'banner', name: 'Atlas', detail: 'Every arena, mapped.', earn: 'Achievement', price: 0 },
  { id: 'title_unstoppable', slot: 'title', name: 'Unstoppable', detail: 'Ten wins in a row.', earn: 'Achievement', price: 0 },
  { id: 'impact_crater', slot: 'impact', name: 'Crater', detail: 'Leaves a dent.', earn: 'Achievement', price: 0 },
  { id: 'title_sweeper', slot: 'title', name: 'Sweeper', detail: 'Quadruple knockout.', earn: 'Achievement', price: 0 },
  { id: 'frame_laurel', slot: 'frame', name: 'Laurel', detail: 'Ranked wins.', earn: 'Achievement', price: 0 },
  { id: 'skin_prism', slot: 'skin', name: 'Prism', detail: 'Refracts your color.', earn: 'Achievement', price: 0 },

  // Season 1 track extension
  { id: 'impact_orbit', slot: 'impact', name: 'Orbit Rings', detail: 'Two rings chase each other.', earn: 'Season 1', price: 0 },
  { id: 'title_orbiter', slot: 'title', name: 'Orbiter', detail: 'Season 1 track.', earn: 'Season 1', price: 0 },
  { id: 'frame_orbit', slot: 'frame', name: 'Orbit Frame', detail: 'Season 1 track.', earn: 'Season 1', price: 0 },
  { id: 'skin_orbit', slot: 'skin', name: 'First Orbit', detail: 'A ringed ball.', earn: 'Season 1', price: 0 },
  { id: 'title_s1_gold', slot: 'title', name: 'Orbit Gold', detail: 'Peaked Gold or higher in Season 1.', earn: 'Season 1 end', price: 0 },

  // Season 2
  { id: 'trail_aurora', slot: 'trail', name: 'Aurora', detail: 'Green sheets of light.', earn: 'Season 2', price: 0 },
  { id: 'emote_brr', slot: 'emote', name: 'Brr', detail: 'Cold take.', earn: 'Season 2', price: 0 },
  { id: 'banner_frost', slot: 'banner', name: 'Frost', detail: 'Rime on the edges.', earn: 'Season 2', price: 0 },
  { id: 'skin_frost', slot: 'skin', name: 'Frost', detail: 'Frosted shell.', earn: 'Season 2', price: 0 },
  { id: 'impact_shard', slot: 'impact', name: 'Ice Shard', detail: 'Cracks on contact.', earn: 'Season 2', price: 0 },
  { id: 'title_cold_front', slot: 'title', name: 'Cold Front', detail: 'Season 2 track.', earn: 'Season 2', price: 0 },
  { id: 'trail_snow', slot: 'trail', name: 'Snow', detail: 'Drifts behind you.', earn: 'Season 2', price: 0 },
  { id: 'frame_frost', slot: 'frame', name: 'Frost Frame', detail: 'Season 2 track.', earn: 'Season 2', price: 0 },
  { id: 'skin_glacier', slot: 'skin', name: 'Glacier', detail: 'Deep blue ice.', earn: 'Season 2', price: 0 },
  { id: 'title_s2_gold', slot: 'title', name: 'Front Gold', detail: 'Peaked Gold or higher in Season 2.', earn: 'Season 2 end', price: 0 },
]

export const CHALLENGES: ChallengeDef[] = [
  { id: 'd_hazard', name: 'Use the room', detail: 'Eliminate 1 opponent with a hazard or the environment after your hit.', stat: 'hazardElims', target: 1, mode: 'best', cadence: 'daily', coins: 80, xp: 80 },
  { id: 'd_momentum', name: 'Stay fast', detail: 'Reach 80% momentum and survive 20 seconds in one match.', stat: 'fastSurvival', target: 1, mode: 'best', cadence: 'daily', coins: 80, xp: 80 },
  { id: 'd_no_ability', name: 'Body only', detail: 'Win a match without casting your ability.', stat: 'winNoAbility', target: 1, mode: 'best', cadence: 'daily', coins: 90, xp: 90 },
  { id: 'd_dash', name: 'Dash strike', detail: 'Land 2 dash hits in one match.', stat: 'dashHits', target: 2, mode: 'best', cadence: 'daily', coins: 70, xp: 70 },
  { id: 'd_escape', name: 'Get back', detail: 'Recover from a fall 1 time.', stat: 'escapes', target: 1, mode: 'best', cadence: 'daily', coins: 70, xp: 70 },
  { id: 'd_elims', name: 'Clean hits', detail: 'Eliminate 3 opponents in one match.', stat: 'elims', target: 3, mode: 'best', cadence: 'daily', coins: 90, xp: 90 },
  { id: 'd_launch', name: 'Send them', detail: 'Launch someone at least 8 meters.', stat: 'launch8', target: 1, mode: 'best', cadence: 'daily', coins: 80, xp: 80 },
  { id: 'd_podium', name: 'Podium', detail: 'Finish in the top 3.', stat: 'topThree', target: 1, mode: 'best', cadence: 'daily', coins: 70, xp: 70 },
  { id: 'd_ability', name: 'Make it count', detail: 'Land 3 ability hits in one match.', stat: 'abilityHits', target: 3, mode: 'best', cadence: 'daily', coins: 80, xp: 80 },
  { id: 'd_wall', name: 'Off the wall', detail: 'Land 3 wall kicks in one match.', stat: 'wallKicks', target: 3, mode: 'best', cadence: 'daily', coins: 70, xp: 70 },
  { id: 'w_hazard3', name: 'Hazard route', detail: 'Get 3 hazard eliminations this week.', stat: 'hazardElims', target: 3, mode: 'sum', cadence: 'weekly', coins: 160, xp: 220, grant: 'title_hazard' },
  { id: 'w_dash_elims', name: 'Dash closer', detail: 'Eliminate 5 opponents with a dash this week.', stat: 'dashElims', target: 5, mode: 'sum', cadence: 'weekly', coins: 160, xp: 220 },
  { id: 'w_walls', name: 'Bank it', detail: 'Land 12 wall kicks this week.', stat: 'wallKicks', target: 12, mode: 'sum', cadence: 'weekly', coins: 140, xp: 200 },
  { id: 'w_matches', name: 'Stay for the set', detail: 'Finish 8 matches this week.', stat: 'matches', target: 8, mode: 'sum', cadence: 'weekly', coins: 120, xp: 200 },
  { id: 'w_perfect', name: 'On the beat', detail: 'Land 6 perfect dashes this week.', stat: 'perfectDashes', target: 6, mode: 'sum', cadence: 'weekly', coins: 150, xp: 220 },
  { id: 'w_survive', name: 'Long life', detail: 'Survive 40 seconds in a single life.', stat: 'longLife', target: 1, mode: 'best', cadence: 'weekly', coins: 140, xp: 200 },
  { id: 'w_wins', name: 'Closer', detail: 'Win 5 matches this week.', stat: 'wins', target: 5, mode: 'sum', cadence: 'weekly', coins: 180, xp: 240 },
  { id: 'w_multi', name: 'Two at once', detail: 'Get a double knockout.', stat: 'multi2', target: 1, mode: 'best', cadence: 'weekly', coins: 160, xp: 220 },
  { id: 'w_ranked', name: 'On the line', detail: 'Finish 5 ranked matches this week.', stat: 'ranked', target: 5, mode: 'sum', cadence: 'weekly', coins: 150, xp: 220 },
  { id: 'w_elims', name: 'Clear the floor', detail: 'Eliminate 25 opponents this week.', stat: 'elims', target: 25, mode: 'sum', cadence: 'weekly', coins: 160, xp: 220 },
]

/** Paid once when every challenge of a cadence is done in the same day or week. */
export const SWEEP_BONUS = {
  daily: { coins: 80, xp: 60 },
  weekly: { coins: 250, xp: 200 },
} as const

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_matches', name: 'Regular', detail: 'Finish {n} matches.', stat: 'matches', tiers: [10, 50, 200], coins: [60, 150, 400], grant: 'frame_iron' },
  { id: 'a_wins', name: 'Last Ball In', detail: 'Win {n} matches.', stat: 'wins', tiers: [5, 25, 100], coins: [80, 200, 500], grant: 'title_champion' },
  { id: 'a_elims', name: 'Knockout Artist', detail: 'Eliminate {n} opponents.', stat: 'elims', tiers: [25, 150, 600], coins: [60, 160, 450], grant: 'impact_nova' },
  { id: 'a_hazard', name: 'Architect', detail: 'Get {n} hazard eliminations.', stat: 'hazardElims', tiers: [5, 25, 100], coins: [60, 160, 400], grant: 'trail_magma' },
  { id: 'a_dash', name: 'Lance', detail: 'Get {n} dash eliminations.', stat: 'dashElims', tiers: [5, 30, 120], coins: [60, 160, 400], grant: 'title_lancer' },
  { id: 'a_comeback', name: 'Not Done Yet', detail: 'Win {n} matches you were losing at the half.', stat: 'comebacks', tiers: [1, 5, 20], coins: [80, 200, 450], grant: 'title_unbroken' },
  { id: 'a_perfect', name: 'Tempo', detail: 'Land {n} perfect dashes.', stat: 'perfectDashes', tiers: [10, 60, 250], coins: [60, 160, 400], grant: 'trail_pulse' },
  { id: 'a_walls', name: 'Geometry', detail: 'Land {n} wall kicks.', stat: 'wallKicks', tiers: [20, 120, 500], coins: [60, 160, 400], grant: 'title_carom' },
  { id: 'a_escapes', name: 'Rim Walker', detail: 'Recover from {n} falls.', stat: 'escapes', tiers: [5, 30, 120], coins: [60, 160, 400], grant: 'emote_phew' },
  { id: 'a_arenas', name: 'Tourist', detail: 'Play {n} different arenas.', stat: 'arenas', tiers: [3, 7, 11], coins: [50, 120, 300], grant: 'banner_atlas' },
  { id: 'a_streak', name: 'On a Run', detail: 'Win {n} matches in a row.', stat: 'bestStreak', tiers: [3, 5, 10], coins: [80, 200, 500], grant: 'title_unstoppable' },
  { id: 'a_launch', name: 'Long Ball', detail: 'Launch someone {n} meters.', stat: 'biggestLaunch', tiers: [6, 10, 15], coins: [60, 150, 350], grant: 'impact_crater' },
  { id: 'a_multi', name: 'Crowd Control', detail: 'Knock out {n} balls in one burst.', stat: 'bestMulti', tiers: [2, 3, 4], coins: [60, 180, 450], grant: 'title_sweeper' },
  { id: 'a_ranked', name: 'Contender', detail: 'Win {n} ranked matches.', stat: 'rankedWins', tiers: [3, 15, 60], coins: [80, 220, 550], grant: 'frame_laurel' },
  { id: 'a_mastery', name: 'Specialist', detail: 'Reach mastery {n} with any core or ability.', stat: 'masteryLevel', tiers: [3, 6, 10], coins: [60, 180, 500], grant: 'skin_prism' },
]

export const SEASONS: SeasonDef[] = [
  {
    id: 's1',
    name: 'First Orbit',
    start: '2026-09-01',
    end: '2026-12-15',
    endTitle: 'title_s1_gold',
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
      { xp: 2400, name: 'Halfway', coins: 200 },
      { xp: 2900, name: 'Orbit impact', cosmetic: 'impact_orbit' },
      { xp: 3450, name: 'Purse', coins: 240 },
      { xp: 4050, name: 'Orbiter', cosmetic: 'title_orbiter' },
      { xp: 4700, name: 'Vault', coins: 280 },
      { xp: 5400, name: 'Orbit frame', cosmetic: 'frame_orbit' },
      { xp: 6200, name: 'First Orbit', cosmetic: 'skin_orbit' },
    ],
  },
  {
    id: 's2',
    name: 'Cold Front',
    start: '2026-12-16',
    end: '2027-03-31',
    endTitle: 'title_s2_gold',
    tiers: [
      { xp: 0, name: 'Arrive', coins: 50 },
      { xp: 120, name: 'Warmup', coins: 80 },
      { xp: 280, name: 'Aurora', cosmetic: 'trail_aurora' },
      { xp: 460, name: 'Pocket coins', coins: 120 },
      { xp: 680, name: 'Brr', cosmetic: 'emote_brr' },
      { xp: 920, name: 'Frost banner', cosmetic: 'banner_frost' },
      { xp: 1200, name: 'Stash', coins: 160 },
      { xp: 1550, name: 'Frost', cosmetic: 'skin_frost' },
      { xp: 1950, name: 'Ice shard', cosmetic: 'impact_shard' },
      { xp: 2400, name: 'Halfway', coins: 200 },
      { xp: 2900, name: 'Cold Front', cosmetic: 'title_cold_front' },
      { xp: 3450, name: 'Purse', coins: 240 },
      { xp: 4050, name: 'Snow', cosmetic: 'trail_snow' },
      { xp: 4700, name: 'Vault', coins: 280 },
      { xp: 5400, name: 'Frost frame', cosmetic: 'frame_frost' },
      { xp: 6200, name: 'Glacier', cosmetic: 'skin_glacier' },
    ],
  },
]

/** After the last tier, every OVERTIME_XP of season xp pays OVERTIME_COINS. */
export const OVERTIME_XP = 400
export const OVERTIME_COINS = 100

/** Season-end coins by peak rank tier index, Bronze through Grandmaster. */
export const SEASON_END_COINS = [80, 150, 250, 400, 600, 800, 1000]

export const LEVEL_REWARDS: Record<number, string> = {
  2: 'banner_stripe',
  3: 'impact_burst',
  4: 'emote_again',
  6: 'skin_glass',
  8: 'trail_ion',
  10: 'frame_bronze',
  12: 'title_regular',
  14: 'banner_grid',
  16: 'emote_gg',
  18: 'impact_ripple',
  20: 'frame_silver',
  22: 'trail_prism',
  25: 'title_veteran',
  28: 'skin_nebula',
  30: 'frame_apex',
}

/** Cumulative mastery xp for levels 1 through 10. */
export const MASTERY_LEVELS = [0, 120, 300, 560, 900, 1320, 1820, 2400, 3060, 3800]

export const CORE_MASTERY_REWARDS: Record<string, Record<number, string>> = {
  stable: { 3: 'skin_hollow', 5: 'title_keel' },
  heavy: { 2: 'title_anchor', 3: 'trail_ember' },
  light: { 2: 'title_ghost', 5: 'trail_wisp' },
  elastic: { 2: 'title_bank', 5: 'impact_spring' },
  aggressive: { 2: 'title_dash', 5: 'trail_blade' },
}

/** Every ability grants its own title at this mastery level. */
export const ABILITY_TITLE_LEVEL = 5

export function masteryReward(kind: 'core' | 'ability', id: string, level: number): string | undefined {
  if (kind === 'core') return CORE_MASTERY_REWARDS[id]?.[level]
  if (level !== ABILITY_TITLE_LEVEL) return undefined
  const title = `title_ab_${id}`
  return cosmeticById(title) ? title : undefined
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
  for (const season of SEASONS) {
    // The end date runs through its last day.
    if (t >= Date.parse(season.start) && t < Date.parse(season.end) + 86400000) return season
  }
  return null
}

export function seasonById(id: string): SeasonDef | undefined {
  return SEASONS.find((s) => s.id === id)
}

/** The running season, else the next one, else the last one. */
export function displaySeason(now = new Date()): SeasonDef {
  const t = now.getTime()
  return currentSeason(now) ?? SEASONS.find((s) => Date.parse(s.start) > t) ?? SEASONS[SEASONS.length - 1]!
}

export function rankTierIndex(rating: number): number {
  let index = 0
  RANK_TIERS.forEach((t, i) => {
    if (rating >= t.min) index = i
  })
  return index
}

export function masteryLevel(xp: number): { level: number; have: number; need: number; max: boolean } {
  let level = 1
  while (level < MASTERY_LEVELS.length && xp >= MASTERY_LEVELS[level]!) level += 1
  const max = level >= MASTERY_LEVELS.length
  const start = MASTERY_LEVELS[level - 1]!
  const next = MASTERY_LEVELS[level] ?? start
  return { level, have: xp - start, need: Math.max(1, next - start), max }
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
