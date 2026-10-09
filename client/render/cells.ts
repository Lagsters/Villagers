/**
 * Stan pol mapy dla shadera terenu (tekstura RGBA8 rozmiaru mapy, jeden teksel na pole): co stoi na polu i ktoredy
 * biegna drogi. Teren rysuje z niej cienie drzew i budynkow, sciolke lasu, wydeptana ziemie, drogi i zaorane pola,
 * wiec ziemia zmienia sie razem z tym, co na niej stoi, bez dodatkowych wywolan rysowania.
 *
 * Kanaly: R - drzewo (rzuca cien, sciolka; sadzonka slabiej wg etapu), G - inna bryla rzucajaca cien (budynek,
 * skala), B - bity: 0-5 droga w kierunku DIR_E..DIR_NE (map.roads), 6 - flaga, 7 - pole zboza,
 * A - wydeptana ziemia (budynek, plac budowy). Bit pola ustawiaja tez sceny pracy (siew, sciernisko - setPlowed).
 *
 * Druga tekstura (paths) - sciezka od flagi do wejscia gotowego budynku (podnoze schodow albo prog): na polu flagi
 * RG = podnoze wzgledem srodka pola, na polu budynku BA = podnoze wzgledem srodka pola (drugi koniec to flaga, pole SE).
 * Wektory w jednostkach swiata, bajt = 128 + 79 * v; (128, 128) - brak sciezki.
 *
 * Trzecia tekstura (bends) - przesuniecie srodka drogi na polu, na ktorym droga omija drzewo albo budynek
 * (roadBend): RG = x, z w jednostkach swiata, bajt = 128 + BEND_K * v. Z niej czytaja tez postacie (bendAt).
 */
import * as THREE from 'three';
import { O, isField, isStone } from '../../sim/defs.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { STAGE, type Building, type GameState } from '../../sim/types.ts';
import { BEND_K, vx, vz } from './coords.ts';
import { roadBend } from './roadBend.ts';

const BIT_FLAG = 1 << 6;
const BIT_FIELD = 1 << 7;
/** Skala wektorow sciezki w teksturze (bajt = 128 + PATH_K * v, |v| do ~1.6 pola). */
const PATH_K = 79;

/** Podnoze wejscia budynku (swiat x, z) albo null. */
export type EntranceOf = (b: Building) => { footX: number; footZ: number } | null;

export class CellMap {
  readonly texture: THREE.DataTexture;
  readonly paths: THREE.DataTexture;
  readonly bends: THREE.DataTexture;
  private bendData: Uint8Array;
  private bend: [number, number] = [0, 0];
  private data: Uint8Array;
  private pathData: Uint8Array;
  private pathNext: Uint8Array;
  private plowed = new Set<number>();
  private map: MapData;

  constructor(map: MapData) {
    this.map = map;
    this.data = new Uint8Array(map.w * map.h * 4);
    this.texture = new THREE.DataTexture(this.data, map.w, map.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.pathData = new Uint8Array(map.w * map.h * 4).fill(128);
    this.pathNext = new Uint8Array(map.w * map.h * 4);
    this.paths = new THREE.DataTexture(this.pathData, map.w, map.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.paths.magFilter = this.paths.minFilter = THREE.NearestFilter;
    this.paths.colorSpace = THREE.NoColorSpace;
    this.paths.needsUpdate = true;
    this.bendData = new Uint8Array(map.w * map.h * 4).fill(128);
    this.bends = new THREE.DataTexture(this.bendData, map.w, map.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.bends.magFilter = this.bends.minFilter = THREE.NearestFilter;
    this.bends.colorSpace = THREE.NoColorSpace;
    this.bends.needsUpdate = true;
  }

  /** Przelicz po tickach symulacji; tekstury wysylane tylko po zmianie. entranceOf - wejscie gotowego budynku. */
  sync(s: GameState, entranceOf?: EntranceOf): void {
    if (entranceOf) this.syncPaths(s, entranceOf);
    const m = this.map;
    const d = this.data;
    let changed = false;
    for (let i = 0; i < m.w * m.h; i++) {
      const o = m.obj[i];
      let tree = 0, cast = 0, bits = m.roads[i] & 63, worn = 0;
      if (o === O.TREE) tree = 255;
      else if (o >= O.SAPLING1 && o < O.TREE) tree = 40 + (o - O.SAPLING1) * 45;
      else if (isStone(o)) cast = 110 + (o - O.STONE1) * 25;
      else if (isField(o)) bits |= BIT_FIELD;
      else if (o === O.FLAG) bits |= BIT_FLAG;
      else if (o === O.BUILDING || o === O.BUILDING_PART) {
        const b = s.buildings[m.objId[i]];
        cast = b && b.stage === STAGE.DONE ? 255 : 90;
        worn = 255;
      }
      if (this.plowed.has(i)) bits |= BIT_FIELD;
      let bx = 128, bz = 128;
      if (bits & 63 && roadBend(s, i, this.bend)) {
        bx = Math.round(128 + BEND_K * this.bend[0]);
        bz = Math.round(128 + BEND_K * this.bend[1]);
      }
      const k = i * 4;
      if (this.bendData[k] !== bx || this.bendData[k + 1] !== bz) {
        this.bendData[k] = bx;
        this.bendData[k + 1] = bz;
        this.bends.needsUpdate = true;
      }
      if (d[k] !== tree || d[k + 1] !== cast || d[k + 2] !== bits || d[k + 3] !== worn) {
        d[k] = tree; d[k + 1] = cast; d[k + 2] = bits; d[k + 3] = worn;
        changed = true;
      }
    }
    if (changed) this.texture.needsUpdate = true;
  }

  private syncPaths(s: GameState, entranceOf: EntranceOf): void {
    const m = this.map;
    const next = this.pathNext.fill(128);
    const put = (cell: number, k: number, fx: number, fz: number) => {
      const x = cell % m.w, y = (cell / m.w) | 0;
      for (const [c, v] of [[0, fx - vx(x, y)], [1, fz - vz(y)]] as const) {
        next[cell * 4 + k + c] = Math.max(0, Math.min(255, Math.round(128 + PATH_K * v)));
      }
    };
    for (const b of s.buildings) {
      if (!b || b.stage !== STAGE.DONE) continue;
      const f = s.flags[b.flag];
      const e = entranceOf(b);
      if (!f || !e) continue;
      put(f.pos, 0, e.footX, e.footZ);
      put(b.pos, 2, e.footX, e.footZ);
    }
    let changed = false;
    for (let i = 0; i < next.length; i++) if (next[i] !== this.pathData[i]) { changed = true; break; }
    if (changed) {
      this.pathData.set(next);
      this.paths.needsUpdate = true;
    }
  }

  /** Przesuniecie srodka drogi na polu i (jak w teksturze bends); false - bez przesuniecia. */
  bendAt(i: number, out: [number, number]): boolean {
    const k = i * 4;
    out[0] = (this.bendData[k] - 128) / BEND_K;
    out[1] = (this.bendData[k + 1] - 128) / BEND_K;
    return out[0] !== 0 || out[1] !== 0;
  }

  /** Pola zaorane w tej klatce przez sceny pracy (EntitiesRenderer.plowed); zmienia tylko ich teksele. */
  setPlowed(cells: ReadonlySet<number>): void {
    const d = this.data;
    let changed = false;
    const set = (i: number, on: boolean) => {
      const k = i * 4 + 2;
      const bits = on || isField(this.map.obj[i]) ? d[k] | BIT_FIELD : d[k] & ~BIT_FIELD;
      if (bits !== d[k]) { d[k] = bits; changed = true; }
    };
    for (const i of this.plowed) if (!cells.has(i)) { this.plowed.delete(i); set(i, false); }
    for (const i of cells) if (!this.plowed.has(i)) { this.plowed.add(i); set(i, true); }
    if (changed) this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.paths.dispose();
    this.bends.dispose();
  }
}
