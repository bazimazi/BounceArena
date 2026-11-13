import { DT, ZERO_INPUT, type MatchResult } from '../core/types'
import { abilityById } from '../data/tuning'
import { dailyTwist } from '../data/content'
import { clamp } from '../core/math'
import type { Body } from '../sim/body'
import { AudioBus } from '../audio/audio'
import { attractConfig, buildMatchConfig, type PlayOptions } from '../game/setup'
import { Input } from '../input/input'
import { loadProfile, saveProfile, type Profile } from '../progression/profile'
import { buyCosmetic, equipCosmetic, refresh, rerollChallenge, settle, type Grant, type SettleOutcome } from '../progression/settle'
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
  lastElim: { x: number; y: number; color: string; time: number } | null = null
  finaleShown = false
  wiping = false
  /** Rewards paid while loading the profile, shown once on the menu. */
  notices: Grant[] = []

  constructor() {
    this.profile = loadProfile()
    this.notices = refresh(this.profile)
    saveProfile(this.profile)
    this.attract = new Match(attractConfig(1))
    this.applySettings()
    this.bindShell()
    this.input.attach(canvas)
    this.input.onPause = () => this.togglePause()
    this.bindTouch()
    this.renderer.resize()
    window.addEventListener('resize', () => this.renderer.resize())
    // Browsers only allow audio after a gesture; the first one starts the menu music too.
    const unlock = () => {
      this.audio.resume()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    // Leaving the tab pauses the match and silences the audio instead of playing on unseen.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend()
        this.autoPause()
      } else this.audio.wake()
    })
    window.addEventListener('blur', () => this.autoPause())
    uiRoot.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'mouse' && (e.target as HTMLElement).closest?.('button')) this.audio.hover()
    })
    this.show('menu')
  }

  /** Practice and Tutorial can run slower as an assist. Scored matches always run at full speed. */
  private assistSpeed(): number {
    const mode = this.session?.match.config.modeId
    if (this.highlight || (mode !== 'practice' && mode !== 'tutorial')) return 1
    return clamp(this.profile.settings.practiceSpeed || 1, 0.5, 1)
  }

  private autoPause(): void {
    const match = this.session?.match
    if (this.screen !== 'match' || !match || this.paused) return
    // Spectating after a knockout: togglePause would leave for results, so let it be.
    const you = match.players.find((p) => p.id === this.youId)
    if (you && you.eliminated) return
    if (match.status === 'playing' || match.status === 'sudden' || match.status === 'countdown') this.togglePause()
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
    const live = this.highlight || (this.session && this.screen === 'match' && !this.paused)
    this.acc += dt * (live ? this.renderer.timeScale(dt) * this.assistSpeed() : 1)
    let steps = 0
    while (this.acc >= DT && steps < 5) {
      this.tick()
      this.acc -= DT
      steps += 1
    }
    if (steps === 5) this.acc = 0
    this.pollPad()
    this.draw()
    requestAnimationFrame(this.frame)
  }

  private tick(): void {
    if (this.highlight) {
      this.highlight.step()
      this.readFx(this.highlight)
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
        ? this.input.player(you.x, you.y, (x, y) => this.renderer.toCss(x, y), this.profile.settings.mouseSteer, !this.lastOptions?.localDuo)
        : { ...ZERO_INPUT }
      const tick = match.playTick
      this.session.submit(this.youId, tick, frame)
      if (this.lastOptions?.localDuo) {
        const second = this.input.playerTwo() ?? { ...ZERO_INPUT }
        this.session.submit('p2', tick, second)
      }
      this.session.step()
      this.readFx(match)
      this.watchFinale(match)
      this.watchCountdown(match)
      if (match.status === 'finished' && !this.settled) this.finishMatch()
      if (match.config.modeId === 'tutorial') {
        const learner = match.players.find((p) => p.id === this.youId)
        if (learner && learner.stats.elims > 0 && match.status === 'playing') match.endNow()
      }
      const level = match.status === 'sudden' ? 3 : match.finalPhase ? 2 : match.status === 'countdown' ? 0 : 1
      this.audio.update(DT, this.screen === 'match' ? level : 0)
      return
    }
    this.audio.update(DT, 0)
    if (!this.session || this.screen !== 'match') {
      if (this.attract.status === 'finished' || this.attract.status === 'celebrate') {
        this.attract = new Match(attractConfig((this.attract.config.seed + 1) >>> 0))
      }
      this.attract.silent = true
      this.attract.step()
    }
  }

  private draw(): void {
    const prefs = this.prefs()
    const alpha = clamp(this.acc / DT, 0, 1)
    const menu = this.screen !== 'match' && this.screen !== 'results'
    const bias = menu ? Math.min(220, window.innerWidth * 0.18) : 0
    if (this.highlight) {
      this.renderer.draw(this.highlight, alpha, prefs, 0, this.youId)
      return
    }
    if (this.session && (this.screen === 'match' || this.screen === 'results')) {
      const match = this.session.match
      // After a forfeit the match stops stepping, so blending would shake the results backdrop.
      this.renderer.draw(match, this.paused || this.screen === 'results' ? 1 : alpha, prefs, 0, this.youId)
      if (this.screen === 'match') {
        this.shell.syncHud(match, this.youId, this.hint(match))
        const you = match.players.find((p) => p.id === this.youId)
        document.body.dataset.out = you && !you.alive && you.eliminated ? 'yes' : ''
        if (you) this.syncTouch(you)
      }
      return
    }
    this.renderer.draw(this.attract, alpha, { ...prefs, shake: 0 }, bias, '')
  }

  private play(options: PlayOptions): void {
    this.transition(() => this.begin(options))
  }

  private begin(options: PlayOptions): void {
    this.audio.resume()
    const earlyClassic = this.profile.matches < 2 && options.modeId === 'ffa' && options.arenaId === 'random'
    const tuned = earlyClassic ? { ...options, arenaId: 'classic' } : options
    this.lastOptions = tuned
    this.outcome = null
    this.settled = false
    this.paused = false
    this.highlight = null
    this.youId = 'you'
    this.lastElim = null
    this.finaleShown = false
    this.renderer.reset()
    this.input.reset()
    this.resetStick()
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
    this.shell.onMenu = () => this.leaveMatch(true)
  }

  private finishMatch(toMenu = false): void {
    if (!this.session || this.settled) return
    this.settled = true
    const result = this.session.match.toResult(this.youId)
    this.lastResult = result
    this.outcome = settle(this.profile, result)
    this.profile = this.outcome.profile
    this.profile.tutorialDone = true
    saveProfile(this.profile)
    const you = result.placements.find((p) => p.id === this.youId)
    if (you?.place === 1) {
      this.audio.win()
      this.renderer.confetti([you.color, '#ffc14d', '#ff4d3a', '#7ee0ff', '#f4f7fb'])
    } else this.audio.lose()
    if (toMenu) {
      this.transition(() => {
        this.session = null
        this.show('menu')
      })
    } else this.show('results')
  }

  /** Ends the match early. `toMenu` settles it and skips the results screen. */
  private leaveMatch(toMenu = false): void {
    const match = this.session?.match
    if (match && match.status !== 'finished' && match.status !== 'celebrate') {
      const you = match.players.find((p) => p.id === this.youId)
      // Untimed modes have no other way out, so leaving ranks the field instead of forfeiting.
      const untimed = match.config.duration <= 0
      if (you?.alive && !untimed) match.forfeit(this.youId)
      else match.endNow()
      this.finishMatch(toMenu)
      return
    }
    this.transition(() => {
      this.session = null
      this.show('menu')
    })
  }

  private show(screen: 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings' | 'results'): void {
    this.screen = screen
    document.body.dataset.mode = screen === 'results' ? 'results' : 'menu'
    document.body.dataset.out = ''
    hudRoot.hidden = true
    this.paused = false
    if (screen === 'menu') {
      this.shell.showMenu(this.profile, this.notices)
      this.notices = []
    }
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
    const touch = window.matchMedia('(pointer: coarse)').matches
    const keys = touch
      ? { steer: 'Touch and drag anywhere on the left to steer', dash: 'Tap DASH to burst forward', ability: 'the ability button', brake: 'BRAKE slows you' }
      : { steer: 'WASD to steer', dash: 'Space dashes', ability: 'F', brake: 'Shift brakes' }
    if (!taught.move && Math.hypot(you.vx, you.vy) < 40) return `${keys.steer}. You keep your speed when you let go.`
    if (!taught.move) taught.move = true
    if (!taught.land && you.stats.survival < 2) return 'Landings give a burst if you are holding a direction.'
    if (you.sinceLand < 0.05) taught.land = true
    if (!taught.speed && you.stats.maxSpeed < 360) return 'Speed is power. Build it, then commit to the hit.'
    if (you.stats.maxSpeed >= 360) taught.speed = true
    if (!taught.dash && you.stats.dashes < 1) return `${keys.dash}. Time it as you land for a perfect dash.`
    if (you.stats.dashes > 0) taught.dash = true
    if (!taught.ability && you.stats.abilityUses < 1) return `${abilityById(you.ability).name} is ${keys.ability}. It is a decision, not a stat.`
    if (you.stats.abilityUses > 0) taught.ability = true
    if (!taught.edge && you.edgeDist < 110) return `The edge is out. ${keys.brake}. Dash back toward the floor.`
    if (you.stats.escapes > 0) taught.edge = true
    if (!taught.heat && you.heat >= 25) return 'Heat (the % by your name) rises with every hit you take. Hotter balls fly farther.'
    if (you.heat >= 25 && you.stats.survival > 3) taught.heat = true
    if (!taught.di && you.heat >= 60) return 'Getting launched? Steer sideways as you are hit to bend the launch away from the edge.'
    if (you.heat >= 60 && you.stats.damageTaken > 1500) taught.di = true
    if (!taught.hit && you.stats.hits < 1) return 'A faster ball launches a slower one. Angle it toward the edge.'
    if (you.stats.hits > 0) taught.hit = true
    return ''
  }

  private readFx(match: Match): void {
    const events = match.consumeFx()
    this.renderer.absorb(events, this.prefs(), this.youId, match)
    const view = match.arena.view || 560
    for (const e of events) {
      const local = e.actorId === this.youId || e.victimId === this.youId
      this.audio.fx(e, local, clamp(e.x / view, -1, 1) * 0.7)
      if (local && !match.silent && !this.highlight) this.feel(e)
      if (e.type === 'elim') {
        const victim = match.players.find((p) => p.id === e.victimId)
        this.lastElim = { x: e.x, y: e.y, color: victim?.color ?? e.color, time: match.time }
      }
    }
  }

  /** The knockout that decides the match gets the slow-motion finish. */
  private watchFinale(match: Match): void {
    if (this.finaleShown || match.status !== 'celebrate') return
    this.finaleShown = true
    const ko = this.lastElim
    if (ko && match.time - ko.time < 0.5) {
      this.renderer.finale(ko.x, ko.y, ko.color, this.prefs())
      this.audio.finish()
    }
  }

  /** Haptics for things that happened to or by the local ball: phone vibration and pad rumble. */
  private feel(e: { type: string; power: number; victimId: string }): void {
    if (!this.profile.settings.haptics) return
    const k = Math.min(1, e.power / 800)
    let ms = 0
    let strong = 0
    let weak = 0
    if (e.type === 'hit' && e.power > 160) {
      ms = 25 + k * 70
      strong = 0.2 + k * 0.7
      weak = 0.35 + k * 0.4
    } else if (e.type === 'elim') {
      ms = e.victimId === this.youId ? 260 : 160
      strong = 1
      weak = 0.6
    } else if (e.type === 'dash') {
      ms = 18
      weak = 0.35
    } else if (e.type === 'boom') {
      ms = 90
      strong = 0.6
      weak = 0.3
    }
    if (!ms) return
    this.input.rumble(0, strong, weak, ms)
    if (navigator.vibrate && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(Math.round(Math.min(ms, 60)))
  }

  /** Start pauses; in menus the stick and d-pad move focus, A presses, B goes back. */
  private pollPad(): void {
    const presses = this.input.padPresses(0)
    if (presses.size === 0) return
    this.audio.resume()
    if (this.screen === 'match') {
      if (presses.has('start')) {
        this.togglePause()
        return
      }
      if (!this.paused) return
      if (presses.has('b')) {
        this.togglePause()
        return
      }
    }
    if (this.highlight) return
    const buttons = [...uiRoot.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter((b) => b.offsetParent !== null)
    if (!buttons.length) return
    const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1
    const move = (d: number) => {
      const next = buttons[current < 0 ? 0 : (current + d + buttons.length) % buttons.length]!
      next.focus()
      next.scrollIntoView({ block: 'nearest' })
      this.audio.hover()
    }
    if (presses.has('down') || presses.has('right')) move(1)
    else if (presses.has('up') || presses.has('left')) move(-1)
    if (presses.has('a')) (current >= 0 ? buttons[current]! : buttons[0]!).click()
    if (presses.has('b')) uiRoot.querySelector<HTMLButtonElement>('button.back')?.click()
    if (presses.has('start') && (this.screen === 'menu' || this.screen === 'play')) this.play(this.optionsFrom(this.shell.draft))
    if (presses.has('start') && this.screen === 'results' && this.lastOptions) this.play(this.lastOptions)
  }

  /** Cooldown sweeps on the touch buttons. */
  private syncTouch(you: Body): void {
    if (!this.touch) return
    const dash = you.dashCdMax <= 0 ? 1 : 1 - Math.min(1, you.dashCd / you.dashCdMax)
    const ability = you.abilityCdMax <= 0 ? 1 : 1 - Math.min(1, you.abilityCd / you.abilityCdMax)
    this.touch.dash.style.setProperty('--p', dash.toFixed(3))
    this.touch.dash.classList.toggle('ready', you.dashCd <= 0)
    this.touch.ability.style.setProperty('--p', ability.toFixed(3))
    this.touch.ability.classList.toggle('ready', you.abilityCd <= 0)
    const name = abilityById(you.ability).name.toUpperCase()
    if (this.touch.ability.textContent !== name) this.touch.ability.textContent = name
  }

  private prefs() {
    return {
      shake: this.profile.settings.shake,
      fx: this.profile.settings.fx,
      colorblind: this.profile.settings.colorblind,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      numbers: this.profile.settings.numbers,
      flashes: this.profile.settings.flashes,
    }
  }

  /** Iris wipe between menu and match. Runs the swap while the screen is covered. */
  private transition(run: () => void): void {
    const wipe = document.querySelector('#wipe') as HTMLElement | null
    if (!wipe || this.wiping || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!this.wiping) run()
      return
    }
    this.wiping = true
    wipe.className = 'in'
    window.setTimeout(() => {
      run()
      wipe.className = 'out'
      window.setTimeout(() => {
        wipe.className = ''
        this.wiping = false
      }, 420)
    }, 300)
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
    this.shell.onTwist = () => {
      const twist = dailyTwist()
      this.play({ modeId: twist.modeId, arenaId: twist.arenaId, competitive: false, players: 0, mutators: twist.mutators })
    }
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
    this.shell.onReroll = (id) => {
      const next = rerollChallenge(this.profile, id)
      if (!next) return
      this.audio.click()
      this.profile = next
      saveProfile(this.profile)
      this.shell.showCareer(this.profile)
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
    this.input.deadzone = this.profile.settings.deadzone
    this.audio.setVolumes(this.profile.settings.volume, this.profile.settings.music)
  }

  private touch: { dash: HTMLButtonElement; ability: HTMLButtonElement } | null = null
  private resetStick: () => void = () => {}

  /**
   * Floating stick: a touch anywhere in the left zone plants the stick under the thumb, so the
   * player never has to find a fixed circle. Buttons capture the pointer, so a thumb that slides
   * a little off a button keeps it held.
   */
  private bindTouch(): void {
    const zone = document.querySelector('#stick-zone') as HTMLElement
    const stick = document.querySelector('#stick') as HTMLElement
    const knob = document.querySelector('#knob') as HTMLElement
    const dash = document.querySelector('#btn-dash') as HTMLButtonElement
    const ability = document.querySelector('#btn-ability') as HTMLButtonElement
    const brake = document.querySelector('#btn-brake') as HTMLButtonElement
    this.touch = { dash, ability }
    let owner = -1
    let cx = 0
    let cy = 0
    const reach = 54
    const set = (e: PointerEvent) => {
      const x = e.clientX - cx
      const y = e.clientY - cy
      const m = Math.hypot(x, y)
      // 12% dead spot so a resting thumb does not drift.
      const k = m < reach * 0.12 ? 0 : Math.min(1, m / reach)
      this.input.stick.x = m > 0 ? (x / m) * k : 0
      this.input.stick.y = m > 0 ? (y / m) * k : 0
      this.input.stick.active = true
      knob.style.transform = `translate(${this.input.stick.x * 36}px, ${this.input.stick.y * 36}px)`
    }
    zone.addEventListener('pointerdown', (e) => {
      if (owner !== -1) return
      e.preventDefault()
      owner = e.pointerId
      zone.setPointerCapture(e.pointerId)
      cx = e.clientX
      cy = e.clientY
      stick.style.left = `${cx - 66}px`
      stick.style.top = `${cy - 66}px`
      stick.style.bottom = 'auto'
      stick.classList.add('live')
      set(e)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === owner) set(e)
    })
    const clear = (e: PointerEvent) => {
      if (e.pointerId !== owner) return
      owner = -1
      this.input.stick.active = false
      this.input.stick.x = 0
      this.input.stick.y = 0
      knob.style.transform = ''
      stick.classList.remove('live')
      stick.style.left = ''
      stick.style.top = ''
      stick.style.bottom = ''
    }
    zone.addEventListener('pointerup', clear)
    zone.addEventListener('pointercancel', clear)
    zone.addEventListener('lostpointercapture', clear)
    this.resetStick = () => {
      owner = -1
      this.input.stick.active = false
      this.input.stick.x = 0
      this.input.stick.y = 0
      knob.style.transform = ''
      stick.classList.remove('live')
      stick.style.left = ''
      stick.style.top = ''
      stick.style.bottom = ''
    }
    const hold = (button: HTMLButtonElement, key: 'touchDash' | 'touchAbility' | 'touchBrake') => {
      const down = (e: PointerEvent) => {
        e.preventDefault()
        button.setPointerCapture(e.pointerId)
        this.input[key] = true
        if (this.profile.settings.haptics && navigator.vibrate) navigator.vibrate(8)
      }
      const up = () => {
        this.input[key] = false
      }
      button.addEventListener('pointerdown', down)
      button.addEventListener('pointerup', up)
      button.addEventListener('pointercancel', up)
      button.addEventListener('lostpointercapture', up)
    }
    hold(dash, 'touchDash')
    hold(ability, 'touchAbility')
    hold(brake, 'touchBrake')
  }
}

const app = new App()
app.start()
