/**
 * Statyczne obiekty mapy (drzewa, skaly, pola, znaki, ruiny). Lista instancji jest liczona
 * per chunk; do GPU trafiaja tylko chunki w kadrze. Zmiany wykrywamy porownaniem kopii map.obj.
 */
import * as THREE from 'three';
import { O, isField, isStone, isTree } from '../../sim/defs.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';
import { CHUNK } from './terrain.ts';

const KINDS = ['tree_pine', 'tree_leaf', 'stump', 'stone', 'field', 'field_ripe', 'sign', 'ruin'] as const;
type Kind = (typeof KINDS)[number];

interface Inst { k: number; x: number; y: number; z: number; r: number; s: number; sy: number }

function hashf(i: number, k: number): number {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ k;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h >>> 0) % 10000) / 10000;
}

export class MapObjectsRenderer {
  readonly group = new THREE.Group();
  private layers: InstancedLayer[];
  private chunkInst: Inst[][];
  private chunkBoxes: THREE.Box3[];
  private lastObj: Uint8Array;
  private dirtyChunks = new Set<number>();
  private needRebuild = true;
  private cw: number;
  private ch: number;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();

  private map: MapData;

  constructor(map: MapData, material: THREE.Material) {
    this.map = map;
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);
    this.layers = KINDS.map((k) => new InstancedLayer(this.group, getModel(k), material, 512));
    this.chunkInst = [];
    this.chunkBoxes = [];
    for (let c = 0; c < this.cw * this.ch; c++) {
      this.chunkInst.push([]);
      const cx = c % this.cw, cy = Math.floor(c / this.cw);
      this.chunkBoxes.push(new THREE.Box3(
        new THREE.Vector3(cx * CHUNK - 1, -1, vz(cy * CHUNK) - 1),
        new THREE.Vector3((cx + 1) * CHUNK + 1, 9, vz((cy + 1) * CHUNK) + 1),
      ));
      this.buildChunk(c);
    }
    this.lastObj = new Uint8Array(map.obj);
  }

  setModel(kind: Kind, g: THREE.BufferGeometry): void {
    this.layers[KINDS.indexOf(kind)].setGeometry(g);
  }

  private buildChunk(c: number): void {
    const m = this.map;
    const list: Inst[] = [];
    const cx = c % this.cw, cy = Math.floor(c / this.cw);
    for (let y = cy * CHUNK; y < Math.min(m.h, (cy + 1) * CHUNK); y++) {
      for (let x = cx * CHUNK; x < Math.min(m.w, (cx + 1) * CHUNK); x++) {
        const i = y * m.w + x;
        const o = m.obj[i];
        if (o === O.NONE || o === O.FLAG || o === O.BUILDING || o === O.BUILDING_PART) continue;
        const px = vx(x, y) + (hashf(i, 1) - 0.5) * 0.2;
        const pz = vz(y) + (hashf(i, 2) - 0.5) * 0.2;
        const py = m.height[i] * H_SCALE;
        const r = hashf(i, 3) * Math.PI * 2;
        if (isTree(o)) {
          const k = hashf(i, 4) < 0.55 ? 0 : 1;
          const s = o === O.TREE ? 0.85 + hashf(i, 5) * 0.35 : 0.2 + (o - O.SAPLING1) * 0.15;
          list.push({ k, x: px, y: py, z: pz, r, s, sy: s });
        } else if (o === O.STUMP) {
          list.push({ k: 2, x: px, y: py, z: pz, r, s: 1, sy: 1 });
        } else if (isStone(o)) {
          const s = 0.55 + (o - O.STONE1) * 0.12;
          list.push({ k: 3, x: px, y: py, z: pz, r, s, sy: s });
        } else if (isField(o)) {
          const ripe = o === O.FIELD_RIPE;
          const stage = o - O.FIELD1;
          list.push({ k: ripe ? 5 : 4, x: vx(x, y), y: py, z: vz(y), r: 0, s: 1, sy: ripe ? 1 : 0.25 + stage * 0.22 });
        } else if (o === O.SIGN) {
          list.push({ k: 6, x: px, y: py, z: pz, r, s: 1, sy: 1 });
        } else if (o === O.RUIN) {
          list.push({ k: 7, x: vx(x, y), y: py, z: vz(y), r, s: 1, sy: 1 });
        }
      }
    }
    this.chunkInst[c] = list;
  }

  /** Wykryj zmiany na mapie (wywolywane po kazdym ticku symulacji). */
  sync(): void {
    const m = this.map;
    const obj = m.obj;
    const last = this.lastObj;
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] !== last[i]) {
        last[i] = obj[i];
        const x = i % m.w, y = (i / m.w) | 0;
        this.dirtyChunks.add(Math.floor(y / CHUNK) * this.cw + Math.floor(x / CHUNK));
      }
    }
    if (this.dirtyChunks.size) {
      for (const c of this.dirtyChunks) this.buildChunk(c);
      this.dirtyChunks.clear();
      this.needRebuild = true;
    }
  }

  /** Wysokosc terenu mogla sie zmienic (wyrownanie) - przebuduj chunk. */
  markHeight(i: number): void {
    const m = this.map;
    const x = i % m.w, y = (i / m.w) | 0;
    this.dirtyChunks.add(Math.floor(y / CHUNK) * this.cw + Math.floor(x / CHUNK));
  }

  update(camera: THREE.Camera, cameraMoved: boolean): void {
    if (!cameraMoved && !this.needRebuild) return;
    this.needRebuild = false;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const l of this.layers) l.begin();
    for (let c = 0; c < this.chunkInst.length; c++) {
      if (!this.frustum.intersectsBox(this.chunkBoxes[c])) continue;
      for (const it of this.chunkInst[c]) this.layers[it.k].push(it.x, it.y, it.z, it.r, it.s, it.sy);
    }
    for (const l of this.layers) l.end();
  }

  get instanceCount(): number {
    let n = 0;
    for (const l of this.layers) n += l.count;
    return n;
  }
}
