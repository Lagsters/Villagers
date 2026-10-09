import { describe, expect, it } from 'vitest';
import { B, O, T } from '../../sim/defs.ts';
import { DIR_E, DIR_NW, DIR_SE, DIR_W, spiral } from '../../sim/grid.ts';
import { step } from '../../sim/step.ts';
import { STAGE, type GameState } from '../../sim/types.ts';
import { canBuild, canPlaceFlag, neighbor } from '../../sim/world.ts';
import { findRoadPath } from '../../sim/roads.ts';
import { newGame } from './helpers.ts';

/** Plaski, wolny, wlasny teren trawy w promieniu r wokol pola obok zamku gracza 0. */
function flatArea(r = 5): { s: GameState; a: number } {
  const s = newGame(2, 64, 'TEST');
  const m = s.map;
  const castle = s.buildings[s.players[0].castle]!;
  let a = castle.pos;
  for (let k = 0; k < 4; k++) a = neighbor(m, a, DIR_E);
  for (const i of spiral(m.w, m.h, a % m.w, (a / m.w) | 0, r)) {
    if (m.obj[i] === O.BUILDING || m.obj[i] === O.FLAG || m.roads[i] !== 0) continue;
    m.obj[i] = O.NONE;
    m.objId[i] = -1;
    m.terrain[i] = T.GRASS;
    m.height[i] = 10;
    m.owner[i] = 1;
  }
  return { s, a };
}

const at = (s: GameState, p: number, dir: number, n = 1) => {
  for (let k = 0; k < n; k++) p = neighbor(s.map, p, dir);
  return p;
};

describe('zasady stawiania budynkow (jak w pierwowzorze)', () => {
  it('duzy budynek zajmuje jedno pole, drzewo obok nie przeszkadza', () => {
    const { s, a } = flatArea();
    s.map.obj[at(s, a, DIR_W)] = O.TREE;
    expect(canBuild(s, 0, a, B.FARM)).toBe(true);
    step(s, [{ type: 'build', player: 0, pos: a, kind: B.FARM }]);
    expect(s.map.obj[a]).toBe(O.BUILDING);
    expect(s.map.obj[at(s, a, DIR_NW)]).toBe(O.NONE);
    expect(s.map.obj[at(s, a, DIR_SE)]).toBe(O.FLAG);
  });

  it('dom i duzy budynek: bez budynku na sasiednich polach i bez duzego w drugim pierscieniu', () => {
    const { s, a } = flatArea();
    step(s, [{ type: 'build', player: 0, pos: a, kind: B.FARM }]);
    // Drugi pierscien: drugi duzy/dom zabroniony, chata dozwolona.
    const two = at(s, a, DIR_E, 2);
    expect(canBuild(s, 0, two, B.SAWMILL)).toBe(false);
    expect(canBuild(s, 0, two, B.WOODCUTTER)).toBe(true);
    const three = at(s, a, DIR_E, 3);
    expect(canBuild(s, 0, three, B.SAWMILL)).toBe(true);
  });

  it('chata nie wymaga wolnych sasiadow; na stoku (sasiad wyzej albo nizej o wiecej niz 1) tylko na miejscu domu', () => {
    const { s, a } = flatArea();
    s.map.obj[at(s, a, DIR_W)] = O.TREE;
    s.map.height[at(s, a, DIR_E)] = 11;
    s.map.height[at(s, a, DIR_W)] = 9;
    expect(canBuild(s, 0, a, B.WOODCUTTER)).toBe(true);
    s.map.height[at(s, a, DIR_E)] = 12;
    expect(canBuild(s, 0, a, B.WOODCUTTER)).toBe(true); // stok, ale miejsce domu - teren zostanie wyrownany
    s.map.height[at(s, a, DIR_E)] = 20;
    expect(canBuild(s, 0, a, B.SAWMILL)).toBe(true); // roznica 10 tylko na sasiedzie, drugi pierscien plaski
    expect(canBuild(s, 0, a, B.WOODCUTTER)).toBe(true);
    s.map.height[at(s, a, DIR_E, 2)] = 20;
    expect(canBuild(s, 0, a, B.SAWMILL)).toBe(false); // drugi pierscien: roznica >= 9
    expect(canBuild(s, 0, a, B.WOODCUTTER)).toBe(false); // ani dom, ani lagodny stok
  });

  it('chata stoi wszedzie tam, gdzie dom; na stoku czeka na wyrownanie terenu jak dom', () => {
    const { s, a } = flatArea();
    // Budynek na sasiednim polu: miejsce nie nadaje sie na dom, wiec chata tylko na lagodnym stoku.
    step(s, [{ type: 'build', player: 0, pos: at(s, a, DIR_W, 2), kind: B.WOODCUTTER }]);
    const b = at(s, a, DIR_W);
    s.map.height[at(s, b, DIR_E)] = 12;
    expect(canBuild(s, 0, b, B.SAWMILL)).toBe(false);
    expect(canBuild(s, 0, b, B.WOODCUTTER)).toBe(false);
    // Miejsce domu na stoku: chata stawia plac w etapie wyrownywania, na plaskim od razu buduje.
    const c = at(s, a, DIR_E, 3);
    s.map.height[at(s, c, DIR_E)] = 13;
    expect(canBuild(s, 0, c, B.SAWMILL)).toBe(true);
    step(s, [{ type: 'build', player: 0, pos: c, kind: B.WOODCUTTER }]);
    const hut = s.buildings[s.map.objId[c]]!;
    expect(hut.stage).toBe(STAGE.LEVEL);
    expect(hut.levelHeight).toBe(10); // srednia z pola i 6 sasiadow: (6 * 10 + 13) / 7
  });

  it('mlyn jest chata', () => {
    const { s, a } = flatArea();
    step(s, [{ type: 'build', player: 0, pos: a, kind: B.WOODCUTTER }]);
    expect(canBuild(s, 0, at(s, a, DIR_E, 2), B.MILL)).toBe(true);
  });
});

describe('drogi przez drzewa', () => {
  it('droga moze przejsc przez pole z drzewem, drzewo zostaje; flagi na drzewie postawic sie nie da', () => {
    const s = newGame(2, 64, 'TEST');
    const m = s.map;
    const castle = s.buildings[s.players[0].castle]!;
    const a = s.flags[castle.flag]!.pos;
    const t = neighbor(m, neighbor(m, a, DIR_E), DIR_E);
    const end = neighbor(m, neighbor(m, t, DIR_E), DIR_E);
    for (const c of [neighbor(m, a, DIR_E), t, neighbor(m, t, DIR_E), end]) { m.obj[c] = O.NONE; m.terrain[c] = T.GRASS; m.height[c] = m.height[a]; }
    m.obj[t] = O.TREE;
    expect(findRoadPath(s, 0, a, end)).not.toBeNull();
    expect(canPlaceFlag(s, 0, t)).toBe(false);
  });
});
