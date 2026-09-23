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
  mastery: Record<string, number>
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
  }
  challenges: {
    dailyKey: string
    weeklyKey: string
    daily: string[]
    weekly: string[]
    progress: Record<string, number>
    done: string[]
  }
  seasonXp: number
  seasonId: string
  seasonClaimed: number
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

export function defaultProfile(): Profile {
  return {
    version: 1,
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
    },
    challenges: {
      dailyKey: '',
      weeklyKey: '',
      daily: [],
      weekly: [],
      progress: {},
      done: [],
    },
    seasonXp: 0,
    seasonId: 's1',
    seasonClaimed: 0,
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
    const parsed = JSON.parse(raw) as Partial<Profile>
    return { ...defaultProfile(), ...parsed, settings: { ...defaultProfile().settings, ...parsed.settings }, loadout: { ...defaultProfile().loadout, ...parsed.loadout }, equipped: { ...defaultProfile().equipped, ...parsed.equipped }, rank: { ...defaultProfile().rank, ...parsed.rank }, stats: { ...defaultProfile().stats, ...parsed.stats }, records: { ...defaultProfile().records, ...parsed.records }, challenges: { ...defaultProfile().challenges, ...parsed.challenges } }
  } catch {
    return defaultProfile()
  }
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
  while (xpForLevel(level + 1) <= xp && level < 80) level += 1
  return level
}

export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.floor(70 * Math.pow(level - 1, 1.42))
}

export function xpIntoLevel(xp: number): { level: number; have: number; need: number } {
  const level = levelFromXp(xp)
  const start = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return { level, have: xp - start, need: Math.max(1, next - start) }
}
