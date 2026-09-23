import type { MatchResult, Placement } from '../core/types'
import {
  CHALLENGES,
  LEVEL_REWARDS,
  MASTERY_REWARDS,
  cosmeticById,
  currentSeason,
  dateKey,
  rankName,
  weekKey,
} from '../data/content'
import { levelFromXp, type Profile } from './profile'

export interface Grant {
  id: string
  name: string
  detail: string
  kind: 'cosmetic' | 'coins' | 'record' | 'rank' | 'challenge' | 'level'
}

export interface SettleOutcome {
  profile: Profile
  grants: Grant[]
  duplicate: boolean
  rankDelta: number
  rankReason: string
  levelUp: number
  coinsGained: number
  xpGained: number
  records: string[]
  challenges: { id: string; name: string; progress: number; target: number; done: boolean }[]
}

const PLACE_XP = [140, 100, 78, 60, 48, 38, 30, 24]

export function settle(profile: Profile, result: MatchResult, now = new Date()): SettleOutcome {
  const next = structuredClone(profile)
  refreshChallenges(next, now)
  rollSeason(next, now)
  if (next.settled.includes(result.matchId)) {
    return { profile: next, grants: [], duplicate: true, rankDelta: 0, rankReason: 'Already counted', levelUp: 0, coinsGained: 0, xpGained: 0, records: [], challenges: [] }
  }
  next.settled.push(result.matchId)
  if (next.settled.length > 40) next.settled.splice(0, next.settled.length - 40)

  const you = result.placements.find((p) => p.id === result.youId) ?? result.placements[0]
  if (!you) {
    return { profile: next, grants: [], duplicate: false, rankDelta: 0, rankReason: '', levelUp: 0, coinsGained: 0, xpGained: 0, records: [], challenges: [] }
  }

  const grants: Grant[] = []
  const records: string[] = []
  const beforeLevel = levelFromXp(next.accountXp)
  const xp = matchXp(you, result)
  const coins = matchCoins(you, result)
  next.accountXp += xp
  next.coins += coins
  next.matches += 1
  next.stats.matches += 1
  next.stats.elims += you.elims
  next.stats.deaths += you.deaths
  next.stats.damage += you.damage
  next.stats.playTime += result.time
  next.stats.hazardElims += you.hazardElims
  next.stats.dashElims += you.dashElims
  next.stats.arenaPlays[result.arenaId] = (next.stats.arenaPlays[result.arenaId] ?? 0) + 1
  next.stats.abilityUses[you.ability] = (next.stats.abilityUses[you.ability] ?? 0) + you.abilityUses
  if (you.won) {
    next.stats.wins += 1
    next.stats.currentStreak += 1
    next.stats.bestStreak = Math.max(next.stats.bestStreak, next.stats.currentStreak)
  } else {
    next.stats.currentStreak = 0
  }
  if (you.behindAtMid && you.won) {
    next.stats.comebacks += 1
    next.records.comebacks += 1
  }

  const masteryKey = you.masteryCore || you.core
  next.mastery[masteryKey] = (next.mastery[masteryKey] ?? 0) + 24 + you.elims * 12 + (you.won ? 20 : 0)
  for (const reward of MASTERY_REWARDS[masteryKey] ?? []) {
    if ((next.mastery[masteryKey] ?? 0) >= reward.xp) grantCosmetic(next, reward.cosmetic, grants, 'Mastery')
  }

  const afterLevel = levelFromXp(next.accountXp)
  if (next.matches === 1) {
    grantCosmetic(next, 'trail_comet', grants, 'First match')
    grantCosmetic(next, 'title_first_bounce', grants, 'First match')
    next.equipped.trail = 'trail_comet'
    next.equipped.title = 'title_first_bounce'
  }
  for (let level = beforeLevel + 1; level <= afterLevel; level++) {
    const id = LEVEL_REWARDS[level]
    if (id) grantCosmetic(next, id, grants, `Level ${level}`)
  }

  noteRecord(next, records, 'Biggest launch', you.bestLaunchM, next.records.biggestLaunch, (v) => (next.records.biggestLaunch = v))
  if (you.elims > 0) {
    const fastest = result.time
    if (next.records.fastestElim === 0 || fastest < next.records.fastestElim) {
      next.records.fastestElim = fastest
      records.push('Fastest elimination')
    }
  }
  noteRecord(next, records, 'Longest life', you.longestLife, next.records.longestSurvival, (v) => (next.records.longestSurvival = v))
  noteRecord(next, records, 'Most eliminations', you.elims, next.records.mostElims, (v) => (next.records.mostElims = v))
  noteRecord(next, records, 'Highest momentum', you.maxMomentum, next.records.highestMomentum, (v) => (next.records.highestMomentum = v))
  noteRecord(next, records, 'Highest speed', you.maxSpeed, next.records.highestSpeed, (v) => (next.records.highestSpeed = v))
  noteRecord(next, records, 'Best multi-knockout', you.multiBest, next.records.bestMulti, (v) => (next.records.bestMulti = v))

  const mmrDelta = rateChange(next.mmr, you, result, 16)
  next.mmr = clampRating(next.mmr + mmrDelta)
  let rankDelta = 0
  let rankReason = 'Casual matches do not move your rank.'
  if (result.competitive && !result.forfeit) {
    const k = next.rank.placementsLeft > 0 ? 40 : next.rank.rating >= 1900 ? 16 : 24
    rankDelta = rateChange(next.rank.rating, you, result, k)
    next.rank.rating = clampRating(next.rank.rating + rankDelta)
    if (next.rank.placementsLeft > 0) next.rank.placementsLeft -= 1
    const label = rankName(next.rank.rating).label
    next.rank.lastDelta = rankDelta
    const field = averageField(result, you.id)
    rankReason = explainRank(rankDelta, you.place, field, next.rank.placementsLeft)
    next.rank.lastReason = rankReason
    if (next.rank.rating > next.rank.peak) {
      next.rank.peak = next.rank.rating
      next.rank.peakLabel = label
    }
    if (next.rank.rating >= 1300) grantCosmetic(next, 'title_gold', grants, 'Gold')
    if (next.rank.rating >= 1300) grantCosmetic(next, 'impact_glyph', grants, 'Gold')
  } else if (result.competitive && result.forfeit) {
    rankDelta = -12
    next.rank.rating = clampRating(next.rank.rating + rankDelta)
    rankReason = 'Forfeit counted as a loss.'
    next.rank.lastDelta = rankDelta
    next.rank.lastReason = rankReason
  }

  next.seasonXp += Math.round(xp * 0.85)
  const season = currentSeason(now)
  if (season) {
    while (next.seasonClaimed < season.tiers.length && next.seasonXp >= season.tiers[next.seasonClaimed]!.xp) {
      const tier = season.tiers[next.seasonClaimed]!
      if (tier.cosmetic) grantCosmetic(next, tier.cosmetic, grants, season.name)
      if (tier.coins) {
        next.coins += tier.coins
        grants.push({ id: 'coins', name: `${tier.coins} coins`, detail: tier.name, kind: 'coins' })
      }
      next.seasonClaimed += 1
    }
  }

  const challenges = applyChallenges(next, you, result)
  for (const c of challenges) {
    if (c.done) {
      const def = CHALLENGES.find((x) => x.id === c.id)
      if (def && !next.challenges.done.includes(c.id)) {
        next.challenges.done.push(c.id)
        next.coins += def.coins
        grants.push({ id: c.id, name: def.name, detail: `+${def.coins} coins`, kind: 'challenge' })
        if (def.grant) grantCosmetic(next, def.grant, grants, 'Challenge')
      }
    }
  }

  next.recent.unshift({
    id: result.matchId,
    mode: result.modeId,
    arena: result.arenaId,
    place: you.place,
    competitive: result.competitive,
    delta: rankDelta,
    at: now.getTime(),
  })
  if (next.recent.length > 12) next.recent.pop()

  return {
    profile: next,
    grants,
    duplicate: false,
    rankDelta,
    rankReason,
    levelUp: afterLevel - beforeLevel,
    coinsGained: coins,
    xpGained: xp,
    records,
    challenges,
  }
}

export function refreshChallenges(profile: Profile, now = new Date()): void {
  const day = dateKey(now)
  const week = weekKey(now)
  if (profile.challenges.dailyKey !== day) {
    profile.challenges.dailyKey = day
    profile.challenges.daily = pickChallenges('daily', day, 3)
    for (const id of profile.challenges.daily) profile.challenges.progress[id] = 0
  }
  if (profile.challenges.weeklyKey !== week) {
    profile.challenges.weeklyKey = week
    profile.challenges.weekly = pickChallenges('weekly', week, 3)
    for (const id of profile.challenges.weekly) profile.challenges.progress[id] = 0
  }
}

export function buyCosmetic(profile: Profile, id: string): Profile | null {
  const item = cosmeticById(id)
  if (!item || item.price <= 0 || profile.owned.includes(id) || profile.coins < item.price) return null
  const next = structuredClone(profile)
  next.coins -= item.price
  next.owned.push(id)
  return next
}

export function equipCosmetic(profile: Profile, id: string): Profile | null {
  const item = cosmeticById(id)
  if (!item || !profile.owned.includes(id)) return null
  const next = structuredClone(profile)
  next.equipped[item.slot] = id
  return next
}

function matchXp(you: Placement, result: MatchResult): number {
  const base = PLACE_XP[Math.min(PLACE_XP.length - 1, Math.max(0, you.place - 1))] ?? 24
  return base + you.elims * 12 + Math.round(result.time / 12)
}

function matchCoins(you: Placement, result: MatchResult): number {
  return 36 + (PLACE_XP[Math.min(7, you.place - 1)] ?? 20) / 2 + you.elims * 6 + (result.competitive ? 10 : 0)
}

function grantCosmetic(profile: Profile, id: string, grants: Grant[], why: string): void {
  const item = cosmeticById(id)
  if (!item) return
  if (profile.owned.includes(id)) {
    profile.coins += 40
    return
  }
  profile.owned.push(id)
  grants.push({ id, name: item.name, detail: why, kind: 'cosmetic' })
}

function noteRecord(profile: Profile, records: string[], label: string, value: number, current: number, write: (v: number) => void): void {
  void profile
  if (value > current) {
    write(value)
    records.push(label)
  }
}

function averageField(result: MatchResult, youId: string): number {
  const others = result.placements.filter((p) => p.id !== youId)
  if (others.length === 0) return 1000
  return others.reduce((s, p) => s + p.rating, 0) / others.length
}

function rateChange(rating: number, you: Placement, result: MatchResult, k: number): number {
  const n = result.placements.length
  const actual = n <= 1 ? 1 : (n - you.place) / (n - 1)
  const field = averageField(result, you.id)
  const expected = 1 / (1 + 10 ** ((field - rating) / 400))
  return Math.round(k * (actual - expected))
}

function explainRank(delta: number, place: number, field: number, placementsLeft: number): string {
  const placeText = `placed #${place} in a lobby near ${Math.round(field)}`
  if (placementsLeft > 0) return `${delta >= 0 ? '+' : ''}${delta} · placement match, ${placeText}`
  if (delta > 0) return `+${delta} · ${placeText}`
  if (delta < 0) return `${delta} · ${placeText}`
  return `No change · ${placeText}`
}

function clampRating(n: number): number {
  return Math.max(700, Math.min(2800, n))
}

function applyChallenges(profile: Profile, you: Placement, result: MatchResult) {
  const active = [...profile.challenges.daily, ...profile.challenges.weekly]
  const updates: { id: string; name: string; progress: number; target: number; done: boolean }[] = []
  for (const id of active) {
    const def = CHALLENGES.find((c) => c.id === id)
    if (!def || profile.challenges.done.includes(id)) continue
    const value = challengeStat(def.stat, you, result)
    const prev = profile.challenges.progress[id] ?? 0
    const progress = def.mode === 'sum' ? prev + value : Math.max(prev, value)
    profile.challenges.progress[id] = progress
    updates.push({ id, name: def.name, progress, target: def.target, done: progress >= def.target })
  }
  return updates
}

function challengeStat(stat: string, you: Placement, result: MatchResult): number {
  switch (stat) {
    case 'hazardElims':
      return you.hazardElims
    case 'dashHits':
      return you.dashHits
    case 'dashElims':
      return you.dashElims
    case 'escapes':
      return you.escapes
    case 'elims':
      return you.elims
    case 'perfectDashes':
      return you.perfectDashes
    case 'wallKicks':
      return you.wallKicks
    case 'matches':
      return 1
    case 'fastSurvival':
      return you.maxMomentum >= 0.8 && you.survival >= 20 ? 1 : 0
    case 'winNoAbility':
      return you.won && you.abilityUses === 0 ? 1 : 0
    case 'launch8':
      return you.bestLaunchM >= 8 ? 1 : 0
    case 'longLife':
      return you.longestLife >= 40 ? 1 : 0
    default:
      return result.time > 0 ? 0 : 0
  }
}

function pickChallenges(cadence: 'daily' | 'weekly', key: string, count: number): string[] {
  const pool = CHALLENGES.filter((c) => c.cadence === cadence).map((c) => c.id)
  const out: string[] = []
  let h = hash(key)
  while (out.length < count && out.length < pool.length) {
    h = (Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0)
    const id = pool[h % pool.length]!
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

function rollSeason(profile: Profile, now: Date): void {
  const season = currentSeason(now)
  const id = season?.id ?? 'offseason'
  if (profile.rank.seasonId === id) return
  if (season && profile.rank.seasonId !== season.id) {
    profile.rank.rating = Math.round(1000 + (profile.rank.rating - 1000) * 0.3)
    profile.rank.placementsLeft = 5
    profile.rank.seasonId = season.id
    profile.seasonId = season.id
    profile.seasonXp = 0
    profile.seasonClaimed = 0
  }
}