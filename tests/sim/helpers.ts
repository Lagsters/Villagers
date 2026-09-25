import { B, PLAYER_COLORS } from '../../sim/defs.ts';
import { DIR_SE, spiral } from '../../sim/grid.ts';
import { createGame } from '../../sim/state.ts';
import { step } from '../../sim/step.ts';
import type { Command } from '../../sim/commands.ts';
import type { GameState } from '../../sim/types.ts';
import { canBuild, neighbor } from '../../sim/world.ts';
import { findRoadPath } from '../../sim/roads.ts';
import '../../sim/index.ts';

export function newGame(players = 2, size = 64, code = 'TEST'): GameState {
  return createGame({
    mapCode: code,
    mapSize: size,
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, color: PLAYER_COLORS[i], ai: 0 })),
    seed: 7,
  });
}

export function run(s: GameState, ticks: number, cmds: (tick: number) => Command[] = () => []): void {
  for (let i = 0; i < ticks; i++) step(s, cmds(s.tick));
}

/** Pierwsze miejsce (spiralnie od zamku, w odleglosci >= minDist) pod budynek danego rodzaju. */
export function findSite(s: GameState, p: number, kind: number, minDist = 3, maxDist = 8): number {
  const castle = s.buildings[s.players[p].castle]!;
  const w = s.map.w;
  for (const i of spiral(w, s.map.h, castle.pos % w, (castle.pos / w) | 0, maxDist)) {
    const d = Math.abs((i % w) - (castle.pos % w)) + Math.abs(((i / w) | 0) - ((castle.pos / w) | 0));
    if (d < minDist) continue;
    if (canBuild(s, p, i, kind)) return i;
  }
  return -1;
}

/** Stawia budynek i laczy jego flage droga z flaga zamku. */
export function buildConnected(s: GameState, p: number, kind: number, minDist = 3, maxDist = 8): { pos: number; ok: boolean } {
  const pos = findSite(s, p, kind, minDist, maxDist);
  if (pos < 0) return { pos, ok: false };
  step(s, [{ type: 'build', player: p, pos, kind }]);
  const flagPos = neighbor(s.map, pos, DIR_SE);
  const castle = s.buildings[s.players[p].castle]!;
  const castleFlagPos = s.flags[castle.flag]!.pos;
  const dirs = findRoadPath(s, p, flagPos, castleFlagPos);
  if (!dirs) return { pos, ok: false };
  step(s, [{ type: 'road', player: p, pos: flagPos, dirs }]);
  return { pos, ok: s.map.roads[flagPos] !== 0 };
}

export { B };
