import { describe, expect, it } from 'vitest'
import { Match } from '../src/sim/match'
import { stunFor } from '../src/sim/impact'
import { TUNE } from '../src/data/tuning'
import type { InputFrame, MatchConfig, PlayerConfig } from '../src/core/types'

function player(id: string, bot: boolean, team: number): PlayerConfig {
  return {
    id, name: id, team, bot, botLevel: 'rival', skill: 0.5, aggression: 0.6, color: '#ff4d3a', pattern: 0,
    core: 'stable', shell: 'rubber', ability: 'shockwave', passive: 'none', masteryCore: 'stable', trail: 'trail_none',
    impact: 'impact_ring', skin: 'skin_classic', emote: 'emote_nice', title: '', rating: 1000,
  }
}

function live(arenaId = 'classic', withBot = false): Match {
  const config: MatchConfig = {
    seed: 11, matchId: 'edge', modeId: 'ffa', arenaId, duration: 60, stocks: 3, competitive: false, teams: false,
    win: 'last', suddenDeath: false, respawn: 'stocks', events: 'quiet', zone: false, scoreLimit: 0,
    players: [player('you', false, 0), player('other', withBot, 1)], recordReplay: false,
  }
  const match = new Match(config)
  match.countdownTicks = 0
  match.status = 'playing'
  for (const p of match.players) p.invuln = 0
  // Park the second ball far away so it does not interfere.
  match.players[1]!.x = -300
  match.players[1]!.y = 0
  return match
}

const idle: InputFrame = { x: 0, y: 0, dash: false, ability: false, brake: false, emote: false }
const steer = (x: number, y: number, extra: Partial<InputFrame> = {}): InputFrame => ({ ...idle, x, y, ...extra })

describe('launch stun', () => {
  it('only takes control on heavy, heat-scaled launches', () => {
    expect(stunFor(450)).toBe(0)
    expect(stunFor(TUNE.stunFloor)).toBe(0)
    expect(stunFor(900)).toBeGreaterThan(0.1)
    expect(stunFor(5000)).toBe(TUNE.stunMax)
  })

  function struck(heat: number, speed: number, dash: boolean): number {
    const match = live()
    const [you, other] = match.players
    you!.x = 0
    you!.y = 0
    you!.heat = heat
    other!.x = -40
    other!.y = 0
    other!.vx = speed
    other!.dashTime = dash ? 0.15 : 0
    match.step({ you: idle })
    return you!.stun
  }

  it('a plain hit on a fresh ball never stuns; heat makes the same hit stun', () => {
    expect(struck(0, 420, false)).toBe(0)
    expect(struck(200, 420, false)).toBeGreaterThan(0)
  })

  it('stun grows with heat for the same strike', () => {
    expect(struck(180, 640, true)).toBeGreaterThan(struck(0, 640, true))
  })

  it('blocks steering, and a dash pressed during stun fires when it wears off', () => {
    const match = live()
    const you = match.players[0]!
    you.x = 0
    you.y = 0
    you.vx = 300
    you.stun = 0.2
    you.stunMax = 0.2
    match.step({ you: steer(-1, 0, { dash: true }) })
    expect(you.dashCd).toBe(0)
    expect(you.dashBuffer).toBeGreaterThan(0)
    let fired = -1
    for (let i = 0; i < 30; i++) {
      match.step({ you: steer(-1, 0) })
      if (fired < 0 && you.dashCd > 0) fired = i
    }
    expect(fired).toBeGreaterThan(5)
    expect(you.vx).toBeLessThan(0)
  })
})

describe('teeter and claw-back', () => {
  // A rolling ball skates the lip and cannot leave on its own; a dash punches through it.
  function overshoot(from: number, react: number, homeX: number, redash = false): Match {
    const match = live()
    const you = match.players[0]!
    you.x = from
    you.y = 0
    you.vx = 300
    let crossed = -1
    for (let t = 0; t < 120 && you.alive; t++) {
      if (crossed < 0 && you.edgeDist < 0) crossed = t
      const late = crossed >= 0 && (t - crossed) / 60 >= react
      const press = t === 0 || (redash && late && (t - crossed) / 60 < react + 0.05)
      match.step({ you: steer(late ? homeX : 1, 0, { dash: press }) })
    }
    expect(crossed).toBeGreaterThanOrEqual(0)
    return match
  }

  it('a light hit over the edge is clawed back just by holding home', () => {
    for (const speed of [350, 500, 650]) {
      for (const react of [0.12, 0.25]) {
        const match = live()
        const you = match.players[0]!
        you.x = 420
        you.y = 0
        you.vx = speed
        // A fresh, unstunned hit: the lip assist is off for a moment.
        match.playTick = 120
        you.lastHitTime = 2
        let crossed = -1
        for (let t = 0; t < 120 && you.alive; t++) {
          if (crossed < 0 && you.edgeDist < 0) crossed = t
          const late = crossed >= 0 && (t - crossed) / 60 >= react
          match.step({ you: steer(late ? -1 : 0, 0) })
        }
        expect(crossed).toBeGreaterThanOrEqual(0)
        expect(you.stats.deaths).toBe(0)
      }
    }
  })

  it('a full dash off the edge is saved by the cooldown-free recovery dash', () => {
    for (const from of [360, 400, 430]) {
      for (const react of [0.12, 0.25]) {
        const you = overshoot(from, react, -1, true).players[0]!
        expect(you.stats.deaths).toBe(0)
        expect(you.airDash).toBe(true)
      }
    }
  })

  it('rolling at the rim cannot fall off by itself', () => {
    const match = live()
    const you = match.players[0]!
    you.x = 400
    you.y = 0
    you.vx = 600
    for (let t = 0; t < 120; t++) match.step({ you: steer(1, 0) })
    expect(you.stats.deaths).toBe(0)
  })

  it('still falls if the player keeps pushing out', () => {
    const you = overshoot(360, 0.25, 1).players[0]!
    expect(you.stats.deaths).toBe(1)
  })

  it('a launched (stunned) ball gets no teeter', () => {
    const match = live()
    const you = match.players[0]!
    you.x = 430
    you.y = 0
    you.vx = 700
    you.stun = 0.4
    you.stunMax = 0.4
    for (let t = 0; t < 90 && you.alive; t++) match.step({ you: steer(-1, 0) })
    expect(you.stats.deaths).toBe(1)
  })
})

describe('recovery dash', () => {
  it('a dash toward the floor while falling pops the ball back up', () => {
    const match = live()
    const you = match.players[0]!
    you.x = 520
    you.y = 0
    you.vx = 120
    you.coyote = 0
    you.teeter = -1
    let falling = false
    for (let t = 0; t < 30 && !falling; t++) {
      match.step({ you: idle })
      falling = you.falling
    }
    expect(falling).toBe(true)
    const before = you.fallVel
    match.step({ you: steer(-1, 0, { dash: true }) })
    expect(you.fallVel).toBeGreaterThan(before)
    expect(you.fallVel).toBeGreaterThan(0)
    expect(you.recovered).toBeGreaterThan(0)
  })
})

describe('bot edge perception', () => {
  it('does not steer home on the very first tick of danger', () => {
    const match = live('classic', true)
    const bot = match.players[1]!
    bot.x = 300
    bot.y = 0
    bot.vx = 520
    bot.vy = 0
    // Mid-dash, so the rim lip does not stop it for the bot.
    bot.dashTime = 0.4
    bot.dashCd = 2
    bot.skill = 0.2
    bot.botReact = 99
    bot.botX = 1
    bot.botY = 0
    match.step({ you: idle })
    // Still aiming outward: it has not noticed yet.
    expect(bot.input.x).toBeGreaterThan(0)
    let turned = -1
    for (let i = 0; i < 40 && turned < 0; i++) {
      match.step({ you: idle })
      if (bot.input.x < 0) turned = i
    }
    expect(turned).toBeGreaterThan(3)
  })
})
