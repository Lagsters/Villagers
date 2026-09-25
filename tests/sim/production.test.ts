import { describe, expect, it } from 'vitest';
import { B, G, O, S, isStone } from '../../sim/defs.ts';
import { hashAny } from '../../sim/hash.ts';
import { STAGE } from '../../sim/types.ts';
import { buildConnected, countNear, newGame, run } from './helpers.ts';

function countObj(s: ReturnType<typeof newGame>, pred: (o: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < s.map.obj.length; i++) if (pred(s.map.obj[i])) n++;
  return n;
}

describe('M3: pierwsze lancuchy', () => {
  it('drwal scina drzewa i dostarcza pnie do zamku', () => {
    const s = newGame(1, 64, 'WOOD');
    const { ok } = buildConnected(s, 0, B.WOODCUTTER, 3, 7);
    expect(ok).toBe(true);
    const lumber0 = s.buildings[s.players[0].castle]!.inv!.goods[G.LUMBER];
    run(s, 4000);
    expect(s.players[0].stats.produced[G.LUMBER]).toBeGreaterThan(3);
    const inv = s.buildings[s.players[0].castle]!.inv!;
    expect(inv.goods[G.LUMBER]).toBeGreaterThan(lumber0);
  });

  it('lesnik sadzi drzewa, ktore rosna', () => {
    const s = newGame(1, 64, 'FOREST');
    const { ok } = buildConnected(s, 0, B.FORESTER, 3, 7);
    expect(ok).toBe(true);
    run(s, 1500);
    expect(countObj(s, (o) => o >= O.SAPLING1 && o <= O.SAPLING4)).toBeGreaterThan(3);
    const trees0 = countObj(s, (o) => o === O.TREE);
    run(s, 3500);
    expect(countObj(s, (o) => o === O.TREE)).toBeGreaterThan(trees0);
  });

  it('tartak robi deski z pni', () => {
    const s = newGame(1, 64, 'SAW');
    const { pos, ok } = buildConnected(s, 0, B.SAWMILL, 3, 7);
    expect(ok).toBe(true);
    run(s, 3000);
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.stage).toBe(STAGE.DONE);
    expect(s.players[0].stats.produced[G.PLANK]).toBeGreaterThan(3);
  });

  it('kamieniarz lupie skaly', () => {
    const s = newGame(1, 64, 'ROCK');
    const { ok } = buildConnected(s, 0, B.STONECUTTER, 3, 10, (pos) => countNear(s, pos, 6, (i) => isStone(s.map.obj[i])));
    expect(ok).toBe(true);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.STONE]).toBeGreaterThan(2);
  });

  it('caly lancuch jest deterministyczny przez 10 000 tickow', () => {
    const mk = () => {
      const s = newGame(2, 64, 'CHAIN');
      for (const p of [0, 1]) {
        buildConnected(s, p, B.WOODCUTTER, 3, 7);
        buildConnected(s, p, B.FORESTER, 3, 8);
        buildConnected(s, p, B.SAWMILL, 3, 8);
        buildConnected(s, p, B.STONECUTTER, 3, 9);
      }
      return s;
    };
    const a = mk();
    const b = mk();
    run(a, 10000);
    run(b, 10000);
    expect(hashAny(a)).toBe(hashAny(b));
    expect(a.serfs.some((x) => x && x.type === S.WOODCUTTER)).toBe(true);
  });
});
