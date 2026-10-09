/**
 * Drogi omijajace przeszkody lagodnym lukiem: srodek drogi na polu jest przesuniety w poprzek drogi, gdy przez pole
 * rosnie drzewo (droga moze przez nie przejsc, sim/world.ts: isRoadPassable) albo gdy obok stoi budynek, ktorego model
 * wystaje nad droge. Z tego samego przesuniecia korzystaja teren (rysowanie drogi, client/render/cells.ts) i postacie
 * chodzace po drodze (EntitiesRenderer.wp). Pola flag zostaja na miejscu - tam droga sie zaczyna i konczy.
 */
import { BUILDINGS, O, isTree } from '../../sim/defs.ts';
import type { GameState } from '../../sim/types.ts';
import { ROW_H } from './coords.ts';
import { objectSpot } from './mapObjects.ts';
import { BROT, placement } from './placement.ts';
import { yardRects, type Rect } from './yard.ts';

/** Kierunki DIR_E..DIR_NE w swiecie (x, z) - jak DIRV w shaderze terenu. */
const DIRS: readonly [number, number][] = [[1, 0], [0.5, ROW_H], [-0.5, ROW_H], [-1, 0], [-0.5, -ROW_H], [0.5, -ROW_H]];
/** Najmniejsza odleglosc srodka drogi od pnia (polowa szerokosci drogi z brzegiem i pien). */
const CLEAR_TREE = 0.2;
/** Najmniejsza odleglosc srodka drogi od sciany budynku (polowa szerokosci drogi z brzegiem). */
const CLEAR_WALL = 0.15;
/** Najwieksze przesuniecie srodka drogi. */
const MAX_BEND = 0.3;
const COS = Math.cos(BROT), SIN = Math.sin(BROT);
const RECTS = BUILDINGS.map((_, k) => yardRects(`building_${k}`));

/** Czy obiekt pola przepuszcza droge, ktora go omija (drzewo, sadzonka, pieniek). */
export function bendsRoad(o: number): boolean {
  return isTree(o) || o === O.STUMP;
}

interface Wall { x: number; z: number; s: number; rects: readonly Rect[] }

/** Odleglosc punktu (swiat) od obrysu budynku (prostokaty konstrukcji modelu, jak podworka). */
function wallDist(w: Wall, px: number, pz: number): number {
  // Odwrotnosc local() z placement.ts: przesuniecie w swiecie -> uklad modelu (przed skala).
  const rx = (px - w.x) / w.s, ry = -(pz - w.z) / w.s;
  const lx = rx * COS + ry * SIN, ly = -rx * SIN + ry * COS;
  let d = Infinity;
  for (const r of w.rects) d = Math.min(d, Math.hypot(Math.max(r[0] - lx, 0, lx - r[2]), Math.max(r[1] - ly, 0, ly - r[3])));
  return d * w.s;
}

const walls: Wall[] = [];

/** Przesuniecie srodka drogi na polu i (swiat x, z); false - bez przesuniecia (out = [0, 0]). */
export function roadBend(s: GameState, i: number, out: [number, number]): boolean {
  out[0] = out[1] = 0;
  const m = s.map;
  const bits = m.roads[i] & 63;
  if (!bits || m.obj[i] === O.FLAG) return false;
  const x = i % m.w, y = (i / m.w) | 0;
  const cx = x + (y & 1) * 0.5, cz = y * ROW_H;
  // Budynki w promieniu 2 pol (model duzego budynku z basztami siega dalej niz sasiednie pole).
  walls.length = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (m.obj[j] !== O.BUILDING) continue;
      const b = s.buildings[m.objId[j]];
      const rects = b ? RECTS[b.kind] : null;
      if (!b || !rects) continue;
      const pl = placement(BUILDINGS[b.kind].size);
      walls.push({ x: nx + (ny & 1) * 0.5 + pl.ox, z: ny * ROW_H + pl.oz, s: pl.s, rects });
    }
  }
  const tree = bendsRoad(m.obj[i]) ? objectSpot(m, i) : null;
  if (!walls.length && !tree) return false;
  const dist = (px: number, pz: number) => {
    let dd = Infinity;
    for (const w of walls) dd = Math.min(dd, wallDist(w, px, pz) - CLEAR_WALL);
    if (tree) dd = Math.min(dd, Math.hypot(px - tree.x, pz - tree.z) - CLEAR_TREE);
    return dd;
  };
  if (dist(cx, cz) >= 0) return false;
  // Os drogi: od kierunku wejscia do wyjscia (przy jednym kierunku - wzdluz niego); przesuniecie w poprzek niej.
  let ax = 0, az = 0, n = 0;
  for (let k = 0; k < 6; k++) {
    if (!(bits & (1 << k))) continue;
    const sg = n++ === 0 ? 1 : -1;
    ax += DIRS[k][0] * sg;
    az += DIRS[k][1] * sg;
  }
  const len = Math.hypot(ax, az) || 1;
  const px = -az / len, pz = ax / len;
  // Najmniejsze przesuniecie (w jedna albo druga strone), przy ktorym droga mija przeszkody; inaczej najlepsze.
  let best = 0, bestD = -Infinity;
  for (let t = 0.02; t <= MAX_BEND + 1e-6; t += 0.02) {
    for (const sg of [1, -1]) {
      const dd = dist(cx + px * t * sg, cz + pz * t * sg);
      if (dd >= 0) {
        out[0] = px * t * sg;
        out[1] = pz * t * sg;
        return true;
      }
      if (dd > bestD) { bestD = dd; best = t * sg; }
    }
  }
  out[0] = px * best;
  out[1] = pz * best;
  return best !== 0;
}
