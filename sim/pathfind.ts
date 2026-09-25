/**
 * A* po siatce pol (marsz poza drogami) i kopiec binarny z deterministycznym rozstrzyganiem remisow.
 * Bufory robocze sa globalne dla modulu - to pamiec podreczna, nie stan gry.
 */
import { hexDist, neighborTable } from './grid.ts';
import type { MapData } from './mapgen.ts';
import { walkCost } from './world.ts';

/** Kopiec minimalny par (klucz, wartosc); remis klucza -> mniejsza wartosc. */
export class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  private less(i: number, j: number): boolean {
    const a = this.keys[i], b = this.keys[j];
    return a < b || (a === b && this.vals[i] < this.vals[j]);
  }
  private swap(i: number, j: number): void {
    const k = this.keys[i]; this.keys[i] = this.keys[j]; this.keys[j] = k;
    const v = this.vals[i]; this.vals[i] = this.vals[j]; this.vals[j] = v;
  }
  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  /** Zdejmuje minimum; zwraca wartosc, klucz w lastKey. */
  lastKey = 0;
  pop(): number {
    const topV = this.vals[0];
    this.lastKey = this.keys[0];
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      const n = this.keys.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return topV;
  }
}

let gScore = new Int32Array(0);
let came = new Int8Array(0);
let stamp = new Int32Array(0);
let curStamp = 0;
const heap = new MinHeap();

function ensure(n: number): void {
  if (gScore.length < n) {
    gScore = new Int32Array(n);
    came = new Int8Array(n);
    stamp = new Int32Array(n);
    curStamp = 0;
  }
}

/**
 * Najkrotsza sciezka z `from` do `to` jako lista kierunkow albo null.
 * `passable(idx)` decyduje o przechodniosci (cel jest zawsze dopuszczony).
 */
export function findPath(
  map: MapData,
  from: number,
  to: number,
  passable: (idx: number) => boolean,
  maxNodes = 12000,
): number[] | null {
  if (from === to) return [];
  const n = map.w * map.h;
  ensure(n);
  curStamp++;
  if (curStamp > 0x7ffffff0) { stamp.fill(0); curStamp = 1; }
  const w = map.w;
  const tx = to % w, ty = (to / w) | 0;
  const nb = neighborTable(map.w, map.h);
  heap.clear();
  stamp[from] = curStamp;
  gScore[from] = 0;
  came[from] = -1;
  heap.push(hexDist(from % w, (from / w) | 0, tx, ty) * 8, from);
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    const f = heap.lastKey;
    const g = gScore[cur];
    // Pomijamy przeterminowane wpisy.
    if (f - hexDist(cur % w, (cur / w) | 0, tx, ty) * 8 > g) continue;
    if (cur === to) break;
    if (++expanded > maxNodes) return null;
    for (let d = 0; d < 6; d++) {
      const nx = nb[cur * 6 + d];
      if (nx < 0) continue;
      if (nx !== to && !passable(nx)) continue;
      const ng = g + walkCost(map, cur, nx);
      if (stamp[nx] === curStamp && gScore[nx] <= ng) continue;
      stamp[nx] = curStamp;
      gScore[nx] = ng;
      came[nx] = d;
      heap.push(ng + hexDist(nx % w, (nx / w) | 0, tx, ty) * 8, nx);
    }
  }
  if (stamp[to] !== curStamp) return null;
  const path: number[] = [];
  let c = to;
  while (c !== from) {
    const d = came[c];
    path.push(d);
    c = nb[c * 6 + ((d + 3) % 6)];
  }
  path.reverse();
  return path;
}
