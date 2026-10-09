/**
 * Gornictwo i metal, drewno: sceny przed budynkami w trakcie cyklu warsztatu. Pracownik jest w symulacji
 * w srodku budynku; w trakcie cyklu (b.phase != 0) scena rysuje go przed budynkiem przy pracy, a gdy wynosi
 * wyrob na flage (b.phase === 0), nie rysuje go.
 * - Gornik: kolo wyciagu kreci sie (urobek jedzie szybem), gornik wypycha z szopy wozek po szynach, przechyla
 *   skrzynie nad kupka (urobek sie zsypuje) i wciaga wozek z powrotem; dwa kursy na cykl, w pustym cyklu
 *   (brak zloza) wozek jest pusty, a gornik kreci glowa.
 * - Hutnik (w masce): wyjmuje kleszczami tygiel z pieca, przelewa go pomaranczowa struga do formy i odnosi;
 *   wlewek stygnie. Z komina ida dym i iskry, w ujsciu pieca zarzy sie zar.
 * - Kowal narzedzi i platnerz: grzeje pret w palenisku, kuje go na kowadle (iskry przy kazdym uderzeniu), grzeje
 *   drugi raz, hartuje w beczce (bucha para) i kladzie na kowadle gotowe narzedzie albo miecz z tarcza.
 * - Mincerz: kladzie krazek zlota na kowadelku, wybija stemplem i mlotkiem (zloto blyska), odklada monete na stosik.
 * - Szkutnik: przynosi deski ze stosu i przybija je do wregow lodzi na pochylni - poszycie rosnie deska po desce.
 * - Smolarz: obchodzi mielerz, narzuca lopata ziemie i ubija ja; dym gestnieje w miare wypalania.
 */
import * as THREE from 'three';
import { B, BUILDINGS, FIRST_TOOL, G, S, TICKS_PER_SECOND } from '../../../sim/defs.ts';
import type { Building } from '../../../sim/types.ts';
import { ARM_X, HAND, SHOULDER, UNIT_SCALE, type Pose, type RigFrames } from '../rig.ts';
import type { Origin, Scenes, Vec3, WorkCtx } from './types.ts';

// ---------------------------------------------------------------- pomocnicze

/** Modele budynkow sa obrocone o 30 stopni ku fladze (jak BROT w entities.ts). */
const BROT = Math.PI / 6;
const COS30 = Math.cos(BROT);
const SIN30 = Math.sin(BROT);
/** Faza chodu na jednostke drogi w swiecie (pelny cykl krokow na pol pola). */
const WALK_K = Math.PI * 4;

const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mC = new THREE.Matrix4();
const vA = new THREE.Vector3();
const vX = new THREE.Vector3();
const vY = new THREE.Vector3();
const vZ = new THREE.Vector3();
/** Obie strony (szyny, burty). */
const SIDES = [-1, 1] as const;
const pA: Vec3 = { x: 0, y: 0, z: 0 };
const pB: Vec3 = { x: 0, y: 0, z: 0 };
const pC: Vec3 = { x: 0, y: 0, z: 0 };
const dW: Vec3 = { x: 0, y: 0, z: 0 };

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function ease(t: number): number {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

/** Wygladzony postep odcinka [a, b] osi czasu u. */
function span(u: number, a: number, b: number): number {
  return ease((u - a) / (b - a));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Obrot od a do b najkrotsza droga. */
function turn(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Obrot postaci patrzacej w kierunku (dx, dy) ukladu modelu budynku. */
function modelRot(dx: number, dy: number): number {
  return Math.atan2(dx * COS30 - dy * SIN30, -(dx * SIN30 + dy * COS30));
}

/** Kierunek (dx, dy, dz) ukladu modelu w swiecie (wynik w dW). */
function modelDir(dx: number, dy: number, dz: number): Vec3 {
  dW.x = dx * COS30 - dy * SIN30;
  dW.y = dz;
  dW.z = -(dx * SIN30 + dy * COS30);
  return dW;
}

/** Kolor posredni (kanaly sRGB) miedzy a i b. */
function mixHex(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Kolor z rampy [t0, kolor0, t1, kolor1, ...] (t rosnaco). */
function ramp(stops: readonly number[], t: number): number {
  if (t <= stops[0]) return stops[1];
  for (let i = 2; i < stops.length; i += 2) {
    if (t <= stops[i]) return mixHex(stops[i - 1], stops[i + 1], (t - stops[i - 2]) / (stops[i] - stops[i - 2]));
  }
  return stops[stops.length - 1];
}

/** Zelazo wg temperatury 0..1: stal, ciemna czerwien, pomarancz, zolty zar. */
const HEAT = [0, 0x5a6068, 0.22, 0x6e3a2c, 0.42, 0xb8381a, 0.7, 0xff7a24, 1, 0xffe08a];
/** Zar paleniska (pulsuje miedzy tymi kolorami). */
const EMBER_LO = 0xd8401a;
const EMBER_HI = 0xffc246;
const STEAM = 0xf4f6f8;

/** Ukladanie nog i podskoku idacej postaci dla fazy chodu ph. */
function stride(p: Pose, ph: number, amp = 0.55): Pose {
  p.legL = Math.sin(ph) * amp;
  p.legR = -p.legL;
  p.bob = Math.abs(Math.sin(ph)) * 0.012;
  return p;
}

/** Punkt na lamanej (x0, y0, x1, y1, ...) w ukladzie modelu po przejsciu czesci t jej dlugosci, kierunek i droga. */
const PATH = { x: 0, y: 0, dx: 0, dy: 1, dist: 0 };
function along(pts: readonly number[], t: number): typeof PATH {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  let d = clamp01(t) * total;
  PATH.dist = d;
  PATH.x = pts[0];
  PATH.y = pts[1];
  for (let i = 2; i < pts.length; i += 2) {
    const sx = pts[i] - pts[i - 2], sy = pts[i + 1] - pts[i - 1];
    const len = Math.hypot(sx, sy);
    if (len > 1e-6) {
      PATH.dx = sx / len;
      PATH.dy = sy / len;
    }
    if (d <= len || i === pts.length - 2) {
      const k = len > 1e-6 ? Math.min(1, d / len) : 1;
      PATH.x = pts[i - 2] + sx * k;
      PATH.y = pts[i - 1] + sy * k;
      return PATH;
    }
    d -= len;
  }
  return PATH;
}

/**
 * Prostopadloscian ind_box w swiecie: od srodka sciany a do srodka sciany b, wysokosc h wzdluz kierunku
 * (ux, uy, uz) (rzutowanego prostopadle do a-b), grubosc w.
 */
function slab(c: WorkCtx, a: Vec3, b: Vec3, w: number, h: number, ux: number, uy: number, uz: number, color: number): void {
  vY.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = vY.length();
  if (len < 1e-6) return;
  vY.divideScalar(len);
  vX.set(ux, uy, uz).addScaledVector(vY, -(ux * vY.x + uy * vY.y + uz * vY.z));
  if (vX.lengthSq() < 1e-9) vX.set(-vY.y, vY.x, 0);
  vX.normalize();
  vZ.crossVectors(vY, vX);
  mA.makeBasis(vY.multiplyScalar(len), vX.multiplyScalar(h), vZ.multiplyScalar(w));
  mA.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  c.propM('ind_box', mA, color);
}

/** Prostopadloscian ind_box w ukladzie modelu budynku: srodek (lx, ly, lz), wymiary wzdluz X i Y modelu i w gore. */
function boxAt(c: WorkCtx, o: Origin, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number): void {
  mA.copy(c.frameOf(o)).multiply(mB.makeTranslation(lx, lz, -ly)).multiply(mC.makeScale(sx, sz, sy));
  c.propM('ind_box', mA, color);
}

/** Punkt (x, y, z) w ukladzie stawu postaci (np. koniec kleszczy w lewej rece) w swiecie - wynik w vA. */
function jointPoint(frame: THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3 {
  return vA.set(x, y, z).applyMatrix4(frame);
}

/** Uklad modelu budynku przesuniety do punktu (lx, ly) na wysokosc swiata wy (wynik w out). */
function frameAt(c: WorkCtx, o: Origin, lx: number, ly: number, wy: number, out: THREE.Matrix4): THREE.Matrix4 {
  const p = c.at(o, lx, ly, 0, pC);
  return out.makeTranslation(p.x, wy, p.z).multiply(mC.makeRotationY(BROT)).multiply(mB.makeScale(o.sc, o.sc, o.sc));
}

/**
 * Wysokosc podloza w punkcie (lx, ly) ukladu modelu: przy scianach poziom budynku, na podworku teren - jak
 * sprzety modelu budynku (WorkCtx.floor); postacie i sprzety przed budynkiem na stoku nie zapadaja sie ani nie wisza.
 */
function floorAt(c: WorkCtx, o: Origin, lx: number, ly: number): number {
  return c.floor(o, lx, ly);
}

/** Sprzet stojacy przed budynkiem (model w jednostkach budynku) na podlozu w (lx, ly); zwraca wysokosc podloza. */
function fixture(c: WorkCtx, o: Origin, name: string, lx: number, ly: number, color?: number): number {
  const y = floorAt(c, o, lx, ly);
  c.propM(name, frameAt(c, o, lx, ly, y, mA), color);
  return y;
}

/** Pracuje (cykl warsztatu trwa, pracownik w srodku): postep cyklu 0..1, albo -1. */
function working(c: WorkCtx, b: Building): number {
  if (b.paused || !c.workerInside(b)) return -1;
  return c.cycle(b);
}

/** Czas cyklu budynku w sekundach animacji (do wieku wyrzutow czasteczek). */
function cycleSeconds(b: Building): number {
  return BUILDINGS[b.kind].cycle / TICKS_PER_SECOND;
}

/** Klucz czasteczek budynku (rozne zrodla tego samego budynku: k = 0..31). */
function fxKey(b: Building, k: number): number {
  return 50000 + b.id * 32 + k;
}

/** Dym z komina (gestosc 0..1) - opcjonalnie z iskrami. */
function chimneySmoke(c: WorkCtx, o: Origin, b: Building, x: number, y: number, z: number, strength: number, color: number, sparks: number): void {
  const p = c.at(o, x, y, z, pC);
  c.fx.smoke(fxKey(b, 0), p.x, p.y, p.z, strength, color);
  if (sparks > 0) {
    c.fx.stream(fxKey(b, 1), p.x, p.y, p.z, {
      kind: 'bit', n: 6, life: 1.0, vy: 0.42, spread: 0.1, spreadY: 0.12, gravity: -0.12, size: 0.017, sizeEnd: 0.005,
      color: 0xffd060, colorEnd: 0xff4a12, jitter: 0.015, sway: 0.02,
    }, sparks);
  }
}

// ---------------------------------------------------------------- gornik

/**
 * Kopalnia w ukladzie modelu (railY jak MINE_RAIL_Y w art/scripts/buildings.py): tor wzdluz X, od wylotu
 * w lewej scianie szopy do odbojnicy, za nia kupka urobku. Kopalnie stoja na niewyrownanych stokach, wiec tor,
 * kupka, wozek i gornik ida po terenie (przy szopie tor schodzi do poziomu budynku).
 */
const MINE = {
  railY: -0.08,
  /** poczatek toru (przy wylocie) i koniec (odbojnica) */
  rail0: -0.076,
  rail1: -0.32,
  /** rozstaw szyn (od osi) */
  gauge: 0.027,
  /** srodek podwozia wozka w szopie (niewidoczny) i przy odbojnicy */
  cartIn: 0.05,
  cartOut: -0.256,
  /** gornik stoi za wozkiem, od strony szopy */
  push: 0.122,
  /** skala wozka (modele ind_cart, ind_tub, ind_load), dno skrzyni nad torem, polowa dlugosci skrzyni */
  cart: 1.2,
  tubZ: 0.036,
  tubHalf: 0.05,
  /** kopka urobku w skrzyni (nad dnem) */
  loadZ: 0.036,
  /** srodek kupki urobku i wysokosc jej wierzchu */
  pileX: -0.392,
  pileTop: 0.04,
  /** os kola linowego (headframe: x, y - 0.09, h + 0.055) */
  sheave: { x: 0.06, y: 0.05, z: 0.555 },
};
/** Podklady toru (x). */
const SLEEPERS = [-0.1, -0.15, -0.2, -0.25, -0.3] as const;
/** Punkty toru, w ktorych szyny dopasowuja sie do terenu (x). */
const RAIL_PTS = [-0.076, -0.11, -0.15, -0.2, -0.26, -0.32] as const;
/** Kurs wozka (p = 0..1, dwa kursy na cykl): wyciaganie, wypychanie, przechyl, powrot, opuszczanie klatki. */
const TRIP = { push: 0.22, stop: 0.5, tip: 0.54, full: 0.6, lower: 0.68, level: 0.74, back: 0.76, lowerCage: 0.88 };
/** Najwiekszy przechyl skrzyni przy wysypywaniu (rad). */
const TIP_MAX = 0.88;
/** Urobek wg kopalni i pyl nad kupka przy zsypywaniu. */
const ORE: Partial<Record<number, number>> = { [B.COALMINE]: 0x3a3a40, [B.IRONMINE]: 0x8a4f3d, [B.GOLDMINE]: 0xd2ad4e, [B.STONEMINE]: 0xc4c0b8 };
const ORE_DUST: Partial<Record<number, number>> = { [B.COALMINE]: 0x6e6e72, [B.IRONMINE]: 0xa8806e, [B.GOLDMINE]: 0xd8c896, [B.STONEMINE]: 0xd8d4cc };
const RAIL = 0x4a4f56;
const SLEEPER = 0x5e4128;
/** Okruchy zlota na kupce (przesuniecie od srodka kupki i wysokosc). */
const GOLD_GLINTS = [[-0.02, -0.02, 0.036], [0.03, 0.015, 0.03], [0.005, -0.07, 0.02], [-0.04, 0.03, 0.022], [0.02, 0.06, 0.016]] as const;
/** Macierze podwozia i skrzyni wozka w biezacej klatce. */
const CART = new THREE.Matrix4();
const TUB = new THREE.Matrix4();

/** Wysokosc toru (swiat) w punkcie lx: przy wylocie poziom budynku, dalej teren (podworko, WorkCtx.floor). */
function railH(c: WorkCtx, o: Origin, lx: number): number {
  return c.floor(o, lx, MINE.railY) + 0.003;
}

/** Tor (szyny na podkladach, odbojnica) i kupka urobku - na wysokosci terenu. */
function mineTrack(c: WorkCtx, o: Origin, b: Building, ore: number): void {
  const y = MINE.railY;
  const t = 0.008 * o.sc;
  for (let i = 1; i < RAIL_PTS.length; i++) {
    const h0 = railH(c, o, RAIL_PTS[i - 1]), h1 = railH(c, o, RAIL_PTS[i]);
    for (const s of SIDES) {
      c.at(o, RAIL_PTS[i - 1], y + s * MINE.gauge, 0, pA).y = h0 + t;
      c.at(o, RAIL_PTS[i], y + s * MINE.gauge, 0, pB).y = h1 + t;
      slab(c, pA, pB, t, t, 0, 1, 0, RAIL);
    }
  }
  for (const x of SLEEPERS) {
    const h = railH(c, o, x);
    c.at(o, x, y - 0.04, 0, pA).y = h + t * 0.4;
    c.at(o, x, y + 0.04, 0, pB).y = h + t * 0.4;
    slab(c, pA, pB, 0.016 * o.sc, t * 0.9, 0, 1, 0, SLEEPER);
  }
  const hs = railH(c, o, MINE.rail1 - 0.01);
  c.at(o, MINE.rail1 - 0.01, y - 0.036, 0, pA).y = hs + 0.012 * o.sc;
  c.at(o, MINE.rail1 - 0.01, y + 0.036, 0, pB).y = hs + 0.012 * o.sc;
  slab(c, pA, pB, 0.02 * o.sc, 0.024 * o.sc, 0, 1, 0, 0x7a3a1b);
  const pp = c.at(o, MINE.pileX, y, 0, pA);
  const g = c.ground(pp.x, pp.z);
  c.propM('ind_pile', frameAt(c, o, MINE.pileX, y, g, mA), ore);
  if (b.kind === B.GOLDMINE) {
    for (const [dx, dy, dz] of GOLD_GLINTS) {
      frameAt(c, o, MINE.pileX + dx, y + dy, g, mA).multiply(mB.makeTranslation(0, dz, 0)).multiply(mC.makeRotationY(dx * 40))
        .multiply(mB.makeScale(0.012, 0.012, 0.012));
      c.propM('ind_box', mA, 0xffd65a);
    }
  }
}

/**
 * Kopalnia: kolo linowe kreci sie, gdy szybem jedzie urobek; potem gornik wypycha z szopy wozek po szynach,
 * przechyla skrzynie nad kupka (urobek sie zsypuje, unosi sie pyl) i wciaga wozek z powrotem.
 */
function mine(c: WorkCtx, b: Building, o: Origin): void {
  const ore = ORE[b.kind] ?? 0x808080;
  mineTrack(c, o, b, ore);
  const u = working(c, b);
  const k = u < 0 ? 0 : u * 2;
  const p = k - Math.floor(k);
  // Kolo: 1.5 obrotu przy wyciaganiu urobku i tyle samo wstecz, gdy pusty wozek wraca do szybu (wielokrotnosc
  // 60 stopni - szprychy wracaja na swoje miejsca).
  const spin = u < 0 ? 0 : (ease(p / TRIP.push) - span(p, TRIP.lowerCage, 1)) * Math.PI * 3;
  const sh = MINE.sheave;
  c.propAt('ind_sheave', c.frameOf(o), sh.x, sh.z, -sh.y, 0, 0, spin);
  if (u < 0 || p < TRIP.push) return;
  const empty = b.phase === 2;
  const cs = MINE.cart;
  let cx: number;
  let tilt = 0;
  let ph = 0;
  const pulling = p >= TRIP.back;
  if (p < TRIP.stop) {
    cx = lerp(MINE.cartIn, MINE.cartOut, span(p, TRIP.push, TRIP.stop));
    ph = (MINE.cartIn - cx) * o.sc * WALK_K;
  } else if (!pulling) {
    cx = MINE.cartOut;
    tilt = (span(p, TRIP.tip, TRIP.full) - span(p, TRIP.lower, TRIP.level)) * (empty ? 0.5 : TIP_MAX);
  } else {
    cx = lerp(MINE.cartOut, MINE.cartIn, span(p, TRIP.back, 1));
    ph = (MINE.cartIn - cx) * o.sc * WALK_K;
  }
  // Podwozie na szynach, pochylone wg toru; skrzynia obraca sie wokol przedniej krawedzi dna (tyl unosi gornik).
  const wb = 0.034 * cs;
  const hF = railH(c, o, cx - wb), hR = railH(c, o, cx + wb);
  const pitch = Math.max(-0.4, Math.min(0.4, Math.atan2(hR - hF, 2 * wb * o.sc)));
  frameAt(c, o, cx, MINE.railY, (hF + hR) / 2, mA).multiply(mB.makeRotationZ(pitch)).multiply(mC.makeScale(cs, cs, cs));
  CART.copy(mA);
  c.propM('ind_cart', CART);
  TUB.copy(CART).multiply(mB.makeTranslation(-MINE.tubHalf, MINE.tubZ, 0)).multiply(mC.makeRotationZ(tilt))
    .multiply(mB.makeTranslation(MINE.tubHalf, 0, 0));
  c.propM('ind_tub', TUB);
  // Urobek zsuwa sie ze skrzyni do przodu, gdy przechyl jest pelny.
  const slide = clamp01((p - TRIP.full + 0.025) / 0.07);
  if (!empty && slide < 1) {
    mA.copy(TUB).multiply(mC.makeTranslation(-0.04 * slide, MINE.loadZ - 0.01 * slide, 0))
      .multiply(mC.makeScale(1 - slide * 0.6, 1 - slide * 0.95, 1 - slide * 0.5));
    c.propM('ind_load', mA, ore);
    if (b.kind === B.GOLDMINE && c.details) {
      const g = jointPoint(TUB, 0, MINE.loadZ + 0.02, 0);
      c.fx.stream(fxKey(b, 4), g.x, g.y, g.z, { kind: 'bit', n: 2, life: 0.35, size: 0.012, sizeEnd: 0, color: 0xfff2a8, jitter: 0.04 });
    }
  }
  if (!empty && p > TRIP.full - 0.02 && p < TRIP.lower + 0.02) {
    // Struga urobku z przedniej krawedzi skrzyni na kupke i pyl nad kupka.
    const lip = jointPoint(TUB, -0.055, 0.042, 0);
    const d = modelDir(-1, 0, 0);
    const pile = c.at(o, MINE.pileX, MINE.railY, 0, pA);
    const top = c.ground(pile.x, pile.z) + MINE.pileTop * o.sc;
    c.fx.stream(fxKey(b, 2), lip.x, lip.y, lip.z, {
      kind: 'bit', n: 9, life: 0.42, vx: d.x * 0.25, vz: d.z * 0.25, vy: -0.05, spread: 0.08, spreadY: 0.05, gravity: 2.4,
      size: 0.024, sizeEnd: 0.018, color: ore, jitter: 0.018, floor: top - 0.01,
    });
    c.fx.stream(fxKey(b, 3), pile.x, top, pile.z, {
      kind: 'puff', n: 5, life: 1.1, vy: 0.1, spread: 0.07, spreadY: 0.03, size: 0.03, sizeEnd: 0.1,
      color: ORE_DUST[b.kind] ?? 0xb0b0b0, colorEnd: 0xd8d4cc, jitter: 0.04, fade: 0.5,
    });
  }
  // Gornik za wozkiem: pcha pochylony, przy przechyle unosi uchwyty i podchodzi blizej, wciaga wozek tylem.
  const lift = tilt / TIP_MAX;
  const mx = cx + MINE.push - 0.035 * lift;
  const at = c.at(o, mx, MINE.railY, 0, pB);
  const pose: Pose = {
    x: at.x, y: railH(c, o, mx), z: at.z, rot: modelRot(-1, 0), owner: b.owner, type: S.MINER, tool: null,
    lean: pulling ? 0.05 : 0.4 - lift * 0.2, armR: -1.12 - lift * 0.65, armL: -1.12 - lift * 0.65, armROut: -0.12, armLOut: -0.12,
    head: pulling ? 0.1 : 0.25,
  };
  if (ph !== 0) stride(pose, ph, pulling ? 0.38 : 0.5);
  else {
    pose.legL = -0.25;
    pose.legR = 0.3;
  }
  if (empty && p > TRIP.full && p < TRIP.lower) pose.headTurn = Math.sin(c.time * 8) * 0.5;
  c.figure(pose);
}

// ---------------------------------------------------------------- hutnik

/** Huta w ukladzie modelu (jak steelworks w art/scripts/buildings.py). */
const SMELT = {
  /** ujscie pieca: srodek otworu w kamiennej obudowie i wierzch progu */
  mouth: { x: -0.13, y: -0.197, z: 0.09, sill: 0.05 },
  /** hutnik twarza do pieca: tygiel w piecu / wyjety */
  inFurnace: { x: -0.13, y: -0.33 },
  outFurnace: { x: -0.13, y: -0.425 },
  /** hutnik przy formie (twarza ku -X, tygiel nad forma) i dno rowka formy */
  pour: { x: -0.115, y: -0.275 },
  mold: { x: -0.352, y: -0.275, z: 0.026 },
  /** hutnik patrzy, jak stygnie wlewek */
  watch: { x: -0.2, y: -0.38 },
  chimney: { x: 0.14, y: 0.12, z: 0.74 },
};
/** Cykl huty: tygiel w piecu, wyjecie, przejscie, przelewanie (przechyl, struga, powrot), odniesienie, stygniecie. */
const SMELT_T = { pull: 0.14, carry: 0.22, pour: 0.32, tilt: 0.4, stop: 0.56, level: 0.62, back: 0.72, stow: 0.8, out: 0.86, watch: 0.92 };
/** Tygiel: zar po wyjeciu z pieca, stygnacy po wylaniu. */
const CRUCIBLE = [0, 0x7a5a4c, 0.5, 0xa0482a, 1, 0xff8a3a];
/** Wlewek w formie: od zoltego zaru do szarej stali. */
const INGOT = [0, 0xffd870, 0.25, 0xff7a24, 0.55, 0xa83a1c, 0.8, 0x6a4a42, 1, 0x7a8088];
/** Tygiel w kleszczach: srodek (od barku, jednostki postaci) i skala modelu ind_crucible. */
const CRUCIBLE_Y = HAND - 0.245;
const CRUCIBLE_S = 1.6;
/** Wysokosc tygla nad stopami hutnika (swiat): niesiony na wysokosci pasa, nad forma wyzej (struga do formy). */
const CARRY_H = 0.14;
const POUR_H = 0.15;
const LEAN_POUR = 0.25;

/** Wymach ramion z kleszczami, przy ktorym srodek tygla jest na wysokosci h (swiat) nad stopami hutnika. */
function armFor(h: number, lean: number): number {
  const shoulder = 0.14 + (SHOULDER - 0.14) * Math.cos(lean);
  const k = (shoulder - h / UNIT_SCALE) / -CRUCIBLE_Y;
  return -Math.acos(Math.max(-1, Math.min(1, k))) - lean;
}

/** Tygiel w kleszczach trzymanych oburacz: pionowo, przechylony do przodu o tilt; zwraca macierz tygla w mA. */
function crucibleAt(c: WorkCtx, f: RigFrames, lean: number, arm: number, tilt: number, heat: number, full: number): THREE.Matrix4 {
  mA.copy(f.armR).multiply(mB.makeTranslation(-ARM_X, CRUCIBLE_Y, 0)).multiply(mC.makeRotationX(-(lean + arm) + tilt))
    .multiply(mB.makeScale(CRUCIBLE_S, CRUCIBLE_S, CRUCIBLE_S));
  c.propM('ind_crucible', mA, ramp(CRUCIBLE, heat));
  if (full > 0) {
    mB.copy(mA).multiply(mC.makeTranslation(0, 0.016 + 0.01 * full, 0)).multiply(mC.makeScale(0.05, 0.05, 0.05));
    c.propM('ind_coin', mB, mixHex(0xff9a30, 0xffe070, 0.5 + 0.5 * Math.sin(c.time * 9)));
  }
  return mA;
}

/** Zar w ujsciu pieca: zarzace sie wnetrze otworu, jasny zar u jego dolu i wegle na progu; k = jasnosc 0..1. */
function furnaceGlow(c: WorkCtx, o: Origin, b: Building, k: number): void {
  const m = SMELT.mouth;
  const flick = 0.5 + 0.5 * Math.sin(c.time * 6.3 + b.id) * Math.sin(c.time * 2.7 + 1);
  boxAt(c, o, m.x, m.y - 0.002, m.z + 0.004, 0.068, 0.004, 0.066, mixHex(0x3a1208, 0x8a2a10, k));
  boxAt(c, o, m.x, m.y - 0.004, m.z - 0.02, 0.064, 0.004, 0.026, mixHex(0x8a2a10, mixHex(EMBER_LO, EMBER_HI, flick), k));
  mA.copy(c.frameOf(o)).multiply(mB.makeTranslation(m.x, m.sill, -(m.y - 0.014))).multiply(mC.makeScale(0.6, 0.7, 0.45));
  c.propM('ind_embers', mA, mixHex(0x6a2412, mixHex(EMBER_LO, EMBER_HI, 1 - flick), k));
}

/**
 * Huta: hutnik wsuwa kleszcze do pieca, wyjmuje tygiel, przechodzi do formy i przelewa go pomaranczowa struga
 * (iskry pryskaja z formy), odnosi tygiel do pieca i patrzy, jak stygnie wlewek. Z komina dym i iskry.
 */
function steelworks(c: WorkCtx, b: Building, o: Origin): void {
  const u = working(c, b);
  furnaceGlow(c, o, b, u < 0 ? 0.25 : 1);
  const moldY = fixture(c, o, 'ind_mold', SMELT.mold.x, SMELT.mold.y);
  if (u < 0) return;
  const T = SMELT_T;
  chimneySmoke(c, o, b, SMELT.chimney.x, SMELT.chimney.y, SMELT.chimney.z, 1, 0x6e6a66, 1);
  // Polozenie hutnika (uklad modelu), kierunek patrzenia i faza chodu.
  const toFurnace = modelRot(0, 1);
  const toMold = modelRot(-1, 0);
  let x: number, y: number, rot: number, ph = 0;
  // Tygiel: na wysokosci ujscia pieca (atF = 1), niesiony (0) albo nad forma (atP = 1); przechyl, zawartosc, zar.
  let atF = 0, atP = 0, arm = 0;
  let lean = 0.18, tilt = 0, full = 1, heat = 1, holding = true;
  if (u < T.pull + 0.03) {
    // Iskry z ujscia, gdy hutnik obraca tygiel w zarze i go wyjmuje.
    const mp = c.at(o, SMELT.mouth.x, SMELT.mouth.y - 0.01, SMELT.mouth.z, pB);
    const d = modelDir(0, -1, 0);
    c.fx.stream(fxKey(b, 7), mp.x, mp.y, mp.z, {
      kind: 'bit', n: 4, life: 0.5, vx: d.x * 0.25, vz: d.z * 0.25, vy: 0.35, spread: 0.15, gravity: 1.5, size: 0.012, sizeEnd: 0.004,
      color: 0xffe080, colorEnd: 0xff5a18, jitter: 0.02,
    });
  }
  if (u < T.pull) {
    // Kleszcze w piecu: hutnik obraca tygiel w zarze.
    x = SMELT.inFurnace.x;
    y = SMELT.inFurnace.y;
    rot = toFurnace;
    atF = 1;
    lean = 0.22;
  } else if (u < T.carry) {
    const s = span(u, T.pull, T.carry);
    x = SMELT.inFurnace.x;
    y = lerp(SMELT.inFurnace.y, SMELT.outFurnace.y, s);
    rot = toFurnace;
    ph = -s * 0.09 * o.sc * WALK_K;
    atF = 1 - s;
  } else if (u < T.pour) {
    const s = span(u, T.carry, T.pour);
    x = lerp(SMELT.outFurnace.x, SMELT.pour.x, s);
    y = lerp(SMELT.outFurnace.y, SMELT.pour.y, s);
    rot = turn(toFurnace, toMold, ease((u - T.carry) / (T.pour - T.carry) * 1.6));
    ph = s * 0.15 * o.sc * WALK_K;
  } else if (u < T.back) {
    x = SMELT.pour.x;
    y = SMELT.pour.y;
    rot = toMold;
    const pourUp = span(u, T.pour + 0.01, T.tilt) - span(u, T.stop, T.level);
    tilt = pourUp * 1.95;
    atP = pourUp;
    lean = lerp(0.18, LEAN_POUR, pourUp);
    full = 1 - span(u, T.tilt, T.stop);
    heat = 1 - span(u, T.tilt, T.level) * 0.45;
    if (u >= T.level) {
      // Z pustym tyglem z powrotem do pieca.
      const s = span(u, T.level, T.back);
      x = lerp(SMELT.pour.x, SMELT.outFurnace.x, s);
      y = lerp(SMELT.pour.y, SMELT.outFurnace.y, s);
      rot = turn(toMold, toFurnace, ease((u - T.level) / (T.back - T.level) * 1.6));
      ph = s * 0.15 * o.sc * WALK_K;
      tilt = 0;
    }
  } else if (u < T.out) {
    // Odstawia tygiel do pieca i cofa sie.
    const s = u < T.stow ? span(u, T.back, T.stow) : 1 - span(u, T.stow, T.out);
    x = SMELT.inFurnace.x;
    y = lerp(SMELT.outFurnace.y, SMELT.inFurnace.y, s);
    rot = toFurnace;
    ph = s * 0.09 * o.sc * WALK_K;
    atF = s;
    full = 0;
    heat = 0.55;
    holding = u < T.stow;
    arm = -1.0;
  } else {
    // Podchodzi do formy i patrzy na stygnacy wlewek; szczeki kleszczy oparte o ziemie.
    const s = span(u, T.out, T.watch);
    x = lerp(SMELT.outFurnace.x, SMELT.watch.x, s);
    y = lerp(SMELT.outFurnace.y, SMELT.watch.y, s);
    rot = turn(toFurnace, modelRot(SMELT.mold.x - SMELT.watch.x, SMELT.mold.y - SMELT.watch.y), ease(s * 1.5));
    ph = s * 0.11 * o.sc * WALK_K;
    arm = -0.62;
    lean = 0.12;
    holding = false;
  }
  const at = c.at(o, x, y, 0, pA);
  const fy = floorAt(c, o, x, y);
  if (holding) {
    const furnaceH = Math.max(0.11, o.y + SMELT.mouth.z * o.sc - fy);
    const pourH = moldY + SMELT.mold.z * o.sc + POUR_H - fy;
    arm = armFor(lerp(lerp(CARRY_H, furnaceH, atF), pourH, atP), lean) + (u < T.pull ? Math.sin(c.time * 2.4) * 0.04 : 0);
  }
  const pose: Pose = {
    x: at.x, y: fy, z: at.z, rot, owner: b.owner, type: S.SMELTER, tool: 'ind_ctongs',
    lean, armR: arm, armL: arm, head: holding ? 0.3 : 0.45,
  };
  if (Math.abs(ph) > 1e-3) stride(pose, ph, 0.42);
  else {
    pose.legL = -0.2;
    pose.legR = 0.22;
  }
  const f = c.figure(pose);
  // Tygiel w piecu (przed wyjeciem i po odstawieniu) jest niewidoczny.
  const inFurnace = u < T.pull + 0.012 || (u > T.stow - 0.01 && u < T.out);
  if (holding && !inFurnace) {
    const cm = crucibleAt(c, f, lean, arm, tilt, heat, full);
    if (full > 0 && tilt < 0.6) {
      // Opary nad roztopionym metalem.
      const top = jointPoint(cm, 0, 0.03, 0);
      c.fx.stream(fxKey(b, 5), top.x, top.y, top.z, {
        kind: 'puff', n: 3, life: 1.1, vy: 0.12, spread: 0.02, size: 0.014, sizeEnd: 0.05, color: 0xe8e0d8, colorEnd: 0xc8c6c2, fade: 0.5, sway: 0.02,
      });
    }
    if (tilt > 1.15 && full > 0.02) {
      // Struga z dzioba tygla do formy i iskry pryskajace z formy.
      const lip = jointPoint(cm, 0, 0.026, 0.034);
      pB.x = lip.x;
      pB.y = lip.y;
      pB.z = lip.z;
      const fill = span(u, T.tilt, T.stop);
      const mold = c.at(o, SMELT.mold.x, SMELT.mold.y, SMELT.mold.z + fill * 0.008, pC);
      mold.y += moldY - c.floor(o, SMELT.mold.x, SMELT.mold.y);
      slab(c, pB, mold, 0.017, 0.017, 1, 0, 0, mixHex(0xff9a30, 0xffd868, 0.5 + 0.5 * Math.sin(c.time * 23)));
      c.fx.stream(fxKey(b, 6), mold.x, mold.y + 0.01, mold.z, {
        kind: 'bit', n: 6, life: 0.32, vy: 0.55, spread: 0.32, spreadY: 0.15, gravity: 3.2, size: 0.011, sizeEnd: 0.005,
        color: 0xffe080, colorEnd: 0xff5a18, floor: moldY,
      });
    }
  }
  // Wlewek w formie: rosnie przy przelewaniu, potem stygnie (zolty zar -> stal).
  if (u > T.tilt) {
    const fill = span(u, T.tilt, T.stop);
    const cool = clamp01((u - T.stop) / (1 - T.stop));
    const h = 0.003 + 0.009 * fill;
    boxAt(c, o, SMELT.mold.x, SMELT.mold.y, SMELT.mold.z + h / 2 + (moldY - o.y) / o.sc, 0.082, 0.026, h, ramp(INGOT, cool));
    if (cool > 0 && cool < 0.6) {
      // Stygnacy wlewek dymi.
      const ig = c.at(o, SMELT.mold.x, SMELT.mold.y, SMELT.mold.z + h, pC);
      c.fx.stream(fxKey(b, 4), ig.x, ig.y + moldY - c.floor(o, SMELT.mold.x, SMELT.mold.y), ig.z, {
        kind: 'puff', n: 3, life: 1.4, vy: 0.1, spread: 0.02, size: 0.015, sizeEnd: 0.05, color: 0xd0ccc6, colorEnd: 0xd8d6d2,
        jitter: 0.03, sway: 0.02, fade: 0.5,
      }, 1 - cool / 0.6);
    }
  }
}

// ---------------------------------------------------------------- kowal narzedzi i platnerz

interface Smithy {
  /** kowadlo na pniu (poczatek modelu ind_anvil); lico w (x, y + ANVIL_FACE) na wysokosci ANVIL_TOP */
  anvil: { x: number; y: number };
  /** kowal przy kowadle - twarza ku -X */
  stand: { x: number; y: number };
  /** kowal przy palenisku i kierunek, w ktorym patrzy */
  heat: { x: number; y: number; dx: number; dy: number };
  /** kowal przy beczce - twarza ku -Y */
  quench: { x: number; y: number };
  /** beczka z woda (poczatek modelu ind_barrel) */
  barrel: { x: number; y: number };
  chimney: { x: number; y: number; z: number };
  /** dlugosc preta (skala modelu ind_blank) na poczatku i na koncu kucia */
  blank0: number;
  blank1: number;
}
/** Lico kowadla (ind_anvil): przesuniecie wzdluz Y od srodka pnia i wysokosc; lustro wody w beczce (ind_barrel). */
const ANVIL_FACE = 0.01;
const ANVIL_TOP = 0.123;
const WATER_Z = 0.088;

/** Zbrojownia (weaponsmith w art/scripts/buildings.py): palenisko pod daszkiem z lewej, kowadlo i beczka przed nim. */
const ARMORY: Smithy = {
  anvil: { x: -0.2, y: -0.3 },
  stand: { x: -0.068, y: -0.262 },
  heat: { x: -0.115, y: -0.2, dx: -0.5, dy: 0.86 },
  quench: { x: -0.077, y: -0.32 },
  barrel: { x: -0.12, y: -0.44 },
  chimney: { x: -0.24, y: 0.07, z: 0.67 },
  blank0: 1.25,
  blank1: 1.7,
};
/** Palenisko zbrojowni: srodek wierzchu (zar). */
const ARMORY_FORGE = { x: -0.22, y: -0.02, z: 0.124 };

/** Narzedziownia (toolmaker w art/scripts/buildings.py): palenisko w glebi ciemnego wejscia, kowadlo i beczka z lewej. */
const TOOLSHOP: Smithy = {
  anvil: { x: -0.2, y: -0.33 },
  stand: { x: -0.068, y: -0.292 },
  heat: { x: 0.057, y: -0.35, dx: 0, dy: 1 },
  quench: { x: -0.067, y: -0.33 },
  barrel: { x: -0.11, y: -0.46 },
  chimney: { x: -0.22, y: 0.0, z: 0.66 },
  blank0: 1,
  blank1: 1.1,
};
/** Zar w glebi wejscia narzedziowni: srodek swiecacego pasa na scianie. */
const TOOLSHOP_FIRE = { x: 0.1, y: -0.232, z: 0.085 };

/** Cykl kuzni: grzanie, kucie, drugie grzanie, kucie, hartowanie, gotowy wyrob na kowadle. */
const SMITH_T = { walk1: 0.08, forge1: 0.14, walk2: 0.42, heat2: 0.47, walk3: 0.53, forge2: 0.58, barrel: 0.78, dip: 0.81, lift: 0.88, show: 0.92 };
/** Szczeki kleszczy w ukladzie lewej reki (koniec modelu ind_tongs). */
const TONGS_TIP = { y: HAND - 0.15, z: 0.014 };
/** Glowka mlotka w ukladzie prawej reki (tool_hammer). */
const HAMMER_HEAD = { y: HAND - 0.105, z: 0.012 };
/** Uderzenia mlotkiem na sekunde. */
const HAMMER_RATE = 1.7;
/** Wysokosci podloza kuzni w biezacej klatce: kowadlo, beczka, palenisko. */
const YARD = { anvil: 0, barrel: 0, heat: 0 };

/** Zar paleniska: k = jasnosc 0..1 (rozdmuchany przy grzaniu preta). */
function emberColor(c: WorkCtx, b: Building, k: number): number {
  const flick = 0.5 + 0.5 * Math.sin(c.time * 5.1 + b.id) * Math.sin(c.time * 1.9 + b.id * 0.7);
  return mixHex(mixHex(0x5a1e10, 0x9a3416, flick), mixHex(EMBER_LO, EMBER_HI, flick), k);
}

/** Kowadlo i beczka przed kuznia (zawsze) - wysokosci podloza zapisuje w YARD. */
function smithyYard(c: WorkCtx, o: Origin, Y: Smithy): void {
  YARD.anvil = fixture(c, o, 'ind_anvil', Y.anvil.x, Y.anvil.y);
  YARD.barrel = fixture(c, o, 'ind_barrel', Y.barrel.x, Y.barrel.y);
  YARD.heat = floorAt(c, o, Y.heat.x, Y.heat.y);
}

/**
 * Kowal (narzedziownia, zbrojownia): grzeje pret w palenisku, kuje na kowadle (iskry przy uderzeniach,
 * pret ciemnieje), grzeje drugi raz, kuje dalej (pret sie wydluza), hartuje w beczce (bucha para) i kladzie
 * na kowadle gotowy wyrob. Zwraca true, gdy wyrob lezy juz na kowadle (rysuje go wywolujacy).
 */
function smithy(c: WorkCtx, b: Building, o: Origin, Y: Smithy, type: number, u: number): boolean {
  const T = SMITH_T;
  const toAnvil = modelRot(-1, 0);
  const toFire = modelRot(Y.heat.dx, Y.heat.dy);
  const toBarrel = modelRot(0, -1);
  let x = Y.stand.x, y = Y.stand.y, rot = toAnvil, ph = 0, fy = YARD.anvil;
  let mode: 'heat' | 'walk' | 'forge' | 'quench' | 'show' = 'forge';
  let heat = 1;
  let walkFrom = Y.stand, walkTo = Y.stand, s = 0;
  if (u < T.walk1) {
    mode = 'heat';
  } else if (u < T.forge1) {
    mode = 'walk';
    walkFrom = Y.heat;
    s = span(u, T.walk1, T.forge1);
  } else if (u < T.walk2) {
    heat = 1 - 0.65 * (u - T.forge1) / (T.walk2 - T.forge1);
  } else if (u < T.heat2) {
    mode = 'walk';
    walkTo = Y.heat;
    s = span(u, T.walk2, T.heat2);
    heat = 0.35;
  } else if (u < T.walk3) {
    mode = 'heat';
    heat = lerp(0.35, 1, (u - T.heat2) / (T.walk3 - T.heat2));
  } else if (u < T.forge2) {
    mode = 'walk';
    walkFrom = Y.heat;
    s = span(u, T.walk3, T.forge2);
  } else if (u < T.barrel) {
    heat = 1 - 0.6 * (u - T.forge2) / (T.barrel - T.forge2);
  } else if (u < T.dip) {
    mode = 'walk';
    walkTo = Y.quench;
    s = span(u, T.barrel, T.dip);
    heat = 0.4;
  } else if (u < T.lift) {
    mode = 'quench';
    heat = 0;
  } else if (u < T.show) {
    mode = 'walk';
    walkFrom = Y.quench;
    s = span(u, T.lift, T.show);
    heat = 0;
  } else {
    mode = 'show';
    heat = 0;
  }
  if (mode === 'heat') {
    x = Y.heat.x;
    y = Y.heat.y;
    rot = toFire;
    fy = YARD.heat;
  } else if (mode === 'quench') {
    x = Y.quench.x;
    y = Y.quench.y;
    rot = toBarrel;
    fy = YARD.barrel;
  } else if (mode === 'walk') {
    x = lerp(walkFrom.x, walkTo.x, s);
    y = lerp(walkFrom.y, walkTo.y, s);
    fy = lerp(yardFloor(Y, walkFrom), yardFloor(Y, walkTo), s);
    const len = Math.hypot(walkTo.x - walkFrom.x, walkTo.y - walkFrom.y);
    ph = s * len * o.sc * WALK_K;
    const from = walkFrom === Y.heat ? toFire : walkFrom === Y.quench ? toBarrel : toAnvil;
    const to = walkTo === Y.heat ? toFire : walkTo === Y.quench ? toBarrel : toAnvil;
    rot = turn(from, to, ease(s * 1.4));
  }
  // Glowne pozy: przy palenisku kleszcze w zarze, przy kowadle uderzenia z rytmu, przy beczce kleszcze w wodzie.
  const bt = c.beat(HAMMER_RATE, b.id * 0.31);
  const up = mode === 'forge' ? c.strike(bt.f) : 0;
  const at = c.at(o, x, y, 0, pA);
  const pose: Pose = {
    x: at.x, y: fy, z: at.z, rot, owner: b.owner, type, toolL: 'ind_tongs', tool: 'tool_hammer',
    lean: 0.15, armL: -0.8, armR: -0.2, head: 0.25,
  };
  if (mode === 'heat') {
    pose.lean = 0.22;
    pose.armL = -1.12 + Math.sin(c.time * 2.2) * 0.04;
    pose.armLYaw = 0.12;
    pose.armR = -0.25;
    pose.head = 0.3;
  } else if (mode === 'forge') {
    pose.lean = 0.3 - up * 0.08;
    pose.armL = -0.98;
    pose.armLYaw = 0.32;
    pose.armR = -0.92 - up * 1.65;
    pose.twist = -up * 0.12;
    pose.head = 0.42;
    pose.legL = -0.18;
    pose.legR = 0.2;
    pose.legLOut = 0.08;
    pose.legROut = 0.08;
  } else if (mode === 'quench') {
    const dip = span(u, T.dip, T.dip + 0.015) - span(u, T.lift - 0.02, T.lift);
    pose.lean = 0.25 + dip * 0.12;
    pose.armL = -1.05 + dip * 0.32;
    pose.armR = -0.2;
    pose.head = 0.45;
  } else if (mode === 'show') {
    pose.armL = -0.15;
    pose.armR = -0.15;
    pose.head = 0.4;
    pose.toolL = null;
  } else {
    pose.armL = -1.2;
    pose.armR = Math.sin(ph) * 0.35 - 0.1;
  }
  if (mode === 'walk' && ph > 1e-3) stride(pose, ph, 0.5);
  const f = c.figure(pose);
  const anvilTop = YARD.anvil + ANVIL_TOP * o.sc;
  const blankScale = u < T.forge2 ? Y.blank0 : lerp(Y.blank0, Y.blank1, span(u, T.forge2, T.barrel - 0.04));
  if (mode !== 'show') {
    const tip = jointPoint(f.armL, 0, TONGS_TIP.y, TONGS_TIP.z);
    const bx = tip.x, bz = tip.z;
    let by = tip.y;
    let dir = rot;
    if (mode === 'forge') {
      // Pret lezy na kowadle, skierowany od kleszczy pod mlotek (glowka w chwili uderzenia).
      mB.copy(f.torso).multiply(mC.makeTranslation(ARM_X, SHOULDER, 0)).multiply(mC.makeRotationX(-0.92));
      const hit = jointPoint(mB, 0, HAMMER_HEAD.y, HAMMER_HEAD.z);
      dir = Math.atan2(hit.x - bx, hit.z - bz);
      by = anvilTop + 0.006;
      blankAt(c, bx, by, bz, dir, 0, blankScale, ramp(HEAT, heat));
      // Iskry przy kazdym uderzeniu - tym mniej, im chlodniejszy pret.
      if (heat > 0.3) {
        c.fx.burst(fxKey(b, 8) * 64 + (bt.n & 63), bt.age, hit.x, by + 0.008, hit.z, {
          kind: 'bit', n: Math.round(4 + heat * 7), life: 0.5, vy: 0.75, spread: 0.65, spreadY: 0.3, gravity: 3.2,
          size: 0.014, sizeEnd: 0.005, color: 0xfff0a0, colorEnd: 0xff6a20, jitter: 0.008, floor: YARD.anvil,
        });
      }
    } else if (mode !== 'quench') {
      // W drodze i przy palenisku pret zwisa z kleszczy skosnie w dol (w beczce jest pod woda).
      blankAt(c, bx, by, bz, dir, mode === 'heat' ? 0.35 : 0.85, blankScale, ramp(HEAT, heat));
    }
  }
  // Para z beczki: wielki kleb przy zanurzeniu i dalej syczaca struga.
  const w = c.at(o, Y.barrel.x, Y.barrel.y, 0, pC);
  const wy = YARD.barrel + WATER_Z * o.sc;
  const sec = cycleSeconds(b);
  const age = (u - T.dip - 0.008) * sec;
  c.fx.burst(fxKey(b, 9), age, w.x, wy + 0.01, w.z, {
    kind: 'puff', n: 9, life: 1.5, vy: 0.32, spread: 0.07, spreadY: 0.1, gravity: -0.06, size: 0.04, sizeEnd: 0.15,
    color: STEAM, colorEnd: 0xd8dde2, jitter: 0.03, sway: 0.03, fade: 0.4,
  });
  if (mode === 'quench' && u > T.dip + 0.008 && u < T.lift - 0.02) {
    c.fx.stream(fxKey(b, 10), w.x, wy + 0.01, w.z, {
      kind: 'puff', n: 5, life: 1.0, vy: 0.26, spread: 0.05, size: 0.03, sizeEnd: 0.09, color: STEAM, colorEnd: 0xdfe3e8, jitter: 0.025, fade: 0.4,
    });
    c.fx.burst(fxKey(b, 11), age, w.x, wy + 0.005, w.z, {
      kind: 'bit', n: 6, life: 0.45, vy: 0.5, spread: 0.3, gravity: 3, size: 0.01, sizeEnd: 0.006, color: 0xcfe6f5,
    });
  }
  return mode === 'show';
}

/** Wysokosc podloza przy kowadle, palenisku albo beczce (miejsca z YARD). */
function yardFloor(Y: Smithy, p: { x: number; y: number }): number {
  return p === Y.heat ? YARD.heat : p === Y.quench ? YARD.barrel : YARD.anvil;
}

/** Pret (ind_blank) od szczek kleszczy w kierunku dir, pochylony w dol o pitch. */
function blankAt(c: WorkCtx, x: number, y: number, z: number, dir: number, pitch: number, s: number, color: number): void {
  mA.makeTranslation(x, y, z).multiply(mB.makeRotationY(dir)).multiply(mC.makeRotationX(pitch)).multiply(mB.makeScale(s, 1, s));
  c.propM('ind_blank', mA, color);
}

/** Wyrob lezacy na kowadle wzdluz lica (model good_<g> stoi pionowo - kladziemy go glowka ku -Y). */
function onAnvil(c: WorkCtx, o: Origin, Y: Smithy, g: number, len: number): void {
  frameAt(c, o, Y.anvil.x, Y.anvil.y + ANVIL_FACE + len * 0.5, YARD.anvil, mA);
  c.goodAt(g, mA, 0, ANVIL_TOP + 0.008, 0, Math.PI / 2, 0, 0, 0.9 / o.sc);
}

/** Narzedziownia: kowal kuje narzedzie wybrane przez symulacje (b.phase = 10 + numer narzedzia). */
function toolmaker(c: WorkCtx, b: Building, o: Origin): void {
  const u = working(c, b);
  // Zar w glebi wejscia: pas swiatla na ciemnym tle, jasniejszy przy pracy.
  const k = u < 0 ? 0.2 : u < SMITH_T.walk1 || (u > SMITH_T.heat2 && u < SMITH_T.walk3) ? 1 : 0.6;
  const F = TOOLSHOP_FIRE;
  boxAt(c, o, F.x, F.y, F.z, 0.1, 0.004, 0.05, emberColor(c, b, k * 0.8));
  boxAt(c, o, F.x, F.y - 0.002, F.z - 0.012, 0.06, 0.004, 0.022, emberColor(c, b, k));
  smithyYard(c, o, TOOLSHOP);
  if (u < 0) return;
  chimneySmoke(c, o, b, TOOLSHOP.chimney.x, TOOLSHOP.chimney.y, TOOLSHOP.chimney.z, 0.7, 0x7a7672, 0.4);
  const tool = b.phase >= 10 ? FIRST_TOOL + b.phase - 10 : G.HAMMER;
  if (smithy(c, b, o, TOOLSHOP, S.TOOLMAKER, u)) onAnvil(c, o, TOOLSHOP, tool, 0.1);
}

/** Zbrojownia: platnerz wykuwa klinge; gotowy miecz kladzie na kowadle, tarcza oparta o pien kowadla. */
function weaponsmith(c: WorkCtx, b: Building, o: Origin): void {
  const u = working(c, b);
  const heating = u >= 0 && (u < SMITH_T.walk1 || (u > SMITH_T.heat2 && u < SMITH_T.walk3));
  const Fg = ARMORY_FORGE;
  mA.copy(c.frameOf(o)).multiply(mB.makeTranslation(Fg.x, Fg.z, -Fg.y));
  c.propM('ind_embers', mA, emberColor(c, b, u < 0 ? 0.15 : heating ? 1 : 0.55));
  smithyYard(c, o, ARMORY);
  if (u < 0) return;
  chimneySmoke(c, o, b, ARMORY.chimney.x, ARMORY.chimney.y, ARMORY.chimney.z, 0.8, 0x75716d, heating ? 0.8 : 0.3);
  if (heating) {
    const p = c.at(o, Fg.x, Fg.y, Fg.z + 0.01, pC);
    c.fx.stream(fxKey(b, 12), p.x, p.y, p.z, {
      kind: 'bit', n: 4, life: 0.6, vy: 0.35, spread: 0.08, gravity: -0.05, size: 0.01, sizeEnd: 0.003, color: 0xffd060, colorEnd: 0xff4a12, jitter: 0.04,
    });
  }
  if (smithy(c, b, o, ARMORY, S.WEAPONSMITH, u)) {
    const Y = ARMORY;
    onAnvil(c, o, Y, G.SWORD, 0.1);
    // Tarcza oparta o pien kowadla od strony -X (lico ku -X, lekko odchylona).
    const k = 0.85 / o.sc;
    frameAt(c, o, Y.anvil.x - 0.055, Y.anvil.y + ANVIL_FACE, YARD.anvil, mA)
      .multiply(mC.makeRotationY(-Math.PI / 2)).multiply(mB.makeRotationX(-0.28)).multiply(mC.makeScale(k, k, k));
    c.goodAt(G.SHIELD, mA, 0, 0, 0);
  }
}

// ---------------------------------------------------------------- mincerz

/** Mennica w ukladzie modelu (jak mint w art/scripts/buildings.py): pien z kowadelkiem przed lewym oknem. */
const MINT = {
  /** pien (poczatek modelu ind_stump) */
  stump: { x: -0.2, y: -0.395 },
  /** lico kowadelka, miska z krazkami (po lewej rece mincerza, ku -X), stosik monet (przed nim, ku -Y) */
  die: { x: -0.196, y: -0.389, z: 0.118 },
  bowl: { x: -0.234, y: -0.387, z: 0.112 },
  stack: { x: -0.19, y: -0.429, z: 0.1 },
  /** mincerz za pniem, twarza ku kamerze (ku -Y, lekko w lewo) */
  stand: { x: -0.152, y: -0.25 },
  face: { dx: -0.3, dy: -0.95 },
  chimney: { x: 0.12, y: 0.1, z: 0.68 },
};
/** Monet wybijanych w jednym cyklu (stosik rosnie do konca cyklu). */
const COINS = 10;
/** Chwile uderzen mlotkiem w czasie jednej monety (czesc jej czasu). */
const MINT_HITS = [0.47, 0.67] as const;
const GOLD = 0xf0c040;
/** Moneta: skala modelu ind_coin (promien 0.5) w jednostkach budynku i grubosc. */
const COIN_S = 0.03;
const COIN_H = COIN_S * 0.2;

/** Moneta w punkcie (lx, ly, lz) ukladu modelu nad podlozem pnia (MINT_Y). */
function coin(c: WorkCtx, o: Origin, lx: number, ly: number, lz: number): void {
  c.propAt('ind_coin', frameAt(c, o, lx, ly, MINT_Y.v, mA), 0, lz + COIN_H / 2, 0, 0, 0, 0, COIN_S, GOLD);
}
/** Wysokosc podloza pod pniem mincerza w biezacej klatce. */
const MINT_Y = { v: 0 };

/** Krzywa zamachu: od t0 w gore, uderzenie w chwili hit (jak c.strike, ale na osi czasu etapu pracy). */
function swing(f: number, t0: number, hit: number): number {
  const t = (f - t0) / (hit - t0);
  if (t < 0 || t > 1) return 0;
  return t < 0.72 ? Math.sin((t / 0.72) * Math.PI / 2) : Math.cos(((t - 0.72) / 0.28) * Math.PI / 2);
}

/**
 * Mennica: mincerz bierze krazek z miski, kladzie na kowadelku, przystawia stempel i bije mlotkiem dwa razy
 * (przy kazdym uderzeniu zloto blyska), odklada monete na stosik, ktory rosnie przez caly cykl.
 */
function mint(c: WorkCtx, b: Building, o: Origin): void {
  MINT_Y.v = fixture(c, o, 'ind_stump', MINT.stump.x, MINT.stump.y);
  const u = working(c, b);
  if (u < 0) return;
  const lift = MINT_Y.v - c.floor(o, MINT.die.x, MINT.die.y);
  chimneySmoke(c, o, b, MINT.chimney.x, MINT.chimney.y, MINT.chimney.z, 0.55, 0x8a8682, 0);
  const n = Math.min(COINS, Math.floor(u * COINS + 0.06));
  const f = u * COINS - Math.floor(u * COINS);
  const coinSec = cycleSeconds(b) / COINS;
  const D = MINT.die;
  for (let i = 0; i < n; i++) coin(c, o, MINT.stack.x + ((i * 7) % 3 - 1) * 0.0012, MINT.stack.y, MINT.stack.z + i * COIN_H);
  const done = n >= COINS || f > 0.94;
  // Krazek w drodze z miski na kowadelko, na kowadelku i w drodze na stosik.
  let armLYaw = 0.4, armL = -1.35;
  if (!done) {
    if (f < 0.16) {
      armLYaw = lerp(0.4, 0, span(f, 0, 0.1));
      armL = -1.25 + span(f, 0.04, 0.12) * 0.15;
    } else if (f < 0.3) {
      const s = span(f, 0.16, 0.3);
      armLYaw = lerp(0, 0.4, s);
      armL = lerp(-1.1, -1.35, s);
      coin(c, o, lerp(MINT.bowl.x, D.x, s), lerp(MINT.bowl.y, D.y, s), lerp(MINT.bowl.z, D.z, s) + Math.sin(s * Math.PI) * 0.03);
    } else if (f < 0.78) {
      coin(c, o, D.x, D.y, D.z);
      if (c.details) {
        const p = c.at(o, D.x, D.y, D.z + COIN_H, pB);
        c.prop('ind_punch', p.x, p.y + lift, p.z, c.frontRot);
      }
    } else {
      const s = span(f, 0.78, 0.92);
      armLYaw = lerp(0.4, 0.5, s);
      armL = lerp(-1.35, -1.5, Math.sin(s * Math.PI));
      coin(c, o, lerp(D.x, MINT.stack.x, s), lerp(D.y, MINT.stack.y, s), lerp(D.z, MINT.stack.z + n * COIN_H, s) + Math.sin(s * Math.PI) * 0.025);
    }
  }
  // Dwa uderzenia na monete: blysk zlota i drobiny.
  const up = done ? 0 : swing(f, 0.3, MINT_HITS[0]) + swing(f, MINT_HITS[0] + 0.02, MINT_HITS[1]);
  const flash = c.at(o, D.x, D.y, D.z + COIN_H + 0.004, pC);
  flash.y += lift;
  for (const hit of MINT_HITS) {
    const age = (f - hit) * coinSec;
    c.fx.burst(fxKey(b, 14) + (hit > 0.5 ? 1 : 0), age, flash.x, flash.y, flash.z, {
      kind: 'puff', n: 1, life: 0.2, size: 0.1, sizeEnd: 0.01, color: 0xfff8d0,
    });
    c.fx.burst(fxKey(b, 16) + (hit > 0.5 ? 1 : 0), age, flash.x, flash.y, flash.z, {
      kind: 'bit', n: 7, life: 0.4, vy: 0.45, spread: 0.36, spreadY: 0.12, gravity: 2.6, size: 0.012, sizeEnd: 0.004,
      color: 0xfff0a0, colorEnd: GOLD, floor: MINT_Y.v + MINT.die.z * o.sc - 0.01,
    });
  }
  const at = c.at(o, MINT.stand.x, MINT.stand.y, 0, pA);
  c.figure({
    x: at.x, y: MINT_Y.v, z: at.z, rot: modelRot(MINT.face.dx, MINT.face.dy), owner: b.owner, type: S.MINTER, tool: 'tool_hammer',
    lean: 0.42, crouch: 0.02, head: 0.32, armL, armLYaw, armR: -1.05 - up * 1.75, armRYaw: -0.32, armROut: up * 0.25,
    legLOut: 0.06, legROut: 0.06,
  });
}

// ---------------------------------------------------------------- szkutnik

/** Lodz na pochylni stoczni (uklad modelu, jak shipyard w art/scripts/buildings.py): os wzdluz X, dziob z lewej. */
const BOAT = {
  y: -0.24,
  /** spod stepki (wierzch klockow pochylni) */
  keel: 0.045,
  /** wregi (x) */
  ribs: [-0.13, -0.05, 0.03, 0.1] as const,
  /** miejsce przy stosie desek (szkutnik twarza ku +X) */
  pick: { x: 0.262, y: -0.24 },
  /** szkutnik przy burcie blizszej (y < os) i dalszej, obejscie rufy */
  nearY: -0.392,
  farY: -0.098,
  roundX: 0.215,
  /** miejsca przybijania wzdluz deski (od rufy) */
  nail: [0.05, -0.08] as const,
};
/** Stacje wzdluz lodzi: x, szerokosc wzgledem srodka, podniesienie ku stewom (wspolczynnik na pas). */
const HULL_X = [-0.215, -0.135, 0.06, 0.15] as const;
const HULL_W = [0.1, 0.84, 1, 0.22] as const;
const HULL_RISE = [0.016, 0.003, 0, 0.012] as const;
/** Pasy poszycia od dolu: dolna krawedz deski i odleglosc od osi na srodku lodzi, rozchylenie burty (rad). */
const STRAKES = [
  { z: 0.054, w: 0.03, flare: 1.0 },
  { z: 0.08, w: 0.055, flare: 0.72 },
  { z: 0.106, w: 0.075, flare: 0.5 },
] as const;
const PLANK_H = 0.03;
const PLANK_T = 0.007;
const BOAT_WOOD = 0x7a5230;
const PLANK_COL = [0xc49a64, 0xb98e58, 0xcaa36e] as const;
/** Deski w kolejnosci przybijania: pas k, burta (-1 blizsza, 1 dalsza). */
const PLANKS = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]] as const;
/** Os czasu jednej deski: po deske, podniesienie, z deska do lodzi, przylozenie, przybijanie w dwoch miejscach. */
const PLANK_STEPS = { pick: 0.22, carry: 0.3, place: 0.48, nail1: 0.54, step: 0.76, nail2: 0.82 };

/** Podniesienie pochylni (swiat) w biezacej klatce: teren przed stocznia moze byc wyzszy niz budynek. */
const BOAT_LIFT = { v: 0 };

/** Punkt lodzi w ukladzie modelu (lx, ly, lz) w swiecie, z podniesieniem pochylni. */
function boatAt(c: WorkCtx, o: Origin, lx: number, ly: number, lz: number, out: Vec3): Vec3 {
  c.at(o, lx, ly, lz, out).y = o.y + lz * o.sc + BOAT_LIFT.v;
  return out;
}

function hullPoint(k: number, side: number, j: number, out: Vec3, c: WorkCtx, o: Origin, up = 0): Vec3 {
  const st = STRAKES[k];
  const fl = st.flare * HULL_W[j];
  const w = st.w * HULL_W[j] + Math.sin(fl) * up;
  const z = st.z + HULL_RISE[j] * (k + 1) + Math.cos(fl) * up;
  return boatAt(c, o, HULL_X[j], BOAT.y + side * w, z, out);
}

/** Deska poszycia (pas k, burta side): trzy odcinki od dziobu do rufy. */
function plank(c: WorkCtx, o: Origin, k: number, side: number): void {
  const col = PLANK_COL[k];
  for (let j = 0; j < 3; j++) {
    hullPoint(k, side, j, pA, c, o, PLANK_H / 2);
    hullPoint(k, side, j + 1, pB, c, o, PLANK_H / 2);
    const fl = STRAKES[k].flare * (HULL_W[j] + HULL_W[j + 1]) / 2;
    const d = modelDir(0, side * Math.sin(fl), Math.cos(fl));
    slab(c, pA, pB, PLANK_T * o.sc, PLANK_H * o.sc * 1.08, d.x, d.y, d.z, col);
  }
}

/** Polowa szerokosci gornego pasa w miejscu x (do wregow). */
function hullHalf(x: number): number {
  for (let j = 0; j < 3; j++) {
    if (x <= HULL_X[j + 1]) return lerp(HULL_W[j], HULL_W[j + 1], (x - HULL_X[j]) / (HULL_X[j + 1] - HULL_X[j]));
  }
  return HULL_W[3];
}

/** Szkielet lodzi: stepka, stewy i wregi (zawsze na pochylni - nowa lodz czeka na deski). */
function boatFrame(c: WorkCtx, o: Origin): void {
  const y = BOAT.y, kz = BOAT.keel;
  const t = 0.015 * o.sc;
  slab(c, boatAt(c, o, HULL_X[0] + 0.01, y, kz + 0.008, pA), boatAt(c, o, HULL_X[3] - 0.004, y, kz + 0.008, pB), t, t, 0, 1, 0, BOAT_WOOD);
  // Stewy grubsze niz deski - zakrywaja ich zbiegajace sie konce.
  const ts = 0.022 * o.sc;
  slab(c, boatAt(c, o, HULL_X[0] + 0.008, y, kz + 0.006, pA), boatAt(c, o, HULL_X[0] - 0.026, y, kz + 0.16, pB), ts, ts, 0, 1, 0, BOAT_WOOD);
  slab(c, boatAt(c, o, HULL_X[3] - 0.004, y, kz + 0.006, pA), boatAt(c, o, HULL_X[3] + 0.016, y, kz + 0.13, pB), ts, ts, 0, 1, 0, BOAT_WOOD);
  const top = STRAKES[2];
  const r = 0.008 * o.sc;
  for (const x of BOAT.ribs) {
    const h = hullHalf(x);
    const w = top.w * h - PLANK_T * 1.2;
    const zt = top.z + Math.cos(top.flare * h) * PLANK_H;
    slab(c, boatAt(c, o, x, y - 0.022, kz + 0.016, pA), boatAt(c, o, x, y + 0.022, kz + 0.016, pB), r, r, 0, 1, 0, BOAT_WOOD);
    for (const side of SIDES) {
      boatAt(c, o, x, y + side * 0.02, kz + 0.016, pA);
      boatAt(c, o, x, y + side * (STRAKES[0].w * h - PLANK_T), STRAKES[0].z + 0.01, pB);
      slab(c, pA, pB, r, r, 0, 1, 0, BOAT_WOOD);
      boatAt(c, o, x, y + side * w, zt, pC);
      slab(c, pB, pC, r, r, 0, 1, 0, BOAT_WOOD);
    }
  }
}

/** Droga szkutnika (uklad modelu): lamana przez trzy punkty, wpisywana do PTS. */
const PTS = [0, 0, 0, 0, 0, 0];
function setPath(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number[] {
  PTS[0] = x0;
  PTS[1] = y0;
  PTS[2] = x1;
  PTS[3] = y1;
  PTS[4] = x2;
  PTS[5] = y2;
  return PTS;
}

/**
 * Stocznia: na pochylni stoi szkielet lodzi; w trakcie cyklu szkutnik przynosi ze stosu deske (na ramieniu),
 * przyklada ja do wregow i przybija mlotkiem w dwoch miejscach - burta blizsza od strony kamery, dalsza
 * zza lodzi (obchodzi rufe). Poszycie rosnie deska po desce od stepki w gore.
 */
function shipyard(c: WorkCtx, b: Building, o: Origin): void {
  BOAT_LIFT.v = floorAt(c, o, -0.03, BOAT.y) - o.y;
  boatFrame(c, o);
  const u = working(c, b);
  if (u < 0) return;
  const k6 = u * PLANKS.length;
  const idx = Math.min(PLANKS.length - 1, Math.floor(k6));
  const f = k6 - idx;
  const T = PLANK_STEPS;
  for (let i = 0; i < idx; i++) plank(c, o, PLANKS[i][0], PLANKS[i][1]);
  const [k, side] = PLANKS[idx];
  if (f >= T.place) plank(c, o, k, side);
  const sy = side < 0 ? BOAT.nearY : BOAT.farY;
  const prevSide = idx > 0 ? PLANKS[idx - 1][1] : side;
  const py = prevSide < 0 ? BOAT.nearY : BOAT.farY;
  // Polozenie szkutnika (uklad modelu), kierunek i faza chodu.
  let x: number, y: number, rot: number, ph = 0;
  let carry = false;
  const toHull = modelRot(0, -side);
  if (f < T.pick) {
    const pth = idx === 0 ? setPath(BOAT.pick.x, BOAT.pick.y, BOAT.pick.x, BOAT.pick.y, BOAT.pick.x, BOAT.pick.y)
      : setPath(BOAT.nail[1], py, BOAT.roundX, py, BOAT.pick.x, BOAT.pick.y);
    const pt = along(pth, span(f, 0, T.pick));
    x = pt.x;
    y = pt.y;
    rot = idx === 0 ? modelRot(1, 0) : modelRot(pt.dx, pt.dy);
    ph = pt.dist * o.sc * WALK_K;
  } else if (f < T.carry) {
    x = BOAT.pick.x;
    y = BOAT.pick.y;
    rot = modelRot(1, 0);
    carry = f > (T.pick + T.carry) / 2;
  } else if (f < T.place) {
    const pt = along(setPath(BOAT.pick.x, BOAT.pick.y, BOAT.roundX, sy, BOAT.nail[0], sy), span(f, T.carry, T.place));
    x = pt.x;
    y = pt.y;
    rot = modelRot(pt.dx, pt.dy);
    ph = pt.dist * o.sc * WALK_K;
    carry = true;
  } else if (f < T.step) {
    x = BOAT.nail[0];
    y = sy;
    rot = toHull;
  } else if (f < T.nail2) {
    const s = span(f, T.step, T.nail2);
    x = lerp(BOAT.nail[0], BOAT.nail[1], s);
    y = sy;
    rot = toHull;
    ph = s * Math.abs(BOAT.nail[1] - BOAT.nail[0]) * o.sc * WALK_K;
  } else {
    x = BOAT.nail[1];
    y = sy;
    rot = toHull;
  }
  const nailing = (f >= T.nail1 && f < T.step) || f >= T.nail2 + 0.02;
  const bt = c.beat(2.1, b.id * 0.23);
  const up = nailing ? c.strike(bt.f) : 0;
  const at = c.at(o, x, y, 0, pA);
  const low = 2 - k;
  const pose: Pose = {
    x: at.x, y: floorAt(c, o, x, y), z: at.z, rot, owner: b.owner, type: S.BOATBUILDER, tool: 'tool_hammer',
    lean: 0.1, armL: 0, armR: 0, head: 0.2,
  };
  if (ph > 1e-3) {
    stride(pose, ph, 0.5);
    pose.armL = carry ? -0.5 : -Math.sin(ph) * 0.45;
    pose.armR = carry ? -2.75 : Math.sin(ph) * 0.45;
  } else if (f >= T.pick && f < T.carry) {
    // Schyla sie po deske i podnosi ja na ramie.
    const bend = Math.sin(span(f, T.pick, T.carry) * Math.PI);
    pose.lean = 0.15 + bend * 0.55;
    pose.crouch = bend * 0.05;
    pose.armL = -0.6 - bend * 0.5;
    pose.armR = carry ? -2.75 : -0.7 - bend * 0.5;
    pose.head = 0.4;
  } else if (f >= T.place && f < T.nail1) {
    // Przyklada deske do wregow.
    const s = span(f, T.place, T.nail1);
    pose.lean = 0.25 + low * 0.08;
    pose.armL = lerp(-0.5, -1.1, s);
    pose.armR = lerp(-2.75, -1.1, s);
    pose.crouch = low * 0.025 * s;
  } else {
    // Przybija: lewa reka trzyma deske, prawa bije mlotkiem w burte.
    pose.lean = 0.28 + low * 0.08 + (side > 0 ? 0.08 : 0);
    pose.crouch = low * 0.025;
    pose.armL = -1.05 - (side > 0 ? 0.15 : 0);
    pose.armLYaw = 0.2;
    pose.armR = -0.95 - up * 1.35 - (side > 0 ? 0.15 : 0);
    pose.head = 0.35;
    pose.legL = -0.15;
    pose.legR = 0.18;
  }
  if (carry) pose.tool = null;
  const fr = c.figure(pose);
  if (carry) {
    // Deska na prawym ramieniu, wzdluz kierunku marszu.
    mA.copy(fr.root).multiply(mB.makeTranslation(0.1, SHOULDER + 0.05, 0.02));
    const len = 0.38 * o.sc / UNIT_SCALE;
    mA.multiply(mB.makeRotationX(-0.12)).multiply(mC.makeScale(PLANK_T * o.sc / UNIT_SCALE, PLANK_H * o.sc / UNIT_SCALE, len));
    c.propM('ind_box', mA, PLANK_COL[k]);
  }
  if (nailing) {
    // Wiory i pyl z burty przy kazdym uderzeniu.
    const zs = STRAKES[k].z + PLANK_H * 0.6;
    const sp = boatAt(c, o, x - 0.03, BOAT.y + side * (STRAKES[k].w + 0.012), zs, pC);
    c.fx.burst(fxKey(b, 18) * 64 + (bt.n & 63), bt.age, sp.x, sp.y, sp.z, {
      kind: 'bit', n: 3, life: 0.4, vy: 0.35, spread: 0.25, gravity: 2.5, size: 0.01, sizeEnd: 0.007, color: 0xe8cf9c, floor: o.y + BOAT_LIFT.v,
    });
  }
}

// ---------------------------------------------------------------- smolarz

/** Mielerz smolarni w ukladzie modelu (jak charburner w art/scripts/buildings.py). */
const KILN = {
  x: 0.24,
  y: -0.08,
  /** wierzcholek kopca (otwor dymny) */
  top: 0.166,
  /** profil kopca ziemi: promien podstawy, wysokosc nad z0 */
  r: 0.235,
  h: 0.146,
  z0: 0.02,
  /** sciezka smolarza dookola kopca i otwory dymne przy ziemi */
  walk: 0.375,
  vent: 0.24,
  ventZ: 0.04,
};
/** Smolarz rusza od chaty (kat startu w ukladzie modelu) i obchodzi kopiec dookola; katy stacji, na ktorych pracuje. */
const KILN_START = 2.95;
const KILN_STOPS = [3.55, 4.3, 5.05, 5.85, 6.95, 8.0] as const;
/** Czesc cyklu na marsz miedzy stacjami (reszta - praca na stacjach). */
const KILN_WALK = 0.3;
/** Otwory dymne widoczne od frontu (katy). */
const KILN_VENTS = [3.15, 4.2, 5.25] as const;
/** Praca na stacji (czesc stacji): rzuty ziemi [poczatek kopania, rzut] i chwile klepniec lopata. */
const KILN_THROWS = [[0, 0.3], [0.36, 0.66]] as const;
const KILN_PATS = [0.84, 0.97] as const;
const SOIL = 0x5e4128;
/** Wysokosc lopaty nad stopami smolarza w chwili rzutu (swiat). */
const THROW_H = 0.26;

/** Wysokosc powierzchni kopca w odleglosci r od srodka. */
function kilnZ(r: number): number {
  const k = Math.min(1, r / KILN.r);
  return KILN.z0 + KILN.h * Math.sqrt(1 - k * k);
}

/**
 * Smolarnia: smolarz obchodzi mielerz; na kazdej stacji dwa razy nabiera lopata ziemi i narzuca ja na kopiec,
 * potem ubija ja dwoma klepnieciami. Dym z wierzcholka i otworow gestnieje w miare wypalania.
 */
function charburner(c: WorkCtx, b: Building, o: Origin): void {
  const u = working(c, b);
  if (u < 0) return;
  // Dym: z wierzcholka coraz gestszy i ciemniejszy, z otworow przy ziemi kolejno w miare wypalania.
  const top = c.at(o, KILN.x, KILN.y, KILN.top, pC);
  const dense = 0.3 + 0.7 * u;
  c.fx.stream(fxKey(b, 20), top.x, top.y, top.z, {
    kind: 'puff', n: 12, life: 3.4, vx: 0.05, vy: 0.15, vz: -0.03, spread: 0.025, spreadY: 0.02, gravity: -0.01,
    size: 0.05 + 0.03 * u, sizeEnd: 0.15 + 0.12 * u, color: mixHex(0xc8c4bc, 0x6e6a66, u), colorEnd: 0xcac8c4, jitter: 0.015, sway: 0.035, fade: 0.25,
  }, dense);
  for (let i = 0; i < KILN_VENTS.length; i++) {
    const a = KILN_VENTS[i];
    const v = c.at(o, KILN.x + Math.cos(a) * KILN.vent, KILN.y + Math.sin(a) * KILN.vent, KILN.ventZ, pB);
    c.fx.stream(fxKey(b, 21 + i), v.x, v.y, v.z, {
      kind: 'puff', n: 4, life: 1.8, vx: 0.03, vy: 0.09, spread: 0.02, size: 0.025, sizeEnd: 0.08, color: 0x9a9690, colorEnd: 0xc8c6c2, sway: 0.02, fade: 0.3,
    }, clamp01((u - 0.25 - i * 0.12) * 2.2) * 0.8);
  }
  // Polozenie na obwodzie: marsz albo praca na stacji.
  const nStops = KILN_STOPS.length;
  const walkPer = KILN_WALK / (nStops + 1);
  const workPer = (1 - KILN_WALK) / nStops;
  let ang = KILN_START, ph = 0, g = -1, gf = 0;
  let t = u;
  let prev = KILN_START;
  for (let i = 0; i <= nStops; i++) {
    const next = i < nStops ? KILN_STOPS[i] : KILN_START + Math.PI * 2;
    if (t < walkPer) {
      const s = ease(t / walkPer);
      ang = lerp(prev, next, s);
      ph = (ang - KILN_START) * KILN.walk * o.sc * WALK_K;
      break;
    }
    t -= walkPer;
    ang = next;
    if (i === nStops) break;
    if (t < workPer) {
      g = i;
      gf = t / workPer;
      break;
    }
    t -= workPer;
    prev = next;
  }
  const px = KILN.x + Math.cos(ang) * KILN.walk, py = KILN.y + Math.sin(ang) * KILN.walk;
  const at = c.at(o, px, py, 0, pA);
  const inward = modelRot(-Math.cos(ang), -Math.sin(ang));
  const pose: Pose = {
    x: at.x, y: floorAt(c, o, px, py), z: at.z, rot: g < 0 ? modelRot(-Math.sin(ang), Math.cos(ang)) : inward, owner: b.owner, type: S.CHARBURNER,
    lean: 0.1, armR: -0.4, armL: -0.3, head: 0.2,
  };
  let clod = false;
  if (g < 0) {
    stride(pose, ph, 0.5);
    pose.armR = -0.45 + Math.sin(ph) * 0.2;
    pose.armL = -Math.sin(ph) * 0.4;
  } else {
    // Stacja: dwa rzuty ziemi (kopanie, zamach, rzut), potem dwa klepniecia lopata.
    for (const [d0, thr] of KILN_THROWS) {
      if (gf >= d0 && gf < thr + 0.06) {
        const dig = Math.sin(clamp01((gf - d0) / (thr - d0 - 0.1)) * Math.PI);
        const lift = span(gf, thr - 0.12, thr);
        pose.lean = 0.12 + dig * 0.45 - lift * 0.05;
        pose.crouch = dig * 0.035;
        pose.armR = -0.3 - dig * 0.35 - lift * 1.25;
        pose.armL = -0.5 - dig * 0.25 - lift * 0.8;
        pose.twist = 0.25 * dig - 0.15 * lift;
        clod = gf > d0 + (thr - d0) * 0.45 && gf < thr;
      }
    }
    if (gf >= KILN_PATS[0] - 0.12) {
      const pat = Math.max(swing(gf, KILN_PATS[0] - 0.12, KILN_PATS[0]), swing(gf, KILN_PATS[1] - 0.11, KILN_PATS[1]));
      pose.lean = 0.3;
      pose.armR = -1.0 - pat * 0.55;
      pose.armL = -0.95 - pat * 0.35;
      pose.head = 0.3;
    }
  }
  const fr = c.figure(pose);
  if (clod) {
    // Grudka ziemi na lopacie (koniec tool_shovel: z = HAND - 0.09, y = -0.18).
    mA.copy(fr.armR).multiply(mB.makeTranslation(0, HAND - 0.07, 0.17)).multiply(mC.makeScale(0.6, 0.7, 0.6));
    c.propM('ind_load', mA, SOIL);
  }
  if (g >= 0) {
    // Ziemia leci z lopaty (wzniesionej przy rzucie) na kopiec, przy klepnieciu unosi sie kurz.
    const sec = workPer * cycleSeconds(b);
    const hit = c.at(o, KILN.x + Math.cos(ang) * 0.19, KILN.y + Math.sin(ang) * 0.19, kilnZ(0.19) + 0.005, pB);
    const rt = KILN.walk - 0.13;
    const from = c.at(o, KILN.x + Math.cos(ang) * rt, KILN.y + Math.sin(ang) * rt, 0, pA);
    from.y = pose.y + THROW_H;
    for (let i = 0; i < KILN_THROWS.length; i++) {
      c.fx.burst(fxKey(b, 24 + i), (gf - KILN_THROWS[i][1]) * sec, from.x, from.y, from.z, {
        kind: 'bit', n: 7, life: 0.55, vx: (hit.x - from.x) * 1.7, vz: (hit.z - from.z) * 1.7, vy: 0.3, spread: 0.12, gravity: 2.4,
        size: 0.022, sizeEnd: 0.016, color: SOIL, floor: hit.y,
      });
    }
    for (let i = 0; i < KILN_PATS.length; i++) {
      c.fx.burst(fxKey(b, 26 + i), (gf - KILN_PATS[i]) * sec, hit.x, hit.y, hit.z, {
        kind: 'puff', n: 3, life: 0.6, vy: 0.08, spread: 0.06, size: 0.02, sizeEnd: 0.06, color: 0x8a7458, colorEnd: 0xb0a088, fade: 0.5,
      });
    }
  }
}

export const industryScenes: Scenes = {
  building: {
    [B.COALMINE]: mine,
    [B.IRONMINE]: mine,
    [B.GOLDMINE]: mine,
    [B.STONEMINE]: mine,
    [B.STEELWORKS]: steelworks,
    [B.MINT]: mint,
    [B.TOOLMAKER]: toolmaker,
    [B.WEAPONSMITH]: weaponsmith,
    [B.SHIPYARD]: shipyard,
    [B.CHARBURNER]: charburner,
  },
};
