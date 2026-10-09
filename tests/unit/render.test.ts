import { describe, expect, it } from 'vitest';
import { DIR_E, DIR_SE, DIR_SW, stepXY } from '../../sim/grid.ts';
import { generateMap } from '../../sim/mapgen.ts';
import { H_SCALE, groundHeight, vx, vz } from '../../client/render/coords.ts';
import { yardWeight } from '../../client/render/yard.ts';

describe('wysokosc terenu w rendererze', () => {
  it('groundHeight lezy na trojkatach siatki terenu (jak w terrain.ts)', () => {
    const { map } = generateMap('TEREN', 32, 2);
    const tris: [number, number, number][] = [];
    for (let y = 0; y < map.h - 1; y++) {
      for (let x = 1; x < map.w - 1; x++) {
        const i = y * map.w + x;
        const at = (d: number) => { const [a, b] = stepXY(x, y, d); return b * map.w + a; };
        tris.push([i, at(DIR_SE), at(DIR_E)], [i, at(DIR_SW), at(DIR_SE)]);
      }
    }
    const P = (i: number) => [vx(i % map.w, (i / map.w) | 0), vz((i / map.w) | 0), map.height[i] * H_SCALE];
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const wx = 2 + ((k * 7919) % 1000) / 1000 * (map.w - 5);
      const wz = vz(2) + ((k * 104729) % 997) / 997 * vz(map.h - 5);
      for (const [a, b, c] of tris) {
        const [ax, az, ah] = P(a), [bx, bz, bh] = P(b), [cx, cz, ch] = P(c);
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        const l1 = ((bz - cz) * (wx - cx) + (cx - bx) * (wz - cz)) / det;
        const l2 = ((cz - az) * (wx - cx) + (ax - cx) * (wz - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        expect(groundHeight(map, wx, wz)).toBeCloseTo(l1 * ah + l2 * bh + l3 * ch, 6);
        checked++;
        break;
      }
    }
    expect(checked).toBe(400);
  });

  it('waga podworka: 0 przy scianie, 1 z dala od niej', () => {
    const rects = [[-0.2, -0.2, 0.2, 0.2]] as const;
    expect(yardWeight(rects, 0, 0)).toBe(0);
    expect(yardWeight(rects, 0, -0.22)).toBe(0);
    expect(yardWeight(rects, 0, -0.4)).toBe(1);
    const mid = yardWeight(rects, 0.275, 0);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });
});
