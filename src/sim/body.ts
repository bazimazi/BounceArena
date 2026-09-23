import { emptyStats, type BodyStats, type InputFrame, type PlayerConfig, ZERO_INPUT } from '../core/types'
import { abilityById, coreById, shellById, TUNE } from '../data/tuning'

export interface Body {
  id: string
  name: string
  team: number
  bot: boolean
  auto: boolean
  botLevel: PlayerConfig['botLevel']
  skill: number
  aggression: number
  color: string
  pattern: number
  core: string
  shell: string
  ability: string
  passive: string
  masteryCore: string
  trail: string
  impact: string
  skin: string
  emote: string
  title: string
  rating: number

  x: number
  y: number
  vx: number
  vy: number
  prevX: number
  prevY: number
  radius: number
  mass: number
  restitution: number
  accel: number
  maxSpeed: number
  turnRate: number
  outgoing: number
  incoming: number
  dashMul: number
  dashCdMax: number
  period: number
  bounceAmp: number
  landMul: number
  magnetAura: number
  reactive: boolean

  momentum: number
  phase: number
  height: number
  laserCycle: number
  lastHitDash: boolean
  lastHitHazard: boolean
  grounded: boolean
  sinceLand: number
  dashCd: number
  dashTime: number
  perfectFlash: number
  abilityCd: number
  abilityCdMax: number
  phaseTime: number
  anchorTime: number
  overdriveTime: number
  mirrorTime: number
  magnetTime: number
  wellCdNote: number
  invuln: number
  secondWind: number
  secondWindCd: number
  reactiveCd: number
  emoteCd: number
  emoteText: string
  emoteTime: number
  hitFlash: number
  hazardTime: number
  portalCd: number

  falling: boolean
  fallHeight: number
  fallVel: number
  coyote: number
  supported: boolean
  edgeDist: number
  safetyX: number
  safetyY: number
  inheritVx: number
  inheritVy: number
  wasSupported: boolean
  surface: string

  alive: boolean
  stocks: number
  respawn: number
  eliminated: boolean
  placement: number
  lastAttacker: string
  lastHitTime: number
  spawnShield: number

  input: InputFrame
  prevDash: boolean
  prevAbility: boolean
  prevEmote: boolean

  stats: BodyStats
  launching: boolean
  launchFromX: number
  launchFromY: number
  launchT: number
  launchAttacker: string
  deepFall: boolean
  elimStreak: number
  lastElimTime: number
  botReact: number
  botX: number
  botY: number
  botDash: boolean
  botAbility: boolean
  botBrake: boolean

  decoy: boolean
  ownerId: string
  decoyLife: number
  remove: boolean

  hist: number[]
  histI: number
}

export function createBody(cfg: PlayerConfig, stocks: number, competitive: boolean): Body {
  const core = coreById(competitive ? 'stable' : cfg.core)
  const shell = shellById(competitive ? 'rubber' : cfg.shell)
  const passive = competitive ? 'none' : cfg.passive
  const ability = abilityById(cfg.ability)
  const radius = core.radius
  return {
    id: cfg.id,
    name: cfg.name,
    team: cfg.team,
    bot: cfg.bot,
    auto: false,
    botLevel: cfg.botLevel,
    skill: cfg.skill,
    aggression: cfg.aggression,
    color: cfg.color,
    pattern: cfg.pattern,
    core: core.id,
    shell: shell.id,
    ability: ability.id,
    passive,
    masteryCore: cfg.masteryCore,
    trail: cfg.trail,
    impact: cfg.impact,
    skin: cfg.skin,
    emote: cfg.emote,
    title: cfg.title,
    rating: cfg.rating,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    prevX: 0,
    prevY: 0,
    radius,
    mass: core.mass * shell.mass,
    restitution: core.restitution * shell.restitution,
    accel: TUNE.accel * core.accel,
    maxSpeed: TUNE.maxSpeed * core.maxSpeed,
    turnRate: core.turn,
    outgoing: core.outgoing * shell.outgoing * (passive === 'heavy-hitter' ? 1.1 : 1),
    incoming: core.incoming * shell.incoming,
    dashMul: core.dash,
    dashCdMax: TUNE.dashCooldown * core.dashCd * shell.dashCd,
    period: TUNE.bouncePeriod * shell.period,
    bounceAmp: TUNE.bounceAmp,
    landMul: shell.land,
    magnetAura: shell.magnet,
    reactive: shell.reactive,
    momentum: 0,
    phase: 0,
    height: 0,
    laserCycle: -1,
    lastHitDash: false,
    lastHitHazard: false,
    grounded: true,
    sinceLand: 1,
    dashCd: 0,
    dashTime: 0,
    perfectFlash: 0,
    abilityCd: 0,
    abilityCdMax: ability.cooldown,
    phaseTime: 0,
    anchorTime: 0,
    overdriveTime: 0,
    mirrorTime: 0,
    magnetTime: 0,
    wellCdNote: 0,
    invuln: TUNE.spawnInvuln,
    secondWind: 0,
    secondWindCd: 0,
    reactiveCd: 0,
    emoteCd: 0,
    emoteText: '',
    emoteTime: 0,
    hitFlash: 0,
    hazardTime: 0,
    portalCd: 0,
    falling: false,
    fallHeight: 10,
    fallVel: 0,
    coyote: TUNE.coyote,
    supported: true,
    edgeDist: 999,
    safetyX: 0,
    safetyY: 0,
    inheritVx: 0,
    inheritVy: 0,
    wasSupported: true,
    surface: 'normal',
    alive: true,
    stocks,
    respawn: 0,
    eliminated: false,
    placement: 0,
    lastAttacker: '',
    lastHitTime: -99,
    spawnShield: 0,
    input: { ...ZERO_INPUT },
    prevDash: false,
    prevAbility: false,
    prevEmote: false,
    stats: emptyStats(),
    launching: false,
    launchFromX: 0,
    launchFromY: 0,
    launchT: 0,
    launchAttacker: '',
    deepFall: false,
    elimStreak: 0,
    lastElimTime: -99,
    botReact: 0,
    botX: 0,
    botY: 1,
    botDash: false,
    botAbility: false,
    botBrake: false,
    decoy: false,
    ownerId: '',
    decoyLife: 0,
    remove: false,
    hist: new Array(28).fill(0),
    histI: 0,
  }
}

/** Random bounce phase would desync replays. Seed it from the id. */
export function seedPhase(body: Body, salt: number): void {
  let h = salt + 1
  for (let i = 0; i < body.id.length; i++) h = (h * 33 + body.id.charCodeAt(i)) >>> 0
  body.phase = ((h & 1023) / 1023) * Math.PI
  body.height = Math.abs(Math.sin(body.phase)) * body.bounceAmp
  body.grounded = body.height < 3
}
