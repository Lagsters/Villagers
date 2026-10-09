/** Przeliczenia pole mapy -> wspolrzedne swiata three.js. */
import { DIRS, stepXY } from '../../sim/grid.ts';
import type { MapData } from '../../sim/mapgen.ts';

export const ROW_H = Math.sqrt(3) / 2;
export const H_SCALE = 0.22;

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
 * Wysokosc terenu w punkcie (wx, wz) - dokladnie na siatce terenu: interpolacja barycentryczna
 * w trojkacie miedzy najblizszym polem a dwoma kolejnymi sasiadami.
 */
export function groundHeight(map: MapData, wx: number, wz: number): number {
  const i = nearestIdx(map, wx, wz);
  if (i < 0) return 0;
  const x = i % map.w, y = (i / map.w) | 0;
  const ax = vx(x, y), az = vz(y), ah = map.height[i] * H_SCALE;
  for (let d = 0; d < DIRS; d++) {
    const [bx0, by0] = stepXY(x, y, d);
    const [cx0, cy0] = stepXY(x, y, (d + 1) % DIRS);
    if (bx0 < 0 || by0 < 0 || cx0 < 0 || cy0 < 0 || bx0 >= map.w || by0 >= map.h || cx0 >= map.w || cy0 >= map.h) continue;
    const bx = vx(bx0, by0), bz = vz(by0), cx = vx(cx0, cy0), cz = vz(cy0);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((bz - cz) * (wx - cx) + (cx - bx) * (wz - cz)) / det;
    const l2 = ((cz - az) * (wx - cx) + (ax - cx) * (wz - cz)) / det;
    const l3 = 1 - l1 - l2;
    const bh = map.height[by0 * map.w + bx0] * H_SCALE, ch = map.height[cy0 * map.w + cx0] * H_SCALE;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * ah + l2 * bh + l3 * ch;
  }
  return ah;
}
