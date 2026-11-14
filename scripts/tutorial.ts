// How long a human-like proxy needs to land the first knockout in the tutorial (the tutorial ends there).
//   npx vite-node scripts/tutorial.ts
import { ZERO_INPUT } from '../src/core/types'
import { Rng } from '../src/core/math'
import { buildMatchConfig } from '../src/game/setup'
import { defaultProfile } from '../src/progression/profile'
import { Match } from '../src/sim/match'
import { makeProxy } from './proxy'
for (const style of ['casual', 'good']) {
  const times: number[] = []
  let fails = 0
  for (let i = 0; i < 40; i++) {
    const cfg = buildMatchConfig(defaultProfile(), { modeId: 'tutorial', arenaId: 'classic', competitive: false, players: 2, seed: 300 + i * 13 })
    cfg.recordReplay = false
    const m = new Match(cfg)
    const me = m.players[0]!
    const proxy = makeProxy(style, new Rng(5 + i))
    let t = -1
    while (m.time < 120) {
      const input = m.status === 'playing' ? proxy.think(m, me) : { ...ZERO_INPUT }
      m.step({ you: input })
      if (me.stats.elims > 0) { t = m.time; break }
    }
    if (t < 0) fails++
    else times.push(t)
  }
  times.sort((a, b) => a - b)
  console.log(`${style}: median first KO ${times[Math.floor(times.length / 2)]?.toFixed(1)}s, p90 ${times[Math.floor(times.length * 0.9)]?.toFixed(1)}s, none in 120s: ${fails}/40`)
}
