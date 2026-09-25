import { B, PLAYER_COLORS } from '../../sim/defs.ts';
import { DIR_SE, hexDist, spiral } from '../../sim/grid.ts';
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

/** Miejsce z najlepszym wynikiem funkcji oceny (np. liczba skal w promieniu). */
export function findSiteBest(s: GameState, p: number, kind: number, score: (pos: number) => number, maxDist = 10): number {
  const castle = s.buildings[s.players[p].castle]!;
  const w = s.map.w;
  let best = -1;
  let bestScore = -Infinity;
  for (const i of spiral(w, s.map.h, castle.pos % w, (castle.pos / w) | 0, maxDist)) {
    if (!canBuild(s, p, i, kind)) continue;
    const sc = score(i);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return best;
}

/** Liczba pol spelniajacych warunek w promieniu r od pos. */
export function countNear(s: GameState, pos: number, r: number, pred: (i: number) => boolean): number {
  let n = 0;
  for (const i of spiral(s.map.w, s.map.h, pos % s.map.w, (pos / s.map.w) | 0, r)) if (pred(i)) n++;
  return n;
}

/** Stawia budynek i laczy jego flage droga z flaga zamku. */
export function buildConnected(s: GameState, p: number, kind: number, minDist = 3, maxDist = 8, score?: (pos: number) => number): { pos: number; ok: boolean } {
  const pos = score ? findSiteBest(s, p, kind, score, maxDist) : findSite(s, p, kind, minDist, maxDist);
  if (pos < 0) return { pos, ok: false };
  step(s, [{ type: 'build', player: p, pos, kind }]);
  const flagPos = neighbor(s.map, pos, DIR_SE);
  return { pos, ok: connectFlag(s, p, flagPos) };
}

/** Laczy flage z najblizsza flaga sieci (majaca juz droge albo flaga zamku). */
export function connectFlag(s: GameState, p: number, flagPos: number): boolean {
  const castle = s.buildings[s.players[p].castle]!;
  const w = s.map.w;
  const fx = flagPos % w, fy = (flagPos / w) | 0;
  const targets = s.flags
    .filter((f) => f && f.owner === p && f.pos !== flagPos && (f.id === castle.flag || f.roads.some((r) => r >= 0)))
    .map((f) => f!.pos)
    .sort((a, b) => hexDist(fx, fy, a % w, (a / w) | 0) - hexDist(fx, fy, b % w, (b / w) | 0) || a - b);
  for (const t of targets.slice(0, 8)) {
    const dirs = findRoadPath(s, p, flagPos, t);
    if (!dirs) continue;
    step(s, [{ type: 'road', player: p, pos: flagPos, dirs }]);
    if (s.map.roads[flagPos] !== 0) return true;
  }
  return false;
}

export { B };
