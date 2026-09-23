import { SPEED_CAP } from '../core/types'
import { TUNE } from '../data/tuning'
import { clamp, hypot } from '../core/math'

export interface ImpactBody {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  mass: number
  restitution: number
  outgoing: number
  incoming: number
  momentum: number
  dashTime: number
  anchorTime: number
  mirrorTime: number
  overdriveTime: number
  phaseTime: number
  invuln: number
  team: number
  decoy: boolean
  id: string
  ownerId: string
}

export interface ImpactOutcome {
  kind: 'none' | 'phase' | 'separate' | 'trade' | 'strike' | 'anchor' | 'mirror' | 'pop'
  attacker: -1 | 0 | 1
  power: number
  popA: boolean
  popB: boolean
}

const NONE: ImpactOutcome = { kind: 'none', attacker: -1, power: 0, popA: false, popB: false }

export function capSpeed(b: { vx: number; vy: number }, cap = SPEED_CAP): void {
  const s = hypot(b.vx, b.vy)
  if (s > cap) {
    const k = cap / s
    b.vx *= k
    b.vy *= k
  }
}

export function resolvePair(a: ImpactBody, b: ImpactBody, teams: boolean): ImpactOutcome {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let dist = hypot(dx, dy)
  const min = a.radius + b.radius
  if (dist >= min) return NONE
  if (dist < 1e-6) {
    dx = 1
    dy = 0
    dist = 1
  }
  const nx = dx / dist
  const ny = dy / dist

  if (a.phaseTime > 0 || b.phaseTime > 0) {
    return { kind: 'phase', attacker: -1, power: 0, popA: false, popB: false }
  }

  const pen = min - dist
  const invA = 1 / Math.max(0.25, a.mass)
  const invB = 1 / Math.max(0.25, b.mass)
  const invSum = invA + invB
  a.x -= nx * pen * (invA / invSum)
  a.y -= ny * pen * (invA / invSum)
  b.x += nx * pen * (invB / invSum)
  b.y += ny * pen * (invB / invSum)

  if (a.invuln > 0 || b.invuln > 0) {
    return { kind: 'separate', attacker: -1, power: 0, popA: false, popB: false }
  }

  const ownerSafe = (a.decoy && a.ownerId === b.id) || (b.decoy && b.ownerId === a.id)
  const teamSafe = teams && a.team === b.team && !a.decoy && !b.decoy
  if (a.decoy && b.decoy) {
    return { kind: 'separate', attacker: -1, power: 0, popA: false, popB: false }
  }

  const rvx = b.vx - a.vx
  const rvy = b.vy - a.vy
  const velN = rvx * nx + rvy * ny
  const rel = hypot(rvx, rvy)
  const closing = Math.max(0, -velN)
  const angle = rel > 8 ? closing / rel : 1

  if (velN > 12 && !ownerSafe && !teamSafe) {
    return { kind: 'separate', attacker: -1, power: 0, popA: false, popB: false }
  }

  if (ownerSafe || teamSafe) {
    softTrade(a, b, nx, ny, velN, invA, invB, TUNE.friendlyBump)
    return { kind: 'trade', attacker: -1, power: 0, popA: false, popB: false }
  }

  if (a.anchorTime > 0 && b.anchorTime > 0) {
    softTrade(a, b, nx, ny, velN, invA, invB, 0.4)
    return { kind: 'anchor', attacker: -1, power: 0, popA: false, popB: false }
  }
  if (a.anchorTime > 0) return bounceOffAnchor(b, a, nx, ny, 1)
  if (b.anchorTime > 0) return bounceOffAnchor(a, b, -nx, -ny, 0)

  const aScore = threat(a)
  const bScore = threat(b)
  const popA = a.decoy
  const popB = b.decoy
  const aOut = a.outgoing * (a.decoy ? 0.62 : 1)
  const bOut = b.outgoing * (b.decoy ? 0.62 : 1)

  if (angle < TUNE.glanceAngle) {
    softTrade(a, b, nx, ny, velN, invA, invB, Math.min(a.restitution, b.restitution))
    const power = closing
    return { kind: 'trade', attacker: aScore === bScore ? -1 : aScore > bScore ? 0 : 1, power, popA, popB }
  }

  const ratio = aScore / (bScore + 1)
  if (ratio > TUNE.strikeRatio) {
    return strike(a, b, nx, ny, angle, aOut, 0, popA, popB)
  }
  if (1 / Math.max(0.001, ratio) > TUNE.strikeRatio && bScore > aScore * TUNE.strikeRatio) {
    return strike(b, a, -nx, -ny, angle, bOut, 1, popB, popA)
  }
  softTrade(a, b, nx, ny, velN, invA, invB, Math.min(1, (a.restitution + b.restitution) * 0.5))
  return { kind: 'trade', attacker: -1, power: closing * 0.5, popA, popB }
}

function threat(b: ImpactBody): number {
  const speed = hypot(b.vx, b.vy)
  const dash = b.dashTime > 0 ? 1.38 : 1
  const over = b.overdriveTime > 0 ? 1.12 : 1
  return speed * b.mass * dash * over * b.outgoing * (0.85 + 0.3 * b.momentum)
}

function strike(
  striker: ImpactBody,
  victim: ImpactBody,
  nx: number,
  ny: number,
  angle: number,
  outgoing: number,
  attackerIndex: 0 | 1,
  popStriker: boolean,
  popVictim: boolean,
): ImpactOutcome {
  const sp = hypot(striker.vx, striker.vy)
  const dir = sp > 20 ? { x: striker.vx / sp, y: striker.vy / sp } : { x: nx, y: ny }
  const bx = dir.x * 0.72 + nx * 0.28
  const by = dir.y * 0.72 + ny * 0.28
  const bl = hypot(bx, by) || 1
  const kx = bx / bl
  const ky = by / bl
  const massAdv = clamp(striker.mass / Math.max(0.25, victim.mass), 0.55, 1.5)
  let power = sp * (0.62 + 0.5 * angle) * massAdv * outgoing * victim.incoming
  power *= 0.9 + 0.22 * striker.momentum
  if (striker.dashTime > 0) power *= TUNE.dashStrikeMul
  if (striker.overdriveTime > 0) power *= 1.1
  power = clamp(power, 0, SPEED_CAP)

  if (victim.mirrorTime > 0 && !victim.decoy) {
    victim.mirrorTime = 0
    const keep = 0.15
    striker.vx = striker.vx * keep - kx * power
    striker.vy = striker.vy * keep - ky * power
    victim.vx *= 0.92
    victim.vy *= 0.92
    capSpeed(striker)
    capSpeed(victim)
    return {
      kind: 'mirror',
      attacker: attackerIndex === 0 ? 1 : 0,
      power,
      popA: attackerIndex === 0 ? popStriker : popVictim,
      popB: attackerIndex === 0 ? popVictim : popStriker,
    }
  }

  const retain = striker.dashTime > 0 ? TUNE.dashRetain : TUNE.strikeRetain
  victim.vx = victim.vx * 0.12 + kx * power
  victim.vy = victim.vy * 0.12 + ky * power
  striker.vx *= retain
  striker.vy *= retain
  capSpeed(striker)
  capSpeed(victim)
  const popA = attackerIndex === 0 ? popStriker : popVictim
  const popB = attackerIndex === 0 ? popVictim : popStriker
  return { kind: 'strike', attacker: attackerIndex, power, popA, popB }
}

function bounceOffAnchor(mover: ImpactBody, anchor: ImpactBody, nx: number, ny: number, moverIndex: 0 | 1): ImpactOutcome {
  const sp = hypot(mover.vx, mover.vy)
  const vn = mover.vx * nx + mover.vy * ny
  if (vn < 0) {
    mover.vx -= (1 + 0.85) * vn * nx
    mover.vy -= (1 + 0.85) * vn * ny
  } else {
    mover.vx += nx * Math.max(80, sp * 0.25)
    mover.vy += ny * Math.max(80, sp * 0.25)
  }
  anchor.vx *= 0.05
  anchor.vy *= 0.05
  capSpeed(mover)
  return { kind: 'anchor', attacker: -1, power: sp * 0.4, popA: moverIndex === 0 && mover.decoy, popB: moverIndex === 1 && mover.decoy }
}

function softTrade(
  a: ImpactBody,
  b: ImpactBody,
  nx: number,
  ny: number,
  velN: number,
  invA: number,
  invB: number,
  restitution: number,
): void {
  if (velN >= 0) return
  const e = clamp(restitution, 0, 1)
  const j = -(1 + e) * velN / (invA + invB)
  a.vx -= j * nx * invA
  a.vy -= j * ny * invA
  b.vx += j * nx * invB
  b.vy += j * ny * invB
  capSpeed(a)
  capSpeed(b)
}
