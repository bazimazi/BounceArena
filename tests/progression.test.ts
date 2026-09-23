import { describe, expect, it } from 'vitest'
import { defaultProfile, memoryStore, loadProfile, saveProfile, levelFromXp } from '../src/progression/profile'
import { settle } from '../src/progression/settle'
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
