import { describe, expect, it } from 'vitest';
import { B, G, O, S, T } from '../../sim/defs.ts';
import { placeBuilding } from '../../sim/construction.ts';
import { hexDist, spiral } from '../../sim/grid.ts';
import { attackersAvailable, knightArrive } from '../../sim/military.ts';
import { createSerf, SS } from '../../sim/serfs.ts';
import { step } from '../../sim/step.ts';
import { STAGE, type GameState } from '../../sim/types.ts';
import { buildConnected, newGame, run } from './helpers.ts';

function dist(s: GameState, a: number, b: number): number {
  const w = s.map.w;
  return hexDist(a % w, (a / w) | 0, b % w, (b / w) | 0);
}

function castleOfCat(s: GameState) {
  return s.buildings[s.players[0].castle]!;
}

/** Wolne miejsce pod budynek: trawa bez obiektow w promieniu 2. */
function clearSpot(s: GameState, near: number, minD: number, maxD: number, avoid: number[] = []): number {
  const m = s.map;
  for (const i of spiral(m.w, m.h, near % m.w, (near / m.w) | 0, maxD)) {
    if (dist(s, i, near) < minD) continue;
    if (avoid.some((a) => dist(s, i, a) < 4)) continue;
    let ok = true;
    for (const j of spiral(m.w, m.h, i % m.w, (i / m.w) | 0, 2)) {
      if (m.terrain[j] !== T.GRASS || m.obj[j] !== O.NONE || m.roads[j] !== 0) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/** Stawia gotowy budynek wojskowy z rycerzami o podanych poziomach (scenariusz testowy). */
function spawnMilitary(s: GameState, p: number, pos: number, kind: number, levels: number[]): number {
  const m = s.map;
  for (const j of spiral(m.w, m.h, pos % m.w, (pos / m.w) | 0, 1)) m.owner[j] = p + 1;
  const id = placeBuilding(s, p, pos, kind, true);
  const b = s.buildings[id]!;
  for (const lv of levels) {
    const k = createSerf(s, p, S.KNIGHT, pos);
    k.level = lv;
    s.players[p].totalSerfs++;
    knightArrive(s, k, b);
  }
  return id;
}

describe('M5: budynki wojskowe i terytorium', () => {
  it('strażnica dostaje rycerza i poszerza terytorium', () => {
    const s = newGame(1, 64, 'MIL');
    const owned0 = s.map.owner.reduce((a, o) => a + (o === 1 ? 1 : 0), 0);
    const c = s.buildings[s.players[0].castle]!;
    const { pos, ok } = buildConnected(s, 0, B.GUARDHUT, 6, 9, (p) => dist(s, p, c.pos));
    expect(ok).toBe(true);
    run(s, 2500);
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.stage).toBe(STAGE.DONE);
    expect(b.knights.length).toBeGreaterThanOrEqual(1);
    const owned1 = s.map.owner.reduce((a, o) => a + (o === 1 ? 1 : 0), 0);
    expect(owned1).toBeGreaterThan(owned0);
  });

  it('obsada zalezy od ustawien', () => {
    const s = newGame(1, 64, 'MIL');
    step(s, [{ type: 'setting', player: 0, key: 'knightsInterior', value: 4 }, { type: 'setting', player: 0, key: 'knightsBorder', value: 4 }]);
    const { pos } = buildConnected(s, 0, B.TOWER, 5, 9);
    run(s, 4000);
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.knights.length).toBe(4);
    step(s, [{ type: 'setting', player: 0, key: 'knightsBorder', value: 1 }, { type: 'setting', player: 0, key: 'knightsInterior', value: 1 }]);
    run(s, 400);
    expect(b.knights.length).toBe(1);
  });

  it('zloto szkoli rycerzy', () => {
    const s = newGame(1, 64, 'GOLDK');
    const c = s.buildings[s.players[0].castle]!;
    const spot = clearSpot(s, c.pos, 6, 10);
    const id = spawnMilitary(s, 0, spot, B.TOWER, [0, 0]);
    const b = s.buildings[id]!;
    b.gold = 2;
    run(s, 1300);
    const lv = b.knights.map((k) => s.serfs[k]!.level);
    expect(lv.reduce((a, l) => a + l, 0)).toBeGreaterThanOrEqual(2);
  });
});

describe('M5: katapulta', () => {
  it('katapulta zabija rycerzy we wrogim budynku w zasiegu', () => {
    const s = newGame(2, 64, 'CATA');
    const c0 = s.buildings[s.players[0].castle]!;
    const c1 = s.buildings[s.players[1].castle]!;
    const w = s.map.w;
    const mid = (((c0.pos / w) | 0) + ((c1.pos / w) | 0) >> 1) * w + ((c0.pos % w) + (c1.pos % w) >> 1);
    const a = clearSpot(s, mid, 3, 12, [c0.pos, c1.pos]);
    const d = clearSpot(s, a, 6, 9, [c0.pos, c1.pos, a]);
    const did = spawnMilitary(s, 1, d, B.TOWER, [0, 0, 0, 0, 0, 0]);
    // Bez posilkow z zamku mierzymy sama katapulte.
    c1.inv!.knights = [0, 0, 0, 0, 0];
    c1.inv!.goods[G.SWORD] = 0;
    for (const j of spiral(s.map.w, s.map.h, a % w, (a / w) | 0, 1)) s.map.owner[j] = 1;
    const cid = placeBuilding(s, 0, a, B.CATAPULT, true);
    const cat = s.buildings[cid]!;
    const worker = createSerf(s, 0, S.CATAPULTER, a);
    worker.state = SS.INSIDE;
    worker.home = cid;
    cat.worker = worker.id;
    cat.workerInside = true;
    cat.stock[0] = 4;
    castleOfCat(s).inv!.goods[G.STONE] = 40;
    run(s, 6000);
    expect(s.buildings[did]!.knights.length).toBeLessThan(6);
    expect(s.buildings[did]!.knights.length).toBeGreaterThanOrEqual(1);
  });
});

describe('M5: walka', () => {
  function duelSetup(code: string, attackerLevels: number[], defenderLevels: number[]) {
    const s = newGame(2, 64, code);
    const c0 = s.buildings[s.players[0].castle]!;
    const c1 = s.buildings[s.players[1].castle]!;
    // Budynki miedzy zamkami, ~7 pol od siebie.
    const w = s.map.w;
    const mid = (((c0.pos / w) | 0) + ((c1.pos / w) | 0) >> 1) * w + ((c0.pos % w) + (c1.pos % w) >> 1);
    const a = clearSpot(s, mid, 3, 12, [c0.pos, c1.pos]);
    const d = clearSpot(s, a, 6, 9, [c0.pos, c1.pos, a]);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThanOrEqual(0);
    const aid = spawnMilitary(s, 0, a, B.FORTRESS, attackerLevels);
    const did = spawnMilitary(s, 1, d, B.GUARDHUT, defenderLevels);
    return { s, aid, did };
  }

  it('silny atak przejmuje straznice, a budynki wroga na utraconym terenie plona', () => {
    const { s, did } = duelSetup('WAR', [4, 4, 4, 4, 4, 4], [0]);
    const target = s.buildings[did]!;
    expect(attackersAvailable(s, 0, target)).toBe(5);
    step(s, [{ type: 'attack', player: 0, pos: target.pos, count: 5 }]);
    expect(s.serfs.filter((x) => x && x.state === SS.KNIGHT_ATTACK).length).toBe(5);
    let captured = false;
    for (let i = 0; i < 3000 && !captured; i++) {
      step(s, []);
      captured = s.buildings[did]?.owner === 0;
    }
    expect(captured).toBe(true);
    expect(s.map.owner[target.pos]).toBe(1);
    run(s, 400);
    // Atakujacy, ktorzy nie weszli, wrocili do domu.
    expect(s.serfs.filter((x) => x && (x.state === SS.KNIGHT_ATTACK || x.state === SS.KNIGHT_WAIT)).length).toBe(0);
  });

  it('slaby atak przegrywa z silnym obronca', () => {
    const { s, did } = duelSetup('WAR2', [0, 0], [4, 4]);
    const target = s.buildings[did]!;
    step(s, [{ type: 'attack', player: 0, pos: target.pos, count: 1 }]);
    run(s, 2500);
    expect(s.buildings[did]!.owner).toBe(1);
    expect(s.serfs.filter((x) => x && x.owner === 0 && x.type === S.KNIGHT && x.state !== SS.INSIDE).length).toBe(0);
  });

  it('zniszczenie zamku eliminuje gracza i daje zwyciestwo', () => {
    const s = newGame(2, 64, 'WIN');
    const c1 = s.buildings[s.players[1].castle]!;
    c1.inv!.knights = [1, 0, 0, 0, 0];
    const spot = clearSpot(s, c1.pos, 10, 13, [c1.pos]);
    expect(spot).toBeGreaterThanOrEqual(0);
    spawnMilitary(s, 0, spot, B.FORTRESS, [4, 4, 4, 4, 4, 4, 4, 4]);
    step(s, [{ type: 'attack', player: 0, pos: c1.pos, count: 7 }]);
    for (let i = 0; i < 4000 && s.winner === -1; i++) step(s, []);
    expect(s.winner).toBe(0);
    expect(s.players[1].alive).toBe(false);
    expect(s.map.owner.some((o) => o === 2)).toBe(false);
  });
});
