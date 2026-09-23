import { ABILITIES, CORES, PASSIVES, SHELLS } from '../data/tuning'
import { ARENAS, CHALLENGES, COSMETICS, MODES, rankName } from '../data/content'
import { abilityById } from '../data/tuning'
import type { MatchResult } from '../core/types'
import { levelFromXp, xpIntoLevel, type Profile } from '../progression/profile'
import type { SettleOutcome } from '../progression/settle'
import type { Match } from '../sim/match'
import type { PlayOptions } from '../game/setup'

export interface PlayDraft {
  modeId: PlayOptions['modeId']
  arenaId: string
  competitive: boolean
  players: number
  localDuo: boolean
}

type Nav = 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings'

export class Shell {
  draft: PlayDraft = { modeId: 'ffa', arenaId: 'random', competitive: false, players: 6, localDuo: false }
  onNavigate: (screen: Nav) => void = () => {}
  onPlay: (draft: PlayDraft) => void = () => {}
  onTutorial: () => void = () => {}
  onPractice: () => void = () => {}
  onRanked: () => void = () => {}
  onName: (name: string) => void = () => {}
  onLoadout: (slot: 'core' | 'shell' | 'ability' | 'passive', id: string) => void = () => {}
  onEquip: (id: string) => void = () => {}
  onBuy: (id: string) => void = () => {}
  onSettings: (partial: Partial<Profile['settings']>) => void = () => {}
  onRematch: () => void = () => {}
  onMenu: () => void = () => {}
  onHighlight: () => void = () => {}
  onPause: () => void = () => {}
  onResume: () => void = () => {}
  onForfeit: () => void = () => {}
  onEnd: () => void = () => {}

  constructor(private root: HTMLElement, private hud: HTMLElement) {}

  showMenu(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(this.brand(profile), this.goals(profile))
    const play = button('PLAY', 'play', () => this.onPlay(this.draft))
    const ranked = button('RANKED DUEL', 'ghost', () => this.onRanked())
    ranked.append(el('small', '', 'Standard ball. Your ability is the signature. Rank moves here only.'))
    const row = el('div', 'row')
    row.append(
      button('Practice', 'ghost', () => this.onPractice()),
      button('Tutorial', 'ghost', () => this.onTutorial()),
    )
    const nav = el('div', 'stack')
    for (const [id, label] of [['play', 'Modes'], ['loadout', 'Loadout'], ['career', 'Career'], ['collection', 'Collection'], ['settings', 'Settings']] as const) {
      nav.append(button(label, 'texty', () => this.onNavigate(id)))
    }
    const name = document.createElement('input')
    name.value = profile.name
    name.maxLength = 16
    name.ariaLabel = 'Player name'
    name.addEventListener('change', () => this.onName(name.value.trim().slice(0, 16) || 'Player'))
    const nameRow = el('div', 'name-row')
    nameRow.append(name)
    panel.append(play, ranked, row, nav, nameRow)
    this.root.append(panel)
  }

  showPlay(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(button('Back', 'texty', () => this.onNavigate('menu')))
    panel.append(el('h2', '', 'Queue'))
    const modes = el('div', 'grid')
    for (const mode of MODES.filter((m) => m.id !== 'tutorial')) {
      const b = button('', 'choice', () => {
        this.draft.modeId = mode.id
        this.draft.players = mode.players
        this.draft.competitive = this.draft.competitive && mode.ranked
        this.showPlay(profile)
      })
      if (this.draft.modeId === mode.id) b.classList.add('active')
      b.append(el('strong', '', mode.name), el('small', '', mode.blurb))
      modes.append(b)
    }
    const arenas = el('div', 'cards')
    for (const arena of [{ id: 'random', name: 'Random', tagline: 'Surprise', blurb: '' }, ...ARENAS]) {
      const b = button('', 'card', () => {
        this.draft.arenaId = arena.id
        this.showPlay(profile)
      })
      if (this.draft.arenaId === arena.id) b.classList.add('active')
      b.append(el('strong', '', arena.name), el('small', '', arena.tagline))
      arenas.append(b)
    }
    const count = document.createElement('input')
    count.type = 'range'
    const mode = MODES.find((m) => m.id === this.draft.modeId)!
    count.min = String(mode.minPlayers)
    count.max = String(mode.maxPlayers)
    count.value = String(this.draft.players)
    const countLabel = el('div', 'lede', `${this.draft.players} players`)
    count.addEventListener('input', () => {
      this.draft.players = Number(count.value)
      countLabel.textContent = `${this.draft.players} players`
    })
    const ranked = toggle('Ranked rules', this.draft.competitive && mode.ranked, (v) => {
      this.draft.competitive = v
    })
    const duo = toggle('Local player 2 (arrows)', this.draft.localDuo, (v) => {
      this.draft.localDuo = v
    })
    panel.append(modes, el('div', 'lede', 'Arena'), arenas, countLabel, count, ranked, duo)
    panel.append(button('START', 'play', () => this.onPlay({ ...this.draft })))
    this.root.append(panel)
  }

  showLoadout(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(button('Back', 'texty', () => this.onNavigate('menu')))
    panel.append(el('h2', '', 'Loadout'))
    panel.append(el('p', 'lede', 'Sidegrades, not upgrades. Ranked locks the ball to Stable / Rubber and turns passives off. Your ability stays.'))
    panel.append(this.pick('Ball core', CORES, profile.loadout.core, (id) => this.onLoadout('core', id)))
    panel.append(this.pick('Shell', SHELLS, profile.loadout.shell, (id) => this.onLoadout('shell', id)))
    panel.append(this.pick('Ability', ABILITIES, profile.loadout.ability, (id) => this.onLoadout('ability', id)))
    panel.append(this.pick('Passive', PASSIVES.filter((p) => p.id !== 'none'), profile.loadout.passive, (id) => this.onLoadout('passive', id)))
    this.root.append(panel)
  }

  showCareer(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(button('Back', 'texty', () => this.onNavigate('menu')))
    const lvl = xpIntoLevel(profile.accountXp)
    const rank = profile.rank.placementsLeft > 0 ? `Placement ${5 - profile.rank.placementsLeft}/5` : rankName(profile.rank.rating).label
    panel.append(el('h2', '', rank))
    panel.append(el('p', 'lede', `Peak ${profile.rank.peakLabel}. ${profile.rank.lastReason || 'Play ranked to move this.'}`))
    panel.append(el('p', 'lede', `Level ${lvl.level} · ${lvl.have}/${lvl.need} xp · ${profile.coins} coins`))
    const stats = el('div', 'stats')
    for (const [k, v] of [
      ['Matches', profile.stats.matches],
      ['Wins', profile.stats.wins],
      ['Elims', profile.stats.elims],
      ['Streak', profile.stats.bestStreak],
    ] as const) {
      const d = el('div')
      d.append(el('b', '', String(v)), el('span', '', k))
      stats.append(d)
    }
    panel.append(stats)
    panel.append(el('h3', '', 'Records'))
    panel.append(el('p', 'lede', `Launch ${profile.records.biggestLaunch.toFixed(1)} m · Speed ${Math.round(profile.records.highestSpeed)} · Multi ${profile.records.bestMulti}`))
    panel.append(el('h3', '', 'Challenges'))
    for (const id of [...profile.challenges.daily, ...profile.challenges.weekly]) {
      const def = CHALLENGES.find((c) => c.id === id)
      if (!def) continue
      const prog = profile.challenges.progress[id] ?? 0
      const done = profile.challenges.done.includes(id)
      panel.append(el('p', 'lede', `${done ? 'Done' : `${Math.min(prog, def.target)}/${def.target}`} · ${def.detail}`))
    }
    const seasonTiers = 10
    panel.append(el('p', 'lede', `Season First Orbit · tier ${profile.seasonClaimed}/${seasonTiers}`))
    this.root.append(panel)
  }

  showCollection(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(button('Back', 'texty', () => this.onNavigate('menu')))
    panel.append(el('h2', '', 'Collection'))
    panel.append(el('p', 'lede', `${profile.coins} coins. Cosmetics never change a hit.`))
    for (const item of COSMETICS) {
      const owned = profile.owned.includes(item.id)
      const equipped = profile.equipped[item.slot] === item.id
      const row = el('div', 'choice')
      row.append(el('strong', '', `${item.name}${equipped ? ' · equipped' : ''}`), el('small', '', `${item.detail} ${item.earn}`))
      if (owned) row.append(button(equipped ? 'Equipped' : 'Equip', 'ghost', () => this.onEquip(item.id)))
      else if (item.price > 0) row.append(button(`Buy ${item.price}`, 'ghost', () => this.onBuy(item.id)))
      else row.append(el('small', '', 'Earned in play'))
      panel.append(row)
    }
    this.root.append(panel)
  }

  showSettings(profile: Profile): void {
    this.root.replaceChildren()
    const panel = el('div', 'panel')
    panel.append(button('Back', 'texty', () => this.onNavigate('menu')))
    panel.append(el('h2', '', 'Settings'))
    panel.append(slider('Effects', profile.settings.volume, (v) => this.onSettings({ volume: v })))
    panel.append(slider('Music', profile.settings.music, (v) => this.onSettings({ music: v })))
    panel.append(slider('Shake', profile.settings.shake, (v) => this.onSettings({ shake: v })))
    const uiT = Math.max(0, Math.min(1, (profile.settings.uiScale - 0.85) / 0.4))
    panel.append(slider('UI scale', uiT, (v) => this.onSettings({ uiScale: 0.85 + v * 0.4 })))
    panel.append(toggle('Reduced effects', profile.settings.fx === 'reduced', (v) => this.onSettings({ fx: v ? 'reduced' : 'full' })))
    panel.append(toggle('Stronger patterns', profile.settings.colorblind, (v) => this.onSettings({ colorblind: v })))
    panel.append(toggle('Mouse steer', profile.settings.mouseSteer, (v) => this.onSettings({ mouseSteer: v })))
    panel.append(toggle('Haptics', profile.settings.haptics, (v) => this.onSettings({ haptics: v })))
    panel.append(toggle('Speed numbers', profile.settings.numbers, (v) => this.onSettings({ numbers: v })))
    panel.append(button('Fullscreen', 'ghost', () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen()
    }))
    panel.append(el('p', 'lede', 'WASD steer · Space dash · F ability · Shift brake · G emote. Player 2: arrows, Enter dash, Right Ctrl ability, Right Shift brake.'))
    this.root.append(panel)
  }

  showResults(profile: Profile, outcome: SettleOutcome, result: MatchResult): void {
    this.root.replaceChildren()
    const card = el('div', 'results')
    const you = result.placements.find((p) => p.id === result.youId)
    const place = you?.place ?? 1
    card.append(el('div', 'place', placeLabel(place)))
    card.append(el('div', 'lede', you?.name ?? profile.name))
    if (you) {
      card.append(el('div', 'lede', `${you.elims} eliminations · ${you.deaths} falls · ${Math.round(you.survival)}s alive · best hit ${Math.round(you.bestImpact)}`))
    }
    const moment = result.moments[0]
    if (moment) {
      const box = el('div', 'moment')
      box.append(el('b', '', moment.title), el('div', '', moment.detail))
      card.append(box)
    } else if (outcome.records[0]) {
      const box = el('div', 'moment')
      box.append(el('b', '', 'NEW RECORD'), el('div', '', outcome.records[0]))
      card.append(box)
    }
    const board = el('div', 'board')
    for (const p of [...result.placements].sort((a, b) => a.place - b.place)) {
      const row = el('div', `slot${p.id === result.youId ? ' on' : ''}`)
      const sw = el('i', 'swatch')
      sw.style.background = p.color
      row.append(sw, el('span', '', p.name), el('span', '', `#${p.place}`))
      board.append(row)
    }
    card.append(board)
    if (outcome.grants[0]) card.append(el('div', 'grant', `${outcome.grants[0].name} · ${outcome.grants[0].detail}`))
    card.append(el('div', 'lede', `+${outcome.xpGained} xp · +${outcome.coinsGained} coins`))
    if (result.competitive) card.append(el('div', 'lede', outcome.rankReason))
    else card.append(el('div', 'lede', 'Casual. Your rank did not change.'))
    const changed = outcome.challenges.filter((c) => c.progress > 0)
    for (const c of changed.slice(0, 3)) card.append(el('div', 'lede', `${c.name} · ${Math.min(c.progress, c.target)}/${c.target}`))
    const row = el('div', 'row')
    row.append(button('REMATCH', 'play small', () => this.onRematch()))
    row.append(button('Highlight', 'ghost', () => this.onHighlight()))
    row.append(button('Menu', 'ghost', () => this.onMenu()))
    card.append(row)
    void profile
    this.root.append(card)
  }

  showPause(): void {
    const existing = this.root.querySelector('.overlay')
    if (existing) return
    const overlay = el('div', 'overlay')
    const sheet = el('div', 'sheet')
    sheet.append(el('h2', '', 'Paused'))
    sheet.append(button('Resume', 'play small', () => this.onResume()))
    sheet.append(button('End match', 'ghost', () => this.onForfeit()))
    sheet.append(button('Menu', 'ghost', () => this.onMenu()))
    overlay.append(sheet)
    this.root.append(overlay)
  }

  hidePause(): void {
    this.root.querySelector('.overlay')?.remove()
  }

  mountHud(): void {
    this.hud.replaceChildren()
    const top = el('div', 'hud-top')
    top.append(el('div', 'phase'), el('div', 'timer'))
    const left = el('div', 'hud-left')
    const feed = el('div', 'hud-feed')
    const banner = el('div', 'banner')
    const hint = el('div', 'hint', '')
    hint.hidden = true
    const bottom = el('div', 'hud-bottom')
    const meter = el('div', 'meter')
    const fill = document.createElement('i')
    const label = el('span')
    label.append(el('b', '', 'MOMENTUM'), el('b', '', '0'))
    meter.append(fill, label)
    const cds = el('div', 'cooldowns')
    const dash = el('div', 'cd')
    dash.append(el('b', '', 'DASH'), el('i'))
    const ability = el('div', 'cd')
    ability.append(el('b', '', 'ABILITY'), el('i'))
    cds.append(dash, ability)
    bottom.append(meter, cds)
    const pause = document.createElement('button')
    pause.type = 'button'
    pause.className = 'pause'
    pause.textContent = 'PAUSE'
    pause.addEventListener('click', () => {
      if (pause.dataset.act === 'end') this.onEnd()
      else this.onPause()
    })
    this.hud.append(top, left, feed, banner, hint, bottom, pause)
  }

  syncHud(match: Match, youId: string, hint: string): void {
    const you = match.players.find((p) => p.id === youId) ?? match.players[0]
    if (!you) return
    const phase = this.hud.querySelector('.phase')
    const timer = this.hud.querySelector('.timer')
    if (phase && timer) {
      phase.textContent = match.status === 'sudden' ? 'SUDDEN DEATH' : match.finalPhase ? 'FINAL PHASE' : match.status === 'countdown' ? 'READY' : ''
      if (match.config.duration <= 0) timer.textContent = '∞'
      else if (match.status === 'sudden') timer.textContent = String(Math.ceil(match.suddenLeft))
      else timer.textContent = String(Math.max(0, Math.ceil(match.config.duration - match.time)))
    }
    const left = this.hud.querySelector('.hud-left')
    if (left) {
      left.replaceChildren()
      const rows = [...match.players].sort((a, b) => a.placement - b.placement || b.stats.score - a.stats.score || b.stocks - a.stocks)
      for (const p of rows) {
        const slot = el('div', `slot${p.id === you.id ? ' on' : ''}`)
        const sw = el('i', 'swatch')
        sw.style.background = p.color
        slot.append(sw, el('span', '', `${p.name}${p.eliminated ? ' · out' : ''}`), el('span', '', p.eliminated ? `#${p.placement}` : `${p.stocks}`))
        left.append(slot)
      }
    }
    const feed = this.hud.querySelector('.hud-feed')
    if (feed) {
      feed.replaceChildren()
      for (const item of match.feed) {
        const line = el('div', '', item.text)
        line.style.color = item.color
        feed.append(line)
      }
    }
    const banner = this.hud.querySelector('.banner')
    if (banner) {
      banner.replaceChildren()
      if (match.banner) {
        banner.append(el('strong', '', match.banner.text), el('em', '', match.banner.sub))
      }
    }
    const hintEl = this.hud.querySelector('.hint') as HTMLElement | null
    if (hintEl) {
      hintEl.hidden = !hint
      hintEl.textContent = hint
    }
    const fill = this.hud.querySelector('.meter i') as HTMLElement | null
    const nums = this.hud.querySelectorAll('.meter b')
    const momentum = you.alive ? you.momentum : 0
    if (fill) fill.style.width = `${Math.round(momentum * 100)}%`
    if (nums[1]) nums[1].textContent = String(Math.round(momentum * 100))
    const cds = this.hud.querySelectorAll('.cd')
    paintCd(cds[0], 'DASH', you.dashCd, you.dashCdMax)
    const ability = abilityById(you.ability)
    paintCd(cds[1], ability.name.toUpperCase(), you.abilityCd, you.abilityCdMax)
    const pause = this.hud.querySelector('.pause') as HTMLButtonElement | null
    if (pause) {
      const out = !you.alive && you.eliminated
      pause.dataset.act = out ? 'end' : 'pause'
      pause.textContent = out ? 'RESULTS' : 'PAUSE'
    }
  }

  private brand(profile: Profile): HTMLElement {
    const wrap = el('div')
    const mark = el('div', 'mark')
    const b = document.createElement('b')
    b.innerHTML = '<span>BOUNCE</span><br>ARENA'
    mark.append(b, el('em', '', 'SPEED IS POWER'))
    const rank = profile.rank.placementsLeft > 0 ? 'UNRANKED' : rankName(profile.rank.rating).label
    const chip = el('div', 'rank-chip', rank)
    wrap.append(mark, chip)
    return wrap
  }

  private goals(profile: Profile): HTMLElement {
    const box = el('div', 'goals')
    const lvl = levelFromXp(profile.accountXp)
    box.append(el('div', '', `Level ${lvl}`))
    const next = profile.challenges.daily[0]
    const def = CHALLENGES.find((c) => c.id === next)
    if (def) box.append(el('div', '', def.detail))
    return box
  }

  private pick<T extends { id: string; name: string; blurb: string }>(title: string, items: T[], current: string, choose: (id: string) => void): HTMLElement {
    const wrap = el('div', 'stack')
    wrap.append(el('div', 'lede', title))
    for (const item of items) {
      const b = button('', 'choice', () => choose(item.id))
      if (item.id === current) b.classList.add('active')
      b.append(el('strong', '', item.name), el('small', '', item.blurb))
      wrap.append(b)
    }
    return wrap
  }
}

function paintCd(node: Element | undefined, name: string, cd: number, max: number): void {
  if (!node) return
  const title = node.querySelector('b')
  const bar = node.querySelector('i span') as HTMLElement | null
  let inner = node.querySelector('i span') as HTMLElement | null
  if (!inner) {
    const host = node.querySelector('i')
    if (host) {
      inner = document.createElement('span')
      host.append(inner)
    }
  }
  if (title) title.textContent = cd <= 0 ? `${name} READY` : name
  node.classList.toggle('ready', cd <= 0)
  const pct = max <= 0 ? 1 : 1 - Math.min(1, cd / max)
  if (inner) inner.style.width = `${pct * 100}%`
  void bar
}

function placeLabel(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}TH`
  if (n % 10 === 1) return `${n}ST`
  if (n % 10 === 2) return `${n}ND`
  if (n % 10 === 3) return `${n}RD`
  return `${n}TH`
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.textContent = text
  node.addEventListener('click', onClick)
  return node
}

function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = el('label', 'choice')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value
  input.addEventListener('change', () => onChange(input.checked))
  row.append(input, document.createTextNode(' ' + label))
  return row
}

function slider(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('label', 'stack')
  const text = el('span', '', `${label} ${Math.round(value * 100)}`)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    text.textContent = `${label} ${Math.round(v * 100)}`
    onChange(v)
  })
  wrap.append(text, input)
  return wrap
}
