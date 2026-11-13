import { clamp } from '../core/math'

export { mixHex } from '../core/math'

/** `#rrggbb` (or `#rgb`) to an rgba() string. */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`
}

/** Deterministic 0..1 noise for a number. */
export function hashN(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInCubic(t: number): number {
  return t * t * t
}

export function easeOutElastic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Shift a colour's lightness: positive toward white, negative toward a deep version of itself. */
export function shade(hex: string, k: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  let r = parseInt(n.slice(0, 2), 16)
  let g = parseInt(n.slice(2, 4), 16)
  let b = parseInt(n.slice(4, 6), 16)
  if (k >= 0) {
    r += (255 - r) * k
    g += (255 - g) * k
    b += (255 - b) * k
  } else {
    // Darken toward a saturated, slightly blue-shifted shadow instead of grey.
    const t = -k
    r = r * (1 - t) + 8 * t
    g = g * (1 - t) + 6 * t
    b = b * (1 - t) + 26 * t
  }
  const to = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export const DISPLAY_FONT = '"Lilita One", "Rubik", Impact, sans-serif'
export const UI_FONT = '"Rubik", "Segoe UI", system-ui, sans-serif'
