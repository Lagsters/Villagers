/**
 * Czasteczki bez stanu: dym, iskry, wiory, pyl, para, krople. Polozenie kazdej czasteczki liczone jest
 * z czasu animacji i ziarna (hash), wiec nic nie trzeba pamietac ani sprzatac - scena co klatke wola
 * stream() (ciagly wyplyw) albo burst() (jednorazowy wyrzut w chwili zdarzenia, z wiekiem liczonym przez scene).
 * Dwa modele: fx_puff (kula - dym, para, pyl, krople) i fx_bit (szescian - wiory, iskry, odpryski, ziarno).
 * Kolor nadaje instancja (modele sa biale).
 */
import * as THREE from 'three';
import { InstancedLayer } from './instanced.ts';

export interface FxOptions {
  /** 'puff' (kula) albo 'bit' (szescian) */
  kind?: 'puff' | 'bit';
  /** liczba czasteczek w powietrzu naraz (stream) albo w wyrzucie (burst) */
  n?: number;
  /** czas zycia czasteczki (s) */
  life?: number;
  /** predkosc poczatkowa (swiat/s) */
  vx?: number;
  vy?: number;
  vz?: number;
  /** losowy rozrzut predkosci (swiat/s) w kazdej osi; spreadY osobno dla pionu */
  spread?: number;
  spreadY?: number;
  /** przyspieszenie w dol (swiat/s^2); ujemne - unoszenie */
  gravity?: number;
  /** wielkosc na poczatku i na koncu zycia (srednica, swiat) */
  size?: number;
  sizeEnd?: number;
  /** kolor (hex) na poczatku i na koncu zycia */
  color?: number;
  colorEnd?: number;
  /** rozrzut punktu startu (swiat) */
  jitter?: number;
  /** czasteczki nie schodza ponizej tej wysokosci (np. wiory zostaja chwile na ziemi) */
  floor?: number;
  /** lagodne kolysanie na boki (dym): amplituda (swiat) */
  sway?: number;
  /** czesc zycia na koncu, w ktorej czasteczka maleje do zera (dym nie znika nagle) */
  fade?: number;
}

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b + 0x3c6ef372, 0x85ebca6b) ^ Math.imul(c + 0x6a09e667, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const cA = new THREE.Color();
const cB = new THREE.Color();

export class Fx {
  time = 0;
  readonly puff: InstancedLayer;
  readonly bit: InstancedLayer;

  constructor(layer: (name: string, cap: number, color?: boolean) => InstancedLayer) {
    this.puff = layer('fx_puff', 256, true);
    this.bit = layer('fx_bit', 256, true);
  }

  layers(): InstancedLayer[] {
    return [this.puff, this.bit];
  }

  /**
   * Ciagly wyplyw: n czasteczek, kazda zyje `life` sekund i odradza sie z nowym losowym rozrzutem.
   * key rozroznia zrodla (np. id budynku * 10 + numer komina), zeby nie migotaly jednakowo.
   * rate (0..1) przerzedza wyplyw (losowo pomija czasteczki); 0 gasi wyplyw od razu, razem z czasteczkami w powietrzu.
   */
  stream(key: number, x: number, y: number, z: number, o: FxOptions, rate = 1): void {
    const n = o.n ?? 6;
    const life = o.life ?? 2;
    for (let k = 0; k < n; k++) {
      const phase = this.time / life + k / n + hash(key, k, 7);
      const cycle = Math.floor(phase);
      if (rate < 1 && hash(key, k, cycle) >= rate) continue;
      this.particle(key * 131 + k, cycle, (phase - cycle) * life, x, y, z, o);
    }
  }

  /** Jednorazowy wyrzut n czasteczek; age = sekundy od wyrzutu (po czasie zycia nic nie rysuje). */
  burst(key: number, age: number, x: number, y: number, z: number, o: FxOptions): void {
    const life = o.life ?? 0.6;
    if (age < 0 || age > life) return;
    const n = o.n ?? 6;
    for (let k = 0; k < n; k++) this.particle(key * 131 + k, -1, age, x, y, z, o);
  }

  private particle(seed: number, cycle: number, age: number, x: number, y: number, z: number, o: FxOptions): void {
    const life = o.life ?? 1;
    const f = Math.min(1, age / life);
    const sp = o.spread ?? 0;
    const spy = o.spreadY ?? sp;
    const r1 = hash(seed, cycle, 1) * 2 - 1, r2 = hash(seed, cycle, 2) * 2 - 1, r3 = hash(seed, cycle, 3);
    const j = o.jitter ?? 0;
    const vx = (o.vx ?? 0) + r1 * sp, vz = (o.vz ?? 0) + r2 * sp, vy = (o.vy ?? 0) + (r3 * 2 - 1) * spy;
    const g = o.gravity ?? 0;
    let px = x + (hash(seed, cycle, 4) * 2 - 1) * j + vx * age;
    let pz = z + (hash(seed, cycle, 5) * 2 - 1) * j + vz * age;
    let py = y + vy * age - 0.5 * g * age * age;
    if (o.sway) {
      const w = Math.sin(age * 2.3 + seed) * o.sway * f;
      px += w;
      pz += w * 0.6;
    }
    if (o.floor !== undefined && py < o.floor) py = o.floor;
    const s0 = o.size ?? 0.05;
    const s1 = o.sizeEnd ?? s0;
    let size = s0 + (s1 - s0) * f;
    if (o.fade && f > 1 - o.fade) size *= (1 - f) / o.fade;
    if (size <= 0.001) return;
    const layer = o.kind === 'bit' ? this.bit : this.puff;
    const i = layer.push(px, py, pz, hash(seed, cycle, 6) * 6.283 + age * 3, size);
    cA.setHex(o.color ?? 0xffffff);
    if (o.colorEnd !== undefined) cA.lerp(cB.setHex(o.colorEnd), f);
    layer.color(i, cA.r, cA.g, cA.b);
  }

  /** Dym z komina: szare kleby rosnace i znoszone lekko z wiatrem; strength 0..1 (gestosc). */
  smoke(key: number, x: number, y: number, z: number, strength = 1, color = 0x8a8682): void {
    if (strength <= 0) return;
    this.stream(key, x, y, z, {
      kind: 'puff', n: 7, life: 3.2, vx: 0.05, vy: 0.16, vz: -0.03, spread: 0.02, spreadY: 0.02, gravity: -0.01,
      size: 0.05, sizeEnd: 0.17, color, colorEnd: 0xc8c6c2, jitter: 0.01, sway: 0.03, fade: 0.25,
    }, strength);
  }
}
