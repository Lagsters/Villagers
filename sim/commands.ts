/**
 * Komendy - jedyne wejscie do symulacji. Kazda komenda jest walidowana przy wykonaniu;
 * niepoprawna jest ignorowana (np. spozniona komenda po zmianie stanu).
 */
import { BUILDINGS, O } from './defs.ts';
import { demolishBuilding, placeBuilding } from './construction.ts';
import { buildRoad, placeFlag, removeFlag, removeRoad, roadAt } from './roads.ts';
import { destroyBuilding } from './construction.ts';
import type { GameState, Settings } from './types.ts';
import { applySetting } from './settings.ts';

export type Command =
  | { type: 'flag'; player: number; pos: number }
  | { type: 'road'; player: number; pos: number; dirs: number[] }
  | { type: 'build'; player: number; pos: number; kind: number }
  | { type: 'demolish'; player: number; pos: number }
  | { type: 'attack'; player: number; pos: number; count: number }
  | { type: 'geologist'; player: number; pos: number }
  | { type: 'setting'; player: number; key: keyof Settings; value: number | number[] }
  | { type: 'surrender'; player: number }
  | { type: 'pause'; player: number; pos: number; on: boolean };

export type CommandHandler = (s: GameState, c: Command) => void;

const extra: Partial<Record<Command['type'], CommandHandler>> = {};

/** Rejestracja obslugi komend z pozniejszych modulow (wojsko, geolog). */
export function registerCommand(type: Command['type'], h: CommandHandler): void {
  extra[type] = h;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function applyCommand(s: GameState, c: Command): void {
  if (!c || typeof c !== 'object' || !isInt(c.player)) return;
  const pl = s.players[c.player];
  if (!pl || !pl.alive) return;
  const n = s.map.w * s.map.h;
  if ('pos' in c && (!isInt(c.pos) || c.pos < 0 || c.pos >= n)) return;
  switch (c.type) {
    case 'flag':
      placeFlag(s, c.player, c.pos);
      return;
    case 'road':
      if (!Array.isArray(c.dirs) || !c.dirs.every(isInt)) return;
      buildRoad(s, c.player, c.pos, c.dirs);
      return;
    case 'build':
      if (!isInt(c.kind) || c.kind <= 0 || c.kind >= BUILDINGS.length) return;
      placeBuilding(s, c.player, c.pos, c.kind);
      return;
    case 'demolish': {
      const map = s.map;
      const o = map.obj[c.pos];
      if (o === O.BUILDING || o === O.BUILDING_PART) {
        const b = s.buildings[map.objId[c.pos]];
        if (b && b.owner === c.player) demolishBuilding(s, b.id);
      } else if (o === O.FLAG) {
        const f = s.flags[map.objId[c.pos]];
        if (!f || f.owner !== c.player) return;
        const b = f.building >= 0 ? s.buildings[f.building] : null;
        if (b && b.kind === 0) return; // flaga zamku zostaje
        removeFlag(s, f.id, (bid) => destroyBuilding(s, bid, false));
      } else {
        const rid = roadAt(s, c.pos);
        if (rid >= 0 && s.roads[rid]!.owner === c.player) removeRoad(s, rid);
      }
      return;
    }
    case 'pause': {
      const map = s.map;
      const o = map.obj[c.pos];
      if (o !== O.BUILDING && o !== O.BUILDING_PART) return;
      const b = s.buildings[map.objId[c.pos]];
      if (b && b.owner === c.player && BUILDINGS[b.kind].worker >= 0) b.paused = !!c.on;
      return;
    }
    case 'setting':
      applySetting(s, c.player, c.key, c.value);
      return;
    default: {
      const h = extra[c.type];
      if (h) h(s, c);
    }
  }
}
