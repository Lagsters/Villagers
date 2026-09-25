/**
 * Punkt wejscia symulacji. Rejestruje rozszerzenia petli ticku w stalej kolejnosci
 * (kolejnosc wplywa na wynik, wiec jest tylko tutaj) i eksportuje publiczne API.
 */
import { updateAnimals } from './animals.ts';
import { sweepMap } from './mapsweep.ts';
import { updateProduction, updateWorkerOut } from './production.ts';
import { hooks } from './step.ts';
import { registerCommand } from './commands.ts';
import { commandGeologist, updateGeologist } from './geologist.ts';
import { statsTick } from './stats.ts';

// Modul ES wykonuje sie raz, wiec rejestracja nastepuje dokladnie jeden raz.
hooks.preTick.push(sweepMap, updateAnimals);
hooks.serf.push((s, serf) => updateWorkerOut(s, serf));
hooks.serf.push(updateGeologist);
hooks.building.push(updateProduction);
registerCommand('geologist', commandGeologist);
hooks.postTick.push(statsTick);

export { createGame } from './state.ts';
export { step, hooks } from './step.ts';
export { applyCommand, type Command } from './commands.ts';
export { hashAny as hashState, serialize, deserialize } from './hash.ts';
export type { GameState } from './types.ts';
