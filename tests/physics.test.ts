import { describe, expect, it } from 'vitest'
import { resolvePair, type ImpactBody } from '../src/sim/impact'
import { applyMotion, type MotionMods } from '../src/sim/motion'
import { supportAt } from '../src/sim/geometry'
import { arenaById } from '../src/data/content'

function body(partial: Partial<ImpactBody>): ImpactBody {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 22,
    mass: 1,
    restitution: 1,
    outgoing: 1,
    incoming: 1,
    momentum: 0.4,
    dashTime: 0,
    anchorTime: 0,
    mirrorTime: 0,
    overdriveTime: 0,
    phaseTime: 0,
    invuln: 0,
    team: 0,
    decoy: false,
    id: 'a',
    ownerId: '',
    ...partial,
  }
}

const mods: MotionMods = {
  turnMul: 1,
  accelMul: 1,
  maxMul: 1,
  dragMul: 1,
  ampMul: 1,
  gravMul: 1,
  conveyorX: 0,
  conveyorY: 0,
  ice: false,
  sticky: false,
  rubber: false,
  edgeDist: 200,
  braking: false,
  falling: false,
}

describe('impacts', () => {
  it('sends a still ball along a faster strike', () => {
    const a = body({ id: 'a', x: 0, vx: 520, vy: 0, team: 0 })
    const b = body({ id: 'b', x: 40, vx: 0, vy: 0, team: 1 })
    const out = resolvePair(a, b, false)
    expect(out.kind).toBe('strike')
    expect(b.vx).toBeGreaterThan(300)
    expect(a.vx).toBeGreaterThan(150)
    expect(Number.isFinite(a.vx)).toBe(true)
    expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(981)
  })

  it('does not explode across repeated trades', () => {
    const a = body({ x: 0, vx: 200, team: 0 })
    const b = body({ id: 'b', x: 44, vx: -180, team: 1 })
    for (let i = 0; i < 30; i++) {
      a.x = 0
      b.x = 40
      resolvePair(a, b, false)
      expect(Number.isFinite(a.vx)).toBe(true)
      expect(Math.hypot(a.vx, a.vy)).toBeLessThanOrEqual(981)
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(981)
    }
  })

  it('lets an anchor ignore the launch', () => {
    const a = body({ x: 0, vx: 600, team: 0 })
    const b = body({ id: 'b', x: 40, vx: 0, anchorTime: 1, team: 1 })
    resolvePair(a, b, false)
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(80)
    expect(a.vx).toBeLessThan(0)
  })
})

describe('motion', () => {
  it('builds speed while holding a direction and coasts after release', () => {
    const ball = { vx: 0, vy: 0, momentum: 0, accel: 540, maxSpeed: 680, turnRate: 1, overdriveTime: 0, anchorTime: 0, passive: 'none' }
    for (let i = 0; i < 90; i++) applyMotion(ball, 1, 0, 1 / 60, mods)
    const fast = Math.hypot(ball.vx, ball.vy)
    expect(fast).toBeGreaterThan(500)
    for (let i = 0; i < 90; i++) applyMotion(ball, 0, 0, 1 / 60, mods)
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(fast)
  })

  it('turns more slowly at high momentum', () => {
    const slow = { vx: 0, vy: 80, momentum: 0.05, accel: 540, maxSpeed: 680, turnRate: 1, overdriveTime: 0, anchorTime: 0, passive: 'none' }
    const fast = { vx: 0, vy: 660, momentum: 0.95, accel: 540, maxSpeed: 680, turnRate: 1, overdriveTime: 0, anchorTime: 0, passive: 'none' }
    applyMotion(slow, 1, 0, 1 / 60, mods)
    applyMotion(fast, 1, 0, 1 / 60, mods)
    const slowAngle = Math.atan2(slow.vy, slow.vx)
    const fastAngle = Math.atan2(fast.vy, fast.vx)
    expect(Math.abs(slowAngle)).toBeLessThan(Math.abs(fastAngle))
  })

  it('brakes harder than coasting', () => {
    const coast = { vx: 600, vy: 0, momentum: 0.8, accel: 540, maxSpeed: 680, turnRate: 1, overdriveTime: 0, anchorTime: 0, passive: 'none' }
    const brake = { ...coast }
    applyMotion(coast, 0, 0, 0.2, mods)
    applyMotion(brake, 0, 0, 0.2, { ...mods, braking: true })
    expect(Math.hypot(brake.vx, brake.vy)).toBeLessThan(Math.hypot(coast.vx, coast.vy))
  })
})

describe('arenas', () => {
  it('keeps the classic center supported and the outside unsupported', () => {
    const arena = arenaById('classic')
    const inside = supportAt(arena.solids, 0, 0, 0, { cut: 0, innerGrow: 0 }, 1 / 60)
    const outside = supportAt(arena.solids, 800, 0, 0, { cut: 0, innerGrow: 0 }, 1 / 60)
    expect(inside.edgeDist).toBeGreaterThan(100)
    expect(outside.supported).toBe(false)
    expect(outside.edgeDist).toBeLessThan(0)
  })
})
