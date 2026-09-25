/**
 * Wspolne operacje na swiecie: alokacja encji, zapytania o pola, koszt marszu, terytorium.
 */
import { BUILDINGS, O, SIZE, T, isInventory, isMilitary } from './defs.ts';
import { DIR_NE, DIR_NW, DIR_SE, DIR_W, hexDist, neighborTable, spiral } from './grid.ts';
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

/** Pola zajmowane przez budynek (glowne + dodatkowe dla duzych). */
export function buildingCells(map: MapData, pos: number, size: number): number[] {
  const out = [pos];
  if (size === SIZE.LARGE) {
    const t = nb(map);
    out.push(t[pos * 6 + DIR_W], t[pos * 6 + DIR_NW], t[pos * 6 + DIR_NE]);
  }
  return out;
}

/**
 * Czy mozna postawic budynek danego rodzaju. Zwraca true/false.
 * Flaga na SE(pos) musi juz stac (wlasna) albo dac sie postawic.
 */
export function canBuild(s: GameState, p: number, pos: number, kind: number): boolean {
  const map = s.map;
  const def = BUILDINGS[kind];
  if (!def || pos < 0 || pos >= map.w * map.h) return false;
  const t = nb(map);
  const flagPos = t[pos * 6 + DIR_SE];
  if (flagPos < 0) return false;
  if (map.roads[pos] !== 0) return false;
  const terrain = map.terrain[pos];
  if (def.size === SIZE.MINE) {
    if (terrain !== T.MOUNTAIN) return false;
  } else if (terrain !== T.GRASS) return false;
  const cells = buildingCells(map, pos, def.size);
  for (const c of cells) {
    if (c < 0 || isBorder(map, c)) return false;
    if (!ownedBy(map, c, p)) return false;
    if (!isClearObj(map.obj[c])) return false;
    if (c !== pos && map.roads[c] !== 0) return false;
    const tc = map.terrain[c];
    if (tc === T.WATER || tc === T.SNOW) return false;
  }
  // Wszyscy sasiedzi glownego pola: wlasni, bez flag (poza nasza SE) i budynkow.
  const h0 = map.height[pos];
  // Chata: roznica wysokosci 4, sasiedzi dowolni. Dom: 3, bez sasiednich budynkow i obcych flag.
  const strict = def.size === SIZE.LARGE || def.size === SIZE.MEDIUM;
  const maxDiff = strict ? 3 : 4;
  for (let d = 0; d < 6; d++) {
    const j = t[pos * 6 + d];
    if (j < 0 || !ownedBy(map, j, p)) return false;
    if (Math.abs(map.height[j] - h0) > maxDiff) return false;
    const o = map.obj[j];
    if (d !== DIR_SE && (o === O.BUILDING || o === O.BUILDING_PART) && !cells.includes(j)) {
      // Sasiednie budynki blokuja domy i duze budynki (chaty moga stac obok siebie).
      if (strict) return false;
    }
    if (d !== DIR_SE && o === O.FLAG && !cells.includes(j)) {
      // Flaga obok (inna niz nasza) nie przeszkadza chatom.
      if (strict) return false;
    }
  }
  if (map.obj[flagPos] === O.FLAG) {
    const f = s.flags[map.objId[flagPos]];
    if (!f || f.owner !== p || f.building >= 0) return false;
    return true;
  }
  // Flage trzeba postawic: pole flagi nie moze byc jednym z pol budynku.
  if (!canPlaceFlag(s, p, flagPos)) return false;
  return true;
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
