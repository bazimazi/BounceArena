import { describe, expect, it } from 'vitest'
import { Match } from '../src/sim/match'
import { supportAt } from '../src/sim/geometry'
import { arenaById } from '../src/data/content'
import { TUNE } from '../src/data/tuning'
import type { InputFrame, MatchConfig, PlayerConfig } from '../src/core/types'

function player(id: string, bot: boolean, team = 0): PlayerConfig {
  return {
    id, name: id, team, bot, botLevel: 'rival', skill: bot ? 0.55 : 1, aggression: 0.7, color: '#ff4d3a', pattern: 0,
    core: 'stable', shell: 'rubber', ability: 'shockwave', passive: 'none', masteryCore: 'stable', trail: 'trail_none',
    impact: 'impact_ring', skin: 'skin_classic', emote: 'emote_nice', title: '', rating: 1000,
  }
}

function config(extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 7, matchId: 'feel', modeId: 'ffa', arenaId: 'classic', duration: 20, stocks: 2, competitive: false, teams: false,
    win: 'last', suddenDeath: true, respawn: 'stocks', events: 'quiet', zone: false, scoreLimit: 0,
    players: [player('you', false, 0), player('bot-1', true, 1)], recordReplay: false, ...extra,
  }
}

function live(): Match {
  const match = new Match(config())
  match.countdownTicks = 0
  match.status = 'playing'
  return match
}

const idle: InputFrame = { x: 0, y: 0, dash: false, ability: false, brake: false, emote: false }
const NO_SHRINK = { cut: 0, innerGrow: 0 }

describe('edge safety direction', () => {
  it('points straight inward from the side of a rectangular floor', () => {
    const sup = supportAt(arenaById('conveyor').solids, 480, 0, 0, NO_SHRINK, 1 / 60)
    expect(sup.safetyX).toBeCloseTo(-1)
    expect(sup.safetyY).toBeCloseTo(0)
  })

  it('still points back at the floor when far off it', () => {
    const sup = supportAt(arenaById('classic').solids, 700, 0, 0, NO_SHRINK, 1 / 60)
    expect(sup.supported).toBe(false)
    expect(sup.safetyX).toBeCloseTo(-1)
    expect(sup.safetyY).toBeCloseTo(0)
  })

  it('points out of the hole on the ring arena', () => {
    const sup = supportAt(arenaById('ring').solids, 20, 0, 0, NO_SHRINK, 1 / 60)
    expect(sup.supported).toBe(false)
    expect(sup.safetyX).toBeGreaterThan(0.9)
  })
})

describe('input buffering', () => {
  it('fires a dash pressed just before the cooldown ends', () => {
    const match = live()
    const you = match.players[0]!
    you.dashCd = TUNE.inputBuffer * 0.6
    match.step({ you: { ...idle, x: 1, dash: true } })
    expect(you.stats.dashes).toBe(0)
    for (let i = 0; i < 12; i++) match.step({ you: { ...idle, x: 1 } })
    expect(you.stats.dashes).toBe(1)
  })

  it('drops a press made well before the cooldown ends', () => {
    const match = live()
    const you = match.players[0]!
    you.dashCd = 1
    match.step({ you: { ...idle, x: 1, dash: true } })
    for (let i = 0; i < 70; i++) match.step({ you: { ...idle, x: 1 } })
    expect(you.stats.dashes).toBe(0)
  })

  it('shows no ability effect for a press during cooldown', () => {
    const match = live()
    const you = match.players[0]!
    match.step({ you: { ...idle, ability: true } })
    expect(match.consumeFx().filter((e) => e.type === 'ability' && e.actorId === 'you')).toHaveLength(1)
    match.step({ you: idle })
    match.step({ you: { ...idle, ability: true } })
    expect(match.consumeFx().filter((e) => e.type === 'ability' && e.actorId === 'you')).toHaveLength(0)
    expect(you.stats.abilityUses).toBe(1)
  })

  it('tags a dash on the landing frame as perfect', () => {
    const match = live()
    const you = match.players[0]!
    you.sinceLand = 0
    match.step({ you: { ...idle, x: 1, dash: true } })
    const dash = match.consumeFx().find((e) => e.type === 'dash' && e.actorId === 'you')
    expect(dash?.text).toBe('perfect')
  })
})

describe('open arenas', () => {
  it('tighten from mid-match', () => {
    const match = live()
    expect(match.arena.shrinkRate).toBeGreaterThan(0)
    match.playTick = Math.round((match.arena.shrinkDelay + 20) / (1 / 60))
    match.step({ you: idle })
    expect(match.shrink.cut).toBeGreaterThan(0)
  })
})
