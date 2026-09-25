/**
 * Geolog: wysylany na flage bada 8 pol w promieniu 5 i stawia znaki ze zlozem.
 * Pola osadnika: target = pole flagi, sub = faza, timer = czas badania, road = liczba zbadanych pol.
 */
import { O, RES, S, T } from './defs.ts';
import { DIR_SE, hexDist, spiral } from './grid.ts';
import { findPath } from './pathfind.ts';
import { randInt } from './rng.ts';
import { UNREACHABLE, flagDist, walkRoute } from './routing.ts';
import { SS, canProvideSerf, sendHome, takeSerfFromInventory } from './serfs.ts';
import { STAGE, type GameState, type Serf } from './types.ts';
import { event, isFreeWalkable } from './world.ts';
import type { Command } from './commands.ts';

export const GEO_PROBES = 8;
export const GEO_RADIUS = 5;
export const GEO_TICKS = 60;
const GS = { TO_FLAG: 0, TO_SPOT: 1, PROBING: 2, BACK: 3 } as const;

/** Kod znaku w objId: zasob * 100 + ilosc (0 = pusto). */
export function signCode(res: number, amt: number): number {
  return res * 100 + Math.min(99, amt);
}

export function commandGeologist(s: GameState, c: Command): void {
  if (c.type !== 'geologist') return;
  const map = s.map;
  if (map.obj[c.pos] !== O.FLAG) return;
  const f = s.flags[map.objId[c.pos]];
  if (!f || f.owner !== c.player) return;
  let best = -1;
  let bestD = UNREACHABLE;
  for (const b of s.buildings) {
    if (!b || b.owner !== c.player || !b.inv || b.stage !== STAGE.DONE) continue;
    if (!canProvideSerf(b.inv, S.GEOLOGIST)) continue;
    const d = flagDist(s, c.player, b.flag, f.id, true);
    if (d < bestD) { bestD = d; best = b.id; }
  }
  if (best < 0) return;
  const inv = s.buildings[best]!;
  const route = walkRoute(s, c.player, inv.flag, f.id);
  if (!route) return;
  const serf = takeSerfFromInventory(s, inv, S.GEOLOGIST);
  if (!serf) return;
  serf.path = [DIR_SE, ...route];
  serf.state = SS.GEOLOGIST;
  serf.sub = GS.TO_FLAG;
  serf.target = f.pos;
  serf.road = 0;
}

function pickSpot(s: GameState, serf: Serf): number[] | null {
  const m = s.map;
  const c = serf.target;
  const cells = spiral(m.w, m.h, c % m.w, (c / m.w) | 0, GEO_RADIUS).filter((i) =>
    i !== c && isFreeWalkable(m, i) && m.obj[i] === O.NONE && m.roads[i] === 0);
  for (let attempt = 0; attempt < 4 && cells.length > 0; attempt++) {
    const k = randInt(s, cells.length);
    const path = findPath(m, serf.pos, cells[k], (i) => isFreeWalkable(m, i), 1500);
    if (path) return path;
    cells.splice(k, 1);
  }
  return null;
}

export function updateGeologist(s: GameState, serf: Serf): boolean {
  if (serf.state !== SS.GEOLOGIST) return false;
  const m = s.map;
  switch (serf.sub) {
    case GS.TO_FLAG:
    case GS.TO_SPOT: {
      if (serf.sub === GS.TO_SPOT) {
        serf.sub = GS.PROBING;
        serf.timer = GEO_TICKS;
        serf.anim = 1;
        return true;
      }
      const p = pickSpot(s, serf);
      if (!p) { back(s, serf); return true; }
      serf.path = p;
      serf.sub = GS.TO_SPOT;
      return true;
    }
    case GS.PROBING: {
      if (--serf.timer > 0) return true;
      serf.anim = 0;
      const i = serf.pos;
      if (m.obj[i] === O.NONE && m.roads[i] === 0) {
        const mountain = m.terrain[i] === T.MOUNTAIN;
        const res = mountain && m.res[i] !== RES.FISH ? m.res[i] : RES.NONE;
        m.obj[i] = O.SIGN;
        m.objTimer[i] = 0;
        m.objId[i] = signCode(res, res === RES.NONE ? 0 : m.resAmt[i]);
        if (res !== RES.NONE) event(s, 'found', serf.owner, i, res);
      }
      serf.road++;
      if (serf.road >= GEO_PROBES) { back(s, serf); return true; }
      const p = pickSpot(s, serf);
      if (!p) { back(s, serf); return true; }
      serf.path = p;
      serf.sub = GS.TO_SPOT;
      return true;
    }
    case GS.BACK: {
      sendHome(s, serf);
      return true;
    }
  }
  return true;
}

/** Powrot do flagi startowej (stamtad po drogach do magazynu). */
function back(s: GameState, serf: Serf): void {
  const m = s.map;
  serf.sub = GS.BACK;
  serf.road = -1;
  if (hexDist(serf.pos % m.w, (serf.pos / m.w) | 0, serf.target % m.w, (serf.target / m.w) | 0) === 0) return;
  const p = findPath(m, serf.pos, serf.target, (i) => isFreeWalkable(m, i), 1500);
  if (p) serf.path = p;
}
