import type { FxEvent } from '../core/types'

/**
 * Procedural audio. Everything is synthesized, so the game ships no sound files.
 *
 * Chain: sfx ─┐
 *             ├─ master ─ limiter ─ out
 *   music ─ duck ─┘
 *
 * Music is a small step sequencer with vertical layers. `update(dt, level)` sets a target
 * intensity (0 menu, 1 match, 2 final phase, 3 sudden death) and the layers fade toward it,
 * so the score swells with the match instead of switching tracks.
 */

const BPM = 124
const STEP = 60 / BPM / 4 // one 16th note
const LOOKAHEAD = 0.14

/** Semitones from A for each bar's chord: Am, F, C, G. */
const CHORDS: number[][] = [
  [0, 3, 7],
  [-4, 0, 3],
  [3, 7, 10],
  [-2, 2, 5],
]
/** A minor pentatonic motif for the lead layer, one value per 8th (null = rest). */
const MOTIF: (number | null)[] = [12, null, 15, 12, 10, null, 7, null, 12, null, 15, 17, 15, null, 12, 10]

type Layer = 'pad' | 'arp' | 'kick' | 'hat' | 'bass' | 'clap' | 'lead' | 'drive'

/** How loud each layer sits at each intensity level. */
const MIX: Record<Layer, [number, number, number, number]> = {
  pad: [0.9, 0.7, 0.6, 0.5],
  arp: [0.55, 0.6, 0.7, 0.6],
  kick: [0, 0.9, 1, 1],
  hat: [0.25, 0.6, 0.85, 1],
  bass: [0, 0.8, 0.9, 1],
  clap: [0, 0, 0.8, 1],
  lead: [0, 0, 0.55, 0.7],
  drive: [0, 0, 0, 0.9],
}

function hz(semisFromA2: number): number {
  return 110 * Math.pow(2, semisFromA2 / 12)
}

export class AudioBus {
  private ctx: AudioContext | null = null
  private sfx: GainNode | null = null
  private music: GainNode | null = null
  private duck: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private layers = new Map<Layer, GainNode>()
  private started = false
  private volume = 0.8
  private musicVol = 0.22
  private level = 0
  private nextNote = 0
  private step = 0

  private voices = new Map<string, number[]>()

  resume(): void {
    const ctx = this.ensure()
    // iOS reports 'interrupted' after backgrounding; anything but running is worth a resume.
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    if (!this.started) {
      this.started = true
      this.nextNote = ctx.currentTime + 0.05
      window.setInterval(() => this.schedule(), 25)
    }
  }

  /** Silence everything while the tab is hidden or the game is backgrounded. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  wake(): void {
    if (this.ctx && this.started && this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => {
        if (this.ctx) this.nextNote = Math.max(this.nextNote, this.ctx.currentTime + 0.05)
      }).catch(() => {})
    }
  }

  setVolumes(volume: number, music: number): void {
    this.volume = volume
    this.musicVol = music
    const t = this.ctx?.currentTime ?? 0
    this.sfx?.gain.setTargetAtTime(volume, t, 0.03)
    this.music?.gain.setTargetAtTime(music * 1.5, t, 0.05)
  }

  /** `level`: 0 menu, 1 match, 2 final phase, 3 sudden death. */
  update(_dt: number, level: number): void {
    const next = Math.max(0, Math.min(3, Math.round(level)))
    if (next === this.level || !this.ctx) {
      this.level = next
      return
    }
    this.level = next
    const t = this.ctx.currentTime
    for (const [name, g] of this.layers) g.gain.setTargetAtTime(MIX[name][next], t, 0.9)
  }

  fx(event: FxEvent, local: boolean, pan = 0): void {
    if (!this.started || !this.ctx) return
    const k = Math.min(1.2, event.power / 700)
    switch (event.type) {
      case 'hit': {
        if (!this.voice('hit', event.power > 420 ? 4 : 3)) return
        this.hit(k, pan, local)
        return
      }
      case 'dash':
        if (!this.voice('dash', 2)) return
        this.whoosh(pan, local ? 0.12 : 0.05, 700, 2600, 0.16)
        this.chirp(320, 900, 0.09, local ? 0.05 : 0.02, 'sine', pan)
        if (event.text === 'recover') {
          // A rising hop: you pulled it back from the void.
          this.chirp(300, 1100, 0.16, local ? 0.06 : 0.025, 'triangle', pan)
          if (local) this.note(hz(28), 0.16, 'triangle', 0.04, this.sfx!, this.now() + 0.1, pan)
        }
        if (event.text === 'perfect' && local) {
          // A bright two-note sparkle confirms the timing.
          this.note(hz(31), 0.12, 'triangle', 0.05, this.sfx!, this.now() + 0.02, pan)
          this.note(hz(36), 0.2, 'triangle', 0.045, this.sfx!, this.now() + 0.08, pan)
        }
        return
      case 'ability':
        if (this.abilitySound(event.text, pan, local ? 1 : 0.5)) return
        this.chirp(420, 640, 0.12, 0.05, 'triangle', pan)
        return
      case 'elim':
        this.elim(pan, local, event.victimId !== '' && local && event.actorId === '')
        return
      case 'land':
        if (!local || !this.voice('land', 1, 90)) return
        this.chirp(190, 120, 0.06, 0.025, 'sine', pan)
        return
      case 'wall':
        if (!this.voice('wall', 2)) return
        this.chirp(340, 170, 0.09, 0.06, 'sine', pan)
        this.noise(0.03, 0.05, 2400, 'bandpass', pan)
        return
      case 'pickup':
        ;[0, 4, 7, 12].forEach((s, i) => this.note(hz(24 + s), 0.12, 'triangle', 0.05, this.sfx!, this.now() + i * 0.045, pan))
        return
      case 'boom':
        if (!this.voice('boom', 2)) return
        this.boom(pan, 0.7)
        return
      case 'save':
        if (event.text === 'edge' && !local) return
        this.note(hz(19), 0.09, 'triangle', 0.06, this.sfx!, this.now(), pan)
        this.note(hz(26), 0.16, 'triangle', 0.06, this.sfx!, this.now() + 0.07, pan)
        return
      case 'spawn':
        this.chirp(600, 1200, 0.25, 0.025, 'sine', pan)
        return
      case 'launch':
        // A rising whistle: the ball has been sent and cannot act yet.
        if (!this.voice('launch', 2)) return
        this.chirp(520, 1900, 0.18 + event.power * 0.6, local ? 0.045 : 0.02, 'triangle', pan, 3600)
        this.whoosh(pan, local ? 0.08 : 0.04, 1800, 5200, 0.3)
        return
      case 'teeter':
        // A nervous wobble on the brink, mostly for your own ball.
        if (!local || !this.voice('teeter', 1, 300)) return
        ;[0, 1, 2].forEach((i) => this.note(hz(i % 2 ? 22 : 21), 0.05, 'square', 0.02, this.sfx!, this.now() + i * 0.06, pan))
        return
      default:
        return
    }
  }

  blip(step: number): void {
    if (!this.ctx) return
    this.note(step <= 0 ? 880 : 440 + (3 - step) * 110, 0.1, 'square', 0.045, this.sfx!, this.now())
  }

  go(): void {
    if (!this.ctx) return
    const t = this.now()
    this.note(hz(15), 0.09, 'square', 0.05, this.sfx!, t)
    this.note(hz(22), 0.22, 'square', 0.05, this.sfx!, t + 0.06)
    this.boom(0, 0.35)
  }

  win(): void {
    if (!this.ctx) return
    const t = this.now()
    ;[12, 16, 19, 24, 28].forEach((s, i) => this.note(hz(s), 0.22 + i * 0.04, 'triangle', 0.06, this.sfx!, t + i * 0.085))
    ;[12, 16, 19].forEach((s) => this.note(hz(s), 0.9, 'sawtooth', 0.018, this.sfx!, t + 0.45))
  }

  lose(): void {
    if (!this.ctx) return
    const t = this.now()
    this.note(hz(7), 0.22, 'sine', 0.05, this.sfx!, t)
    this.note(hz(3), 0.3, 'sine', 0.045, this.sfx!, t + 0.16)
    this.note(hz(0), 0.5, 'sine', 0.04, this.sfx!, t + 0.34)
  }

  /** Deep boom and a falling whoosh under the slow-motion finish. */
  finish(): void {
    if (!this.started || !this.ctx) return
    this.boom(0, 1.2)
    this.whoosh(0, 0.12, 3200, 300, 0.9)
    this.duckMusic(0.15, 1.2)
  }

  click(): void {
    if (!this.ctx) return
    this.note(1320, 0.035, 'square', 0.022, this.sfx!, this.now())
  }

  hover(): void {
    if (!this.ctx || !this.started || !this.voice('hover', 1, 40)) return
    this.note(2200, 0.02, 'sine', 0.012, this.sfx!, this.now())
  }

  // ------------------------------------------------------------- sfx

  private hit(k: number, pan: number, local: boolean): void {
    const t = this.now()
    const vary = 0.95 + Math.random() * 0.1
    const gain = (0.1 + k * 0.16) * (local ? 1 : 0.7)
    // Rubbery thump: a fast pitch drop reads as a ball, not a punch.
    this.sweepNote((150 + k * 90) * vary, 48, 0.1 + k * 0.12, 'sine', gain * 1.4, t, pan)
    this.noise(0.035 + k * 0.03, gain * 0.9, (1400 + k * 2600) * vary, 'bandpass', pan)
    if (k > 0.55) {
      this.sweepNote(70, 30, 0.35 + k * 0.2, 'sine', 0.12 * k, t, pan)
      this.noise(0.08, 0.06 * k, 5200, 'highpass', pan)
    }
    if (local && k > 0.45) this.duckMusic(0.55, 0.25)
  }

  private elim(pan: number, local: boolean, selfOut: boolean): void {
    this.boom(pan, local ? 1 : 0.7)
    this.whoosh(pan, local ? 0.1 : 0.06, 2600, 260, 0.45)
    const t = this.now()
    if (local && !selfOut) {
      // A bright stab on the beat's key for knockouts that involve you.
      ;[12, 19, 24].forEach((s) => this.note(hz(s), 0.32, 'sawtooth', 0.02, this.sfx!, t + 0.05, pan))
    }
    this.duckMusic(local ? 0.4 : 0.65, 0.4)
  }

  private boom(pan: number, size: number): void {
    const t = this.now()
    this.sweepNote(95, 32, 0.45 * size + 0.15, 'sine', 0.2 * size, t, pan)
    this.noise(0.25 * size + 0.08, 0.16 * size, 420, 'lowpass', pan)
  }

  private abilitySound(id: string, pan: number, v: number): boolean {
    const t = this.now()
    const s = this.sfx!
    switch (id) {
      case 'shockwave':
        this.boom(pan, 0.55 * v)
        this.chirp(900, 200, 0.25, 0.05 * v, 'triangle', pan)
        return true
      case 'magnet':
        this.chirp(160, 520, 0.4, 0.06 * v, 'sawtooth', pan, 900)
        return true
      case 'phase':
        this.note(880, 0.35, 'sine', 0.04 * v, s, t, pan)
        this.note(893, 0.35, 'sine', 0.04 * v, s, t, pan)
        this.note(1320, 0.25, 'sine', 0.02 * v, s, t + 0.05, pan)
        return true
      case 'overdrive':
        this.chirp(110, 660, 0.45, 0.05 * v, 'sawtooth', pan, 2200)
        return true
      case 'anchor':
        ;[220, 331, 487].forEach((f, i) => this.note(f, 0.5 - i * 0.1, 'square', 0.025 * v, s, t, pan))
        this.noise(0.04, 0.08 * v, 3000, 'bandpass', pan)
        return true
      case 'repulse':
        this.noise(0.18, 0.12 * v, 900, 'bandpass', pan)
        this.chirp(300, 120, 0.2, 0.06 * v, 'sawtooth', pan, 1400)
        return true
      case 'blink':
        this.chirp(2000, 420, 0.12, 0.05 * v, 'sine', pan)
        this.noise(0.05, 0.05 * v, 6000, 'highpass', pan)
        return true
      case 'gravity-well':
        this.chirp(380, 60, 0.7, 0.07 * v, 'sawtooth', pan, 700)
        return true
      case 'mirror':
        this.note(1568, 0.4, 'sine', 0.04 * v, s, t, pan)
        this.note(2349, 0.3, 'sine', 0.025 * v, s, t + 0.03, pan)
        return true
      case 'split':
        this.chirp(500, 900, 0.06, 0.05 * v, 'triangle', pan)
        this.chirp(500, 900, 0.06, 0.05 * v, 'triangle', -pan, 0, 0.08)
        return true
      default:
        return false
    }
  }

  // ------------------------------------------------------------- music

  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    if (this.nextNote < ctx.currentTime - 0.2) this.nextNote = ctx.currentTime + 0.02
    while (this.nextNote < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextNote)
      this.nextNote += STEP
      this.step = (this.step + 1) % 64
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16)
    const s = step % 16
    const chord = CHORDS[bar]!
    const root = chord[0]!
    const lv = this.level
    const L = (n: Layer) => this.layers.get(n)!

    if (s === 0) {
      for (const n of chord) {
        this.pad(hz(n + 12), STEP * 16, t, L('pad'))
      }
    }
    // Arp: chord tones in 16ths when the match is hot, 8ths otherwise.
    if (lv >= 2 || s % 2 === 0) {
      const tone = chord[(s >> (lv >= 2 ? 0 : 1)) % chord.length]!
      const oct = s % 8 >= 4 ? 24 : 12
      this.note(hz(tone + oct), STEP * 1.6, 'triangle', 0.035, L('arp'), t)
    }
    if (s % 4 === 0) this.kick(t, L('kick'))
    if (lv >= 3 && (s === 14 || s === 15)) this.kick(t, L('drive'), 0.6)
    if (s % 4 === 2 || (lv >= 2 && s % 2 === 1)) this.hat(t, L('hat'), s % 4 === 2 ? 1 : 0.5)
    if (s === 4 || s === 12) this.clap(t, L('clap'))
    // Bass: off-beat 8ths on the root, an octave jump in sudden death.
    if (s % 2 === 0) {
      const up = lv >= 3 && s % 4 === 2 ? 12 : 0
      this.bass(hz(root - 12 + up), STEP * 1.8, t, L('bass'))
    }
    if (s % 2 === 0) {
      const m = MOTIF[(s / 2 + (bar % 2) * 8) % MOTIF.length]
      if (m != null) this.note(hz(m + 12), STEP * 1.8, 'square', 0.022, L('lead'), t, 0, 2400)
    }
    if (lv >= 3 && bar % 2 === 1 && s === 0) this.riser(t, STEP * 16, L('drive'))
  }

  private kick(t: number, dest: AudioNode, vel = 1): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12)
    g.gain.setValueAtTime(0.32 * vel, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + 0.35)
  }

  private hat(t: number, dest: AudioNode, vel: number): void {
    this.noiseAt(t, 0.045, 0.06 * vel, 7500, 'highpass', dest)
  }

  private clap(t: number, dest: AudioNode): void {
    this.noiseAt(t, 0.14, 0.13, 1700, 'bandpass', dest)
    this.noiseAt(t + 0.012, 0.1, 0.08, 1700, 'bandpass', dest)
  }

  private bass(f: number, dur: number, t: number, dest: AudioNode): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const lp = ctx.createBiquadFilter()
    const g = ctx.createGain()
    o.type = 'sawtooth'
    o.frequency.value = f
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(380 + this.level * 220, t)
    lp.frequency.exponentialRampToValueAtTime(160, t + dur)
    lp.Q.value = 6
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(lp).connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private pad(f: number, dur: number, t: number, dest: AudioNode): void {
    const ctx = this.ctx!
    const lp = ctx.createBiquadFilter()
    const g = ctx.createGain()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.022, t + dur * 0.3)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    lp.connect(g).connect(dest)
    for (const detune of [-8, 8]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.detune.value = detune
      o.connect(lp)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
  }

  private riser(t: number, dur: number, dest: AudioNode): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 3
    f.frequency.setValueAtTime(400, t)
    f.frequency.exponentialRampToValueAtTime(6000, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.95)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(t)
    src.stop(t + dur)
  }

  // ------------------------------------------------------------- building blocks

  private now(): number {
    return this.ctx!.currentTime
  }

  /** At most `max` copies of one sound inside `windowMs`, so a pile-up never turns into noise. */
  private voice(key: string, max: number, windowMs = 50): boolean {
    const now = performance.now()
    const list = (this.voices.get(key) ?? []).filter((t) => now - t < windowMs)
    if (list.length >= max) return false
    list.push(now)
    this.voices.set(key, list)
    return true
  }

  private duckMusic(to: number, hold: number): void {
    const g = this.duck?.gain
    if (!g || !this.ctx) return
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(to, t + 0.02)
    g.setTargetAtTime(1, t + hold, 0.25)
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!
    if (!pan) return this.sfx!
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    p.connect(this.sfx!)
    return p
  }

  private note(freq: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, t: number, pan = 0, lowpass = 0): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    let head: AudioNode = o
    if (lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = lowpass
      o.connect(f)
      head = f
    }
    head.connect(g)
    g.connect(dest === this.sfx && pan ? this.out(pan) : dest)
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  private sweepNote(from: number, to: number, dur: number, type: OscillatorType, gain: number, t: number, pan: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    o.connect(g).connect(this.out(pan))
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  private chirp(from: number, to: number, dur: number, gain: number, type: OscillatorType, pan: number, lowpass = 0, delay = 0): void {
    const ctx = this.ctx!
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    let head: AudioNode = o
    if (lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = lowpass
      o.connect(f)
      head = f
    }
    head.connect(g).connect(this.out(pan))
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  private whoosh(pan: number, gain: number, from: number, to: number, dur: number): void {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.4
    f.frequency.setValueAtTime(from, t)
    f.frequency.exponentialRampToValueAtTime(to, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.25)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    src.connect(f).connect(g).connect(this.out(pan))
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number, type: BiquadFilterType, pan: number): void {
    this.noiseAt(this.now(), dur, gain, freq, type, this.out(pan))
  }

  private noiseAt(t: number, dur: number, gain: number, freq: number, type: BiquadFilterType, dest: AudioNode): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(t, Math.random() * 0.8)
    src.stop(t + dur + 0.02)
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.2
    const master = ctx.createGain()
    master.gain.value = 0.9
    const sfx = ctx.createGain()
    sfx.gain.value = this.volume
    const music = ctx.createGain()
    music.gain.value = this.musicVol * 1.5
    const duck = ctx.createGain()
    // A short tempo-synced echo gives the arp and lead some space.
    const delay = ctx.createDelay(1)
    delay.delayTime.value = STEP * 3
    const feedback = ctx.createGain()
    feedback.gain.value = 0.28
    const echo = ctx.createGain()
    echo.gain.value = 0.3
    delay.connect(feedback).connect(delay)
    echo.connect(delay)
    delay.connect(music)

    for (const name of Object.keys(MIX) as Layer[]) {
      const g = ctx.createGain()
      g.gain.value = MIX[name][this.level]
      g.connect(music)
      if (name === 'arp' || name === 'lead') g.connect(echo)
      this.layers.set(name, g)
    }
    music.connect(duck).connect(master)
    sfx.connect(master)
    master.connect(limiter).connect(ctx.destination)

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    this.ctx = ctx
    this.sfx = sfx
    this.music = music
    this.duck = duck
    return ctx
  }
}
