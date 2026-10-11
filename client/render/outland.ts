/**
 * Swiat wokol mapy: otwarte morze w kolorze wody mapy, a daleko inne kontynenty - osobne lady z plazami, lakami,
 * lasami i wysokimi gorami ze sniegiem; lad przycmiewa mgielka odleglosci (kamera jest ortograficzna, wiec dalekie
 * gory nie maleja - o odleglosci mowi tylko mgielka i krzywizna). Kontynenty leza tak daleko, jak pozwala
 * krzywizna swiata (client/render/curve.ts): dalej nawet wysokie szczyty chowalyby sie za horyzontem. Wyglad jak teren
 * mapy w prostszej wersji: wagi rodzajow (trawa, piasek, skala, snieg) i woda w wierzcholkach, w pikselu faktury
 * z tej samej tekstury co teren mapy i granice falujace szumem - bez obiektow, stanu pol i cieni, wiec tania
 * w rysowaniu. Siatka jest gesta przy mapie i coraz rzadsza ku horyzontowi; pod mapa tylko pas przy krawedzi. Woda
 * lezy tuz pod lustrem wody mapy i faluje razem z nia; lad mapy dochodzacy do krawedzi schodzi za nia plaza do morza.
 */
import * as THREE from 'three';
import { T } from '../../sim/defs.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { SEA_HEIGHT } from '../../sim/mapgen.ts';
import { H_SCALE, ROW_H, shownHeight, shownIdx, vx } from './coords.ts';
import { CURVE_COMMON, CURVE_PROJECT, curveUniform } from './curve.ts';
import { HAZE_FAR, HAZE_NEAR } from './ocean.ts';
import { FOREST_FLOOR, GRASS_DARK, GRASS_LIGHT, ROCK_DARK, ROCK_LIGHT, SAND, SHALLOW_WATER, SNOW, WATER } from './palette.ts';

/** Zasieg krainy za brzegiem mapy (swiat) - za horyzontem przy najnizszej kamerze. */
const REACH = 160;
/** Pas przy mapie z siatka co 1 pole; dalej odstep rosnie o GROW na krok, najwyzej do MAX_STEP (gory kontynentow
 * na rzadszej siatce wygladaja kanciasto). */
const NEAR = 6;
const GROW = 1.08;
const MAX_STEP = 2.5;
/** Kontynenty zaczynaja sie najblizej tyle pol od mapy (blizej tylko morze) i gesto zapelniaja dalszy pas. */
const CONT_NEAR = 55;
const CONT_FULL = 100;
/**
 * Najwyzszy szczyt kontynentu (jednostki mapy). Kamera ortograficzna nie zmniejsza dalekich gor - o tym, jak daleko
 * wygladaja, decyduje czesc wystajaca ponad horyzont: przy stalej wysokosci im dalej, tym mniej, az do zera. Gory
 * podnoszone z odlegloscia "za krzywizne" wyrastaly w oddali jak sciany (dalszy teren wypada na ekranie wyzej).
 */
const PEAK = 30;
/** Kolor mgielki na horyzoncie (liniowo) - ten sam co nad morzem (client/render/ocean.ts). */
const HAZE = new THREE.Color().setRGB(0.42, 0.56, 0.68, THREE.LinearSRGBColorSpace);

/**
 * Kierunek od srodka widoku do kamery w poziomie (x, z). Kamera ortograficzna stoi daleko za srodkiem widoku, wiec
 * przy niskim pochyleniu wisi nad kraina za brzegiem mapy - lad po jej stronie splaszcza sie do poziomu morza,
 * inaczej gory kontynentu zaslanialyby mape.
 */
export const outlandViewUniform = { value: new THREE.Vector2(0, 1) };
/**
 * Lad zamgla sie mocniej niz woda (do 80%) - po tym widac, ze kontynenty sa daleko. Mgielka liczy sie od srodka
 * widoku, ale nie wiecej niz od brzegu mapy: teren mapy jest bez mgielki, wiec przy oddalonej kamerze zamglona woda
 * tuz za brzegiem obrysowywalaby prostokat mapy.
 */
const LAND_HAZE_NEAR = 22;
const LAND_HAZE_FAR = 81;
/** Lad po stronie kamery splaszcza sie od tej odleglosci za srodkiem widoku (swiat) do FLAT_TO. */
const FLAT_FROM = 4;
const FLAT_TO = 20;

function hash(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Gladki szum wartosci 0..1 z komorek co 1 jednostke. */
function noise(x: number, y: number, seed: number): number {
  const gx = Math.floor(x), gy = Math.floor(y);
  const fx = x - gx, fy = y - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash(a * 7919 + b * 104729, seed);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx;
  const bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/** Kilka oktaw szumu 0..1. */
function fbm(x: number, y: number, seed: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += noise(x * f, y * f, seed + o * 31) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Wspolrzedne wezlow siatki wzdluz osi: gesto nad mapa i przy niej, dalej coraz rzadziej. Skrajne wezly nad mapa leza
 * dokladnie na jej krawedziach (lo, hi) - tam kraina przejmuje wysokosc brzegu terenu mapy.
 */
function axis(lo: number, hi: number): number[] {
  const inner: number[] = [];
  const cells = Math.max(1, Math.round(hi - lo));
  for (let v = lo - NEAR; v < lo; v += 1) inner.push(v);
  for (let c = 0; c < cells; c++) inner.push(lo + ((hi - lo) * c) / cells);
  for (let v = hi; v <= hi + NEAR; v += 1) inner.push(v);
  const out: number[] = [];
  let step = 1, v = lo - NEAR;
  while (v > lo - NEAR - REACH) { step = Math.min(MAX_STEP, step * GROW); v -= step; out.unshift(v); }
  out.push(...inner);
  step = 1; v = inner[inner.length - 1];
  while (v < hi + NEAR + REACH) { step = Math.min(MAX_STEP, step * GROW); v += step; out.push(v); }
  return out;
}

/**
 * Wysokosc terenu mapy (jednostki mapy) w punkcie (cx, cz) na brzegu jej prostokata: liniowo miedzy skrajnymi
 * wierzcholkami siatki terenu, tak jak biegnie jej krawedz (client/render/terrain.ts).
 */
function edgeHeight(map: MapData, cx: number, cz: number): number {
  const hAt = (x: number, y: number) => shownHeight(map, y * map.w + x);
  if (cx <= 0 || cx >= map.w - 0.5) {
    const x = cx <= 0 ? 0 : map.w - 1;
    const fy = Math.min(map.h - 1, cz / ROW_H);
    const y0 = Math.min(map.h - 2, Math.floor(fy));
    return hAt(x, y0) + (hAt(x, y0 + 1) - hAt(x, y0)) * (fy - y0);
  }
  const y = cz <= 0 ? 0 : map.h - 1;
  const at = (x: number) => (x === 0 ? 0 : x === map.w - 1 ? map.w - 0.5 : vx(x, y));
  const x0 = Math.min(map.w - 2, Math.max(0, Math.floor(cx - (y & 1) * 0.5)));
  const t = Math.min(1, Math.max(0, (cx - at(x0)) / (at(x0 + 1) - at(x0))));
  return hAt(x0, y) + (hAt(x0 + 1, y) - hAt(x0, y)) * t;
}

/**
 * Plycizna wody przy skrajnym polu mapy (ex, ey), liczona jak na mapie: 0 - przy ladzie, 1 - dwa pola dalej.
 */
function edgeShallow(map: MapData, ex: number, ey: number): number {
  let near = 3;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = ex + dx, y = ey + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h || map.terrain[shownIdx(map, y * map.w + x)] === T.WATER) continue;
      near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
    }
  }
  return Math.max(0, (near - 1) / 2);
}

const glsl = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

/**
 * Piksel krainy: faktury trawy, piasku i skaly z tekstury terenu mapy (kanaly r, b, g; a - szum granic), rodzaj
 * wygrywajacy w punkcie przesunietym szumem jak na mapie; woda na poziomie morza z falami i blyskami
 * jak woda mapy (ten sam wzor i czas, wiec fale ida przez krawedz mapy bez szwu).
 */
const OUTLAND_FRAGMENT = /* glsl */ `
vec2 p = vWorld.xz;
vec4 dt = texture2D(detailMap, p / 3.0);
float edge = (texture2D(detailMap, p / 7.0 + 0.37).a - 0.5) * 1.4 + (texture2D(detailMap, p / 2.1 + 0.71).a - 0.5) * 0.7;
vec3 grass = vColor.rgb * (0.8 + 0.4 * dt.r);
vec3 sand = ${glsl(SAND)} * (0.78 + 0.27 * dt.b);
vec3 rock = mix(${glsl(ROCK_DARK)}, ${glsl(ROCK_LIGHT)}, clamp(0.12 + texture2D(detailMap, p / 3.2).g * 0.8 + edge * 0.12, 0.0, 1.0));
vec3 snow = ${glsl(SNOW)} * (0.92 + 0.08 * dt.r);
vec4 sk = vKind + vec4(edge, -edge * 0.8, edge * 0.7, -edge) * 0.25;
float top = max(max(sk.x, sk.y), max(sk.z, sk.w));
vec4 k = smoothstep(top - 0.1, top, sk);
k /= k.x + k.y + k.z + k.w;
vec3 col = grass * k.x + sand * k.y + rock * k.z + snow * k.w;
vec2 wp = p / 4.0;
float wa = texture2D(detailMap, vec2(wp.x * 0.9 + wp.y * 0.4, wp.y * 0.8 - wp.x * 0.3) + vec2(0.012, 0.007) * uTime).b;
float wb = texture2D(detailMap, vec2(wp.y * 0.7 - wp.x * 0.5, wp.x * 0.8 + wp.y * 0.3) * 1.3 - vec2(0.009, 0.013) * uTime).b;
vec3 sea = vWcol * (1.0 + 0.22 * (wa + wb - 1.1));
sea += vec3(0.5, 0.5, 0.45) * smoothstep(0.66, 0.72, min(wa, wb)) * 0.5;
// Woda tam, gdzie powierzchnia lezy na poziomie morza - na rzadkiej siatce gor trojkat od morza do zbocza ma wode
// tylko przy dolnym wierzcholku, a nie rozmazana po calym zboczu.
float landF = smoothstep(${(SEA_HEIGHT * H_SCALE - 0.026).toFixed(3)}, ${(SEA_HEIGHT * H_SCALE + 0.02).toFixed(3)}, vWorld.y + edge * 0.01);
col = mix(sea, col, landF);
diffuseColor.rgb = col;
`;

export class OutlandRenderer {
  readonly mesh: THREE.Mesh;

  /** detail, time - tekstura faktur i czas animacji wody terenu mapy (TerrainRenderer.detail, TerrainRenderer.time). */
  constructor(map: MapData, seed: number, detail: THREE.Texture, time: { value: number }) {
    const x1 = map.w - 0.5, z1 = (map.h - 1) * ROW_H;
    const xs = axis(0, x1), zs = axis(0, z1);
    const nx = xs.length, nz = zs.length;
    const n = nx * nz;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const wcol = new Float32Array(n * 3);
    const kind = new Float32Array(n * 4);
    /** Udzial kontynentu (0 przy mapie) - tylko on splaszcza sie po stronie kamery. */
    const far = new Float32Array(n);
    const h = new Float32Array(n);
    /** Udzial plycizny przy brzegu mapy (0..1) i jak bardzo wierzcholek przejmuje go od mapy. */
    const edgeShall = new Float32Array(n);
    const edgeW = new Float32Array(n);
    /** Odleglosc wierzcholka od prostokata mapy (swiat). */
    const dist = new Float32Array(n);
    /** Pas brzegu ladu mapy: 1 - plaza, 2 - skala pod gora. */
    const coast = new Uint8Array(n);
    const sea = SEA_HEIGHT;

    // Wysokosci (jednostki mapy): morze, dalej kontynenty - lady tam, gdzie szum o niskiej czestotliwosci
    // przekracza prog (prog maleje z odlegloscia, wiec im dalej, tym wiecej ladu); w glebi ladu wysokie gory.
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const wx = xs[i], wz = zs[j];
        const dx = Math.max(0, -wx, wx - x1), dz = Math.max(0, -wz, wz - z1);
        const d = Math.hypot(dx, dz);
        const cont = fbm(wx * 0.012, wz * 0.012, seed + 1) + (fbm(wx * 0.05, wz * 0.05, seed + 6) - 0.5) * 0.18;
        const shore = 0.6 - smooth(CONT_NEAR, CONT_FULL + 40, d) * 0.12;
        const landW = smooth(shore - 0.01, shore + 0.02, cont) * smooth(CONT_NEAR - 6, CONT_NEAR, d);
        const inland = smooth(shore + 0.02, shore + 0.16, cont);
        const ridge = 1 - Math.abs(fbm(wx * 0.03, wz * 0.03, seed + 3) * 2 - 1);
        const land = sea + 0.8 + 6 * fbm(wx * 0.08, wz * 0.08, seed + 2) * smooth(shore, shore + 0.05, cont)
          + inland * (ridge * ridge * 0.85 + 0.15 * fbm(wx * 0.02, wz * 0.02, seed + 7)) * PEAK;
        const bed = sea - 1.5 - Math.min(3, d * 0.3);
        let v = bed + (land - bed) * landW;
        // Skrajne pole mapy najblizej wierzcholka (plycizna wody przy krawedzi, wysokosc pod mapa).
        const ex = Math.min(map.w - 1, Math.max(0, Math.round(wx))), ey = Math.min(map.h - 1, Math.max(0, Math.round(wz / ROW_H)));
        // Lad mapy dochodzacy do krawedzi schodzi od niej do morza stokiem o szerokosci zmiennej szumem (pod gora
        // urwisko) - inaczej konczy sie rowno ucieta krawedzia mapy. Stok od razu opada: szerszy albo z plaskim
        // wierzcholkiem wyglada jak fartuch doklejony do mapy.
        const eh = edgeHeight(map, Math.min(x1, Math.max(0, wx)), Math.min(z1, Math.max(0, wz)));
        const coastL = 0.8 + 6 * Math.max(0, fbm(wx * 0.3, wz * 0.3, seed + 8) - 0.35);
        const et = map.terrain[shownIdx(map, ey * map.w + ex)];
        const k = j * nx + i;
        if (d === 0 && wx > 0 && wx < x1 && wz > 0 && wz < z1) v = sea;
        else if (eh > sea && d < coastL) {
          v = Math.max(v, eh + (sea - 0.8 - eh) * (d / coastL));
          coast[k] = et === T.MOUNTAIN || et === T.SNOW ? 2 : 1;
        }
        h[k] = v;
        edgeShall[k] = edgeShallow(map, ex, ey);
        edgeW[k] = 1 - smooth(0, 2, d);
        dist[k] = d;
      }
    }

    // Wierzcholki: kolor trawy (laty, plamy lasu), wagi rodzajow, kolor i udzial wody.
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const wx = xs[i], wz = zs[j];
        const v = h[k];
        const ii = Math.min(nx - 1, i + 1), jj = Math.min(nz - 1, j + 1);
        // Nachylenie w swiecie (przyrost wysokosci na jednostke) - do sasiada w prawo i w dol.
        const slope = Math.hypot((h[j * nx + ii] - v) / ((xs[ii] - wx) || 1), (h[jj * nx + i] - v) / ((zs[jj] - wz) || 1)) * H_SCALE;
        const g = fbm(wx * 0.08, wz * 0.08, seed + 4);
        const lg = Math.min(1, Math.max(0, g * 1.4 - 0.1 + (v - 8) * 0.02));
        const forest = smooth(0.52, 0.6, fbm(wx * 0.05, wz * 0.05, seed + 5)) * (1 - smooth(10, 16, v)) * 0.85;
        for (let c = 0; c < 3; c++) {
          const grass = GRASS_DARK[c] + (GRASS_LIGHT[c] - GRASS_DARK[c]) * lg;
          col[k * 3 + c] = grass + (FOREST_FLOOR[c] - grass) * forest;
          const own = smooth(0, 1, sea - v);
          const shallow = own + (edgeShall[k] - own) * edgeW[k];
          wcol[k * 3 + c] = SHALLOW_WATER[c] + (WATER[c] - SHALLOW_WATER[c]) * shallow;
        }
        // Plaza tylko przy samym brzegu - szeroka na niskiej rowninie wybrzeza robila w mgielce jasny pas nad woda.
        const sandW = coast[k] === 1 ? 1 : 1 - smooth(sea + 0.2, sea + 0.7, v);
        const rockW = coast[k] === 2 ? 1 : coast[k] ? 0 : Math.max(smooth(0.35, 0.6, slope), smooth(11, 17, v));

        const snowW = smooth(0.62, 0.72, (v - sea) / PEAK + g * 0.08);
        kind[k * 4] = (1 - sandW) * (1 - rockW) * (1 - snowW);
        kind[k * 4 + 1] = sandW * (1 - rockW);
        kind[k * 4 + 2] = rockW * (1 - snowW);
        kind[k * 4 + 3] = snowW;
        far[k] = smooth(CONT_NEAR - 20, CONT_NEAR - 8, dist[k]);
        // Woda plaska tuz pod lustrem wody mapy - teren mapy ja zaslania, nie miga z jej woda. Lad tuz pod terenem:
        // na krawedzi mapy styka sie z nim bez stopnia.
        pos[k * 3] = wx;
        pos[k * 3 + 1] = v > sea ? v * H_SCALE - 0.005 : sea * H_SCALE - 0.03;
        pos[k * 3 + 2] = wz;
      }
    }

    // Trojkaty poza mapa i pasem 1 pola pod jej krawedzia (pod terenem mapy, zeby miedzy nimi nie przeswitywalo morze).
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        if (xs[i] >= 1 && xs[i + 1] <= x1 - 1 && zs[j] >= 1 && zs[j + 1] <= z1 - 1) continue;
        const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('wcol', new THREE.BufferAttribute(wcol, 3));
    geo.setAttribute('kind', new THREE.BufferAttribute(kind, 4));
    geo.setAttribute('far', new THREE.BufferAttribute(far, 1));
    geo.setAttribute('mapd', new THREE.BufferAttribute(dist, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const haze = { value: HAZE };
    const detailMap = { value: detail };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCurve = curveUniform;
      sh.uniforms.uHaze = haze;
      sh.uniforms.detailMap = detailMap;
      sh.uniforms.uTime = time;
      sh.uniforms.uView = outlandViewUniform;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 wcol;\nattribute vec4 kind;\nattribute float far;\nattribute float mapd;\nuniform vec2 uView;\nvarying vec3 vWcol;\nvarying vec4 vKind;\nvarying vec3 vWorld;\nvarying float vDist;\nvarying float vMapD;' + CURVE_COMMON)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWcol = wcol;
vKind = kind;
vWorld = position;
float seaY = ${(SEA_HEIGHT * H_SCALE - 0.03).toFixed(3)};
transformed.y = seaY + (transformed.y - seaY) * (1.0 - far * smoothstep(${FLAT_FROM.toFixed(1)}, ${FLAT_TO.toFixed(1)}, dot(position.xz - uCurve.xy, uView)));`)
        .replace('#include <project_vertex>', CURVE_PROJECT + '\nvDist = length(curveD);\nvMapD = mapd;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform float uTime;\nuniform vec3 uHaze;\nvarying vec3 vWcol;\nvarying vec4 vKind;\nvarying vec3 vWorld;\nvarying float vDist;\nvarying float vMapD;')
        .replace('#include <color_fragment>', OUTLAND_FRAGMENT)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, mix(smoothstep(${HAZE_NEAR.toFixed(1)}, ${HAZE_FAR.toFixed(1)}, min(vDist, vMapD + ${HAZE_NEAR.toFixed(1)})), 0.8 * smoothstep(${LAND_HAZE_NEAR.toFixed(1)}, ${LAND_HAZE_FAR.toFixed(1)}, min(vDist, vMapD + ${LAND_HAZE_NEAR.toFixed(1)})), landF));`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
