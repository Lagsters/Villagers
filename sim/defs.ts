/**
 * Stale gry: typy terenu, obiekty na mapie, towary, zawody, budynki.
 * Uzywamy obiektow `as const` zamiast enum (erasableSyntaxOnly).
 */

export const TICKS_PER_SECOND = 10;

// ---------- Teren ----------
export const T = { WATER: 0, GRASS: 1, DESERT: 2, MOUNTAIN: 3, SNOW: 4 } as const;

export function isWalkableTerrain(t: number): boolean {
  return t === T.GRASS || t === T.DESERT || t === T.MOUNTAIN;
}

// ---------- Obiekty na polach ----------
export const O = {
  NONE: 0,
  // Drzewo: 1-4 sadzonka (etapy), 5 dorosle
  SAPLING1: 1,
  SAPLING4: 4,
  TREE: 5,
  STUMP: 6,
  // Skala: 7..12 = 1..6 jednostek kamienia
  STONE1: 7,
  STONE6: 12,
  // Pole zboza: 13..16 rosnie, 17 dojrzale
  FIELD1: 13,
  FIELD_RIPE: 17,
  FLAG: 19,
  BUILDING: 20,
  BUILDING_PART: 21,
  SIGN: 22,
  RUIN: 23,
} as const;

export function isTree(o: number): boolean {
  return o >= O.SAPLING1 && o <= O.TREE;
}
export function isStone(o: number): boolean {
  return o >= O.STONE1 && o <= O.STONE6;
}
export function isField(o: number): boolean {
  return o >= O.FIELD1 && o <= O.FIELD_RIPE;
}
/** Czy obiekt blokuje przejscie (drzewa i skaly blokuja, jak w oryginale). */
export function objBlocksWalk(o: number): boolean {
  return o === O.TREE || isStone(o) || o === O.BUILDING || o === O.BUILDING_PART;
}

// ---------- Zloza ----------
export const RES = { NONE: 0, COAL: 1, IRON: 2, GOLD: 3, STONE: 4, FISH: 5 } as const;

// ---------- Towary ----------
export const G = {
  FISH: 0, PIG: 1, MEAT: 2, WHEAT: 3, FLOUR: 4, BREAD: 5, LUMBER: 6, PLANK: 7, BOAT: 8, STONE: 9,
  IRON_ORE: 10, STEEL: 11, COAL: 12, GOLD_ORE: 13, GOLD: 14,
  SHOVEL: 15, HAMMER: 16, ROD: 17, CLEAVER: 18, SCYTHE: 19, AXE: 20, SAW: 21, PICK: 22, PINCER: 23,
  SWORD: 24, SHIELD: 25,
} as const;
export const GOODS_COUNT = 26;
export const NO_GOOD = -1;
export const FIRST_TOOL = G.SHOVEL;
export const TOOLS_COUNT = 9;

export const GOOD_NAMES_PL: readonly string[] = [
  'Ryba', 'Świnia', 'Mięso', 'Zboże', 'Mąka', 'Chleb', 'Pień', 'Deska', 'Łódź', 'Kamień',
  'Ruda żelaza', 'Stal', 'Węgiel', 'Ruda złota', 'Złoto',
  'Łopata', 'Młotek', 'Wędka', 'Tasak', 'Kosa', 'Siekiera', 'Piła', 'Kilof', 'Szczypce',
  'Miecz', 'Tarcza',
];

export function isFood(g: number): boolean {
  return g === G.FISH || g === G.MEAT || g === G.BREAD;
}

// ---------- Zawody ----------
export const S = {
  GENERIC: 0, TRANSPORTER: 1, SAILOR: 2, DIGGER: 3, BUILDER: 4, WOODCUTTER: 5, FORESTER: 6,
  SAWYER: 7, STONECUTTER: 8, MINER: 9, FISHER: 10, HUNTER: 11, FARMER: 12, MILLER: 13, BAKER: 14,
  PIGFARMER: 15, BUTCHER: 16, SMELTER: 17, TOOLMAKER: 18, WEAPONSMITH: 19, BOATBUILDER: 20,
  GEOLOGIST: 21, KNIGHT: 22, DONKEY: 23,
} as const;
export const SERF_TYPES = 24;

export const SERF_NAMES_PL: readonly string[] = [
  'Osadnik', 'Tragarz', 'Przewoźnik', 'Kopacz', 'Budowniczy', 'Drwal', 'Leśnik', 'Tracz', 'Kamieniarz',
  'Górnik', 'Rybak', 'Myśliwy', 'Rolnik', 'Młynarz', 'Piekarz', 'Hodowca', 'Rzeźnik', 'Hutnik',
  'Narzędziowiec', 'Płatnerz', 'Szkutnik', 'Geolog', 'Rycerz', 'Osioł',
];

/** Narzedzia potrzebne do wyszkolenia zawodu (lista towarow). */
export const SERF_TOOLS: readonly (readonly number[])[] = (() => {
  const t: number[][] = Array.from({ length: SERF_TYPES }, () => []);
  t[S.SAILOR] = [G.BOAT];
  t[S.DIGGER] = [G.SHOVEL];
  t[S.BUILDER] = [G.HAMMER];
  t[S.WOODCUTTER] = [G.AXE];
  t[S.SAWYER] = [G.SAW];
  t[S.STONECUTTER] = [G.PICK];
  t[S.MINER] = [G.PICK];
  t[S.FISHER] = [G.ROD];
  t[S.FARMER] = [G.SCYTHE];
  t[S.BUTCHER] = [G.CLEAVER];
  t[S.TOOLMAKER] = [G.HAMMER, G.SAW];
  t[S.WEAPONSMITH] = [G.HAMMER, G.PINCER];
  t[S.BOATBUILDER] = [G.HAMMER];
  t[S.GEOLOGIST] = [G.HAMMER];
  t[S.KNIGHT] = [G.SWORD, G.SHIELD];
  return t;
})();

// ---------- Budynki ----------
export const B = {
  CASTLE: 0, WAREHOUSE: 1, WOODCUTTER: 2, FORESTER: 3, SAWMILL: 4, STONECUTTER: 5, FISHER: 6,
  HUNTER: 7, FARM: 8, MILL: 9, BAKERY: 10, PIGFARM: 11, BUTCHER: 12, COALMINE: 13, IRONMINE: 14,
  GOLDMINE: 15, STONEMINE: 16, STEELWORKS: 17, GOLDSMELTER: 18, TOOLMAKER: 19, WEAPONSMITH: 20,
  SHIPYARD: 21, GUARDHUT: 22, TOWER: 23, FORTRESS: 24,
} as const;
export const BUILDING_TYPES = 25;

export const SIZE = { SMALL: 1, LARGE: 2, MINE: 3 } as const;

export interface BuildingDef {
  name: string;
  size: number;
  planks: number;
  stones: number;
  /** zawod pracownika, -1 brak (wojskowe/magazyny) */
  worker: number;
  /** towary wejsciowe; kopalnie jedza dowolne jedzenie (obslugiwane osobno) */
  inputs: readonly number[];
  output: number;
  cycle: number;
  /** promien pracy (drwal, lesnik...) albo terytorium (wojskowe, zamek) */
  radius: number;
  knights: number;
  gold: number;
  military: boolean;
}

function def(name: string, size: number, planks: number, stones: number, worker: number, inputs: number[], output: number, cycle: number, radius = 0, knights = 0, gold = 0): BuildingDef {
  return { name, size, planks, stones, worker, inputs, output, cycle, radius, knights, gold, military: knights > 0 };
}

export const BUILDINGS: readonly BuildingDef[] = [
  def('Zamek', SIZE.LARGE, 0, 0, -1, [], NO_GOOD, 0, 9),
  def('Magazyn', SIZE.LARGE, 4, 4, -1, [], NO_GOOD, 0),
  def('Drwal', SIZE.SMALL, 2, 0, S.WOODCUTTER, [], G.LUMBER, 80, 6),
  def('Leśnik', SIZE.SMALL, 2, 0, S.FORESTER, [], NO_GOOD, 120, 5),
  def('Tartak', SIZE.SMALL, 2, 1, S.SAWYER, [G.LUMBER], G.PLANK, 80),
  def('Kamieniarz', SIZE.SMALL, 2, 0, S.STONECUTTER, [], G.STONE, 80, 7),
  def('Rybak', SIZE.SMALL, 2, 0, S.FISHER, [], G.FISH, 100, 7),
  def('Myśliwy', SIZE.SMALL, 2, 0, S.HUNTER, [], G.MEAT, 60, 8),
  def('Farma', SIZE.LARGE, 3, 1, S.FARMER, [], G.WHEAT, 80, 3),
  def('Młyn', SIZE.SMALL, 3, 1, S.MILLER, [G.WHEAT], G.FLOUR, 60),
  def('Piekarnia', SIZE.SMALL, 2, 2, S.BAKER, [G.FLOUR], G.BREAD, 80),
  def('Chlewnia', SIZE.LARGE, 3, 2, S.PIGFARMER, [G.WHEAT], G.PIG, 120),
  def('Rzeźnia', SIZE.SMALL, 2, 1, S.BUTCHER, [G.PIG], G.MEAT, 60),
  def('Kopalnia węgla', SIZE.MINE, 4, 0, S.MINER, [], G.COAL, 100, 2),
  def('Kopalnia żelaza', SIZE.MINE, 4, 0, S.MINER, [], G.IRON_ORE, 100, 2),
  def('Kopalnia złota', SIZE.MINE, 4, 0, S.MINER, [], G.GOLD_ORE, 100, 2),
  def('Kopalnia kamienia', SIZE.MINE, 4, 0, S.MINER, [], G.STONE, 100, 2),
  def('Huta żelaza', SIZE.SMALL, 2, 2, S.SMELTER, [G.IRON_ORE, G.COAL], G.STEEL, 100),
  def('Huta złota', SIZE.SMALL, 2, 2, S.SMELTER, [G.GOLD_ORE, G.COAL], G.GOLD, 100),
  def('Narzędziownia', SIZE.SMALL, 3, 1, S.TOOLMAKER, [G.PLANK, G.STEEL], NO_GOOD, 120),
  def('Zbrojownia', SIZE.SMALL, 2, 2, S.WEAPONSMITH, [G.STEEL, G.COAL], G.SWORD, 140),
  def('Stocznia', SIZE.SMALL, 3, 0, S.BOATBUILDER, [G.PLANK], G.BOAT, 150),
  def('Strażnica', SIZE.SMALL, 1, 1, -1, [], NO_GOOD, 0, 5, 2, 2),
  def('Wieża', SIZE.SMALL, 2, 3, -1, [], NO_GOOD, 0, 7, 4, 2),
  def('Twierdza', SIZE.LARGE, 4, 6, -1, [], NO_GOOD, 0, 9, 8, 4),
];

export function isMine(kind: number): boolean {
  return kind >= B.COALMINE && kind <= B.STONEMINE;
}
export function isInventory(kind: number): boolean {
  return kind === B.CASTLE || kind === B.WAREHOUSE;
}
export function isMilitary(kind: number): boolean {
  return kind === B.GUARDHUT || kind === B.TOWER || kind === B.FORTRESS;
}
/** Zloze wydobywane przez kopalnie danego typu. */
export function mineResource(kind: number): number {
  switch (kind) {
    case B.COALMINE: return RES.COAL;
    case B.IRONMINE: return RES.IRON;
    case B.GOLDMINE: return RES.GOLD;
    case B.STONEMINE: return RES.STONE;
    default: return RES.NONE;
  }
}

export const MAX_PLAYERS = 8;
export const MAP_SIZES = [64, 96, 128, 160] as const;

/** Kolory graczy (rendering, UI, lobby). */
export const PLAYER_COLORS: readonly number[] = [
  0x2f6fdb, 0xd8392b, 0xe8c12a, 0x2ea44f, 0x9b4dca, 0xe07b26, 0x2bb3c0, 0xe0e0e0,
];
export const PLAYER_COLOR_NAMES_PL: readonly string[] = [
  'Niebieski', 'Czerwony', 'Żółty', 'Zielony', 'Fioletowy', 'Pomarańczowy', 'Turkusowy', 'Biały',
];
