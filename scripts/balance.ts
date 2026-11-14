/**
 * Headless balance harness. Plays full matches with a human-like proxy in the `you` slot against the
 * real bots, then prints what a human would feel: placement, knockouts, falls, self-falls, how long
 * the first stock lasts, and how often a match reaches sudden death.
 *
 *   npx vite-node scripts/balance.ts [matches=40] [proxy=casual|good|idle] [mode=ffa] [arena=random] [veteran=1]
 *
 * The proxy perceives the world through a reaction delay, aims with error, and sometimes misses the
 * edge, so the numbers reflect a person at a keyboard rather than a perfect controller.
 */
import { ZERO_INPUT, type ModeId } from '../src/core/types'
import { Rng } from '../src/core/math'
import { buildMatchConfig } from '../src/game/setup'
import { defaultProfile } from '../src/progression/profile'
import { ARENAS } from '../src/data/content'
import { Match } from '../src/sim/match'
import { Proxy, STYLES } from './proxy'

interface Tally {
  matches: number
  places: number[]
  wins: number
  kos: number
  falls: number
  selfFalls: number
  firstDeath: number[]
  sudden: number
  duration: number[]
  botFalls: number
  botSelfFalls: number
  hitsTaken: number
  bestHits: number[]
  peakHeat: number[]
  takenYou: number
  takenBots: number
  outAt: number[]
}

function run(count: number, styleId: string, modeId: ModeId, arenaId: string, veteran: boolean): Tally {
  const tally: Tally = { matches: 0, places: [], wins: 0, kos: 0, falls: 0, selfFalls: 0, firstDeath: [], sudden: 0, duration: [], botFalls: 0, botSelfFalls: 0, hitsTaken: 0, bestHits: [], peakHeat: [], takenYou: 0, takenBots: 0, outAt: [] }
  for (let i = 0; i < count; i++) {
    const profile = defaultProfile()
    profile.matches = veteran ? 40 : 0
    const config = buildMatchConfig(profile, { modeId, arenaId, competitive: false, players: 0, seed: 1000 + i * 7919 })
    config.recordReplay = false
    if (styleId === 'bot') {
      const me0 = config.players[0]!
      const ref = config.players[1]!
      Object.assign(me0, { bot: true, skill: ref.skill, aggression: ref.aggression, botLevel: ref.botLevel, pace: ref.pace })
    }
    const match = new Match(config)
    match.silent = false
    const rng = new Rng(77 + i)
    const proxy = new Proxy(STYLES[styleId] ?? STYLES.casual!, rng)
    const me = match.players.find((p) => p.id === 'you')!
    let firstDeath = -1
    let sawSudden = false
    let outAt = -1
    const deathsSeen = new Map<string, number>()
    let guard = 0
    let leave: string | null = null
    let lastDash = -9
    while (match.status !== 'finished' && guard++ < 60 * 400) {
      const input = match.status === 'playing' || match.status === 'sudden' ? proxy.think(match, me) : { ...ZERO_INPUT }
      const wasDash = me.dashTime
      match.step({ you: input })
      if (me.dashTime > wasDash) lastDash = match.time
      if (process.env.TRACE) { RING.push(`t=${match.time.toFixed(2)} in=(${input.x.toFixed(1)},${input.y.toFixed(1)})${input.dash ? 'D' : ''} v=${Math.hypot(me.vx, me.vy).toFixed(0)} out=${(me.vx * -me.safetyX + me.vy * -me.safetyY).toFixed(0)} edge=${me.edgeDist.toFixed(0)} sup=${me.supported ? 1 : 0} fall=${me.falling ? me.fallHeight.toFixed(0) : '-'} teet=${me.teeter.toFixed(2)} coy=${me.coyote.toFixed(2)} stun=${me.stun.toFixed(2)} dcd=${me.dashCd.toFixed(2)} home=${(input.x * me.safetyX + input.y * me.safetyY).toFixed(2)}`); if (RING.length > 40) RING.shift() }
      if (me.alive && me.supported && !me.falling) leave = null
      else if (me.alive && !leave) {
        const since = match.time - me.lastHitTime
        leave = me.stun > 0 ? 'launched(stun)' : since < 0.5 ? 'hit<0.5s' : match.time - lastDash < 0.45 ? 'own dash' : since < 1.5 ? 'hit<1.5s' : 'drift'
      }
      if (match.status === 'sudden') sawSudden = true
      if (me.eliminated && outAt < 0) outAt = match.time
      for (const e of match.consumeFx()) {
        if (e.type !== 'elim') continue
        const credited = e.actorId !== ''
        if (e.victimId === 'you') {
          tally.falls += 1
          if (!credited) tally.selfFalls += 1
          const c = leave ?? 'hazard/other'
          if (process.env.TRACE === c && !TRACED) { TRACED = true; console.log('--- death: ' + c + String.fromCharCode(10) + RING.join(String.fromCharCode(10))) }
          CAUSES[c] = (CAUSES[c] ?? 0) + 1
          if (firstDeath < 0) firstDeath = match.time
        } else if (match.players.some((p) => p.id === e.victimId)) {
          tally.botFalls += 1
          if (!credited) tally.botSelfFalls += 1
          deathsSeen.set(e.victimId, (deathsSeen.get(e.victimId) ?? 0) + 1)
        }
      }
      if (match.config.duration <= 0 && match.time > 90) match.endNow()
    }
    const r = match.toResult('you')
    const mine = r.placements.find((p) => p.id === 'you')!
    tally.matches += 1
    tally.places.push(mine.place)
    if (mine.won) tally.wins += 1
    tally.kos += mine.elims
    tally.firstDeath.push(firstDeath < 0 ? match.time : firstDeath)
    if (sawSudden) tally.sudden += 1
    tally.duration.push(match.time)
    tally.bestHits.push(mine.bestImpact)
    tally.peakHeat.push(mine.peakHeat)
    tally.outAt.push(outAt < 0 ? match.time : outAt)
    tally.takenYou += mine.damageTaken
    const others = r.placements.filter((p) => p.id !== 'you')
    tally.takenBots += others.reduce((s2, p) => s2 + p.damageTaken, 0) / Math.max(1, others.length)
  }
  return tally
}

const CAUSES: Record<string, number> = {}
const RING: string[] = []
let TRACED = false
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

const [count = '40', style = 'casual', mode = 'ffa', arena = 'random', vet = '1'] = process.argv.slice(2)
const arenas = arena === 'all' ? ARENAS.map((a) => a.id) : [arena]
for (const a of arenas) {
  const t = run(Number(count), style, mode as ModeId, a, vet !== '0')
  const n = t.matches
  const players = buildMatchConfig(defaultProfile(), { modeId: mode as ModeId, arenaId: a, competitive: false, players: 0, seed: 1 }).players.length
  console.log(
    [
      `${mode}/${a.padEnd(11)} ${style}${vet !== '0' ? '' : ' (new)'} n=${n} p=${players}`,
      `place ${avg(t.places).toFixed(2)}`,
      `win ${((t.wins / n) * 100).toFixed(0)}%`,
      `KO ${(t.kos / n).toFixed(2)}`,
      `falls ${(t.falls / n).toFixed(2)} (self ${(t.selfFalls / n).toFixed(2)})`,
      `firstDeath ${avg(t.firstDeath).toFixed(1)}s`,
      `out ${avg(t.outAt).toFixed(0)}s`,
      `len ${avg(t.duration).toFixed(0)}s`,
      `sudden ${((t.sudden / n) * 100).toFixed(0)}%`,
      `botFalls ${(t.botFalls / n).toFixed(1)} (self ${(t.botSelfFalls / n).toFixed(1)})`,
      `bestHit ${avg(t.bestHits).toFixed(0)}`,
      `peakHeat ${avg(t.peakHeat).toFixed(0)}`,
      `dmgTaken you/bot ${(t.takenYou / n).toFixed(0)}/${(t.takenBots / n).toFixed(0)}`,
    ].join(' | '),
  )
}
if (process.env.CAUSES) console.log('you died by:', JSON.stringify(CAUSES))
