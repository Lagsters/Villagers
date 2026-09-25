/**
 * Tworzenie nowej gry: mapa z kodu, zamki graczy z poczatkowym inwentarzem, terytorium.
 */
import { B, G, GOODS_COUNT, MAP_SIZES, MAX_PLAYERS, S } from './defs.ts';
import { finishBuilding, placeBuilding } from './construction.ts';
import { generateMap, normalizeMapCode } from './mapgen.ts';
import { seedRng } from './rng.ts';
import { defaultSettings } from './settings.ts';
import type { GameConfig, GameState, PlayerState } from './types.ts';
import { SIM_VERSION } from './version.ts';
import { recomputeTerritory } from './world.ts';
import { ANIMAL_SPAWN_TICKS, maxAnimals, spawnAnimal } from './animals.ts';

export type { GameConfig, GameState, PlayerState } from './types.ts';

export function validateConfig(cfg: GameConfig): GameConfig {
  const size = (MAP_SIZES as readonly number[]).includes(cfg.mapSize) ? cfg.mapSize : 96;
  const players = cfg.players.slice(0, MAX_PLAYERS).map((p) => ({ name: String(p.name).slice(0, 20), color: p.color | 0, ai: p.ai | 0 }));
  if (players.length === 0) throw new Error('Brak graczy');
  return { mapCode: normalizeMapCode(cfg.mapCode), mapSize: size, players, seed: cfg.seed >>> 0 };
}

/** Poczatkowy inwentarz zamku. */
export const START_GOODS: ReadonlyArray<[number, number]> = [
  [G.PLANK, 40], [G.STONE, 30], [G.LUMBER, 10], [G.FISH, 8], [G.BREAD, 6], [G.MEAT, 6], [G.WHEAT, 4],
  [G.WATER, 4], [G.BEER, 6], [G.PIG, 2], [G.COAL, 12], [G.IRON_ORE, 8], [G.STEEL, 6], [G.GOLD, 2], [G.BOAT, 2],
  [G.SHOVEL, 4], [G.HAMMER, 7], [G.ROD, 2], [G.CLEAVER, 1], [G.SCYTHE, 2], [G.AXE, 3], [G.SAW, 2],
  [G.PICK, 3], [G.PINCER, 1], [G.BOW, 1], [G.CRUCIBLE, 2], [G.ROLLING_PIN, 1], [G.SWORD, 3], [G.SHIELD, 3],
];
export const START_SERFS = 30;
export const START_KNIGHTS: readonly number[] = [4, 2, 1, 0, 0];
export const START_DONKEYS = 3;

export function createGame(input: GameConfig): GameState {
  const cfg = validateConfig(input);
  const { map, starts } = generateMap(cfg.mapCode, cfg.mapSize, cfg.players.length);
  const players: PlayerState[] = cfg.players.map((p, i) => ({
    id: i,
    name: p.name,
    color: p.color,
    ai: p.ai,
    start: starts[i],
    alive: true,
    castle: -1,
    settings: defaultSettings(),
    serfTimer: 250 + i,
    donkeyTimer: 900 + i,
    totalSerfs: 0,
    netVersion: 0,
    stats: { samples: [], produced: new Array(GOODS_COUNT).fill(0) },
    morale: 50,
    territory: 0,
    lastAttacked: -1,
    toolWant: new Array(9).fill(0),
  }));
  const s: GameState = {
    version: SIM_VERSION,
    tick: 0,
    rng: seedRng(cfg.seed ^ 0x2545f491).rng,
    config: cfg,
    map,
    players,
    flags: [],
    roads: [],
    buildings: [],
    serfs: [],
    freeFlags: [],
    freeRoads: [],
    freeBuildings: [],
    freeSerfs: [],
    animals: [],
    freeAnimals: [],
    animalTimer: ANIMAL_SPAWN_TICKS,
    sweep: 0,
    winner: -1,
    _events: [],
  };
  for (const pl of players) {
    const id = placeBuilding(s, pl.id, pl.start, B.CASTLE, true);
    if (id < 0) throw new Error(`Nie mozna postawic zamku gracza ${pl.id}`);
    const castle = s.buildings[id]!;
    if (!castle.inv) finishBuilding(s, castle);
    const inv = castle.inv!;
    for (const [g, n] of START_GOODS) inv.goods[g] = n;
    inv.serfs[S.GENERIC] = START_SERFS;
    inv.serfs[S.DONKEY] = START_DONKEYS;
    for (let l = 0; l < 5; l++) inv.knights[l] = START_KNIGHTS[l];
    pl.castle = id;
    pl.totalSerfs = START_SERFS + START_KNIGHTS.reduce((a, b) => a + b, 0);
    recomputeTerritory(s, pl.start, 9);
  }
  const initialAnimals = maxAnimals(s) >> 1;
  for (let i = 0; i < initialAnimals * 4 && s.animals.length < initialAnimals; i++) spawnAnimal(s);
  s._events = [];
  return s;
}
