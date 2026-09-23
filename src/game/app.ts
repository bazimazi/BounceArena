import { DT, ZERO_INPUT, type MatchResult } from '../core/types'
import { abilityById } from '../data/tuning'
import { AudioBus } from '../audio/audio'
import { attractConfig, buildMatchConfig, type PlayOptions } from '../game/setup'
import { Input } from '../input/input'
import { loadProfile, saveProfile, type Profile } from '../progression/profile'
import { buyCosmetic, equipCosmetic, refreshChallenges, settle, type SettleOutcome } from '../progression/settle'
import { Renderer } from '../render/render'
import { Match } from '../sim/match'
import { Session } from '../sim/session'
import { Shell, type PlayDraft } from '../ui/ui'

const uiRoot = document.querySelector('#ui') as HTMLElement
const hudRoot = document.querySelector('#hud') as HTMLElement
const canvas = document.querySelector('#view') as HTMLCanvasElement

class App {
  profile: Profile
  shell = new Shell(uiRoot, hudRoot)
  audio = new AudioBus()
  input = new Input()
  renderer = new Renderer(canvas)
  session: Session | null = null
  attract: Match
  highlight: Match | null = null
  highlightLeft = 0
  outcome: SettleOutcome | null = null
  lastResult: MatchResult | null = null
  lastOptions: PlayOptions | null = null
  screen: 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings' | 'match' | 'results' = 'menu'
  paused = false
  settled = false
  acc = 0
  last = 0
  blip = -1
  youId = 'you'

  constructor() {
    this.profile = loadProfile()
    refreshChallenges(this.profile)
    saveProfile(this.profile)
    this.attract = new Match(attractConfig(1))
    this.applySettings()
    this.bindShell()
    this.input.attach(canvas)
    this.input.onPause = () => this.togglePause()
    this.bindTouch()
    this.renderer.resize()
    window.addEventListener('resize', () => this.renderer.resize())
    this.show('menu')
  }

  start(): void {
    this.last = performance.now()
    requestAnimationFrame(this.frame)
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (document.hidden) {
      requestAnimationFrame(this.frame)
      return
    }
    this.acc += dt
    let steps = 0
    while (this.acc >= DT && steps < 5) {
      this.tick()
      this.acc -= DT
      steps += 1
    }
    if (steps === 5) this.acc = 0
    this.draw()
    requestAnimationFrame(this.frame)
  }

  private tick(): void {
    if (this.highlight) {
      this.highlight.step()
      this.highlightLeft -= DT
      if (this.highlightLeft <= 0 || this.highlight.status === 'finished') {
        this.highlight = null
        this.show('results')
      }
      return
    }
    if (this.session && this.screen === 'match' && !this.paused) {
      const match = this.session.match
      const you = match.players.find((p) => p.id === this.youId)
      const frame = you
        ? this.input.player(you.x, you.y, (x, y) => this.renderer.toCss(x, y), this.profile.settings.mouseSteer)
        : { ...ZERO_INPUT }
      const tick = match.playTick
      this.session.submit(this.youId, tick, frame)
      if (this.lastOptions?.localDuo) {
        const second = this.input.playerTwo() ?? { ...ZERO_INPUT }
        this.session.submit('p2', tick, second)
      }
      this.session.step()
      this.readFx(match)
      this.watchCountdown(match)
      if (match.status === 'finished' && !this.settled) this.finishMatch()
      if (match.config.modeId === 'tutorial') {
        const learner = match.players.find((p) => p.id === this.youId)
        if (learner && learner.stats.elims > 0 && match.status === 'playing') match.endNow()
      }
      const intensity = match.finalPhase || match.status === 'sudden' ? 1 : 0.35
      this.audio.update(DT, this.screen === 'match' ? intensity : 0)
      return
    }
    if (!this.session || this.screen !== 'match') {
      if (this.attract.status === 'finished' || this.attract.status === 'celebrate') {
        this.attract = new Match(attractConfig((this.attract.config.seed + 1) >>> 0))
      }
      this.attract.silent = true
      this.attract.step()
    }
  }

  private draw(): void {
    const prefs = {
      shake: this.profile.settings.shake,
      fx: this.profile.settings.fx,
      colorblind: this.profile.settings.colorblind,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
    const menu = this.screen !== 'match' && this.screen !== 'results'
    const bias = menu ? Math.min(220, window.innerWidth * 0.18) : 0
    if (this.highlight) {
      this.renderer.draw(this.highlight, 1, prefs, 0, this.youId)
      return
    }
    if (this.session && (this.screen === 'match' || this.screen === 'results')) {
      const match = this.session.match
      this.renderer.draw(match, 1, prefs, 0, this.youId)
      if (this.screen === 'match') {
        this.shell.syncHud(match, this.youId, this.hint(match))
        const you = match.players.find((p) => p.id === this.youId)
        if (you && this.profile.settings.haptics && you.hitFlash > 0.85 && navigator.vibrate) navigator.vibrate(10)
      }
      return
    }
    this.renderer.draw(this.attract, 1, { ...prefs, shake: 0 }, bias, '')
  }

  private play(options: PlayOptions): void {
    this.audio.resume()
    const earlyClassic = this.profile.matches < 2 && options.modeId === 'ffa' && options.arenaId === 'random'
    const tuned = earlyClassic ? { ...options, arenaId: 'classic' } : options
    this.lastOptions = tuned
    this.outcome = null
    this.settled = false
    this.paused = false
    this.highlight = null
    this.youId = 'you'
    this.input.reset()
    const config = buildMatchConfig(this.profile, tuned)
    this.session = new Session(config)
    this.screen = 'match'
    document.body.dataset.mode = 'match'
    uiRoot.replaceChildren()
    hudRoot.hidden = false
    this.shell.mountHud()
    this.shell.onPause = () => this.togglePause()
    this.shell.onResume = () => this.togglePause()
    this.shell.onForfeit = () => this.leaveMatch()
    this.shell.onMenu = () => this.leaveMatch()
  }

  private finishMatch(): void {
    if (!this.session || this.settled) return
    this.settled = true
    const result = this.session.match.toResult(this.youId)
    this.lastResult = result
    this.outcome = settle(this.profile, result)
    this.profile = this.outcome.profile
    this.profile.tutorialDone = true
    saveProfile(this.profile)
    const you = result.placements.find((p) => p.id === this.youId)
    if (you?.place === 1) this.audio.win()
    else this.audio.lose()
    this.show('results')
  }

  private leaveMatch(): void {
    const match = this.session?.match
    if (match && match.status !== 'finished' && match.status !== 'celebrate') {
      const you = match.players.find((p) => p.id === this.youId)
      if (you?.alive) match.forfeit(this.youId)
      else match.endNow()
      this.finishMatch()
      return
    }
    this.session = null
    this.show('menu')
  }

  private show(screen: 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings' | 'results'): void {
    this.screen = screen
    document.body.dataset.mode = screen === 'results' ? 'results' : 'menu'
    hudRoot.hidden = true
    this.paused = false
    if (screen === 'menu') this.shell.showMenu(this.profile)
    if (screen === 'play') this.shell.showPlay(this.profile)
    if (screen === 'loadout') this.shell.showLoadout(this.profile)
    if (screen === 'career') this.shell.showCareer(this.profile)
    if (screen === 'collection') this.shell.showCollection(this.profile)
    if (screen === 'settings') this.shell.showSettings(this.profile)
    if (screen === 'results' && this.outcome && this.lastResult) this.shell.showResults(this.profile, this.outcome, this.lastResult)
  }

  private togglePause(): void {
    if (this.screen !== 'match' || !this.session) return
    const you = this.session.match.players.find((p) => p.id === this.youId)
    if (you && !you.alive && you.eliminated) {
      this.leaveMatch()
      return
    }
    this.paused = !this.paused
    if (this.paused) this.shell.showPause()
    else this.shell.hidePause()
  }

  private watchHighlight(): void {
    const match = this.session?.match
    if (!match) return
    const moment = [...match.moments].sort((a, b) => b.importance - a.importance)[0]
    const replay = new Match(match.config)
    replay.replayMode = true
    replay.inputLog = match.inputLog
    replay.silent = true
    const target = Math.max(0, Math.floor((moment?.time ?? Math.max(0, match.time - 2)) / DT) - 70)
    let guard = 0
    while (replay.countdownTicks > 0 || (replay.playTick < target && replay.status !== 'finished' && replay.status !== 'celebrate')) {
      replay.step()
      if (++guard > 20000) break
    }
    replay.silent = false
    this.highlight = replay
    this.highlightLeft = 3.2
    uiRoot.replaceChildren()
    hudRoot.hidden = true
  }

  private hint(match: Match): string {
    if (this.profile.matches > 1 && this.profile.tutorialDone) return ''
    const you = match.players.find((p) => p.id === this.youId)
    if (!you) return ''
    const taught = this.profile.taught
    if (!taught.move && Math.hypot(you.vx, you.vy) < 40) return 'WASD to steer. You keep your speed when you let go.'
    if (!taught.move) taught.move = true
    if (!taught.land && you.stats.survival < 2) return 'Landings give a burst if you are holding a direction.'
    if (you.sinceLand < 0.05) taught.land = true
    if (!taught.speed && you.stats.maxSpeed < 360) return 'Speed is power. Build it, then commit to the hit.'
    if (you.stats.maxSpeed >= 360) taught.speed = true
    if (!taught.dash && you.stats.dashes < 1) return 'Space dashes. Tap it as you land for a perfect dash.'
    if (you.stats.dashes > 0) taught.dash = true
    if (!taught.ability && you.stats.abilityUses < 1) return `${abilityById(you.ability).name} is F. It is a decision, not a stat.`
    if (you.stats.abilityUses > 0) taught.ability = true
    if (!taught.edge && you.edgeDist < 110) return 'The edge is out. Shift brakes. Dash back toward the floor.'
    if (you.stats.escapes > 0) taught.edge = true
    if (!taught.hit && you.stats.hits < 1) return 'A faster ball launches a slower one. Angle it toward the edge.'
    if (you.stats.hits > 0) taught.hit = true
    return ''
  }

  private readFx(match: Match): void {
    const events = match.consumeFx()
    this.renderer.absorb(events, {
      shake: this.profile.settings.shake,
      fx: this.profile.settings.fx,
      colorblind: this.profile.settings.colorblind,
      reducedMotion: false,
    }, this.youId)
    for (const e of events) {
      const local = e.actorId === this.youId || e.victimId === this.youId
      this.audio.fx(e, local)
    }
  }

  private watchCountdown(match: Match): void {
    if (match.countdownTicks <= 0) {
      if (this.blip > 0) this.audio.go()
      this.blip = -1
      return
    }
    const n = Math.ceil(match.countdownTicks / 60)
    if (n !== this.blip) {
      this.blip = n
      this.audio.blip(n)
    }
  }

  private bindShell(): void {
    this.shell.onNavigate = (screen) => {
      this.audio.click()
      if (screen === 'menu') this.show('menu')
      else this.show(screen)
    }
    this.shell.onPlay = (draft) => this.play(this.optionsFrom(draft))
    this.shell.onTutorial = () => this.play({ modeId: 'tutorial', arenaId: 'classic', competitive: false, players: 2 })
    this.shell.onPractice = () => this.play({ modeId: 'practice', arenaId: this.shell.draft.arenaId, competitive: false, players: 4 })
    this.shell.onRanked = () => this.play({ modeId: 'duel', arenaId: 'classic', competitive: true, players: 2 })
    this.shell.onName = (name) => {
      this.profile.name = name
      saveProfile(this.profile)
    }
    this.shell.onLoadout = (slot, id) => {
      this.profile.loadout[slot] = id
      saveProfile(this.profile)
      this.shell.showLoadout(this.profile)
    }
    this.shell.onEquip = (id) => {
      const next = equipCosmetic(this.profile, id)
      if (!next) return
      this.profile = next
      saveProfile(this.profile)
      this.shell.showCollection(this.profile)
    }
    this.shell.onBuy = (id) => {
      const next = buyCosmetic(this.profile, id)
      if (!next) return
      this.profile = next
      saveProfile(this.profile)
      this.shell.showCollection(this.profile)
    }
    this.shell.onSettings = (partial) => {
      this.profile.settings = { ...this.profile.settings, ...partial }
      saveProfile(this.profile)
      this.applySettings()
    }
    this.shell.onRematch = () => {
      if (this.lastOptions) this.play(this.lastOptions)
    }
    this.shell.onMenu = () => {
      this.session = null
      this.highlight = null
      this.show('menu')
    }
    this.shell.onHighlight = () => this.watchHighlight()
    this.shell.onForfeit = () => this.leaveMatch()
    this.shell.onEnd = () => this.leaveMatch()
  }

  private optionsFrom(draft: PlayDraft): PlayOptions {
    return {
      modeId: draft.modeId,
      arenaId: draft.arenaId,
      competitive: draft.competitive,
      players: draft.players,
      localDuo: draft.localDuo,
    }
  }

  private applySettings(): void {
    document.documentElement.style.setProperty('--ui', String(this.profile.settings.uiScale))
    this.audio.setVolumes(this.profile.settings.volume, this.profile.settings.music)
  }

  private bindTouch(): void {
    const stick = document.querySelector('#stick') as HTMLElement
    const knob = document.querySelector('#knob') as HTMLElement
    const dash = document.querySelector('#btn-dash') as HTMLButtonElement
    const ability = document.querySelector('#btn-ability') as HTMLButtonElement
    const brake = document.querySelector('#btn-brake') as HTMLButtonElement
    const set = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect()
      const x = e.clientX - (rect.left + rect.width / 2)
      const y = e.clientY - (rect.top + rect.height / 2)
      const m = Math.hypot(x, y) || 1
      const k = Math.min(1, m / (rect.width / 2))
      this.input.stick.x = (x / m) * k
      this.input.stick.y = (y / m) * k
      this.input.stick.active = true
      knob.style.transform = `translate(${this.input.stick.x * 36}px, ${this.input.stick.y * 36}px)`
    }
    stick.addEventListener('pointerdown', (e) => {
      stick.setPointerCapture(e.pointerId)
      set(e)
    })
    stick.addEventListener('pointermove', (e) => {
      if (this.input.stick.active) set(e)
    })
    const clear = () => {
      this.input.stick.active = false
      this.input.stick.x = 0
      this.input.stick.y = 0
      knob.style.transform = ''
    }
    stick.addEventListener('pointerup', clear)
    stick.addEventListener('pointercancel', clear)
    const hold = (button: HTMLButtonElement, key: 'touchDash' | 'touchAbility' | 'touchBrake') => {
      const down = (e: PointerEvent) => {
        e.preventDefault()
        this.input[key] = true
      }
      const up = () => {
        this.input[key] = false
      }
      button.addEventListener('pointerdown', down)
      button.addEventListener('pointerup', up)
      button.addEventListener('pointerleave', up)
    }
    hold(dash, 'touchDash')
    hold(ability, 'touchAbility')
    hold(brake, 'touchBrake')
  }
}

const app = new App()
app.start()
