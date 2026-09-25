/**
 * Punkt wejscia symulacji: importuje wszystkie moduly rejestrujace rozszerzenia (hooks),
 * i eksportuje publiczne API.
 */
export { createGame } from './state.ts';
export { step, hooks } from './step.ts';
export { applyCommand, type Command } from './commands.ts';
export { hashAny as hashState, serialize, deserialize } from './hash.ts';
export type { GameState } from './types.ts';
