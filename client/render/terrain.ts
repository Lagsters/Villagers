/**
 * Teren jako chunki 32x32 pol. Kazde pole ma dwa trojkaty: [v, SE, E] i [v, SW, SE].
 * Kolor trojkata zalezy od terenu jego wierzcholkow (flat shading = styl low-poly).
 * three.js sam odrzuca chunki poza kadrem (frustum culling po boundingSphere).
 */
import * as THREE from 'three';
import { T } from '../../sim/defs.ts';
import { stepXY, DIR_E, DIR_SE, DIR_SW } from '../../sim/grid.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { DEEP_WATER, SHORE_COLOR, TERRAIN_COLORS } from './palette.ts';

export const CHUNK = 32;

function jitter(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.08;
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
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
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
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
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

  private triColor(a: number, b: number, c: number, out: number[], seedIdx: number): void {
    const m = this.map;
    const ta = m.terrain[a], tb = m.terrain[b], tc = m.terrain[c];
    let water = 0, snow = 0, mount = 0, desert = 0;
    for (const t of [ta, tb, tc]) {
      if (t === T.WATER) water++;
      else if (t === T.SNOW) snow++;
      else if (t === T.MOUNTAIN) mount++;
      else if (t === T.DESERT) desert++;
    }
    let col: [number, number, number];
    if (water === 3) {
      const deep = m.resAmt[a] < 10 && m.resAmt[b] < 10 && m.resAmt[c] < 10;
      col = deep ? DEEP_WATER : TERRAIN_COLORS[T.WATER];
    } else if (water > 0) col = SHORE_COLOR;
    else if (snow >= 2) col = TERRAIN_COLORS[T.SNOW];
    else if (snow === 1 || mount >= 2) col = TERRAIN_COLORS[T.MOUNTAIN];
    else if (mount === 1) col = mix(TERRAIN_COLORS[T.MOUNTAIN], TERRAIN_COLORS[T.GRASS], 0.5);
    else if (desert >= 2) col = TERRAIN_COLORS[T.DESERT];
    else if (desert === 1) col = mix(TERRAIN_COLORS[T.DESERT], TERRAIN_COLORS[T.GRASS], 0.55);
    else {
      // Trawa: wyzej jasniejsza i bardziej zolta.
      const hAvg = (m.height[a] + m.height[b] + m.height[c]) / 3;
      const k = Math.min(1, Math.max(0, (hAvg - 5) / 10));
      col = mix([0.5, 0.66, 0.3], TERRAIN_COLORS[T.GRASS], k);
    }
    const j = jitter(seedIdx, 7);
    out[0] = col[0] * (1 + j);
    out[1] = col[1] * (1 + j);
    out[2] = col[2] * (1 + j);
  }

  private buildGeometry(cx: number, cy: number): THREE.BufferGeometry {
    const m = this.map;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(m.w - 1, x0 + CHUNK), y1 = Math.min(m.h - 1, y0 + CHUNK);
    const pos: number[] = [];
    const col: number[] = [];
    const c3: number[] = [0, 0, 0];
    const push = (i: number) => {
      const x = i % m.w, y = (i / m.w) | 0;
      pos.push(vx(x, y), m.height[i] * H_SCALE, vz(y));
      col.push(c3[0], c3[1], c3[2]);
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = y * m.w + x;
        const [ex, ey] = stepXY(x, y, DIR_E);
        const [sex, sey] = stepXY(x, y, DIR_SE);
        const [swx, swy] = stepXY(x, y, DIR_SW);
        const se = sey * m.w + sex;
        if (sex < m.w && sey < m.h && ex < m.w) {
          const e = ey * m.w + ex;
          this.triColor(v, se, e, c3, v * 2);
          push(v); push(se); push(e);
        }
        if (swx >= 0 && swy < m.h && sex < m.w) {
          const sw = swy * m.w + swx;
          this.triColor(v, sw, se, c3, v * 2 + 1);
          push(v); push(sw); push(se);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  dispose(): void {
    for (const c of this.chunks) c.geometry.dispose();
    this.material.dispose();
  }
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t)];
}
