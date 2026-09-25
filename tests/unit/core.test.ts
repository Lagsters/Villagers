import { describe, expect, it } from 'vitest';
import { FP_ONE, fpCos, fpSin, isqrt, ANGLE_STEPS } from '../../sim/fixed.ts';
import { hexDist, neighborTable, opposite, spiral, stepXY } from '../../sim/grid.ts';
import { hashAny, serialize, deserialize } from '../../sim/hash.ts';
import { generateMap } from '../../sim/mapgen.ts';
import { T } from '../../sim/defs.ts';
import { nextU32, seedRng } from '../../sim/rng.ts';

describe('fixed-point', () => {
  it('sin/cos z tablicy sa bliskie wartosciom dokladnym', () => {
    for (let a = 0; a < ANGLE_STEPS; a += 7) {
      const exact = Math.sin((a / ANGLE_STEPS) * 2 * Math.PI) * FP_ONE;
      expect(Math.abs(fpSin(a) - exact)).toBeLessThanOrEqual(2);
    }
    expect(fpCos(0)).toBe(FP_ONE);
    expect(fpSin(ANGLE_STEPS / 4)).toBe(FP_ONE);
  });
  it('isqrt', () => {
    for (let n = 0; n < 5000; n += 13) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)));
  });
});

describe('siatka heksagonalna', () => {
  it('krok w kierunku i przeciwnym wraca na miejsce', () => {
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) for (let d = 0; d < 6; d++) {
      const [nx, ny] = stepXY(x, y, d);
      expect(stepXY(nx, ny, opposite(d))).toEqual([x, y]);
      expect(hexDist(x, y, nx, ny)).toBe(1);
    }
  });
  it('tablica sasiadow ma -1 poza mapa', () => {
    const nb = neighborTable(8, 8);
    expect(nb[0 * 6 + 3]).toBe(-1);
    expect(nb[0 * 6 + 0]).toBe(1);
  });
  it('spirala ma 1 + 3r(r+1) pol i rosnace odleglosci', () => {
    const s = spiral(40, 40, 20, 20, 4);
    expect(s.length).toBe(1 + 3 * 4 * 5);
    expect(new Set(s).size).toBe(s.length);
    let last = 0;
    for (const i of s) {
      const d = hexDist(20, 20, i % 40, (i / 40) | 0);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe('PRNG', () => {
  it('ten sam seed = ten sam ciag', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });
});

describe('generator mapy', () => {
  it('ten sam kod daje identyczna mape', () => {
    const a = generateMap('TEST1', 96, 4);
    const b = generateMap('TEST1', 96, 4);
    expect(hashAny(a.map)).toBe(hashAny(b.map));
    expect(a.starts).toEqual(b.starts);
    const c = generateMap('TEST2', 96, 4);
    expect(hashAny(c.map)).not.toBe(hashAny(a.map));
  });
  it('ma sensowne proporcje terenu i rozstawione starty', () => {
    for (const code of ['A', 'DOLINA', 'XYZ123', 'Q9']) {
      const { map, starts } = generateMap(code, 128, 8);
      const cnt = [0, 0, 0, 0, 0];
      for (let i = 0; i < map.terrain.length; i++) cnt[map.terrain[i]]++;
      const n = map.terrain.length;
      expect(cnt[T.GRASS] / n).toBeGreaterThan(0.4);
      expect(cnt[T.WATER] / n).toBeGreaterThan(0.1);
      expect(cnt[T.MOUNTAIN]).toBeGreaterThan(0);
      expect(starts.length).toBe(8);
      for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) {
        const d = hexDist(starts[i] % 128, (starts[i] / 128) | 0, starts[j] % 128, (starts[j] / 128) | 0);
        expect(d).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe('serializacja', () => {
  it('zapis i odczyt zachowuja hash', () => {
    const { map } = generateMap('SER', 64, 2);
    const s = serialize({ map, list: [1, null, { a: 2 }] });
    const back = deserialize<{ map: typeof map }>(s);
    expect(hashAny(back)).toBe(hashAny({ map, list: [1, null, { a: 2 }] }));
    expect(back.map.height).toBeInstanceOf(Uint8Array);
  });
});
