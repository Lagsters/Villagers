/**
 * Siatka heksagonalna w ukladzie offset: wiersze nieparzyste przesuniete o pol pola w prawo.
 * Pole identyfikuje indeks idx = y * W + x.
 */
export const DIR_E = 0;
export const DIR_SE = 1;
export const DIR_SW = 2;
export const DIR_W = 3;
export const DIR_NW = 4;
export const DIR_NE = 5;
export const DIRS = 6;

export function opposite(dir: number): number {
  return (dir + 3) % 6;
}

// [dx, dy] dla wiersza parzystego i nieparzystego.
const EVEN: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const ODD: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

export function stepXY(x: number, y: number, dir: number): [number, number] {
  const d = (y & 1) === 0 ? EVEN[dir] : ODD[dir];
  return [x + d[0], y + d[1]];
}

const neighborCache = new Map<number, Int32Array>();

/** Tablica sasiadow: nb[idx*6+dir] = indeks sasiada albo -1 poza mapa. Dane pochodne, nie czesc stanu. */
export function neighborTable(w: number, h: number): Int32Array {
  const key = w * 100000 + h;
  let t = neighborCache.get(key);
  if (t) return t;
  t = new Int32Array(w * h * 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let d = 0; d < 6; d++) {
        const [nx, ny] = stepXY(x, y, d);
        t[(y * w + x) * 6 + d] = nx >= 0 && ny >= 0 && nx < w && ny < h ? ny * w + nx : -1;
      }
    }
  }
  neighborCache.set(key, t);
  return t;
}

/** Odleglosc heksagonalna (liczba krokow). */
export function hexDist(x1: number, y1: number, x2: number, y2: number): number {
  const q1 = x1 - ((y1 - (y1 & 1)) >> 1);
  const q2 = x2 - ((y2 - (y2 & 1)) >> 1);
  const dq = q1 - q2;
  const dr = y1 - y2;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

export function idxDist(w: number, a: number, b: number): number {
  return hexDist(a % w, (a / w) | 0, b % w, (b / w) | 0);
}

/**
 * Pola w promieniu r od (cx,cy), w stalej kolejnosci: pierscieniami od srodka,
 * w pierscieniu wg kierunkow. Zwraca indeksy lezace na mapie.
 */
const spiralCache = new Map<number, Int32Array>();

/** Przesuniecia spirali jako pary (dq, dr) w ukladzie osiowym, pierscien po pierscieniu. */
function spiralOffsets(r: number): Int32Array {
  let s = spiralCache.get(r);
  if (s) return s;
  const out: number[] = [0, 0];
  // Kierunki osiowe odpowiadajace E, SE, SW, W, NW, NE.
  const AX = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  for (let k = 1; k <= r; k++) {
    // Start: k krokow na NE... uzywamy standardowego obchodu: zaczynamy od (k * W) i idziemy.
    let q = -k;
    let rr = 0; // punkt k krokow na W
    // Obchodzimy pierscien: kierunki NE, E, SE, SW, W, NW po k krokow.
    const order = [5, 0, 1, 2, 3, 4];
    for (const d of order) {
      for (let i = 0; i < k; i++) {
        out.push(q, rr);
        q += AX[d][0];
        rr += AX[d][1];
      }
    }
  }
  s = Int32Array.from(out);
  spiralCache.set(r, s);
  return s;
}

export function spiral(w: number, h: number, cx: number, cy: number, r: number, out: number[] = []): number[] {
  out.length = 0;
  const offs = spiralOffsets(r);
  const cq = cx - ((cy - (cy & 1)) >> 1);
  for (let i = 0; i < offs.length; i += 2) {
    const q = cq + offs[i];
    const y = cy + offs[i + 1];
    if (y < 0 || y >= h) continue;
    const x = q + ((y - (y & 1)) >> 1);
    if (x < 0 || x >= w) continue;
    out.push(y * w + x);
  }
  return out;
}
