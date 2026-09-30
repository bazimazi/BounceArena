import { describe, expect, it } from 'vitest'
import { defaultProfile, memoryStore, loadProfile, saveProfile, levelFromXp, xpForLevel } from '../src/progression/profile'
import { achievementProgress, canReroll, liveDayStreak, refresh, refreshChallenges, rerollChallenge, settle } from '../src/progression/settle'
import { ACHIEVEMENTS, CHALLENGES, masteryLevel } from '../src/data/content'
import type { MatchResult, Placement } from '../src/core/types'

function placement(partial: Partial<Placement> = {}): Placement {
  return {
    id: 'you',
    name: 'Player',
    team: 0,
    place: 1,
    bot: false,
    color: '#fff',
    core: 'stable',
    masteryCore: 'heavy',
    ability: 'shockwave',
    rating: 1000,
    elims: 2,
    deaths: 1,
    damage: 800,
    damageTaken: 200,
    score: 200,
    survival: 40,
    maxSpeed: 600,
    maxMomentum: 0.8,
    bestImpact: 400,
    bestLaunchM: 4,
    dashes: 3,
    dashHits: 1,
    dashElims: 1,
    perfectDashes: 1,
    abilityUses: 1,
    abilityHits: 1,
    hazardElims: 0,
    escapes: 1,
    multiBest: 1,
    wallKicks: 0,
    stocksLeft: 1,
    longestLife: 20,
    firstElimAt: 12,
    behindAtMid: false,
    won: true,
    ...partial,
  }
}

function result(partial: Partial<MatchResult> = {}, you: Partial<Placement> = {}): MatchResult {
  const mine = placement(you)
  return {
    matchId: 'm1',
    seed: 1,
    modeId: 'ffa',
    arenaId: 'classic',
    competitive: false,
    duration: 80,
    time: 40,
    forfeit: false,
    youId: 'you',
    placements: [
      mine,
      placement({ id: 'b1', name: 'Pebble', place: 2, won: false, rating: 1000, team: 1 }),
      placement({ id: 'b2', name: 'Comet', place: 3, won: false, rating: 1000, team: 2 }),
    ],
    moments: [],
    replayHumans: [],
    humanIds: ['you'],
    ...partial,
  }
}

describe('progression', () => {
  it('pays a match once', () => {
    const profile = defaultProfile()
    const first = settle(profile, result())
    const again = settle(first.profile, result())
    expect(first.duplicate).toBe(false)
    expect(first.xpGained).toBeGreaterThan(0)
    expect(again.duplicate).toBe(true)
    expect(again.profile.coins).toBe(first.profile.coins)
    expect(again.profile.accountXp).toBe(first.profile.accountXp)
  })

  it('moves ranked rating up for a first place and explains it', () => {
    const profile = defaultProfile()
    profile.rank.placementsLeft = 0
    const out = settle(profile, result({ competitive: true }))
    expect(out.rankDelta).toBeGreaterThan(0)
    expect(out.profile.rank.rating).toBeGreaterThan(1000)
    expect(out.rankReason.toLowerCase()).toContain('placed')
  })

  it('does not change rank in casual play', () => {
    const profile = defaultProfile()
    const out = settle(profile, result({ competitive: false }, { place: 6, won: false }))
    expect(out.profile.rank.rating).toBe(1000)
    expect(out.profile.mmr).not.toBe(1000)
  })

  it('grants the first-match trail once', () => {
    const profile = defaultProfile()
    const out = settle(profile, result())
    expect(out.profile.owned).toContain('trail_comet')
    expect(out.profile.equipped.trail).toBe('trail_comet')
    const second = settle(out.profile, result({ matchId: 'm2' }))
    expect(second.grants.some((g) => g.id === 'trail_comet')).toBe(false)
  })

  it('levels from xp', () => {
    expect(levelFromXp(0)).toBe(1)
    expect(levelFromXp(80)).toBeGreaterThan(1)
  })

  it('round-trips a profile through a store', () => {
    const store = memoryStore()
    const profile = defaultProfile()
    profile.name = 'Ricochet'
    saveProfile(profile, store)
    expect(loadProfile(store).name).toBe('Ricochet')
  })
})

const DAY = new Date(2026, 8, 30, 12)

function days(n: number): Date {
  const d = new Date(DAY.getTime())
  d.setDate(d.getDate() + n)
  return d
}

describe('daily bonuses', () => {
  it('pays the first win of the day once', () => {
    const first = settle(defaultProfile(), result(), DAY)
    expect(first.xpLines.some((l) => l.label === 'First win of the day')).toBe(true)
    expect(first.grants.some((g) => g.id === 'first-win')).toBe(true)
    const second = settle(first.profile, result({ matchId: 'm2' }), DAY)
    expect(second.xpLines.some((l) => l.label === 'First win of the day')).toBe(false)
    const tomorrow = settle(second.profile, result({ matchId: 'm3' }), days(1))
    expect(tomorrow.xpLines.some((l) => l.label === 'First win of the day')).toBe(true)
  })

  it('counts consecutive days and resets after a gap', () => {
    let p = settle(defaultProfile(), result(), DAY).profile
    p = settle(p, result({ matchId: 'm2' }), days(1)).profile
    const third = settle(p, result({ matchId: 'm3' }), days(2))
    expect(third.dayStreak).toBe(3)
    expect(liveDayStreak(third.profile, days(3))).toBe(3)
    expect(liveDayStreak(third.profile, days(5))).toBe(0)
    const gap = settle(third.profile, result({ matchId: 'm4' }), days(5))
    expect(gap.dayStreak).toBe(1)
    expect(gap.profile.daily.bestStreak).toBe(3)
  })

  it('itemizes xp so the lines add up', () => {
    const out = settle(defaultProfile(), result(), DAY)
    expect(out.xpLines.reduce((s, l) => s + l.xp, 0)).toBe(out.xpGained)
  })

  it('reports net coins including bonuses', () => {
    const profile = defaultProfile()
    const out = settle(profile, result(), DAY)
    expect(out.coinsGained).toBe(out.profile.coins - profile.coins)
  })
})

describe('challenges', () => {
  it('clears finished challenges when the set rotates', () => {
    const profile = defaultProfile()
    refreshChallenges(profile, DAY)
    const yesterday = [...profile.challenges.daily]
    profile.challenges.done.push(...yesterday)
    refreshChallenges(profile, days(1))
    for (const id of yesterday) expect(profile.challenges.done).not.toContain(id)
    for (const id of profile.challenges.daily) expect(profile.challenges.progress[id]).toBe(0)
  })

  it('rerolls one challenge per day within its cadence', () => {
    const profile = defaultProfile()
    refreshChallenges(profile, DAY)
    const target = profile.challenges.daily[0]!
    const next = rerollChallenge(profile, target, DAY)
    expect(next).not.toBeNull()
    expect(next!.challenges.daily).not.toContain(target)
    expect(new Set(next!.challenges.daily).size).toBe(3)
    expect(CHALLENGES.find((c) => c.id === next!.challenges.daily[0])?.cadence).toBe('daily')
    expect(canReroll(next!, DAY)).toBe(false)
    expect(rerollChallenge(next!, next!.challenges.daily[1]!, DAY)).toBeNull()
    expect(canReroll(next!, days(1))).toBe(true)
  })

  it('pays a sweep bonus when every daily is done', () => {
    const profile = defaultProfile()
    refreshChallenges(profile, DAY)
    profile.challenges.daily = ['d_podium', 'd_elims', 'd_dash']
    const out = settle(profile, result({}, { elims: 3, dashHits: 2 }), DAY)
    expect(out.grants.some((g) => g.id === 'sweep-daily')).toBe(true)
    expect(out.profile.challenges.sweeps).toContain(`d:${out.profile.challenges.dailyKey}`)
    const again = settle(out.profile, result({ matchId: 'm2' }, { elims: 3, dashHits: 2 }), DAY)
    expect(again.grants.some((g) => g.id === 'sweep-daily')).toBe(false)
  })
})

describe('mastery', () => {
  it('levels core and ability mastery and grants the ability title', () => {
    const profile = defaultProfile()
    profile.abilityMastery.shockwave = 890
    const out = settle(profile, result(), DAY)
    const ability = out.mastery.find((m) => m.kind === 'ability')!
    expect(ability.levelsGained).toBe(1)
    expect(out.profile.owned).toContain('title_ab_shockwave')
    expect(out.mastery.find((m) => m.kind === 'core')?.id).toBe('heavy')
    expect(out.profile.mastery.heavy).toBeGreaterThan(0)
  })

  it('caps mastery at the last level', () => {
    const profile = defaultProfile()
    profile.mastery.heavy = 3799
    const out = settle(profile, result(), DAY)
    expect(out.profile.mastery.heavy).toBe(3800)
    expect(masteryLevel(3800).max).toBe(true)
  })
})

describe('levels and achievements', () => {
  it('pays coins per level and catches up missed level rewards', () => {
    const profile = defaultProfile()
    profile.accountXp = xpForLevel(20)
    const out = settle(profile, result(), DAY)
    expect(out.profile.owned).toContain('frame_silver')
    expect(out.profile.owned).toContain('banner_grid')
    const fresh = settle(defaultProfile(), result(), DAY)
    expect(fresh.grants.some((g) => g.kind === 'level')).toBe(true)
  })

  it('claims achievement tiers with coins and the final cosmetic', () => {
    const profile = defaultProfile()
    profile.stats.matches = 9
    const out = settle(profile, result(), DAY)
    expect(out.profile.achievements.a_matches).toBe(1)
    expect(out.grants.some((g) => g.id === 'a_matches-1')).toBe(true)

    const vet = defaultProfile()
    vet.stats.matches = 199
    vet.achievements.a_matches = 2
    const done = settle(vet, result(), DAY)
    expect(done.profile.achievements.a_matches).toBe(3)
    expect(done.profile.owned).toContain('frame_iron')
    expect(achievementProgress(done.profile, ACHIEVEMENTS.find((a) => a.id === 'a_matches')!).target).toBeNull()
  })

  it('records the fastest knockout from the knockout time', () => {
    const out = settle(defaultProfile(), result({ time: 70 }, { firstElimAt: 9.5 }), DAY)
    expect(out.profile.records.fastestElim).toBe(9.5)
    const none = settle(defaultProfile(), result({}, { elims: 0, firstElimAt: 0 }), DAY)
    expect(none.profile.records.fastestElim).toBe(0)
  })
})

describe('rank', () => {
  it('shields a fresh promotion from an immediate drop', () => {
    const profile = defaultProfile()
    profile.rank.placementsLeft = 0
    profile.rank.rating = 1298
    const up = settle(profile, result({ competitive: true }), DAY)
    expect(up.rankMove).toBe('up')
    expect(up.profile.rank.rating).toBeGreaterThanOrEqual(1300)
    expect(up.profile.rank.shield).toBe(3)
    const loss = settle(up.profile, result({ matchId: 'm2', competitive: true }, { place: 3, won: false }), DAY)
    expect(loss.profile.rank.rating).toBe(1300)
    expect(loss.profile.rank.shield).toBe(2)
    expect(loss.rankReason).toContain('shield')
  })

  it('adds a streak bonus on the third ranked win in a row', () => {
    const profile = defaultProfile()
    profile.rank.placementsLeft = 0
    profile.rank.streak = 2
    const out = settle(profile, result({ competitive: true }), DAY)
    expect(out.rankReason).toContain('streak +2')
  })

  it('pays season-end rewards and soft resets into the next season', () => {
    const profile = defaultProfile()
    profile.rank.placementsLeft = 0
    profile.rank.rating = 1450
    profile.rank.peak = 1450
    profile.rank.peakLabel = 'Gold III'
    profile.rank.seasonMatches = 12
    profile.seasonXp = 900
    const out = settle(profile, result({ competitive: false }), new Date(2026, 11, 20, 12))
    expect(out.grants.some((g) => g.id === 'season-end-s1')).toBe(true)
    expect(out.profile.owned).toContain('title_s1_gold')
    expect(out.profile.rank.history[0]?.seasonId).toBe('s1')
    expect(out.profile.rank.seasonId).toBe('s2')
    expect(out.profile.seasonId).toBe('s2')
    expect(out.profile.rank.rating).toBe(1135)
    expect(out.profile.rank.placementsLeft).toBe(5)
    const again = settle(out.profile, result({ matchId: 'm2' }), new Date(2026, 11, 21, 12))
    expect(again.grants.some((g) => g.id.startsWith('season-end'))).toBe(false)
  })

  it('pays overtime past the last season tier', () => {
    const profile = defaultProfile()
    profile.seasonXp = 6200 + 390
    profile.seasonClaimed = 16
    const out = settle(profile, result(), DAY)
    expect(out.profile.seasonOvertime).toBeGreaterThanOrEqual(1)
    expect(out.grants.some((g) => g.id === 'overtime')).toBe(true)
  })
})

describe('refresh on load', () => {
  it('pays earned but missing rewards once, then nothing', () => {
    const profile = defaultProfile()
    profile.accountXp = xpForLevel(14)
    profile.stats.matches = 60
    profile.mastery.light = 1000
    const grants = refresh(profile, DAY)
    expect(profile.owned).toContain('banner_grid')
    expect(profile.owned).toContain('trail_wisp')
    expect(profile.achievements.a_matches).toBe(2)
    expect(grants.length).toBeGreaterThan(0)
    const coins = profile.coins
    expect(refresh(profile, DAY)).toEqual([])
    expect(profile.coins).toBe(coins)
  })

  it('keeps a forfeit out of mastery', () => {
    const out = settle(defaultProfile(), result({ forfeit: true }, { place: 3, won: false }), DAY)
    expect(out.mastery).toEqual([])
    expect(out.profile.mastery.heavy).toBeUndefined()
  })
})

describe('profile migration', () => {
  it('upgrades a v1 save without losing progress', () => {
    const v1 = {
      version: 1,
      name: 'Old',
      accountXp: 900,
      coins: 321,
      mastery: { heavy: 200 },
      stats: { matches: 12, abilityUses: { magnet: 40 } },
      challenges: { dailyKey: 'x', weeklyKey: 'y', daily: ['d_dash'], weekly: [], progress: {}, done: ['d_hazard', 'd_dash'] },
    }
    const profile = loadProfile(memoryStore(JSON.stringify(v1)))
    expect(profile.version).toBe(2)
    expect(profile.name).toBe('Old')
    expect(profile.coins).toBe(321)
    expect(profile.stats.matches).toBe(12)
    expect(profile.stats.rankedWins).toBe(0)
    expect(profile.challenges.done).toEqual(['d_dash'])
    expect(profile.challenges.sweeps).toEqual([])
    expect(profile.daily.streak).toBe(0)
    expect(profile.rank.history).toEqual([])
    expect(profile.abilityMastery.magnet).toBe(240)
  })
})
