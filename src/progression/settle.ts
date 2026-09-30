import type { MatchResult, Placement } from '../core/types'
import {
  ACHIEVEMENTS,
  CHALLENGES,
  LEVEL_REWARDS,
  MASTERY_LEVELS,
  OVERTIME_COINS,
  OVERTIME_XP,
  RANK_TIERS,
  SEASON_END_COINS,
  SWEEP_BONUS,
  cosmeticById,
  currentSeason,
  dateKey,
  masteryLevel,
  masteryReward,
  rankName,
  rankTierIndex,
  seasonById,
  weekKey,
  type AchievementDef,
  type ChallengeDef,
} from '../data/content'
import { ABILITIES, CORES } from '../data/tuning'
import { levelFromXp, type Profile } from './profile'

export interface Grant {
  id: string
  name: string
  detail: string
  kind: 'cosmetic' | 'coins' | 'record' | 'rank' | 'challenge' | 'level' | 'achievement' | 'mastery' | 'season'
}

export interface XpLine {
  label: string
  xp: number
}

export interface MasteryGain {
  kind: 'core' | 'ability'
  id: string
  name: string
  gained: number
  /** Mastery xp after this match. */
  xp: number
  levelsGained: number
}

export interface ChallengeUpdate {
  id: string
  name: string
  progress: number
  target: number
  done: boolean
}

export interface SettleOutcome {
  profile: Profile
  grants: Grant[]
  duplicate: boolean
  rankDelta: number
  rankReason: string
  /** Set when a ranked result crossed a tier line. */
  rankMove: 'up' | 'down' | ''
  levelUp: number
  /** Net coins this settle added, including every bonus and reward. */
  coinsGained: number
  xpGained: number
  xpLines: XpLine[]
  seasonXpGained: number
  records: string[]
  challenges: ChallengeUpdate[]
  mastery: MasteryGain[]
  dayStreak: number
}

const PLACE_XP = [140, 100, 78, 60, 48, 38, 30, 24]
const FIRST_WIN_XP = 60
const FIRST_WIN_COINS = 40
const SHIELD_MATCHES = 3
const DUPLICATE_REFUND = 40

export function settle(profile: Profile, result: MatchResult, now = new Date()): SettleOutcome {
  const next = structuredClone(profile)
  const coinsBefore = profile.coins
  const grants = refresh(next, now)
  const empty = (duplicate: boolean, rankReason: string): SettleOutcome => ({
    profile: next,
    grants,
    duplicate,
    rankDelta: 0,
    rankReason,
    rankMove: '',
    levelUp: 0,
    coinsGained: next.coins - coinsBefore,
    xpGained: 0,
    xpLines: [],
    seasonXpGained: 0,
    records: [],
    challenges: [],
    mastery: [],
    dayStreak: next.daily.streak,
  })
  if (next.settled.includes(result.matchId)) return empty(true, 'Already counted')
  next.settled.push(result.matchId)
  if (next.settled.length > 40) next.settled.splice(0, next.settled.length - 40)

  const you = result.placements.find((p) => p.id === result.youId) ?? result.placements[0]
  if (!you) return empty(false, '')

  const records: string[] = []
  const beforeLevel = levelFromXp(next.accountXp)
  const today = dateKey(now)

  // Day streak: consecutive calendar days with a finished match.
  const firstToday = next.daily.lastDay !== today
  if (firstToday) {
    next.daily.streak = next.daily.lastDay === dateKey(addDays(now, -1)) ? next.daily.streak + 1 : 1
    next.daily.bestStreak = Math.max(next.daily.bestStreak, next.daily.streak)
    next.daily.lastDay = today
  }

  // Career stats first: bonuses and achievements read them.
  next.matches += 1
  next.stats.matches += 1
  next.stats.elims += you.elims
  next.stats.deaths += you.deaths
  next.stats.damage += you.damage
  next.stats.playTime += result.time
  next.stats.hazardElims += you.hazardElims
  next.stats.dashElims += you.dashElims
  next.stats.perfectDashes += you.perfectDashes
  next.stats.wallKicks += you.wallKicks
  next.stats.escapes += you.escapes
  next.stats.abilityHits += you.abilityHits
  if (you.place <= 3) next.stats.podiums += 1
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

  // Account xp, with every bonus itemized for the results screen.
  const xpLines: XpLine[] = [{ label: placeText(you.place), xp: PLACE_XP[clampIndex(you.place - 1)] ?? 24 }]
  if (you.elims > 0) xpLines.push({ label: `${you.elims} knockout${you.elims === 1 ? '' : 's'}`, xp: you.elims * 12 })
  const timeXp = Math.round(result.time / 12)
  if (timeXp > 0) xpLines.push({ label: 'Time played', xp: timeXp })
  if (!result.forfeit) {
    if (firstToday) xpLines.push({ label: `Day ${next.daily.streak} streak`, xp: 20 + 10 * Math.min(7, next.daily.streak) })
    if (you.won && next.daily.firstWinDay !== today) {
      next.daily.firstWinDay = today
      xpLines.push({ label: 'First win of the day', xp: FIRST_WIN_XP })
      next.coins += FIRST_WIN_COINS
      grants.push({ id: 'first-win', name: 'First win of the day', detail: `+${FIRST_WIN_COINS} coins`, kind: 'coins' })
    }
    if (you.won && next.stats.currentStreak >= 2) {
      xpLines.push({ label: `Win streak ${next.stats.currentStreak}`, xp: 8 * Math.min(5, next.stats.currentStreak - 1) })
    }
  }
  const xp = xpLines.reduce((s, l) => s + l.xp, 0)
  next.accountXp += xp
  next.coins += matchCoins(you, result)

  // Mastery for the core you chose and the ability you ran. A forfeit earns none.
  const mastery: MasteryGain[] = []
  if (!result.forfeit) {
    const coreId = you.masteryCore || you.core
    const coreXp = 30 + you.elims * 12 + (you.won ? 25 : 0) + Math.max(0, 4 - you.place) * 5
    mastery.push(addMastery(next, 'core', coreId, coreXp, grants))
    const abilityXp = you.abilityUses > 0 ? 20 + you.abilityHits * 8 + you.elims * 6 + (you.won ? 20 : 0) : 8
    mastery.push(addMastery(next, 'ability', you.ability, abilityXp, grants))
  }

  // Account levels: coins every level, cosmetics on the listed ones.
  const afterLevel = levelFromXp(next.accountXp)
  for (let level = beforeLevel + 1; level <= afterLevel; level++) {
    const coins = levelCoins(level)
    next.coins += coins
    grants.push({ id: `level-${level}`, name: `Level ${level}`, detail: `+${coins} coins`, kind: 'level' })
  }
  if (next.matches === 1) {
    grantCosmetic(next, 'trail_comet', grants, 'First match')
    grantCosmetic(next, 'title_first_bounce', grants, 'First match')
    next.equipped.trail = 'trail_comet'
    next.equipped.title = 'title_first_bounce'
  }

  noteRecord(records, 'Biggest launch', you.bestLaunchM, next.records.biggestLaunch, (v) => (next.records.biggestLaunch = v))
  if (you.firstElimAt > 0 && (next.records.fastestElim === 0 || you.firstElimAt < next.records.fastestElim)) {
    next.records.fastestElim = you.firstElimAt
    records.push('Fastest knockout')
  }
  noteRecord(records, 'Longest life', you.longestLife, next.records.longestSurvival, (v) => (next.records.longestSurvival = v))
  noteRecord(records, 'Most knockouts', you.elims, next.records.mostElims, (v) => (next.records.mostElims = v))
  noteRecord(records, 'Highest momentum', you.maxMomentum, next.records.highestMomentum, (v) => (next.records.highestMomentum = v))
  noteRecord(records, 'Highest speed', you.maxSpeed, next.records.highestSpeed, (v) => (next.records.highestSpeed = v))
  noteRecord(records, 'Best multi-knockout', you.multiBest, next.records.bestMulti, (v) => (next.records.bestMulti = v))

  const mmrDelta = rateChange(next.mmr, you, result, 16)
  next.mmr = clampRating(next.mmr + mmrDelta)
  const ranked = settleRank(next, you, result, grants)

  const challenges = applyChallenges(next, you, result)
  let seasonXp = Math.round(xp * 0.85)
  for (const c of challenges) {
    if (!c.done || next.challenges.done.includes(c.id)) continue
    const def = CHALLENGES.find((x) => x.id === c.id)
    if (!def) continue
    next.challenges.done.push(c.id)
    next.coins += def.coins
    seasonXp += def.xp
    grants.push({ id: c.id, name: def.name, detail: `+${def.coins} coins · +${def.xp} season xp`, kind: 'challenge' })
    if (def.grant) grantCosmetic(next, def.grant, grants, 'Challenge')
  }
  seasonXp += paySweeps(next, grants, now)
  next.seasonXp += seasonXp
  claimSeason(next, grants, now)

  reconcile(next, grants)

  next.recent.unshift({
    id: result.matchId,
    mode: result.modeId,
    arena: result.arenaId,
    place: you.place,
    competitive: result.competitive,
    delta: ranked.delta,
    at: now.getTime(),
  })
  if (next.recent.length > 12) next.recent.pop()

  return {
    profile: next,
    grants,
    duplicate: false,
    rankDelta: ranked.delta,
    rankReason: ranked.reason,
    rankMove: ranked.move,
    levelUp: afterLevel - beforeLevel,
    coinsGained: next.coins - coinsBefore,
    xpGained: xp,
    xpLines,
    seasonXpGained: seasonXp,
    records,
    challenges,
    mastery,
    dayStreak: next.daily.streak,
  }
}

/**
 * Rotates challenges, rolls the season, and pays anything the profile has already earned
 * but not received: season-end rewards, and rewards added to levels, mastery, or
 * achievements after the player passed them. Run it when a profile loads.
 */
export function refresh(profile: Profile, now = new Date()): Grant[] {
  refreshChallenges(profile, now)
  const grants = rollSeason(profile, now)
  reconcile(profile, grants)
  return grants
}

/** Idempotent: grants only what is earned and missing. */
function reconcile(profile: Profile, grants: Grant[]): void {
  const level = levelFromXp(profile.accountXp)
  for (let l = 2; l <= level; l++) {
    const id = LEVEL_REWARDS[l]
    if (id) grantMissing(profile, id, grants, `Level ${l}`)
  }
  for (const [kind, book] of [
    ['core', profile.mastery],
    ['ability', profile.abilityMastery],
  ] as const) {
    for (const [id, xp] of Object.entries(book)) {
      const name = masteryName(kind, id)
      const top = masteryLevel(xp).level
      for (let l = 2; l <= top; l++) {
        const reward = masteryReward(kind, id, l)
        if (reward) grantMissing(profile, reward, grants, `${name} mastery ${l}`)
      }
    }
  }
  claimAchievements(profile, grants)
}

export function refreshChallenges(profile: Profile, now = new Date()): void {
  const day = dateKey(now)
  const week = weekKey(now)
  const c = profile.challenges
  if (c.dailyKey !== day) {
    rotate(profile, c.daily)
    c.dailyKey = day
    c.daily = pickChallenges('daily', day, 3)
    for (const id of c.daily) c.progress[id] = 0
  }
  if (c.weeklyKey !== week) {
    rotate(profile, c.weekly)
    c.weeklyKey = week
    c.weekly = pickChallenges('weekly', week, 3)
    for (const id of c.weekly) c.progress[id] = 0
  }
  if (c.sweeps.length > 30) c.sweeps.splice(0, c.sweeps.length - 30)
}

/** Clears the outgoing set so a challenge that rotates back in starts fresh. */
function rotate(profile: Profile, outgoing: string[]): void {
  const c = profile.challenges
  c.done = c.done.filter((id) => !outgoing.includes(id))
  for (const id of outgoing) delete c.progress[id]
}

/** The day streak, or 0 once a calendar day has been missed. */
export function liveDayStreak(profile: Profile, now = new Date()): number {
  const last = profile.daily.lastDay
  return last === dateKey(now) || last === dateKey(addDays(now, -1)) ? profile.daily.streak : 0
}

export function canReroll(profile: Profile, now = new Date()): boolean {
  return profile.challenges.rerollDay !== dateKey(now)
}

/** Swaps one unfinished challenge for another of the same cadence. Once per day. */
export function rerollChallenge(profile: Profile, id: string, now = new Date()): Profile | null {
  const next = structuredClone(profile)
  refreshChallenges(next, now)
  const c = next.challenges
  const day = dateKey(now)
  if (c.rerollDay === day || c.done.includes(id)) return null
  const cadence = c.daily.includes(id) ? 'daily' : c.weekly.includes(id) ? 'weekly' : null
  if (!cadence) return null
  const list = cadence === 'daily' ? c.daily : c.weekly
  const pool = CHALLENGES.filter((d) => d.cadence === cadence && !list.includes(d.id)).map((d) => d.id)
  if (pool.length === 0) return null
  const pick = pool[hash(`${day}:${id}`) % pool.length]!
  list[list.indexOf(id)] = pick
  delete c.progress[id]
  c.progress[pick] = 0
  c.rerollDay = day
  return next
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

export function achievementValue(profile: Profile, stat: AchievementDef['stat']): number {
  switch (stat) {
    case 'arenas':
      return Object.keys(profile.stats.arenaPlays).length
    case 'biggestLaunch':
      return profile.records.biggestLaunch
    case 'bestMulti':
      return profile.records.bestMulti
    case 'masteryLevel':
      return Math.max(1, ...[...Object.values(profile.mastery), ...Object.values(profile.abilityMastery)].map((xp) => masteryLevel(xp).level))
    default:
      return profile.stats[stat]
  }
}

export function achievementProgress(profile: Profile, def: AchievementDef): { tier: number; value: number; target: number | null } {
  const tier = profile.achievements[def.id] ?? 0
  return { tier, value: achievementValue(profile, def.stat), target: def.tiers[tier] ?? null }
}

export function challengeDef(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id)
}

function claimAchievements(profile: Profile, grants: Grant[]): void {
  for (const def of ACHIEVEMENTS) {
    let tier = profile.achievements[def.id] ?? 0
    const value = achievementValue(profile, def.stat)
    while (tier < def.tiers.length && value >= def.tiers[tier]!) {
      const coins = def.coins[tier] ?? 0
      tier += 1
      profile.coins += coins
      grants.push({ id: `${def.id}-${tier}`, name: `${def.name} ${roman(tier)}`, detail: `+${coins} coins`, kind: 'achievement' })
      if (tier === def.tiers.length && def.grant) grantCosmetic(profile, def.grant, grants, def.name)
    }
    profile.achievements[def.id] = tier
  }
}

function addMastery(profile: Profile, kind: 'core' | 'ability', id: string, gained: number, grants: Grant[]): MasteryGain {
  const book = kind === 'core' ? profile.mastery : profile.abilityMastery
  const before = masteryLevel(book[id] ?? 0).level
  book[id] = Math.min(MASTERY_LEVELS[MASTERY_LEVELS.length - 1]!, (book[id] ?? 0) + gained)
  const after = masteryLevel(book[id]!).level
  const name = masteryName(kind, id)
  for (let level = before + 1; level <= after; level++) {
    const coins = 15 * level
    profile.coins += coins
    grants.push({ id: `mastery-${kind}-${id}-${level}`, name: `${name} mastery ${level}`, detail: `+${coins} coins`, kind: 'mastery' })
  }
  return { kind, id, name, gained, xp: book[id]!, levelsGained: after - before }
}

function masteryName(kind: 'core' | 'ability', id: string): string {
  return (kind === 'core' ? CORES : ABILITIES).find((d) => d.id === id)?.name ?? id
}

function settleRank(profile: Profile, you: Placement, result: MatchResult, grants: Grant[]): { delta: number; reason: string; move: 'up' | 'down' | '' } {
  const rank = profile.rank
  if (!result.competitive) return { delta: 0, reason: 'Casual matches do not move your rank.', move: '' }
  profile.stats.rankedMatches += 1
  rank.seasonMatches += 1
  const placing = rank.placementsLeft > 0
  const tierBefore = rankTierIndex(rank.rating)
  let delta: number
  let reason: string
  if (result.forfeit) {
    delta = -12
    reason = 'Forfeit counted as a loss.'
    rank.streak = 0
  } else {
    const k = placing ? 40 : rank.rating >= 1900 ? 16 : 24
    delta = rateChange(rank.rating, you, result, k)
    if (you.won) {
      profile.stats.rankedWins += 1
      rank.seasonWins += 1
      rank.streak += 1
    } else rank.streak = 0
    const bonus = delta > 0 && rank.streak >= 3 ? Math.min(6, 2 * (rank.streak - 2)) : 0
    delta += bonus
    reason = explainRank(delta, you.place, averageField(result, you.id), rank.placementsLeft - (placing ? 1 : 0), bonus)
  }
  let rating = clampRating(rank.rating + delta)
  if (!placing && rank.shield > 0) {
    const floor = RANK_TIERS[tierBefore]!.min
    if (rating < floor) {
      rating = floor
      reason += ' · shield held'
    }
    rank.shield -= 1
  }
  delta = rating - rank.rating
  rank.rating = rating
  if (placing) rank.placementsLeft -= 1
  const tierAfter = rankTierIndex(rating)
  const label = rankName(rating).label
  let move: 'up' | 'down' | '' = ''
  if (placing && rank.placementsLeft === 0) {
    grants.push({ id: 'placed', name: `Placed ${label}`, detail: 'Placements done', kind: 'rank' })
  } else if (!placing && tierAfter > tierBefore) {
    move = 'up'
    rank.shield = SHIELD_MATCHES
    grants.push({ id: 'promoted', name: `Promoted to ${RANK_TIERS[tierAfter]!.name}`, detail: `${SHIELD_MATCHES}-match shield`, kind: 'rank' })
  } else if (!placing && tierAfter < tierBefore) move = 'down'
  rank.lastDelta = delta
  rank.lastReason = reason
  if (rating > rank.peak) {
    rank.peak = rating
    rank.peakLabel = label
  }
  if (rating >= 1300) {
    grantCosmetic(profile, 'title_gold', grants, 'Gold')
    grantCosmetic(profile, 'impact_glyph', grants, 'Gold')
  }
  return { delta, reason, move }
}

function claimSeason(profile: Profile, grants: Grant[], now: Date): void {
  const season = currentSeason(now)
  if (!season || season.id !== profile.seasonId) return
  while (profile.seasonClaimed < season.tiers.length && profile.seasonXp >= season.tiers[profile.seasonClaimed]!.xp) {
    const tier = season.tiers[profile.seasonClaimed]!
    if (tier.cosmetic) grantCosmetic(profile, tier.cosmetic, grants, season.name)
    if (tier.coins) {
      profile.coins += tier.coins
      grants.push({ id: `season-${profile.seasonClaimed}`, name: `${tier.coins} coins`, detail: `${season.name} · ${tier.name}`, kind: 'season' })
    }
    profile.seasonClaimed += 1
  }
  if (profile.seasonClaimed < season.tiers.length) return
  const last = season.tiers[season.tiers.length - 1]!.xp
  const earned = Math.floor(Math.max(0, profile.seasonXp - last) / OVERTIME_XP)
  if (earned > profile.seasonOvertime) {
    const coins = (earned - profile.seasonOvertime) * OVERTIME_COINS
    profile.seasonOvertime = earned
    profile.coins += coins
    grants.push({ id: 'overtime', name: `${coins} coins`, detail: `${season.name} · Overtime`, kind: 'season' })
  }
}

function paySweeps(profile: Profile, grants: Grant[], now: Date): number {
  const c = profile.challenges
  let xp = 0
  for (const [cadence, list, key] of [
    ['daily', c.daily, `d:${dateKey(now)}`],
    ['weekly', c.weekly, `w:${weekKey(now)}`],
  ] as const) {
    if (list.length === 0 || c.sweeps.includes(key) || !list.every((id) => c.done.includes(id))) continue
    const bonus = SWEEP_BONUS[cadence]
    c.sweeps.push(key)
    profile.coins += bonus.coins
    xp += bonus.xp
    grants.push({ id: `sweep-${cadence}`, name: cadence === 'daily' ? 'Daily sweep' : 'Weekly sweep', detail: `+${bonus.coins} coins · +${bonus.xp} season xp`, kind: 'challenge' })
  }
  return xp
}

function rollSeason(profile: Profile, now: Date): Grant[] {
  const season = currentSeason(now)
  const id = season?.id ?? 'offseason'
  const rank = profile.rank
  if (rank.seasonId === id) return []
  const grants: Grant[] = []
  const ended = seasonById(rank.seasonId)
  if (ended && rank.seasonMatches > 0 && !rank.history.some((h) => h.seasonId === ended.id)) {
    const coins = SEASON_END_COINS[rankTierIndex(rank.peak)] ?? 0
    profile.coins += coins
    grants.push({ id: `season-end-${ended.id}`, name: `${ended.name} ended`, detail: `Peak ${rank.peakLabel} · +${coins} coins`, kind: 'season' })
    if (rank.peak >= 1300) grantCosmetic(profile, ended.endTitle, grants, `${ended.name} peak`)
    rank.history.unshift({
      seasonId: ended.id,
      name: ended.name,
      peak: rank.peak,
      peakLabel: rank.peakLabel,
      matches: rank.seasonMatches,
      wins: rank.seasonWins,
      coins,
    })
  }
  rank.seasonId = id
  rank.seasonMatches = 0
  rank.seasonWins = 0
  if (!season) return grants
  rank.rating = Math.round(1000 + (rank.rating - 1000) * 0.3)
  rank.placementsLeft = 5
  rank.shield = 0
  rank.streak = 0
  rank.peak = rank.rating
  rank.peakLabel = rankName(rank.rating).label
  profile.seasonId = season.id
  profile.seasonXp = 0
  profile.seasonClaimed = 0
  profile.seasonOvertime = 0
  return grants
}

function matchCoins(you: Placement, result: MatchResult): number {
  return 36 + (PLACE_XP[clampIndex(you.place - 1)] ?? 20) / 2 + you.elims * 6 + (result.competitive ? 10 : 0)
}

function levelCoins(level: number): number {
  return 20 + level * 2 + (level % 5 === 0 ? 100 : 0)
}

function grantCosmetic(profile: Profile, id: string, grants: Grant[], why: string): void {
  const item = cosmeticById(id)
  if (!item) return
  if (profile.owned.includes(id)) {
    profile.coins += DUPLICATE_REFUND
    grants.push({ id: `refund-${id}`, name: `${item.name} (owned)`, detail: `+${DUPLICATE_REFUND} coins`, kind: 'coins' })
    return
  }
  profile.owned.push(id)
  grants.push({ id, name: item.name, detail: why, kind: 'cosmetic' })
}

/** Grants without a duplicate refund. Safe to call every match. */
function grantMissing(profile: Profile, id: string, grants: Grant[], why: string): void {
  if (!profile.owned.includes(id)) grantCosmetic(profile, id, grants, why)
}

function noteRecord(records: string[], label: string, value: number, current: number, write: (v: number) => void): void {
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

function explainRank(delta: number, place: number, field: number, placementsLeft: number, bonus: number): string {
  const text = `placed #${place} in a lobby near ${Math.round(field)}${bonus ? ` · streak +${bonus}` : ''}`
  const sign = delta > 0 ? '+' : ''
  if (placementsLeft > 0) return `${sign}${delta} · placement match, ${text}`
  if (delta === 0) return `No change · ${text}`
  return `${sign}${delta} · ${text}`
}

function clampRating(n: number): number {
  return Math.max(700, Math.min(2800, n))
}

function clampIndex(i: number): number {
  return Math.min(PLACE_XP.length - 1, Math.max(0, i))
}

function placeText(place: number): string {
  return place === 1 ? 'Won the match' : `Placed #${place}`
}

function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][n - 1] ?? String(n)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

function applyChallenges(profile: Profile, you: Placement, result: MatchResult): ChallengeUpdate[] {
  const active = [...profile.challenges.daily, ...profile.challenges.weekly]
  const updates: ChallengeUpdate[] = []
  for (const id of active) {
    const def = challengeDef(id)
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
    case 'abilityHits':
      return you.abilityHits
    case 'matches':
      return 1
    case 'wins':
      return you.won ? 1 : 0
    case 'topThree':
      return you.place <= 3 ? 1 : 0
    case 'multi2':
      return you.multiBest >= 2 ? 1 : 0
    case 'ranked':
      return result.competitive && !result.forfeit ? 1 : 0
    case 'fastSurvival':
      return you.maxMomentum >= 0.8 && you.survival >= 20 ? 1 : 0
    case 'winNoAbility':
      return you.won && you.abilityUses === 0 ? 1 : 0
    case 'launch8':
      return you.bestLaunchM >= 8 ? 1 : 0
    case 'longLife':
      return you.longestLife >= 40 ? 1 : 0
    default:
      return 0
  }
}

function pickChallenges(cadence: 'daily' | 'weekly', key: string, count: number): string[] {
  const pool = CHALLENGES.filter((c) => c.cadence === cadence).map((c) => c.id)
  const out: string[] = []
  let h = hash(key)
  for (let guard = 0; out.length < count && out.length < pool.length && guard < 256; guard++) {
    h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0
    const id = pool[h % pool.length]!
    if (!out.includes(id)) out.push(id)
  }
  for (const id of pool) if (out.length < count && !out.includes(id)) out.push(id)
  return out
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
