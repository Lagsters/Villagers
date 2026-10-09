/**
 * Statyczne obiekty mapy (drzewa, skaly, pola, znaki, ruiny). Lista instancji jest liczona
 * per chunk; do GPU trafiaja tylko chunki w kadrze. Zmiany wykrywamy porownaniem kopii map.obj.
 * Drzewa i skaly maja po dwie odmiany modelu i odcien instancji wg pola; sadzonki i zboze rosna plynnie
 * (wzrost z licznika przegladu mapy - sim/mapsweep.ts - odswiezany co GROW_TICKS).
 */
import * as THREE from 'three';
import { O, isField, isStone, isTree } from '../../sim/defs.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { FIELD_STAGE, SAPLING_STAGE } from '../../sim/mapsweep.ts';
import type { GameState } from '../../sim/types.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';
import { CHUNK } from './terrain.ts';

const KINDS = ['tree_pine', 'tree_pine2', 'tree_leaf', 'tree_leaf2', 'stump', 'stone', 'stone2', 'field', 'field_ripe', 'sign', 'ruin'] as const;
type Kind = (typeof KINDS)[number];
export type TreeModel = 'tree_pine' | 'tree_pine2' | 'tree_leaf' | 'tree_leaf2';
/** Warstwy z kolorem instancji: odcien drzew i skal, dojrzewanie zboza, zloze na znaku geologa. */
const TINTED: readonly Kind[] = ['tree_pine', 'tree_pine2', 'tree_leaf', 'tree_leaf2', 'stone', 'stone2', 'field', 'sign'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<Kind, number>;

/** Co tyle tickow przeliczamy chunki z rosnacymi sadzonkami i zbozem (1 s gry przy tempie 1x). */
const GROW_TICKS = 5;
/** Wielkosc swiezo posadzonej sadzonki (jak SAPLING_S w client/render/work/field.ts). */
const SAPLING_S = 0.15;
/** Mnoznik koloru zielonego zboza tuz przed dojrzaloscia: zielen przechodzi w zloto modelu field_ripe. */
const RIPEN: readonly [number, number, number] = [3.6, 1.12, 1.6];
/** Kolor symbolu na znaku geologa wg zloza (RES.*): brak (takze ryby), wegiel, zelazo, zloto, kamien. */
const SIGN_COLORS = [0xf2ead8, 0x2a2a2e, 0xa8553a, 0xf2c230, 0xa9a59c, 0xf2ead8];

/** Instancja obiektu; tr, tg, tb - kolor instancji (liniowo, mnozony przez kolory modelu), tr < 0 - bez koloru. */
interface Inst { k: number; x: number; y: number; z: number; r: number; s: number; sy: number; i: number; tr: number; tg: number; tb: number }

function hashf(i: number, k: number): number {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ k;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h >>> 0) % 10000) / 10000;
}

/** Polozenie obiektu mapy na polu i (drzewo, skala, znak - jak w rendererze obiektow): przesuniecie w polu i obrot. */
export function objectSpot(map: MapData, i: number): { x: number; y: number; z: number; rot: number } {
  const x = i % map.w, y = (i / map.w) | 0;
  return {
    x: vx(x, y) + (hashf(i, 1) - 0.5) * 0.2,
    y: map.height[i] * H_SCALE,
    z: vz(y) + (hashf(i, 2) - 0.5) * 0.2,
    rot: hashf(i, 3) * Math.PI * 2,
  };
}

/** Odcien instancji (mnoznik kolorow modelu): jasnosc k, przesuniecie ku zolci (+) albo blekitowi (-). */
function tint(k: number, warm: number): [number, number, number] {
  return [k * (1 + warm), k, k * (1 - warm)];
}

/**
 * Wyglad doroslego drzewa na polu i (jak w rendererze obiektow): polozenie, model (gatunek i odmiana), skala
 * (s w poziomie, sy w pionie) i odcien instancji (mnoznik r, g, b; tintHex - ten sam jako kolor rekwizytu sceny).
 */
export function treeLook(map: MapData, i: number): { model: TreeModel; x: number; y: number; z: number; rot: number; s: number; sy: number; tint: [number, number, number]; tintHex: number } {
  const pine = hashf(i, 4) < 0.55;
  const first = hashf(i, 6) < 0.6;
  const model: TreeModel = pine ? (first ? 'tree_pine' : 'tree_pine2') : first ? 'tree_leaf' : 'tree_leaf2';
  const s = 0.62 + hashf(i, 5) * 0.25;
  const t = tint(0.9 + hashf(i, 8) * 0.16, (hashf(i, 9) - 0.5) * 0.12);
  return {
    ...objectSpot(map, i), model, s, sy: s * (0.9 + hashf(i, 7) * 0.2), tint: t,
    tintHex: new THREE.Color().setRGB(t[0], t[1], t[2], THREE.LinearSRGBColorSpace).getHex(),
  };
}

/** Skala na polu i: model (odmiana) i odcien. */
function stoneLook(i: number): { k: number; tint: [number, number, number] } {
  return { k: hashf(i, 6) < 0.5 ? K.stone : K.stone2, tint: tint(0.92 + hashf(i, 8) * 0.14, (hashf(i, 9) - 0.5) * 0.08) };
}

export class MapObjectsRenderer {
  readonly group = new THREE.Group();
  private layers: InstancedLayer[];
  private chunkInst: Inst[][];
  private chunkBoxes: THREE.Box3[];
  /** Chunki z sadzonkami albo rosnacym zbozem - przeliczane co GROW_TICKS. */
  private growing = new Set<number>();
  private lastGrow = -GROW_TICKS;
  /** Polozenie przegladu mapy (GameState.sweep) - ulamek okresu od ostatnich odwiedzin pola. */
  private sweep = 0;
  private lastObj: Uint8Array;
  private dirtyChunks = new Set<number>();
  private needRebuild = true;
  private cw: number;
  private ch: number;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  /** Kolor symbolu znaku geologa wg zloza (liniowo). */
  private signColors = SIGN_COLORS.map((h) => new THREE.Color(h).toArray() as [number, number, number]);

  private map: MapData;

  constructor(map: MapData, material: THREE.Material) {
    this.map = map;
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);
    this.layers = KINDS.map((k) => new InstancedLayer(this.group, getModel(k), material, 512, TINTED.includes(k)));
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

  /** Postep wzrostu 0..1 przez `stages` etapow po `per` odwiedzin przegladu mapy (plynnie miedzy odwiedzinami). */
  private growth(i: number, stage: number, stages: number, per: number): number {
    const n = this.map.w * this.map.h;
    const since = ((this.sweep - 1 - i + n) % n) / n;
    return (stage + Math.min(1, (this.map.objTimer[i] + since) / per)) / stages;
  }

  private buildChunk(c: number): void {
    const m = this.map;
    const list: Inst[] = [];
    let grows = false;
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
          const t = treeLook(m, i);
          let s = t.s, sy = t.sy;
          if (o !== O.TREE) {
            // Sadzonka rosnie plynnie do wielkosci tego samego drzewa (bez skoku przy dojrzeniu), mloda jest smuklejsza.
            const g = this.growth(i, o - O.SAPLING1, O.TREE - O.SAPLING1, SAPLING_STAGE);
            sy = SAPLING_S + (t.sy - SAPLING_S) * g;
            s = (SAPLING_S + (t.s - SAPLING_S) * g) * (0.8 + 0.2 * g);
            grows = true;
          }
          list.push({ k: K[t.model], x: px, y: py, z: pz, r, s, sy, i, tr: t.tint[0], tg: t.tint[1], tb: t.tint[2] });
        } else if (o === O.STUMP) {
          list.push({ k: K.stump, x: px, y: py, z: pz, r, s: 1, sy: 1, i, tr: -1, tg: 0, tb: 0 });
        } else if (isStone(o)) {
          const st = stoneLook(i);
          const s = 0.55 + (o - O.STONE1) * 0.12;
          list.push({ k: st.k, x: px, y: py, z: pz, r, s, sy: s, i, tr: st.tint[0], tg: st.tint[1], tb: st.tint[2] });
        } else if (isField(o)) {
          if (o === O.FIELD_RIPE) {
            list.push({ k: K.field_ripe, x: vx(x, y), y: py, z: vz(y), r: 0, s: 1, sy: 1, i, tr: -1, tg: 0, tb: 0 });
          } else {
            // Zboze rosnie plynnie, a pod koniec zielen przechodzi w zloto (kolor instancji ponad 1).
            const g = this.growth(i, o - O.FIELD1, O.FIELD_RIPE - O.FIELD1, FIELD_STAGE);
            const t = Math.max(0, Math.min(1, (g - 0.55) / 0.45));
            const k = t * t * (3 - 2 * t);
            list.push({ k: K.field, x: vx(x, y), y: py, z: vz(y), r: 0, s: 1, sy: 0.2 + 0.8 * g, i,
              tr: 1 + (RIPEN[0] - 1) * k, tg: 1 + (RIPEN[1] - 1) * k, tb: 1 + (RIPEN[2] - 1) * k });
            grows = true;
          }
        } else if (o === O.SIGN) {
          const res = Math.floor(m.objId[i] / 100);
          const sc = this.signColors[res] ?? this.signColors[0];
          list.push({ k: K.sign, x: px, y: py, z: pz, r, s: 1, sy: 1, i, tr: sc[0], tg: sc[1], tb: sc[2] });
        } else if (o === O.RUIN) {
          list.push({ k: K.ruin, x: vx(x, y), y: py, z: vz(y), r, s: 1, sy: 1, i, tr: -1, tg: 0, tb: 0 });
        }
      }
    }
    this.chunkInst[c] = list;
    if (grows) this.growing.add(c);
    else this.growing.delete(c);
  }

  /** Wykryj zmiany na mapie (wywolywane po tickach symulacji); co GROW_TICKS odswiez rosnace sadzonki i zboze. */
  sync(s: GameState): void {
    const m = this.map;
    const obj = m.obj;
    const last = this.lastObj;
    this.sweep = s.sweep;
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] !== last[i]) {
        last[i] = obj[i];
        const x = i % m.w, y = (i / m.w) | 0;
        this.dirtyChunks.add(Math.floor(y / CHUNK) * this.cw + Math.floor(x / CHUNK));
      }
    }
    if (s.tick - this.lastGrow >= GROW_TICKS || s.tick < this.lastGrow) {
      this.lastGrow = s.tick;
      for (const c of this.growing) this.dirtyChunks.add(c);
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

  /** Pola ukryte przez sceny pracy w tej klatce (sceny rysuja je same, np. koszone zboze). */
  private hidden = new Set<number>();

  setHidden(cells: ReadonlySet<number>): void {
    if (cells.size === this.hidden.size && [...cells].every((c) => this.hidden.has(c))) return;
    this.hidden = new Set(cells);
    this.needRebuild = true;
  }

  update(camera: THREE.Camera, cameraMoved: boolean): void {
    if (!cameraMoved && !this.needRebuild) return;
    this.needRebuild = false;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const l of this.layers) l.begin();
    for (let c = 0; c < this.chunkInst.length; c++) {
      if (!this.frustum.intersectsBox(this.chunkBoxes[c])) continue;
      const hide = this.hidden.size > 0;
      for (const it of this.chunkInst[c]) {
        if (hide && this.hidden.has(it.i)) continue;
        const layer = this.layers[it.k];
        const n = layer.push(it.x, it.y, it.z, it.r, it.s, it.sy);
        if (it.tr >= 0) layer.color(n, it.tr, it.tg, it.tb);
      }
    }
    for (const l of this.layers) l.end();
  }

  get instanceCount(): number {
    let n = 0;
    for (const l of this.layers) n += l.count;
    return n;
  }
}
