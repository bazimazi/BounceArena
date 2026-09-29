import { clamp, lerp, mixHex, TAU } from '../core/math'
import { SPEED_CAP, type FxEvent } from '../core/types'
import { abilityById } from '../data/tuning'
import { solidPose, wallSegments, type Pose } from '../sim/geometry'
import { explosiveWarn, hazardPose, laserAngle, laserMode } from '../sim/hazards'
import type { Body } from '../sim/body'
import type { Match } from '../sim/match'

export interface RenderPrefs {
  shake: number
  fx: 'full' | 'reduced'
  colorblind: boolean
  reducedMotion: boolean
  numbers?: boolean
}

type Project = (x: number, y: number) => { x: number; y: number }

type ParticleKind =
  | 'spark'
  | 'dust'
  | 'ring'
  | 'text'
  | 'stamp'
  | 'confetti'
  | 'shard'
  | 'ember'
  | 'flash'
  | 'beam'
  | 'pillar'
  | 'bolt'
  | 'star'

interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  /** World units for rings and beams, CSS px for sprites. */
  size: number
  color: string
  text: string
  rot: number
  spin: number
  drag: number
  seed: number
}

interface Star {
  x: number
  y: number
  r: number
  a: number
  depth: number
  tw: number
}

/** Presentation-only state per ball. Never feeds back into the sim. */
interface BallFx {
  squash: number
  squashV: number
  squashAng: number
  land: number
  roll: number
  vx: number
  vy: number
  ghosts: { x: number; y: number; life: number }[]
  ghostTimer: number
  emberTimer: number
}

const MAX_PARTICLES = 700

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private stars: Star[] = []
  private particles: Particle[] = []
  private balls = new Map<string, BallFx>()
  private floorPattern: CanvasPattern | null = null
  private dpr = 1
  private camX = 0
  private camY = 0
  private camZoom = 1
  private trauma = 0
  private kickX = 0
  private kickY = 0
  private kickVX = 0
  private kickVY = 0
  private punch = 0
  private flashA = 0
  private flashColor = '#ffffff'
  private impactFrames = 0
  private hitstop = 0
  private slow = 0
  private finish: { x: number; y: number; life: number; max: number; color: string } | null = null
  private clock = 0
  private lastNow = 0
  private matchRef: Match | null = null
  private speedLines = 0
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
    this.floorPattern = null
  }

  /**
   * Real-time multiplier for the fixed-step sim. Hitstop freezes it, the
   * final knockout slows it. Only the shell reads this; the sim stays pure.
   */
  timeScale(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop -= dt
      return 0
    }
    if (this.slow > 0) {
      this.slow -= dt
      return this.slow > 0.4 ? 0.2 : lerp(1, 0.2, this.slow / 0.4)
    }
    return 1
  }

  /** Clears transient camera and time effects, e.g. between matches. */
  reset(): void {
    this.particles = []
    this.balls.clear()
    this.trauma = 0
    this.kickX = this.kickY = this.kickVX = this.kickVY = 0
    this.punch = 0
    this.flashA = 0
    this.impactFrames = 0
    this.hitstop = 0
    this.slow = 0
    this.finish = null
  }

  /** Smash-style finish: slow the clock and push the camera onto the last knockout. */
  finale(x: number, y: number, color: string, prefs: RenderPrefs): void {
    if (this.finish) return
    this.finish = { x, y, life: 1.5, max: 1.5, color }
    if (!prefs.reducedMotion) this.slow = 1.25
    this.flashA = Math.max(this.flashA, 0.35)
    this.flashColor = color
    this.trauma = Math.min(1, this.trauma + 0.4 * prefs.shake)
  }

  /** Confetti over the whole view, for a win on the results screen. */
  confetti(colors: string[]): void {
    const view = this.matchRef?.arena.view ?? 560
    for (let i = 0; i < 90; i++) {
      const x = this.camX + (Math.random() - 0.5) * view * 2
      const y = this.camY - view * (0.9 + Math.random() * 0.5)
      this.add('confetti', x, y, (Math.random() - 0.5) * 60, 140 + Math.random() * 160, 3 + Math.random() * 2.5, colors[i % colors.length] ?? '#ffc14d', 2.6 + Math.random() * 1.2, 0.2)
    }
  }

  absorb(events: FxEvent[], prefs: RenderPrefs, localId: string, match: Match): void {
    const full = prefs.fx === 'full'
    const motion = prefs.reducedMotion ? 0.15 : 1
    const shake = prefs.shake * motion
    for (const e of events) {
      const local = !!localId && (e.actorId === localId || e.victimId === localId)
      if (e.type === 'hit') {
        const victim = match.bodies.find((b) => b.id === e.victimId)
        const actor = match.bodies.find((b) => b.id === e.actorId)
        let nx = 1
        let ny = 0
        if (victim) {
          const d = Math.hypot(victim.x - e.x, victim.y - e.y)
          if (d > 0.01) {
            nx = (victim.x - e.x) / d
            ny = (victim.y - e.y) / d
          }
        }
        const k = clamp(e.power / 900, 0, 1.2)
        const n = full ? Math.round(8 + k * 16) : 4
        for (let i = 0; i < n; i++) {
          const spread = (Math.random() - 0.5) * (i % 3 === 0 ? Math.PI * 2 : 1.4)
          const a = Math.atan2(ny, nx) + spread
          const s = (180 + k * 520) * (0.4 + Math.random() * 0.8)
          this.add('spark', e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 1.6 + Math.random() * 1.6 + k, i % 4 === 0 ? '#ffffff' : e.color, 0.22 + Math.random() * 0.2 + k * 0.15, 5)
        }
        this.ring(e.x, e.y, e.color, 16 + k * 46, 0.34 + k * 0.1, 3 + k * 4)
        if (k > 0.35) this.ring(e.x, e.y, '#ffffff', 10 + k * 28, 0.2, 2)
        this.add('flash', e.x, e.y, 0, 0, 14 + k * 38, '#ffffff', 0.09 + k * 0.05, 0)
        this.impactStyle(actor?.impact ?? 'impact_ring', e.x, e.y, e.color, k, full)
        if (e.power > 560 && full) this.bolts(e.x, e.y, Math.atan2(ny, nx), k)
        if (e.text && prefs.numbers !== false) this.popNumber(e.x, e.y - 18, e.text, e.power)
        if (victim) {
          const fx = this.fxFor(victim)
          fx.squashAng = Math.atan2(ny, nx)
          fx.squashV -= 7 + k * 9
        }
        if (actor) {
          const fx = this.fxFor(actor)
          fx.squashAng = Math.atan2(ny, nx)
          fx.squashV -= 3 + k * 4
        }
        this.trauma = Math.min(1, this.trauma + (local ? 0.16 + k * 0.34 : 0.04 + k * 0.1) * shake)
        if (local) {
          this.kickVX += nx * (60 + k * 260) * motion
          this.kickVY += ny * (60 + k * 260) * motion
          this.punch = Math.max(this.punch, k * 0.06 * motion)
        }
        if (local || e.power > 640) this.hitstop = Math.max(this.hitstop, clamp(0.016 + k * 0.085, 0.02, 0.11))
        if (local && e.power > 780 && full && !prefs.reducedMotion) this.impactFrames = 1
      } else if (e.type === 'dash') {
        const b = match.bodies.find((x) => x.id === e.actorId)
        const a = b ? Math.atan2(b.vy, b.vx) + Math.PI : Math.random() * TAU
        for (let i = 0; i < (full ? 7 : 3); i++) {
          const aa = a + (Math.random() - 0.5) * 1.3
          const s = 60 + Math.random() * 120
          this.add('dust', e.x, e.y, Math.cos(aa) * s, Math.sin(aa) * s, 5 + Math.random() * 6, '#dfe9f5', 0.35 + Math.random() * 0.2, 4)
        }
        this.ring(e.x, e.y, e.color, 22, 0.22, 2)
        if (b) {
          const fx = this.fxFor(b)
          fx.ghostTimer = 0.32
          fx.squashAng = Math.atan2(b.vy, b.vx)
          fx.squashV += 6
        }
        if (local) this.trauma = Math.min(1, this.trauma + 0.05 * shake)
      } else if (e.type === 'elim') {
        const victim = match.bodies.find((b) => b.id === e.victimId)
        const color = victim?.color ?? e.color
        const fx = victim ? this.balls.get(victim.id) : undefined
        let dx = fx ? fx.vx : 0
        let dy = fx ? fx.vy : 0
        if (Math.hypot(dx, dy) < 30) {
          dx = e.x
          dy = e.y
        }
        const ang = Math.atan2(dy, dx)
        this.add('beam', e.x, e.y, 0, 0, 1, color, 0.85, 0, ang)
        this.ring(e.x, e.y, '#ffffff', 70, 0.5, 5)
        this.ring(e.x, e.y, color, 110, 0.7, 8)
        const bits = full ? 34 : 10
        for (let i = 0; i < bits; i++) {
          const a = ang + (Math.random() - 0.5) * 1.6
          const s = 200 + Math.random() * 520
          const c = i % 3 === 0 ? e.color : i % 3 === 1 ? color : '#ffffff'
          if (i % 2 === 0) this.add('confetti', e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 3 + Math.random() * 3, c, 1 + Math.random() * 0.6, 2.4)
          else this.add('spark', e.x, e.y, Math.cos(a) * s * 1.3, Math.sin(a) * s * 1.3, 2.5, c, 0.4 + Math.random() * 0.3, 3)
        }
        this.add('stamp', e.x, e.y - 30, 0, -24, local ? 34 : 24, e.victimId === localId ? '#ff4d3a' : '#fff7ea', 1.05, 0, (Math.random() - 0.5) * 0.3, 'KO!')
        this.flashA = Math.max(this.flashA, (local ? 0.32 : 0.1) * motion)
        this.flashColor = color
        this.trauma = Math.min(1, this.trauma + (local ? 0.55 : 0.22) * shake)
        if (local) {
          this.hitstop = Math.max(this.hitstop, 0.12)
          this.punch = Math.max(this.punch, 0.08 * motion)
        }
      } else if (e.type === 'boom') {
        this.ring(e.x, e.y, e.color, 70, 0.5, 8)
        this.ring(e.x, e.y, '#ffffff', 40, 0.25, 3)
        this.add('flash', e.x, e.y, 0, 0, 60, '#fff1c4', 0.14, 0)
        for (let i = 0; i < (full ? 22 : 8); i++) {
          const a = Math.random() * TAU
          const s = 120 + Math.random() * 380
          if (i % 2) this.add('spark', e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 2.5, i % 3 ? e.color : '#ffc14d', 0.4 + Math.random() * 0.3, 4)
          else this.add('dust', e.x, e.y, Math.cos(a) * s * 0.35, Math.sin(a) * s * 0.35, 10 + Math.random() * 12, '#3a3040', 0.8 + Math.random() * 0.5, 2)
        }
        this.trauma = Math.min(1, this.trauma + 0.22 * shake)
      } else if (e.type === 'land') {
        const b = match.bodies.find((x) => x.id === e.actorId)
        if (b) this.fxFor(b).land = 1
        if (full) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * TAU
            this.add('dust', e.x, e.y, Math.cos(a) * 40, Math.sin(a) * 40, 4 + Math.random() * 3, '#cfd9e6', 0.3, 4)
          }
        }
      } else if (e.type === 'wall') {
        for (let i = 0; i < (full ? 8 : 3); i++) {
          const a = Math.random() * TAU
          const s = 120 + Math.random() * 220
          this.add('spark', e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 1.8, i % 2 ? '#ffffff' : e.color, 0.25, 6)
        }
        this.ring(e.x, e.y, e.color, 18, 0.22, 2)
      } else if (e.type === 'ability') {
        this.ring(e.x, e.y, e.color, 60, 0.45, 5)
        this.ring(e.x, e.y, '#ffffff', 34, 0.3, 2)
        if (local && e.text) {
          const def = abilityById(e.text)
          if (def.id === e.text) this.add('text', e.x, e.y - 34, 0, -40, 15, e.color, 0.8, 0, 0, def.name.toUpperCase())
        }
      } else if (e.type === 'pickup') {
        this.ring(e.x, e.y, e.color, 40, 0.4, 4)
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU
          this.add('star', e.x, e.y, Math.cos(a) * 160, Math.sin(a) * 160, 7, e.color, 0.55, 4, 0, '', 6)
        }
        if (e.text) this.add('text', e.x, e.y - 30, 0, -40, 16, e.color, 0.9, 0, 0, e.text)
      } else if (e.type === 'save') {
        this.ring(e.x, e.y, '#3ee6a0', 44, 0.45, 4)
        if (local) this.add('text', e.x, e.y - 30, 0, -46, 18, '#3ee6a0', 0.95, 0, 0, 'SAVED!')
      } else if (e.type === 'spawn') {
        this.add('pillar', e.x, e.y, 0, 0, 34, e.color, 0.6, 0)
        this.ring(e.x, e.y, e.color, 46, 0.5, 4)
        const b = match.bodies.find((x) => x.id === e.actorId)
        if (b) {
          const fx = this.fxFor(b)
          fx.land = 1.4
          fx.ghosts = []
        }
      }
    }
  }

  draw(match: Match, alpha: number, prefs: RenderPrefs, biasX: number, spectateId: string): void {
    void alpha
    const w = this.canvas.width
    const h = this.canvas.height
    const now = performance.now()
    const dt = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.05) : 1 / 60
    this.lastNow = now
    this.clock += dt
    if (this.matchRef !== match) {
      this.matchRef = match
      this.balls.clear()
      this.finish = null
    }

    const dpr = this.dpr
    const focus = match.players.find((p) => p.id === spectateId && p.alive) ?? match.players.find((p) => p.alive)
    let tx = 0
    let ty = 0
    if (focus) {
      tx = clamp(focus.x + focus.vx * 0.06, -70, 70)
      ty = clamp(focus.y + focus.vy * 0.06, -50, 50)
    }
    let finishZoom = 0
    if (this.finish) {
      this.finish.life -= dt
      const u = clamp(this.finish.life / this.finish.max, 0, 1)
      const env = Math.sin(u * Math.PI)
      tx = lerp(tx, this.finish.x, env)
      ty = lerp(ty, this.finish.y, env)
      finishZoom = env * 0.45 * (prefs.reducedMotion ? 0.2 : 1)
      if (this.finish.life <= 0) this.finish = null
    }
    const follow = 1 - Math.exp(-4 * dt)
    this.camX = lerp(this.camX, tx, follow)
    this.camY = lerp(this.camY, ty, follow)
    this.punch *= Math.exp(-9 * dt)
    const baseZoom = Math.min(w, h) / (match.arena.view * 2 * 1.12)
    this.camZoom = lerp(this.camZoom, 1 + finishZoom, 1 - Math.exp(-7 * dt))
    const zoom = baseZoom * (this.camZoom + this.punch)

    this.trauma = Math.max(0, this.trauma - dt * 1.5)
    const quake = this.trauma * this.trauma * 16 * dpr
    const t = this.clock * 26
    const sx = quake * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4)
    const sy = quake * (Math.cos(t * 0.9 + 0.4) * 0.6 + Math.sin(t * 2.7 + 3.1) * 0.4)
    this.kickVX += (-260 * this.kickX - 20 * this.kickVX) * dt
    this.kickVY += (-260 * this.kickY - 20 * this.kickVY) * dt
    this.kickX += this.kickVX * dt
    this.kickY += this.kickVY * dt

    const originX = w / 2 + biasX * dpr + sx + this.kickX * dpr
    const originY = h / 2 + sy + this.kickY * dpr
    const camX = this.camX
    const camY = this.camY
    const project: Project = (x, y) => ({
      x: originX + (x - camX) * zoom,
      y: originY + (y - camY) * zoom,
    })
    this.css = (x, y) => {
      const p = project(x, y)
      return { x: p.x / dpr, y: p.y / dpr }
    }

    this.background(match, w, h)

    const poses = match.arena.solids.map((s) => solidPose(s, match.time, match.shrink))
    const bodies = match.bodies.filter((b) => b.alive)
    for (const b of bodies) this.track(b, dt)
    const sunk = (b: Body) => b.falling && b.fallHeight < -2
    const behind = bodies.filter((b) => sunk(b) && this.behindFloor(b, poses))

    for (const b of behind) this.drawBall(b, project, zoom, prefs)

    const depth = 16 * dpr * (zoom / baseZoom)
    for (const pose of poses) this.floorSide(pose, project, zoom, depth, match.arena.floor, match.arena.rim)
    for (const pose of poses) this.floorTop(pose, project, zoom, match)
    this.edgeGlow(bodies, project, zoom)

    this.hazards(match, project, zoom)
    this.events(match, project, zoom)
    if (match.zone) this.zone(match, project, zoom)
    this.walls(match, project)

    const front = bodies.filter((b) => !behind.includes(b))
    for (const b of front) this.trail(b, project, zoom)
    for (const b of front) this.ghosts(b, project, zoom)
    for (const b of front) {
      const p = project(b.x, b.y)
      const lift = Math.max(0, b.falling ? b.fallHeight : b.height) * zoom * 0.85
      this.shadow(p.x, p.y, b.radius * zoom * (b.falling ? 0.7 : 1), lift)
    }
    const sorted = [...front].sort((a, b) => a.y - b.y)
    for (const b of sorted) this.drawBall(b, project, zoom, prefs)

    this.drawParticles(project, zoom, dt, prefs)

    const placed: { x: number; y: number }[] = []
    for (const b of sorted) {
      if (b.decoy) continue
      const p = project(b.x, b.y)
      let lift = Math.max(0, b.height) * zoom * 0.85
      for (const other of placed) {
        if (Math.abs(other.x - p.x) < 80 * dpr && Math.abs(other.y - (p.y - lift)) < 20 * dpr) lift += 18 * dpr
      }
      placed.push({ x: p.x, y: p.y - lift })
      this.label(b, p.x, p.y - lift, zoom, b.id === spectateId && !match.silent)
    }

    this.screenFx(match, w, h, dt, prefs, focus, spectateId)
    this.offscreen(match, project, w, h, spectateId)
    this.countdown(match, w, h)
  }

  // ---------------------------------------------------------------- world

  private background(match: Match, w: number, h: number): void {
    const ctx = this.ctx
    const accent = match.arena.accent
    const rim = match.arena.rim
    const bg = ctx.createRadialGradient(w / 2, h * 0.45, 20, w / 2, h / 2, Math.max(w, h) * 0.75)
    bg.addColorStop(0, mixHex('#0f1b2b', rim, 0.1))
    bg.addColorStop(0.5, '#0a111b')
    bg.addColorStop(1, '#04070c')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const blobs: [number, number, string, number][] = [
      [0.18 + Math.sin(this.clock * 0.05) * 0.04, 0.22, rim, 0.07],
      [0.82, 0.78 + Math.cos(this.clock * 0.04) * 0.05, accent, 0.06],
    ]
    for (const [bx, by, c, a] of blobs) {
      const cx = bx * w - this.camX * 0.2 * this.dpr
      const cy = by * h - this.camY * 0.2 * this.dpr
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.45)
      g.addColorStop(0, hexA(c, a))
      g.addColorStop(1, hexA(c, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()

    for (const s of this.stars) {
      const px = (((s.x * w - this.camX * s.depth * this.dpr * 0.6) % w) + w) % w
      const py = (((s.y * h - this.camY * s.depth * this.dpr * 0.6) % h) + h) % h
      const tw = 0.6 + Math.sin(this.clock * s.tw + s.x * 40) * 0.4
      ctx.fillStyle = `rgba(210,228,255,${s.a * tw})`
      ctx.fillRect(px, py, s.r * this.dpr, s.r * this.dpr)
    }
  }

  private behindFloor(b: Body, poses: Pose[]): boolean {
    let best: Pose | null = null
    let bestD = Infinity
    for (const p of poses) {
      const d = Math.hypot(b.x - p.x, b.y - p.y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return !!best && b.y < best.y
  }

  private floorSide(pose: Pose, project: Project, zoom: number, depth: number, floor: string, rim: string): void {
    const ctx = this.ctx
    const c = project(pose.x, pose.y)
    ctx.save()
    ctx.globalAlpha = pose.active ? 1 : 0.15
    if (pose.warn) ctx.globalAlpha = 0.5 + Math.sin(this.clock * 18) * 0.25
    const side = ctx.createLinearGradient(0, c.y, 0, c.y + (pose.r || 300) * zoom + depth)
    side.addColorStop(0, mixHex(floor, '#000000', 0.45))
    side.addColorStop(1, mixHex(floor, '#000000', 0.75))
    ctx.fillStyle = side
    if (pose.shape === 'poly') {
      const pts = pose.points.map((pt) => project(pt.x, pt.y))
      ctx.beginPath()
      pts.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y + depth) : ctx.moveTo(s.x, s.y + depth)))
      ctx.closePath()
      ctx.fill()
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % pts.length]!
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(b.x, b.y + depth)
        ctx.lineTo(a.x, a.y + depth)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      const r = pose.r * zoom
      ctx.beginPath()
      ctx.arc(c.x, c.y + depth, r, 0, Math.PI)
      ctx.lineTo(c.x - r, c.y)
      ctx.arc(c.x, c.y, r, Math.PI, 0, true)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = hexA(rim, 0.35)
      ctx.lineWidth = 1.5 * this.dpr
      ctx.beginPath()
      ctx.arc(c.x, c.y + depth, r, 0, Math.PI)
      ctx.stroke()
    }
    ctx.restore()
  }

  private floorTop(pose: Pose, project: Project, zoom: number, match: Match): void {
    const ctx = this.ctx
    const { floor, rim, accent, id: arenaId } = match.arena
    const c = project(pose.x, pose.y)
    const r = pose.r * zoom
    ctx.save()
    ctx.globalAlpha = pose.active ? 1 : 0.16
    if (pose.warn) ctx.globalAlpha = 0.5 + Math.sin(this.clock * 18) * 0.25

    const path = () => {
      ctx.beginPath()
      if (pose.shape === 'poly') {
        pose.points.forEach((pt, i) => {
          const s = project(pt.x, pt.y)
          if (i === 0) ctx.moveTo(s.x, s.y)
          else ctx.lineTo(s.x, s.y)
        })
        ctx.closePath()
      } else {
        ctx.arc(c.x, c.y, r, 0, TAU)
        if (pose.shape === 'ring') {
          ctx.moveTo(c.x + pose.inner * zoom, c.y)
          ctx.arc(c.x, c.y, pose.inner * zoom, 0, TAU, true)
        }
      }
    }

    const span = pose.shape === 'poly' ? 520 * zoom : r
    const g = ctx.createRadialGradient(c.x, c.y - span * 0.3, span * 0.05, c.x, c.y, span * 1.05)
    const surfaceTint = pose.surface === 'rubber' ? '#ff6b9a' : pose.surface === 'ice' ? '#bfe8ff' : pose.surface === 'launch' ? '#ffc14d' : floor
    const top = pose.surface === 'normal' ? floor : mixHex(floor, surfaceTint, 0.12)
    g.addColorStop(0, mixHex(top, '#ffffff', 0.12))
    g.addColorStop(0.7, top)
    g.addColorStop(1, mixHex(top, '#000000', 0.3))
    path()
    ctx.fillStyle = g
    ctx.fill('evenodd')

    // Grid: reads motion, as in slither.io. The pattern follows the world.
    const pattern = this.gridPattern()
    if (pattern) {
      const o = project(0, 0)
      const scale = zoom * 1.4
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, o.x, o.y]))
      ctx.save()
      path()
      ctx.clip('evenodd')
      ctx.globalAlpha *= 0.55
      ctx.fillStyle = pattern
      ctx.fillRect(c.x - span * 1.4, c.y - span * 1.4, span * 2.8, span * 2.8)
      ctx.restore()
    }

    if ((arenaId === 'classic' || arenaId === 'collapse') && pose.shape === 'circle') {
      ctx.save()
      ctx.globalAlpha *= 0.3
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.5 * this.dpr
      for (const ring of [0.33, 0.66]) {
        ctx.beginPath()
        ctx.arc(c.x, c.y, r * ring, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }
    if (pose.surface === 'launch') {
      ctx.save()
      ctx.strokeStyle = hexA('#ffc14d', 0.5)
      ctx.lineWidth = 2 * this.dpr
      ctx.setLineDash([8 * this.dpr, 8 * this.dpr])
      ctx.lineDashOffset = -this.clock * 30 * this.dpr
      ctx.beginPath()
      ctx.arc(c.x, c.y, r * 0.7, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }

    // Danger rim: marching hazard stripes, brighter in the final phase.
    const hot = match.finalPhase || match.status === 'sudden'
    const rimW = 7 * this.dpr
    const drawRim = (cx: number, cy: number, rr: number) => {
      ctx.beginPath()
      ctx.arc(cx, cy, rr, 0, TAU)
      ctx.lineWidth = rimW * 3
      ctx.strokeStyle = hexA(rim, hot ? 0.22 + Math.sin(this.clock * 8) * 0.08 : 0.12)
      ctx.stroke()
      ctx.lineWidth = rimW
      ctx.strokeStyle = mixHex(rim, '#000000', 0.55)
      ctx.stroke()
      ctx.setLineDash([10 * this.dpr, 10 * this.dpr])
      ctx.lineDashOffset = this.clock * 24 * this.dpr
      ctx.strokeStyle = rim
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1.5 * this.dpr
      ctx.strokeStyle = hexA('#ffffff', 0.45)
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(1, rr - rimW / 2 - 1.5 * this.dpr), 0, TAU)
      ctx.stroke()
    }
    if (pose.shape === 'poly') {
      path()
      ctx.lineWidth = rimW * 3
      ctx.strokeStyle = hexA(rim, hot ? 0.22 : 0.12)
      ctx.stroke()
      ctx.lineWidth = rimW
      ctx.strokeStyle = mixHex(rim, '#000000', 0.55)
      ctx.stroke()
      ctx.setLineDash([10 * this.dpr, 10 * this.dpr])
      ctx.lineDashOffset = this.clock * 24 * this.dpr
      ctx.strokeStyle = rim
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      drawRim(c.x, c.y, r)
      if (pose.shape === 'ring') {
        ctx.save()
        ctx.beginPath()
        ctx.arc(c.x, c.y, pose.inner * zoom, 0, TAU)
        ctx.fillStyle = 'rgba(2,4,8,0.75)'
        ctx.fill()
        ctx.restore()
        drawRim(c.x, c.y, pose.inner * zoom)
      }
    }
    ctx.restore()
  }

  /** Red glow on the rim right where a ball is about to leave. */
  private edgeGlow(bodies: Body[], project: Project, zoom: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bodies) {
      if (b.decoy || b.edgeDist > 70 || b.edgeDist < -40) continue
      const k = clamp(1 - b.edgeDist / 70, 0, 1)
      const ex = b.x - b.safetyX * b.edgeDist
      const ey = b.y - b.safetyY * b.edgeDist
      const s = project(ex, ey)
      const rr = (50 + k * 40) * zoom
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
      g.addColorStop(0, hexA('#ff4d3a', 0.5 * k))
      g.addColorStop(1, hexA('#ff4d3a', 0))
      ctx.fillStyle = g
      ctx.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2)
    }
    ctx.restore()
  }

  private walls(match: Match, project: Project): void {
    const ctx = this.ctx
    ctx.save()
    ctx.lineCap = 'round'
    for (const wall of wallSegments(match.arena.walls, match.time)) {
      const a = project(wall.x1, wall.y1)
      const b = project(wall.x2, wall.y2)
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 9 * this.dpr
      ctx.beginPath()
      ctx.moveTo(a.x, a.y + 5 * this.dpr)
      ctx.lineTo(b.x, b.y + 5 * this.dpr)
      ctx.stroke()
      ctx.strokeStyle = hexA(match.arena.rim, 0.35)
      ctx.lineWidth = 12 * this.dpr
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.strokeStyle = '#f4f7fb'
      ctx.lineWidth = 4 * this.dpr
      ctx.stroke()
    }
    ctx.restore()
  }

  private hazards(match: Match, project: Project, zoom: number): void {
    const ctx = this.ctx
    const T = this.clock
    const dpr = this.dpr
    for (const h of [...match.arena.hazards, ...match.extras]) {
      const p = hazardPose(h, match.time)
      const s = project(p.x, p.y)
      const r = Math.max(4, p.r * zoom)
      ctx.save()
      if (h.kind === 'lava') {
        const pulse = 0.5 + Math.sin(T * 4) * 0.5
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.25)
        g.addColorStop(0, '#ffd27a')
        g.addColorStop(0.45, '#ff6a2a')
        g.addColorStop(0.85, '#c21f12')
        g.addColorStop(1, 'rgba(194,31,18,0)')
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * 1.25, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4 + T * 0.3
          const d = ((i * 0.37 + T * 0.12) % 1) * r * 0.8
          const br = (1 - ((T * 0.8 + i * 0.3) % 1)) * r * 0.14
          ctx.beginPath()
          ctx.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, br, 0, TAU)
          ctx.fillStyle = hexA('#ffe3a0', 0.35 + pulse * 0.2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, TAU)
        ctx.strokeStyle = hexA('#ffb199', 0.5 + pulse * 0.4)
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
      } else if (h.kind === 'spikes') {
        const n = 10
        ctx.beginPath()
        for (let i = 0; i <= n * 2; i++) {
          const a = (i / (n * 2)) * TAU + T * 0.4
          const rr = i % 2 ? r * 0.55 : r
          ctx.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr)
        }
        ctx.closePath()
        ctx.fillStyle = '#ff4d3a'
        ctx.fill()
        ctx.strokeStyle = '#ffd0c8'
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
      } else if (h.kind === 'bumper') {
        const pulse = 1 + Math.sin(T * 5 + h.x) * 0.04
        ctx.beginPath()
        ctx.arc(s.x, s.y + 5 * dpr, r * pulse, 0, TAU)
        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(s.x, s.y, r * 0.6, s.x, s.y, r * 1.7)
        halo.addColorStop(0, hexA(h.color, 0.35))
        halo.addColorStop(1, hexA(h.color, 0))
        ctx.fillStyle = halo
        ctx.fillRect(s.x - r * 1.7, s.y - r * 1.7, r * 3.4, r * 3.4)
        ctx.globalCompositeOperation = 'source-over'
        const g = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.35, r * 0.1, s.x, s.y, r * pulse)
        g.addColorStop(0, mixHex(h.color, '#ffffff', 0.6))
        g.addColorStop(0.6, h.color)
        g.addColorStop(1, mixHex(h.color, '#000000', 0.4))
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * pulse, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
        ctx.lineWidth = 3 * dpr
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * 0.55, 0, TAU)
        ctx.strokeStyle = hexA('#ffffff', 0.6)
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
      } else if (h.kind === 'portal') {
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.3)
        g.addColorStop(0, hexA(h.color, 0.55))
        g.addColorStop(0.7, hexA(h.color, 0.15))
        g.addColorStop(1, hexA(h.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * 1.3, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = h.color
        ctx.lineWidth = 2.5 * dpr
        for (let i = 0; i < 3; i++) {
          const a = T * 2.5 + (i * TAU) / 3
          ctx.beginPath()
          ctx.arc(s.x, s.y, r * (0.45 + i * 0.22), a, a + 2.2)
          ctx.stroke()
        }
      } else if (h.kind === 'launcher') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, TAU)
        ctx.fillStyle = hexA(h.color, 0.18)
        ctx.fill()
        ctx.strokeStyle = h.color
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
        ctx.translate(s.x, s.y)
        ctx.rotate(h.angle)
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, TAU)
        ctx.clip()
        for (let i = 0; i < 3; i++) {
          const u = ((T * 1.6 + i / 3) % 1)
          const x = lerp(-r * 0.8, r * 0.8, u)
          ctx.globalAlpha = Math.sin(u * Math.PI)
          ctx.beginPath()
          ctx.moveTo(x - r * 0.25, -r * 0.4)
          ctx.lineTo(x + r * 0.15, 0)
          ctx.lineTo(x - r * 0.25, r * 0.4)
          ctx.strokeStyle = h.color
          ctx.lineWidth = 4 * dpr
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
      } else if (h.kind === 'blackhole') {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.4)
        g.addColorStop(0, '#000000')
        g.addColorStop(0.55, 'rgba(40,10,80,0.9)')
        g.addColorStop(1, 'rgba(80,40,160,0)')
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * 1.4, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = hexA('#b388ff', 0.7)
        ctx.lineWidth = 2 * dpr
        for (let i = 0; i < 4; i++) {
          const a = -T * 3 + (i * TAU) / 4
          ctx.beginPath()
          ctx.arc(s.x, s.y, r * (0.5 + (i % 2) * 0.4), a, a + 1.4)
          ctx.stroke()
        }
      } else if (h.kind === 'explosive') {
        const warn = explosiveWarn(h, match.time)
        const blink = warn ? (Math.sin(T * 30) > 0 ? 1 : 0.4) : 0.6
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, TAU)
        ctx.fillStyle = hexA('#ff4d3a', 0.2 * blink)
        ctx.fill()
        ctx.setLineDash([6 * dpr, 5 * dpr])
        ctx.lineDashOffset = T * 20
        ctx.strokeStyle = hexA('#ffc14d', blink)
        ctx.lineWidth = 2.5 * dpr
        ctx.stroke()
      } else if (h.kind === 'laser') {
        const mode = laserMode(h, match.time)
        const start = project(h.x, h.y)
        ctx.beginPath()
        ctx.arc(start.x, start.y, 9 * dpr, 0, TAU)
        ctx.fillStyle = mode === 'hot' ? '#ff4d3a' : '#3a2a2a'
        ctx.fill()
        ctx.strokeStyle = '#ffc14d'
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
        if (mode !== 'off') {
          const ang = laserAngle(h, match.time)
          const end = project(h.x + Math.cos(ang) * p.r, h.y + Math.sin(ang) * p.r)
          ctx.lineCap = 'round'
          if (mode === 'hot') {
            ctx.globalCompositeOperation = 'lighter'
            for (const [wd, col] of [[22, 'rgba(255,60,40,0.18)'], [11, 'rgba(255,90,60,0.5)'], [4, '#fff2ea']] as const) {
              ctx.strokeStyle = col
              ctx.lineWidth = (wd + Math.sin(T * 60) * 1.5) * dpr
              ctx.beginPath()
              ctx.moveTo(start.x, start.y)
              ctx.lineTo(end.x, end.y)
              ctx.stroke()
            }
          } else {
            ctx.setLineDash([10 * dpr, 8 * dpr])
            ctx.lineDashOffset = -T * 80
            ctx.strokeStyle = `rgba(255,193,77,${0.5 + Math.sin(T * 24) * 0.3})`
            ctx.lineWidth = 2 * dpr
            ctx.beginPath()
            ctx.moveTo(start.x, start.y)
            ctx.lineTo(end.x, end.y)
            ctx.stroke()
          }
        }
      } else if (h.kind === 'conveyor' || h.kind === 'gravity' || h.kind === 'ice' || h.kind === 'crusher') {
        const hw = (h.w || h.r * 2) * zoom
        const hh = (h.h || h.r * 2) * zoom
        const x0 = s.x - hw / 2
        const y0 = s.y - hh / 2
        ctx.beginPath()
        ctx.rect(x0, y0, hw, hh)
        ctx.clip()
        if (h.kind === 'conveyor') {
          ctx.fillStyle = hexA(h.color, 0.12)
          ctx.fillRect(x0, y0, hw, hh)
          const step = 46 * zoom
          const dir = Math.cos(h.angle) >= 0 ? 1 : -1
          const off = ((T * h.speed * zoom * dir) % step + step) % step
          ctx.strokeStyle = hexA(h.color, 0.4)
          ctx.lineWidth = 4 * dpr
          ctx.lineJoin = 'round'
          for (let x = x0 - step + off; x < x0 + hw + step; x += step) {
            ctx.beginPath()
            ctx.moveTo(x - dir * hh * 0.18, s.y - hh * 0.3)
            ctx.lineTo(x + dir * hh * 0.12, s.y)
            ctx.lineTo(x - dir * hh * 0.18, s.y + hh * 0.3)
            ctx.stroke()
          }
          ctx.strokeStyle = hexA(h.color, 0.5)
          ctx.lineWidth = 2 * dpr
          ctx.strokeRect(x0, y0, hw, hh)
        } else if (h.kind === 'gravity') {
          const light = h.speed < 1
          ctx.fillStyle = light ? 'rgba(126,224,255,0.1)' : 'rgba(214,255,74,0.08)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.fillStyle = light ? 'rgba(126,224,255,0.45)' : 'rgba(214,255,74,0.35)'
          for (let i = 0; i < 26; i++) {
            const fx = ((i * 0.618) % 1) * hw
            const drift = light ? -1 : 1
            const fy = ((((i * 0.37) + T * 0.05 * (light ? 1 : 2.2) * drift) % 1) + 1) % 1 * hh
            const sz = (light ? 2.5 : 1.8) * dpr
            ctx.fillRect(x0 + fx, y0 + fy, sz, light ? sz : sz * 4)
          }
        } else if (h.kind === 'ice') {
          ctx.fillStyle = 'rgba(191,232,255,0.14)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'
          ctx.lineWidth = 2 * dpr
          for (let x = x0 - hh; x < x0 + hw; x += 40 * dpr) {
            ctx.beginPath()
            ctx.moveTo(x, y0 + hh)
            ctx.lineTo(x + hh, y0)
            ctx.stroke()
          }
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.1)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.strokeStyle = 'rgba(255,193,77,0.5)'
          ctx.lineWidth = 6 * dpr
          for (let x = x0 - hh; x < x0 + hw; x += 22 * dpr) {
            ctx.beginPath()
            ctx.moveTo(x, y0 + hh)
            ctx.lineTo(x + hh, y0)
            ctx.stroke()
          }
        }
      }
      ctx.restore()
    }
  }

  private events(match: Match, project: Project, zoom: number): void {
    const ctx = this.ctx
    const dpr = this.dpr
    for (const ev of match.live) {
      const s = project(ev.x, ev.y)
      const r = Math.max(8, ev.r * zoom)
      ctx.save()
      if (ev.kind === 'meteor' || ev.kind === 'blast') {
        if (ev.fired) {
          ctx.beginPath()
          ctx.arc(s.x, s.y, r, 0, TAU)
          ctx.fillStyle = 'rgba(40,20,20,0.35)'
          ctx.fill()
        } else {
          const u = clamp((match.time - ev.born) / Math.max(0.01, ev.dur), 0, 1)
          ctx.beginPath()
          ctx.arc(s.x, s.y, r, 0, TAU)
          ctx.fillStyle = `rgba(255,77,58,${0.08 + u * 0.18})`
          ctx.fill()
          ctx.setLineDash([6 * dpr, 5 * dpr])
          ctx.lineDashOffset = this.clock * 20
          ctx.strokeStyle = 'rgba(255,193,77,0.9)'
          ctx.lineWidth = 2 * dpr
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(s.x, s.y, r * u, 0, TAU)
          ctx.strokeStyle = 'rgba(255,77,58,0.9)'
          ctx.lineWidth = 3 * dpr
          ctx.stroke()
          if (ev.kind === 'meteor') {
            const fall = (1 - u) * 260 * zoom
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createLinearGradient(s.x + fall * 0.5, s.y - fall, s.x, s.y - fall * 0.1)
            g.addColorStop(0, 'rgba(255,120,60,0)')
            g.addColorStop(1, 'rgba(255,200,120,0.9)')
            ctx.strokeStyle = g
            ctx.lineWidth = 8 * dpr
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(s.x + fall * 0.5, s.y - fall)
            ctx.lineTo(s.x + fall * 0.05, s.y - fall * 0.1)
            ctx.stroke()
          }
        }
      } else if (ev.kind === 'orb' && !ev.fired) {
        const bob = Math.sin(this.clock * 6) * 4 * dpr
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(s.x, s.y + bob, 0, s.x, s.y + bob, 28 * dpr)
        g.addColorStop(0, 'rgba(255,193,77,0.8)')
        g.addColorStop(1, 'rgba(255,193,77,0)')
        ctx.fillStyle = g
        ctx.fillRect(s.x - 28 * dpr, s.y + bob - 28 * dpr, 56 * dpr, 56 * dpr)
        ctx.globalCompositeOperation = 'source-over'
        ctx.beginPath()
        ctx.arc(s.x, s.y + bob, 9 * dpr, 0, TAU)
        ctx.fillStyle = '#ffe3a0'
        ctx.fill()
        ctx.strokeStyle = '#ffc14d'
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
      } else if (ev.kind === 'hole') {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r)
        g.addColorStop(0, 'rgba(0,0,0,0.9)')
        g.addColorStop(1, 'rgba(60,20,90,0.35)')
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = '#b388ff'
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
      }
      ctx.restore()
    }
    for (const well of match.wells) {
      const s = project(well.x, well.y)
      const r = well.r * zoom
      ctx.save()
      ctx.strokeStyle = 'rgba(179,136,255,0.7)'
      ctx.lineWidth = 2 * dpr
      for (let i = 0; i < 3; i++) {
        const u = ((this.clock * 0.8 + i / 3) % 1)
        ctx.globalAlpha = u
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * (1 - u) + 4, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private zone(match: Match, project: Project, zoom: number): void {
    if (!match.zone) return
    const ctx = this.ctx
    const s = project(match.zone.x, match.zone.y)
    const r = match.zone.r * zoom
    ctx.save()
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r)
    g.addColorStop(0, 'rgba(255,193,77,0.04)')
    g.addColorStop(1, 'rgba(255,193,77,0.2)')
    ctx.beginPath()
    ctx.arc(s.x, s.y, r, 0, TAU)
    ctx.fillStyle = g
    ctx.fill()
    ctx.setLineDash([14 * this.dpr, 8 * this.dpr])
    ctx.lineDashOffset = -this.clock * 30
    ctx.strokeStyle = '#ffc14d'
    ctx.lineWidth = 3 * this.dpr
    ctx.stroke()
    ctx.restore()
  }

  // ---------------------------------------------------------------- balls

  private fxFor(b: Body): BallFx {
    let fx = this.balls.get(b.id)
    if (!fx) {
      fx = {
        squash: 0, squashV: 0, squashAng: 0, land: 0, roll: 0,
        vx: 0, vy: 0,
        ghosts: [], ghostTimer: 0, emberTimer: 0,
      }
      this.balls.set(b.id, fx)
    }
    return fx
  }

  private track(b: Body, dt: number): void {
    const fx = this.fxFor(b)
    fx.vx = b.vx
    fx.vy = b.vy
    // Damped spring back to round, like a rubber ball.
    fx.squashV += (-420 * fx.squash - 16 * fx.squashV) * dt
    fx.squash = clamp(fx.squash + fx.squashV * dt, -0.4, 0.4)
    fx.land = Math.max(0, fx.land - dt * 6)
    fx.roll += (Math.hypot(b.vx, b.vy) / Math.max(4, b.radius)) * dt * (b.vx >= 0 ? 1 : -1)
    if (fx.ghostTimer > 0) {
      fx.ghostTimer -= dt
      fx.ghosts.push({ x: b.x, y: b.y, life: 0.22 })
    }
    for (const g of fx.ghosts) g.life -= dt
    fx.ghosts = fx.ghosts.filter((g) => g.life > 0)
    if (b.trail === 'trail_ember' && Math.hypot(b.vx, b.vy) > 260) {
      fx.emberTimer -= dt
      if (fx.emberTimer <= 0) {
        fx.emberTimer = 0.03
        const a = Math.atan2(b.vy, b.vx) + Math.PI + (Math.random() - 0.5) * 0.8
        this.add('ember', b.x, b.y, Math.cos(a) * 60, Math.sin(a) * 60 - 20, 2 + Math.random() * 2, Math.random() < 0.5 ? '#ffc14d' : '#ff6a2a', 0.5, 2)
      }
    }
  }

  private trail(b: Body, project: Project, zoom: number): void {
    const speed = Math.hypot(b.vx, b.vy)
    if (speed < 90 || b.trail === 'trail_none' || b.trail === 'trail_ember') return
    const ctx = this.ctx
    const pts: { x: number; y: number }[] = []
    const n = b.hist.length / 2
    for (let i = 0; i < n; i++) {
      const idx = (b.histI / 2 + i) % n
      const x = b.hist[idx * 2]
      const y = b.hist[idx * 2 + 1]
      if (x === undefined || y === undefined || (x === 0 && y === 0)) continue
      const last = pts[pts.length - 1]
      if (last && Math.hypot(last.x - x, last.y - y) > 140) pts.length = 0
      pts.push({ x, y })
    }
    pts.push({ x: b.x, y: b.y })
    if (pts.length < 3) return
    const sp = pts.map((p) => project(p.x, p.y))
    const lift = Math.max(0, b.height) * zoom * 0.85
    const a0 = clamp((speed - 90) / 600, 0.1, 0.85)
    const r = b.radius * zoom
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const kind = b.trail
    const m = sp.length
    if (kind === 'trail_ribbon') {
      for (let i = 1; i < m; i++) {
        const u = i / (m - 1)
        ctx.strokeStyle = hexA(b.color, a0 * u * 0.6)
        ctx.lineWidth = r * 1.7
        ctx.beginPath()
        ctx.moveTo(sp[i - 1]!.x, sp[i - 1]!.y - lift)
        ctx.lineTo(sp[i]!.x, sp[i]!.y - lift)
        ctx.stroke()
      }
    } else if (kind === 'trail_ion') {
      for (const side of [-1, 1]) {
        ctx.beginPath()
        for (let i = 0; i < m; i++) {
          const prev = sp[Math.max(0, i - 1)]!
          const next = sp[Math.min(m - 1, i + 1)]!
          const dx = next.x - prev.x
          const dy = next.y - prev.y
          const l = Math.hypot(dx, dy) || 1
          const px = (-dy / l) * r * 0.55 * side
          const py = (dx / l) * r * 0.55 * side
          const q = sp[i]!
          if (i === 0) ctx.moveTo(q.x + px, q.y + py - lift)
          else ctx.lineTo(q.x + px, q.y + py - lift)
        }
        ctx.strokeStyle = hexA(mixHex(b.color, '#ffffff', 0.4), a0)
        ctx.lineWidth = 1.6 * this.dpr
        ctx.stroke()
      }
    } else if (kind === 'trail_spark') {
      for (let i = 1; i < m; i++) {
        const q = sp[i]!
        const j = Math.sin(i * 12.9898 + Math.floor(this.clock * 30) * 78.233) * r * 0.9
        const k = Math.cos(i * 4.1414 + Math.floor(this.clock * 30) * 12.3) * r * 0.9
        ctx.strokeStyle = hexA(i % 2 ? '#ffffff' : b.color, a0 * (i / m))
        ctx.lineWidth = 1.5 * this.dpr
        ctx.beginPath()
        ctx.moveTo(q.x, q.y - lift)
        ctx.lineTo(q.x + j, q.y + k - lift)
        ctx.stroke()
      }
    } else if (kind === 'trail_hex') {
      for (let i = 1; i < m; i += 2) {
        const q = sp[i]!
        const u = i / m
        ctx.strokeStyle = hexA(b.color, a0 * u)
        ctx.lineWidth = 1.5 * this.dpr
        ctx.beginPath()
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU + i
          const rr = r * (0.3 + u * 0.4)
          ctx.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr - lift)
        }
        ctx.stroke()
      }
    } else {
      // Comet: tapered, hot at the head.
      for (let i = 1; i < m; i++) {
        const u = i / (m - 1)
        ctx.strokeStyle = hexA(mixHex(b.color, '#ffffff', u * 0.35), a0 * u)
        ctx.lineWidth = Math.max(1, r * 1.5 * u)
        ctx.beginPath()
        ctx.moveTo(sp[i - 1]!.x, sp[i - 1]!.y - lift)
        ctx.lineTo(sp[i]!.x, sp[i]!.y - lift)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private ghosts(b: Body, project: Project, zoom: number): void {
    const fx = this.balls.get(b.id)
    if (!fx || fx.ghosts.length === 0) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const g of fx.ghosts) {
      const s = project(g.x, g.y)
      const u = g.life / 0.22
      ctx.globalAlpha = u * 0.35
      ctx.beginPath()
      ctx.arc(s.x, s.y - Math.max(0, b.height) * zoom * 0.85, b.radius * zoom * (0.7 + u * 0.3), 0, TAU)
      ctx.fillStyle = b.color
      ctx.fill()
    }
    ctx.restore()
  }

  private shadow(x: number, y: number, r: number, lift: number): void {
    const ctx = this.ctx
    const spread = 1 + lift / 160
    ctx.beginPath()
    ctx.ellipse(x, y + r * 0.15, r * 0.9 * spread, r * 0.42 * spread, 0, 0, TAU)
    ctx.fillStyle = `rgba(0,0,0,${clamp(0.42 - lift / 300, 0.1, 0.42)})`
    ctx.fill()
  }

  private drawBall(b: Body, project: Project, zoom: number, prefs: RenderPrefs): void {
    const ctx = this.ctx
    const fx = this.fxFor(b)
    const p = project(b.x, b.y)
    const h = b.falling ? b.fallHeight : b.height
    const lift = h * zoom * 0.85
    let r = b.radius * zoom * (1 + Math.max(0, lift) * 0.0016)
    const x = p.x
    const y = p.y - lift
    let sink = 0
    if (b.falling && b.fallHeight < 0) {
      sink = clamp(-b.fallHeight / 32, 0, 1)
      r *= 1 - sink * 0.45
    }
    ctx.save()
    if (b.phaseTime > 0) ctx.globalAlpha = 0.45
    if (b.decoy) ctx.globalAlpha = 0.7
    ctx.translate(x, y)
    ctx.save()
    const speed = Math.hypot(b.vx, b.vy)
    const stretch = prefs.reducedMotion ? 0 : Math.min(0.22, (speed / SPEED_CAP) * 0.26)
    const va = Math.atan2(b.vy, b.vx)
    ctx.rotate(va)
    ctx.scale(1 + stretch, 1 / (1 + stretch))
    ctx.rotate(-va)
    if (fx.squash !== 0 && !prefs.reducedMotion) {
      ctx.rotate(fx.squashAng)
      ctx.scale(1 + fx.squash, 1 / (1 + fx.squash))
      ctx.rotate(-fx.squashAng)
    }
    if (fx.land > 0 && !prefs.reducedMotion) {
      const l = Math.sin(Math.min(1, fx.land) * Math.PI) * 0.16
      ctx.scale(1 + l, 1 - l)
    }

    const skinMix = b.skin === 'glass' ? 0.35 : b.skin === 'chrome' ? 0.2 : 0.08
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.1, 0, 0, r)
    g.addColorStop(0, mixHex(b.color, '#ffffff', 0.55 + skinMix))
    g.addColorStop(0.5, b.color)
    g.addColorStop(1, mixHex(b.color, '#000000', b.skin === 'hollow' ? 0.15 : 0.5))
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    if (b.skin !== 'hollow') {
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.save()
    ctx.clip()
    ctx.rotate(fx.roll * 0.35)
    this.pattern(b.pattern + (prefs.colorblind ? 1 : 0), 0, 0, r)
    ctx.restore()
    // Rim light from below, then the specular highlight.
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.92, 0.2, Math.PI - 0.2)
    ctx.strokeStyle = hexA(mixHex(b.color, '#ffffff', 0.5), 0.45)
    ctx.lineWidth = Math.max(1, r * 0.1)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(-r * 0.3, -r * 0.38, r * 0.3, r * 0.15, -0.6, 0, TAU)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(-r * 0.12, -r * 0.55, r * 0.06, 0, TAU)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.lineWidth = (b.skin === 'hollow' ? 4 : 2) * this.dpr
    ctx.strokeStyle = mixHex(b.color, '#000000', 0.45)
    ctx.stroke()
    if (b.hitFlash > 0.5) {
      ctx.fillStyle = `rgba(255,255,255,${(b.hitFlash - 0.5) * 1.8})`
      ctx.fill()
    }
    if (sink > 0) {
      ctx.fillStyle = `rgba(2,4,10,${sink * 0.75})`
      ctx.fill()
    }
    ctx.restore()

    if (!b.decoy && !b.falling) this.auras(b, r, prefs)
    ctx.restore()
  }

  private auras(b: Body, r: number, prefs: RenderPrefs): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const T = this.clock
    const ringR = r + 7 * dpr
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, TAU)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 3.5 * dpr
    ctx.stroke()
    if (b.momentum > 0.01) {
      const col = mixHex('#3ee6a0', '#ff4d3a', b.momentum)
      if (b.momentum > 0.85) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.arc(0, 0, ringR, 0, TAU)
        ctx.strokeStyle = hexA(col, 0.25 + Math.sin(T * 14) * 0.12)
        ctx.lineWidth = 9 * dpr
        ctx.stroke()
        ctx.restore()
      }
      ctx.beginPath()
      ctx.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * b.momentum)
      ctx.strokeStyle = col
      ctx.lineWidth = 3 * dpr
      ctx.stroke()
    }
    if (b.dashCd <= 0) {
      const a = T * 2.4
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * ringR, Math.sin(a) * ringR, 2.6 * dpr, 0, TAU)
      ctx.fill()
    }
    if (b.invuln > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.setLineDash([4 * dpr, 5 * dpr])
      ctx.lineDashOffset = -T * 30
      ctx.beginPath()
      ctx.arc(0, 0, r + 11 * dpr, 0, TAU)
      ctx.strokeStyle = hexA('#7ee0ff', 0.5 + Math.sin(T * 12) * 0.25)
      ctx.lineWidth = 2 * dpr
      ctx.stroke()
      ctx.restore()
    }
    if (b.overdriveTime > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 6; i++) {
        const a = T * 6 + (i * TAU) / 6
        ctx.beginPath()
        ctx.arc(0, 0, r + 4 * dpr, a, a + 0.5)
        ctx.strokeStyle = hexA('#ffc14d', 0.8)
        ctx.lineWidth = 3 * dpr
        ctx.stroke()
      }
      ctx.restore()
    }
    if (b.anchorTime > 0 || b.mirrorTime > 0) {
      ctx.strokeStyle = b.mirrorTime > 0 ? '#7ee0ff' : '#f4f7fb'
      ctx.lineWidth = 2.5 * dpr
      ctx.beginPath()
      const sides = b.mirrorTime > 0 ? 6 : 4
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * TAU + T * 0.8
        ctx.lineTo(Math.cos(a) * (r + 5 * dpr), Math.sin(a) * (r + 5 * dpr))
      }
      ctx.stroke()
    }
    if (b.edgeDist < 40 && b.edgeDist > -20 && !prefs.reducedMotion) {
      ctx.save()
      ctx.globalAlpha = 0.5 + Math.sin(T * 20) * 0.5
      ctx.fillStyle = '#ff4d3a'
      ctx.font = `800 ${12 * dpr}px "Barlow Condensed", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('!', 0, r + 18 * dpr)
      ctx.restore()
    }
  }

  private pattern(kind: number, x: number, y: number, r: number): void {
    const ctx = this.ctx
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'
    ctx.fillStyle = 'rgba(0,0,0,0.26)'
    ctx.lineWidth = Math.max(1.5, r * 0.12)
    const k = kind % 8
    if (k === 1) {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(x - r, y + i * r * 0.32)
        ctx.lineTo(x + r, y + i * r * 0.32)
        ctx.stroke()
      }
    } else if (k === 2) {
      for (const [ox, oy] of [[-0.3, -0.2], [0.25, 0.15], [0, 0.45], [-0.25, 0.3], [0.3, -0.35]]) {
        ctx.beginPath()
        ctx.arc(x + ox! * r, y + oy! * r, r * 0.13, 0, TAU)
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
      ctx.arc(x, y, r * 0.45, 0, TAU)
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
    } else {
      ctx.beginPath()
      ctx.arc(x, y, r * 1.05, -0.4, 0.4)
      ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill()
    }
  }

  private label(b: Body, x: number, y: number, zoom: number, local: boolean): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const above = b.radius * zoom + 24 * dpr
    const ty = y - above
    ctx.save()
    ctx.font = `700 ${12 * dpr}px Barlow, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const name = b.name
    const tw = ctx.measureText(name).width
    const pw = tw + 14 * dpr
    const ph = 17 * dpr
    ctx.globalAlpha = b.falling ? 0.5 : 1
    roundRect(ctx, x - pw / 2, ty - ph / 2, pw, ph, ph / 2)
    ctx.fillStyle = local ? b.color : 'rgba(6,10,16,0.72)'
    ctx.fill()
    if (!local) {
      ctx.strokeStyle = hexA(b.color, 0.7)
      ctx.lineWidth = 1.2 * dpr
      ctx.stroke()
    }
    ctx.fillStyle = local ? '#0b0f14' : '#f4f7fb'
    ctx.fillText(name, x, ty + 0.5 * dpr)
    const stocks = Math.max(0, Math.min(5, b.stocks))
    for (let i = 0; i < stocks; i++) {
      ctx.beginPath()
      ctx.arc(x + (i - (stocks - 1) / 2) * 8 * dpr, ty + ph / 2 + 6 * dpr, 2.6 * dpr, 0, TAU)
      ctx.fillStyle = b.color
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 1 * dpr
      ctx.stroke()
    }
    if (local) {
      const bob = Math.sin(this.clock * 5) * 2.5 * dpr
      const ay = ty - ph / 2 - 7 * dpr + bob
      ctx.beginPath()
      ctx.moveTo(x - 6 * dpr, ay - 6 * dpr)
      ctx.lineTo(x + 6 * dpr, ay - 6 * dpr)
      ctx.lineTo(x, ay)
      ctx.closePath()
      ctx.fillStyle = '#ffc14d'
      ctx.fill()
    }
    if (b.emoteTime > 0 && b.emoteText) {
      ctx.font = `700 ${13 * dpr}px Barlow, sans-serif`
      const ew = ctx.measureText(b.emoteText).width + 16 * dpr
      const ey = ty - ph - 16 * dpr
      const pop = Math.min(1, b.emoteTime * 6)
      ctx.globalAlpha = pop
      roundRect(ctx, x - ew / 2, ey - 11 * dpr, ew, 22 * dpr, 6 * dpr)
      ctx.fillStyle = '#ffc14d'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(x - 5 * dpr, ey + 11 * dpr)
      ctx.lineTo(x + 5 * dpr, ey + 11 * dpr)
      ctx.lineTo(x, ey + 17 * dpr)
      ctx.fill()
      ctx.fillStyle = '#1a1205'
      ctx.fillText(b.emoteText, x, ey + 0.5 * dpr)
    }
    ctx.restore()
  }

  // ---------------------------------------------------------------- screen

  private screenFx(match: Match, w: number, h: number, dt: number, prefs: RenderPrefs, focus: Body | undefined, localId: string): void {
    const ctx = this.ctx
    const you = match.players.find((p) => p.id === localId)
    // Speed lines when the local ball is near its cap.
    const want = you && you.alive && !prefs.reducedMotion ? clamp((you.momentum - 0.72) / 0.28, 0, 1) : 0
    this.speedLines = lerp(this.speedLines, want, 1 - Math.exp(-6 * dt))
    if (this.speedLines > 0.02 && you) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const a = Math.atan2(you.vy, you.vx)
      const cx = w / 2
      const cy = h / 2
      const R = Math.hypot(w, h) / 2
      for (let i = 0; i < 26; i++) {
        const seed = Math.floor(this.clock * 20) + i * 7
        const ang = a + Math.PI + (hashN(seed) - 0.5) * 2.6
        const r0 = R * (0.55 + hashN(seed + 3) * 0.3)
        const len = R * (0.12 + hashN(seed + 5) * 0.2)
        ctx.strokeStyle = `rgba(255,255,255,${0.12 * this.speedLines})`
        ctx.lineWidth = (1 + hashN(seed + 9) * 2) * this.dpr
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0)
        ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len))
        ctx.stroke()
      }
      ctx.restore()
    }

    if (this.finish && !prefs.reducedMotion) {
      const u = clamp(this.finish.life / this.finish.max, 0, 1)
      const env = Math.sin(u * Math.PI)
      ctx.save()
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.7)
      g.addColorStop(0, 'rgba(255,40,30,0)')
      g.addColorStop(1, `rgba(255,40,30,${0.4 * env})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 40; i++) {
        const ang = (i / 40) * TAU + hashN(i) * 0.2
        const r0 = Math.min(w, h) * (0.25 + hashN(i + 11) * 0.2)
        ctx.strokeStyle = `rgba(255,255,255,${0.14 * env})`
        ctx.lineWidth = (1 + hashN(i + 4) * 3) * this.dpr
        ctx.beginPath()
        ctx.moveTo(w / 2 + Math.cos(ang) * r0, h / 2 + Math.sin(ang) * r0)
        ctx.lineTo(w / 2 + Math.cos(ang) * r0 * 3, h / 2 + Math.sin(ang) * r0 * 3)
        ctx.stroke()
      }
      ctx.restore()
    }

    if (match.status === 'sudden') {
      const pulse = 0.18 + Math.sin(this.clock * 6) * 0.08
      this.vignette(w, h, pulse, '255,60,30')
    } else if (focus && focus.alive && focus.id === localId && focus.edgeDist < 90 && focus.edgeDist > -30) {
      const outward = focus.vx * -focus.safetyX + focus.vy * -focus.safetyY
      if (outward > 20 || focus.falling) this.vignette(w, h, focus.falling ? 0.5 : 0.25, '255,30,20')
    }

    if (this.flashA > 0.005) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = hexA(this.flashColor, this.flashA)
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
      this.flashA *= Math.exp(-10 * dt)
    }
    if (this.impactFrames > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'difference'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
      this.impactFrames -= 1
    }
  }

  private offscreen(match: Match, project: Project, w: number, h: number, localId: string): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const pad = 26 * dpr
    for (const b of match.players) {
      if (!b.alive) continue
      const p = project(b.x, b.y)
      if (p.x > 0 && p.x < w && p.y > 0 && p.y < h) continue
      const cx = clamp(p.x, pad, w - pad)
      const cy = clamp(p.y, pad, h - pad)
      const a = Math.atan2(p.y - cy, p.x - cx)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.beginPath()
      ctx.arc(0, 0, 13 * dpr, 0, TAU)
      ctx.fillStyle = 'rgba(6,10,16,0.8)'
      ctx.fill()
      ctx.strokeStyle = b.id === localId ? '#ffc14d' : b.color
      ctx.lineWidth = 2 * dpr
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, 7 * dpr, 0, TAU)
      ctx.fillStyle = b.color
      ctx.fill()
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(18 * dpr, 0)
      ctx.lineTo(12 * dpr, -5 * dpr)
      ctx.lineTo(12 * dpr, 5 * dpr)
      ctx.closePath()
      ctx.fillStyle = b.id === localId ? '#ffc14d' : b.color
      ctx.fill()
      ctx.restore()
    }
  }

  private countdown(match: Match, w: number, h: number): void {
    if (match.silent) return
    const ctx = this.ctx
    const dpr = this.dpr
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (match.countdownTicks > 0) {
      const n = Math.ceil(match.countdownTicks / 60)
      const u = 1 - ((match.countdownTicks - 1) % 60) / 60
      const pop = easeOutBack(clamp(u / 0.3, 0, 1))
      const scale = lerp(1.9, 1, pop) * (u > 0.8 ? lerp(1, 0.85, (u - 0.8) / 0.2) : 1)
      const alpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, (70 + u * 50) * dpr, 0, TAU)
      ctx.strokeStyle = `rgba(255,255,255,${0.3 * (1 - u)})`
      ctx.lineWidth = 4 * dpr
      ctx.stroke()
      ctx.translate(w / 2, h / 2)
      ctx.scale(scale, scale)
      ctx.font = `800 ${120 * dpr}px "Barlow Condensed", Impact, sans-serif`
      ctx.lineWidth = 10 * dpr
      ctx.strokeStyle = 'rgba(6,10,16,0.85)'
      ctx.strokeText(String(n), 0, 0)
      ctx.fillStyle = n === 1 ? '#ffc14d' : '#f4f7fb'
      ctx.fillText(String(n), 0, 0)
    } else if (match.goFlash > 0) {
      const u = 1 - match.goFlash / 0.75
      const pop = easeOutBack(clamp(u / 0.25, 0, 1))
      const scale = lerp(2.4, 1, pop) + u * 0.25
      ctx.globalAlpha = clamp(match.goFlash * 2.2, 0, 1)
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, (60 + u * 420) * dpr, 0, TAU)
      ctx.strokeStyle = `rgba(255,77,58,${0.6 * (1 - u)})`
      ctx.lineWidth = (14 * (1 - u) + 2) * dpr
      ctx.stroke()
      ctx.translate(w / 2, h / 2)
      ctx.rotate(-0.06)
      ctx.scale(scale, scale)
      ctx.font = `800 ${120 * dpr}px "Barlow Condensed", Impact, sans-serif`
      ctx.lineWidth = 10 * dpr
      ctx.strokeStyle = 'rgba(6,10,16,0.85)'
      ctx.strokeText('GO!', 0, 0)
      ctx.fillStyle = '#ff4d3a'
      ctx.fillText('GO!', 0, 0)
    }
    ctx.restore()
  }

  private vignette(w: number, h: number, amount: number, rgb: string): void {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7)
    g.addColorStop(0, `rgba(${rgb},0)`)
    g.addColorStop(1, `rgba(${rgb},${amount})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // ---------------------------------------------------------------- particles

  private add(
    kind: ParticleKind, x: number, y: number, vx: number, vy: number, size: number, color: string,
    life: number, drag: number, rot = 0, text = '', spin = 0,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
    this.particles.push({ kind, x, y, vx, vy, size, color, life, max: life, drag, rot, text, spin, seed: Math.random() })
  }

  private ring(x: number, y: number, color: string, size: number, life: number, width: number): void {
    this.add('ring', x, y, 0, 0, size, color, life, 0, 0, '', width)
  }

  private popNumber(x: number, y: number, text: string, power: number): void {
    // Smash damage colours: white, yellow, red, maroon.
    const color = power < 420 ? '#f4f7fb' : power < 620 ? '#ffc14d' : power < 820 ? '#ff4d3a' : '#c2182b'
    this.add('text', x, y, (Math.random() - 0.5) * 30, -70, 14 + Math.min(14, power / 60), color, 0.85, 3, (Math.random() - 0.5) * 0.2, text)
  }

  private bolts(x: number, y: number, ang: number, k: number): void {
    for (let i = 0; i < 4; i++) {
      const a = ang + (i - 1.5) * 0.5 + (Math.random() - 0.5) * 0.3
      this.add('bolt', x, y, 0, 0, 40 + k * 50, i % 2 ? '#ff2d2d' : '#16060a', 0.16, 0, a)
    }
  }

  private impactStyle(style: string, x: number, y: number, color: string, k: number, full: boolean): void {
    if (style === 'impact_burst' && k > 0.4) {
      this.add('flash', x, y, 0, 0, 30 + k * 60, color, 0.14, 0)
    } else if (style === 'impact_shatter' && full) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU
        const s = 140 + Math.random() * 260
        this.add('shard', x, y, Math.cos(a) * s, Math.sin(a) * s, 4 + Math.random() * 4, color, 0.5, 3, a, '', (Math.random() - 0.5) * 20)
      }
    } else if (style === 'impact_glyph') {
      this.add('ring', x, y, 0, 0, 30 + k * 30, '#ffc14d', 0.45, 0, 0, 'glyph', 3)
    }
  }

  private drawParticles(project: Project, zoom: number, dt: number, prefs: RenderPrefs): void {
    const ctx = this.ctx
    const dpr = this.dpr
    ctx.save()
    for (const p of this.particles) {
      p.life -= dt
      if (p.life <= 0) continue
      const damp = Math.exp(-p.drag * dt)
      p.vx *= damp
      p.vy *= damp
      if (p.kind === 'confetti') p.vy += 260 * dt
      if (p.kind === 'ember') p.vy -= 30 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
      const s = project(p.x, p.y)
      const t = clamp(p.life / p.max, 0, 1)
      const u = 1 - t
      ctx.globalAlpha = t
      ctx.globalCompositeOperation = 'source-over'
      if (p.kind === 'ring') {
        const rr = p.size * zoom * easeOutCubic(u) + 2
        ctx.beginPath()
        ctx.arc(s.x, s.y, rr, 0, TAU)
        ctx.strokeStyle = p.color
        ctx.lineWidth = Math.max(0.5, p.spin * t) * dpr
        ctx.stroke()
        if (p.text === 'glyph') {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU + u
            ctx.beginPath()
            ctx.moveTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr)
            ctx.lineTo(s.x + Math.cos(a) * (rr + 6 * dpr), s.y + Math.sin(a) * (rr + 6 * dpr))
            ctx.stroke()
          }
        }
      } else if (p.kind === 'spark' || p.kind === 'ember') {
        ctx.globalCompositeOperation = 'lighter'
        const sp = Math.hypot(p.vx, p.vy)
        const len = Math.min(26, sp * 0.03 + 2) * dpr * (zoom / 0.6)
        const nx = sp > 0 ? p.vx / sp : 1
        const ny = sp > 0 ? p.vy / sp : 0
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size * dpr * t + 0.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(s.x - nx * len, s.y - ny * len)
        ctx.stroke()
      } else if (p.kind === 'dust') {
        ctx.globalAlpha = t * 0.45
        ctx.beginPath()
        ctx.arc(s.x, s.y, p.size * dpr * (0.6 + u * 1.2), 0, TAU)
        ctx.fillStyle = p.color
        ctx.fill()
      } else if (p.kind === 'flash') {
        ctx.globalCompositeOperation = 'lighter'
        const rr = p.size * dpr * (0.6 + u * 0.6)
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
        g.addColorStop(0, hexA(p.color, 0.95))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2)
      } else if (p.kind === 'confetti' || p.kind === 'shard') {
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot + p.seed * 6 + this.clock * (p.kind === 'confetti' ? 6 : 0))
        ctx.fillStyle = p.color
        const sz = p.size * dpr
        if (p.kind === 'confetti') ctx.fillRect(-sz, -sz * 0.5 * Math.abs(Math.sin(this.clock * 8 + p.seed * 9)), sz * 2, sz)
        else {
          ctx.beginPath()
          ctx.moveTo(-sz, -sz * 0.4)
          ctx.lineTo(sz, 0)
          ctx.lineTo(-sz, sz * 0.4)
          ctx.fill()
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'star') {
        ctx.globalCompositeOperation = 'lighter'
        ctx.translate(s.x, s.y)
        ctx.rotate(this.clock * 4)
        ctx.fillStyle = p.color
        const sz = p.size * dpr * t
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU
          const rr = i % 2 ? sz * 0.35 : sz
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        ctx.fill()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'bolt') {
        ctx.strokeStyle = p.color
        ctx.lineWidth = (p.color === '#16060a' ? 5 : 3) * dpr
        ctx.lineJoin = 'miter'
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        const len = p.size * zoom
        const segs = 4
        for (let i = 1; i <= segs; i++) {
          const d = (i / segs) * len
          const j = (hashN(Math.floor(p.seed * 1000) + i) - 0.5) * len * 0.35
          ctx.lineTo(s.x + Math.cos(p.rot) * d - Math.sin(p.rot) * j, s.y + Math.sin(p.rot) * d + Math.cos(p.rot) * j)
        }
        ctx.stroke()
      } else if (p.kind === 'beam') {
        if (prefs.reducedMotion) continue
        // Smash blast-line column, pointing where the ball flew.
        ctx.globalCompositeOperation = 'lighter'
        const len = 900 * zoom * easeOutCubic(clamp(u * 4, 0, 1))
        const wid = 90 * zoom * t
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot)
        const g = ctx.createLinearGradient(0, 0, len, 0)
        g.addColorStop(0, hexA('#ffffff', 0.9 * t))
        g.addColorStop(0.2, hexA(p.color, 0.7 * t))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(-10 * dpr, 0)
        ctx.lineTo(len, -wid)
        ctx.lineTo(len, wid)
        ctx.closePath()
        ctx.fill()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'pillar') {
        ctx.globalCompositeOperation = 'lighter'
        const wid = p.size * zoom * (0.4 + t * 0.6)
        const hgt = 520 * zoom
        const g = ctx.createLinearGradient(0, s.y - hgt, 0, s.y)
        g.addColorStop(0, hexA(p.color, 0))
        g.addColorStop(1, hexA(p.color, 0.55 * t))
        ctx.fillStyle = g
        ctx.fillRect(s.x - wid / 2, s.y - hgt, wid, hgt)
      } else if (p.kind === 'text' || p.kind === 'stamp') {
        const pop = p.kind === 'stamp' ? easeOutBack(clamp(u / 0.18, 0, 1)) : easeOutBack(clamp(u / 0.15, 0, 1))
        const sc = p.kind === 'stamp' ? lerp(2.2, 1, pop) : lerp(0.3, 1, pop)
        ctx.globalAlpha = clamp(t * 2.5, 0, 1)
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot)
        ctx.scale(sc, sc)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `800 ${p.size * dpr}px "Barlow Condensed", Impact, sans-serif`
        ctx.lineWidth = Math.max(3, p.size * 0.22) * dpr
        ctx.strokeStyle = 'rgba(6,10,16,0.9)'
        ctx.lineJoin = 'round'
        ctx.strokeText(p.text, 0, 0)
        ctx.fillStyle = p.color
        ctx.fillText(p.text, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
    }
    ctx.restore()
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  // ---------------------------------------------------------------- misc

  private gridPattern(): CanvasPattern | null {
    if (this.floorPattern) return this.floorPattern
    const tile = document.createElement('canvas')
    const s = 60
    tile.width = s
    tile.height = Math.round(s * Math.sqrt(3))
    const g = tile.getContext('2d')
    if (!g) return null
    g.strokeStyle = 'rgba(255,255,255,0.09)'
    g.lineWidth = 1
    const hex = (cx: number, cy: number, r: number) => {
      g.beginPath()
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      }
      g.stroke()
    }
    const r = s / 3
    const hh = tile.height
    for (const [cx, cy] of [[0, 0], [s, 0], [s / 2, hh / 2], [0, hh], [s, hh]] as const) hex(cx, cy, r)
    this.floorPattern = this.ctx.createPattern(tile, 'repeat')
    return this.floorPattern
  }

  private css: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y })

  toCss(x: number, y: number): { x: number; y: number } {
    return this.css(x, y)
  }

  private seedStars(): void {
    for (let i = 0; i < 140; i++) {
      this.stars.push({
        x: hashN(i * 3 + 1),
        y: hashN(i * 3 + 2),
        r: 0.6 + hashN(i * 3 + 3) * 1.6,
        a: 0.15 + hashN(i * 7) * 0.5,
        depth: 0.1 + hashN(i * 11) * 0.5,
        tw: 0.5 + hashN(i * 13) * 2.5,
      })
    }
  }
}

function hashN(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
