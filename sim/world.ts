/**
 * Wspolne operacje na swiecie: alokacja encji, zapytania o pola, koszt marszu, terytorium.
 */
import { BUILDINGS, O, SIZE, T, isInventory, isMilitary } from './defs.ts';
import { DIR_SE, hexDist, neighborTable, spiral } from './grid.ts';
import { isBorder, type MapData } from './mapgen.ts';
import { STAGE, type Building, type GameEvent, type GameState } from './types.ts';

export function nb(map: MapData): Int32Array {
  return neighborTable(map.w, map.h);
}

export function neighbor(map: MapData, idx: number, dir: number): number {
  return neighborTable(map.w, map.h)[idx * 6 + dir];
}

export function allocId<T>(list: (T | null)[], free: number[]): number {
  if (free.length > 0) return free.pop()!;
  list.push(null);
  return list.length - 1;
}

export function event(s: GameState, type: string, player: number, pos: number, a?: number): void {
  const e: GameEvent = { type, player, pos };
  if (a !== undefined) e.a = a;
  s._events.push(e);
}

// ---------- Marsz ----------

/** Czas przejscia krawedzi from -> to w tickach. */
export function walkCost(map: MapData, from: number, to: number): number {
  const dh = map.height[to] - map.height[from];
  return 8 + (dh > 0 ? dh * 2 : -dh);
}

export function isLandWalkable(map: MapData, idx: number): boolean {
  if (isBorder(map, idx)) return false;
  const t = map.terrain[idx];
  return t === T.GRASS || t === T.DESERT || t === T.MOUNTAIN;
}

/** Czy pole mozna przejsc swobodnie (poza drogami): teren + brak przeszkod. */
export function isFreeWalkable(map: MapData, idx: number): boolean {
  if (!isLandWalkable(map, idx)) return false;
  const o = map.obj[idx];
  return !(o === O.TREE || (o >= O.STONE1 && o <= O.STONE6) || o === O.BUILDING || o === O.BUILDING_PART);
}

// ---------- Zabudowa ----------

/** Obiekty, ktore mozna po prostu usunac pod flage/budynek/droge. */
export function isClearObj(o: number): boolean {
  return o === O.NONE || o === O.SIGN;
}

export function ownedBy(map: MapData, idx: number, p: number): boolean {
  return map.owner[idx] === p + 1;
}

/** Czy gracz moze postawic flage na polu (dopuszczalne pole z droga - podzial drogi). */
export function canPlaceFlag(s: GameState, p: number, pos: number): boolean {
  const map = s.map;
  if (pos < 0 || pos >= map.w * map.h) return false;
  if (!isLandWalkable(map, pos) || !ownedBy(map, pos, p)) return false;
  if (!isClearObj(map.obj[pos])) return false;
  const table = nb(map);
  for (let d = 0; d < 6; d++) {
    const j = table[pos * 6 + d];
    if (j < 0) return false;
    if (map.obj[j] === O.FLAG) return false;
  }
  return true;
}

/** Pola zajmowane przez budynek. Jak w pierwowzorze kazdy budynek (takze duzy) stoi na jednym polu. */
export function buildingCells(_map: MapData, pos: number, _size: number): number[] {
  return [pos];
}

/** Budynki "duze" w sensie zasad stawiania (wymagaja wolnych sasiadow i wyrownania terenu). */
export function isBigSize(size: number): boolean {
  return size === SIZE.LARGE || size === SIZE.MEDIUM;
}

/** Najwieksza dopuszczalna roznica wysokosci w drugim pierscieniu pod duzy budynek (jak w pierwowzorze). */
const BIG_HEIGHT_SPAN = 9;

/**
 * Czy mozna postawic budynek danego rodzaju (zasady pierwowzoru):
 * - pole i 6 sasiadow wlasne, na polu brak drogi i przeszkod, flaga na SE stoi (wlasna, wolna) albo da sie ja postawic;
 * - chata: trawa na polu, sasiedzi nie w wodzie - bez warunkow co do sasiednich budynkow i wysokosci;
 * - kopalnia: gory na polu;
 * - dom i duzy budynek: trawa wokol, na 6 sasiednich polach brak budynkow (drzewa i flagi nie przeszkadzaja),
 *   w drugim pierscieniu brak innego domu/duzego budynku i roznica wysokosci < 9 (teren zostanie wyrownany).
 */
export function canBuild(s: GameState, p: number, pos: number, kind: number): boolean {
  const map = s.map;
  const def = BUILDINGS[kind];
  if (!def || pos < 0 || pos >= map.w * map.h) return false;
  const t = nb(map);
  const flagPos = t[pos * 6 + DIR_SE];
  if (flagPos < 0) return false;
  if (map.roads[pos] !== 0 || isBorder(map, pos) || !ownedBy(map, pos, p) || !isClearObj(map.obj[pos])) return false;
  const terrain = map.terrain[pos];
  if (def.size === SIZE.MINE) {
    if (terrain !== T.MOUNTAIN) return false;
  } else if (terrain !== T.GRASS) return false;
  const big = isBigSize(def.size);
  for (let d = 0; d < 6; d++) {
    const j = t[pos * 6 + d];
    if (j < 0 || !ownedBy(map, j, p)) return false;
    const tj = map.terrain[j];
    if (tj === T.WATER || tj === T.SNOW) return false;
    if (big) {
      if (tj !== T.GRASS && d !== DIR_SE) return false;
      const o = map.obj[j];
      if (o === O.BUILDING || o === O.BUILDING_PART) return false;
    }
  }
  if (big) {
    // Drugi pierscien (12 pol): dla kazdego kierunku dwa kroki prosto oraz krok prosto i krok w kolejnym kierunku.
    let hMin = 99, hMax = -1;
    for (let k = 0; k < 12; k++) {
      const d = k >> 1;
      const a = t[pos * 6 + d];
      const v = a < 0 ? -1 : t[a * 6 + (k & 1 ? (d + 1) % 6 : d)];
      if (v < 0) continue;
      const h = map.height[v];
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      if (map.obj[v] === O.BUILDING) {
        const other = s.buildings[map.objId[v]];
        if (other && isBigSize(BUILDINGS[other.kind].size)) return false;
      }
    }
    if (hMax - hMin >= BIG_HEIGHT_SPAN) return false;
  }
  if (map.obj[flagPos] === O.FLAG) {
    const f = s.flags[map.objId[flagPos]];
    return !!f && f.owner === p && f.building < 0;
  }
  return canPlaceFlag(s, p, flagPos);
}

// ---------- Terytorium ----------

/** Czy budynek wyznacza terytorium (zamek albo obsadzony budynek wojskowy). */
export function exertsTerritory(b: Building): boolean {
  if (b.stage !== STAGE.DONE) return false;
  if (b.kind === 0) return true;
  return isMilitary(b.kind) && b.knights.length > 0;
}

export function territoryRadius(kind: number): number {
  return BUILDINGS[kind].radius;
}

const MAX_TERRITORY_RADIUS = 9;

/**
 * Przelicza wlasciciela pol w promieniu `r` od `center`. Zwraca liste pol, ktore zmienily
 * wlasciciela (pary [idx, staryWlasciciel]).
 */
export function recomputeTerritory(s: GameState, center: number, r: number, force: Building | null = null): number[] {
  const map = s.map;
  const w = map.w;
  const cx = center % w;
  const cy = (center / w) | 0;
  // Budynki mogace wplywac na region.
  const infl: Building[] = [];
  for (const b of s.buildings) {
    if (!b || !exertsTerritory(b)) continue;
    const d = hexDist(cx, cy, b.pos % w, (b.pos / w) | 0);
    if (d <= r + MAX_TERRITORY_RADIUS) infl.push(b);
  }
  const changed: number[] = [];
  for (const v of spiral(w, map.h, cx, cy, r)) {
    const vx = v % w;
    const vy = (v / w) | 0;
    const cur = map.owner[v];
    let keep = false;
    let best = -1;
    let bestD = 1 << 30;
    let bestId = 1 << 30;
    for (const b of infl) {
      const d = hexDist(vx, vy, b.pos % w, (b.pos / w) | 0);
      if (d > territoryRadius(b.kind)) continue;
      if (b.owner + 1 === cur) keep = true;
      if (d < bestD || (d === bestD && b.id < bestId)) {
        bestD = d;
        bestId = b.id;
        best = b.owner;
      }
    }
    let nw = keep ? cur : best + 1;
    if (force && keep && cur !== force.owner + 1) {
      // Przejety budynek zabiera pola, do ktorych jest nie dalej niz budynki obecnego wlasciciela.
      const df = hexDist(vx, vy, force.pos % w, (force.pos / w) | 0);
      if (df <= territoryRadius(force.kind)) {
        let dCur = 1 << 30;
        for (const b of infl) {
          if (b.owner + 1 !== cur) continue;
          const d = hexDist(vx, vy, b.pos % w, (b.pos / w) | 0);
          if (d <= territoryRadius(b.kind) && d < dCur) dCur = d;
        }
        if (df <= dCur) nw = force.owner + 1;
      }
    }
    if (nw !== cur) {
      map.owner[v] = nw;
      changed.push(v, cur);
    }
  }
  return changed;
}

export function isInventoryBuilding(b: Building | null): b is Building {
  return !!b && isInventory(b.kind) && b.stage === STAGE.DONE && b.inv !== null;
}
