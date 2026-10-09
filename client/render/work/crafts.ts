/**
 * Rzemieslnicy przy budynkach (zywnosc i zwierzeta): mlynarz, piekarz, rzeznik, hodowca swin, hodowca oslow,
 * studniarz, piwowar.
 *
 * Pracownik warsztatu jest w symulacji w srodku budynku. W trakcie cyklu (c.cycle) scena budynku rysuje go przy
 * pracy przed budynkiem: wychodzi z drzwi, pracuje i wraca, zanim prawdziwy pracownik wyniesie wyrob na flage
 * (wyrob niesie po swojemu - to rysuja sceny osadnikow: worek maki na ramieniu, kosz chleba, deska z miesem,
 * swinia na rekach, wiadro wody, beczka toczona przed soba).
 *  - Mlyn: mlynarz bierze worek zboza z palety i wnosi go do mlyna; skrzydla rozpedzaja sie na czas mielenia,
 *    w drzwiach unosi sie bialy pyl, w polowie mielenia mlynarz wytrzepuje w drzwiach pusty worek.
 *  - Piekarnia: piekarz stawia pusty kosz na stole, walkuje ciasto, formuje bochenki, lopata wsuwa je do pieca,
 *    czeka (ogien w piecu migocze, z komina bije dym), wyjmuje upieczone po jednym na stol i pakuje je do kosza.
 *  - Rzeznia: rzeznik przynosi tusze na ramieniu, kladzie ja na pniu, odrabuje tasakiem kawalki i zsuwa je na deske.
 *  - Chlewnia: hodowca sypie pasze z wiadra do koryta zza plotu, swinie podbiegaja i jedza; potem dolewa wody.
 *  - Studnia: studniarz kreci korba, wiadro wyjezdza ze studni, przelewa wode do beczki, wiadro spada z powrotem.
 *    Studniarz stoi przy korbie takze miedzy cyklami (studnia nie ma drzwi), a wode na flage niesie obok beczki.
 *  - Browar: piwowar wsypuje slod do kotla i miesza wioslem w parujacym kotle; beczke z piwem toczy na flage.
 *  - Hodowla oslow: hodowca oprowadza oslice na sznurku po zagrodzie, za nia biega oslatko; na koniec cyklu
 *    oslatko wbiega do stajni, z ktorej wychodzi nowy osiol.
 */
import * as THREE from 'three';
import { B, BUILDINGS, G, S, TICKS_PER_SECOND } from '../../../sim/defs.ts';
import { SS } from '../../../sim/serfs.ts';
import type { Building, Serf } from '../../../sim/types.ts';
import type { FxOptions } from '../fx.ts';
import { ARM_X, HAND, HIP, SHOULDER, UNIT_SCALE, type Pose } from '../rig.ts';
import type { Origin, Scenes, SerfAt, Vec3, WorkCtx } from './types.ts';

const BROT = Math.PI / 6;
const COS30 = Math.cos(BROT);
const SIN30 = Math.sin(BROT);
const TAU = Math.PI * 2;
const US = UNIT_SCALE;
/** Kierunek "na zewnatrz" frontu budynku w swiecie (x, z). */
const OUT_X = SIN30;
const OUT_Z = COS30;
/** Faza krokow na jednostke drogi w swiecie. */
const STRIDE = TAU * 1.7;

const GRAIN = 0xd4bb8c;
const FLOUR = 0xf7f4ec;
const DOUGH = 0xf1dfba;
const CRUST = 0xc27b34;
const WATER = 0x5a8fc0;
const FEED = 0xd9b45a;
const SLOP = 0x93a08a;
const ROPE = 0xc8b48a;
const PIG = 0xf0a8a8;
const DONKEY = 0x8f8578;
const MEAT_BIT = 0xa8342a;
const STEAM = 0xf2f0ec;
const EMBER_DIM = 0x4a1606;
const EMBER_HOT = 0xffa53a;
const FLAME = 0xffd27a;
const MALT = 0xc89a4a;

const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mT = new THREE.Matrix4();
const mInv = new THREE.Matrix4();
const mProp = new THREE.Matrix4();
const mBody = new THREE.Matrix4();
const mFrom = new THREE.Matrix4();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const Y_UP = new THREE.Vector3(0, 1, 0);
const cA = new THREE.Color();
const cB = new THREE.Color();
const w1: Vec3 = { x: 0, y: 0, z: 0 };
const w2: Vec3 = { x: 0, y: 0, z: 0 };
const w3: Vec3 = { x: 0, y: 0, z: 0 };
const w4: Vec3 = { x: 0, y: 0, z: 0 };
const w5: Vec3 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------- pomocnicze

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Postep etapu [a, b] cyklu: 0 przed etapem, 1 po nim. */
function span(p: number, a: number, b: number): number {
  return clamp01((p - a) / (b - a));
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** Kolor posredni miedzy a i b (hex). */
function mix(a: number, b: number, t: number): number {
  return cA.setHex(a).lerp(cB.setHex(b), clamp01(t)).getHex();
}

/** Droga przebyta z predkoscia stala, z rozpedem i hamowaniem na czesci k etapu (u, wynik: 0..1). */
function cruise(u: number, k = 0.08): number {
  const t = clamp01(u);
  const vmax = 1 / (1 - k);
  if (t < k) return (vmax * t * t) / (2 * k);
  if (t > 1 - k) return 1 - (vmax * (1 - t) * (1 - t)) / (2 * k);
  return vmax * (t - k / 2);
}

/** Obrot postaci patrzacej w kierunku (dx, dy) ukladu modelu budynku. */
function faceL(dx: number, dy: number): number {
  return Math.atan2(dx * COS30 - dy * SIN30, -(dx * SIN30 + dy * COS30));
}

/** Czas cyklu budynku w sekundach animacji. */
function cycleSec(kind: number): number {
  return BUILDINGS[kind].cycle / TICKS_PER_SECOND;
}

/** Postep cyklu warsztatu (pracownik w srodku, budynek nie wstrzymany) albo -1. */
function workP(c: WorkCtx, b: Building): number {
  return c.workerInside(b) && !b.paused ? c.cycle(b) : -1;
}

/** Punkt w ukladzie budynku (lx, ly) dla danego punktu swiata (odwrotnosc c.at w poziomie). */
function toLocal(o: Origin, x: number, z: number, out: Vec3): Vec3 {
  const wx = (x - o.x) / o.sc, wz = (z - o.z) / o.sc;
  out.x = wx * COS30 - wz * SIN30;
  out.y = -wx * SIN30 - wz * COS30;
  return out;
}

interface Walk {
  x: number;
  y: number;
  rot: number;
  moving: boolean;
  dist: number;
}
const WK: Walk = { x: 0, y: 0, rot: 0, moving: false, dist: 0 };
const WK2: Walk = { x: 0, y: 0, rot: 0, moving: false, dist: 0 };

/** Punkt na lamanej [lx, ly, ...] (uklad budynku) po przejsciu czesci u (0..1) jej dlugosci; dist - przebyta droga. */
function along(pts: readonly number[], u: number, out: Walk = WK): Walk {
  let total = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  let d = clamp01(u) * total;
  out.moving = u > 0 && u < 1;
  out.dist = d;
  out.x = pts[0];
  out.y = pts[1];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) out.rot = faceL(dx, dy);
    if (d <= len || i + 4 >= pts.length) {
      const t = len > 1e-6 ? Math.min(1, d / len) : 1;
      out.x = pts[i] + dx * t;
      out.y = pts[i + 1] + dy * t;
      return out;
    }
    d -= len;
  }
  return out;
}

const P: Pose = { x: 0, y: 0, z: 0, rot: 0, owner: 0, type: 0 };

/** Wspolna poza postaci sceny (zerowana przy kazdym uzyciu). */
function pose(x: number, y: number, z: number, rot: number, owner: number, type: number): Pose {
  P.x = x;
  P.y = y;
  P.z = z;
  P.rot = rot;
  P.owner = owner;
  P.type = type;
  P.bob = 0;
  P.lean = 0;
  P.twist = 0;
  P.tilt = 0;
  P.crouch = 0;
  P.legL = 0;
  P.legR = 0;
  P.legLOut = 0;
  P.legROut = 0;
  P.armL = 0;
  P.armR = 0;
  P.armLOut = 0;
  P.armROut = 0;
  P.armLYaw = 0;
  P.armRYaw = 0;
  P.head = 0;
  P.headTurn = 0;
  P.tool = undefined;
  P.toolRoll = 0;
  P.toolL = null;
  P.toolLRoll = 0;
  P.carry = -1;
  P.hat = true;
  return P;
}

function poseAt(c: WorkCtx, o: Origin, lx: number, ly: number, rot: number, owner: number, type: number): Pose {
  const w = c.at(o, lx, ly, 0, w1);
  return pose(w.x, w.y, w.z, rot, owner, type);
}

/** Nogi i rece w marszu po przebyciu drogi dist (swiat). */
function steps(p: Pose, dist: number, arms = true): void {
  const s = Math.sin(dist * STRIDE);
  p.legL = s * 0.55;
  p.legR = -s * 0.55;
  if (arms) {
    p.armL = -s * 0.45;
    p.armR = s * 0.45;
  }
  p.bob = Math.abs(s) * 0.014;
}

/** Postac idaca lamana pts ukladu budynku (u - przebyta czesc drogi). */
function walker(c: WorkCtx, o: Origin, pts: readonly number[], u: number, owner: number, type: number): Pose {
  const w = along(pts, u);
  const p = poseAt(c, o, w.x, w.y, w.rot, owner, type);
  if (w.moving) steps(p, w.dist * o.sc);
  return p;
}

const EXIT_PATH: number[] = [];
/** Droga przebyta (swiat) na ostatnio policzonej drodze doorWalk. */
let exitDist = 0;

/**
 * Pracownik w drodze z budynku na flage (wynosi wyrob) albo z powrotem: zamiast prosto przez sciane idzie lamana
 * pts ukladu budynku (od wnetrza za drzwiami, obok rekwizytow), konczona flaga. Zwraca domyslna poze osadnika
 * przeniesiona na te droge albo null, gdy osadnik nie jest na tym odcinku.
 */
function doorWalk(c: WorkCtx, serf: Serf, at: SerfAt, pts: readonly number[]): Pose | null {
  const b = c.s.buildings[serf.home];
  const flag = b ? c.s.flags[b.flag] : null;
  if (!b || !flag) return null;
  let t: number;
  if (at.moving) t = at.from === b.pos && at.to === flag.pos ? at.t : at.from === flag.pos && at.to === b.pos ? 1 - at.t : -1;
  else t = serf.pos === b.pos ? 0 : serf.pos === flag.pos ? 1 : -1;
  if (t < 0) return null;
  const o = c.origin(b);
  const fw = c.flagOf(b, w2);
  const fl = toLocal(o, fw.x, fw.z, w3);
  EXIT_PATH.length = 0;
  for (const v of pts) EXIT_PATH.push(v);
  EXIT_PATH.push(fl.x, fl.y);
  const w = along(EXIT_PATH, t, WK);
  const q = c.at(o, w.x, w.y, 0, w1);
  const fig = c.walkPose(serf, at);
  fig.x = q.x;
  fig.y = q.y;
  fig.z = q.z;
  exitDist = w.dist * o.sc;
  if (at.moving) {
    fig.rot = at.from === b.pos ? w.rot : w.rot + Math.PI;
    steps(fig, exitDist);
  }
  return fig;
}

/** Macierz tulowia postaci w pozie p (jak w rig.ts). */
function torsoOf(p: Pose, out: THREE.Matrix4): THREE.Matrix4 {
  out.makeTranslation(p.x, p.y + (p.bob ?? 0), p.z).multiply(mB.makeRotationY(p.rot)).multiply(mB.makeScale(US, US, US));
  const crouch = Math.max(0, Math.min(0.09, p.crouch ?? 0));
  out.multiply(mB.makeTranslation(0, HIP - crouch, 0));
  if (p.twist) out.multiply(mB.makeRotationY(p.twist));
  if (p.lean) out.multiply(mB.makeRotationX(p.lean));
  if (p.tilt) out.multiply(mB.makeRotationZ(-p.tilt));
  return out.multiply(mB.makeTranslation(0, -HIP, 0));
}

/**
 * Kieruje reke (side: 1 prawa, -1 lewa) ku punktowi swiata (reka jest sztywna - dlon lezy na prostej
 * bark-punkt w odleglosci dlugosci reki). Zwraca odleglosc barku od punktu w dlugosciach reki.
 */
function reach(p: Pose, side: number, x: number, y: number, z: number): number {
  mInv.copy(torsoOf(p, mT)).invert();
  vA.set(x, y, z).applyMatrix4(mInv);
  const dx = vA.x - side * ARM_X, dy = vA.y - SHOULDER, dz = vA.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = Math.max(-1, Math.min(1, dz / len));
  const as = Math.asin(nz);
  let s: number, b: number;
  if (ny <= 0) {
    s = -as;
    b = Math.atan2(nx, -ny);
  } else {
    s = -Math.PI + as;
    b = Math.atan2(-nx, ny);
  }
  if (side > 0) {
    p.armR = s;
    p.armROut = b;
    p.armRYaw = 0;
  } else {
    p.armL = s;
    p.armLOut = -b;
    p.armLYaw = 0;
  }
  return len / -HAND;
}

function reachV(p: Pose, side: number, v: Vec3): number {
  return reach(p, side, v.x, v.y, v.z);
}

/** Punkt (lx, ly, lz) ukladu macierzy m w swiecie. */
function pt(m: THREE.Matrix4, lx: number, ly: number, lz: number, out: Vec3): Vec3 {
  vB.set(lx, ly, lz).applyMatrix4(m);
  out.x = vB.x;
  out.y = vB.y;
  out.z = vB.z;
  return out;
}

/** Dlon postaci (macierz reki z figure()) w swiecie. */
function hand(arm: THREE.Matrix4, out: Vec3): Vec3 {
  return pt(arm, 0, HAND, 0, out);
}

/** Punkt przed postacia: naprzod f, w prawo r, w gore u (swiat) od stop postaci w pozie p. */
function front(p: Pose, f: number, r: number, u: number, out: Vec3): Vec3 {
  const s = Math.sin(p.rot), co = Math.cos(p.rot);
  out.x = p.x + s * f + co * r;
  out.y = p.y + u;
  out.z = p.z + co * f - s * r;
  return out;
}

/** Macierz rekwizytu: punkt swiata, obrot wokol pionu, pochylenie (+ = przod w dol), przechyl, skala osi. */
function ypr(m: THREE.Matrix4, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  m.makeTranslation(x, y, z);
  if (yaw) m.multiply(mB.makeRotationY(yaw));
  if (pitch) m.multiply(mB.makeRotationX(pitch));
  if (roll) m.multiply(mB.makeRotationZ(roll));
  if (sx !== 1 || sy !== 1 || sz !== 1) m.multiply(mB.makeScale(sx, sy, sz));
  return m;
}

/** Przejscie miedzy dwoma ulozeniami rekwizytu (polozenie, obrot, skala). */
function blend(out: THREE.Matrix4, from: THREE.Matrix4, to: THREE.Matrix4, t: number): THREE.Matrix4 {
  from.decompose(vA, qA, sA);
  to.decompose(vC, qB, sB);
  vA.lerp(vC, t);
  qA.slerp(qB, t);
  sA.lerp(sB, t);
  return out.compose(vA, qA, sA);
}

/** Sznur (pret crf_rope) miedzy dwoma punktami swiata. */
function rope(c: WorkCtx, a: Vec3, b: Vec3, t: number, color = ROPE): void {
  vA.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = vA.length();
  if (len < 1e-4) return;
  qA.setFromUnitVectors(Y_UP, vA.multiplyScalar(1 / len));
  mA.compose(vB.set(a.x, a.y, a.z), qA, sA.set(t, len, t));
  c.propM('crf_rope', mA, color);
}

/** Rekwizyt w ukladzie budynku: punkt (lx, ly, lz), obrot wokol pionu, pochylenie, skala osi (sx, sy - w gore, sz). */
function inBuilding(c: WorkCtx, o: Origin, name: string, lx: number, ly: number, lz: number, rot: number,
  sx: number, sy: number, sz: number, color?: number, pitch = 0): void {
  mA.copy(c.frameOf(o)).multiply(mB.makeTranslation(lx, lz, -ly));
  if (rot) mA.multiply(mB.makeRotationY(rot));
  if (pitch) mA.multiply(mB.makeRotationX(pitch));
  mA.multiply(mB.makeScale(sx, sy, sz));
  c.propM(name, mA, color);
}

/** Migotanie ognia 0..1 (dwie nalozone fale). */
function flicker(t: number, seed: number): number {
  return 0.5 + 0.3 * Math.sin(t * 7.3 + seed) + 0.2 * Math.sin(t * 13.1 + seed * 2.7);
}

/** Zar w otworze (crf_glow): luk o podstawie w (lx, ly, lz) ukladu budynku, szerokosci w i wysokosci h. */
function glow(c: WorkCtx, o: Origin, lx: number, ly: number, lz: number, w: number, h: number, color: number): void {
  inBuilding(c, o, 'crf_glow', lx, ly, lz, 0, w, h / 1.1, 0.02, color);
}

// ---------------------------------------------------------------- mlyn

/** Mlyn (uklad modelu): piasta skrzydel, worki zboza na palecie (lx, ly, obrot; ostatni bierze mlynarz),
 *  wysokosc palety, miejsce mlynarza przy palecie, prog drzwi (pyl). */
const MILL = {
  hub: { x: 0, y: -0.31, z: 0.5 },
  sacks: [-0.335, -0.165, 0.3, -0.31, -0.222, -0.5, -0.275, -0.145, 1.2, -0.255, -0.2, 0.1],
  pallet: 0.014,
  stand: { x: -0.2, y: -0.13 },
  door: { x: 0.085, y: -0.2, z: 0.03 },
};
/** Etapy cyklu mlyna: dojscie do palety, schylenie, worek na ramie, powrot do drzwi; wyjscie i trzepanie worka. */
const MILL_T = { at: 0.105, grab: 0.135, lift: 0.175, inside: 0.29, out2: 0.55, shake0: 0.575, shake1: 0.665, in2: 0.69 };
/** Droga mlynarza od drzwi pod skrzydlami (za ich plaszczyzna) do palety. */
const MILL_FETCH = [0.09, -0.12, 0.08, -0.205, -0.065, -0.235, -0.17, -0.195, -0.2, -0.13];
const MILL_BACK = [-0.2, -0.13, -0.17, -0.195, -0.065, -0.235, 0.08, -0.205, 0.09, -0.12];
const MILL_STEP_OUT = [0.09, -0.12, 0.07, -0.22];
const MILL_STEP_IN = [0.07, -0.22, 0.09, -0.12];
/** Droga mlynarza z maka od drzwi na flage (flage dopisuje doorWalk). */
const MILL_EXIT = [0.09, -0.12, 0.08, -0.22, 0.03, -0.34];
const SACK_S = 0.85;
/** Worek na ramieniu (uklad tulowia, jednostki postaci; x prawego ramienia): podstawa za barkiem, worek wzdluz ramienia. */
const SACK_SHOULDER = { x: 0.085, y: 0.385, z: -0.08 };
const DOOR_DUST: FxOptions = {
  kind: 'puff', n: 9, life: 2.2, vx: OUT_X * 0.04, vz: OUT_Z * 0.04, vy: 0.07, spread: 0.035, spreadY: 0.02, gravity: -0.012,
  size: 0.03, sizeEnd: 0.095, color: FLOUR, colorEnd: 0xebe8e0, jitter: 0.03, sway: 0.025, fade: 0.45,
};
const SACK_DUST: FxOptions = {
  kind: 'puff', n: 7, life: 1.0, vy: 0.12, spread: 0.1, spreadY: 0.05, gravity: -0.04, size: 0.03, sizeEnd: 0.085,
  color: FLOUR, colorEnd: 0xebe7de, jitter: 0.03, fade: 0.5,
};

/** Skrzydla mlynow: kat i predkosc (rozpedzaja sie i zwalniaja plynnie), czas ostatniej klatki. */
const sails = new Map<number, { a: number; v: number; t: number }>();

function millSails(c: WorkCtx, b: Building, o: Origin, milling: boolean): void {
  let st = sails.get(b.id);
  if (!st) {
    st = { a: b.id * 1.7, v: 0.3, t: c.time };
    sails.set(b.id, st);
  }
  const dt = Math.min(0.25, Math.max(0, c.time - st.t));
  st.t = c.time;
  st.v += ((milling ? 2.3 : 0.3) - st.v) * Math.min(1, dt * 0.7);
  st.a += st.v * dt;
  const hub = c.at(o, MILL.hub.x, MILL.hub.y, MILL.hub.z, w1);
  mA.makeTranslation(hub.x, hub.y, hub.z).multiply(mB.makeRotationY(BROT)).multiply(mB.makeRotationZ(st.a)).multiply(mB.makeScale(o.sc, o.sc, o.sc));
  c.propM('crf_sails', mA);
}

function grainSack(c: WorkCtx, o: Origin, k: number, m?: THREE.Matrix4): void {
  const s = MILL.sacks;
  const q = c.at(o, s[k * 3], s[k * 3 + 1], MILL.pallet, w3);
  if (m) ypr(m, q.x, q.y, q.z, BROT + s[k * 3 + 2], 0, 0, SACK_S);
  else c.prop('crf_sack', q.x, q.y, q.z, BROT + s[k * 3 + 2], SACK_S, SACK_S, GRAIN);
}

/**
 * Worek na ramieniu postaci w pozie p (side: 1 prawe, -1 lewe; macierz do `out`); reka z tej strony
 * przytrzymuje go z wierzchu. Sceny wybieraja ramie od strony kamery, zeby worek nie znikal za postacia.
 */
function sackOnShoulder(p: Pose, out: THREE.Matrix4, side: number, hold = true): THREE.Matrix4 {
  torsoOf(p, out).multiply(mB.makeTranslation(side * SACK_SHOULDER.x, SACK_SHOULDER.y, SACK_SHOULDER.z));
  out.multiply(mB.makeRotationX(Math.PI / 2)).multiply(mB.makeScale(SACK_S / US, SACK_S / US, SACK_S / US));
  if (hold) reachV(p, side, pt(out, side * 0.01, 0.1, -0.045, w4));
  return out;
}

/** Mlynarz przy palecie: schyla sie, chwyta worek oburacz i zarzuca go na ramie. */
function millerLift(c: WorkCtx, b: Building, o: Origin, p: number): void {
  const st = c.at(o, MILL.stand.x, MILL.stand.y, 0, w1);
  const rest = c.at(o, MILL.sacks[9], MILL.sacks[10], MILL.pallet, w2);
  const rot = c.facing(st.x, st.z, rest.x, rest.z);
  const g = smooth(span(p, MILL_T.at, MILL_T.grab)), l = smooth(span(p, MILL_T.grab, MILL_T.lift));
  const fig = pose(st.x, st.y, st.z, lerpAngle(faceL(-0.3, 0.6), rot, smooth(span(p, MILL_T.at, MILL_T.at + 0.01))), b.owner, S.MILLER);
  const bend = Math.sin(Math.PI * Math.min(1, g * 0.5 + l * 0.5));
  fig.lean = 0.7 * bend;
  fig.crouch = 0.05 * bend;
  fig.head = 0.25 * bend;
  fig.legL = -0.25 * bend;
  fig.legR = 0.15 * bend;
  grainSack(c, o, 3, mFrom);
  sackOnShoulder(fig, mProp, -1, false);
  blend(mA, mFrom, mProp, l);
  // Luk nad postacia: worek idzie najpierw w gore przed soba.
  vA.setFromMatrixPosition(mA);
  const arc = Math.sin(Math.PI * l) * 0.07;
  mA.setPosition(vA.x + Math.sin(rot) * arc * 0.6, vA.y + arc, vA.z + Math.cos(rot) * arc * 0.6);
  if (l < 0.85) {
    reachV(fig, 1, pt(mA, 0.03, 0.115, 0, w4));
    reachV(fig, -1, pt(mA, -0.03, 0.115, 0, w4));
  } else {
    reachV(fig, -1, pt(mA, -0.01, 0.1, -0.045, w4));
    fig.armR = 0;
  }
  c.figure(fig);
  c.propM('crf_sack', mA, GRAIN);
}

/** Mlynarz w drzwiach wytrzepuje pusty worek: trzy szarpniecia, przy kazdym chmura pylu. */
function millerShake(c: WorkCtx, b: Building, o: Origin, p: number): void {
  const out = p < MILL_T.shake0, back = p >= MILL_T.shake1;
  const face = faceL(-0.6, -1);
  let fig: Pose;
  if (out) {
    fig = walker(c, o, MILL_STEP_OUT, span(p, MILL_T.out2, MILL_T.shake0), b.owner, S.MILLER);
    fig.rot = lerpAngle(fig.rot, face, smooth(span(p, MILL_T.out2 + 0.015, MILL_T.shake0)));
  } else if (back) {
    fig = walker(c, o, MILL_STEP_IN, span(p, MILL_T.shake1, MILL_T.in2), b.owner, S.MILLER);
  } else fig = poseAt(c, o, MILL_STEP_OUT[2], MILL_STEP_OUT[3], face, b.owner, S.MILLER);
  const sh = span(p, MILL_T.shake0, MILL_T.shake1) * 3;
  const k = Math.min(2, Math.floor(sh)), f = sh - k;
  const shaking = !out && !back;
  const up = shaking ? (f < 0.6 ? smooth(f / 0.6) : 1 - smooth((f - 0.6) / 0.4)) : 0;
  if (shaking) {
    fig.lean = 0.1 - 0.1 * up;
    reachV(fig, 1, front(fig, 0.1, 0.03, 0.2 + 0.09 * up, w4));
    reachV(fig, -1, front(fig, 0.1, -0.03, 0.2 + 0.09 * up, w4));
  } else fig.armR = -0.2;
  const fr = c.figure(fig);
  hand(fr.armR, w4);
  if (shaking) {
    hand(fr.armL, w5);
    w4.x = (w4.x + w5.x) / 2;
    w4.y = (w4.y + w5.y) / 2;
    w4.z = (w4.z + w5.z) / 2;
  }
  const swing = shaking ? Math.sin(f * TAU) * 0.7 : 0;
  ypr(mA, w4.x, w4.y, w4.z, fig.rot, Math.PI + swing, 0, SACK_S, SACK_S * 1.1, SACK_S * 0.28);
  c.propM('crf_sack', mA, GRAIN);
  if (shaking && f >= 0.6) {
    const flap = ((MILL_T.shake1 - MILL_T.shake0) / 3) * cycleSec(B.MILL);
    const cy = w4.y - 0.07;
    c.fx.burst(b.id * 31 + k, (f - 0.6) * flap, w4.x + Math.sin(fig.rot) * 0.03, cy, w4.z + Math.cos(fig.rot) * 0.03, SACK_DUST);
  }
}

/** Mlyn: skrzydla, worki zboza na palecie, mlynarz z workiem, pyl w drzwiach. */
function mill(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  // Skrzydla rozpedzaja sie, gdy mlynarz wniesie zboze i zaczyna mielic.
  millSails(c, b, o, p >= MILL_T.inside - 0.04);
  const stock = b.stock[0] ?? 0;
  for (let k = 0; k < Math.min(3, stock); k++) grainSack(c, o, k);
  if (p >= 0 ? p < MILL_T.grab : stock >= 4) grainSack(c, o, 3);
  if (p < 0) return;
  const dust = span(p, 0.3, 0.38) * (1 - span(p, 0.96, 1)) * (0.55 + 0.45 * span(p, 0.7, 0.9));
  if (dust > 0) {
    const d = c.at(o, MILL.door.x, MILL.door.y, MILL.door.z, w1);
    c.fx.stream(b.id * 16 + 3, d.x, d.y, d.z, DOOR_DUST, dust);
  }
  if (p < MILL_T.at) {
    c.figure(walker(c, o, MILL_FETCH, cruise(p / MILL_T.at), b.owner, S.MILLER));
  } else if (p < MILL_T.lift) {
    millerLift(c, b, o, p);
  } else if (p < MILL_T.inside) {
    const fig = walker(c, o, MILL_BACK, cruise(span(p, MILL_T.lift, MILL_T.inside)), b.owner, S.MILLER);
    sackOnShoulder(fig, mProp, -1);
    c.figure(fig);
    c.propM('crf_sack', mProp, GRAIN);
  } else if (p >= MILL_T.out2 && p < MILL_T.in2) {
    millerShake(c, b, o, p);
  }
}

/** Mlynarz wynosi make na flage: worek na lewym ramieniu (od strony kamery); droga od drzwi. */
function miller(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, MILL_EXIT);
  if (!fig) return false;
  if (serf.carry === G.FLOUR) {
    fig.carry = -1;
    fig.tool = null;
    sackOnShoulder(fig, mProp, -1);
    c.figure(fig);
    c.propM('crf_sack', mProp, FLOUR);
  } else c.figure(fig);
  return true;
}

// ---------------------------------------------------------------- piekarnia

/**
 * Piekarnia (uklad modelu): stol z lewej (srodek, wysokosc blatu) z miejscami na bochenki (lx), kosz i ciasto
 * na stole, miejsce piekarza za stolem, stanowisko z lopata miedzy stolem a piecem, dolna krawedz otworu pieca,
 * lopata oparta o lewa sciane (stopa, gora) i miejsce, z ktorego piekarz ja bierze, wylot komina.
 */
const BAKERY = {
  table: { x: -0.42, y: -0.35, top: 0.08 },
  slots: [-0.445, -0.41, -0.375, -0.34],
  basket: { x: -0.49, y: -0.35 },
  dough: -0.395,
  knead: { x: -0.42, y: -0.265 },
  station: { x: -0.26, y: -0.375 },
  mouth: { x: -0.08, y: -0.27, z: 0.08 },
  peelFoot: { x: -0.25, y: -0.19 },
  peelTop: { x: -0.216, y: -0.19, z: 0.2 },
  peelGrab: { x: -0.3, y: -0.215 },
  chimney: { x: 0.3, y: 0.14, z: 0.672 },
};
/** Etapy cyklu piekarni (koniec etapu). */
const BAKE_T = {
  atTable: 0.08, rolled: 0.22, shaped: 0.3, toPeel: 0.32, grab: 0.335, atStation: 0.36, loaded: 0.4, pushed: 0.46,
  baked: 0.56, trips: 0.8, peelBack: 0.82, toTable: 0.84, packed: 0.88, lifted: 0.9,
};
const BAKE_IN = [0.14, -0.21, 0.12, -0.34, -0.2, -0.34, -0.3, -0.27, -0.42, -0.265];
const BAKE_TO_PEEL = [-0.42, -0.265, -0.3, -0.215];
const BAKE_TO_STATION = [-0.3, -0.215, -0.26, -0.375];
const BAKE_PEEL_BACK = [-0.26, -0.375, -0.3, -0.215];
const BAKE_TO_TABLE = [-0.3, -0.215, -0.42, -0.265];
const BAKE_HOME = [-0.42, -0.265, -0.3, -0.27, -0.2, -0.34, 0.12, -0.34, 0.14, -0.21];
const BAKERY_EXIT = [0.14, -0.19, 0.14, -0.33];
const LOAF_TABLE = 0.8;
const LOAF_PEEL = 0.55;
/** Bochenki na piorze lopaty (uklad lopaty: x, z wzdluz). */
const PEEL_LOAVES = [-0.017, 0.28, 0.017, 0.28, -0.017, 0.318, 0.017, 0.318];
const FLOUR_PUFF: FxOptions = {
  kind: 'puff', n: 4, life: 0.7, vy: 0.08, spread: 0.06, spreadY: 0.03, gravity: -0.02, size: 0.018, sizeEnd: 0.05,
  color: FLOUR, jitter: 0.02, fade: 0.5,
};

function tableLoaf(c: WorkCtx, o: Origin, k: number, color: number, s = LOAF_TABLE): void {
  const q = c.at(o, BAKERY.slots[k], BAKERY.table.y, BAKERY.table.top, w3);
  c.prop('crf_loaf', q.x, q.y, q.z, BROT + Math.PI / 2 + k * 0.13, s, s, color);
}

/** Lopata trzymana oburacz przed soba (wysuniecie push 0..1); macierz w mProp, rece na trzonku. */
function peelHeld(fig: Pose, push: number): THREE.Matrix4 {
  fig.lean = 0.18 + 0.12 * push;
  const g = front(fig, 0.05 + 0.05 * push, 0.035, 0.15 - 0.01 * push, w4);
  ypr(mProp, g.x, g.y, g.z, fig.rot, 0.06);
  reachV(fig, 1, g);
  reachV(fig, -1, pt(mProp, 0, 0, 0.08, w5));
  return mProp;
}

/** Lopata oparta o lewa sciane piekarni (macierz w `out`). */
function peelResting(c: WorkCtx, o: Origin, out: THREE.Matrix4): THREE.Matrix4 {
  const top = c.at(o, BAKERY.peelTop.x, BAKERY.peelTop.y, BAKERY.peelTop.z, w3);
  const foot = c.at(o, BAKERY.peelFoot.x, BAKERY.peelFoot.y, 0.004, w5);
  const dx = foot.x - top.x, dz = foot.z - top.z;
  return ypr(out, top.x, top.y, top.z, Math.atan2(dx, dz), Math.atan2(top.y - foot.y, Math.hypot(dx, dz)));
}

/** Lopata wsparta piorem o ziemie przed piekarzem, oburacz na gornym koncu trzonka (macierz w `out`). */
function peelLeaning(fig: Pose, out: THREE.Matrix4): THREE.Matrix4 {
  const g = front(fig, 0.07, 0.025, 0.2, w4);
  ypr(out, g.x, g.y, g.z, fig.rot, Math.asin(0.196 / 0.3));
  reachV(fig, 1, g);
  reachV(fig, -1, pt(out, 0, 0, 0.05, w5));
  return out;
}

/**
 * Ogien w piecu (natezenie heat 0..1) i dym z komina. W ciemnym otworze: czerwona poswiata, trzy jezyki
 * ognia o migoczacej wysokosci i jasny zar na dnie.
 */
function bakeryFire(c: WorkCtx, b: Building, o: Origin, heat: number, smoke: number): void {
  const fl = flicker(c.time, b.id);
  const m = BAKERY.mouth;
  glow(c, o, m.x, m.y, m.z, 0.092, 0.075 + 0.03 * heat, mix(0x1e0703, 0xb8400f, heat * (0.55 + 0.45 * fl)));
  for (let k = -1; k <= 1; k++) {
    const f = flicker(c.time * 1.3, b.id + k * 3.1);
    const h = (0.025 + 0.05 * heat * f) * (k === 0 ? 1.2 : 0.85);
    inBuilding(c, o, 'crf_flame', m.x + k * 0.025, m.y - 0.003, m.z + 0.004, 0, 0.026, h / 1.75, 0.006, mix(0xc0400c, FLAME, heat * f));
  }
  glow(c, o, m.x, m.y - 0.003, m.z, 0.088, 0.016 + 0.008 * heat * fl, mix(0x7a2206, 0xffe08a, heat * (0.6 + 0.4 * fl)));
  const ch = c.at(o, BAKERY.chimney.x, BAKERY.chimney.y, BAKERY.chimney.z, w1);
  c.fx.smoke(b.id * 16 + 5, ch.x, ch.y, ch.z, smoke);
}

/** Piekarz walkuje ciasto: walek oburacz przetaczany po ciescie tam i z powrotem; co ruch obloczek maki. */
function bakerRolling(c: WorkCtx, b: Building, o: Origin, u: number): void {
  const t = BAKERY.table;
  const fig = poseAt(c, o, BAKERY.knead.x, BAKERY.knead.y, faceL(0, -1), b.owner, S.BAKER);
  fig.lean = 0.26;
  fig.head = 0.12;
  const strokes = 5;
  const ph = u * strokes * TAU;
  const roll = -Math.sin(ph) * 0.025;
  const q = c.at(o, BAKERY.dough, t.y + roll, t.top + 0.009, w2);
  const rx = Math.cos(fig.rot), rz = -Math.sin(fig.rot);
  reach(fig, 1, q.x + rx * 0.043, q.y + 0.01, q.z + rz * 0.043);
  reach(fig, -1, q.x - rx * 0.043, q.y + 0.01, q.z - rz * 0.043);
  fig.tool = null;
  c.figure(fig);
  mA.makeTranslation(q.x, q.y, q.z).multiply(mB.makeRotationY(fig.rot)).multiply(mB.makeScale(US, US, US)).multiply(mB.makeTranslation(0, 0.16, -0.03));
  c.propM('tool_rolling_pin', mA);
  // Ciasto: z bryly placek coraz cienszy i szerszy.
  const k = smooth(Math.min(1, u * 1.3));
  const d = c.at(o, BAKERY.dough, t.y, t.top, w3);
  ypr(mA, d.x, d.y, d.z, BROT, 0, 0, lerp(0.95, 1.6, k), lerp(1.5, 0.38, k), lerp(1.1, 1.9, k));
  c.propM('crf_loaf', mA, DOUGH);
  const n = Math.floor(ph / Math.PI);
  const age = ((ph / Math.PI - n) * (BAKE_T.rolled - BAKE_T.atTable) * cycleSec(B.BAKERY)) / (strokes * 2);
  if (n % 2 === 0) c.fx.burst(b.id * 41 + n, age, d.x, d.y + 0.01, d.z, FLOUR_PUFF);
}

/** Piekarz formuje bochenki: placek maleje, na stole przybywa surowych bochenkow; dlonie klepia ciasto. */
function bakerShaping(c: WorkCtx, b: Building, o: Origin, u: number): void {
  const t = BAKERY.table;
  const fig = poseAt(c, o, BAKERY.knead.x, BAKERY.knead.y, faceL(0, -1), b.owner, S.BAKER);
  fig.lean = 0.4;
  fig.head = 0.3;
  fig.tool = null;
  const made = Math.min(4, Math.floor(u * 4.4));
  const pat = Math.abs(Math.sin(u * 4.4 * Math.PI * 3));
  const k = Math.min(3, made);
  const q = c.at(o, lerp(BAKERY.dough, BAKERY.slots[k], 0.6), t.y, t.top + 0.02 + 0.02 * pat, w2);
  const rx = Math.cos(fig.rot), rz = -Math.sin(fig.rot);
  reach(fig, 1, q.x + rx * 0.025, q.y, q.z + rz * 0.025);
  reach(fig, -1, q.x - rx * 0.025, q.y + 0.01 * (1 - pat), q.z - rz * 0.025);
  c.figure(fig);
  const left = 1 - made / 4;
  if (left > 0) {
    const d = c.at(o, BAKERY.dough, t.y, t.top, w3);
    ypr(mA, d.x, d.y, d.z, BROT, 0, 0, 1.6 * Math.sqrt(left), 0.38 + 0.4 * (1 - left), 1.9 * Math.sqrt(left));
    c.propM('crf_loaf', mA, DOUGH);
  }
  for (let i = 0; i < made; i++) tableLoaf(c, o, i, DOUGH);
}

/** Bochenki (n) na lopacie w ulozeniu `peel`, lopata skierowana w strone yaw. */
function peelLoaves(c: WorkCtx, peel: THREE.Matrix4, yaw: number, n: number, color: number): void {
  for (let i = 0; i < n; i++) {
    pt(peel, PEEL_LOAVES[i * 2], 0.004, PEEL_LOAVES[i * 2 + 1], w3);
    c.prop('crf_loaf', w3.x, w3.y, w3.z, yaw + Math.PI / 2, LOAF_PEEL, LOAF_PEEL, color);
  }
}

/**
 * Piekarz przy stanowisku z lopata. turn: 0 - twarza do pieca, 1 - do stolu; push: wysuniecie lopaty.
 */
function bakerAtStation(c: WorkCtx, o: Origin, b: Building, turn: number, push: number): Pose {
  const st = c.at(o, BAKERY.station.x, BAKERY.station.y, 0, w1);
  const mo = c.at(o, BAKERY.mouth.x, BAKERY.mouth.y, 0, w2);
  const toOven = c.facing(st.x, st.z, mo.x, mo.z);
  const tb = c.at(o, BAKERY.table.x, BAKERY.table.y, 0, w2);
  const toTable = c.facing(st.x, st.z, tb.x, tb.z);
  const step = 0.035 * push * (1 - turn) * o.sc;
  const rot = lerpAngle(toOven, toTable, smooth(turn));
  const fig = pose(st.x + Math.sin(rot) * step, st.y, st.z + Math.cos(rot) * step, rot, b.owner, S.BAKER);
  fig.tool = null;
  if (turn > 0 && turn < 1) {
    fig.legL = Math.sin(turn * Math.PI * 2) * 0.25;
    fig.legR = -fig.legL;
  }
  return fig;
}

/** Kosz na lewym koncu stolu: pusty albo z chlebem. */
function tableBasket(c: WorkCtx, o: Origin, full: boolean): void {
  const q = c.at(o, BAKERY.basket.x, BAKERY.basket.y, BAKERY.table.top, w3);
  c.prop(full ? 'crf_basket' : 'crf_basket_empty', q.x, q.y, q.z, BROT + 0.3);
}

/** Kosz trzymany oburacz przed soba: rece na brzegach, polozenie kosza (podstawa) w `out`. */
function basketHeld(fig: Pose, out: Vec3): Vec3 {
  const k = front(fig, 0.085, 0, 0.13 + (fig.bob ?? 0), out);
  const rx = Math.cos(fig.rot) * 0.045, rz = -Math.sin(fig.rot) * 0.045;
  reach(fig, 1, k.x + rx, k.y + 0.04, k.z + rz);
  reach(fig, -1, k.x - rx, k.y + 0.04, k.z - rz);
  return k;
}

/** Kosz przenoszony miedzy rekami piekarza (stojacego za stolem) a stolem: u = 0 w rekach, 1 na stole. */
function basketToTable(c: WorkCtx, o: Origin, fig: Pose, u: number, full: boolean): void {
  const hk = front(fig, 0.085, 0, 0.13, w4);
  const tb = c.at(o, BAKERY.basket.x, BAKERY.basket.y, BAKERY.table.top, w3);
  const x = lerp(hk.x, tb.x, u), y = lerp(hk.y, tb.y, u) + Math.sin(Math.PI * u) * 0.02, z = lerp(hk.z, tb.z, u);
  fig.lean = 0.2 * Math.sin(Math.PI * u) + 0.1 * u;
  const rx = Math.cos(fig.rot) * 0.045, rz = -Math.sin(fig.rot) * 0.045;
  reach(fig, 1, x + rx, y + 0.04, z + rz);
  reach(fig, -1, x - rx, y + 0.04, z - rz);
  c.figure(fig);
  c.prop(full ? 'crf_basket' : 'crf_basket_empty', x, y, z, lerpAngle(fig.rot, BROT + 0.3, u));
}

/** Piekarnia: piec, komin, stol z ciastem i chlebem, kosz, piekarz z walkiem, lopata i koszem. */
function bakery(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  const T = BAKE_T;
  let heat = 0.3, smoke = 0.15;
  if (p >= 0) {
    heat = 0.55;
    smoke = 0.45;
    if (p >= T.loaded) {
      const push = span(p, T.loaded + 0.02, T.loaded + 0.04);
      heat = lerp(0.55, 1, push);
      smoke = lerp(0.45, 1, push);
      if (p >= T.trips) {
        heat = lerp(1, 0.6, span(p, T.trips, 1));
        smoke = lerp(1, 0.5, span(p, T.trips, 1));
      }
    }
  }
  bakeryFire(c, b, o, heat, smoke);
  const peelOut = p >= T.grab && p < T.trips + 0.01;
  if (!peelOut) {
    peelResting(c, o, mA);
    c.propM('crf_peel', mA);
  }
  if (p < 0) return;
  // Kosz przyniesiony na poczatku cyklu stoi na stole; na koncu piekarz pakuje do niego chleb i go wynosi.
  if (p >= T.atTable && p < T.packed) tableBasket(c, o, p >= T.toTable + 0.012);
  if (p < T.atTable) {
    const placeAt = T.atTable - 0.014;
    if (p < placeAt) {
      const fig = walker(c, o, BAKE_IN, cruise(p / placeAt), b.owner, S.BAKER);
      fig.tool = null;
      const k = basketHeld(fig, w2);
      c.figure(fig);
      c.prop('crf_basket_empty', k.x, k.y, k.z, fig.rot);
    } else {
      // Stawia pusty kosz na lewym koncu stolu.
      const fig = poseAt(c, o, BAKERY.knead.x, BAKERY.knead.y, faceL(0, -1), b.owner, S.BAKER);
      fig.tool = null;
      basketToTable(c, o, fig, smooth(span(p, placeAt, T.atTable)), false);
    }
    return;
  }
  if (p < T.rolled) {
    bakerRolling(c, b, o, span(p, T.atTable, T.rolled));
    return;
  }
  if (p < T.shaped) {
    bakerShaping(c, b, o, span(p, T.rolled, T.shaped));
    return;
  }
  // Surowe bochenki na stole do chwili przelozenia na lopate; upieczone przybywaja z kolejnych kursow od pieca,
  // a na koncu po kolei trafiaja do kosza.
  const loadU = span(p, T.atStation + 0.015, T.loaded);
  const onPeel = Math.min(4, Math.floor(loadU * 4.4));
  if (p < T.loaded) for (let k = onPeel; k < 4; k++) tableLoaf(c, o, k, DOUGH);
  const tripU = span(p, T.baked, T.trips) * 4;
  const done = p >= T.trips ? 4 : Math.floor(tripU);
  const placed = p >= T.trips ? 4 : done + (tripU - done >= 0.95 ? 1 : 0);
  const packU = span(p, T.toTable, T.packed) * 4;
  const packed = p >= T.packed ? 4 : Math.floor(packU);
  for (let k = packed + (p >= T.toTable && p < T.packed ? 1 : 0); k < placed; k++) tableLoaf(c, o, k, CRUST);
  if (p < T.toPeel) {
    c.figure(walker(c, o, BAKE_TO_PEEL, cruise(span(p, T.shaped, T.toPeel)), b.owner, S.BAKER));
    return;
  }
  if (p < T.grab) {
    // Siega po lopate oparta o sciane.
    const fig = poseAt(c, o, BAKERY.peelGrab.x, BAKERY.peelGrab.y, faceL(0.8, 0.3), b.owner, S.BAKER);
    fig.tool = null;
    const g = span(p, T.toPeel, T.grab);
    fig.lean = 0.15 * Math.sin(Math.PI * g);
    peelResting(c, o, mFrom);
    reachV(fig, 1, pt(mFrom, 0, 0, 0.06 + 0.04 * g, w4));
    c.figure(fig);
    c.propM('crf_peel', mFrom);
    return;
  }
  if (p < T.atStation) {
    const fig = walker(c, o, BAKE_TO_STATION, span(p, T.grab, T.atStation), b.owner, S.BAKER);
    fig.tool = null;
    const legL = fig.legL, legR = fig.legR;
    peelHeld(fig, 0);
    fig.legL = legL;
    fig.legR = legR;
    c.figure(fig);
    c.propM('crf_peel', mProp);
    return;
  }
  if (p < T.loaded) {
    // Odwraca sie do stolu i zsuwa surowe bochenki na lopate.
    const fig = bakerAtStation(c, o, b, smooth(span(p, T.atStation, T.atStation + 0.015)), 0);
    peelHeld(fig, 0);
    c.figure(fig);
    c.propM('crf_peel', mProp);
    if (c.details) peelLoaves(c, mProp, fig.rot, onPeel, DOUGH);
    return;
  }
  if (p < T.pushed) {
    // Do pieca: obrot, wsuniecie lopaty z bochenkami, wyjecie pustej.
    const turn = 1 - smooth(span(p, T.loaded, T.loaded + 0.02));
    const push = span(p, T.loaded + 0.02, T.loaded + 0.04) * (1 - span(p, T.loaded + 0.045, T.pushed));
    const fig = bakerAtStation(c, o, b, turn, push);
    peelHeld(fig, push);
    c.figure(fig);
    c.propM('crf_peel', mProp);
    if (c.details && p < T.loaded + 0.042) peelLoaves(c, mProp, fig.rot, 4, DOUGH);
    return;
  }
  if (p < T.baked) {
    // Czeka odwrocony od pieca, wsparty na lopacie; raz ociera czolo.
    const fig = bakerAtStation(c, o, b, 0, 0);
    const toOven = fig.rot;
    const out = smooth(span(p, T.pushed, T.pushed + 0.015)) * (1 - smooth(span(p, T.baked - 0.015, T.baked)));
    fig.rot = lerpAngle(toOven, faceL(-0.3, -1), out);
    if (out > 0 && out < 1) {
      fig.legL = Math.sin(out * Math.PI * 2) * 0.25;
      fig.legR = -fig.legL;
    }
    peelHeld(fig, 0);
    mFrom.copy(mProp);
    peelLeaning(fig, mBody);
    blend(mProp, mFrom, mBody, out);
    if (out < 1) {
      reachV(fig, 1, pt(mProp, 0, 0, 0, w4));
      reachV(fig, -1, pt(mProp, 0, 0, out > 0.5 ? 0.05 : 0.08, w4));
    }
    const wipe = Math.sin(Math.PI * span(p, T.pushed + 0.035, T.pushed + 0.065));
    if (wipe > 0) {
      fig.armL = lerp(fig.armL ?? 0, -2.6, wipe);
      fig.armLOut = lerp(fig.armLOut ?? 0, 0.5, wipe);
      fig.head = -0.15 * wipe;
    }
    c.figure(fig);
    c.propM('crf_peel', mProp);
    return;
  }
  if (p < T.trips) {
    // Kursy od pieca do stolu: wsuniecie, wyjecie bochenka, obrot do stolu, zsuniecie na stol.
    const k = Math.min(3, Math.floor(tripU)), f = tripU - k;
    const toOven = 1 - smooth(clamp01(f / 0.15));
    const push = clamp01((f - 0.08) / 0.12) * (1 - clamp01((f - 0.3) / 0.15));
    const turn = f < 0.45 ? 1 - toOven : smooth(clamp01((f - 0.45) / 0.25));
    const tilt = clamp01((f - 0.75) / 0.2);
    const fig = bakerAtStation(c, o, b, k === 0 && f < 0.15 ? 0 : turn, push);
    peelHeld(fig, push);
    if (tilt > 0) mProp.multiply(mB.makeRotationZ(tilt * 0.5));
    c.figure(fig);
    c.propM('crf_peel', mProp);
    if (c.details && f > 0.24 && f < 0.95) {
      pt(mProp, 0, 0.004, 0.3 - 0.06 * tilt, w3);
      const tl = c.at(o, BAKERY.slots[k], BAKERY.table.y, BAKERY.table.top, w2);
      const j = smooth(tilt);
      c.prop('crf_loaf', lerp(w3.x, tl.x, j), lerp(w3.y, tl.y, j) + Math.sin(Math.PI * j) * 0.02, lerp(w3.z, tl.z, j),
        lerpAngle(fig.rot + Math.PI / 2, BROT + Math.PI / 2 + k * 0.13, j), lerp(LOAF_PEEL, LOAF_TABLE, j), lerp(LOAF_PEEL, LOAF_TABLE, j), CRUST);
    }
    return;
  }
  if (p < T.peelBack) {
    // Odstawia lopate pod sciane.
    const u = span(p, T.trips, T.peelBack);
    const fig = walker(c, o, BAKE_PEEL_BACK, Math.min(1, u * 1.6), b.owner, S.BAKER);
    fig.tool = null;
    if (u < 0.62) {
      const legL = fig.legL, legR = fig.legR;
      peelHeld(fig, 0);
      fig.legL = legL;
      fig.legR = legR;
      c.figure(fig);
      c.propM('crf_peel', mProp);
    } else {
      fig.rot = faceL(0.8, 0.3);
      peelResting(c, o, mFrom);
      reachV(fig, 1, pt(mFrom, 0, 0, 0.1, w4));
      c.figure(fig);
    }
    return;
  }
  if (p < T.toTable) {
    const fig = walker(c, o, BAKE_TO_TABLE, cruise(span(p, T.peelBack, T.toTable)), b.owner, S.BAKER);
    fig.tool = null;
    c.figure(fig);
    return;
  }
  if (p < T.packed) {
    // Przeklada bochenki po kolei do kosza: prawa reka niesie bochenek, lewa przytrzymuje kosz.
    const fig = poseAt(c, o, BAKERY.knead.x, BAKERY.knead.y, faceL(0, -1), b.owner, S.BAKER);
    fig.tool = null;
    fig.lean = 0.3;
    fig.head = 0.25;
    const k = Math.min(3, packed), f = smooth(packU - k);
    const from = c.at(o, BAKERY.slots[k], BAKERY.table.y, BAKERY.table.top, w2);
    const to = c.at(o, BAKERY.basket.x, BAKERY.basket.y, BAKERY.table.top + 0.03, w3);
    const x = lerp(from.x, to.x, f), y = lerp(from.y, to.y, f) + Math.sin(Math.PI * f) * 0.04, z = lerp(from.z, to.z, f);
    reach(fig, 1, x, y + 0.02, z);
    reach(fig, -1, to.x + Math.cos(fig.rot) * 0.03, to.y + 0.03, to.z - Math.sin(fig.rot) * 0.03);
    c.figure(fig);
    if (c.details && f < 0.96) c.prop('crf_loaf', x, y, z, lerpAngle(BROT + Math.PI / 2 + k * 0.13, fig.rot, f), LOAF_TABLE, LOAF_TABLE, CRUST);
    return;
  }
  if (p < T.lifted) {
    // Podnosi kosz ze stolu.
    const fig = poseAt(c, o, BAKERY.knead.x, BAKERY.knead.y, faceL(0, -1), b.owner, S.BAKER);
    fig.tool = null;
    basketToTable(c, o, fig, 1 - smooth(span(p, T.packed, T.lifted)), true);
    return;
  }
  const fig = walker(c, o, BAKE_HOME, cruise(span(p, T.lifted, 1)), b.owner, S.BAKER);
  fig.tool = null;
  const k = basketHeld(fig, w2);
  c.figure(fig);
  c.prop('crf_basket', k.x, k.y, k.z, fig.rot);
}

/** Piekarz wynosi chleb na flage w koszu trzymanym oburacz przed soba i wraca z pustym; droga od drzwi. */
function baker(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, BAKERY_EXIT);
  if (!fig) return false;
  fig.carry = -1;
  fig.tool = null;
  const k = basketHeld(fig, w2);
  c.figure(fig);
  c.prop(serf.carry === G.BREAD ? 'crf_basket' : 'crf_basket_empty', k.x, k.y, k.z, fig.rot);
  return true;
}

// ---------------------------------------------------------------- rzeznia

/**
 * Rzeznia (uklad modelu): pien (srodek, wierzch), miejsce rzeznika za pniem, lawka z deska na mieso po prawej
 * rece rzeznika, tylny koniec tuszy na pniu (tusza lezy ku desce, w strone -X).
 */
const BUTCHER = {
  block: { x: -0.22, y: -0.38, top: 0.068 },
  stand: { x: -0.22, y: -0.29 },
  bench: { x: -0.33, y: -0.37, top: 0.066 },
  carcass: { x: -0.17, y: -0.38 },
};
const BUTCH_T = { at: 0.08, laid: 0.13, chop: 0.86, wipe: 0.92 };
const BUTCHER_IN = [0.04, -0.17, 0.03, -0.29, -0.22, -0.29];
const BUTCHER_OUT = [-0.22, -0.29, 0.03, -0.29, 0.04, -0.17];
const BUTCHER_EXIT = [0.04, -0.15, 0.03, -0.3];
/** Kawalki miesa na desce (uklad deski, swiat). */
const TRAY_SLOTS = [-0.03, -0.018, 0.03, -0.018, -0.03, 0.02, 0.03, 0.02];
/** Skala tuszy i jej dlugosc w swiecie (od tylnego konca do przekroju). */
const CARCASS_S = 1.3;
const CARCASS_LEN = 0.11 * CARCASS_S;
const CHOP_BITS: FxOptions = {
  kind: 'bit', n: 4, life: 0.45, vy: 0.45, spread: 0.3, gravity: 2.4, size: 0.012, sizeEnd: 0.008, color: MEAT_BIT,
};

/** Tusza: tylny koniec w punkcie (x, y, z) swiata, lezy w kierunku yaw; dlugosc len (1 = cala). */
function carcass(c: WorkCtx, m: THREE.Matrix4, x: number, y: number, z: number, yaw: number, len: number): void {
  ypr(m, x, y, z, yaw, 0, 0, CARCASS_S, CARCASS_S, CARCASS_S * Math.max(0.05, len));
  c.propM('crf_carcass', m);
}

/** Deska z kawalkami miesa (n) w ukladzie m (podstawa deski). */
function trayWithMeat(c: WorkCtx, m: THREE.Matrix4, n: number): void {
  c.propM('crf_tray', m);
  for (let k = 0; k < n; k++) {
    pt(m, TRAY_SLOTS[k * 2], 0.008, TRAY_SLOTS[k * 2 + 1], w3);
    c.good(G.MEAT, w3.x, w3.y, w3.z, k * 1.3, 0.5);
  }
}

function butcherShop(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  const T = BUTCH_T;
  const worker = b.worker >= 0 ? c.s.serfs[b.worker] : null;
  const block = c.at(o, BUTCHER.carcass.x, BUTCHER.carcass.y, BUTCHER.block.top, w2);
  const along = faceL(-1, 0);
  const dx = Math.sin(along), dz = Math.cos(along);
  // Deska na lawce, chyba ze rzeznik niesie ja na flage.
  const per = (T.chop - T.laid) / 4;
  const q = (p - T.laid) / per;
  const n = p < T.laid ? 0 : p >= T.chop ? 4 : Math.min(3, Math.floor(q));
  const u = p >= T.laid && p < T.chop ? q - n : 0;
  const onTray = p < 0 ? (worker && worker.state === SS.INSIDE && b.out.length > 0 ? 4 : 0) : n;
  if (!worker || worker.state !== SS.WORK_OUT) {
    const bn = c.at(o, BUTCHER.bench.x, BUTCHER.bench.y, BUTCHER.bench.top, w3);
    ypr(mBody, bn.x, bn.y, bn.z, BROT);
    trayWithMeat(c, mBody, onTray);
  }
  if (p < 0) return;
  if (p < T.at) {
    const fig = walker(c, o, BUTCHER_IN, cruise(p / T.at), b.owner, S.BUTCHER);
    fig.tool = null;
    fig.toolL = 'tool_cleaver';
    carcassOnShoulder(fig, mProp);
    c.figure(fig);
    c.propM('crf_carcass', mProp);
    return;
  }
  const st = c.at(o, BUTCHER.stand.x, BUTCHER.stand.y, 0, w1);
  const fig = pose(st.x, st.y, st.z, faceL(0, -1), b.owner, S.BUTCHER);
  if (p < T.laid) {
    // Zdejmuje tusze z ramienia i kladzie ja na pniu.
    const l = smooth(span(p, T.at, T.laid));
    fig.lean = 0.35 * Math.sin(Math.PI * l);
    carcassOnShoulder(fig, mFrom, false);
    ypr(mBody, block.x, block.y, block.z, along);
    blend(mProp, mFrom, mBody, l);
    reachV(fig, -1, pt(mProp, 0, 0.065, 0.06, w4));
    reachV(fig, 1, pt(mProp, 0, 0.065, 0.02, w4));
    fig.tool = null;
    fig.toolL = 'tool_cleaver';
    c.figure(fig);
    c.propM('crf_carcass', mProp);
    return;
  }
  if (p < T.chop) {
    // Trzy uderzenia tasakiem odcinaja kawalek, czwarty ruch zsuwa go plazem na deske.
    const len = 1 - 0.25 * n;
    const cut = u >= 0.72;
    carcass(c, mBody, block.x, block.y, block.z, along, cut ? len - 0.25 : len);
    const chopAt = CARCASS_LEN * (len - 0.25);
    const cx = block.x + dx * chopAt, cz = block.z + dz * chopAt;
    fig.lean = 0.3;
    fig.head = 0.3;
    reach(fig, -1, block.x + dx * 0.02, block.y + 0.075, block.z + dz * 0.02);
    if (!cut) {
      const s = u / 0.24;
      const k = Math.min(2, Math.floor(s)), f = s - k;
      const upk = c.strike(f);
      reach(fig, 1, cx, block.y + 0.09, cz);
      fig.armR = lerp(fig.armR ?? 0, -2.5, upk);
      fig.armROut = lerp(fig.armROut ?? 0, 0.35, upk);
      fig.lean = 0.3 - 0.12 * upk;
      const strikeSec = per * 0.24 * cycleSec(B.BUTCHER);
      if (c.details) c.fx.burst(b.id * 53 + n * 3 + k, f * strikeSec, cx, block.y + 0.035, cz, CHOP_BITS);
      c.figure(fig);
    } else {
      const s = smooth(clamp01((u - 0.72) / 0.26));
      const bn = c.at(o, BUTCHER.bench.x, BUTCHER.bench.y, BUTCHER.bench.top, w3);
      ypr(mFrom, bn.x, bn.y, bn.z, BROT);
      pt(mFrom, TRAY_SLOTS[n * 2], 0.008, TRAY_SLOTS[n * 2 + 1], w5);
      const px = block.x + dx * CARCASS_LEN * (len - 0.125);
      const pz = block.z + dz * CARCASS_LEN * (len - 0.125);
      const mx = lerp(px, w5.x, s), mz = lerp(pz, w5.z, s), my = lerp(block.y, w5.y, s) + Math.sin(Math.PI * s) * 0.015;
      reach(fig, 1, mx, my + 0.11, mz);
      fig.toolRoll = -1.2;
      c.figure(fig);
      c.good(G.MEAT, mx, my, mz, s * 1.3 + n * 1.3, 0.5);
    }
    return;
  }
  if (p < T.wipe) {
    // Wyciera tasak o fartuch.
    const w = span(p, T.chop, T.wipe);
    fig.armR = -0.55;
    fig.armRYaw = Math.sin(w * TAU * 2) * 0.5;
    fig.armROut = -0.25;
    fig.armL = -0.5;
    fig.armLOut = -0.2;
    fig.head = 0.2;
    c.figure(fig);
    return;
  }
  c.figure(walker(c, o, BUTCHER_OUT, cruise(span(p, T.wipe, 1)), b.owner, S.BUTCHER));
}

/** Tusza na prawym ramieniu (od strony kamery, gdy rzeznik idzie w lewo; macierz w `out`); prawa reka ja trzyma. */
function carcassOnShoulder(fig: Pose, out: THREE.Matrix4, hold = true): THREE.Matrix4 {
  const s = CARCASS_S / US;
  torsoOf(fig, out).multiply(mB.makeTranslation(0.075, 0.36, -0.12)).multiply(mB.makeScale(s, s, s));
  if (hold) reachV(fig, 1, pt(out, 0, 0.06, 0.07, w4));
  return out;
}

/** Rzeznik wynosi mieso na flage na desce trzymanej oburacz i wraca z pusta deska; droga od drzwi. */
function butcher(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, BUTCHER_EXIT);
  if (!fig) return false;
  fig.carry = -1;
  fig.tool = null;
  const k = front(fig, 0.09, 0, 0.14 + (fig.bob ?? 0), w2);
  ypr(mProp, k.x, k.y, k.z, fig.rot + Math.PI / 2);
  reachV(fig, 1, pt(mProp, 0, 0.012, 0.072, w4));
  reachV(fig, -1, pt(mProp, 0, 0.012, -0.072, w4));
  c.figure(fig);
  trayWithMeat(c, mProp, serf.carry === G.MEAT ? 4 : 0);
  return true;
}

// ---------------------------------------------------------------- chlewnia

/**
 * Chlewnia (uklad modelu): koryto przy lewym plocie (srodek, wierzch, dlugosc i szerokosc wnetrza), miejsce
 * hodowcy za plotem, swinie: miejsca odpoczynku (lx, ly, obrot), miejsca przy korycie (lx, ly[]).
 */
const PIGFARM = {
  trough: { x: -0.045, y: -0.29, top: 0.047, len: 0.176, w: 0.04 },
  pour: { x: -0.155, y: -0.22 },
  rest: [0.36, -0.28, 2.6, 0.47, -0.38, -2.2, 0.22, -0.17, 0.9],
  eatX: 0.05,
  eatY: [-0.35, -0.29, -0.23],
};
/** Etapy cyklu chlewni: wyjscie z pasza, uniesienie wiadra, sypanie, opuszczenie, powrot; to samo z woda. */
const PIG_T = { out: 0.04, lift: 0.06, pour: 0.14, lower: 0.16, back: 0.2, out2: 0.4, out2End: 0.44, lift2: 0.46, pour2: 0.52, lower2: 0.54, back2: 0.58 };
const PIG_TO_FENCE = [-0.3, -0.06, -0.3, -0.15, -0.155, -0.22];
const PIG_FROM_FENCE = [-0.155, -0.22, -0.3, -0.15, -0.3, -0.06];
/** Droga hodowcy ze swinia od drzwi domu, wzdluz lewego plotu i przed zagroda, na flage. */
const PIGFARM_EXIT = [-0.3, -0.03, -0.3, -0.15, -0.17, -0.3, -0.16, -0.55];
const PIG_S = 0.8;
const FEED_BITS: FxOptions = { kind: 'bit', n: 9, life: 0.32, vy: -0.15, spread: 0.05, spreadY: 0.02, gravity: 2.0, size: 0.011, color: FEED };
const WATER_DROPS: FxOptions = {
  kind: 'puff', n: 9, life: 0.3, vy: -0.15, spread: 0.04, spreadY: 0.02, gravity: 2.2, size: 0.016, sizeEnd: 0.01, color: 0x7fb2dc,
};
/** Krople spadajace z wiadra wynurzajacego sie z wody. */
const DRIPS: FxOptions = { kind: 'puff', n: 4, life: 0.25, vy: -0.15, spread: 0.04, spreadY: 0.02, gravity: 2.2, size: 0.014, sizeEnd: 0.01, color: 0x7fb2dc };

/** Swinia: punkt na ziemi, obrot, pochylenie (+ = ryjem w dol); nogi w fazie ph z wymachem amp. */
function drawPig(c: WorkCtx, x: number, y: number, z: number, yaw: number, pitch: number, ph: number, amp: number, s = PIG_S): void {
  ypr(mBody, x, y, z, yaw, pitch, 0, s);
  c.propM('crf_pig', mBody);
  for (let k = 0; k < 4; k++) {
    const side = k & 1 ? 1 : -1, fore = k < 2 ? 1 : -1;
    const sw = Math.sin(ph + (side * fore > 0 ? 0 : Math.PI)) * amp;
    mA.copy(mBody).multiply(mB.makeTranslation(side * 0.024, 0.05, fore * 0.045)).multiply(mB.makeRotationX(sw)).multiply(mB.makeScale(0.48, 0.48, 0.48));
    c.propM('crf_leg', mA, PIG);
  }
}

/** Polozenie swini i w cyklu karmienia: odpoczynek, bieg do koryta, jedzenie, powrot. */
function pig(c: WorkCtx, b: Building, o: Origin, i: number, p: number): void {
  const t = c.time;
  const r = PIGFARM.rest;
  const seed = b.id * 3 + i;
  // Odpoczynek: lekkie przestepowanie i rycie ryjem.
  const rx = r[i * 3] + 0.025 * Math.sin(t * 0.21 + seed * 2.1), ry = r[i * 3 + 1] + 0.018 * Math.sin(t * 0.29 + seed);
  const restYaw = BROT + r[i * 3 + 2] + 0.5 * Math.sin(t * 0.13 + seed * 1.3);
  const root = 0.14 + 0.07 * Math.sin(t * 1.9 + seed);
  const ex = PIGFARM.eatX, ey = PIGFARM.eatY[i];
  const runTo = 0.075 + 0.014 * i, eatEnd = 0.6 + 0.025 * i;
  const runDur = (Math.hypot(rx - ex, ry - ey) * o.sc) / 0.85 / cycleSec(B.PIGFARM);
  const walkDur = (Math.hypot(rx - ex, ry - ey) * o.sc) / 0.3 / cycleSec(B.PIGFARM);
  let lx = rx, ly = ry, yaw = restYaw, pitch = root, ph = 0, amp = 0, bob = 0;
  if (p >= runTo && p < eatEnd + walkDur) {
    if (p < runTo + runDur) {
      const u = smooth(span(p, runTo, runTo + runDur));
      lx = lerp(rx, ex, u);
      ly = lerp(ry, ey, u);
      yaw = faceL(ex - rx, ey - ry);
      ph = u * Math.hypot(rx - ex, ry - ey) * o.sc * 55;
      amp = 0.7;
      bob = Math.abs(Math.sin(ph)) * 0.012;
      pitch = -0.05 + Math.sin(ph * 2) * 0.05;
    } else if (p < eatEnd) {
      lx = ex + 0.004 * Math.sin(t * 3 + seed);
      ly = ey;
      yaw = faceL(-1, 0) + 0.15 * Math.sin(t * 0.9 + seed);
      pitch = 0.32 + 0.07 * Math.sin(t * 9 + seed * 3);
    } else {
      const u = span(p, eatEnd, eatEnd + walkDur);
      lx = lerp(ex, rx, u);
      ly = lerp(ey, ry, u);
      yaw = faceL(rx - ex, ry - ey);
      ph = u * Math.hypot(rx - ex, ry - ey) * o.sc * 40;
      amp = 0.45;
      pitch = 0.04;
    }
  }
  const q = c.at(o, lx, ly, 0, w3);
  drawPig(c, q.x, q.y + bob, q.z, yaw, pitch, ph, amp);
}

/** Hodowca za plotem z wiadrem: dochodzi, unosi wiadro nad plot, przechyla (sypie / leje), opuszcza. */
function pigFeeder(c: WorkCtx, b: Building, o: Origin, p: number, t0: number, water: boolean): void {
  const T = PIG_T;
  const outEnd = water ? T.out2End : T.out, lift = water ? T.lift2 : T.lift, pour = water ? T.pour2 : T.pour;
  const lower = water ? T.lower2 : T.lower, back = water ? T.back2 : T.back;
  const full = water ? 'crf_pail_water' : 'crf_pail_feed';
  if (p < outEnd || p >= lower) {
    const goingOut = p < outEnd;
    const fig = walker(c, o, goingOut ? PIG_TO_FENCE : PIG_FROM_FENCE, cruise(goingOut ? span(p, t0, outEnd) : span(p, lower, back)), b.owner, S.PIGFARMER);
    fig.tool = null;
    fig.armR = 0.05;
    fig.armROut = 0.12;
    const fr = c.figure(fig);
    hand(fr.armR, w4);
    c.prop(goingOut ? full : 'crf_pail', w4.x, w4.y, w4.z, fig.rot + Math.PI / 2);
    return;
  }
  const st = c.at(o, PIGFARM.pour.x, PIGFARM.pour.y, 0, w1);
  // Polbokiem do kamery: sypie przed siebie i w prawo, do srodka koryta.
  const fig = pose(st.x, st.y, st.z, faceL(1, -0.6), b.owner, S.PIGFARMER);
  fig.tool = null;
  const up = smooth(span(p, outEnd, lift)) * (1 - smooth(span(p, pour, lower)));
  const tip = smooth(span(p, lift, lift + 0.02)) * (1 - smooth(span(p, pour - 0.01, pour + 0.005)));
  const sweep = Math.sin(span(p, lift, pour) * Math.PI * 2) * 0.05;
  // Uchwyt wiadra nad plotem; przechylone wylewa sie ku korytu.
  const g = front(fig, lerp(0.05, 0.145, up), lerp(0.04, 0.0, up) + sweep * up, lerp(0.13, 0.21, up), w4);
  fig.lean = 0.22 * up;
  ypr(mProp, g.x, g.y, g.z, fig.rot, tip * 2.15);
  reachV(fig, 1, g);
  if (up > 0.3) reachV(fig, -1, pt(mProp, 0, -0.068, 0, w5));
  c.figure(fig);
  c.propM(tip > 0.6 && p > pour - 0.03 ? 'crf_pail' : full, mProp);
  if (tip > 0.5 && p < pour) {
    pt(mProp, 0, -0.02, 0.03, w5);
    const tr = c.at(o, PIGFARM.trough.x, PIGFARM.trough.y, PIGFARM.trough.top, w3);
    const fx = water ? WATER_DROPS : FEED_BITS;
    fx.floor = tr.y;
    c.fx.stream(b.id * 16 + (water ? 7 : 6), w5.x, w5.y, w5.z, fx);
  }
}

/** Zawartosc koryta w cyklu: poziom 0..1 i kolor (pasza, potem pomyje z woda). */
function troughFill(p: number): [number, number] {
  const T = PIG_T;
  if (p < T.lift + 0.02) return [0, FEED];
  if (p < T.pour) return [span(p, T.lift + 0.02, T.pour), FEED];
  if (p < T.lift2 + 0.02) return [lerp(1, 0.3, span(p, T.pour, 0.42)), FEED];
  if (p < T.pour2) {
    const u = span(p, T.lift2 + 0.02, T.pour2);
    return [lerp(0.3, 0.95, u), mix(FEED, WATER, u)];
  }
  return [lerp(0.95, 0, span(p, T.pour2, 0.74)), mix(WATER, SLOP, span(p, T.pour2, 0.6))];
}

function pigfarm(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  for (let i = 0; i < 3; i++) pig(c, b, o, i, p);
  if (p < 0) return;
  const [level, color] = troughFill(p);
  const tr = PIGFARM.trough;
  if (level > 0.02) {
    const k = Math.sqrt(level);
    inBuilding(c, o, 'fx_bit', tr.x, tr.y, tr.top + 0.002 + 0.004 * level, 0, tr.w * k, 0.006, tr.len * (0.4 + 0.6 * k), color);
  }
  if (p < PIG_T.back) pigFeeder(c, b, o, p, 0, false);
  else if (p >= PIG_T.out2 && p < PIG_T.back2) pigFeeder(c, b, o, p, PIG_T.out2, true);
}

/** Hodowca wynosi swinie na flage na rekach; droga od drzwi domu, obok zagrody. */
function pigfarmer(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, PIGFARM_EXIT);
  if (!fig) return false;
  if (serf.carry === G.PIG) {
    fig.carry = -1;
    fig.tool = null;
    fig.lean = -0.08;
    const k = front(fig, 0.08, 0, 0.12 + (fig.bob ?? 0), w2);
    reach(fig, 1, k.x + Math.cos(fig.rot) * 0.04, k.y + 0.03, k.z - Math.sin(fig.rot) * 0.04);
    reach(fig, -1, k.x - Math.cos(fig.rot) * 0.04, k.y + 0.03, k.z + Math.sin(fig.rot) * 0.04);
    c.figure(fig);
    drawPig(c, k.x, k.y, k.z, fig.rot + Math.PI / 2, 0, c.time * 9, 0.35, 0.62);
  } else c.figure(fig);
  return true;
}

// ---------------------------------------------------------------- studnia

/**
 * Studnia (uklad modelu): wysokosc osi kolowrotu, polozenie sznura na walku i promien nawoju, korba (os raczki
 * w lx, promien), miejsce studniarza przy korbie (tu stoi takze miedzy cyklami), miejsce przy cembrowinie,
 * beczka (srodek, wierzch, promien wnetrza), miejsce przy beczce, wysokosc uchwytu wiadra (pod walkiem, w glebi),
 * lustro wody w studni.
 */
const WELL = {
  axleZ: 0.16,
  ropeX: -0.06,
  ropeR: 0.024,
  handleX: -0.19,
  handleR: 0.042,
  crank: { x: -0.255, y: 0.035 },
  grab: { x: -0.21, y: -0.07 },
  barrel: { x: -0.2, y: -0.22, top: 0.09, r: 0.036 },
  pour: { x: -0.272, y: -0.152 },
  bucketTop: 0.128,
  bucketLow: -0.3,
  water: 0.05,
};
const WELL_T = { grip: 0.05, up: 0.42, take: 0.47, toBarrel: 0.52, pour: 0.66, toWell: 0.72, drop: 0.8, home: 0.86 };
const WELL_TO_BARREL = [-0.21, -0.07, -0.272, -0.152];
const WELL_TO_RIM = [-0.272, -0.152, -0.21, -0.07];
const WELL_TO_CRANK = [-0.21, -0.07, -0.255, 0.035];
const WELL_TO_GRAB = [-0.255, 0.035, -0.21, -0.07];
/** Droga studniarza z woda od korby, obok beczki, na flage (flage dopisuje doorWalk). */
const WELL_TO_FLAG = [-0.255, 0.035, -0.3, -0.08, -0.3, -0.2, -0.2, -0.32];
const SPLASH: FxOptions = { kind: 'puff', n: 7, life: 0.55, vy: 0.35, spread: 0.12, spreadY: 0.08, gravity: 1.6, size: 0.016, sizeEnd: 0.01, color: 0x8fc0e6 };
const BUCKET_S = 0.9;

/** Kat korby (rad) dla wysokosci uchwytu wiadra z (sznur nawija sie na walek). */
function crankAngle(z: number): number {
  return -(z - WELL.bucketLow) / WELL.ropeR;
}

/** Wysokosc uchwytu wiadra w cyklu (uklad modelu). */
function wellBucket(p: number): number {
  const T = WELL_T;
  if (p < T.grip) return WELL.bucketLow;
  if (p < T.up) return lerp(WELL.bucketLow, WELL.bucketTop, cruise(span(p, T.grip, T.up), 0.12));
  if (p < T.toWell + 0.02) return WELL.bucketTop;
  const u = span(p, T.toWell + 0.02, T.drop);
  return lerp(WELL.bucketTop, WELL.bucketLow, u * u);
}

/** Kolowrot w ukladzie budynku (obrot o kat a); raczka korby w swiecie do `out`. */
function winch(c: WorkCtx, o: Origin, a: number, out: Vec3): Vec3 {
  mA.copy(c.frameOf(o)).multiply(mB.makeTranslation(0, WELL.axleZ, 0)).multiply(mB.makeRotationX(a));
  c.propM('crf_winch', mA);
  return pt(mA, WELL.handleX, WELL.handleR, 0, out);
}

/** Studniarz przy korbie: obie dlonie na raczce, cialo podnosi sie i przysiada z obrotem korby. */
function wellerCranking(c: WorkCtx, b: Building, o: Origin, a: number, grip: number, rot: number): void {
  const st = c.at(o, WELL.crank.x, WELL.crank.y, 0, w1);
  const fig = pose(st.x, st.y, st.z, rot, b.owner, S.WELLER);
  fig.tool = null;
  const h = winch(c, o, a, w4);
  if (grip > 0) {
    const ca = Math.cos(a);
    fig.bob = 0.008 * ca * grip;
    fig.crouch = 0.012 * (1 - ca) * grip;
    fig.lean = 0.12 + 0.12 * Math.sin(a) * grip;
    reachV(fig, 1, h);
    reach(fig, -1, h.x - Math.sin(rot) * 0.01, h.y, h.z - Math.cos(rot) * 0.01);
  }
  c.figure(fig);
}

function well(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  const T = WELL_T;
  const inside = c.workerInside(b);
  const bz = p >= 0 ? wellBucket(p) : WELL.bucketLow;
  const hanging = p < T.take || p >= T.toWell;
  // Sznur z walka do uchwytu wiadra (albo do haka, gdy wiadro jest w rekach).
  const top = c.at(o, WELL.ropeX, 0, WELL.axleZ - WELL.ropeR, w2);
  const hook = c.at(o, WELL.ropeX, 0, hanging ? Math.max(bz, WELL.water - 0.02) : WELL.bucketTop + 0.004, w3);
  if (c.details) rope(c, top, hook, 0.004 * o.sc);
  if (hanging && bz > WELL.water - 0.07) {
    const q = c.at(o, WELL.ropeX, 0, bz, w3);
    c.prop(p >= T.toWell || p < 0 ? 'crf_pail' : 'crf_pail_water', q.x, q.y, q.z, BROT, BUCKET_S);
  }
  if (p >= T.toWell) {
    // Plusk, gdy spadajace wiadro uderza w wode.
    const hit = lerp(T.toWell + 0.02, T.drop, Math.sqrt((WELL.bucketTop - WELL.water - 0.036) / (WELL.bucketTop - WELL.bucketLow)));
    const q = c.at(o, WELL.ropeX, 0, WELL.water, w3);
    if (p >= hit) c.fx.burst(b.id * 61, (p - hit) * cycleSec(B.WELL), q.x, q.y, q.z, SPLASH);
  }
  // Woda w beczce: przybywa przy przelewaniu, ubywa, gdy studniarz niesie wode na flage.
  const br = WELL.barrel;
  const lvl = p < 0 ? (inside ? 0.45 : 0.25) : lerp(0.45, 0.92, smooth(span(p, T.toBarrel + 0.02, T.pour)));
  inBuilding(c, o, 'crf_disc', br.x, br.y, lerp(0.02, br.top - 0.006, lvl), 0, br.r * 2, 0.002, br.r * 2, WATER);
  if (!inside) {
    winch(c, o, crankAngle(WELL.bucketLow), w4);
    return;
  }
  const rest = faceL(-0.25, -1);
  const toCrank = faceL(1, 0);
  if (p < 0 || p >= T.home) {
    // Odpoczywa przy korbie.
    const turn = p < 0 ? 0 : smooth(span(p, T.home, T.home + 0.03));
    const ang = crankAngle(WELL.bucketLow);
    const st = c.at(o, WELL.crank.x, WELL.crank.y, 0, w1);
    const arrive = faceL(WELL_TO_CRANK[2] - WELL_TO_CRANK[0], WELL_TO_CRANK[3] - WELL_TO_CRANK[1]);
    const fig = pose(st.x, st.y, st.z, p < 0 ? rest : lerpAngle(arrive, rest, turn), b.owner, S.WELLER);
    fig.tool = null;
    fig.armL = -0.15;
    fig.armLOut = 0.25;
    fig.armR = -0.2;
    fig.armROut = 0.1;
    fig.head = 0.05 * Math.sin(c.time * 0.7 + b.id);
    winch(c, o, ang, w4);
    c.figure(fig);
    return;
  }
  if (p < T.up) {
    const grip = smooth(span(p, 0, T.grip));
    wellerCranking(c, b, o, crankAngle(bz), grip, lerpAngle(rest, toCrank, smooth(span(p, 0, 0.03))));
    if (bz < WELL.water + 0.02 && bz > WELL.water - 0.05 && c.details) {
      const q = c.at(o, WELL.ropeX, 0, WELL.water, w3);
      DRIPS.floor = q.y;
      c.fx.stream(b.id * 16 + 8, q.x, q.y + 0.02, q.z, DRIPS);
    }
    return;
  }
  winch(c, o, crankAngle(bz), w4);
  let fig: Pose;
  const toBucket = faceL(WELL.ropeX - WELL.grab.x, -WELL.grab.y);
  if (p < T.take || (p >= T.toWell && p < T.drop)) {
    // Przy cembrowinie: podchodzi od korby i siega po wiadro; potem zawiesza puste i patrzy, jak spada.
    const back = p >= T.toWell;
    const g = back ? 0 : span(p, T.up, T.take);
    if (!back && g < 0.45) fig = walker(c, o, WELL_TO_GRAB, cruise(g / 0.45), b.owner, S.WELLER);
    else fig = poseAt(c, o, WELL.grab.x, WELL.grab.y, toBucket, b.owner, S.WELLER);
    if (!back) fig.rot = lerpAngle(fig.rot, toBucket, smooth(clamp01((g - 0.35) / 0.2)));
    const hook = back ? span(p, T.toWell, T.toWell + 0.025) : 0;
    const reachK = back ? Math.sin(Math.PI * hook) : smooth(clamp01((g - 0.45) / 0.3));
    fig.lean = 0.35 * reachK + (back ? 0.2 * span(p, T.toWell + 0.02, T.toWell + 0.03) : 0);
    fig.head = back ? 0.35 * span(p, T.toWell + 0.02, T.toWell + 0.03) : 0;
    const q = c.at(o, WELL.ropeX, 0, back ? bz : WELL.bucketTop, w3);
    if (reachK > 0.05) reachV(fig, 1, q);
    fig.tool = null;
    c.figure(fig);
    return;
  }
  if (p >= T.drop) {
    const fig = walker(c, o, WELL_TO_CRANK, cruise(span(p, T.drop, T.home)), b.owner, S.WELLER);
    fig.tool = null;
    c.figure(fig);
    return;
  }
  if (p < T.toBarrel) {
    fig = walker(c, o, WELL_TO_BARREL, cruise(span(p, T.take, T.toBarrel)), b.owner, S.WELLER);
  } else if (p < T.pour) {
    const st = c.at(o, WELL.pour.x, WELL.pour.y, 0, w1);
    const br2 = c.at(o, br.x, br.y, 0, w2);
    fig = pose(st.x, st.y, st.z, c.facing(st.x, st.z, br2.x, br2.z), b.owner, S.WELLER);
  } else {
    fig = walker(c, o, WELL_TO_RIM, cruise(span(p, T.pour, T.toWell)), b.owner, S.WELLER);
  }
  fig.tool = null;
  if (p >= T.toBarrel && p < T.pour) {
    // Przelewa: wiadro uniesione nad beczka i przechylone, strumien wody.
    const u = span(p, T.toBarrel, T.pour);
    const up = smooth(clamp01(u * 5)) * (1 - smooth(clamp01((u - 0.85) * 6.6)));
    const tip = smooth(clamp01((u - 0.12) * 5)) * (1 - smooth(clamp01((u - 0.8) * 8)));
    // Uchwyt wiadra wedruje znad ziemi nad srodek beczki (wylot przechylonego wiadra nad otworem).
    const bt = c.at(o, br.x, br.y, br.top, w2);
    const hx = bt.x - Math.sin(fig.rot) * 0.025, hy = bt.y + 0.075, hz = bt.z - Math.cos(fig.rot) * 0.025;
    const g0 = front(fig, 0.06, 0.04, 0.13, w4);
    const g = w4;
    g.x = lerp(g0.x, hx, up);
    g.y = lerp(g0.y, hy, up);
    g.z = lerp(g0.z, hz, up);
    fig.lean = 0.25 * up;
    ypr(mProp, g.x, g.y, g.z, fig.rot, tip * 2.0, 0, BUCKET_S);
    reachV(fig, 1, g);
    if (up > 0.3) reachV(fig, -1, pt(mProp, 0, -0.068, 0, w5));
    c.figure(fig);
    c.propM(tip > 0.55 && u > 0.6 ? 'crf_pail' : 'crf_pail_water', mProp);
    if (tip > 0.5 && u < 0.8) {
      pt(mProp, 0, -0.02, 0.03, w5);
      WATER_DROPS.floor = c.at(o, br.x, br.y, br.top - 0.02, w2).y;
      c.fx.stream(b.id * 16 + 9, w5.x, w5.y, w5.z, WATER_DROPS);
    }
    return;
  }
  fig.armR = 0.05;
  fig.armROut = 0.12;
  const fr = c.figure(fig);
  hand(fr.armR, w4);
  c.prop(p < T.pour ? 'crf_pail_water' : 'crf_pail', w4.x, w4.y, w4.z, fig.rot + Math.PI / 2, BUCKET_S);
}

/** Studniarz niesie wode na flage (wiadro w reku) i wraca do korby - droga od korby obok beczki. */
function weller(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, WELL_TO_FLAG);
  if (!fig) return false;
  fig.carry = -1;
  fig.tool = null;
  fig.armR = 0.05;
  fig.armROut = 0.12;
  const fr = c.figure(fig);
  hand(fr.armR, w4);
  c.prop(serf.carry === G.WATER ? 'crf_pail_water' : 'crf_pail', w4.x, w4.y, w4.z, fig.rot + Math.PI / 2, BUCKET_S);
  return true;
}

// ---------------------------------------------------------------- browar

/**
 * Browar (uklad modelu): kociol (srodek, lustro brzeczki, rant), miejsce piwowara za kotlem, pusty worek po slodzie,
 * otwor paleniska (dol, przed kamieniami), wioslo oparte o przybudowke (stopa, gora).
 */
const BREWERY = {
  kettle: { x: -0.27, y: -0.33, surf: 0.094, rim: 0.112 },
  stir: { x: -0.27, y: -0.212 },
  sack: { x: -0.17, y: -0.29 },
  fire: { x: -0.27, y: -0.408, z: 0.003 },
  paddleFoot: { x: -0.355, y: -0.205 },
  paddleTop: { x: -0.36, y: -0.172, z: 0.21 },
};
const BREW_T = { at: 0.06, poured: 0.13, paddle: 0.16, stirred: 0.86, put: 0.9 };
const BREW_IN = [0.12, -0.13, 0.1, -0.215, -0.18, -0.21, -0.27, -0.212];
const BREW_OUT = [-0.27, -0.212, -0.18, -0.21, 0.1, -0.215, 0.12, -0.13];
const BREWERY_EXIT = [0.12, -0.12, 0.1, -0.25];
const STEAM_FX: FxOptions = {
  kind: 'puff', n: 6, life: 2.4, vx: OUT_X * 0.025, vz: OUT_Z * 0.025, vy: 0.1, spread: 0.02, spreadY: 0.02, gravity: -0.02,
  size: 0.025, sizeEnd: 0.085, color: STEAM, colorEnd: 0xdcdad6, jitter: 0.04, sway: 0.03, fade: 0.35,
};
const MALT_BITS: FxOptions = { kind: 'bit', n: 10, life: 0.3, vy: -0.1, spread: 0.04, gravity: 2.0, size: 0.01, color: MALT };

/** Pusty worek po slodzie lezacy plasko przy kotle (macierz w `out`). */
function emptySack(c: WorkCtx, o: Origin, out: THREE.Matrix4): THREE.Matrix4 {
  const q = c.at(o, BREWERY.sack.x, BREWERY.sack.y, 0.006, w5);
  return ypr(out, q.x, q.y, q.z, BROT + 0.7, Math.PI / 2, 0, SACK_S * 1.05, SACK_S * 1.1, SACK_S * 0.22);
}

/** Wioslo oparte o przybudowke (macierz w `out`). */
function paddleResting(c: WorkCtx, o: Origin, out: THREE.Matrix4): THREE.Matrix4 {
  const top = c.at(o, BREWERY.paddleTop.x, BREWERY.paddleTop.y, BREWERY.paddleTop.z, w3);
  const foot = c.at(o, BREWERY.paddleFoot.x, BREWERY.paddleFoot.y, 0.03, w5);
  return paddleBetween(out, top, foot);
}

/** Wioslo od gornego konca a ku piorze w kierunku b (macierz w `out`). */
function paddleBetween(out: THREE.Matrix4, a: Vec3, b: Vec3): THREE.Matrix4 {
  vA.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  qA.setFromUnitVectors(vC.set(0, -1, 0), vA);
  return out.compose(vB.set(a.x, a.y, a.z), qA, sA.set(1, 1, 1));
}

function brewery(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  const T = BREW_T;
  const k = BREWERY.kettle;
  const fl = flicker(c.time, b.id + 5);
  const heat = p < 0 ? 0.35 : 0.85;
  glow(c, o, BREWERY.fire.x, BREWERY.fire.y, BREWERY.fire.z, 0.046, 0.026, mix(EMBER_DIM, EMBER_HOT, heat * (0.65 + 0.35 * fl)));
  const s = c.at(o, k.x, k.y, k.surf + 0.01, w1);
  c.fx.stream(b.id * 16 + 10, s.x, s.y, s.z, STEAM_FX, p < 0 ? 0.3 : p < T.paddle ? 0.6 : 1);
  const paddleOut = p >= T.poured + 0.015 && p < T.put - 0.01;
  if (!paddleOut) {
    paddleResting(c, o, mA);
    c.propM('crf_paddle', mA);
  }
  if (p < 0) return;
  // Pusty worek po slodzie lezy przy kotle, az piwowar zabierze go, wracajac do browaru.
  if (p >= T.poured && p < T.put + 0.012) {
    emptySack(c, o, mA);
    c.propM('crf_sack', mA, GRAIN);
  }
  if (p < T.at) {
    const fig = walker(c, o, BREW_IN, cruise(p / T.at), b.owner, S.BREWER);
    fig.tool = null;
    sackOnShoulder(fig, mProp, 1);
    c.figure(fig);
    c.propM('crf_sack', mProp, GRAIN);
    return;
  }
  if (p >= T.put) {
    const fig = walker(c, o, BREW_OUT, cruise(span(p, T.put, 1)), b.owner, S.BREWER);
    fig.armL = 0.05;
    const fr = c.figure(fig);
    if (p >= T.put + 0.012) {
      hand(fr.armL, w4);
      ypr(mA, w4.x, w4.y, w4.z, fig.rot + Math.PI / 2, Math.PI, 0, SACK_S * 0.8, SACK_S * 0.8, SACK_S * 0.25);
      c.propM('crf_sack', mA, GRAIN);
    }
    return;
  }
  const st = c.at(o, BREWERY.stir.x, BREWERY.stir.y, 0, w1);
  const fig = pose(st.x, st.y, st.z, faceL(0, -1), b.owner, S.BREWER);
  fig.tool = null;
  const ctr = c.at(o, k.x, k.y, k.rim, w2);
  if (p < T.poured) {
    // Wsypuje slod z worka do kotla.
    const u = span(p, T.at, T.poured);
    const tip = smooth(clamp01(u * 3)) * (1 - smooth(clamp01((u - 0.85) * 6)));
    sackOnShoulder(fig, mFrom, 1, false);
    // Worek przechylony wylotem nad srodkiem kotla, dnem do piwowara; pusty odrzuca obok kotla.
    const back = 0.0925;
    ypr(mBody, ctr.x - Math.sin(fig.rot) * back, ctr.y + 0.106, ctr.z - Math.cos(fig.rot) * back, fig.rot, Math.PI * 0.72, 0,
      SACK_S * (1 - 0.3 * u), SACK_S, SACK_S * (1 - 0.3 * u));
    if (u < 0.85) blend(mProp, mFrom, mBody, tip);
    else blend(mProp, mBody, emptySack(c, o, mA), smooth(span(u, 0.85, 1)));
    fig.lean = 0.25 * tip;
    reachV(fig, 1, pt(mProp, 0.03, 0.11, 0, w4));
    reachV(fig, -1, pt(mProp, -0.03, 0.02, 0, w4));
    c.figure(fig);
    c.propM('crf_sack', mProp, GRAIN);
    if (tip > 0.8 && c.details) {
      pt(mProp, 0, 0.142, 0, w4);
      MALT_BITS.floor = s.y - 0.01;
      c.fx.stream(b.id * 16 + 11, w4.x, w4.y, w4.z, MALT_BITS);
    }
    return;
  }
  if (p < T.paddle || p >= T.stirred) {
    // Bierze wioslo oparte o sciane albo odstawia je z powrotem.
    const g = p < T.paddle ? span(p, T.poured, T.paddle) : 1 - span(p, T.stirred, T.put);
    fig.rot = lerpAngle(faceL(0, -1), faceL(-1, 0.4), Math.sin(Math.PI * Math.min(1, g * 1.4)));
    paddleResting(c, o, mFrom);
    stirPaddle(c, o, fig, 0, mBody);
    blend(mProp, mFrom, mBody, smooth(clamp01((g - 0.35) / 0.65)));
    reachV(fig, 1, pt(mProp, 0, -0.02, 0, w4));
    if (g > 0.7) reachV(fig, -1, pt(mProp, 0, -0.09, 0, w4));
    c.figure(fig);
    c.propM('crf_paddle', mProp);
    return;
  }
  // Mieszanie: gorny koniec wiosla i pior kraza w przeciwnych fazach.
  const ph = span(p, T.paddle, T.stirred) * 9 * TAU;
  stirPaddle(c, o, fig, ph, mProp);
  fig.lean = 0.2 + 0.06 * Math.sin(ph);
  fig.twist = 0.12 * Math.sin(ph + 0.6);
  reachV(fig, 1, pt(mProp, 0, -0.02, 0, w4));
  reachV(fig, -1, pt(mProp, 0, -0.1, 0, w4));
  c.figure(fig);
  c.propM('crf_paddle', mProp);
}

/** Wioslo w kotle w fazie mieszania ph (macierz w `out`). */
function stirPaddle(c: WorkCtx, o: Origin, fig: Pose, ph: number, out: THREE.Matrix4): THREE.Matrix4 {
  const k = BREWERY.kettle;
  const blade = c.at(o, k.x + Math.cos(ph) * 0.03, k.y + Math.sin(ph) * 0.03, k.surf - 0.03, w3);
  const top = front(fig, 0.115, 0.0, 0.3, w5);
  top.x += (Math.cos(ph + Math.PI) * 0.012) * o.sc;
  top.z += (Math.sin(ph + Math.PI) * 0.012) * o.sc;
  return paddleBetween(out, top, blade);
}

/** Piwowar toczy beczke z piwem przed soba na flage; droga od drzwi. */
function brewer(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const fig = doorWalk(c, serf, at, BREWERY_EXIT);
  if (!fig) return false;
  if (serf.carry === G.BEER) {
    fig.carry = -1;
    fig.tool = null;
    fig.lean = 0.45;
    const r = 0.045 * US;
    const k = front(fig, 0.12, 0, r, w2);
    // Beczka lezy w poprzek drogi i toczy sie.
    ypr(mProp, k.x, k.y, k.z, fig.rot, exitDist / r, Math.PI / 2, US).multiply(mB.makeTranslation(0, -0.05, 0));
    reach(fig, 1, k.x + Math.cos(fig.rot) * 0.03, k.y + r + 0.01, k.z - Math.sin(fig.rot) * 0.03);
    reach(fig, -1, k.x - Math.cos(fig.rot) * 0.03, k.y + r + 0.01, k.z + Math.sin(fig.rot) * 0.03);
    c.figure(fig);
    c.goodAt(G.BEER, mProp, 0, 0, 0);
  } else c.figure(fig);
  return true;
}

// ---------------------------------------------------------------- hodowla oslow

/**
 * Hodowla oslow (uklad modelu): drzwi domu, owalna trasa oprowadzania (srodek, polosie; zaczyna sie przy sianie,
 * gdzie oslica stoi pyskiem ku -X, gdy nikt jej nie oprowadza), drzwi stajni (oslatko).
 */
const DONKEYS = {
  door: { x: -0.44, y: 0.0 },
  loop: { x: 0.06, y: -0.285, rx: 0.36, ry: 0.145 },
  stall: { x: 0.12, y: 0.03 },
};
/** Odstep hodowcy przed oslica i oslatka za nia (droga po owalu, uklad modelu). */
const LEAD = 0.18;
const FOAL_GAP = 0.17;
const DONK_T = { at: 0.04, rope: 0.06, lap1: 0.44, pause: 0.52, lap2: 0.82, release: 0.86, home: 0.93 };
const LOOP_N = 96;
const loopCum: number[] = [];
let loopLen = 0;
{
  const L = DONKEYS.loop;
  let px = L.x - L.rx, py = L.y;
  loopCum.push(0);
  for (let i = 1; i <= LOOP_N; i++) {
    const a = Math.PI + (i / LOOP_N) * TAU;
    const x = L.x + L.rx * Math.cos(a), y = L.y + L.ry * Math.sin(a);
    loopLen += Math.hypot(x - px, y - py);
    loopCum.push(loopLen);
    px = x;
    py = y;
  }
}

/** Punkt owalu po przejsciu drogi s od miejsca przy sianie (w kierunku: najpierw ku kamerze). */
function loopAt(s: number, out: Walk = WK): Walk {
  const L = DONKEYS.loop;
  let d = s % loopLen;
  if (d < 0) d += loopLen;
  let i = 0;
  while (i < LOOP_N - 1 && loopCum[i + 1] < d) i++;
  const f = (d - loopCum[i]) / (loopCum[i + 1] - loopCum[i]);
  const a = Math.PI + ((i + f) / LOOP_N) * TAU;
  out.x = L.x + L.rx * Math.cos(a);
  out.y = L.y + L.ry * Math.sin(a);
  out.rot = faceL(-L.rx * Math.sin(a), L.ry * Math.cos(a));
  out.dist = s;
  out.moving = true;
  return out;
}

/** Osiol: punkt na ziemi, obrot, skala; glowa pochylona o nod (+ = w dol); nogi w fazie ph z wymachem amp. */
function drawDonkey(c: WorkCtx, x: number, y: number, z: number, yaw: number, s: number, nod: number, ph: number, amp: number): void {
  ypr(mBody, x, y, z, yaw, 0, 0, s);
  c.propM('crf_donkey', mBody);
  mA.copy(mBody).multiply(mB.makeTranslation(0, 0.15, 0.08)).multiply(mB.makeRotationX(nod));
  c.propM('crf_donkey_head', mA);
  for (let k = 0; k < 4; k++) {
    const side = k & 1 ? 1 : -1, fore = k < 2 ? 1 : -1;
    const sw = Math.sin(ph + (side * fore > 0 ? 0 : Math.PI) + (fore > 0 ? 0 : 0.5)) * amp;
    mA.copy(mBody).multiply(mB.makeTranslation(side * 0.03, 0.1, fore * 0.065)).multiply(mB.makeRotationX(sw));
    c.propM('crf_leg', mA, DONKEY);
  }
}

/** Kantar osla (punkt przypiecia sznura) w swiecie dla ostatnio narysowanego osla z glowa pochylona o nod. */
function halter(nod: number, out: Vec3): Vec3 {
  mA.copy(mBody).multiply(mB.makeTranslation(0, 0.15, 0.08)).multiply(mB.makeRotationX(nod));
  return pt(mA, 0, 0.055, 0.105, out);
}

/** Droga oslicy po owalu w cyklu (uklad modelu) - z rozpedem i postojem w polowie. */
function donkeyDist(p: number): number {
  const T = DONK_T;
  const first = 2.12 * loopLen;
  if (p < T.rope) return 0;
  if (p < T.lap1) return first * cruise(span(p, T.rope, T.lap1), 0.05);
  if (p < T.pause) return first;
  if (p < T.lap2) return first + (4 * loopLen - first) * cruise(span(p, T.pause, T.lap2), 0.06);
  return 4 * loopLen;
}

function donkeybreeder(c: WorkCtx, b: Building, o: Origin): void {
  const p = workP(c, b);
  const T = DONK_T;
  const t = c.time;
  const sd = p < 0 ? 0 : donkeyDist(p);
  const walking = p >= T.rope && p < T.lap2 && !(p >= T.lap1 && p < T.pause);
  const home = loopAt(0, WK);
  const hx = home.x, hy = home.y;
  const eatYaw = faceL(-1, 0);
  let dx = hx, dy = hy, dyaw = eatYaw, nod = 0.95 + 0.06 * Math.sin(t * 5 + b.id), ph = 0, amp = 0;
  if (p >= T.at && p < T.release + 0.02) {
    const w = loopAt(sd, WK);
    dx = w.x;
    dy = w.y;
    const turnIn = smooth(span(sd, 0, 0.06));
    const turnOut = smooth(span(p, T.lap2, T.release));
    dyaw = lerpAngle(lerpAngle(eatYaw, w.rot, turnIn), eatYaw, turnOut);
    nod = lerp(0.95, 0.25, smooth(span(p, T.at, T.rope))) + 0.7 * turnOut;
    if (walking) {
      ph = sd * o.sc * 26;
      amp = 0.38;
      nod += 0.06 * Math.sin(ph * 2);
    }
    if (p >= T.lap1 && p < T.pause) nod += 0.25 * Math.max(0, Math.sin(span(p, T.lap1 + 0.02, T.pause - 0.02) * Math.PI * 4));
  }
  const dq = c.at(o, dx, dy, 0, w4);
  drawDonkey(c, dq.x, dq.y + (amp ? Math.abs(Math.sin(ph)) * 0.006 : 0), dq.z, dyaw, 1, nod, ph, amp);
  const hal = halter(nod, w5);
  const neck = pt(mA.copy(mBody).multiply(mB.makeTranslation(0, 0.19, 0.09)), 0, 0.02, 0, NECK);
  if (p < 0) return;
  if (p < T.home + 0.03) foal(c, b, o, p, sd);
  const owner = b.owner;
  if (p >= T.home) return;
  let fig: Pose;
  const start = loopAt(LEAD, WK);
  const sx = start.x, sy = start.y, srot = start.rot;
  if (p < T.at) {
    fig = walker(c, o, donkeyPath(DONKEYS.door.x, DONKEYS.door.y, sx, sy), cruise(p / T.at), owner, S.DONKEYBREEDER);
  } else if (p >= T.release) {
    fig = walker(c, o, donkeyPath(sx, sy, DONKEYS.door.x, DONKEYS.door.y), cruise(span(p, T.release, T.home)), owner, S.DONKEYBREEDER);
  } else {
    const sb = sd + LEAD;
    const w = loopAt(sb, WK);
    fig = poseAt(c, o, w.x, w.y, w.rot, owner, S.DONKEYBREEDER);
    if (walking) steps(fig, sd * o.sc);
    if (p < T.rope) fig.rot = lerpAngle(srot, srot + Math.PI, smooth(span(p, T.at, T.at + 0.01)));
    else if (p < T.rope + 0.01) fig.rot = lerpAngle(srot + Math.PI, w.rot, smooth(span(p, T.rope, T.rope + 0.01)));
    if (p >= T.lap1 && p < T.pause) {
      const turn = smooth(span(p, T.lap1, T.lap1 + 0.012)) * (1 - smooth(span(p, T.pause - 0.012, T.pause)));
      fig.rot = lerpAngle(w.rot, w.rot + Math.PI, turn);
      const pat = Math.sin(span(p, T.lap1 + 0.02, T.pause - 0.02) * Math.PI * 4);
      if (turn > 0.9) {
        reach(fig, -1, neck.x, neck.y + 0.015 * Math.max(0, pat), neck.z);
      }
    }
    if (p >= T.lap2) fig.rot = lerpAngle(w.rot, w.rot + Math.PI, smooth(span(p, T.lap2, T.lap2 + 0.012)));
  }
  const leading = p >= T.rope - 0.008 && p < T.release;
  if (leading) reachV(fig, 1, hal);
  const fr = c.figure(fig);
  if (leading && c.details) rope(c, hand(fr.armR, w3), hal, 0.005);
}

/** Lamana od punktu a do punktu b omijajaca siano (wspolny bufor). */
function donkeyPath(ax: number, ay: number, bx: number, by: number): number[] {
  const path = DONKEY_PATH;
  path.length = 0;
  path.push(ax, ay, -0.36, -0.1, bx, by);
  return path;
}
const DONKEY_PATH: number[] = [];
/** Szyja oslicy (tu hodowca ja klepie) - liczona po narysowaniu oslicy. */
const NECK: Vec3 = { x: 0, y: 0, z: 0 };

/** Oslatko (rosnie w ciagu cyklu): wybiega ze stajni, biega za oslica podskakujac, na koniec wraca do stajni. */
function foal(c: WorkCtx, b: Building, o: Origin, p: number, sd: number): void {
  const T = DONK_T;
  const t = c.time;
  const s = lerp(0.55, 0.7, p);
  const st = DONKEYS.stall;
  const wait = loopAt(loopLen - FOAL_GAP, WK2);
  let x: number, y: number, yaw: number, ph: number, amp = 0.5;
  if (p < T.rope) {
    const u = span(p, 0, T.rope);
    x = lerp(st.x, wait.x, u);
    y = lerp(st.y, wait.y, u);
    yaw = faceL(wait.x - st.x, wait.y - st.y);
    ph = u * 40;
    if (u >= 1) amp = 0;
  } else if (p < T.release) {
    const w = loopAt(sd - FOAL_GAP, WK);
    const side = 0.035 * Math.sin(t * 1.3 + b.id);
    x = w.x + side * 0.5;
    y = w.y + side;
    yaw = w.rot + 0.3 * Math.cos(t * 1.3 + b.id);
    ph = sd * o.sc * 34;
    const moving = p < T.lap1 || (p >= T.pause && p < T.lap2);
    if (!moving) {
      // Na postoju oslatko podskakuje w miejscu i rozglada sie.
      ph = t * 9;
      amp = 0.25;
      yaw = w.rot + Math.sin(t * 0.8 + b.id) * 0.8;
    }
  } else {
    const from = loopAt(4 * loopLen - FOAL_GAP, WK2);
    const u = span(p, T.release, T.home + 0.03);
    x = lerp(from.x, st.x, u);
    y = lerp(from.y, st.y, u);
    yaw = faceL(st.x - from.x, st.y - from.y);
    ph = u * 40;
  }
  const q = c.at(o, x, y, 0, w3);
  drawDonkey(c, q.x, q.y + Math.abs(Math.sin(ph)) * 0.012 * (amp > 0 ? 1 : 0), q.z, yaw, s, 0.3 + 0.1 * Math.sin(ph), ph, amp);
}

export const craftScenes: Scenes = {
  serf: {
    [S.MILLER]: miller,
    [S.BAKER]: baker,
    [S.BUTCHER]: butcher,
    [S.PIGFARMER]: pigfarmer,
    [S.WELLER]: weller,
    [S.BREWER]: brewer,
  },
  building: {
    [B.MILL]: mill,
    [B.BAKERY]: bakery,
    [B.BUTCHER]: butcherShop,
    [B.PIGFARM]: pigfarm,
    [B.WELL]: well,
    [B.BREWERY]: brewery,
    [B.DONKEYBREEDER]: donkeybreeder,
  },
};
