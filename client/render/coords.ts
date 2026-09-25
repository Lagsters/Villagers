/** Przeliczenia pole mapy -> wspolrzedne swiata three.js. */
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

/** Wysokosc terenu w punkcie (interpolacja barycentryczna w trojkacie). */
export function groundHeight(map: MapData, wx: number, wz: number): number {
  const i = nearestIdx(map, wx, wz);
  if (i < 0) return 0;
  return map.height[i] * H_SCALE;
}
