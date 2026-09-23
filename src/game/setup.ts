import { Rng, clamp } from '../core/math'
import type { BotLevel, MatchConfig, ModeId, PlayerConfig } from '../core/types'
import { ARENAS, BOT_NAMES, MODES, PALETTE, modeById } from '../data/content'
import type { Profile } from '../progression/profile'

export interface PlayOptions {
  modeId: ModeId
  arenaId: string
  competitive: boolean
  players: number
  seed?: number
  localDuo?: boolean
}

export function buildMatchConfig(profile: Profile, options: PlayOptions): MatchConfig {
  const mode = modeById(options.modeId)
  const seed = options.seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
  const rng = new Rng(seed)
  const arenaId = options.arenaId === 'random' || !ARENAS.some((a) => a.id === options.arenaId)
    ? rng.pick(ARENAS).id
    : options.arenaId
  const count = clamp(options.players || mode.players, mode.minPlayers, mode.maxPlayers)
  const names = [...BOT_NAMES]
  const players: PlayerConfig[] = []
  const humanColor = PALETTE[profile.color % PALETTE.length] ?? PALETTE[0]!
  players.push(makeHuman(profile, humanColor, mode.teams ? 0 : 0))
  const palette = PALETTE.filter((_, idx) => idx !== (profile.color % PALETTE.length))
  for (let i = 1; i < count; i++) {
    const spread = 70 + i * 18
    const rating = clamp(profile.mmr + rng.range(-spread, spread), 820, 1750)
    const name = takeName(names, rng)
    const color = palette[(i - 1) % palette.length]!
    const team = mode.teams ? (i < Math.ceil(count / 2) ? 0 : 1) : i
    const skill = clamp((rating - 850) / 950, 0.08, 0.95)
    const aggression = options.modeId === 'tutorial' ? 0.28 : clamp(0.45 + skill * 0.4, 0.3, 0.95)
    players.push({
      id: `bot-${i}`,
      name,
      team,
      bot: true,
      botLevel: levelFor(rating),
      skill: options.modeId === 'tutorial' ? 0.18 : skill,
      aggression,
      color,
      pattern: i % 8,
      core: rng.pick(['stable', 'heavy', 'light', 'elastic', 'aggressive']),
      shell: rng.pick(['rubber', 'armored', 'spiked', 'magnetic', 'reactive']),
      ability: rng.pick(['shockwave', 'magnet', 'phase', 'overdrive', 'anchor', 'repulse', 'blink', 'gravity-well', 'mirror', 'split']),
      passive: rng.pick(['second-wind', 'edge-guard', 'dash-refund', 'momentum-bank', 'heavy-hitter', 'glider']),
      masteryCore: 'stable',
      trail: 'trail_comet',
      impact: 'impact_ring',
      skin: 'skin_classic',
      emote: 'emote_nice',
      title: '',
      rating: Math.round(rating),
    })
  }
  if (options.localDuo && players[1]) {
    const mate = players[1]
    mate.id = 'p2'
    mate.name = 'Player 2'
    mate.bot = false
    mate.color = PALETTE[3]!
    mate.pattern = 3
    mate.core = profile.loadout.core
    mate.shell = profile.loadout.shell
    mate.ability = profile.loadout.ability
    mate.passive = profile.loadout.passive
    mate.masteryCore = profile.loadout.core
    mate.trail = profile.equipped.trail
    mate.impact = profile.equipped.impact
    mate.skin = profile.equipped.skin
  }
  return {
    seed,
    matchId: `m-${seed.toString(16)}-${profile.matches}`,
    modeId: options.modeId,
    arenaId,
    duration: mode.duration,
    stocks: mode.stocks,
    competitive: options.competitive && mode.ranked,
    teams: mode.teams,
    win: mode.win,
    suddenDeath: mode.suddenDeath,
    respawn: mode.respawn,
    events: mode.events,
    zone: mode.zone,
    scoreLimit: mode.scoreLimit,
    players,
    recordReplay: true,
  }
}

function makeHuman(profile: Profile, color: string, team: number): PlayerConfig {
  return {
    id: 'you',
    name: profile.name || 'Player',
    team,
    bot: false,
    botLevel: 'rival',
    skill: 1,
    aggression: 0.5,
    color,
    pattern: 0,
    core: profile.loadout.core,
    shell: profile.loadout.shell,
    ability: profile.loadout.ability,
    passive: profile.loadout.passive,
    masteryCore: profile.loadout.core,
    trail: profile.equipped.trail,
    impact: profile.equipped.impact,
    skin: profile.equipped.skin,
    emote: profile.equipped.emote,
    title: profile.equipped.title,
    rating: Math.round(profile.mmr),
  }
}

function levelFor(rating: number): BotLevel {
  if (rating < 1000) return 'rookie'
  if (rating < 1200) return 'rival'
  if (rating < 1450) return 'ace'
  return 'champion'
}

function takeName(names: string[], rng: Rng): string {
  if (names.length === 0) return 'Ball'
  const i = Math.floor(rng.next() * names.length)
  return names.splice(i, 1)[0]!
}

export function attractConfig(seed: number): MatchConfig {
  const built = buildMatchConfig(
    {
      ...({} as Profile),
      name: 'Scrim',
      color: 0,
      mmr: 1100,
      matches: 0,
      loadout: { core: 'stable', shell: 'rubber', ability: 'shockwave', passive: 'none' },
      equipped: {
        trail: 'trail_comet',
        impact: 'impact_ring',
        emote: 'emote_nice',
        banner: 'banner_plain',
        title: '',
        frame: 'frame_plain',
        skin: 'skin_classic',
      },
    },
    { modeId: 'ffa', arenaId: 'random', competitive: false, players: 6, seed },
  )
  built.players.forEach((p) => {
    p.bot = true
  })
  built.recordReplay = false
  built.duration = 70
  return built
}

export { MODES, ARENAS }
