/**
 * Drogi jako wstegi lezace na terenie (kazdy wierzcholek na wysokosci siatki terenu), z generowana
 * w kodzie faktura ubitej ziemi: ziarno, dwie wydeptane koleiny, kamyki i poszarpany brzeg miekko
 * przechodzacy w trawe. Jedna siatka dla calej mapy, przebudowywana po zmianie sieci (rzadkie
 * zdarzenie). Drogi wodne maja niebieskawy odcien.
 */
import * as THREE from 'three';
import type { GameState } from '../../sim/types.ts';
import { groundHeight, ROW_H, vx, vz } from './coords.ts';

/** Polowa szerokosci wstegi (z miekkim brzegiem). */
const WIDTH = 0.13;
/** Minimalne uniesienie nad terenem (reszte zalatwia polygonOffset materialu). */
const LIFT = 0.006;
/** Kawalki na odcinek miedzy polami (lamanie wstegi razem z terenem zalatwia przycinanie do trojkatow terenu). */
const PIECES = 1;
/** Dlugosc drogi (w jednostkach swiata) na jedno powtorzenie faktury. */
const TEX_LEN = 0.8;

function hash(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Faktura drogi: u - w poprzek (0..1), v - wzdluz (powtarzana). */
function roadTexture(): THREE.Texture {
  const W = 64, H = 256;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    // Poszarpany brzeg: szerokosc pasa trawy zmienia sie wzdluz drogi.
    const edgeL = 0.1 + hash(y >> 3, 21) * 0.1;
    const edgeR = 0.1 + hash(y >> 3, 22) * 0.1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) / W;
      const n = hash(i, 9);
      // Ubita ziemia z ziarnem; koleiny ciemniejsze, srodek nieco jasniejszy.
      let r = 172 + n * 30, g = 134 + n * 24, b = 88 + n * 18;
      const rut = Math.min(Math.abs(u - 0.33), Math.abs(u - 0.67));
      const dark = rut < 0.07 ? 0.82 + rut * 2 : 1;
      r *= dark; g *= dark; b *= dark;
      // Kamyki.
      if (hash(i, 31) > 0.985) { r = 196; g = 190; b = 178; }
      else if (hash(i, 32) > 0.99) { r = 120; g = 100; b = 78; }
      // Brzeg: przezroczystosc rosnie ku krawedziom, z poszarpaniem.
      const d = Math.min(u - edgeL * 0.3, 1 - u - edgeR * 0.3);
      const a = Math.max(0, Math.min(1, d / Math.max(0.02, (u < 0.5 ? edgeL : edgeR)) + (hash(i, 41) - 0.5) * 0.5));
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Wierzcholek wstegi: polozenie na plaszczyznie (x, z) i wspolrzedne faktury. */
type RV = [number, number, number, number];

/**
 * Rodziny prostych, po ktorych biegna krawedzie trojkatow terenu: wiersze siatki (z / ROW_H)
 * i dwie przekatne przez sasiadow (x -+ wiersz/2) - na kazdej prostej z rodziny wartosc jest calkowita.
 */
const EDGE_FAMILIES: ((x: number, z: number) => number)[] = [
  (_x, z) => z / ROW_H,
  (x, z) => x - z / ROW_H / 2,
  (x, z) => x + z / ROW_H / 2,
];

/** Dzieli wielokat wypukly prostymi rodziny f o wartosciach calkowitych; zwraca kawalki. */
function splitBy(poly: RV[], f: (x: number, z: number) => number): RV[][] {
  const vals = poly.map((p) => f(p[0], p[1]));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const out: RV[][] = [];
  let rest = poly;
  for (let k = Math.floor(lo) + 1; k < hi; k++) {
    const below: RV[] = [], above: RV[] = [];
    // Wierzcholek na prostej (czesto: wezel siatki na srodku drogi) nalezy do obu czesci.
    const side = (p: RV) => {
      const d = f(p[0], p[1]) - k;
      return Math.abs(d) < 1e-9 ? 0 : d;
    };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i], b = rest[(i + 1) % rest.length];
      const fa = side(a), fb = side(b);
      if (fa <= 0) below.push(a);
      if (fa >= 0) above.push(a);
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
        const t = fa / (fa - fb);
        const c: RV = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
        below.push(c);
        above.push(c);
      }
    }
    if (below.length >= 3) out.push(below);
    rest = above;
    if (rest.length < 3) return out;
  }
  out.push(rest);
  return out;
}

export class RoadsRenderer {
  readonly mesh: THREE.Mesh;
  private sig = '';

  constructor() {
    const mat = new THREE.MeshLambertMaterial({
      // Brzeg wycinany progiem przezroczystosci (bez mieszania) - tanszy, nieprzezroczysty przebieg.
      vertexColors: true, map: roadTexture(), alphaTest: 0.45,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Przebudowa, jesli zmienil sie zestaw drog. */
  sync(s: GameState): void {
    let sig = '';
    for (const r of s.roads) if (r) sig += r.id + ':' + r.a + ':' + r.b + ',';
    if (sig === this.sig) return;
    this.sig = sig;
    this.rebuild(s);
  }

  /** Wymus przebudowe (np. po zmianie wysokosci terenu). */
  invalidate(): void {
    this.sig = '';
  }

  private rebuild(s: GameState): void {
    const map = s.map;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const xz = (i: number) => {
      const x = i % map.w, y = (i / map.w) | 0;
      return [vx(x, y), vz(y)] as const;
    };
    const ground = (x: number, z: number) => groundHeight(map, x, z) + LIFT;
    for (const r of s.roads) {
      if (!r || r.cells.length < 2) continue;
      const c = r.water ? [0.7, 0.85, 1.0] : [1, 1, 1];
      // Punkty srodka drogi: pola trasy, kazdy odcinek podzielony na PIECES kawalkow.
      const pts: [number, number][] = [];
      const seg: number[] = []; // indeks odcinka, do ktorego nalezy punkt (kierunek styczny)
      for (let i = 0; i + 1 < r.cells.length; i++) {
        const [ax, az] = xz(r.cells[i]);
        const [bx, bz] = xz(r.cells[i + 1]);
        for (let k = 0; k < PIECES; k++) {
          const t = k / PIECES;
          pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
          seg.push(i);
        }
      }
      pts.push(xz(r.cells[r.cells.length - 1]) as [number, number]);
      seg.push(r.cells.length - 2);
      const dirOf = (i: number): [number, number] => {
        const [ax, az] = xz(r.cells[i]);
        const [bx, bz] = xz(r.cells[i + 1]);
        const l = Math.hypot(bx - ax, bz - az) || 1;
        return [(bx - ax) / l, (bz - az) / l];
      };
      // Jedna ciagla wstega: w wezlach trasy (zakretach) normalna jest srednia z obu odcinkow,
      // wydluzona tak, by szerokosc drogi sie nie zmieniala (polaczenie bez szpar i zakladek).
      let prev: number[] | null = null;
      let dist = 0;
      for (let j = 0; j < pts.length; j++) {
        const [px, pz] = pts[j];
        if (j > 0) dist += Math.hypot(px - pts[j - 1][0], pz - pts[j - 1][1]);
        const atNode = j % PIECES === 0;
        const i = seg[j];
        let [tx, tz] = dirOf(i);
        let scale = 1;
        if (atNode && j > 0 && j < pts.length - 1) {
          const [ux, uz] = dirOf(i - 1);
          const mx = ux + tx, mz = uz + tz;
          const ml = Math.hypot(mx, mz);
          if (ml > 1e-6) {
            tx = mx / ml; tz = mz / ml;
            const cos = tx * ux + tz * uz;
            scale = Math.min(2, 1 / Math.max(0.5, cos));
          }
        }
        const nx = -tz * WIDTH * scale, nz = tx * WIDTH * scale;
        // Konce drogi lekko wysuniete pod flage.
        let ex = 0, ez = 0;
        if (j === 0) { ex = -tx * WIDTH * 0.4; ez = -tz * WIDTH * 0.4; }
        if (j === pts.length - 1) { ex = tx * WIDTH * 0.4; ez = tz * WIDTH * 0.4; }
        const cx = px + ex, cz = pz + ez;
        const v = dist / TEX_LEN;
        const cur = [cx + nx, 0, cz + nz, cx - nx, 0, cz - nz, v];
        if (prev) {
          const q: RV[] = [[prev[0], prev[2], 0, prev[6]], [prev[3], prev[5], 1, prev[6]],
            [cur[0], cur[2], 0, cur[6]], [cur[3], cur[5], 1, cur[6]]];
          // Kazdy trojkat wstegi przyciety do trojkatow terenu: kawalek lezy w plaszczyznie terenu,
          // wiec teren nie przebija drogi na grzbietach i w dolinach miedzy wierzcholkami.
          for (const tri of [[q[0], q[2], q[1]], [q[1], q[2], q[3]]]) {
            let pieces = [tri];
            for (const f of EDGE_FAMILIES) pieces = pieces.flatMap((pc) => splitBy(pc, f));
            for (const pc of pieces) {
              for (let k = 1; k + 1 < pc.length; k++) {
                for (const v of [pc[0], pc[k], pc[k + 1]]) {
                  pos.push(v[0], ground(v[0], v[1]), v[1]);
                  uv.push(v[2], v[3]);
                  col.push(c[0], c[1], c[2]);
                }
              }
            }
          }
        }
        prev = cur;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // Normalne zawsze ku gorze (kolejnosc wierzcholkow zalezy od kierunku odcinka).
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}
