import { describe, expect, it } from 'vitest';
import { SIM_VERSION } from '../../sim/version.ts';

describe('szkielet', () => {
  it('ma wersje symulacji', () => {
    expect(SIM_VERSION).toBeGreaterThan(0);
  });
});
