import { ABILITIES, CORES, PASSIVES, SHELLS } from '../data/tuning'
import { ARENAS, CHALLENGES, COSMETICS, MODES, SEASON, rankName, type ArenaDef, type CosmeticDef } from '../data/content'
import { abilityById } from '../data/tuning'
import type { MatchResult } from '../core/types'
import { xpIntoLevel, type Profile } from '../progression/profile'
import type { SettleOutcome } from '../progression/settle'
import { solidPose } from '../sim/geometry'
import type { FeedItem, Banner, Match } from '../sim/match'
import type { PlayOptions } from '../game/setup'

export interface PlayDraft {
  modeId: PlayOptions['modeId']
  arenaId: string
  competitive: boolean
  players: number
  localDuo: boolean
}

type Nav = 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings'

const MODE_TAG: Record<string, string> = {
  ffa: 'FFA',
  team: 'TEAM',
  score: 'PTS',
  king: 'KING',
  survivor: '1UP',
  chaos: 'CHAOS',
  duel: '1V1',
  practice: 'FREE',
}

const MODE_COLOR: Record<string, string> = {
  ffa: '#ff4d3a',
  team: '#4cc9ff',
  score: '#ffc14d',
  king: '#b388ff',
  survivor: '#3ee6a0',
  chaos: '#ff6b9a',
  duel: '#f4f7fb',
  practice: '#93a0b4',
}

const SLOT_NAME: Record<CosmeticDef['slot'], string> = {
  trail: 'Trails',
  impact: 'Impacts',
  emote: 'Emotes',
  banner: 'Banners',
  title: 'Titles',
  frame: 'Frames',
  skin: 'Skins',
}

interface HudRefs {
  phase: HTMLElement
  timer: HTMLElement
  left: HTMLElement
  roster: HTMLElement
  feed: HTMLElement
  banner: HTMLElement
  callout: HTMLElement
  hint: HTMLElement
  spectate: HTMLElement
  gauge: HTMLElement
  gaugeArc: SVGCircleElement
  gaugeNum: HTMLElement
  dash: HTMLElement
  dashArc: SVGCircleElement
  ability: HTMLElement
  abilityArc: SVGCircleElement
  abilityName: HTMLElement
  pause: HTMLButtonElement
}

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

  private refs: HudRefs | null = null
  private rosterKey = ''
  private feedNodes = new WeakMap<FeedItem, HTMLElement>()
  private lastBanner: Banner | null = null
  private lastLeft = 0
  private dashReady = true
  private abilityReady = true
  private current = ''
  private rematchKey: (() => void) | null = null

  constructor(private root: HTMLElement, private hud: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || e.repeat) return
      const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text'
      if (typing) return
      if (this.current === 'menu') this.onPlay(this.draft)
      else if (this.current === 'play') this.onPlay({ ...this.draft })
      else if (this.current === 'results') this.rematchKey?.()
    })
  }

  showMenu(profile: Profile): void {
    const panel = this.screen('menu')
    panel.append(this.brand())
    panel.append(this.profileCard(profile))

    const play = button('', 'play big', () => this.onPlay(this.draft))
    play.append(el('span', '', 'PLAY'), el('kbd', '', 'ENTER'))
    const mode = MODES.find((m) => m.id === this.draft.modeId)
    const arena = ARENAS.find((a) => a.id === this.draft.arenaId)
    play.append(el('small', '', `${mode?.name ?? 'Free-for-All'} · ${arena?.name ?? 'Random arena'} · ${this.draft.players} players`))

    const ranked = button('', 'tile ranked', () => this.onRanked())
    ranked.append(el('strong', '', 'Ranked Duel'), el('small', '', 'Standard ball. Your ability is the signature.'))
    const row = el('div', 'row')
    const practice = button('', 'tile', () => this.onPractice())
    practice.append(el('strong', '', 'Practice'), el('small', '', 'Bots respawn, no clock'))
    const tutorial = button('', 'tile', () => this.onTutorial())
    tutorial.append(el('strong', '', 'Tutorial'), el('small', '', 'Learn the hit'))
    row.append(practice, tutorial)

    const nav = el('nav', 'nav')
    for (const [id, label, sub] of [
      ['play', 'Modes', 'Pick a mode and arena'],
      ['loadout', 'Loadout', abilityById(profile.loadout.ability).name],
      ['career', 'Career', `${profile.stats.wins} wins`],
      ['collection', 'Collection', `${profile.coins} coins`],
      ['settings', 'Settings', 'Audio, effects, controls'],
    ] as const) {
      const b = button('', 'nav-item', () => this.onNavigate(id))
      b.append(el('span', '', label), el('small', '', sub), el('i', 'chev'))
      nav.append(b)
    }

    const nameRow = el('label', 'name-row')
    const name = document.createElement('input')
    name.type = 'text'
    name.value = profile.name
    name.maxLength = 16
    name.ariaLabel = 'Player name'
    name.addEventListener('change', () => this.onName(name.value.trim().slice(0, 16) || 'Player'))
    name.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') name.blur()
    })
    nameRow.append(el('span', '', 'Name'), name)
    panel.append(play, ranked, row, nav, nameRow)
    this.stagger(panel)
  }

  showPlay(profile: Profile): void {
    const panel = this.screen('play', 'wide')
    panel.append(this.header('Queue', 'Pick a mode, then an arena.'))
    const modes = el('div', 'grid')
    for (const mode of MODES.filter((m) => m.id !== 'tutorial')) {
      const b = button('', 'mode', () => {
        this.draft.modeId = mode.id
        this.draft.players = mode.players
        this.draft.competitive = this.draft.competitive && mode.ranked
        this.showPlay(profile)
      })
      b.style.setProperty('--tone', MODE_COLOR[mode.id] ?? '#ff4d3a')
      if (this.draft.modeId === mode.id) b.classList.add('active')
      const meta = mode.respawn === 'always' ? 'Endless' : `${mode.stocks} stock${mode.stocks === 1 ? '' : 's'}`
      b.append(el('b', 'tag', MODE_TAG[mode.id] ?? mode.id.toUpperCase()), el('strong', '', mode.name), el('small', '', mode.blurb), el('em', '', `${mode.minPlayers}-${mode.maxPlayers} players · ${meta}`))
      modes.append(b)
    }
    panel.append(modes)

    panel.append(el('div', 'section', 'Arena'))
    const arenas = el('div', 'arenas')
    for (const arena of [null, ...ARENAS]) {
      const id = arena?.id ?? 'random'
      const b = button('', 'arena', () => {
        this.draft.arenaId = id
        this.showPlay(profile)
      })
      if (this.draft.arenaId === id) b.classList.add('active')
      b.append(arenaThumb(arena), el('strong', '', arena?.name ?? 'Random'), el('small', '', arena?.tagline ?? 'Surprise me'))
      arenas.append(b)
    }
    panel.append(arenas)

    const mode = MODES.find((m) => m.id === this.draft.modeId)!
    const opts = el('div', 'options')
    const count = document.createElement('input')
    count.type = 'range'
    count.min = String(mode.minPlayers)
    count.max = String(mode.maxPlayers)
    count.value = String(this.draft.players)
    const countLabel = el('b', '', String(this.draft.players))
    const paint = () => count.style.setProperty('--fill', `${((Number(count.value) - mode.minPlayers) / Math.max(1, mode.maxPlayers - mode.minPlayers)) * 100}%`)
    paint()
    count.addEventListener('input', () => {
      this.draft.players = Number(count.value)
      countLabel.textContent = String(this.draft.players)
      paint()
    })
    const countRow = el('label', 'slider')
    const head = el('span', '')
    head.append(document.createTextNode('Players '), countLabel)
    countRow.append(head, count)
    opts.append(countRow)
    if (mode.ranked) {
      opts.append(toggle('Ranked rules', 'Standard ball, rank moves', this.draft.competitive, (v) => {
        this.draft.competitive = v
      }))
    }
    opts.append(toggle('Local player 2', 'Arrows, Enter, Right Ctrl', this.draft.localDuo, (v) => {
      this.draft.localDuo = v
    }))
    panel.append(opts)
    const start = button('', 'play sticky', () => this.onPlay({ ...this.draft }))
    start.append(el('span', '', 'START'), el('kbd', '', 'ENTER'))
    panel.append(start)
    this.stagger(panel)
  }

  showLoadout(profile: Profile): void {
    const panel = this.screen('loadout', 'wide')
    panel.append(this.header('Loadout', 'Sidegrades, not upgrades. Ranked locks the ball to Stable / Rubber and turns passives off. Your ability stays.'))
    panel.append(this.pick('Ability', 'F', ABILITIES, profile.loadout.ability, (id) => this.onLoadout('ability', id)))
    panel.append(this.pick('Ball core', '', CORES, profile.loadout.core, (id) => this.onLoadout('core', id)))
    panel.append(this.pick('Shell', '', SHELLS, profile.loadout.shell, (id) => this.onLoadout('shell', id)))
    panel.append(this.pick('Passive', '', PASSIVES.filter((p) => p.id !== 'none'), profile.loadout.passive, (id) => this.onLoadout('passive', id)))
    this.stagger(panel)
  }

  showCareer(profile: Profile): void {
    const panel = this.screen('career', 'wide')
    const lvl = xpIntoLevel(profile.accountXp)
    const placing = profile.rank.placementsLeft > 0
    const rank = placing ? `Placement ${5 - profile.rank.placementsLeft}/5` : rankName(profile.rank.rating).label
    panel.append(this.header('Career', ''))
    const hero = el('div', 'hero')
    const badge = el('div', 'rank-badge', placing ? '?' : rank.split(' ')[0]!.slice(0, 1))
    const info = el('div', '')
    info.append(el('b', 'rank-title', rank), el('small', '', `Peak ${profile.rank.peakLabel}. ${profile.rank.lastReason || 'Play ranked to move this.'}`))
    info.append(bar(lvl.have / lvl.need, `Level ${lvl.level}`, `${lvl.have} / ${lvl.need} xp`))
    hero.append(badge, info)
    panel.append(hero)

    const stats = el('div', 'stats')
    for (const [k, v] of [
      ['Matches', profile.stats.matches],
      ['Wins', profile.stats.wins],
      ['Knockouts', profile.stats.elims],
      ['Best streak', profile.stats.bestStreak],
    ] as const) {
      const d = el('div', 'stat')
      d.append(el('b', '', String(v)), el('span', '', k))
      stats.append(d)
    }
    panel.append(stats)

    panel.append(el('div', 'section', 'Records'))
    const records = el('div', 'stats')
    for (const [k, v] of [
      ['Longest launch', `${profile.records.biggestLaunch.toFixed(1)} m`],
      ['Top speed', String(Math.round(profile.records.highestSpeed))],
      ['Best multi-KO', String(profile.records.bestMulti)],
      ['Coins', String(profile.coins)],
    ] as const) {
      const d = el('div', 'stat')
      d.append(el('b', '', v), el('span', '', k))
      records.append(d)
    }
    panel.append(records)

    panel.append(el('div', 'section', 'Challenges'))
    const list = el('div', 'stack')
    for (const id of [...profile.challenges.daily, ...profile.challenges.weekly]) {
      const def = CHALLENGES.find((c) => c.id === id)
      if (!def) continue
      const prog = Math.min(profile.challenges.progress[id] ?? 0, def.target)
      const done = profile.challenges.done.includes(id)
      const row = el('div', `challenge${done ? ' done' : ''}`)
      row.append(el('b', 'tag', def.cadence === 'daily' ? 'DAY' : 'WEEK'))
      const body = el('div', '')
      body.append(bar(done ? 1 : prog / def.target, def.name, done ? 'Done' : `${prog}/${def.target}`), el('small', '', `${def.detail} · ${def.coins} coins`))
      row.append(body)
      list.append(row)
    }
    panel.append(list)

    panel.append(el('div', 'section', `Season · ${SEASON.name}`))
    const track = el('div', 'season')
    SEASON.tiers.forEach((tier, i) => {
      const pip = el('div', `tier${i < profile.seasonClaimed ? ' got' : ''}`)
      pip.title = `${tier.name} · ${tier.xp} xp`
      pip.append(el('b', '', String(i + 1)), el('small', '', tier.name))
      track.append(pip)
    })
    panel.append(track)
    this.stagger(panel)
  }

  showCollection(profile: Profile): void {
    const panel = this.screen('collection', 'wide')
    const head = this.header('Collection', 'Cosmetics never change a hit.')
    head.append(el('div', 'coins', String(profile.coins)))
    panel.append(head)
    const slots = [...new Set(COSMETICS.map((c) => c.slot))]
    for (const slot of slots) {
      panel.append(el('div', 'section', SLOT_NAME[slot]))
      const grid = el('div', 'grid three')
      for (const item of COSMETICS.filter((c) => c.slot === slot)) {
        const owned = profile.owned.includes(item.id)
        const equipped = profile.equipped[item.slot] === item.id
        const card = el('div', `item${equipped ? ' active' : ''}${owned ? '' : ' locked'}`)
        card.append(el('strong', '', item.name), el('small', '', item.detail))
        if (owned) card.append(button(equipped ? 'Equipped' : 'Equip', `chip${equipped ? ' on' : ''}`, () => this.onEquip(item.id)))
        else if (item.price > 0) {
          const buy = button('', `chip buy${profile.coins < item.price ? ' short' : ''}`, () => this.onBuy(item.id))
          buy.append(el('i', 'coin'), document.createTextNode(String(item.price)))
          card.append(buy)
        } else card.append(el('em', '', item.earn))
        grid.append(card)
      }
      panel.append(grid)
    }
    this.stagger(panel)
  }

  showSettings(profile: Profile): void {
    const panel = this.screen('settings', 'wide')
    panel.append(this.header('Settings', ''))
    panel.append(el('div', 'section', 'Audio'))
    panel.append(slider('Effects', profile.settings.volume, (v) => this.onSettings({ volume: v })))
    panel.append(slider('Music', profile.settings.music, (v) => this.onSettings({ music: v })))
    panel.append(el('div', 'section', 'Video'))
    panel.append(slider('Screen shake', profile.settings.shake, (v) => this.onSettings({ shake: v })))
    const uiT = Math.max(0, Math.min(1, (profile.settings.uiScale - 0.85) / 0.4))
    panel.append(slider('UI scale', uiT, (v) => this.onSettings({ uiScale: 0.85 + v * 0.4 })))
    panel.append(toggle('Reduced effects', 'Fewer particles, no impact frames', profile.settings.fx === 'reduced', (v) => this.onSettings({ fx: v ? 'reduced' : 'full' })))
    panel.append(toggle('Stronger patterns', 'Extra marks on every ball', profile.settings.colorblind, (v) => this.onSettings({ colorblind: v })))
    panel.append(toggle('Speed numbers', 'Show hit power', profile.settings.numbers, (v) => this.onSettings({ numbers: v })))
    panel.append(el('div', 'section', 'Controls'))
    panel.append(toggle('Mouse steer', 'Steer toward the cursor when no key is held', profile.settings.mouseSteer, (v) => this.onSettings({ mouseSteer: v })))
    panel.append(toggle('Haptics', 'Vibrate on hits (mobile)', profile.settings.haptics, (v) => this.onSettings({ haptics: v })))
    const keys = el('div', 'keys')
    for (const [action, p1, p2] of [
      ['Steer', 'W A S D', 'Arrows'],
      ['Dash', 'Space', 'Enter'],
      ['Ability', 'F', 'Right Ctrl'],
      ['Brake', 'Shift', 'Right Shift'],
      ['Emote', 'G', ''],
      ['Pause', 'Esc', ''],
    ] as const) {
      const row = el('div', '')
      row.append(el('span', '', action), kbds(p1), kbds(p2))
      keys.append(row)
    }
    panel.append(keys)
    panel.append(button('Toggle fullscreen', 'ghost', () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen()
    }))
    this.stagger(panel)
  }

  showResults(profile: Profile, outcome: SettleOutcome, result: MatchResult): void {
    this.current = 'results'
    this.root.replaceChildren()
    const card = el('div', 'results')
    const you = result.placements.find((p) => p.id === result.youId)
    const place = you?.place ?? 1
    const won = !!you?.won || place === 1
    const tone = won ? '#ffc14d' : place <= 3 ? '#7ee0ff' : '#ff4d3a'
    card.style.setProperty('--tone', tone)

    const head = el('div', 'res-head')
    head.append(el('div', 'res-kicker', won ? 'VICTORY' : result.forfeit && place === result.placements.length ? 'FORFEIT' : place <= 3 ? 'PODIUM' : 'KNOCKED OUT'))
    const placeEl = el('div', 'place', placeLabel(place))
    head.append(placeEl, el('div', 'res-name', `${you?.name ?? profile.name} · ${result.competitive ? 'Ranked' : 'Casual'}`))
    card.append(head)

    if (you) {
      const stats = el('div', 'stats')
      for (const [k, v, fmt] of [
        ['Knockouts', you.elims, ''],
        ['Falls', you.deaths, ''],
        ['Alive', Math.round(you.survival), 's'],
        ['Best hit', Math.round(you.bestImpact), ''],
      ] as const) {
        const d = el('div', 'stat')
        const b = el('b', '', '0')
        d.append(b, el('span', '', k))
        stats.append(d)
        countUp(b, v, 700, fmt)
      }
      card.append(stats)
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
      const row = el('div', `slot${p.id === result.youId ? ' on' : ''}${p.place <= 3 ? ` medal m${p.place}` : ''}`)
      const sw = el('i', 'swatch')
      sw.style.setProperty('--c', p.color)
      row.append(el('b', 'pos', String(p.place)), sw, el('span', '', p.name), el('small', '', `${p.elims} KO`))
      board.append(row)
    }
    card.append(board)

    const rewards = el('div', 'rewards')
    const before = xpIntoLevel(Math.max(0, profile.accountXp - outcome.xpGained))
    const after = xpIntoLevel(profile.accountXp)
    const xp = bar(before.have / before.need, `Level ${after.level}`, `+${outcome.xpGained} xp`)
    const fill = xp.querySelector('.fill') as HTMLElement | null
    if (fill) {
      window.setTimeout(() => {
        fill.style.width = `${(after.level > before.level ? 1 : after.have / after.need) * 100}%`
        if (after.level > before.level) {
          window.setTimeout(() => {
            fill.style.transition = 'none'
            fill.style.width = '0%'
            void fill.offsetWidth
            fill.style.transition = ''
            fill.style.width = `${(after.have / after.need) * 100}%`
            xp.classList.add('up')
          }, 650)
        }
      }, 450)
    }
    rewards.append(xp)
    const coins = el('div', 'coins', '0')
    countUp(coins, outcome.coinsGained, 900, '', '+')
    rewards.append(coins)
    card.append(rewards)
    const grants = el('div', 'grants')
    if (outcome.levelUp > 0) grants.append(el('div', 'grant', `LEVEL UP · ${after.level}`))
    for (const g of outcome.grants.slice(0, 3)) grants.append(el('div', 'grant', `${g.name} · ${g.detail}`))
    if (grants.childElementCount) card.append(grants)
    card.append(el('p', 'lede', result.competitive ? outcome.rankReason : 'Casual. Your rank did not change.'))
    const changed = outcome.challenges.filter((c) => c.progress > 0)
    for (const c of changed.slice(0, 3)) card.append(bar(Math.min(1, c.progress / c.target), c.name, c.done ? 'Done' : `${Math.min(c.progress, c.target)}/${c.target}`))

    const row = el('div', 'row actions')
    const rematch = button('', 'play', () => this.onRematch())
    rematch.append(el('span', '', 'REMATCH'), el('kbd', '', 'ENTER'))
    this.rematchKey = () => this.onRematch()
    row.append(rematch)
    row.append(button('Highlight', 'ghost', () => this.onHighlight()))
    row.append(button('Menu', 'ghost', () => this.onMenu()))
    card.append(row)
    this.root.append(card)
    this.stagger(card, 60)
  }

  showPause(): void {
    const existing = this.root.querySelector('.overlay')
    if (existing) return
    const overlay = el('div', 'overlay')
    const sheet = el('div', 'sheet')
    sheet.append(el('div', 'res-kicker', 'PAUSED'))
    const resume = button('', 'play', () => this.onResume())
    resume.append(el('span', '', 'RESUME'), el('kbd', '', 'ESC'))
    sheet.append(resume)
    sheet.append(button('End match', 'ghost', () => this.onForfeit()))
    sheet.append(button('Menu', 'ghost', () => this.onMenu()))
    sheet.append(el('p', 'lede', 'WASD steer · Space dash · F ability · Shift brake · G emote'))
    overlay.append(sheet)
    this.root.append(overlay)
  }

  hidePause(): void {
    this.root.querySelector('.overlay')?.remove()
  }

  mountHud(): void {
    this.current = 'match'
    this.hud.replaceChildren()
    this.hud.classList.remove('out')
    this.rosterKey = ''
    this.lastBanner = null
    this.lastLeft = 0
    this.dashReady = true
    this.abilityReady = true
    this.feedNodes = new WeakMap()

    const top = el('div', 'hud-top')
    const phase = el('div', 'phase')
    const timer = el('div', 'timer')
    top.append(phase, timer)
    const left = el('div', 'hud-left')
    const roster = el('div', 'roster')
    left.append(roster)
    const feed = el('div', 'hud-feed')
    const banner = el('div', 'banner')
    const callout = el('div', 'callout')
    const hint = el('div', 'hint')
    hint.hidden = true
    const spectate = el('div', 'spectate')
    spectate.hidden = true

    const bottom = el('div', 'hud-bottom')
    const [dash, dashArc] = gauge('cd dash', 32)
    dash.append(el('b', '', 'DASH'), el('kbd', '', 'SPACE'))
    const [g, gaugeArc] = gauge('momentum', 46)
    const gaugeNum = el('b', '', '0')
    g.append(gaugeNum, el('small', '', 'SPEED'))
    const [ability, abilityArc] = gauge('cd ability', 32)
    const abilityName = el('b', '', 'ABILITY')
    ability.append(abilityName, el('kbd', '', 'F'))
    bottom.append(dash, g, ability)

    const pause = document.createElement('button')
    pause.type = 'button'
    pause.className = 'pause'
    pause.ariaLabel = 'Pause'
    pause.append(el('i'), el('span', '', 'PAUSE'))
    pause.addEventListener('click', () => {
      if (pause.dataset.act === 'end') this.onEnd()
      else this.onPause()
    })
    this.hud.append(top, left, feed, banner, callout, hint, spectate, bottom, pause)
    this.refs = {
      phase, timer, left, roster, feed, banner, callout, hint, spectate,
      gauge: g, gaugeArc, gaugeNum, dash, dashArc, ability, abilityArc, abilityName, pause,
    }
  }

  syncHud(match: Match, youId: string, hint: string): void {
    const r = this.refs
    const you = match.players.find((p) => p.id === youId) ?? match.players[0]
    if (!r || !you) return

    r.phase.textContent = match.status === 'sudden' ? 'SUDDEN DEATH' : match.finalPhase ? 'FINAL PHASE' : match.status === 'countdown' ? 'GET READY' : ''
    r.phase.hidden = !r.phase.textContent
    let secs = Infinity
    if (match.config.duration <= 0) r.timer.textContent = '∞'
    else {
      secs = match.status === 'sudden' ? Math.ceil(match.suddenLeft) : Math.max(0, Math.ceil(match.config.duration - match.time))
      const txt = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs)
      if (r.timer.textContent !== txt) {
        r.timer.textContent = txt
        if (secs <= 10 && match.status !== 'countdown') restart(r.timer, 'tick')
      }
    }
    r.timer.classList.toggle('urgent', secs <= 10 || match.status === 'sudden')

    // Roster: rebuild only when something visible changes.
    const rows = [...match.players].sort((a, b) => (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) || a.placement - b.placement || b.stats.score - a.stats.score || b.stocks - a.stocks)
    const key = rows.map((p) => `${p.id}:${p.stocks}:${p.eliminated ? p.placement : ''}:${p.alive ? 1 : 0}`).join('|')
    if (key !== this.rosterKey) {
      this.rosterKey = key
      r.roster.replaceChildren()
      for (const p of rows) {
        const slot = el('div', `slot${p.id === you.id ? ' on' : ''}${p.eliminated ? ' out' : ''}${!p.alive && !p.eliminated ? ' down' : ''}`)
        const sw = el('i', 'swatch')
        sw.style.setProperty('--c', p.color)
        const pips = el('span', 'pips')
        if (p.eliminated) pips.textContent = `#${p.placement}`
        else if (match.config.respawn === 'always') pips.textContent = String(p.stats.elims)
        else {
          for (let i = 0; i < Math.min(5, p.stocks); i++) {
            const pip = el('i')
            pip.style.setProperty('--c', p.color)
            pips.append(pip)
          }
        }
        slot.append(sw, el('span', 'nm', p.name), pips)
        r.roster.append(slot)
      }
    }

    // Kill feed: new items slide in, old ones fade.
    const live = new Set<HTMLElement>()
    for (let i = match.feed.length - 1; i >= 0; i--) {
      const item = match.feed[i]!
      let node = this.feedNodes.get(item)
      if (!node) {
        node = el('div', 'feed-item')
        const dot = el('i')
        dot.style.setProperty('--c', item.color)
        node.append(dot, el('span', '', item.text))
        this.feedNodes.set(item, node)
        r.feed.prepend(node)
      }
      node.style.opacity = String(Math.min(1, item.life / 0.6))
      live.add(node)
    }
    for (const child of [...r.feed.children]) if (!live.has(child as HTMLElement)) child.remove()

    // Banner: slam in when the sim announces something new.
    if (match.banner !== this.lastBanner) {
      this.lastBanner = match.banner
      r.banner.replaceChildren()
      if (match.banner && match.banner.text !== 'GO') {
        r.banner.append(el('strong', '', match.banner.text))
        if (match.banner.sub) r.banner.append(el('em', '', match.banner.sub))
        restart(r.banner, 'slam')
      }
    }

    // "N LEFT" callout as contenders drop, like Brawl Stars Showdown.
    const left = match.players.filter((p) => !p.eliminated).length
    if (this.lastLeft && left < this.lastLeft && left > 1 && match.players.length > 2) {
      r.callout.textContent = `${left} LEFT`
      restart(r.callout, 'show')
    }
    this.lastLeft = left

    const out = !you.alive && you.eliminated
    this.hud.classList.toggle('out', out)
    r.spectate.hidden = !out || match.status === 'celebrate' || match.status === 'finished'
    r.hint.hidden = !hint || out
    if (r.hint.textContent !== hint) r.hint.textContent = hint
    if (out && !r.spectate.childElementCount) {
      r.spectate.append(el('strong', '', `ELIMINATED · ${placeLabel(you.placement)}`), el('small', '', 'Spectating. Esc for results.'))
    }

    const momentum = you.alive ? you.momentum : 0
    setArc(r.gaugeArc, momentum)
    r.gaugeNum.textContent = String(Math.round(momentum * 100))
    r.gauge.style.setProperty('--m', mixColor(momentum))
    r.gauge.classList.toggle('max', momentum > 0.85)
    if (you.hitFlash > 0.9) restart(r.gauge, 'hit')

    const dashPct = you.dashCdMax <= 0 ? 1 : 1 - Math.min(1, you.dashCd / you.dashCdMax)
    setArc(r.dashArc, dashPct)
    const dashReady = you.dashCd <= 0
    r.dash.classList.toggle('ready', dashReady)
    if (dashReady && !this.dashReady) restart(r.dash, 'pop')
    this.dashReady = dashReady

    const ability = abilityById(you.ability)
    if (r.abilityName.textContent !== ability.name.toUpperCase()) r.abilityName.textContent = ability.name.toUpperCase()
    const abPct = you.abilityCdMax <= 0 ? 1 : 1 - Math.min(1, you.abilityCd / you.abilityCdMax)
    setArc(r.abilityArc, abPct)
    const abReady = you.abilityCd <= 0
    r.ability.classList.toggle('ready', abReady)
    if (abReady && !this.abilityReady) restart(r.ability, 'pop')
    this.abilityReady = abReady

    r.pause.dataset.act = out ? 'end' : 'pause'
    const label = r.pause.querySelector('span')
    if (label) label.textContent = out ? 'RESULTS' : 'PAUSE'
  }

  // ---------------------------------------------------------------- pieces

  private screen(name: string, variant = ''): HTMLElement {
    this.current = name
    this.rematchKey = null
    this.root.replaceChildren()
    const panel = el('div', `panel ${variant}`.trim())
    if (name !== 'menu') {
      const back = button('', 'back', () => this.onNavigate('menu'))
      back.append(el('i', 'chev'), document.createTextNode('Back'))
      panel.append(back)
    }
    this.root.append(panel)
    return panel
  }

  private stagger(node: HTMLElement, step = 40): void {
    ;[...node.children].forEach((child, i) => {
      ;(child as HTMLElement).style.setProperty('--d', `${Math.min(i, 14) * step}ms`)
      child.classList.add('rise')
    })
  }

  private header(title: string, sub: string): HTMLElement {
    const h = el('div', 'head')
    h.append(el('h2', '', title))
    if (sub) h.append(el('p', 'lede', sub))
    return h
  }

  private brand(): HTMLElement {
    const mark = el('div', 'mark')
    const logo = el('div', 'logo')
    const w1 = el('span', 'w1', 'BOUNCE')
    w1.append(el('i', 'logo-ball'))
    logo.append(w1, el('span', 'w2', 'ARENA'))
    mark.append(logo, el('em', '', 'SPEED IS POWER'))
    return mark
  }

  private profileCard(profile: Profile): HTMLElement {
    const card = el('div', 'profile')
    const lvl = xpIntoLevel(profile.accountXp)
    const rank = profile.rank.placementsLeft > 0 ? 'Unranked' : rankName(profile.rank.rating).label
    const top = el('div', 'profile-top')
    top.append(el('b', 'lvl', String(lvl.level)))
    const who = el('div', '')
    who.append(el('strong', '', profile.name), el('small', '', rank))
    top.append(who, el('div', 'coins', String(profile.coins)))
    card.append(top, bar(lvl.have / lvl.need, '', `${lvl.have}/${lvl.need} xp`))
    const next = profile.challenges.daily.find((id) => !profile.challenges.done.includes(id)) ?? profile.challenges.daily[0]
    const def = CHALLENGES.find((c) => c.id === next)
    if (def) {
      const prog = Math.min(profile.challenges.progress[def.id] ?? 0, def.target)
      const goal = el('div', 'goal')
      goal.append(el('b', 'tag', 'DAILY'), el('span', '', def.detail), el('small', '', `${prog}/${def.target}`))
      card.append(goal)
    }
    return card
  }

  private pick<T extends { id: string; name: string; blurb: string }>(title: string, key: string, items: T[], current: string, choose: (id: string) => void): HTMLElement {
    const wrap = el('div', 'stack')
    const head = el('div', 'section', title)
    if (key) head.append(el('kbd', '', key))
    wrap.append(head)
    const grid = el('div', 'grid')
    for (const item of items) {
      const b = button('', 'choice', () => choose(item.id))
      if (item.id === current) b.classList.add('active')
      b.append(el('strong', '', item.name), el('small', '', item.blurb))
      grid.append(b)
    }
    wrap.append(grid)
    return wrap
  }
}

// ------------------------------------------------------------------ helpers

function arenaThumb(arena: ArenaDef | null): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const size = 120
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = size * dpr
  c.height = size * dpr
  c.className = 'thumb'
  const g = c.getContext('2d')
  if (!g) return c
  g.scale(dpr, dpr)
  if (!arena) {
    g.fillStyle = 'rgba(255,255,255,0.06)'
    g.beginPath()
    g.arc(60, 60, 42, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffc14d'
    g.font = '800 44px "Barlow Condensed", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('?', 60, 62)
    return c
  }
  const k = (size / 2 - 8) / arena.view
  const P = (x: number, y: number) => ({ x: 60 + x * k * 1.05, y: 60 + y * k * 1.05 })
  for (const solid of arena.solids) {
    const pose = solidPose(solid, 0, { cut: 0, innerGrow: 0 })
    const s = P(pose.x, pose.y)
    g.beginPath()
    if (pose.shape === 'poly') {
      pose.points.forEach((pt, i) => {
        const q = P(pt.x, pt.y)
        if (i) g.lineTo(q.x, q.y)
        else g.moveTo(q.x, q.y)
      })
      g.closePath()
    } else {
      g.arc(s.x, s.y, pose.r * k * 1.05, 0, Math.PI * 2)
      if (pose.shape === 'ring') {
        g.moveTo(s.x + pose.inner * k * 1.05, s.y)
        g.arc(s.x, s.y, pose.inner * k * 1.05, 0, Math.PI * 2, true)
      }
    }
    g.fillStyle = arena.floor
    g.fill('evenodd')
    g.strokeStyle = arena.rim
    g.lineWidth = 2
    g.stroke()
  }
  for (const h of arena.hazards) {
    const s = P(h.x, h.y)
    g.fillStyle = h.kind === 'lava' ? '#ff6a2a' : h.color
    if (h.w && h.h) {
      g.globalAlpha = 0.35
      g.fillRect(s.x - (h.w * k) / 2, s.y - (h.h * k) / 2, h.w * k, h.h * k)
      g.globalAlpha = 1
    } else {
      g.beginPath()
      g.arc(s.x, s.y, Math.max(2.5, h.r * k), 0, Math.PI * 2)
      g.fill()
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)'
  g.lineWidth = 2
  g.lineCap = 'round'
  for (const w of arena.walls) {
    const a = P(w.x1, w.y1)
    const b = P(w.x2, w.y2)
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }
  return c
}

function gauge(className: string, r: number): [HTMLElement, SVGCircleElement] {
  const wrap = el('div', `gauge ${className}`)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const size = r * 2 + 10
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  const track = document.createElementNS(ns, 'circle')
  const arc = document.createElementNS(ns, 'circle')
  for (const c of [track, arc]) {
    c.setAttribute('cx', String(size / 2))
    c.setAttribute('cy', String(size / 2))
    c.setAttribute('r', String(r))
  }
  track.setAttribute('class', 'track')
  arc.setAttribute('class', 'arc')
  arc.setAttribute('pathLength', '100')
  arc.style.strokeDasharray = '0 100'
  svg.append(track, arc)
  wrap.append(svg)
  return [wrap, arc]
}

function setArc(arc: SVGCircleElement, t: number): void {
  const u = Math.max(0, Math.min(1, t))
  const v = `${(u * 100).toFixed(1)} 100`
  if (arc.style.strokeDasharray !== v) arc.style.strokeDasharray = v
  // A zero-length dash with round caps still paints a dot.
  const o = u > 0.005 ? '1' : '0'
  if (arc.style.opacity !== o) arc.style.opacity = o
}

/** Smash damage-meter colours: white, gold, coral, deep red. */
function mixColor(t: number): string {
  if (t < 0.4) return '#f4f7fb'
  if (t < 0.7) return '#ffc14d'
  if (t < 0.9) return '#ff4d3a'
  return '#ff2d55'
}

function restart(node: HTMLElement, cls: string): void {
  node.classList.remove(cls)
  void node.offsetWidth
  node.classList.add(cls)
}

function countUp(node: HTMLElement, to: number, ms: number, suffix = '', prefix = ''): void {
  const start = performance.now() + 250
  const step = (now: number) => {
    const u = Math.max(0, Math.min(1, (now - start) / ms))
    const e = 1 - Math.pow(1 - u, 3)
    node.textContent = `${prefix}${Math.round(to * e)}${suffix}`
    if (u < 1) requestAnimationFrame(step)
  }
  node.textContent = `${prefix}0${suffix}`
  requestAnimationFrame(step)
}

function bar(t: number, label: string, value: string): HTMLElement {
  const wrap = el('div', 'bar')
  if (label || value) {
    const head = el('div', 'bar-head')
    head.append(el('span', '', label), el('b', '', value))
    wrap.append(head)
  }
  const track = el('div', 'track')
  const fill = el('i', 'fill')
  fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`
  track.append(fill)
  wrap.append(track)
  return wrap
}

function kbds(text: string): HTMLElement {
  const wrap = el('span', 'kbds')
  if (!text) return wrap
  for (const part of text.split(' ')) wrap.append(el('kbd', '', part))
  return wrap
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
  if (text) node.textContent = text
  node.addEventListener('click', onClick)
  return node
}

function toggle(label: string, sub: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = el('label', 'switch')
  const text = el('span', '')
  text.append(el('strong', '', label))
  if (sub) text.append(el('small', '', sub))
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value
  input.addEventListener('change', () => onChange(input.checked))
  row.append(text, input, el('i', 'switch-knob'))
  return row
}

function slider(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('label', 'slider')
  const num = el('b', '', String(Math.round(value * 100)))
  const head = el('span', '')
  head.append(document.createTextNode(`${label} `), num)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.style.setProperty('--fill', `${value * 100}%`)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    num.textContent = String(Math.round(v * 100))
    input.style.setProperty('--fill', `${v * 100}%`)
    onChange(v)
  })
  wrap.append(head, input)
  return wrap
}
