import { describe, expect, it } from 'vitest';
import { B, G, O, S } from '../../sim/defs.ts';
import { DIR_SE } from '../../sim/grid.ts';
import { deserialize, hashAny, serialize } from '../../sim/hash.ts';
import { findRoadPath } from '../../sim/roads.ts';
import { step } from '../../sim/step.ts';
import { STAGE, type GameState } from '../../sim/types.ts';
import { canPlaceFlag, neighbor } from '../../sim/world.ts';
import { buildConnected, findSite, newGame, run } from './helpers.ts';

function castleOf(s: GameState, p = 0) {
  return s.buildings[s.players[p].castle]!;
}

describe('start gry', () => {
  it('zamek stoi z inwentarzem i terytorium', () => {
    const s = newGame(2);
    for (const p of s.players) {
      const c = s.buildings[p.castle]!;
      expect(c.kind).toBe(B.CASTLE);
      expect(c.stage).toBe(STAGE.DONE);
      expect(c.inv!.goods[G.PLANK]).toBe(40);
      expect(s.map.owner[c.pos]).toBe(p.id + 1);
      expect(s.map.obj[s.flags[c.flag]!.pos]).toBe(O.FLAG);
    }
    let owned = 0;
    for (let i = 0; i < s.map.owner.length; i++) if (s.map.owner[i] === 1) owned++;
    expect(owned).toBe(1 + 3 * 9 * 10);
  });
});

describe('flagi i drogi', () => {
  it('flaga nie moze stac obok innej flagi', () => {
    const s = newGame(1);
    const cf = s.flags[castleOf(s).flag]!;
    for (let d = 0; d < 6; d++) {
      const n = neighbor(s.map, cf.pos, d);
      expect(canPlaceFlag(s, 0, n)).toBe(false);
    }
  });

  it('droga laczy flagi, a flaga na drodze ja dzieli', () => {
    const s = newGame(1);
    const cf = s.flags[castleOf(s).flag]!;
    // Cel 5 pol na wschod.
    let target = cf.pos;
    for (let i = 0; i < 5; i++) target = neighbor(s.map, target, 0);
    const dirs = findRoadPath(s, 0, cf.pos, target);
    expect(dirs).not.toBeNull();
    step(s, [{ type: 'road', player: 0, pos: cf.pos, dirs: dirs! }]);
    const roads = s.roads.filter((r) => r);
    expect(roads.length).toBe(1);
    const road = roads[0]!;
    const mid = road.cells[2];
    step(s, [{ type: 'flag', player: 0, pos: mid }]);
    expect(s.roads.filter((r) => r).length).toBe(2);
    expect(s.map.obj[mid]).toBe(O.FLAG);
    // Rozbiorka srodkowej flagi usuwa obie drogi.
    step(s, [{ type: 'demolish', player: 0, pos: mid }]);
    expect(s.roads.filter((r) => r).length).toBe(0);
    expect(s.map.roads[road.cells[1]]).toBe(0);
  });

  it('niepoprawna droga jest ignorowana', () => {
    const s = newGame(1);
    const cf = s.flags[castleOf(s).flag]!;
    step(s, [{ type: 'road', player: 0, pos: cf.pos, dirs: [4] }]); // NW = drzwi zamku
    step(s, [{ type: 'road', player: 1, pos: cf.pos, dirs: [0, 0] }]); // nie ma gracza 1
    step(s, [{ type: 'road', player: 0, pos: cf.pos, dirs: [0, 3] }]); // zawraca
    expect(s.roads.filter((r) => r).length).toBe(0);
  });
});

describe('tragarze i budowa', () => {
  it('tragarz przychodzi na droge, deski docieraja, budynek powstaje', () => {
    const s = newGame(1);
    const { pos, ok } = buildConnected(s, 0, B.WOODCUTTER, 4, 8);
    expect(ok).toBe(true);
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.stage).toBe(STAGE.BUILD);
    run(s, 60);
    const carriers = s.serfs.filter((x) => x && x.type === S.TRANSPORTER);
    expect(carriers.length).toBeGreaterThan(0);
    run(s, 1500);
    expect(b.stage).toBe(STAGE.DONE);
    expect(b.planksUsed).toBe(2);
    expect(castleOf(s).inv!.goods[G.PLANK]).toBe(38);
    // Budowniczy wrocil do zamku.
    expect(s.serfs.some((x) => x && x.type === S.BUILDER)).toBe(false);
  });

  it('duzy budynek wymaga wyrownania terenu przez kopacza', () => {
    const s = newGame(1, 64, 'HILLS');
    const pos = findSite(s, 0, B.FARM, 4, 9);
    expect(pos).toBeGreaterThanOrEqual(0);
    step(s, [{ type: 'build', player: 0, pos, kind: B.FARM }]);
    const b = s.buildings[s.map.objId[pos]]!;
    const flagPos = neighbor(s.map, pos, DIR_SE);
    const dirs = findRoadPath(s, 0, flagPos, s.flags[castleOf(s).flag]!.pos)!;
    step(s, [{ type: 'road', player: 0, pos: flagPos, dirs }]);
    run(s, 3000);
    expect(b.stage).toBe(STAGE.DONE);
    const h = s.map.height[pos];
    for (let d = 0; d < 6; d++) expect(s.map.height[neighbor(s.map, pos, d)]).toBe(h);
  });

  it('rozbiorka drogi odsyla tragarza, towary nie gina w nieskonczonosc', () => {
    const s = newGame(1);
    const { pos } = buildConnected(s, 0, B.SAWMILL, 4, 8);
    run(s, 200);
    const flagPos = neighbor(s.map, pos, DIR_SE);
    const f = s.flags[s.map.objId[flagPos]]!;
    const rid = f.roads.find((r) => r >= 0)!;
    const road = s.roads[rid]!;
    step(s, [{ type: 'demolish', player: 0, pos: road.cells[1] }]);
    run(s, 800);
    expect(s.serfs.filter((x) => x && x.type === S.TRANSPORTER).length).toBe(0);
    // Plac budowy nie liczy juz towarow w drodze, ktore przepadly.
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.planksTransit).toBeLessThanOrEqual(0 + 3);
  });
});

describe('determinizm', () => {
  function scenario(): GameState {
    const s = newGame(2, 64, 'DET');
    for (const p of [0, 1]) {
      buildConnected(s, p, B.WOODCUTTER, 3, 8);
      buildConnected(s, p, B.FORESTER, 3, 8);
      buildConnected(s, p, B.FARM, 4, 9);
      buildConnected(s, p, B.STONECUTTER, 3, 9);
    }
    return s;
  }

  it('dwie instancje daja ten sam hash, zapis/odczyt nie zmienia przebiegu', () => {
    const a = scenario();
    const b = scenario();
    run(a, 3000);
    run(b, 3000);
    expect(hashAny(a)).toBe(hashAny(b));
    const c = deserialize<GameState>(serialize(a));
    expect(hashAny(c)).toBe(hashAny(a));
    run(a, 3000);
    run(c, 3000);
    expect(hashAny(c)).toBe(hashAny(a));
  });
});
