/** Paleta stylizowanego low-poly. */

/**
 * Zielen lak: ciemne i jasne laty, przesuszona trawa (wzgorza, okolice plaz) i sciolka lasu. Z tej samej
 * rodziny co korony drzew (art/scripts/nature.py) - las i laka maja wygladac jak jeden obraz.
 */
export const GRASS_DARK: [number, number, number] = [0.085, 0.2, 0.035];
export const GRASS_LIGHT: [number, number, number] = [0.2, 0.36, 0.07];
export const GRASS_DRY: [number, number, number] = [0.3, 0.33, 0.1];
export const FOREST_FLOOR: [number, number, number] = [0.075, 0.14, 0.035];
export const LITTER: [number, number, number] = [0.2, 0.12, 0.05];
/** Ziemia na stromych zboczach lak. */
export const EARTH: [number, number, number] = [0.36, 0.27, 0.15];
/** Ubita ziemia drog i wydeptanych placow przed budynkami. */
export const PATH: [number, number, number] = [0.33, 0.22, 0.11];
/** Zaorana ziemia pola: bruzda i grzbiet skiby. */
export const SOIL_DARK: [number, number, number] = [0.11, 0.06, 0.025];
export const SOIL_LIGHT: [number, number, number] = [0.24, 0.14, 0.065];
/** Piasek pustyni i plaz: jasny i ciemniejszy, cieplejszy (laty, doliny wydm). */
export const SAND: [number, number, number] = [0.78, 0.63, 0.37];
export const SAND_DARK: [number, number, number] = [0.55, 0.4, 0.2];
/** Skala gor: szczeliny i cienie, oswietlone sciany. */
export const ROCK_DARK: [number, number, number] = [0.15, 0.13, 0.11];
export const ROCK_LIGHT: [number, number, number] = [0.5, 0.46, 0.4];
export const SNOW: [number, number, number] = [0.93, 0.95, 0.98];
/** Woda: plycizna przy brzegu, otwarta woda, glebia (kolor tla przy brzegu mapy). */
export const SHALLOW_WATER: [number, number, number] = [0.14, 0.44, 0.52];
export const WATER: [number, number, number] = [0.09, 0.3, 0.52];
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
