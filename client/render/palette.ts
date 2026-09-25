/** Paleta stylizowanego low-poly. */
import { T } from '../../sim/defs.ts';

export const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [T.WATER]: [0.12, 0.34, 0.6],
  [T.GRASS]: [0.2, 0.46, 0.08],
  [T.DESERT]: [0.8, 0.64, 0.36],
  [T.MOUNTAIN]: [0.46, 0.37, 0.28],
  [T.SNOW]: [0.94, 0.95, 0.97],
};
/** Soczysta zielen lak: ciemne i jasne laty. */
export const GRASS_DARK: [number, number, number] = [0.12, 0.36, 0.05];
export const GRASS_LIGHT: [number, number, number] = [0.3, 0.58, 0.1];
export const SHORE_COLOR: [number, number, number] = [0.82, 0.72, 0.46];
export const DEEP_WATER: [number, number, number] = [0.08, 0.25, 0.5];

/** Kolory towarow (maly szescian na fladze / nad glowa tragarza). */
export const GOOD_COLORS: readonly [number, number, number][] = [
  [0.55, 0.7, 0.85], // ryba
  [0.95, 0.65, 0.65], // swinia
  [0.75, 0.25, 0.2], // mieso
  [0.95, 0.82, 0.35], // zboze
  [0.97, 0.95, 0.88], // maka
  [0.8, 0.55, 0.25], // chleb
  [0.5, 0.33, 0.18], // pien
  [0.85, 0.66, 0.4], // deska
  [0.45, 0.3, 0.15], // lodz
  [0.65, 0.65, 0.65], // kamien
  [0.55, 0.35, 0.3], // ruda zelaza
  [0.6, 0.65, 0.75], // stal
  [0.15, 0.15, 0.15], // wegiel
  [0.75, 0.65, 0.3], // ruda zlota
  [1.0, 0.85, 0.2], // zloto
  [0.5, 0.5, 0.55], [0.45, 0.45, 0.5], [0.6, 0.45, 0.3], [0.7, 0.7, 0.75], [0.65, 0.65, 0.6],
  [0.55, 0.45, 0.35], [0.7, 0.72, 0.78], [0.5, 0.52, 0.55], [0.4, 0.4, 0.45], // narzedzia
  [0.85, 0.87, 0.92], // miecz
  [0.6, 0.35, 0.2], // tarcza
];
