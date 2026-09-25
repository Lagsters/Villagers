/**
 * Arytmetyka stalopozycyjna 16.16 i funkcje trygonometryczne na tablicach.
 * Wszystko liczone na liczbach calkowitych mniejszych niz 2^53, wiec wynik
 * jest identyczny w kazdej przegladarce.
 */
export const FP_SHIFT = 16;
export const FP_ONE = 1 << FP_SHIFT;

export function fpMul(a: number, b: number): number {
  return Math.floor((a * b) / FP_ONE);
}

export function fpDiv(a: number, b: number): number {
  return Math.floor((a * FP_ONE) / b);
}

/** Liczba katow w pelnym obrocie. */
export const ANGLE_STEPS = 1024;

/**
 * Tablica sinusa (16.16) liczona szeregiem Taylora na liczbach calkowitych
 * dla cwiartki, reszta z symetrii. Nie uzywa Math.sin.
 */
function buildSinTable(): Int32Array {
  const t = new Int32Array(ANGLE_STEPS);
  const quarter = ANGLE_STEPS / 4;
  const S = 1n << 60n; // skala obliczen
  const PI = 3622009729038561421n; // round(pi * 2^60)
  for (let i = 0; i <= quarter; i++) {
    const x = (PI * 2n * BigInt(i)) / BigInt(ANGLE_STEPS);
    const x2 = (x * x) / S;
    let term = x;
    let sum = x;
    for (let k = 1n; k <= 8n; k++) {
      term = (term * x2) / S / ((2n * k) * (2n * k + 1n));
      sum += k % 2n === 1n ? -term : term;
    }
    // 2^60 -> 2^16 z zaokragleniem
    t[i] = Number((sum + (1n << 43n)) >> 44n);
  }
  for (let i = quarter + 1; i < ANGLE_STEPS / 2; i++) t[i] = t[ANGLE_STEPS / 2 - i];
  for (let i = ANGLE_STEPS / 2; i < ANGLE_STEPS; i++) t[i] = -t[i - ANGLE_STEPS / 2];
  return t;
}

export const SIN_TABLE = buildSinTable();

export function fpSin(angle: number): number {
  return SIN_TABLE[((angle % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS];
}

export function fpCos(angle: number): number {
  return fpSin(angle + ANGLE_STEPS / 4);
}

/** Pierwiastek calkowity (floor). */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
