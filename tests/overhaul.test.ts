import { describe, expect, it } from 'vitest'
import { heatMul, resolvePair, type ImpactBody } from '../src/sim/impact'
import { Match } from '../src/sim/match'
import { createBody } from '../src/sim/body'
import { resolveCircleWall } from '../src/sim/geometry'
import { radialDeadzone } from '../src/input/input'
import { botEase, buildMatchConfig } from '../src/game/setup'
import { defaultProfile } from '../src/progression/profile'
import { ARENAS, MUTATORS, dailyTwist, mutatorById } from '../src/data/content'
import { TUNE } from '../src/data/tuning'
import type { MatchConfig, PlayerConfig } from '../src/core/types'

function impact(partial: Partial<ImpactBody>): ImpactBody {
  return {
    x: 0, y: 0, vx: 0, vy: 0, radius: 22, mass: 1, restitution: 1, outgoing: 1, incoming: 1,
    momentum: 0.4, dashTime: 0, anchorTime: 0, mirrorTime: 0, overdriveTime: 0, phaseTime: 0,
    invuln: 0, team: 0, decoy: false, id: 'a', ownerId: '', heat: 0,
    ...partial,
  }
}

function player(id: string, bot: boolean, team = 0): PlayerConfig {
  return {
    id, name: id, team, bot, botLevel: 'rival', skill: bot ? 0.55 : 1, aggression: 0.7,
    color: '#ff4d3a', pattern: 0, core: 'stable', shell: 'rubber', ability: 'shockwave', passive: 'none',
    masteryCore: 'stable', trail: 'trail_none', impact: 'impact_ring', skin: 'skin_classic',
    emote: 'emote_nice', title: '', rating: 1000,
  }
}

function config(extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 7, matchId: 'overhaul', modeId: 'ffa', arenaId: 'classic', duration: 30, stocks: 3,
    competitive: false, teams: false, win: 'last', suddenDeath: false, respawn: 'stocks',
    events: 'quiet', zone: false, scoreLimit: 0, recordReplay: true,
    players: [player('you', false, 0), player('foe', false, 1)],
    ...extra,
  }
}

const still = { x: 0, y: 0, dash: false, ability: false, brake: false, emote: false }

describe('heat', () => {
  it('launches a hotter ball farther from the same hit', () => {
    const cold = impact({ id: 'b', x: 40, team: 1 })
    const hot = impact({ id: 'b', x: 40, team: 1, heat: 120 })
    resolvePair(impact({ vx: 520 }), cold, false)
    resolvePair(impact({ vx: 520 }), hot, false)
    expect(Math.hypot(hot.vx, hot.vy)).toBeGreaterThan(Math.hypot(cold.vx, cold.vy) * 1.5)
    expect(Math.hypot(hot.vx, hot.vy)).toBeLessThanOrEqual(981)
    expect(heatMul(0)).toBe(1)
    expect(heatMul(100)).toBeCloseTo(1 + TUNE.heatScale)
  })

  it('builds on the victim of a strike and resets on respawn', () => {
    const match = new Match(config())
    match.countdownTicks = 0
    match.status = 'playing'
    const [you, foe] = match.players as [typeof match.players[0], typeof match.players[0]]
    you.invuln = 0
    foe.invuln = 0
    you.x = -60
    you.y = 0
    you.vx = 600
    foe.x = -10
    foe.y = 0
    match.step({ you: { ...still, x: 1 }, foe: still })
    expect(foe.heat).toBeGreaterThan(5)
    expect(you.heat).toBe(0)
    expect(foe.stats.peakHeat).toBeCloseTo(foe.heat)
    // Throw the foe off the floor and let it respawn.
    foe.x = 900
    for (let i = 0; i < 200; i++) match.step({ you: still, foe: still })
    expect(foe.stats.deaths).toBe(1)
    expect(foe.alive).toBe(true)
    expect(foe.heat).toBe(0)
  })
})

describe('launch steering', () => {
  it('bends a launch toward the side the victim steers', () => {
    const left = impact({ id: 'b', x: 40, team: 1, input: { x: 0, y: -1 } })
    const right = impact({ id: 'b', x: 40, team: 1, input: { x: 0, y: 1 } })
    const none = impact({ id: 'b', x: 40, team: 1 })
    for (const v of [left, right, none]) resolvePair(impact({ vx: 520 }), v, false)
    expect(left.vy).toBeLessThan(-20)
    expect(right.vy).toBeGreaterThan(20)
    expect(Math.abs(none.vy)).toBeLessThan(1)
    const bend = Math.abs(Math.atan2(left.vy, left.vx))
    expect(bend).toBeLessThanOrEqual(TUNE.diAngle + 1e-6)
  })
})

describe('interpolation', () => {
  it('keeps where each ball started the tick', () => {
    const match = new Match(config())
    match.countdownTicks = 0
    match.status = 'playing'
    const you = match.players[0]!
    you.vx = 300
    const before = you.x
    match.step({ you: { ...still, x: 1 }, foe: still })
    expect(you.prevX).toBeCloseTo(before)
    expect(you.x).toBeGreaterThan(before)
  })
})

describe('soft lobbies', () => {
  it('eases bots for new players and never in ranked', () => {
    const fresh = defaultProfile()
    expect(botEase(fresh, false, 'ffa')).toBeLessThan(0.6)
    expect(botEase(fresh, true, 'duel')).toBe(1)
    expect(botEase({ ...fresh, matches: 40, recent: [] }, false, 'ffa')).toBe(1)
    const cfg = buildMatchConfig(fresh, { modeId: 'ffa', arenaId: 'classic', competitive: false, players: 6, seed: 3 })
    const bots = cfg.players.filter((p) => p.bot)
    expect(bots.every((p) => (p.pace ?? 1) < 1)).toBe(true)
    const vet = buildMatchConfig({ ...fresh, matches: 40 }, { modeId: 'ffa', arenaId: 'classic', competitive: false, players: 6, seed: 3 })
    expect(vet.players.filter((p) => p.bot).every((p) => (p.pace ?? 1) === 1)).toBe(true)
  })

  it('only slows bots, never the human', () => {
    const human = createBody({ ...player('you', false), pace: 0.6 }, 3, false)
    const bot = createBody({ ...player('b', true), pace: 0.6 }, 3, false)
    const full = createBody(player('c', true), 3, false)
    expect(human.maxSpeed).toBe(full.maxSpeed)
    expect(bot.maxSpeed).toBeLessThan(full.maxSpeed)
  })
})

describe('mutators and the daily twist', () => {
  it('picks the same valid twist for a date', () => {
    const day = new Date(2026, 10, 13)
    const a = dailyTwist(day)
    const b = dailyTwist(day)
    expect(a).toEqual(b)
    expect(a.mutators).toHaveLength(2)
    expect(new Set(a.mutators).size).toBe(2)
    for (const id of a.mutators) expect(mutatorById(id)).toBeDefined()
    expect(ARENAS.some((x) => x.id === a.arenaId)).toBe(true)
  })

  it('varies across a month', () => {
    const seen = new Set<string>()
    for (let d = 1; d <= 30; d++) seen.add(dailyTwist(new Date(2026, 10, d)).name)
    expect(seen.size).toBeGreaterThan(8)
  })

  it('changes the ball rules', () => {
    const base = createBody(player('a', false), 3, false)
    const giant = createBody(player('a', false), 3, false, ['giant'])
    const frenzy = createBody(player('a', false), 3, false, ['frenzy'])
    expect(giant.radius).toBeGreaterThan(base.radius)
    expect(frenzy.dashCdMax).toBeLessThan(base.dashCdMax)
    expect(frenzy.abilityCdMax).toBeLessThan(base.abilityCdMax)
    expect(MUTATORS.length).toBeGreaterThanOrEqual(6)
  })

  it('runs every mutator to the buzzer without NaN', () => {
    for (const m of MUTATORS) {
      const match = new Match(config({
        duration: 12,
        mutators: [m.id],
        players: [0, 1, 2, 3].map((i) => player(`b${i}`, true, i)),
      }))
      for (let i = 0; i < 60 * 20 && match.status !== 'finished'; i++) {
        match.step({})
        for (const p of match.players) {
          expect(Number.isFinite(p.x)).toBe(true)
          expect(Number.isFinite(p.heat)).toBe(true)
        }
      }
      expect(match.status).toBe('finished')
    }
  })
})

describe('turbine', () => {
  it('a spinning blade carries a resting ball with it', () => {
    // A blade along +x spinning counter-clockwise moves +y at x=150.
    const out = resolveCircleWall(150, 15, 0, 0, 22, { x1: 70, y1: 0, x2: 270, y2: 0, restitution: 1, lethal: false, spin: 0.62 })
    expect(out.hit).toBe(true)
    expect(out.vy).toBeGreaterThan(50)
  })

  it('plays a full bot match', () => {
    const match = new Match(config({ arenaId: 'turbine', duration: 20, players: [0, 1, 2, 3, 4].map((i) => player(`b${i}`, true, i)) }))
    for (let i = 0; i < 60 * 30 && match.status !== 'finished'; i++) match.step({})
    expect(match.status).toBe('finished')
  })
})

describe('gamepad deadzone', () => {
  it('is radial and rescaled', () => {
    expect(radialDeadzone(0.1, 0.05, 0.15)).toEqual({ x: 0, y: 0 })
    const full = radialDeadzone(1, 0, 0.15)
    expect(full.x).toBeCloseTo(1)
    const diag = radialDeadzone(0.5, 0.5, 0.15)
    // Direction is kept exactly, no snapping to an axis.
    expect(diag.x).toBeCloseTo(diag.y)
    const just = radialDeadzone(0.2, 0, 0.15)
    expect(just.x).toBeGreaterThan(0)
    expect(just.x).toBeLessThan(0.1)
  })
})

describe('forfeits', () => {
  it('never hands the forfeiter a team win', () => {
    const match = new Match(config({
      teams: true,
      players: [player('you', false, 0), player('mate', true, 0), player('f1', true, 1), player('f2', true, 1)],
    }))
    match.countdownTicks = 0
    match.status = 'playing'
    match.players[1]!.stats.score = 500
    match.forfeit('you')
    const result = match.toResult('you')
    const you = result.placements.find((p) => p.id === 'you')!
    expect(you.won).toBe(false)
    expect(you.place).toBe(4)
    expect(result.placements.find((p) => p.id === 'mate')!.won).toBe(true)
  })
})

describe('heat edge cases', () => {
  it('scales a mirror reflection by the striker heat, not the mirror holder', () => {
    const cool = impact({ vx: 520 })
    const hotHolder = impact({ id: 'b', x: 40, team: 1, mirrorTime: 1, heat: 150 })
    const out = resolvePair(cool, hotHolder, false)
    expect(out.kind).toBe('mirror')
    expect(out.power).toBeCloseTo(out.base ?? 0)
    const hotStriker = impact({ vx: 520, heat: 150 })
    const holder = impact({ id: 'b', x: 40, team: 1, mirrorTime: 1 })
    const back = resolvePair(hotStriker, holder, false)
    expect(back.power).toBeGreaterThan((back.base ?? 0) * 1.5)
  })

  it('reports the pre-heat power for stats and numbers', () => {
    const out = resolvePair(impact({ vx: 400 }), impact({ id: 'b', x: 40, team: 1, heat: 100 }), false)
    expect(out.kind).toBe('strike')
    expect(out.base).toBeDefined()
    expect(out.power).toBeGreaterThan(out.base! * 1.5)
  })

  it('never pairs low gravity with black ice', () => {
    for (let d = 0; d < 730; d++) {
      const t = dailyTwist(new Date(2026, 0, 1 + d))
      expect(t.mutators.includes('lowgrav') && t.mutators.includes('ice')).toBe(false)
    }
  })
})
