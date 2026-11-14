/** A human-like controller for headless play: perceives through a reaction delay, aims with error. */
import { DT, ZERO_INPUT, type InputFrame } from '../src/core/types'
import { Rng, clamp, hypot } from '../src/core/math'
import type { Match } from '../src/sim/match'
import type { Body } from '../src/sim/body'

interface ProxyStyle {
  react: number
  aim: number
  notice: number
  dashBias: number
  ability: number
}

export const STYLES: Record<string, ProxyStyle> = {
  casual: { react: 0.3, aim: 0.28, notice: 0.55, dashBias: 0.5, ability: 0.4 },
  good: { react: 0.2, aim: 0.12, notice: 0.85, dashBias: 0.8, ability: 0.7 },
  idle: { react: 1, aim: 0, notice: 0, dashBias: 0, ability: 0 },
  bot: { react: 0, aim: 0, notice: 1, dashBias: 0, ability: 0 },
}

interface Snap {
  x: number
  y: number
  vx: number
  vy: number
  edgeDist: number
  safetyX: number
  safetyY: number
  alive: boolean
  id: string
  team: number
  decoy: boolean
}

function snap(b: Body): Snap {
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, edgeDist: b.edgeDist, safetyX: b.safetyX, safetyY: b.safetyY, alive: b.alive, id: b.id, team: b.team, decoy: b.decoy }
}

export class Proxy {
  private history: Snap[][] = []
  private hold: InputFrame = { ...ZERO_INPUT }
  private next = 0
  private dashArmed = false
  constructor(private style: ProxyStyle, private rng: Rng) {}

  think(match: Match, me: Body): InputFrame {
    this.history.push(match.bodies.map(snap))
    const lag = Math.round(this.style.react / DT)
    if (this.history.length > lag + 1) this.history.shift()
    const seen = this.history[0] ?? []
    const self = seen.find((s) => s.id === me.id)
    const frame: InputFrame = { ...this.hold, dash: false, ability: false }
    if (this.dashArmed && me.dashCd <= 0) {
      frame.dash = true
      this.dashArmed = false
    }
    if (!self || !me.alive || this.style.notice === 0) return frame
    if (match.time < this.next) return frame
    this.next = match.time + 0.08 + this.rng.next() * 0.08
    const speed = hypot(self.vx, self.vy)
    const outward = self.vx * -self.safetyX + self.vy * -self.safetyY
    // Hanging over the edge is impossible to miss; a near miss of the rim sometimes is.
    const over = self.edgeDist < 0
    if (over || (self.edgeDist < 70 + speed * 0.25 && outward > 30 && this.rng.next() < this.style.notice)) {
      this.hold = { ...ZERO_INPUT, x: self.safetyX, y: self.safetyY, brake: outward > 260 && self.edgeDist > 0 }
      if (self.edgeDist < 34 && me.dashCd <= 0) this.dashArmed = true
      return { ...this.hold, dash: this.dashArmed }
    }
    const foes = seen.filter((s) => s.alive && s.id !== me.id && !s.decoy && !(match.config.teams && s.team === me.team))
    let target: Snap | null = null
    let best = Infinity
    for (const f of foes) {
      const d = hypot(f.x - self.x, f.y - self.y) - clamp(120 - f.edgeDist, 0, 120)
      if (d < best) {
        best = d
        target = f
      }
    }
    if (!target) {
      this.hold = { ...ZERO_INPUT, x: -self.x, y: -self.y }
      return this.hold
    }
    const dx = target.x - self.x
    const dy = target.y - self.y
    const dist = hypot(dx, dy) || 1
    const err = (this.rng.next() - 0.5) * 2 * this.style.aim
    const a = Math.atan2(dy, dx) + err
    let ax = Math.cos(a)
    let ay = Math.sin(a)
    // Keep a little away from the rim while chasing.
    if (self.edgeDist < 110) {
      ax += self.safetyX * 0.6
      ay += self.safetyY * 0.6
    }
    const m = hypot(ax, ay) || 1
    this.hold = { ...ZERO_INPUT, x: ax / m, y: ay / m }
    const align = speed > 1 ? (self.vx * dx + self.vy * dy) / (speed * dist) : 0
    if (me.dashCd <= 0 && dist < 190 && align > 0.75 && this.rng.next() < this.style.dashBias) frame.dash = true
    if (me.abilityCd <= 0 && dist < 130 && this.rng.next() < this.style.ability * 0.3) frame.ability = true
    return { ...this.hold, dash: frame.dash, ability: frame.ability }
  }
}

export function makeProxy(style: string, rng: Rng): Proxy {
  return new Proxy(STYLES[style] ?? STYLES.casual!, rng)
}
