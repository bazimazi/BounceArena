import { TAU } from '../core/math'
import { blinkAt, paintBall, type Expression } from '../render/ball'
import { hexA, shade } from '../render/util'

export interface PreviewLook {
  color: string
  skin: string
  pattern: number
  /** Resting mood. Clicks and bounces add reactions on top. */
  mood?: Expression
}

export interface Preview {
  el: HTMLCanvasElement
  set(look: Partial<PreviewLook>): void
  /** A happy hop, e.g. after a change in the loadout. */
  cheer(): void
}

/**
 * A ball character idling on a lit pedestal. It animates itself while attached to the page and
 * stops on its own once removed, so screens can throw previews away freely.
 */
export function livePreview(look: PreviewLook, width: number, height: number, opts: { pedestal?: boolean; bounce?: number } = {}): Preview {
  const canvas = document.createElement('canvas')
  canvas.className = 'preview'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  const state: PreviewLook = { mood: 'idle', ...look }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let cheer = 0
  let spin = 0
  let started = 0
  let mounted = false
  const pedestal = opts.pedestal !== false
  const amp = opts.bounce ?? 1

  const born = performance.now()
  const frame = (now: number) => {
    if (!canvas.isConnected) {
      // Removed, or never attached: stop instead of spinning forever.
      if (mounted || now - born > 3000) return
      requestAnimationFrame(frame)
      return
    }
    mounted = true
    if (!started) started = now
    const t = (now - started) / 1000
    draw(t)
    requestAnimationFrame(frame)
  }

  const draw = (t: number) => {
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const r = Math.min(W * 0.3, H * 0.27)
    const floorY = H * (pedestal ? 0.78 : 0.86)
    const period = cheer > 0 ? 0.42 : 0.62
    const phase = (t % period) / period
    const hop = reduced ? 0 : Math.abs(Math.sin(phase * Math.PI)) * r * (cheer > 0 ? 1.1 : 0.42) * amp
    const ground = 1 - Math.min(1, hop / (r * 0.12))
    const squash = reduced ? 0 : ground * 0.16
    if (cheer > 0) cheer = Math.max(0, cheer - 1 / 60)
    if (spin > 0) spin = Math.max(0, spin - 1 / 60)

    if (pedestal) {
      const pw = r * 1.55
      const ph = r * 0.42
      // Glow pooled under the pedestal, as an ellipse so it never shows a box edge.
      ctx.save()
      ctx.translate(W / 2, floorY)
      ctx.scale(1, 0.42)
      const gr = Math.min(W / 2, pw * 1.6)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr)
      g.addColorStop(0, hexA(state.color, 0.4))
      g.addColorStop(1, hexA(state.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, gr, 0, TAU)
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.ellipse(W / 2, floorY + ph * 0.55, pw, ph, 0, 0, Math.PI)
      ctx.lineTo(W / 2 - pw, floorY)
      ctx.ellipse(W / 2, floorY, pw, ph, 0, Math.PI, 0, true)
      ctx.closePath()
      const side = ctx.createLinearGradient(0, floorY, 0, floorY + ph * 1.6)
      side.addColorStop(0, '#1a2140')
      side.addColorStop(1, '#090c1c')
      ctx.fillStyle = side
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(W / 2, floorY, pw, ph, 0, 0, TAU)
      const top = ctx.createLinearGradient(0, floorY - ph, 0, floorY + ph)
      top.addColorStop(0, '#2b355f')
      top.addColorStop(1, '#161c38')
      ctx.fillStyle = top
      ctx.fill()
      ctx.lineWidth = 2 * dpr
      ctx.strokeStyle = hexA(shade(state.color, 0.3), 0.9)
      ctx.stroke()
      // Running light around the pedestal rim.
      const a = t * 2
      ctx.beginPath()
      ctx.ellipse(W / 2, floorY, pw, ph, 0, a, a + 0.9)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3 * dpr
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    const shadowK = 1 - Math.min(0.7, hop / (r * 1.6))
    ctx.beginPath()
    ctx.ellipse(W / 2, floorY, r * 0.95 * shadowK, r * 0.28 * shadowK, 0, 0, TAU)
    ctx.fillStyle = `rgba(0,0,10,${0.45 * shadowK})`
    ctx.fill()

    const cx = W / 2
    const cy = floorY - r - hop + r * squash
    const lookX = reduced ? 0.15 : Math.sin(t * 0.7) * 0.55 + (spin > 0 ? Math.sin(spin * 30) * 0.6 : 0)
    const lookY = reduced ? 0.25 : 0.25 + Math.sin(t * 0.43) * 0.2
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1 + squash, 1 - squash)
    paintBall(ctx, 0, 0, r, {
      color: state.color,
      skin: state.skin,
      pattern: state.pattern,
      lookX,
      lookY,
      expression: cheer > 0 ? 'happy' : state.mood ?? 'idle',
      blink: reduced ? 0 : blinkAt(t, 0.37),
      time: t,
      dpr,
    })
    ctx.restore()
  }

  canvas.addEventListener('pointerdown', () => {
    cheer = 1.1
    spin = 0.5
  })
  requestAnimationFrame(frame)
  draw(0)
  return {
    el: canvas,
    set(next) {
      Object.assign(state, next)
    },
    cheer() {
      cheer = 1.1
    },
  }
}
