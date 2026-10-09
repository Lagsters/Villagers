/** Ustawienie modelu budynku na mapie (wspolne dla rysowania budynkow i drog omijajacych budynki). */
import { SIZE } from '../../sim/defs.ts';

/** Budynki sa obrocone o 30 stopni (drzwi na flage). */
export const BROT = Math.PI / 6;
const COS30 = Math.cos(BROT);
const SIN30 = Math.sin(BROT);

/** Punkt lokalny modelu budynku (uklad Blendera x, y) -> przesuniecie w swiecie (x, z). */
export function local(lx: number, ly: number): [number, number] {
  const rx = lx * COS30 - ly * SIN30;
  const ry = lx * SIN30 + ly * COS30;
  return [rx, -ry];
}

/**
 * Ustawienie modelu budynku wzgledem jego pola (jak w pierwowzorze): budynek wiekszy niz pole,
 * przesuniety ku swojej fladze (pole SE), tak ze drzwi wychodza prawie wprost na flage, a reszta
 * budynku siega w gore i w lewo. Kazdy budynek stoi na jednym polu; duze wizualnie wychodza poza nie.
 */
export const FLAG_DIR = local(0, -1); // kierunek z pola budynku do jego flagi (SE)
const PLACEMENT: Record<number, { s: number; d: number }> = {
  [SIZE.SMALL]: { s: 1.7, d: 0.22 },
  [SIZE.MEDIUM]: { s: 1.55, d: 0.2 },
  [SIZE.MINE]: { s: 1.6, d: 0.18 },
  [SIZE.LARGE]: { s: 1.3, d: 0.1 },
};
export function placement(size: number): { s: number; ox: number; oz: number } {
  const pl = PLACEMENT[size] ?? PLACEMENT[SIZE.SMALL];
  return { s: pl.s, ox: FLAG_DIR[0] * pl.d, oz: FLAG_DIR[1] * pl.d };
}
