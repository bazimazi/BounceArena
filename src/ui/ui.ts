import { ABILITIES, CORES, PASSIVES, SHELLS } from '../data/tuning'
import {
  ACHIEVEMENTS,
  ARENAS,
  COSMETICS,
  MODES,
  OVERTIME_XP,
  RANK_TIERS,
  SWEEP_BONUS,
  arenaById,
  cosmeticById,
  dateKey,
  displaySeason,
  MASTERY_LEVELS,
  masteryLevel,
  masteryReward,
  modeById,
  rankName,
  rankTierIndex,
  type ArenaDef,
  type CosmeticDef,
} from '../data/content'
import { abilityById } from '../data/tuning'
import type { MatchResult } from '../core/types'
import { xpIntoLevel, type Profile } from '../progression/profile'
import { achievementProgress, canReroll, challengeDef, liveDayStreak, type Grant, type SettleOutcome } from '../progression/settle'
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

type CareerTab = 'overview' | 'challenges' | 'season' | 'mastery' | 'awards'

const MASTERY_MAX = MASTERY_LEVELS.length

const CAREER_TABS: [CareerTab, string][] = [
  ['overview', 'Overview'],
  ['challenges', 'Challenges'],
  ['season', 'Season'],
  ['mastery', 'Mastery'],
  ['awards', 'Awards'],
]

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

const GRANT_ORDER: Grant['kind'][] = ['rank', 'cosmetic', 'achievement', 'season', 'level', 'mastery', 'challenge', 'record', 'coins']

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
  onReroll: (id: string) => void = () => {}
  careerTab: CareerTab = 'overview'

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

  showMenu(profile: Profile, notices: Grant[] = []): void {
    const panel = this.screen('menu')
    panel.append(this.brand())
    panel.append(this.profileCard(profile))
    if (notices.length) panel.append(noticeCard(notices))

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
    const abilityBadge = (id: string) => `M${masteryLevel(profile.abilityMastery[id] ?? 0).level}`
    const coreBadge = (id: string) => `M${masteryLevel(profile.mastery[id] ?? 0).level}`
    panel.append(this.pick('Ability', 'F', ABILITIES, profile.loadout.ability, (id) => this.onLoadout('ability', id), abilityBadge))
    panel.append(this.pick('Ball core', '', CORES, profile.loadout.core, (id) => this.onLoadout('core', id), coreBadge))
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
    const title = el('b', 'rank-title', rank)
    if (profile.rank.shield > 0 && !placing) title.append(el('span', 'shield', `Shield ${profile.rank.shield}`))
    info.append(title, el('small', '', `Season peak ${profile.rank.peakLabel}. ${profile.rank.lastReason || 'Play ranked to move this.'}`))
    if (!placing) info.append(rankLadder(profile.rank.rating))
    info.append(bar(lvl.have / lvl.need, `Level ${lvl.level}`, `${lvl.have} / ${lvl.need} xp`))
    hero.append(badge, info)
    panel.append(hero)

    const tabs = el('div', 'tabs')
    tabs.setAttribute('role', 'tablist')
    for (const [id, label] of CAREER_TABS) {
      const tab = button(label, `tab${this.careerTab === id ? ' on' : ''}`, () => {
        this.careerTab = id
        this.showCareer(profile)
      })
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(this.careerTab === id))
      if (id === 'challenges') {
        const open = [...profile.challenges.daily, ...profile.challenges.weekly].filter((c) => !profile.challenges.done.includes(c)).length
        if (open) tab.append(el('i', 'count', String(open)))
      }
      tabs.append(tab)
    }
    panel.append(tabs)

    if (this.careerTab === 'overview') this.careerOverview(panel, profile)
    else if (this.careerTab === 'challenges') this.careerChallenges(panel, profile)
    else if (this.careerTab === 'season') this.careerSeason(panel, profile)
    else if (this.careerTab === 'mastery') this.careerMastery(panel, profile)
    else this.careerAwards(panel, profile)
    this.stagger(panel)
  }

  private careerOverview(panel: HTMLElement, profile: Profile): void {
    const s = profile.stats
    panel.append(statGrid([
      ['Matches', String(s.matches)],
      ['Wins', String(s.wins)],
      ['Knockouts', String(s.elims)],
      ['Podiums', String(s.podiums)],
      ['Ranked wins', String(s.rankedWins)],
      ['Best streak', String(s.bestStreak)],
      ['Day streak', String(liveDayStreak(profile))],
      ['Play time', `${Math.round(s.playTime / 60)}m`],
    ]))

    panel.append(el('div', 'section', 'Records'))
    const r = profile.records
    panel.append(statGrid([
      ['Longest launch', `${r.biggestLaunch.toFixed(1)} m`],
      ['Top speed', String(Math.round(r.highestSpeed))],
      ['Best multi-KO', String(r.bestMulti)],
      ['Fastest KO', r.fastestElim ? `${r.fastestElim.toFixed(1)}s` : '-'],
      ['Longest life', `${Math.round(r.longestSurvival)}s`],
      ['Most KOs', String(r.mostElims)],
      ['Comebacks', String(r.comebacks)],
      ['Coins', String(profile.coins)],
    ]))

    if (profile.recent.length) {
      panel.append(el('div', 'section', 'Recent'))
      const list = el('div', 'board recent')
      for (const m of profile.recent.slice(0, 8)) {
        const row = el('div', `slot${m.place === 1 ? ' medal m1' : ''}`)
        row.append(el('b', 'pos', String(m.place)), el('span', '', `${modeById(m.mode).name} · ${arenaById(m.arena).name}`))
        const delta = el('small', m.competitive ? (m.delta >= 0 ? 'up' : 'down') : '', m.competitive ? `${m.delta >= 0 ? '+' : ''}${m.delta}` : 'Casual')
        row.append(delta)
        list.append(row)
      }
      panel.append(list)
    }

    if (profile.rank.history.length) {
      panel.append(el('div', 'section', 'Past seasons'))
      const list = el('div', 'stack')
      for (const h of profile.rank.history) {
        const row = el('div', 'challenge')
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
      const head = el('div', 'section', `${label} · ${done}/${ids.length}`)
      panel.append(head)
      const list = el('div', 'stack')
      for (const id of ids) {
        const def = challengeDef(id)
        if (!def) continue
        const prog = Math.min(profile.challenges.progress[id] ?? 0, def.target)
        const finished = profile.challenges.done.includes(id)
        const row = el('div', `challenge${finished ? ' done' : ''}`)
        row.append(el('b', 'tag', cadence === 'daily' ? 'DAY' : 'WEEK'))
        const body = el('div', '')
        body.append(bar(finished ? 1 : prog / def.target, def.name, finished ? 'Done' : `${prog}/${def.target}`), el('small', '', `${def.detail} · ${def.coins} coins · ${def.xp} season xp`))
        row.append(body)
        if (!finished && reroll) {
          const swap = button('Swap', 'chip reroll', () => this.onReroll(id))
          swap.ariaLabel = `Reroll ${def.name}`
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
    const start = Date.parse(season.start)
    const end = Date.parse(season.end) + 86400000
    const days = Math.max(0, Math.ceil(((now < start ? start : end) - now) / 86400000))
    const when = now < start ? `Starts in ${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} left`
    const head = el('div', 'season-head')
    head.append(el('strong', '', season.name), el('small', '', when))
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
    const track = el('div', 'season')
    season.tiers.forEach((tier, i) => {
      const pip = el('div', `tier${i < claimed ? ' got' : ''}${i === claimed ? ' next' : ''}${tier.cosmetic ? ' prize' : ''}`)
      pip.title = `${tier.name} · ${tier.xp} xp`
      pip.append(el('b', '', String(i + 1)), el('small', '', tierReward(tier)))
      track.append(pip)
    })
    panel.append(track)
    panel.append(el('p', 'lede', `Season xp comes from matches and challenges. The season ends with coins for your peak rank, and a title at Gold or higher.`))
  }

  private careerMastery(panel: HTMLElement, profile: Profile): void {
    panel.append(el('p', 'lede', 'Mastery is a record of time spent, not power. Rewards are cosmetic.'))
    for (const [kind, label, items, book] of [
      ['ability', 'Abilities', ABILITIES, profile.abilityMastery],
      ['core', 'Cores', CORES, profile.mastery],
    ] as const) {
      panel.append(el('div', 'section', label))
      const grid = el('div', 'grid')
      const sorted = [...items].sort((a, b) => (book[b.id] ?? 0) - (book[a.id] ?? 0))
      for (const item of sorted) {
        const m = masteryLevel(book[item.id] ?? 0)
        const card = el('div', `mastery${m.max ? ' max' : ''}`)
        const head = el('div', 'mastery-head')
        head.append(el('strong', '', item.name), el('b', 'mbadge', `M${m.level}`))
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
    const list = el('div', 'stack')
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
    if (outcome.xpLines.length > 1) {
      const lines = el('div', 'xp-lines')
      for (const line of outcome.xpLines) {
        const row = el('div', '')
        row.append(el('span', '', line.label), el('b', '', `+${line.xp}`))
        lines.append(row)
      }
      card.append(lines)
    }
    if (outcome.rankMove) {
      const label = rankName(profile.rank.rating).label
      card.append(el('div', `rank-move ${outcome.rankMove}`, outcome.rankMove === 'up' ? `PROMOTED · ${label}` : `DOWN TO ${label}`))
    }
    const grants = el('div', 'grants')
    if (outcome.levelUp > 0) grants.append(el('div', 'grant', `LEVEL UP · ${after.level}`))
    grants.append(...grantChips(outcome.grants, 6).children)
    if (grants.childElementCount) card.append(grants)
    card.append(el('p', 'lede', result.competitive ? outcome.rankReason : 'Casual. Your rank did not change.'))
    const mastery = el('div', 'grid res-mastery')
    for (const m of outcome.mastery) {
      const lvl = masteryLevel(m.xp)
      mastery.append(bar(lvl.max ? 1 : lvl.have / lvl.need, `${m.name} M${lvl.level}${m.levelsGained ? ' ▲' : ''}`, `+${m.gained}`))
    }
    if (mastery.childElementCount) card.append(mastery)
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
    const def = next ? challengeDef(next) : undefined
    if (def) {
      const prog = Math.min(profile.challenges.progress[def.id] ?? 0, def.target)
      const goal = el('div', 'goal')
      goal.append(el('b', 'tag', 'DAILY'), el('span', '', def.detail), el('small', '', `${prog}/${def.target}`))
      card.append(goal)
    }
    const perks: string[] = []
    if (profile.daily.firstWinDay !== dateKey()) perks.push('First win bonus ready')
    const streak = liveDayStreak(profile)
    if (streak > 1) perks.push(`Day streak ${streak}`)
    if (perks.length) card.append(el('div', 'perks', perks.join(' · ')))
    return card
  }

  private pick<T extends { id: string; name: string; blurb: string }>(title: string, key: string, items: T[], current: string, choose: (id: string) => void, badge?: (id: string) => string): HTMLElement {
    const wrap = el('div', 'stack')
    const head = el('div', 'section', title)
    if (key) head.append(el('kbd', '', key))
    wrap.append(head)
    const grid = el('div', 'grid')
    for (const item of items) {
      const b = button('', 'choice', () => choose(item.id))
      if (item.id === current) b.classList.add('active')
      const name = el('strong', '', item.name)
      if (badge) name.append(el('b', 'mbadge', badge(item.id)))
      b.append(name, el('small', '', item.blurb))
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

function grantChips(grants: Grant[], limit: number): HTMLElement {
  const wrap = el('div', 'grants')
  const ordered = [...grants].sort((a, b) => GRANT_ORDER.indexOf(a.kind) - GRANT_ORDER.indexOf(b.kind))
  const shown = ordered.slice(0, limit)
  for (const g of shown) wrap.append(el('div', `grant ${g.kind}`, `${g.name} · ${g.detail}`))
  if (ordered.length > shown.length) {
    const more = el('div', 'grant more', `+${ordered.length - shown.length} more`)
    more.title = ordered.slice(shown.length).map((g) => `${g.name} · ${g.detail}`).join('\n')
    wrap.append(more)
  }
  return wrap
}

/** Rewards paid on load: a season that ended, or items added to tracks already passed. */
function noticeCard(grants: Grant[]): HTMLElement {
  const card = el('div', 'notice')
  const ended = grants.find((g) => g.id.startsWith('season-end'))
  card.append(el('b', '', ended ? ended.name.toUpperCase() : 'REWARDS WAITING'))
  const rest = grants.filter((g) => g !== ended)
  if (rest.length) card.append(grantChips(rest, 5))
  if (ended) card.append(el('small', '', ended.detail))
  return card
}

function statGrid(items: [string, string][]): HTMLElement {
  const grid = el('div', 'stats')
  for (const [k, v] of items) {
    const d = el('div', 'stat')
    d.append(el('b', '', v), el('span', '', k))
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
  return bar((rating - tier.min) / (next.min - tier.min), `${rating}`, `${next.min - rating} to ${next.name}`)
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
