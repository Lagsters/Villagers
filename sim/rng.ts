/**
 * Deterministyczny PRNG (xorshift32). Stan to jedna liczba uint32 != 0,
 * trzymana w stanie gry, dzieki czemu serializuje sie razem z nim.
 */
export interface RngHolder {
  rng: number;
}

export function nextU32(s: RngHolder): number {
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng;
}

/** Liczba calkowita z przedzialu [0, n). */
export function randInt(s: RngHolder, n: number): number {
  return nextU32(s) % n;
}

/** true z prawdopodobienstwem pct/100. */
export function chance(s: RngHolder, pct: number): boolean {
  return nextU32(s) % 100 < pct;
}

/** Ziarno z dowolnej liczby (gwarantuje stan != 0). */
export function seedRng(seed: number): RngHolder {
  const s = { rng: (seed ^ 0x9e3779b9) >>> 0 || 0x12345678 };
  // Rozgrzewka, zeby bliskie ziarna daly rozne ciagi.
  for (let i = 0; i < 8; i++) nextU32(s);
  return s;
}

/** Hash 32-bit dla wspolrzednych (bez stanu), uzywany w generatorze mapy. */
export function hash3(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a z tekstu (kod mapy -> ziarno). */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
