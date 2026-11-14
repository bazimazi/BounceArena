import { TAU, clamp, lerp } from '../core/math'
import { SPEED_CAP, type FxEvent } from '../core/types'
import { abilityById } from '../data/tuning'
import { TEAM_COLORS } from '../data/content'
import { solidPose, wallSegments, type Pose } from '../sim/geometry'
import { explosiveWarn, hazardPose, laserAngle, laserMode } from '../sim/hazards'
import type { Body } from '../sim/body'
import type { Match } from '../sim/match'
import { blinkAt, paintBall, type BallLook, type Expression } from './ball'
import { DISPLAY_FONT, UI_FONT, easeInCubic, easeOutBack, easeOutCubic, hashN, hexA, mixHex, roundRect, shade } from './util'

/** Camera pitch: world y is squashed by this on screen, so the floor reads as a tilted plane. */
export const TILT = 0.8
/** Platform thickness in world units. */
const DEPTH = 58
const WALL_H = 26
const MAX_PARTICLES = 1100

export interface RenderPrefs {
  shake: number
  fx: 'full' | 'reduced'
  colorblind: boolean
  reducedMotion: boolean
  numbers?: boolean
  /** Full-screen flashes and inverted impact frames. Off for photosensitive players. */
  flashes?: boolean
}

/** Heat colour ramp: white, yellow, orange, red, then deep red past 200%. */
export function heatColor(heat: number): string {
  const stops: [number, string][] = [[0, '#f4f7fb'], [45, '#ffe066'], [90, '#ff9f3a'], [140, '#ff4d3a'], [200, '#c2142e']]
  for (let i = 1; i < stops.length; i++) {
    const [h1, c1] = stops[i]!
    const [h0, c0] = stops[i - 1]!
    if (heat <= h1) return mixHex(c0, c1, (heat - h0) / (h1 - h0))
  }
  return stops[stops.length - 1]![1]
}

type Kind =
  | 'spark' | 'chunk' | 'puff' | 'ring' | 'implode' | 'sring' | 'flash' | 'text' | 'stamp' | 'confetti'
  | 'beam' | 'pillar' | 'ember' | 'smoke' | 'star' | 'shard' | 'bolt' | 'scorch' | 'faller' | 'streak' | 'zzz' | 'burst' | 'edgeflare'

interface Particle {
  kind: Kind
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Gravity on z, world units/s². */
  g: number
  life: number
  max: number
  size: number
  color: string
  text: string
  rot: number
  spin: number
  drag: number
  seed: number
  owner?: string
  look?: BallLook
  behind?: boolean
  x2?: number
  y2?: number
}

/** Presentation-only state per ball. Never feeds back into the sim. */
interface BallFx {
  squash: number
  squashV: number
  squashAng: number
  land: number
  lookX: number
  lookY: number
  hurt: number
  focus: number
  idle: number
  ghosts: { x: number; y: number; z: number; life: number }[]
  ghostTimer: number
  emberTimer: number
  smokeTimer: number
  zzzTimer: number
  /** Drop-in from the sky: 1 at the top, 0 landed. */
  drop: number
  dropDelay: number
  lastX: number
  lastY: number
  seed: number
  perfect: number
  /** Launch streak strength, set by a stun launch and fading out. */
  launch: number
  launchAng: number
}

interface Mote {
  x: number
  y: number
  z: number
  r: number
  s: number
}

interface Rock {
  x: number
  y: number
  r: number
  depth: number
  spin: number
  seed: number
}

type Project = (x: number, y: number, z?: number) => { x: number; y: number }

interface DrawItem {
  y: number
  draw: () => void
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private particles: Particle[] = []
  private balls = new Map<string, BallFx>()
  private hexPattern: CanvasPattern | null = null
  private lipPattern: CanvasPattern | null = null
  private lipKey = ''
  private bgCache: { key: string; canvas: HTMLCanvasElement } | null = null
  private motes: Mote[] = []
  private rocks: Rock[] = []
  private dpr = 1
  /** Highest pixel density allowed. Lowered on its own when frames run long. */
  private dprCap = 2
  private frameEma = 16
  private slowFrames = 0
  private camX = 0
  private camY = 0
  private camZoom = 0
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
  private jitterId = ''
  private Z = 1
  private OX = 0
  private OY = 0
  private labelScale = 1
  private css: (x: number, y: number, z?: number) => { x: number; y: number } = (x, y) => ({ x, y })
  width = 1
  height = 1
  /** CSS pixels the match HUD covers at the top; the camera frames the arena below it. */
  insetTop = 0

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    this.ctx = ctx
    for (let i = 0; i < 70; i++) {
      this.motes.push({ x: hashN(i * 3.1), y: hashN(i * 5.7), z: 0.2 + hashN(i * 9.3) * 0.8, r: 0.6 + hashN(i * 2.2) * 1.8, s: 0.2 + hashN(i * 4.4) })
    }
    for (let i = 0; i < 9; i++) {
      this.rocks.push({ x: (hashN(i * 13.1) - 0.5) * 2.4, y: 0.15 + hashN(i * 7.7) * 0.9, r: 18 + hashN(i * 3.3) * 60, depth: 0.15 + hashN(i * 5.1) * 0.35, spin: (hashN(i) - 0.5) * 0.2, seed: i })
    }
  }

  resize(): void {
    // Very large canvases cost fill rate for little visible gain; keep under ~4.2 MP.
    const css = Math.max(1, window.innerWidth * window.innerHeight)
    const budget = Math.sqrt(4_200_000 / css)
    this.dpr = Math.max(1, Math.min(this.dprCap, window.devicePixelRatio || 1, budget))
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = Math.floor(this.width * this.dpr)
    this.canvas.height = Math.floor(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.hexPattern = null
    this.lipPattern = null
    this.bgCache = null
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
      return this.slow > 0.45 ? 0.18 : lerp(1, 0.18, this.slow / 0.45)
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
    this.matchRef = null
  }

  /** Smash-style finish: slow the clock and push the camera onto the last knockout. */
  finale(x: number, y: number, color: string, prefs: RenderPrefs): void {
    if (this.finish) return
    this.finish = { x, y, life: 1.7, max: 1.7, color }
    if (!prefs.reducedMotion) this.slow = 1.35
    if (prefs.flashes !== false) this.flashA = Math.max(this.flashA, 0.4)
    this.flashColor = color
    this.trauma = Math.min(1, this.trauma + 0.45 * prefs.shake)
  }

  /** Confetti over the whole view, for a win on the results screen. */
  confetti(colors: string[]): void {
    const view = this.matchRef?.arena.view ?? 560
    for (let i = 0; i < 140; i++) {
      const x = this.camX + (Math.random() - 0.5) * view * 2.2
      const y = this.camY + (Math.random() - 0.5) * view * 1.4
      this.add({
        kind: 'confetti', x, y, z: 500 + Math.random() * 500, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 40, vz: -60 - Math.random() * 120,
        g: 160, size: 3 + Math.random() * 3, color: colors[i % colors.length] ?? '#ffc14d', life: 3.2 + Math.random() * 1.5, drag: 0.6, spin: (Math.random() - 0.5) * 12,
      })
    }
  }

  // ================================================================ events

  absorb(events: FxEvent[], prefs: RenderPrefs, localId: string, match: Match): void {
    const full = prefs.fx === 'full'
    const motion = prefs.reducedMotion ? 0.15 : 1
    const shake = prefs.shake * motion
    for (const e of events) {
      const local = !!localId && (e.actorId === localId || e.victimId === localId)
      if (e.type === 'hit') this.onHit(e, match, local, full, prefs, motion, shake)
      else if (e.type === 'dash') this.onDash(e, match, local, full, shake)
      else if (e.type === 'elim') this.onElim(e, match, localId, local, full, prefs, motion, shake)
      else if (e.type === 'boom') this.onBoom(e, full, shake)
      else if (e.type === 'land') {
        const b = match.bodies.find((x) => x.id === e.actorId)
        if (b) this.fxFor(b).land = 1
        if (full && b && Math.hypot(b.vx, b.vy) > 140) {
          const a = Math.atan2(b.vy, b.vx) + Math.PI
          for (let i = 0; i < 2; i++) {
            const aa = a + (Math.random() - 0.5) * 1.4
            this.add({ kind: 'puff', x: e.x, y: e.y, z: 2, vx: Math.cos(aa) * 50, vy: Math.sin(aa) * 50, size: 5 + Math.random() * 4, color: '#dfe9f5', life: 0.35, drag: 4 })
          }
        }
      } else if (e.type === 'wall') {
        for (let i = 0; i < (full ? 12 : 4); i++) {
          const a = Math.random() * TAU
          const s = 140 + Math.random() * 260
          this.add({ kind: 'spark', x: e.x, y: e.y, z: 16, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 80 + Math.random() * 200, g: 900, size: 1.8, color: i % 2 ? '#ffffff' : e.color, life: 0.3, drag: 5 })
        }
        this.ring(e.x, e.y, e.color, 26, 0.26, 3)
        this.add({ kind: 'flash', x: e.x, y: e.y, z: 16, size: 26, color: e.color, life: 0.1 })
      } else if (e.type === 'ability') this.onAbility(e, match, local, full)
      else if (e.type === 'launch') this.onLaunch(e, match, localId, full, prefs, motion, shake)
      else if (e.type === 'teeter') {
        const b = match.bodies.find((x) => x.id === e.actorId)
        for (let i = 0; i < (full ? 4 : 2); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
          this.add({ kind: 'spark', x: e.x, y: e.y, z: (b?.radius ?? 20) * 2, vx: Math.cos(a) * 60, vy: 0, vz: 160 + Math.random() * 120, g: 700, size: 2.4, color: '#9fe6ff', life: 0.5, drag: 1 })
        }
        if (b) {
          const fx = this.fxFor(b)
          fx.squashAng = 0
          fx.squashV += 6
        }
      }
      else if (e.type === 'pickup') {
        this.ring(e.x, e.y, e.color, 60, 0.5, 5)
        this.add({ kind: 'sring', x: e.x, y: e.y, z: 24, size: 50, color: '#ffffff', life: 0.35, spin: 3 })
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU
          this.add({ kind: 'star', x: e.x, y: e.y, z: 24, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, vz: 120, g: 300, size: 7, color: e.color, life: 0.65, drag: 3 })
        }
        if (e.text) this.add({ kind: 'text', x: e.x, y: e.y, z: 70, vz: 60, size: 20, color: e.color, life: 1, drag: 2, text: e.text })
      } else if (e.type === 'save' && e.text === 'edge') {
        // Clawed back from the brink: dust kicks off the lip and a quick mint ring.
        this.ring(e.x, e.y, '#3ee6a0', 44, 0.4, 4)
        for (let i = 0; i < (full ? 7 : 3); i++) {
          const a = Math.random() * TAU
          this.add({ kind: 'puff', x: e.x, y: e.y, z: 3, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, size: 6 + Math.random() * 4, color: '#dfe9f5', life: 0.4, drag: 4 })
        }
        if (local) this.add({ kind: 'text', x: e.x, y: e.y, z: 64, vz: 70, size: 19, color: '#3ee6a0', life: 0.9, drag: 2, text: 'SAVED!' })
      } else if (e.type === 'save') {
        this.ring(e.x, e.y, '#3ee6a0', 60, 0.5, 5)
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * TAU
          this.add({ kind: 'star', x: e.x, y: e.y, z: 20, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, vz: 220, g: 600, size: 5, color: '#3ee6a0', life: 0.6, drag: 2 })
        }
        if (local) this.add({ kind: 'text', x: e.x, y: e.y, z: 70, vz: 70, size: 24, color: '#3ee6a0', life: 1.1, drag: 2, text: 'SAVED!' })
      } else if (e.type === 'spawn') {
        const b = match.bodies.find((x) => x.id === e.actorId)
        if (b) {
          const fx = this.fxFor(b)
          fx.drop = 1
          fx.dropDelay = 0
          fx.ghosts = []
        }
        this.add({ kind: 'pillar', x: e.x, y: e.y, z: 0, size: 40, color: e.color, life: 0.7 })
      }
    }
  }

  private onHit(e: FxEvent, match: Match, local: boolean, full: boolean, prefs: RenderPrefs, motion: number, shake: number): void {
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
    const ang = Math.atan2(ny, nx)
    const z = 20
    const n = full ? Math.round(12 + k * 22) : 5
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * (i % 3 === 0 ? TAU : 1.3)
      const a = ang + spread
      const s = (220 + k * 620) * (0.35 + Math.random() * 0.8)
      this.add({
        kind: 'spark', x: e.x, y: e.y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 60 + Math.random() * 320, g: 1100,
        size: 1.6 + Math.random() * 1.8 + k, color: i % 4 === 0 ? '#ffffff' : e.color, life: 0.25 + Math.random() * 0.25 + k * 0.15, drag: 3.5,
      })
    }
    this.ring(e.x, e.y, e.color, 22 + k * 60, 0.36 + k * 0.12, 4 + k * 5)
    if (k > 0.3) this.ring(e.x, e.y, '#ffffff', 14 + k * 34, 0.22, 2.5)
    this.add({ kind: 'flash', x: e.x, y: e.y, z, size: 18 + k * 48, color: '#ffffff', life: 0.09 + k * 0.06 })
    this.add({ kind: 'sring', x: e.x, y: e.y, z, size: 18 + k * 40, color: mixHex(e.color, '#ffffff', 0.5), life: 0.2 + k * 0.1, spin: 2 + k * 3 })
    if (full && k > 0.45) {
      for (let i = 0; i < Math.round(k * 6); i++) {
        const a = ang + (Math.random() - 0.5) * 1.2
        const s = 180 + Math.random() * 300
        this.add({ kind: 'chunk', x: e.x, y: e.y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 200 + Math.random() * 260, g: 1200, size: 3 + Math.random() * 3, color: e.color, life: 0.8, drag: 1.5, spin: (Math.random() - 0.5) * 20 })
      }
    }
    this.impactStyle(actor?.impact ?? 'impact_ring', e.x, e.y, e.color, k, full)
    if (e.power > 560 && full) this.bolts(e.x, e.y, ang, k)
    if (e.text && prefs.numbers !== false) this.popNumber(e.x, e.y, e.text, e.power, e.victimId)
    if (victim) {
      this.jitterId = victim.id
      const fx = this.fxFor(victim)
      fx.squashAng = ang
      fx.squashV -= 8 + k * 10
      fx.hurt = 0.35 + k * 0.3
    }
    if (actor) {
      const fx = this.fxFor(actor)
      fx.squashAng = ang
      fx.squashV -= 3 + k * 4
      fx.focus = 0.6
    }
    this.trauma = Math.min(1, this.trauma + (local ? 0.18 + k * 0.38 : 0.04 + k * 0.1) * shake)
    if (local) {
      this.kickVX += nx * (70 + k * 300) * motion
      this.kickVY += ny * (70 + k * 300) * motion * TILT
      this.punch = Math.max(this.punch, k * 0.07 * motion)
    }
    if (local || e.power > 640) this.hitstop = Math.max(this.hitstop, clamp(0.018 + k * 0.09, 0.02, 0.12))
    if (local && e.power > 780 && full && !prefs.reducedMotion && prefs.flashes !== false) this.impactFrames = 2
  }

  private onDash(e: FxEvent, match: Match, local: boolean, full: boolean, shake: number): void {
    const b = match.bodies.find((x) => x.id === e.actorId)
    const a = b ? Math.atan2(b.vy, b.vx) + Math.PI : Math.random() * TAU
    for (let i = 0; i < (full ? 9 : 3); i++) {
      const aa = a + (Math.random() - 0.5) * 1.4
      const s = 70 + Math.random() * 150
      this.add({ kind: 'puff', x: e.x, y: e.y, z: 3, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, size: 6 + Math.random() * 7, color: '#e6eef8', life: 0.4 + Math.random() * 0.25, drag: 4 })
    }
    this.ring(e.x, e.y, e.color, 30, 0.26, 3)
    if (b) {
      const fx = this.fxFor(b)
      fx.ghostTimer = 0.3
      fx.squashAng = Math.atan2(b.vy, b.vx)
      fx.squashV += 7
      fx.focus = 0.5
      if (e.text === 'perfect') {
        fx.perfect = 0.5
        this.ring(e.x, e.y, '#ffc14d', 54, 0.4, 5)
        this.add({ kind: 'sring', x: e.x, y: e.y, z: 22, size: 40, color: '#ffe39c', life: 0.3, spin: 3 })
        for (let i = 0; i < 8; i++) {
          const q = (i / 8) * TAU
          this.add({ kind: 'star', x: e.x, y: e.y, z: 22, vx: Math.cos(q) * 170, vy: Math.sin(q) * 170, vz: 80, g: 200, size: 5, color: '#ffc14d', life: 0.45, drag: 3 })
        }
        if (local) this.add({ kind: 'text', x: e.x, y: e.y, z: 64, vz: 80, size: 19, color: '#ffc14d', life: 0.85, drag: 2.5, text: 'PERFECT' })
      } else if (e.text === 'recover') {
        // A dash that pulls the ball back from a fall: a hop ring and a burst of mint stars.
        fx.squashAng = Math.PI / 2
        fx.squashV -= 7
        this.ring(e.x, e.y, '#3ee6a0', 58, 0.45, 5)
        this.add({ kind: 'sring', x: e.x, y: e.y, z: 18, size: 36, color: '#b8ffe0', life: 0.3, spin: 3 })
        for (let i = 0; i < 8; i++) {
          const q = (i / 8) * TAU
          this.add({ kind: 'star', x: e.x, y: e.y, z: 18, vx: Math.cos(q) * 150, vy: Math.sin(q) * 150, vz: 140, g: 300, size: 5, color: '#3ee6a0', life: 0.5, drag: 3 })
        }
        if (local) this.add({ kind: 'text', x: e.x, y: e.y, z: 64, vz: 80, size: 20, color: '#3ee6a0', life: 0.9, drag: 2.5, text: 'RECOVER!' })
      }
    }
    if (local) this.trauma = Math.min(1, this.trauma + 0.06 * shake)
  }

  /** A hit strong enough to take control away: anime speed burst, a launch streak, a camera kick. */
  private onLaunch(e: FxEvent, match: Match, localId: string, full: boolean, prefs: RenderPrefs, motion: number, shake: number): void {
    const victim = match.bodies.find((b) => b.id === e.victimId)
    if (!victim) return
    const k = clamp(e.power / 0.45, 0, 1)
    const ang = Math.atan2(victim.vy, victim.vx)
    const fx = this.fxFor(victim)
    fx.launch = 0.35 + k * 0.5
    fx.launchAng = ang
    if (full) this.add({ kind: 'burst', x: e.x, y: e.y, z: victim.radius, size: 70 + k * 90, color: e.color, life: 0.22 + k * 0.12, rot: ang })
    this.ring(e.x, e.y, '#ffffff', 40 + k * 50, 0.3, 4 + k * 4)
    for (let i = 0; i < (full ? 10 : 4); i++) {
      const a = ang + Math.PI + (Math.random() - 0.5) * 1.2
      const s = 120 + Math.random() * 260
      this.add({ kind: 'smoke', x: e.x, y: e.y, z: victim.radius, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40, size: 8 + Math.random() * 8, color: '#c9d3e6', life: 0.5 + Math.random() * 0.3, drag: 4 })
    }
    const mine = e.victimId === localId || e.actorId === localId
    if (mine) {
      this.trauma = Math.min(1, this.trauma + (0.12 + k * 0.25) * shake)
      this.punch = Math.max(this.punch, (0.03 + k * 0.05) * motion)
    }
    // The heaviest launches get a beat of extra freeze so they land.
    if (k > 0.55 && !prefs.reducedMotion) this.hitstop = Math.max(this.hitstop, 0.06 + k * 0.05)
  }

  private onElim(e: FxEvent, match: Match, localId: string, local: boolean, full: boolean, prefs: RenderPrefs, motion: number, shake: number): void {
    const victim = match.bodies.find((b) => b.id === e.victimId)
    const color = victim?.color ?? e.color
    const fx = victim ? this.balls.get(victim.id) : undefined
    let dx = victim ? victim.vx : 0
    let dy = victim ? victim.vy : 0
    if (Math.hypot(dx, dy) < 30) {
      dx = e.x
      dy = e.y
    }
    const ang = Math.atan2(dy, dx)
    const hazard = e.power === 2
    if (!hazard && victim) {
      // The ball keeps falling into the void after the sim lets go of it.
      const behind = this.behindAny(e.x, e.y, match)
      this.add({
        kind: 'faller', x: e.x, y: e.y, z: victim.fallHeight, vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120, vz: -260, g: 1400,
        size: victim.radius, color, life: 1.1, drag: 0.5, spin: (Math.random() - 0.5) * 8, behind,
        look: { color, skin: victim.skin, pattern: victim.pattern, lookX: 0, lookY: -0.4, expression: 'scared', blink: 0, time: 0 },
      })
    }
    if (!prefs.reducedMotion) this.add({ kind: 'beam', x: e.x, y: e.y, z: 0, size: 1, color, life: 0.9, rot: ang })
    // The blast at the screen edge where the ball left, so a knockout lands even off-camera.
    if (!hazard && full && !prefs.reducedMotion && prefs.flashes !== false) this.add({ kind: 'edgeflare', x: e.x, y: e.y, z: 10, size: local ? 1.15 : 0.65, color, life: local ? 0.75 : 0.55, rot: ang })
    this.ring(e.x, e.y, '#ffffff', 90, 0.5, 6)
    this.ring(e.x, e.y, color, 150, 0.8, 10)
    this.add({ kind: 'sring', x: e.x, y: e.y, z: 10, size: 120, color, life: 0.5, spin: 8 })
    this.add({ kind: 'flash', x: e.x, y: e.y, z: 10, size: 150, color: '#ffffff', life: 0.18 })
    const bits = full ? 46 : 12
    for (let i = 0; i < bits; i++) {
      const a = ang + (Math.random() - 0.5) * 1.8
      const s = 220 + Math.random() * 640
      const c = i % 3 === 0 ? e.color : i % 3 === 1 ? color : '#ffffff'
      if (i % 2 === 0) this.add({ kind: 'confetti', x: e.x, y: e.y, z: 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 200 + Math.random() * 400, g: 700, size: 3 + Math.random() * 3, color: c, life: 1.2 + Math.random() * 0.6, drag: 2.2, spin: (Math.random() - 0.5) * 14 })
      else this.add({ kind: 'spark', x: e.x, y: e.y, z: 10, vx: Math.cos(a) * s * 1.3, vy: Math.sin(a) * s * 1.3, vz: Math.random() * 300, g: 500, size: 2.6, color: c, life: 0.45 + Math.random() * 0.3, drag: 2.5 })
    }
    const mine = e.victimId === localId
    this.add({ kind: 'stamp', x: e.x, y: e.y, z: 70, vz: 30, size: local ? 46 : 32, color: mine ? '#ff4d3a' : '#fff7ea', life: 1.15, rot: (Math.random() - 0.5) * 0.3, text: 'KO!' })
    if (prefs.flashes !== false) {
      this.flashA = Math.max(this.flashA, (local ? 0.34 : 0.1) * motion)
      this.flashColor = color
    }
    this.trauma = Math.min(1, this.trauma + (local ? 0.6 : 0.24) * shake)
    if (local) {
      this.hitstop = Math.max(this.hitstop, 0.13)
      this.punch = Math.max(this.punch, 0.09 * motion)
    }
    if (fx) fx.ghosts = []
  }

  private onBoom(e: FxEvent, full: boolean, shake: number): void {
    this.ring(e.x, e.y, e.color, 110, 0.6, 10)
    this.ring(e.x, e.y, '#ffffff', 60, 0.3, 4)
    this.add({ kind: 'flash', x: e.x, y: e.y, z: 20, size: 110, color: '#fff1c4', life: 0.18 })
    this.add({ kind: 'sring', x: e.x, y: e.y, z: 30, size: 90, color: '#ffc14d', life: 0.4, spin: 6 })
    this.add({ kind: 'scorch', x: e.x, y: e.y, z: 0, size: Math.min(140, e.power * 0.22), color: '#000000', life: 7 })
    for (let i = 0; i < (full ? 30 : 10); i++) {
      const a = Math.random() * TAU
      const s = 140 + Math.random() * 420
      if (i % 3 === 0) this.add({ kind: 'smoke', x: e.x, y: e.y, z: 10, vx: Math.cos(a) * s * 0.3, vy: Math.sin(a) * s * 0.3, vz: 40 + Math.random() * 80, size: 14 + Math.random() * 16, color: '#2a2234', life: 1 + Math.random() * 0.6, drag: 2 })
      else if (i % 3 === 1) this.add({ kind: 'spark', x: e.x, y: e.y, z: 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 100 + Math.random() * 400, g: 900, size: 2.6, color: i % 2 ? e.color : '#ffc14d', life: 0.5 + Math.random() * 0.3, drag: 3 })
      else this.add({ kind: 'chunk', x: e.x, y: e.y, z: 10, vx: Math.cos(a) * s * 0.7, vy: Math.sin(a) * s * 0.7, vz: 260 + Math.random() * 300, g: 1300, size: 3 + Math.random() * 4, color: '#5a4a5e', life: 0.9, drag: 1, spin: (Math.random() - 0.5) * 20 })
    }
    this.trauma = Math.min(1, this.trauma + 0.26 * shake)
  }

  private onAbility(e: FxEvent, match: Match, local: boolean, full: boolean): void {
    const b = match.bodies.find((x) => x.id === e.actorId)
    const id = e.text
    const c = e.color
    const fx = b ? this.fxFor(b) : null
    if (id === 'shockwave') {
      this.ring(e.x, e.y, c, 172, 0.45, 8)
      this.ring(e.x, e.y, '#ffffff', 120, 0.3, 3)
      this.add({ kind: 'sring', x: e.x, y: e.y, z: 20, size: 80, color: c, life: 0.3, spin: 5 })
      for (let i = 0; i < (full ? 20 : 8); i++) {
        const a = (i / 20) * TAU
        this.add({ kind: 'puff', x: e.x, y: e.y, z: 3, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, size: 8, color: '#e6eef8', life: 0.45, drag: 5 })
      }
    } else if (id === 'magnet' || id === 'gravity-well') {
      const R = id === 'magnet' ? 210 : 165
      this.add({ kind: 'implode', x: e.x, y: e.y, z: 0, size: R, color: id === 'magnet' ? c : '#b388ff', life: 0.5, spin: 4 })
      for (let i = 0; i < (full ? 18 : 6); i++) {
        const a = Math.random() * TAU
        const d = R * (0.7 + Math.random() * 0.3)
        this.add({ kind: 'spark', x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, z: 12, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, size: 2, color: id === 'magnet' ? c : '#b388ff', life: 0.42, drag: 1 })
      }
    } else if (id === 'phase') {
      this.add({ kind: 'sring', x: e.x, y: e.y, z: 20, size: 46, color: '#cfe8ff', life: 0.4, spin: 3 })
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU
        this.add({ kind: 'star', x: e.x, y: e.y, z: 20, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, vz: 90, size: 4, color: '#cfe8ff', life: 0.55, drag: 3 })
      }
    } else if (id === 'overdrive') {
      this.ring(e.x, e.y, '#ffc14d', 70, 0.4, 6)
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU
        this.add({ kind: 'ember', x: e.x, y: e.y, z: 14, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, vz: 160, size: 3, color: i % 2 ? '#ffc14d' : '#ff6a2a', life: 0.6, drag: 3 })
      }
    } else if (id === 'anchor') {
      this.ring(e.x, e.y, '#f4f7fb', 80, 0.45, 9)
      for (let i = 0; i < (full ? 14 : 5); i++) {
        const a = Math.random() * TAU
        this.add({ kind: 'puff', x: e.x, y: e.y, z: 2, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, size: 9, color: '#cfd9e6', life: 0.5, drag: 5 })
      }
      if (fx) {
        fx.squashAng = Math.PI / 2
        fx.squashV -= 10
      }
    } else if (id === 'repulse' && b) {
      const m = Math.hypot(b.input.x, b.input.y)
      const s = Math.hypot(b.vx, b.vy)
      const a = m > 0.15 ? Math.atan2(b.input.y, b.input.x) : s > 20 ? Math.atan2(b.vy, b.vx) : 0
      for (let i = 0; i < (full ? 26 : 10); i++) {
        const aa = a + (Math.random() - 0.5) * 1.1
        const sp = 300 + Math.random() * 500
        this.add({ kind: 'spark', x: e.x, y: e.y, z: 18, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, size: 2.4, color: i % 3 ? c : '#ffffff', life: 0.35, drag: 3 })
      }
      this.add({ kind: 'streak', x: e.x, y: e.y, z: 18, size: 220, color: c, life: 0.3, rot: a })
    } else if (id === 'blink' && fx) {
      this.add({ kind: 'streak', x: fx.lastX, y: fx.lastY, z: 20, x2: e.x, y2: e.y, size: 0, color: c, life: 0.35 })
      for (const [px, py] of [[fx.lastX, fx.lastY], [e.x, e.y]] as const) {
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * TAU
          this.add({ kind: 'star', x: px, y: py, z: 20, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, vz: 60, size: 4, color: c, life: 0.4, drag: 3 })
        }
      }
    } else if (id === 'mirror') {
      this.add({ kind: 'sring', x: e.x, y: e.y, z: 20, size: 40, color: '#7ee0ff', life: 0.35, spin: 4 })
    } else {
      this.ring(e.x, e.y, c, 60, 0.45, 5)
      this.ring(e.x, e.y, '#ffffff', 34, 0.3, 2)
    }
    if (local && id) {
      const def = abilityById(id)
      if (def.id === id) this.add({ kind: 'text', x: e.x, y: e.y, z: 72, vz: 50, size: 17, color: c, life: 0.85, drag: 2, text: def.name.toUpperCase() })
    }
  }

  // ================================================================ frame

  /**
   * Draws the match blended `alpha` of the way from the previous tick to the current one, so motion
   * stays smooth on 90/120/144 Hz screens while the sim ticks at 60 Hz. Positions are swapped in
   * for the draw and restored afterwards; the sim never sees them.
   */
  draw(match: Match, alpha: number, prefs: RenderPrefs, biasX: number, spectateId: string): void {
    const a = clamp(alpha, 0, 1)
    const saved: [Body, number, number, number, number][] = []
    if (a < 0.999) {
      for (const b of match.bodies) {
        // Teleports (respawn, blink, portals) snap instead of smearing across the floor.
        if (Math.hypot(b.x - b.prevX, b.y - b.prevY) > 120) continue
        saved.push([b, b.x, b.y, b.height, b.fallHeight])
        b.x = lerp(b.prevX, b.x, a)
        b.y = lerp(b.prevY, b.y, a)
        if (b.falling) b.fallHeight = lerp(b.prevH, b.fallHeight, a)
        else b.height = lerp(b.prevH, b.height, a)
      }
    }
    try {
      this.drawFrame(match, prefs, biasX, spectateId)
    } finally {
      for (const [b, x, y, h, f] of saved) {
        b.x = x
        b.y = y
        b.height = h
        b.fallHeight = f
      }
    }
  }

  private drawFrame(match: Match, prefs: RenderPrefs, biasX: number, spectateId: string): void {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    const now = performance.now()
    const raw = this.lastNow ? now - this.lastNow : 16
    const dt = this.lastNow ? clamp(raw / 1000, 0, 0.05) : 1 / 60
    this.lastNow = now
    this.clock += dt
    this.adaptQuality(raw)
    const menu = match.silent
    if (this.matchRef !== match) this.enterMatch(match)

    const focus = match.players.find((p) => p.id === spectateId && p.alive) ?? match.players.find((p) => p.alive)
    this.frameCamera(match, w, h, dt, prefs, biasX, focus, menu, spectateId)
    const Z = this.Z
    const OX = this.OX
    const OY = this.OY
    const camX = this.camX
    const camY = this.camY
    const project: Project = (x, y, z = 0) => ({ x: OX + (x - camX) * Z, y: OY + (y - camY) * Z * TILT - z * Z })
    this.css = (x, y, z = 0) => {
      const p = project(x, y, z)
      return { x: p.x / this.dpr, y: p.y / this.dpr }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    this.background(match, w, h, dt)

    const poses = match.arena.solids.map((s) => solidPose(s, match.time, match.shrink))
    const bodies = match.bodies.filter((b) => b.alive)
    for (const b of bodies) this.track(b, dt, match, prefs)
    const sunk = (b: Body) => b.falling && b.fallHeight < -2
    const behind = bodies.filter((b) => sunk(b) && this.behindFloor(b, poses))

    // Things below and behind the platforms.
    this.drawParticles(project, dt, prefs, 'behind')
    for (const b of behind) this.drawBall(b, project, prefs, match)

    const order = [...poses].sort((a, b) => a.y - b.y)
    for (const pose of order) this.platformUnder(pose, project, match)
    for (const pose of order) {
      this.platformSide(pose, project, match)
      this.platformTop(pose, project, match)
    }

    // Ground decals.
    this.drawParticles(project, 0, prefs, 'ground')
    this.edgeGlow(bodies, project)
    this.groundHazards(match, project)
    this.groundEvents(match, project)
    if (match.zone) this.zone(match, project)

    const front = bodies.filter((b) => !behind.includes(b))
    for (const b of front) {
      if (this.fxFor(b).dropDelay > 0) continue
      const lift = this.zOf(b)
      this.shadow(b, project, lift)
      if (match.config.teams && !b.decoy && !b.falling) this.teamRing(b, project, teamColor(b.team))
    }
    const you = front.find((b) => b.id === spectateId)
    if (you && !menu && match.status !== 'countdown') this.localMarker(you, project)
    for (const b of front) {
      this.trail(b, project)
      this.launchStreak(b, project)
    }

    // Upright things, painted back to front.
    const items: DrawItem[] = []
    for (const b of front) items.push({ y: b.y, draw: () => { this.ghosts(b, project); this.drawBall(b, project, prefs, match) } })
    this.uprightHazards(match, project, items)
    for (const wall of wallSegments(match.arena.walls, match.time)) {
      const my = (wall.y1 + wall.y2) / 2
      items.push({ y: my, draw: () => this.wall(wall, project, match) })
    }
    this.uprightEvents(match, project, items)
    items.sort((a, b) => a.y - b.y)
    for (const it of items) it.draw()

    this.drawParticles(project, 0, prefs, 'air')

    // Labels never pile up. Your own is always full. Others get the full name pill when it fits,
    // drop to a compact heat chip in a crowd, and vanish rather than stack more than one row.
    this.labelScale = clamp(Math.min(w, h) / this.dpr / 760, 0.82, 1.08)
    const placed: { x: number; y: number; w: number }[] = []
    const rowH = 24 * this.dpr * this.labelScale
    const gap = 4 * this.dpr
    const fits = (x: number, y: number, lw: number) => !placed.some((o) => Math.abs(o.x - x) < (o.w + lw) / 2 + gap && Math.abs(o.y - y) < rowH)
    if (match.status !== 'countdown' || !this.anyDropping()) {
      const order = [...front]
        .filter((b) => !b.decoy && this.fxFor(b).drop <= 0.05)
        // Local first, then the hottest balls: their numbers matter most.
        .sort((a, b) => Number(b.id === spectateId) - Number(a.id === spectateId) || b.heat - a.heat)
      for (const b of order) {
        const local = b.id === spectateId && !menu
        const p = project(b.x, b.y, this.zOf(b) + b.radius * 2 + 10)
        const team = match.config.teams ? teamColor(b.team) : ''
        const full = this.labelWidth(b, false)
        if (local || fits(p.x, p.y, full)) {
          placed.push({ x: p.x, y: p.y, w: full })
          this.label(b, p.x, p.y, local, team, false)
          continue
        }
        if (b.heat < 1) continue
        const lite = this.labelWidth(b, true)
        for (const y of [p.y, p.y - rowH]) {
          if (!fits(p.x, y, lite)) continue
          placed.push({ x: p.x, y, w: lite })
          this.label(b, p.x, y, false, team, true)
          break
        }
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.screenFx(match, w, h, dt, prefs, focus, spectateId)
    if (!menu) this.offscreen(match, project, w, h, spectateId)
    this.countdown(match, w, h)
    if (match.replayMode) this.replayTag(w)
  }

  private replayTag(w: number): void {
    const ctx = this.ctx
    const dpr = this.dpr
    ctx.save()
    const x = w / 2
    const y = 34 * dpr
    ctx.font = `${22 * dpr}px ${DISPLAY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText('REPLAY').width + 44 * dpr
    roundRect(ctx, x - tw / 2, y - 17 * dpr, tw, 34 * dpr, 17 * dpr)
    ctx.fillStyle = 'rgba(8,10,24,0.85)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1.5 * dpr
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x - tw / 2 + 18 * dpr, y, 5 * dpr, 0, TAU)
    ctx.fillStyle = Math.sin(this.clock * 6) > 0 ? '#ff4d3a' : 'rgba(255,77,58,0.3)'
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText('REPLAY', x + 8 * dpr, y + 1 * dpr)
    ctx.restore()
  }

  /** Drops resolution a step at a time when the device cannot keep up. */
  private adaptQuality(frameMs: number): void {
    if (frameMs > 250) return
    this.frameEma = lerp(this.frameEma, frameMs, 0.05)
    this.slowFrames = this.frameEma > 21 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2)
    if (this.slowFrames > 120 && this.dpr > 1) {
      this.slowFrames = 0
      this.dprCap = Math.max(1, this.dpr - 0.25)
      this.resize()
    }
  }

  private enterMatch(match: Match): void {
    this.matchRef = match
    this.balls.clear()
    this.particles = []
    this.finish = null
    this.bgCache = null
    // Start a little wide so the camera settles in during the countdown.
    this.camZoom = 0
    if (match.status === 'countdown' && !match.silent) {
      match.players.forEach((p, i) => {
        const fx = this.fxFor(p)
        fx.drop = 1
        fx.dropDelay = 0.25 + i * 0.13
      })
    }
  }

  private anyDropping(): boolean {
    for (const fx of this.balls.values()) if (fx.drop > 0.05) return true
    return false
  }

  private frameCamera(match: Match, w: number, h: number, dt: number, prefs: RenderPrefs, biasX: number, focus: Body | undefined, menu: boolean, localId: string): void {
    const dpr = this.dpr
    const view = match.arena.view
    // Portrait phones would fit the arena to the narrow side and waste most of the screen.
    // Zoom in and let the camera follow the local ball further instead.
    const tall = clamp((h / Math.max(1, w) - 1.05) / 0.9, 0, 1)
    const inset = menu ? 0 : this.insetTop * dpr
    const fitW = w / (2 * view * 1.02)
    const fitH = (h - inset) / ((2 * view * TILT + DEPTH * 1.2) * 1.02)
    const base = Math.min(fitW, fitH) * (1 + tall * 0.5) * (menu ? 0.94 : 1)

    let tx = 0
    let ty = 0
    let zoomK = 1
    const alive = match.players.filter((p) => p.alive)
    if (!menu && alive.length > 0 && match.status !== 'countdown') {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of alive) {
        const px = p.x + p.vx * 0.2
        const py = p.y + p.vy * 0.2
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minY = Math.min(minY, py)
        maxY = Math.max(maxY, py)
      }
      const pad = 250
      const halfW = (maxX - minX) / 2 + pad
      const halfH = ((maxY - minY) / 2 + pad) * TILT + 60
      const fit = Math.min(w / 2 / (halfW * base), (h - inset) / 2 / (halfH * base))
      zoomK = clamp(fit, 1, alive.length <= 2 ? 1.35 : 1.15)
      const k = clamp((zoomK - 1) / 0.3, 0, 1) * 0.85
      tx = lerp(0, (minX + maxX) / 2, k)
      ty = lerp(0, (minY + maxY) / 2, k)
    }
    if (focus && !menu) {
      const reach = view * 0.42 * tall
      const lx = clamp(focus.x + focus.vx * 0.08, -60 - reach * 0.6, 60 + reach * 0.6)
      const ly = clamp(focus.y + focus.vy * 0.08, -40 - reach, 40 + reach)
      const pull = focus.id === localId ? 0.16 + tall * 0.6 : 0.1
      tx = lerp(tx, lx, pull)
      ty = lerp(ty, ly, pull)
    }
    let finishZoom = 0
    if (this.finish) {
      this.finish.life -= dt
      const u = clamp(this.finish.life / this.finish.max, 0, 1)
      const env = Math.sin(u * Math.PI)
      tx = lerp(tx, this.finish.x, env)
      ty = lerp(ty, this.finish.y, env)
      finishZoom = env * 0.55 * (prefs.reducedMotion ? 0.2 : 1)
      if (this.finish.life <= 0) this.finish = null
    }
    const follow = 1 - Math.exp(-3.2 * dt)
    this.camX = lerp(this.camX, tx, follow)
    this.camY = lerp(this.camY, ty, follow)
    this.punch *= Math.exp(-9 * dt)
    const targetZoom = zoomK * (1 + finishZoom)
    if (this.camZoom <= 0) this.camZoom = menu ? targetZoom : targetZoom * 0.82
    this.camZoom = lerp(this.camZoom, targetZoom, 1 - Math.exp(-(match.status === 'countdown' ? 1.6 : 2.4) * dt))
    const Z = base * (this.camZoom + this.punch)

    this.trauma = Math.max(0, this.trauma - dt * 1.5)
    const quake = this.trauma * this.trauma * 18 * dpr
    const t = this.clock * 26
    const sx = quake * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4)
    const sy = quake * (Math.cos(t * 0.9 + 0.4) * 0.6 + Math.sin(t * 2.7 + 3.1) * 0.4)
    this.kickVX += (-260 * this.kickX - 20 * this.kickVX) * dt
    this.kickVY += (-260 * this.kickY - 20 * this.kickVY) * dt
    this.kickX += this.kickVX * dt
    this.kickY += this.kickVY * dt

    this.Z = Z
    this.OX = w / 2 + biasX * dpr + sx + this.kickX * dpr
    this.OY = h / 2 + inset * 0.5 - tall * h * 0.05 - DEPTH * Z * 0.45 + sy + this.kickY * dpr
  }

  // ================================================================ background

  private background(match: Match, w: number, h: number, dt: number): void {
    const ctx = this.ctx
    const key = `${match.arena.id}:${w}x${h}`
    if (!this.bgCache || this.bgCache.key !== key) this.bgCache = { key, canvas: this.paintSky(match, w, h) }
    const sky = this.bgCache.canvas
    const px = -this.camX * 0.05 * this.Z
    const py = -this.camY * 0.05 * this.Z
    ctx.drawImage(sky, -w * 0.05 + px, -h * 0.05 + py)

    // Distant islands drift far below the arena.
    const T = this.clock
    for (const r of this.rocks) {
      const x = w / 2 + (r.x * w * 0.5) - this.camX * r.depth * this.Z * 0.6 + Math.sin(T * 0.05 + r.seed) * 20 * this.dpr
      const y = r.y * h + Math.sin(T * 0.3 + r.seed * 2) * 6 * this.dpr - this.camY * r.depth * this.Z * 0.4
      this.rock(x, y, r.r * this.dpr * (0.6 + r.depth), r.seed, match.arena.rim, r.depth)
    }

    // Motes rising through the void give the empty space some air.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const m of this.motes) {
      m.y -= m.s * 0.02 * dt * m.z
      if (m.y < -0.05) m.y = 1.05
      const x = ((m.x * w - this.camX * m.z * this.Z * 0.3) % w + w) % w
      const y = m.y * h - this.camY * m.z * this.Z * 0.2
      const a = 0.25 + Math.sin(T * 2 + m.x * 30) * 0.15
      ctx.fillStyle = hexA(m.z > 0.6 ? match.arena.accent : '#cfe2ff', a * m.z)
      ctx.beginPath()
      ctx.arc(x, y, m.r * this.dpr * m.z, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  private paintSky(match: Match, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * 1.1)
    c.height = Math.ceil(h * 1.1)
    const g = c.getContext('2d')!
    const { rim, accent, floor } = match.arena
    const W = c.width
    const H = c.height
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, mixHex('#050816', accent, 0.07))
    sky.addColorStop(0.5, mixHex('#080c1d', floor, 0.25))
    sky.addColorStop(1, mixHex('#03040b', rim, 0.08))
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    const blobs: [number, number, number, string, number][] = [
      [0.15, 0.2, 0.55, rim, 0.13],
      [0.85, 0.75, 0.6, accent, 0.1],
      [0.7, 0.1, 0.4, mixHex(rim, accent, 0.5), 0.08],
      [0.3, 0.9, 0.5, floor, 0.25],
    ]
    for (const [bx, by, br, col, a] of blobs) {
      const rad = Math.max(W, H) * br
      const gr = g.createRadialGradient(bx * W, by * H, 0, bx * W, by * H, rad)
      gr.addColorStop(0, hexA(col, a))
      gr.addColorStop(0.5, hexA(col, a * 0.35))
      gr.addColorStop(1, hexA(col, 0))
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
    }
    // Soft light shafts from above.
    g.filter = 'blur(24px)'
    for (let i = 0; i < 4; i++) {
      const x = W * (0.1 + hashN(i * 7.7) * 0.8)
      const sw = W * (0.06 + hashN(i * 3.1) * 0.08)
      const shaft = g.createLinearGradient(0, 0, 0, H * 0.8)
      shaft.addColorStop(0, hexA('#cfe2ff', 0.022))
      shaft.addColorStop(1, hexA('#cfe2ff', 0))
      g.fillStyle = shaft
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x + sw, 0)
      g.lineTo(x + sw * 3 + W * 0.1, H * 0.8)
      g.lineTo(x + W * 0.1, H * 0.8)
      g.closePath()
      g.fill()
    }
    g.filter = 'none'
    for (let i = 0; i < 260; i++) {
      const x = hashN(i * 3 + 1) * W
      const y = hashN(i * 3 + 2) * H
      const r = (0.4 + hashN(i * 3 + 3) * 1.4) * this.dpr
      g.fillStyle = `rgba(220,232,255,${0.15 + hashN(i * 7) * 0.55})`
      g.beginPath()
      g.arc(x, y, r, 0, TAU)
      g.fill()
      if (hashN(i * 11) > 0.96) {
        const glow = g.createRadialGradient(x, y, 0, x, y, r * 8)
        glow.addColorStop(0, 'rgba(220,232,255,0.35)')
        glow.addColorStop(1, 'rgba(220,232,255,0)')
        g.fillStyle = glow
        g.fillRect(x - r * 8, y - r * 8, r * 16, r * 16)
      }
    }
    g.globalCompositeOperation = 'source-over'
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75)
    vig.addColorStop(0, 'rgba(0,0,0,0)')
    vig.addColorStop(1, 'rgba(0,0,0,0.55)')
    g.fillStyle = vig
    g.fillRect(0, 0, W, H)
    return c
  }

  /** A small floating island far below: flat lit top, jagged rocky underside. */
  private rock(x: number, y: number, r: number, seed: number, rim: string, depth: number): void {
    const ctx = this.ctx
    const rx = r * 1.25
    const ry = r * 0.3
    ctx.save()
    ctx.globalAlpha = 0.3 + depth * 1.2
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, Math.PI, TAU)
    const n = 9
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const px = x + rx - u * rx * 2
      const taper = Math.sin(u * Math.PI)
      const drop = ry + taper * r * (0.5 + hashN(seed * 13 + i) * 0.9)
      ctx.lineTo(px, y + drop)
    }
    ctx.closePath()
    const g = ctx.createLinearGradient(0, y - ry, 0, y + r * 1.4)
    g.addColorStop(0, '#1e2742')
    g.addColorStop(0.4, '#10162a')
    g.addColorStop(1, '#04060d')
    ctx.fillStyle = g
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
    const top = ctx.createLinearGradient(0, y - ry, 0, y + ry)
    top.addColorStop(0, '#2c3a5c')
    top.addColorStop(1, '#18203a')
    ctx.fillStyle = top
    ctx.fill()
    ctx.strokeStyle = hexA(rim, 0.4)
    ctx.lineWidth = 1.5 * this.dpr
    ctx.stroke()
    ctx.restore()
  }

  // ================================================================ platforms

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

  private behindAny(x: number, y: number, match: Match): boolean {
    const poses = match.arena.solids.map((s) => solidPose(s, match.time, match.shrink))
    let best: Pose | null = null
    let bestD = Infinity
    for (const p of poses) {
      const d = Math.hypot(x - p.x, y - p.y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return !!best && y < best.y
  }

  private poseAlpha(pose: Pose): number {
    if (!pose.active) return 0
    if (pose.warn) return 0.65 + Math.sin(this.clock * 22) * 0.3
    return 1
  }

  private poseShake(pose: Pose): number {
    return pose.warn ? Math.sin(this.clock * 60) * 2.5 * this.dpr : 0
  }

  private platformUnder(pose: Pose, project: Project, match: Match): void {
    if (!pose.active) return
    const ctx = this.ctx
    const Z = this.Z
    const c = project(pose.x, pose.y, -DEPTH)
    const span = pose.shape === 'poly' ? polyRadius(pose) : pose.r
    const rx = span * Z * 1.1
    const ry = span * Z * TILT * 0.9
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx)
    g.addColorStop(0, hexA(match.arena.rim, 0.22))
    g.addColorStop(0.5, hexA(match.arena.rim, 0.07))
    g.addColorStop(1, hexA(match.arena.rim, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(c.x, c.y + ry * 0.2, rx, ry, 0, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  private platformSide(pose: Pose, project: Project, match: Match): void {
    const a = this.poseAlpha(pose)
    if (a <= 0) {
      this.ghostPlatform(pose, project, match)
      return
    }
    const ctx = this.ctx
    const Z = this.Z
    const D = DEPTH * Z
    const { floor, rim } = match.arena
    const sx = this.poseShake(pose)
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(sx, 0)
    const c = project(pose.x, pose.y)
    if (pose.shape === 'poly') {
      const pts = pose.points.map((p) => project(p.x, p.y))
      const n = pts.length
      // Signed area tells winding, so outward normals are right for either order.
      let area = 0
      for (let i = 0; i < n; i++) {
        const p = pts[i]!
        const q = pts[(i + 1) % n]!
        area += p.x * q.y - q.x * p.y
      }
      const sgn = area > 0 ? 1 : -1
      for (let i = 0; i < n; i++) {
        const p = pts[i]!
        const q = pts[(i + 1) % n]!
        // Screen y points down, so a camera-facing edge has its outward normal pointing +y.
        const ny = (p.x - q.x) * sgn
        if (ny <= 0) continue
        const g = ctx.createLinearGradient(0, Math.min(p.y, q.y), 0, Math.max(p.y, q.y) + D)
        g.addColorStop(0, shade(floor, -0.3))
        g.addColorStop(1, shade(floor, -0.82))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.lineTo(q.x, q.y + D)
        ctx.lineTo(p.x, p.y + D)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = hexA(rim, 0.65)
        ctx.lineWidth = 2 * this.dpr
        ctx.beginPath()
        ctx.moveTo(p.x, p.y + D * 0.42)
        ctx.lineTo(q.x, q.y + D * 0.42)
        ctx.stroke()
      }
    } else {
      const rx = pose.r * Z
      const ry = pose.r * Z * TILT
      const g = ctx.createLinearGradient(0, c.y, 0, c.y + ry + D)
      g.addColorStop(0, shade(floor, -0.25))
      g.addColorStop(0.6, shade(floor, -0.62))
      g.addColorStop(1, shade(floor, -0.88))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI)
      ctx.lineTo(c.x - rx, c.y + D)
      ctx.ellipse(c.x, c.y + D, rx, ry, 0, Math.PI, 0, true)
      ctx.closePath()
      ctx.fill()
      // Panel seams wrap the side so it reads as a solid drum.
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'
      ctx.lineWidth = 1.5 * this.dpr
      const seams = 18
      for (let i = 1; i < seams; i++) {
        const t = (i / seams) * Math.PI
        const x = c.x + Math.cos(t) * rx
        const y = c.y + Math.sin(t) * ry
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + D)
        ctx.stroke()
      }
      // Emissive band, brighter in the final phase.
      const hot = match.finalPhase || match.status === 'sudden'
      const band = hot ? mixHex(rim, '#ff3b2f', 0.5 + Math.sin(this.clock * 8) * 0.3) : rim
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = hexA(band, 0.35)
      ctx.lineWidth = 7 * this.dpr
      ctx.beginPath()
      ctx.ellipse(c.x, c.y + D * 0.42, rx, ry, 0, 0.05, Math.PI - 0.05)
      ctx.stroke()
      ctx.strokeStyle = hexA(mixHex(band, '#ffffff', 0.4), 0.9)
      ctx.lineWidth = 2 * this.dpr
      ctx.stroke()
      // Running lights travel along the band.
      for (let i = 0; i < 12; i++) {
        const t = ((i / 12 + this.clock * 0.05) % 1) * Math.PI
        const lx = c.x + Math.cos(t) * rx
        const ly = c.y + D * 0.42 + Math.sin(t) * ry
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 9 * this.dpr)
        lg.addColorStop(0, hexA('#ffffff', 0.8 * Math.sin(t)))
        lg.addColorStop(1, hexA(band, 0))
        ctx.fillStyle = lg
        ctx.fillRect(lx - 9 * this.dpr, ly - 9 * this.dpr, 18 * this.dpr, 18 * this.dpr)
      }
      ctx.restore()
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 2 * this.dpr
      ctx.beginPath()
      ctx.ellipse(c.x, c.y + D, rx, ry, 0, 0, Math.PI)
      ctx.stroke()
    }
    ctx.restore()
  }

  private ghostPlatform(pose: Pose, project: Project, match: Match): void {
    const ctx = this.ctx
    const c = project(pose.x, pose.y)
    ctx.save()
    ctx.setLineDash([8 * this.dpr, 8 * this.dpr])
    ctx.lineDashOffset = -this.clock * 20 * this.dpr
    ctx.strokeStyle = hexA(match.arena.rim, 0.35)
    ctx.lineWidth = 2 * this.dpr
    ctx.beginPath()
    if (pose.shape === 'poly') this.polyPath(pose, project)
    else ctx.ellipse(c.x, c.y, pose.r * this.Z, pose.r * this.Z * TILT, 0, 0, TAU)
    ctx.stroke()
    ctx.restore()
  }

  private polyPath(pose: Pose, project: Project): void {
    const ctx = this.ctx
    pose.points.forEach((pt, i) => {
      const s = project(pt.x, pt.y)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.closePath()
  }

  private platformTop(pose: Pose, project: Project, match: Match): void {
    const a = this.poseAlpha(pose)
    if (a <= 0) return
    const ctx = this.ctx
    const Z = this.Z
    const { floor, rim, accent, id: arenaId } = match.arena
    const c = project(pose.x, pose.y)
    const rx = pose.r * Z
    const ry = pose.r * Z * TILT
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(this.poseShake(pose), 0)

    const path = () => {
      ctx.beginPath()
      if (pose.shape === 'poly') this.polyPath(pose, project)
      else {
        ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU)
        if (pose.shape === 'ring') {
          ctx.moveTo(c.x + pose.inner * Z, c.y)
          ctx.ellipse(c.x, c.y, pose.inner * Z, pose.inner * Z * TILT, 0, 0, TAU, true)
        }
      }
    }

    const span = (pose.shape === 'poly' ? polyRadius(pose) : pose.r) * Z
    const surfaceTint = pose.surface === 'rubber' ? '#ff6b9a' : pose.surface === 'ice' ? '#bfe8ff' : pose.surface === 'launch' ? '#ffc14d' : pose.surface === 'sticky' ? '#9b7bff' : floor
    const top = pose.surface === 'normal' ? floor : mixHex(floor, surfaceTint, 0.14)
    const g = ctx.createRadialGradient(c.x - span * 0.2, c.y - span * TILT * 0.45, span * 0.05, c.x, c.y, span * 1.1)
    g.addColorStop(0, shade(top, 0.2))
    g.addColorStop(0.55, top)
    g.addColorStop(1, shade(top, -0.35))
    path()
    ctx.fillStyle = g
    ctx.fill('evenodd')

    // Tile pattern follows the world so motion reads across the floor.
    ctx.save()
    path()
    ctx.clip('evenodd')
    const pattern = this.hexTile()
    if (pattern) {
      const o = project(0, 0)
      const scale = Z * 1.3
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale * TILT, o.x, o.y]))
      ctx.globalAlpha *= 0.6
      ctx.fillStyle = pattern
      ctx.fillRect(c.x - span * 1.3, c.y - span * 1.3, span * 2.6, span * 2.6)
      ctx.globalAlpha = a
    }
    // Light pooling in the centre and a soft falloff toward the edge.
    const pool = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, span)
    pool.addColorStop(0, hexA(accent, 0.1))
    pool.addColorStop(1, hexA(accent, 0))
    ctx.fillStyle = pool
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillRect(c.x - span, c.y - span, span * 2, span * 2)
    ctx.globalCompositeOperation = 'source-over'

    if (pose.shape === 'circle' && pose.r > 200) {
      // Court markings.
      ctx.strokeStyle = hexA(accent, 0.22)
      ctx.lineWidth = 2 * this.dpr
      for (const ring of arenaId === 'classic' || arenaId === 'collapse' ? [0.33, 0.66] : [0.22]) {
        ctx.beginPath()
        ctx.ellipse(c.x, c.y, rx * ring, ry * ring, 0, 0, TAU)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(c.x - rx * 0.06, c.y)
      ctx.lineTo(c.x + rx * 0.06, c.y)
      ctx.moveTo(c.x, c.y - ry * 0.06)
      ctx.lineTo(c.x, c.y + ry * 0.06)
      ctx.stroke()
    }
    if (pose.surface === 'launch') {
      ctx.strokeStyle = hexA('#ffc14d', 0.6)
      ctx.lineWidth = 3 * this.dpr
      ctx.setLineDash([10 * this.dpr, 10 * this.dpr])
      ctx.lineDashOffset = -this.clock * 40 * this.dpr
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, rx * 0.7, ry * 0.7, 0, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (pose.surface === 'rubber') {
      ctx.fillStyle = hexA('#ff9fc0', 0.08)
      for (let i = 0; i < 40; i++) {
        const t = hashN(i * 3.3) * TAU
        const d = Math.sqrt(hashN(i * 5.1)) * 0.9
        ctx.beginPath()
        ctx.ellipse(c.x + Math.cos(t) * rx * d, c.y + Math.sin(t) * ry * d, 6 * Z, 6 * Z * TILT, 0, 0, TAU)
        ctx.fill()
      }
    }
    // The lip: where a slow drift skates instead of falling. Show it so players learn it.
    if (pose.shape !== 'poly' && pose.r > 90) {
      const lip = Math.max(0, pose.r - 52) / pose.r
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU)
      ctx.ellipse(c.x, c.y, rx * lip, ry * lip, 0, 0, TAU, true)
      ctx.fillStyle = hexA(shade(floor, -0.5), 0.35)
      ctx.fill('evenodd')
      const lp = this.lipTile(rim)
      if (lp) {
        const o = project(0, 0)
        lp.setTransform(new DOMMatrix([Z, 0, 0, Z * TILT, o.x + this.clock * 6 * Z, o.y]))
        ctx.fillStyle = lp
        ctx.fill('evenodd')
      }
      ctx.strokeStyle = hexA(rim, 0.25)
      ctx.lineWidth = 1.5 * this.dpr
      ctx.setLineDash([3 * this.dpr, 7 * this.dpr])
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, rx * lip, ry * lip, 0, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()

    // Rim: a glowing lip, a bright edge and a dark undercut.
    const hot = match.finalPhase || match.status === 'sudden'
    const rimCol = pose.warn ? '#ff3b2f' : hot ? mixHex(rim, '#ff3b2f', 0.4 + Math.sin(this.clock * 8) * 0.3) : rim
    const stroke = (width: number, style: string) => {
      ctx.lineWidth = width
      ctx.strokeStyle = style
      if (pose.shape === 'poly') {
        ctx.beginPath()
        this.polyPath(pose, project)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU)
        ctx.stroke()
      }
    }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    stroke(14 * this.dpr, hexA(rimCol, hot ? 0.3 : 0.16))
    ctx.restore()
    stroke(5 * this.dpr, shade(rimCol, -0.35))
    stroke(2.5 * this.dpr, mixHex(rimCol, '#ffffff', 0.35))
    if (pose.shape !== 'poly') {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.setLineDash([2 * this.dpr, 22 * this.dpr])
      ctx.lineDashOffset = -this.clock * 30 * this.dpr
      ctx.lineCap = 'round'
      stroke(4 * this.dpr, hexA('#ffffff', 0.7))
      ctx.restore()
    }
    if (pose.shape === 'ring') {
      const irx = pose.inner * Z
      const iry = pose.inner * Z * TILT
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, irx, iry, 0, 0, TAU)
      ctx.clip()
      ctx.fillStyle = '#02030a'
      ctx.fillRect(c.x - irx, c.y - iry, irx * 2, iry * 2)
      // The far inner wall of the hole.
      const D = DEPTH * Z
      const wg = ctx.createLinearGradient(0, c.y - iry, 0, c.y - iry + D)
      wg.addColorStop(0, shade(floor, -0.35))
      wg.addColorStop(1, shade(floor, -0.9))
      ctx.fillStyle = wg
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, irx, iry, 0, Math.PI, TAU)
      ctx.lineTo(c.x + irx, c.y + D)
      ctx.ellipse(c.x, c.y + D, irx, iry, 0, 0, Math.PI, true)
      ctx.closePath()
      ctx.fill()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = hexA(rim, 0.45)
      ctx.lineWidth = 2 * this.dpr
      ctx.beginPath()
      ctx.ellipse(c.x, c.y + D * 0.42, irx, iry, 0, Math.PI + 0.1, TAU - 0.1)
      ctx.stroke()
      ctx.restore()
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, irx, iry, 0, 0, TAU)
      ctx.lineWidth = 3 * this.dpr
      ctx.strokeStyle = mixHex(rimCol, '#ffffff', 0.3)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Red glow on the rim right where a ball is about to leave. */
  private edgeGlow(bodies: Body[], project: Project): void {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bodies) {
      if (b.decoy || b.edgeDist > 80 || b.edgeDist < -40) continue
      const k = clamp(1 - b.edgeDist / 80, 0, 1)
      const ex = b.x - b.safetyX * b.edgeDist
      const ey = b.y - b.safetyY * b.edgeDist
      const s = project(ex, ey)
      const rr = (60 + k * 50) * this.Z
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
      g.addColorStop(0, hexA('#ff4d3a', 0.55 * k))
      g.addColorStop(1, hexA('#ff4d3a', 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, rr, rr * TILT, 0, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  private wall(wall: { x1: number; y1: number; x2: number; y2: number; lethal: boolean }, project: Project, match: Match): void {
    const ctx = this.ctx
    const a0 = project(wall.x1, wall.y1)
    const b0 = project(wall.x2, wall.y2)
    const a1 = project(wall.x1, wall.y1, WALL_H)
    const b1 = project(wall.x2, wall.y2, WALL_H)
    const col = wall.lethal ? '#ff4d3a' : match.arena.rim
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 12 * this.dpr
    ctx.beginPath()
    ctx.moveTo(a0.x, a0.y + 4 * this.dpr)
    ctx.lineTo(b0.x, b0.y + 4 * this.dpr)
    ctx.stroke()
    const g = ctx.createLinearGradient(0, Math.min(a1.y, b1.y), 0, Math.max(a0.y, b0.y))
    g.addColorStop(0, shade(col, -0.2))
    g.addColorStop(1, shade(col, -0.75))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(a0.x, a0.y)
    ctx.lineTo(b0.x, b0.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.lineTo(a1.x, a1.y)
    ctx.closePath()
    ctx.fill()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = hexA(col, 0.4)
    ctx.lineWidth = 10 * this.dpr
    ctx.beginPath()
    ctx.moveTo(a1.x, a1.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = mixHex(col, '#ffffff', 0.6)
    ctx.lineWidth = 3.5 * this.dpr
    ctx.stroke()
    ctx.restore()
  }

  // ================================================================ hazards

  private groundHazards(match: Match, project: Project): void {
    const ctx = this.ctx
    const T = this.clock
    const dpr = this.dpr
    const Z = this.Z
    for (const h of [...match.arena.hazards, ...match.extras]) {
      const p = hazardPose(h, match.time)
      const s = project(p.x, p.y)
      const r = Math.max(4, p.r * Z)
      const ry = r * TILT
      ctx.save()
      if (h.kind === 'lava') {
        const pulse = 0.5 + Math.sin(T * 4) * 0.5
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(s.x, s.y, r * 0.8, s.x, s.y, r * 1.6)
        halo.addColorStop(0, hexA('#ff6a2a', 0.35))
        halo.addColorStop(1, hexA('#ff6a2a', 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * 1.6, ry * 1.6, 0, 0, TAU)
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
        const g = ctx.createRadialGradient(s.x, s.y - ry * 0.2, 0, s.x, s.y, r)
        g.addColorStop(0, '#fff0a8')
        g.addColorStop(0.35, '#ffb02e')
        g.addColorStop(0.75, '#ff4d1a')
        g.addColorStop(1, '#8a1408')
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
        ctx.clip()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 12; i++) {
          const a = i * 2.4 + T * 0.25
          const d = ((i * 0.37 + T * 0.1) % 1) * r * 0.85
          const life = (T * 0.7 + i * 0.29) % 1
          const br = Math.sin(life * Math.PI) * r * 0.12
          ctx.beginPath()
          ctx.ellipse(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * TILT, br, br * TILT, 0, 0, TAU)
          ctx.fillStyle = hexA('#fff3c4', 0.35 + pulse * 0.25)
          ctx.fill()
        }
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
        ctx.strokeStyle = hexA('#3a0a04', 0.8)
        ctx.lineWidth = 4 * dpr
        ctx.stroke()
        // Heat rising off the pool.
        if (Math.random() < 0.3) this.add({ kind: 'ember', x: p.x + (Math.random() - 0.5) * p.r * 1.6, y: p.y + (Math.random() - 0.5) * p.r * 1.6, z: 4, vz: 60 + Math.random() * 60, size: 2 + Math.random() * 2, color: Math.random() < 0.5 ? '#ffc14d' : '#ff6a2a', life: 0.9, drag: 1 })
      } else if (h.kind === 'spikes') {
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * 1.1, ry * 1.1, 0, 0, TAU)
        ctx.fillStyle = '#1a0d12'
        ctx.fill()
        ctx.strokeStyle = hexA('#ff4d3a', 0.8)
        ctx.lineWidth = 2.5 * dpr
        ctx.setLineDash([6 * dpr, 4 * dpr])
        ctx.lineDashOffset = T * 20
        ctx.stroke()
      } else if (h.kind === 'bumper') {
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * 1.15, ry * 1.15, 0, 0, TAU)
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(s.x, s.y, r * 0.8, s.x, s.y, r * 2)
        halo.addColorStop(0, hexA(h.color, 0.28))
        halo.addColorStop(1, hexA(h.color, 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * 2, ry * 2, 0, 0, TAU)
        ctx.fill()
      } else if (h.kind === 'portal') {
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.4)
        g.addColorStop(0, hexA(h.color, 0.7))
        g.addColorStop(0.6, hexA(h.color, 0.2))
        g.addColorStop(1, hexA(h.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * 1.4, ry * 1.4, 0, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = h.color
        ctx.lineWidth = 3 * dpr
        ctx.lineCap = 'round'
        for (let i = 0; i < 4; i++) {
          const a = T * 2.5 + (i * TAU) / 4
          const rr = 0.35 + i * 0.18
          ctx.beginPath()
          ctx.ellipse(s.x, s.y, r * rr, ry * rr, 0, a, a + 2)
          ctx.stroke()
        }
        if (Math.random() < 0.25) this.add({ kind: 'star', x: p.x + (Math.random() - 0.5) * p.r, y: p.y + (Math.random() - 0.5) * p.r, z: 2, vz: 90, size: 3, color: h.color, life: 0.8, drag: 1 })
      } else if (h.kind === 'launcher') {
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
        ctx.fillStyle = hexA(h.color, 0.16)
        ctx.fill()
        ctx.strokeStyle = h.color
        ctx.lineWidth = 2.5 * dpr
        ctx.stroke()
        ctx.clip()
        this.groundOn(p.x, p.y)
        ctx.rotate(h.angle)
        const R = p.r
        for (let i = 0; i < 3; i++) {
          const u = (T * 1.6 + i / 3) % 1
          const x = lerp(-R * 0.8, R * 0.8, u)
          ctx.globalAlpha = Math.sin(u * Math.PI)
          ctx.beginPath()
          ctx.moveTo(x - R * 0.25, -R * 0.42)
          ctx.lineTo(x + R * 0.15, 0)
          ctx.lineTo(x - R * 0.25, R * 0.42)
          ctx.strokeStyle = h.color
          ctx.lineWidth = (5 * dpr) / Z
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.stroke()
        }
      } else if (h.kind === 'blackhole') {
        this.vortex(s.x, s.y, r * 1.3, '#b388ff', T)
      } else if (h.kind === 'explosive') {
        const warn = explosiveWarn(h, match.time)
        const blink = warn ? (Math.sin(T * 30) > 0 ? 1 : 0.4) : 0.6
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
        ctx.fillStyle = hexA('#ff4d3a', (warn ? 0.28 : 0.12) * blink)
        ctx.fill()
        ctx.setLineDash([8 * dpr, 6 * dpr])
        ctx.lineDashOffset = T * 20
        ctx.strokeStyle = hexA('#ffc14d', blink)
        ctx.lineWidth = 3 * dpr
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = hexA('#ffc14d', blink)
        ctx.font = `${16 * dpr * (Z / 0.7)}px ${DISPLAY_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('!', s.x, s.y)
      } else if (h.kind === 'laser') {
        const mode = laserMode(h, match.time)
        if (mode !== 'off') {
          const ang = laserAngle(h, match.time)
          const end = project(h.x + Math.cos(ang) * p.r, h.y + Math.sin(ang) * p.r)
          const start = project(h.x, h.y)
          ctx.lineCap = 'round'
          if (mode === 'hot') {
            ctx.globalCompositeOperation = 'lighter'
            ctx.strokeStyle = 'rgba(255,60,40,0.25)'
            ctx.lineWidth = 34 * dpr * (Z / 0.7)
            ctx.beginPath()
            ctx.moveTo(start.x, start.y)
            ctx.lineTo(end.x, end.y)
            ctx.stroke()
          } else {
            ctx.setLineDash([10 * dpr, 8 * dpr])
            ctx.lineDashOffset = -T * 80
            ctx.strokeStyle = `rgba(255,193,77,${0.45 + Math.sin(T * 24) * 0.3})`
            ctx.lineWidth = 2.5 * dpr
            ctx.beginPath()
            ctx.moveTo(start.x, start.y)
            ctx.lineTo(end.x, end.y)
            ctx.stroke()
          }
        }
      } else if (h.kind === 'conveyor' || h.kind === 'gravity' || h.kind === 'ice' || h.kind === 'crusher') {
        const hw = h.w || h.r * 2
        const hh = h.h || h.r * 2
        this.groundOn(p.x, p.y)
        const x0 = -hw / 2
        const y0 = -hh / 2
        ctx.beginPath()
        ctx.rect(x0, y0, hw, hh)
        ctx.clip()
        const px = dpr / Z
        if (h.kind === 'conveyor') {
          ctx.fillStyle = hexA(shade(h.color, -0.6), 0.55)
          ctx.fillRect(x0, y0, hw, hh)
          const step = 46
          const dir = Math.cos(h.angle) >= 0 ? 1 : -1
          const off = (((T * h.speed * dir) % step) + step) % step
          ctx.strokeStyle = hexA(h.color, 0.55)
          ctx.lineWidth = 5 * px
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          for (let x = x0 - step + off; x < x0 + hw + step; x += step) {
            ctx.beginPath()
            ctx.moveTo(x - dir * hh * 0.18, -hh * 0.3)
            ctx.lineTo(x + dir * hh * 0.12, 0)
            ctx.lineTo(x - dir * hh * 0.18, hh * 0.3)
            ctx.stroke()
          }
          ctx.strokeStyle = hexA(h.color, 0.7)
          ctx.lineWidth = 3 * px
          ctx.strokeRect(x0, y0, hw, hh)
        } else if (h.kind === 'gravity') {
          const light = h.speed < 1
          ctx.fillStyle = light ? 'rgba(126,224,255,0.07)' : 'rgba(214,255,74,0.06)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.fillStyle = light ? 'rgba(126,224,255,0.55)' : 'rgba(214,255,74,0.45)'
          for (let i = 0; i < 30; i++) {
            const fx = ((i * 0.618) % 1) * hw
            const drift = light ? -1 : 1
            const fy = (((((i * 0.37) + T * 0.05 * (light ? 1 : 2.2) * drift) % 1) + 1) % 1) * hh
            const sz = (light ? 3 : 2.2) * px
            ctx.fillRect(x0 + fx, y0 + fy, sz, light ? sz : sz * 4)
          }
          ctx.strokeStyle = light ? 'rgba(126,224,255,0.45)' : 'rgba(214,255,74,0.4)'
          ctx.lineWidth = 2 * px
          ctx.setLineDash([8 * px, 6 * px])
          ctx.strokeRect(x0, y0, hw, hh)
        } else if (h.kind === 'ice') {
          ctx.fillStyle = 'rgba(191,232,255,0.18)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'
          ctx.lineWidth = 2 * px
          for (let x = x0 - hh; x < x0 + hw; x += 40) {
            ctx.beginPath()
            ctx.moveTo(x, y0 + hh)
            ctx.lineTo(x + hh, y0)
            ctx.stroke()
          }
        } else {
          ctx.fillStyle = 'rgba(30,24,10,0.6)'
          ctx.fillRect(x0, y0, hw, hh)
          ctx.strokeStyle = 'rgba(255,193,77,0.6)'
          ctx.lineWidth = 8 * px
          for (let x = x0 - hh; x < x0 + hw; x += 26) {
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

  /** Bumpers, spikes and laser posts stand up, so they sort with the balls. */
  private uprightHazards(match: Match, project: Project, items: DrawItem[]): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const Z = this.Z
    const T = this.clock
    for (const h of [...match.arena.hazards, ...match.extras]) {
      const p = hazardPose(h, match.time)
      if (h.kind === 'bumper') {
        items.push({
          y: p.y,
          draw: () => {
            const pulse = 1 + Math.sin(T * 5 + h.x) * 0.03
            const r = p.r * Z * pulse
            const H = 24 * Z
            const base = project(p.x, p.y)
            const ry = r * TILT
            const side = ctx.createLinearGradient(base.x - r, 0, base.x + r, 0)
            side.addColorStop(0, shade(h.color, -0.6))
            side.addColorStop(0.35, shade(h.color, -0.15))
            side.addColorStop(1, shade(h.color, -0.7))
            ctx.fillStyle = side
            ctx.beginPath()
            ctx.ellipse(base.x, base.y, r, ry, 0, 0, Math.PI)
            ctx.lineTo(base.x - r, base.y - H)
            ctx.ellipse(base.x, base.y - H, r, ry, 0, Math.PI, 0, true)
            ctx.closePath()
            ctx.fill()
            const g = ctx.createRadialGradient(base.x - r * 0.3, base.y - H - ry * 0.4, r * 0.1, base.x, base.y - H, r)
            g.addColorStop(0, shade(h.color, 0.65))
            g.addColorStop(0.6, h.color)
            g.addColorStop(1, shade(h.color, -0.3))
            ctx.beginPath()
            ctx.ellipse(base.x, base.y - H, r, ry, 0, 0, TAU)
            ctx.fillStyle = g
            ctx.fill()
            ctx.lineWidth = 3 * dpr
            ctx.strokeStyle = '#ffffff'
            ctx.stroke()
            ctx.beginPath()
            ctx.ellipse(base.x, base.y - H, r * 0.55, ry * 0.55, 0, 0, TAU)
            ctx.strokeStyle = hexA('#ffffff', 0.55)
            ctx.lineWidth = 2 * dpr
            ctx.stroke()
          },
        })
      } else if (h.kind === 'spikes') {
        items.push({
          y: p.y,
          draw: () => {
            const n = 9
            const spikes: { a: number; d: number }[] = [{ a: 0, d: 0 }]
            for (let i = 0; i < n; i++) spikes.push({ a: (i / n) * TAU + T * 0.4, d: 0.62 })
            spikes.sort((u, v) => Math.sin(u.a) * u.d - Math.sin(v.a) * v.d)
            for (const sp of spikes) {
              const x = p.x + Math.cos(sp.a) * p.r * sp.d
              const y = p.y + Math.sin(sp.a) * p.r * sp.d
              const b = project(x, y)
              const tip = project(x, y, p.r * (sp.d ? 0.8 : 1.1))
              const bw = p.r * Z * 0.22
              const g = ctx.createLinearGradient(b.x - bw, 0, b.x + bw, 0)
              g.addColorStop(0, '#5b1a1a')
              g.addColorStop(0.45, '#ffd0c8')
              g.addColorStop(1, '#7a1f1f')
              ctx.fillStyle = g
              ctx.beginPath()
              ctx.moveTo(b.x - bw, b.y)
              ctx.lineTo(tip.x, tip.y)
              ctx.lineTo(b.x + bw, b.y)
              ctx.closePath()
              ctx.fill()
            }
          },
        })
      } else if (h.kind === 'laser') {
        items.push({
          y: h.y,
          draw: () => {
            const mode = laserMode(h, match.time)
            const base = project(h.x, h.y)
            const top = project(h.x, h.y, 30)
            const r = 12 * Z
            ctx.fillStyle = '#2a2030'
            ctx.fillRect(base.x - r * 0.6, top.y, r * 1.2, base.y - top.y)
            ctx.beginPath()
            ctx.ellipse(top.x, top.y, r, r * TILT, 0, 0, TAU)
            ctx.fillStyle = mode === 'hot' ? '#ff4d3a' : mode === 'warn' ? '#ffc14d' : '#4a3a4a'
            ctx.fill()
            ctx.strokeStyle = '#ffc14d'
            ctx.lineWidth = 2 * dpr
            ctx.stroke()
            if (mode === 'hot') {
              const ang = laserAngle(h, match.time)
              const end = project(h.x + Math.cos(ang) * p.r, h.y + Math.sin(ang) * p.r, 18)
              const st = project(h.x, h.y, 18)
              ctx.save()
              ctx.globalCompositeOperation = 'lighter'
              ctx.lineCap = 'round'
              for (const [wd, col] of [[18, 'rgba(255,60,40,0.3)'], [8, 'rgba(255,110,80,0.7)'], [3, '#fff2ea']] as const) {
                ctx.strokeStyle = col
                ctx.lineWidth = (wd + Math.sin(T * 60) * 1.5) * dpr * (Z / 0.7)
                ctx.beginPath()
                ctx.moveTo(st.x, st.y)
                ctx.lineTo(end.x, end.y)
                ctx.stroke()
              }
              ctx.restore()
              if (Math.random() < 0.5) {
                const u = Math.random()
                this.add({ kind: 'spark', x: h.x + Math.cos(ang) * p.r * u, y: h.y + Math.sin(ang) * p.r * u, z: 18, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 200, vz: 150, g: 900, size: 1.6, color: '#ffb199', life: 0.3, drag: 3 })
              }
            }
          },
        })
      }
    }
  }

  private vortex(x: number, y: number, r: number, color: string, T: number): void {
    const ctx = this.ctx
    const ry = r * TILT
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, '#000000')
    g.addColorStop(0.5, 'rgba(30,8,60,0.95)')
    g.addColorStop(1, hexA(color, 0))
    ctx.beginPath()
    ctx.ellipse(x, y, r, ry, 0, 0, TAU)
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = 0; i < 6; i++) {
      const a = -T * 3 + (i * TAU) / 6
      const k = 0.35 + (i % 3) * 0.2
      ctx.strokeStyle = hexA(color, 0.5 + (i % 2) * 0.3)
      ctx.lineWidth = (2 + (i % 2)) * this.dpr
      ctx.beginPath()
      ctx.ellipse(x, y, r * k, ry * k, 0, a, a + 1.6)
      ctx.stroke()
    }
    ctx.restore()
    ctx.beginPath()
    ctx.ellipse(x, y, r * 0.18, ry * 0.18, 0, 0, TAU)
    ctx.fillStyle = '#000'
    ctx.fill()
  }

  /** World-space transform on the floor plane, centred on (x, y). Line widths are in world units. */
  private groundOn(x: number, y: number): void {
    const Z = this.Z
    this.ctx.setTransform(Z, 0, 0, Z * TILT, this.OX + (x - this.camX) * Z, this.OY + (y - this.camY) * Z * TILT)
  }

  // ================================================================ events and zone

  private groundEvents(match: Match, project: Project): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const Z = this.Z
    for (const ev of match.live) {
      const s = project(ev.x, ev.y)
      const r = Math.max(8, ev.r * Z)
      const ry = r * TILT
      ctx.save()
      if ((ev.kind === 'meteor' || ev.kind === 'blast') && !ev.fired) {
        const u = clamp((match.time - ev.born) / Math.max(0.01, ev.dur), 0, 1)
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
        ctx.fillStyle = `rgba(255,77,58,${0.1 + u * 0.22})`
        ctx.fill()
        ctx.setLineDash([8 * dpr, 6 * dpr])
        ctx.lineDashOffset = this.clock * 30
        ctx.strokeStyle = 'rgba(255,193,77,0.95)'
        ctx.lineWidth = 3 * dpr
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, r * u, ry * u, 0, 0, TAU)
        ctx.strokeStyle = 'rgba(255,77,58,0.95)'
        ctx.lineWidth = 4 * dpr
        ctx.stroke()
        // Crosshair.
        ctx.strokeStyle = 'rgba(255,193,77,0.7)'
        ctx.lineWidth = 2 * dpr
        ctx.beginPath()
        ctx.moveTo(s.x - r * 0.25, s.y)
        ctx.lineTo(s.x + r * 0.25, s.y)
        ctx.moveTo(s.x, s.y - ry * 0.25)
        ctx.lineTo(s.x, s.y + ry * 0.25)
        ctx.stroke()
      } else if (ev.kind === 'hole') {
        this.vortex(s.x, s.y, r, '#b388ff', this.clock)
        if (Math.random() < 0.4) {
          const a = Math.random() * TAU
          const d = ev.r * 1.1
          this.add({ kind: 'spark', x: ev.x + Math.cos(a) * d, y: ev.y + Math.sin(a) * d, z: 2, vx: -Math.cos(a + 0.6) * d * 1.6, vy: -Math.sin(a + 0.6) * d * 1.6, size: 1.6, color: '#b388ff', life: 0.6, drag: 1 })
        }
      } else if (ev.kind === 'orb' && !ev.fired) {
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, 14 * Z, 14 * Z * TILT, 0, 0, TAU)
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, ev.r * Z, ev.r * Z * TILT, 0, 0, TAU)
        ctx.strokeStyle = hexA('#ffc14d', 0.4 + Math.sin(this.clock * 6) * 0.2)
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
      }
      ctx.restore()
    }
    for (const well of match.wells) {
      const s = project(well.x, well.y)
      const r = well.r * Z
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r)
      g.addColorStop(0, 'rgba(179,136,255,0.35)')
      g.addColorStop(1, 'rgba(179,136,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, r, r * TILT, 0, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = 'rgba(179,136,255,0.8)'
      ctx.lineWidth = 2.5 * dpr
      for (let i = 0; i < 4; i++) {
        const u = (this.clock * 0.9 + i / 4) % 1
        ctx.globalAlpha = u
        const rr = r * (1 - u) + 4
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, rr, rr * TILT, 0, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private uprightEvents(match: Match, project: Project, items: DrawItem[]): void {
    const ctx = this.ctx
    const Z = this.Z
    for (const ev of match.live) {
      if (ev.kind === 'meteor' && !ev.fired) {
        items.push({
          y: ev.y + 1000,
          draw: () => {
            const u = clamp((match.time - ev.born) / Math.max(0.01, ev.dur), 0, 1)
            const fall = (1 - u) * (1 - u)
            const z = fall * 900
            const x = ev.x + fall * 380
            const s = project(x, ev.y - fall * 120, z)
            const tail = project(x + 260, ev.y - fall * 120 - 90, z + 600)
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createLinearGradient(tail.x, tail.y, s.x, s.y)
            g.addColorStop(0, 'rgba(255,120,60,0)')
            g.addColorStop(1, 'rgba(255,210,140,0.95)')
            ctx.strokeStyle = g
            ctx.lineWidth = 22 * Z
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(tail.x, tail.y)
            ctx.lineTo(s.x, s.y)
            ctx.stroke()
            const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 60 * Z)
            glow.addColorStop(0, 'rgba(255,230,170,0.95)')
            glow.addColorStop(1, 'rgba(255,90,30,0)')
            ctx.fillStyle = glow
            ctx.fillRect(s.x - 60 * Z, s.y - 60 * Z, 120 * Z, 120 * Z)
            ctx.restore()
            ctx.beginPath()
            ctx.arc(s.x, s.y, 16 * Z, 0, TAU)
            ctx.fillStyle = '#3a2420'
            ctx.fill()
            ctx.strokeStyle = '#ffb36b'
            ctx.lineWidth = 3 * this.dpr
            ctx.stroke()
          },
        })
      } else if (ev.kind === 'orb' && !ev.fired) {
        items.push({
          y: ev.y,
          draw: () => {
            const bob = Math.sin(this.clock * 4) * 6
            const s = project(ev.x, ev.y, 34 + bob)
            const r = 12 * Z
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4)
            g.addColorStop(0, 'rgba(255,193,77,0.7)')
            g.addColorStop(1, 'rgba(255,193,77,0)')
            ctx.fillStyle = g
            ctx.fillRect(s.x - r * 4, s.y - r * 4, r * 8, r * 8)
            ctx.restore()
            ctx.save()
            ctx.translate(s.x, s.y)
            const spin = Math.cos(this.clock * 3)
            ctx.scale(Math.max(0.2, Math.abs(spin)), 1)
            ctx.beginPath()
            ctx.moveTo(0, -r * 1.3)
            ctx.lineTo(r, 0)
            ctx.lineTo(0, r * 1.3)
            ctx.lineTo(-r, 0)
            ctx.closePath()
            const gg = ctx.createLinearGradient(-r, -r, r, r)
            gg.addColorStop(0, '#fff6d0')
            gg.addColorStop(0.5, '#ffc14d')
            gg.addColorStop(1, '#c47a00')
            ctx.fillStyle = gg
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2 * this.dpr
            ctx.stroke()
            ctx.restore()
          },
        })
      }
    }
  }

  private zone(match: Match, project: Project): void {
    if (!match.zone) return
    const ctx = this.ctx
    const s = project(match.zone.x, match.zone.y)
    const r = match.zone.r * this.Z
    const ry = r * TILT
    const H = 90 * this.Z
    const owners = match.players.filter((p) => p.alive && Math.hypot(p.x - match.zone!.x, p.y - match.zone!.y) < match.zone!.r)
    const col = owners.length === 1 ? owners[0]!.color : '#ffc14d'
    ctx.save()
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r)
    g.addColorStop(0, hexA(col, 0.06))
    g.addColorStop(1, hexA(col, 0.26))
    ctx.beginPath()
    ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
    ctx.fillStyle = g
    ctx.fill()
    ctx.setLineDash([16 * this.dpr, 10 * this.dpr])
    ctx.lineDashOffset = -this.clock * 40
    ctx.strokeStyle = col
    ctx.lineWidth = 3.5 * this.dpr
    ctx.stroke()
    ctx.setLineDash([])
    // Light curtain rising from the edge.
    ctx.globalCompositeOperation = 'lighter'
    const cg = ctx.createLinearGradient(0, s.y - H, 0, s.y + ry)
    cg.addColorStop(0, hexA(col, 0))
    cg.addColorStop(1, hexA(col, 0.22))
    ctx.fillStyle = cg
    ctx.beginPath()
    ctx.ellipse(s.x, s.y, r, ry, 0, 0, Math.PI)
    ctx.lineTo(s.x - r, s.y - H)
    ctx.ellipse(s.x, s.y - H, r, ry, 0, Math.PI, TAU)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ================================================================ balls

  private fxFor(b: Body): BallFx {
    let fx = this.balls.get(b.id)
    if (!fx) {
      let seed = 0
      for (let i = 0; i < b.id.length; i++) seed = (seed * 31 + b.id.charCodeAt(i)) % 997
      fx = {
        squash: 0, squashV: 0, squashAng: 0, land: 0,
        lookX: 0, lookY: 0.2, hurt: 0, focus: 0, idle: 0,
        ghosts: [], ghostTimer: 0, emberTimer: 0, smokeTimer: 0, zzzTimer: 0,
        drop: 0, dropDelay: 0, lastX: b.x, lastY: b.y, seed: seed / 997, perfect: 0, launch: 0, launchAng: 0,
      }
      this.balls.set(b.id, fx)
    }
    return fx
  }

  private zOf(b: Body): number {
    const fx = this.balls.get(b.id)
    const h = b.falling ? b.fallHeight : b.height
    const drop = fx && fx.drop > 0 ? easeInCubic(fx.drop) * 820 : 0
    return h + drop
  }

  private track(b: Body, dt: number, match: Match, prefs: RenderPrefs): void {
    const fx = this.fxFor(b)
    // Damped spring back to round, like a rubber ball.
    fx.squashV += (-420 * fx.squash - 16 * fx.squashV) * dt
    fx.squash = clamp(fx.squash + fx.squashV * dt, -0.4, 0.4)
    fx.land = Math.max(0, fx.land - dt * 6)
    fx.hurt = Math.max(0, fx.hurt - dt)
    fx.focus = Math.max(0, fx.focus - dt)
    fx.perfect = Math.max(0, fx.perfect - dt)
    fx.launch = b.stun > 0 ? Math.max(fx.launch, 0.2) : Math.max(0, fx.launch - dt * 2.2)
    if (fx.launch > 0 && Math.hypot(b.vx, b.vy) > 60) fx.launchAng = Math.atan2(b.vy, b.vx)
    if (fx.dropDelay > 0) fx.dropDelay -= dt
    else if (fx.drop > 0) {
      fx.drop = Math.max(0, fx.drop - dt / 0.42)
      if (fx.drop === 0) {
        fx.land = 1.6
        fx.squashAng = Math.PI / 2
        fx.squashV -= 6
        this.ring(b.x, b.y, b.color, 60, 0.45, 5)
        if (prefs.fx === 'full') {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU + Math.random() * 0.6
            const sp = 120 + Math.random() * 90
            this.add({ kind: 'puff', x: b.x, y: b.y, z: 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: 6 + Math.random() * 5, color: '#dfe9f5', life: 0.4 + Math.random() * 0.2, drag: 5 })
          }
        }
        if (!match.silent) this.trauma = Math.min(1, this.trauma + 0.05 * prefs.shake)
      }
    }
    const speed = Math.hypot(b.vx, b.vy)
    // Face turns toward travel, settling back to the camera when slow.
    const k = clamp(speed / 320, 0, 1) * 0.95
    const tx = speed > 1 ? (b.vx / speed) * k : 0
    const ty = speed > 1 ? (b.vy / speed) * k * TILT : 0.2
    const ease = 1 - Math.exp(-8 * dt)
    fx.lookX = lerp(fx.lookX, tx, ease)
    fx.lookY = lerp(fx.lookY, speed > 40 ? ty : 0.2, ease)
    fx.idle = speed < 6 && !b.bot ? fx.idle + dt : 0
    if (fx.ghostTimer > 0) {
      fx.ghostTimer -= dt
      fx.ghosts.push({ x: b.x, y: b.y, z: this.zOf(b), life: 0.24 })
    }
    for (const g of fx.ghosts) g.life -= dt
    fx.ghosts = fx.ghosts.filter((g) => g.life > 0)
    if (b.trail === 'trail_ember' && speed > 260) {
      fx.emberTimer -= dt
      if (fx.emberTimer <= 0) {
        fx.emberTimer = 0.03
        const a = Math.atan2(b.vy, b.vx) + Math.PI + (Math.random() - 0.5) * 0.8
        this.add({ kind: 'ember', x: b.x, y: b.y, z: this.zOf(b) + b.radius, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, vz: 40, size: 2 + Math.random() * 2, color: Math.random() < 0.5 ? '#ffc14d' : '#ff6a2a', life: 0.5, drag: 2 })
      }
    }
    if (b.heat > 110 && !b.decoy && prefs.fx === 'full' && !b.falling) {
      fx.smokeTimer -= dt
      if (fx.smokeTimer <= 0) {
        fx.smokeTimer = clamp(0.22 - (b.heat - 110) / 700, 0.05, 0.22)
        this.add({ kind: b.heat > 170 ? 'ember' : 'smoke', x: b.x + (Math.random() - 0.5) * b.radius, y: b.y, z: this.zOf(b) + b.radius * 1.6, vx: (Math.random() - 0.5) * 20, vy: 0, vz: 50 + Math.random() * 40, size: b.heat > 170 ? 2.5 : 6 + Math.random() * 5, color: b.heat > 170 ? '#ff8a3a' : '#9aa2b4', life: 0.8, drag: 1 })
      }
    }
    if (fx.idle > 6 && match.status !== 'countdown') {
      fx.zzzTimer -= dt
      if (fx.zzzTimer <= 0) {
        fx.zzzTimer = 0.9
        this.add({ kind: 'zzz', x: b.x, y: b.y, z: b.radius * 2.2, vx: 14, vz: 30, size: 14, color: '#cfe2ff', life: 1.4, drag: 0.5, text: 'z' })
      }
    }
    fx.lastX = b.x
    fx.lastY = b.y
  }

  private expressionFor(b: Body, fx: BallFx, match: Match): Expression {
    if (match.status === 'celebrate' || match.status === 'finished') {
      if (match.winnerIds.includes(b.id)) return 'happy'
    }
    if (b.emoteTime > 0) return 'happy'
    if (b.stun > 0.03) return 'dizzy'
    if (fx.hurt > 0 || b.hitFlash > 0.55) return 'hurt'
    if (fx.drop > 0.02) return 'scared'
    const outward = b.vx * -b.safetyX + b.vy * -b.safetyY
    if (b.falling || (b.edgeDist < 60 && b.edgeDist > -40 && outward > 60) || b.heat > 160) return 'scared'
    if (fx.idle > 6) return 'sleep'
    if (b.dashTime > 0 || fx.focus > 0 || b.momentum > 0.82 || b.overdriveTime > 0 || b.anchorTime > 0) return 'focus'
    return 'idle'
  }

  private trail(b: Body, project: Project): void {
    const speed = Math.hypot(b.vx, b.vy)
    if (speed < 100 || b.trail === 'trail_none' || b.trail === 'trail_ember') return
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
    const z = this.zOf(b) + b.radius
    const sp = pts.map((p) => project(p.x, p.y, z))
    const a0 = clamp((speed - 100) / 560, 0.1, 0.9)
    const r = b.radius * this.Z
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const kind = b.trail
    const m = sp.length
    if (kind === 'trail_ribbon') {
      for (let i = 1; i < m; i++) {
        const u = i / (m - 1)
        ctx.strokeStyle = hexA(b.color, a0 * u * 0.55)
        ctx.lineWidth = r * 1.8
        ctx.beginPath()
        ctx.moveTo(sp[i - 1]!.x, sp[i - 1]!.y)
        ctx.lineTo(sp[i]!.x, sp[i]!.y)
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
          const px = (-dy / l) * r * 0.6 * side
          const py = (dx / l) * r * 0.6 * side
          const q = sp[i]!
          if (i === 0) ctx.moveTo(q.x + px, q.y + py)
          else ctx.lineTo(q.x + px, q.y + py)
        }
        ctx.strokeStyle = hexA(mixHex(b.color, '#ffffff', 0.4), a0)
        ctx.lineWidth = 2 * this.dpr
        ctx.stroke()
      }
    } else if (kind === 'trail_spark') {
      for (let i = 1; i < m; i++) {
        const q = sp[i]!
        const j = Math.sin(i * 12.9898 + Math.floor(this.clock * 30) * 78.233) * r * 0.9
        const k = Math.cos(i * 4.1414 + Math.floor(this.clock * 30) * 12.3) * r * 0.9
        ctx.strokeStyle = hexA(i % 2 ? '#ffffff' : b.color, a0 * (i / m))
        ctx.lineWidth = 1.8 * this.dpr
        ctx.beginPath()
        ctx.moveTo(q.x, q.y)
        ctx.lineTo(q.x + j, q.y + k)
        ctx.stroke()
      }
    } else if (kind === 'trail_hex') {
      for (let i = 1; i < m; i += 2) {
        const q = sp[i]!
        const u = i / m
        ctx.strokeStyle = hexA(b.color, a0 * u)
        ctx.lineWidth = 1.8 * this.dpr
        ctx.beginPath()
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU + i
          const rr = r * (0.3 + u * 0.45)
          ctx.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr)
        }
        ctx.stroke()
      }
    } else {
      // Comet: tapered, hot at the head.
      for (let i = 1; i < m; i++) {
        const u = i / (m - 1)
        ctx.strokeStyle = hexA(mixHex(b.color, '#ffffff', u * 0.4), a0 * u * 0.9)
        ctx.lineWidth = Math.max(1, r * 1.6 * u)
        ctx.beginPath()
        ctx.moveTo(sp[i - 1]!.x, sp[i - 1]!.y)
        ctx.lineTo(sp[i]!.x, sp[i]!.y)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private ghosts(b: Body, project: Project): void {
    const fx = this.balls.get(b.id)
    if (!fx || fx.ghosts.length === 0) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const g of fx.ghosts) {
      const s = project(g.x, g.y, g.z + b.radius)
      const u = g.life / 0.24
      ctx.globalAlpha = u * 0.32
      ctx.beginPath()
      ctx.arc(s.x, s.y, b.radius * this.Z * (0.7 + u * 0.3), 0, TAU)
      ctx.fillStyle = b.color
      ctx.fill()
    }
    ctx.restore()
  }

  private shadow(b: Body, project: Project, lift: number): void {
    if (b.falling && b.fallHeight < 0) return
    const ctx = this.ctx
    const s = project(b.x, b.y)
    const r = b.radius * this.Z * (b.decoy ? 0.85 : 1)
    const spread = 1 + Math.max(0, lift) / 140
    const a = clamp(0.5 - Math.max(0, lift) / 400, 0.06, 0.5)
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * spread)
    g.addColorStop(0, `rgba(0,0,8,${a})`)
    g.addColorStop(0.7, `rgba(0,0,8,${a * 0.6})`)
    g.addColorStop(1, 'rgba(0,0,8,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(s.x, s.y, r * spread * 1.05, r * spread * TILT * 0.75, 0, 0, TAU)
    ctx.fill()
  }

  /** Floor ring under your ball: speed arc, dash pips and the steer arrow. */
  private localMarker(b: Body, project: Project): void {
    if (b.falling) return
    const ctx = this.ctx
    const s = project(b.x, b.y)
    const r = (b.radius + 9) * this.Z
    const ry = r * TILT
    const dpr = this.dpr
    if (b.teeter > 0 && b.edgeDist < 0) this.homeArrow(b, project)
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(s.x, s.y, r, ry, 0, 0, TAU)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 5 * dpr
    ctx.stroke()
    if (b.momentum > 0.02) {
      const col = mixHex('#3ee6a0', '#ff4d3a', b.momentum)
      ctx.globalCompositeOperation = 'lighter'
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, r, ry, 0, -Math.PI / 2, -Math.PI / 2 + TAU * b.momentum)
      ctx.strokeStyle = col
      ctx.lineWidth = 3.5 * dpr
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }
    const m = Math.hypot(b.input.x, b.input.y)
    if (m > 0.2) {
      const ax = b.input.x / m
      const ay = b.input.y / m
      const ready = b.dashCd <= 0
      const d0 = b.radius + 16
      const tip = project(b.x + ax * (d0 + 16), b.y + ay * (d0 + 16))
      const l = project(b.x + ax * d0 - ay * 9, b.y + ay * d0 + ax * 9)
      const rr = project(b.x + ax * d0 + ay * 9, b.y + ay * d0 - ax * 9)
      const mid = project(b.x + ax * (d0 + 5), b.y + ay * (d0 + 5))
      ctx.beginPath()
      ctx.moveTo(tip.x, tip.y)
      ctx.lineTo(l.x, l.y)
      ctx.lineTo(mid.x, mid.y)
      ctx.lineTo(rr.x, rr.y)
      ctx.closePath()
      ctx.fillStyle = ready ? hexA('#ffffff', 0.85 * m) : hexA('#ffffff', 0.35 * m)
      ctx.fill()
    }
    ctx.restore()
  }

  /** Hanging off the edge: three pulsing chevrons on the floor point the way home. */
  private homeArrow(b: Body, project: Project): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const hx = b.safetyX
    const hy = b.safetyY
    if (hx * hx + hy * hy < 0.25) return
    const held = b.input.x * hx + b.input.y * hy > 0.2
    const col = held ? '#3ee6a0' : '#ffc14d'
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 3; i++) {
      const phase = (this.clock * 3 + i / 3) % 1
      const d = b.radius + 18 + i * 22
      const a = 0.35 + 0.65 * Math.sin(phase * Math.PI)
      const tip = project(b.x + hx * (d + 12), b.y + hy * (d + 12))
      const l = project(b.x + hx * d - hy * 13, b.y + hy * d + hx * 13)
      const rr = project(b.x + hx * d + hy * 13, b.y + hy * d - hx * 13)
      ctx.beginPath()
      ctx.moveTo(l.x, l.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.lineTo(rr.x, rr.y)
      ctx.strokeStyle = hexA(col, a)
      ctx.lineWidth = 5 * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawBall(b: Body, project: Project, prefs: RenderPrefs, match: Match): void {
    const ctx = this.ctx
    const fx = this.fxFor(b)
    if (fx.dropDelay > 0) return
    const z = this.zOf(b)
    let r = b.radius * this.Z
    const p = project(b.x, b.y, z + b.radius)
    // During hitstop the struck ball shudders in place, which sells the freeze.
    const shudder = this.hitstop > 0 && b.id === this.jitterId && !prefs.reducedMotion ? 3 * this.dpr : 0
    const x = p.x + (shudder ? (Math.random() - 0.5) * 2 * shudder : 0)
    const y = p.y + (shudder ? (Math.random() - 0.5) * 2 * shudder : 0)
    let sink = 0
    if (b.falling && b.fallHeight < 0) {
      sink = clamp(-b.fallHeight / 40, 0, 1)
      r *= 1 - sink * 0.25
    }
    ctx.save()
    if (b.phaseTime > 0) ctx.globalAlpha = 0.4 + Math.sin(this.clock * 30) * 0.1
    if (b.decoy) ctx.globalAlpha = 0.75
    if (b.invuln > 0 && !b.decoy && Math.sin(this.clock * 28) > 0.3) ctx.globalAlpha *= 0.65

    // Heat glow behind the ball: warmer and faster as it gets easier to launch.
    if (b.heat > 35 && !b.decoy) {
      const k = clamp((b.heat - 35) / 150, 0, 1)
      const beat = prefs.reducedMotion ? 0.5 : 0.5 + Math.sin(this.clock * (4 + k * 10)) * 0.5
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const R = r + (12 + k * 20) * this.dpr
      const glow = ctx.createRadialGradient(x, y, r * 0.7, x, y, R)
      glow.addColorStop(0, hexA(heatColor(b.heat), (0.25 + k * 0.35) * (0.6 + beat * 0.4)))
      glow.addColorStop(1, hexA(heatColor(b.heat), 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, R, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    if (b.overdriveTime > 0 || fx.perfect > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const R = r * 1.9
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, R)
      glow.addColorStop(0, hexA('#ffc14d', 0.45))
      glow.addColorStop(1, hexA('#ffc14d', 0))
      ctx.fillStyle = glow
      ctx.fillRect(x - R, y - R, R * 2, R * 2)
      ctx.restore()
    }

    ctx.translate(x, y)
    ctx.save()
    const speed = Math.hypot(b.vx, b.vy)
    const stretch = prefs.reducedMotion ? 0 : Math.min(0.24, (speed / SPEED_CAP) * 0.28)
    const va = Math.atan2(b.vy * TILT, b.vx)
    ctx.rotate(va)
    ctx.scale(1 + stretch, 1 / (1 + stretch))
    ctx.rotate(-va)
    if (fx.squash !== 0 && !prefs.reducedMotion) {
      ctx.rotate(fx.squashAng)
      ctx.scale(1 + fx.squash, 1 / (1 + fx.squash))
      ctx.rotate(-fx.squashAng)
    }
    if (fx.land > 0 && !prefs.reducedMotion) {
      const l = Math.sin(Math.min(1, fx.land) * Math.PI) * 0.18
      ctx.translate(0, r * l)
      ctx.scale(1 + l, 1 - l)
    }
    if (fx.drop > 0 && !prefs.reducedMotion) ctx.scale(0.85, 1.2)
    const teetering = b.teeter > 0 && b.edgeDist < 0 && !b.falling && !b.decoy
    if (!prefs.reducedMotion) {
      // A launched ball tumbles; one hanging off the edge wobbles to keep its balance.
      if (b.stun > 0) ctx.rotate((this.clock * 16 + fx.seed * 7) * (b.vx >= 0 ? 1 : -1))
      else if (teetering) ctx.rotate(Math.sin(this.clock * 24 + fx.seed * 5) * 0.28)
    }
    paintBall(ctx, 0, 0, r, {
      color: b.color,
      skin: b.skin,
      pattern: b.pattern,
      colorblind: prefs.colorblind,
      lookX: fx.lookX,
      lookY: fx.lookY,
      expression: b.decoy ? 'idle' : this.expressionFor(b, fx, match),
      blink: blinkAt(this.clock, fx.seed),
      time: this.clock,
      heat: b.heat,
      flash: b.hitFlash > 0.5 ? (b.hitFlash - 0.5) * 2 : 0,
      sink,
      face: !b.decoy,
      dpr: this.dpr,
    })
    ctx.restore()

    if (!b.decoy && !b.falling) this.auras(b, r)
    if (b.stun > 0 && !b.decoy) this.dizzyStars(r, b.stun)
    if (teetering) this.alarm(r)
    ctx.restore()
  }

  /** Little stars circling the head of a stunned ball. */
  private dizzyStars(r: number, stun: number): void {
    const ctx = this.ctx
    const dpr = this.dpr
    ctx.save()
    ctx.globalAlpha = clamp(stun * 6, 0, 1)
    for (let i = 0; i < 3; i++) {
      const a = this.clock * 9 + (i * TAU) / 3
      const x = Math.cos(a) * r * 0.95
      const y = -r * 1.15 + Math.sin(a) * r * 0.28
      const sz = (4 + (Math.sin(a) + 1) * 1.6) * dpr
      ctx.fillStyle = i === 0 ? '#ffe066' : '#ffffff'
      ctx.beginPath()
      for (let k = 0; k < 10; k++) {
        const q = (k / 10) * TAU - Math.PI / 2
        const rr = k % 2 ? sz * 0.42 : sz
        ctx.lineTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr)
      }
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  /** A bobbing "!" over a ball hanging off the edge. */
  private alarm(r: number): void {
    const ctx = this.ctx
    const dpr = this.dpr
    // Off to the upper side, clear of the name tag above the ball.
    const x = r * 0.95 + 6 * dpr
    const y = -r * 0.9 + Math.sin(this.clock * 18) * 2 * dpr
    ctx.save()
    ctx.translate(x, 0)
    ctx.beginPath()
    ctx.arc(0, y, 10 * dpr, 0, TAU)
    ctx.fillStyle = '#ffc14d'
    ctx.fill()
    ctx.lineWidth = 2 * dpr
    ctx.strokeStyle = 'rgba(8,10,24,0.9)'
    ctx.stroke()
    ctx.fillStyle = '#1d1200'
    ctx.font = `${15 * dpr}px ${DISPLAY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', 0, y + 1 * dpr)
    ctx.restore()
  }

  /** A hot white streak behind a launched ball, so a big send reads at a glance. */
  private launchStreak(b: Body, project: Project): void {
    const fx = this.balls.get(b.id)
    if (!fx || fx.launch <= 0.02) return
    const speed = Math.hypot(b.vx, b.vy)
    if (speed < 120) return
    const ctx = this.ctx
    const z = this.zOf(b) + b.radius
    const len = Math.min(260, speed * 0.32) * clamp(fx.launch * 2, 0, 1)
    const head = project(b.x, b.y, z)
    const tail = project(b.x - Math.cos(fx.launchAng) * len, b.y - Math.sin(fx.launchAng) * len, z)
    const r = b.radius * this.Z
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y)
    g.addColorStop(0, hexA('#ffffff', 0.85 * clamp(fx.launch * 2, 0, 1)))
    g.addColorStop(0.35, hexA(b.color, 0.55 * clamp(fx.launch * 2, 0, 1)))
    g.addColorStop(1, hexA(b.color, 0))
    ctx.strokeStyle = g
    ctx.lineCap = 'round'
    ctx.lineWidth = r * 1.7
    ctx.beginPath()
    ctx.moveTo(head.x, head.y)
    ctx.lineTo(tail.x, tail.y)
    ctx.stroke()
    ctx.restore()
  }

  private auras(b: Body, r: number): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const T = this.clock
    ctx.lineCap = 'round'
    if (b.invuln > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r + 10 * dpr)
      g.addColorStop(0, hexA('#7ee0ff', 0))
      g.addColorStop(0.7, hexA('#7ee0ff', 0.35 + Math.sin(T * 12) * 0.15))
      g.addColorStop(1, hexA('#7ee0ff', 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, r + 10 * dpr, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    if (b.overdriveTime > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 6; i++) {
        const a = T * 7 + (i * TAU) / 6
        ctx.beginPath()
        ctx.arc(0, 0, r + 5 * dpr, a, a + 0.5)
        ctx.strokeStyle = hexA('#ffc14d', 0.85)
        ctx.lineWidth = 3 * dpr
        ctx.stroke()
      }
      ctx.restore()
    }
    if (b.anchorTime > 0 || b.mirrorTime > 0) {
      const mirror = b.mirrorTime > 0
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = mirror ? '#7ee0ff' : '#f4f7fb'
      ctx.fillStyle = mirror ? 'rgba(126,224,255,0.12)' : 'rgba(244,247,251,0.1)'
      ctx.lineWidth = 2.5 * dpr
      ctx.beginPath()
      const sides = mirror ? 6 : 4
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * TAU + T * 0.8
        ctx.lineTo(Math.cos(a) * (r + 7 * dpr), Math.sin(a) * (r + 7 * dpr))
      }
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    if (b.magnetTime > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = hexA('#b388ff', 0.7)
      ctx.lineWidth = 2 * dpr
      for (let i = 0; i < 3; i++) {
        const u = (T * 2 + i / 3) % 1
        ctx.globalAlpha = u
        ctx.beginPath()
        ctx.arc(0, 0, r + (1 - u) * 40 * dpr, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }
    if (b.dashCd <= 0 && !b.bot) {
      const a = T * 3
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * (r + 5 * dpr), Math.sin(a) * (r + 5 * dpr), 2.4 * dpr, 0, TAU)
      ctx.fill()
    }
  }

  /** Floor ring in the team colour, so partners read at a glance. */
  private teamRing(b: Body, project: Project, color: string): void {
    const ctx = this.ctx
    const s = project(b.x, b.y)
    const r = b.radius * this.Z * 1.3
    ctx.beginPath()
    ctx.ellipse(s.x, s.y, r, r * TILT, 0, 0, TAU)
    ctx.strokeStyle = hexA(color, 0.9)
    ctx.lineWidth = 3 * this.dpr
    ctx.stroke()
  }

  private heatText(b: Body): string {
    return b.heat >= 1 ? `${Math.floor(b.heat)}%` : ''
  }

  private labelWidth(b: Body, compact = false): number {
    const ctx = this.ctx
    const dpr = this.dpr * this.labelScale
    if (compact) {
      ctx.font = `${16 * dpr}px ${DISPLAY_FONT}`
      return ctx.measureText(this.heatText(b)).width + 18 * dpr
    }
    ctx.font = `600 ${12 * dpr}px ${UI_FONT}`
    let w = ctx.measureText(b.name).width + 16 * dpr
    const heat = this.heatText(b)
    if (heat) {
      ctx.font = `${17 * dpr}px ${DISPLAY_FONT}`
      w += ctx.measureText(heat).width * 2 + 10 * dpr
    }
    return w
  }

  private label(b: Body, x: number, y: number, local: boolean, team = '', compact = false): void {
    const ctx = this.ctx
    const dpr = this.dpr * this.labelScale
    const ty = y
    ctx.save()
    if (compact) {
      // Crowded: just a colour dot and the heat, so you can still read who is launchable.
      const heat = this.heatText(b)
      ctx.globalAlpha = b.falling ? 0.5 : 0.95
      ctx.font = `${16 * dpr}px ${DISPLAY_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(heat).width
      const dx = x - tw / 2 - 2 * dpr
      ctx.beginPath()
      ctx.arc(dx - 3 * dpr, ty, 4 * dpr, 0, TAU)
      ctx.fillStyle = team || b.color
      ctx.fill()
      ctx.lineWidth = 1.5 * dpr
      ctx.strokeStyle = 'rgba(8,10,24,0.9)'
      ctx.stroke()
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4 * dpr
      ctx.strokeText(heat, x + 5 * dpr, ty + 1 * dpr)
      ctx.fillStyle = heatColor(b.heat)
      ctx.fillText(heat, x + 5 * dpr, ty + 1 * dpr)
      ctx.restore()
      return
    }
    ctx.font = `600 ${12 * dpr}px ${UI_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const name = b.name
    const tw = ctx.measureText(name).width
    const pw = tw + 16 * dpr
    const ph = 19 * dpr
    ctx.globalAlpha = b.falling ? 0.5 : 1
    roundRect(ctx, x - pw / 2, ty - ph / 2, pw, ph, ph / 2)
    ctx.fillStyle = local ? b.color : 'rgba(8,10,24,0.78)'
    ctx.fill()
    ctx.strokeStyle = team || (local ? 'rgba(255,255,255,0.9)' : hexA(b.color, 0.8))
    ctx.lineWidth = (team ? 2 : 1.4) * dpr
    ctx.stroke()
    ctx.fillStyle = local ? (isLight(b.color) ? '#0b0f14' : '#ffffff') : '#f4f7fb'
    ctx.fillText(name, x, ty + 0.5 * dpr)
    const heat = this.heatText(b)
    if (heat) {
      // Damage percent beside the name, coloured by how launchable the ball is.
      ctx.font = `${17 * dpr}px ${DISPLAY_FONT}`
      ctx.textAlign = 'left'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4 * dpr
      ctx.strokeStyle = 'rgba(8,10,24,0.95)'
      const hx = x + pw / 2 + 4 * dpr
      ctx.strokeText(heat, hx, ty + 1 * dpr)
      ctx.fillStyle = heatColor(b.heat)
      ctx.fillText(heat, hx, ty + 1 * dpr)
    }
    if (local) {
      const bob = Math.sin(this.clock * 5) * 2.5 * dpr
      const ay = ty - ph / 2 - 6 * dpr + bob
      ctx.beginPath()
      ctx.moveTo(x - 7 * dpr, ay - 8 * dpr)
      ctx.lineTo(x + 7 * dpr, ay - 8 * dpr)
      ctx.lineTo(x, ay)
      ctx.closePath()
      ctx.fillStyle = '#ffc14d'
      ctx.fill()
      ctx.strokeStyle = 'rgba(8,10,24,0.9)'
      ctx.lineWidth = 1.5 * dpr
      ctx.stroke()
    }
    if (b.emoteTime > 0 && b.emoteText) {
      ctx.font = `700 ${13 * dpr}px ${UI_FONT}`
      ctx.textAlign = 'center'
      const ew = ctx.measureText(b.emoteText).width + 18 * dpr
      const ey = ty - ph - 18 * dpr
      const pop = easeOutBack(Math.min(1, (1.6 - b.emoteTime) * 5))
      ctx.globalAlpha = Math.min(1, b.emoteTime * 4)
      ctx.translate(x, ey)
      ctx.scale(pop, pop)
      roundRect(ctx, -ew / 2, -12 * dpr, ew, 24 * dpr, 8 * dpr)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-5 * dpr, 12 * dpr)
      ctx.lineTo(5 * dpr, 12 * dpr)
      ctx.lineTo(0, 18 * dpr)
      ctx.fill()
      ctx.fillStyle = '#16122a'
      ctx.fillText(b.emoteText, 0, 0.5 * dpr)
    }
    ctx.restore()
  }

  // ================================================================ screen

  private screenFx(match: Match, w: number, h: number, dt: number, prefs: RenderPrefs, focus: Body | undefined, localId: string): void {
    const ctx = this.ctx
    const you = match.players.find((p) => p.id === localId)
    // Speed lines when the local ball is near its cap.
    const want = you && you.alive && !prefs.reducedMotion ? clamp((you.momentum - 0.7) / 0.3, 0, 1) : 0
    this.speedLines = lerp(this.speedLines, want, 1 - Math.exp(-6 * dt))
    if (this.speedLines > 0.02 && you) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const a = Math.atan2(you.vy * TILT, you.vx)
      const cx = w / 2
      const cy = h / 2
      const R = Math.hypot(w, h) / 2
      for (let i = 0; i < 30; i++) {
        const seed = Math.floor(this.clock * 20) + i * 7
        const ang = a + Math.PI + (hashN(seed) - 0.5) * 2.6
        const r0 = R * (0.55 + hashN(seed + 3) * 0.3)
        const len = R * (0.12 + hashN(seed + 5) * 0.22)
        ctx.strokeStyle = `rgba(255,255,255,${0.13 * this.speedLines})`
        ctx.lineWidth = (1 + hashN(seed + 9) * 2.5) * this.dpr
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
      // Letterbox bars for the finishing blow.
      const bar = h * 0.09 * env
      ctx.fillStyle = 'rgba(0,0,0,0.92)'
      ctx.fillRect(0, 0, w, bar)
      ctx.fillRect(0, h - bar, w, bar)
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.7)
      g.addColorStop(0, 'rgba(255,40,30,0)')
      g.addColorStop(1, `rgba(255,40,30,${0.35 * env})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * TAU + hashN(i) * 0.2
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
      const pulse = 0.2 + Math.sin(this.clock * 6) * 0.08
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
    const pad = 30 * dpr
    for (const b of match.players) {
      if (!b.alive) continue
      const p = project(b.x, b.y, b.radius)
      if (p.x > 0 && p.x < w && p.y > 0 && p.y < h) continue
      const cx = clamp(p.x, pad, w - pad)
      const cy = clamp(p.y, pad, h - pad)
      const a = Math.atan2(p.y - cy, p.x - cx)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.beginPath()
      ctx.arc(0, 0, 15 * dpr, 0, TAU)
      ctx.fillStyle = 'rgba(8,10,24,0.85)'
      ctx.fill()
      ctx.strokeStyle = b.id === localId ? '#ffc14d' : b.color
      ctx.lineWidth = 2.5 * dpr
      ctx.stroke()
      paintBall(ctx, 0, 0, 9 * dpr, { color: b.color, skin: b.skin, pattern: b.pattern, lookX: Math.cos(a) * 0.6, lookY: Math.sin(a) * 0.6, expression: 'scared', blink: 0, time: this.clock, dpr })
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(22 * dpr, 0)
      ctx.lineTo(15 * dpr, -6 * dpr)
      ctx.lineTo(15 * dpr, 6 * dpr)
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
    const s = Math.min(1.2, Math.min(w, h) / dpr / 720)
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (match.countdownTicks > 0 && match.countdownTicks <= 180) {
      const n = Math.ceil(match.countdownTicks / 60)
      const u = 1 - ((match.countdownTicks - 1) % 60) / 60
      const pop = easeOutBack(clamp(u / 0.3, 0, 1))
      const scale = lerp(2.2, 1, pop) * (u > 0.8 ? lerp(1, 0.8, (u - 0.8) / 0.2) : 1) * s
      const alpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
      ctx.globalAlpha = alpha
      ctx.translate(w / 2, h / 2)
      // Slash behind the digit.
      ctx.save()
      ctx.rotate(-0.12)
      const sw = (300 + u * 200) * dpr * s
      const g = ctx.createLinearGradient(-sw, 0, sw, 0)
      const col = n === 1 ? '255,193,77' : '255,255,255'
      g.addColorStop(0, `rgba(${col},0)`)
      g.addColorStop(0.5, `rgba(${col},${0.25 * (1 - u * 0.6)})`)
      g.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = g
      ctx.fillRect(-sw, -36 * dpr * s, sw * 2, 72 * dpr * s)
      ctx.restore()
      ctx.scale(scale, scale)
      ctx.font = `${150 * dpr}px ${DISPLAY_FONT}`
      ctx.lineJoin = 'round'
      ctx.lineWidth = 16 * dpr
      ctx.strokeStyle = 'rgba(8,10,24,0.92)'
      ctx.strokeText(String(n), 0, 6 * dpr)
      ctx.fillStyle = n === 1 ? '#ffc14d' : '#f4f7fb'
      ctx.fillText(String(n), 0, 0)
    } else if (match.goFlash > 0) {
      const u = 1 - match.goFlash / 0.75
      const pop = easeOutBack(clamp(u / 0.25, 0, 1))
      const scale = (lerp(2.6, 1, pop) + u * 0.3) * s
      ctx.globalAlpha = clamp(match.goFlash * 2.2, 0, 1)
      ctx.beginPath()
      ctx.ellipse(w / 2, h / 2, (60 + u * 700) * dpr, (60 + u * 700) * dpr * TILT, 0, 0, TAU)
      ctx.strokeStyle = `rgba(255,77,58,${0.7 * (1 - u)})`
      ctx.lineWidth = (18 * (1 - u) + 2) * dpr
      ctx.stroke()
      ctx.translate(w / 2, h / 2)
      ctx.rotate(-0.08)
      ctx.scale(scale, scale)
      ctx.font = `${150 * dpr}px ${DISPLAY_FONT}`
      ctx.lineJoin = 'round'
      ctx.lineWidth = 16 * dpr
      ctx.strokeStyle = 'rgba(8,10,24,0.92)'
      ctx.strokeText('GO!', 0, 6 * dpr)
      const g = ctx.createLinearGradient(0, -60 * dpr, 0, 60 * dpr)
      g.addColorStop(0, '#ffb199')
      g.addColorStop(0.5, '#ff4d3a')
      g.addColorStop(1, '#d1203a')
      ctx.fillStyle = g
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

  // ================================================================ particles

  private add(p: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'life'>): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
    this.particles.push({
      z: 0, vx: 0, vy: 0, vz: 0, g: 0, size: 4, color: '#ffffff', text: '', rot: 0, spin: 0, drag: 0,
      ...p,
      max: p.life,
      seed: Math.random(),
    })
  }

  private ring(x: number, y: number, color: string, size: number, life: number, width: number): void {
    this.add({ kind: 'ring', x, y, z: 0, size, color, life, spin: width })
  }

  private popNumber(x: number, y: number, text: string, power: number, owner: string): void {
    // Smash damage colours: white, yellow, red, maroon.
    const color = power < 420 ? '#f4f7fb' : power < 620 ? '#ffc14d' : power < 820 ? '#ff4d3a' : '#ff2d55'
    const size = 16 + Math.min(18, power / 50)
    // A flurry on one ball shows one number that grows, not a pile of overlapping digits.
    const live = owner ? this.particles.find((p) => p.kind === 'text' && p.owner === owner && p.max - p.life < 0.45) : undefined
    if (live) {
      if (Number(text) > Number(live.text)) {
        live.text = text
        live.color = color
        live.size = Math.max(live.size, size)
      }
      live.life = live.max
      live.x = x
      live.y = y
      return
    }
    // Numbers float up from above the name tags so they never sit on top of them.
    this.add({ kind: 'text', x, y, z: 96, vx: (Math.random() - 0.5) * 40, vz: 110, size, color, life: 0.8, drag: 3, rot: (Math.random() - 0.5) * 0.25, text, owner })
  }

  private bolts(x: number, y: number, ang: number, k: number): void {
    for (let i = 0; i < 4; i++) {
      const a = ang + (i - 1.5) * 0.5 + (Math.random() - 0.5) * 0.3
      this.add({ kind: 'bolt', x, y, z: 20, size: 50 + k * 60, color: i % 2 ? '#ff2d2d' : '#16060a', life: 0.16, rot: a })
    }
  }

  private impactStyle(style: string, x: number, y: number, color: string, k: number, full: boolean): void {
    if (style === 'impact_burst' && k > 0.35) {
      this.add({ kind: 'flash', x, y, z: 20, size: 40 + k * 70, color, life: 0.16 })
      this.add({ kind: 'sring', x, y, z: 20, size: 40 + k * 40, color, life: 0.3, spin: 5 })
    } else if (style === 'impact_shatter' && full) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU
        const s = 160 + Math.random() * 280
        this.add({ kind: 'shard', x, y, z: 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 150 + Math.random() * 200, g: 900, size: 5 + Math.random() * 4, color, life: 0.6, drag: 2, rot: a, spin: (Math.random() - 0.5) * 20 })
      }
    } else if (style === 'impact_glyph') {
      this.add({ kind: 'ring', x, y, z: 0, size: 40 + k * 40, color: '#ffc14d', life: 0.5, text: 'glyph', spin: 3 })
    }
  }

  private drawParticles(project: Project, dt: number, prefs: RenderPrefs, layer: 'behind' | 'ground' | 'air'): void {
    const ctx = this.ctx
    const dpr = this.dpr
    const Z = this.Z
    // Only the first pass of the frame advances the simulation.
    if (layer === 'behind' && dt > 0) {
      for (const p of this.particles) {
        p.life -= dt
        if (p.life <= 0) continue
        const damp = Math.exp(-p.drag * dt)
        p.vx *= damp
        p.vy *= damp
        p.vz -= p.g * dt
        if (p.kind === 'confetti') p.vz *= Math.exp(-1.5 * dt)
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
        if ((p.kind === 'spark' || p.kind === 'chunk' || p.kind === 'shard' || p.kind === 'confetti') && p.z < 0 && p.vz < 0) {
          p.z = 0
          p.vz *= -0.35
          p.vx *= 0.6
          p.vy *= 0.6
        }
        p.rot += p.spin * dt
      }
      this.particles = this.particles.filter((p) => p.life > 0)
    }
    ctx.save()
    for (const p of this.particles) {
      const ground = p.kind === 'ring' || p.kind === 'implode' || p.kind === 'scorch' || p.kind === 'puff'
      const want = p.kind === 'faller' ? (p.behind ? 'behind' : 'air') : ground ? 'ground' : 'air'
      if (want !== layer) continue
      const t = clamp(p.life / p.max, 0, 1)
      const u = 1 - t
      ctx.globalAlpha = t
      ctx.globalCompositeOperation = 'source-over'
      if (p.kind === 'ring' || p.kind === 'implode') {
        const grow = p.kind === 'implode' ? 1 - easeOutCubic(u) : easeOutCubic(u)
        const s = project(p.x, p.y)
        const rr = p.size * Z * grow + 2
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, rr, rr * TILT, 0, 0, TAU)
        ctx.strokeStyle = p.color
        ctx.lineWidth = Math.max(0.5, p.spin * t) * dpr
        ctx.stroke()
        if (p.text === 'glyph') {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU + u
            ctx.beginPath()
            ctx.moveTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr * TILT)
            ctx.lineTo(s.x + Math.cos(a) * (rr + 8 * dpr), s.y + Math.sin(a) * (rr + 8 * dpr) * TILT)
            ctx.stroke()
          }
        }
      } else if (p.kind === 'scorch') {
        const s = project(p.x, p.y)
        const rr = p.size * Z
        ctx.globalAlpha = Math.min(1, t * 3) * 0.5
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
        g.addColorStop(0, 'rgba(10,6,8,0.9)')
        g.addColorStop(0.6, 'rgba(20,10,10,0.5)')
        g.addColorStop(1, 'rgba(20,10,10,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, rr, rr * TILT, 0, 0, TAU)
        ctx.fill()
      } else if (p.kind === 'puff') {
        const s = project(p.x, p.y, p.z)
        const rr = p.size * Z * (0.6 + u * 1.5)
        ctx.globalAlpha = t * 0.45
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
        g.addColorStop(0, p.color)
        g.addColorStop(0.5, hexA(p.color, 0.6))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(s.x, s.y, rr, rr * 0.75, 0, 0, TAU)
        ctx.fill()
      } else if (p.kind === 'smoke') {
        const s = project(p.x, p.y, p.z)
        const rr = p.size * Z * (0.6 + u * 1.6)
        ctx.globalAlpha = t * 0.4
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
        g.addColorStop(0, p.color)
        g.addColorStop(1, hexA(p.color.startsWith('#') ? p.color : '#888888', 0))
        ctx.fillStyle = g
        ctx.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2)
      } else if (p.kind === 'spark' || p.kind === 'ember') {
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, p.z)
        const sp = Math.hypot(p.vx, p.vy * TILT - p.vz)
        const len = Math.min(30, sp * 0.032 + 2) * dpr * (Z / 0.6)
        const nx = sp > 0 ? p.vx / sp : 1
        const ny = sp > 0 ? (p.vy * TILT - p.vz) / sp : 0
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size * dpr * t + 0.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(s.x - nx * len, s.y - ny * len)
        ctx.stroke()
      } else if (p.kind === 'flash') {
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, p.z)
        const rr = p.size * Z * (0.6 + u * 0.7)
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr)
        g.addColorStop(0, hexA(p.color, 0.95))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2)
      } else if (p.kind === 'sring') {
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, p.z)
        const rr = p.size * Z * (0.3 + easeOutCubic(u) * 1.1)
        ctx.beginPath()
        ctx.arc(s.x, s.y, rr, 0, TAU)
        ctx.strokeStyle = p.color
        ctx.lineWidth = Math.max(0.5, p.spin * t) * dpr
        ctx.stroke()
      } else if (p.kind === 'confetti' || p.kind === 'shard' || p.kind === 'chunk') {
        const s = project(p.x, p.y, p.z)
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot + p.seed * 6)
        ctx.fillStyle = p.color
        const sz = p.size * dpr * (Z / 0.7)
        if (p.kind === 'confetti') ctx.fillRect(-sz, -sz * 0.5 * Math.abs(Math.sin(this.clock * 8 + p.seed * 9)), sz * 2, sz)
        else if (p.kind === 'chunk') {
          ctx.beginPath()
          ctx.moveTo(-sz, -sz * 0.6)
          ctx.lineTo(sz * 0.8, -sz)
          ctx.lineTo(sz, sz * 0.5)
          ctx.lineTo(-sz * 0.4, sz)
          ctx.closePath()
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,0.4)'
          ctx.lineWidth = dpr
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(-sz, -sz * 0.4)
          ctx.lineTo(sz, 0)
          ctx.lineTo(-sz, sz * 0.4)
          ctx.fill()
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'star') {
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, p.z)
        ctx.translate(s.x, s.y)
        ctx.rotate(this.clock * 4 + p.seed * 6)
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
        const s = project(p.x, p.y, p.z)
        ctx.strokeStyle = p.color
        ctx.lineWidth = (p.color === '#16060a' ? 5 : 3) * dpr
        ctx.lineJoin = 'miter'
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        const len = p.size * Z
        const segs = 4
        for (let i = 1; i <= segs; i++) {
          const d = (i / segs) * len
          const j = (hashN(Math.floor(p.seed * 1000) + i) - 0.5) * len * 0.35
          ctx.lineTo(s.x + Math.cos(p.rot) * d - Math.sin(p.rot) * j, s.y + (Math.sin(p.rot) * d + Math.cos(p.rot) * j) * TILT)
        }
        ctx.stroke()
      } else if (p.kind === 'beam') {
        if (prefs.reducedMotion) continue
        // Smash blast-line column, pointing where the ball flew.
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, 10)
        const len = 1100 * Z * easeOutCubic(clamp(u * 4, 0, 1))
        const wid = 110 * Z * t
        ctx.translate(s.x, s.y)
        ctx.rotate(Math.atan2(Math.sin(p.rot) * TILT, Math.cos(p.rot)))
        const g = ctx.createLinearGradient(0, 0, len, 0)
        g.addColorStop(0, hexA('#ffffff', 0.95 * t))
        g.addColorStop(0.25, hexA(p.color, 0.75 * t))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(-12 * dpr, 0)
        ctx.lineTo(len, -wid)
        ctx.lineTo(len, wid)
        ctx.closePath()
        ctx.fill()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'pillar') {
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y)
        const wid = p.size * Z * (0.4 + t * 0.6)
        const hgt = 900 * Z
        const g = ctx.createLinearGradient(0, s.y - hgt, 0, s.y)
        g.addColorStop(0, hexA(p.color, 0))
        g.addColorStop(1, hexA(p.color, 0.6 * t))
        ctx.fillStyle = g
        ctx.fillRect(s.x - wid / 2, s.y - hgt, wid, hgt)
      } else if (p.kind === 'streak') {
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        if (p.x2 !== undefined && p.y2 !== undefined) {
          const a = project(p.x, p.y, p.z)
          const b = project(p.x2, p.y2, p.z)
          ctx.strokeStyle = hexA(p.color, 0.8 * t)
          ctx.lineWidth = 16 * Z * t
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
          ctx.strokeStyle = hexA('#ffffff', 0.9 * t)
          ctx.lineWidth = 4 * Z * t
          ctx.stroke()
        } else {
          const a = project(p.x, p.y, p.z)
          const b = project(p.x + Math.cos(p.rot) * p.size * (0.4 + u), p.y + Math.sin(p.rot) * p.size * (0.4 + u), p.z)
          const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
          g.addColorStop(0, hexA(p.color, 0.8 * t))
          g.addColorStop(1, hexA(p.color, 0))
          ctx.strokeStyle = g
          ctx.lineWidth = 40 * Z * t
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      } else if (p.kind === 'burst') {
        // Anime speed burst: sharp white spikes radiating from a heavy launch.
        ctx.globalCompositeOperation = 'lighter'
        const s = project(p.x, p.y, p.z)
        const R = p.size * Z * (0.5 + easeOutCubic(u) * 0.8)
        ctx.fillStyle = hexA('#ffffff', 0.9 * t)
        for (let i = 0; i < 14; i++) {
          const a = p.rot + Math.PI + (hashN(i + p.seed * 50) - 0.5) * 2.6
          const len = R * (0.6 + hashN(i * 3 + p.seed * 70) * 0.7)
          const w = (2 + hashN(i * 7) * 4) * dpr
          const r0 = R * 0.25
          ctx.beginPath()
          ctx.moveTo(s.x + Math.cos(a) * r0 - Math.sin(a) * w, s.y + (Math.sin(a) * r0 + Math.cos(a) * w) * TILT)
          ctx.lineTo(s.x + Math.cos(a) * (r0 + len), s.y + Math.sin(a) * (r0 + len) * TILT)
          ctx.lineTo(s.x + Math.cos(a) * r0 + Math.sin(a) * w, s.y + (Math.sin(a) * r0 - Math.cos(a) * w) * TILT)
          ctx.closePath()
          ctx.fill()
        }
      } else if (p.kind === 'edgeflare') {
        ctx.globalCompositeOperation = 'lighter'
        const W = this.canvas.width
        const H = this.canvas.height
        const s = project(p.x, p.y, p.z)
        let dx = Math.cos(p.rot)
        let dy = Math.sin(p.rot) * TILT
        const dl = Math.hypot(dx, dy) || 1
        dx /= dl
        dy /= dl
        // March from the knockout point along its flight until the screen border.
        let k = Infinity
        if (dx > 1e-3) k = Math.min(k, (W - s.x) / dx)
        if (dx < -1e-3) k = Math.min(k, -s.x / dx)
        if (dy > 1e-3) k = Math.min(k, (H - s.y) / dy)
        if (dy < -1e-3) k = Math.min(k, -s.y / dy)
        if (!Number.isFinite(k)) k = 0
        const ex = clamp(s.x + dx * Math.max(0, k), 0, W)
        const ey = clamp(s.y + dy * Math.max(0, k), 0, H)
        const pop = easeOutCubic(clamp(u * 3, 0, 1))
        const R = Math.min(W, H) * 0.32 * p.size * (0.4 + pop * 0.8)
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, R)
        g.addColorStop(0, hexA('#ffffff', 0.95 * t))
        g.addColorStop(0.2, hexA(p.color, 0.8 * t))
        g.addColorStop(1, hexA(p.color, 0))
        ctx.fillStyle = g
        ctx.fillRect(ex - R, ey - R, R * 2, R * 2)
        // Spikes fanning back into the screen.
        ctx.fillStyle = hexA('#ffffff', 0.75 * t)
        const back = Math.atan2(-dy, -dx)
        for (let i = 0; i < 9; i++) {
          const a = back + (hashN(i + p.seed * 40) - 0.5) * 2.2
          const len = R * (0.9 + hashN(i * 5 + p.seed * 9) * 0.9)
          const wd = (3 + hashN(i * 11) * 6) * dpr
          ctx.beginPath()
          ctx.moveTo(ex - Math.sin(a) * wd, ey + Math.cos(a) * wd)
          ctx.lineTo(ex + Math.cos(a) * len, ey + Math.sin(a) * len)
          ctx.lineTo(ex + Math.sin(a) * wd, ey - Math.cos(a) * wd)
          ctx.closePath()
          ctx.fill()
        }
      } else if (p.kind === 'faller' && p.look) {
        const s = project(p.x, p.y, p.z)
        const k = clamp(1 + p.z / 900, 0.15, 1)
        ctx.globalAlpha = Math.min(1, t * 2)
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot)
        paintBall(ctx, 0, 0, p.size * Z * k, { ...p.look, time: this.clock, dpr })
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (p.kind === 'zzz') {
        const s = project(p.x, p.y, p.z)
        ctx.globalAlpha = Math.sin(t * Math.PI)
        ctx.font = `${p.size * dpr * (0.6 + u * 0.6)}px ${DISPLAY_FONT}`
        ctx.textAlign = 'center'
        ctx.fillStyle = p.color
        ctx.fillText(p.text, s.x + Math.sin(u * 6) * 6 * dpr, s.y)
      } else if (p.kind === 'text' || p.kind === 'stamp') {
        const s = project(p.x, p.y, p.z)
        const pop = p.kind === 'stamp' ? easeOutBack(clamp(u / 0.18, 0, 1)) : easeOutBack(clamp(u / 0.15, 0, 1))
        const sc = (p.kind === 'stamp' ? lerp(2.4, 1, pop) : lerp(0.3, 1, pop)) * this.labelScale
        ctx.globalAlpha = clamp(t * 2.5, 0, 1)
        ctx.translate(s.x, s.y)
        ctx.rotate(p.rot)
        ctx.scale(sc, sc)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `${p.size * dpr}px ${DISPLAY_FONT}`
        ctx.lineWidth = Math.max(4, p.size * 0.26) * dpr
        ctx.strokeStyle = 'rgba(8,10,24,0.95)'
        ctx.lineJoin = 'round'
        ctx.strokeText(p.text, 0, p.size * 0.06 * dpr)
        ctx.fillStyle = p.color
        ctx.fillText(p.text, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
    }
    ctx.restore()
  }

  // ================================================================ tiles

  private hexTile(): CanvasPattern | null {
    if (this.hexPattern) return this.hexPattern
    const tile = document.createElement('canvas')
    const s = 60
    tile.width = s
    tile.height = Math.round(s * Math.sqrt(3))
    const g = tile.getContext('2d')
    if (!g) return null
    const r = s / 3
    const hh = tile.height
    const hex = (cx: number, cy: number) => {
      g.beginPath()
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      }
    }
    for (const [cx, cy] of [[0, 0], [s, 0], [s / 2, hh / 2], [0, hh], [s, hh]] as const) {
      hex(cx, cy)
      g.fillStyle = 'rgba(255,255,255,0.025)'
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.lineWidth = 1.2
      g.stroke()
      g.strokeStyle = 'rgba(0,0,0,0.18)'
      g.lineWidth = 1
      g.save()
      g.translate(0.8, 1.2)
      g.stroke()
      g.restore()
    }
    this.hexPattern = this.ctx.createPattern(tile, 'repeat')
    return this.hexPattern
  }

  private lipTile(rim: string): CanvasPattern | null {
    if (this.lipPattern && this.lipKey === rim) return this.lipPattern
    this.lipKey = rim
    const tile = document.createElement('canvas')
    tile.width = 24
    tile.height = 24
    const g = tile.getContext('2d')
    if (!g) return null
    g.strokeStyle = hexA(rim, 0.1)
    g.lineWidth = 5
    g.beginPath()
    g.moveTo(-6, 30)
    g.lineTo(30, -6)
    g.moveTo(-18, 18)
    g.lineTo(18, -18)
    g.moveTo(6, 42)
    g.lineTo(42, 6)
    g.stroke()
    this.lipPattern = this.ctx.createPattern(tile, 'repeat')
    return this.lipPattern
  }

  /** CSS pixel position of a world point. `z` lifts it off the floor. */
  toCss(x: number, y: number, z = 22): { x: number; y: number } {
    return this.css(x, y, z)
  }
}

function teamColor(team: number): string {
  return TEAM_COLORS[team % TEAM_COLORS.length] ?? '#ffffff'
}

function polyRadius(pose: Pose): number {
  let m = 0
  for (const p of pose.points) m = Math.max(m, Math.hypot(p.x - pose.x, p.y - pose.y))
  return m || 300
}

function isLight(hex: string): boolean {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 150
}
