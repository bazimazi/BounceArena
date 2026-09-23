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

export class Input {
  private keys = new Set<string>()
  private pointer = { x: 0, y: 0, inside: false }
  stick = { x: 0, y: 0, active: false }
  touchDash = false
  touchAbility = false
  touchBrake = false
  onPause: (() => void) | null = null

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.onPause?.()
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
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

  player(worldX: number, worldY: number, screenOf: (x: number, y: number) => { x: number; y: number }, mouseSteer: boolean): InputFrame {
    let x = 0
    let y = 0
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
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
      const dx = this.pointer.x - s.x / window.devicePixelRatio
      const dy = this.pointer.y - s.y / window.devicePixelRatio
      const m = Math.hypot(dx, dy)
      if (m > 24) {
        x = dx / m
        y = dy / m
      }
    }
    const pad = navigator.getGamepads?.()[0]
    if (pad) {
      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      if (Math.hypot(ax, ay) > 0.18) {
        x += ax
        y += ay
      }
    }
    return {
      x,
      y,
      dash: this.keys.has('Space') || this.keys.has('MouseDash') || this.touchDash || !!pad?.buttons[0]?.pressed,
      ability: this.keys.has('KeyF') || this.keys.has('MouseAbility') || this.touchAbility || !!pad?.buttons[1]?.pressed,
      brake: this.keys.has('ShiftLeft') || this.touchBrake || (pad?.buttons[6]?.pressed ?? false),
      emote: this.keys.has('KeyG') || (pad?.buttons[3]?.pressed ?? false),
    }
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
    const pad = navigator.getGamepads?.()[1]
    if (pad) {
      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      if (Math.hypot(ax, ay) > 0.18) {
        any = true
        x += ax
        y += ay
      }
    }
    if (!any && !pad) return null
    return {
      x,
      y,
      dash: this.keys.has('Enter') || !!pad?.buttons[0]?.pressed,
      ability: this.keys.has('ControlRight') || !!pad?.buttons[1]?.pressed,
      brake: this.keys.has('ShiftRight') || !!pad?.buttons[6]?.pressed,
      emote: this.keys.has('KeyP') || !!pad?.buttons[3]?.pressed,
    }
  }
}
