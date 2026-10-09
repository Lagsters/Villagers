/**
 * Teren jako chunki 32x32 pol: wspolne wierzcholki, gladkie normalne liczone z mapy wysokosci (bez szwow
 * miedzy chunkami). Wagi rodzajow terenu pol (trawa, piasek, skala, snieg; reszta to woda) sa w teksturze, a shader
 * rozstrzyga w kazdym pikselu, ktory rodzaj wygrywa - w punkcie przesunietym szumem, wiec granice faluja jak
 * malowane, a nie ida po trojkatach siatki. Kazdy rodzaj ma wlasna fakture z jednej generowanej w kodzie tekstury
 * (kanaly: trawa, skala, piasek i fale, szum granic); woda faluje w czasie (setTime). Ze stanu pol
 * (client/render/cells.ts) shader rysuje to, co laczy obiekty z ziemia: cienie drzew i budynkow, sciolke lasu,
 * wydeptana ziemie, drogi i zaorane pola.
 * three.js sam odrzuca chunki poza kadrem (frustum culling po boundingSphere).
 */
import * as THREE from 'three';
import { T } from '../../sim/defs.ts';
import { stepXY, DIR_E, DIR_SE, DIR_SW } from '../../sim/grid.ts';
import type { MapData } from '../../sim/mapgen.ts';
import { BEND_K, H_SCALE, ROW_H, vx, vz } from './coords.ts';
import { CURVE_COMMON, CURVE_PROJECT, curveUniform } from './curve.ts';
import {
  DEEP_WATER, EARTH, FOREST_FLOOR, GRASS_DARK, GRASS_DRY, GRASS_LIGHT, LITTER, PATH, ROCK_DARK, ROCK_LIGHT, SAND,
  SAND_DARK, SHALLOW_WATER, SNOW, SOIL_DARK, SOIL_LIGHT, WATER,
} from './palette.ts';

export const CHUNK = 32;
/** Polozenie slonca wzgledem celu swiatla kierunkowego; z niego takze kierunek cieni na terenie. */
export const SUN: readonly [number, number, number] = [-30, 60, 20];
/** Wysokosc, z ktorej liczony jest cien na terenie (srodek korony drzewa, dach chaty). */
const CAST_H = 0.5;
/** Rozmiar tekstury faktur (piksele, kafel powtarzalny). */
const TEX = 256;
/** Udzial piasku na polu ladu przy wodzie (reszta jego rodzaju) - plaza wezsza niz pole. */
const BEACH = 0.6;

function hash(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Szum wartosci o niskiej czestotliwosci (laty ciemniejszej i jasniejszej trawy) - komorki co `size` pol. */
function patch(x: number, y: number, size: number, seed: number): number {
  const gx = Math.floor(x / size), gy = Math.floor(y / size);
  const fx = x / size - gx, fy = y / size - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash(a * 7919 + b * 104729, seed);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx;
  const bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/**
 * Kolor trawy pola (x, y) przed faktura shadera: duze i mniejsze laty, wyzej jasniej. Ten sam kolor dostaja
 * kepy trawy stojace na polu (client/render/mapObjects.ts), zeby zlewaly sie z laka.
 */
export function grassColor(map: MapData, x: number, y: number, out: [number, number, number]): [number, number, number] {
  const i = y * map.w + x;
  const p = patch(x, y, 6, 3) * 0.6 + patch(x, y, 17, 4) * 0.4;
  const g = Math.min(1, Math.max(0, p * 1.6 - 0.3 + (map.height[i] - 8) * 0.03));
  const j = 1 + (hash(i, 7) - 0.5) * 0.08;
  for (let c = 0; c < 3; c++) out[c] = (GRASS_DARK[c] + (GRASS_LIGHT[c] - GRASS_DARK[c]) * g) * j;
  return out;
}

/** Szum wartosci powtarzalny co `period` komorek (kafel tekstury bez szwow), wynik 0..1. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const cell = TEX / period;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash(((a % period) + period) % period + (((b % period) + period) % period) * 977, seed);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx;
  const bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/** Odleglosc do najblizszego z losowych punktow (po jednym w komorce, kafel powtarzalny co `n` komorek), w komorkach. */
function worley(x: number, y: number, n: number, seed: number): number {
  const cell = TEX / n;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let f1 = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx, cy = gy + dy;
      const id = ((cx % n) + n) % n + (((cy % n) + n) % n) * 131;
      const px = (cx + 0.15 + 0.7 * hash(id, seed)) * cell, py = (cy + 0.15 + 0.7 * hash(id, seed + 1)) * cell;
      f1 = Math.min(f1, Math.hypot(px - x, py - y));
    }
  }
  return f1 / cell;
}

/**
 * Tekstura faktur (powtarzalna, odcienie szarosci w kanalach): R - trawa (kepki, zdzbla, ziarno), G - wysokosc
 * skaly (nierownosci i drobne glazy; shader liczy z niej swiatlo od slonca), B - piasek (zmarszczki
 * i ziarno; na wodzie fale), A - szum granic miedzy rodzajami terenu.
 */
function detailTexture(): THREE.Texture {
  const data = new Uint8Array(TEX * TEX * 4);
  const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const grain = hash(i, 11);
      // Trawa: miekkie kepy, krotkie pionowe zdzbla (jasne i ciemne kreski), ziarno.
      const clumps = tileNoise(x, y, 16, 1) * 0.6 + tileNoise(x, y, 32, 2) * 0.4;
      const blade = hash((x >> 1) + (y >> 2) * 128, 5);
      const g = 0.5 + (clumps - 0.5) * 0.55 + (grain - 0.5) * 0.18 + (blade > 0.86 ? 0.14 : blade < 0.1 ? -0.16 : 0);
      // Skala: nierowna, garbata powierzchnia (szum kilku skal) i miejscami pola drobnych glazow. Bez siatki
      // szczelin - rowna siec spekan wyglada z kamery jak bruk albo wyschniete bloto.
      const fbm = tileNoise(x, y, 8, 12) * 0.45 + tileNoise(x, y, 16, 13) * 0.3 + tileNoise(x, y, 32, 14) * 0.15 + tileNoise(x, y, 64, 17) * 0.1;
      const t = Math.min(1, worley(x, y, 14, 3) / 0.7);
      const boulders = (1 - t * t) * Math.max(0, Math.min(1, (tileNoise(x, y, 8, 15) - 0.42) * 4));
      const r = fbm * 0.62 + boulders * 0.3 + (grain - 0.5) * 0.06 + 0.04;
      // Piasek: zmarszczki od wiatru (falista linia) i drobne ziarno.
      const ripple = Math.sin((x / TEX) * Math.PI * 2 * 18 + tileNoise(x, y, 8, 6) * 6 + (y / TEX) * Math.PI * 2 * 3);
      const s = 0.55 + ripple * 0.07 + (grain - 0.5) * 0.22;
      // Granice: szum o srednich i niskich czestotliwosciach.
      const edge = tileNoise(x, y, 4, 7) * 0.5 + tileNoise(x, y, 8, 8) * 0.3 + tileNoise(x, y, 16, 9) * 0.2;
      data[i * 4] = b(g);
      data[i * 4 + 1] = b(r);
      data[i * 4 + 2] = b(s);
      data[i * 4 + 3] = b(edge);
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // Stoki odwrocone od kamery widac pod ostrym katem - bez filtrowania anizotropowego faktura rozmazuje sie w smugi.
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const glslColor = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

/**
 * Stan pol w shaderze (client/render/cells.ts): trojkat siatki terenu pod punktem - pola a, b, c i wagi
 * barycentryczne (ten sam podzial co groundHeight w client/render/coords.ts) - i odleglosc od drog wychodzacych
 * z pola. Kazdy odcinek drogi jest zapisany na obu koncach, wiec trzy wierzcholki trojkata widza kazda droge
 * blizsza niz ~0.8 pola. Rodzaje terenu pol (kindMap: trawa, piasek, skala, snieg; woda = reszta) w tej samej
 * siatce - shader czyta je w dowolnym punkcie, takze przesunietym szumem.
 */
const CELLS_GLSL = /* glsl */ `
uniform sampler2D cellMap;
uniform sampler2D pathMap;
uniform sampler2D bendMap;
uniform sampler2D kindMap;
uniform float uTime;
const vec2 DIRV[6] = vec2[6](vec2(1.0, 0.0), vec2(0.5, ${ROW_H.toFixed(8)}), vec2(-0.5, ${ROW_H.toFixed(8)}),
  vec2(-1.0, 0.0), vec2(-0.5, -${ROW_H.toFixed(8)}), vec2(0.5, -${ROW_H.toFixed(8)}));
vec4 cellTex(vec2 c) {
  ivec2 s = textureSize(cellMap, 0);
  return texelFetch(cellMap, clamp(ivec2(c), ivec2(0), s - 1), 0);
}
vec4 kindTex(vec2 c) {
  ivec2 s = textureSize(kindMap, 0);
  return texelFetch(kindMap, clamp(ivec2(c), ivec2(0), s - 1), 0);
}
vec2 cellPos(vec2 c) { return vec2(c.x + mod(c.y, 2.0) * 0.5, c.y * ${ROW_H.toFixed(8)}); }
void cellTri(vec2 p, out vec2 a, out vec2 b, out vec2 c, out vec3 w) {
  float rf = p.y / ${ROW_H.toFixed(8)};
  float r = floor(rf);
  float t = rf - r;
  float odd = mod(r, 2.0);
  float q = p.x - odd * 0.5 - 0.5 * t;
  float i = floor(q);
  float f = q - i;
  if (f + t <= 1.0) { a = vec2(i, r); b = vec2(i + 1.0, r); c = vec2(i + odd, r + 1.0); w = vec3(1.0 - f - t, f, t); }
  else { a = vec2(i + 1.0, r); b = vec2(i + odd, r + 1.0); c = vec2(i + 1.0 + odd, r + 1.0); w = vec3(1.0 - t, 1.0 - f, f + t - 1.0); }
}
// Przesuniecie srodka drogi na polu (droga omija drzewo, client/render/roadBend.ts).
vec2 bendOf(vec2 c) {
  ivec2 s = textureSize(bendMap, 0);
  return (texelFetch(bendMap, clamp(ivec2(c), ivec2(0), s - 1), 0).rg * 255.0 - 128.0) / ${BEND_K.toFixed(1)};
}
// Sasiad pola w kierunku k (jak stepXY w sim/grid.ts: wiersze nieparzyste przesuniete o pol pola w prawo).
vec2 stepCell(vec2 c, int k) {
  bool odd = mod(c.y, 2.0) > 0.5;
  if (k == 0) return c + vec2(1.0, 0.0);
  if (k == 3) return c + vec2(-1.0, 0.0);
  float dy = k < 3 ? 1.0 : -1.0;
  bool east = k == 1 || k == 5;
  return c + vec2(east ? (odd ? 1.0 : 0.0) : (odd ? 0.0 : -1.0), dy);
}
float roadDist(vec2 p, vec2 cell, int bits) {
  float best = 9.0;
  if ((bits & 63) == 0) return best;
  vec2 c0 = cellPos(cell);
  vec2 o = c0 + bendOf(cell);
  for (int k = 0; k < 6; k++) {
    if ((bits & (1 << k)) == 0) continue;
    vec2 e = c0 + DIRV[k] + bendOf(stepCell(cell, k));
    vec2 ab = e - o;
    float h = clamp(dot(p - o, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    best = min(best, length(p - o - ab * h));
  }
  return best;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * h);
}
// Sciezka od flagi do wejscia budynku (pathMap, client/render/cells.ts): na polu flagi i na polu budynku.
float pathDist(vec2 p, vec2 cell) {
  ivec2 s = textureSize(pathMap, 0);
  vec4 t = (texelFetch(pathMap, clamp(ivec2(cell), ivec2(0), s - 1), 0) * 255.0 - 128.0) / 79.0;
  vec2 o = cellPos(cell);
  float best = 9.0;
  if (dot(t.xy, t.xy) > 1e-4) best = segDist(p, o, o + t.xy);
  if (dot(t.zw, t.zw) > 1e-4) best = min(best, segDist(p, o + t.zw, o + DIRV[1]));
  return best;
}
float speck(vec2 g, float seed) { return fract(sin(dot(floor(g), vec2(127.1, 311.7)) + seed) * 43758.5453); }
`;

/**
 * Kolor terenu w pikselu: wagi rodzajow (kindMap) czytane w punkcie przesunietym szumem - granice faluja niezaleznie
 * od trojkatow siatki - i dodatkowo przesuniete szumem granic (kazdy rodzaj w inna strone); wygrywa najwyzsza
 * z waskim, miekkim przejsciem.
 * - Trawa: przesuszona na wzgorzach (szum) i przy plazach, ciemna sciolka w lesie, kwiaty na lakach, na stromej
 *   lace przeswituje ziemia.
 * - Skala: faktura rzutowana z trzech stron (bez rozciagniec na urwiskach), na plaskim oswietlona od slonca, na
 *   urwiskach warstwy; odcien cieply albo chlodny w duzych latach, na plaskich polkach mech i gorska trawa, przy
 *   lace piarg.
 * - Snieg: zaspy, zsuwa sie ze stromizn na skale, stoki odwrocone od slonca niebieskawe.
 * - Piasek: wydmy, cieplejsze laty, mokry pas przy wodzie, kamyki.
 * - Woda: glebia (vWcol), fale i blyski plynace w czasie, przy brzegu przeswituje piaszczyste dno, piana faluje.
 * Na wierzchu stan pol: wydeptana ziemia przy budynkach i flagach, zaorane pole (bruzdy wzdluz z pod grzbietami
 * zboza modelu), drogi z koleinami i przydeptana trawa przy brzegu, cien drzew i budynkow (stan pola przesuniety
 * od slonca).
 */
const TERRAIN_FRAGMENT = /* glsl */ `
vec2 p = vWorld.xz;
vec4 dt = texture2D(detailMap, p / 3.0);
float edge = (texture2D(detailMap, p / 7.0 + 0.37).a - 0.5) * 1.4 + (texture2D(detailMap, p / 2.1 + 0.71).a - 0.5) * 0.7;
vec3 wn = normalize(vWN);
float steep = 1.0 - clamp(wn.y, 0.0, 1.0);
float cliff = smoothstep(0.3, 0.6, steep);
float lowN = texture2D(detailMap, p / 23.0 + 0.13).a;

vec2 pk = p + (vec2(texture2D(detailMap, p / 2.6 + 0.19).a, texture2D(detailMap, p / 2.6 + 0.61).a) - 0.5) * 0.9;
vec2 ka, kb, kc;
vec3 kw3;
cellTri(pk, ka, kb, kc, kw3);
vec4 w = kw3.x * kindTex(ka) + kw3.y * kindTex(kb) + kw3.z * kindTex(kc);
float water = clamp(1.0 - w.x - w.y - w.z - w.w, 0.0, 1.0);
// Woda tylko na poziomie lustra: trojkat miedzy polem wody a wyzszym ladem to juz brzeg, nie woda na stoku.
// Prog wysokosci faluje szumem - inaczej linia brzegu szlaby prosto po trojkatach; w glab wody tylko przy brzegu.
float shore = vWorld.y - vWLevel - max(edge * 0.13 + (dt.b - 0.5) * 0.05, -0.1 * (1.0 - water));
water *= 1.0 - smoothstep(0.03, 0.08, shore);

// Skala: trzy rzuty faktury wazone normalna; swiatlo od slonca z rzutu z gory.
vec3 tw = pow(abs(wn), vec3(8.0));
tw /= tw.x + tw.y + tw.z;
float rTop = texture2D(detailMap, p / 3.2).g;
float rockD = rTop * tw.y + texture2D(detailMap, vec2(vWorld.z, -vWorld.y * 1.3) / 3.2 + 0.31).g * tw.x
  + texture2D(detailMap, vec2(vWorld.x, -vWorld.y * 1.3) / 3.2 + 0.57).g * tw.z;
float rockLit = (rTop - texture2D(detailMap, p / 3.2 + vec2(-0.012, 0.008)).g) * 4.0 * tw.y;

vec2 ca, cb, cc;
vec3 bw;
cellTri(p, ca, cb, cc, bw);
vec4 ta = cellTex(ca), tb = cellTex(cb), tc = cellTex(cc);
ivec3 bits = ivec3(vec3(ta.b, tb.b, tc.b) * 255.0 + 0.5);
float treeV = dot(bw, vec3(ta.r, tb.r, tc.r));
float castHere = dot(bw, vec3(ta.g, tb.g, tc.g));
float wornV = max(dot(bw, vec3(ta.a, tb.a, tc.a)), dot(bw, vec3(notEqual(bits & 64, ivec3(0)))) * 0.8);
float fieldV = dot(bw, vec3(notEqual(bits & 128, ivec3(0))));
float road = min(min(roadDist(p, ca, bits.x), roadDist(p, cb, bits.y)), roadDist(p, cc, bits.z));
road = min(road, min(min(pathDist(p, ca), pathDist(p, cb)), pathDist(p, cc)));
vec2 sa, sb, sc;
vec3 sw;
cellTri(p - vec2(${(-SUN[0] / SUN[1] * CAST_H).toFixed(4)}, ${(-SUN[2] / SUN[1] * CAST_H).toFixed(4)}), sa, sb, sc, sw);
vec2 caster = sw.x * cellTex(sa).rg + sw.y * cellTex(sb).rg + sw.z * cellTex(sc).rg;

float dry = clamp(smoothstep(0.55, 0.75, lowN) * 0.35 + smoothstep(0.02, 0.4, w.y) * 0.5, 0.0, 0.7);
vec3 grass = mix(vColor.rgb, ${glslColor(GRASS_DRY)}, dry) * (0.8 + 0.4 * dt.r);
grass = mix(grass, ${glslColor(EARTH)} * (0.75 + 0.5 * rockD), smoothstep(0.42, 0.7, steep) * 0.85);
// Las: ciemna sciolka z rudymi plamami pod drzewami i miedzy nimi, laka przy lesie ciemniejsza.
float forest = smoothstep(0.3, 0.75, treeV + edge * 0.3);
vec3 litter = mix(${glslColor(FOREST_FLOOR)}, ${glslColor(LITTER)}, smoothstep(0.5, 0.68, texture2D(detailMap, p / 1.3 + 0.21).a) * 0.6) * (0.8 + 0.4 * dt.r);
grass = mix(grass * (1.0 - 0.18 * smoothstep(0.02, 0.3, treeV)), litter, forest * 0.85);
// Kwiaty i kamyki: rzadkie plamki (laka, piasek); z daleka gasna (bez migotania).
vec2 fg = p * 6.0;
float fh = speck(fg, 0.0);
float fr = length(fract(fg) - 0.5 - (vec2(fract(fh * 13.1), fract(fh * 71.7)) - 0.5) * 0.5);
float fade = clamp(1.6 - length(fwidth(fg)) * 3.0, 0.0, 1.0);
float meadow = smoothstep(0.42, 0.3, lowN) * (1.0 - forest) * (1.0 - dry);
float bloom = step(0.9, fh) * (1.0 - smoothstep(0.1, 0.16, fr)) * meadow * fade;
grass = mix(grass, fh > 0.97 ? vec3(0.8, 0.78, 0.66) : fh > 0.935 ? vec3(0.8, 0.55, 0.06) : vec3(0.36, 0.22, 0.55), bloom);

// Skala: odcien w duzych latach, warstwy na urwiskach, mech na polkach, piarg przy lace.
float tone = texture2D(detailMap, p / 11.0 + 0.3).a;
vec3 rock = mix(${glslColor(ROCK_DARK)}, ${glslColor(ROCK_LIGHT)}, clamp(0.12 + rockD * 0.8 + rockLit + edge * 0.12, 0.0, 1.0));
rock *= mix(vec3(1.06, 0.99, 0.9), vec3(0.93, 0.97, 1.03), smoothstep(0.35, 0.65, tone));
rock *= (1.0 + 0.1 * sin(vWorld.y * 18.0 + edge * 3.0 + rockD * 2.5) * cliff) * (0.88 + 0.24 * texture2D(detailMap, p * 0.9 + 0.17).g);
float ledge = (1.0 - smoothstep(0.06, 0.22, steep)) * smoothstep(0.6, 0.74, texture2D(detailMap, p / 4.3 + 0.8).a + w.x * 0.5);
rock = mix(rock, mix(vColor.rgb * mix(vec3(0.85), vec3(1.05, 1.0, 0.82), tone), rock, 0.35) * (0.75 + 0.4 * dt.r), ledge * 0.7);
float scree = smoothstep(0.04, 0.35, w.x) * (1.0 - cliff);
vec3 gravel = mix(${glslColor(ROCK_LIGHT)}, ${glslColor(SAND_DARK)}, 0.35) * (0.7 + 0.55 * texture2D(detailMap, p * 1.9).b);
rock = mix(rock, gravel, scree * 0.65);

// Snieg: zaspy, stoki odwrocone od slonca niebieskawe.
float sunLit = dot(wn, normalize(vec3(${SUN.join('.0, ')}.0)));
float drift = texture2D(detailMap, p / 4.0 + 0.45).a;
float driftLit = (drift - texture2D(detailMap, p / 4.0 + 0.45 + vec2(-0.012, 0.008)).a) * 6.0;
vec3 snow = ${glslColor(SNOW)} * (0.95 + 0.04 * dt.r + clamp(driftLit, -0.07, 0.05));
snow = mix(snow, snow * vec3(0.78, 0.86, 1.0), clamp(clamp(0.95 - sunLit, 0.0, 1.0) * 0.8 + steep * 0.2 + (0.5 - drift) * 0.25, 0.0, 1.0));

// Piasek: wydmy, laty cieplejsze, mokry pas przy wodzie, kamyki.
float dune = sin(dot(p, vec2(0.8, 0.6)) * 1.5 + edge * 3.0 + lowN * 7.0);
vec3 sand = mix(${glslColor(SAND_DARK)}, ${glslColor(SAND)}, 0.5 + 0.4 * smoothstep(0.3, 0.7, tone)) * (0.88 + 0.24 * dt.b) * (1.0 + 0.14 * dune);
sand = mix(sand, sand * vec3(0.66, 0.64, 0.58), smoothstep(0.12, 0.42, water));
float ph = speck(p * 9.0, 7.0);
float pebble = step(0.965, ph) * (1.0 - smoothstep(0.1, 0.17, length(fract(p * 9.0) - 0.5))) * clamp(1.6 - length(fwidth(p * 9.0)) * 3.0, 0.0, 1.0);
sand = mix(sand, mix(${glslColor(ROCK_LIGHT)} * 0.8, sand * 0.7, step(0.985, ph)), pebble * 0.8);

// Woda: dwie warstwy fal plynace w rozne strony, blyski, przy brzegu dno z piasku i piana.
vec2 wp = p / 4.0;
float wa = texture2D(detailMap, vec2(wp.x * 0.9 + wp.y * 0.4, wp.y * 0.8 - wp.x * 0.3) + vec2(0.012, 0.007) * uTime).b;
float wb = texture2D(detailMap, vec2(wp.y * 0.7 - wp.x * 0.5, wp.x * 0.8 + wp.y * 0.3) * 1.3 - vec2(0.009, 0.013) * uTime).b;
vec3 sea = vWcol * (1.0 + 0.22 * (wa + wb - 1.1));
sea = mix(sea, ${glslColor(SAND)} * 0.62 + vec3(0.0, 0.05, 0.06), (1.0 - smoothstep(0.5, 0.92, water)) * 0.55);
sea += vec3(0.5, 0.5, 0.45) * smoothstep(0.66, 0.72, min(wa, wb)) * smoothstep(0.75, 1.0, water) * 0.5;
float lap = 0.55 + 0.07 * sin(uTime * 0.8 + edge * 5.0);
float foam = max(1.0 - smoothstep(0.0, 0.05, abs(water - lap)), 0.7 * (1.0 - smoothstep(0.0, 0.08, abs(water - 0.42))));
// Z daleka piana slabsza - inaczej obrysowuje wybrzeze gruba biala linia.
sea = mix(sea, vec3(0.9, 0.95, 0.95), foam * 0.5 * (0.7 + 0.6 * dt.b) * clamp(1.6 - length(fwidth(p)) * 30.0, 0.35, 1.0));

float slide = smoothstep(0.35, 0.6, steep);
w.z += w.w * slide;
w.w *= 1.0 - slide;
vec4 sk = w + vec4(edge, -edge * 0.8, edge * 0.7, -edge) * 0.25;
float swat = water - edge * 0.4;
float top = max(max(max(sk.x, sk.y), max(sk.z, sk.w)), swat);
vec4 k = smoothstep(top - 0.1, top, sk);
float kw = smoothstep(top - 0.1, top, swat);
float tot = k.x + k.y + k.z + k.w + kw;
k /= tot;
kw /= tot;
vec3 col = grass * k.x + sand * k.y + rock * k.z + snow * k.w + sea * kw;
float land = 1.0 - kw;

// Ubita ziemia (drogi, place) w kolorze podloza: na piasku ciemniejszy piasek, na skale zwir.
vec3 path = ${glslColor(PATH)} * (0.84 + 0.32 * dt.b);
path = mix(path, sand * 0.78, k.y);
path = mix(path, gravel * 0.85, k.z * 0.7);
float worn = smoothstep(0.42, 0.62, wornV + edge * 0.2 + (dt.r - 0.5) * 0.25);
col = mix(col, path, worn * land * 0.85);
// Pole: grzbiety skib pod grzbietami zboza modelu pola (co 0.125, srodek pola na bruzdzie), bruzdy miedzy nimi.
float soil = smoothstep(0.52, 0.6, fieldV + edge * 0.22 + (texture2D(detailMap, p / 0.9 + 0.4).a - 0.5) * 0.3) * land;
float ridge = 1.0 - abs(fract(p.x / 0.125) - 0.5) * 2.0;
vec3 soilC = mix(${glslColor(SOIL_DARK)}, ${glslColor(SOIL_LIGHT)}, smoothstep(0.15, 0.75, ridge)) * (0.85 + 0.3 * dt.b);
col = mix(col, soilC, soil);
// Droga: postrzepiony brzeg, dwie koleiny, przy brzegu przydeptana i przesuszona trawa; na wodzie jasny slad.
float rw = 0.115 + edge * 0.03 + (dt.r - 0.5) * 0.04;
float onRoad = 1.0 - smoothstep(rw - 0.015, rw + 0.01, road);
float rut = 1.0 - smoothstep(0.01, 0.028, abs(road - 0.05));
float fringe = (1.0 - smoothstep(rw, rw + 0.11, road)) * (1.0 - onRoad);
col = mix(col, mix(col, ${glslColor(GRASS_DRY)} * (0.8 + 0.4 * dt.r), 0.55) * 0.92, fringe * k.x);
col = mix(col, path * (1.0 - 0.2 * rut) * (0.94 + 0.12 * dt.g), onRoad * land);
col = mix(col, col * 1.2 + 0.03, onRoad * kw * 0.6);
// Cien drzew (korona) i bryl (budynek, skala) po stronie odwrotnej do slonca; przy samym pniu i scianie dookola.
float shade = smoothstep(0.5, 0.8, caster.x + edge * 0.15) * 0.5 + smoothstep(0.3, 0.6, caster.y + edge * 0.1) * 0.45;
shade = max(shade, smoothstep(0.55, 0.95, max(treeV, castHere)) * 0.38);
col *= 1.0 - min(shade, 0.55) * (0.4 + 0.6 * land);
diffuseColor.rgb = col;
`;

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private material: THREE.MeshLambertMaterial;
  private detail: THREE.Texture;
  private kinds: THREE.DataTexture;
  private time = { value: 0 };
  readonly cw: number;
  readonly ch: number;

  private map: MapData;
  private rgb: [number, number, number] = [0, 0, 0];

  /** cells, paths, bends - stan pol, sciezki do wejsc budynkow, luki drog wokol drzew (client/render/cells.ts). */
  constructor(map: MapData, cells: THREE.Texture, paths: THREE.Texture, bends: THREE.Texture) {
    this.map = map;
    this.detail = detailTexture();
    this.kinds = this.kindTexture();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const detailMap = { value: this.detail };
    const cellMap = { value: cells };
    const pathMap = { value: paths };
    const bendMap = { value: bends };
    const kindMap = { value: this.kinds };
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = detailMap;
      sh.uniforms.cellMap = cellMap;
      sh.uniforms.pathMap = pathMap;
      sh.uniforms.bendMap = bendMap;
      sh.uniforms.kindMap = kindMap;
      sh.uniforms.uTime = this.time;
      sh.uniforms.uCurve = curveUniform;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 wcol;\nattribute float wlevel;\nvarying vec3 vWcol;\nvarying float vWLevel;\nvarying vec3 vWorld;\nvarying vec3 vWN;' + CURVE_COMMON)
        .replace('#include <project_vertex>', CURVE_PROJECT)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWcol = wcol;\nvWLevel = wlevel;\nvWorld = position;\nvWN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWcol;\nvarying float vWLevel;\nvarying vec3 vWorld;\nvarying vec3 vWN;\n' + CELLS_GLSL)
        .replace('#include <color_fragment>', TERRAIN_FRAGMENT);
    };
    this.cw = Math.ceil((map.w - 1) / CHUNK);
    this.ch = Math.ceil((map.h - 1) / CHUNK);
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const mesh = new THREE.Mesh(this.buildGeometry(cx, cy), this.material);
        mesh.matrixAutoUpdate = false;
        mesh.userData.chunk = cy * this.cw + cx;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Czas animacji wody (s, plynie takze przy pauzie gry). */
  setTime(t: number): void {
    this.time.value = t;
  }

  /**
   * Wagi rodzajow terenu pol (RGBA: trawa, piasek, skala, snieg; woda = reszta) dla shadera. Pole ladu przy wodzie
   * jest w czesci piaskiem (plaza). Rodzaje pol sie nie zmieniaja (wyrownanie terenu zmienia tylko wysokosc).
   */
  private kindTexture(): THREE.DataTexture {
    const m = this.map;
    const data = new Uint8Array(m.w * m.h * 4);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        const t = m.terrain[i];
        if (t === T.WATER) continue;
        const own = t === T.DESERT ? 1 : t === T.MOUNTAIN ? 2 : t === T.SNOW ? 3 : 0;
        if (own === 0 && this.isShore(x, y)) {
          data[i * 4] = Math.round((1 - BEACH) * 255);
          data[i * 4 + 1] = Math.round(BEACH * 255);
        } else data[i * 4 + own] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, m.w, m.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** Oznacz chunk(i) zawierajacy pole do przebudowy (np. po wyrownaniu terenu). */
  markDirty(idx: number): void {
    const x = idx % this.map.w;
    const y = (idx / this.map.w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = Math.floor((x + dx) / CHUNK);
        const cy = Math.floor((y + dy) / CHUNK);
        if (cx >= 0 && cy >= 0 && cx < this.cw && cy < this.ch) this.dirty.add(cy * this.cw + cx);
      }
    }
  }

  /** Przebudowa wszystkich chunkow (np. po przewinieciu gry z wyrownywaniem terenu). */
  markAllDirty(): void {
    for (let c = 0; c < this.chunks.length; c++) this.dirty.add(c);
  }

  update(): void {
    if (this.dirty.size === 0) return;
    for (const c of this.dirty) {
      const mesh = this.chunks[c];
      mesh.geometry.dispose();
      mesh.geometry = this.buildGeometry(c % this.cw, Math.floor(c / this.cw));
    }
    this.dirty.clear();
  }

  private at(x: number, y: number): number {
    const m = this.map;
    x = Math.max(0, Math.min(m.w - 1, x));
    y = Math.max(0, Math.min(m.h - 1, y));
    return y * m.w + x;
  }

  /** Czy pole ladu sasiaduje z woda (brzeg - plaza). */
  private isShore(x: number, y: number): boolean {
    const m = this.map;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (m.terrain[this.at(x + dx, y + dy)] === T.WATER) return true;
    }
    return false;
  }

  /**
   * Wierzcholek (pole): kolor trawy z latami (rgb - takze pod innymi rodzajami: przejscia, polki skalne), kolor
   * wody (glebia, ku brzegowi mapy kolor tla) i poziom lustra najblizszej wody (wlevel).
   */
  private node(x: number, y: number, col: Float32Array, wcol: Float32Array, wlevel: Float32Array, k: number): void {
    const m = this.map;
    const t = m.terrain[y * m.w + x];
    grassColor(m, x, y, this.rgb);
    col.set(this.rgb, k * 3);
    // Woda: przy brzegu jasniejsza plycizna, dalej otwarta woda, ku brzegowi mapy glebia w kolorze tla.
    const shallow = t === T.WATER ? this.waterDepth(x, y) : 0;
    const d = Math.min(x, y, m.w - 1 - x, m.h - 1 - y);
    const e = Math.min(1, d / 8);
    const edge = e * e * (3 - 2 * e);
    for (let c = 0; c < 3; c++) {
      const open = SHALLOW_WATER[c] + (WATER[c] - SHALLOW_WATER[c]) * shallow;
      wcol[k * 3 + c] = DEEP_WATER[c] + (open - DEEP_WATER[c]) * edge;
    }
    wlevel[k] = this.waterLevel(x, y);
  }

  /**
   * Poziom lustra wody przy polu (swiat): wysokosc pola wody, a dla ladu - najnizsza z pol wody w promieniu 2 pol
   * (jezioro moze lezec wyzej niz morze; brzeg nalezy do najblizszej wody). Bez wody w poblizu - wysokosc pola.
   */
  private waterLevel(x: number, y: number): number {
    const m = this.map;
    const i = this.at(x, y);
    if (m.terrain[i] === T.WATER) return m.height[i] * H_SCALE;
    let h = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const j = this.at(x + dx, y + dy);
        if (m.terrain[j] === T.WATER) h = Math.min(h, m.height[j]);
      }
    }
    return (Number.isFinite(h) ? h : m.height[i]) * H_SCALE;
  }

  /** Odleglosc pola wody od ladu 0..1 (0 - przy brzegu, 0.5 - dwa pola od ladu, 1 - dalej). */
  private waterDepth(x: number, y: number): number {
    const m = this.map;
    let near = 3;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (m.terrain[this.at(x + dx, y + dy)] !== T.WATER) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
    return (near - 1) / 2;
  }

  private buildGeometry(cx: number, cy: number): THREE.BufferGeometry {
    const m = this.map;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(m.w - 1, x0 + CHUNK), y1 = Math.min(m.h - 1, y0 + CHUNK);
    // Wierzcholki: pola od x0-1 do x1 (trojkat SW siega kolumny w lewo), wiersze y0..y1.
    const vxMin = Math.max(0, x0 - 1);
    const cols = x1 - vxMin + 1;
    const rows = y1 - y0 + 1;
    const n = cols * rows;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const wcol = new Float32Array(n * 3);
    const wlevel = new Float32Array(n);
    for (let y = y0; y <= y1; y++) {
      for (let x = vxMin; x <= x1; x++) {
        const k = (y - y0) * cols + (x - vxMin);
        const i = y * m.w + x;
        const wx = vx(x, y), wz = vz(y);
        pos[k * 3] = wx; pos[k * 3 + 1] = m.height[i] * H_SCALE; pos[k * 3 + 2] = wz;
        // Normalna z roznic centralnych mapy wysokosci (identyczna po obu stronach granicy chunku).
        const hl = m.height[this.at(x - 1, y)], hr = m.height[this.at(x + 1, y)];
        const hu = m.height[this.at(x, y - 1)], hd = m.height[this.at(x, y + 1)];
        const nx = -(hr - hl) * H_SCALE / 2;
        const nz = -(hd - hu) * H_SCALE / (2 * ROW_H);
        const len = Math.hypot(nx, 1, nz);
        nor[k * 3] = nx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = nz / len;
        this.node(x, y, col, wcol, wlevel, k);
      }
    }
    const idx: number[] = [];
    const vi = (x: number, y: number) => (y - y0) * cols + (x - vxMin);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [ex, ey] = stepXY(x, y, DIR_E);
        const [sex, sey] = stepXY(x, y, DIR_SE);
        const [swx, swy] = stepXY(x, y, DIR_SW);
        if (sex <= x1 && sey <= y1 && ex <= x1) idx.push(vi(x, y), vi(sex, sey), vi(ex, ey));
        if (swx >= vxMin && swy <= y1 && sex <= x1) idx.push(vi(x, y), vi(swx, swy), vi(sex, sey));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('wcol', new THREE.BufferAttribute(wcol, 3));
    g.setAttribute('wlevel', new THREE.BufferAttribute(wlevel, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  dispose(): void {
    for (const c of this.chunks) c.geometry.dispose();
    this.detail.dispose();
    this.kinds.dispose();
    this.material.dispose();
  }
}
