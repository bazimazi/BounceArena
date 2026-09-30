export interface Settings {
  volume: number
  music: number
  shake: number
  fx: 'full' | 'reduced'
  haptics: boolean
  mouseSteer: boolean
  uiScale: number
  colorblind: boolean
  numbers: boolean
}

export interface CareerStats {
  matches: number
  wins: number
  elims: number
  deaths: number
  damage: number
  playTime: number
  hazardElims: number
  dashElims: number
  comebacks: number
  perfectDashes: number
  wallKicks: number
  escapes: number
  abilityHits: number
  podiums: number
  rankedMatches: number
  rankedWins: number
  bestStreak: number
  winStreak: number
  currentStreak: number
  arenaPlays: Record<string, number>
  abilityUses: Record<string, number>
}

export interface Records {
  biggestLaunch: number
  fastestElim: number
  longestSurvival: number
  mostElims: number
  highestMomentum: number
  highestSpeed: number
  bestMulti: number
  comebacks: number
}

export interface RecentMatch {
  id: string
  mode: string
  arena: string
  place: number
  competitive: boolean
  delta: number
  at: number
}

export interface SeasonRecord {
  seasonId: string
  name: string
  peak: number
  peakLabel: string
  matches: number
  wins: number
  coins: number
}

export interface Daily {
  /** dateKey of the last day with a finished match. */
  lastDay: string
  /** Consecutive days with at least one finished match. */
  streak: number
  bestStreak: number
  /** dateKey the first-win bonus was last paid. */
  firstWinDay: string
}

export interface Profile {
  version: number
  name: string
  color: number
  accountXp: number
  coins: number
  mmr: number
  loadout: { core: string; shell: string; ability: string; passive: string }
  equipped: {
    trail: string
    impact: string
    emote: string
    banner: string
    title: string
    frame: string
    skin: string
  }
  owned: string[]
  /** Core mastery xp. */
  mastery: Record<string, number>
  abilityMastery: Record<string, number>
  /** Achievement id to tiers claimed. */
  achievements: Record<string, number>
  daily: Daily
  stats: CareerStats
  records: Records
  rank: {
    rating: number
    peak: number
    peakLabel: string
    placementsLeft: number
    seasonId: string
    lastDelta: number
    lastReason: string
    /** Ranked matches left where a loss cannot drop you out of a new tier. */
    shield: number
    /** Consecutive ranked wins. */
    streak: number
    seasonMatches: number
    seasonWins: number
    history: SeasonRecord[]
  }
  challenges: {
    dailyKey: string
    weeklyKey: string
    daily: string[]
    weekly: string[]
    progress: Record<string, number>
    done: string[]
    /** Period keys whose sweep bonus is paid, like `d:2026-09-30`. */
    sweeps: string[]
    /** dateKey of the last reroll. One per day. */
    rerollDay: string
  }
  seasonXp: number
  seasonId: string
  seasonClaimed: number
  /** Overtime payouts claimed past the last season tier. */
  seasonOvertime: number
  settled: string[]
  recent: RecentMatch[]
  settings: Settings
  taught: Record<string, boolean>
  matches: number
  tutorialDone: boolean
  created: number
}

export interface Store {
  get(key: string): string | null
  set(key: string, value: string): void
}

export const PROFILE_KEY = 'bounce-arena-profile-v1'
export const PROFILE_VERSION = 2
export const MAX_LEVEL = 80

export function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    name: 'Player',
    color: 0,
    accountXp: 0,
    coins: 0,
    mmr: 1000,
    loadout: { core: 'stable', shell: 'rubber', ability: 'shockwave', passive: 'second-wind' },
    equipped: {
      trail: 'trail_none',
      impact: 'impact_ring',
      emote: 'emote_nice',
      banner: 'banner_plain',
      title: 'title_rookie',
      frame: 'frame_plain',
      skin: 'skin_classic',
    },
    owned: [
      'trail_none',
      'impact_ring',
      'emote_nice',
      'banner_plain',
      'title_rookie',
      'frame_plain',
      'skin_classic',
    ],
    mastery: {},
    abilityMastery: {},
    achievements: {},
    daily: { lastDay: '', streak: 0, bestStreak: 0, firstWinDay: '' },
    stats: {
      matches: 0,
      wins: 0,
      elims: 0,
      deaths: 0,
      damage: 0,
      playTime: 0,
      hazardElims: 0,
      dashElims: 0,
      comebacks: 0,
      perfectDashes: 0,
      wallKicks: 0,
      escapes: 0,
      abilityHits: 0,
      podiums: 0,
      rankedMatches: 0,
      rankedWins: 0,
      bestStreak: 0,
      winStreak: 0,
      currentStreak: 0,
      arenaPlays: {},
      abilityUses: {},
    },
    records: {
      biggestLaunch: 0,
      fastestElim: 0,
      longestSurvival: 0,
      mostElims: 0,
      highestMomentum: 0,
      highestSpeed: 0,
      bestMulti: 0,
      comebacks: 0,
    },
    rank: {
      rating: 1000,
      peak: 1000,
      peakLabel: 'Bronze I',
      placementsLeft: 5,
      seasonId: 's1',
      lastDelta: 0,
      lastReason: '',
      shield: 0,
      streak: 0,
      seasonMatches: 0,
      seasonWins: 0,
      history: [],
    },
    challenges: {
      dailyKey: '',
      weeklyKey: '',
      daily: [],
      weekly: [],
      progress: {},
      done: [],
      sweeps: [],
      rerollDay: '',
    },
    seasonXp: 0,
    seasonId: 's1',
    seasonClaimed: 0,
    seasonOvertime: 0,
    settled: [],
    recent: [],
    settings: {
      volume: 0.8,
      music: 0.22,
      shake: 0.55,
      fx: 'full',
      haptics: true,
      mouseSteer: false,
      uiScale: 1,
      colorblind: false,
      numbers: true,
    },
    taught: {},
    matches: 0,
    tutorialDone: false,
    created: Date.now(),
  }
}

export function loadProfile(store: Store = browserStore()): Profile {
  const raw = store.get(PROFILE_KEY)
  if (!raw) return defaultProfile()
  try {
    return migrateProfile(JSON.parse(raw) as Partial<Profile>)
  } catch {
    return defaultProfile()
  }
}

/** Fills fields added since the save was written. Older saves keep everything they had. */
export function migrateProfile(parsed: Partial<Profile>): Profile {
  const base = defaultProfile()
  const profile: Profile = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...parsed.settings },
    loadout: { ...base.loadout, ...parsed.loadout },
    equipped: { ...base.equipped, ...parsed.equipped },
    rank: { ...base.rank, ...parsed.rank },
    stats: { ...base.stats, ...parsed.stats },
    records: { ...base.records, ...parsed.records },
    challenges: { ...base.challenges, ...parsed.challenges },
    daily: { ...base.daily, ...parsed.daily },
    mastery: { ...parsed.mastery },
    abilityMastery: { ...parsed.abilityMastery },
    achievements: { ...parsed.achievements },
  }
  if ((parsed.version ?? 1) < 2) {
    // v1 kept completed challenge ids forever, which froze any challenge that rotated back in.
    const active = new Set([...profile.challenges.daily, ...profile.challenges.weekly])
    profile.challenges.done = profile.challenges.done.filter((id) => active.has(id))
    // v1 counted ability casts per ability; seed ability mastery from them.
    for (const [id, uses] of Object.entries(profile.stats.abilityUses)) {
      profile.abilityMastery[id] = Math.max(profile.abilityMastery[id] ?? 0, Math.min(900, uses * 6))
    }
  }
  profile.version = PROFILE_VERSION
  return profile
}

export function saveProfile(profile: Profile, store: Store = browserStore()): void {
  store.set(PROFILE_KEY, JSON.stringify(profile))
}

function browserStore(): Store {
  return {
    get: (key) => {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        /* private mode */
      }
    },
  }
}

export function memoryStore(seed?: string): Store {
  const map = new Map<string, string>()
  if (seed) map.set(PROFILE_KEY, seed)
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value)
    },
  }
}

export function levelFromXp(xp: number): number {
  let level = 1
  while (xpForLevel(level + 1) <= xp && level < MAX_LEVEL) level += 1
  return level
}

export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.floor(70 * Math.pow(level - 1, 1.42))
}

export function xpIntoLevel(xp: number): { level: number; have: number; need: number } {
  const level = levelFromXp(xp)
  const start = xpForLevel(level)
  if (level >= MAX_LEVEL) return { level, have: 1, need: 1 }
  const next = xpForLevel(level + 1)
  return { level, have: xp - start, need: Math.max(1, next - start) }
}
