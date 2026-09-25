/**
 * Statystyki: co STATS_PERIOD tickow probka na gracza. Historia ma maks. MAX_SAMPLES probek;
 * po zapelnieniu sasiednie probki sa usredniane parami (rozdzielczosc spada, zakres rosnie).
 */
import { GOODS_COUNT, S } from './defs.ts';
import { STAGE, type GameState } from './types.ts';

export const STATS_PERIOD = 300;
export const MAX_SAMPLES = 240;
/** Indeksy pol probki. */
export const ST = { TICK: 0, BUILDINGS: 1, SERFS: 2, KNIGHTS: 3, STRENGTH: 4, TERRITORY: 5, GOODS: 6 } as const;

export interface PlayerSummary {
  buildings: number;
  serfs: number;
  knights: number;
  strength: number;
  territory: number;
  goods: number[];
}

export function summarize(s: GameState, p: number): PlayerSummary {
  const sum: PlayerSummary = { buildings: 0, serfs: 0, knights: 0, strength: 0, territory: 0, goods: new Array(GOODS_COUNT).fill(0) };
  for (const b of s.buildings) {
    if (!b || b.owner !== p || b.stage === STAGE.BURN) continue;
    sum.buildings++;
    if (b.inv) {
      for (let g = 0; g < GOODS_COUNT; g++) sum.goods[g] += b.inv.goods[g];
      for (let t = 0; t < b.inv.serfs.length; t++) if (t !== S.DONKEY) sum.serfs += b.inv.serfs[t];
      for (let l = 0; l < 5; l++) {
        sum.knights += b.inv.knights[l];
        sum.strength += b.inv.knights[l] * (l + 1);
      }
    }
  }
  for (const sf of s.serfs) {
    if (!sf || sf.owner !== p || sf.type === S.DONKEY) continue;
    if (sf.type === S.KNIGHT) {
      sum.knights++;
      sum.strength += sf.level + 1;
    } else sum.serfs++;
  }
  const own = p + 1;
  const o = s.map.owner;
  for (let i = 0; i < o.length; i++) if (o[i] === own) sum.territory++;
  return sum;
}

export function statsTick(s: GameState): void {
  if (s.tick % STATS_PERIOD !== 0) return;
  for (const pl of s.players) {
    const sm = summarize(s, pl.id);
    pl.territory = sm.territory;
    const sample = [s.tick, sm.buildings, sm.serfs, sm.knights, sm.strength, sm.territory, ...sm.goods];
    const list = pl.stats.samples;
    list.push(sample);
    if (list.length >= MAX_SAMPLES) {
      const merged: number[][] = [];
      for (let i = 0; i + 1 < list.length; i += 2) {
        const a = list[i], b = list[i + 1];
        merged.push(a.map((v, k) => (k === ST.TICK ? b[k] : (v + b[k]) >> 1)));
      }
      if (list.length % 2 === 1) merged.push(list[list.length - 1]);
      pl.stats.samples = merged;
    }
  }
}
