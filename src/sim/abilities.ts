import { hypot } from '../core/math'
import { capSpeed } from './impact'
import type { Body } from './body'
import { createBody } from './body'

export interface Well {
  x: number
  y: number
  r: number
  ttl: number
  ownerId: string
  acc: number
}

export interface CastContext {
  bodies: Body[]
  time: number
  onSolid: (x: number, y: number) => boolean
  addWell: (w: Well) => void
  addDecoy: (d: Body) => void
}

export function castAbility(body: Body, ctx: CastContext): number {
  if (body.abilityCd > 0 || !body.alive || body.decoy) return 0
  body.abilityCd = body.abilityCdMax
  body.stats.abilityUses += 1
  let hits = 0
  const steer = aim(body)

  switch (body.ability) {
    case 'shockwave':
      hits = radial(body, ctx, 172, 380, 1)
      break
    case 'magnet':
      body.magnetTime = 0.75
      hits = countNear(body, ctx, 210)
      break
    case 'phase':
      body.phaseTime = 0.55
      break
    case 'overdrive':
      body.overdriveTime = 1.45
      break
    case 'anchor':
      body.anchorTime = 1.25
      body.vx *= 0.15
      body.vy *= 0.15
      break
    case 'repulse':
      hits = cone(body, ctx, steer, 220, 500, 0.55)
      break
    case 'blink': {
      const spot = blinkPoint(body, steer, ctx)
      if (!spot) {
        body.abilityCd = 0.35
        body.stats.abilityUses -= 1
        return 0
      }
      body.x = spot.x
      body.y = spot.y
      body.prevX = spot.x
      body.prevY = spot.y
      break
    }
    case 'gravity-well':
      ctx.addWell({ x: body.x, y: body.y, r: 150, ttl: 1.7, ownerId: body.id, acc: 640 })
      hits = countNear(body, ctx, 150)
      break
    case 'mirror':
      body.mirrorTime = 2.35
      break
    case 'split':
      ctx.addDecoy(makeDecoy(body, steer))
      break
    default:
      break
  }
  if (hits > 0) body.stats.abilityHits += hits
  return hits
}

export function sustainForces(bodies: Body[], wells: Well[], dt: number, time: number): void {
  for (const b of bodies) {
    if (!b.alive || b.magnetTime <= 0) continue
    for (const o of bodies) {
      if (o === b || !o.alive || o.invuln > 0) continue
      if (o.decoy && o.ownerId === b.id) continue
      const dx = b.x - o.x
      const dy = b.y - o.y
      const d = hypot(dx, dy)
      if (d > 210 || d < 6) continue
      const acc = 740 * (1 - d / 210)
      o.vx += (dx / d) * acc * dt
      o.vy += (dy / d) * acc * dt
      capSpeed(o)
      if (time - o.lastHitTime > 0.45) {
        o.lastAttacker = b.id
        o.lastHitTime = time
      }
    }
  }
  for (const w of wells) {
    for (const o of bodies) {
      if (!o.alive || o.id === w.ownerId || o.invuln > 0) continue
      const dx = w.x - o.x
      const dy = w.y - o.y
      const d = hypot(dx, dy)
      if (d > w.r || d < 4) continue
      o.vx += (dx / d) * w.acc * dt
      o.vy += (dy / d) * w.acc * dt
      capSpeed(o)
      if (time - o.lastHitTime > 0.45) {
        o.lastAttacker = w.ownerId
        o.lastHitTime = time
      }
    }
  }
}

function aim(body: Body): { x: number; y: number } {
  const m = hypot(body.input.x, body.input.y)
  if (m > 0.15) return { x: body.input.x / m, y: body.input.y / m }
  const s = hypot(body.vx, body.vy)
  if (s > 20) return { x: body.vx / s, y: body.vy / s }
  return { x: body.safetyX || 1, y: body.safetyY || 0 }
}

function radial(body: Body, ctx: CastContext, radius: number, power: number, dir: number): number {
  let hits = 0
  for (const o of ctx.bodies) {
    if (o === body || !o.alive || o.invuln > 0) continue
    if (o.decoy && o.ownerId === body.id) continue
    const dx = o.x - body.x
    const dy = o.y - body.y
    const d = hypot(dx, dy)
    if (d > radius || d < 1) continue
    const fall = 1 - d / radius
    const nx = (dx / d) * dir
    const ny = (dy / d) * dir
    const kick = power * fall / Math.sqrt(Math.max(0.4, o.mass))
    o.vx += nx * kick
    o.vy += ny * kick
    capSpeed(o)
    o.lastAttacker = body.id
    o.lastHitTime = ctx.time
    o.hitFlash = 1
    hits++
  }
  return hits
}

function cone(body: Body, ctx: CastContext, steer: { x: number; y: number }, radius: number, power: number, minDot: number): number {
  let hits = 0
  for (const o of ctx.bodies) {
    if (o === body || !o.alive || o.invuln > 0) continue
    const dx = o.x - body.x
    const dy = o.y - body.y
    const d = hypot(dx, dy)
    if (d > radius || d < 1) continue
    const dot = (dx * steer.x + dy * steer.y) / d
    if (dot < minDot) continue
    const kick = power * dot * (1 - d / radius) / Math.sqrt(Math.max(0.4, o.mass))
    o.vx += steer.x * kick
    o.vy += steer.y * kick
    capSpeed(o)
    o.lastAttacker = body.id
    o.lastHitTime = ctx.time
    o.hitFlash = 1
    hits++
  }
  return hits
}

function countNear(body: Body, ctx: CastContext, radius: number): number {
  let n = 0
  for (const o of ctx.bodies) {
    if (o === body || !o.alive || o.decoy) continue
    if (hypot(o.x - body.x, o.y - body.y) <= radius) n++
  }
  return n
}

function blinkPoint(body: Body, steer: { x: number; y: number }, ctx: CastContext): { x: number; y: number } | null {
  let last: { x: number; y: number } | null = null
  for (let step = 1; step <= 7; step++) {
    const dist = step * 20
    const x = body.x + steer.x * dist
    const y = body.y + steer.y * dist
    if (!ctx.onSolid(x, y)) break
    last = { x, y }
  }
  if (!last) return null
  if (hypot(last.x - body.x, last.y - body.y) < 16) return null
  return last
}

function makeDecoy(owner: Body, steer: { x: number; y: number }): Body {
  const cfg = {
    id: `${owner.id}-decoy`,
    name: '',
    team: owner.team,
    bot: true,
    botLevel: owner.botLevel,
    skill: 0,
    aggression: 0,
    color: owner.color,
    pattern: owner.pattern,
    core: 'light',
    shell: 'rubber',
    ability: 'shockwave',
    passive: 'none',
    masteryCore: 'light',
    trail: owner.trail,
    impact: owner.impact,
    skin: 'hollow',
    emote: '',
    title: '',
    rating: 0,
  }
  const d = createBody(cfg, 1, true)
  const px = -steer.y
  const py = steer.x
  d.decoy = true
  d.ownerId = owner.id
  d.decoyLife = 1.15
  d.x = owner.x + px * (owner.radius + 16)
  d.y = owner.y + py * (owner.radius + 16)
  d.prevX = d.x
  d.prevY = d.y
  const sp = Math.max(280, hypot(owner.vx, owner.vy))
  d.vx = px * sp
  d.vy = py * sp
  d.invuln = 0.12
  d.radius = owner.radius * 0.86
  d.outgoing = 0.7
  d.incoming = 1
  d.mass = 0.75
  d.abilityCd = 99
  d.dashCd = 99
  return d
}

export function decayWells(wells: Well[], dt: number): Well[] {
  for (const w of wells) w.ttl -= dt
  return wells.filter((w) => w.ttl > 0)
}
