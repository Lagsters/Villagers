/** Paleta stylizowanego low-poly. */
import { T } from '../../sim/defs.ts';

export const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [T.WATER]: [0.2, 0.45, 0.62],
  [T.GRASS]: [0.42, 0.62, 0.27],
  [T.DESERT]: [0.86, 0.76, 0.5],
  [T.MOUNTAIN]: [0.52, 0.47, 0.42],
  [T.SNOW]: [0.94, 0.95, 0.97],
};
export const SHORE_COLOR: [number, number, number] = [0.83, 0.77, 0.56];
export const DEEP_WATER: [number, number, number] = [0.15, 0.36, 0.55];
