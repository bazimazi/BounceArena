import { Rng, clamp, hypot, metersFromPx } from '../core/math'
import {
  DT,
  SPEED_CAP,
  ZERO_INPUT,
  sanitizeInput,
  type FxEvent,
  type InputFrame,
  type LiveScript,
  type MatchConfig,
  type MatchResult,
  type Moment,
  type Placement,
  type ScriptEvent,
} from '../core/types'
import { TUNE } from '../data/tuning'
import { arenaById, type ArenaDef, type HazardDef } from '../data/content'
import { createBody, seedPhase, type Body } from './body'
import { resolveCircleWall, supportAt, wallSegments, type Shrink } from './geometry'
import { resolvePair, capSpeed, type ImpactBody } from './impact'
import { applyMotion, type MotionMods } from './motion'
import {
  applyEnvironment,
  blankMods,
  explosiveHot,
  hazardContact,
  hazardPose,
  laserMode,
  magnetNudge,
} from './hazards'
import { castAbility, decayWells, sustainForces, type Well } from './abilities'
import { thinkBot, type BotEvent } from './bot'

export interface Banner {
  text: string
  sub: string
  life: number
  priority: number
}

export interface FeedItem {
  text: string
  color: string
  life: number
}

const EMOTE: Record<string, string> = {
  emote_nice: 'Nice hit',
  emote_again: 'Again!',
  emote_close: 'Close...',
  emote_watch: 'Watch this',
}

export class Match {
  readonly config: MatchConfig
  readonly arena: ArenaDef
  readonly players: Body[]
  bodies: Body[]
  playTick = 0
  time = 0
  status: 'countdown' | 'playing' | 'sudden' | 'celebrate' | 'finished' = 'countdown'
  countdownTicks = 180
  goFlash = 0
  celebrate = 0
  suddenLeft = 0
  finalPhase = false
  finalAt = 0
  lowG = 0
  shrink: Shrink = { cut: 0, innerGrow: 0 }
  zone: { x: number; y: number; r: number } | null = null
  zoneNext: { x: number; y: number } | null = null
  zoneMoved = false
  wells: Well[] = []
  live: LiveScript[] = []
  extras: HazardDef[] = []
  laserSpawned = false
  banner: Banner | null = null
  feed: FeedItem[] = []
  moments: Moment[] = []
  fx: FxEvent[] = []
  winnerIds: string[] = []
  forfeitId = ''
  markedMid = false
  inputLog: InputFrame[][] = []
  replayMode = false
  silent = false
  private script: ScriptEvent[]
  private scriptCursor = 0
  private readonly record: boolean

  constructor(config: MatchConfig) {
    this.config = config
    this.arena = arenaById(config.arenaId)
    this.record = config.recordReplay
    this.players = config.players.map((p) => createBody(p, config.stocks, config.competitive))
    this.players.forEach((p, i) => seedPhase(p, config.seed + i * 17))
    this.bodies = [...this.players]
    this.placeInitial()
    const rng = new Rng(config.seed)
    this.script = buildScript(this.arena, config.events, rng, config.duration)
    this.finalAt = config.duration > 0 ? Math.max(10, config.duration - TUNE.finalLead) : 1e9
    if (config.zone) {
      this.zone = { x: 0, y: 0, r: 116 }
      const a = rng.next() * Math.PI * 2
      this.zoneNext = { x: Math.cos(a) * 150, y: Math.sin(a) * 150 }
    }
  }

  consumeFx(): FxEvent[] {
    const out = this.fx
    this.fx = []
    return out
  }

  step(live: Record<string, Partial<InputFrame>> = {}): void {
    this.decayPresentation(DT)
    if (this.status === 'finished') return
    if (this.status === 'celebrate') {
      this.celebrate -= DT
      if (this.celebrate <= 0) this.status = 'finished'
      return
    }
    if (this.countdownTicks > 0) {
      this.countdownTicks -= 1
      for (const b of this.players) this.animateIdle(b, DT)
      if (this.countdownTicks === 0) {
        this.status = 'playing'
        this.goFlash = 0.75
        this.announce('GO', 'Speed is power', 2)
      }
      return
    }

    this.time = this.playTick * DT
    this.shrink = this.computeShrink()
    this.refreshSupport()

    if (this.replayMode) {
      const frame = this.inputLog[this.playTick] ?? []
      this.players.forEach((p, i) => {
        p.input = frame[i] ? { ...frame[i] } : { ...ZERO_INPUT }
      })
    } else {
      for (const p of this.players) {
        if (p.bot || p.auto) continue
        p.input = sanitizeInput(live[p.id])
      }
      const sense = this.botSense()
      for (const p of this.players) {
        if (p.bot || p.auto) thinkBot(p, sense)
      }
      if (this.record) this.inputLog.push(this.players.map((p) => ({ ...p.input })))
    }

    for (const b of this.bodies) {
      if (b.decoy) b.input = { ...ZERO_INPUT }
      this.command(b)
    }

    this.wells = decayWells(this.wells, DT)
    sustainForces(this.bodies, this.wells, DT, this.time)
    magnetNudge(this.bodies, DT)

    const hdt = DT / TUNE.substeps
    for (let s = 0; s < TUNE.substeps; s++) this.substep(hdt)

    for (const b of this.bodies) this.afterMove(b, DT)
    this.hazardsAndEvents(DT)
    this.rules(DT)
    this.bodies = this.bodies.filter((b) => !b.remove)

    for (const b of this.bodies) this.guard(b)
    this.playTick += 1
  }

  forfeit(id: string): void {
    if (this.status === 'finished' || this.status === 'celebrate') return
    this.forfeitId = id
    this.finishByRanking('forfeit')
  }

  /** End a practice or tutorial match and rank whoever is ahead. */
  endNow(): void {
    if (this.status === 'finished' || this.status === 'celebrate') return
    this.finishByRanking('time')
  }

  toResult(youId: string): MatchResult {
    return {
      matchId: this.config.matchId,
      seed: this.config.seed,
      modeId: this.config.modeId,
      arenaId: this.config.arenaId,
      competitive: this.config.competitive,
      duration: this.config.duration,
      time: this.time,
      forfeit: this.forfeitId !== '',
      youId,
      placements: this.players.map((p) => toPlacement(p, this.winnerIds)),
      moments: [...this.moments].sort((a, b) => b.importance - a.importance).slice(0, 8),
      replayHumans: this.inputLog,
      humanIds: this.players.map((p) => p.id),
    }
  }

  private placeInitial(): void {
    const spots = this.arena.spawns
    this.players.forEach((p, i) => {
      const s = spots[i % spots.length] ?? { x: 0, y: 0 }
      const turn = Math.floor(i / spots.length)
      p.x = s.x + turn * 28
      p.y = s.y + turn * 12
      p.prevX = p.x
      p.prevY = p.y
    })
  }

  private animateIdle(b: Body, dt: number): void {
    b.prevX = b.x
    b.prevY = b.y
    b.phase += (dt * Math.PI * 2) / b.period
    b.height = Math.abs(Math.sin(b.phase)) * b.bounceAmp
    this.pushHist(b)
  }

  private command(b: Body): void {
    if (!b.alive || b.decoy) {
      if (b.decoy) {
        b.decoyLife -= DT
        if (b.decoyLife <= 0) b.remove = true
      }
      return
    }
    const dashEdge = b.input.dash && !b.prevDash
    const abilityEdge = b.input.ability && !b.prevAbility
    const emoteEdge = b.input.emote && !b.prevEmote
    b.prevDash = b.input.dash
    b.prevAbility = b.input.ability
    b.prevEmote = b.input.emote
    if (dashEdge) this.doDash(b)
    if (abilityEdge) {
      const hits = castAbility(b, {
        bodies: this.bodies,
        time: this.time,
        onSolid: (x, y) => supportAt(this.arena.solids, x, y, this.time, this.shrink, DT).edgeDist >= -4,
        addWell: (w) => this.wells.push(w),
        addDecoy: (d) => {
          const existing = this.bodies.find((o) => o.decoy && o.ownerId === b.id)
          if (existing) existing.remove = true
          this.bodies.push(d)
        },
      })
      this.pushFx({ type: 'ability', x: b.x, y: b.y, power: hits, color: b.color, actorId: b.id, victimId: '', text: b.ability })
    }
    if (emoteEdge && b.emoteCd <= 0) {
      b.emoteText = EMOTE[b.emote] ?? '...'
      b.emoteTime = 1.6
      b.emoteCd = 3
    }
  }

  private doDash(b: Body): void {
    if (b.dashCd > 0 || b.anchorTime > 0) return
    let dx = b.input.x
    let dy = b.input.y
    let mag = hypot(dx, dy)
    if (mag < 0.18) {
      dx = b.vx
      dy = b.vy
      mag = hypot(dx, dy)
    }
    if (mag < 0.18) {
      dx = b.safetyX || 1
      dy = b.safetyY || 0
      mag = hypot(dx, dy) || 1
    }
    dx /= mag
    dy /= mag
    const dashSpeed = TUNE.dashSpeed * b.dashMul * (b.overdriveTime > 0 ? 1.08 : 1)
    b.vx = b.vx * TUNE.dashBlend + dx * dashSpeed
    b.vy = b.vy * TUNE.dashBlend + dy * dashSpeed
    b.dashTime = TUNE.dashWindow
    b.dashCd = b.dashCdMax
    b.stats.dashes += 1
    if (b.sinceLand < TUNE.perfectDashWindow && b.supported && !b.falling) {
      b.perfectFlash = 0.28
      b.dashCd = Math.max(0, b.dashCd - TUNE.perfectDashRefund)
      b.vx *= TUNE.perfectDashBoost
      b.vy *= TUNE.perfectDashBoost
      b.stats.perfectDashes += 1
    }
    capSpeed(b, SPEED_CAP)
    b.anchorTime = 0
    this.pushFx({ type: 'dash', x: b.x, y: b.y, power: dashSpeed, color: b.color, actorId: b.id, victimId: '', text: '' })
  }

  private substep(dt: number): void {
    const walls = wallSegments(this.arena.walls, this.time)
    for (const b of this.bodies) {
      if (!b.alive) continue
      b.dashCd = Math.max(0, b.dashCd - dt)
      b.abilityCd = Math.max(0, b.abilityCd - dt)
      b.dashTime = Math.max(0, b.dashTime - dt)
      b.phaseTime = Math.max(0, b.phaseTime - dt)
      b.anchorTime = Math.max(0, b.anchorTime - dt)
      b.overdriveTime = Math.max(0, b.overdriveTime - dt)
      b.mirrorTime = Math.max(0, b.mirrorTime - dt)
      b.magnetTime = Math.max(0, b.magnetTime - dt)
      b.invuln = Math.max(0, b.invuln - dt)
      b.secondWind = Math.max(0, b.secondWind - dt)
      b.secondWindCd = Math.max(0, b.secondWindCd - dt)
      b.reactiveCd = Math.max(0, b.reactiveCd - dt)

      const mods = this.modsFor(b)
      mods.braking = b.input.brake && b.anchorTime <= 0
      mods.falling = b.falling
      if (b.secondWind > 0) mods.accelMul *= 1.25
      if (b.dashTime > 0) {
        mods.maxMul = Math.max(mods.maxMul, (TUNE.dashSpeed * b.dashMul * 1.12) / Math.max(1, b.maxSpeed))
      }
      if (b.sinceLand < 0.2) mods.maxMul = Math.max(mods.maxMul, 1.14)
      if (!b.decoy) applyMotion(b, b.input.x, b.input.y, dt, mods)
      b.x += b.vx * dt
      b.y += b.vy * dt
      this.skimRim(b)

      for (const wall of walls) {
        const hit = resolveCircleWall(b.x, b.y, b.vx, b.vy, b.radius, wall)
        if (!hit.hit) continue
        b.x = hit.x
        b.y = hit.y
        b.vx = hit.vx
        b.vy = hit.vy
        if (hit.speedIn > 80) {
          const steer = b.input.x * hit.nx + b.input.y * hit.ny
          if (steer > 0.28) {
            const boost = b.core === 'elastic' ? 1.1 : 1.055
            b.vx *= boost
            b.vy *= boost
            b.stats.wallKicks += 1
            this.pushFx({ type: 'wall', x: b.x, y: b.y, power: hit.speedIn, color: b.color, actorId: b.id, victimId: '', text: '' })
          } else if (steer < -0.4) {
            b.vx *= 0.9
            b.vy *= 0.9
          }
          if (b.dashTime > 0) b.dashTime = Math.max(b.dashTime, 0.08)
          capSpeed(b)
        }
      }
    }

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.bodies.length; i++) {
        for (let j = i + 1; j < this.bodies.length; j++) {
          const a = this.bodies[i]!
          const b = this.bodies[j]!
          if (!a.alive || !b.alive) continue
          this.collide(a, b)
        }
      }
    }
  }

  /** Slow outward drift skates the lip. A dash or a fresh hit punches through. */
  private skimRim(b: Body): void {
    if (!b.alive || b.decoy || !b.supported || b.falling || b.dashTime > 0) return
    if (b.lastHitTime > 0 && this.time - b.lastHitTime < 0.75) return
    const lip = 52
    if (b.edgeDist >= lip || b.edgeDist < 0) return
    const ox = -b.safetyX
    const oy = -b.safetyY
    if (ox * ox + oy * oy < 0.25) return
    const outward = b.vx * ox + b.vy * oy
    const depth = 1 - b.edgeDist / lip
    if (outward > 0) {
      const cut = outward * (0.45 + depth * 0.5)
      b.vx -= ox * cut
      b.vy -= oy * cut
    }
    const tx = -oy
    const ty = ox
    const tangent = b.vx * tx + b.vy * ty
    b.vx -= tx * tangent * depth * 0.12
    b.vy -= ty * tangent * depth * 0.12
    b.vx += b.safetyX * 90 * depth
    b.vy += b.safetyY * 90 * depth
    capSpeed(b)
  }

  private collide(a: Body, b: Body): void {
    const outcome = resolvePair(asImpact(a), asImpact(b), this.config.teams)
    if (outcome.kind === 'none' || outcome.kind === 'phase') return
    if (outcome.power < 40 && outcome.kind === 'separate') return
    const attacker = outcome.attacker === 0 ? a : outcome.attacker === 1 ? b : null
    const victim = outcome.attacker === 0 ? b : outcome.attacker === 1 ? a : null
    if (attacker && victim && outcome.power > 30) this.noteHit(attacker, victim, outcome.power, outcome.kind)
    if (outcome.popA && a.decoy) a.remove = true
    if (outcome.popB && b.decoy) b.remove = true
    if (outcome.power > 120) {
      this.pushFx({
        type: 'hit',
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        power: outcome.power,
        color: (attacker ?? a).color,
        actorId: attacker?.decoy ? attacker.ownerId : attacker?.id ?? '',
        victimId: victim?.id ?? '',
        text: outcome.power > 280 ? String(Math.round(outcome.power)) : '',
      })
    }
  }

  private noteHit(attacker: Body, victim: Body, power: number, kind: string): void {
    const owner = attacker.decoy ? this.players.find((p) => p.id === attacker.ownerId) ?? attacker : attacker
    if (victim.decoy || victim.invuln > 0) return
    victim.hitFlash = 1
    attacker.hitFlash = Math.max(attacker.hitFlash, 0.6)
    victim.lastAttacker = owner.id
    victim.lastHitTime = this.time
    victim.lastHitDash = attacker.dashTime > 0 || owner.dashTime > 0
    victim.lastHitHazard = false
    owner.stats.damage += power
    owner.stats.hits += 1
    victim.stats.damageTaken += power
    if (power > owner.stats.bestImpact) owner.stats.bestImpact = power
    if (this.config.modeId === 'score') owner.stats.score += power * 0.05
    if (victim.lastHitDash) {
      owner.stats.dashHits += 1
      if (owner.passive === 'dash-refund') owner.dashCd = Math.max(0, owner.dashCd - 0.65)
    }
    if (power > 240) this.trackLaunch(victim, owner.id)
    if (power > 520) {
      this.moment(owner.id, 'mega', 'MEGA IMPACT', `Launched ${victim.name} at ${Math.round(power)} force`, 3)
    }
    if (victim.passive === 'second-wind' && power > 260 && victim.secondWindCd <= 0) {
      victim.secondWind = 0.8
      victim.secondWindCd = 4
      const sp = hypot(victim.vx, victim.vy) || 1
      victim.vx += (victim.vx / sp) * 80
      victim.vy += (victim.vy / sp) * 80
    }
    if (victim.reactive && victim.reactiveCd <= 0 && power > 180 && kind === 'strike') {
      victim.reactiveCd = 2.3
      for (const o of this.bodies) {
        if (o === victim || !o.alive || o.invuln > 0) continue
        const d = hypot(o.x - victim.x, o.y - victim.y)
        if (d > 110 || d < 1) continue
        o.vx += ((o.x - victim.x) / d) * 220
        o.vy += ((o.y - victim.y) / d) * 220
        capSpeed(o)
        o.lastAttacker = victim.id
        o.lastHitTime = this.time
      }
      this.pushFx({ type: 'boom', x: victim.x, y: victim.y, power: 200, color: victim.color, actorId: victim.id, victimId: '', text: '' })
    }
  }

  private trackLaunch(victim: Body, attackerId: string): void {
    victim.launching = true
    victim.launchFromX = victim.x
    victim.launchFromY = victim.y
    victim.launchT = 0
    victim.launchAttacker = attackerId
  }

  private modsFor(b: Body): MotionMods {
    const mods = blankMods(b.edgeDist)
    const hazards = this.allHazards()
    applyEnvironment(mods, hazards, b, this.time, this.lowG)
    if (b.surface === 'launch') mods.rubber = true
    return mods
  }

  private refreshSupport(): void {
    for (const b of this.bodies) {
      if (!b.alive) continue
      const sup = supportAt(this.arena.solids, b.x, b.y, this.time, this.shrink, DT)
      b.edgeDist = sup.edgeDist
      b.safetyX = sup.safetyX
      b.safetyY = sup.safetyY
      if (sup.pose) b.surface = sup.surface
      const on = sup.edgeDist >= -8
      if (on) {
        b.coyote = b.passive === 'glider' ? TUNE.coyote + 0.05 : TUNE.coyote
        b.supported = true
        if (sup.pose?.def.orbit) {
          b.x += sup.carryX
          b.y += sup.carryY
          b.inheritVx = sup.carryX / DT
          b.inheritVy = sup.carryY / DT
        }
      } else if (b.coyote > 0) {
        b.coyote -= DT
        b.supported = b.coyote > 0
      } else {
        b.supported = false
      }
    }
  }

  private afterMove(b: Body, dt: number): void {
    if (!b.alive) return
    b.sinceLand += dt
    b.emoteCd = Math.max(0, b.emoteCd - dt)
    b.emoteTime = Math.max(0, b.emoteTime - dt)
    b.hitFlash = Math.max(0, b.hitFlash - dt * 4)
    b.perfectFlash = Math.max(0, b.perfectFlash - dt)
    if (b.alive && !b.decoy && !b.falling) {
      b.stats.survival += dt
      b.stats.lifeTime += dt
      b.stats.longestLife = Math.max(b.stats.longestLife, b.stats.lifeTime)
    }
    const speed = hypot(b.vx, b.vy)
    if (speed > b.stats.maxSpeed) b.stats.maxSpeed = speed
    if (b.momentum > b.stats.maxMomentum) b.stats.maxMomentum = b.momentum

    if (b.launching) {
      b.launchT += dt
      const traveled = hypot(b.x - b.launchFromX, b.y - b.launchFromY)
      if (speed < 190 || b.launchT > 1.35 || !b.alive) {
        const meters = metersFromPx(traveled)
        const owner = this.players.find((p) => p.id === b.launchAttacker)
        if (owner && meters > owner.stats.bestLaunchM) owner.stats.bestLaunchM = meters
        if (owner && meters >= 8) {
          this.moment(owner.id, 'launch', 'LONG SEND', `${b.name} traveled ${meters.toFixed(1)} m`, meters > 12 ? 4 : 2)
        }
        b.launching = false
      }
    }

    const mods = this.modsFor(b)
    if (b.supported && !b.falling) {
      b.phase += (dt * Math.PI * 2) / b.period
      const h = Math.abs(Math.sin(b.phase)) * b.bounceAmp * mods.ampMul
      if (!b.grounded && h < 3.2) {
        b.grounded = true
        b.sinceLand = 0
        const inputMag = hypot(b.input.x, b.input.y)
        if (inputMag > 0.2 && b.anchorTime <= 0) {
          const burst = TUNE.landingBurst * b.landMul * (mods.rubber || b.surface === 'rubber' ? 1.12 : 1)
          b.vx += (b.input.x / inputMag) * burst
          b.vy += (b.input.y / inputMag) * burst
          capSpeed(b)
        }
        this.pushFx({ type: 'land', x: b.x, y: b.y, power: 1, color: b.color, actorId: b.id, victimId: '', text: '' })
      } else if (h > 9) b.grounded = false
      b.height = h
      if (b.wasSupported === false) {
        if (b.deepFall) {
          b.stats.escapes += 1
          this.moment(b.id, 'escape', 'LAST SECOND ESCAPE', `${b.name} clawed back onto the floor`, 4)
          this.pushFx({ type: 'save', x: b.x, y: b.y, power: 1, color: b.color, actorId: b.id, victimId: '', text: '' })
        }
        b.deepFall = false
      }
    } else if (!b.supported) {
      if (!b.falling) {
        b.falling = true
        b.fallHeight = b.height
        b.fallVel = -40
        b.vx += b.inheritVx
        b.vy += b.inheritVy
        capSpeed(b)
      }
      const grav = TUNE.fallGravity * mods.gravMul * (b.passive === 'glider' ? 0.72 : 1)
      b.fallVel -= grav * dt
      b.fallHeight += b.fallVel * dt
      if (b.fallHeight < -6) b.deepFall = true
      if (b.fallHeight < TUNE.fallKill) this.eliminate(b, 'fall')
    }
    if (b.supported && b.falling && b.fallHeight > TUNE.fallKill) {
      b.falling = false
      b.fallVel = 0
    }
    b.wasSupported = b.supported
    this.pushHist(b)
  }

  private hazardsAndEvents(dt: number): void {
    this.lowG = Math.max(0, this.lowG - dt)
    if (this.config.duration > 0 && this.time >= this.finalAt && !this.finalPhase && (this.status === 'playing' || this.status === 'sudden')) {
      this.finalPhase = true
      this.announce('FINAL PHASE', 'The arena gets mean', 3)
    }
    if (this.finalPhase && !this.laserSpawned && this.arena.final === 'laser') {
      this.laserSpawned = true
      this.extras.push(hazard({
        kind: 'laser',
        x: 0,
        y: 0,
        r: this.arena.view * 0.92,
        angle: 0.4,
        speed: 0.95,
        delay: this.time,
        period: 2.5,
        color: '#ff4d3a',
      }))
    }

    while (this.scriptCursor < this.script.length && this.script[this.scriptCursor]!.t <= this.time) {
      const ev = this.script[this.scriptCursor]!
      this.scriptCursor += 1
      this.live.push({ ...ev, born: this.time, fired: false })
      if (ev.kind === 'meteor') this.announce('METEOR', 'Leave the mark', 2)
      if (ev.kind === 'lowg') {
        this.lowG = ev.dur
        this.announce('LOW GRAVITY', 'Hang time, worse saves', 2)
      }
      if (ev.kind === 'orb') this.announce('BONUS ORB', 'Dash and a burst of speed', 1)
      if (ev.kind === 'well') {
        this.wells.push({ x: ev.x, y: ev.y, r: ev.r, ttl: ev.dur, ownerId: '', acc: 520 })
        this.announce('GRAVITY WELL', 'It pulls everyone', 2)
      }
      if (ev.kind === 'hole') this.announce('BLACK HOLE', 'Do not feed it', 3)
      if (ev.kind === 'blast') this.announce('BLAST ZONE', 'It arms, then it goes', 2)
    }

    for (const ev of this.live) {
      if (ev.fired) continue
      if (ev.kind === 'orb') {
        for (const b of this.players) {
          if (!b.alive) continue
          if (hypot(b.x - ev.x, b.y - ev.y) < ev.r + b.radius) {
            ev.fired = true
            b.dashCd = 0
            b.overdriveTime = Math.max(b.overdriveTime, 1.15)
            this.pushFx({ type: 'pickup', x: ev.x, y: ev.y, power: 1, color: '#ffc14d', actorId: b.id, victimId: '', text: 'OVERDRIVE' })
            break
          }
        }
      } else if ((ev.kind === 'meteor' || ev.kind === 'blast') && this.time >= ev.born + ev.dur) {
        ev.fired = true
        this.pushFx({ type: 'boom', x: ev.x, y: ev.y, power: ev.kind === 'blast' ? 420 : 500, color: '#ff4d3a', actorId: '', victimId: '', text: '' })
        for (const b of this.bodies) {
          if (!b.alive || b.invuln > 0) continue
          const d = hypot(b.x - ev.x, b.y - ev.y)
          if (d > ev.r) continue
          const nx = d < 1 ? 1 : (b.x - ev.x) / d
          const ny = d < 1 ? 0 : (b.y - ev.y) / d
          const kick = 640 * (1 - d / ev.r)
          b.vx += nx * kick
          b.vy += ny * kick
          capSpeed(b)
          b.hitFlash = 1
          b.lastHitHazard = true
          b.lastHitTime = this.time
        }
      } else if (ev.kind === 'hole' && this.time >= ev.born + ev.dur) {
        ev.fired = true
      }
    }
    this.live = this.live.filter((ev) => {
      if (ev.kind === 'orb') return !ev.fired && this.time < ev.born + ev.dur
      if (ev.kind === 'meteor' || ev.kind === 'blast') return this.time < ev.born + ev.dur + 0.35
      if (ev.kind === 'hole') return this.time < ev.born + ev.dur
      return this.time < ev.born + ev.dur
    })

    for (const h of this.allHazards()) {
      if (h.kind === 'explosive' && explosiveHot(h, this.time, dt)) {
        this.pushFx({ type: 'boom', x: h.x, y: h.y, power: 400, color: h.color, actorId: '', victimId: '', text: '' })
      }
    }

    for (const b of this.bodies) {
      if (!b.alive || b.invuln > 0) continue
      let lethal = 0
      let touching = false
      for (const h of this.allHazards()) {
        const touch = hazardContact(b, h, this.time, dt)
        if (!touch) continue
        if (touch.kind === 'laser' && (touch.impulseX !== 0 || touch.impulseY !== 0)) {
          const period = h.period || 2.6
          const cycle = Math.floor(this.time / period)
          if (b.laserCycle !== cycle) {
            b.laserCycle = cycle
            b.vx += touch.impulseX
            b.vy += touch.impulseY
            capSpeed(b)
            b.hitFlash = 1
            b.lastHitHazard = true
            b.lastHitTime = this.time
            this.pushFx({ type: 'hit', x: b.x, y: b.y, power: 400, color: '#ff4d3a', actorId: '', victimId: b.id, text: '' })
          }
        } else if (touch.impulseX || touch.impulseY) {
          b.vx += touch.impulseX
          b.vy += touch.impulseY
        }
        if (touch.pop && touch.kind === 'bumper') {
          this.pushFx({ type: 'wall', x: b.x, y: b.y, power: 300, color: h.color, actorId: b.id, victimId: '', text: '' })
        }
        if (touch.lethal) {
          touching = true
          if (touch.kind === 'blackhole') lethal = 2
          else if (touch.kind === 'spikes') lethal = Math.max(lethal, 1)
          else lethal = Math.max(lethal, lethal === 1 ? 1 : 0.5)
          b.lastHitHazard = true
        }
      }
      for (const ev of this.live) {
        if (ev.kind !== 'hole' || ev.fired) continue
        const d = hypot(b.x - ev.x, b.y - ev.y)
        if (d < ev.r) {
          const nx = d < 1 ? 0 : (ev.x - b.x) / d
          const ny = d < 1 ? 0 : (ev.y - b.y) / d
          b.vx += nx * 640 * dt
          b.vy += ny * 640 * dt
          if (d < 20) {
            b.lastHitHazard = true
            this.eliminate(b, 'hazard')
          }
        }
      }
      if (touching) b.hazardTime += dt
      else b.hazardTime = Math.max(0, b.hazardTime - dt * 3)
      const limit = lethal >= 2 ? 0 : lethal >= 1 ? 0.12 : 0.42
      if (touching && b.hazardTime >= limit) this.eliminate(b, 'hazard')

      if (b.portalCd > 0) b.portalCd -= dt
      else {
        const portals = this.arena.hazards.filter((h) => h.kind === 'portal')
        for (const p of portals) {
          const pose = hazardPose(p, this.time)
          if (hypot(b.x - pose.x, b.y - pose.y) > pose.r + b.radius * 0.4) continue
          const other = portals.find((o) => o !== p && o.link === p.link)
          if (!other) continue
          const dx = other.x - p.x
          const dy = other.y - p.y
          const d = hypot(dx, dy) || 1
          b.x = other.x + (dx / d) * (other.r + b.radius + 10)
          b.y = other.y + (dy / d) * (other.r + b.radius + 10)
          b.portalCd = 0.6
          this.pushFx({ type: 'ability', x: b.x, y: b.y, power: 1, color: other.color, actorId: b.id, victimId: '', text: '' })
          break
        }
      }
    }

    if (this.zone && this.zoneNext && !this.zoneMoved && this.time > 34 && this.config.duration > 0) {
      this.zone.x = this.zoneNext.x
      this.zone.y = this.zoneNext.y
      this.zoneMoved = true
      this.announce('ZONE MOVED', 'Go take it', 2)
    }
  }

  private rules(dt: number): void {
    if (!this.markedMid && this.config.duration > 0 && this.time >= this.config.duration * 0.5) {
      this.markedMid = true
      const maxStocks = Math.max(...this.players.map((p) => p.stocks))
      for (const p of this.players) if (p.stocks < maxStocks && !p.eliminated) p.stats.behindAtMid = true
    }

    if (this.zone && (this.status === 'playing' || this.status === 'sudden')) {
      const inside = this.players.filter((p) => p.alive && hypot(p.x - this.zone!.x, p.y - this.zone!.y) < this.zone!.r)
      const rate = inside.length === 1 ? 16 : 4
      for (const p of inside) {
        p.stats.score += rate * dt
        p.stats.zoneTime += dt
      }
    }

    for (const b of this.players) {
      if (b.respawn > 0) {
        b.respawn -= dt
        if (b.respawn <= 0 && !b.eliminated) this.respawn(b)
      }
    }

    if (this.config.scoreLimit > 0) {
      const leader = this.players.find((p) => p.stats.score >= this.config.scoreLimit)
      if (leader) {
        this.finishByRanking('score')
        return
      }
    }

    if (this.config.win === 'last') this.checkWipe()

    if (this.status === 'playing' && this.config.duration > 0 && this.time >= this.config.duration) {
      if (this.config.suddenDeath && this.contenders() > 1) {
        this.status = 'sudden'
        this.suddenLeft = TUNE.suddenTime
        this.announce('SUDDEN DEATH', 'The floor leaves. No respawns.', 4)
      } else this.finishByRanking('time')
    } else if (this.status === 'sudden') {
      this.suddenLeft -= dt
      if (this.suddenLeft <= 0 || this.contenders() <= 1) this.finishByRanking('time')
    }
  }

  private checkWipe(): void {
    const groups = new Map<number, Body[]>()
    for (const p of this.players) {
      const list = groups.get(p.team) ?? []
      list.push(p)
      groups.set(p.team, list)
    }
    const alive = [...groups.entries()].filter(([, list]) => list.some((p) => !p.eliminated))
    if (alive.length > 1) return
    const winners = alive[0]?.[1] ?? []
    this.winnerIds = winners.map((p) => p.id)
    this.rankSurvivors(winners.map((p) => p.team))
    const name = this.config.teams ? 'Team ' + (winners[0]?.team ?? '') : winners[0]?.name ?? 'Draw'
    if (winners[0]?.stats.behindAtMid) {
      this.moment(winners[0].id, 'comeback', 'COMEBACK', `${winners[0].name} won from behind`, 5)
    }
    this.announce(winners.length ? `${name.toUpperCase()} WINS` : 'DRAW', 'The floor keeps the rest', 5)
    this.status = 'celebrate'
    this.celebrate = TUNE.celebrate
  }

  private eliminate(b: Body, reason: 'fall' | 'hazard'): void {
    if (!b.alive) return
    if (b.decoy) {
      b.alive = false
      b.remove = true
      return
    }
    b.alive = false
    b.falling = false
    b.vx = 0
    b.vy = 0
    b.stats.deaths += 1
    b.stats.longestLife = Math.max(b.stats.longestLife, b.stats.lifeTime)
    b.stats.lifeTime = 0
    const credited = this.time - b.lastHitTime <= TUNE.hitCreditWindow
    const killer = credited ? this.players.find((p) => p.id === b.lastAttacker && p.id !== b.id) : undefined
    if (killer) {
      killer.stats.elims += 1
      killer.stats.score += this.config.modeId === 'score' ? 130 : 100
      if (b.lastHitDash) killer.stats.dashElims += 1
      if (reason === 'hazard' || b.lastHitHazard) killer.stats.hazardElims += 1
      if (this.time - killer.lastElimTime < 1.15) killer.elimStreak += 1
      else killer.elimStreak = 1
      killer.lastElimTime = this.time
      if (killer.elimStreak > killer.stats.multiBest) killer.stats.multiBest = killer.elimStreak
      if (killer.elimStreak === 2) this.moment(killer.id, 'double', 'DOUBLE KNOCKOUT', `${killer.name} sent two`, 4)
      if (killer.elimStreak >= 3) this.moment(killer.id, 'triple', 'TRIPLE KNOCKOUT', `${killer.name} cleared the floor`, 5)
      const how = reason === 'hazard' || b.lastHitHazard ? 'into the hazard' : 'off the arena'
      this.pushFeed(`${killer.name} ${how === 'into the hazard' ? 'fed' : 'sent'} ${b.name}`, killer.color)
    } else {
      this.pushFeed(`${b.name} fell`, b.color)
    }
    this.pushFx({
      type: 'elim',
      x: b.x,
      y: b.y,
      power: reason === 'hazard' ? 2 : 1,
      color: killer?.color ?? b.color,
      actorId: killer?.id ?? '',
      victimId: b.id,
      text: killer ? killer.name : '',
    })

    const infinite = this.config.respawn === 'always'
    if (!infinite) b.stocks = Math.max(0, b.stocks - 1)
    const allow = this.status !== 'sudden' && (infinite || (this.config.respawn === 'stocks' && b.stocks > 0))
    if (allow) {
      b.respawn = TUNE.respawnDelay
      if (b.stocks === 1 && !infinite) this.announce('LAST STOCK', b.name, 2)
    } else {
      b.eliminated = true
      b.stocks = 0
      const out = this.players.filter((p) => p.eliminated).length
      b.placement = this.players.length - out + 1
    }
  }

  private respawn(b: Body): void {
    let best = this.arena.spawns[0] ?? { x: 0, y: 0 }
    let bestD = -1
    const hazards = this.allHazards()
    for (const s of this.arena.spawns) {
      const sup = supportAt(this.arena.solids, s.x, s.y, this.time, this.shrink, DT)
      if (sup.edgeDist < 20) continue
      let blocked = false
      for (const h of hazards) {
        if (h.kind !== 'lava' && h.kind !== 'spikes' && h.kind !== 'blackhole') continue
        const p = hazardPose(h, this.time)
        if (hypot(s.x - p.x, s.y - p.y) < p.r + 40) blocked = true
      }
      if (blocked) continue
      let minD = 9999
      for (const o of this.players) {
        if (!o.alive || o === b) continue
        minD = Math.min(minD, hypot(o.x - s.x, o.y - s.y))
      }
      if (minD > bestD) {
        bestD = minD
        best = s
      }
    }
    b.x = best.x
    b.y = best.y
    b.prevX = b.x
    b.prevY = b.y
    b.vx = 0
    b.vy = 0
    b.alive = true
    b.falling = false
    b.fallHeight = 12
    b.fallVel = 0
    b.deepFall = false
    b.invuln = TUNE.spawnInvuln
    b.supported = true
    b.dashTime = 0
    this.pushFx({ type: 'spawn', x: b.x, y: b.y, power: 1, color: b.color, actorId: b.id, victimId: '', text: '' })
  }

  private contenders(): number {
    const teams = new Set(this.players.filter((p) => !p.eliminated).map((p) => p.team))
    return teams.size
  }

  private rankSurvivors(winningTeams: number[]): void {
    const open = this.players.filter((p) => p.placement === 0)
    open.sort((a, b) => {
      const aw = winningTeams.includes(a.team) ? 1 : 0
      const bw = winningTeams.includes(b.team) ? 1 : 0
      return bw - aw || b.stats.score - a.stats.score || b.stocks - a.stocks || b.stats.damage - a.stats.damage
    })
    open.forEach((p, i) => {
      p.placement = i + 1
    })
  }

  private finishByRanking(reason: 'time' | 'score' | 'forfeit'): void {
    if (this.status === 'celebrate' || this.status === 'finished') return
    const forfeiter = this.forfeitId
    const survivors = this.players.filter((p) => p.id !== forfeiter && !p.eliminated)
    survivors.sort((a, b) => b.stats.score - a.stats.score || b.stocks - a.stocks || b.stats.damage - a.stats.damage)
    const dead = this.players.filter((p) => p.id !== forfeiter && p.eliminated).sort((a, b) => a.placement - b.placement)
    const order = [...survivors, ...dead]
    const quit = this.players.find((p) => p.id === forfeiter)
    if (quit) order.push(quit)
    order.forEach((p, i) => {
      p.placement = i + 1
    })
    const top = order[0]
    if (this.config.teams && top) this.winnerIds = this.players.filter((p) => p.team === top.team).map((p) => p.id)
    else if (top) this.winnerIds = [top.id]
    else this.winnerIds = []
    if (top?.stats.behindAtMid && reason !== 'forfeit') {
      this.moment(top.id, 'comeback', 'COMEBACK', `${top.name} took it after falling behind`, 5)
    }
    const title = reason === 'forfeit' ? 'FORFEIT' : top ? `${top.name.toUpperCase()} WINS` : 'TIME'
    this.announce(title, reason === 'time' ? 'Time' : 'That is the match', 4)
    this.status = 'celebrate'
    this.celebrate = TUNE.celebrate
  }

  private computeShrink(): Shrink {
    let cut = 0
    let innerGrow = 0
    if (this.arena.shrinkRate > 0) cut += Math.max(0, this.time - this.arena.shrinkDelay) * this.arena.shrinkRate
    if (this.config.events === 'survivor') cut += this.time * 3.5
    if (this.finalPhase && this.arena.final === 'shrink') cut += Math.max(0, this.time - this.finalAt) * 2.4
    if (this.status === 'sudden') {
      const u = 1 - clamp(this.suddenLeft / TUNE.suddenTime, 0, 1)
      cut += u * 180
      innerGrow += u * 100
    }
    return { cut: Math.min(360, cut), innerGrow }
  }

  private allHazards(): HazardDef[] {
    return [...this.arena.hazards, ...this.extras]
  }

  private botSense() {
    const events: BotEvent[] = []
    for (const ev of this.live) {
      const warn = (ev.kind === 'meteor' || ev.kind === 'blast') && !ev.fired
      const hot = ev.kind === 'hole' || ((ev.kind === 'meteor' || ev.kind === 'blast') && this.time > ev.born + ev.dur * 0.75)
      if (ev.kind === 'meteor' || ev.kind === 'hole' || ev.kind === 'blast') {
        events.push({ x: ev.x, y: ev.y, r: ev.r, warn, hot })
      }
    }
    for (const h of this.allHazards()) {
      if (h.kind === 'laser' && laserMode(h, this.time) !== 'off') {
        events.push({ x: h.x, y: h.y, r: 70, warn: laserMode(h, this.time) === 'warn', hot: laserMode(h, this.time) === 'hot' })
      }
    }
    return {
      time: this.time,
      playTick: this.playTick,
      teams: this.config.teams,
      zone: this.zone,
      bodies: this.bodies,
      hazards: this.allHazards(),
      events,
    }
  }

  private announce(text: string, sub: string, priority: number): void {
    if (this.banner && this.banner.life > 0.35 && this.banner.priority > priority) return
    this.banner = { text, sub, life: priority >= 4 ? 1.7 : 1.35, priority }
  }

  private pushFeed(text: string, color: string): void {
    this.feed.unshift({ text, color, life: 3.4 })
    if (this.feed.length > 4) this.feed.pop()
  }

  private moment(actorId: string, kind: string, title: string, detail: string, importance: number): void {
    const last = this.moments[this.moments.length - 1]
    if (last && last.kind === kind && last.actorId === actorId && this.time - last.time < 0.8) return
    this.moments.push({ kind, title, detail, time: this.time, actorId, importance })
    if (this.moments.length > 24) this.moments.shift()
  }

  private pushFx(fx: FxEvent): void {
    if (this.silent) return
    this.fx.push(fx)
    if (this.fx.length > 64) this.fx.shift()
  }

  private pushHist(b: Body): void {
    b.hist[b.histI] = b.x
    b.hist[b.histI + 1] = b.y
    b.histI = (b.histI + 2) % b.hist.length
  }

  private decayPresentation(dt: number): void {
    if (this.banner) {
      this.banner.life -= dt
      if (this.banner.life <= 0) this.banner = null
    }
    this.goFlash = Math.max(0, this.goFlash - dt)
    for (const f of this.feed) f.life -= dt
    this.feed = this.feed.filter((f) => f.life > 0)
  }

  private guard(b: Body): void {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
      b.x = 0
      b.y = 0
      b.vx = 0
      b.vy = 0
    }
    capSpeed(b, SPEED_CAP)
  }
}

function asImpact(b: Body): ImpactBody {
  return b
}

function toPlacement(p: Body, winners: string[]): Placement {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    place: p.placement || thisPlace(p),
    bot: p.bot,
    color: p.color,
    core: p.core,
    masteryCore: p.masteryCore,
    ability: p.ability,
    rating: p.rating,
    elims: p.stats.elims,
    deaths: p.stats.deaths,
    damage: p.stats.damage,
    damageTaken: p.stats.damageTaken,
    score: p.stats.score,
    survival: p.stats.survival,
    maxSpeed: p.stats.maxSpeed,
    maxMomentum: p.stats.maxMomentum,
    bestImpact: p.stats.bestImpact,
    bestLaunchM: p.stats.bestLaunchM,
    dashes: p.stats.dashes,
    dashHits: p.stats.dashHits,
    dashElims: p.stats.dashElims,
    perfectDashes: p.stats.perfectDashes,
    abilityUses: p.stats.abilityUses,
    abilityHits: p.stats.abilityHits,
    hazardElims: p.stats.hazardElims,
    escapes: p.stats.escapes,
    multiBest: p.stats.multiBest,
    wallKicks: p.stats.wallKicks,
    stocksLeft: p.stocks,
    longestLife: p.stats.longestLife,
    behindAtMid: p.stats.behindAtMid,
    won: winners.includes(p.id),
  }
}

function thisPlace(p: Body): number {
  return p.eliminated ? 8 : 1
}

function hazard(partial: Partial<HazardDef> & Pick<HazardDef, 'kind'>): HazardDef {
  return {
    x: 0,
    y: 0,
    r: 0,
    w: 0,
    h: 0,
    angle: 0,
    speed: 0,
    amp: 0,
    delay: 0,
    period: 0,
    link: '',
    grow: 0,
    maxR: 0,
    color: '#ffffff',
    ...partial,
  }
}

function buildScript(arena: ArenaDef, events: MatchConfig['events'], rng: Rng, duration: number): ScriptEvent[] {
  if (events === 'quiet' || events === 'survivor') return []
  const list: ScriptEvent[] = []
  const place = () => {
    const a = rng.next() * Math.PI * 2
    const rad = rng.range(30, Math.min(260, arena.view * 0.42))
    return { x: Math.cos(a) * rad, y: Math.sin(a) * rad }
  }
  if (events === 'standard') {
    const orb = place()
    list.push({ t: 14, kind: 'orb', x: orb.x, y: orb.y, r: 26, dur: 8 })
    const meteor = place()
    list.push({ t: 32, kind: 'meteor', x: meteor.x, y: meteor.y, r: 128, dur: 0.95 })
    list.push({ t: 48, kind: 'lowg', x: 0, y: 0, r: 0, dur: 4 })
    const orb2 = place()
    list.push({ t: 60, kind: 'orb', x: orb2.x, y: orb2.y, r: 26, dur: 7 })
    return list
  }
  let t = 8
  const kinds: ScriptEvent['kind'][] = ['meteor', 'orb', 'lowg', 'well', 'blast', 'hole']
  const end = Math.max(24, (duration || 80) - 10)
  while (t < end) {
    const kind = rng.pick(kinds)
    const p = place()
    list.push({
      t,
      kind,
      x: p.x,
      y: p.y,
      r: kind === 'meteor' || kind === 'hole' ? 120 : 80,
      dur: kind === 'lowg' ? 3.2 : kind === 'meteor' || kind === 'blast' ? 0.95 : 5,
    })
    t += rng.range(7.5, 11)
  }
  return list
}
