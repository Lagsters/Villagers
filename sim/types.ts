/**
 * Typy encji symulacji. Wszystkie pola to liczby calkowite, boolean, tablice albo null,
 * zeby stan dal sie wprost zserializowac i zahashowac. Pola z prefiksem `_` to dane pochodne.
 */
import type { MapData } from './mapgen.ts';

export const FLAG_SLOTS = 8;
/** Kierunek "do budynku przy tej fladze" w slotDir. */
export const DIR_INTO = 6;

export interface Flag {
  id: number;
  owner: number;
  pos: number;
  /** id drogi w kazdym z 6 kierunkow albo -1 */
  roads: number[];
  /** budynek przyczepiony do flagi (stoi na NW od niej) albo -1 */
  building: number;
  slotGood: number[];
  slotDest: number[];
  /** nastepny kierunek (0-5), DIR_INTO, albo -1 gdy brak trasy */
  slotDir: number[];
  slotClaim: number[];
  slotTime: number[];
}

export interface Road {
  id: number;
  owner: number;
  a: number;
  b: number;
  dirA: number;
  dirB: number;
  /** kierunki krokow od flagi a do b */
  path: number[];
  /** pola od a do b wlacznie */
  cells: number[];
  /** czas przejscia calej drogi w tickach */
  cost: number;
  water: boolean;
  carrier: number;
  donkey: number;
  /** licznik zatloczenia (osly) */
  load: number;
}

export interface Inventory {
  goods: number[];
  /** wolni osadnicy wg zawodu (bez rycerzy) */
  serfs: number[];
  /** rycerze wg poziomu 0-4 */
  knights: number[];
  outCooldown: number;
  /** ile osadnikow/rycerzy wyszlo, zeby limitowac tempo wychodzenia */
  exitCooldown: number;
}

export const STAGE = { LEVEL: 0, BUILD: 1, DONE: 2, BURN: 3 } as const;

export interface Building {
  id: number;
  owner: number;
  kind: number;
  pos: number;
  flag: number;
  stage: number;
  /** postep budowy w tickach dla biezacej jednostki materialu */
  progress: number;
  planks: number;
  stones: number;
  planksUsed: number;
  stonesUsed: number;
  planksTransit: number;
  stonesTransit: number;
  /** docelowa wysokosc przy wyrownywaniu (-1 brak) */
  levelHeight: number;
  builder: number;
  digger: number;
  worker: number;
  workerInside: boolean;
  /** zapasy wejsc wg indeksu w BUILDINGS[kind].inputs (kopalnie: [jedzenie]) */
  stock: number[];
  transit: number[];
  timer: number;
  phase: number;
  /** wyroby czekajace na wyniesienie na flage */
  out: number[];
  knights: number[];
  knightsComing: number;
  gold: number;
  goldTransit: number;
  inv: Inventory | null;
  burn: number;
  idleCycles: number;
  trainTimer: number;
  /** ostatni tick obsluzenia zamowienia (sprawiedliwosc przy rownych priorytetach) */
  served: number;
  /** licznik produkcji (statystyki na budynek) */
  produced: number;
}

export interface Serf {
  id: number;
  owner: number;
  type: number;
  level: number;
  hp: number;
  state: number;
  pos: number;
  to: number;
  t: number;
  dur: number;
  path: number[];
  carry: number;
  carryDest: number;
  home: number;
  target: number;
  road: number;
  timer: number;
  sub: number;
  /** wskazowka dla renderera: 0 marsz/stoi, 1 praca, 2 walka, 3 niesie */
  anim: number;
}

export interface Settings {
  /** kolejnosc towarow: transportPrio[g] = priorytet (wiekszy = wazniejszy) */
  transportPrio: number[];
  foodCoal: number;
  foodIron: number;
  foodGold: number;
  foodStone: number;
  plankConstruction: number;
  plankShipyard: number;
  plankToolmaker: number;
  steelToolmaker: number;
  steelWeaponsmith: number;
  coalSteel: number;
  coalGold: number;
  coalWeapons: number;
  wheatMill: number;
  wheatPig: number;
  toolPrio: number[];
  /** minimalna obsada: wewnatrz, przy granicy, przy wrogu (0..pojemnosc, 99 = pelna) */
  knightsInterior: number;
  knightsBorder: number;
  knightsEnemy: number;
  castleKnights: number;
  serfReserve: number;
}

export interface Stats {
  /** probki: [tick, budynki, osadnicy, rycerze, sila, terytorium, ...zapasy towarow(26)] */
  samples: number[][];
  produced: number[];
}

export interface PlayerState {
  id: number;
  name: string;
  color: number;
  ai: number;
  start: number;
  alive: boolean;
  castle: number;
  settings: Settings;
  serfTimer: number;
  donkeyTimer: number;
  totalSerfs: number;
  /** wersja sieci drog; zmiana uniewaznia tablice tras */
  netVersion: number;
  stats: Stats;
  morale: number;
  territory: number;
  /** zdarzenia do UI (nie wplywaja na logike): ostatni atak itp. */
  lastAttacked: number;
}

export interface GameConfig {
  mapCode: string;
  mapSize: number;
  players: { name: string; color: number; ai: number }[];
  seed: number;
}

export interface GameState {
  version: number;
  tick: number;
  rng: number;
  config: GameConfig;
  map: MapData;
  players: PlayerState[];
  flags: (Flag | null)[];
  roads: (Road | null)[];
  buildings: (Building | null)[];
  serfs: (Serf | null)[];
  freeFlags: number[];
  freeRoads: number[];
  freeBuildings: number[];
  freeSerfs: number[];
  /** kursor przegladu mapy (wzrost drzew, pol, ryb) */
  sweep: number;
  winner: number;
  /** ostatnie zdarzenia dla klienta (dzwieki, komunikaty); czyszczone co tick, bez hasha */
  _events: GameEvent[];
}

export interface GameEvent {
  type: string;
  player: number;
  pos: number;
  a?: number;
}
