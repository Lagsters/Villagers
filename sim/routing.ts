/**
 * Trasowanie po grafie flag. Dla flagi docelowej liczymy (Dijkstra od celu) dla kazdej flagi
 * kierunek, w ktorym trzeba wyjsc, i odleglosc. Tablice sa pamiecia podreczna (pole `_routes`
 * gracza), uniewaznana przy kazdej zmianie sieci drog; wynik zalezy wylacznie od stanu.
 */
import { MinHeap } from './pathfind.ts';
import type { GameState, PlayerState } from './types.ts';

/** Koszt przejscia przez flage (zniecheca do tras przez wiele flag). */
const FLAG_COST = 2;
export const UNREACHABLE = 0x3fffffff;

export interface RouteTable {
  dir: Int8Array;
  dist: Int32Array;
}

interface RouteCache {
  ver: number;
  flagsLen: number;
  tables: Map<number, RouteTable>;
}

type PlayerWithCache = PlayerState & { _routes?: RouteCache };

const heap = new MinHeap();

function cacheFor(s: GameState, p: number): RouteCache {
  const pl = s.players[p] as PlayerWithCache;
  let c = pl._routes;
  if (!c || c.ver !== pl.netVersion || c.flagsLen !== s.flags.length) {
    c = { ver: pl.netVersion, flagsLen: s.flags.length, tables: new Map() };
    pl._routes = c;
  }
  return c;
}

/** Uniewaznia trasy gracza (po zmianie sieci). */
export function invalidateRoutes(s: GameState, p: number): void {
  s.players[p].netVersion++;
}

/**
 * Tablica tras do flagi `dest`. walkers = true pomija drogi wodne (piesi nie plyna).
 */
export function routeTo(s: GameState, p: number, dest: number, walkers: boolean): RouteTable {
  const cache = cacheFor(s, p);
  const key = dest * 2 + (walkers ? 1 : 0);
  let t = cache.tables.get(key);
  if (t) return t;
  const n = s.flags.length;
  t = { dir: new Int8Array(n).fill(-1), dist: new Int32Array(n).fill(UNREACHABLE) };
  const destFlag = s.flags[dest];
  if (destFlag && destFlag.owner === p) {
    t.dist[dest] = 0;
    heap.clear();
    heap.push(0, dest);
    while (heap.size > 0) {
      const f = heap.pop();
      const d0 = heap.lastKey;
      if (d0 > t.dist[f]) continue;
      const flag = s.flags[f]!;
      for (let dir = 0; dir < 6; dir++) {
        const rid = flag.roads[dir];
        if (rid < 0) continue;
        const road = s.roads[rid]!;
        if (walkers && road.water) continue;
        const other = road.a === f ? road.b : road.a;
        const nd = d0 + road.cost + FLAG_COST;
        if (nd < t.dist[other]) {
          t.dist[other] = nd;
          t.dir[other] = road.a === other ? road.dirA : road.dirB;
          heap.push(nd, other);
        }
      }
    }
  }
  cache.tables.set(key, t);
  return t;
}

export function flagDist(s: GameState, p: number, from: number, to: number, walkers: boolean): number {
  if (from === to) return 0;
  return routeTo(s, p, to, walkers).dist[from];
}

/**
 * Lista kierunkow marszu po drogach z flagi `from` do flagi `to` (piesi) albo null.
 */
export function walkRoute(s: GameState, p: number, from: number, to: number): number[] | null {
  if (from === to) return [];
  const t = routeTo(s, p, to, true);
  if (t.dist[from] >= UNREACHABLE) return null;
  const out: number[] = [];
  let f = from;
  let guard = 0;
  while (f !== to) {
    if (++guard > 10000) return null;
    const d = t.dir[f];
    const flag = s.flags[f];
    const road = flag && d >= 0 ? s.roads[flag.roads[d]] : null;
    if (!road) return null;
    if (road.a === f) {
      for (const x of road.path) out.push(x);
      f = road.b;
    } else {
      for (let i = road.path.length - 1; i >= 0; i--) out.push((road.path[i] + 3) % 6);
      f = road.a;
    }
  }
  return out;
}
