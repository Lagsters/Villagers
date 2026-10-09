/**
 * Odsluch wariantow dzwiekow z client/sfx.ts bez sluchania: kazdy dzwiek renderowany offline (OfflineAudioContext
 * w przegladarce bez okna) dla wielu ziaren, z cech nagrania (dlugosc, wysokosc tonu, udzial dzwiecznosci, srodek
 * ciezkosci widma) liczona jest odleglosc od wzorca prawdziwego odglosu (TARGETS), a z najlepszych wybierane sa
 * warianty mozliwie rozne od siebie. Wybrane trafiaja do plikow mp3 (do odsluchu przez czlowieka) i spektrogramow png.
 * Ziarna zatwierdzone na odsluchu wpisuje sie do PICKS w client/sfx.ts - gra losuje tylko sposrod nich.
 *
 *   node scripts/sounds.ts --out <katalog> [--names pig_grunt,bird] [--n 100] [--top 6] [--url http://localhost:5173/]
 *
 * Bez --names: glosy (zwierzeta, ptaki, okrzyki) po --n ziaren, dzwieki pracy po 3 ziarna bez rankingu, petle po 4 s.
 * Ziarna juz zatwierdzone (PICKS) sa zawsze dolaczane, obok nowych wariantow.
 * Wynik: <out>/<nazwa>_<ziarno>.mp3, .png oraz <out>/sounds.json (cechy, wynik, wybor); strone odsluchu sklada
 * scripts/sounds-page.py. Serwer gry musi dzialac (npm run dev), potrzebny ffmpeg w PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
function opt(name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const out = opt('out');
if (!out) {
  console.error('Brak --out <katalog>');
  process.exit(1);
}
const N = Number(opt('n', '100'));
const TOP = Number(opt('top', '6'));
const URL = opt('url', 'http://localhost:5173/')!;
const RATE = 44100;

/** Cechy nagrania (liczone w przegladarce). */
interface Feat { dur: number; peak: number; rms: number; cent: number; f0: number; f0a: number; f0b: number; f0ratio: number; voiced: number }
type Range = [number, number];
/** Wzorzec prawdziwego odglosu: zakresy cech (czestotliwosci w Hz, czasy w s, voiced - udzial dzwiecznych ramek). */
interface Target { dur?: Range; f0?: Range; cent?: Range; voiced?: Range; f0ratio?: Range; fall?: Range }

const TARGETS: Record<string, Target> = {
  pig_grunt: { dur: [0.15, 0.8], f0: [70, 200], cent: [300, 1400], voiced: [0.3, 1] },
  pig_squeal: { dur: [0.35, 1.2], f0: [500, 1600], cent: [1000, 3500], voiced: [0.4, 1] },
  donkey_bray: { dur: [1.0, 3.0], f0ratio: [2, 5], cent: [500, 2000], voiced: [0.4, 1] },
  deer_snort: { dur: [0.15, 0.5], cent: [600, 2500] },
  bird: { dur: [0.2, 2], f0: [1800, 7000], cent: [1800, 7000], voiced: [0.5, 1] },
  cricket: { dur: [0.1, 0.5], cent: [3500, 6000] },
  shout: { dur: [0.25, 0.7], f0: [110, 300], cent: [500, 1800], voiced: [0.5, 1] },
  death: { dur: [0.4, 1.3], f0: [90, 300], fall: [1.3, 3], cent: [400, 1800], voiced: [0.5, 1] },
};

/** Odleglosc od zakresu w skali logarytmicznej (0 w srodku zakresu). */
function off(x: number, [lo, hi]: Range): number {
  if (!(x > 0)) return 3;
  return x < lo ? Math.log2(lo / x) : x > hi ? Math.log2(x / hi) : 0;
}

function score(f: Feat, t: Target): number {
  let s = 0;
  if (t.dur) s += off(f.dur, t.dur);
  if (t.f0) s += off(f.f0, t.f0);
  if (t.cent) s += off(f.cent, t.cent);
  if (t.voiced) s += f.voiced < t.voiced[0] ? (t.voiced[0] - f.voiced) * 3 : 0;
  if (t.f0ratio) s += off(f.f0ratio, t.f0ratio);
  if (t.fall) s += off(f.f0a / Math.max(1, f.f0b), t.fall);
  if (f.peak > 0.99) s += 1;
  return s;
}

/** Polozenie w przestrzeni cech (log), do wyboru wariantow roznych od siebie. */
function vec(f: Feat): number[] {
  return [Math.log2(f.dur + 0.01) * 1.5, Math.log2(f.f0 + 1), Math.log2(f.cent + 1), f.voiced * 2, Math.log2(f.f0ratio + 1)];
}

/**
 * Najlepsze warianty: z czolowki wynikow (do +0,4 od najlepszego, najmniej 3 * TOP) kolejno ten, ktorego odleglosc
 * od juz wybranych pomniejszona o wynik jest najwieksza - rozne od siebie, ale wciaz bliskie wzorcowi.
 */
function pick(cands: { seed: number; f: Feat; s: number }[], k: number): number[] {
  const sorted = [...cands].sort((a, b) => a.s - b.s);
  const pool = sorted.filter((c, i) => c.s <= sorted[0].s + 0.4 || i < 3 * k);
  const chosen = [pool[0]];
  while (chosen.length < Math.min(k, pool.length)) {
    let best = pool[0], bestD = -1;
    for (const c of pool) {
      if (chosen.includes(c)) continue;
      const v = vec(c.f);
      const d = Math.min(...chosen.map((x) => Math.hypot(...vec(x.f).map((a, i) => a - v[i]))));
      if (d - c.s > bestD) { bestD = d - c.s; best = c; }
    }
    chosen.push(best);
  }
  return chosen.map((c) => c.seed);
}

/** Kod w przegladarce: render dzwieku i cechy. */
const PAGE = `
window.__mod = () => import('/client/sfx.ts');
window.__fft = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
};
window.__render = async (mod, name, seed, loopSec) => {
  const R = ${RATE};
  const len = loopSec ? loopSec : 4;
  const c = new OfflineAudioContext(1, Math.ceil(R * len), R);
  let dur;
  if (loopSec) {
    const l = mod.LOOPS[name](c, c.destination, 0, mod.rng(seed));
    l.stop(loopSec);
    dur = loopSec;
  } else dur = mod.SFX[name](c, c.destination, 0.02, mod.rng(seed));
  const buf = await c.startRendering();
  const end = Math.min(buf.length, Math.ceil(R * (dur + 0.35)));
  return buf.getChannelData(0).slice(0, end);
};
window.__features = (d) => {
  const R = ${RATE}, W = Math.round(R * 0.01);
  const env = [];
  for (let i = 0; i + W <= d.length; i += W) { let s = 0; for (let k = 0; k < W; k++) s += d[i + k] * d[i + k]; env.push(Math.sqrt(s / W)); }
  const mx = Math.max(...env, 1e-9);
  let a = env.findIndex((e) => e > mx * 0.05), b = env.length - 1;
  while (b > 0 && env[b] <= mx * 0.05) b--;
  if (a < 0) a = 0;
  let peak = 0, sum = 0;
  for (const x of d) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  const F = 2048, hop = 1024;
  let cw = 0, cs = 0;
  const f0s = [];
  let frames = 0;
  for (let i = a * W; i + F <= Math.min(d.length, (b + 1) * W + F); i += hop) {
    const re = new Float64Array(F * 2), im = new Float64Array(F * 2);
    let e = 0;
    for (let k = 0; k < F; k++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / F); re[k] = d[i + k] * w; e += re[k] * re[k]; }
    if (e < 1e-8) continue;
    frames++;
    window.__fft(re, im);
    let num = 0, den = 0;
    for (let k = 0; k <= F; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (k > 0 && k < F) { num += p * k * R / (F * 2); den += p; }
      re[k] = p; im[k] = 0;
    }
    for (let k = F + 1; k < F * 2; k++) { re[k] = re[F * 2 - k]; im[k] = 0; }
    cw += num; cs += den;
    window.__fft(re, im);
    const r0 = re[0];
    let best = 0, lag = 0;
    for (let L = Math.floor(R / 8000); L <= Math.ceil(R / 60) && L < F; L++) {
      const v = re[L] / r0 / (1 - L / F);
      if (v > best && re[L] >= re[L - 1] && re[L] >= re[L + 1]) { best = v; lag = L; }
    }
    if (best > 0.5 && lag > 0) f0s.push(R / lag);
  }
  const sorted = [...f0s].sort((x, y) => x - y);
  const f0 = sorted.length ? sorted[sorted.length >> 1] : 0;
  const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
  return {
    dur: (b - a + 1) * 0.01, peak, rms: Math.sqrt(sum / d.length), cent: cs ? cw / cs : 0, f0,
    f0a: f0s.length ? f0s.slice(0, 2).reduce((s, x) => s + x, 0) / Math.min(2, f0s.length) : 0,
    f0b: f0s.length ? f0s.slice(-2).reduce((s, x) => s + x, 0) / Math.min(2, f0s.length) : 0,
    f0ratio: sorted.length ? q(0.95) / Math.max(1, q(0.05)) : 0, voiced: frames ? f0s.length / frames : 0,
  };
};
`;

function wav(samples: number[]): Buffer {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(new globalThis.URL('/README.md', URL).href);
await page.addScriptTag({ content: PAGE });
const names: { sfx: string[]; loops: string[]; kept: Record<string, number[]> } = await page.evaluate(async () => {
  const m = await (window as unknown as { __mod: () => Promise<Record<string, Record<string, unknown>>> }).__mod();
  return { sfx: Object.keys(m.SFX), loops: Object.keys(m.LOOPS), kept: m.PICKS as Record<string, number[]> };
});
const only = opt('names')?.split(',');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** picks - warianty do odsluchu; kept - ziarna juz zatwierdzone (PICKS), zawsze wsrod picks, do porownania z nowymi. */
interface Entry { name: string; loop: boolean; picks: number[]; kept: number[]; feats: Record<number, Feat & { s: number }> }
const result: Entry[] = [];

async function save(name: string, seed: number, loopSec = 0): Promise<void> {
  const data: number[] = await page.evaluate(async ([n, s, l]) => {
    const m = await (window as unknown as { __mod: () => Promise<Record<string, Record<string, unknown>>> }).__mod();
    return Array.from(await (window as unknown as { __render: (...a: unknown[]) => Promise<Float32Array> }).__render(m, n, s, l));
  }, [name, seed, loopSec] as const);
  const base = join(out!, `${name}_${seed}`);
  writeFileSync(`${base}.wav`, wav(data));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${base}.wav`, '-b:a', '64k', `${base}.mp3`]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${base}.wav`, '-lavfi', 'showspectrumpic=s=480x160:legend=0:fscale=log:color=intensity', `${base}.png`]);
  rmSync(`${base}.wav`);
}

for (const name of names.sfx) {
  if (only && !only.includes(name)) continue;
  const target = TARGETS[name];
  const count = target ? N : 3;
  const kept = names.kept[name] ?? [];
  const feats: Entry['feats'] = {};
  const cands: { seed: number; f: Feat; s: number }[] = [];
  const seeds = [...new Set([...kept, ...Array.from({ length: count }, (_, i) => i + 1)])];
  for (const seed of seeds) {
    const f: Feat = await page.evaluate(async ([n, s]) => {
      const m = await (window as unknown as { __mod: () => Promise<Record<string, Record<string, unknown>>> }).__mod();
      const w = window as unknown as { __render: (...a: unknown[]) => Promise<Float32Array>; __features: (d: Float32Array) => unknown };
      return w.__features(await w.__render(m, n, s, 0));
    }, [name, seed] as const) as Feat;
    const s = target ? score(f, target) : 0;
    feats[seed] = { ...f, s: Math.round(s * 100) / 100 };
    cands.push({ seed, f, s });
  }
  const fresh = cands.filter((c) => !kept.includes(c.seed));
  const picks = [...kept, ...(target ? pick(fresh, TOP) : fresh.slice(0, 3).map((c) => c.seed))];
  for (const seed of picks) await save(name, seed);
  result.push({ name, loop: false, picks, kept, feats });
  console.log(`${name}: ${picks.join(', ')}${target ? ` (wynik ${picks.map((p) => feats[p].s).join(', ')})` : ''}`);
}
for (const name of names.loops) {
  if (only && !only.includes(name)) continue;
  await save(name, 1, 4);
  result.push({ name, loop: true, picks: [1], kept: [], feats: {} });
  console.log(`${name}: petla 4 s`);
}
writeFileSync(join(out, 'sounds.json'), JSON.stringify(result, null, 1));
await browser.close();
