import { ABILITIES, CORES, PASSIVES, SHELLS, abilityById, coreById, shellById } from '../data/tuning'
import {
  ACHIEVEMENTS,
  ARENAS,
  COSMETICS,
  MODES,
  OVERTIME_XP,
  PALETTE,
  RANK_TIERS,
  SWEEP_BONUS,
  TEAM_COLORS,
  arenaById,
  cosmeticById,
  dailyTwist,
  mutatorById,
  dateKey,
  displaySeason,
  MASTERY_LEVELS,
  masteryLevel,
  masteryReward,
  modeById,
  rankName,
  rankTierIndex,
  seasonBounds,
  type ArenaDef,
  type CosmeticDef,
} from '../data/content'
import type { MatchResult } from '../core/types'
import { TAU } from '../core/math'
import { xpIntoLevel, type Profile } from '../progression/profile'
import { achievementProgress, canReroll, challengeDef, isPodium, liveDayStreak, type Grant, type SettleOutcome } from '../progression/settle'
import { solidPose } from '../sim/geometry'
import type { FeedItem, Banner, Match } from '../sim/match'
import type { Body } from '../sim/body'
import type { PlayOptions } from '../game/setup'
import { heatColor } from '../render/render'
import { ballAvatar, paintBall } from '../render/ball'
import { hexA, mixHex, shade } from '../render/util'
import { MODE_ICON, icon } from './icons'
import { livePreview } from './preview'

export interface PlayDraft {
  modeId: PlayOptions['modeId']
  arenaId: string
  competitive: boolean
  players: number
  localDuo: boolean
}

type Nav = 'menu' | 'play' | 'loadout' | 'career' | 'collection' | 'settings'
type CareerTab = 'overview' | 'challenges' | 'season' | 'mastery' | 'awards'
type LoadoutTab = 'ability' | 'core' | 'shell' | 'passive'
type Slot = CosmeticDef['slot']

const MASTERY_MAX = MASTERY_LEVELS.length

const TOP_TABS: [Nav, string, string][] = [
  ['menu', 'Play', 'play'],
  ['loadout', 'Loadout', 'loadout'],
  ['career', 'Career', 'career'],
  ['collection', 'Collection', 'collection'],
]

const CAREER_TABS: [CareerTab, string, string][] = [
  ['overview', 'Overview', 'chart'],
  ['challenges', 'Challenges', 'target'],
  ['season', 'Season', 'calendar'],
  ['mastery', 'Mastery', 'medal'],
  ['awards', 'Awards', 'trophy'],
]

const MODE_TAG: Record<string, string> = {
  ffa: 'FFA', team: 'TEAM', score: 'PTS', king: 'KING', survivor: '1 LIFE', chaos: 'CHAOS', duel: '1V1', practice: 'FREE',
}

const MODE_COLOR: Record<string, string> = {
  ffa: '#ff4d3a', team: '#4cc9ff', score: '#ffc14d', king: '#b388ff', survivor: '#3ee6a0', chaos: '#ff6b9a', duel: '#f4f7fb', practice: '#93a0b4',
}

const TIER_COLOR: Record<string, string> = {
  bronze: '#d98b56', silver: '#c9d6e6', gold: '#ffc14d', platinum: '#5ee0cf', diamond: '#59d4ff', master: '#b388ff', grandmaster: '#ff4d6d',
}

const SLOTS: [Slot, string, string][] = [
  ['skin', 'Skins', 'skin'],
  ['trail', 'Trails', 'trail'],
  ['impact', 'Impacts', 'impact'],
  ['emote', 'Emotes', 'chat'],
  ['title', 'Titles', 'tag'],
  ['banner', 'Banners', 'flag'],
  ['frame', 'Frames', 'frame'],
]

const GRANT_ORDER: Grant['kind'][] = ['rank', 'cosmetic', 'achievement', 'season', 'level', 'mastery', 'challenge', 'record', 'coins']
const GRANT_ICON: Record<Grant['kind'], string> = {
  rank: 'shield', cosmetic: 'sparkle', achievement: 'trophy', season: 'calendar', level: 'star', mastery: 'medal', challenge: 'target', record: 'flag', coins: 'coin',
}

interface CardRefs {
  root: HTMLElement
  heat: HTMLElement
  sub: HTMLElement
  stocks: HTMLElement
  lastHeat: number
  lastStocks: number
  lastSub: string
  state: string
}

interface HudRefs {
  intro: HTMLElement
  phase: HTMLElement
  timer: HTMLElement
  cards: HTMLElement
  feed: HTMLElement
  banner: HTMLElement
  callout: HTMLElement
  toast: HTMLElement
  hint: HTMLElement
  spectate: HTMLElement
  speed: HTMLElement
  speedArc: SVGPathElement
  speedNum: HTMLElement
  dash: HTMLElement
  dashArc: SVGCircleElement
  ability: HTMLElement
  abilityArc: SVGCircleElement
  abilityName: HTMLElement
  abilityIcon: HTMLElement
  pause: HTMLButtonElement
}

export class Shell {
  draft: PlayDraft = { modeId: 'ffa', arenaId: 'random', competitive: false, players: 6, localDuo: false }
  onNavigate: (screen: Nav) => void = () => {}
  onPlay: (draft: PlayDraft) => void = () => {}
  onTutorial: () => void = () => {}
  onPractice: () => void = () => {}
  onRanked: () => void = () => {}
  onTwist: () => void = () => {}
  onName: (name: string) => void = () => {}
  onColor: (index: number) => void = () => {}
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
  onReroll: (id: string) => void = () => {}
  careerTab: CareerTab = 'overview'
  loadoutTab: LoadoutTab = 'ability'
  collectionSlot: Slot = 'skin'

  private refs: HudRefs | null = null
  private cards = new Map<string, CardRefs>()
  private feedNodes = new WeakMap<FeedItem, HTMLElement>()
  private lastBanner: Banner | null = null
  private lastLeft = 0
  private lastElims = 0
  private lastStocks = -1
  private dashReady = true
  private abilityReady = true
  private current = ''
  private booted = false
  private rematchKey: (() => void) | null = null
  private settingsCache: Profile['settings'] | null = null

  constructor(private root: HTMLElement, private hud: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      const focused = document.activeElement
      const typing = focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement || focused instanceof HTMLTextAreaElement
      if (e.code === 'Escape' && ['play', 'loadout', 'career', 'collection', 'settings'].includes(this.current)) {
        if (typing) (focused as HTMLElement).blur()
        this.onNavigate('menu')
        return
      }
      if (typing) return
      if ((e.code === 'KeyQ' || e.code === 'KeyE') && this.isMenuScreen()) {
        const order = TOP_TABS.map((t) => t[0])
        const at = this.current === 'play' ? 0 : Math.max(0, order.indexOf(this.current as Nav))
        const next = order[(at + (e.code === 'KeyE' ? 1 : order.length - 1)) % order.length]!
        this.onNavigate(next)
        return
      }
      if (e.code !== 'Enter') return
      // Enter on a focused control activates that control, not the queue.
      if (focused instanceof HTMLButtonElement) return
      if (this.current === 'menu' || this.current === 'play') this.onPlay({ ...this.draft })
      else if (this.current === 'results') this.rematchKey?.()
    })
  }

  private isMenuScreen(): boolean {
    return ['menu', 'play', 'loadout', 'career', 'collection', 'settings'].includes(this.current)
  }

  // ================================================================ frame

  /** The persistent menu chrome: brand, top tabs, currencies and profile chip. Returns the content area. */
  private frame(name: string, tab: Nav, profile: Profile): HTMLElement {
    const same = this.current === name
    const main = this.root.querySelector('main.screen') as HTMLElement | null
    const keep = same && main ? main.scrollTop : 0
    this.current = name
    document.body.dataset.screen = name
    this.rematchKey = null
    this.root.replaceChildren()
    const shell = el('div', `shell${this.booted ? '' : ' boot'}`)
    this.booted = true

    const top = el('header', 'topbar')
    const brand = el('button', 'brand')
    brand.setAttribute('type', 'button')
    brand.ariaLabel = 'Home'
    brand.addEventListener('click', () => this.onNavigate('menu'))
    const mark = el('span', 'brand-ball')
    brand.append(mark, el('span', 'brand-word', 'BOUNCE'), el('span', 'brand-word alt', 'ARENA'))
    const nav = el('nav', 'toptabs')
    nav.append(el('kbd', 'tab-key', 'Q'))
    for (const [id, label, ico] of TOP_TABS) {
      const b = button('', `toptab${tab === id ? ' on' : ''}`, () => this.onNavigate(id))
      b.append(icon(ico), el('span', '', label))
      if (id === 'career') {
        const open = [...profile.challenges.daily, ...profile.challenges.weekly].filter((c) => !profile.challenges.done.includes(c)).length
        if (open) b.append(el('i', 'badge', String(open)))
      }
      nav.append(b)
    }
    nav.append(el('kbd', 'tab-key', 'E'))
    const right = el('div', 'topright')
    const coins = el('div', 'pill coins')
    coins.append(icon('coin'), el('b', '', String(profile.coins)))
    const lvl = xpIntoLevel(profile.accountXp)
    const chip = button('', 'me-chip', () => this.onNavigate('loadout'))
    const av = document.createElement('canvas')
    ballAvatar(av, playerColor(profile), profile.equipped.skin, 0, 'idle', 34)
    const ring = el('span', 'lvl-ring')
    ring.style.setProperty('--p', String(lvl.have / lvl.need))
    ring.append(el('b', '', String(lvl.level)))
    const who = el('span', 'me-who')
    who.append(el('strong', '', profile.name), el('small', '', profile.rank.placementsLeft > 0 ? 'Unranked' : rankName(profile.rank.rating).label))
    chip.append(av, who, ring)
    const gear = button('', `icon-btn${tab === 'settings' ? ' on' : ''}`, () => this.onNavigate('settings'))
    gear.ariaLabel = 'Settings'
    gear.append(icon('settings'))
    right.append(coins, chip, gear)
    top.append(brand, nav, right)

    const content = el('main', `screen screen-${name}`)
    shell.append(top, content)
    this.root.append(shell)
    if (same) {
      content.classList.add('still')
      requestAnimationFrame(() => {
        content.scrollTop = keep
      })
    }
    return content
  }

  private subhead(title: string, sub: string, extra?: HTMLElement): HTMLElement {
    const h = el('div', 'subhead')
    const back = button('', 'back', () => this.onNavigate('menu'))
    back.append(icon('back'), el('span', '', 'Back'), el('kbd', '', 'ESC'))
    const text = el('div', 'subhead-text')
    text.append(el('h1', '', title))
    if (sub) text.append(el('p', 'lede', sub))
    h.append(back, text)
    if (extra) h.append(extra)
    return h
  }

  private stagger(node: HTMLElement, step = 45): void {
    if (node.classList.contains('still') || node.closest('.still')) return
    ;[...node.children].forEach((child, i) => {
      ;(child as HTMLElement).style.setProperty('--d', `${Math.min(i, 12) * step}ms`)
      child.classList.add('rise')
    })
  }

  // ================================================================ home

  showMenu(profile: Profile, notices: Grant[] = []): void {
    const main = this.frame('menu', 'menu', profile)
    main.classList.add('home')
    const left = el('section', 'home-left')
    const right = el('section', 'home-right')

    if (notices.length) this.toast(notices)

    // Daily twist.
    const twist = dailyTwist()
    const tone = mutatorById(twist.mutators[0] ?? '')?.color ?? '#ff6b9a'
    const twistCard = button('', 'card twist', () => this.onTwist())
    twistCard.style.setProperty('--tone', tone)
    const th = el('div', 'card-head')
    th.append(el('span', 'tag hot', 'DAILY TWIST'), el('span', 'timer-chip', `New in ${untilMidnight()}`))
    const muts = el('div', 'muts')
    for (const id of twist.mutators) {
      const m = mutatorById(id)
      if (!m) continue
      const chip = el('span', 'mut')
      chip.style.setProperty('--c', m.color)
      chip.append(el('i', 'dot'), document.createTextNode(m.name))
      muts.append(chip)
    }
    const go = el('span', 'card-go')
    go.append(icon('play'))
    twistCard.append(th, el('strong', 'card-title', twist.name), el('small', 'card-sub', twist.blurb), muts, go)

    // Ranked.
    const placing = profile.rank.placementsLeft > 0
    const rank = rankName(profile.rank.rating)
    const tierId = RANK_TIERS[rankTierIndex(profile.rank.rating)]?.id ?? 'bronze'
    const ranked = button('', 'card ranked', () => this.onRanked())
    ranked.style.setProperty('--tone', placing ? '#93a0b4' : TIER_COLOR[tierId] ?? '#ffc14d')
    const emblem = rankEmblem(placing ? 'placement' : tierId, placing ? '?' : romanOf(rank.division, tierId), 58)
    const rb = el('div', 'card-body')
    const rh = el('div', 'card-head')
    rh.append(el('span', 'tag', 'RANKED DUEL'))
    if (profile.rank.shield > 0 && !placing) rh.append(el('span', 'tag ice', `SHIELD ${profile.rank.shield}`))
    rb.append(rh, el('strong', 'card-title', placing ? `Placement ${5 - profile.rank.placementsLeft}/5` : rank.label))
    rb.append(placing ? el('small', 'card-sub', 'Five matches to find your rank. Standard ball, your ability.') : rankLadder(profile.rank.rating))
    const go2 = el('span', 'card-go')
    go2.append(icon('play'))
    ranked.append(emblem, rb, go2)

    // Challenges and season.
    const ch = button('', 'card challenges', () => {
      this.careerTab = 'challenges'
      this.onNavigate('career')
    })
    const chHead = el('div', 'card-head')
    const done = profile.challenges.daily.filter((id) => profile.challenges.done.includes(id)).length
    chHead.append(el('span', 'tag mint', 'DAILY CHALLENGES'), el('span', 'count-chip', `${done}/${profile.challenges.daily.length}`))
    ch.append(chHead)
    for (const id of profile.challenges.daily) {
      const def = challengeDef(id)
      if (!def) continue
      const prog = Math.min(profile.challenges.progress[id] ?? 0, def.target)
      const finished = profile.challenges.done.includes(id)
      const row = el('div', `mini-ch${finished ? ' done' : ''}`)
      const check = el('i', 'mini-check')
      if (finished) check.append(icon('check'))
      const body = el('div', 'mini-body')
      body.append(el('span', '', def.detail), miniBar(finished ? 1 : prog / def.target))
      row.append(check, body, el('b', '', finished ? '' : `${prog}/${def.target}`))
      ch.append(row)
    }
    const season = displaySeason()
    if (season.id === profile.seasonId) {
      const claimed = profile.seasonClaimed
      const next = season.tiers[claimed]
      const prev = season.tiers[claimed - 1]?.xp ?? 0
      const foot = el('div', 'season-strip')
      foot.append(el('span', '', `${season.name} · Tier ${Math.min(claimed + 1, season.tiers.length)}`), miniBar(next ? (profile.seasonXp - prev) / Math.max(1, next.xp - prev) : 1, 'gold'))
      ch.append(foot)
    }

    const quick = el('div', 'quick')
    const practice = button('', 'tile', () => this.onPractice())
    practice.append(icon('flag'), el('strong', '', 'Practice'), el('small', '', 'Bots respawn, no clock'))
    const tutorial = button('', 'tile', () => this.onTutorial())
    tutorial.append(icon('sparkle'), el('strong', '', 'Tutorial'), el('small', '', 'Learn the hit'))
    quick.append(practice, tutorial)

    left.append(twistCard, ranked, ch, quick)

    // Hero: your ball and the queue.
    const hero = el('div', 'hero-ball')
    const preview = livePreview({ color: playerColor(profile), skin: profile.equipped.skin, pattern: 0 }, 260, 230)
    preview.el.title = 'Click me'
    const nameplate = button('', 'nameplate', () => this.onNavigate('loadout'))
    const title = profile.equipped.title ? cosmeticById(profile.equipped.title)?.name ?? '' : ''
    nameplate.append(el('strong', '', profile.name), el('small', '', title || abilityById(profile.loadout.ability).name))
    hero.append(preview.el, nameplate)

    const queue = el('div', 'queue')
    const mode = modeById(this.draft.modeId)
    const arena = ARENAS.find((a) => a.id === this.draft.arenaId)
    const pick = button('', 'mode-pick', () => this.onNavigate('play'))
    pick.style.setProperty('--tone', MODE_COLOR[mode.id] ?? '#ff4d3a')
    const pickIco = el('span', 'mode-ico')
    pickIco.append(icon(MODE_ICON[mode.id] ?? 'ball'))
    const pickText = el('span', 'mode-text')
    pickText.append(el('small', '', 'MODE'), el('strong', '', mode.name), el('em', '', `${arena?.name ?? 'Random arena'} · ${this.draft.players} players${this.draft.competitive ? ' · Ranked' : ''}`))
    const change = el('span', 'change')
    change.append(document.createTextNode('Change'), icon('next'))
    pick.append(pickIco, pickText, change)
    const play = button('', 'cta-play', () => this.onPlay({ ...this.draft }))
    play.append(icon('play'), el('span', '', 'PLAY'), el('kbd', '', 'ENTER'))
    queue.append(pick, play)
    const perks: string[] = []
    if (profile.daily.firstWinDay !== dateKey()) perks.push('First win bonus ready')
    const streak = liveDayStreak(profile)
    if (streak > 1) perks.push(`Day streak ${streak}`)
    if (perks.length) {
      const p = el('div', 'perks')
      for (const t of perks) {
        const chip = el('span', '')
        chip.append(icon('sparkle'), document.createTextNode(t))
        p.append(chip)
      }
      queue.append(p)
    }
    right.append(hero, queue)
    main.append(left, right)
    this.stagger(left, 70)
    this.stagger(right, 90)
  }

  /** Rewards paid on load: shown as a toast stack that leaves on its own. */
  private toast(grants: Grant[]): void {
    const wrap = el('div', 'toasts')
    const ended = grants.find((g) => g.id.startsWith('season-end'))
    const card = el('div', 'toast')
    const head = el('div', 'toast-head')
    head.append(icon('sparkle'), el('b', '', ended ? ended.name.toUpperCase() : 'REWARDS WAITING'))
    const close = button('', 'icon-btn small', () => card.remove())
    close.ariaLabel = 'Dismiss'
    close.append(icon('close'))
    head.append(close)
    card.append(head)
    const rest = grants.filter((g) => g !== ended)
    if (rest.length) card.append(grantChips(rest, 5))
    if (ended) card.append(el('small', '', ended.detail))
    wrap.append(card)
    this.root.append(wrap)
    window.setTimeout(() => card.classList.add('leave'), 9000)
    window.setTimeout(() => wrap.remove(), 9600)
  }

  // ================================================================ modes

  showPlay(profile: Profile): void {
    const main = this.frame('play', 'menu', profile)
    main.classList.add('modes')
    main.append(this.subhead('Choose a mode', 'Pick how you want to fight, then where.'))
    const grid = el('div', 'mode-grid')
    for (const mode of MODES.filter((m) => m.id !== 'tutorial')) {
      const b = button('', `mode-card${this.draft.modeId === mode.id ? ' on' : ''}`, () => {
        this.draft.modeId = mode.id
        this.draft.players = mode.players
        this.draft.competitive = this.draft.competitive && mode.ranked
        this.showPlay(profile)
      })
      b.style.setProperty('--tone', MODE_COLOR[mode.id] ?? '#ff4d3a')
      const art = el('span', 'mode-art')
      art.append(icon(MODE_ICON[mode.id] ?? 'ball'))
      const meta = el('span', 'mode-meta')
      const lives = mode.respawn === 'always' ? 'Endless' : `${mode.stocks} stock${mode.stocks === 1 ? '' : 's'}`
      for (const [ico, text] of [['users', `${mode.minPlayers}-${mode.maxPlayers}`], ['heart', lives], ['clock', mode.duration > 0 ? `${mode.duration}s` : 'No clock']] as const) {
        const m = el('span', '')
        m.append(icon(ico), document.createTextNode(text))
        meta.append(m)
      }
      b.append(art, el('b', 'tag', MODE_TAG[mode.id] ?? mode.id.toUpperCase()), el('strong', '', mode.name), el('small', '', mode.blurb), meta)
      if (this.draft.modeId === mode.id) {
        const tick = el('span', 'tick')
        tick.append(icon('check'))
        b.append(tick)
      }
      grid.append(b)
    }
    main.append(grid)

    main.append(sectionTitle('Arena', 'map'))
    const arenas = el('div', 'arena-row')
    for (const arena of [null, ...ARENAS]) {
      const id = arena?.id ?? 'random'
      const b = button('', `arena-card${this.draft.arenaId === id ? ' on' : ''}`, () => {
        this.draft.arenaId = id
        this.showPlay(profile)
      })
      if (arena) b.style.setProperty('--tone', arena.rim)
      b.append(arenaThumb(arena), el('strong', '', arena?.name ?? 'Random'), el('small', '', arena?.tagline ?? 'Surprise me'))
      arenas.append(b)
    }
    main.append(arenas)

    const mode = modeById(this.draft.modeId)
    const bar = el('div', 'launch-bar')
    const opts = el('div', 'launch-opts')
    const stepper = el('div', 'stepper')
    const minus = button('', 'icon-btn', () => {
      this.draft.players = Math.max(mode.minPlayers, this.draft.players - 1)
      count.textContent = String(this.draft.players)
    })
    minus.ariaLabel = 'Fewer players'
    minus.append(el('span', '', '−'))
    const plus = button('', 'icon-btn', () => {
      this.draft.players = Math.min(mode.maxPlayers, this.draft.players + 1)
      count.textContent = String(this.draft.players)
    })
    plus.ariaLabel = 'More players'
    plus.append(el('span', '', '+'))
    const count = el('b', '', String(this.draft.players))
    const lab = el('span', 'stepper-label')
    lab.append(icon('users'), document.createTextNode('Players'))
    stepper.append(lab, minus, count, plus)
    opts.append(stepper)
    if (mode.ranked) opts.append(toggle('Ranked rules', 'Standard ball, rank moves', this.draft.competitive, (v) => { this.draft.competitive = v }))
    opts.append(toggle('Local player 2', 'Arrows, Enter, Right Ctrl', this.draft.localDuo, (v) => { this.draft.localDuo = v }))
    const start = button('', 'cta-play compact', () => this.onPlay({ ...this.draft }))
    start.append(icon('play'), el('span', '', 'START'), el('kbd', '', 'ENTER'))
    bar.append(opts, start)
    main.append(bar)
    this.stagger(main, 40)
  }

  // ================================================================ loadout

  showLoadout(profile: Profile): void {
    const main = this.frame('loadout', 'loadout', profile)
    main.classList.add('loadout')
    const color = playerColor(profile)
    const hero = el('section', 'lo-hero')
    const preview = livePreview({ color, skin: profile.equipped.skin, pattern: 0 }, 300, 270)
    if (this.current === 'loadout' && main.classList.contains('still')) preview.cheer()
    const name = document.createElement('input')
    name.type = 'text'
    name.value = profile.name
    name.maxLength = 16
    name.ariaLabel = 'Player name'
    name.className = 'name-input'
    name.addEventListener('change', () => {
      const clean = name.value.trim().slice(0, 16) || 'Player'
      name.value = clean
      this.onName(clean)
    })
    name.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return
      // Confirm the name only; do not let the menu's Enter shortcut start a match.
      e.stopPropagation()
      name.blur()
    })
    const nameRow = el('label', 'name-row')
    nameRow.append(icon('tag'), name)
    const swatches = el('div', 'swatches')
    PALETTE.forEach((c, i) => {
      const s = button('', `swatch-btn${profile.color % PALETTE.length === i ? ' on' : ''}`, () => this.onColor(i))
      s.style.setProperty('--c', c)
      s.ariaLabel = `Colour ${i + 1}`
      swatches.append(s)
    })
    hero.append(preview.el, nameRow, swatches, statBlock(profile))
    const cos = el('div', 'equipped')
    for (const slot of ['skin', 'trail', 'impact'] as const) {
      const item = cosmeticById(profile.equipped[slot])
      const b = button('', 'equip-chip', () => {
        this.collectionSlot = slot
        this.onNavigate('collection')
      })
      b.append(icon(slot === 'skin' ? 'skin' : slot), el('small', '', slot.toUpperCase()), el('strong', '', item?.name ?? '—'))
      cos.append(b)
    }
    hero.append(cos)

    const pick = el('section', 'lo-pick')
    pick.append(this.subhead('Loadout', 'Sidegrades, not upgrades. Ranked locks the ball to Stable and Rubber and turns passives off. Your ability stays.'))
    const tabs = el('div', 'seg')
    for (const [id, label, ico] of [['ability', 'Ability', 'shockwave'], ['core', 'Core', 'stable'], ['shell', 'Shell', 'rubber'], ['passive', 'Passive', 'second-wind']] as const) {
      const b = button('', `seg-btn${this.loadoutTab === id ? ' on' : ''}`, () => {
        this.loadoutTab = id
        this.showLoadout(profile)
      })
      b.append(icon(ico), el('span', '', label))
      tabs.append(b)
    }
    pick.append(tabs)
    const grid = el('div', 'choice-grid')
    const tab = this.loadoutTab
    const items: { id: string; name: string; blurb: string; extra?: string }[] =
      tab === 'ability' ? ABILITIES.map((a) => ({ ...a, extra: `${a.cooldown}s` }))
        : tab === 'core' ? CORES
          : tab === 'shell' ? SHELLS
            : PASSIVES.filter((p) => p.id !== 'none')
    const current = profile.loadout[tab]
    for (const item of items) {
      const b = button('', `choice${item.id === current ? ' on' : ''}`, () => this.onLoadout(tab, item.id))
      const ico = el('span', 'choice-ico')
      ico.append(icon(item.id))
      const head = el('span', 'choice-head')
      head.append(el('strong', '', item.name))
      if (tab === 'ability' || tab === 'core') {
        const book = tab === 'ability' ? profile.abilityMastery : profile.mastery
        head.append(el('b', 'mbadge', `M${masteryLevel(book[item.id] ?? 0).level}`))
      }
      if (item.extra) head.append(el('em', 'cd-chip', item.extra))
      b.append(ico, head, el('small', '', item.blurb))
      if (item.id === current) {
        const tick = el('span', 'tick')
        tick.append(icon('check'))
        b.append(tick)
      }
      grid.append(b)
    }
    pick.append(grid)
    main.append(hero, pick)
    this.stagger(hero, 50)
    this.stagger(pick, 35)
  }

  // ================================================================ career

  showCareer(profile: Profile): void {
    const main = this.frame('career', 'career', profile)
    main.classList.add('career')
    const lvl = xpIntoLevel(profile.accountXp)
    const placing = profile.rank.placementsLeft > 0
    const rank = placing ? `Placement ${5 - profile.rank.placementsLeft}/5` : rankName(profile.rank.rating).label
    const tierId = RANK_TIERS[rankTierIndex(profile.rank.rating)]?.id ?? 'bronze'
    main.append(this.subhead('Career', ''))
    const hero = el('div', 'career-hero')
    hero.style.setProperty('--tone', placing ? '#93a0b4' : TIER_COLOR[tierId] ?? '#ffc14d')
    hero.append(rankEmblem(placing ? 'placement' : tierId, placing ? '?' : romanOf(rankName(profile.rank.rating).division, tierId), 92))
    const info = el('div', 'career-info')
    const title = el('b', 'rank-title', rank)
    if (profile.rank.shield > 0 && !placing) title.append(el('span', 'tag ice', `SHIELD ${profile.rank.shield}`))
    info.append(title, el('small', '', `Season peak ${profile.rank.peakLabel}. ${profile.rank.lastReason || 'Play ranked to move this.'}`))
    if (!placing) info.append(rankLadder(profile.rank.rating))
    const lv = el('div', 'career-level')
    const ring = el('span', 'lvl-ring big')
    ring.style.setProperty('--p', String(lvl.have / lvl.need))
    ring.append(el('b', '', String(lvl.level)))
    const lvt = el('div', '')
    lvt.append(el('strong', '', `Level ${lvl.level}`), el('small', '', `${lvl.have} / ${lvl.need} xp`))
    lv.append(ring, lvt)
    hero.append(info, lv)
    main.append(hero)

    const tabs = el('div', 'seg')
    tabs.setAttribute('role', 'tablist')
    for (const [id, label, ico] of CAREER_TABS) {
      const tab = button('', `seg-btn${this.careerTab === id ? ' on' : ''}`, () => {
        this.careerTab = id
        this.showCareer(profile)
      })
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(this.careerTab === id))
      tab.append(icon(ico), el('span', '', label))
      if (id === 'challenges') {
        const open = [...profile.challenges.daily, ...profile.challenges.weekly].filter((c) => !profile.challenges.done.includes(c)).length
        if (open) tab.append(el('i', 'badge', String(open)))
      }
      tabs.append(tab)
    }
    main.append(tabs)
    const body = el('div', 'career-body')
    if (this.careerTab === 'overview') this.careerOverview(body, profile)
    else if (this.careerTab === 'challenges') this.careerChallenges(body, profile)
    else if (this.careerTab === 'season') this.careerSeason(body, profile)
    else if (this.careerTab === 'mastery') this.careerMastery(body, profile)
    else this.careerAwards(body, profile)
    main.append(body)
    this.stagger(main, 40)
  }

  private careerOverview(panel: HTMLElement, profile: Profile): void {
    const s = profile.stats
    panel.append(statGrid([
      ['Matches', String(s.matches), 'ball'],
      ['Wins', String(s.wins), 'trophy'],
      ['Knockouts', String(s.elims), 'impact'],
      ['Podiums', String(s.podiums), 'medal'],
      ['Ranked wins', String(s.rankedWins), 'shield'],
      ['Best streak', String(s.bestStreak), 'flame'],
      ['Day streak', String(liveDayStreak(profile)), 'calendar'],
      ['Play time', `${Math.round(s.playTime / 60)}m`, 'clock'],
    ]))
    panel.append(sectionTitle('Records', 'flag'))
    const r = profile.records
    panel.append(statGrid([
      ['Longest launch', `${r.biggestLaunch.toFixed(1)} m`, 'trail'],
      ['Top speed', String(Math.round(r.highestSpeed)), 'bolt'],
      ['Best multi-KO', String(r.bestMulti), 'impact'],
      ['Fastest KO', r.fastestElim ? `${r.fastestElim.toFixed(1)}s` : '—', 'clock'],
      ['Longest life', `${Math.round(r.longestSurvival)}s`, 'heart'],
      ['Most KOs', String(r.mostElims), 'target'],
      ['Comebacks', String(r.comebacks), 'refresh'],
      ['Coins', String(profile.coins), 'coin'],
    ]))
    if (profile.recent.length) {
      panel.append(sectionTitle('Recent', 'film'))
      const list = el('div', 'board')
      for (const m of profile.recent.slice(0, 8)) {
        const row = el('div', `slot${m.place === 1 ? ' gold' : ''}`)
        row.append(el('b', 'pos', placeLabel(m.place)), el('span', '', `${modeById(m.mode).name} · ${arenaById(m.arena).name}`))
        row.append(el('small', m.competitive ? (m.delta >= 0 ? 'up' : 'down') : '', m.competitive ? `${m.delta >= 0 ? '+' : ''}${m.delta}` : 'Casual'))
        list.append(row)
      }
      panel.append(list)
    }
    if (profile.rank.history.length) {
      panel.append(sectionTitle('Past seasons', 'calendar'))
      const list = el('div', 'stack')
      for (const h of profile.rank.history) {
        const row = el('div', 'row-card')
        row.append(el('b', 'tag', h.seasonId.toUpperCase()))
        const body = el('div', '')
        body.append(el('strong', '', `${h.name} · Peak ${h.peakLabel}`), el('small', '', `${h.wins} wins in ${h.matches} ranked · ${h.coins} coins`))
        row.append(body)
        list.append(row)
      }
      panel.append(list)
    }
  }

  private careerChallenges(panel: HTMLElement, profile: Profile): void {
    const reroll = canReroll(profile)
    panel.append(el('p', 'lede', reroll ? 'One reroll a day. Swap a challenge you do not want.' : 'Reroll used today.'))
    for (const [cadence, ids, label] of [
      ['daily', profile.challenges.daily, 'Daily'],
      ['weekly', profile.challenges.weekly, 'Weekly'],
    ] as const) {
      const done = ids.filter((id) => profile.challenges.done.includes(id)).length
      panel.append(sectionTitle(`${label} · ${done}/${ids.length}`, cadence === 'daily' ? 'target' : 'calendar'))
      const list = el('div', 'stack')
      for (const id of ids) {
        const def = challengeDef(id)
        if (!def) continue
        const prog = Math.min(profile.challenges.progress[id] ?? 0, def.target)
        const finished = profile.challenges.done.includes(id)
        const row = el('div', `row-card challenge${finished ? ' done' : ''}`)
        const ico = el('span', 'row-ico')
        ico.append(icon(finished ? 'check' : cadence === 'daily' ? 'target' : 'calendar'))
        const body = el('div', '')
        body.append(bar(finished ? 1 : prog / def.target, def.name, finished ? 'Done' : `${prog}/${def.target}`))
        const reward = el('small', 'rewards-line')
        reward.append(document.createTextNode(def.detail), el('i', 'sep'), icon('coin'), document.createTextNode(`${def.coins}`), el('i', 'sep'), document.createTextNode(`${def.xp} season xp`))
        body.append(reward)
        row.append(ico, body)
        if (!finished && reroll) {
          const swap = button('', 'chip', () => this.onReroll(id))
          swap.ariaLabel = `Reroll ${def.name}`
          swap.append(icon('refresh'), document.createTextNode('Swap'))
          row.append(swap)
        }
        list.append(row)
      }
      const bonus = SWEEP_BONUS[cadence]
      const key = cadence === 'daily' ? `d:${profile.challenges.dailyKey}` : `w:${profile.challenges.weeklyKey}`
      const swept = profile.challenges.sweeps.includes(key)
      list.append(el('div', `sweep${swept ? ' got' : ''}`, swept ? `${label} sweep paid` : `Finish all ${ids.length} for +${bonus.coins} coins and +${bonus.xp} season xp`))
      panel.append(list)
    }
  }

  private careerSeason(panel: HTMLElement, profile: Profile): void {
    const season = displaySeason()
    const live = season.id === profile.seasonId
    const now = Date.now()
    const { start, end } = seasonBounds(season)
    const days = Math.max(0, Math.ceil(((now < start ? start : end) - now) / 86400000))
    const when = now < start ? `Starts in ${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} left`
    const head = el('div', 'season-head')
    head.append(el('strong', '', season.name), el('span', 'timer-chip', when))
    panel.append(head)
    const xp = live ? profile.seasonXp : 0
    const claimed = live ? profile.seasonClaimed : 0
    const nextTier = season.tiers[claimed]
    if (nextTier) {
      const prev = season.tiers[claimed - 1]?.xp ?? 0
      const span = Math.max(1, nextTier.xp - prev)
      panel.append(bar((xp - prev) / span, `Tier ${claimed + 1} · ${tierReward(nextTier)}`, `${xp - prev} / ${span} xp`))
    } else {
      const last = season.tiers[season.tiers.length - 1]!.xp
      const into = (xp - last) % OVERTIME_XP
      panel.append(bar(into / OVERTIME_XP, 'Overtime · coins every tier', `${into} / ${OVERTIME_XP} xp`))
    }
    const track = el('div', 'season-track')
    season.tiers.forEach((tier, i) => {
      const pip = el('div', `tier${i < claimed ? ' got' : ''}${i === claimed ? ' next' : ''}${tier.cosmetic ? ' prize' : ''}`)
      pip.title = `${tier.name} · ${tier.xp} xp`
      const ico = el('span', 'tier-ico')
      ico.append(icon(i < claimed ? 'check' : tier.cosmetic ? 'sparkle' : 'coin'))
      pip.append(el('b', '', String(i + 1)), ico, el('small', '', tierReward(tier)))
      track.append(pip)
    })
    panel.append(track)
    panel.append(el('p', 'lede', 'Season xp comes from matches and challenges. The season ends with coins for your peak rank, and a title at Gold or higher.'))
  }

  private careerMastery(panel: HTMLElement, profile: Profile): void {
    panel.append(el('p', 'lede', 'Mastery is a record of time spent, not power. Rewards are cosmetic.'))
    for (const [kind, label, items, book] of [
      ['ability', 'Abilities', ABILITIES, profile.abilityMastery],
      ['core', 'Cores', CORES, profile.mastery],
    ] as const) {
      panel.append(sectionTitle(label, kind === 'ability' ? 'shockwave' : 'stable'))
      const grid = el('div', 'mastery-grid')
      const sorted = [...items].sort((a, b) => (book[b.id] ?? 0) - (book[a.id] ?? 0))
      for (const item of sorted) {
        const m = masteryLevel(book[item.id] ?? 0)
        const card = el('div', `mastery${m.max ? ' max' : ''}`)
        const head = el('div', 'mastery-head')
        const ico = el('span', 'choice-ico small')
        ico.append(icon(item.id))
        head.append(ico, el('strong', '', item.name), el('b', 'mbadge', `M${m.level}`))
        card.append(head, bar(m.max ? 1 : m.have / m.need, '', m.max ? 'Max' : `${m.have}/${m.need}`))
        const next = nextMasteryReward(kind, item.id, m.level)
        if (next) card.append(el('small', '', `M${next.level}: ${next.name}`))
        grid.append(card)
      }
      panel.append(grid)
    }
  }

  private careerAwards(panel: HTMLElement, profile: Profile): void {
    const total = ACHIEVEMENTS.reduce((s, a) => s + a.tiers.length, 0)
    const got = ACHIEVEMENTS.reduce((s, a) => s + (profile.achievements[a.id] ?? 0), 0)
    panel.append(bar(got / total, 'Awards', `${got}/${total}`))
    const list = el('div', 'awards-grid')
    const rows = ACHIEVEMENTS.map((def) => ({ def, p: achievementProgress(profile, def) }))
    rows.sort((a, b) => Number(a.p.target === null) - Number(b.p.target === null) || progressOf(b.p) - progressOf(a.p))
    for (const { def, p } of rows) {
      const complete = p.target === null
      const row = el('div', `ach${complete ? ' done' : ''}`)
      const pips = el('span', 'tier-pips')
      def.tiers.forEach((_, i) => pips.append(el('i', i < p.tier ? 'on' : '')))
      const target = p.target ?? def.tiers[def.tiers.length - 1]!
      const shown = Math.min(Math.floor(p.value * 10) / 10, target)
      const body = el('div', '')
      body.append(bar(complete ? 1 : p.value / target, def.name, complete ? 'Complete' : `${shown}/${target}`))
      const reward = def.grant ? cosmeticById(def.grant)?.name : ''
      body.append(el('small', '', `${def.detail.replace('{n}', String(target))}${complete ? '' : ` · +${def.coins[p.tier]} coins`}${reward ? ` · final: ${reward}` : ''}`))
      row.append(pips, body)
      list.append(row)
    }
    panel.append(list)
  }

  // ================================================================ collection

  showCollection(profile: Profile): void {
    const main = this.frame('collection', 'collection', profile)
    main.classList.add('collection')
    const coins = el('div', 'pill coins big')
    coins.append(icon('coin'), el('b', '', String(profile.coins)))
    main.append(this.subhead('Collection', 'Cosmetics never change a hit.', coins))
    const tabs = el('div', 'seg')
    for (const [slot, label, ico] of SLOTS) {
      const all = COSMETICS.filter((c) => c.slot === slot)
      if (!all.length) continue
      const owned = all.filter((c) => profile.owned.includes(c.id)).length
      const b = button('', `seg-btn${this.collectionSlot === slot ? ' on' : ''}`, () => {
        this.collectionSlot = slot
        this.showCollection(profile)
      })
      b.append(icon(ico), el('span', '', label), el('em', 'seg-count', `${owned}/${all.length}`))
      tabs.append(b)
    }
    main.append(tabs)
    const grid = el('div', 'item-grid')
    const color = playerColor(profile)
    for (const item of COSMETICS.filter((c) => c.slot === this.collectionSlot)) {
      const owned = profile.owned.includes(item.id)
      const equipped = profile.equipped[item.slot] === item.id
      const card = el('div', `item${equipped ? ' on' : ''}${owned ? '' : ' locked'}`)
      card.append(itemArt(item, color))
      const text = el('div', 'item-text')
      text.append(el('strong', '', item.name), el('small', '', item.detail))
      card.append(text)
      if (owned) {
        const b = button('', `chip${equipped ? ' on' : ''}`, () => this.onEquip(item.id))
        b.append(icon(equipped ? 'check' : 'sparkle'), document.createTextNode(equipped ? 'Equipped' : 'Equip'))
        card.append(b)
      } else if (item.price > 0) {
        const buy = button('', `chip buy${profile.coins < item.price ? ' short' : ''}`, () => this.onBuy(item.id))
        buy.append(icon('coin'), document.createTextNode(String(item.price)))
        card.append(buy)
      } else {
        const lock = el('em', 'earn')
        lock.append(icon('lock'), document.createTextNode(item.earn))
        card.append(lock)
      }
      grid.append(card)
    }
    main.append(grid)
    this.stagger(main, 30)
  }

  // ================================================================ settings

  showSettings(profile: Profile): void {
    const main = this.frame('settings', 'settings', profile)
    main.classList.add('settings')
    main.append(this.subhead('Settings', 'Saved as you go.'))
    const cols = el('div', 'settings-grid')
    const group = (title: string, ico: string, ...rows: HTMLElement[]) => {
      const g = el('div', 'group')
      g.append(sectionTitle(title, ico), ...rows)
      cols.append(g)
    }
    const st = profile.settings
    group('Audio', 'volume',
      slider('Effects', st.volume, (v) => this.onSettings({ volume: v })),
      slider('Music', st.music, (v) => this.onSettings({ music: v })))
    const uiT = Math.max(0, Math.min(1, (st.uiScale - 0.85) / 0.4))
    group('Video', 'eye',
      slider('Screen shake', st.shake, (v) => this.onSettings({ shake: v })),
      slider('UI scale', uiT, (v) => this.onSettings({ uiScale: 0.85 + v * 0.4 }), (v) => `${Math.round((0.85 + v * 0.4) * 100)}%`),
      toggle('Reduced effects', 'Fewer particles, no impact frames', st.fx === 'reduced', (v) => this.onSettings({ fx: v ? 'reduced' : 'full' })),
      toggle('Stronger patterns', 'Extra marks on every ball', st.colorblind, (v) => this.onSettings({ colorblind: v })),
      toggle('Speed numbers', 'Show hit power', st.numbers, (v) => this.onSettings({ numbers: v })),
      toggle('Screen flashes', 'Full-screen flashes on big hits and knockouts', st.flashes, (v) => this.onSettings({ flashes: v })))
    const psT = Math.max(0, Math.min(1, (st.practiceSpeed - 0.5) / 0.5))
    const dzT = Math.max(0, Math.min(1, (st.deadzone - 0.05) / 0.3))
    group('Controls', 'gamepad',
      toggle('Mouse steer', 'Steer toward the cursor when no key is held', st.mouseSteer, (v) => this.onSettings({ mouseSteer: v })),
      toggle('Haptics', 'Phone vibration and gamepad rumble', st.haptics, (v) => this.onSettings({ haptics: v })),
      slider('Stick deadzone', dzT, (v) => this.onSettings({ deadzone: 0.05 + v * 0.3 }), (v) => `${Math.round((0.05 + v * 0.3) * 100)}%`),
      slider('Practice speed', psT, (v) => this.onSettings({ practiceSpeed: 0.5 + Math.round(v * 10) / 20 }), (v) => `${Math.round((0.5 + Math.round(v * 10) / 20) * 100)}%`))
    const keys = el('div', 'keys')
    const head = el('div', 'keys-head')
    head.append(el('span', '', 'Action'), el('span', '', 'Keyboard'), el('span', '', 'Gamepad'))
    keys.append(head)
    for (const [action, p1, p2] of [
      ['Steer', 'W A S D', 'L-Stick · D-pad'],
      ['Dash', 'Space', 'A · RT'],
      ['Ability', 'F E', 'B · X'],
      ['Brake', 'Shift', 'LT · LB'],
      ['Emote', 'G', 'Y'],
      ['Pause', 'Esc', 'Start'],
    ] as const) {
      const row = el('div', '')
      row.append(el('span', '', action), kbds(p1), kbds(p2))
      keys.append(row)
    }
    const fs = button('', 'btn ghost', () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen()
    })
    fs.append(icon('expand'), document.createTextNode('Toggle fullscreen'))
    group('Keys', 'gamepad', keys, fs)
    main.append(cols)
    this.stagger(cols, 60)
  }

  // ================================================================ results

  showResults(profile: Profile, outcome: SettleOutcome, result: MatchResult): void {
    this.current = 'results'
    document.body.dataset.screen = 'results'
    this.root.replaceChildren()
    const you = result.placements.find((p) => p.id === result.youId)
    const place = you?.place ?? 1
    const won = !!you?.won || place === 1
    const podium = isPodium(place, result.placements.length)
    const tone = won ? '#ffc14d' : podium ? '#59d4ff' : '#ff4d3a'
    const wrap = el('div', 'results')
    wrap.style.setProperty('--tone', tone)

    const hero = el('section', 'res-hero')
    const teamWin = won && place > 1 && modeById(result.modeId).teams
    const kicker = teamWin ? 'TEAM VICTORY' : won ? 'VICTORY' : result.forfeit && place === result.placements.length ? 'FORFEIT' : podium ? 'PODIUM' : result.competitive || result.placements.length <= 2 ? 'DEFEAT' : 'KNOCKED OUT'
    hero.append(el('div', 'res-kicker', kicker))
    const placeEl = el('div', 'place')
    const num = placeLabel(place)
    placeEl.append(el('span', '', num.replace(/\D+$/, '')), el('sup', '', num.replace(/^\d+/, '')))
    const preview = livePreview({ color: you?.color ?? playerColor(profile), skin: profile.equipped.skin, pattern: 0, mood: won ? 'happy' : podium ? 'idle' : 'hurt' }, 280, 250, { bounce: won ? 1.6 : 0.6 })
    const stage = el('div', 'res-stage')
    stage.append(placeEl, preview.el)
    hero.append(stage)
    hero.append(el('div', 'res-name', `${you?.name ?? profile.name} · ${result.competitive ? 'Ranked' : 'Casual'} · ${modeById(result.modeId).name}`))
    if (you) {
      const stats = el('div', 'res-stats')
      for (const [k, v, fmt, ico] of [
        ['Knockouts', you.elims, '', 'impact'],
        ['Falls', you.deaths, '', 'heart'],
        ['Best hit', Math.round(you.bestImpact), '', 'bolt'],
        ['Peak heat', Math.round(you.peakHeat ?? 0), '%', 'flame'],
      ] as const) {
        const d = el('div', 'res-stat')
        const b = el('b', '', '0')
        d.append(icon(ico), b, el('span', '', k))
        stats.append(d)
        countUp(b, v, 700, fmt)
      }
      hero.append(stats)
    }
    const moment = result.moments[0]
    if (moment || outcome.records[0]) {
      const box = el('div', 'moment')
      box.append(icon(moment ? 'film' : 'flag'), el('b', '', moment ? moment.title : 'NEW RECORD'), el('span', '', moment ? moment.detail : outcome.records[0]!))
      hero.append(box)
    }

    const side = el('section', 'res-side')
    const board = el('div', 'board')
    for (const p of [...result.placements].sort((a, b) => a.place - b.place)) {
      const medal = p.place <= 3 && (isPodium(p.place, result.placements.length) || p.place === 1) ? ` m${p.place}` : ''
      const row = el('div', `slot${p.id === result.youId ? ' you' : ''}${medal}`)
      const av = document.createElement('canvas')
      ballAvatar(av, p.color, p.id === result.youId ? profile.equipped.skin : 'skin_classic', 0, p.won ? 'happy' : 'idle', 26)
      row.append(el('b', 'pos', placeLabel(p.place)), av, el('span', 'nm', p.name), el('small', '', `${p.elims} KO`))
      board.append(row)
    }
    side.append(board)

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
      }, 500)
    }
    rewards.append(xp)
    const coins = el('div', 'pill coins big')
    const cnum = el('b', '', '0')
    coins.append(icon('coin'), cnum)
    countUp(cnum, outcome.coinsGained, 900, '', '+')
    rewards.append(coins)
    side.append(rewards)
    if (outcome.xpLines.length > 1) {
      const lines = el('div', 'xp-lines')
      for (const line of outcome.xpLines) {
        const row = el('div', '')
        row.append(el('span', '', line.label), el('b', '', `+${line.xp}`))
        lines.append(row)
      }
      side.append(lines)
    }
    if (outcome.rankMove) {
      const label = rankName(profile.rank.rating).label
      side.append(el('div', `rank-move ${outcome.rankMove}`, outcome.rankMove === 'up' ? `PROMOTED · ${label}` : `DOWN TO ${label}`))
    }
    const grants = el('div', 'grants')
    if (outcome.levelUp > 0) {
      const g = el('div', 'grant level')
      g.append(icon('star'), document.createTextNode(`LEVEL UP · ${after.level}`))
      grants.append(g)
    }
    grants.append(...grantChips(outcome.grants, 6).children)
    if (grants.childElementCount) side.append(grants)
    side.append(el('p', 'lede', result.competitive ? outcome.rankReason : 'Casual. Your rank did not change.'))
    const mastery = el('div', 'res-mastery')
    for (const m of outcome.mastery) {
      const lvl = masteryLevel(m.xp)
      mastery.append(bar(lvl.max ? 1 : lvl.have / lvl.need, `${m.name} M${lvl.level}${m.levelsGained ? ' ▲' : ''}`, `+${m.gained}`))
    }
    if (mastery.childElementCount) side.append(mastery)
    const changed = outcome.challenges.filter((c) => c.progress > 0)
    for (const c of changed.slice(0, 3)) side.append(bar(Math.min(1, c.progress / c.target), c.name, c.done ? 'Done' : `${Math.min(c.progress, c.target)}/${c.target}`))

    const actions = el('div', 'res-actions')
    const rematch = button('', 'cta-play compact', () => this.onRematch())
    rematch.append(icon('refresh'), el('span', '', 'REMATCH'), el('kbd', '', 'ENTER'))
    this.rematchKey = () => this.onRematch()
    const hl = button('', 'btn ghost', () => this.onHighlight())
    hl.append(icon('film'), document.createTextNode('Highlight'))
    const menu = button('', 'btn ghost', () => this.onMenu())
    menu.append(icon('home'), document.createTextNode('Menu'))
    actions.append(rematch, hl, menu)
    // Phones dock the actions to the bottom of the screen, outside the scrolling panels.
    const dock = window.matchMedia('(max-width: 760px)').matches
    if (dock) actions.classList.add('dock')
    else side.append(actions)

    wrap.append(hero, side)
    this.root.append(wrap)
    if (dock) this.root.append(actions)
    this.stagger(hero, 90)
    this.stagger(side, 55)
  }

  // ================================================================ pause

  /** Settings are needed for the quick sliders; the app passes them when it can. */
  setSettings(settings: Profile['settings']): void {
    this.settingsCache = settings
  }

  showPause(): void {
    if (this.root.querySelector('.overlay')) return
    const overlay = el('div', 'overlay')
    const sheet = el('div', 'sheet')
    const head = el('div', 'sheet-head')
    head.append(icon('pause'), el('b', '', 'PAUSED'))
    sheet.append(head)
    const resume = button('', 'cta-play compact', () => this.onResume())
    resume.append(icon('play'), el('span', '', 'RESUME'), el('kbd', '', 'ESC'))
    sheet.append(resume)
    if (this.settingsCache) {
      const s = this.settingsCache
      sheet.append(slider('Effects', s.volume, (v) => this.onSettings({ volume: v })), slider('Music', s.music, (v) => this.onSettings({ music: v })))
    }
    const row = el('div', 'sheet-row')
    const end = button('', 'btn ghost', () => this.onForfeit())
    end.append(icon('flag'), document.createTextNode('End match'))
    const menu = button('', 'btn ghost', () => this.onMenu())
    menu.append(icon('exit'), document.createTextNode('Menu'))
    row.append(end, menu)
    sheet.append(row)
    if (!window.matchMedia('(pointer: coarse)').matches) {
      const hints = el('div', 'hints')
      for (const [k, t] of [['WASD', 'Steer'], ['SPACE', 'Dash'], ['F', 'Ability'], ['SHIFT', 'Brake'], ['G', 'Emote']] as const) {
        const h = el('span', '')
        h.append(el('kbd', '', k), document.createTextNode(t))
        hints.append(h)
      }
      sheet.append(hints)
    }
    overlay.append(sheet)
    this.root.append(overlay)
  }

  hidePause(): void {
    this.root.querySelector('.overlay')?.remove()
  }

  // ================================================================ HUD

  mountHud(): void {
    this.current = 'match'
    document.body.dataset.screen = 'match'
    this.hud.replaceChildren()
    this.hud.classList.remove('out')
    this.cards.clear()
    this.lastBanner = null
    this.lastLeft = 0
    this.lastElims = 0
    this.lastStocks = -1
    this.dashReady = true
    this.abilityReady = true
    this.feedNodes = new WeakMap()

    const top = el('div', 'hud-top')
    const timer = el('div', 'timer')
    const phase = el('div', 'phase')
    top.append(timer, phase)
    const cards = el('div', 'hud-cards')
    const feed = el('div', 'hud-feed')
    const banner = el('div', 'banner')
    const callout = el('div', 'callout')
    const toast = el('div', 'ko-toast')
    const hint = el('div', 'hint')
    hint.hidden = true
    const spectate = el('div', 'spectate')
    spectate.hidden = true
    const intro = el('div', 'intro')
    intro.hidden = true

    const actions = el('div', 'hud-actions')
    const [dash, dashArc] = cdButton('dash', 'bolt', 'DASH', 'SPACE')
    const speed = el('div', 'speedo')
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 120 80')
    const track = document.createElementNS(ns, 'path')
    const arc = document.createElementNS(ns, 'path')
    const d = 'M 12 70 A 48 48 0 0 1 108 70'
    for (const p of [track, arc]) p.setAttribute('d', d)
    track.setAttribute('class', 'track')
    arc.setAttribute('class', 'arc')
    arc.setAttribute('pathLength', '100')
    arc.style.strokeDasharray = '0 100'
    svg.append(track, arc)
    const speedNum = el('b', '', '0')
    speed.append(svg, speedNum, el('small', '', 'SPEED'))
    const [ability, abilityArc, abilityIcon] = cdButton('ability', 'shockwave', 'ABILITY', 'F')
    const abilityName = ability.querySelector('.cd-name') as HTMLElement
    actions.append(dash, speed, ability)

    const pause = document.createElement('button')
    pause.type = 'button'
    pause.className = 'pause'
    pause.ariaLabel = 'Pause'
    pause.append(icon('pause'), el('span', '', 'PAUSE'))
    pause.addEventListener('click', () => {
      if (pause.dataset.act === 'end') this.onEnd()
      else this.onPause()
    })
    this.hud.append(top, cards, feed, banner, callout, toast, hint, spectate, intro, actions, pause)
    this.refs = {
      intro, phase, timer, cards, feed, banner, callout, toast, hint, spectate,
      speed, speedArc: arc, speedNum, dash, dashArc, ability, abilityArc, abilityName, abilityIcon, pause,
    }
  }

  syncHud(match: Match, youId: string, hint: string): void {
    const r = this.refs
    const you = match.players.find((p) => p.id === youId) ?? match.players[0]
    if (!r || !you) return

    // Intro card while the balls drop in: mode, arena and any twists.
    const counting = match.status === 'countdown'
    if (counting && !r.intro.childElementCount) {
      const mode = modeById(match.config.modeId)
      r.intro.style.setProperty('--tone', MODE_COLOR[mode.id] ?? '#ff4d3a')
      const head = el('div', 'intro-mode')
      head.append(icon(MODE_ICON[mode.id] ?? 'ball'), el('span', '', mode.name))
      r.intro.append(head, el('strong', '', match.arena.name), el('small', '', match.arena.blurb))
      const twists = match.mutators.map((id) => mutatorById(id)).filter((m): m is NonNullable<typeof m> => !!m)
      if (twists.length) {
        const muts = el('div', 'muts')
        for (const m of twists) {
          const chip = el('span', 'mut')
          chip.style.setProperty('--c', m.color)
          chip.append(el('i', 'dot'), document.createTextNode(m.name))
          muts.append(chip)
        }
        r.intro.append(muts)
      }
      // The lineup: every ball in the match, yours first, sliding in one after another.
      const lineup = el('div', 'lineup')
      const order = [...match.players].sort((a, b) => Number(b.id === youId) - Number(a.id === youId) || (match.config.teams ? a.team - b.team : 0))
      order.forEach((p, i) => {
        const card = el('div', `lu${p.id === youId ? ' you' : ''}`)
        card.style.setProperty('--c', match.config.teams ? TEAM_COLORS[p.team % TEAM_COLORS.length]! : p.color)
        card.style.setProperty('--d', `${120 + i * 70}ms`)
        const av = document.createElement('canvas')
        ballAvatar(av, p.color, p.skin, p.pattern, p.id === youId ? 'focus' : 'idle', 38)
        const meta = el('span', 'lu-meta')
        meta.append(el('b', '', p.name), el('small', '', p.bot ? botTag(p.botLevel) : p.id === youId ? 'YOU' : 'PLAYER'))
        card.append(av, meta)
        lineup.append(card)
      })
      r.intro.append(lineup)
    }
    r.intro.hidden = !counting
    this.hud.classList.toggle('counting', counting)

    // Clock and phase.
    const phase = match.status === 'sudden' ? 'SUDDEN DEATH' : match.finalPhase ? 'FINAL PHASE' : ''
    if (r.phase.textContent !== phase) r.phase.textContent = phase
    r.phase.hidden = !phase
    r.phase.classList.toggle('danger', match.status === 'sudden' || match.finalPhase)
    let secs = Infinity
    if (match.config.duration <= 0) {
      if (r.timer.textContent !== '∞') r.timer.textContent = '∞'
    } else {
      secs = match.status === 'sudden' ? Math.ceil(match.suddenLeft) : Math.max(0, Math.ceil(match.config.duration - match.time))
      const txt = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs)
      if (r.timer.textContent !== txt) {
        r.timer.textContent = txt
        if (secs <= 10 && match.status !== 'countdown') restart(r.timer, 'tick')
      }
    }
    r.timer.classList.toggle('urgent', secs <= 10 || match.status === 'sudden')

    this.syncCards(match, you)

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
    // Someone else's last stock in a crowd is a small callout, not a banner over the action.
    const minor = !!match.banner && match.banner.text === 'LAST STOCK' && match.banner.sub !== you.name && match.players.length > 2
    if (match.banner !== this.lastBanner) {
      this.lastBanner = match.banner
      r.banner.replaceChildren()
      if (minor && match.banner) {
        r.callout.textContent = `${match.banner.sub.toUpperCase()} · LAST STOCK`
        restart(r.callout, 'show')
      } else if (match.banner && match.banner.text !== 'GO') {
        const danger = /SUDDEN|FINAL|LAST|METEOR|HOLE|BLAST/.test(match.banner.text)
        r.banner.classList.toggle('danger', danger)
        r.banner.classList.toggle('win', /WINS/.test(match.banner.text))
        r.banner.append(el('strong', '', match.banner.text))
        if (match.banner.sub) r.banner.append(el('em', '', match.banner.sub))
        restart(r.banner, 'slam')
      }
    }
    // While a banner is up, the tip steps aside so the two never stack.
    this.hud.classList.toggle('bannering', !!match.banner && match.banner.text !== 'GO' && !minor)

    // "N LEFT" callout as contenders drop.
    const left = match.players.filter((p) => !p.eliminated).length
    if (this.lastLeft && left < this.lastLeft && left > 1 && match.players.length > 2) {
      r.callout.textContent = `${left} LEFT`
      restart(r.callout, 'show')
    }
    this.lastLeft = left

    // Your knockouts get a callout, and streaks escalate.
    if (you.stats.elims > this.lastElims) {
      const streak = match.time - you.lastElimTime < 0.2 ? you.elimStreak : 1
      const words = ['', 'KNOCKOUT!', 'DOUBLE KO!', 'TRIPLE KO!', 'RAMPAGE!']
      r.toast.replaceChildren(el('strong', '', words[Math.min(4, streak)] ?? 'RAMPAGE!'), el('em', '', `+1 · ${you.stats.elims} total`))
      r.toast.classList.toggle('streak', streak >= 2)
      restart(r.toast, 'show')
    }
    this.lastElims = you.stats.elims
    if (this.lastStocks >= 0 && you.stocks < this.lastStocks && !you.eliminated) {
      r.toast.replaceChildren(el('strong', '', 'STOCK LOST'), el('em', '', `${you.stocks} left`))
      r.toast.classList.remove('streak')
      r.toast.classList.add('bad')
      restart(r.toast, 'show')
      window.setTimeout(() => r.toast.classList.remove('bad'), 1400)
    }
    this.lastStocks = you.stocks

    const out = !you.alive && you.eliminated
    this.hud.classList.toggle('out', out)
    r.spectate.hidden = !out || match.status === 'celebrate' || match.status === 'finished'
    r.hint.hidden = !hint || out
    if (r.hint.textContent !== hint) r.hint.textContent = hint
    if (out && !r.spectate.childElementCount) {
      const ff = el('span', 'ff')
      ff.append(icon('next'), icon('next'), document.createTextNode('FAST-FORWARD'))
      r.spectate.append(el('strong', '', `ELIMINATED · ${placeLabel(you.placement)}`), ff, el('small', '', 'Watching the finish · RESULTS to skip'))
    }

    // Speed and cooldowns.
    const momentum = you.alive ? you.momentum : 0
    setPathArc(r.speedArc, momentum)
    const sp = String(Math.round(momentum * 100))
    if (r.speedNum.textContent !== sp) r.speedNum.textContent = sp
    r.speed.style.setProperty('--m', speedColor(momentum))
    r.speed.classList.toggle('max', momentum > 0.85)

    const dashPct = you.dashCdMax <= 0 ? 1 : 1 - Math.min(1, you.dashCd / you.dashCdMax)
    setArc(r.dashArc, dashPct)
    const dashReady = you.dashCd <= 0
    r.dash.classList.toggle('ready', dashReady)
    if (dashReady && !this.dashReady) restart(r.dash, 'pop')
    this.dashReady = dashReady

    const ability = abilityById(you.ability)
    if (r.abilityName.textContent !== ability.name.toUpperCase()) {
      r.abilityName.textContent = ability.name.toUpperCase()
      r.abilityIcon.replaceChildren(icon(ability.id))
    }
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

  /** Smash-style player cards: avatar, big heat %, stocks. Built once, then patched in place. */
  private syncCards(match: Match, you: Body): void {
    const r = this.refs!
    const teams = match.config.teams
    const points = match.config.win === 'score'
    const endless = match.config.respawn === 'always'
    if (this.cards.size !== match.players.length) {
      r.cards.replaceChildren()
      this.cards.clear()
      const order = teams ? [...match.players].sort((a, b) => a.team - b.team) : match.players
      r.cards.classList.toggle('many', order.length > 5)
      for (const p of order) {
        const root = el('div', `pcard${p.id === you.id ? ' you' : ''}${teams ? ' team' : ''}`)
        root.style.setProperty('--c', p.color)
        if (teams) root.style.setProperty('--team', TEAM_COLORS[p.team % TEAM_COLORS.length]!)
        const av = document.createElement('canvas')
        av.className = 'pc-av'
        ballAvatar(av, p.color, p.skin, p.pattern, 'idle', 40)
        const body = el('div', 'pc-body')
        const name = el('span', 'pc-name', p.name)
        const heat = el('b', 'pc-heat', '0%')
        const sub = el('span', 'pc-sub', '')
        body.append(name, heat)
        const stocks = el('div', 'pc-stocks')
        root.append(av, body, sub, stocks)
        r.cards.append(root)
        this.cards.set(p.id, { root, heat, sub, stocks, lastHeat: -1, lastStocks: -1, lastSub: '', state: '' })
      }
    }
    for (const p of match.players) {
      const c = this.cards.get(p.id)
      if (!c) continue
      const state = p.eliminated ? 'out' : !p.alive ? 'down' : ''
      if (state !== c.state) {
        c.root.classList.toggle('out', state === 'out')
        c.root.classList.toggle('down', state === 'down')
        if (state === 'out') restart(c.root, 'ko')
        c.state = state
      }
      const h = p.alive ? Math.floor(p.heat) : 0
      if (h !== c.lastHeat) {
        if (h > c.lastHeat && c.lastHeat >= 0) restart(c.heat, h - c.lastHeat > 12 ? 'bump-big' : 'bump')
        c.lastHeat = h
        c.heat.textContent = p.eliminated ? `#${p.placement}` : `${h}%`
        c.heat.style.color = p.eliminated ? '' : heatColor(h)
        c.root.classList.toggle('hot', h >= 100)
      }
      if (p.hitFlash > 0.95 && p.alive) restart(c.root, 'shake')
      const subText = points ? `${Math.floor(p.stats.score)} pts` : endless ? `${p.stats.elims} KO` : ''
      if (subText !== c.lastSub) {
        c.lastSub = subText
        c.sub.textContent = subText
      }
      const stocks = endless ? 0 : Math.max(0, Math.min(5, p.stocks))
      if (stocks !== c.lastStocks) {
        const lost = c.lastStocks > stocks
        c.stocks.replaceChildren()
        for (let i = 0; i < Math.max(stocks, lost ? c.lastStocks : 0); i++) {
          const pip = el('i', i >= stocks ? 'lost' : '')
          c.stocks.append(pip)
        }
        c.lastStocks = stocks
      }
    }
  }
}

// ==================================================================== helpers

function playerColor(profile: Profile): string {
  return PALETTE[profile.color % PALETTE.length] ?? PALETTE[0]!
}

function untilMidnight(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const mins = Math.max(1, Math.round((next.getTime() - now.getTime()) / 60000))
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}

function romanOf(division: number, tierId: string): string {
  if (tierId === 'grandmaster') return '★'
  return ['I', 'II', 'III'][division - 1] ?? 'I'
}

/** A hexagonal rank badge drawn as SVG, tinted by tier. */
function rankEmblem(tierId: string, label: string, size: number): HTMLElement {
  const c = tierId === 'placement' ? '#93a0b4' : TIER_COLOR[tierId] ?? '#ffc14d'
  const wrap = el('span', 'emblem')
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`
  const id = `g${Math.random().toString(36).slice(2, 8)}`
  wrap.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.55)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.55)}"/></linearGradient></defs>
    <path d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z" fill="${shade(c, -0.7)}"/>
    <path d="M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z" fill="url(#${id})"/>
    <path d="M50 10 L85 30 L50 50 L15 30 Z" fill="rgba(255,255,255,0.22)"/>
    <path d="M50 22 L74 36 L74 64 L50 78 L26 64 L26 36 Z" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="3"/>
  </svg>`
  wrap.append(el('b', '', label))
  return wrap
}

function cdButton(kind: string, ico: string, name: string, key: string): [HTMLElement, SVGCircleElement, HTMLElement] {
  const wrap = el('div', `cd ${kind}`)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 80 80')
  const track = document.createElementNS(ns, 'circle')
  const arc = document.createElementNS(ns, 'circle')
  for (const c of [track, arc]) {
    c.setAttribute('cx', '40')
    c.setAttribute('cy', '40')
    c.setAttribute('r', '35')
  }
  track.setAttribute('class', 'track')
  arc.setAttribute('class', 'arc')
  arc.setAttribute('pathLength', '100')
  arc.style.strokeDasharray = '0 100'
  svg.append(track, arc)
  const face = el('span', 'cd-face')
  const iw = el('span', 'cd-ico')
  iw.append(icon(ico))
  face.append(iw)
  wrap.append(svg, face, el('b', 'cd-name', name), el('kbd', '', key))
  return [wrap, arc, iw]
}

function arenaThumb(arena: ArenaDef | null): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const W = 160
  const H = 112
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = W * dpr
  c.height = H * dpr
  c.className = 'thumb'
  const g = c.getContext('2d')
  if (!g) return c
  g.scale(dpr, dpr)
  const T = 0.62
  if (!arena) {
    g.beginPath()
    g.ellipse(80, 66, 54, 54 * T, 0, 0, TAU)
    g.fillStyle = 'rgba(255,255,255,0.06)'
    g.fill()
    g.setLineDash([6, 6])
    g.strokeStyle = 'rgba(255,255,255,0.3)'
    g.lineWidth = 2
    g.stroke()
    g.setLineDash([])
    g.fillStyle = '#ffc14d'
    g.font = '44px "Lilita One", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('?', 80, 60)
    return c
  }
  const k = 56 / arena.view
  const P = (x: number, y: number) => ({ x: 80 + x * k * 1.15, y: 60 + y * k * 1.15 * T })
  const depth = 10
  const poses = arena.solids.map((s) => solidPose(s, 0, { cut: 0, innerGrow: 0 })).sort((a, b) => a.y - b.y)
  for (const pass of ['side', 'top'] as const) {
    for (const pose of poses) {
      const s = P(pose.x, pose.y)
      const rx = pose.r * k * 1.15
      const ry = rx * T
      g.beginPath()
      if (pose.shape === 'poly') {
        pose.points.forEach((pt, i) => {
          const q = P(pt.x, pt.y)
          if (pass === 'side') q.y += depth
          if (i) g.lineTo(q.x, q.y)
          else g.moveTo(q.x, q.y)
        })
        g.closePath()
      } else if (pass === 'side') {
        g.ellipse(s.x, s.y + depth, rx, ry, 0, 0, TAU)
      } else {
        g.ellipse(s.x, s.y, rx, ry, 0, 0, TAU)
        if (pose.shape === 'ring') {
          g.moveTo(s.x + pose.inner * k * 1.15, s.y)
          g.ellipse(s.x, s.y, pose.inner * k * 1.15, pose.inner * k * 1.15 * T, 0, 0, TAU, true)
        }
      }
      if (pass === 'side') {
        g.fillStyle = shade(arena.floor, -0.6)
        g.fill()
      } else {
        const gr = g.createRadialGradient(s.x - rx * 0.2, s.y - ry * 0.4, 1, s.x, s.y, rx * 1.1)
        gr.addColorStop(0, shade(arena.floor, 0.25))
        gr.addColorStop(1, shade(arena.floor, -0.2))
        g.fillStyle = gr
        g.fill('evenodd')
        g.strokeStyle = arena.rim
        g.lineWidth = 2
        g.stroke()
      }
    }
  }
  for (const h of arena.hazards) {
    const s = P(h.x, h.y)
    g.fillStyle = h.kind === 'lava' ? '#ff6a2a' : h.color
    if (h.w && h.h) {
      g.globalAlpha = 0.4
      g.fillRect(s.x - (h.w * k * 1.15) / 2, s.y - (h.h * k * 1.15 * T) / 2, h.w * k * 1.15, h.h * k * 1.15 * T)
      g.globalAlpha = 1
    } else {
      g.beginPath()
      g.ellipse(s.x, s.y, Math.max(2.5, h.r * k * 1.15), Math.max(2, h.r * k * 1.15 * T), 0, 0, TAU)
      g.fill()
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = 2.5
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

/** Stats bars for the equipped core and shell, against the Stable/Rubber baseline. */
function statBlock(profile: Profile): HTMLElement {
  const core = coreById(profile.loadout.core)
  const shell = shellById(profile.loadout.shell)
  const rows: [string, number, number][] = [
    // label, value, baseline; each normalised to 0..1 over the range the content uses.
    ['Power', norm(core.outgoing * shell.outgoing, 0.75, 1.4), norm(1, 0.75, 1.4)],
    ['Weight', norm(core.mass * shell.mass, 0.65, 1.55), norm(1, 0.65, 1.55)],
    ['Speed', norm(core.maxSpeed, 0.85, 1.2), norm(1, 0.85, 1.2)],
    ['Pickup', norm(core.accel, 0.8, 1.28), norm(1, 0.8, 1.28)],
    ['Control', norm(core.turn, 0.8, 1.2), norm(1, 0.8, 1.2)],
    ['Toughness', norm(1 / (core.incoming * shell.incoming), 0.75, 1.4), norm(1, 0.75, 1.4)],
  ]
  const wrap = el('div', 'stat-bars')
  const head = el('div', 'stat-head')
  head.append(el('strong', '', `${core.name} core · ${shell.name} shell`))
  wrap.append(head)
  for (const [label, v, base] of rows) {
    const row = el('div', 'stat-row')
    const trk = el('span', 'stat-track')
    const fill = el('i', `stat-fill${v > base + 0.02 ? ' up' : v < base - 0.02 ? ' down' : ''}`)
    fill.style.width = `${Math.round(v * 100)}%`
    const mark = el('i', 'stat-base')
    mark.style.left = `${Math.round(base * 100)}%`
    trk.append(fill, mark)
    row.append(el('span', 'stat-label', label), trk)
    wrap.append(row)
  }
  return wrap
}

function norm(v: number, a: number, b: number): number {
  return Math.max(0.04, Math.min(1, (v - a) / (b - a)))
}

function itemArt(item: CosmeticDef, color: string): HTMLElement {
  const art = el('div', `item-art art-${item.slot}`)
  if (item.slot === 'skin') {
    const c = document.createElement('canvas')
    ballAvatar(c, color, item.id, 0, 'idle', 78)
    art.append(c)
  } else if (item.slot === 'trail') {
    const c = document.createElement('canvas')
    trailArt(c, item.id, color)
    art.append(c)
  } else if (item.slot === 'emote') {
    art.append(el('span', 'bubble', item.name))
  } else if (item.slot === 'title') {
    art.append(el('span', 'plate', item.name))
  } else if (item.slot === 'banner') {
    const b = el('span', `banner-art ${item.id}`)
    b.style.setProperty('--c', color)
    art.append(b)
  } else if (item.slot === 'frame') {
    art.append(el('span', `frame-art ${item.id}`))
  } else {
    art.append(icon('impact'))
  }
  return art
}

function trailArt(canvas: HTMLCanvasElement, id: string, color: string): void {
  const W = 150
  const H = 70
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = W * dpr
  canvas.height = H * dpr
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
  const g = canvas.getContext('2d')
  if (!g) return
  g.scale(dpr, dpr)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < 16; i++) pts.push({ x: 14 + i * 7, y: 35 + Math.sin(i * 0.45) * 12 })
  const r = 11
  const head = pts[pts.length - 1]!
  g.globalCompositeOperation = 'lighter'
  g.lineCap = 'round'
  if (id === 'trail_ribbon') {
    for (let i = 1; i < pts.length; i++) {
      g.strokeStyle = hexA(color, (i / pts.length) * 0.5)
      g.lineWidth = r * 1.8
      g.beginPath()
      g.moveTo(pts[i - 1]!.x, pts[i - 1]!.y)
      g.lineTo(pts[i]!.x, pts[i]!.y)
      g.stroke()
    }
  } else if (id === 'trail_ion') {
    for (const side of [-1, 1]) {
      g.beginPath()
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y + side * 6) : g.moveTo(p.x, p.y + side * 6)))
      g.strokeStyle = mixHex(color, '#ffffff', 0.4)
      g.lineWidth = 2
      g.stroke()
    }
  } else if (id === 'trail_spark') {
    pts.forEach((p, i) => {
      g.strokeStyle = hexA(i % 2 ? '#ffffff' : color, i / pts.length)
      g.lineWidth = 1.6
      g.beginPath()
      g.moveTo(p.x, p.y)
      g.lineTo(p.x + Math.sin(i * 9) * 8, p.y + Math.cos(i * 5) * 8)
      g.stroke()
    })
  } else if (id === 'trail_hex') {
    pts.forEach((p, i) => {
      if (i % 2) return
      g.strokeStyle = hexA(color, i / pts.length)
      g.lineWidth = 1.6
      g.beginPath()
      for (let k = 0; k <= 6; k++) g.lineTo(p.x + Math.cos((k / 6) * TAU + i) * 5, p.y + Math.sin((k / 6) * TAU + i) * 5)
      g.stroke()
    })
  } else if (id === 'trail_ember') {
    pts.forEach((p, i) => {
      g.fillStyle = hexA(i % 2 ? '#ffc14d' : '#ff6a2a', i / pts.length)
      g.beginPath()
      g.arc(p.x + Math.sin(i * 3) * 4, p.y - (pts.length - i) * 0.8, 2, 0, TAU)
      g.fill()
    })
  } else if (id !== 'trail_none') {
    for (let i = 1; i < pts.length; i++) {
      const u = i / (pts.length - 1)
      g.strokeStyle = hexA(mixHex(color, '#ffffff', u * 0.4), u * 0.9)
      g.lineWidth = Math.max(1, r * 1.6 * u)
      g.beginPath()
      g.moveTo(pts[i - 1]!.x, pts[i - 1]!.y)
      g.lineTo(pts[i]!.x, pts[i]!.y)
      g.stroke()
    }
  }
  g.globalCompositeOperation = 'source-over'
  paintBall(g, head.x, head.y, r, { color, skin: 'skin_classic', pattern: 0, lookX: 0.8, lookY: 0, expression: 'focus', blink: 0, time: 0 })
}

function grantChips(grants: Grant[], limit: number): HTMLElement {
  const wrap = el('div', 'grants')
  const ordered = [...grants].sort((a, b) => GRANT_ORDER.indexOf(a.kind) - GRANT_ORDER.indexOf(b.kind))
  const shown = ordered.slice(0, limit)
  for (const g of shown) {
    const chip = el('div', `grant ${g.kind}`)
    chip.append(icon(GRANT_ICON[g.kind] ?? 'sparkle'), document.createTextNode(`${g.name} · ${g.detail}`))
    wrap.append(chip)
  }
  if (ordered.length > shown.length) {
    const more = el('div', 'grant more', `+${ordered.length - shown.length} more`)
    more.title = ordered.slice(shown.length).map((g) => `${g.name} · ${g.detail}`).join('\n')
    wrap.append(more)
  }
  return wrap
}

function statGrid(items: [string, string, string][]): HTMLElement {
  const grid = el('div', 'stat-grid')
  for (const [k, v, ico] of items) {
    const d = el('div', 'stat')
    d.append(icon(ico), el('b', '', v), el('span', '', k))
    grid.append(d)
  }
  return grid
}

/** Where the rating sits between this tier's floor and the next. */
function rankLadder(rating: number): HTMLElement {
  const i = rankTierIndex(rating)
  const tier = RANK_TIERS[i]!
  const next = RANK_TIERS[i + 1]
  if (!next) return bar(1, `${rating}`, 'Top tier')
  return bar((rating - tier.min) / (next.min - tier.min), `${rating} SR`, `${next.min - rating} to ${next.name}`)
}

function tierReward(tier: { cosmetic?: string; coins?: number; name: string }): string {
  if (tier.cosmetic) return cosmeticById(tier.cosmetic)?.name ?? tier.name
  return `${tier.coins ?? 0} coins`
}

function nextMasteryReward(kind: 'core' | 'ability', id: string, level: number): { level: number; name: string } | null {
  for (let l = level + 1; l <= MASTERY_MAX; l++) {
    const reward = masteryReward(kind, id, l)
    if (reward) return { level: l, name: cosmeticById(reward)?.name ?? reward }
  }
  return null
}

function progressOf(p: { value: number; target: number | null }): number {
  return p.target ? Math.min(1, p.value / p.target) : 1
}

function setArc(arc: SVGCircleElement, t: number): void {
  const u = Math.max(0, Math.min(1, t))
  const v = `${(u * 100).toFixed(1)} 100`
  if (arc.style.strokeDasharray !== v) arc.style.strokeDasharray = v
  // A zero-length dash with round caps still paints a dot.
  const o = u > 0.005 ? '1' : '0'
  if (arc.style.opacity !== o) arc.style.opacity = o
}

function setPathArc(arc: SVGPathElement, t: number): void {
  const u = Math.max(0, Math.min(1, t))
  const v = `${(u * 100).toFixed(1)} 100`
  if (arc.style.strokeDasharray !== v) arc.style.strokeDasharray = v
  const o = u > 0.005 ? '1' : '0'
  if (arc.style.opacity !== o) arc.style.opacity = o
}

function speedColor(t: number): string {
  if (t < 0.4) return '#f4f7fb'
  if (t < 0.7) return '#ffc14d'
  if (t < 0.9) return '#ff7a3a'
  return '#ff2d55'
}

function restart(node: HTMLElement, cls: string): void {
  node.classList.remove(cls)
  void node.offsetWidth
  node.classList.add(cls)
}

function countUp(node: HTMLElement, to: number, ms: number, suffix = '', prefix = ''): void {
  const start = performance.now() + 350
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

function miniBar(t: number, tone = ''): HTMLElement {
  const track = el('span', `mini-bar${tone ? ` ${tone}` : ''}`)
  const fill = el('i')
  fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`
  track.append(fill)
  return track
}

function sectionTitle(text: string, ico: string): HTMLElement {
  const s = el('div', 'section')
  s.append(icon(ico), el('span', '', text))
  return s
}

function kbds(text: string): HTMLElement {
  const wrap = el('span', 'kbds')
  if (!text) return wrap
  // "·" separates alternatives and is drawn as a divider, not a key.
  for (const part of text.split(' ')) wrap.append(part === '·' ? el('i', 'kbd-or', '/') : el('kbd', '', part))
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

function slider(label: string, value: number, onChange: (v: number) => void, format: (v: number) => string = (v) => String(Math.round(v * 100))): HTMLElement {
  const wrap = el('label', 'slider')
  const num = el('b', '', format(value))
  const head = el('span', '')
  head.append(document.createTextNode(label), num)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.style.setProperty('--fill', `${value * 100}%`)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    num.textContent = format(v)
    input.style.setProperty('--fill', `${v * 100}%`)
    onChange(v)
  })
  wrap.append(head, input)
  return wrap
}


/** Short skill tag for a bot in the lineup. */
function botTag(level: string): string {
  return level === 'champion' ? 'CHAMPION' : level === 'ace' ? 'ACE' : level === 'rival' ? 'RIVAL' : 'ROOKIE'
}
