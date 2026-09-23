import { DT, type InputFrame, type MatchConfig, sanitizeInput } from '../core/types'
import { Match } from './match'

/**
 * Authoritative session. Clients submit inputs. The sim decides positions,
 * hits, eliminations, and rewards. A future socket adapter can feed submit()
 * from the network; late or malformed inputs are dropped.
 */
export class Session {
  readonly match: Match
  private mailbox = new Map<string, InputFrame>()
  private afk = new Map<string, number>()

  constructor(config: MatchConfig) {
    this.match = new Match(config)
  }

  submit(id: string, tick: number, input: Partial<InputFrame>): boolean {
    if (this.match.playTick > 8 && tick < this.match.playTick - 1) return false
    this.mailbox.set(id, sanitizeInput(input))
    this.afk.set(id, 0)
    const body = this.match.players.find((p) => p.id === id)
    if (body) body.auto = false
    return true
  }

  step(): void {
    for (const p of this.match.players) {
      if (p.bot) continue
      if (!this.mailbox.has(p.id)) {
        const t = (this.afk.get(p.id) ?? 0) + DT
        this.afk.set(p.id, t)
        if (t > 5) p.auto = true
      }
    }
    const live: Record<string, InputFrame> = {}
    for (const [id, input] of this.mailbox) live[id] = input
    this.match.step(live)
    this.mailbox.clear()
  }
}
