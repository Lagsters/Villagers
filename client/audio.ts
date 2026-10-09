/**
 * Dzwiek gry w WebAudio (bez plikow; generatory w client/sfx.ts). AudioContext powstaje po pierwszym gescie
 * uzytkownika (wymog przegladarek).
 *
 * Dzwieki swiata maja polozenie: sluchacz stoi w srodku widoku kamery. Im blizej (wieksze przyblizenie, zrodlo
 * blizej srodka ekranu), tym glosniej i wyrazisciej - z daleka filtr dolnoprzepustowy przycina gore pasma i rosnie
 * udzial poglosu; panorama stereo wg polozenia na ekranie. Limit glosow naraz i najwyzej kilka jednakowych dzwiekow
 * jednoczesnie (20 drwali w kadrze to nie 20 uderzen). Petle (ogien, woda, skrzypienie) zyja, dopoki scena je
 * odswieza; otoczenie (wiatr, las, morze, jezioro, gwar osady) mieszane wg zawartosci kadru (setMix).
 */
import type { GameEvent } from '../sim/types.ts';
import { LOOPS, PICKS, SFX, rng, type Loop } from './sfx.ts';

type Wave = OscillatorType;

/** Sluchacz: srodek widoku (swiat x, z), polowa szerokosci widoku w swiecie, przyblizenie, kierunek "w prawo" ekranu. */
export interface Listener { x: number; z: number; half: number; zoom: number; rx: number; rz: number }

/** Co widac w kadrze (udzialy 0..1), wg czego miesza sie otoczenie. */
export interface ViewMix { trees: number; water: number; shore: number; mountain: number; grass: number; people: number }

/** Najwiecej glosow swiata naraz i jednakowych dzwiekow naraz. */
const MAX_VOICES = 18;
const MAX_SAME = 3;
/** Najwiecej petli swiata naraz (ognie, woda); kolejne czekaja, az ktoras zgasnie. */
const MAX_LOOPS = 10;
/** Ten sam klucz (np. jedno uderzenie siekiery) najwyzej raz na tyle sekund. */
const KEY_GAP = 0.25;
/** Zrodlo dalej niz tyle polowek szerokosci widoku od srodka - cisza. */
const CUTOFF = 1.3;

/** Glosnosc wg przyblizenia: z daleka cicho, z bliska pelna. */
function zoomGain(zoom: number): number {
  return Math.min(1, Math.max(0.12, (zoom - 0.6) / 4));
}

/** Krotki poglos: szum gasnacy wykladniczo (impuls splotu), stereo. */
function reverbImpulse(c: BaseAudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 1.2);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return b;
}

interface LiveLoop { loop: Loop; gain: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode; seen: number; name: string }
interface Bed { loop: Loop; gain: GainNode }

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private world: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private keys = new Map<number, number>();
  private active = new Map<string, number>();
  private voices = 0;
  private loops = new Map<number, LiveLoop>();
  private beds = new Map<string, Bed>();
  private ambientOn = false;
  private seed = 1;
  private listener: Listener = { x: 0, z: 0, half: 10, zoom: 1, rx: 1, rz: 0 };
  private mix: ViewMix = { trees: 0, water: 0, shore: 0, mountain: 0, grass: 1, people: 0 };
  private nextBird = 0;
  private nextCricket = 0;
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
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    this.world = c.createGain();
    this.world.connect(this.master);
    this.reverb = c.createConvolver();
    this.reverb.buffer = reverbImpulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);
    // Bufor szumu bialego (1 s) do dzwiekow interfejsu i powiadomien.
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    if (this.ambientOn) this.startBeds();
    return c;
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

  // ---------------------------------------------------------------- dzwieki swiata z polozeniem

  /** Polozenie sluchacza (co klatke, z kamery). */
  setListener(l: Listener): void {
    this.listener = l;
  }

  /** Glosnosc (0..1), odleglosc wzgledna i panorama zrodla w (x, z) wzgledem sluchacza. */
  private place(x: number, z: number): { g: number; r: number; pan: number } {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const r = Math.hypot(dx, dz) / Math.max(0.5, L.half);
    if (r > CUTOFF) return { g: 0, r, pan: 0 };
    const g = zoomGain(L.zoom) / (1 + (r / 0.45) ** 2);
    const pan = Math.max(-1, Math.min(1, (dx * L.rx + dz * L.rz) / Math.max(0.5, L.half))) * 0.7;
    return { g, r, pan };
  }

  /** Lancuch zrodla swiata: glosnosc, filtr (wyrazistosc), panorama; do miksu i do poglosu wg odleglosci. */
  private chain(c: AudioContext, g: number, r: number, pan: number): { input: GainNode; lp: BiquadFilterNode; p: StereoPannerNode } {
    const input = c.createGain();
    input.gain.value = g;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.clarity(r);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    input.connect(lp).connect(p);
    p.connect(this.world!);
    const send = c.createGain();
    send.gain.value = this.wetness(r);
    p.connect(send).connect(this.reverb!);
    return { input, lp, p };
  }

  /** Granica filtra: z bliska pelne pasmo, z daleka (odleglosc, male przyblizenie) przytlumione. */
  private clarity(r: number): number {
    const near = Math.min(1, this.listener.zoom / 5) * (1 - Math.min(1, r));
    return 1500 + near * near * 15000;
  }

  private wetness(r: number): number {
    return 0.15 + 0.45 * Math.min(1, r + (1 - Math.min(1, this.listener.zoom / 4)) * 0.5);
  }

  /**
   * Dzwiek swiata w (x, z). key - to samo zdarzenie (np. uderzenie o numerze n danego drwala) gra tylko raz, nawet
   * gdy scena wola co klatke; gain - mnoznik glosnosci.
   */
  play(name: string, x: number, z: number, key = -1, gain = 1): void {
    const gen = SFX[name];
    if (!gen || this.volume <= 0) return;
    const now = performance.now() / 1000;
    if (key >= 0) {
      const k = this.keys.get(key);
      if (k !== undefined && now - k < KEY_GAP) {
        this.keys.set(key, now);
        return;
      }
      this.keys.set(key, now);
      if (this.keys.size > 4000) this.keys.clear();
    }
    const { g, r, pan } = this.place(x, z);
    if (g * gain < 0.01 || this.voices >= MAX_VOICES || (this.active.get(name) ?? 0) >= MAX_SAME) return;
    const c = this.ensure();
    if (!c || !this.world) return;
    const ch = this.chain(c, g * gain, r, pan);
    const picks = PICKS[name];
    const seed = picks?.length ? picks[Math.floor(Math.random() * picks.length)] : this.seed++ * 2654435761;
    const dur = gen(c, ch.input, c.currentTime + 0.005, rng(seed));
    this.voices++;
    this.active.set(name, (this.active.get(name) ?? 0) + 1);
    setTimeout(() => {
      this.voices--;
      this.active.set(name, (this.active.get(name) ?? 1) - 1);
      ch.p.disconnect();
    }, (dur + 1.2) * 1000);
  }

  /** Petla swiata pod kluczem (np. ogien w kuzni budynku): gra, dopoki jest odswiezana co klatke. */
  loop(key: number, name: string, x: number, z: number, gain = 1): void {
    if (this.volume <= 0) return;
    const c = this.ctx;
    if (!c || !this.world) return;
    const { g, r, pan } = this.place(x, z);
    let l = this.loops.get(key);
    if (!l) {
      const gen = LOOPS[name];
      if (!gen || g * gain < 0.01 || this.loops.size >= MAX_LOOPS) return;
      const ch = this.chain(c, 0, r, pan);
      l = { loop: gen(c, ch.input, c.currentTime, rng(key)), gain: ch.input, lp: ch.lp, pan: ch.p, seen: 0, name };
      this.loops.set(key, l);
    }
    l.seen = c.currentTime;
    l.gain.gain.setTargetAtTime(g * gain, c.currentTime, 0.1);
    l.lp.frequency.setTargetAtTime(this.clarity(r), c.currentTime, 0.1);
    l.pan.pan.setTargetAtTime(pan, c.currentTime, 0.1);
  }

  /** Co klatke: wygasza petle, ktorych scena juz nie odswieza; miesza otoczenie; ptaki i swierszcze. */
  update(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const [k, l] of this.loops) {
      if (t - l.seen > 0.3) {
        l.gain.gain.setTargetAtTime(0, t, 0.08);
        l.loop.stop(t + 0.5);
        this.loops.delete(k);
      }
    }
    this.updateBeds(t);
  }

  /** Co widac w kadrze (wywolywane co ok. 0,5 s). */
  setMix(m: ViewMix): void {
    this.mix = m;
  }

  // ---------------------------------------------------------------- otoczenie

  /** Otoczenie w tle: wiatr, las, morze, jezioro, gwar osady (glosnosc wg kadru), ptaki i swierszcze. */
  ambient(on: boolean): void {
    this.ambientOn = on;
    if (!this.ctx) return;
    if (on) this.startBeds();
    else {
      for (const b of this.beds.values()) b.loop.stop(this.ctx.currentTime + 0.1);
      this.beds.clear();
    }
  }

  private startBeds(): void {
    const c = this.ctx;
    if (!c || !this.master || this.beds.size) return;
    for (const name of ['wind', 'leaves', 'sea', 'lake', 'murmur']) {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      this.beds.set(name, { loop: LOOPS[name](c, gain, c.currentTime, rng(name.length)), gain });
    }
  }

  private updateBeds(t: number): void {
    if (!this.beds.size) return;
    const m = this.mix, z = this.listener.zoom;
    // Tlo jest najnizszym priorytetem: las i morze sa prawie w kazdym kadrze, wiec graja cicho i przyciszaja sie
    // jeszcze, gdy slychac prace, zwierzeta albo petle (ogien, woda). Z daleka wiecej wiatru, z bliska wiecej lisci.
    const far = 1 - Math.min(1, z / 4);
    const duck = Math.max(0.35, 1 / (1 + 0.25 * (this.voices + this.loops.size)));
    const target: Record<string, number> = {
      wind: (0.03 + 0.04 * m.mountain + 0.03 * far) * duck,
      leaves: 0.018 * m.trees * (0.4 + 0.6 * (1 - far)) * duck,
      sea: 0.03 * Math.min(1, m.shore * 3) * (0.5 + 0.5 * m.water) * duck,
      lake: 0.02 * Math.min(1, m.shore * 3) * (1 - far) * duck,
      murmur: 0.03 * Math.min(1, m.people) * (1 - far * 0.7) * duck,
    };
    for (const [name, b] of this.beds) b.gain.gain.setTargetAtTime(target[name] ?? 0, t, 0.8);
    // Ptaki w lesie i na lace, swierszcze na otwartej lace - tylko z bliska.
    const L = this.listener;
    if (t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 4 / Math.max(0.2, m.trees + m.grass * 0.4);
      if (z > 1.5 && (m.trees > 0.1 || m.grass > 0.3)) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * L.half;
        this.play('bird', L.x + Math.cos(a) * d, L.z + Math.sin(a) * d, -1, 0.5 + m.trees * 0.5);
      }
    }
    if (t > this.nextCricket) {
      this.nextCricket = t + 0.6 + Math.random() * 1.5;
      if (z > 2.5 && m.grass > 0.4) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * L.half;
        this.play('cricket', L.x + Math.cos(a) * d, L.z + Math.sin(a) * d, -1, 0.4 * m.grass);
      }
    }
  }

  // ---------------------------------------------------------------- interfejs i powiadomienia (bez polozenia)

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

  victory(): void {
    [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.08, i * 0.15));
  }

  /**
   * Dzwieki zdarzen gry. Powiadomienia gracza (budowa, atak, przejecie, koniec gry, zloze) bez polozenia; odglosy
   * swiata (walka, pozar, katapulta) w miejscu zdarzenia - glosnosc wg kamery. at(pos) daje polozenie pola w swiecie.
   */
  onEvents(events: GameEvent[], me: number, at: (pos: number) => { x: number; z: number }): void {
    for (const e of events) {
      switch (e.type) {
        case 'site': if (e.player === me) this.thud(); break;
        case 'built': if (e.player === me && e.a !== 0) this.chime(); break;
        case 'attack': if (e.player === me || e.a === me) { if (this.throttle('horn', 3000)) this.horn(); } break;
        case 'captured': if (e.player === me) this.fanfare(); else if (e.a === me) this.doom(); break;
        case 'castleLost': if (e.player === me) this.doom(); else if (e.a === me) this.fanfare(); break;
        case 'victory': if (e.player === me) this.victory(); else this.doom(); break;
        case 'duel': { const p = at(e.pos); this.play('clash', p.x, p.z); this.play('shout', p.x, p.z, -1, 0.7); break; }
        case 'death': { const p = at(e.pos); this.play('death', p.x, p.z); break; }
        case 'burned': case 'demolished': { const p = at(e.pos); this.play('crackle', p.x, p.z); this.play('wood_crack', p.x, p.z, -1, 0.7); break; }
        case 'catapult': { const p = at(e.pos); this.play('catapult', p.x, p.z); break; }
        case 'found': if (e.player === me) this.tone(880, 0.2, 'sine', 0.1); break;
        case 'exhausted': if (e.player === me) this.tone(440, 0.4, 'sine', 0.08, 0, 0.7); break;
      }
    }
  }
}
