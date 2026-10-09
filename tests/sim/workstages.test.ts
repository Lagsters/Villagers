import { describe, expect, it } from 'vitest';
import { B, G, O, S, T, isStone } from '../../sim/defs.ts';
import { spiral } from '../../sim/grid.ts';
import { DRESS_TICKS, HANG_TICKS, PREP_TICKS, WS } from '../../sim/production.ts';
import { SS } from '../../sim/serfs.ts';
import { step } from '../../sim/step.ts';
import type { GameState, Serf } from '../../sim/types.ts';
import { buildConnected, countNear, newGame } from './helpers.ts';

/** Kolejne podstany pracownika w terenie i liczba tickow w kazdym (do `ticks` tickow albo pierwszego powrotu). */
function trace(s: GameState, type: number, ticks: number, until: (sf: Serf) => boolean = () => false): { sub: number; n: number; pos: number }[] {
  const out: { sub: number; n: number; pos: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    step(s, []);
    const sf = s.serfs.find((x) => x && x.type === type && x.owner === 0);
    if (!sf || sf.state !== SS.WORK_OUT) continue;
    const last = out[out.length - 1];
    if (last && last.sub === sf.sub) last.n++;
    else out.push({ sub: sf.sub, n: 1, pos: sf.pos });
    if (until(sf)) break;
  }
  return out;
}

describe('etapy pracy przy chacie (sceny zawodow)', () => {
  it('lesnik bierze sadzonke przy chacie (PREP), potem sadzi', () => {
    const s = newGame(1, 64, 'FOREST');
    expect(buildConnected(s, 0, B.FORESTER, 3, 7).ok).toBe(true);
    const tr = trace(s, S.FORESTER, 3000, (sf) => sf.sub === WS.RETURN);
    const subs = tr.map((x) => x.sub);
    expect(subs.slice(0, 3)).toEqual([WS.PREP, WS.TO_TARGET, WS.WORKING]);
    // Podstan PREP trwa tez w czasie kroku z drzwi na flage, a timer odlicza dopiero na fladze.
    const prep = tr.find((x) => x.sub === WS.PREP)!;
    expect(prep.n).toBeGreaterThanOrEqual(PREP_TICKS);
    const work = tr.find((x) => x.sub === WS.WORKING)!;
    expect(work.n).toBe(60 - PREP_TICKS);
  });

  it('kamieniarz ociosuje blok przy chacie (DRESS), zanim polozy go na fladze', () => {
    const s = newGame(1, 64, 'ROCK');
    const { ok } = buildConnected(s, 0, B.STONECUTTER, 3, 10, (pos) => countNear(s, pos, 6, (i) => isStone(s.map.obj[i])));
    expect(ok).toBe(true);
    const tr = trace(s, S.STONECUTTER, 4000, (sf) => sf.sub === WS.ENTER);
    const subs = tr.map((x) => x.sub);
    const i = subs.indexOf(WS.DRESS);
    expect(i).toBeGreaterThan(0);
    expect(subs[i - 1]).toBe(WS.RETURN);
    expect(tr[i].n).toBe(DRESS_TICKS);
    expect(tr.find((x) => x.sub === WS.WORKING)!.n).toBe(80 - DRESS_TICKS);
    expect(s.players[0].stats.produced[G.STONE]).toBe(1);
  });

  it('mysliwy strzela z odleglosci, idzie po zdobycz (FETCH) i wiesza ja przy chacie (HANG)', () => {
    const s = newGame(1, 64, 'HUNT');
    const castle = s.buildings[s.players[0].castle]!;
    let placed = 0;
    for (const i of spiral(s.map.w, s.map.h, castle.pos % s.map.w, (castle.pos / s.map.w) | 0, 8)) {
      if (placed >= 4) break;
      if (s.map.obj[i] === O.NONE && s.map.terrain[i] === T.GRASS && s.map.roads[i] === 0 && (i % 7) === 0) {
        s.animals.push({ id: s.animals.length, pos: i, to: -1, t: 0, dur: 0, timer: 1000, hunter: -1, dead: false });
        placed++;
      }
    }
    expect(buildConnected(s, 0, B.HUNTER, 3, 8).ok).toBe(true);
    let shotAt = -1, deadSeen = false;
    const tr: { sub: number; n: number; pos: number }[] = [];
    for (let t = 0; t < 4000 && !(tr.length && tr[tr.length - 1].sub === WS.ENTER); t++) {
      step(s, []);
      const h = s.serfs.find((x) => x && x.type === S.HUNTER)!;
      if (!h || h.state !== SS.WORK_OUT) continue;
      const last = tr[tr.length - 1];
      if (last && last.sub === h.sub) last.n++;
      else tr.push({ sub: h.sub, n: 1, pos: h.pos });
      if (h.sub === WS.FETCH && shotAt < 0) {
        const a = s.animals[h.target]!;
        expect(a.dead).toBe(true);
        expect(a.pos).not.toBe(h.pos); // strzal z odleglosci
        shotAt = a.pos;
        deadSeen = true;
      }
    }
    expect(deadSeen).toBe(true);
    const subs = tr.map((x) => x.sub);
    expect(subs).toEqual(expect.arrayContaining([WS.WORKING, WS.FETCH, WS.RETURN, WS.HANG]));
    expect(subs.indexOf(WS.HANG)).toBe(subs.indexOf(WS.RETURN) + 1);
    expect(tr.find((x) => x.sub === WS.HANG)!.n).toBe(HANG_TICKS);
    expect(s.players[0].stats.produced[G.MEAT]).toBe(1);
    expect(s.animals.some((a) => a && a.pos === shotAt && a.dead)).toBe(false);
  });

  it('upolowane zwierze bez mysliwego znika', () => {
    const s = newGame(1, 64, 'HUNT');
    const pos = s.buildings[s.players[0].castle]!.pos + 5;
    s.animals.push({ id: s.animals.length, pos, to: -1, t: 0, dur: 0, timer: 1000, hunter: -1, dead: true });
    const id = s.animals.length - 1;
    step(s, []);
    expect(s.animals[id]).toBeNull();
  });
});
