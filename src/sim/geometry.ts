import { hypot } from '../core/math'
import type { SolidDef, WallDef } from '../data/content'
import type { SurfaceKind } from '../core/types'

export interface Shrink {
  cut: number
  innerGrow: number
}

export interface Pose {
  id: string
  shape: SolidDef['shape']
  x: number
  y: number
  r: number
  inner: number
  points: { x: number; y: number }[]
  surface: SurfaceKind
  active: boolean
  warn: boolean
  primary: boolean
  shrinkable: boolean
  def: SolidDef
}

export interface Support {
  supported: boolean
  pose: Pose | null
  surface: SurfaceKind
  edgeDist: number
  safetyX: number
  safetyY: number
  carryX: number
  carryY: number
}

const NONE: Support = {
  supported: false,
  pose: null,
  surface: 'normal',
  edgeDist: -999,
  safetyX: 0,
  safetyY: -1,
  carryX: 0,
  carryY: 0,
}

export function solidPose(solid: SolidDef, time: number, shrink: Shrink): Pose {
  let x = solid.x
  let y = solid.y
  let r = solid.r
  let inner = solid.inner
  let points = solid.points
  if (solid.orbit) {
    const a = solid.orbit.phase + time * solid.orbit.speed
    x = solid.orbit.cx + Math.cos(a) * solid.orbit.arm
    y = solid.orbit.cy + Math.sin(a) * solid.orbit.arm
  }
  if (solid.shrinkable) {
    r = Math.max(36, r - shrink.cut)
    inner = Math.min(Math.max(0, r - 48), inner + shrink.innerGrow)
  }
  if (solid.shape === 'poly' && shrink.cut > 0 && solid.shrinkable) {
    const c = centroid(points)
    const scale = Math.max(0.35, 1 - shrink.cut / 520)
    points = points.map((p) => ({
      x: c.x + (p.x - c.x) * scale,
      y: c.y + (p.y - c.y) * scale,
    }))
  }
  const toggle = solid.toggle
  let active = true
  let warn = false
  if (toggle) {
    const u = ((time % toggle.period) + toggle.period) % toggle.period / toggle.period
    active = u < toggle.duty
    const warnStart = toggle.duty - toggle.warn / toggle.period
    warn = u >= warnStart && u < toggle.duty
  }
  return {
    id: solid.id,
    shape: solid.shape,
    x,
    y,
    r,
    inner,
    points,
    surface: solid.surface,
    active,
    warn,
    primary: solid.primary,
    shrinkable: solid.shrinkable,
    def: solid,
  }
}

export function supportAt(solids: SolidDef[], x: number, y: number, time: number, shrink: Shrink, dt: number): Support {
  let best: Support | null = null
  for (const solid of solids) {
    const pose = solidPose(solid, time, shrink)
    if (!pose.active) continue
    const info = insidePose(pose, x, y)
    if (!info.inside && info.edgeDist < -18) continue
    const prev = solidPose(solid, time - dt, shrink)
    const carryX = pose.x - prev.x
    const carryY = pose.y - prev.y
    const candidate: Support = {
      supported: info.inside,
      pose,
      surface: pose.surface,
      edgeDist: info.edgeDist,
      safetyX: info.safetyX,
      safetyY: info.safetyY,
      carryX,
      carryY,
    }
    if (!best || candidate.edgeDist > best.edgeDist) best = candidate
  }
  return best ?? NONE
}

function insidePose(pose: Pose, x: number, y: number): { inside: boolean; edgeDist: number; safetyX: number; safetyY: number } {
  if (pose.shape === 'circle' || pose.shape === 'ring') {
    const dx = x - pose.x
    const dy = y - pose.y
    const d = Math.hypot(dx, dy)
    const nx = d > 1 ? dx / d : 1
    const ny = d > 1 ? dy / d : 0
    if (pose.shape === 'circle') {
      const edgeDist = pose.r - d
      return { inside: edgeDist >= 0, edgeDist, safetyX: -nx, safetyY: -ny }
    }
    const outer = pose.r - d
    const inner = d - pose.inner
    const edgeDist = Math.min(outer, inner)
    if (inner < outer) return { inside: edgeDist >= 0, edgeDist, safetyX: nx, safetyY: ny }
    return { inside: edgeDist >= 0, edgeDist, safetyX: -nx, safetyY: -ny }
  }
  const c = centroid(pose.points)
  const inside = pointInPoly(x, y, pose.points)
  let best = Infinity
  let sx = 0
  let sy = 0
  const pts = pose.points
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    const hit = distToSegment(x, y, a.x, a.y, b.x, b.y)
    if (hit.dist < best) {
      best = hit.dist
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const inward = normAway(c.x - mx, c.y - my)
      sx = inward.x
      sy = inward.y
    }
  }
  return {
    inside,
    edgeDist: inside ? best : -best,
    safetyX: sx || 0,
    safetyY: sy || -1,
  }
}

export function pointInPoly(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i]!
    const pj = pts[j]!
    const intersect = pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y + 1e-9) + pi.x
    if (intersect) inside = !inside
  }
  return inside
}

export function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { dist: number; nx: number; ny: number; qx: number; qy: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 < 1e-8 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = x1 + dx * t
  const qy = y1 + dy * t
  const nx = px - qx
  const ny = py - qy
  const dist = Math.hypot(nx, ny)
  return { dist, nx, ny, qx, qy }
}

function normAway(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y)
  if (l < 1e-6) return { x: 0, y: -1 }
  return { x: x / l, y: y / l }
}

export interface WallHit {
  x1: number
  y1: number
  x2: number
  y2: number
  restitution: number
  lethal: boolean
}

export function wallSegments(walls: WallDef[], time: number): WallHit[] {
  return walls.map((w) => {
    if (!w.spin) {
      return { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, restitution: w.restitution, lethal: w.lethal }
    }
    const c = Math.cos(time * w.spin)
    const s = Math.sin(time * w.spin)
    const rot = (x: number, y: number) => ({ x: x * c - y * s, y: x * s + y * c })
    const a = rot(w.x1, w.y1)
    const b = rot(w.x2, w.y2)
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, restitution: w.restitution, lethal: w.lethal }
  })
}

export function resolveCircleWall(
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  wall: WallHit,
): { x: number; y: number; vx: number; vy: number; hit: boolean; nx: number; ny: number; speedIn: number } {
  const hit = distToSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2)
  if (hit.dist >= radius || hit.dist < 1e-6) {
    return { x, y, vx, vy, hit: false, nx: 0, ny: 0, speedIn: 0 }
  }
  const nx = hit.nx / hit.dist
  const ny = hit.ny / hit.dist
  const pen = radius - hit.dist
  x += nx * pen
  y += ny * pen
  const vn = vx * nx + vy * ny
  if (vn < 0) {
    const e = wall.restitution
    vx -= (1 + e) * vn * nx
    vy -= (1 + e) * vn * ny
    return { x, y, vx, vy, hit: true, nx, ny, speedIn: -vn }
  }
  return { x, y, vx, vy, hit: true, nx, ny, speedIn: 0 }
}

export function circleHitsCircle(x: number, y: number, r: number, cx: number, cy: number, cr: number): boolean {
  return hypot(x - cx, y - cy) <= r + cr
}

export function circleHitsRect(x: number, y: number, r: number, cx: number, cy: number, w: number, h: number): boolean {
  const dx = Math.abs(x - cx)
  const dy = Math.abs(y - cy)
  if (dx > w / 2 + r || dy > h / 2 + r) return false
  if (dx <= w / 2 || dy <= h / 2) return true
  const ex = dx - w / 2
  const ey = dy - h / 2
  return ex * ex + ey * ey <= r * r
}
