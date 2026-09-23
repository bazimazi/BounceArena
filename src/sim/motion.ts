import { TUNE } from '../data/tuning'
import { SPEED_CAP } from '../core/types'
import { clamp, hypot, lerp } from '../core/math'
import { capSpeed } from './impact'

export interface MotionMods {
  turnMul: number
  accelMul: number
  maxMul: number
  dragMul: number
  ampMul: number
  gravMul: number
  conveyorX: number
  conveyorY: number
  ice: boolean
  sticky: boolean
  rubber: boolean
  edgeDist: number
  braking: boolean
  falling: boolean
}

export function momentumOf(speed: number): number {
  return clamp(speed / TUNE.momentumRef, 0, 1)
}

export function applyMotion(
  body: {
    vx: number
    vy: number
    momentum: number
    accel: number
    maxSpeed: number
    turnRate: number
    overdriveTime: number
    anchorTime: number
    passive: string
  },
  inputX: number,
  inputY: number,
  dt: number,
  mods: MotionMods,
): void {
  if (body.anchorTime > 0) {
    body.vx *= Math.exp(-10 * dt)
    body.vy *= Math.exp(-10 * dt)
    body.momentum = momentumOf(hypot(body.vx, body.vy))
    return
  }

  const ix = inputX
  const iy = inputY
  const inputMag = hypot(ix, iy)
  const wx = inputMag > 0.04 ? ix / inputMag : 0
  const wy = inputMag > 0.04 ? iy / inputMag : 0
  let speed = hypot(body.vx, body.vy)
  const over = body.overdriveTime > 0 ? 1.22 : 1
  const maxSpeed = Math.min(SPEED_CAP, body.maxSpeed * mods.maxMul * over * (mods.sticky ? 0.82 : 1))
  let turnMul = mods.turnMul * (mods.ice ? 0.42 : 1) * (mods.sticky ? 1.15 : 1)
  if (body.passive === 'edge-guard' && mods.edgeDist < 100 && mods.edgeDist > -20) turnMul *= 1.32
  if (body.passive === 'momentum-bank') turnMul *= lerp(1, 1.45, body.momentum)
  if (mods.braking) turnMul *= 1.65
  if (mods.falling) turnMul *= 0.75

  const turnLow = TUNE.turnLow * body.turnRate * turnMul
  const turnHigh = TUNE.turnHigh * body.turnRate * turnMul
  const turn = lerp(turnLow, turnHigh, body.momentum * body.momentum)

  if (speed < 28 || inputMag < 0.04) {
    if (inputMag >= 0.04) {
      const accel = body.accel * mods.accelMul * (body.overdriveTime > 0 ? 1.45 : 1)
      body.vx += wx * accel * dt * inputMag
      body.vy += wy * accel * dt * inputMag
    }
  } else {
    const dirX = body.vx / speed
    const dirY = body.vy / speed
    if (inputMag >= 0.04) {
      const cross = dirX * wy - dirY * wx
      const dotted = dirX * wx + dirY * wy
      const angle = Math.atan2(cross, dotted)
      const maxStep = turn * dt * (0.35 + inputMag * 0.65)
      const step = clamp(angle, -maxStep, maxStep)
      const c = Math.cos(step)
      const s = Math.sin(step)
      const ndx = dirX * c - dirY * s
      const ndy = dirX * s + dirY * c
      let next = speed
      const accel = body.accel * mods.accelMul * (body.overdriveTime > 0 ? 1.45 : 1) * (body.passive === 'heavy-hitter' ? 0.92 : 1)
      if (mods.braking) {
        next = speed * Math.exp(-TUNE.brake * dt)
      } else if (dotted > 0.15) {
        next = Math.min(maxSpeed, speed + accel * dt * dotted * inputMag)
      } else {
        next = Math.max(0, speed + accel * dt * dotted * inputMag * 1.25)
      }
      body.vx = ndx * next
      body.vy = ndy * next
    }
  }

  body.vx += mods.conveyorX * dt
  body.vy += mods.conveyorY * dt

  speed = hypot(body.vx, body.vy)
  if (inputMag < 0.2 && !mods.braking) {
    const drag = TUNE.coast * mods.dragMul * (mods.ice ? 0.25 : 1) * (mods.sticky ? 2.4 : 1)
    const next = speed * Math.exp(-drag * dt)
    if (speed > 1) {
      body.vx *= next / speed
      body.vy *= next / speed
    }
  } else if (mods.braking) {
    const next = speed * Math.exp(-TUNE.brake * dt)
    if (speed > 1) {
      body.vx *= next / speed
      body.vy *= next / speed
    }
  }

  if (speed > maxSpeed && inputMag >= 0.2 && !mods.braking) {
    const k = maxSpeed / speed
    body.vx *= k
    body.vy *= k
  }
  capSpeed(body)
  body.momentum = momentumOf(hypot(body.vx, body.vy))
}

export function steerAlign(vx: number, vy: number, ix: number, iy: number): number {
  const sp = hypot(vx, vy)
  const ip = hypot(ix, iy)
  if (sp < 1 || ip < 0.05) return 0
  return (vx * ix + vy * iy) / (sp * ip)
}
