/**
 * Zawody pracujace w terenie i zwierzyna.
 * Lesnik: przed wyjsciem kleka za grzadka przy chacie i wyciaga sadzonke (grzadka sie przerzedza i powoli
 *   odrasta); na miejscu odklada sadzonke, kopie lopata dolek (grudki ziemi leca na kopczyk), przyklekuje,
 *   wklada sadzonke, zgarnia ziemie i udeptuje ja.
 * Kamieniarz: odlupuje kilofem kawalki skaly (odpryski), ostatnim uderzeniem odlamuje blok, niesie go
 *   na ramieniu i przy chacie ociosuje mlotkiem na kamiennym stole na rowna kostke.
 * Rybak: odstawia kosz, zarzuca wedke, splawik kolysze sie na wodzie i drga przy braniu; zaciecie, ryba
 *   szamocze sie na zylce, rybak wrzuca ja do kosza i wraca z koszem. Przy chacie suszy sie siec i ryby.
 * Mysliwy: ostatnie pola skrada sie pochylony, kleka, naciaga luk; strzala trafia jelenia w chwili konca
 *   strzalu i jelen pada. Mysliwy niesie go na karku i wiesza na stojaku przy chacie, z miesem idzie na flage.
 * Rolnik: zniwa - kosi rzad za rzedem zamaszystym lukiem (slomki w powietrzu, zostaje sciernisko i pokosy),
 *   zgarnia pokosy, wiaze snop i niesie go na ramieniu; siew - chodzi po zaoranym polu i rozrzuca ziarno
 *   z worka szerokim ruchem.
 * Jelen: chodzi, pasie sie, czujnie podnosi leb przy mysliwym; trafiony pada na bok ze strzala w boku.
 */
import * as THREE from 'three';
import { B, BUILDINGS, G, O, RES, S, TICKS_PER_SECOND, isStone } from '../../../sim/defs.ts';
import { DRESS_TICKS, HANG_TICKS, PREP_TICKS, WS } from '../../../sim/production.ts';
import { SS } from '../../../sim/serfs.ts';
import type { Animal, Building, Serf } from '../../../sim/types.ts';
import { objectSpot, treeLook } from '../mapObjects.ts';
import { HAND, SHOULDER, UNIT_SCALE, type Pose, type RigFrames } from '../rig.ts';
import type { Origin, Scenes, SerfAt, Vec3, WorkCtx } from './types.ts';

// ---------------------------------------------------------------- stale

/** Czasy pracy w terenie (ticki) - jak workTime() w sim/production.ts. */
const PLANT_TICKS = 60 - PREP_TICKS;
const BREAK_TICKS = BUILDINGS[B.STONECUTTER].cycle - DRESS_TICKS;
const FISH_TICKS = BUILDINGS[B.FISHER].cycle;
const SHOOT_TICKS = 20;
const FARM_TICKS = BUILDINGS[B.FARM].cycle;
/** Sekundy czasu animacji na tick. */
const TICK_S = 1 / TICKS_PER_SECOND;

/*
 * Stanowiska przed chatami (rekwizyty fld_seedbed, fld_table, fld_netrack, fld_rack z art/scripts/props_field.py):
 * srodek (x, y) w ukladzie modelu budynku (lx w prawo, ly w glab, front na -Y). Stoja na wysokosci terenu
 * w swoim srodku - teren przed budynkiem bywa wyzszy niz pole budynku. Wymiary w jednostkach modelu budynku.
 */
/**
 * Grzadka sadzonek przed lesniczowka z lewej od wejscia: miejsca (kolumny i rzedy wzgledem srodka grzadki),
 * wierzch ziemi. Lesnik kleka za grzadka (standY, miedzy grzadka a chata) twarza ku fladze; dochodzi tam przez
 * punkt pass przy prawym koncu grzadki.
 */
const SEEDBED = { x: -0.2, y: -0.365, cols: [-0.065, -0.02, 0.025, 0.07], rows: [-0.025, 0.025], top: 0.035, standY: -0.262, passX: -0.07, passY: -0.268 };
/** Kamienny stol przed chata kamieniarza: miejsce bloku na plycie, wierzch plyty, miejsce kamieniarza z prawej, kilof oparty z lewej. */
const STONE_TABLE = { x: 0.27, y: -0.33, blockX: 0.02, top: 0.082, standX: 0.39, standY: -0.33, pickX: 0.19, pickY: -0.37 };
/** Zerdz z siecia przed chata rybaka: wysokosc zerdzi, siec i suszone ryby przed nia (y), miejsca ryb wzdluz zerdzi. */
const NET_BAR = { x: -0.3, y: -0.32, z: 0.148, netY: -0.016, fishY: -0.03, fish: [-0.11, -0.04, 0.03, 0.1] };
/** Stojak na zdobycz przed chata mysliwego: wysokosc poprzeczki, miejsce mysliwego z prawej. */
const GAME_RACK = { x: -0.35, y: -0.26, bar: 0.3, standX: -0.21, standY: -0.31 };

/** Rzedy dojrzalego pola (jak art/scripts/nature.py: field_ripe): przesuniecie w x, dlugosc wzdluz z, liczba zamachow kosa. */
const ROWS: readonly { x: number; len: number; swings: number }[] = [
  { x: -0.25, len: 0.42, swings: 4 }, { x: 0, len: 0.64, swings: 6 }, { x: 0.25, len: 0.42, swings: 4 },
];
/** Etapy zniw (czesc WORKING): koszenie rzedow i przejscia miedzy nimi, zgarnianie, wiazanie, podnoszenie snopa. */
const MOW = [[0, 0.2], [0.24, 0.48], [0.52, 0.7]] as const;
const GATHER = 0.7, BIND = 0.8, LIFT = 0.88;

/** Wielkosc sadzonki O.SAPLING1 w rendererze obiektow (skala modelu drzewa). */
const SAPLING_S = 0.15;
/** Pelna wielkosc sadzonki na grzadce. */
const SEEDLING_S = 0.1;
/** Grzadka: miejsce po wyjetej sadzonce stoi puste, potem nowa rosnie (s). */
const BED_EMPTY_S = 10;
const BED_GROW_S = 45;
/** Upolowany jelen wisi na stojaku tyle sekund po powieszeniu. */
const HANG_SHOW_S = 45;
/** Skoszone pole (sciernisko) zostaje jeszcze chwile po zniwach (s). */
const STUBBLE_S = 14;

const SOIL = 0x6b4a2e;
const SOIL_DARK = 0x3b2a1a;
const ROOTBALL = 0x9a7a52;
const DUST = 0xb8a88a;
const STONE_CHIP = 0xb9b5ad;
const WATER_DROP = 0xd8ecf6;
const STRAW = 0xe3c25a;
const SEED = 0xd9c78f;
const FUR = 0xa8703f;
const LINE = 0xf4f4f0;
const STRING = 0xe8e0c8;

// Pomocnicze macierze i wektory (bez alokacji w klatce).
const mA = new THREE.Matrix4();
/** Czynnik chwilowy w lancuchach mnozenia (makeTranslation/Rotation/Scale) - nigdy nie jest wejsciem pomocnikow. */
const mT = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mC = new THREE.Matrix4();
const mBow = new THREE.Matrix4();
const mDeer = new THREE.Matrix4();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vD = new THREE.Vector3();
const ax = new THREE.Vector3();
const ay = new THREE.Vector3();
const az = new THREE.Vector3();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const w1: Vec3 = { x: 0, y: 0, z: 0 };
const w2: Vec3 = { x: 0, y: 0, z: 0 };
const w3: Vec3 = { x: 0, y: 0, z: 0 };
const w4: Vec3 = { x: 0, y: 0, z: 0 };
const w5: Vec3 = { x: 0, y: 0, z: 0 };
/** Lamane krotkich marszow przy chacie (punkty ustawia scena): flaga -> przejscie -> miejsce, flaga -> miejsce i z powrotem. */
const PATH_OUT: readonly Vec3[] = [w5, w3, w2];
const PATH_BACK: readonly Vec3[] = [w2, w3, w5];
const PATH_TO: readonly Vec3[] = [w3, w2];
const PATH_FROM: readonly Vec3[] = [w2, w3];

// ---------------------------------------------------------------- pomocnicze

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Postep odcinka [a, b] etapu (0..1). */
const span = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Gora-dol w odcinku [a, b] (0 na koncach, 1 w srodku) - krotki ruch tam i z powrotem. */
const bump = (p: number, a: number, b: number): number => Math.sin(span(p, a, b) * Math.PI);

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(b + 0x6d2b79f5, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Punkt (x, y, z) w ukladzie `frame` (staw postaci, rekwizyt) w swiecie. */
function pt(frame: THREE.Matrix4, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, y, z).applyMatrix4(frame);
}

/** Macierz rekwizytu w punkcie p, z osia +z modelu wzdluz kierunku d (strzala, ryba), w skali s. */
function aimAlong(out: THREE.Matrix4, px: number, py: number, pz: number, dx: number, dy: number, dz: number, s: number): THREE.Matrix4 {
  az.set(dx, dy, dz);
  if (az.lengthSq() < 1e-10) az.set(0, 0, 1);
  az.normalize();
  ax.crossVectors(UP, az);
  if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0);
  ax.normalize();
  ay.crossVectors(az, ax);
  return out.makeBasis(ax.multiplyScalar(s), ay.multiplyScalar(s), az.multiplyScalar(s)).setPosition(px, py, pz);
}

/** Cienki odcinek (zylka, cieciwa) z punktu a do b, grubosc t (swiat). */
function line(c: WorkCtx, a: THREE.Vector3, b: THREE.Vector3, t: number, color: number): void {
  ay.subVectors(b, a);
  const len = ay.length();
  if (len < 1e-4) return;
  ay.multiplyScalar(1 / len);
  ax.set(0, 0, 1).cross(ay);
  if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
  ax.normalize();
  az.crossVectors(ax, ay);
  mA.makeBasis(ax.multiplyScalar(t), ay.multiplyScalar(len), az.multiplyScalar(t)).setPosition(a.x, a.y, a.z);
  c.propM('fld_line', mA, color);
}

/** Interpolacja polozenia i obrotu dwoch macierzy (przenoszenie rekwizytu z miejsca na miejsce). */
function blendM(out: THREE.Matrix4, a: THREE.Matrix4, b: THREE.Matrix4, k: number): THREE.Matrix4 {
  a.decompose(pA, qA, sA);
  b.decompose(pB, qB, sB);
  pA.lerp(pB, k);
  qA.slerp(qB, k);
  sA.lerp(sB, k);
  return out.compose(pA, qA, sA);
}

/** Wektor "w prawo" postaci zwroconej o rot (strona prawej reki). */
function rightX(rot: number): number {
  return Math.cos(rot);
}
function rightZ(rot: number): number {
  return -Math.sin(rot);
}

/** Krotki marsz po lamanej (punkty w kolejnosci) dla postepu k: polozenie, kierunek i sinus fazy krokow. */
interface Stroll { x: number; y: number; z: number; rot: number; legs: number }
const stroll: Stroll = { x: 0, y: 0, z: 0, rot: 0, legs: 0 };
function walkPath(c: WorkCtx, pts: readonly Vec3[], k: number): Stroll {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  let d = clamp01(k) * total;
  const walked = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= len || i === pts.length - 1) {
      const t = len > 1e-6 ? clamp01(d / len) : 1;
      stroll.x = lerp(a.x, b.x, t);
      stroll.z = lerp(a.z, b.z, t);
      stroll.y = c.ground(stroll.x, stroll.z);
      stroll.rot = len > 1e-6 ? c.facing(a.x, a.z, b.x, b.z) : stroll.rot;
      break;
    }
    d -= len;
  }
  // Pelny cykl krokow (lewa i prawa noga) na 0.32 jednostki drogi; nogi stoja, gdy postac stoi.
  stroll.legs = k > 0 && k < 1 ? Math.sin((walked / 0.32) * Math.PI * 2) : 0;
  return stroll;
}

/** Poza marszu: nogi (i rece) w rytm krokow; phase - sinus fazy chodu (-1..1). */
function walkLegs(pose: Pose, phase: number, arms = true): Pose {
  pose.legL = phase * 0.6;
  pose.legR = -phase * 0.6;
  if (arms) {
    pose.armL = -phase * 0.5;
    pose.armR = phase * 0.5;
  }
  return pose;
}

/** Nowa poza osadnika w punkcie (bez towaru). */
function poseAt(serf: Serf, x: number, y: number, z: number, rot: number): Pose {
  return { x, y, z, rot, owner: serf.owner, type: serf.type, carry: -1 };
}

/**
 * Ostatnie miejsce pracy osadnika: dojscie do celu konczy sie w nim (nie w srodku pola), a pierwszy krok
 * powrotu z niego sie zaczyna - bez przeskoku postaci.
 */
interface Spot { cell: number; x: number; y: number; z: number }
const workSpots = new Map<number, Spot>();
function setSpot(serf: Serf, x: number, y: number, z: number): void {
  let sp = workSpots.get(serf.id);
  if (!sp) {
    sp = { cell: 0, x: 0, y: 0, z: 0 };
    workSpots.set(serf.id, sp);
  }
  sp.cell = serf.pos;
  sp.x = x;
  sp.y = y;
  sp.z = z;
}

/** Przeszkoda na polu pracy (skala): krok z miejsca pracy i do niego obchodzi ja po okregu (r - najmniejszy promien). */
interface Obstacle { x: number; z: number; r: number }

/**
 * Krok z punktu s (miejsce pracy) do punktu e dla postepu t: wprost albo - gdy jest przeszkoda - najpierw
 * po okregu wokol niej (s lezy na okregu), potem prosto do e. Wynik w `at` (polozenie i kierunek marszu).
 */
function stepFrom(c: WorkCtx, at: SerfAt, sx: number, sz: number, ex: number, ez: number, t: number, ob: Obstacle | null): void {
  if (!ob) {
    at.x = lerp(sx, ex, t);
    at.z = lerp(sz, ez, t);
    at.rot = c.facing(sx, sz, ex, ez);
  } else {
    // Promien okregu: odleglosc miejsca pracy od srodka przeszkody (skala mogla sie juz zmniejszyc).
    const r = Math.max(ob.r * 0.5, Math.hypot(sx - ob.x, sz - ob.z));
    const a0 = Math.atan2(sx - ob.x, sz - ob.z);
    let da = Math.atan2(ex - ob.x, ez - ob.z) - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a1 = a0 + da;
    const qx = ob.x + Math.sin(a1) * r, qz = ob.z + Math.cos(a1) * r;
    const la = Math.abs(da) * r, ls = Math.hypot(ex - qx, ez - qz);
    const d = t * (la + ls);
    if (d < la) {
      const a = a0 + da * (d / la);
      at.x = ob.x + Math.sin(a) * r;
      at.z = ob.z + Math.cos(a) * r;
      at.rot = a + (da > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else {
      const k = ls > 1e-6 ? (d - la) / ls : 1;
      at.x = lerp(qx, ex, k);
      at.z = lerp(qz, ez, k);
      at.rot = c.facing(qx, qz, ex, ez);
    }
  }
  at.y = c.ground(at.x, at.z);
}

/**
 * Wygladza ostatni krok dojscia (konczy sie w `stand`, nie w srodku pola celu) i pierwszy krok powrotu
 * (zaczyna sie w zapamietanym miejscu pracy); przeszkode `ob` na polu celu obchodzi.
 */
function smoothSteps(c: WorkCtx, serf: Serf, at: SerfAt, stand: Vec3 | null, ob: Obstacle | null = null): void {
  if (!at.moving) return;
  if (stand && serf.sub === WS.TO_TARGET && serf.path.length === 0 && at.to === serf.target) {
    // Dojscie liczone wstecz: z miejsca pracy do pola, z ktorego przychodzi.
    const a = c.cell(at.from, w4);
    stepFrom(c, at, stand.x, stand.z, a.x, a.z, 1 - at.t, ob);
    at.rot += Math.PI;
    return;
  }
  const sp = workSpots.get(serf.id);
  if (!sp || serf.sub !== WS.RETURN) return;
  if (at.from !== sp.cell) {
    workSpots.delete(serf.id);
    return;
  }
  const b = c.cell(at.to, w4);
  stepFrom(c, at, sp.x, sp.z, b.x, b.z, at.t, ob);
}

/**
 * Narzedzie (model z poczatkiem w barku) wbite w ziemie w punkcie (x, z): obrot rot wokol pionu, pochylenie
 * `tilt` wokol osi X (ustawia trzonek pionowo) i punkt narzedzia (ty, tz - uklad modelu w grze) wbity w ziemie.
 */
function stuckTool(c: WorkCtx, name: string, x: number, z: number, rot: number, tilt: number, ty: number, tz: number): void {
  const cs = Math.cos(tilt), sn = Math.sin(tilt);
  const py = ty * cs - tz * sn, pz = ty * sn + tz * cs;
  mA.makeTranslation(x, c.ground(x, z) - 0.02, z).multiply(mT.makeRotationY(rot)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE))
    .multiply(mT.makeTranslation(0, -py, -pz)).multiply(mT.makeRotationX(tilt));
  c.propM(name, mA);
}

/** Wysokosc terenu w srodku stanowiska (lx, ly) przed budynkiem. */
function stationY(c: WorkCtx, o: Origin, lx: number, ly: number): number {
  const p = c.at(o, lx, ly, 0, w4);
  return c.ground(p.x, p.z);
}

/** Uklad stanowiska (lx, ly) przed budynkiem: osie i skala budynku, poczatek na terenie w srodku stanowiska. */
function stationFrame(c: WorkCtx, o: Origin, lx: number, ly: number, out: THREE.Matrix4): THREE.Matrix4 {
  const p = c.at(o, lx, ly, 0, w4);
  return out.makeTranslation(p.x, c.ground(p.x, p.z), p.z).multiply(mT.makeRotationY(c.frontRot)).multiply(mT.makeScale(o.sc, o.sc, o.sc));
}

// ---------------------------------------------------------------- lesnik

/** Stan grzadki przy lesniczowce (po stronie klienta): kiedy wyjeto sadzonke z kazdego miejsca, wybrane miejsce. */
interface Bed { since: number[]; slot: number; choosing: boolean }
const beds = new Map<number, Bed>();

function bedOf(c: WorkCtx, b: Building): Bed {
  let bed = beds.get(b.id);
  if (!bed) {
    // Na poczatek grzadka jest gesta, ale nierowna: sadzonki w roznym wieku, czasem puste miejsce.
    const since: number[] = [];
    for (let k = 0; k < 8; k++) since.push(c.time - (BED_EMPTY_S + BED_GROW_S) * (0.2 + 1.4 * hash(b.id, k)));
    bed = { since, slot: -1, choosing: false };
    beds.set(b.id, bed);
  }
  return bed;
}

/** Wzrost sadzonki na miejscu k grzadki 0..1 (0 - puste). */
function growth(c: WorkCtx, bed: Bed, k: number): number {
  return clamp01((c.time - bed.since[k] - BED_EMPTY_S) / BED_GROW_S);
}

function slotModel(b: Building, k: number): 'tree_pine' | 'tree_leaf' {
  return (k * 5 + b.id) % 3 === 0 ? 'tree_leaf' : 'tree_pine';
}

/** Miejsce grzadki, z ktorego lesnik bierze sadzonke: najwieksza tego gatunku, ktory posadzi (albo jakakolwiek). */
function pickSlot(c: WorkCtx, bed: Bed, b: Building, model: string): number {
  let best = -1, bestG = 0.25;
  for (let k = 0; k < 8; k++) {
    const g = growth(c, bed, k) + (slotModel(b, k).startsWith('tree_leaf') === model.startsWith('tree_leaf') ? 1 : 0);
    if (g > bestG) { bestG = g; best = k; }
  }
  return best < 0 ? 0 : best;
}

/** Sadzonka z bryla korzeni w lewej dloni (pionowo mimo wymachu reki armL). */
function saplingInHand(c: WorkCtx, f: RigFrames, model: string, armL: number): void {
  if (!c.details) return;
  c.propAt(model, f.armL, 0, HAND + 0.005, 0.012, -armL, 0, 0, SAPLING_S / UNIT_SCALE);
  c.propAt('fx_puff', f.armL, 0, HAND - 0.015, 0.012, 0, 0, 0, 0.05, ROOTBALL);
}

/** Lesniczowka: grzadka z sadzonkami (puste miejsca po wyjetych, mlode odrastaja). */
function foresterHut(c: WorkCtx, b: Building, o: Origin): void {
  const gy = stationY(c, o, SEEDBED.x, SEEDBED.y);
  const bc = c.at(o, SEEDBED.x, SEEDBED.y, 0, w1);
  c.prop('fld_seedbed', bc.x, gy, bc.z, c.frontRot, o.sc);
  if (!c.details) return;
  const bed = bedOf(c, b);
  for (let k = 0; k < 8; k++) {
    const g = growth(c, bed, k);
    if (g <= 0) continue;
    const p = c.at(o, SEEDBED.x + SEEDBED.cols[k % 4] + (hash(b.id, k + 9) - 0.5) * 0.012, SEEDBED.y + SEEDBED.rows[k >> 2], 0, w1);
    c.prop(slotModel(b, k), p.x, gy + SEEDBED.top * o.sc, p.z, hash(b.id, k + 20) * 6.28, SEEDLING_S * (0.3 + 0.7 * g));
  }
}

/** PREP: lesnik idzie z flagi za grzadke, kleka, wyciaga sadzonke i wraca z nia na flage. */
function foresterPrep(c: WorkCtx, serf: Serf, at: SerfAt): void {
  const b = c.s.buildings[serf.home];
  if (!b || at.moving || serf.target < 0) {
    c.figure(c.walkPose(serf, at));
    return;
  }
  const o = c.origin(b);
  const bed = bedOf(c, b);
  const p = c.progress(serf.timer, PREP_TICKS);
  const model = treeLook(c.s.map, serf.target).model;
  const PULL = 0.5;
  // Wybor miejsca przed wyjeciem, wyjecie w chwili PULL (miejsce pustoszeje, sadzonka jest w dloni).
  if (p < PULL) {
    if (!bed.choosing) {
      bed.slot = pickSlot(c, bed, b, model);
      bed.choosing = true;
    }
  } else if (bed.choosing) {
    bed.since[bed.slot] = c.time;
    bed.choosing = false;
  }
  const slot = Math.max(0, bed.slot);
  const sx = SEEDBED.x + SEEDBED.cols[slot % 4], sy = SEEDBED.y + SEEDBED.rows[slot >> 2];
  const seed = c.at(o, sx, sy, 0, w1);
  seed.y = stationY(c, o, SEEDBED.x, SEEDBED.y) + SEEDBED.top * o.sc;
  const stand = c.at(o, sx, SEEDBED.standY, 0, w2);
  c.at(o, SEEDBED.passX, SEEDBED.passY, 0, w3);
  stand.y = c.ground(stand.x, stand.z);
  w5.x = at.x;
  w5.y = at.y;
  w5.z = at.z;
  let pose: Pose;
  if (p < 0.3 || p > 0.68) {
    const out = p < 0.3;
    const st = out ? walkPath(c, PATH_OUT, p / 0.3) : walkPath(c, PATH_BACK, (p - 0.68) / 0.32);
    pose = walkLegs(poseAt(serf, st.x, st.y, st.z, st.rot), st.legs);
    if (!out) pose.armL = -0.45;
  } else {
    // Przyklek za grzadka: lewa reka siega do sadzonki i wyciaga ja.
    const kk = smooth(span(p, 0.3, 0.4)) * (1 - smooth(span(p, 0.6, 0.68)));
    const pull = bump(p, 0.44, 0.58);
    pose = poseAt(serf, stand.x, stand.y, stand.z, c.facing(stand.x, stand.z, seed.x, seed.z));
    pose.crouch = 0.075 * kk;
    pose.lean = 0.5 * kk - pull * 0.15;
    pose.head = 0.35 * kk;
    pose.armL = -0.25 - 0.85 * kk + pull * 0.35;
    pose.armR = -0.25 * kk;
    pose.armLYaw = 0.2 * kk;
    const age = (p - PULL) * PREP_TICKS * TICK_S;
    c.fx.burst(serf.id * 17 + 3, age, seed.x, seed.y + 0.01, seed.z,
      { kind: 'bit', n: 5, life: 0.5, vy: 0.45, spread: 0.25, gravity: 2.4, size: 0.014, sizeEnd: 0.01, color: SOIL, floor: stationY(c, o, SEEDBED.x, SEEDBED.y) + 0.012, sound: 'dirt', soundGain: 0.6 });
  }
  const f = c.figure(pose);
  if (p >= PULL) saplingInHand(c, f, model, pose.armL ?? 0);
}

/** Miejsce sadzenia: dokladnie tam pojawi sie sadzonka O.SAPLING1 (jak w rendererze obiektow). */
function plantStand(c: WorkCtx, cell: number): Vec3 & { rot: number } {
  const look = treeLook(c.s.map, cell);
  return c.beside(look.x, look.z, 0.15, 0.9);
}

/**
 * WORKING: odlozenie sadzonki, kopanie dolka (trzy sztychy: wbicie, docisniecie stopa, podwazenie, rzut ziemi
 * na kopczyk), przyklek i wlozenie sadzonki, zgarniecie ziemi rekami, udeptanie, chwila przygladania sie.
 */
function planting(c: WorkCtx, serf: Serf): void {
  const look = treeLook(c.s.map, serf.target);
  const st = plantStand(c, serf.target);
  setSpot(serf, st.x, st.y, st.z);
  const p = c.progress(serf.timer, PLANT_TICKS);
  const rot = st.rot;
  const fx = Math.sin(rot), fz = Math.cos(rot), rx = rightX(rot), rz = rightZ(rot);
  const gy = c.ground(look.x, look.z);
  // Sadzonka czeka za lesnikiem, kopczyk rosnie obok dolka od strony kamery (side: +1 - kamera po prawej lesnika),
  // lopata stoi wbita po drugiej stronie - nic nie zaslania dolka.
  const side = Math.sin(c.toCamera - rot) > 0 ? 1 : -1;
  const putX = st.x - fx * 0.1 + rx * side * 0.05, putZ = st.z - fz * 0.1 + rz * side * 0.05;
  const moundX = look.x + rx * side * 0.08 + fx * 0.03, moundZ = look.z + rz * side * 0.08 + fz * 0.03;
  const moundY = c.ground(moundX, moundZ);
  const dig = span(p, 0.08, 0.52);
  const fill = span(p, 0.66, 0.78);
  const pose = poseAt(serf, st.x, st.y, st.z, rot);
  pose.legL = -0.2;
  pose.legR = 0.2;
  let clump = false;
  let throwAge = -1;
  let shovelInHand = true;
  if (p < 0.08) {
    // Odklada sadzonke na ziemie za soba.
    const k = bump(p, 0, 0.08);
    pose.lean = 0.35 * k;
    pose.armL = 0.55 * k;
    pose.armLYaw = side * 0.3 * k;
    pose.armR = -0.3;
  } else if (p < 0.52) {
    // Trzy sztychy lopata.
    const u = dig * 3;
    const f = u - Math.floor(u);
    let armR: number, lean: number, twist = 0, yaw = 0;
    if (f < 0.25) {
      const k = smooth(f / 0.25);
      armR = lerp(-1.05, -0.3, k);
      lean = lerp(0.15, 0.45, k);
    } else if (f < 0.4) {
      const k = (f - 0.25) / 0.15;
      armR = -0.3;
      lean = 0.45;
      pose.legR = 0.2 - Math.sin(k * Math.PI) * 0.6;
      pose.bob = -Math.sin(k * Math.PI) * 0.006;
    } else if (f < 0.65) {
      const k = smooth((f - 0.4) / 0.25);
      armR = lerp(-0.3, -1.15, k);
      lean = lerp(0.45, 0.18, k);
      clump = true;
    } else if (f < 0.82) {
      const k = smooth((f - 0.65) / 0.17);
      armR = -1.15 + k * 0.15;
      lean = 0.18;
      twist = side * 0.75 * k;
      yaw = side * 0.5 * k;
      clump = f < 0.75;
    } else {
      const k = smooth((f - 0.82) / 0.18);
      armR = lerp(-1.0, -1.05, k);
      lean = 0.18 - 0.03 * k;
      twist = side * 0.75 * (1 - k);
      yaw = side * 0.5 * (1 - k);
    }
    pose.armR = armR;
    pose.armL = armR - 0.35;
    pose.armRYaw = yaw;
    pose.armLYaw = 0.45 + yaw;
    pose.lean = lean;
    pose.twist = twist;
    throwAge = (f - 0.75) * (0.44 * PLANT_TICKS * TICK_S) / 3;
  } else if (p < 0.8) {
    // Lopata wbita obok; lesnik bierze sadzonke, przyklekuje, wklada ja do dolka i zgarnia ziemie.
    shovelInHand = false;
    const kneel = smooth(span(p, 0.53, 0.6)) * (1 - smooth(span(p, 0.77, 0.81)));
    pose.crouch = 0.08 * kneel;
    pose.lean = 0.35 + 0.25 * kneel;
    pose.head = 0.3;
    if (p < 0.58) {
      // Siega po sadzonke za soba.
      const k = bump(p, 0.52, 0.58);
      pose.armL = 0.55 * k;
      pose.armLYaw = side * 0.3 * k;
      pose.armR = -0.2;
    } else if (p < 0.66) {
      pose.armL = -0.9;
      pose.armLYaw = 0.35;
      pose.armR = -0.6;
    } else {
      const s = Math.sin(fill * Math.PI * 6);
      pose.armL = -0.95 + s * 0.3;
      pose.armR = -0.95 - s * 0.3;
      pose.armLYaw = 0.3;
      pose.armRYaw = -0.2;
    }
  } else if (p < 0.94) {
    // Udeptywanie: na zmiane lewa i prawa stopa, przy kazdym tupnieciu pyl.
    const u = span(p, 0.8, 0.94) * 4;
    const ph = u * Math.PI;
    pose.legL = -0.55 * Math.max(0, Math.sin(ph));
    pose.legR = -0.55 * Math.max(0, -Math.sin(ph));
    pose.bob = -Math.abs(Math.sin(ph)) * 0.004;
    pose.lean = 0.2;
    pose.head = 0.35;
    pose.armR = -0.35;
    pose.armL = 0.15 * Math.sin(ph);
    const n = Math.floor(u);
    const age = (u - n) * (0.14 * PLANT_TICKS * TICK_S) / 4;
    c.fx.burst(serf.id * 23 + n, age - 0.12, look.x + (n % 2 ? rx : -rx) * 0.04, gy + 0.01, look.z + (n % 2 ? rz : -rz) * 0.04,
      { kind: 'puff', n: 3, life: 0.5, vy: 0.12, spread: 0.12, gravity: 0.1, size: 0.03, sizeEnd: 0.05, color: DUST, fade: 0.5, sound: 'shovel' });
  } else {
    // Przyglada sie sadzonce, oparty o lopate.
    pose.head = 0.4;
    pose.armR = -0.45;
    pose.armL = -0.1;
  }
  if (!shovelInHand) pose.tool = null;
  const f = c.figure(pose);
  // Lopata wbita w ziemie obok, gdy lesnik ma zajete rece.
  if (!shovelInHand && c.details) stuckTool(c, 'tool_shovel', st.x - rx * side * 0.1 - fx * 0.02, st.z - rz * side * 0.1 - fz * 0.02, rot + 0.4, 1.18, HAND - 0.09, 0.18);
  // Grudka ziemi na lopacie i rzut na kopczyk.
  if (clump && c.details) c.propAt('fx_puff', f.armR, 0, HAND - 0.085, 0.18, 0, 0, 0, 0.04, SOIL);
  if (throwAge > -0.5) {
    pt(f.armR, 0, HAND - 0.085, 0.18, vA);
    c.fx.burst(serf.id * 29 + Math.floor(dig * 3), throwAge, vA.x, vA.y, vA.z,
      { kind: 'bit', n: 8, life: 0.45, vx: (moundX - vA.x) / 0.4, vz: (moundZ - vA.z) / 0.4, vy: 0.55, spread: 0.1, gravity: 3.2,
        size: 0.026, sizeEnd: 0.02, color: SOIL, floor: moundY + 0.005, sound: 'dirt' });
  }
  // Dolek i kopczyk ziemi.
  const hole = smooth(dig) * (1 - smooth(fill));
  if (hole > 0.02) c.prop('fx_puff', look.x, gy + 0.002, look.z, 0, 0.12 * hole, 0.012, SOIL_DARK);
  const mound = dig > 0 ? Math.min(1, dig * 1.4) * (1 - 0.75 * fill) * (1 - span(p, 0.8, 0.94)) : 0;
  if (mound > 0.02) c.prop('fx_puff', moundX, moundY, moundZ, rot, 0.13 * Math.sqrt(mound), 0.06 * mound, SOIL);
  // Sadzonka: odlozona za lesnikiem, w dloni, potem w dolku (tam, gdzie pojawi sie na mapie).
  if (p < 0.04) {
    saplingInHand(c, f, look.model, pose.armL ?? 0);
  } else if (p < 0.55) {
    const py = c.ground(putX, putZ);
    c.prop(look.model, putX, py + 0.015, putZ, look.rot, SAPLING_S);
    c.prop('fx_puff', putX, py + 0.012, putZ, 0, 0.045, 0.04, ROOTBALL);
  } else if (p < 0.62) {
    saplingInHand(c, f, look.model, pose.armL ?? 0);
  } else {
    const k = smooth(span(p, 0.62, 0.66));
    pt(f.armL, 0, HAND, 0.012, vA);
    const sxp = lerp(vA.x, look.x, k), syp = lerp(vA.y, gy, k), szp = lerp(vA.z, look.z, k);
    c.prop(look.model, sxp, syp, szp, look.rot, SAPLING_S);
    if (fill < 0.6) c.prop('fx_puff', sxp, syp, szp, 0, 0.045, 0.04, ROOTBALL);
    if (fill > 0 && fill < 1) {
      const n = Math.floor(fill * 6);
      c.fx.burst(serf.id * 31 + n, (fill * 6 - n) * 0.25, look.x, gy + 0.01, look.z,
        { kind: 'bit', n: 3, life: 0.35, vy: 0.3, spread: 0.2, gravity: 2.5, size: 0.014, color: SOIL, floor: gy + 0.005, sound: 'dirt', soundGain: 0.5 });
    }
  }
}

function forester(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.PREP) {
    foresterPrep(c, serf, at);
    return true;
  }
  if (serf.sub === WS.WORKING && serf.target >= 0 && !at.moving) {
    planting(c, serf);
    return true;
  }
  smoothSteps(c, serf, at, serf.sub === WS.TO_TARGET && serf.target >= 0 ? plantStand(c, serf.target) : null);
  const pose = c.walkPose(serf, at);
  if (serf.sub === WS.TO_TARGET && serf.target >= 0) {
    // Z sadzonka niesiona przed soba w lewej dloni, lopata w prawej.
    pose.armL = -0.85;
    pose.armLYaw = 0.25;
    const f = c.figure(pose);
    saplingInHand(c, f, treeLook(c.s.map, serf.target).model, -0.85);
    return true;
  }
  c.figure(pose);
  return true;
}

// ---------------------------------------------------------------- kamieniarz

/**
 * Skala na polu: polozenie jak w rendererze obiektow (objectSpot), skala modelu `stone` wg liczby jednostek
 * kamienia i promien jego glownej bryly.
 */
const rockInfo = { x: 0, y: 0, z: 0, r: 0, s: 0 };
const obstacle: Obstacle = { x: 0, z: 0, r: 0 };
function rockOf(c: WorkCtx, cell: number): typeof rockInfo {
  const look = objectSpot(c.s.map, cell);
  const o = c.s.map.obj[cell];
  rockInfo.s = isStone(o) ? 0.55 + (o - O.STONE1) * 0.12 : 0.55;
  rockInfo.x = look.x;
  rockInfo.y = look.y;
  rockInfo.z = look.z;
  rockInfo.r = 0.26 * rockInfo.s;
  return rockInfo;
}

function rockStand(c: WorkCtx, cell: number): Vec3 & { rot: number } {
  const r = rockOf(c, cell);
  return c.beside(r.x, r.z, r.r + 0.1, 0.8);
}

/** Blok kamienia (kostka good_11 z naroslami fld_lumps zmniejszonymi do k) w ukladzie m (podstawa bloku). */
function roughBlock(c: WorkCtx, m: THREE.Matrix4, k: number): void {
  c.goodAt(G.STONE, m, 0, 0, 0);
  if (k <= 0.5) return;
  mC.copy(m).multiply(mT.makeTranslation(0, 0.035, 0)).multiply(mT.makeScale(k, k, k)).multiply(mT.makeTranslation(0, -0.035, 0));
  c.propM('fld_lumps', mC);
}

/** Uklad bloku niesionego na prawym ramieniu (w ukladzie tulowia - pochyla sie z postacia). */
function shoulderBlock(out: THREE.Matrix4, f: RigFrames): THREE.Matrix4 {
  return out.copy(f.torso).multiply(mT.makeTranslation(0.118, SHOULDER + 0.01, -0.012)).multiply(mT.makeRotationY(0.35));
}

/**
 * WORKING przy skale: dziewiec uderzen kilofem z odpryskami (co trzecie z kurzem), potem najmocniejszy zamach
 * odlamuje blok, ktory spada przed kamieniarza; kamieniarz odklada kilof do lewej reki, schyla sie i bierze
 * blok na ramie.
 */
function breaking(c: WorkCtx, serf: Serf): void {
  const rock = rockOf(c, serf.target);
  const st = c.beside(rock.x, rock.z, rock.r + 0.1, 0.8);
  setSpot(serf, st.x, st.y, st.z);
  const p = c.progress(serf.timer, BREAK_TICKS);
  const rot = st.rot;
  const fx = Math.sin(rot), fz = Math.cos(rot), rx = rightX(rot), rz = rightZ(rot);
  // Miejsce uderzen: sciana skaly od strony kamieniarza.
  const hitX = rock.x - fx * rock.r * 0.75, hitZ = rock.z - fz * rock.r * 0.75, hitY = rock.y + 0.1 * rock.s + 0.03;
  const blockX = st.x + fx * 0.1 + rx * 0.05, blockZ = st.z + fz * 0.1 + rz * 0.05;
  const blockY = c.ground(blockX, blockZ);
  const N = 9, T0 = 0.02, T1 = 0.74, BREAK = 0.765, LAND = 0.8;
  const secPer = ((T1 - T0) * BREAK_TICKS * TICK_S) / N;
  const pose = poseAt(serf, st.x, st.y, st.z, rot);
  pose.legL = -0.3;
  pose.legR = 0.3;
  let carried = false;
  if (p < BREAK) {
    let up: number;
    if (p < T1) {
      const u = span(p, T0, T1) * N;
      const n = Math.floor(u), f = u - n;
      up = c.strike(f);
      const age = f * secPer;
      c.fx.burst(serf.id * 37 + n, age, hitX, hitY, hitZ,
        { kind: 'bit', n: 6, life: 0.55, vx: fx * -0.5, vz: fz * -0.5, vy: 0.65, spread: 0.38, gravity: 2.6, size: 0.022, sizeEnd: 0.016,
          color: n % 2 ? STONE_CHIP : 0x8d8a84, floor: rock.y + 0.008, sound: 'pick_stone' });
      if (n % 3 === 2) {
        c.fx.burst(serf.id * 41 + n, age, hitX, hitY, hitZ,
          { kind: 'puff', n: 4, life: 0.9, vx: fx * -0.08, vz: fz * -0.08, vy: 0.12, spread: 0.06, gravity: -0.02, size: 0.04, sizeEnd: 0.1,
            color: 0xcfcac0, colorEnd: 0xe2ded6, fade: 0.5 });
      }
    } else {
      // Ostatni, najmocniejszy zamach.
      const k = span(p, T1, BREAK);
      up = k < 0.75 ? smooth(k / 0.75) * 1.1 : 1.1 * (1 - smooth((k - 0.75) / 0.25));
    }
    // Zamach nad glowe z odchyleniem do tylu, uderzenie calym cialem (pochylenie i lekki przysiad).
    pose.armR = -0.75 - up * 2.15;
    pose.armL = pose.armR + 0.12;
    pose.armLYaw = 0.35;
    pose.lean = 0.5 - up * 0.58;
    pose.crouch = 0.025 * (1 - up);
    pose.head = 0.15;
  } else if (p < 0.86) {
    // Kilof do lewej reki, schylenie po blok.
    const k = smooth(span(p, LAND, 0.86));
    pose.tool = null;
    pose.toolL = 'tool_pick';
    pose.crouch = 0.06 * k;
    pose.lean = 0.25 + 0.5 * k;
    pose.armR = -0.4 - 0.4 * k;
    pose.armL = -0.2 - 0.4 * k;
    pose.head = 0.3;
  } else {
    // Podnosi blok i zarzuca na prawe ramie.
    const k = smooth(span(p, 0.86, 0.96));
    pose.tool = null;
    pose.toolL = 'tool_pick';
    pose.crouch = 0.06 * (1 - k);
    pose.lean = 0.75 * (1 - k);
    pose.armR = lerp(-0.8, -2.75, k);
    pose.armL = lerp(-0.6, -0.1, k);
    carried = k >= 1;
  }
  const f = c.figure(pose);
  // Blok: w scianie skaly, odlamany spada przed kamieniarza, lezy, podnoszony, na ramieniu.
  if (p >= BREAK) {
    if (carried) {
      roughBlock(c, shoulderBlock(mA, f), 1);
    } else if (p < LAND) {
      const k = span(p, BREAK, LAND);
      const x = lerp(hitX, blockX, k), z = lerp(hitZ, blockZ, k);
      const y = lerp(hitY - 0.03, blockY, k) + Math.sin(k * Math.PI) * 0.05;
      mA.makeTranslation(x, y, z).multiply(mT.makeRotationY(rot + k * 2)).multiply(mT.makeRotationX(k * 2.5)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
      roughBlock(c, mA, 1);
    } else {
      const k = p < 0.86 ? 0 : smooth(span(p, 0.86, 0.96));
      mB.makeTranslation(blockX, blockY, blockZ).multiply(mT.makeRotationY(rot + 2)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
      shoulderBlock(mDeer, f);
      blendM(mA, mB, mDeer, k);
      roughBlock(c, mA, 1);
    }
    const age = (p - LAND) * BREAK_TICKS * TICK_S;
    c.fx.burst(serf.id * 43, age, blockX, blockY + 0.02, blockZ,
      { kind: 'puff', n: 5, life: 0.8, vy: 0.1, spread: 0.12, gravity: 0.05, size: 0.04, sizeEnd: 0.09, color: 0xcfcac0, fade: 0.5, sound: 'drop_stone', soundGain: 1.3 });
    c.fx.burst(serf.id * 47, (p - BREAK) * BREAK_TICKS * TICK_S, hitX, hitY, hitZ,
      { kind: 'bit', n: 8, life: 0.6, vx: -fx * 0.6, vz: -fz * 0.6, vy: 0.7, spread: 0.4, gravity: 2.6, size: 0.02, sizeEnd: 0.014, color: STONE_CHIP, floor: rock.y + 0.008, sound: 'pick_stone', soundGain: 1.2 });
  }
}

/**
 * DRESS przy chacie: z flagi do kamiennego stolu, blok z ramienia na stol, osiem uderzen mlotkiem (narosla
 * maleja, az zostaje rowna kostka, leca odpryski), kostka w obie rece i na flage. Kilof oparty o stol.
 */
function dressing(c: WorkCtx, serf: Serf, at: SerfAt): void {
  const b = c.s.buildings[serf.home];
  if (!b) {
    c.figure(c.walkPose(serf, at));
    return;
  }
  const o = c.origin(b);
  const p = c.progress(serf.timer, DRESS_TICKS);
  const table = c.at(o, STONE_TABLE.x + STONE_TABLE.blockX, STONE_TABLE.y, 0, w1);
  table.y = stationY(c, o, STONE_TABLE.x, STONE_TABLE.y) + STONE_TABLE.top * o.sc;
  const stand = c.at(o, STONE_TABLE.standX, STONE_TABLE.standY, 0, w2);
  stand.y = c.ground(stand.x, stand.z);
  const flag = w3;
  flag.x = at.x;
  flag.y = at.y;
  flag.z = at.z;
  const toTable = c.facing(stand.x, stand.z, table.x, table.z);
  const N = 8, H0 = 0.25, H1 = 0.82;
  const hammer = span(p, H0, H1);
  const u = hammer * N;
  const n = Math.min(N - 1, Math.floor(u)), fBeat = u - n;
  // Narosla bloku maleja z kazdym uderzeniem (w chwili uderzenia), az schowaja sie w kostce.
  const lumps = 1 - 0.5 * ((p >= H1 ? N : n + (fBeat > 0.02 ? 1 : 0)) / N);
  let pose: Pose;
  let where: 'shoulder' | 'table' | 'hands' = 'table';
  let blendK = -1;
  if (p < 0.14) {
    const st = walkPath(c, PATH_TO, p / 0.14);
    pose = walkLegs(poseAt(serf, st.x, st.y, st.z, st.rot), st.legs);
    pose.armR = -2.75;
    pose.tool = null;
    pose.toolL = 'tool_pick';
    where = 'shoulder';
  } else if (p > 0.9) {
    const st = walkPath(c, PATH_FROM, (p - 0.9) / 0.1);
    pose = walkLegs(poseAt(serf, st.x, st.y, st.z, st.rot), st.legs, false);
    pose.armL = pose.armR = -1.0;
    pose.tool = null;
    where = 'hands';
  } else {
    pose = poseAt(serf, stand.x, stand.y, stand.z, toTable);
    pose.legL = -0.2;
    pose.legR = 0.2;
    pose.lean = 0.3;
    pose.head = 0.35;
    if (p < 0.25) {
      // Zdejmuje blok z ramienia na stol.
      const k = smooth(span(p, 0.14, 0.24));
      pose.armR = lerp(-2.75, -0.95, k);
      pose.armL = lerp(-0.1, -0.9, k);
      pose.tool = null;
      pose.lean = 0.3 * k;
      blendK = k;
      where = k < 1 ? 'shoulder' : 'table';
    } else if (p < H1) {
      const up = c.strike(fBeat);
      pose.tool = 'tool_hammer';
      pose.armR = -0.95 - up * 1.0;
      pose.armRYaw = -0.1;
      pose.armL = -0.95;
      pose.armLYaw = 0.25;
      pose.lean = 0.32 - up * 0.08;
      const secPer = ((H1 - H0) * DRESS_TICKS * TICK_S) / N;
      c.fx.burst(serf.id * 53 + n, fBeat * secPer, table.x, table.y + 0.06, table.z,
        { kind: 'bit', n: 5, life: 0.45, vy: 0.55, spread: 0.4, gravity: 2.8, size: 0.017, sizeEnd: 0.012, color: n % 2 ? STONE_CHIP : 0x9a968f, floor: stationY(c, o, STONE_TABLE.x, STONE_TABLE.y) + 0.006, sound: 'chisel' });
    } else {
      // Ogladanie kostki i branie jej w obie rece.
      const k = smooth(span(p, 0.84, 0.9));
      pose.tool = null;
      pose.armR = pose.armL = lerp(-0.85, -1.0, k);
      pose.armLYaw = 0.2 * (1 - k);
      pose.lean = 0.3 * (1 - k);
      pose.head = 0.35 - 0.2 * k;
      where = k > 0.5 ? 'hands' : 'table';
    }
  }
  const f = c.figure(pose);
  // Kilof oparty o stol podczas ociosywania.
  if (p >= 0.14 && p <= 0.9 && c.details) {
    const pk = c.at(o, STONE_TABLE.pickX, STONE_TABLE.pickY, 0, w4);
    stuckTool(c, 'tool_pick', pk.x, pk.z, c.frontRot + 0.8, 0.35, HAND - 0.14, 0.0);
  }
  mB.makeTranslation(table.x, table.y, table.z).multiply(mT.makeRotationY(c.frontRot + 0.15)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
  if (blendK >= 0 && blendK < 1) {
    shoulderBlock(mDeer, f);
    roughBlock(c, blendM(mA, mDeer, mB, blendK), 1);
  } else if (where === 'shoulder') {
    roughBlock(c, shoulderBlock(mA, f), 1);
  } else if (where === 'table') {
    roughBlock(c, mB, lumps);
  } else {
    mA.copy(f.torso).multiply(mT.makeTranslation(0, 0.17, 0.115));
    c.goodAt(G.STONE, mA, 0, 0, 0);
  }
}

/** Chata kamieniarza: kamienny stol przed wejsciem. */
function stonecutterHut(c: WorkCtx, _b: Building, o: Origin): void {
  const p = c.at(o, STONE_TABLE.x, STONE_TABLE.y, 0, w1);
  c.prop('fld_table', p.x, stationY(c, o, STONE_TABLE.x, STONE_TABLE.y), p.z, c.frontRot, o.sc);
}

function stonecutter(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.DRESS) {
    dressing(c, serf, at);
    return true;
  }
  if (serf.sub === WS.WORKING && serf.target >= 0 && !at.moving) {
    breaking(c, serf);
    return true;
  }
  // Skala stoi na polu celu: kamieniarz obchodzi ja (przy dojsciu i przy pierwszym kroku powrotu).
  const cell = serf.sub === WS.TO_TARGET ? serf.target : workSpots.get(serf.id)?.cell ?? -1;
  let ob: Obstacle | null = null;
  if (cell >= 0 && isStone(c.s.map.obj[cell])) {
    const r = rockOf(c, cell);
    obstacle.x = r.x;
    obstacle.z = r.z;
    obstacle.r = r.r + 0.1;
    ob = obstacle;
  }
  smoothSteps(c, serf, at, serf.sub === WS.TO_TARGET && serf.target >= 0 ? rockStand(c, serf.target) : null, ob);
  const pose = c.walkPose(serf, at);
  if (serf.sub === WS.RETURN && serf.carry === G.STONE) {
    // Blok na prawym ramieniu, kilof w lewej rece.
    pose.carry = -1;
    pose.armR = -2.75;
    pose.armL = at.moving ? -Math.sin(at.walk) * 0.5 : 0;
    pose.tool = null;
    pose.toolL = 'tool_pick';
    const f = c.figure(pose);
    roughBlock(c, shoulderBlock(mA, f), 1);
    return true;
  }
  c.figure(pose);
  return true;
}

// ---------------------------------------------------------------- rybak

/** Miejsce rybaka (s*) i jego obrot, splawik na wodzie (f*), kosz na ziemi (b*) i strona kosza (bs: +1 - z prawej). */
interface Shore { sx: number; sy: number; sz: number; rot: number; fx: number; fy: number; fz: number; bx: number; by: number; bz: number; bs: number }
const shore: Shore = { sx: 0, sy: 0, sz: 0, rot: 0, fx: 0, fy: 0, fz: 0, bx: 0, by: 0, bz: 0, bs: 1 };

/** Brzeg: miejsce rybaka (blizej wody), splawik przy srodku pola wody (lekko z boku), kosz po stronie widocznej z kamery. */
function shoreOf(c: WorkCtx, serf: Serf, landCell: number): Shore {
  const land = c.cell(landCell, w1);
  const water = c.cell(serf.road, w2);
  let dx = water.x - land.x, dz = water.z - land.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  shore.sx = land.x + dx * 0.3;
  shore.sz = land.z + dz * 0.3;
  shore.sy = c.ground(shore.sx, shore.sz);
  shore.rot = Math.atan2(dx, dz);
  const side = (serf.id % 2 ? 1 : -1) * 0.1;
  shore.fx = water.x + dx * 0.08 + dz * side;
  shore.fz = water.z + dz * 0.08 - dx * side;
  // Powierzchnia wody przy brzegu nie jest plaska (siatka terenu wznosi sie ku ladowi) - splawik na terenie.
  shore.fy = Math.max(water.y, c.ground(shore.fx, shore.fz)) + 0.002;
  const rx = rightX(shore.rot), rz = rightZ(shore.rot);
  const bs = Math.sin(c.toCamera - shore.rot) > 0 ? 1 : -1;
  shore.bs = bs;
  shore.bx = shore.sx + rx * bs * 0.12 - dx * 0.04;
  shore.bz = shore.sz + rz * bs * 0.12 - dz * 0.04;
  shore.by = c.ground(shore.bx, shore.bz);
  return shore;
}

/** Kosz w lewej dloni (wisi pionowo mimo wymachu reki); fish - z ryba w srodku. */
function basketInHand(c: WorkCtx, f: RigFrames, armL: number, fish: boolean): void {
  if (!c.details) return;
  mA.copy(f.armL).multiply(mT.makeTranslation(0, HAND - 0.004, 0)).multiply(mT.makeRotationX(-armL)).multiply(mT.makeTranslation(0, -0.104, 0));
  c.propM('fld_basket', mA);
  if (fish) c.goodAt(G.FISH, mA, 0.005, 0.038, 0, -0.5, 0.3, 0.2, 0.8);
}

/** Kosz na ziemi (skala postaci); fish - ryba w srodku. */
function basketOnGround(c: WorkCtx, x: number, y: number, z: number, rot: number, fish: boolean): void {
  c.prop('fld_basket', x, y, z, rot + 1.2, UNIT_SCALE);
  if (fish) {
    mA.makeTranslation(x, y, z).multiply(mT.makeRotationY(rot + 1.2)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
    c.goodAt(G.FISH, mA, 0.005, 0.038, 0, -0.5, 0.3, 0.2, 0.8);
  }
}

/** Fala na wodzie: pierscien rosnacy przez `life` s (age = s od powstania). */
function ripple(c: WorkCtx, x: number, y: number, z: number, age: number, life = 1.1, size = 0.16): void {
  if (age < 0 || age > life) return;
  const k = age / life;
  c.prop('fld_ripple', x, y + 0.002, z, 0, size * (0.25 + k), 1, 0xdfeef6);
}

/**
 * WORKING na brzegu: odstawienie kosza, zamach i zarzucenie (splawik leci lukiem), czekanie (splawik kolysze
 * sie, dwa brania), zaciecie; z ryba - ryba wyskakuje z wody i szamocze sie na zylce, rybak przeciaga ja do
 * lewej reki i wrzuca do kosza; bez ryby - zwija pusta zylke i krecac glowa bierze kosz.
 */
function fishing(c: WorkCtx, serf: Serf): void {
  const sh = shoreOf(c, serf, serf.pos);
  setSpot(serf, sh.sx, sh.sy, sh.sz);
  const p = c.progress(serf.timer, FISH_TICKS);
  const sec = FISH_TICKS * TICK_S;
  const catchIt = serf.road >= 0 && c.s.map.res[serf.road] === RES.FISH && c.s.map.resAmt[serf.road] > 0;
  const rot = sh.rot;
  const pose = poseAt(serf, sh.sx, sh.sy, sh.sz, rot);
  pose.tool = 'fld_rod';
  pose.legL = -0.15;
  pose.legR = 0.15;
  pose.head = 0.12;
  const t = c.time;
  const wait = 0.03 * Math.sin(t * 1.3 + serf.id);
  let basketHeld = false;
  let fishInBasket = false;
  // Wedka wychodzi z dloni ok. 28 stopni nad poziom (fld_rod); wymach reki unosi ja dalej: armR -0.1 - wedka
  // skosnie nad woda, -0.9 - prawie pionowo, -1.9 - za glowa.
  if (p < 0.05) {
    // Odstawia kosz obok siebie.
    const k = bump(p, 0, 0.05);
    pose.lean = 0.45 * k;
    pose.armL = -0.2 - 0.3 * k;
    pose.armLYaw = sh.bs * 0.35 * k;
    pose.armR = -0.3;
    basketHeld = p < 0.025;
  } else if (p < 0.1) {
    // Zamach: wedka nad glowe do tylu.
    const k = smooth(span(p, 0.05, 0.1));
    pose.armR = lerp(-0.3, -1.9, k);
    pose.twist = 0.3 * k;
    pose.lean = -0.08 * k;
    pose.armL = -0.3;
  } else if (p < 0.135) {
    // Zarzucenie: szybki wymach do przodu, wedka nisko nad woda.
    const k = smooth(span(p, 0.1, 0.13));
    pose.armR = lerp(-1.9, 0.05, k) + (p > 0.13 ? -0.15 * span(p, 0.13, 0.135) : 0);
    pose.twist = 0.3 * (1 - k);
    pose.lean = lerp(-0.08, 0.15, k);
    pose.armL = -0.3 - 0.1 * k;
    pose.armLYaw = 0.5 * k;
  } else if (p < 0.68) {
    // Czekanie: wedka skosnie nad woda, lewa reka przy dolnym koncu, wzrok na splawiku.
    pose.armR = -0.1 + wait;
    pose.armL = -0.38 + wait;
    pose.armLYaw = 0.5;
    pose.lean = 0.08;
    pose.head = 0.2 + 0.05 * Math.sin(t * 0.7);
    pose.headTurn = 0.15 * Math.sin(t * 0.37 + serf.id);
    // Przy braniach rybak pochyla sie czujnie.
    pose.lean += 0.08 * (bump(p, 0.48, 0.55) + bump(p, 0.58, 0.66));
  } else if (p < 0.72) {
    // Zaciecie: szarpniecie wedka w gore.
    const k = smooth(span(p, 0.68, 0.705));
    pose.armR = lerp(-0.1, -0.95, k);
    pose.armL = lerp(-0.38, -0.95, k);
    pose.armLYaw = 0.45;
    pose.lean = lerp(0.08, -0.12, k);
  } else if (catchIt) {
    if (p < 0.86) {
      // Ryba na zylce: rybak trzyma wedke wysoko i sie odchyla.
      const w = Math.sin(t * 9);
      pose.armR = -0.95 + w * 0.1;
      pose.armL = -0.95 + w * 0.08;
      pose.armLYaw = 0.45;
      pose.lean = -0.14;
      pose.legL = -0.35;
      pose.legR = 0.3;
    } else if (p < 0.92) {
      // Przeciaga rybe w bok, do lewej reki.
      const k = smooth(span(p, 0.86, 0.92));
      pose.armR = lerp(-0.95, -0.7, k);
      pose.armRYaw = -0.6 * k;
      pose.twist = 0.35 * k;
      pose.armL = lerp(-0.95, -1.2, k);
      pose.armLYaw = lerp(0.45, -0.25, k);
      pose.lean = lerp(-0.14, 0.05, k);
    } else {
      // Do kosza i podniesienie kosza.
      const k = bump(p, 0.92, 1.0);
      pose.armR = -0.55;
      pose.armRYaw = -0.6 * (1 - span(p, 0.95, 1));
      pose.twist = 0.35 * (1 - span(p, 0.95, 1));
      pose.lean = 0.5 * k;
      pose.crouch = 0.03 * k;
      pose.armL = -0.2 - 0.4 * k;
      pose.armLYaw = sh.bs * 0.35 * k;
      fishInBasket = p >= 0.955;
      basketHeld = p >= 0.975;
    }
  } else {
    // Pusty haczyk: zwija zylke, kreci glowa, bierze kosz.
    const k = smooth(span(p, 0.72, 0.8));
    pose.armR = lerp(-0.95, -0.55, k);
    pose.armL = -0.7;
    pose.armLYaw = 0.4;
    pose.headTurn = p > 0.8 && p < 0.93 ? Math.sin((p - 0.8) * 60) * 0.45 : 0;
    if (p > 0.93) {
      const kb = bump(p, 0.93, 1.0);
      pose.lean = 0.45 * kb;
      pose.armL = -0.2 - 0.4 * kb;
      pose.armLYaw = sh.bs * 0.35 * kb;
      basketHeld = p >= 0.965;
    }
  }
  const f = c.figure(pose);
  if (basketHeld) basketInHand(c, f, pose.armL ?? 0, fishInBasket);
  else if (c.details) basketOnGround(c, sh.bx, sh.by, sh.bz, rot, fishInBasket);
  if (!c.details) return;
  // Zylka, splawik i ryba.
  const tip = pt(f.armR, 0, HAND + 0.26, 0.48, vA);
  const water = sh.fy;
  if (p >= 0.105 && p < 0.135) {
    // Splawik leci lukiem z czubka wedki.
    const k = span(p, 0.11, 0.135);
    vB.set(lerp(tip.x, sh.fx, k), lerp(tip.y, water, k) + Math.sin(k * Math.PI) * 0.18, lerp(tip.z, sh.fz, k));
    c.prop('fld_float', vB.x, vB.y, vB.z, 0, 1);
    line(c, tip, vB, 0.0035, LINE);
    return;
  }
  if (p < 0.135) return;
  const landAge = (p - 0.135) * sec;
  if (p < 0.68 || (p < 0.72 && !catchIt) || (!catchIt && p < 0.8)) {
    // Splawik na wodzie: kolysanie, dwa brania (szybkie zanurzenia), po zacieciu - pusty haczyk wraca.
    let dip = 0;
    const n1 = span(p, 0.5, 0.53), n2 = span(p, 0.6, 0.64);
    if (n1 > 0 && n1 < 1) dip = Math.sin(n1 * Math.PI * 3) * 0.008;
    if (n2 > 0 && n2 < 1) dip = Math.sin(n2 * Math.PI * 4) * 0.011;
    let x = sh.fx, z = sh.fz, y = water + Math.sin(t * 2.4 + serf.id) * 0.003 - Math.abs(dip);
    if (p >= 0.68) {
      const k = smooth(span(p, 0.69, 0.8));
      x = lerp(sh.fx, tip.x, k);
      z = lerp(sh.fz, tip.z, k);
      y = lerp(water, tip.y - 0.1, k) + Math.sin(k * Math.PI) * 0.08;
    }
    vB.set(x, y, z);
    c.prop('fld_float', x, y, z, 0, 1);
    line(c, tip, vB, 0.003, LINE);
    ripple(c, sh.fx, water, sh.fz, landAge);
    ripple(c, sh.fx, water, sh.fz, (p - 0.5) * sec, 0.9, 0.1);
    ripple(c, sh.fx, water, sh.fz, (p - 0.6) * sec, 0.9, 0.12);
    c.fx.burst(serf.id * 59, landAge, sh.fx, water + 0.01, sh.fz,
      { kind: 'puff', n: 5, life: 0.4, vy: 0.45, spread: 0.18, gravity: 2.5, size: 0.016, sizeEnd: 0.01, color: WATER_DROP, sound: 'splash_small' });
    return;
  }
  if (!catchIt) return;
  // Ryba: wyskakuje z wody, szamocze sie na zylce, wedruje do lewej reki i do kosza.
  const strikeAge = (p - 0.7) * sec;
  ripple(c, sh.fx, water, sh.fz, strikeAge, 1.2, 0.2);
  c.fx.burst(serf.id * 61, strikeAge, sh.fx, water + 0.01, sh.fz,
    { kind: 'puff', n: 7, life: 0.55, vy: 0.6, spread: 0.25, gravity: 2.4, size: 0.02, sizeEnd: 0.012, color: WATER_DROP, sound: 'splash' });
  if (p >= 0.955) return;
  const wig = Math.sin(t * 23) * 0.9;
  const hangX = tip.x, hangY = tip.y - 0.13, hangZ = tip.z;
  let x: number, y: number, z: number;
  if (p < 0.8) {
    const k = smooth(span(p, 0.71, 0.8));
    x = lerp(sh.fx, hangX, k);
    z = lerp(sh.fz, hangZ, k);
    y = lerp(water - 0.02, hangY, k) + Math.sin(k * Math.PI) * 0.06;
  } else if (p < 0.86) {
    x = hangX + Math.sin(t * 5.3) * 0.025;
    y = hangY;
    z = hangZ + Math.cos(t * 4.1) * 0.02;
  } else if (p < 0.925) {
    const hand = pt(f.armL, 0, HAND - 0.02, 0, vC);
    const k = smooth(span(p, 0.86, 0.91));
    x = lerp(hangX, hand.x, k);
    y = lerp(hangY, hand.y - 0.06, k);
    z = lerp(hangZ, hand.z, k);
  } else {
    // Rzut do kosza.
    const hand = pt(f.armL, 0, HAND - 0.02, 0, vC);
    const k = smooth(span(p, 0.925, 0.955));
    x = lerp(hand.x, sh.bx, k);
    y = lerp(hand.y - 0.06, sh.by + 0.03, k) + Math.sin(k * Math.PI) * 0.07;
    z = lerp(hand.z, sh.bz, k);
  }
  // Ryba glowa do gory (pysk na haczyku), wije sie.
  const still = p > 0.91 ? 0.25 : 1;
  mA.makeTranslation(x, y, z).multiply(mT.makeRotationY(rot + wig * still)).multiply(mT.makeRotationZ(Math.sin(t * 17) * 0.35 * still))
    .multiply(mT.makeRotationX(-Math.PI / 2)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE)).multiply(mT.makeTranslation(0, -0.035, -0.07));
  c.goodAt(G.FISH, mA, 0, 0, 0);
  if (p < 0.91) {
    vB.set(x, y + 0.018, z);
    line(c, tip, vB, 0.003, LINE);
  }
  if (p < 0.8) {
    c.fx.stream(serf.id * 67, x, y, z,
      { kind: 'puff', n: 4, life: 0.35, vy: -0.1, spread: 0.12, gravity: 1.8, size: 0.012, sizeEnd: 0.006, color: WATER_DROP });
  }
}

function fisher(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.WORKING && serf.road >= 0 && !at.moving) {
    fishing(c, serf);
    return true;
  }
  const toShore = serf.sub === WS.TO_TARGET && serf.target >= 0 && serf.road >= 0;
  if (toShore) {
    const sh = shoreOf(c, serf, serf.target);
    w3.x = sh.sx;
    w3.y = sh.sy;
    w3.z = sh.sz;
  }
  smoothSteps(c, serf, at, toShore ? w3 : null);
  const pose = c.walkPose(serf, at);
  const out = serf.sub === WS.TO_TARGET || serf.sub === WS.RETURN;
  if (!out) {
    c.figure(pose);
    return true;
  }
  // W drodze: wedka oparta o prawe ramie, kosz w lewej rece (w drodze powrotnej z ryba w srodku).
  const fish = serf.carry === G.FISH;
  pose.carry = -1;
  pose.tool = 'fld_rod';
  pose.armR = -1.8;
  pose.armL = (pose.armL ?? 0) * 0.4;
  const f = c.figure(pose);
  basketInHand(c, f, pose.armL, fish);
  return true;
}

/** Chata rybaka: siec suszy sie na zerdzi i kolysze na wietrze, przed nia suszone ryby (od jednej do czterech, przybywa ich z polowami). */
function fisherHut(c: WorkCtx, b: Building, o: Origin): void {
  const fr = stationFrame(c, o, NET_BAR.x, NET_BAR.y, mC);
  c.propM('fld_netrack', fr);
  if (!c.details) return;
  const sway = Math.sin(c.time * 1.1 + b.id) * 0.1 + Math.sin(c.time * 2.7 + b.id * 2) * 0.04;
  c.propAt('fld_net', fr, 0, NET_BAR.z, -NET_BAR.netY, sway, 0, 0);
  const n = b.produced === 0 ? 0 : 1 + ((b.produced - 1) % NET_BAR.fish.length);
  const s = UNIT_SCALE / o.sc;
  for (let k = 0; k < n; k++) {
    const sw = sway * 1.4 + Math.sin(c.time * 1.9 + k * 1.7) * 0.08;
    // Ryba wisi za ogon, glowa w dol.
    mA.copy(fr).multiply(mT.makeTranslation(NET_BAR.fish[k], NET_BAR.z, -NET_BAR.fishY)).multiply(mT.makeRotationX(sw))
      .multiply(mT.makeScale(s, s, s)).multiply(mT.makeTranslation(0, -0.125, 0)).multiply(mT.makeRotationY(0.3 * (k % 2 ? 1 : -1)))
      .multiply(mT.makeRotationX(Math.PI / 2)).multiply(mT.makeTranslation(0, -0.035, 0));
    c.goodAt(G.FISH, mA, 0, 0, 0);
  }
}

// ---------------------------------------------------------------- jelen

/** Smierc jelenia (po stronie klienta): chwila trafienia i bok trafiony strzala, ktory po upadku jest na gorze (+1 - bok +x jelenia). */
interface Death { t: number; side: number }
const deaths = new Map<number, Death>();
/** Ostatni kierunek marszu jelenia - stojac patrzy tam, dokad szedl. */
const deerRot = new Map<number, number>();
/** Macierz lezacego jelenia wg mysliwego (mysliwy podnosi go stamtad na kark). */
const lastCarcass = new Map<number, THREE.Matrix4>();

const DEER_HIP = 0.136;
/** Nogi: [x, z] stawu (z > 0 - przednie). */
const DEER_LEGS: readonly [number, number][] = [[-0.03, 0.075], [0.03, 0.075], [-0.03, -0.075], [0.03, -0.075]];

/** Jelen z czesci w ukladzie `base` (skala postaci): wymach nog [LP, PP, LT, PT], pochylenie i skret glowy. */
function deer(c: WorkCtx, base: THREE.Matrix4, legs: readonly number[], pitch: number, yaw = 0): void {
  c.propM('fld_deer_body', base);
  c.propAt('fld_deer_head', base, 0, 0.2, 0.085, pitch, yaw, 0);
  for (let i = 0; i < 4; i++) c.propAt('fld_deer_leg', base, DEER_LEGS[i][0], DEER_HIP, DEER_LEGS[i][1], legs[i]);
}

const legs4 = [0, 0, 0, 0];

/** Polozenie i obrot jelenia w tej klatce (jak w rendererze encji, obrot stojacego - ostatni kierunek marszu). */
function deerAt(c: WorkCtx, a: Animal, out: Vec3): number {
  const p = c.cell(a.pos, out);
  if (a.to >= 0) {
    const q = c.cell(a.to, w4);
    const t = Math.min(1, (a.t + c.alpha) / Math.max(1, a.dur));
    const rot = Math.atan2(q.x - p.x, q.z - p.z);
    out.x += (q.x - out.x) * t;
    out.y += (q.y - out.y) * t;
    out.z += (q.z - out.z) * t;
    return rot;
  }
  return deerRot.get(a.id) ?? a.id * 1.7;
}

/** Punkt trafienia strzaly: bok jelenia od strony mysliwego (w swiecie). */
function hitPoint(c: WorkCtx, a: Animal, hx: number, hz: number, out: THREE.Vector3): THREE.Vector3 {
  const rot = deerAt(c, a, w1);
  const lx = (hx - w1.x) * Math.cos(rot) - (hz - w1.z) * Math.sin(rot);
  const side = lx >= 0 ? 1 : -1;
  mA.makeTranslation(w1.x, w1.y, w1.z).multiply(mT.makeRotationY(rot)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
  return pt(mA, side * 0.045, 0.185, 0.03, out);
}

/** Uklad lezacego (padajacego) jelenia; age - s od trafienia. Ustawia nogi w `legs4`, zwraca pochylenie glowy. */
function carcass(out: THREE.Matrix4, x: number, y: number, z: number, rot: number, side: number, age: number): number {
  const k1 = smooth(clamp01(age / 0.35));
  const k2 = smooth(clamp01((age - 0.22) / 0.45));
  const h = 0.178 - 0.07 * k1 - 0.055 * k2;
  out.makeTranslation(x, y, z).multiply(mT.makeRotationY(rot)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE))
    .multiply(mT.makeTranslation(0, h, 0)).multiply(mT.makeRotationZ(side * (Math.PI / 2) * k2)).multiply(mT.makeTranslation(0, -0.178, 0));
  // Nogi uginaja sie (przednie do tylu, tylne do przodu), po upadku prostuja sie bezwladnie.
  legs4[0] = legs4[1] = lerp(1.25 * k1, 0.35, k2);
  legs4[2] = legs4[3] = lerp(-0.9 * k1, -0.25, k2);
  return lerp(-0.3 * k1, 0.7, k2);
}

/** Strzala wbita w bok lezacego jelenia (bok od strony mysliwego jest na gorze). */
function stuckArrow(c: WorkCtx, base: THREE.Matrix4, side: number): void {
  if (!c.details) return;
  mC.copy(base).multiply(mT.makeTranslation(side * 0.03, 0.19, 0.035)).multiply(mT.makeRotationY(-side * 1.2)).multiply(mT.makeRotationX(0.35))
    .multiply(mT.makeTranslation(0, 0, -0.2));
  c.propM('fld_arrow', mC);
}

function animal(c: WorkCtx, a: Animal, at: SerfAt): boolean {
  if (a.dead) {
    let d = deaths.get(a.id);
    if (!d) {
      const h = a.hunter >= 0 ? c.s.serfs[a.hunter] : null;
      let side = a.id % 2 ? 1 : -1;
      if (h) {
        const hp = c.cell(h.pos, w2);
        const rot = deerAt(c, a, w1);
        side = (hp.x - w1.x) * Math.cos(rot) - (hp.z - w1.z) * Math.sin(rot) >= 0 ? 1 : -1;
      }
      d = { t: c.time, side };
      deaths.set(a.id, d);
    }
    const rot = deerAt(c, a, w1);
    const age = c.time - d.t;
    const pitch = carcass(mDeer, w1.x, w1.y, w1.z, rot, d.side, age);
    deer(c, mDeer, legs4, pitch, d.side * 0.4 * smooth(clamp01((age - 0.3) / 0.4)));
    stuckArrow(c, mDeer, d.side);
    if (a.hunter >= 0) {
      let m = lastCarcass.get(a.hunter);
      if (!m) {
        m = new THREE.Matrix4();
        lastCarcass.set(a.hunter, m);
      }
      m.copy(mDeer);
    }
    // Trafienie: klaczki siersci.
    pt(mDeer, d.side * 0.045, 0.185, 0.03, vA);
    c.fx.burst(a.id * 71, age, vA.x, vA.y, vA.z,
      { kind: 'bit', n: 5, life: 0.45, vy: 0.4, spread: 0.3, gravity: 1.6, size: 0.012, sizeEnd: 0.008, color: FUR, floor: at.y + 0.005, sound: 'arrow_hit' });
    return true;
  }
  if (deaths.has(a.id)) deaths.delete(a.id);
  if (at.moving) deerRot.set(a.id, at.rot);
  const rot = at.moving ? at.rot : deerRot.get(a.id) ?? at.rot;
  let pitch: number, yaw = 0;
  let bob = 0;
  if (at.moving) {
    // Stepa: przekatne pary nog razem, trzy kroki na pole.
    const ph = at.t * Math.PI * 6;
    const s = Math.sin(ph) * 0.55;
    legs4[0] = s;
    legs4[3] = s;
    legs4[1] = -s;
    legs4[2] = -s;
    bob = Math.abs(Math.cos(ph)) * 0.008;
    pitch = 0.1 + Math.sin(ph * 2) * 0.05;
  } else {
    legs4[0] = legs4[1] = legs4[2] = legs4[3] = 0;
    const h = a.hunter >= 0 ? c.s.serfs[a.hunter] : null;
    if (h && h.state === SS.WORK_OUT && (h.sub === WS.WORKING || (h.sub === WS.TO_TARGET && h.path.length <= 2))) {
      // Czujny: leb wysoko, odwraca go ku mysliwemu.
      const hp = c.cell(h.pos, w2);
      let rel = Math.atan2(hp.x - at.x, hp.z - at.z) - rot;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      pitch = -0.35;
      yaw = Math.max(-0.9, Math.min(0.9, rel));
      // Parskniecie zaniepokojonego jelenia, z rzadka.
      const n = Math.floor(c.time / 3 + a.id * 0.37);
      if (((n * 2654435761 + a.id * 40503) >>> 0) % 5 === 0) c.sfx('deer_snort', at.x, at.z, 0x5100000 + a.id * 4096 + (n & 4095));
      legs4[1] = -0.1 * Math.max(0, Math.sin(c.time * 3 + a.id));
    } else {
      // Pasie sie: leb przy ziemi i skubanie trawy, co jakis czas podnosi leb i rozglada sie.
      const cyc = (c.time * 0.11 + a.id * 0.37) % 1;
      const up = smooth(span(cyc, 0.62, 0.7)) * (1 - smooth(span(cyc, 0.92, 1)));
      pitch = lerp(1.25 + Math.sin(c.time * 7 + a.id) * 0.06, -0.15, up);
      yaw = up * Math.sin(c.time * 0.9 + a.id) * 0.6;
    }
  }
  mDeer.makeTranslation(at.x, at.y + bob, at.z).multiply(mT.makeRotationY(rot)).multiply(mT.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
  deer(c, mDeer, legs4, pitch, yaw);
  return true;
}

// ---------------------------------------------------------------- mysliwy

/** Kiedy mysliwy zaczal wracac z jeleniem (wg osadnika) - podnoszenie zdobyczy z ziemi na kark. */
const pickups = new Map<number, number>();
/** Kiedy powieszono jelenia na stojaku przy chacie (wg budynku). */
const hung = new Map<number, number>();

/** Luk w lewej dloni: raise 0 - wzdluz reki (niesiony), 1 - w poprzek reki (do strzalu). Zwraca macierz luku. */
function bowInHand(c: WorkCtx, f: RigFrames, raise: number): THREE.Matrix4 {
  mBow.copy(f.armL).multiply(mT.makeTranslation(0, HAND, 0.006)).multiply(mT.makeRotationX(-(Math.PI / 2) * (1 - raise)));
  if (c.details) c.propM('fld_bow', mBow);
  return mBow;
}

/** Cieciwa luku: od konca do konca przez punkt naciagu (nock) albo prosto, gdy nock = null. */
function bowString(c: WorkCtx, bow: THREE.Matrix4, nock: THREE.Vector3 | null): void {
  if (!c.details) return;
  const top = pt(bow, 0, 0.042, -0.14, vC);
  const bot = pt(bow, 0, 0.042, 0.14, vD);
  if (!nock) {
    line(c, top, bot, 0.0028, STRING);
    return;
  }
  line(c, top, nock, 0.0028, STRING);
  line(c, nock, bot, 0.0028, STRING);
}

/** Kolczan na plecach (i luk na plecach, gdy rece sa zajete zdobycza). */
function quiver(c: WorkCtx, f: RigFrames, bowOnBack: boolean): void {
  if (!c.details) return;
  c.propAt('fld_quiver', f.torso, 0, 0, 0);
  if (bowOnBack) c.propAt('fld_bow', f.torso, -0.01, 0.22, -0.085, 0, Math.PI / 2, 0.55);
}

/** Uklad jelenia na karku mysliwego (w poprzek barkow, nogi zwisaja z przodu). */
function neckCarry(out: THREE.Matrix4, f: RigFrames): THREE.Matrix4 {
  return out.copy(f.torso).multiply(mT.makeTranslation(0, SHOULDER + 0.06, -0.07)).multiply(mT.makeRotationY(Math.PI / 2))
    .multiply(mT.makeRotationZ(-1.0)).multiply(mT.makeTranslation(0, -0.178, 0));
}
const CARRY_LEGS = [1.2, 1.2, -0.4, -0.4];

/** Poza skradania: pochylony, ugiete kolana, luk nisko w lewej rece. */
function sneakPose(pose: Pose, walk: number): void {
  pose.lean = 0.55;
  pose.crouch = 0.045;
  pose.head = -0.5;
  pose.legL = Math.sin(walk) * 0.4;
  pose.legR = -Math.sin(walk) * 0.4;
  pose.armL = -0.55;
  pose.armR = -0.45 + Math.sin(walk) * 0.1;
  pose.bob = 0;
}

/**
 * WORKING: przyklek bokiem do zwierzecia, strzala z kolczana, luk w gore, powolne naciaganie, celowanie,
 * strzal (cieciwa wraca) i lot strzaly - trafia w bok jelenia w chwili konca strzalu (wtedy jelen pada).
 */
function shooting(c: WorkCtx, serf: Serf, at: SerfAt): void {
  const a = c.s.animals[serf.target];
  const p = c.progress(serf.timer, SHOOT_TICKS);
  const T = 1.25;
  let rot = at.rot;
  if (a) {
    deerAt(c, a, w2);
    rot = c.facing(at.x, at.z, w2.x, w2.z);
  }
  const raise = smooth(span(p, 0.12, 0.32));
  const draw = smooth(span(p, 0.38, 0.82));
  const release = p >= 0.9;
  const pose = poseAt(serf, at.x, at.y, at.z, rot);
  pose.tool = null;
  pose.crouch = 0.07 * smooth(span(p, 0, 0.12));
  pose.twist = T * raise;
  pose.headTurn = -T * raise * 0.9;
  pose.lean = 0.1;
  pose.armL = lerp(-0.4, -Math.PI / 2, raise);
  pose.armLYaw = -T * raise;
  if (p < 0.12) {
    // Siega po strzale do kolczana za prawym barkiem.
    const k = bump(p, 0, 0.12);
    pose.armR = -0.4 - 2.4 * k;
    pose.armROut = 0.3 * k;
  } else if (p < 0.38) {
    // Naklada strzale na cieciwe.
    const k = smooth(span(p, 0.12, 0.34));
    pose.armR = lerp(-0.6, -Math.PI / 2, k);
    pose.armRYaw = lerp(0, -T - 0.55, k);
  } else if (!release) {
    pose.armR = -Math.PI / 2 + Math.sin(c.time * 31) * 0.01 * span(p, 0.8, 0.9);
    pose.armRYaw = lerp(-T - 0.55, 0.25, draw);
  } else {
    const k = smooth(span(p, 0.9, 0.96));
    pose.armR = lerp(-Math.PI / 2, -1.25, k);
    pose.armRYaw = 0.25 + 0.4 * k;
    pose.armROut = 0.3 * k;
  }
  const f = c.figure(pose);
  quiver(c, f, false);
  const bow = bowInHand(c, f, raise);
  const hand = pt(f.armR, 0, HAND, 0, vA);
  const nocked = p >= 0.3 && !release;
  bowString(c, bow, nocked ? hand : null);
  if (!c.details) return;
  if (p >= 0.05 && p < 0.3) {
    // Strzala w prawej dloni.
    c.propAt('fld_arrow', f.armR, 0, HAND + 0.03, 0, Math.PI / 2 - 0.4, 0, 0);
  } else if (nocked) {
    const grip = pt(bow, 0, 0, 0, vB);
    aimAlong(mA, hand.x, hand.y, hand.z, grip.x - hand.x, grip.y - hand.y, grip.z - hand.z, UNIT_SCALE);
    c.propM('fld_arrow', mA);
  } else if (release && a) {
    // Lot strzaly od luku do boku jelenia.
    const grip = pt(bow, 0, 0, 0, vB);
    if (p < 0.93) c.sfx('bow', grip.x, grip.z, 0x5000000 + serf.id);
    const hit = hitPoint(c, a, at.x, at.z, vD);
    const k = span(p, 0.9, 1.0);
    const x = lerp(grip.x, hit.x, k), y = lerp(grip.y, hit.y, k) + Math.sin(k * Math.PI) * 0.06, z = lerp(grip.z, hit.z, k);
    const dy = hit.y - grip.y + Math.cos(k * Math.PI) * 0.06 * Math.PI;
    aimAlong(mA, x, y, z, hit.x - grip.x, dy, hit.z - grip.z, UNIT_SCALE);
    mA.multiply(mT.makeTranslation(0, 0, -0.2));
    c.propM('fld_arrow', mA);
  }
}

/**
 * HANG przy chacie: z flagi do stojaka z jeleniem na karku, zawieszenie go na poprzeczce (za tylne nogi),
 * odkrojenie miesa i z miesem na flage.
 */
function hanging(c: WorkCtx, serf: Serf, at: SerfAt): void {
  const b = c.s.buildings[serf.home];
  if (!b) {
    c.figure(c.walkPose(serf, at));
    return;
  }
  const o = c.origin(b);
  const p = c.progress(serf.timer, HANG_TICKS);
  const rack = c.at(o, GAME_RACK.x, GAME_RACK.y, 0, w1);
  const stand = c.at(o, GAME_RACK.standX, GAME_RACK.standY, 0, w2);
  stand.y = c.ground(stand.x, stand.z);
  const flag = w3;
  flag.x = at.x;
  flag.y = at.y;
  flag.z = at.z;
  const HUNG = 0.42;
  if (p >= HUNG) hung.set(b.id, c.time);
  let pose: Pose;
  // Jelen: 0 - na karku, 1 - na stojaku, pomiedzy - przenoszony.
  let deerK = p >= HUNG ? 1 : 0;
  let meat: 'none' | 'hand' | 'carry' = 'none';
  let knife = false;
  if (p < 0.2) {
    const st = walkPath(c, PATH_TO, p / 0.2);
    pose = walkLegs(poseAt(serf, st.x, st.y, st.z, st.rot), st.legs, false);
    pose.armL = pose.armR = -2.3;
  } else if (p > 0.66) {
    const st = walkPath(c, PATH_FROM, (p - 0.66) / 0.34);
    pose = walkLegs(poseAt(serf, st.x, st.y, st.z, st.rot), st.legs, false);
    pose.armL = pose.armR = -1.05;
    meat = 'carry';
  } else {
    pose = poseAt(serf, stand.x, stand.y, stand.z, c.facing(stand.x, stand.z, rack.x, rack.z));
    if (p < HUNG + 0.04) {
      // Unosi jelenia nad glowe i zaczepia na poprzeczce.
      const k = smooth(span(p, 0.2, HUNG));
      deerK = k;
      pose.armL = pose.armR = lerp(-2.3, -2.9, Math.sin(k * Math.PI)) + (k >= 1 ? 0.6 * span(p, HUNG, HUNG + 0.04) : 0);
      pose.lean = -0.1 * Math.sin(k * Math.PI);
    } else {
      // Odkraja tasakiem kawal miesa i bierze go w reke.
      const k = span(p, HUNG + 0.04, 0.66);
      deerK = 1;
      const cut = Math.sin(k * Math.PI * 5) * (k < 0.6 ? 1 : 0);
      if (k < 0.6) knife = true;
      pose.armR = -1.45 + cut * 0.2;
      pose.armL = -1.2;
      pose.armLYaw = 0.3;
      pose.lean = 0.12;
      pose.head = 0.15;
      meat = k > 0.6 ? 'hand' : 'none';
    }
  }
  pose.tool = knife ? 'tool_cleaver' : null;
  const f = c.figure(pose);
  quiver(c, f, true);
  // Jelen: na karku, przenoszony na stojak, wiszacy.
  const s = UNIT_SCALE / o.sc;
  rackDeer(mC, stationFrame(c, o, GAME_RACK.x, GAME_RACK.y, mBow), s);
  if (deerK <= 0) {
    deer(c, neckCarry(mA, f), CARRY_LEGS, 1.0);
  } else if (deerK < 1) {
    neckCarry(mDeer, f);
    deer(c, blendM(mA, mDeer, mC, deerK), CARRY_LEGS, 1.0);
  } else {
    deer(c, mC, RACK_LEGS, 0.6);
  }
  if (meat === 'hand') c.goodAt(G.MEAT, f.armR, -0.04, HAND - 0.03, 0.02, 0, 0, 0, 0.9);
  else if (meat === 'carry') {
    mA.copy(f.torso).multiply(mT.makeTranslation(0, 0.18, 0.11));
    c.goodAt(G.MEAT, mA, 0, 0, 0, 0, 0.6, 0, 1);
  }
}

/** Jelen wiszacy na poprzeczce stojaka za tylne nogi, glowa w dol (w ukladzie stojaka `frame`, skala s). */
function rackDeer(out: THREE.Matrix4, frame: THREE.Matrix4, s: number, sway = 0): THREE.Matrix4 {
  return out.copy(frame).multiply(mT.makeTranslation(0, GAME_RACK.bar - 0.01, 0))
    .multiply(mT.makeScale(s, s, s)).multiply(mT.makeRotationY(1.0)).multiply(mT.makeRotationX(sway)).multiply(mT.makeTranslation(0, -0.211, -0.136))
    .multiply(mT.makeRotationX(Math.PI / 2));
}
const RACK_LEGS = [-1.3, -1.3, Math.PI / 2, Math.PI / 2];

function hunter(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.HANG) {
    hanging(c, serf, at);
    return true;
  }
  if (serf.sub === WS.WORKING && serf.target >= 0 && !at.moving) {
    shooting(c, serf, at);
    return true;
  }
  const pose = c.walkPose(serf, at);
  pose.tool = null;
  if (serf.sub === WS.RETURN && serf.carry === G.MEAT) {
    // Jelen na karku, obie rece trzymaja nogi z przodu; na poczatku podnosi go z ziemi.
    pose.carry = -1;
    pose.armL = pose.armR = -2.3;
    let t0 = pickups.get(serf.id);
    if (t0 === undefined) {
      t0 = c.time;
      pickups.set(serf.id, t0);
    }
    const k = smooth(clamp01((c.time - t0) / 0.45));
    if (k < 1) {
      pose.lean = 0.5 * (1 - k);
      pose.armL = pose.armR = lerp(-0.7, -2.3, k);
    }
    const f = c.figure(pose);
    quiver(c, f, true);
    const from = lastCarcass.get(serf.id);
    neckCarry(mDeer, f);
    const near = !!from && Math.hypot(from.elements[12] - at.x, from.elements[14] - at.z) < 0.35;
    if (from && near && k < 1) deer(c, blendM(mA, from, mDeer, k), CARRY_LEGS, lerp(0.7, 1.0, k));
    else deer(c, mDeer, CARRY_LEGS, 1.0);
    return true;
  }
  pickups.delete(serf.id);
  if (serf.sub === WS.ENTER || serf.sub === WS.OUT_CARRY) lastCarcass.delete(serf.id);
  const sneaking = (serf.sub === WS.TO_TARGET && serf.path.length <= 2 && at.moving) || serf.sub === WS.WORKING;
  if (sneaking) sneakPose(pose, at.walk);
  if (serf.sub === WS.FETCH && serf.path.length === 0 && at.moving) {
    // Ostatnie kroki do zdobyczy: schyla sie po nia.
    const k = smooth(span(at.t, 0.55, 1));
    pose.lean = 0.6 * k;
    pose.armL = lerp(pose.armL ?? 0, -0.7, k);
    pose.armR = lerp(pose.armR ?? 0, -0.7, k);
  }
  const f = c.figure(pose);
  quiver(c, f, false);
  bowInHand(c, f, sneaking ? 0.35 : 0);
  if (sneaking && c.details) {
    // Strzala gotowa w prawej dloni.
    c.propAt('fld_arrow', f.armR, 0, HAND + 0.02, 0, Math.PI / 2 - 0.2, 0, 0);
  }
  return true;
}

/** Chata mysliwego: stojak na zdobycz; jelen wisi na nim jeszcze jakis czas po powieszeniu. */
function hunterHut(c: WorkCtx, b: Building, o: Origin): void {
  const fr = stationFrame(c, o, GAME_RACK.x, GAME_RACK.y, mC);
  c.propM('fld_rack', fr);
  const t = hung.get(b.id);
  if (t === undefined) return;
  if (c.time - t > HANG_SHOW_S) {
    hung.delete(b.id);
    return;
  }
  const w = b.worker >= 0 ? c.s.serfs[b.worker] : null;
  if (w && w.state === SS.WORK_OUT && w.sub === WS.HANG) return;
  const s = UNIT_SCALE / o.sc;
  const sw = Math.sin(c.time * 1.3 + b.id) * 0.04;
  rackDeer(mA, fr, s, sw);
  deer(c, mA, RACK_LEGS, 0.6);
}

// ---------------------------------------------------------------- rolnik

/** Kierunek koszenia wzdluz osi z (od kamery): +1 albo -1. */
function mowDir(c: WorkCtx): number {
  return Math.cos(c.toCamera) > 0 ? -1 : 1;
}

/** Dlugosc modeli rzedow zniw (fld_wheat_row, fld_stubble, fld_swath - ROW_LEN w art/scripts/props_field.py). */
const ROW_MODEL_LEN = 0.5;

/** Rzad pola od z0 do z1 (wzgledem srodka pola) modelem `name` (rzad o dlugosci ROW_MODEL_LEN wzdluz +z). */
function row(c: WorkCtx, name: string, cx: number, cy: number, cz: number, x: number, z0: number, z1: number, dx = 0): void {
  const a = Math.min(z0, z1), len = Math.abs(z1 - z0);
  if (len < 0.004) return;
  mA.makeTranslation(cx + x + dx, cy, cz + a).multiply(mT.makeScale(1, 1, len / ROW_MODEL_LEN));
  c.propM(name, mA);
}

/** Polozenie rolnika przy koszeniu: za linia ciecia rzedu r (u - skoszona czesc 0..1). */
function mowerAt(dir: number, r: number, u: number): { x: number; z: number } {
  const R = ROWS[r];
  const zc = -dir * R.len / 2 + dir * u * R.len;
  return { x: R.x + 0.05 * dir, z: zc - dir * 0.15 };
}

/** Pole w trakcie zniw (ziemie rysuje teren): sciernisko, stojace zboze i pokosy wg postepu; gather - zgarniete pokosy (0..1). */
function harvestField(c: WorkCtx, cx: number, cy: number, cz: number, dir: number, cut: readonly number[], gather: number): void {
  for (let r = 0; r < 3; r++) {
    const R = ROWS[r];
    const near = -dir * R.len / 2, far = dir * R.len / 2;
    const zc = near + dir * cut[r] * R.len;
    row(c, 'fld_stubble', cx, cy, cz, R.x, near, zc);
    row(c, 'fld_wheat_row', cx, cy, cz, R.x, zc, far);
    // Pokos lezy obok scierniska; przy zgarnianiu skraca sie ku blizszemu koncowi.
    const sw = cut[r] * (1 - gather);
    if (sw > 0.01) row(c, 'fld_swath', cx, cy + 0.002, cz, R.x, near, near + dir * sw * R.len, 0.075 * -dir);
  }
}

const cut3 = [0, 0, 0];
/** Siew: trzy przejscia wzdluz pola (x wzgledem srodka pola), dlugosc przejscia w granicach szesciokata ziemi. */
const SOW_X = [-0.25, 0, 0.25];
function sowHalf(x: number): number {
  return 0.33 - Math.abs(x) * 0.45;
}
/** Pola, na ktorych w tej klatce pracuje rolnik (scena rysuje je sama). */
const busyFields = new Set<number>();
/** Skoszone pola (po stronie klienta): sciernisko widac jeszcze chwile po zniwach (pole -> czas). */
const stubble = new Map<number, number>();

/**
 * WORKING - zniwa: trzy rzedy koszone zamaszystym lukiem (kazdy zamach scina kawalek rzedu, slomki leca w lewo),
 * przejscia miedzy rzedami, potem kosa wbita w ziemie, zgarnianie pokosow w snop, wiazanie, snop na ramie.
 */
function harvesting(c: WorkCtx, serf: Serf): void {
  const F = c.cell(serf.target, w1);
  c.hideObject(serf.target);
  busyFields.add(serf.target);
  const p = c.progress(serf.timer, FARM_TICKS);
  if (p > 0.9) stubble.set(serf.target, c.time);
  const dir = mowDir(c);
  const sec = FARM_TICKS * TICK_S;
  let x: number, z: number, rot = dir > 0 ? 0 : Math.PI;
  let swing = -2;
  let legs: number;
  let swingAge = -1, swingN = 0;
  for (let r = 0; r < 3; r++) cut3[r] = p >= MOW[r][1] ? 1 : 0;
  let r = -1;
  for (let i = 0; i < 3; i++) if (p >= MOW[i][0] && p < MOW[i][1]) r = i;
  const gather = smooth(span(p, GATHER + 0.03, BIND));
  const sheafX = 0.04 * -dir, sheafZ = -dir * 0.42;
  const pose = poseAt(serf, 0, 0, 0, rot);
  pose.tool = 'fld_scythe';
  let sheaf = 0;
  let sheafLift = -1;
  let scytheStuck = false;
  if (r >= 0) {
    // Koszenie rzedu r: zamach (ciecie szybkie z prawej w lewo, powrot wolniejszy), linia ciecia postepuje.
    const R = ROWS[r];
    const u = span(p, MOW[r][0], MOW[r][1]) * R.swings;
    const n = Math.min(R.swings - 1, Math.floor(u)), f = u - n;
    const cutF = f < 0.4 ? smooth(f / 0.4) : 1;
    cut3[r] = clamp01((n + cutF) / R.swings);
    swing = f < 0.4 ? lerp(1, -1, smooth(f / 0.4)) : lerp(-1, 1, smooth((f - 0.4) / 0.6));
    const at = mowerAt(dir, r, cut3[r]);
    x = at.x;
    z = at.z;
    legs = Math.sin(u * Math.PI) * 0.25;
    swingAge = (f - 0.22) * ((MOW[r][1] - MOW[r][0]) * sec) / R.swings;
    swingN = r * 10 + n;
  } else if (p < GATHER) {
    // Przejscie na poczatek nastepnego rzedu (albo na koniec pola).
    let i = 0;
    while (i < 2 && p >= MOW[i + 1][0]) i++;
    const a = mowerAt(dir, i, 1), b = mowerAt(dir, Math.min(2, i + 1), 0);
    const k = span(p, MOW[i][1], MOW[i + 1][0]);
    x = lerp(a.x, b.x, k);
    z = lerp(a.z, b.z, k);
    rot = Math.atan2(b.x - a.x, b.z - a.z);
    legs = Math.sin(k * Math.PI * 4) * 0.6;
    pose.armR = -0.5;
  } else {
    // Do snopa: kosa wbita w ziemie, zgarnianie pokosow, wiazanie, snop na ramie.
    scytheStuck = p < LIFT + 0.05;
    pose.tool = null;
    const a = mowerAt(dir, 2, 1);
    const k = smooth(span(p, GATHER, GATHER + 0.03));
    const sx = sheafX + 0.12, sz = sheafZ - dir * 0.02;
    x = lerp(a.x, sx, k);
    z = lerp(a.z, sz, k);
    rot = k < 1 ? Math.atan2(sx - a.x, sz - a.z) : Math.atan2(sheafX - sx, sheafZ - sz);
    legs = k > 0 && k < 1 ? Math.sin(k * Math.PI * 3) * 0.6 : 0;
    sheaf = gather;
    if (p >= GATHER + 0.03 && p < BIND) {
      const g = Math.sin(span(p, GATHER + 0.03, BIND) * Math.PI * 4);
      pose.lean = 0.7;
      pose.crouch = 0.04;
      pose.armL = -0.9 + g * 0.2;
      pose.armR = -0.9 - g * 0.2;
      pose.armLYaw = 0.5 + g * 0.3;
      pose.armRYaw = -0.5 + g * 0.3;
      pose.head = 0.3;
    } else if (p >= BIND && p < LIFT) {
      // Wiazanie: rece okrecaja powroslo wokol snopa.
      const g = span(p, BIND, LIFT) * Math.PI * 6;
      pose.lean = 0.45;
      pose.armL = -1.0 + Math.sin(g) * 0.25;
      pose.armR = -1.0 - Math.sin(g) * 0.25;
      pose.armLYaw = 0.35 + Math.cos(g) * 0.25;
      pose.armRYaw = -0.35 + Math.cos(g) * 0.25;
      pose.head = 0.35;
    } else if (p >= LIFT) {
      const kk = smooth(span(p, LIFT, 0.96));
      sheafLift = kk;
      pose.lean = 0.5 * (1 - kk);
      pose.armR = lerp(-1.0, -2.7, kk);
      pose.armL = lerp(-1.0, 0, kk);
    }
  }
  const gx = F.x + x, gz = F.z + z;
  pose.x = gx;
  pose.z = gz;
  pose.y = c.ground(gx, gz);
  pose.rot = rot;
  setSpot(serf, gx, pose.y, gz);
  if (swing > -2) {
    // Zamaszysty luk: skret tulowia i rak od prawego boku do lewego, kosa tuz nad ziemia.
    pose.twist = 0.95 * swing;
    pose.armR = -0.5;
    pose.armL = -0.55;
    pose.armRYaw = 0.7 * swing;
    pose.armLYaw = 0.7 * swing + 0.25;
    pose.lean = 0.32 + 0.06 * (1 - Math.abs(swing));
    pose.legL = -0.25 + legs;
    pose.legR = 0.25 - legs;
    pose.head = 0.2;
  } else if (legs) {
    pose.legL = legs;
    pose.legR = -legs;
  }
  const f = c.figure(pose);
  harvestField(c, F.x, F.y, F.z, dir, cut3, gather);
  if (swingAge > -0.5) {
    // Slomki i klosy spod kosy, w lewo od kosiarza.
    const lx = -rightX(rot), lz = -rightZ(rot);
    const fwx = Math.sin(rot), fwz = Math.cos(rot);
    c.fx.burst(serf.id * 73 + swingN, swingAge, gx + fwx * 0.18, F.y + 0.12, gz + fwz * 0.18,
      { kind: 'bit', n: 7, life: 0.6, vx: lx * 0.7, vz: lz * 0.7, vy: 0.6, spread: 0.3, gravity: 2.0, size: 0.016, sizeEnd: 0.012,
        color: swingN % 2 ? STRAW : 0xcfae4c, floor: F.y + 0.03, sound: 'swish' });
  }
  if (sheafLift >= 0 && !scytheStuck) scytheUpright(c, f.armL, pose.armL ?? 0);
  if (scytheStuck && c.details) stuckTool(c, 'fld_scythe', F.x + sheafX - 0.15 * -dir, F.z + sheafZ + dir * 0.05, rot + 2.4, -2.23, HAND + 0.13, -0.12);
  if (sheaf > 0 || sheafLift >= 0) {
    const sy = c.ground(F.x + sheafX, F.z + sheafZ);
    mB.makeTranslation(F.x + sheafX, sy, F.z + sheafZ).multiply(mT.makeRotationY(rot)).multiply(mT.makeScale(UNIT_SCALE * 1.4, UNIT_SCALE * 1.4 * Math.max(0.3, sheaf), UNIT_SCALE * 1.4));
    if (sheafLift > 0) c.goodAt(G.WHEAT, blendM(mA, mB, shoulderSheaf(mDeer, f), sheafLift), 0, 0, 0);
    else c.goodAt(G.WHEAT, mB, 0, 0, 0);
  }
}

/** Kosa trzymana pionowo w dloni reki `arm` o wymachu `swing` ("na sztorc"): ostrze nad glowa, kosisko przy ziemi. */
function scytheUpright(c: WorkCtx, arm: THREE.Matrix4, swing: number): void {
  if (!c.details) return;
  mA.copy(arm).multiply(mT.makeTranslation(0, HAND, 0)).multiply(mT.makeRotationX(-2.23 - swing)).multiply(mT.makeTranslation(0, -HAND, 0));
  c.propM('fld_scythe', mA);
}

/** Snop na prawym ramieniu (lezy skosnie, klosy z tylu). */
function shoulderSheaf(out: THREE.Matrix4, f: RigFrames): THREE.Matrix4 {
  return out.copy(f.torso).multiply(mT.makeTranslation(0.1, SHOULDER + 0.03, 0.06)).multiply(mT.makeRotationX(-1.9))
    .multiply(mT.makeRotationZ(0.25)).multiply(mT.makeScale(1.4, 1.4, 1.4)).multiply(mT.makeTranslation(0, -0.07, 0));
}

/**
 * WORKING - siew: zaorana ziemia pojawia sie od razu, rolnik przechodzi pole trzy razy (tam i z powrotem),
 * w kazdym przejsciu cztery razy siega do worka i szerokim lukiem rozrzuca ziarno.
 */
function sowing(c: WorkCtx, serf: Serf): void {
  const F = c.cell(serf.target, w1);
  busyFields.add(serf.target);
  const p = c.progress(serf.timer, FARM_TICKS);
  const sec = FARM_TICKS * TICK_S;
  const dir = mowDir(c);
  c.plowCell(serf.target);
  const P0 = 0.04, P1 = 0.96, PASS = 3, THROWS = 4;
  const u = span(p, P0, P1) * PASS;
  const i = Math.min(PASS - 1, Math.floor(u)), k = u - i;
  const d = i % 2 ? -dir : dir;
  const x = SOW_X[i];
  const half = sowHalf(x);
  // Przejscie: wzdluz pola, na koncu nawrot.
  const walkK = smooth(span(k, 0.04, 0.96));
  const z = -d * half + d * 2 * half * walkK;
  const rot = d > 0 ? 0 : Math.PI;
  const gx = F.x + x, gz = F.z + z;
  const pose = poseAt(serf, gx, c.ground(gx, gz), gz, p < P0 ? (dir > 0 ? 0 : Math.PI) : rot);
  setSpot(serf, gx, pose.y, gz);
  pose.tool = null;
  const steps = walkK * 2 * half / 0.16;
  const legs = p > P0 && p < P1 ? Math.sin(steps * Math.PI) * 0.45 : 0;
  pose.legL = legs;
  pose.legR = -legs;
  pose.armL = -0.35;
  pose.armLYaw = 0.2;
  // Rzut: reka do worka przy lewym biodrze, potem szeroki luk w prawo i w gore, ziarno leci z dloni.
  const tu = span(k, 0.04, 0.96) * THROWS;
  const n = Math.min(THROWS - 1, Math.floor(tu)), f = tu - n;
  let throwAge = -1;
  if (p > P0 && p < P1) {
    if (f < 0.4) {
      const kk = smooth(f / 0.4);
      pose.armR = lerp(-0.9, -0.45, kk);
      pose.armRYaw = lerp(1.0, -0.75, kk);
      pose.twist = lerp(0.25, -0.2, kk);
    } else if (f < 0.72) {
      const kk = smooth((f - 0.4) / 0.32);
      pose.armR = lerp(-0.45, -1.45, kk);
      pose.armRYaw = lerp(-0.75, 1.1, kk);
      pose.twist = lerp(-0.2, 0.3, kk);
    } else {
      const kk = smooth((f - 0.72) / 0.28);
      pose.armR = lerp(-1.45, -0.9, kk);
      pose.armRYaw = lerp(1.1, 1.0, kk);
      pose.twist = 0.3 - 0.05 * kk;
    }
    throwAge = (f - 0.58) * ((P1 - P0) * sec) / (PASS * THROWS);
  } else {
    pose.armR = -0.2;
    pose.head = 0.3;
  }
  const fr = c.figure(pose);
  if (c.details) c.propAt('fld_seedbag', fr.torso, 0, 0, 0);
  if (throwAge > -0.5) {
    // Ziarno leci wachlarzem w prawo i do przodu, na zaorana ziemie (cel nie dalej niz 0.3 od srodka pola).
    pt(fr.armR, 0, HAND, 0, vA);
    let tx = x + rightX(rot) * 0.17 + Math.sin(rot) * 0.12, tz = z + rightZ(rot) * 0.17 + Math.cos(rot) * 0.12;
    const tl = Math.hypot(tx, tz);
    if (tl > 0.3) {
      tx *= 0.3 / tl;
      tz *= 0.3 / tl;
    }
    const FLY = 0.5;
    c.fx.burst(serf.id * 79 + i * 10 + n, throwAge, vA.x, vA.y, vA.z,
      { kind: 'bit', n: 12, life: 0.75, vx: (F.x + tx - vA.x) / FLY, vz: (F.z + tz - vA.z) / FLY, vy: 0.3, spread: 0.22, spreadY: 0.1, gravity: 2.2,
        size: 0.015, sizeEnd: 0.012, color: SEED, floor: F.y + 0.008, sound: 'scatter' });
  }
}

/** Miejsce, z ktorego rolnik zaczyna prace na polu (koniec dojscia). */
function farmStand(c: WorkCtx, serf: Serf): Vec3 {
  const F = c.cell(serf.target, w3);
  const dir = mowDir(c);
  if (c.s.map.obj[serf.target] === O.FIELD_RIPE) {
    const a = mowerAt(dir, 0, 0);
    F.x += a.x;
    F.z += a.z;
  } else {
    F.x += SOW_X[0];
    F.z += -dir * sowHalf(SOW_X[0]);
  }
  F.y = c.ground(F.x, F.z);
  return F;
}

function farmer(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.WORKING && serf.target >= 0 && !at.moving) {
    if (c.s.map.obj[serf.target] === O.FIELD_RIPE) harvesting(c, serf);
    else sowing(c, serf);
    return true;
  }
  smoothSteps(c, serf, at, serf.sub === WS.TO_TARGET && serf.target >= 0 ? farmStand(c, serf) : null);
  const pose = c.walkPose(serf, at);
  const harvestTrip = serf.sub === WS.TO_TARGET && serf.target >= 0 && c.s.map.obj[serf.target] === O.FIELD_RIPE;
  if (serf.carry === G.WHEAT) {
    // Snop na prawym ramieniu, kosa na sztorc w lewej rece.
    pose.carry = -1;
    pose.armR = -2.7;
    pose.armL = at.moving ? -Math.sin(at.walk) * 0.25 : 0;
    pose.tool = null;
    const f = c.figure(pose);
    c.goodAt(G.WHEAT, shoulderSheaf(mA, f), 0, 0, 0);
    scytheUpright(c, f.armL, pose.armL);
    return true;
  }
  const out = serf.sub === WS.TO_TARGET || serf.sub === WS.RETURN;
  if (harvestTrip) {
    // Kosa na sztorc w prawej rece, ostrzem nad glowa.
    pose.tool = null;
    pose.armR = (pose.armR ?? 0) * 0.4;
    const f = c.figure(pose);
    scytheUpright(c, f.armR, pose.armR);
    return true;
  }
  pose.tool = null;
  const f = c.figure(pose);
  if (out && c.details) c.propAt('fld_seedbag', f.torso, 0, 0, 0);
  return true;
}

/** Rzerysko po zniwach: zostaje chwile na zaoranej ziemi pustego pola i zapada sie w nia. */
function stubbleFields(c: WorkCtx): void {
  if (stubble.size === 0) return;
  for (const [cell, t] of stubble) {
    const age = c.time - t;
    if (age > STUBBLE_S || age < 0 || c.s.map.obj[cell] !== O.NONE) {
      if (age > 1) stubble.delete(cell);
      continue;
    }
    if (busyFields.has(cell)) continue;
    const F = c.cell(cell, w1);
    if (!c.inView(F.x, F.z)) continue;
    const k = 1 - smooth(clamp01((age - STUBBLE_S * 0.5) / (STUBBLE_S * 0.5)));
    c.plowCell(cell);
    for (const R of ROWS) {
      mA.makeTranslation(F.x + R.x, F.y - 0.06 * (1 - k), F.z - R.len / 2).multiply(mT.makeScale(1, Math.max(0.05, k), R.len / ROW_MODEL_LEN));
      c.propM('fld_stubble', mA);
    }
  }
}

// ---------------------------------------------------------------- rejestr

/** Porzadki w pamieci scen (rzadko): wpisy osadnikow i zwierzat, ktorych juz nie ma. */
function prune(c: WorkCtx): void {
  if (c.s.tick % 50 !== 0) return;
  for (const id of workSpots.keys()) if (!c.s.serfs[id]) workSpots.delete(id);
  for (const id of pickups.keys()) if (!c.s.serfs[id]) pickups.delete(id);
  for (const id of lastCarcass.keys()) if (!c.s.serfs[id]) lastCarcass.delete(id);
  for (const id of deaths.keys()) if (!c.s.animals[id]?.dead) deaths.delete(id);
  for (const id of deerRot.keys()) if (!c.s.animals[id]) deerRot.delete(id);
  for (const id of beds.keys()) if (!c.s.buildings[id]) beds.delete(id);
}

function frame(c: WorkCtx): void {
  stubbleFields(c);
  busyFields.clear();
  prune(c);
}

export const fieldScenes: Scenes = {
  serf: {
    [S.FORESTER]: forester,
    [S.STONECUTTER]: stonecutter,
    [S.FISHER]: fisher,
    [S.HUNTER]: hunter,
    [S.FARMER]: farmer,
  },
  building: { [B.FORESTER]: foresterHut, [B.STONECUTTER]: stonecutterHut, [B.FISHER]: fisherHut, [B.HUNTER]: hunterHut },
  animal,
  frame,
};
