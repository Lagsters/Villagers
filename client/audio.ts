/**
 * Dzwieki generowane proceduralnie w WebAudio (bez plikow): oscylatory, szum, obwiednie.
 * AudioContext powstaje po pierwszym gescie uzytkownika (wymog przegladarek).
 */
import type { GameEvent } from '../sim/types.ts';

type Wave = OscillatorType;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private windNode: AudioBufferSourceNode | null = null;
  volume: number;

  constructor(volume: number) {
    this.volume = volume;
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // Bufor szumu bialego (1 s) do trzaskow, uderzen i wiatru.
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Ograniczenie czestotliwosci dzwieku (ms). */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: Wave = 'sine', gain = 0.2, at = 0, slide = 0): void {
    const c = this.ensure();
    if (!c || !this.master || this.volume <= 0) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, q = 1, gain = 0.2, at = 0, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ensure();
    if (!c || !this.master || !this.noiseBuf || this.volume <= 0) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- Dzwieki ----------

  click(): void {
    if (this.throttle('click', 40)) this.tone(900, 0.05, 'triangle', 0.08);
  }

  thud(): void {
    this.noise(0.18, 180, 1.2, 0.35);
    this.tone(90, 0.15, 'sine', 0.2, 0, 0.6);
  }

  chime(): void {
    this.tone(660, 0.35, 'triangle', 0.12);
    this.tone(990, 0.45, 'triangle', 0.1, 0.09);
  }

  horn(): void {
    this.tone(220, 0.7, 'sawtooth', 0.07, 0, 1.05);
    this.tone(330, 0.6, 'sawtooth', 0.05, 0.05, 1.02);
  }

  fanfare(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, 'square', 0.05, i * 0.12));
  }

  doom(): void {
    this.tone(160, 1.2, 'sawtooth', 0.08, 0, 0.5);
    this.tone(120, 1.4, 'sine', 0.12, 0.1, 0.6);
  }

  clash(): void {
    if (!this.throttle('clash', 180)) return;
    this.noise(0.08, 3500, 8, 0.12);
    this.tone(1800 + Math.random() * 600, 0.12, 'square', 0.03);
  }

  crackle(): void {
    if (!this.throttle('crackle', 400)) return;
    for (let i = 0; i < 4; i++) this.noise(0.05, 1200 + Math.random() * 1500, 3, 0.08, Math.random() * 0.3);
  }

  whoosh(): void {
    if (this.throttle('whoosh', 300)) this.noise(0.4, 600, 0.8, 0.15, 0, 'lowpass');
  }

  victory(): void {
    [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.08, i * 0.15));
  }

  /** Cichy wiatr w tle (petla szumu z wolna modulacja filtra). */
  ambient(on: boolean): void {
    const c = this.ensure();
    if (!c || !this.master || !this.noiseBuf) return;
    if (!on) {
      this.windNode?.stop();
      this.windNode = null;
      return;
    }
    if (this.windNode) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = c.createGain();
    g.gain.value = 0.035;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.windNode = src;
  }

  /**
   * Dzwieki zdarzen gry. `near(pos)` mowi, czy zdarzenie jest w poblizu kamery
   * (odglosy swiata tylko w kadrze), `me` to lokalny gracz (powiadomienia zawsze).
   */
  onEvents(events: GameEvent[], me: number, near: (pos: number) => boolean): void {
    for (const e of events) {
      switch (e.type) {
        case 'site': if (e.player === me) this.thud(); break;
        case 'built': if (e.player === me && e.a !== 0) this.chime(); break;
        case 'attack': if (e.player === me || e.a === me) { if (this.throttle('horn', 3000)) this.horn(); } break;
        case 'captured': if (e.player === me) this.fanfare(); else if (e.a === me) this.doom(); break;
        case 'castleLost': if (e.player === me) this.doom(); else if (e.a === me) this.fanfare(); break;
        case 'victory': if (e.player === me) this.victory(); else this.doom(); break;
        case 'duel': case 'death': if (near(e.pos)) this.clash(); break;
        case 'burned': case 'demolished': if (near(e.pos)) this.crackle(); break;
        case 'catapult': if (near(e.pos)) this.whoosh(); break;
        case 'found': if (e.player === me) this.tone(880, 0.2, 'sine', 0.1); break;
      }
    }
  }
}
