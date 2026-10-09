/**
 * Teren jako chunki 32x32 pol: wspolne wierzcholki, gladkie normalne liczone z mapy wysokosci (bez szwow
 * miedzy chunkami). Kazdy wierzcholek niesie wagi rodzajow terenu (trawa, piasek, skala, snieg; reszta to woda),
 * a shader rozstrzyga w kazdym pikselu, ktory rodzaj wygrywa - z szumem, wiec granice sa poszarpane jak malowane,
 * a nie rozmyte na cale pole. Kazdy rodzaj ma wlasna fakture z jednej generowanej w kodzie tekstury (kanaly:
 * trawa, skala, piasek i fale, szum granic); skala na urwiskach jest mapowana pionowo (bez rozciagniec),
 * przy brzegu woda jasnieje i bieleje piana. three.js sam odrzuca chunki poza kadrem (frustum culling po boundingSphere).
 */
import * as THREE from 'three';
import { T } from '../../sim/defs.ts';
import { stepXY, DIR_E, DIR_SE, DIR_SW } from '../../sim/grid.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { H_SCALE, ROW_H, vx, vz } from './coords.ts';
import { DEEP_WATER, EARTH, GRASS_DARK, GRASS_LIGHT, ROCK_DARK, ROCK_LIGHT, SAND, SHALLOW_WATER, SNOW, WATER } from './palette.ts';

export const CHUNK = 32;
/** Rozmiar tekstury faktur (piksele, kafel powtarzalny). */
const TEX = 256;
/** Udzial piasku na polu ladu przy wodzie (reszta jego rodzaju) - plaza wezsza niz pole. */
const BEACH = 0.6;

function hash(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Szum wartosci o niskiej czestotliwosci (laty ciemniejszej i jasniejszej trawy). */
function patch(x: number, y: number): number {
  const S = 6;
  const gx = Math.floor(x / S), gy = Math.floor(y / S);
  const fx = x / S - gx, fy = y / S - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash(a * 7919 + b * 104729, 3);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx;
  const bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/** Szum wartosci powtarzalny co `period` komorek (kafel tekstury bez szwow), wynik 0..1. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const cell = TEX / period;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash(((a % period) + period) % period + (((b % period) + period) % period) * 977, seed);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx;
  const bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/**
 * Komorki Worleya powtarzalne co `n` komorek na kafel: odleglosci do najblizszego i drugiego punktu (piksele).
 * Z nich wysokosc skaly: zaokraglone glazy (blisko punktu wyzej) i szczeliny na granicach komorek.
 */
function worley(x: number, y: number, n: number, seed: number): [number, number] {
  const cell = TEX / n;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let f1 = 1e9, f2 = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx, cy = gy + dy;
      const id = ((cx % n) + n) % n + (((cy % n) + n) % n) * 131;
      const px = (cx + 0.15 + 0.7 * hash(id, seed)) * cell, py = (cy + 0.15 + 0.7 * hash(id, seed + 1)) * cell;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  return [f1 / cell, f2 / cell];
}

/**
 * Tekstura faktur (powtarzalna, odcienie szarosci w kanalach): R - trawa (kepki, zdzbla, ziarno), G - wysokosc
 * skaly (glazy i szczeliny; shader liczy z niej swiatlo od slonca), B - piasek (zmarszczki i ziarno; na wodzie fale),
 * A - szum granic miedzy rodzajami terenu.
 */
function detailTexture(): THREE.Texture {
  const data = new Uint8Array(TEX * TEX * 4);
  const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const grain = hash(i, 11);
      // Trawa: miekkie kepy, krotkie pionowe zdzbla (jasne i ciemne kreski), ziarno.
      const clumps = tileNoise(x, y, 16, 1) * 0.6 + tileNoise(x, y, 32, 2) * 0.4;
      const blade = hash((x >> 1) + (y >> 2) * 128, 5);
      const g = 0.5 + (clumps - 0.5) * 0.55 + (grain - 0.5) * 0.18 + (blade > 0.86 ? 0.14 : blade < 0.1 ? -0.16 : 0);
      // Skala: duze glazy z mniejszymi miedzy nimi, szczeliny na granicach, ziarno.
      const [a1, a2] = worley(x, y, 7, 3);
      const [b1, b2] = worley(x, y, 17, 5);
      const dome = (f1: number, f2: number) => {
        const t = Math.min(1, f1 / 0.75);
        return (1 - t * t) * 0.75 + Math.min(1, (f2 - f1) * 6) * 0.25;
      };
      const r = dome(a1, a2) * 0.62 + dome(b1, b2) * 0.26 + (grain - 0.5) * 0.06 + 0.06;
      // Piasek: zmarszczki od wiatru (falista linia) i drobne ziarno.
      const ripple = Math.sin((x / TEX) * Math.PI * 2 * 18 + tileNoise(x, y, 8, 6) * 6 + (y / TEX) * Math.PI * 2 * 3);
      const s = 0.55 + ripple * 0.07 + (grain - 0.5) * 0.22;
      // Granice: szum o srednich i niskich czestotliwosciach.
      const edge = tileNoise(x, y, 4, 7) * 0.5 + tileNoise(x, y, 8, 8) * 0.3 + tileNoise(x, y, 16, 9) * 0.2;
      data[i * 4] = b(g);
      data[i * 4 + 1] = b(r);
      data[i * 4 + 2] = b(s);
      data[i * 4 + 3] = b(edge);
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const glslColor = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

/**
 * Kolor terenu w pikselu: wagi rodzajow (vKind - trawa, piasek, skala, snieg; woda = reszta) przesuniete szumem
 * granic (kazdy rodzaj w inna strone), wygrywa najwyzsza z waskim, miekkim przejsciem. Snieg zsuwa sie ze stromizn
 * na skale, na stromej lace przeswituje ziemia. Faktury: drobna (co 3 pola) i pionowa na urwiskach (skala).
 */
const TERRAIN_FRAGMENT = /* glsl */ `
vec4 dt = texture2D(detailMap, vWorld.xz / 3.0);
float edge = (texture2D(detailMap, vWorld.xz / 7.0 + 0.37).a - 0.5) * 1.4 + (texture2D(detailMap, vWorld.xz / 2.1 + 0.71).a - 0.5) * 0.7;
float steep = 1.0 - clamp(normalize(vWN).y, 0.0, 1.0);
float cliff = smoothstep(0.3, 0.6, steep);
// Skala: wysokosc z tekstury (na urwiskach mapowana pionowo) i jej spadek ku sloncu - glazy oswietlone z jednej strony.
vec3 wn = normalize(vWN);
vec2 rp = mix(vWorld.xz, vec2(abs(wn.x) > abs(wn.z) ? vWorld.z : vWorld.x, -vWorld.y * 1.5), cliff) / 3.2;
float rockD = texture2D(detailMap, rp).g;
float rockLit = (rockD - texture2D(detailMap, rp + vec2(-0.012, 0.008)).g) * 4.0;
vec4 w = vKind;
float water = clamp(1.0 - w.x - w.y - w.z - w.w, 0.0, 1.0);
float slide = smoothstep(0.35, 0.6, steep);
w.z += w.w * slide;
w.w *= 1.0 - slide;
vec4 sc = w + vec4(edge, -edge * 0.8, edge * 0.7, -edge) * 0.36;
float sw = water - edge * 0.55;
float top = max(max(max(sc.x, sc.y), max(sc.z, sc.w)), sw);
vec4 k = smoothstep(top - 0.1, top, sc);
float kw = smoothstep(top - 0.1, top, sw);
float tot = k.x + k.y + k.z + k.w + kw;
k /= tot;
kw /= tot;
vec3 grass = vColor.rgb * (0.8 + 0.4 * dt.r);
grass = mix(grass, ${glslColor(EARTH)} * (0.75 + 0.5 * rockD), smoothstep(0.42, 0.7, steep) * 0.85);
vec3 sand = ${glslColor(SAND)} * (0.82 + 0.34 * dt.b) * (1.0 - 0.22 * smoothstep(0.15, 0.5, water));
vec3 rock = mix(${glslColor(ROCK_DARK)}, ${glslColor(ROCK_LIGHT)}, clamp(0.05 + rockD * 0.65 + rockLit + edge * 0.2, 0.0, 1.0));
vec3 snow = ${glslColor(SNOW)} * (0.92 + 0.08 * dt.r + rockLit * 0.12) * mix(vec3(1.0), vec3(0.86, 0.91, 1.0), clamp(steep + 0.4 - edge * 0.5, 0.0, 1.0));
float waves = texture2D(detailMap, vec2(vWorld.x * 0.9 + vWorld.z * 0.4, vWorld.z * 0.8 - vWorld.x * 0.3) / 4.0).b;
vec3 sea = vWcol * (0.93 + 0.14 * waves);
sea = mix(sea, vec3(0.9, 0.95, 0.95), (1.0 - smoothstep(0.0, 0.06, abs(kw - 0.5) - 0.32)) * 0.45 * smoothstep(0.02, 0.2, 1.0 - water));
diffuseColor.rgb = grass * k.x + sand * k.y + rock * k.z + snow * k.w + sea * kw;
`;

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private material: THREE.MeshLambertMaterial;
  private detail: THREE.Texture;
  readonly cw: number;
  readonly ch: number;

  private map: MapData;

  constructor(map: MapData) {
    this.map = map;
    this.detail = detailTexture();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const detailMap = { value: this.detail };
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = detailMap;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 kind;\nattribute vec3 wcol;\nvarying vec4 vKind;\nvarying vec3 vWcol;\nvarying vec3 vWorld;\nvarying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = kind;\nvWcol = wcol;\nvWorld = position;\nvWN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec4 vKind;\nvarying vec3 vWcol;\nvarying vec3 vWorld;\nvarying vec3 vWN;')
        .replace('#include <color_fragment>', TERRAIN_FRAGMENT);
    };
    this.cw = Math.ceil((map.w - 1) / CHUNK);
    this.ch = Math.ceil((map.h - 1) / CHUNK);
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const mesh = new THREE.Mesh(this.buildGeometry(cx, cy), this.material);
        mesh.matrixAutoUpdate = false;
        mesh.userData.chunk = cy * this.cw + cx;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Oznacz chunk(i) zawierajacy pole do przebudowy (np. po wyrownaniu terenu). */
  markDirty(idx: number): void {
    const x = idx % this.map.w;
    const y = (idx / this.map.w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = Math.floor((x + dx) / CHUNK);
        const cy = Math.floor((y + dy) / CHUNK);
        if (cx >= 0 && cy >= 0 && cx < this.cw && cy < this.ch) this.dirty.add(cy * this.cw + cx);
      }
    }
  }

  /** Przebudowa wszystkich chunkow (np. po przewinieciu gry z wyrownywaniem terenu). */
  markAllDirty(): void {
    for (let c = 0; c < this.chunks.length; c++) this.dirty.add(c);
  }

  update(): void {
    if (this.dirty.size === 0) return;
    for (const c of this.dirty) {
      const mesh = this.chunks[c];
      mesh.geometry.dispose();
      mesh.geometry = this.buildGeometry(c % this.cw, Math.floor(c / this.cw));
    }
    this.dirty.clear();
  }

  private at(x: number, y: number): number {
    const m = this.map;
    x = Math.max(0, Math.min(m.w - 1, x));
    y = Math.max(0, Math.min(m.h - 1, y));
    return y * m.w + x;
  }

  /** Czy pole ladu sasiaduje z woda (brzeg - plaza). */
  private isShore(x: number, y: number): boolean {
    const m = this.map;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (m.terrain[this.at(x + dx, y + dy)] === T.WATER) return true;
    }
    return false;
  }

  /**
   * Wierzcholek (pole): kolor trawy z latami (rgb - takze pod innymi rodzajami, do przejsc), wagi rodzajow
   * (kind: trawa, piasek, skala, snieg) i kolor wody (glebia, ku brzegowi mapy kolor tla).
   */
  private node(x: number, y: number, col: Float32Array, kind: Float32Array, wcol: Float32Array, k: number): void {
    const m = this.map;
    const i = y * m.w + x;
    const t = m.terrain[i];
    const p = patch(x, y);
    const g = Math.min(1, Math.max(0, p * 1.4 - 0.2 + (m.height[i] - 8) * 0.03));
    const j = 1 + (hash(i, 7) - 0.5) * 0.08;
    for (let c = 0; c < 3; c++) col[k * 3 + c] = (GRASS_DARK[c] + (GRASS_LIGHT[c] - GRASS_DARK[c]) * g) * j;
    kind.fill(0, k * 4, k * 4 + 4);
    if (t !== T.WATER) {
      const own = t === T.DESERT ? 1 : t === T.MOUNTAIN ? 2 : t === T.SNOW ? 3 : 0;
      if (own === 0 && this.isShore(x, y)) {
        kind[k * 4] = 1 - BEACH;
        kind[k * 4 + 1] = BEACH;
      } else kind[k * 4 + own] = 1;
    }
    // Woda: przy brzegu jasniejsza plycizna, dalej otwarta woda, ku brzegowi mapy glebia w kolorze tla.
    const shallow = t === T.WATER ? this.waterDepth(x, y) : 0;
    const d = Math.min(x, y, m.w - 1 - x, m.h - 1 - y);
    const e = Math.min(1, d / 8);
    const edge = e * e * (3 - 2 * e);
    for (let c = 0; c < 3; c++) {
      const open = SHALLOW_WATER[c] + (WATER[c] - SHALLOW_WATER[c]) * shallow;
      wcol[k * 3 + c] = DEEP_WATER[c] + (open - DEEP_WATER[c]) * edge;
    }
  }

  /** Odleglosc pola wody od ladu 0..1 (0 - przy brzegu, 0.5 - dwa pola od ladu, 1 - dalej). */
  private waterDepth(x: number, y: number): number {
    const m = this.map;
    let near = 3;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (m.terrain[this.at(x + dx, y + dy)] !== T.WATER) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
    return (near - 1) / 2;
  }

  private buildGeometry(cx: number, cy: number): THREE.BufferGeometry {
    const m = this.map;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(m.w - 1, x0 + CHUNK), y1 = Math.min(m.h - 1, y0 + CHUNK);
    // Wierzcholki: pola od x0-1 do x1 (trojkat SW siega kolumny w lewo), wiersze y0..y1.
    const vxMin = Math.max(0, x0 - 1);
    const cols = x1 - vxMin + 1;
    const rows = y1 - y0 + 1;
    const n = cols * rows;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const kind = new Float32Array(n * 4);
    const wcol = new Float32Array(n * 3);
    for (let y = y0; y <= y1; y++) {
      for (let x = vxMin; x <= x1; x++) {
        const k = (y - y0) * cols + (x - vxMin);
        const i = y * m.w + x;
        const wx = vx(x, y), wz = vz(y);
        pos[k * 3] = wx; pos[k * 3 + 1] = m.height[i] * H_SCALE; pos[k * 3 + 2] = wz;
        // Normalna z roznic centralnych mapy wysokosci (identyczna po obu stronach granicy chunku).
        const hl = m.height[this.at(x - 1, y)], hr = m.height[this.at(x + 1, y)];
        const hu = m.height[this.at(x, y - 1)], hd = m.height[this.at(x, y + 1)];
        const nx = -(hr - hl) * H_SCALE / 2;
        const nz = -(hd - hu) * H_SCALE / (2 * ROW_H);
        const len = Math.hypot(nx, 1, nz);
        nor[k * 3] = nx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = nz / len;
        this.node(x, y, col, kind, wcol, k);
      }
    }
    const idx: number[] = [];
    const vi = (x: number, y: number) => (y - y0) * cols + (x - vxMin);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [ex, ey] = stepXY(x, y, DIR_E);
        const [sex, sey] = stepXY(x, y, DIR_SE);
        const [swx, swy] = stepXY(x, y, DIR_SW);
        if (sex <= x1 && sey <= y1 && ex <= x1) idx.push(vi(x, y), vi(sex, sey), vi(ex, ey));
        if (swx >= vxMin && swy <= y1 && sex <= x1) idx.push(vi(x, y), vi(swx, swy), vi(sex, sey));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('kind', new THREE.BufferAttribute(kind, 4));
    g.setAttribute('wcol', new THREE.BufferAttribute(wcol, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  dispose(): void {
    for (const c of this.chunks) c.geometry.dispose();
    this.detail.dispose();
    this.material.dispose();
  }
}
