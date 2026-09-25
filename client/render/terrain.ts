/**
 * Teren jako chunki 32x32 pol: wspolne wierzcholki (kolor per pole, plynne przejscia), gladkie
 * normalne liczone z mapy wysokosci (bez szwow miedzy chunkami) i generowana w kodzie faktura
 * (szum) mnozona przez kolor - miekko cieniowane, ziarniste laki zamiast plaskich trojkatow.
 * three.js sam odrzuca chunki poza kadrem (frustum culling po boundingSphere).
 */
import * as THREE from 'three';
import { T } from '../../sim/defs.ts';
import { stepXY, DIR_E, DIR_SE, DIR_SW } from '../../sim/grid.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { H_SCALE, ROW_H, vx, vz } from './coords.ts';
import { DEEP_WATER, GRASS_DARK, GRASS_LIGHT, SHORE_COLOR, TERRAIN_COLORS } from './palette.ts';

export const CHUNK = 32;
/** Powtorzenie faktury: ile pol na jeden kafel tekstury. */
const TEX_TILE = 3;

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

/** Faktura: ziarnisty szum w odcieniach szarosci (mnozony przez kolor wierzcholka). */
function detailTexture(): THREE.Texture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // Drobne ziarno + kepki (wieksze plamki).
      const fine = hash(i, 11);
      const clump = hash(((x >> 2) & 31) + ((y >> 2) & 31) * 32, 5);
      const v = 205 + fine * 38 + (clump > 0.8 ? 12 : clump < 0.15 ? -18 : 0);
      const c = Math.max(0, Math.min(255, Math.round(v)));
      data[i * 4] = c; data[i * 4 + 1] = c; data[i * 4 + 2] = c; data[i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private material: THREE.MeshLambertMaterial;
  readonly cw: number;
  readonly ch: number;

  private map: MapData;

  constructor(map: MapData) {
    this.map = map;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() });
    // Atrybut grain (0..1) wlacza fakture: otwarta woda jest gladka, zeby brzeg mapy zlewal sie z tlem.
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float grain;\nvarying float vGrain;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = grain;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGrain;')
        .replace('#include <map_fragment>', '#ifdef USE_MAP\ndiffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), vGrain);\n#endif');
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

  /** Czy pole ladu sasiaduje z woda (brzeg - piasek). */
  private isShore(x: number, y: number): boolean {
    const m = this.map;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (m.terrain[this.at(x + dx, y + dy)] === T.WATER) return true;
    }
    return false;
  }

  /** Kolor wierzcholka (pola). */
  private nodeColor(x: number, y: number, out: number[], o: number): void {
    const m = this.map;
    const i = y * m.w + x;
    const t = m.terrain[i];
    let c: readonly number[];
    if (t === T.WATER) {
      // Ku brzegowi mapy woda plynnie przechodzi w glebie (kolor tla sceny) - bez zabkow na krawedzi.
      const base = m.resAmt[i] < 10 ? DEEP_WATER : TERRAIN_COLORS[T.WATER];
      const d = Math.min(x, y, m.w - 1 - x, m.h - 1 - y);
      const t = Math.min(1, d / 8);
      const k = t * t * (3 - 2 * t);
      c = [DEEP_WATER[0] + (base[0] - DEEP_WATER[0]) * k, DEEP_WATER[1] + (base[1] - DEEP_WATER[1]) * k,
        DEEP_WATER[2] + (base[2] - DEEP_WATER[2]) * k];
    } else if (this.isShore(x, y)) {
      c = SHORE_COLOR;
    } else if (t === T.GRASS) {
      const p = patch(x, y);
      const k = Math.min(1, Math.max(0, p * 1.4 - 0.2 + (m.height[i] - 8) * 0.03));
      c = [GRASS_DARK[0] + (GRASS_LIGHT[0] - GRASS_DARK[0]) * k, GRASS_DARK[1] + (GRASS_LIGHT[1] - GRASS_DARK[1]) * k,
        GRASS_DARK[2] + (GRASS_LIGHT[2] - GRASS_DARK[2]) * k];
    } else {
      c = TERRAIN_COLORS[t] ?? TERRAIN_COLORS[T.GRASS];
    }
    const j = t === T.WATER ? 1 : 1 + (hash(i, 7) - 0.5) * 0.08;
    out[o] = c[0] * j; out[o + 1] = c[1] * j; out[o + 2] = c[2] * j;
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
    const uv = new Float32Array(n * 2);
    const grain = new Float32Array(n);
    const tmp = [0, 0, 0];
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
        this.nodeColor(x, y, tmp, 0);
        col[k * 3] = tmp[0]; col[k * 3 + 1] = tmp[1]; col[k * 3 + 2] = tmp[2];
        uv[k * 2] = wx / TEX_TILE; uv[k * 2 + 1] = wz / TEX_TILE;
        grain[k] = m.terrain[i] === T.WATER ? 0 : 1;
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
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('grain', new THREE.BufferAttribute(grain, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  dispose(): void {
    for (const c of this.chunks) c.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
