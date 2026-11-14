import { TAU, clamp } from '../core/math'
import { hexA, mixHex, shade } from './util'

export type Expression = 'idle' | 'focus' | 'hurt' | 'scared' | 'happy' | 'sleep' | 'dizzy'

export interface BallLook {
  color: string
  skin: string
  pattern: number
  colorblind?: boolean
  /** Screen-space facing, length 0..1. 0 faces the camera. */
  lookX: number
  lookY: number
  expression: Expression
  /** 0 open, 1 closed. */
  blink: number
  /** Seconds, for animated skins. */
  time: number
  heat?: number
  /** White hit flash 0..1. */
  flash?: number
  /** Darken as the ball sinks below the rim, 0..1. */
  sink?: number
  /** Decoys and previews can hide the face. */
  face?: boolean
  /** Device pixel ratio, for hairlines. */
  dpr?: number
}

/**
 * Paints a ball character centred on (x, y). Lighting comes from the top left, the face turns toward
 * `look`, and the skin decides the material. Callers apply squash and stretch with a transform.
 */
export function paintBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, look: BallLook): void {
  if (r < 0.5) return
  const skin = look.skin.replace(/^skin_/, '')
  const dpr = look.dpr ?? 1
  ctx.save()
  ctx.translate(x, y)

  if (skin === 'orbit') orbitRing(ctx, r, look, 'back')

  if (skin === 'hollow') hollowBody(ctx, r, look.color)
  else body(ctx, r, look, skin)

  // Identity marks sit low on the body so they never fight the eyes.
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.98, 0, TAU)
  ctx.clip()
  marks(ctx, look.pattern + (look.colorblind ? 1 : 0), r, look.colorblind ? 0.42 : 0.16, look.lookX, look.lookY)
  ctx.restore()

  if (look.heat && look.heat > 50) {
    const k = clamp((look.heat - 50) / 170, 0, 1)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(0, r * 0.25, r * 0.1, 0, 0, r)
    g.addColorStop(0, hexA('#ff6a2a', 0.05 + k * 0.25))
    g.addColorStop(1, hexA('#ff2d2d', 0.15 + k * 0.4))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  if (look.face !== false) face(ctx, r, look)

  if (skin !== 'hollow') specular(ctx, r, skin)

  // Outline last so every skin keeps a crisp silhouette against the floor.
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.lineWidth = Math.max(1 * dpr, r * 0.075)
  ctx.strokeStyle = skin === 'glass' ? hexA(shade(look.color, 0.4), 0.7) : shade(look.color, -0.72)
  if (skin !== 'hollow') ctx.stroke()

  if (look.flash && look.flash > 0.02) {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fillStyle = `rgba(255,255,255,${clamp(look.flash, 0, 1) * 0.85})`
    ctx.fill()
  }
  if (look.sink && look.sink > 0) {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fillStyle = `rgba(2,4,14,${look.sink * 0.7})`
    ctx.fill()
  }

  if (skin === 'orbit') orbitRing(ctx, r, look, 'front')
  ctx.restore()
}

// ---------------------------------------------------------------- materials

function body(ctx: CanvasRenderingContext2D, r: number, look: BallLook, skin: string): void {
  const c = look.color
  const t = look.time
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  if (skin === 'glass') {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r)
    g.addColorStop(0, hexA(shade(c, 0.7), 0.6))
    g.addColorStop(0.6, hexA(c, 0.35))
    g.addColorStop(1, hexA(shade(c, -0.3), 0.75))
    ctx.fillStyle = g
    ctx.fill()
    // A bright core floating inside the clear shell.
    const core = ctx.createRadialGradient(-r * 0.12, -r * 0.1, 0, 0, 0, r * 0.55)
    core.addColorStop(0, shade(c, 0.55))
    core.addColorStop(0.7, c)
    core.addColorStop(1, hexA(c, 0))
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(0, r * 0.05, r * 0.55, 0, TAU)
    ctx.fill()
    return
  }
  if (skin === 'chrome') {
    const g = ctx.createLinearGradient(0, -r, 0, r)
    g.addColorStop(0, shade(c, 0.78))
    g.addColorStop(0.42, shade(c, 0.25))
    g.addColorStop(0.5, shade(c, -0.6))
    g.addColorStop(0.56, shade(c, 0.45))
    g.addColorStop(1, shade(c, -0.35))
    ctx.fillStyle = g
    ctx.fill()
    shadeSphere(ctx, r, 0.55)
    return
  }
  if (skin === 'ember') {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r)
    g.addColorStop(0, shade(c, -0.35))
    g.addColorStop(1, shade(c, -0.85))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.globalCompositeOperation = 'lighter'
    const pulse = 0.6 + Math.sin(t * 5) * 0.25
    const core = ctx.createRadialGradient(0, r * 0.1, 0, 0, 0, r * 0.9)
    core.addColorStop(0, hexA('#ffd27a', 0.55 * pulse))
    core.addColorStop(1, hexA('#ff4d1a', 0))
    ctx.fillStyle = core
    ctx.fillRect(-r, -r, r * 2, r * 2)
    ctx.strokeStyle = hexA('#ffb347', 0.85 * pulse)
    ctx.lineWidth = Math.max(1, r * 0.07)
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
      const a = i * 1.37 + 0.4
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15)
      ctx.quadraticCurveTo(Math.cos(a + 0.5) * r * 0.6, Math.sin(a + 0.5) * r * 0.6, Math.cos(a + 0.2) * r * 1.05, Math.sin(a + 0.2) * r * 1.05)
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (skin === 'nebula') {
    ctx.fillStyle = mixHex('#0a0820', c, 0.18)
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
      const a = t * 0.3 + i * 1.7
      const cx = Math.cos(a) * r * 0.4
      const cy = Math.sin(a * 1.3) * r * 0.35
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.75)
      const tone = i % 2 ? c : shade(c, 0.45)
      g.addColorStop(0, hexA(tone, 0.45))
      g.addColorStop(1, hexA(tone, 0))
      ctx.fillStyle = g
      ctx.fillRect(-r, -r, r * 2, r * 2)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    for (let i = 0; i < 7; i++) {
      const sx = Math.sin(i * 12.9) * r * 0.7
      const sy = Math.cos(i * 7.3) * r * 0.7
      const tw = 0.5 + Math.sin(t * 3 + i) * 0.5
      ctx.globalAlpha = tw
      ctx.fillRect(sx, sy, Math.max(1, r * 0.06), Math.max(1, r * 0.06))
    }
    ctx.restore()
    shadeSphere(ctx, r, 0.45)
    return
  }
  if (skin === 'frost' || skin === 'glacier') {
    const base = skin === 'frost' ? mixHex(c, '#eaf6ff', 0.5) : mixHex(c, '#1d4f9a', 0.45)
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r * 1.1)
    g.addColorStop(0, shade(base, 0.55))
    g.addColorStop(0.6, base)
    g.addColorStop(1, shade(base, -0.45))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = hexA('#ffffff', skin === 'frost' ? 0.5 : 0.32)
    ctx.lineWidth = Math.max(1, r * 0.045)
    // Facets: a few hard planes read as ice instead of plastic.
    const pts = [[-0.9, -0.2], [-0.2, -0.75], [0.55, -0.55], [0.85, 0.15], [0.2, 0.8], [-0.6, 0.6]]
    ctx.beginPath()
    for (const [px, py] of pts) {
      ctx.moveTo(0.05 * r, 0.02 * r)
      ctx.lineTo(px! * r, py! * r)
    }
    ctx.stroke()
    ctx.restore()
    shadeSphere(ctx, r, 0.3)
    return
  }
  // Classic and prism share the glossy plastic base.
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.04, 0, 0, r * 1.08)
  g.addColorStop(0, shade(c, 0.55))
  g.addColorStop(0.32, shade(c, 0.12))
  g.addColorStop(0.72, c)
  g.addColorStop(1, shade(c, -0.55))
  ctx.fillStyle = g
  ctx.fill()
  if (skin === 'prism') {
    ctx.save()
    ctx.clip()
    ctx.globalCompositeOperation = 'overlay'
    const cg = ctx.createConicGradient(t * 0.8, 0, 0)
    for (const [i, col] of ['#ff4d6d', '#ffc14d', '#d6ff4a', '#3ee6a0', '#4cc9ff', '#b388ff', '#ff4d6d'].entries()) cg.addColorStop(i / 6, col)
    ctx.fillStyle = cg
    ctx.globalAlpha = 0.75
    ctx.fillRect(-r, -r, r * 2, r * 2)
    ctx.restore()
  }
  // Light bounced off the floor warms the underside.
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.clip()
  const bounce = ctx.createRadialGradient(0, r * 1.05, r * 0.1, 0, r * 0.9, r * 0.75)
  bounce.addColorStop(0, hexA(shade(c, 0.35), 0.45))
  bounce.addColorStop(1, hexA(c, 0))
  ctx.fillStyle = bounce
  ctx.fillRect(-r, 0, r * 2, r)
  ctx.restore()
}

/** Extra terminator shading for skins that start from a flat fill. */
function shadeSphere(ctx: CanvasRenderingContext2D, r: number, k: number): void {
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.05)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(0.7, `rgba(0,0,0,${0.1 * k})`)
  g.addColorStop(1, `rgba(0,0,0,${0.75 * k})`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()
}

function hollowBody(ctx: CanvasRenderingContext2D, r: number, c: string): void {
  const w = r * 0.34
  ctx.beginPath()
  ctx.arc(0, 0, r - w / 2, 0, TAU)
  const g = ctx.createLinearGradient(-r, -r, r, r)
  g.addColorStop(0, shade(c, 0.5))
  g.addColorStop(0.5, c)
  g.addColorStop(1, shade(c, -0.5))
  ctx.lineWidth = w
  ctx.strokeStyle = g
  ctx.stroke()
  ctx.lineWidth = Math.max(1, r * 0.06)
  ctx.strokeStyle = shade(c, -0.7)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, r - w, 0, TAU)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, r - w / 2, Math.PI * 1.1, Math.PI * 1.45)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.lineCap = 'round'
  ctx.stroke()
}

function specular(ctx: CanvasRenderingContext2D, r: number, skin: string): void {
  const hard = skin === 'chrome' || skin === 'glacier' || skin === 'glass'
  const soft = skin === 'frost' || skin === 'ember'
  ctx.save()
  ctx.translate(-r * 0.36, -r * 0.44)
  ctx.rotate(-0.62)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.34)
  g.addColorStop(0, `rgba(255,255,255,${hard ? 0.95 : soft ? 0.35 : 0.75})`)
  g.addColorStop(0.55, `rgba(255,255,255,${hard ? 0.5 : soft ? 0.12 : 0.3})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.scale(1, 0.55)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.34, 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.arc(-r * 0.2, -r * 0.6, r * 0.065, 0, TAU)
  ctx.fillStyle = `rgba(255,255,255,${soft ? 0.4 : 0.9})`
  ctx.fill()
  // Thin rim light on the shadow side separates the ball from dark floors.
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.9, 0.15, Math.PI * 0.62)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.lineCap = 'round'
  ctx.stroke()
}

function orbitRing(ctx: CanvasRenderingContext2D, r: number, look: BallLook, half: 'back' | 'front'): void {
  ctx.save()
  ctx.rotate(-0.28)
  ctx.beginPath()
  if (half === 'back') ctx.ellipse(0, 0, r * 1.6, r * 0.42, 0, Math.PI, TAU)
  else ctx.ellipse(0, 0, r * 1.6, r * 0.42, 0, 0, Math.PI)
  ctx.strokeStyle = half === 'back' ? hexA(shade(look.color, 0.5), 0.55) : shade(look.color, 0.6)
  ctx.lineWidth = Math.max(1.5, r * 0.16)
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = Math.max(0.5, r * 0.04)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------- identity marks

function marks(ctx: CanvasRenderingContext2D, kind: number, r: number, alpha: number, lx: number, ly: number): void {
  const k = ((kind % 8) + 8) % 8
  // Marks drift opposite the face, as if painted on the far side of the ball.
  const ox = -lx * r * 0.18
  const oy = r * 0.42 - ly * r * 0.12
  ctx.save()
  ctx.translate(ox, oy)
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`
  ctx.fillStyle = `rgba(0,0,0,${alpha})`
  ctx.lineWidth = Math.max(1.2, r * 0.11)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const s = r * 0.5
  ctx.beginPath()
  if (k === 1) {
    ctx.moveTo(-r, -s * 0.2)
    ctx.quadraticCurveTo(0, s * 0.25, r, -s * 0.2)
    ctx.moveTo(-r, s * 0.35)
    ctx.quadraticCurveTo(0, s * 0.8, r, s * 0.35)
    ctx.stroke()
  } else if (k === 2) {
    for (const [px, py] of [[-0.55, 0], [0, 0.25], [0.55, 0]]) {
      ctx.moveTo(px! * s + s * 0.16, py! * s)
      ctx.arc(px! * s, py! * s, s * 0.16, 0, TAU)
    }
    ctx.fill()
  } else if (k === 3) {
    ctx.moveTo(-s * 0.35, 0)
    ctx.lineTo(s * 0.35, 0)
    ctx.moveTo(0, -s * 0.3)
    ctx.lineTo(0, s * 0.4)
    ctx.stroke()
  } else if (k === 4) {
    ctx.moveTo(-s * 0.5, s * 0.25)
    ctx.lineTo(0, -s * 0.15)
    ctx.lineTo(s * 0.5, s * 0.25)
    ctx.stroke()
  } else if (k === 5) {
    ctx.ellipse(0, s * 0.1, s * 0.42, s * 0.3, 0, 0, TAU)
    ctx.stroke()
  } else if (k === 6) {
    ctx.moveTo(0, -s * 0.3)
    ctx.lineTo(s * 0.35, s * 0.1)
    ctx.lineTo(0, s * 0.5)
    ctx.lineTo(-s * 0.35, s * 0.1)
    ctx.closePath()
    ctx.fill()
  } else if (k === 7) {
    ctx.moveTo(-s * 0.6, -s * 0.05)
    ctx.lineTo(-s * 0.2, s * 0.35)
    ctx.lineTo(s * 0.2, -s * 0.05)
    ctx.lineTo(s * 0.6, s * 0.35)
    ctx.stroke()
  } else {
    ctx.moveTo(-r, s * 0.05)
    ctx.quadraticCurveTo(0, s * 0.55, r, s * 0.05)
    ctx.lineTo(r, r)
    ctx.lineTo(-r, r)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- face

function face(ctx: CanvasRenderingContext2D, r: number, look: BallLook): void {
  let lx = clamp(look.lookX, -1, 1)
  let ly = clamp(look.lookY, -1, 1)
  const m = Math.hypot(lx, ly)
  if (m > 1) {
    lx /= m
    ly /= m
  }
  const ex = look.expression
  // The face sits on the front of the sphere and slides toward where the ball is heading.
  const cx = lx * r * 0.42
  const cy = -r * 0.08 + ly * r * 0.3
  const turn = 1 - Math.abs(lx) * 0.32
  const tilt = 1 - Math.max(0, -ly) * 0.35
  const gap = r * 0.34 * turn
  const scared = ex === 'scared'
  const ew = r * 0.19 * (scared ? 1.18 : 1) * turn
  const eh = r * 0.27 * (scared ? 1.16 : 1) * tilt
  const ink = '#0d0a1a'
  const lw = Math.max(1, r * 0.075)

  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.97, 0, TAU)
  ctx.clip()
  for (const side of [-1, 1]) {
    const x = cx + side * gap
    const y = cy
    ctx.save()
    ctx.translate(x, y)
    if (ex === 'dizzy') {
      // Spinning spirals: knocked silly by a launch.
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(0, 0, ew * 1.05, eh * 0.95, 0, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = lw * 0.85
      ctx.lineCap = 'round'
      ctx.beginPath()
      const spin = look.time * 14 * side
      for (let k = 0; k <= 26; k++) {
        const u = k / 26
        const a = spin + u * TAU * 2.2
        const rr = u * 0.85
        const px = Math.cos(a) * ew * rr
        const py = Math.sin(a) * eh * rr
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    } else if (ex === 'hurt') {
      // >  < squeezed shut.
      ctx.strokeStyle = ink
      ctx.lineWidth = lw * 1.25
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(-side * ew * 0.9, -eh * 0.55)
      ctx.lineTo(side * ew * 0.7, 0)
      ctx.lineTo(-side * ew * 0.9, eh * 0.55)
      ctx.stroke()
    } else if (ex === 'happy') {
      ctx.strokeStyle = ink
      ctx.lineWidth = lw * 1.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(0, eh * 0.25, ew * 0.95, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
    } else if (ex === 'sleep' || look.blink > 0.85) {
      ctx.strokeStyle = ink
      ctx.lineWidth = lw
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-ew * 0.9, 0)
      ctx.quadraticCurveTo(0, eh * 0.35, ew * 0.9, 0)
      ctx.stroke()
    } else {
      const open = 1 - clamp(look.blink, 0, 1) * 0.9
      ctx.beginPath()
      ctx.ellipse(0, 0, ew, eh * open, 0, 0, TAU)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = Math.max(0.8, r * 0.04)
      ctx.strokeStyle = hexA(ink, 0.55)
      ctx.stroke()
      ctx.save()
      ctx.clip()
      const pr = scared ? 0.5 : 0.68
      const px = lx * ew * 0.38 + side * -ew * 0.06
      const py = ly * eh * 0.3 + eh * 0.08
      ctx.beginPath()
      ctx.ellipse(px, py, ew * pr, eh * pr * 0.9, 0, 0, TAU)
      ctx.fillStyle = ink
      ctx.fill()
      ctx.beginPath()
      ctx.arc(px - ew * 0.22, py - eh * 0.26, Math.max(0.6, ew * 0.24), 0, TAU)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      if (ex === 'focus') {
        // A lid cut at the inner top corner reads as determined.
        ctx.beginPath()
        ctx.moveTo(-ew * 1.2, -eh * (side < 0 ? 0.55 : 1.2))
        ctx.lineTo(ew * 1.2, -eh * (side < 0 ? 1.2 : 0.55))
        ctx.lineTo(ew * 1.2, -eh * 1.6)
        ctx.lineTo(-ew * 1.2, -eh * 1.6)
        ctx.closePath()
        ctx.fillStyle = shade(look.color, -0.1)
        ctx.fill()
      }
      ctx.restore()
      if (ex === 'focus') {
        ctx.strokeStyle = ink
        ctx.lineWidth = lw
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-ew * 1.05, -eh * (side < 0 ? 0.62 : 1.15))
        ctx.lineTo(ew * 1.05, -eh * (side < 0 ? 1.15 : 0.62))
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // A small mouth only for strong feelings, so the default face stays clean.
  const my = cy + eh * 1.05
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = lw * 0.9
  ctx.lineCap = 'round'
  if (ex === 'happy') {
    ctx.beginPath()
    ctx.moveTo(cx - gap * 0.55, my - eh * 0.1)
    ctx.quadraticCurveTo(cx, my + eh * 0.9, cx + gap * 0.55, my - eh * 0.1)
    ctx.closePath()
    ctx.fill()
  } else if (scared) {
    ctx.beginPath()
    ctx.ellipse(cx, my + eh * 0.2, ew * 0.38, eh * 0.32, 0, 0, TAU)
    ctx.fill()
  } else if (ex === 'dizzy') {
    ctx.beginPath()
    for (let k = 0; k <= 8; k++) {
      const u = k / 8
      const x = cx - gap * 0.5 + u * gap
      const y = my + eh * 0.15 + Math.sin(u * TAU * 1.5 + look.time * 18) * eh * 0.14
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else if (ex === 'hurt') {
    ctx.beginPath()
    ctx.moveTo(cx - gap * 0.45, my + eh * 0.1)
    ctx.lineTo(cx - gap * 0.15, my - eh * 0.1)
    ctx.lineTo(cx + gap * 0.15, my + eh * 0.1)
    ctx.lineTo(cx + gap * 0.45, my - eh * 0.1)
    ctx.stroke()
  }
  ctx.restore()

  if (scared) {
    // Sweat drop on the far side of the head.
    const sx = cx + gap * 1.6
    const sy = cy - eh * 1.1
    ctx.beginPath()
    ctx.moveTo(sx, sy - r * 0.16)
    ctx.quadraticCurveTo(sx + r * 0.11, sy, sx, sy + r * 0.06)
    ctx.quadraticCurveTo(sx - r * 0.11, sy, sx, sy - r * 0.16)
    ctx.fillStyle = '#9fe6ff'
    ctx.fill()
  }
}

/** A blink curve: mostly open, a quick close every few seconds, offset per ball. */
export function blinkAt(time: number, seed: number): number {
  const period = 2.6 + (seed % 1) * 2.4
  const u = ((time + seed * 7.3) % period) / period
  const w = 0.045
  if (u > w * 2) return 0
  return 1 - Math.abs(u - w) / w
}

/** Renders a still ball into a canvas, for UI avatars and cards. */
export function ballAvatar(canvas: HTMLCanvasElement, color: string, skin: string, pattern: number, expression: Expression = 'idle', size = 48, look = { x: 0.15, y: 0.25 }): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const r = canvas.width * (skin.includes('orbit') ? 0.3 : 0.42)
  paintBall(ctx, canvas.width / 2, canvas.height / 2, r, {
    color, skin, pattern, lookX: look.x, lookY: look.y, expression, blink: 0, time: 0, dpr,
  })
}
