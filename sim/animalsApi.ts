/** Zapytania o zwierzeta dla mysliwego. */
import { hexDist } from './grid.ts';
import { removeAnimal } from './animals.ts';
import type { GameState } from './types.ts';

/** Id wolnych (nie sciganych) zwierzat w promieniu, posortowane wg odleglosci i id. */
export function animalsNear(s: GameState, pos: number, r: number): number[] {
  const w = s.map.w;
  const px = pos % w, py = (pos / w) | 0;
  const out: [number, number][] = [];
  for (const a of s.animals) {
    if (!a || a.hunter >= 0) continue;
    const d = hexDist(px, py, a.pos % w, (a.pos / w) | 0);
    if (d <= r) out.push([d, a.id]);
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return out.map((x) => x[1]);
}

/** Mysliwy upolowal zwierze (jesli nadal na nie polowal). */
export function removeAnimalById(s: GameState, id: number, hunter: number): boolean {
  const a = id >= 0 ? s.animals[id] : null;
  if (!a || a.hunter !== hunter) return false;
  removeAnimal(s, a);
  return true;
}
