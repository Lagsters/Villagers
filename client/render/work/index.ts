/**
 * Rejestr scen pracy: laczy zestawy scen z plikow zawodow. Kazdy zawod i budynek ma jednego wlasciciela
 * (powtorzony klucz to blad - wychodzi od razu przy starcie).
 */
import type { AnimalScene, BuildingScene, Scenes, SerfScene, SiteScene, WorkCtx } from './types.ts';
import type { GameEvent } from '../../../sim/types.ts';
import { woodScenes } from './wood.ts';
import { fieldScenes } from './field.ts';
import { craftScenes } from './crafts.ts';
import { industryScenes } from './industry.ts';
import { peopleScenes } from './people.ts';

const SETS: Scenes[] = [woodScenes, fieldScenes, craftScenes, industryScenes, peopleScenes];

export const serfScenes: Partial<Record<number, SerfScene>> = {};
export const buildingScenes: Partial<Record<number, BuildingScene>> = {};
const sites: SiteScene[] = [];
const animals: AnimalScene[] = [];
const eventHandlers: ((c: WorkCtx, ev: readonly GameEvent[]) => void)[] = [];
const frames: ((c: WorkCtx) => void)[] = [];

for (const set of SETS) {
  for (const [k, f] of Object.entries(set.serf ?? {})) {
    if (serfScenes[+k]) throw new Error(`Scena osadnika ${k} zdefiniowana dwa razy`);
    serfScenes[+k] = f;
  }
  for (const [k, f] of Object.entries(set.building ?? {})) {
    if (buildingScenes[+k]) throw new Error(`Scena budynku ${k} zdefiniowana dwa razy`);
    buildingScenes[+k] = f;
  }
  if (set.site) sites.push(set.site);
  if (set.animal) animals.push(set.animal);
  if (set.events) eventHandlers.push(set.events);
  if (set.frame) frames.push(set.frame);
}

export const siteScenes: readonly SiteScene[] = sites;
export const animalScenes: readonly AnimalScene[] = animals;
export const eventScenes: readonly ((c: WorkCtx, ev: readonly GameEvent[]) => void)[] = eventHandlers;
export const frameScenes: readonly ((c: WorkCtx) => void)[] = frames;
