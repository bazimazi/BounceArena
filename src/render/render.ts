import { clamp, lerp, mixHex } from '../core/math'
import type { FxEvent } from '../core/types'
import { solidPose, wallSegments } from '../sim/geometry'
import { hazardPose, laserAngle, laserMode } from '../sim/hazards'
import type { Body } from '../sim/body'
import type { Match } from '../sim/match'

export interface RenderPrefs {
  shake: number
  fx: 'full' | 'reduced'
  colorblind: boolean
  reducedMotion: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  kind: 'spark' | 'ring' | 'text'
  text: string
}

interface Star {
  x: number
  y: number
  r: number
  a: number
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private stars: Star[] = []
  private particles: Particle[] = []
  private shake = 0
  private camX = 0
  private camY = 0
  private dpr = 1
  width = 1
  height = 1

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    this.ctx = ctx
    this.seedStars()
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = Math.floor(this.width * this.dpr)
    this.canvas.height = Math.floor(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
  }

  absorb(events: FxEvent[], prefs: RenderPrefs, localId: string): void {
    const budget = prefs.fx === 'reduced' ? 8 : 18
    for (const e of events) {
      if (e.type === 'hit') {
        const n = prefs.fx === 'reduced' ? 4 : 10 + Math.min(8, e.power / 80)
        this.burst(e.x, e.y, e.color, n, 80 + e.power * 0.15)
        this.ring(e.x, e.y, e.color, 18 + e.power * 0.04)
        if (e.text) this.text(e.x, e.y - 20, e.text, '#fff7ea')
        const local = e.actorId === localId || e.victimId === localId
        const mag = (e.power / 900) * (local ? 1 : 0.45)
        this.shake = Math.max(this.shake, mag * 16 * prefs.shake * (prefs.reducedMotion ? 0.15 : 1))
      } else if (e.type === 'dash') {
        this.burst(e.x, e.y, e.color, budget > 8 ? 6 : 3, 140)
      } else if (e.type === 'elim') {
        this.burst(e.x, e.y, e.color, prefs.fx === 'reduced' ? 8 : 22, 220)
        this.ring(e.x, e.y, '#ffffff', 40)
        this.shake = Math.max(this.shake, 10 * prefs.shake)
      } else if (e.type === 'boom') {
        this.ring(e.x, e.y, e.color, 30)
        this.burst(e.x, e.y, e.color, prefs.fx === 'reduced' ? 6 : 16, 260)
      } else if (e.type === 'land' && prefs.fx === 'full') {
        this.ring(e.x, e.y, e.color, 8)
      } else if (e.type === 'wall' || e.type === 'ability' || e.type === 'pickup' || e.type === 'save') {
        this.ring(e.x, e.y, e.color, e.type === 'ability' ? 26 : 14)
      }
    }
  }

  draw(match: Match, alpha: number, prefs: RenderPrefs, biasX: number, spectateId: string): void {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    this.shake *= Math.exp(-6 / 60)
    const sx = Math.sin(match.time * 42) * this.shake * this.dpr
    const sy = Math.cos(match.time * 37) * this.shake * this.dpr
    const focus = match.players.find((p) => p.id === spectateId && p.alive) ?? match.players.find((p) => p.alive)
    if (focus) {
      this.camX = lerp(this.camX, clamp(focus.x, -50, 50), 0.06)
      this.camY = lerp(this.camY, clamp(focus.y, -36, 36), 0.06)
    }
    const zoom = (Math.min(w, h) / (match.arena.view * 2 * 1.12))
    const originX = w / 2 + biasX * this.dpr + sx
    const originY = h / 2 + sy
    const project = (x: number, y: number) => ({
      x: originX + (x - this.camX) * zoom,
      y: originY + (y - this.camY) * zoom,
    })
    const dpr = this.dpr
    this.css = (x, y) => {
      const p = project(x, y)
      return { x: p.x / dpr, y: p.y / dpr }
    }

    const bg = ctx.createRadialGradient(originX, originY, 40, originX, originY, Math.max(w, h) * 0.65)
    bg.addColorStop(0, '#122033')
    bg.addColorStop(0.45, '#0b121c')
    bg.addColorStop(1, '#06090f')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.globalAlpha = 0.45
    for (const s of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${s.a})`
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r * this.dpr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    for (const solid of match.arena.solids) {
      const pose = solidPose(solid, match.time, match.shrink)
      this.floor(pose, project, zoom, match.arena.floor, match.arena.rim, match.arena.accent, match.arena.id)
    }

    this.hazards(match, project, zoom)
    this.events(match, project, zoom)
    if (match.zone) this.zone(match, project, zoom)

    for (const wall of wallSegments(match.arena.walls, match.time)) {
      const a = project(wall.x1, wall.y1)
      const b = project(wall.x2, wall.y2)
      ctx.strokeStyle = 'rgba(255,255,255,0.78)'
      ctx.lineWidth = 4 * this.dpr
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    const bodies = [...match.bodies].filter((b) => b.alive || b.respawn > 0)
    for (const b of bodies) {
      if (!b.alive) continue
      const p = project(b.prevX + (b.x - b.prevX) * alpha, b.prevY + (b.y - b.prevY) * alpha)
      this.trail(b, project, alpha)
      const lift = (b.falling ? b.fallHeight : b.height) * zoom * 0.85
      this.shadow(p.x, p.y, b.radius * zoom * (b.falling ? 0.7 : 1), lift)
    }
    for (const b of bodies) {
      if (!b.alive) continue
      const p = project(b.prevX + (b.x - b.prevX) * alpha, b.prevY + (b.y - b.prevY) * alpha)
      const lift = (b.falling ? b.fallHeight : b.height) * zoom * 0.85
      this.ball(b, p.x, p.y - lift, b.radius * zoom * (1 + Math.max(0, lift) * 0.002), prefs)
    }
    const placed: { x: number; y: number }[] = []
    for (const b of bodies) {
      if (!b.alive) continue
      const p = project(b.x, b.y)
      let lift = 0
      for (const other of placed) {
        if (Math.abs(other.x - p.x) < 72 * this.dpr && Math.abs(other.y - (p.y - lift)) < 18 * this.dpr) lift += 16 * this.dpr
      }
      placed.push({ x: p.x, y: p.y - lift })
      this.label(b, p.x, p.y - lift, zoom)
    }

    this.drawParticles(project, zoom)
    this.banner(match, w, h)
    if (focus && focus.alive && focus.edgeDist < 90 && focus.edgeDist > -30) {
      const outward = focus.vx * -focus.safetyX + focus.vy * -focus.safetyY
      if (outward > 20 || focus.falling) this.vignette(w, h, focus.falling ? 0.55 : 0.28)
    }
  }

  private floor(
    pose: ReturnType<typeof solidPose>,
    project: (x: number, y: number) => { x: number; y: number },
    zoom: number,
    floor: string,
    rim: string,
    accent: string,
    arenaId: string,
  ): void {
    const ctx = this.ctx
    const c = project(pose.x, pose.y)
    ctx.save()
    ctx.globalAlpha = pose.active ? 1 : 0.18
    if (pose.warn) ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 80) * 0.2
    if (pose.shape === 'ring') {
      ctx.beginPath()
      ctx.arc(c.x, c.y, ((pose.r + pose.inner) / 2) * zoom, 0, Math.PI * 2)
      ctx.lineWidth = Math.max(2, (pose.r - pose.inner) * zoom)
      ctx.strokeStyle = floor
      ctx.stroke()
      ctx.lineWidth = 3 * this.dpr
      ctx.strokeStyle = rim
      ctx.beginPath()
      ctx.arc(c.x, c.y, pose.r * zoom, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = accent
      ctx.beginPath()
      ctx.arc(c.x, c.y, pose.inner * zoom, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pose.shape === 'poly') {
      ctx.beginPath()
      pose.points.forEach((pt, i) => {
        const s = project(pt.x, pt.y)
        if (i === 0) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
      })
      ctx.closePath()
      ctx.fillStyle = mixHex(floor, '#9fd0ff', 0.16)
      ctx.fill()
      ctx.lineWidth = 14 * this.dpr
      ctx.strokeStyle = 'rgba(255, 90, 70, 0.28)'
      ctx.stroke()
      ctx.lineWidth = 3 * this.dpr
      ctx.strokeStyle = rim
      ctx.stroke()
    } else {
      const g = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, pose.r * zoom)
      g.addColorStop(0, mixHex(floor, '#ffffff', 0.08))
      g.addColorStop(0.72, floor)
      g.addColorStop(1, mixHex(floor, '#000000', 0.25))
      ctx.beginPath()
      ctx.arc(c.x, c.y, pose.r * zoom, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
      ctx.lineWidth = 16 * this.dpr
      ctx.strokeStyle = 'rgba(255, 90, 70, 0.22)'
      ctx.stroke()
      ctx.lineWidth = 3 * this.dpr
      ctx.strokeStyle = rim
      ctx.stroke()
      if (arenaId === 'classic' || arenaId === 'collapse') {
        ctx.globalAlpha *= 0.35
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.5 * this.dpr
        for (const ring of [0.33, 0.66]) {
          ctx.beginPath()
          ctx.arc(c.x, c.y, pose.r * zoom * ring, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }
    ctx.restore()
  }

  private hazards(match: Match, project: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
    const ctx = this.ctx
    const hazards = [...match.arena.hazards, ...match.extras]
    for (const h of hazards) {
      const p = hazardPose(h, match.time)
      const s = project(p.x, p.y)
      if (h.kind === 'lava' || h.kind === 'spikes' || h.kind === 'blackhole' || h.kind === 'bumper' || h.kind === 'launcher' || h.kind === 'portal') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, Math.max(4, p.r * zoom), 0, Math.PI * 2)
        if (h.kind === 'lava') {
          const pulse = 0.75 + Math.sin(match.time * 5) * 0.25
          ctx.fillStyle = `rgba(255,77,58,${0.35 + pulse * 0.35})`
          ctx.fill()
          ctx.strokeStyle = '#ffb199'
          ctx.stroke()
        } else if (h.kind === 'spikes') {
          ctx.fillStyle = '#ff4d3a'
          ctx.fill()
        } else if (h.kind === 'bumper') {
          ctx.fillStyle = h.color
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2 * this.dpr
          ctx.stroke()
        } else if (h.kind === 'portal') {
          ctx.strokeStyle = h.color
          ctx.lineWidth = 3 * this.dpr
          ctx.stroke()
        } else if (h.kind === 'launcher') {
          ctx.fillStyle = 'rgba(255,193,77,0.25)'
          ctx.fill()
          ctx.strokeStyle = '#ffc14d'
          ctx.stroke()
        } else {
          ctx.fillStyle = 'rgba(80,40,160,0.45)'
          ctx.fill()
        }
      } else if (h.kind === 'laser') {
        const mode = laserMode(h, match.time)
        if (mode === 'off') continue
        const ang = laserAngle(h, match.time)
        const end = project(h.x + Math.cos(ang) * p.r, h.y + Math.sin(ang) * p.r)
        const start = project(h.x, h.y)
        ctx.strokeStyle = mode === 'hot' ? 'rgba(255,70,50,0.9)' : 'rgba(255,193,77,0.7)'
        ctx.lineWidth = (mode === 'hot' ? 6 : 2) * this.dpr
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
      } else if (h.kind === 'conveyor' || h.kind === 'gravity' || h.kind === 'ice' || h.kind === 'crusher') {
        const s0 = project(p.x - h.w / 2, p.y - h.h / 2)
        ctx.fillStyle = h.kind === 'gravity'
          ? (h.speed < 1 ? 'rgba(126,224,255,0.13)' : 'rgba(214,255,74,0.12)')
          : h.kind === 'conveyor'
            ? 'rgba(255,193,77,0.16)'
            : 'rgba(255,255,255,0.08)'
        ctx.fillRect(s0.x, s0.y, h.w * zoom, h.h * zoom)
      }
    }
  }

  private events(match: Match, project: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
    const ctx = this.ctx
    for (const ev of match.live) {
      const s = project(ev.x, ev.y)
      const r = Math.max(8, ev.r * zoom)
      if (ev.kind === 'meteor' || ev.kind === 'blast') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.strokeStyle = ev.fired ? 'rgba(255,77,58,0.2)' : 'rgba(255,193,77,0.9)'
        ctx.lineWidth = 2 * this.dpr
        ctx.setLineDash(ev.fired ? [] : [6 * this.dpr, 5 * this.dpr])
        ctx.stroke()
        ctx.setLineDash([])
      } else if (ev.kind === 'orb' && !ev.fired) {
        ctx.beginPath()
        ctx.arc(s.x, s.y, 10 * this.dpr + Math.sin(match.time * 6) * 2, 0, Math.PI * 2)
        ctx.fillStyle = '#ffc14d'
        ctx.fill()
      } else if (ev.kind === 'hole') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(40,0,60,0.45)'
        ctx.fill()
        ctx.strokeStyle = '#b388ff'
        ctx.stroke()
      }
    }
    for (const w of match.wells) {
      const s = project(w.x, w.y)
      ctx.beginPath()
      ctx.arc(s.x, s.y, w.r * zoom, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(179,136,255,0.8)'
      ctx.lineWidth = 2 * this.dpr
      ctx.stroke()
    }
  }

  private zone(match: Match, project: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
    if (!match.zone) return
    const ctx = this.ctx
    const s = project(match.zone.x, match.zone.y)
    ctx.beginPath()
    ctx.arc(s.x, s.y, match.zone.r * zoom, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,193,77,0.12)'
    ctx.fill()
    ctx.strokeStyle = '#ffc14d'
    ctx.lineWidth = 2 * this.dpr
    ctx.stroke()
  }

  private trail(b: Body, project: (x: number, y: number) => { x: number; y: number }, alpha: number): void {
    void alpha
    const ctx = this.ctx
    const speed = Math.hypot(b.vx, b.vy)
    if (speed < 80 || b.trail === 'trail_none') return
    ctx.beginPath()
    let started = false
    const n = b.hist.length / 2
    for (let i = 0; i < n; i++) {
      const idx = (b.histI / 2 + i) % n
      const x = b.hist[idx * 2]
      const y = b.hist[idx * 2 + 1]
      if (x === undefined || y === undefined || (x === 0 && y === 0)) continue
      const p = project(x, y)
      if (!started) {
        ctx.moveTo(p.x, p.y)
        started = true
      } else ctx.lineTo(p.x, p.y)
    }
    ctx.strokeStyle = b.color
    ctx.globalAlpha = clamp(speed / 900, 0.15, 0.7)
    ctx.lineWidth = (b.trail === 'trail_ribbon' ? 8 : 3) * this.dpr
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private shadow(x: number, y: number, r: number, lift: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.ellipse(x, y, r * 0.85, r * 0.38, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(0,0,0,${clamp(0.35 - lift / 400, 0.08, 0.4)})`
    ctx.fill()
  }

  private ball(b: Body, x: number, y: number, r: number, prefs: RenderPrefs): void {
    const ctx = this.ctx
    ctx.save()
    if (b.phaseTime > 0) ctx.globalAlpha = 0.45
    if (b.invuln > 0) ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 70) * 0.2
    if (b.falling) ctx.globalAlpha = 0.75
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.15, x, y, r)
    const skinMix = b.skin === 'glass' ? 0.35 : b.skin === 'chrome' ? 0.2 : 0.08
    g.addColorStop(0, mixHex(b.color, '#ffffff', 0.55 + skinMix))
    g.addColorStop(0.55, b.color)
    g.addColorStop(1, mixHex(b.color, '#000000', b.skin === 'hollow' ? 0.15 : 0.45))
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    if (b.skin !== 'hollow') {
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.lineWidth = (b.skin === 'hollow' ? 4 : 2) * this.dpr
    ctx.strokeStyle = mixHex(b.color, '#000000', 0.35)
    ctx.stroke()
    if (b.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${b.hitFlash * 0.45})`
      ctx.fill()
    }
    ctx.save()
    ctx.clip()
    this.pattern(b.pattern + (prefs.colorblind ? 1 : 0), x, y, r, b.color)
    ctx.restore()
    ctx.beginPath()
    ctx.ellipse(x - r * 0.28, y - r * 0.34, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.38)'
    ctx.fill()
    const ringR = r + 7 * this.dpr
    ctx.beginPath()
    ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.momentum)
    ctx.strokeStyle = mixHex('#3ee6a0', '#ff4d3a', b.momentum)
    ctx.lineWidth = 3 * this.dpr
    ctx.stroke()
    if (b.dashCd <= 0) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x + ringR, y, 2.4 * this.dpr, 0, Math.PI * 2)
      ctx.fill()
    }
    if (b.anchorTime > 0 || b.mirrorTime > 0) {
      ctx.strokeStyle = b.mirrorTime > 0 ? '#7ee0ff' : '#f4f7fb'
      ctx.lineWidth = 2 * this.dpr
      ctx.beginPath()
      ctx.arc(x, y, r + 4 * this.dpr, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  private pattern(kind: number, x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 2 * this.dpr
    const k = kind % 8
    if (k === 1) {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(x - r, y + i * r * 0.28)
        ctx.lineTo(x + r, y + i * r * 0.28)
        ctx.stroke()
      }
    } else if (k === 2) {
      for (const [ox, oy] of [[-0.3, -0.2], [0.25, 0.15], [0, 0.35], [-0.2, 0.25]]) {
        ctx.beginPath()
        ctx.arc(x + ox * r, y + oy * r, r * 0.12, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (k === 3) {
      ctx.beginPath()
      ctx.moveTo(x - r * 0.5, y)
      ctx.lineTo(x + r * 0.5, y)
      ctx.moveTo(x, y - r * 0.5)
      ctx.lineTo(x, y + r * 0.5)
      ctx.stroke()
    } else if (k === 4) {
      ctx.beginPath()
      ctx.moveTo(x - r * 0.35, y + r * 0.15)
      ctx.lineTo(x, y - r * 0.35)
      ctx.lineTo(x + r * 0.35, y + r * 0.15)
      ctx.stroke()
    } else if (k === 5) {
      ctx.beginPath()
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2)
      ctx.stroke()
    } else if (k === 6) {
      ctx.beginPath()
      ctx.moveTo(x, y - r * 0.45)
      ctx.lineTo(x + r * 0.4, y)
      ctx.lineTo(x, y + r * 0.45)
      ctx.lineTo(x - r * 0.4, y)
      ctx.closePath()
      ctx.stroke()
    } else if (k === 7) {
      ctx.beginPath()
      ctx.arc(x, y, r * 0.55, 0, Math.PI)
      ctx.stroke()
    }
    void color
  }

  private label(b: Body, x: number, y: number, zoom: number): void {
    const ctx = this.ctx
    const above = b.radius * zoom + 22 * this.dpr
    ctx.font = `600 ${12 * this.dpr}px Barlow, Segoe UI, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText(b.name, x, y - above)
    const stocks = Math.max(0, Math.min(5, b.stocks))
    for (let i = 0; i < stocks; i++) {
      ctx.fillStyle = i < b.stocks ? b.color : 'rgba(255,255,255,0.2)'
      ctx.fillRect(x + (i - (stocks - 1) / 2) * 8 * this.dpr - 3 * this.dpr, y - above + 4 * this.dpr, 5 * this.dpr, 3 * this.dpr)
    }
    if (b.emoteTime > 0 && b.emoteText) {
      ctx.font = `700 ${13 * this.dpr}px Barlow, sans-serif`
      ctx.fillStyle = '#ffc14d'
      ctx.fillText(b.emoteText, x, y - above - 16 * this.dpr)
    }
  }

  private banner(match: Match, w: number, h: number): void {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    if (match.countdownTicks > 0 && !match.silent) {
      const n = Math.ceil(match.countdownTicks / 60)
      ctx.font = `800 ${92 * this.dpr}px "Barlow Condensed", Impact, sans-serif`
      ctx.fillStyle = '#f4f7fb'
      ctx.fillText(String(n), w / 2, h / 2)
      return
    }
    if (match.goFlash > 0) {
      ctx.globalAlpha = Math.min(1, match.goFlash * 2)
      ctx.font = `800 ${84 * this.dpr}px "Barlow Condensed", Impact, sans-serif`
      ctx.fillStyle = '#ff4d3a'
      ctx.fillText('GO', w / 2, h / 2)
      ctx.globalAlpha = 1
    }
  }

  private vignette(w: number, h: number, amount: number): void {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.65)
    g.addColorStop(0, 'rgba(255,40,20,0)')
    g.addColorStop(1, `rgba(255,30,20,${amount})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2
      const s = speed * (0.4 + Math.random() * 0.8)
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.25, max: 0.5, size: 2 + Math.random() * 2, color, kind: 'spark', text: '',
      })
    }
  }

  private ring(x: number, y: number, color: string, size: number): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size, color, kind: 'ring', text: '' })
  }

  private text(x: number, y: number, text: string, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: -30, life: 0.7, max: 0.7, size: 14, color, kind: 'text', text })
  }

  private drawParticles(project: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
    const ctx = this.ctx
    const dt = 1 / 60
    for (const p of this.particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.life <= 0) continue
      const s = project(p.x, p.y)
      const t = p.life / p.max
      ctx.globalAlpha = clamp(t, 0, 1)
      if (p.kind === 'ring') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, p.size * zoom * (1.4 - t), 0, Math.PI * 2)
        ctx.strokeStyle = p.color
        ctx.lineWidth = 2 * this.dpr
        ctx.stroke()
      } else if (p.kind === 'text') {
        ctx.fillStyle = p.color
        ctx.font = `700 ${p.size * this.dpr}px Barlow, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(p.text, s.x, s.y)
      } else {
        ctx.fillStyle = p.color
        ctx.fillRect(s.x, s.y, p.size * this.dpr, p.size * this.dpr)
      }
    }
    ctx.globalAlpha = 1
    if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240)
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  private css: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y })

  toCss(x: number, y: number): { x: number; y: number } {
    return this.css(x, y)
  }

  private seedStars(): void {
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        x: (i * 47 % 100) / 100,
        y: (i * 19 % 100) / 100,
        r: (i % 3) + 0.5,
        a: 0.15 + (i % 5) * 0.08,
      })
    }
  }
}
