import { clamp, hypot } from '../core/math'
import { SPEED_CAP } from '../core/types'
import type { HazardDef } from '../data/content'
import { circleHitsCircle, circleHitsRect } from './geometry'
import { capSpeed } from './impact'
import type { Body } from './body'
import type { MotionMods } from './motion'

export interface HazardPulse {
  kind: string
  x: number
  y: number
  r: number
  color: string
}

export function blankMods(edgeDist: number): MotionMods {
  return {
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
    edgeDist,
    braking: false,
    falling: false,
  }
}

export function applyEnvironment(
  mods: MotionMods,
  hazards: HazardDef[],
  body: Body,
  time: number,
  lowG: number,
): void {
  if (body.surface === 'ice') mods.ice = true
  if (body.surface === 'sticky') mods.sticky = true
  if (body.surface === 'rubber') mods.rubber = true
  if (body.surface === 'magnetic') {
    /* aura handled separately */
  }
  for (const h of hazards) {
    if (h.kind === 'conveyor' && overlaps(body, h, time)) {
      mods.conveyorX += Math.cos(h.angle) * h.speed
      mods.conveyorY += Math.sin(h.angle) * h.speed
    } else if (h.kind === 'ice' && overlaps(body, h, time)) {
      mods.ice = true
    } else if (h.kind === 'gravity' && overlaps(body, h, time)) {
      if (h.speed < 1) {
        mods.ampMul *= 1.65
        mods.gravMul *= h.speed
        mods.maxMul *= 1.06
        mods.turnMul *= 0.9
      } else {
        mods.ampMul *= 0.7
        mods.gravMul *= h.speed
        mods.turnMul *= 1.12
        mods.dragMul *= 1.2
      }
    }
  }
  if (lowG > 0) {
    mods.ampMul *= 1.7
    mods.gravMul *= 0.5
    mods.maxMul *= 1.05
  }
}

export function overlaps(body: Body, h: HazardDef, time: number): boolean {
  const p = hazardPose(h, time)
  if (h.kind === 'conveyor' || h.kind === 'ice' || h.kind === 'gravity' || h.kind === 'crusher') {
    return circleHitsRect(body.x, body.y, body.radius * 0.6, p.x, p.y, h.w || h.r * 2, h.h || h.r * 2)
  }
  if (h.kind === 'laser') return laserTouch(body, h, time)
  return circleHitsCircle(body.x, body.y, body.radius * 0.75, p.x, p.y, p.r)
}

export function hazardPose(h: HazardDef, time: number): { x: number; y: number; r: number } {
  let x = h.x
  let y = h.y
  let r = h.r
  if (h.kind === 'crusher') {
    const a = Math.sin(time * h.speed) * h.amp
    if (Math.abs(Math.cos(h.angle)) > 0.5) x += a
    else y += a
  }
  if (h.kind === 'lava' && time > h.delay) {
    r = Math.min(h.maxR || r + 400, r + (time - h.delay) * h.grow)
  }
  return { x, y, r }
}

export function laserMode(h: HazardDef, time: number): 'off' | 'warn' | 'hot' {
  if (time < h.delay) return 'off'
  const period = h.period || 2.6
  const u = ((time - h.delay) % period + period) % period
  if (u < period * 0.42) return 'off'
  if (u < period * 0.68) return 'warn'
  return 'hot'
}

export function laserAngle(h: HazardDef, time: number): number {
  return h.angle + time * (h.speed || 0.9)
}

function laserTouch(body: Body, h: HazardDef, time: number): boolean {
  if (laserMode(h, time) === 'off') return false
  const ang = laserAngle(h, time)
  const x2 = h.x + Math.cos(ang) * (h.r || 460)
  const y2 = h.y + Math.sin(ang) * (h.r || 460)
  const dx = x2 - h.x
  const dy = y2 - h.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((body.x - h.x) * dx + (body.y - h.y) * dy) / len2
  t = clamp(t, 0, 1)
  const qx = h.x + dx * t
  const qy = h.y + dy * t
  return hypot(body.x - qx, body.y - qy) < body.radius + 10
}

export interface HazardTouch {
  lethal: boolean
  kind: string
  impulseX: number
  impulseY: number
  pop: boolean
  warn: boolean
}

/**
 * Per-tick hazard contact. Pushers return an impulse. Lethal flags require sustained contact
 * tracked on the body by the caller.
 */
export function hazardContact(body: Body, h: HazardDef, time: number, dt: number): HazardTouch | null {
  const empty = null
  if (h.kind === 'spikes' || h.kind === 'lava' || h.kind === 'blackhole') {
    const p = hazardPose(h, time)
    if (!circleHitsCircle(body.x, body.y, body.radius * 0.72, p.x, p.y, p.r)) return empty
    if (h.kind === 'blackhole') {
      const dx = p.x - body.x
      const dy = p.y - body.y
      const d = hypot(dx, dy) || 1
      return {
        lethal: d < 18,
        kind: h.kind,
        impulseX: (dx / d) * 720 * dt,
        impulseY: (dy / d) * 720 * dt,
        pop: false,
        warn: d < p.r,
      }
    }
    const dx = body.x - p.x
    const dy = body.y - p.y
    const d = hypot(dx, dy) || 1
    return {
      lethal: true,
      kind: h.kind,
      impulseX: (dx / d) * (h.kind === 'spikes' ? 220 : 40) * dt,
      impulseY: (dy / d) * (h.kind === 'spikes' ? 220 : 40) * dt,
      pop: false,
      warn: true,
    }
  }
  if (h.kind === 'bumper') {
    const p = hazardPose(h, time)
    if (!circleHitsCircle(body.x, body.y, body.radius, p.x, p.y, p.r)) return empty
    const dx = body.x - p.x
    const dy = body.y - p.y
    const d = hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const pen = body.radius + p.r - d
    body.x += nx * pen
    body.y += ny * pen
    const vn = body.vx * nx + body.vy * ny
    if (vn < 80) {
      body.vx += nx * (h.speed - vn)
      body.vy += ny * (h.speed - vn)
      capSpeed(body)
    }
    return { lethal: false, kind: 'bumper', impulseX: 0, impulseY: 0, pop: true, warn: false }
  }
  if (h.kind === 'launcher') {
    const p = hazardPose(h, time)
    if (!circleHitsCircle(body.x, body.y, body.radius * 0.8, p.x, p.y, p.r)) return empty
    if (body.sinceLand > 0.16 && hypot(body.vx, body.vy) > h.speed * 0.75) return empty
    body.vx = Math.cos(h.angle) * h.speed
    body.vy = Math.sin(h.angle) * h.speed
    capSpeed(body, SPEED_CAP)
    return { lethal: false, kind: 'launcher', impulseX: 0, impulseY: 0, pop: true, warn: false }
  }
  if (h.kind === 'laser' && laserMode(h, time) === 'hot' && laserTouch(body, h, time)) {
    const ang = laserAngle(h, time) + Math.PI / 2
    const side = Math.sign((body.x - h.x) * Math.cos(ang) + (body.y - h.y) * Math.sin(ang)) || 1
    return {
      lethal: false,
      kind: 'laser',
      impulseX: Math.cos(ang) * side * 640,
      impulseY: Math.sin(ang) * side * 640,
      pop: true,
      warn: false,
    }
  }
  if (h.kind === 'laser' && laserMode(h, time) === 'warn' && laserTouch(body, h, time)) {
    return { lethal: false, kind: 'laser', impulseX: 0, impulseY: 0, pop: false, warn: true }
  }
  if (h.kind === 'crusher') {
    const p = hazardPose(h, time)
    if (!circleHitsRect(body.x, body.y, body.radius, p.x, p.y, h.w, h.h)) return empty
    const prevT = time - dt
    const prev = h.x + (Math.abs(Math.cos(h.angle)) > 0.5 ? Math.sin(prevT * h.speed) * h.amp : 0)
    const now = p.x
    const vx = (now - prev) / Math.max(dt, 1 / 120)
    const sign = body.x >= p.x ? 1 : -1
    body.x += sign * 8
    body.vx = sign * Math.max(360, Math.abs(vx) + 200)
    capSpeed(body)
    return { lethal: false, kind: 'crusher', impulseX: 0, impulseY: 0, pop: true, warn: false }
  }
  if (h.kind === 'explosive') {
    const pulse = explosiveHot(h, time, dt)
    const p = hazardPose(h, time)
    const warn = explosiveWarn(h, time)
    if (!circleHitsCircle(body.x, body.y, body.radius, p.x, p.y, p.r)) return empty
    if (!pulse) return { lethal: false, kind: 'explosive', impulseX: 0, impulseY: 0, pop: false, warn }
    const dx = body.x - p.x
    const dy = body.y - p.y
    const d = hypot(dx, dy) || 1
    return {
      lethal: false,
      kind: 'explosive',
      impulseX: (dx / d) * 560,
      impulseY: (dy / d) * 560,
      pop: true,
      warn: false,
    }
  }
  return empty
}

export function explosiveWarn(h: HazardDef, time: number): boolean {
  const period = h.period || 5.5
  const u = ((time % period) + period) % period
  return u > period * 0.72 && u < period * 0.9
}

export function explosiveHot(h: HazardDef, time: number, dt: number): boolean {
  const period = h.period || 5.5
  const prev = ((time - dt) % period + period) % period
  const u = ((time % period) + period) % period
  const mark = period * 0.9
  if (u >= prev) return prev < mark && u >= mark
  return prev < mark || u >= mark
}

export function magnetNudge(bodies: Body[], dt: number): void {
  for (const a of bodies) {
    if (!a.alive || a.magnetAura <= 0 || a.decoy) continue
    for (const b of bodies) {
      if (a === b || !b.alive || b.decoy || b.team === a.team && b.invuln > 0) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = hypot(dx, dy)
      if (d > a.magnetAura || d < 8) continue
      const k = (1 - d / a.magnetAura) * a.magnetAura * 0.9
      b.vx += (dx / d) * k * dt
      b.vy += (dy / d) * k * dt
    }
  }
}
