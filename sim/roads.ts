/**
 * Flagi i drogi: stawianie, laczenie, dzielenie, rozbiorka.
 */
import { O, T } from './defs.ts';
import { opposite } from './grid.ts';
import { clearFlagGoods, rerouteFlags } from './goods.ts';
import { invalidateRoutes } from './routing.ts';
import { sendHome } from './serfs.ts';
import { carrierAfterSplit, releaseClaims } from './transport.ts';
import { FLAG_SLOTS, type Flag, type GameState, type Road } from './types.ts';
import { allocId, canPlaceFlag, isClearObj, isLandWalkable, neighbor, ownedBy, walkCost } from './world.ts';
import { cancelTransit } from './goods.ts';
import { findPath } from './pathfind.ts';

export const MAX_ROAD_LEN = 30;

function newFlag(s: GameState, p: number, pos: number): Flag {
  const id = allocId(s.flags, s.freeFlags);
  const f: Flag = {
    id, owner: p, pos,
    roads: [-1, -1, -1, -1, -1, -1],
    building: -1,
    slotGood: new Array(FLAG_SLOTS).fill(-1),
    slotDest: new Array(FLAG_SLOTS).fill(-1),
    slotDir: new Array(FLAG_SLOTS).fill(-1),
    slotClaim: new Array(FLAG_SLOTS).fill(-1),
    slotTime: new Array(FLAG_SLOTS).fill(0),
  };
  s.flags[id] = f;
  s.map.obj[pos] = O.FLAG;
  s.map.objId[pos] = id;
  s.map.objTimer[pos] = 0;
  return f;
}

/** Stawia flage (dzielac droge, jesli przez pole przechodzi). Zwraca id flagi albo -1. */
export function placeFlag(s: GameState, p: number, pos: number): number {
  if (!canPlaceFlag(s, p, pos)) return -1;
  const map = s.map;
  // Droga przez to pole? Musi byc wlasna.
  let split: Road | null = null;
  if (map.roads[pos] !== 0) {
    for (const r of s.roads) {
      if (r && r.cells.indexOf(pos) > 0 && r.cells.indexOf(pos) < r.cells.length - 1) { split = r; break; }
    }
    if (!split || split.owner !== p) return -1;
  }
  const f = newFlag(s, p, pos);
  if (split) splitRoad(s, split, f);
  invalidateRoutes(s, p);
  rerouteFlags(s, p);
  return f.id;
}

function newRoad(s: GameState, p: number, a: Flag, cells: number[], path: number[], water: boolean): Road {
  const map = s.map;
  const id = allocId(s.roads, s.freeRoads);
  let cost = 0;
  for (let i = 0; i + 1 < cells.length; i++) {
    if (water) cost += 10;
    else cost += (walkCost(map, cells[i], cells[i + 1]) + walkCost(map, cells[i + 1], cells[i])) >> 1;
  }
  const bId = map.objId[cells[cells.length - 1]];
  const road: Road = {
    id, owner: p, a: a.id, b: bId,
    dirA: path[0], dirB: opposite(path[path.length - 1]),
    path, cells, cost, water,
    carrier: -1, donkey: -1, load: 0,
  };
  s.roads[id] = road;
  a.roads[road.dirA] = id;
  s.flags[bId]!.roads[road.dirB] = id;
  for (let i = 0; i < path.length; i++) {
    map.roads[cells[i]] |= 1 << path[i];
    map.roads[cells[i + 1]] |= 1 << opposite(path[i]);
  }
  return road;
}

/**
 * Sprawdza sciezke drogi. Zwraca liste pol albo null. Pole koncowe musi byc wlasna flaga
 * albo miejscem, gdzie mozna ja postawic (`allowNewEnd`).
 */
export function validateRoad(s: GameState, p: number, start: number, dirs: number[], allowNewEnd = true): { cells: number[]; water: boolean } | null {
  const map = s.map;
  if (dirs.length < 1 || dirs.length > MAX_ROAD_LEN) return null;
  if (map.obj[start] !== O.FLAG) return null;
  const fa = s.flags[map.objId[start]];
  if (!fa || fa.owner !== p) return null;
  if (fa.roads[dirs[0]] >= 0) return null;
  if (fa.building >= 0 && dirs[0] === 4 /* NW = drzwi budynku */) return null;
  const cells = [start];
  let water = false;
  let land = false;
  let cur = start;
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    if (d < 0 || d > 5 || (d | 0) !== d) return null;
    const nx = neighbor(map, cur, d);
    if (nx < 0) return null;
    if (cells.includes(nx)) return null;
    const last = i === dirs.length - 1;
    if (!last) {
      if (!ownedBy(map, nx, p)) return null;
      if (map.roads[nx] !== 0) return null;
      if (!isClearObj(map.obj[nx])) return null;
      if (map.terrain[nx] === T.WATER) {
        if (!waterRoadCell(s, nx)) return null;
        water = true;
      } else if (isLandWalkable(map, nx)) land = true;
      else return null;
    }
    cells.push(nx);
    cur = nx;
  }
  if (water && land) return null;
  const end = cells[cells.length - 1];
  const inDir = opposite(dirs[dirs.length - 1]);
  if (map.obj[end] === O.FLAG) {
    const fb = s.flags[map.objId[end]];
    if (!fb || fb.owner !== p || fb.id === fa.id) return null;
    if (fb.roads[inDir] >= 0) return null;
    if (fb.building >= 0 && inDir === 4) return null;
  } else {
    if (!allowNewEnd) return null;
    if (map.roads[end] !== 0) return null;
    if (!canPlaceFlag(s, p, end)) return null;
  }
  // Droga wodna musi miec co najmniej jedno pole wody (ladowe konce).
  return { cells, water };
}

function waterRoadCell(s: GameState, idx: number): boolean {
  const map = s.map;
  const x = idx % map.w, y = (idx / map.w) | 0;
  return x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1;
}

/** Buduje droge z flagi na polu `start` wg kierunkow. Zwraca id drogi albo -1. */
export function buildRoad(s: GameState, p: number, start: number, dirs: number[]): number {
  const v = validateRoad(s, p, start, dirs);
  if (!v) return -1;
  const map = s.map;
  const end = v.cells[v.cells.length - 1];
  if (map.obj[end] !== O.FLAG) {
    if (placeFlag(s, p, end) < 0) return -1;
  }
  const fa = s.flags[map.objId[start]]!;
  for (let i = 1; i < v.cells.length - 1; i++) {
    if (map.obj[v.cells[i]] === O.SIGN) map.obj[v.cells[i]] = O.NONE;
  }
  const road = newRoad(s, p, fa, v.cells, dirs.slice(), v.water);
  invalidateRoutes(s, p);
  rerouteFlags(s, p);
  return road.id;
}

/** Dzieli droge nowa flaga lezaca na jej polu posrednim. */
function splitRoad(s: GameState, r: Road, f: Flag): void {
  const k = r.cells.indexOf(f.pos);
  const fa = s.flags[r.a]!;
  const fb = s.flags[r.b]!;
  // Zdejmij stara droge z flag i mapy (bez odsylania tragarzy).
  fa.roads[r.dirA] = -1;
  fb.roads[r.dirB] = -1;
  const map = s.map;
  for (let i = 0; i < r.path.length; i++) {
    map.roads[r.cells[i]] &= ~(1 << r.path[i]);
    map.roads[r.cells[i + 1]] &= ~(1 << opposite(r.path[i]));
  }
  s.roads[r.id] = null;
  s.freeRoads.push(r.id);
  const r1 = newRoad(s, r.owner, fa, r.cells.slice(0, k + 1), r.path.slice(0, k), r.water);
  const r2 = newRoad(s, r.owner, f, r.cells.slice(k), r.path.slice(k), r.water);
  // Tragarz i osiol przechodza na polowe, na ktorej sa.
  for (const sid of [r.carrier, r.donkey]) {
    if (sid < 0) continue;
    const serf = s.serfs[sid];
    if (!serf) continue;
    const pos = serf.pos;
    const to = serf.to;
    let target: Road;
    const in1 = r1.cells.includes(pos) && (to < 0 || r1.cells.includes(to));
    const in2 = r2.cells.includes(pos) && (to < 0 || r2.cells.includes(to));
    if (in1 && !in2) target = r1;
    else if (in2 && !in1) target = r2;
    else if (in1 && in2) target = serf.target === 1 ? r2 : r1; // stoi na nowej fladze
    else target = serf.target === 1 ? r2 : r1; // w budynku przy fladze koncowej
    if (sid === r.carrier) target.carrier = sid;
    else target.donkey = sid;
    carrierAfterSplit(s, serf, target);
  }
}

/** Usuwa droge; tragarze wracaja do domu, niesione towary przepadaja. */
export function removeRoad(s: GameState, rid: number): void {
  const r = s.roads[rid];
  if (!r) return;
  const map = s.map;
  const fa = s.flags[r.a];
  const fb = s.flags[r.b];
  if (fa) fa.roads[r.dirA] = -1;
  if (fb) fb.roads[r.dirB] = -1;
  for (let i = 0; i < r.path.length; i++) {
    map.roads[r.cells[i]] &= ~(1 << r.path[i]);
    map.roads[r.cells[i + 1]] &= ~(1 << opposite(r.path[i]));
  }
  for (const sid of [r.carrier, r.donkey]) {
    if (sid < 0) continue;
    const serf = s.serfs[sid];
    if (!serf) continue;
    releaseClaims(s, serf);
    if (serf.carry >= 0) {
      cancelTransit(s, serf.carryDest, serf.carry);
      serf.carry = -1;
      serf.carryDest = -1;
    }
    serf.anim = 0;
    serf.road = -1;
    sendHome(s, serf);
  }
  s.roads[rid] = null;
  s.freeRoads.push(rid);
  invalidateRoutes(s, r.owner);
  rerouteFlags(s, r.owner);
}

/** Usuwa flage razem z drogami i budynkiem. */
export function removeFlag(s: GameState, fid: number, destroyBuilding: (bid: number) => void): void {
  const f = s.flags[fid];
  if (!f) return;
  if (f.building >= 0) destroyBuilding(f.building);
  for (let d = 0; d < 6; d++) if (f.roads[d] >= 0) removeRoad(s, f.roads[d]);
  clearFlagGoods(s, f);
  const map = s.map;
  map.obj[f.pos] = O.NONE;
  map.objId[f.pos] = -1;
  s.flags[fid] = null;
  s.freeFlags.push(fid);
  invalidateRoutes(s, f.owner);
  rerouteFlags(s, f.owner);
}

/** Id drogi przechodzacej przez pole (pole posrednie) albo -1. */
export function roadAt(s: GameState, pos: number): number {
  if (s.map.roads[pos] === 0) return -1;
  for (const r of s.roads) {
    if (!r) continue;
    const k = r.cells.indexOf(pos);
    if (k > 0 && k < r.cells.length - 1) return r.id;
  }
  return -1;
}

/**
 * Najkrotsza mozliwa droga (lista kierunkow) z flagi na polu `from` do pola `to`
 * (istniejacej wlasnej flagi albo miejsca na nowa). null gdy sie nie da.
 */
export function findRoadPath(s: GameState, p: number, from: number, to: number): number[] | null {
  const map = s.map;
  if (from === to) return null;
  const endIsFlag = map.obj[to] === O.FLAG;
  if (!endIsFlag && !canPlaceFlag(s, p, to)) return null;
  const path = findPath(map, from, to, (i) =>
    ownedBy(map, i, p) && map.roads[i] === 0 && isClearObj(map.obj[i]) && isLandWalkable(map, i), 4000);
  if (!path || path.length > MAX_ROAD_LEN) return null;
  return validateRoad(s, p, from, path) ? path : null;
}
