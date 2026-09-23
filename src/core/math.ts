export interface Vec {
  x: number
  y: number
}

export const TAU = Math.PI * 2

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function hypot(x: number, y: number): number {
  return Math.hypot(x, y)
}

export function len(v: Vec): number {
  return Math.hypot(v.x, v.y)
}

export function norm(x: number, y: number): Vec {
  const l = Math.hypot(x, y)
  if (l < 1e-8) return { x: 1, y: 0 }
  return { x: x / l, y: y / l }
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by
}

export function expDecay(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt))
}

/** Deterministic 0..1 noise from a tick and an id. Safe for replay. */
export function hash01(tick: number, id: string, salt = 0): number {
  let h = (Math.imul(tick + 1, 374761393) ^ Math.imul(salt + 1, 668265263)) >>> 0
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 1274126177) >>> 0
  }
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return (h & 0xffff) / 0xffff
}

export function hashSigned(tick: number, id: string, salt = 0): number {
  return hash01(tick, id, salt) * 2 - 1
}

export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }

  next(): number {
    this.s |= 0
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }

  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1))
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length]!
  }

  chance(p: number): boolean {
    return this.next() < p
  }
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  const u = clamp(t, 0, 1)
  const r = Math.round(lerp(pa[0], pb[0], u))
  const g = Math.round(lerp(pa[1], pb[1], u))
  const bl = Math.round(lerp(pa[2], pb[2], u))
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.slice(0, 6)
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ]
}

function toHex(n: number): string {
  return clamp(n, 0, 255).toString(16).padStart(2, '0')
}

export function metersFromPx(px: number): number {
  return px / 40
}
