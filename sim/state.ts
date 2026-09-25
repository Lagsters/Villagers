/**
 * Stan gry: prosty, serializowalny obiekt. Encje trzymamy w tablicach indeksowanych id
 * (null = wolny slot), iteracja zawsze w kolejnosci id.
 */
import { MAP_SIZES, MAX_PLAYERS } from './defs.ts';
import { generateMap, normalizeMapCode, type MapData } from './mapgen.ts';
import { seedRng } from './rng.ts';
import { SIM_VERSION } from './version.ts';

export interface PlayerConfig {
  name: string;
  color: number;
  /** 0 = czlowiek, 1 = bot latwy, 2 = bot trudny (informacyjnie; boty dzialaja poza symulacja) */
  ai: number;
}

export interface GameConfig {
  mapCode: string;
  mapSize: number;
  players: PlayerConfig[];
  seed: number;
}

export interface PlayerState {
  id: number;
  name: string;
  color: number;
  ai: number;
  start: number;
  alive: boolean;
}

export interface GameState {
  version: number;
  tick: number;
  rng: number;
  config: GameConfig;
  map: MapData;
  players: PlayerState[];
  /** -1 = gra trwa, >=0 zwyciezca, -2 = remis */
  winner: number;
}

export function validateConfig(cfg: GameConfig): GameConfig {
  const size = (MAP_SIZES as readonly number[]).includes(cfg.mapSize) ? cfg.mapSize : 96;
  const players = cfg.players.slice(0, MAX_PLAYERS);
  if (players.length === 0) throw new Error('Brak graczy');
  return { mapCode: normalizeMapCode(cfg.mapCode), mapSize: size, players, seed: cfg.seed >>> 0 };
}

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
  }));
  return {
    version: SIM_VERSION,
    tick: 0,
    rng: seedRng(cfg.seed ^ 0x2545f491).rng,
    config: cfg,
    map,
    players,
    winner: -1,
  };
}
