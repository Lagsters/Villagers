/**
 * Dzikie zwierzeta: wedruja po lakach w poblizu lasow, sa celem mysliwych.
 */
import { O, T } from './defs.ts';
import { randInt } from './rng.ts';
import type { Animal, GameState } from './types.ts';
import { allocId, isFreeWalkable, nb, walkCost } from './world.ts';

export const ANIMAL_SPAWN_TICKS = 1500;

export function maxAnimals(s: GameState): number {
  return Math.floor((s.map.w * s.map.h) / 150);
}

function animalCount(s: GameState): number {
  let n = 0;
  for (const a of s.animals) if (a) n++;
  return n;
}

function freeForAnimal(s: GameState, i: number): boolean {
  const m = s.map;
  return isFreeWalkable(m, i) && m.terrain[i] === T.GRASS && m.obj[i] !== O.FLAG && m.roads[i] === 0;
}

/** Proba postawienia zwierzecia przy losowym drzewie. */
export function spawnAnimal(s: GameState): boolean {
  const m = s.map;
  const t = nb(m);
  for (let attempt = 0; attempt < 30; attempt++) {
    const i = randInt(s, m.w * m.h);
    if (m.obj[i] !== O.TREE) continue;
    for (let d = 0; d < 6; d++) {
      const j = t[i * 6 + d];
      if (j >= 0 && freeForAnimal(s, j)) {
        const id = allocId(s.animals, s.freeAnimals);
        const a: Animal = { id, pos: j, to: -1, t: 0, dur: 0, timer: 20 + randInt(s, 40), hunter: -1 };
        s.animals[id] = a;
        return true;
      }
    }
  }
  return false;
}

export function removeAnimal(s: GameState, a: Animal): void {
  s.animals[a.id] = null;
  s.freeAnimals.push(a.id);
}

export function updateAnimals(s: GameState): void {
  if (--s.animalTimer <= 0) {
    s.animalTimer = ANIMAL_SPAWN_TICKS;
    if (animalCount(s) < maxAnimals(s)) spawnAnimal(s);
  }
  const t = nb(s.map);
  for (const a of s.animals) {
    if (!a) continue;
    if (a.to >= 0) {
      if (++a.t < a.dur) continue;
      a.pos = a.to;
      a.to = -1;
      a.t = 0;
    }
    if (a.hunter >= 0) {
      const h = s.serfs[a.hunter];
      if (!h || h.target !== a.id) a.hunter = -1;
      else continue;
    }
    if (--a.timer > 0) continue;
    a.timer = 20 + randInt(s, 60);
    const d = randInt(s, 6);
    const j = t[a.pos * 6 + d];
    if (j >= 0 && freeForAnimal(s, j)) {
      a.to = j;
      a.t = 0;
      a.dur = walkCost(s.map, a.pos, j) + 4;
    }
  }
}
