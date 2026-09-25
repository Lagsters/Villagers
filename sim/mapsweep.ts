/**
 * Przeglad mapy: co tick obslugujemy wycinek mapy tak, zeby kazde pole bylo odwiedzone
 * co SWEEP_PERIOD tickow. Wzrost sadzonek i zboza, znikanie pni, znakow i ruin, odnawianie ryb.
 * Liczniki w map.objTimer sa w jednostkach "odwiedzin".
 */
import { O, RES, T } from './defs.ts';
import type { GameState } from './types.ts';

export const SWEEP_PERIOD = 50;
/** Odwiedziny na etap (czasy z GDD / SWEEP_PERIOD). */
export const SAPLING_STAGE = 14; // 700 tickow
export const STUMP_LIFE = 6; // 300
export const FIELD_STAGE = 10; // 500
export const FIELD_RIPE_LIFE = 60; // 3000
export const SIGN_LIFE = 120; // 6000
export const FISH_REGEN_ROUNDS = 60; // 3000 tickow
export const FISH_MAX = 10;

export function sweepMap(s: GameState): void {
  const map = s.map;
  const n = map.w * map.h;
  const per = Math.ceil(n / SWEEP_PERIOD);
  const round = Math.floor(s.tick / SWEEP_PERIOD);
  const fishRound = round % FISH_REGEN_ROUNDS === 0;
  let i = s.sweep;
  for (let k = 0; k < per; k++) {
    if (i >= n) i = 0;
    const o = map.obj[i];
    if (o !== O.NONE) {
      if (o >= O.SAPLING1 && o <= O.SAPLING4) {
        if (++map.objTimer[i] >= SAPLING_STAGE) {
          map.objTimer[i] = 0;
          map.obj[i] = o + 1;
          map.objId[i] = -1;
        }
      } else if (o === O.STUMP) {
        if (++map.objTimer[i] >= STUMP_LIFE) clearObj(s, i);
      } else if (o >= O.FIELD1 && o < O.FIELD_RIPE) {
        if (++map.objTimer[i] >= FIELD_STAGE) {
          map.objTimer[i] = 0;
          map.obj[i] = o + 1;
        }
      } else if (o === O.FIELD_RIPE) {
        if (++map.objTimer[i] >= FIELD_RIPE_LIFE) clearObj(s, i);
      } else if (o === O.SIGN) {
        if (++map.objTimer[i] >= SIGN_LIFE) clearObj(s, i);
      } else if (o === O.RUIN) {
        if (map.objTimer[i] > 0) map.objTimer[i]--;
        else clearObj(s, i);
      }
    }
    if (fishRound && map.terrain[i] === T.WATER && map.res[i] === RES.FISH && map.resAmt[i] < FISH_MAX) map.resAmt[i]++;
    i++;
  }
  s.sweep = i >= n ? 0 : i;
}

export function clearObj(s: GameState, i: number): void {
  s.map.obj[i] = O.NONE;
  s.map.objTimer[i] = 0;
  s.map.objId[i] = -1;
}
