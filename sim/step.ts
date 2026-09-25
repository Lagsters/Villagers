/**
 * Jeden tick symulacji: step(state, commands) -> state (modyfikuje stan w miejscu).
 */
import { BUILDINGS } from './defs.ts';
import { applyCommand, type Command } from './commands.ts';
import { constructionArrive, updateBuilder, updateBurning, updateDigger } from './construction.ts';
import { ECON_PERIOD, birthTick, economyPass } from './economy.ts';
import { SS, advanceMove, arriveWalking, sendHome } from './serfs.ts';
import { carrierArrived, updateCarrier } from './transport.ts';
import { STAGE, type Building, type GameState, type Serf } from './types.ts';
import { event } from './world.ts';

export type Hook = (s: GameState) => void;
export type SerfHook = (s: GameState, serf: Serf) => boolean;
export type ArriveHook = (s: GameState, serf: Serf, b: Building) => boolean;
export type BuildingHook = (s: GameState, b: Building) => void;

/** Rozszerzenia z pozniejszych modulow (produkcja, wojsko, statystyki). */
export const hooks = {
  serf: [] as SerfHook[],
  arrive: [] as ArriveHook[],
  building: [] as BuildingHook[],
  preTick: [] as Hook[],
  postTick: [] as Hook[],
};

function onBuildingArrive(s: GameState, serf: Serf, b: Building): void {
  if (constructionArrive(serf, b)) return;
  if (b.worker === serf.id && b.stage === STAGE.DONE && BUILDINGS[b.kind].worker === serf.type) {
    b.workerInside = true;
    serf.home = b.id;
    serf.state = SS.INSIDE;
    serf.anim = 0;
    serf.timer = 0;
    return;
  }
  for (const h of hooks.arrive) if (h(s, serf, b)) return;
  sendHome(s, serf);
}

function updateSerf(s: GameState, serf: Serf): void {
  if (!advanceMove(s, serf)) return;
  switch (serf.state) {
    case SS.TO_ROAD:
      carrierArrived(s, serf);
      return;
    case SS.CARRIER:
      updateCarrier(s, serf);
      return;
    case SS.TO_BUILDING:
    case SS.TO_INVENTORY:
    case SS.LOST:
      arriveWalking(s, serf, (sf, b) => onBuildingArrive(s, sf, b));
      return;
    case SS.BUILDER:
      updateBuilder(s, serf);
      return;
    case SS.DIGGER:
      updateDigger(s, serf, (idx) => event(s, 'height', serf.owner, idx));
      return;
  }
  for (const h of hooks.serf) if (h(s, serf)) return;
}

export function step(s: GameState, commands: readonly Command[]): GameState {
  s._events = [];
  for (const c of commands) applyCommand(s, c);
  for (const h of hooks.preTick) h(s);
  const serfs = s.serfs;
  for (let i = 0; i < serfs.length; i++) {
    const serf = serfs[i];
    if (serf) updateSerf(s, serf);
  }
  const bs = s.buildings;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (!b) continue;
    if (b.stage === STAGE.BURN) {
      updateBurning(s, b);
      continue;
    }
    for (const h of hooks.building) h(s, b);
  }
  for (const p of s.players) {
    birthTick(s, p.id);
    if (s.tick % ECON_PERIOD === p.id % ECON_PERIOD) economyPass(s, p.id);
  }
  for (const h of hooks.postTick) h(s);
  s.tick++;
  return s;
}
