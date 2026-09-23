export const DT = 1 / 60
export const SPEED_CAP = 980

export type BotLevel = 'rookie' | 'rival' | 'ace' | 'champion'

export type SurfaceKind =
  | 'normal'
  | 'rubber'
  | 'ice'
  | 'sticky'
  | 'magnetic'
  | 'launch'

export type HazardKind =
  | 'spikes'
  | 'lava'
  | 'bumper'
  | 'launcher'
  | 'laser'
  | 'conveyor'
  | 'ice'
  | 'gravity'
  | 'portal'
  | 'explosive'
  | 'crusher'
  | 'blackhole'

export type ModeId =
  | 'ffa'
  | 'team'
  | 'score'
  | 'king'
  | 'survivor'
  | 'chaos'
  | 'duel'
  | 'practice'
  | 'tutorial'

export interface InputFrame {
  x: number
  y: number
  dash: boolean
  ability: boolean
  brake: boolean
  emote: boolean
}

export const ZERO_INPUT: InputFrame = {
  x: 0,
  y: 0,
  dash: false,
  ability: false,
  brake: false,
  emote: false,
}

export interface PlayerConfig {
  id: string
  name: string
  team: number
  bot: boolean
  botLevel: BotLevel
  /** 0..1 continuous skill used for aim and reactions. */
  skill: number
  /** How eagerly the bot looks for hits. */
  aggression: number
  color: string
  pattern: number
  core: string
  shell: string
  ability: string
  passive: string
  /** Core the player chose, even if competitive rules normalize stats. */
  masteryCore: string
  trail: string
  impact: string
  skin: string
  emote: string
  title: string
  rating: number
}

export interface MatchConfig {
  seed: number
  matchId: string
  modeId: ModeId
  arenaId: string
  /** Seconds of play time. 0 = endless. */
  duration: number
  stocks: number
  competitive: boolean
  teams: boolean
  /** last = knockout, score = highest score at the buzzer. */
  win: 'last' | 'score'
  suddenDeath: boolean
  respawn: 'stocks' | 'always' | 'never'
  events: 'standard' | 'chaos' | 'quiet' | 'survivor'
  zone: boolean
  scoreLimit: number
  players: PlayerConfig[]
  recordReplay: boolean
}

export interface BodyStats {
  elims: number
  deaths: number
  damage: number
  damageTaken: number
  maxSpeed: number
  maxMomentum: number
  bestImpact: number
  bestLaunchM: number
  survival: number
  longestLife: number
  lifeTime: number
  dashes: number
  dashHits: number
  dashElims: number
  perfectDashes: number
  abilityUses: number
  abilityHits: number
  hazardElims: number
  escapes: number
  multiBest: number
  wallKicks: number
  score: number
  zoneTime: number
  hits: number
  behindAtMid: boolean
}

export interface Moment {
  kind: string
  title: string
  detail: string
  time: number
  actorId: string
  importance: number
}

export interface FxEvent {
  type:
    | 'hit'
    | 'dash'
    | 'ability'
    | 'elim'
    | 'land'
    | 'warn'
    | 'pickup'
    | 'boom'
    | 'wall'
    | 'spawn'
    | 'save'
  x: number
  y: number
  power: number
  color: string
  actorId: string
  victimId: string
  text: string
}

export interface ScriptEvent {
  t: number
  kind: 'orb' | 'meteor' | 'lowg' | 'well' | 'hole' | 'blast'
  x: number
  y: number
  r: number
  dur: number
}

export interface LiveScript extends ScriptEvent {
  born: number
  fired: boolean
}

export interface MatchResult {
  matchId: string
  seed: number
  modeId: ModeId
  arenaId: string
  competitive: boolean
  duration: number
  time: number
  forfeit: boolean
  youId: string
  placements: Placement[]
  moments: Moment[]
  /** Human inputs keyed by play tick, aligned to contestant order. */
  replayHumans: InputFrame[][]
  humanIds: string[]
}

export interface Placement {
  id: string
  name: string
  team: number
  place: number
  bot: boolean
  color: string
  core: string
  masteryCore: string
  ability: string
  rating: number
  elims: number
  deaths: number
  damage: number
  damageTaken: number
  score: number
  survival: number
  maxSpeed: number
  maxMomentum: number
  bestImpact: number
  bestLaunchM: number
  dashes: number
  dashHits: number
  dashElims: number
  perfectDashes: number
  abilityUses: number
  abilityHits: number
  hazardElims: number
  escapes: number
  multiBest: number
  wallKicks: number
  stocksLeft: number
  longestLife: number
  behindAtMid: boolean
  won: boolean
}

export function emptyStats(): BodyStats {
  return {
    elims: 0,
    deaths: 0,
    damage: 0,
    damageTaken: 0,
    maxSpeed: 0,
    maxMomentum: 0,
    bestImpact: 0,
    bestLaunchM: 0,
    survival: 0,
    longestLife: 0,
    lifeTime: 0,
    dashes: 0,
    dashHits: 0,
    dashElims: 0,
    perfectDashes: 0,
    abilityUses: 0,
    abilityHits: 0,
    hazardElims: 0,
    escapes: 0,
    multiBest: 0,
    wallKicks: 0,
    score: 0,
    zoneTime: 0,
    hits: 0,
    behindAtMid: false,
  }
}

export function sanitizeInput(raw: Partial<InputFrame> | undefined): InputFrame {
  const x = Number(raw?.x)
  const y = Number(raw?.y)
  let sx = Number.isFinite(x) ? x : 0
  let sy = Number.isFinite(y) ? y : 0
  const m = Math.hypot(sx, sy)
  if (m > 1) {
    sx /= m
    sy /= m
  }
  return {
    x: sx,
    y: sy,
    dash: !!raw?.dash,
    ability: !!raw?.ability,
    brake: !!raw?.brake,
    emote: !!raw?.emote,
  }
}
