import { DT, ZERO_INPUT, type InputFrame } from '../core/types'
import { clamp, hash01, hashSigned, hypot, lerp } from '../core/math'
import type { HazardDef } from '../data/content'
import { hazardPose } from './hazards'
import type { Body } from './body'
import { steerAlign } from './motion'

export interface BotEvent {
  x: number
  y: number
  r: number
  warn: boolean
  hot: boolean
}

export interface BotSense {
  time: number
  playTick: number
  teams: boolean
  zone: { x: number; y: number; r: number } | null
  bodies: Body[]
  hazards: HazardDef[]
  events: BotEvent[]
}

export function thinkBot(body: Body, sense: BotSense): void {
  if (!body.alive || body.decoy) {
    body.input = { ...ZERO_INPUT }
    return
  }
  const emergency = edgeEmergency(body, sense.playTick)
  if (emergency) {
    body.input = emergency
    body.botDash = emergency.dash
    body.botAbility = false
    body.botBrake = emergency.brake
    return
  }

  body.botReact -= DT
  if (body.botReact <= 0) {
    body.botReact = lerp(0.28, 0.05, body.skill)
    decide(body, sense)
  }
  body.input = {
    x: body.botX,
    y: body.botY,
    dash: body.botDash,
    ability: body.botAbility,
    brake: body.botBrake,
    emote: false,
  }
}

function repel(body: Body, sense: BotSense): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const o of sense.bodies) {
    if (!o.alive || o.id === body.id || o.decoy) continue
    const dx = body.x - o.x
    const dy = body.y - o.y
    const d = hypot(dx, dy)
    const space = 110
    if (d >= space || d < 0.5) continue
    const push = ((space - d) / space) * 240
    x += (dx / d) * push
    y += (dy / d) * push
  }
  return { x, y }
}

function edgeEmergency(body: Body, tick: number): InputFrame | null {
  const speed = hypot(body.vx, body.vy)
  const warn = 64 + speed * 0.28
  const outward = body.vx * -body.safetyX + body.vy * -body.safetyY
  if (body.edgeDist > warn || outward < 28) return null
  const panic = body.edgeDist < 26 + speed * 0.07
  const aware = panic || hash01(tick, body.id, 4) < body.skill + 0.25
  if (!aware) return null
  return {
    x: body.safetyX,
    y: body.safetyY,
    dash: panic && body.dashCd <= 0 && (body.skill > 0.22 || panic),
    ability: false,
    brake: !panic && outward > 240,
    emote: false,
  }
}

function decide(body: Body, sense: BotSense): void {
  body.botDash = false
  body.botAbility = false
  body.botBrake = false

  if (hash01(sense.playTick, body.id, 8) < body.skill + 0.2) {
    const flee = hazardFlee(body, sense)
    if (flee) {
      body.botX = flee.x
      body.botY = flee.y
      body.botDash = flee.dash
      return
    }
  }

  const foes = sense.bodies.filter((o) =>
    o.alive && o.id !== body.id && !o.remove && !(sense.teams && o.team === body.team && !o.decoy),
  )
  const real = foes.filter((o) => !o.decoy)
  const decoys = foes.filter((o) => o.decoy && o.ownerId !== body.id)
  let pool = real
  if (decoys.length > 0 && body.skill < 0.7 && hash01(sense.playTick, body.id, 3) < 0.5) pool = decoys
  const target = pickTarget(body, pool.length ? pool : real)
  const speed = hypot(body.vx, body.vy)
  const buildBelow = lerp(300, 150, body.aggression)

  if (!target || speed < buildBelow) {
    let tx = -body.safetyY
    let ty = body.safetyX
    if (tx === 0 && ty === 0) {
      tx = -body.y
      ty = body.x
    }
    if (body.vx * tx + body.vy * ty < 0) {
      tx = -tx
      ty = -ty
    }
    if (body.edgeDist < 80 + speed * 0.22) {
      tx = tx * 0.45 + body.safetyX * 0.9
      ty = ty * 0.45 + body.safetyY * 0.9
    }
    const n = norm(tx, ty)
    const jx = hashSigned(sense.playTick, body.id, 1) * (1 - body.skill) * 0.35
    const jy = hashSigned(sense.playTick, body.id, 2) * (1 - body.skill) * 0.35
    const push = repel(body, sense)
    const aimed = norm(n.x + jx + push.x / 180, n.y + jy + push.y / 180)
    body.botX = aimed.x
    body.botY = aimed.y
    if (body.abilityCd <= 0 && body.ability === 'overdrive' && body.edgeDist > 120 && hash01(sense.playTick, body.id, 6) < 0.35 + body.skill * 0.3) {
      body.botAbility = true
    }
    return
  }

  const dx = target.x - body.x
  const dy = target.y - body.y
  const dist = hypot(dx, dy) || 1
  const lead = clamp(dist / (speed + 90), 0, 0.5) * lerp(0.15, 0.9, body.skill)
  let ax = target.x + target.vx * lead - body.x
  let ay = target.y + target.vy * lead - body.y
  ax += hashSigned(sense.playTick, body.id, 1) * (1 - body.skill) * 90
  ay += hashSigned(sense.playTick, body.id, 2) * (1 - body.skill) * 90
  const away = hypot(target.x, target.y) || 1
  ax += (target.x / away) * 150
  ay += (target.y / away) * 150
  if (body.edgeDist < 130) {
    ax += body.safetyX * 70
    ay += body.safetyY * 70
  }
  if (sense.zone && body.aggression > 0.4 && hash01(sense.playTick, body.id, 11) < 0.45) {
    ax = ax * 0.45 + (sense.zone.x - body.x) * 0.55
    ay = ay * 0.45 + (sense.zone.y - body.y) * 0.55
  }
  const push = repel(body, sense)
  const aimed = norm(ax + push.x, ay + push.y)
  body.botX = aimed.x
  body.botY = aimed.y

  const align = steerAlign(body.vx, body.vy, aimed.x, aimed.y)
  const outwardDash = body.edgeDist < 120 && aimed.x * body.safetyX + aimed.y * body.safetyY < 0.15
  if (
    body.dashCd <= 0 &&
    !outwardDash &&
    align > 0.72 &&
    speed > 260 &&
    dist < 210 &&
    (target.edgeDist < 170 || dist < 120) &&
    hash01(sense.playTick, body.id, 5) < body.aggression * 0.55 + body.skill * 0.45
  ) {
    body.botDash = true
  }

  if (speed > 460 && align < 0.1 && body.edgeDist < 220) body.botBrake = true
  if (speed > 520 && align < -0.15) body.botBrake = true

  const incoming = incomingThreat(body, real)
  if (body.abilityCd <= 0 && wantAbility(body, target, dist, incoming, real, sense)) {
    body.botAbility = hash01(sense.playTick, body.id, 7) < 0.55 + body.skill * 0.4
  }
}

function pickTarget(body: Body, pool: Body[]): Body | null {
  let best: Body | null = null
  let bestScore = -Infinity
  const speed = hypot(body.vx, body.vy)
  for (const f of pool) {
    if (!f.alive) continue
    const dx = f.x - body.x
    const dy = f.y - body.y
    const d = hypot(dx, dy) + 1
    const align = speed > 40 ? (body.vx * dx + body.vy * dy) / (speed * d) : 0
    const edge = clamp(1 - f.edgeDist / 150, 0, 1.2)
    let score = edge * 2.1 + align * 1.3 + (1 - Math.min(d, 640) / 640) * 1.15
    if (f.invuln > 0) score -= 1.6
    if (f.anchorTime > 0) score -= 1.2
    score *= 0.55 + body.aggression
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

function incomingThreat(body: Body, foes: Body[]): Body | null {
  let best: Body | null = null
  let bestScore = 0
  for (const f of foes) {
    const dx = body.x - f.x
    const dy = body.y - f.y
    const d = hypot(dx, dy)
    if (d > 190) continue
    const sp = hypot(f.vx, f.vy)
    if (sp < 280) continue
    const toward = (f.vx * dx + f.vy * dy) / (sp * d + 1)
    if (toward < 0.55) continue
    const score = sp * toward / d
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

function wantAbility(body: Body, target: Body, dist: number, incoming: Body | null, foes: Body[], sense: BotSense): boolean {
  switch (body.ability) {
    case 'shockwave':
      return dist < 140 || (!!incoming && dist < 170) || (body.edgeDist < 80 && dist < 160)
    case 'magnet':
      return body.momentum > 0.45 && dist > 70 && dist < 200
    case 'phase':
      return !!incoming && dist < 120
    case 'overdrive':
      return body.momentum < 0.55 && body.edgeDist > 100
    case 'anchor':
      return !!incoming && hypot(incoming.vx, incoming.vy) > hypot(body.vx, body.vy) * 1.15
    case 'repulse': {
      const align = steerAlign(1, 0, target.x - body.x, target.y - body.y)
      const sx = body.botX
      const sy = body.botY
      const cone = (sx * (target.x - body.x) + sy * (target.y - body.y)) / (dist || 1)
      return dist < 200 && cone > 0.55 && align >= -1
    }
    case 'blink':
      return body.edgeDist < 60 || dist > 240
    case 'gravity-well':
      return foes.filter((f) => hypot(f.x - body.x, f.y - body.y) < 230).length >= 2 || (!!sense.zone && dist < 160)
    case 'mirror':
      return !!incoming
    case 'split':
      return !!incoming || dist < 130
    default:
      return false
  }
}

function hazardFlee(body: Body, sense: BotSense): { x: number; y: number; dash: boolean } | null {
  let rx = 0
  let ry = 0
  let danger = 0
  for (const ev of sense.events) {
    if (!ev.warn && !ev.hot) continue
    const dx = body.x - ev.x
    const dy = body.y - ev.y
    const d = hypot(dx, dy)
    if (d > ev.r + 24) continue
    const n = norm(dx, dy)
    const w = (ev.r + 24 - d) / (ev.r + 24)
    rx += n.x * w
    ry += n.y * w
    danger = Math.max(danger, w)
  }
  for (const h of sense.hazards) {
    if (h.kind !== 'lava' && h.kind !== 'spikes' && h.kind !== 'blackhole') continue
    const p = hazardPose(h, sense.time)
    const dx = body.x - p.x
    const dy = body.y - p.y
    const d = hypot(dx, dy)
    const reach = p.r + body.radius + (h.kind === 'lava' ? 36 : 16)
    if (d > reach) continue
    const n = norm(dx, dy)
    const w = (reach - d) / reach
    rx += n.x * w * 1.4
    ry += n.y * w * 1.4
    danger = Math.max(danger, w)
  }
  if (danger < 0.15) return null
  if (body.edgeDist < 90) {
    rx = rx * 0.4 + body.safetyX
    ry = ry * 0.4 + body.safetyY
  }
  const n = norm(rx, ry)
  return {
    x: n.x,
    y: n.y,
    dash: danger > 0.65 && body.dashCd <= 0 && body.edgeDist > 40,
  }
}

function norm(x: number, y: number): { x: number; y: number } {
  const l = hypot(x, y)
  if (l < 1e-5) return { x: 0, y: 1 }
  return { x: x / l, y: y / l }
}
