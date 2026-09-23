import type { FxEvent } from '../core/types'

export class AudioBus {
  private ctx: AudioContext | null = null
  private sfx: GainNode | null = null
  private music: GainNode | null = null
  private started = false
  private lastHit = 0
  private beat = 0
  private volume = 0.8
  private musicVol = 0.22

  resume(): void {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') void ctx.resume()
    this.started = true
  }

  setVolumes(volume: number, music: number): void {
    this.volume = volume
    this.musicVol = music
    if (this.sfx) this.sfx.gain.value = volume
    if (this.music) this.music.gain.value = music * 0.35
  }

  update(dt: number, intensity: number): void {
    if (!this.started || !this.ctx || !this.music) return
    this.beat -= dt
    const tempo = intensity > 0.8 ? 0.28 : 0.46
    if (this.beat > 0) return
    this.beat = tempo
    this.tone(intensity > 0.8 ? 98 : 74, 0.18, 'sine', 0.05, this.music)
    if (intensity > 0.5) this.tone(intensity > 0.8 ? 196 : 148, 0.08, 'triangle', 0.02, this.music)
  }

  fx(event: FxEvent, local: boolean): void {
    if (!this.started) return
    if (event.type === 'hit') {
      const now = performance.now()
      if (now - this.lastHit < 45 && event.power < 400) return
      this.lastHit = now
      const k = Math.min(1, event.power / 700)
      this.noise(0.08 + k * 0.08, 0.12 + k * 0.2, 180 + k * 900)
      this.tone(70 + k * 90, 0.12, 'sine', 0.08 + k * 0.12)
      if (local && event.power > 350) this.tone(50, 0.16, 'square', 0.03)
      return
    }
    if (event.type === 'dash') {
      this.sweep(220, 640, 0.12, 0.08)
      return
    }
    if (event.type === 'ability') {
      this.tone(420, 0.09, 'triangle', 0.06)
      this.tone(640, 0.12, 'sine', 0.04)
      return
    }
    if (event.type === 'elim') {
      this.noise(0.22, 0.2, 240)
      this.sweep(300, 70, 0.28, 0.08)
      return
    }
    if (event.type === 'wall') this.tone(180, 0.05, 'square', 0.04)
    if (event.type === 'pickup') this.sweep(480, 880, 0.14, 0.06)
    if (event.type === 'boom') {
      this.noise(0.2, 0.18, 120)
      this.tone(60, 0.2, 'sine', 0.1)
    }
    if (event.type === 'save') this.tone(720, 0.08, 'sine', 0.05)
  }

  blip(step: number): void {
    this.tone(step <= 0 ? 660 : 440 + step * 40, 0.09, 'square', 0.05)
  }

  go(): void {
    this.tone(523, 0.08, 'square', 0.05)
    this.tone(784, 0.14, 'square', 0.04)
  }

  win(): void {
    ;[523, 659, 784, 1046].forEach((f, i) => {
      window.setTimeout(() => this.tone(f, 0.12, 'triangle', 0.06), i * 90)
    })
  }

  lose(): void {
    this.tone(220, 0.16, 'sine', 0.05)
    this.tone(164, 0.22, 'sine', 0.04)
  }

  click(): void {
    this.tone(680, 0.04, 'square', 0.03)
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    const master = ctx.createGain()
    const sfx = ctx.createGain()
    const music = ctx.createGain()
    sfx.gain.value = this.volume
    music.gain.value = this.musicVol * 0.35
    sfx.connect(master)
    music.connect(master)
    master.connect(ctx.destination)
    this.ctx = ctx
    this.sfx = sfx
    this.music = music
    return ctx
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode): void {
    const ctx = this.ensure()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.connect(g)
    g.connect(dest ?? this.sfx ?? ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur + 0.02)
  }

  private sweep(from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ensure()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(from, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + dur)
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.connect(g)
    g.connect(this.sfx ?? ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number): void {
    const ctx = this.ensure()
    const length = Math.floor(ctx.sampleRate * dur)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(filter)
    filter.connect(g)
    g.connect(this.sfx ?? ctx.destination)
    src.start()
  }
}
