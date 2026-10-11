/** Przeliczenia pole mapy -> wspolrzedne swiata three.js. */
import { T } from '../../sim/defs.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { SEA_HEIGHT } from '../../sim/mapgen.ts';

export const ROW_H = Math.sqrt(3) / 2;
export const H_SCALE = 0.22;
/** Skala przesuniecia srodka drogi omijajacej drzewo w teksturze (client/render/cells.ts): bajt = 128 + BEND_K * v. */
export const BEND_K = 300;

/**
 * Pole, ktorego rodzaj terenu rysuje sie w miejscu pola idx. Skrajny pierscien mapy jest w symulacji woda (krawedz
 * swiata); jego pole przy ladzie pokazuje sasiada w glab mapy jako plaze (shownHeight), ktora schodzi do morza
 * dopiero za krawedzia (client/render/outland.ts). Inaczej wzdluz calej krawedzi biegnie prosta linia brzegu.
 */
export function shownIdx(map: MapData, idx: number): number {
  const x = idx % map.w, y = (idx / map.w) | 0;
  if (x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1) return idx;
  const j = Math.min(map.h - 2, Math.max(1, y)) * map.w + Math.min(map.w - 2, Math.max(1, x));
  return map.terrain[j] === T.WATER ? idx : j;
}

/** Wysokosc rysowana w miejscu pola idx (shownIdx): pole pierscienia przy ladzie lezy tuz nad morzem. */
export function shownHeight(map: MapData, idx: number): number {
  const j = shownIdx(map, idx);
  return j === idx ? map.height[idx] : Math.min(map.height[j], SEA_HEIGHT + 0.6);
}

/** Czy pole pierscienia mapy rysuje sie jako lad (shownIdx). */
export function shownCoast(map: MapData, idx: number): boolean {
  return shownIdx(map, idx) !== idx;
}

export function vx(x: number, y: number): number {
  return x + (y & 1) * 0.5;
}
export function vz(y: number): number {
  return y * ROW_H;
}
export function vy(map: MapData, idx: number): number {
  return map.height[idx] * H_SCALE;
}

export function worldOf(map: MapData, idx: number, out: { x: number; y: number; z: number }): typeof out {
  const x = idx % map.w;
  const y = (idx / map.w) | 0;
  out.x = vx(x, y);
  out.y = map.height[idx] * H_SCALE;
  out.z = vz(y);
  return out;
}

/** Najblizsze pole dla punktu (wx, wz) na plaszczyznie. */
export function nearestIdx(map: MapData, wx: number, wz: number): number {
  const ry = Math.round(wz / ROW_H);
  let best = -1;
  let bd = Infinity;
  for (let y = ry - 1; y <= ry + 1; y++) {
    if (y < 0 || y >= map.h) continue;
    const rx = Math.round(wx - (y & 1) * 0.5);
    for (let x = rx - 1; x <= rx + 1; x++) {
      if (x < 0 || x >= map.w) continue;
      const dx = vx(x, y) - wx;
      const dz = vz(y) - wz;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = y * map.w + x; }
    }
  }
  return best;
}

/**
 * Wysokosc terenu w punkcie (wx, wz) - dokladnie na siatce terenu (client/render/terrain.ts): pas miedzy
 * wierszem r a r + 1 w ukosnych wspolrzednych (q, t), w ktorych pola obu wierszy leza na calkowitych q;
 * kazdy kwadrat [i, i + 1] dzieli przekatna na trojkat E/SE pola (i, r) i trojkat SW/SE pola (i + 1, r).
 * Ten sam rachunek liczy shader modeli (GROUND_GLSL w client/render/scene.ts) - zmieniac razem.
 */
export function groundHeight(map: MapData, wx: number, wz: number): number {
  if (nearestIdx(map, wx, wz) < 0) return 0;
  const rf = wz / ROW_H;
  const r = Math.floor(rf);
  const t = rf - r;
  const odd = r & 1;
  const q = wx - odd * 0.5 - 0.5 * t;
  const i = Math.floor(q);
  const f = q - i;
  const h = (x: number, y: number) => map.height[Math.min(map.h - 1, Math.max(0, y)) * map.w + Math.min(map.w - 1, Math.max(0, x))] * H_SCALE;
  if (f + t <= 1) return (1 - f - t) * h(i, r) + f * h(i + 1, r) + t * h(i + odd, r + 1);
  return (1 - t) * h(i + 1, r) + (1 - f) * h(i + odd, r + 1) + (f + t - 1) * h(i + 1 + odd, r + 1);
}
