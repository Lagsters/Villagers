import { describe, expect, it } from 'vitest';
import { B, FIRST_TOOL, G, O, RES, S, T, TOOLS_COUNT } from '../../sim/defs.ts';
import { spiral } from '../../sim/grid.ts';
import { signCode } from '../../sim/geologist.ts';
import type { GameState } from '../../sim/types.ts';
import { STAGE } from '../../sim/types.ts';
import { step } from '../../sim/step.ts';
import { buildConnected, countNear, findSiteBest, newGame, run } from './helpers.ts';

function castleInv(s: GameState, p = 0) {
  return s.buildings[s.players[p].castle]!.inv!;
}

/** Zamienia teren w promieniu r wokol pola w gory ze zlozem (do testow kopalni). */
function makeMountain(s: GameState, center: number, r: number, res: number): void {
  const m = s.map;
  for (const i of spiral(m.w, m.h, center % m.w, (center / m.w) | 0, r)) {
    if (m.obj[i] !== O.NONE) continue;
    m.terrain[i] = T.MOUNTAIN;
    m.res[i] = res;
    m.resAmt[i] = 12;
    m.height[i] = m.height[center];
  }
}

/** Pole w terytorium, ~6 od zamku, bez obiektow w promieniu 2. */
function freeSpot(s: GameState): number {
  const castle = s.buildings[s.players[0].castle]!;
  const m = s.map;
  for (const i of spiral(m.w, m.h, castle.pos % m.w, (castle.pos / m.w) | 0, 7)) {
    const x = i % m.w, y = (i / m.w) | 0;
    const d = Math.abs(x - castle.pos % m.w) + Math.abs(y - ((castle.pos / m.w) | 0));
    if (d < 5) continue;
    if (countNear(s, i, 2, (j) => m.obj[j] !== O.NONE || m.roads[j] !== 0 || m.terrain[j] !== T.GRASS) === 0) return i;
  }
  return -1;
}

describe('M4: kopalnie i jedzenie', () => {
  it('kopalnia wegla zuzywa jedzenie i wydobywa wegiel', () => {
    const s = newGame(1, 64, 'MINE');
    const spot = freeSpot(s);
    expect(spot).toBeGreaterThanOrEqual(0);
    makeMountain(s, spot, 2, RES.COAL);
    const { ok } = buildConnected(s, 0, B.COALMINE, 3, 9);
    expect(ok).toBe(true);
    const food0 = castleInv(s).goods[G.FISH] + castleInv(s).goods[G.BREAD] + castleInv(s).goods[G.MEAT];
    run(s, 4000);
    expect(s.players[0].stats.produced[G.COAL]).toBeGreaterThan(2);
    const food1 = castleInv(s).goods[G.FISH] + castleInv(s).goods[G.BREAD] + castleInv(s).goods[G.MEAT];
    expect(food1).toBeLessThan(food0);
  });

  it('waga 0 dla kopalni wegla wstrzymuje dostawy jedzenia', () => {
    const s = newGame(1, 64, 'MINE');
    makeMountain(s, freeSpot(s), 2, RES.COAL);
    step(s, [{ type: 'setting', player: 0, key: 'foodCoal', value: 0 }]);
    buildConnected(s, 0, B.COALMINE, 3, 9);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.COAL]).toBe(0);
  });

  it('pusta kopalnia zglasza wyczerpanie', () => {
    const s = newGame(1, 64, 'MINE');
    makeMountain(s, freeSpot(s), 2, RES.NONE);
    buildConnected(s, 0, B.IRONMINE, 3, 9);
    let exhausted = false;
    for (let i = 0; i < 6000; i++) {
      step(s, []);
      if (s._events.some((e) => e.type === 'exhausted')) exhausted = true;
    }
    expect(exhausted).toBe(true);
  });
});

describe('M4: hutnictwo, narzedzia, bron', () => {
  it('huta zelaza robi stal, narzedziownia narzedzia, zbrojownia bron -> rycerze', () => {
    const s = newGame(1, 64, 'SMITH');
    buildConnected(s, 0, B.STEELWORKS, 3, 8);
    buildConnected(s, 0, B.TOOLMAKER, 3, 8);
    buildConnected(s, 0, B.WEAPONSMITH, 3, 9);
    const knights0 = castleInv(s).knights.reduce((a, b) => a + b, 0);
    run(s, 6000);
    const pr = s.players[0].stats.produced;
    expect(pr[G.STEEL]).toBeGreaterThan(2);
    let tools = 0;
    for (let g: number = FIRST_TOOL; g < FIRST_TOOL + TOOLS_COUNT; g++) tools += pr[g];
    expect(tools).toBeGreaterThan(0);
    expect(pr[G.SWORD]).toBeGreaterThan(0);
    expect(pr[G.SHIELD]).toBe(pr[G.SWORD]);
    expect(castleInv(s).knights.reduce((a, b) => a + b, 0)).toBeGreaterThan(knights0);
  });

  it('priorytety narzedzi: tylko wybrane narzedzie', () => {
    const s = newGame(1, 64, 'TOOLS');
    const prio = new Array(TOOLS_COUNT).fill(0);
    prio[G.SAW - FIRST_TOOL] = 8;
    step(s, [{ type: 'setting', player: 0, key: 'toolPrio', value: prio }]);
    buildConnected(s, 0, B.TOOLMAKER, 3, 8);
    run(s, 5000);
    const pr = s.players[0].stats.produced;
    expect(pr[G.SAW]).toBeGreaterThan(0);
    for (let g: number = FIRST_TOOL; g < FIRST_TOOL + TOOLS_COUNT; g++) if (g !== G.SAW) expect(pr[g]).toBe(0);
  });

  it('mennica bije monety', () => {
    const s = newGame(1, 64, 'GOLD');
    castleInv(s).goods[G.GOLD_ORE] = 4;
    buildConnected(s, 0, B.MINT, 3, 8);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.GOLD]).toBeGreaterThan(0);
  });
});

describe('M4: jedzenie', () => {
  it('farma -> mlyn -> piekarnia daje chleb; chlewnia -> rzeznia daje mieso', () => {
    const s = newGame(1, 96, 'BREAD');
    buildConnected(s, 0, B.FARM, 4, 10, (pos) => countNear(s, pos, 3, (i) => s.map.obj[i] === O.NONE && s.map.terrain[i] === T.GRASS));
    buildConnected(s, 0, B.WELL, 3, 9);
    buildConnected(s, 0, B.WELL, 3, 9);
    buildConnected(s, 0, B.MILL, 3, 9);
    buildConnected(s, 0, B.BAKERY, 3, 9);
    buildConnected(s, 0, B.PIGFARM, 4, 10);
    buildConnected(s, 0, B.BUTCHER, 3, 9);
    run(s, 9000);
    const pr = s.players[0].stats.produced;
    expect(pr[G.WHEAT]).toBeGreaterThan(0);
    expect(pr[G.FLOUR]).toBeGreaterThan(0);
    expect(pr[G.BREAD]).toBeGreaterThan(0);
    expect(pr[G.PIG]).toBeGreaterThan(0);
    expect(pr[G.MEAT]).toBeGreaterThan(0);
  });

  it('rybak lowi ryby', () => {
    const s = newGame(1, 64, 'FISH');
    const m = s.map;
    const pos = findSiteBest(s, 0, B.FISHER, (p) => countNear(s, p, 5, (i) => m.terrain[i] === T.WATER && m.res[i] === RES.FISH));
    expect(pos).toBeGreaterThanOrEqual(0);
    buildConnected(s, 0, B.FISHER, 3, 10, (p) => countNear(s, p, 5, (i) => m.terrain[i] === T.WATER && m.res[i] === RES.FISH));
    run(s, 4000);
    expect(s.players[0].stats.produced[G.FISH]).toBeGreaterThan(0);
  });

  it('mysliwy poluje', () => {
    const s = newGame(1, 64, 'HUNT');
    // Zwierzeta w poblizu zamku (deterministycznie).
    const castle = s.buildings[s.players[0].castle]!;
    let placed = 0;
    for (const i of spiral(s.map.w, s.map.h, castle.pos % s.map.w, (castle.pos / s.map.w) | 0, 8)) {
      if (placed >= 4) break;
      if (s.map.obj[i] === O.NONE && s.map.terrain[i] === T.GRASS && s.map.roads[i] === 0 && (i % 7) === 0) {
        s.animals.push({ id: s.animals.length, pos: i, to: -1, t: 0, dur: 0, timer: 1000, hunter: -1 });
        placed++;
      }
    }
    buildConnected(s, 0, B.HUNTER, 3, 8);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.MEAT]).toBeGreaterThan(0);
  });
});

describe('M4: gospodarka S2 - woda, piwo, osly, wegiel drzewny', () => {
  it('studnia daje wode, browar piwo, a piwo jest potrzebne do rekrutacji', () => {
    const s = newGame(1, 96, 'BEER');
    castleInv(s).goods[G.BEER] = 0;
    castleInv(s).goods[G.WHEAT] = 8;
    buildConnected(s, 0, B.WELL, 3, 9);
    buildConnected(s, 0, B.BREWERY, 3, 9);
    const knights0 = castleInv(s).knights.reduce((a, b) => a + b, 0);
    run(s, 300);
    // Bez piwa miecze i tarcze nie zamieniaja sie w rycerzy.
    expect(castleInv(s).knights.reduce((a, b) => a + b, 0)).toBe(knights0);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.WATER]).toBeGreaterThan(0);
    expect(s.players[0].stats.produced[G.BEER]).toBeGreaterThan(0);
    expect(castleInv(s).knights.reduce((a, b) => a + b, 0)).toBeGreaterThan(knights0);
  });

  it('hodowla oslow daje osly do magazynu', () => {
    const s = newGame(1, 96, 'DONKEY');
    castleInv(s).goods[G.WHEAT] = 8;
    castleInv(s).goods[G.WATER] = 8;
    const d0 = castleInv(s).serfs[S.DONKEY];
    buildConnected(s, 0, B.DONKEYBREEDER, 4, 10);
    run(s, 5000);
    expect(castleInv(s).serfs[S.DONKEY]).toBeGreaterThan(d0);
  });

  it('smolarnia robi wegiel z pni i zboza', () => {
    const s = newGame(1, 96, 'CHAR');
    castleInv(s).goods[G.WHEAT] = 8;
    buildConnected(s, 0, B.CHARBURNER, 4, 10);
    run(s, 4000);
    expect(s.players[0].stats.produced[G.COAL]).toBeGreaterThan(0);
  });
});

describe('M4: inne', () => {
  it('magazyn dostaje materialy, powstaje i przyjmuje towary', () => {
    const s = newGame(1, 96, 'STORE');
    const { pos, ok } = buildConnected(s, 0, B.WAREHOUSE, 5, 10);
    expect(ok).toBe(true);
    run(s, 3000);
    const b = s.buildings[s.map.objId[pos]]!;
    expect(b.stage).toBe(STAGE.DONE);
    expect(b.inv).not.toBeNull();
  });

  it('stocznia buduje lodzie', () => {
    const s = newGame(1, 64, 'BOAT');
    buildConnected(s, 0, B.SHIPYARD, 3, 8);
    run(s, 3000);
    expect(s.players[0].stats.produced[G.BOAT]).toBeGreaterThan(0);
  });

  it('geolog stawia znaki; w gorach ze zlozem', () => {
    const s = newGame(1, 64, 'GEO');
    const castle = s.buildings[s.players[0].castle]!;
    const cf = s.flags[castle.flag]!;
    makeMountain(s, cf.pos, 5, RES.GOLD);
    step(s, [{ type: 'geologist', player: 0, pos: cf.pos }]);
    expect(s.serfs.some((x) => x && x.type === S.GEOLOGIST)).toBe(true);
    run(s, 1500);
    let signs = 0;
    let gold = 0;
    for (let i = 0; i < s.map.obj.length; i++) {
      if (s.map.obj[i] === O.SIGN) {
        signs++;
        if (Math.floor(s.map.objId[i] / 100) === RES.GOLD) gold++;
      }
    }
    expect(signs).toBeGreaterThanOrEqual(6);
    expect(gold).toBeGreaterThan(0);
    expect(signCode(RES.GOLD, 12)).toBe(312);
    run(s, 1000);
    expect(s.serfs.some((x) => x && x.type === S.GEOLOGIST)).toBe(false);
  });

  it('budynki gospodarcze staja i dostaja pracownikow z narzedziami', () => {
    const s = newGame(1, 96, 'ALL');
    for (const k of [B.SAWMILL, B.MILL, B.BAKERY, B.BUTCHER, B.STEELWORKS, B.TOOLMAKER]) buildConnected(s, 0, k, 3, 10);
    run(s, 6000);
    const done = s.buildings.filter((b) => b && b.kind !== B.CASTLE && b.stage === STAGE.DONE && b.workerInside);
    expect(done.length).toBeGreaterThanOrEqual(5);
  });
});
