import type { InputFrame } from '../core/types'

const P1_MOVE: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
}

/**
 * Scaled radial deadzone: no snapping to the axes, and full range just past the dead spot.
 * out = dir * (|v| - dz) / (1 - dz)
 */
export function radialDeadzone(x: number, y: number, dz = 0.15): { x: number; y: number } {
  const m = Math.hypot(x, y)
  if (m <= dz) return { x: 0, y: 0 }
  const k = Math.min(1, (m - dz) / (1 - dz)) / m
  return { x: x * k, y: y * k }
}

/** Standard-mapping gamepad buttons. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const

function held(pad: Gamepad | null | undefined, i: number): boolean {
  const b = pad?.buttons[i]
  return !!b && (b.pressed || b.value > 0.5)
}

export class Input {
  private keys = new Set<string>()
  private pointer = { x: 0, y: 0, inside: false }
  stick = { x: 0, y: 0, active: false }
  touchDash = false
  touchAbility = false
  touchBrake = false
  onPause: (() => void) | null = null
  deadzone = 0.15
  private padPrev: boolean[][] = [[], []]

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.onPause?.()
      // Only in a match: menus keep Space to press buttons and arrows to scroll.
      const playing = document.body.dataset.mode === 'match'
      if (playing && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    target.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
      this.pointer.inside = true
    })
    target.addEventListener('pointerdown', (e) => {
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
      if (e.button === 0) this.keys.add('MouseDash')
      if (e.button === 2) this.keys.add('MouseAbility')
    })
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.keys.delete('MouseDash')
      if (e.button === 2) this.keys.delete('MouseAbility')
    })
    target.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  reset(): void {
    this.keys.clear()
    this.touchDash = false
    this.touchAbility = false
    this.touchBrake = false
  }

  /** `arrows` lets a solo player steer with the arrow keys too; local duo gives them to player 2. */
  player(worldX: number, worldY: number, screenOf: (x: number, y: number) => { x: number; y: number }, mouseSteer: boolean, arrows = false): InputFrame {
    let x = 0
    let y = 0
    const codes = arrows ? Object.keys(P1_MOVE) : ['KeyW', 'KeyA', 'KeyS', 'KeyD']
    for (const code of codes) {
      if (!this.keys.has(code)) continue
      const d = P1_MOVE[code]!
      x += d[0]
      y += d[1]
    }
    if (this.stick.active) {
      x += this.stick.x
      y += this.stick.y
    }
    if (mouseSteer && this.pointer.inside && x === 0 && y === 0) {
      const s = screenOf(worldX, worldY)
      const dx = this.pointer.x - s.x
      const dy = this.pointer.y - s.y
      const m = Math.hypot(dx, dy)
      if (m > 24) {
        x = dx / m
        y = dy / m
      }
    }
    const pad = this.pad(0)
    if (pad) {
      const s = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.deadzone)
      x += s.x
      y += s.y
      if (held(pad, PAD.left)) x -= 1
      if (held(pad, PAD.right)) x += 1
      if (held(pad, PAD.up)) y -= 1
      if (held(pad, PAD.down)) y += 1
    }
    return {
      x,
      y,
      dash: this.keys.has('Space') || this.keys.has('MouseDash') || this.touchDash || held(pad, PAD.a) || held(pad, PAD.rt) || held(pad, PAD.rb),
      ability: this.keys.has('KeyF') || this.keys.has('KeyE') || this.keys.has('MouseAbility') || this.touchAbility || held(pad, PAD.b) || held(pad, PAD.x),
      brake: this.keys.has('ShiftLeft') || this.touchBrake || held(pad, PAD.lt) || held(pad, PAD.lb),
      emote: this.keys.has('KeyG') || held(pad, PAD.y),
    }
  }

  /** The nth connected pad, skipping empty slots. */
  pad(n: number): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? []
    let seen = 0
    for (const p of pads) {
      if (!p || !p.connected) continue
      if (seen === n) return p
      seen++
    }
    return null
  }

  /** Buttons that went down since the last poll, for pause and menu navigation. */
  padPresses(n: number): Set<keyof typeof PAD> {
    const out = new Set<keyof typeof PAD>()
    const pad = this.pad(n)
    const prev = this.padPrev[n] ?? []
    const now: boolean[] = []
    if (pad) {
      for (const [name, i] of Object.entries(PAD) as [keyof typeof PAD, number][]) {
        now[i] = held(pad, i)
        if (now[i] && !prev[i]) out.add(name)
      }
      // The left stick also navigates menus, one step per push.
      const ay = pad.axes[1] ?? 0
      const ax = pad.axes[0] ?? 0
      now[20] = ay < -0.6
      now[21] = ay > 0.6
      now[22] = ax < -0.6
      now[23] = ax > 0.6
      if (now[20] && !prev[20]) out.add('up')
      if (now[21] && !prev[21]) out.add('down')
      if (now[22] && !prev[22]) out.add('left')
      if (now[23] && !prev[23]) out.add('right')
    }
    this.padPrev[n] = now
    return out
  }

  /** Dual-rumble where the browser supports it. A new call replaces the one playing. */
  rumble(n: number, strong: number, weak: number, ms: number): void {
    const pad = this.pad(n) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown>; effects?: string[] } }) | null
    const act = pad?.vibrationActuator
    if (!act?.playEffect) return
    if (act.effects && !act.effects.includes('dual-rumble')) return
    void act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {})
  }

  playerTwo(): InputFrame | null {
    let x = 0
    let y = 0
    let any = false
    for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      if (!this.keys.has(code)) continue
      any = true
      const d = P1_MOVE[code]!
      x += d[0]
      y += d[1]
    }
    const pad = this.pad(1)
    if (pad) {
      const s = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.deadzone)
      if (s.x || s.y) any = true
      x += s.x
      y += s.y
    }
    const frame = {
      x,
      y,
      dash: this.keys.has('Enter') || this.keys.has('NumpadEnter') || held(pad, PAD.a) || held(pad, PAD.rt) || held(pad, PAD.rb),
      ability: this.keys.has('ControlRight') || this.keys.has('Slash') || held(pad, PAD.b) || held(pad, PAD.x),
      brake: this.keys.has('ShiftRight') || held(pad, PAD.lt) || held(pad, PAD.lb),
      emote: this.keys.has('KeyP') || held(pad, PAD.y),
    }
    // Buttons count even with no direction held: a standing dash or ability is still an input.
    if (!any && !pad && !frame.dash && !frame.ability && !frame.brake && !frame.emote) return null
    return frame
  }
}
