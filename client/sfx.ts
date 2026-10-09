/**
 * Biblioteka dzwiekow syntetyzowanych w WebAudio (bez plikow). Kazdy dzwiek to generator, ktory w kontekscie
 * (AudioContext w grze, OfflineAudioContext przy odsluchu wariantow - scripts/sounds.ts) planuje wezly od chwili t
 * do wyjscia `out`; `r` to ziarno losowe - kazde odtworzenie brzmi troche inaczej (wysokosc, barwa, dlugosc).
 * Cegielki: szum przez filtr, ton z obwiednia, drgania modalne (drewno, kamien, metal), glos z formantami
 * (zwierzeta, okrzyki). Petle (ogien, woda, skrzypienie, otoczenie) zwracaja uchwyt z `stop`.
 */

export type Ctx = BaseAudioContext;
export type Rng = () => number;

/** Ziarno losowe (mulberry32). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseBufs = new WeakMap<Ctx, AudioBuffer>();
/** Szum bialy 2 s (wspolny dla kontekstu). */
function noiseBuf(c: Ctx): AudioBuffer {
  let b = noiseBufs.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    noiseBufs.set(c, b);
  }
  return b;
}

const between = (r: Rng, a: number, b: number) => a + (b - a) * r();

/** Obwiednia: narastanie do `peak` w `a` s (liniowo), opadanie do ciszy w `d` s (wykladniczo). */
function env(p: AudioParam, t: number, a: number, peak: number, d: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, a));
  p.exponentialRampToValueAtTime(0.0001, t + a + d);
}

interface NoiseOpts { dur: number; f: number; q?: number; type?: BiquadFilterType; gain?: number; a?: number; f2?: number }
/** Szum przez filtr (pasmowy domyslnie), z opcjonalnym przesuwem czestotliwosci do f2. */
function noise(c: Ctx, out: AudioNode, t: number, o: NoiseOpts): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.f, t);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  env(g.gain, t, o.a ?? 0.003, o.gain ?? 0.3, o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + (o.a ?? 0.003) + o.dur + 0.05);
}

interface ToneOpts { f: number; f2?: number; dur: number; type?: OscillatorType; gain?: number; a?: number }
/** Ton z obwiednia i opcjonalnym przesuwem wysokosci do f2. */
function tone(c: Ctx, out: AudioNode, t: number, o: ToneOpts): void {
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
  const g = c.createGain();
  env(g.gain, t, o.a ?? 0.004, o.gain ?? 0.2, o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + (o.a ?? 0.004) + o.dur + 0.05);
}

/** Drgania modalne: suma tlumionych sinusow (czestotliwosc, czas wybrzmienia, glosnosc) - drewno, kamien, metal. */
function modal(c: Ctx, out: AudioNode, t: number, modes: readonly [number, number, number][], gain = 1): void {
  for (const [f, d, g] of modes) tone(c, out, t, { f, dur: d, gain: g * gain, a: 0.001 });
}

interface VoiceOpts {
  /** wysokosc tonu krtaniowego: punkty [czas wzgledny 0..1, Hz] */
  f0: readonly [number, number][];
  dur: number;
  /** formanty: [Hz, Q, glosnosc] */
  formants: readonly [number, number, number][];
  gain?: number;
  /** chrapliwosc: modulacja amplitudy (Hz, glebokosc 0..1) */
  rough?: [number, number];
  /** domieszka szumu oddechu 0..1 */
  breath?: number;
  /** vibrato: glebokosc (czesc wysokosci, domyslnie 0,012) przy ok. 5,5 Hz - glos bez niego brzmi jak automat */
  vib?: number;
  /** ksztalt obwiedni: narastanie i opadanie (czesci dlugosci) */
  a?: number;
  r?: number;
  wave?: OscillatorType;
}
/** Glos: ton krtaniowy (piloksztaltny) z przebiegiem wysokosci przez rownolegle filtry formantowe. */
function voice(c: Ctx, out: AudioNode, t: number, o: VoiceOpts): void {
  const src = c.createOscillator();
  src.type = o.wave ?? 'sawtooth';
  src.frequency.setValueAtTime(o.f0[0][1], t);
  for (const [u, hz] of o.f0.slice(1)) src.frequency.linearRampToValueAtTime(hz, t + u * o.dur);
  const vib = o.vib ?? 0.012;
  if (vib > 0) {
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = c.createGain();
    depth.gain.value = o.f0[0][1] * vib;
    lfo.connect(depth).connect(src.frequency);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
  }
  const shape = c.createGain();
  const g = shape.gain;
  const a = (o.a ?? 0.1) * o.dur, rel = (o.r ?? 0.3) * o.dur;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(1, t + a);
  g.setValueAtTime(1, t + o.dur - rel);
  g.linearRampToValueAtTime(0, t + o.dur);
  let tail: AudioNode = shape;
  if (o.rough) {
    const am = c.createGain();
    am.gain.value = 1 - o.rough[1] / 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = o.rough[0];
    const depth = c.createGain();
    depth.gain.value = o.rough[1] / 2;
    lfo.connect(depth).connect(am.gain);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
    shape.connect(am);
    tail = am;
  }
  src.connect(shape);
  if (o.breath) {
    const n = c.createBufferSource();
    n.buffer = noiseBuf(c);
    const ng = c.createGain();
    ng.gain.value = o.breath;
    n.connect(ng).connect(shape);
    n.start(t, Math.random());
    n.stop(t + o.dur + 0.05);
  }
  const mix = c.createGain();
  mix.gain.value = o.gain ?? 0.3;
  for (const [f, q, fg] of o.formants) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const bg = c.createGain();
    bg.gain.value = fg;
    tail.connect(bp).connect(bg).connect(mix);
  }
  mix.connect(out);
  src.start(t);
  src.stop(t + o.dur + 0.05);
}

/** Generator dzwieku jednorazowego: planuje wezly od chwili t, zwraca dlugosc (s). */
export type Gen = (c: Ctx, out: AudioNode, t: number, r: Rng) => number;

/** Drewno: kilka modow o krotkim wybrzmieniu, wysokosc wg wielkosci. */
function woodModes(r: Rng, base: number): [number, number, number][] {
  return [[base, 0.09, 0.5], [base * between(r, 2.3, 2.7), 0.06, 0.3], [base * between(r, 4.1, 4.6), 0.04, 0.15]];
}

/** Formanty samoglosek meskiego glosu (a, e, o, u): [F1, F2, F3] w Hz. */
const VOWELS: readonly [number, number, number][] = [[730, 1090, 2440], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240]];

/**
 * Ziarna wybrane na odsluchu (procedura w README, „Odsluch dzwiekow”): gra losuje tylko sposrod nich; brak wpisu -
 * dowolne ziarno. Zmiana generatora zmienia brzmienie jego ziaren - wtedy odsluch tego dzwieku trzeba powtorzyc.
 */
export const PICKS: Partial<Record<string, readonly number[]>> = {
  pig_grunt: [9, 13],
  pig_squeal: [55, 99, 133],
  donkey_bray: [27],
  deer_snort: [89],
  bird: [52, 74, 76],
  cricket: [5, 60, 74, 76],
  shout: [66, 86],
  death: [1, 66],
  wood_crack: [1],
  tree_land: [1],
};

export const SFX: Record<string, Gen> = {
  // ---------------------------------------------------------------- uderzenia w drewno, kamien, metal, ziemie
  /** Siekiera w pien: gluchy stuk drewna i trzask wiorow. */
  chop(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 150, 210)), 0.9);
    noise(c, out, t, { dur: 0.06, f: between(r, 1800, 2600), q: 1.4, gain: 0.35 });
    noise(c, out, t + 0.01, { dur: 0.12, f: 700, q: 0.8, gain: 0.12 });
    return 0.2;
  },
  /** Pekniecie drewna (drzewo zaczyna sie walic, rozlupywanie). */
  wood_crack(c, out, t, r) {
    for (let i = 0; i < 6; i++) noise(c, out, t + i * between(r, 0.02, 0.06), { dur: 0.03, f: between(r, 900, 3000), q: 3, gain: 0.25 });
    modal(c, out, t, woodModes(r, between(r, 110, 150)), 0.5);
    return 0.4;
  },
  /** Drzewo uderza o ziemie: gluchy huk pnia i szelest korony. */
  tree_land(c, out, t, r) {
    tone(c, out, t, { f: between(r, 60, 80), f2: 40, dur: 0.5, gain: 0.5, a: 0.005 });
    noise(c, out, t, { dur: 0.35, f: 220, q: 0.7, gain: 0.45 });
    noise(c, out, t, { dur: 0.6, f: 3000, q: 0.5, gain: 0.15, a: 0.02 });
    for (let i = 0; i < 6; i++) noise(c, out, t + 0.02 + r() * 0.3, { dur: 0.03, f: between(r, 1200, 3000), q: 3, gain: 0.08 });
    return 0.7;
  },
  /** Mlotek w drewno (budowa, szkutnik, gwozdzie). */
  hammer_wood(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 260, 340)), 0.8);
    tone(c, out, t, { f: between(r, 1900, 2300), dur: 0.05, gain: 0.08, type: 'triangle' });
    return 0.15;
  },
  /** Mlot w kowadlo: dzwieczny metal o niewielokrotnych modach, dlugie wybrzmienie. */
  anvil(c, out, t, r) {
    const f = between(r, 900, 1150);
    modal(c, out, t, [[f, 0.9, 0.28], [f * 2.76, 0.6, 0.18], [f * 5.4, 0.35, 0.1], [f * 8.93, 0.2, 0.05]]);
    noise(c, out, t, { dur: 0.03, f: 5000, q: 1, gain: 0.25 });
    return 1;
  },
  /** Kilof w skale: twardy trzask kamienia. */
  pick_stone(c, out, t, r) {
    modal(c, out, t, [[between(r, 600, 800), 0.06, 0.3], [between(r, 1700, 2100), 0.05, 0.2], [between(r, 3300, 3900), 0.03, 0.1]]);
    noise(c, out, t, { dur: 0.05, f: between(r, 3000, 4500), q: 1.2, gain: 0.4 });
    noise(c, out, t + 0.015, { dur: 0.15, f: 1500, q: 0.6, gain: 0.08 });
    return 0.2;
  },
  /** Dluto w kamien: wyzszy, krotszy stuk. */
  chisel(c, out, t, r) {
    modal(c, out, t, [[between(r, 1300, 1600), 0.05, 0.22], [between(r, 3200, 3800), 0.04, 0.12]]);
    noise(c, out, t, { dur: 0.03, f: 6000, q: 1.5, gain: 0.25 });
    return 0.1;
  },
  /** Lopata wbijana w ziemie. */
  shovel(c, out, t, r) {
    noise(c, out, t, { dur: 0.12, f: between(r, 350, 500), q: 0.9, gain: 0.4, a: 0.01 });
    noise(c, out, t, { dur: 0.04, f: 2500, q: 2, gain: 0.12 });
    tone(c, out, t, { f: between(r, 1400, 1700), dur: 0.08, gain: 0.04, type: 'triangle' });
    return 0.18;
  },
  /** Sypanie ziemi z lopaty. */
  dirt(c, out, t, r) {
    for (let i = 0; i < 8; i++) noise(c, out, t + i * between(r, 0.01, 0.03), { dur: 0.06, f: between(r, 900, 2200), q: 1.5, gain: 0.1 });
    noise(c, out, t, { dur: 0.25, f: 500, q: 0.6, gain: 0.12, a: 0.03 });
    return 0.35;
  },
  /** Tasak w pieniek. */
  cleaver(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 180, 240)), 0.7);
    noise(c, out, t, { dur: 0.05, f: 4200, q: 2, gain: 0.2 });
    return 0.15;
  },
  /** Stempel mincerza: uderzenie metalu w metal, krotkie. */
  stamp(c, out, t, r) {
    const f = between(r, 1700, 2000);
    modal(c, out, t, [[f, 0.25, 0.2], [f * 2.4, 0.15, 0.12], [f * 3.9, 0.1, 0.06]]);
    noise(c, out, t, { dur: 0.02, f: 4000, q: 1, gain: 0.2 });
    return 0.3;
  },
  /** Brzek monet. */
  coins(c, out, t, r) {
    for (let i = 0; i < 5; i++) {
      const f = between(r, 3200, 5200);
      modal(c, out, t + i * between(r, 0.03, 0.08), [[f, 0.12, 0.08], [f * 1.48, 0.08, 0.05]]);
    }
    return 0.5;
  },
  /** Odlozenie towaru: drewno, kamien, metal, worek. */
  drop_wood(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 200, 280)), 0.6);
    return 0.12;
  },
  drop_stone(c, out, t, r) {
    modal(c, out, t, [[between(r, 380, 480), 0.05, 0.3], [between(r, 1100, 1300), 0.03, 0.15]]);
    noise(c, out, t, { dur: 0.06, f: 1800, q: 1, gain: 0.15 });
    return 0.12;
  },
  drop_metal(c, out, t, r) {
    const f = between(r, 700, 900);
    modal(c, out, t, [[f, 0.3, 0.12], [f * 2.6, 0.2, 0.08]]);
    return 0.3;
  },
  drop_sack(c, out, t, r) {
    noise(c, out, t, { dur: 0.12, f: between(r, 250, 350), q: 0.7, gain: 0.35, a: 0.008 });
    noise(c, out, t + 0.02, { dur: 0.1, f: 1500, q: 0.8, gain: 0.06 });
    return 0.18;
  },
  /** Klepniecie dloni w ciasto: miekkie, gluche plasniecie. */
  slap(c, out, t, r) {
    noise(c, out, t, { dur: 0.07, f: between(r, 500, 800), q: 0.9, gain: 0.25, a: 0.002 });
    tone(c, out, t, { f: between(r, 110, 150), f2: 80, dur: 0.06, gain: 0.15, a: 0.002 });
    return 0.1;
  },
  // ---------------------------------------------------------------- ruch narzedzi
  /** Pociagniecie pily (tam albo z powrotem): szum z zebami. */
  saw(c, out, t, r) {
    const dur = between(r, 0.32, 0.42);
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(between(r, 1800, 2400), t);
    bp.frequency.linearRampToValueAtTime(between(r, 2400, 3000), t + dur);
    bp.Q.value = 2.5;
    const am = c.createGain();
    am.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = between(r, 45, 60);
    const d = c.createGain();
    d.gain.value = 0.5;
    lfo.connect(d).connect(am.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.06);
    g.gain.setValueAtTime(0.3, t + dur - 0.08);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(am).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    return dur;
  },
  /** Swist (kosa, zamach, zarzucenie wedki): szum o przesuwanym pasmie. */
  swish(c, out, t, r) {
    noise(c, out, t, { dur: 0.25, f: between(r, 900, 1300), f2: between(r, 2500, 3500), q: 1.5, gain: 0.18, a: 0.08 });
    return 0.35;
  },
  /** Siew: garsc ziarna rozsypana na ziemi. */
  scatter(c, out, t, r) {
    for (let i = 0; i < 14; i++) noise(c, out, t + 0.1 + i * between(r, 0.008, 0.02), { dur: 0.02, f: between(r, 3000, 6000), q: 4, gain: 0.07 });
    return 0.4;
  },
  /** Cieciwa luku i swist strzaly. */
  bow(c, out, t, r) {
    tone(c, out, t, { f: between(r, 180, 230), f2: 150, dur: 0.15, type: 'triangle', gain: 0.18 });
    noise(c, out, t, { dur: 0.02, f: 2000, q: 2, gain: 0.15 });
    noise(c, out, t + 0.03, { dur: 0.3, f: 2500, f2: 1200, q: 3, gain: 0.08, a: 0.03 });
    return 0.4;
  },
  /** Trafienie strzaly. */
  arrow_hit(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 300, 400)), 0.4);
    noise(c, out, t, { dur: 0.04, f: 900, q: 1, gain: 0.2 });
    return 0.12;
  },
  // ---------------------------------------------------------------- woda
  /** Plusk (wiadro, spadajacy kamien, ryba). */
  splash(c, out, t, r) {
    noise(c, out, t, { dur: 0.25, f: between(r, 800, 1200), q: 0.7, gain: 0.35, a: 0.005 });
    for (let i = 0; i < 6; i++) tone(c, out, t + 0.03 + i * between(r, 0.02, 0.05), { f: between(r, 600, 1400), f2: between(r, 1400, 2400), dur: 0.05, gain: 0.05 });
    return 0.4;
  },
  /** Maly plusk (splawik, kropla do wody). */
  splash_small(c, out, t, r) {
    noise(c, out, t, { dur: 0.08, f: between(r, 1500, 2200), q: 1, gain: 0.15 });
    tone(c, out, t + 0.01, { f: between(r, 700, 1000), f2: between(r, 1600, 2200), dur: 0.06, gain: 0.08 });
    return 0.15;
  },
  /** Syk hartowania (goracy metal w wodzie) albo lanego metalu. */
  hiss(c, out, t, r) {
    noise(c, out, t, { dur: between(r, 0.6, 0.9), f: between(r, 4000, 6000), q: 0.6, gain: 0.2, a: 0.02, type: 'highpass' });
    for (let i = 0; i < 5; i++) tone(c, out, t + i * 0.05, { f: between(r, 800, 1600), f2: 2400, dur: 0.04, gain: 0.03 });
    return 0.9;
  },
  // ---------------------------------------------------------------- ogien, powietrze, mechanizmy
  /** Trzask ognia (pojedynczy). */
  crackle(c, out, t, r) {
    for (let i = 0; i < 4; i++) noise(c, out, t + r() * 0.3, { dur: 0.03, f: between(r, 1200, 3500), q: 3, gain: 0.12 });
    return 0.35;
  },
  /** Miech kowalski: dmuchniecie. */
  bellows(c, out, t, r) {
    noise(c, out, t, { dur: 0.5, f: between(r, 300, 450), q: 0.5, gain: 0.25, a: 0.15 });
    return 0.7;
  },
  /** Skrzypienie drewna (kolowrot, skrzydla wiatraka, naciag katapulty). */
  creak(c, out, t, r) {
    const dur = between(r, 0.35, 0.6);
    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(between(r, 35, 55), t);
    src.frequency.linearRampToValueAtTime(between(r, 25, 45), t + dur);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = between(r, 700, 1100);
    bp.Q.value = 6;
    const g = c.createGain();
    env(g.gain, t, dur * 0.3, 0.35, dur * 0.7);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
    return dur;
  },
  /** Toczona beczka albo wozek: dudnienie z turkotem. */
  roll(c, out, t, r) {
    const dur = between(r, 0.5, 0.8);
    for (let i = 0; i * 0.07 < dur; i++) noise(c, out, t + i * 0.07, { dur: 0.06, f: between(r, 150, 260), q: 1.5, gain: 0.18 });
    return dur;
  },
  /** Wystrzal katapulty: trzask ramienia o poprzeczke. */
  catapult(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 90, 120)), 1);
    noise(c, out, t, { dur: 0.3, f: 600, f2: 200, q: 0.8, gain: 0.3 });
    return 0.4;
  },
  /** Kamien z katapulty uderza w mur. */
  impact(c, out, t, r) {
    tone(c, out, t, { f: 80, f2: 35, dur: 0.6, gain: 0.5, a: 0.003 });
    noise(c, out, t, { dur: 0.5, f: 400, q: 0.5, gain: 0.5 });
    for (let i = 0; i < 8; i++) noise(c, out, t + 0.05 + r() * 0.5, { dur: 0.04, f: between(r, 1500, 4000), q: 2, gain: 0.12 });
    return 1;
  },
  // ---------------------------------------------------------------- walka
  /** Zderzenie mieczy. */
  clash(c, out, t, r) {
    const f = between(r, 2200, 2800);
    modal(c, out, t, [[f, 0.4, 0.12], [f * 1.33, 0.3, 0.1], [f * 2.71, 0.2, 0.06]]);
    noise(c, out, t, { dur: 0.06, f: 5000, q: 1, gain: 0.3 });
    return 0.5;
  },
  /** Uderzenie w tarcze (drewno okute). */
  shield(c, out, t, r) {
    modal(c, out, t, woodModes(r, between(r, 140, 180)), 0.9);
    tone(c, out, t, { f: between(r, 600, 750), dur: 0.2, gain: 0.06 });
    return 0.25;
  },
  // ---------------------------------------------------------------- glosy: zwierzeta, ludzie
  // Glosy maja szeroka przestrzen parametrow (ziarno wybiera wysokosc, barwe, rytm, czasem rodzaj zawolania); gra
  // losuje tylko sposrod ziaren wybranych na odsluchu (PICKS), a bez wyboru - z calej przestrzeni.
  /** Chrzakniecie swini: niski, chrapliwy, nosowy ton, pojedynczo albo seria. */
  pig_grunt(c, out, t, r) {
    const n = 1 + Math.floor(r() * 4);
    const f = between(r, 70, 170), rough = between(r, 0.5, 0.95), nose = between(r, 350, 650);
    const len = between(r, 0.08, 0.3), gap = between(r, 0.04, 0.2), fall = between(r, 0.7, 1.05);
    let at = t;
    for (let i = 0; i < n; i++) {
      const dur = len * between(r, 0.8, 1.2);
      const fi = f * between(r, 0.9, 1.1);
      voice(c, out, at, {
        f0: [[0, fi * 1.1], [0.4, fi], [1, fi * fall]], dur, rough: [between(r, 20, 45), rough], breath: between(r, 0.1, 0.45),
        formants: [[nose, between(r, 3, 6), 1], [nose * between(r, 2.2, 2.8), 6, 0.55], [between(r, 2000, 2800), 8, 0.2]],
        gain: 0.55, a: between(r, 0.08, 0.25), r: between(r, 0.3, 0.5),
      });
      at += dur + gap * between(r, 0.7, 1.3);
    }
    return at - t;
  },
  /** Kwik swini: wysoki, ostry, z narastaniem i opadaniem wysokosci. */
  pig_squeal(c, out, t, r) {
    const dur = between(r, 0.3, 1.1);
    const f = between(r, 600, 1500);
    const peak = between(r, 0.15, 0.6), up = between(r, 1.0, 1.4), end = between(r, 0.55, 0.95);
    voice(c, out, t, {
      f0: [[0, f * 0.75], [peak, f * up], [1, f * end]], dur, rough: [between(r, 35, 90), between(r, 0.2, 0.7)], breath: between(r, 0.1, 0.45),
      formants: [[between(r, 1200, 2000), between(r, 3, 7), 1], [between(r, 2600, 3800), 7, 0.5], [between(r, 4500, 5500), 9, 0.15]],
      gain: 0.25, a: between(r, 0.05, 0.2), r: between(r, 0.2, 0.45),
    });
    return dur;
  },
  /** Ryk osla: naprzemiennie wdech ("i" - wysoki, chrapliwy) i wydech ("a" - nizszy, pelny), kilka razy, z opadaniem. */
  donkey_bray(c, out, t, r) {
    const n = 2 + Math.floor(r() * 4);
    const fh0 = between(r, 450, 1000), fl0 = between(r, 160, 380), hi0 = between(r, 0.12, 0.3), lo0 = between(r, 0.2, 0.45);
    const tire = between(r, 0.85, 1.0), hRough = between(r, 0.3, 0.8), aOpen = between(r, 550, 900);
    let at = t + between(r, 0, 0.1);
    for (let i = 0; i < n; i++) {
      const k = Math.pow(tire, i);
      const hi = hi0 * between(r, 0.85, 1.15), lo = lo0 * between(r, 0.85, 1.15);
      const fh = fh0 * k, fl = fl0 * k;
      voice(c, out, at, { f0: [[0, fh * 0.85], [0.6, fh], [1, fh * 0.95]], dur: hi, rough: [between(r, 35, 70), hRough], breath: between(r, 0.2, 0.5),
        formants: [[between(r, 900, 1400), 5, 1], [between(r, 2200, 3000), 7, 0.6]], gain: 0.28, a: 0.25, r: 0.2 });
      voice(c, out, at + hi, { f0: [[0, fl * 1.2], [0.3, fl], [1, fl * 0.8]], dur: lo, rough: [between(r, 20, 40), between(r, 0.2, 0.6)], breath: 0.15,
        formants: [[aOpen, 4, 1], [aOpen * between(r, 1.5, 1.9), 5, 0.7], [2500, 8, 0.25]], gain: 0.45, a: 0.08, r: 0.35 });
      at += hi + lo + between(r, 0, 0.06);
    }
    return at - t;
  },
  /** Stuk kopyt (osiol na drodze). */
  hoof(c, out, t, r) {
    modal(c, out, t, [[between(r, 450, 600), 0.04, 0.25], [between(r, 1300, 1600), 0.025, 0.12]]);
    noise(c, out, t, { dur: 0.03, f: 1500, q: 1, gain: 0.1 });
    return 0.06;
  },
  /** Jelen zaniepokojony: prychniecie (szum przez nozdrza) albo krotkie szczekniecie. */
  deer_snort(c, out, t, r) {
    const bark = r() < 0.5;
    const dur = between(r, 0.15, 0.4);
    noise(c, out, t, { dur, f: between(r, 600, 1400), q: between(r, 0.8, 2), gain: bark ? 0.15 : 0.35, a: 0.01 });
    const f = bark ? between(r, 300, 650) : between(r, 120, 220);
    voice(c, out, t, { f0: [[0, f], [0.3, f * 1.05], [1, f * between(r, 0.6, 0.9)]], dur: bark ? dur * 0.8 : 0.15, breath: bark ? 0.3 : 0.6,
      rough: [between(r, 20, 50), bark ? 0.5 : 0.2], formants: [[between(r, 600, 1000), 3, 1], [between(r, 1500, 2200), 5, 0.4]], gain: bark ? 0.4 : 0.15 });
    return dur + 0.05;
  },
  /** Ptak: swiergot (krotkie przesuwy), tryl (szybko powtarzana nuta), gwizd (wolna fraza) albo swiegot z modulacja. */
  bird(c, out, t, r) {
    const kind = Math.floor(r() * 4);
    const base = between(r, 2000, 5500);
    const note = (at: number, f1: number, f2: number, dur: number, gain: number, fm = 0) => {
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(f1, at);
      osc.frequency.exponentialRampToValueAtTime(f2, at + dur);
      if (fm) {
        const lfo = c.createOscillator();
        lfo.frequency.value = fm;
        const d = c.createGain();
        d.gain.value = f1 * 0.08;
        lfo.connect(d).connect(osc.frequency);
        lfo.start(at);
        lfo.stop(at + dur + 0.05);
      }
      const g = c.createGain();
      env(g.gain, at, Math.min(0.02, dur * 0.3), gain, dur);
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    };
    let at = t;
    if (kind === 0) {
      const n = 2 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const dur = between(r, 0.04, 0.14), up = r() < 0.5;
        note(at, base * (up ? 0.8 : 1.25), base * (up ? 1.3 : 0.75) * between(r, 0.9, 1.1), dur, 0.12);
        at += dur + between(r, 0.03, 0.12);
      }
    } else if (kind === 1) {
      const n = 6 + Math.floor(r() * 14), dur = between(r, 0.02, 0.05), gap = between(r, 0.01, 0.04), drift = between(r, 0.85, 1.15);
      for (let i = 0; i < n; i++) {
        const f = base * Math.pow(drift, i / n);
        note(at, f * 1.15, f * 0.85, dur, 0.1);
        at += dur + gap;
      }
    } else if (kind === 2) {
      const n = 2 + Math.floor(r() * 4);
      let f = base * between(r, 0.5, 0.8);
      for (let i = 0; i < n; i++) {
        const dur = between(r, 0.12, 0.35), f2 = f * between(r, 0.75, 1.35);
        note(at, f, f2, dur, 0.1);
        f = f2;
        at += dur + between(r, 0.02, 0.1);
      }
    } else {
      const dur = between(r, 0.3, 0.9);
      note(at, base, base * between(r, 0.8, 1.2), dur, 0.08, between(r, 12, 40));
      at += dur;
    }
    return at - t;
  },
  /** Swierszcz: seria krotkich impulsow 3,5-5,5 kHz. */
  cricket(c, out, t, r) {
    const f = between(r, 3500, 5500);
    const n = 2 + Math.floor(r() * 6), step = between(r, 0.02, 0.06), len = step * between(r, 0.4, 0.7);
    for (let i = 0; i < n; i++) tone(c, out, t + i * step, { f, dur: len, gain: 0.05, a: 0.003 });
    return n * step;
  },
  /** Okrzyk rycerza ("hej!", "ha!", "ho!"): przydech i samogloska z opadajaca wysokoscia. */
  shout(c, out, t, r) {
    const dur = between(r, 0.25, 0.6);
    const f = between(r, 120, 260);
    const [f1, f2, f3] = VOWELS[Math.floor(r() * VOWELS.length)];
    noise(c, out, t, { dur: 0.05, f: between(r, 1200, 2000), q: 0.8, gain: between(r, 0.05, 0.15), a: 0.01 });
    voice(c, out, t + 0.03, { f0: [[0, f * 1.15], [between(r, 0.15, 0.4), f * between(r, 1.15, 1.35)], [1, f * between(r, 0.7, 0.95)]], dur,
      breath: between(r, 0.05, 0.25), rough: [between(r, 15, 35), between(r, 0.05, 0.35)],
      formants: [[f1 * between(r, 0.9, 1.1), 6, 1], [f2 * between(r, 0.9, 1.1), 7, 0.6], [f3, 9, 0.3]], gain: 0.4, a: 0.08, r: between(r, 0.3, 0.5) });
    return dur + 0.03;
  },
  /** Krzyk padajacego rycerza: dluzsze, opadajace "aaa" albo stlumione jekniecie. */
  death(c, out, t, r) {
    const dur = between(r, 0.45, 1.2);
    const f = between(r, 140, 260);
    const [f1, f2, f3] = VOWELS[Math.floor(r() * VOWELS.length)];
    voice(c, out, t, { f0: [[0, f * between(r, 1.1, 1.4)], [between(r, 0.1, 0.3), f * 1.2], [1, f * between(r, 0.45, 0.7)]], dur,
      breath: between(r, 0.1, 0.35), rough: [between(r, 12, 30), between(r, 0.15, 0.5)],
      formants: [[f1, 6, 1], [f2, 7, 0.6], [f3, 9, 0.25]], gain: 0.35, a: between(r, 0.03, 0.1), r: between(r, 0.4, 0.6) });
    return dur;
  },
};

/** Petla: ciagly dzwiek (ogien, woda, skrzypienie, otoczenie) od chwili t do stop(t). */
export interface Loop { stop(t: number): void }
export type LoopGen = (c: Ctx, out: AudioNode, t: number, r: Rng) => Loop;

function noiseLoop(c: Ctx, out: AudioNode, t: number, f: number, q: number, type: BiquadFilterType, gain: number, lfoHz = 0, lfoDepth = 0): Loop {
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(flt).connect(g).connect(out);
  src.start(t, Math.random());
  let lfo: OscillatorNode | null = null;
  if (lfoHz) {
    lfo = c.createOscillator();
    lfo.frequency.value = lfoHz;
    const d = c.createGain();
    d.gain.value = lfoDepth;
    lfo.connect(d).connect(flt.frequency);
    lfo.start(t);
  }
  return { stop: (s) => { src.stop(s); lfo?.stop(s); } };
}

export const LOOPS: Record<string, LoopGen> = {
  /** Wiatr: niski szum z wolno falujacym filtrem. */
  wind: (c, out, t) => noiseLoop(c, out, t, 400, 0.7, 'lowpass', 0.5, 0.07, 180),
  /** Szum lisci w lesie: wyzszy, miekki szum z falowaniem. */
  leaves: (c, out, t) => noiseLoop(c, out, t, 2500, 0.4, 'bandpass', 0.35, 0.15, 900),
  /** Fale morza: niski szum z rytmem przyboju (ok. 7 s). */
  sea: (c, out, t) => noiseLoop(c, out, t, 600, 0.5, 'lowpass', 0.6, 0.14, 450),
  /** Jezioro: ciche chlupotanie przy brzegu. */
  lake: (c, out, t) => noiseLoop(c, out, t, 900, 1.5, 'bandpass', 0.25, 0.4, 300),
  /** Ogien (piec, kuznia, mielerz, pozar): huk w dole pasma. */
  fire: (c, out, t) => noiseLoop(c, out, t, 300, 0.8, 'lowpass', 0.6, 3, 120),
  /** Lanie wody (wiadro do beczki, konewka). */
  pour: (c, out, t) => noiseLoop(c, out, t, 1600, 1.2, 'bandpass', 0.35, 9, 500),
  /** Bulgotanie kadzi piwowara. */
  bubbles: (c, out, t) => noiseLoop(c, out, t, 500, 6, 'bandpass', 0.6, 4, 250),
  /** Urobek zsypywany z wozka: chrzest toczacych sie kamieni. */
  rubble: (c, out, t) => noiseLoop(c, out, t, 900, 0.8, 'bandpass', 0.5, 14, 600),
  /** Gwar osady z daleka: niewyrazny szum srednich czestotliwosci. */
  murmur: (c, out, t) => noiseLoop(c, out, t, 700, 1.2, 'bandpass', 0.3, 0.3, 150),
};
