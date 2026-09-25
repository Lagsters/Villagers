/**
 * Generator mapy z ziarna. Wylacznie arytmetyka calkowita, wiec kazdy peer dostaje identyczna mape.
 */
import { O, RES, T, isWalkableTerrain } from './defs.ts';
import { hexDist, neighborTable, spiral } from './grid.ts';
import { hash3, hashString, randInt, seedRng, type RngHolder } from './rng.ts';

export interface MapData {
  w: number;
  h: number;
  height: Uint8Array;
  terrain: Uint8Array;
  obj: Uint8Array;
  /** licznik wzrostu / dane obiektu (np. zloze na znaku geologa) */
  objTimer: Uint16Array;
  /** id flagi lub budynku dla O.FLAG/O.BUILDING/O.BUILDING_PART, inaczej -1 */
  objId: Int16Array;
  /** wlasciciel terytorium: 0 = niczyje, p+1 = gracz p */
  owner: Uint8Array;
  /** maska drog: bit d = krawedz w kierunku d */
  roads: Uint8Array;
  res: Uint8Array;
  resAmt: Uint8Array;
}

export const SEA_HEIGHT = 4;
export const MAX_HEIGHT = 31;

/** Normalizacja kodu mapy: wielkie litery i cyfry, maks. 12 znakow. */
export function normalizeMapCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return c.length > 0 ? c : 'DOLINA';
}

export function mapSeed(code: string): number {
  return hashString(normalizeMapCode(code));
}

/** Szum wartosci 0..65535 na siatce o boku `cell`, interpolacja smoothstep w fixed-point. */
function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = Math.floor(((x - gx * cell) * 65536) / cell);
  const fy = Math.floor(((y - gy * cell) * 65536) / cell);
  const sx = smooth(fx);
  const sy = smooth(fy);
  const v00 = hash3(seed, gx, gy) & 0xffff;
  const v10 = hash3(seed, gx + 1, gy) & 0xffff;
  const v01 = hash3(seed, gx, gy + 1) & 0xffff;
  const v11 = hash3(seed, gx + 1, gy + 1) & 0xffff;
  const a = v00 + Math.floor(((v10 - v00) * sx) / 65536);
  const b = v01 + Math.floor(((v11 - v01) * sx) / 65536);
  return a + Math.floor(((b - a) * sy) / 65536);
}

/** smoothstep dla t w 0..65536: t*t*(3-2t) */
function smooth(t: number): number {
  return Math.floor((Math.floor((t * t) / 65536) * (3 * 65536 - 2 * t)) / 65536);
}

/** Szum wielooktawowy 0..65535. Wspolrzedna x uwzglednia przesuniecie wierszy heksow (x2). */
function fbm(seed: number, x2: number, y2: number, base: number): number {
  const n1 = valueNoise(seed, x2, y2, base * 2);
  const n2 = valueNoise(seed + 101, x2, y2, base);
  const n3 = valueNoise(seed + 202, x2, y2, Math.max(2, base >> 1));
  return Math.floor((n1 * 55 + n2 * 30 + n3 * 15) / 100);
}

/** Wartosc progu, ponizej ktorej lezy `pct` procent wartosci (histogram 256 kubelkow). */
function percentile(values: Uint16Array, pct: number): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i] >> 8]++;
  const target = Math.floor((values.length * pct) / 100);
  let acc = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc >= target) return b << 8;
  }
  return 65535;
}

export interface GeneratedMap {
  map: MapData;
  starts: number[];
}

export function createEmptyMap(w: number, h: number): MapData {
  const n = w * h;
  return {
    w,
    h,
    height: new Uint8Array(n),
    terrain: new Uint8Array(n),
    obj: new Uint8Array(n),
    objTimer: new Uint16Array(n),
    objId: new Int16Array(n).fill(-1),
    owner: new Uint8Array(n),
    roads: new Uint8Array(n),
    res: new Uint8Array(n),
    resAmt: new Uint8Array(n),
  };
}

export function isBorder(map: MapData, idx: number): boolean {
  const x = idx % map.w;
  const y = (idx / map.w) | 0;
  return x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
}

/**
 * Generuje mape. `players` - liczba pozycji startowych do wyznaczenia.
 */
export function generateMap(code: string, size: number, players: number): GeneratedMap {
  const seed = mapSeed(code);
  const w = size;
  const h = size;
  const n = w * h;
  const map = createEmptyMap(w, h);
  const rng: RngHolder = seedRng(seed ^ 0x51ed270b);

  const hv = new Uint16Array(n);
  const moist = new Uint16Array(n);
  const forest = new Uint16Array(n);
  const rock = new Uint16Array(n);
  const ore = new Uint16Array(n);
  const base = size >= 128 ? 16 : 12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const x2 = x * 2 + (y & 1); // wspolrzedne w polowkach pola
      const y2 = y * 2;
      let v = fbm(seed, x2, y2, base * 2);
      // Lagodny spadek przy krawedzi mapy - brzegi czesciej sa woda.
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge < 6) v = Math.floor((v * (40 + edge * 10)) / 100);
      hv[i] = v;
      moist[i] = fbm(seed + 7777, x2, y2, base * 2);
      forest[i] = fbm(seed + 3131, x2, y2, 10);
      rock[i] = valueNoise(seed + 4242, x2, y2, 6);
      ore[i] = valueNoise(seed + 9191, x2, y2, 8);
    }
  }

  const sea = percentile(hv, 22);
  const mountain = percentile(hv, 82);
  const snow = percentile(hv, 96);
  const dry = percentile(moist, 9);

  for (let i = 0; i < n; i++) {
    const v = hv[i];
    let t: number;
    let height: number;
    if (v < sea) {
      t = T.WATER;
      height = SEA_HEIGHT;
    } else if (v >= snow) {
      t = T.SNOW;
      height = 26 + Math.min(5, Math.floor(((v - snow) * 5) / Math.max(1, 65535 - snow)));
    } else if (v >= mountain) {
      t = T.MOUNTAIN;
      height = 15 + Math.floor(((v - mountain) * 11) / Math.max(1, snow - mountain));
    } else {
      t = moist[i] < dry ? T.DESERT : T.GRASS;
      // Laka: 5..14, lagodnie falujaca.
      height = 5 + Math.floor(((v - sea) * 10) / Math.max(1, mountain - sea));
    }
    map.terrain[i] = t;
    map.height[i] = Math.min(MAX_HEIGHT, height);
  }

  // Krawedz swiata: nieprzechodnia.
  for (let i = 0; i < n; i++) if (isBorder(map, i)) { map.terrain[i] = T.WATER; map.height[i] = SEA_HEIGHT; }

  smoothLandHeights(map);

  // Zloza w gorach.
  for (let i = 0; i < n; i++) {
    if (map.terrain[i] !== T.MOUNTAIN) continue;
    const o = ore[i];
    const r = hash3(seed, i, 77) % 100;
    let res: number = RES.NONE;
    if (o < 22000) res = RES.COAL;
    else if (o < 36000) res = RES.IRON;
    else if (o < 44000) res = RES.STONE;
    else if (o < 52000) res = r < 70 ? RES.COAL : RES.NONE;
    else if (o > 58000) res = RES.GOLD;
    if (res !== RES.NONE) {
      map.res[i] = res;
      map.resAmt[i] = 6 + (hash3(seed, i, 78) % 10);
    }
  }

  // Ryby: woda blisko brzegu.
  const nb = neighborTable(w, h);
  for (let i = 0; i < n; i++) {
    if (map.terrain[i] !== T.WATER || isBorder(map, i)) continue;
    let nearLand = false;
    for (let d = 0; d < 6 && !nearLand; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && map.terrain[j] !== T.WATER) nearLand = true;
    }
    map.res[i] = RES.FISH;
    map.resAmt[i] = nearLand ? 10 : 5;
  }

  // Lasy i skaly.
  const forestT = percentile(forest, 62);
  for (let i = 0; i < n; i++) {
    if (map.terrain[i] !== T.GRASS || isBorder(map, i)) continue;
    const r = hash3(seed, i, 11) % 100;
    if (forest[i] > forestT && r < 55) {
      map.obj[i] = O.TREE;
    } else if (rock[i] > 60000 && r < 45) {
      map.obj[i] = O.STONE1 + 2 + (hash3(seed, i, 12) % 4);
    } else if (r < 2) {
      map.obj[i] = O.TREE; // pojedyncze drzewa
    }
  }
  // Skaly takze na zboczach gor.
  for (let i = 0; i < n; i++) {
    if (map.terrain[i] === T.MOUNTAIN && map.obj[i] === O.NONE && hash3(seed, i, 13) % 100 < 4) {
      map.obj[i] = O.STONE1 + 3 + (hash3(seed, i, 14) % 3);
    }
  }

  const starts = pickStarts(map, players, rng);
  for (const s of starts) prepareStart(map, s, rng);
  return { map, starts };
}

/** Wygladza wysokosci ladu, zeby laki nadawaly sie pod zabudowe. */
function smoothLandHeights(map: MapData): void {
  const { w, h } = map;
  const nb = neighborTable(w, h);
  const tmp = new Uint8Array(map.height);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < w * h; i++) {
      const t = map.terrain[i];
      if (t !== T.GRASS && t !== T.DESERT) continue;
      let sum = map.height[i] * 2;
      let cnt = 2;
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        if (j < 0) continue;
        const tj = map.terrain[j];
        if (tj === T.WATER) continue;
        sum += Math.min(map.height[j], 16);
        cnt++;
      }
      tmp[i] = Math.max(SEA_HEIGHT + 1, Math.floor((sum + (cnt >> 1)) / cnt));
    }
    for (let i = 0; i < w * h; i++) {
      const t = map.terrain[i];
      if (t === T.GRASS || t === T.DESERT) map.height[i] = tmp[i];
    }
  }
}

/** Czy wokol pola da sie ustawic zamek z zapasem miejsca. */
function startCandidate(map: MapData, idx: number, scratch: number[]): boolean {
  const { w, h } = map;
  const x = idx % w;
  const y = (idx / w) | 0;
  if (x < 8 || y < 8 || x >= w - 8 || y >= h - 8) return false;
  const h0 = map.height[idx];
  spiral(w, h, x, y, 3, scratch);
  if (scratch.length < 37) return false;
  for (const j of scratch) {
    if (map.terrain[j] !== T.GRASS) return false;
    if (Math.abs(map.height[j] - h0) > 3) return false;
  }
  return true;
}

/**
 * Etykiety spojnych obszarow ladu (pola przechodnie, 6-sasiedztwo). Zwraca [etykiety, etykieta najwiekszego].
 * Starty lezace na roznych wyspach uniemozliwilyby zwyciestwo, wiec wszystkie losujemy z najwiekszego.
 */
function landComponents(map: MapData): [Int32Array, number] {
  const { w, h } = map;
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const nb = neighborTable(w, h);
  const stack: number[] = [];
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] >= 0 || isBorder(map, i) || !isWalkableTerrain(map.terrain[i])) continue;
    const id = next++;
    let size = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      for (let d = 0; d < 6; d++) {
        const j = nb[c * 6 + d];
        if (j < 0 || label[j] >= 0 || isBorder(map, j) || !isWalkableTerrain(map.terrain[j])) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  return [label, best];
}

function pickStarts(map: MapData, players: number, rng: RngHolder): number[] {
  const { w, h } = map;
  const scratch: number[] = [];
  const cands: number[] = [];
  const [label, main] = landComponents(map);
  for (let i = 0; i < w * h; i += 1) {
    if (label[i] === main && startCandidate(map, i, scratch)) cands.push(i);
  }
  if (cands.length === 0) {
    // Awaryjnie: splaszcz teren w wybranych punktach.
    for (let p = 0; p < players; p++) {
      const x = Math.floor(((p % 3) + 1) * w / 4);
      const y = Math.floor((Math.floor(p / 3) + 1) * h / 4);
      cands.push(y * w + x);
    }
    for (const c of cands) forceGrass(map, c);
  }
  const starts: number[] = [];
  const cx = w >> 1;
  const cy = h >> 1;
  // Pierwszy start: kandydat najdalszy od srodka (z losowym przesunieciem remisow).
  let best = -1;
  let bestScore = -1;
  const off = randInt(rng, cands.length);
  for (let k = 0; k < cands.length; k++) {
    const c = cands[(k + off) % cands.length];
    const d = hexDist(c % w, (c / w) | 0, cx, cy);
    if (d > bestScore) { bestScore = d; best = c; }
  }
  starts.push(best);
  while (starts.length < players) {
    best = -1;
    bestScore = -1;
    for (let k = 0; k < cands.length; k++) {
      const c = cands[(k + off) % cands.length];
      let md = 1 << 30;
      for (const s of starts) md = Math.min(md, hexDist(c % w, (c / w) | 0, s % w, (s / w) | 0));
      if (md > bestScore) { bestScore = md; best = c; }
    }
    if (best < 0 || bestScore < 6) {
      // Za malo miejsca: wymus start w wolnym punkcie siatki.
      const p = starts.length;
      const c = Math.floor(h / 5 + (p % 4) * h / 5) * w + Math.floor(w / 5 + Math.floor(p / 4) * w / 2);
      forceGrass(map, c);
      starts.push(c);
    } else {
      starts.push(best);
    }
  }
  return starts;
}

function forceGrass(map: MapData, idx: number): void {
  const x = idx % map.w;
  const y = (idx / map.w) | 0;
  const h0 = Math.max(SEA_HEIGHT + 2, Math.min(12, map.height[idx]));
  for (const j of spiral(map.w, map.h, x, y, 5)) {
    if (isBorder(map, j)) continue;
    map.terrain[j] = T.GRASS;
    map.height[j] = h0;
    map.obj[j] = O.NONE;
    map.res[j] = RES.NONE;
    map.resAmt[j] = 0;
  }
}

/** Gwarantuje wokol startu wolne miejsce, las, skaly i gory. */
function prepareStart(map: MapData, s: number, rng: RngHolder): void {
  const { w, h } = map;
  const x = s % w;
  const y = (s / w) | 0;
  const area = spiral(w, h, x, y, 14);
  // Wolne miejsce pod zamek i pierwsze budynki.
  for (const j of spiral(w, h, x, y, 4)) {
    if (map.obj[j] !== O.NONE) map.obj[j] = O.NONE;
  }
  let trees = 0;
  let stones = 0;
  let mountains = 0;
  for (const j of area) {
    if (map.obj[j] === O.TREE) trees++;
    if (map.obj[j] >= O.STONE1 && map.obj[j] <= O.STONE6) stones++;
    if (map.terrain[j] === T.MOUNTAIN) mountains++;
  }
  const ring = spiral(w, h, x, y, 11).filter((j) => hexDist(j % w, (j / w) | 0, x, y) >= 6);
  // Dosadz las w jednym sektorze.
  if (trees < 25) {
    const c = ring[randInt(rng, ring.length)];
    for (const j of spiral(w, h, c % w, (c / w) | 0, 3)) {
      if (map.terrain[j] === T.GRASS && map.obj[j] === O.NONE && hexDist(j % w, (j / w) | 0, x, y) >= 5) map.obj[j] = O.TREE;
    }
  }
  if (stones < 3) {
    const c = ring[randInt(rng, ring.length)];
    for (const j of spiral(w, h, c % w, (c / w) | 0, 1)) {
      if (map.terrain[j] === T.GRASS && map.obj[j] === O.NONE && hexDist(j % w, (j / w) | 0, x, y) >= 5) map.obj[j] = O.STONE6;
    }
  }
  if (mountains < 6) {
    // Maly masyw gorski z weglem i zelazem.
    const far = spiral(w, h, x, y, 13).filter((j) => hexDist(j % w, (j / w) | 0, x, y) >= 10 && !isBorder(map, j));
    const c = far[randInt(rng, far.length)];
    const cxm = c % w;
    const cym = (c / w) | 0;
    for (const j of spiral(w, h, cxm, cym, 2)) {
      if (isBorder(map, j) || hexDist(j % w, (j / w) | 0, x, y) < 8) continue;
      map.terrain[j] = T.MOUNTAIN;
      map.height[j] = Math.min(MAX_HEIGHT, Math.max(map.height[j], 15) + 2);
      map.obj[j] = O.NONE;
      const k = hexDist(j % w, (j / w) | 0, cxm, cym);
      map.res[j] = k === 0 ? RES.GOLD : (j & 1) === 0 ? RES.COAL : RES.IRON;
      map.resAmt[j] = 10;
    }
  }
}

export function isWalkable(map: MapData, idx: number): boolean {
  return !isBorder(map, idx) && isWalkableTerrain(map.terrain[idx]);
}
