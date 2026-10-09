/**
 * Podworko budynku: niskie sprzety przed i obok budynku (pieniek, sagi, koziol, plotki, beczki) leza na terenie,
 * a sciany stoja na poziomie budynku. Wierzcholki modelu niosa wage podworka (druga warstwa UV z Blendera,
 * Model.yard w art/scripts/lib.py), shader modeli przesuwa je w pionie ku terenowi (YARD_VERTEX w scene.ts).
 * Sceny pracy licza ta sama wysokosc z obrysu konstrukcji zapisanego przy budowie modeli (art/models/yards.json),
 * a gra stawia schody przed glownymi drzwiami zapisanymi tamze.
 */
import yards from '../../art/models/yards.json';

/** Prostokat obrysu konstrukcji w ukladzie modelu przed obrotem: x0, y0, x1, y1. */
export type Rect = readonly number[];

/** Glowne drzwi modelu w ukladzie modelu przed obrotem: srodek progu (x, y na przedniej scianie), wysokosc progu z, szerokosc w. */
export interface Door { x: number; y: number; z: number; w: number }

/** Jak YARD_NEAR, YARD_FAR w art/scripts/lib.py. */
const NEAR = 0.03;
const FAR = 0.12;

const DATA = yards as Record<string, { rects: number[][]; door: number[] | null }>;

/** Obrys konstrukcji modelu (np. 'building_2') albo null - model bez podworka. */
export function yardRects(model: string): readonly Rect[] | null {
  return DATA[model]?.rects ?? null;
}

/** Glowne drzwi modelu albo null (studnia, otwarta szopa, plac budowy). */
export function doorOf(model: string): Door | null {
  const d = DATA[model]?.door;
  return d ? { x: d[0], y: d[1], z: d[2], w: d[3] } : null;
}

/** Waga podworka 0..1 w punkcie (x, y) ukladu modelu - jak yard_weight w art/scripts/lib.py. */
export function yardWeight(rects: readonly Rect[], x: number, y: number): number {
  let d = 1;
  for (const r of rects) d = Math.min(d, Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - y, 0, y - r[3])));
  const t = Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
  return t * t * (3 - 2 * t);
}
