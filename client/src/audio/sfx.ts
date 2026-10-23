import { store } from '../state/store.js';

type SfxName =
  | 'click'
  | 'fire'
  | 'penHit'
  | 'deskHit'
  | 'fall'
  | 'danger'
  | 'countdown'
  | 'go'
  | 'win'
  | 'lose'
  | 'draw';

/**
 * Procedural sound.
 *
 * Every effect is synthesised with oscillators and generated noise, so the game
 * ships with no audio files at all: nothing to download, nothing to 404, and no
 * licensing attached to a sample pack. The context is created lazily on the
 * first gesture because browsers refuse to start audio before one.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  /** Call from a click/touch handler before the first sound. */
  unlock(): void {
    this.ensure();
    void this.ctx?.resume();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;

      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.volume();
      master.connect(ctx.destination);

      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = this.makeNoise(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private volume(): number {
    const { settings } = store.getState();
    return settings.sfxEnabled ? settings.masterVolume : 0;
  }

  syncVolume(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume(), this.ctx.currentTime, 0.05);
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private noiseBurst(duration: number, frequency: number, q: number, gain: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    source.connect(filter).connect(envelope).connect(this.master);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    endFrequency?: number,
    delay = 0,
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;

    const startAt = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startAt);
    if (endFrequency !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), startAt + duration);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(envelope).connect(this.master);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  /** Rising hum while a shot is being charged. */
  startCharge(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.chargeOsc) return;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(430, ctx.currentTime + 1.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.25);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;

    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();

    this.chargeOsc = osc;
    this.chargeGain = gain;
  }

  stopCharge(): void {
    const ctx = this.ctx;
    if (!ctx || !this.chargeOsc || !this.chargeGain) return;
    this.chargeGain.gain.cancelScheduledValues(ctx.currentTime);
    this.chargeGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
    this.chargeOsc.stop(ctx.currentTime + 0.12);
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  play(name: SfxName, intensity = 1): void {
    if (!store.getState().settings.sfxEnabled) return;
    const strength = Math.max(0.05, Math.min(1, intensity));

    switch (name) {
      case 'click':
        this.tone(760, 0.05, 'square', 0.05);
        break;
      case 'fire':
        this.noiseBurst(0.1, 1500, 0.9, 0.12 * strength);
        this.tone(420, 0.16, 'triangle', 0.1 * strength, 150);
        break;
      case 'penHit':
        // Short, bright, plastic-on-plastic.
        this.noiseBurst(0.07, 2100, 6, 0.3 * strength);
        this.tone(900 + 500 * strength, 0.07, 'square', 0.08 * strength, 400);
        break;
      case 'deskHit':
        this.noiseBurst(0.09, 700, 2.5, 0.16 * strength);
        break;
      case 'fall':
        this.tone(150, 0.3, 'sine', 0.2, 60);
        this.noiseBurst(0.22, 320, 1.2, 0.16);
        break;
      case 'danger':
        this.tone(520, 0.12, 'square', 0.07);
        break;
      case 'countdown':
        this.tone(620, 0.12, 'triangle', 0.1);
        break;
      case 'go':
        this.tone(880, 0.22, 'triangle', 0.13, 1200);
        break;
      case 'win':
        this.tone(523, 0.16, 'triangle', 0.12, undefined, 0);
        this.tone(659, 0.16, 'triangle', 0.12, undefined, 0.12);
        this.tone(784, 0.3, 'triangle', 0.14, undefined, 0.24);
        break;
      case 'lose':
        this.tone(392, 0.2, 'sawtooth', 0.1, undefined, 0);
        this.tone(311, 0.34, 'sawtooth', 0.1, 180, 0.16);
        break;
      case 'draw':
        this.tone(466, 0.22, 'triangle', 0.1);
        this.tone(466, 0.26, 'triangle', 0.09, 400, 0.22);
        break;
      default:
        break;
    }
  }
}

export const sfx = new Sfx();
