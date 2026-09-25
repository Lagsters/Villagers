/**
 * Punkt wejscia symulacji. Rejestruje rozszerzenia petli ticku w stalej kolejnosci
 * (kolejnosc wplywa na wynik, wiec jest tylko tutaj) i eksportuje publiczne API.
 */
import { updateAnimals } from './animals.ts';
import { sweepMap } from './mapsweep.ts';
import { updateProduction, updateWorkerOut } from './production.ts';
import { hooks } from './step.ts';

let registered = false;
if (!registered) {
  registered = true;
  hooks.preTick.push(sweepMap, updateAnimals);
  hooks.serf.push((s, serf) => updateWorkerOut(s, serf));
  hooks.building.push(updateProduction);
}

export { createGame } from './state.ts';
export { step, hooks } from './step.ts';
export { applyCommand, type Command } from './commands.ts';
export { hashAny as hashState, serialize, deserialize } from './hash.ts';
export type { GameState } from './types.ts';
