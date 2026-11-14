/**
 * Loadout census. Bots pick cores, shells, abilities, and passives at random, so running many all-bot
 * matches and averaging placement per pick shows which sidegrades are out of line.
 *
 *   npx vite-node scripts/census.ts [matches=300] [mode=ffa]
 *
 * Placement is normalised to 0 (won) .. 1 (last) so different lobby sizes compare.
 */
import type { ModeId } from '../src/core/types'
import { buildMatchConfig } from '../src/game/setup'
import { defaultProfile } from '../src/progression/profile'
import { Match } from '../src/sim/match'

const [count = '300', mode = 'ffa'] = process.argv.slice(2)
type Row = { n: number; place: number; kos: number; falls: number }
const book: Record<string, Record<string, Row>> = { ability: {}, core: {}, shell: {}, passive: {} }

for (let i = 0; i < Number(count); i++) {
  const profile = defaultProfile()
  profile.matches = 40
  const config = buildMatchConfig(profile, { modeId: mode as ModeId, arenaId: 'random', competitive: false, players: 0, seed: 9000 + i * 7717 })
  config.recordReplay = false
  // Everyone is a bot of the same skill, so only the loadout differs.
  for (const p of config.players) {
    p.bot = true
    p.skill = 0.5
    p.aggression = 0.65
    p.pace = 1
  }
  config.players[0]!.core = ['stable', 'heavy', 'light', 'elastic', 'aggressive'][i % 5]!
  config.players[0]!.ability = ['shockwave', 'magnet', 'phase', 'overdrive', 'anchor', 'repulse', 'blink', 'gravity-well', 'mirror', 'split'][i % 10]!
  config.players[0]!.shell = ['rubber', 'armored', 'spiked', 'magnetic', 'reactive'][(i >> 1) % 5]!
  config.players[0]!.passive = ['second-wind', 'edge-guard', 'dash-refund', 'momentum-bank', 'heavy-hitter', 'glider'][i % 6]!
  const match = new Match(config)
  let guard = 0
  while (match.status !== 'finished' && guard++ < 60 * 400) match.step({})
  const r = match.toResult('you')
  const size = r.placements.length
  for (const pl of r.placements) {
    const body = match.players.find((b) => b.id === pl.id)!
    const norm = size > 1 ? (pl.place - 1) / (size - 1) : 0
    for (const [slot, id] of [['ability', body.ability], ['core', body.core], ['shell', body.shell], ['passive', body.passive]] as const) {
      const row = (book[slot]![id] ??= { n: 0, place: 0, kos: 0, falls: 0 })
      row.n += 1
      row.place += norm
      row.kos += pl.elims
      row.falls += pl.deaths
    }
  }
}

for (const [slot, rows] of Object.entries(book)) {
  console.log(`\n${slot.toUpperCase()}  (place: 0 = always wins, 0.5 = average, 1 = always last)`)
  const sorted = Object.entries(rows).sort((a, b) => a[1].place / a[1].n - b[1].place / b[1].n)
  for (const [id, r] of sorted) {
    console.log(`  ${id.padEnd(14)} n=${String(r.n).padStart(4)}  place ${(r.place / r.n).toFixed(3)}  KO ${(r.kos / r.n).toFixed(2)}  falls ${(r.falls / r.n).toFixed(2)}`)
  }
}
