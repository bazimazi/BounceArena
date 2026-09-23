import { describe, expect, it } from 'vitest'
import { Match } from '../src/sim/match'
import { Session } from '../src/sim/session'
import type { MatchConfig, PlayerConfig } from '../src/core/types'
import { buildMatchConfig } from '../src/game/setup'
import { defaultProfile } from '../src/progression/profile'

function player(id: string, bot: boolean, team = 0): PlayerConfig {
  return {
    id,
    name: id,
    team,
    bot,
    botLevel: 'rival',
    skill: bot ? 0.55 : 1,
    aggression: 0.7,
    color: '#ff4d3a',
    pattern: 0,
    core: 'stable',
    shell: 'rubber',
    ability: 'shockwave',
    passive: 'none',
    masteryCore: 'stable',
    trail: 'trail_none',
    impact: 'impact_ring',
    skin: 'skin_classic',
    emote: 'emote_nice',
    title: '',
    rating: 1000,
  }
}

function config(extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 42,
    matchId: 'test-match',
    modeId: 'ffa',
    arenaId: 'classic',
    duration: 20,
    stocks: 2,
    competitive: false,
    teams: false,
    win: 'last',
    suddenDeath: true,
    respawn: 'stocks',
    events: 'quiet',
    zone: false,
    scoreLimit: 0,
    players: [player('you', false, 0), player('bot-1', true, 1), player('bot-2', true, 2)],
    recordReplay: true,
    ...extra,
  }
}

function skipIntro(match: Match): void {
  match.countdownTicks = 0
  match.status = 'playing'
}

describe('matches', () => {
  it('lets a slow steer skate the rim and a fast line punch through', () => {
    const slow = new Match(config({ players: [player('you', false, 0), player('hold', false, 1)], stocks: 3 }))
    skipIntro(slow)
    const you = slow.players[0]!
    you.x = 300
    you.y = 0
    you.vx = 0
    you.vy = 0
    slow.players[1]!.x = 0
    slow.players[1]!.y = 0
    for (let i = 0; i < 240; i++) {
      slow.step({ you: { x: 1, y: 0, dash: false, ability: false, brake: false, emote: false } })
    }
    expect(you.stats.deaths).toBe(0)
    expect(you.alive).toBe(true)
    expect(you.x).toBeLessThan(450)

    const fast = new Match(config({ players: [player('you', false, 0), player('hold', false, 1)], stocks: 3 }))
    skipIntro(fast)
    const cruiser = fast.players[0]!
    cruiser.x = 300
    cruiser.y = 0
    cruiser.vx = 760
    cruiser.vy = 0
    fast.players[1]!.x = 0
    fast.players[1]!.y = 0
    for (let i = 0; i < 90; i++) fast.step({ you: { x: 1, y: 0, dash: false, ability: false, brake: false, emote: false } })
    expect(cruiser.stats.deaths).toBe(0)
    expect(cruiser.alive).toBe(true)

    const dashed = new Match(config({ players: [player('you', false, 0), player('hold', false, 1)], stocks: 1, respawn: 'never' }))
    skipIntro(dashed)
    const flyer = dashed.players[0]!
    flyer.x = 400
    flyer.y = 0
    flyer.vx = 0
    flyer.vy = 0
    dashed.players[1]!.x = 0
    dashed.players[1]!.y = 0
    dashed.step({ you: { x: 1, y: 0, dash: true, ability: false, brake: false, emote: false } })
    for (let i = 0; i < 90; i++) dashed.step({ you: { x: 1, y: 0, dash: false, ability: false, brake: false, emote: false } })
    expect(flyer.stats.deaths).toBe(1)
  })

  it('eliminates a ball that leaves the arena', () => {
    const match = new Match(config({ stocks: 1, respawn: 'never' }))
    skipIntro(match)
    const you = match.players[0]!
    you.x = 900
    you.y = 0
    you.vx = 400
    for (let i = 0; i < 120; i++) match.step({ you: { x: 1, y: 0, dash: false, ability: false, brake: false, emote: false } })
    expect(you.alive).toBe(false)
    expect(you.stats.deaths).toBeGreaterThan(0)
  })

  it('starts a dash cooldown and will not refresh it while held', () => {
    const match = new Match(config())
    skipIntro(match)
    const you = match.players[0]!
    match.step({ you: { x: 1, y: 0, dash: true, ability: false, brake: false, emote: false } })
    const cd = you.dashCd
    expect(cd).toBeGreaterThan(1)
    expect(you.stats.dashes).toBe(1)
    match.step({ you: { x: 1, y: 0, dash: true, ability: false, brake: false, emote: false } })
    expect(you.stats.dashes).toBe(1)
    expect(you.dashCd).toBeLessThan(cd)
  })

  it('rejects a teleport hidden inside input', () => {
    const match = new Match(config())
    skipIntro(match)
    const you = match.players[0]!
    const x = you.x
    match.step({ you: { x: Number.NaN, y: 9999, dash: false, ability: false, brake: false, emote: false } })
    expect(Number.isFinite(you.x)).toBe(true)
    expect(Math.abs(you.x - x)).toBeLessThan(80)
  })

  it('replays the same positions from the input log', () => {
    const first = new Match(config({ duration: 8, players: [player('you', false, 0), player('bot-1', true, 1)] }))
    for (let i = 0; i < 400; i++) {
      first.step({
        you: {
          x: Math.sin(i / 18),
          y: Math.cos(i / 22),
          dash: i % 50 === 0,
          ability: i % 80 === 0,
          brake: i % 67 === 0,
          emote: false,
        },
      })
    }
    const second = new Match(config({ duration: 8, players: [player('you', false, 0), player('bot-1', true, 1)] }))
    second.replayMode = true
    second.inputLog = first.inputLog
    for (let i = 0; i < 400; i++) second.step({})
    expect(second.players[0]!.x).toBeCloseTo(first.players[0]!.x, 3)
    expect(second.players[1]!.y).toBeCloseTo(first.players[1]!.y, 3)
    expect(second.players[0]!.stats.dashes).toBe(first.players[0]!.stats.dashes)
  })

  it('finishes a bot match without NaN or unbounded speed', () => {
    const match = new Match(config({
      duration: 25,
      players: [0, 1, 2, 3].map((i) => player(`b${i}`, true, i)),
      events: 'standard',
    }))
    let guard = 0
    while (match.status !== 'finished' && guard < 60 * 50) {
      match.step({})
      guard += 1
      for (const p of match.players) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(981)
      }
    }
    expect(match.status).toBe('finished')
    const elims = match.players.reduce((s, p) => s + p.stats.elims, 0)
    const deaths = match.players.reduce((s, p) => s + p.stats.deaths, 0)
    expect(deaths).toBeGreaterThan(0)
    expect(elims + deaths).toBeGreaterThan(0)
  })
})

describe('session', () => {
  it('drops stale inputs and takes over after silence', () => {
    const session = new Session(config())
    for (let i = 0; i < 260; i++) session.step()
    expect(session.match.playTick).toBeGreaterThan(8)
    expect(session.submit('you', 0, { x: 1, y: 0, dash: false, ability: false, brake: false, emote: false })).toBe(false)
    const you = session.match.players[0]!
    for (let i = 0; i < 400; i++) session.step()
    expect(you.auto).toBe(true)
  })
})

describe('matchmaking', () => {
  it('normalizes ranked balls and keeps the chosen ability', () => {
    const profile = defaultProfile()
    profile.loadout = { core: 'heavy', shell: 'spiked', ability: 'blink', passive: 'glider' }
    const built = buildMatchConfig(profile, { modeId: 'duel', arenaId: 'classic', competitive: true, players: 2, seed: 7 })
    expect(built.competitive).toBe(true)
    expect(built.players[0]!.ability).toBe('blink')
    expect(built.players[0]!.masteryCore).toBe('heavy')
    const match = new Match(built)
    expect(match.players[0]!.core).toBe('stable')
    expect(match.players[0]!.shell).toBe('rubber')
    expect(match.players[0]!.passive).toBe('none')
    expect(match.players[0]!.ability).toBe('blink')
  })
})
