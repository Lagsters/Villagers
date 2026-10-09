/**
 * Pozostali: tragarze, osly i przewoznicy, budowniczy, kopacz, geolog, rycerze, katapulciarz.
 * Tragarz schyla sie po towar na fladze i odklada go (przy drugim tragarzu podaja go sobie z rak do rak),
 * bezczynny przestepuje z nogi na noge i siada. Osiol idzie klusem i skubie trawe, przewoznik wiosluje.
 * Budowniczy wnosi deski i kamienie z placu i przybija je, kopacz wyrownuje teren lopata i odrzuca ziemie
 * za siebie. Geolog stuka mlotkiem w skale, przyklada ucho do ziemi i wbija znak. Rycerze: warta przed
 * budynkiem, pojedynek (tarcza i ciecie), upadek pokonanego i miecz zwyciezcy w gorze. Katapulciarz kreci
 * kolem, laduje kamien, a kamien leci lukiem do celu.
 */
import * as THREE from 'three';
import { B, BUILDINGS, G, O, S, SIZE, T, TICKS_PER_SECOND } from '../../../sim/defs.ts';
import { BUILD_TICKS_PER_UNIT, LEVEL_TICKS } from '../../../sim/construction.ts';
import { GEO_PROBES, GEO_TICKS } from '../../../sim/geologist.ts';
import { ROUND_TICKS } from '../../../sim/military.ts';
import { SS } from '../../../sim/serfs.ts';
import { freeSlot } from '../../../sim/goods.ts';
import { CS, bestSlot } from '../../../sim/transport.ts';
import { FLAG_SLOTS, STAGE, type Building, type GameEvent, type GameState, type Road, type Serf } from '../../../sim/types.ts';
import { nb } from '../../../sim/world.ts';
import { objectSpot } from '../mapObjects.ts';
import { HAND, HIP, Rig, UNIT_SCALE, carryArms, carryStyle, swingArm, type Pose, type RigFrames } from '../rig.ts';
import type { Origin, Scenes, SerfAt, Vec3, WorkCtx } from './types.ts';

// ---------------------------------------------------------------- pomocnicze

const TAU = Math.PI * 2;
const hR = new THREE.Vector3();
const hL = new THREE.Vector3();
const vA: Vec3 = { x: 0, y: 0, z: 0 };
const vB: Vec3 = { x: 0, y: 0, z: 0 };
const vC: Vec3 = { x: 0, y: 0, z: 0 };

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Plynne przejscie 0..1 dla x w [a, b]. */
function ease(x: number, a: number, b: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Roznica katow sprowadzona do (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

/** Srodek miedzy dlonmi postaci (swiat). */
function handsMid(f: RigFrames, out: Vec3): Vec3 {
  Rig.point(f.armR, 0, HAND, 0, hR);
  Rig.point(f.armL, 0, HAND, 0, hL);
  out.x = (hR.x + hL.x) / 2;
  out.y = (hR.y + hL.y) / 2;
  out.z = (hR.z + hL.z) / 2;
  return out;
}

/** Krok chodu: wymach nog i rak dla fazy `walk` (rad). */
function walkLegs(p: Pose, walk: number, amp = 1): void {
  p.legL = Math.sin(walk) * 0.6 * amp;
  p.legR = -Math.sin(walk) * 0.6 * amp;
  p.bob = Math.abs(Math.sin(walk)) * 0.02 * amp;
}

/** Wyczyszczenie pamieci klienta, gdy urosnie (osadnicy znikaja bez sladu). */
function prune<K, V>(map: Map<K, V>, max = 2000): void {
  if (map.size > max) map.clear();
}

// ---------------------------------------------------------------- tragarz

/** Promien pierscienia towarow wokol masztu flagi (jak w entities.ts) i miejsce tragarza schylajacego sie po towar. */
const SLOT_R = 0.2;
const STAND_R = 0.34;
/** Miejsce tragarza przy fladze od strony jego drogi (gdy nic nie podnosi ani nie odklada). */
const ROAD_STAND_R = 0.3;
/** Czesc kroku do flagi, po ktorej tragarz stoi i sie schyla; czesc kroku od flagi, w ktorej sie prostuje. */
const ARRIVE_WALK = 0.58;
const LEAVE_WALK = 0.32;
/** Po tylu sekundach bezczynnosci tragarz (i budowniczy bez materialu) siada; tyle trwa siadanie. */
const IDLE_SIT = 7;
const SIT_TIME = 0.8;
/** Obnizenie bioder siedzacej postaci (jednostki modelu): siedzi na ziemi z nogami wyciagnietymi przed siebie. */
const SIT_DROP = HIP - 0.03;

/** Gdzie tragarz stanal przy fladze (pamiec klienta): pole flagi, punkt, obrot, czy sie schylil, czy podawal z rak do rak. */
interface FlagSpot {
  cell: number;
  x: number;
  z: number;
  rot: number;
  bent: boolean;
  hand: boolean;
}
const flagSpots = new Map<number, FlagSpot>();
/** Poczatek bezczynnosci tragarza na drodze: pole i czas. */
const idleSince = new Map<number, { cell: number; t: number }>();
/** Tragarz wstajacy z ziemi w pierwszym kroku po bezczynnosci: pole, z ktorego wstaje, i obrot siedzacego. */
const risingFrom = new Map<number, { cell: number; rot: number }>();
/** Obrot siedzacej postaci (bokiem do kamery). */
function sitFacing(c: WorkCtx, id: number): number {
  return c.toCamera + (id % 2 ? 1.1 : -1.1);
}

/** Co tragarz zrobi, dochodzac do flagi: slot towaru, ktory odlozy albo podniesie (-1 nic), i czy odklada. */
const action = { slot: -1, drop: false };
function arrivalAction(s: GameState, serf: Serf, road: Road, cell: number): typeof action {
  action.slot = -1;
  action.drop = false;
  const f = s.flags[s.map.objId[cell]];
  if (!f) return action;
  const dir = cell === road.cells[0] ? road.dirA : road.dirB;
  if (serf.sub === CS.FETCH) {
    const k = serf.home;
    action.slot = k >= 0 && k < FLAG_SLOTS && f.slotClaim[k] === serf.id && f.slotGood[k] >= 0 ? k : bestSlot(s, f, dir);
  } else if ((serf.sub === CS.CARRY || serf.sub === CS.WAIT) && serf.carry >= 0) {
    const b = serf.carryDest >= 0 ? s.buildings[serf.carryDest] : null;
    if (b && b.flag === f.id) return action;
    action.drop = true;
    action.slot = freeSlot(f);
    if (action.slot < 0) action.slot = bestSlot(s, f, dir);
  } else if (serf.sub === CS.OUTOF) {
    action.slot = bestSlot(s, f, dir);
  }
  return action;
}

/** Miejsce tragarza przy fladze od strony jego drogi. */
function roadStand(c: WorkCtx, road: Road, cell: number, out: Vec3): Vec3 {
  const n = road.cells.length;
  const adj = cell === road.cells[0] ? road.cells[1] : road.cells[n - 2];
  const f = c.cell(cell, out);
  const a = c.cell(adj, vC);
  const dx = a.x - f.x, dz = a.z - f.z;
  const l = Math.hypot(dx, dz) || 1;
  out.x = f.x + (dx / l) * ROAD_STAND_R;
  out.z = f.z + (dz / l) * ROAD_STAND_R;
  out.y = c.ground(out.x, out.z);
  return out;
}

/** Punkt przy fladze, z ktorego tragarz rusza (tam, gdzie stanal), albo miejsce od strony drogi. */
function leaveStand(c: WorkCtx, serf: Serf, road: Road, cell: number, out: Vec3): Vec3 {
  const sp = flagSpots.get(serf.id);
  if (sp && sp.cell === cell) {
    out.x = sp.x;
    out.z = sp.z;
    out.y = c.ground(sp.x, sp.z);
    return out;
  }
  return roadStand(c, road, cell, out);
}

/** Punkt slotu towaru na fladze (jak w entities.ts) albo miejsce tragarza przy nim (r = STAND_R). */
function slotPoint(c: WorkCtx, cell: number, slot: number, r: number, out: Vec3): Vec3 {
  const f = c.cell(cell, out);
  const a = (slot / FLAG_SLOTS) * TAU;
  out.x = f.x + Math.cos(a) * r;
  out.z = f.z + Math.sin(a) * r;
  if (r !== SLOT_R) out.y = c.ground(out.x, out.z);
  else out.y = f.y + 0.01;
  return out;
}

/** Poza postaci schylonej nad ziemia (k = 0..1 stopien schylenia). */
function bendPose(p: Pose, k: number): void {
  p.lean = 0.95 * k;
  p.crouch = 0.022 * k;
  p.head = -0.45 * k;
  p.armL = lerp(p.armL ?? 0, -0.55, k);
  p.armR = lerp(p.armR ?? 0, -0.55, k);
  p.armLOut = 0.1 * k;
  p.armROut = 0.1 * k;
  p.legL = lerp(p.legL ?? 0, 0.05, k);
  p.legR = lerp(p.legR ?? 0, -0.05, k);
  p.legLOut = lerp(p.legLOut ?? 0, 0.13, k);
  p.legROut = lerp(p.legROut ?? 0, 0.13, k);
}

/** Towar w dloniach (miedzy dlonmi, lekko ponizej). */
function goodInHands(c: WorkCtx, g: number, f: RigFrames, rot: number): void {
  const m = handsMid(f, vC);
  c.good(g, m.x, m.y - 0.035, m.z, rot, UNIT_SCALE);
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function basePose(serf: Serf, x: number, y: number, z: number, rot: number): Pose {
  return { x, y, z, rot, owner: serf.owner, type: serf.type, tool: null };
}

/** Bezczynny tragarz na srodku drogi: przestepuje z nogi na noge, rozglada sie, po chwili siada. */
function idleCarrier(c: WorkCtx, serf: Serf, at: SerfAt, road: Road | null): void {
  let rec = idleSince.get(serf.id);
  if (!rec || rec.cell !== serf.pos) {
    rec = { cell: serf.pos, t: c.time };
    idleSince.set(serf.id, rec);
    prune(idleSince);
  }
  const idle = c.time - rec.t;
  const sit = ease(idle, IDLE_SIT, IDLE_SIT + SIT_TIME);
  // Siedzi bokiem do kamery (nogi wyciagniete widac z boku), stoi przodem.
  const face = idleFacing(c, road, serf.pos);
  const rot = lerpAngle(face, sitFacing(c, serf.id), sit);
  const p = basePose(serf, at.x, at.y, at.z, rot);
  standIdle(c, p, serf.id, 1 - sit);
  if (sit > 0) sitPose(c, p, serf.id, sit, idle);
  c.figure(p);
}

/** Kierunek bezczynnego tragarza: w poprzek drogi, przodem ku kamerze. */
function idleFacing(c: WorkCtx, road: Road | null, cell: number): number {
  if (!road) return c.toCamera;
  const k = road.cells.indexOf(cell);
  if (k <= 0 || k >= road.cells.length - 1) return c.toCamera;
  const a = c.cell(road.cells[k - 1], vA);
  const b = c.cell(road.cells[k + 1], vB);
  const along = Math.atan2(b.x - a.x, b.z - a.z);
  const r1 = along + Math.PI / 2, r2 = along - Math.PI / 2;
  return Math.abs(angleDiff(r1, c.toCamera)) < Math.abs(angleDiff(r2, c.toCamera)) ? r1 : r2;
}

/** Stanie bez pracy (w = waga pozy): przestepowanie z nogi na noge, rozgladanie sie i co kilka sekund drobna czynnosc. */
function standIdle(c: WorkCtx, p: Pose, id: number, w: number): void {
  if (w <= 0) return;
  const t = c.time + id * 1.7;
  const shift = Math.sin(t * 1.4);
  const step = Math.max(0, Math.sin(t * 2.8 + 1)) * (Math.abs(shift) > 0.6 ? 1 : 0);
  p.tilt = shift * 0.07 * w;
  p.legLOut = (0.05 + Math.max(0, -shift) * 0.12) * w;
  p.legROut = (0.05 + Math.max(0, shift) * 0.12) * w;
  p.legL = (shift > 0 ? -step * 0.25 : 0) * w;
  p.legR = (shift < 0 ? -step * 0.25 : 0) * w;
  p.armL = (0.08 - shift * 0.1) * w;
  p.armR = (0.08 + shift * 0.1) * w;
  p.armLOut = 0.07 * w;
  p.armROut = 0.07 * w;
  p.headTurn = Math.sin(t * 0.45) * 0.7 * w;
  p.head = 0.05 * w;
  // Co kilka sekund jedna z drobnych czynnosci (inna w kazdym cyklu): drapanie sie w glowe, przeciaganie sie
  // z ziewnieciem, wypatrywanie z dlonia przy czole, rece za plecami, przytupywanie.
  const cyc = t % 9;
  const act = Math.floor(hash(id * 31 + Math.floor(t / 9), 5) * 5);
  const k = ease(cyc, 4.6, 5.2) * (1 - ease(cyc, 7.4, 8)) * w;
  if (k <= 0) return;
  if (act === 0) {
    p.armR = lerp(p.armR, -2.4 + Math.sin(t * 18) * 0.12, k);
    p.elbowR = 1.3 * k;
    p.armROut = lerp(p.armROut, 0.55, k);
    p.head = lerp(p.head, 0.2, k);
    p.headTurn = lerp(p.headTurn, -0.3, k);
  } else if (act === 1) {
    p.armL = lerp(p.armL, -2.95, k);
    p.armR = lerp(p.armR, -2.95, k);
    p.armLOut = lerp(p.armLOut, 0.35, k);
    p.armROut = lerp(p.armROut, 0.35, k);
    p.head = lerp(p.head, -0.3, k);
    p.headTurn = lerp(p.headTurn, 0, k);
    p.lean = -0.1 * k;
  } else if (act === 2) {
    // Dlon przy czole jak daszek: ramie do przodu i w gore, przedramie zgiete ku twarzy.
    p.armR = lerp(p.armR, -1.7, k);
    p.elbowR = 1.9 * k;
    p.armROut = lerp(p.armROut, -0.15, k);
    p.head = lerp(p.head, -0.12, k);
    p.headTurn = lerp(p.headTurn, Math.sin(t * 0.3) * 0.9, k);
  } else if (act === 3) {
    // Rece za plecami: ramiona do tylu i do srodka, lokcie lekko zgiete.
    p.armL = lerp(p.armL, 0.5, k);
    p.armR = lerp(p.armR, 0.5, k);
    p.elbowL = p.elbowR = 0.25 * k;
    p.armLOut = lerp(p.armLOut, -0.3, k);
    p.armROut = lerp(p.armROut, -0.3, k);
    p.lean = 0.04 * k;
  } else {
    p.legR = lerp(p.legR ?? 0, -0.25 * Math.max(0, Math.sin(t * 9)), k);
    p.head = lerp(p.head, 0.08 + Math.max(0, Math.sin(t * 9)) * 0.05, k);
  }
}

/** Siedzenie na ziemi (k = 0..1 przejscie): nogi przed soba, rece oparte z tylu; od czasu do czasu przeciaganie sie. */
function sitPose(c: WorkCtx, p: Pose, id: number, k: number, idle: number): void {
  const t = c.time + id * 2.3;
  p.y -= SIT_DROP * UNIT_SCALE * k;
  p.legL = lerp(p.legL ?? 0, -1.45, k);
  p.legR = lerp(p.legR ?? 0, -1.38, k);
  p.legLOut = lerp(p.legLOut ?? 0, 0.1, k);
  p.legROut = lerp(p.legROut ?? 0, 0.14, k);
  p.lean = lerp(p.lean ?? 0, -0.22, k);
  p.tilt = lerp(p.tilt ?? 0, 0, k);
  // Przeciaganie sie co jakis czas (rece w gore), poza tym rece oparte z tylu o ziemie.
  const cyc = (idle - IDLE_SIT) % 11;
  const stretch = idle > IDLE_SIT + 4 ? ease(cyc, 6, 6.6) * (1 - ease(cyc, 7.8, 8.6)) : 0;
  p.armL = lerp(p.armL ?? 0, lerp(0.75, -2.9, stretch), k);
  p.armR = lerp(p.armR ?? 0, lerp(0.75, -2.9, stretch), k);
  p.armLOut = lerp(p.armLOut ?? 0, lerp(0.3, 0.25, stretch), k);
  p.armROut = lerp(p.armROut ?? 0, lerp(0.3, 0.25, stretch), k);
  p.head = lerp(p.head ?? 0, -0.15 * stretch + Math.sin(t * 0.3) * 0.1, k);
  p.headTurn = lerp(p.headTurn ?? 0, Math.sin(t * 0.37) * 0.8 * (1 - stretch), k);
}

/** Wstawanie z ziemi (k = 1 siedzi, 0 stoi). */
function riseFromSit(p: Pose, k: number): void {
  if (k <= 0) return;
  p.y -= SIT_DROP * UNIT_SCALE * k;
  p.legL = lerp(p.legL ?? 0, -1.45, k);
  p.legR = lerp(p.legR ?? 0, -1.38, k);
  p.lean = lerp(p.lean ?? 0, k > 0.5 ? -0.22 : 0.5, k > 0.5 ? (k - 0.5) * 2 : k * 2);
  p.armL = lerp(p.armL ?? 0, 0.75, k);
  p.armR = lerp(p.armR ?? 0, 0.75, k);
  p.armLOut = 0.3 * k;
  p.armROut = 0.3 * k;
}

/** Ostatnio narysowany tragarz, ktory przy fladze odklada towar albo czeka z nim (drop), i ten, ktory siega po towar (pick). */
interface FlagRole {
  id: number;
  x: number;
  z: number;
  t: number;
}
const flagDrop = new Map<number, FlagRole>();
const flagPick = new Map<number, FlagRole>();
/** Najdalej tak daleko od siebie stoja tragarze podajacy sobie towar przy fladze. */
const HAND_R = 0.75;

function setRole(roles: Map<number, FlagRole>, cell: number, id: number, x: number, z: number, t: number): void {
  let r = roles.get(cell);
  if (!r) {
    r = { id, x, z, t };
    roles.set(cell, r);
    prune(roles, 500);
  }
  r.id = id;
  r.x = x;
  r.z = z;
  r.t = t;
}

/** Drugi tragarz przy tej samej fladze w roli z mapy roles (podawanie z rak do rak) albo null. */
function partner(c: WorkCtx, roles: Map<number, FlagRole>, cell: number, id: number, x: number, z: number): FlagRole | null {
  const r = roles.get(cell);
  if (!r || r.id === id || c.time - r.t > 0.15) return null;
  return Math.hypot(r.x - x, r.z - z) < HAND_R ? r : null;
}

/** Rece wyciagniete przed siebie na wysokosci piersi (podawanie i odbieranie towaru). */
function handOut(p: Pose, k: number): void {
  p.armL = lerp(p.armL ?? 0, -1.3, k);
  p.armR = lerp(p.armR ?? 0, -1.3, k);
  p.armLYaw = 0.15 * k;
  p.armRYaw = -0.15 * k;
  p.lean = lerp(p.lean ?? 0, 0.12, k);
}

/**
 * Tragarz na drodze: przy fladze staje przy miejscu towaru, schyla sie i podnosi go na glowe albo zdejmuje
 * go z glowy i stawia tam, gdzie potem lezy na fladze; z drugim tragarzem przy tej fladze podaja go sobie
 * z rak do rak. Bez pracy stoi albo siedzi na srodku drogi.
 */
function carrier(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.CARRIER) {
    idleSince.delete(serf.id);
    return false;
  }
  const s = c.s;
  const road = s.roads[serf.road];
  if (!road) return false;
  const map = s.map;
  const moving = at.to >= 0;
  // Bezczynny na drodze (takze tick po dostaniu pracy, zanim ruszy): stoi albo siedzi.
  const rec = idleSince.get(serf.id);
  if (!moving && map.obj[serf.pos] !== O.FLAG && (serf.sub === CS.IDLE || (rec && rec.cell === serf.pos))) {
    idleCarrier(c, serf, at, road);
    return true;
  }
  if (rec) {
    if (c.time - rec.t > IDLE_SIT + SIT_TIME * 0.5 && moving) risingFrom.set(serf.id, { cell: rec.cell, rot: sitFacing(c, serf.id) });
    idleSince.delete(serf.id);
  }
  const fromFlag = map.obj[serf.pos] === O.FLAG;
  const toFlag = moving && map.obj[at.to] === O.FLAG;
  if (!moving) {
    atFlag(c, serf, road);
    return true;
  }

  // Idzie: punkt startu i konca kroku (przy fladze - miejsce, gdzie stoi przy towarach).
  const from = fromFlag ? leaveStand(c, serf, road, serf.pos, vA) : c.cell(serf.pos, vA);
  let to: Vec3;
  let act = -1;
  let drop = false;
  if (toFlag) {
    const a = arrivalAction(s, serf, road, at.to);
    act = a.slot;
    drop = a.drop;
    to = act >= 0 ? slotPoint(c, at.to, act, STAND_R, vB) : roadStand(c, road, at.to, vB);
  } else to = c.cell(at.to, vB);

  const t = at.t;
  const sp = flagSpots.get(serf.id);
  const fromSpot = fromFlag && !!sp && sp.cell === serf.pos && serf.sub !== CS.INTO;
  const bentStart = fromSpot && sp.bent;
  const handStart = fromSpot && sp.hand;
  const rise = risingFrom.get(serf.id);
  const rising = rise !== undefined && rise.cell === serf.pos;
  if (rise !== undefined && !rising) risingFrom.delete(serf.id);
  const w0 = bentStart || handStart || rising ? LEAVE_WALK : 0;
  const w1 = act >= 0 ? ARRIVE_WALK : 1;
  const w = clamp01((t - w0) / (w1 - w0));
  const x = lerp(from.x, to.x, w), z = lerp(from.z, to.z, w);
  const y = c.ground(x, z);
  const rot = Math.atan2(to.x - from.x, to.z - from.z);
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const p = basePose(serf, x, y, z, rot);
  const walking = t > w0 && t < w1;
  const walk = w * Math.PI * 2 * Math.max(0.6, dist);
  if (walking) walkLegs(p, walk);
  const carrying = serf.carry >= 0;
  // Rece: z towarem ulozone wg sposobu niesienia (carryArms), bez towaru wymach do kroku.
  const style = carrying ? carryStyle(serf.carry) : 'head';
  const held = basePose(serf, x, y, z, rot);
  carryArms(held, style);
  swingArm(p, -1, walking ? -Math.sin(walk) * 0.5 : 0);
  swingArm(p, 1, walking ? Math.sin(walk) * 0.5 : 0);
  if (carrying) carryArms(p, style, p.armL);
  // Pod gore pochyla sie do przodu, z gory odchyla do tylu; z ciezkim ladunkiem mocniej.
  if (walking && dist > 1e-3) {
    const slope = (c.ground(to.x, to.z) - c.ground(from.x, from.z)) / dist;
    p.lean = (p.lean ?? 0) + Math.max(-0.18, Math.min(0.25, slope * (style === 'arms' ? 1.4 : 1.0)));
  }

  // Na glowie (domyslnie), w dloniach albo na ziemi: polozenie towaru w tej klatce.
  let goodMode: 'head' | 'hands' | 'none' = carrying ? 'head' : 'none';
  let toGround = 0;
  if (rising) {
    riseFromSit(p, 1 - ease(t, 0.02, LEAVE_WALK));
    p.rot = lerpAngle(rise.rot, rot, ease(t, 0.08, LEAVE_WALK));
  }
  if ((bentStart || handStart) && t < LEAVE_WALK + 0.12) {
    // Prostuje sie po odlozeniu albo unosi podniesiony (odebrany) towar: do piersi, potem nad glowe.
    const k = 1 - ease(t, 0, LEAVE_WALK * 0.55);
    if (bentStart) bendPose(p, k);
    else {
      handOut(p, k);
      p.rot = lerpAngle(sp.rot, rot, ease(t, 0, LEAVE_WALK));
    }
    if (carrying) {
      const up = ease(t, LEAVE_WALK * 0.45, LEAVE_WALK + 0.1);
      const chest = bentStart ? -0.75 + (1 - k) * -0.6 : -1.3;
      p.armL = lerp(chest, held.armL ?? 0, up);
      p.armR = lerp(chest, held.armR ?? 0, up);
      p.armLOut = lerp(0, held.armLOut ?? 0, up);
      p.armROut = lerp(0, held.armROut ?? 0, up);
      p.elbowL = lerp(0, held.elbowL ?? 0, up);
      p.elbowR = lerp(0, held.elbowR ?? 0, up);
      goodMode = up < 0.85 ? 'hands' : 'head';
    }
  }
  if (act >= 0 && t > w1 - 0.06) {
    const k = ease(t, w1 - 0.04, 1);
    const flagPt = c.cell(at.to, vC);
    const toFlagRot = c.facing(x, z, flagPt.x, flagPt.z);
    const turn = ease(t, w1 - 0.05, w1 + 0.15);
    // Drugi tragarz przy tej fladze siega po towar (albo odklada swoj): podaja sobie z rak do rak.
    const mate = drop ? partner(c, flagPick, at.to, serf.id, x, z) : partner(c, flagDrop, at.to, serf.id, x, z);
    setRole(drop ? flagDrop : flagPick, at.to, serf.id, x, z, c.time);
    if (mate) {
      const face = c.facing(x, z, mate.x, mate.z);
      p.rot = lerpAngle(rot, face, turn);
      if (drop) {
        // Podaje towar drugiemu, a na koniec stawia go przy fladze.
        const down = ease(t, w1 - 0.06, w1 + 0.15);
        p.armL = lerp(held.armL ?? 0, -1.3, down);
        p.armR = lerp(held.armR ?? 0, -1.3, down);
        p.armLOut = lerp(held.armLOut ?? 0, 0, down);
        p.armROut = lerp(held.armROut ?? 0, 0, down);
        p.elbowL = lerp(held.elbowL ?? 0, 0, down);
        p.elbowR = lerp(held.elbowR ?? 0, 0, down);
        if (down > 0.15) goodMode = 'hands';
        handOut(p, ease(t, w1 + 0.1, w1 + 0.25));
        const set = ease(t, 0.84, 0.97);
        if (set > 0) bendPose(p, set * 0.85);
        toGround = ease(t, 0.88, 1);
      } else handOut(p, k);
    } else if (drop) {
      // Zdejmuje towar z glowy do piersi, potem schyla sie i stawia go na ziemi.
      const down = ease(t, w1 - 0.06, w1 + 0.12);
      p.armL = lerp(held.armL ?? 0, -1.2, down);
      p.armR = lerp(held.armR ?? 0, -1.2, down);
      p.armLOut = lerp(held.armLOut ?? 0, 0, down);
      p.armROut = lerp(held.armROut ?? 0, 0, down);
      p.elbowL = lerp(held.elbowL ?? 0, 0, down);
      p.elbowR = lerp(held.elbowR ?? 0, 0, down);
      if (down > 0.15) goodMode = 'hands';
      bendPose(p, ease(t, w1 + 0.1, 0.97));
      toGround = ease(t, 0.85, 1);
      p.rot = lerpAngle(rot, toFlagRot, turn);
    } else {
      bendPose(p, k);
      p.rot = lerpAngle(rot, toFlagRot, turn);
    }
    let fs = flagSpots.get(serf.id);
    if (!fs) {
      fs = { cell: at.to, x: to.x, z: to.z, rot: p.rot, bent: false, hand: false };
      flagSpots.set(serf.id, fs);
      prune(flagSpots);
    }
    fs.cell = at.to;
    fs.x = to.x;
    fs.z = to.z;
    fs.rot = p.rot;
    fs.bent = !mate || drop;
    fs.hand = !!mate && !drop;
  } else if (toFlag) {
    // Krok do flagi przed schyleniem sie (albo bez niego, np. z towarem do budynku przy tej fladze): stad ruszy dalej.
    let fs = flagSpots.get(serf.id);
    if (!fs) {
      fs = { cell: at.to, x: to.x, z: to.z, rot, bent: false, hand: false };
      flagSpots.set(serf.id, fs);
      prune(flagSpots);
    }
    fs.cell = at.to;
    fs.x = to.x;
    fs.z = to.z;
    fs.rot = rot;
    fs.bent = act >= 0;
    fs.hand = false;
  }
  if (goodMode === 'head') p.carry = serf.carry;
  const f = c.figure(p);
  if (goodMode === 'hands' && carrying) {
    if (toGround > 0) {
      const m = handsMid(f, vC);
      const g = slotPoint(c, at.to, act, SLOT_R, vA);
      const slotRot = (act / FLAG_SLOTS) * TAU + 1.2;
      c.good(serf.carry, lerp(m.x, g.x, toGround), lerp(m.y - 0.035, g.y, toGround), lerp(m.z, g.z, toGround),
        lerpAngle(p.rot, slotRot, toGround), lerp(UNIT_SCALE, 1, toGround));
      if (toGround > 0.9) c.sfx(dropSound(serf.carry), g.x, g.z, 0x6600000 + serf.id, 0.7);
    } else goodInHands(c, serf.carry, f, p.rot);
  }
  return true;
}

/** Odglos towaru stawianego na ziemi: drewno, kamien i ruda, metal albo worek (reszta). */
function dropSound(g: number): string {
  if (g === G.LUMBER || g === G.PLANK || g === G.BOAT || g === G.BOW || g === G.ROLLING_PIN) return 'drop_wood';
  if (g === G.STONE || g === G.IRON_ORE || g === G.GOLD_ORE || g === G.COAL) return 'drop_stone';
  if (g === G.STEEL || g === G.GOLD || g >= G.SHOVEL) return 'drop_metal';
  return 'drop_sack';
}

/** Tragarz stoi przy fladze: chwila miedzy krokami (schylony nad towarem, z rekami wyciagnietymi do drugiego) albo czeka. */
function atFlag(c: WorkCtx, serf: Serf, road: Road): void {
  const st = leaveStand(c, serf, road, serf.pos, vA);
  const sp = flagSpots.get(serf.id);
  const flag = c.cell(serf.pos, vB);
  let rot = c.facing(st.x, st.z, flag.x, flag.z);
  const p = basePose(serf, st.x, st.y, st.z, rot);
  if (serf.sub === CS.WAIT) {
    // Czeka przy pelnej fladze z towarem w rekach; gdy ktos przyjdzie po towar, podaje mu swoj.
    waitPose(c, p, serf.id);
    setRole(flagDrop, serf.pos, serf.id, st.x, st.z, c.time);
    const mate = partner(c, flagPick, serf.pos, serf.id, st.x, st.z);
    if (mate) {
      rot = c.facing(st.x, st.z, mate.x, mate.z);
      p.rot = rot;
      handOut(p, 1);
      p.headTurn = 0;
    }
    const f = c.figure(p);
    if (serf.carry >= 0) goodInHands(c, serf.carry, f, rot);
    return;
  }
  if (sp && sp.cell === serf.pos) {
    if (sp.bent) bendPose(p, 1);
    else if (sp.hand) {
      p.rot = sp.rot;
      handOut(p, 1);
    }
    if (serf.carry >= 0 && (sp.bent || sp.hand)) setRole(flagPick, serf.pos, serf.id, st.x, st.z, c.time);
  }
  const inHands = !!sp && (sp.bent || sp.hand);
  if (serf.carry >= 0 && !inHands) {
    p.carry = serf.carry;
    carryArms(p, carryStyle(serf.carry));
  }
  const f = c.figure(p);
  if (serf.carry >= 0 && inHands) goodInHands(c, serf.carry, f, p.rot);
}

/** Czekanie przy pelnej fladze z towarem w rekach: przestepuje z nogi na noge, rozglada sie. */
function waitPose(c: WorkCtx, p: Pose, id: number): void {
  const t = c.time + id;
  const shift = Math.sin(t * 1.6);
  p.tilt = shift * 0.06;
  p.legLOut = 0.06 + Math.max(0, -shift) * 0.1;
  p.legROut = 0.06 + Math.max(0, shift) * 0.1;
  p.armL = -0.65;
  p.armR = -0.65;
  p.armLOut = 0.08;
  p.armROut = 0.08;
  p.lean = 0.08;
  p.headTurn = Math.sin(t * 0.6) * 0.5;
}

// ---------------------------------------------------------------- plac budowy: budowniczy i kopacz

const WOOD_CHIP = 0xd8b07a;
const STONE_CHIP = 0xbab6ae;
const EARTH = 0x7d5733;
/** Skala deski ppl_plank w swiecie (dlugosc ok. 0.29). */
const PLANK_S = 0.85;
/** Obrot modeli budynkow (30 stopni): deska wzdluz osi X placu. */
const BROT_RAD = Math.PI / 6;
/**
 * Etapy jednostki budowy (b.progress 0..1): przy stosie schyla sie po deske albo kamien, niesie go pod
 * sciane, przyklada, przybija mlotkiem (kamien: kleka i dobija), oglada robote i wraca do stosu.
 */
const BUILD = { pick: 0.1, go: 0.24, place: 0.3, hammer: 0.86, look: 0.9 } as const;
/** Miejsca pracy budowniczego wzdluz przedniej podwaliny (ulamek polowy szerokosci obrysu), kolejno dla jednostek. */
const WORK_X = [-0.55, 0.35, -0.1, 0.65, 0.1, -0.35, 0.5];
/** Wysokosc przybijanej deski nad ziemia (jednostki modelu): na przemian na wysokosci piersi i nisko. */
const PLANK_H = [0.13, 0.075];

/** Obrys podwaliny placu (polowa szerokosci i glebokosci w ukladzie modelu, jak site() w art/scripts/buildings.py). */
const siteGeo = { hx: 0, hy: 0 };
function siteOf(kind: number): typeof siteGeo {
  const size = BUILDINGS[kind].size;
  const w = size === SIZE.LARGE ? 1.2 : size === SIZE.MEDIUM ? 0.72 : 0.55;
  siteGeo.hx = w * 0.42;
  siteGeo.hy = w * 0.36;
  return siteGeo;
}

/** Stos desek albo kamieni na lewo od placu (uklad modelu). */
function pileX(g: typeof siteGeo): number {
  return -(g.hx + 0.12);
}
function pileY(g: typeof siteGeo, plank: boolean): number {
  return plank ? -g.hy * 0.3 : g.hy * 0.5;
}

/** Biezaca jednostka budowy: postep 0..1 (-1 gdy budowniczy nie pracuje), czy deska, numer jednostki. */
const phase = { p: -1, plank: true, n: 0 };
function buildPhase(c: WorkCtx, b: Building): typeof phase {
  phase.p = -1;
  const serf = b.builder >= 0 ? c.s.serfs[b.builder] : null;
  const def = BUILDINGS[b.kind];
  phase.n = b.planksUsed + b.stonesUsed;
  phase.plank = def.planks - b.planksUsed > 0 && b.planks > 0;
  if (!serf || serf.state !== SS.BUILDER || serf.anim !== 1 || b.stage !== STAGE.BUILD) return phase;
  phase.p = clamp01((b.progress + c.alpha) / BUILD_TICKS_PER_UNIT);
  return phase;
}

/** Deska przybijana do podwaliny w jednostce n (uklad modelu: x, y, wysokosc). */
function wallPlank(g: typeof siteGeo, n: number, out: Vec3): Vec3 {
  out.x = WORK_X[n % WORK_X.length] * g.hx;
  out.y = -g.hy - 0.012;
  out.z = PLANK_H[n % 2];
  return out;
}

/** Gdzie stanal budowniczy/kopacz na placu (pamiec klienta, do plynnego zejscia z placu). */
const siteSpot = new Map<number, { cell: number; x: number; z: number }>();
function rememberSpot(id: number, cell: number, x: number, z: number): void {
  let sp = siteSpot.get(id);
  if (!sp) {
    sp = { cell, x, z };
    siteSpot.set(id, sp);
    prune(siteSpot, 500);
  }
  sp.cell = cell;
  sp.x = x;
  sp.z = z;
}

/** Krok z domyslna poza chodu, ale miedzy wlasnymi punktami (wejscie na plac i zejscie z niego). */
function walkBetween(c: WorkCtx, serf: Serf, at: SerfAt, fx: number, fz: number, tx: number, tz: number): void {
  const p = c.walkPose(serf, at);
  p.x = lerp(fx, tx, at.t);
  p.z = lerp(fz, tz, at.t);
  p.y = c.ground(p.x, p.z);
  if (Math.abs(tx - fx) + Math.abs(tz - fz) > 1e-4) p.rot = Math.atan2(tx - fx, tz - fz);
  c.figure(p);
}

/**
 * Wejscie na plac (ostatni krok do pola budynku konczy sie w miejscu pracy, nie na srodku placu) i zejscie
 * z niego (pierwszy krok zaczyna sie tam, gdzie stal). true - narysowane.
 */
function siteSteps(c: WorkCtx, serf: Serf, at: SerfAt, spot: (c: WorkCtx, b: Building, out: Vec3) => Vec3): boolean {
  if (at.to < 0) return false;
  const s = c.s;
  if (serf.state === SS.TO_BUILDING) {
    const b = s.buildings[serf.target];
    if (!b || b.pos !== at.to || b.stage === STAGE.DONE || (b.builder !== serf.id && b.digger !== serf.id)) return false;
    const from = c.cell(at.from, vA);
    const to = spot(c, b, vB);
    walkBetween(c, serf, at, from.x, from.z, to.x, to.z);
    return true;
  }
  const sp = siteSpot.get(serf.id);
  if (sp && sp.cell === at.from) {
    const to = c.cell(at.to, vB);
    walkBetween(c, serf, at, sp.x, sp.z, to.x, to.z);
    if (at.t > 0.95) siteSpot.delete(serf.id);
    return true;
  }
  return false;
}

/** Miejsce budowniczego przy stosie desek. */
function builderRest(c: WorkCtx, b: Building, out: Vec3): Vec3 {
  const g = siteOf(b.kind);
  return c.at(c.origin(b), pileX(g) + 0.1, pileY(g, true), 0, out);
}

/** Mlotek zatkniety za pasek (gdy rece sa zajete). */
function belt(c: WorkCtx, f: RigFrames): void {
  if (c.details) c.propAt('tool_hammer', f.torso, 0.082, -0.1, 0.01, 0, 0, Math.PI - 0.15);
}

/** Poczatek czekania budowniczego bez materialu. */
const waitSince = new Map<number, number>();

/**
 * Budowniczy: przy stosie schyla sie po deske (na ramie) albo kamien (w obu rekach), niesie go pod przednia
 * podwaline, przyklada deske lewa reka i przybija mlotkiem (kamien kladzie i dobija na kleczkach), oglada
 * robote i wraca do stosu; po kazdej jednostce budynek rosnie. Bez materialu czeka przy stosie.
 */
function builder(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.BUILDER) return siteSteps(c, serf, at, builderRest);
  const b = c.s.buildings[serf.target];
  if (!b) return false;
  const o = c.origin(b);
  const g = siteOf(b.kind);
  const ph = buildPhase(c, b);
  const plank = ph.p >= 0 ? ph.plank : true;
  const px = pileX(g), py = pileY(g, plank);
  const pick = c.at(o, px + 0.1, py, 0, vA);
  pick.y = c.ground(pick.x, pick.z);
  const pileW = c.at(o, px, py, 0, vC);
  const toPile = c.facing(pick.x, pick.z, pileW.x, pileW.z);
  rememberSpot(serf.id, b.pos, pick.x, pick.z);
  if (ph.p < 0) {
    // Czeka na material (albo na kopacza): stoi przy stosie, rozglada sie, po chwili siada.
    let t0 = waitSince.get(serf.id);
    if (t0 === undefined) {
      t0 = c.time;
      waitSince.set(serf.id, t0);
      prune(waitSince, 500);
    }
    const idle = c.time - t0;
    const sit = ease(idle, IDLE_SIT, IDLE_SIT + SIT_TIME);
    const p = basePose(serf, pick.x, pick.y, pick.z, lerpAngle(c.facing(pick.x, pick.z, o.x, o.z), sitFacing(c, serf.id), sit));
    standIdle(c, p, serf.id, 1 - sit);
    if (sit > 0) sitPose(c, p, serf.id, sit, idle);
    belt(c, c.figure(p));
    return true;
  }
  waitSince.delete(serf.id);
  const p = ph.p;
  const wp = wallPlank(g, ph.n, vB);
  // Punkt deski w ukladzie modelu - vB zaraz nadpisze miejsce pracy w swiecie.
  const wpx = wp.x, wpy = wp.y, wpz = wp.z;
  const work = c.at(o, wpx, -g.hy - 0.085, 0, vB);
  const workX = work.x, workZ = work.z;
  const inward = c.frontRot + Math.PI;

  let x = pick.x, z = pick.z, rot = toPile;
  let walking = false, walk = 0;
  if (p >= BUILD.pick && p < BUILD.go) {
    const w = ease(p, BUILD.pick + 0.01, BUILD.go);
    x = lerp(pick.x, workX, w);
    z = lerp(pick.z, workZ, w);
    rot = lerpAngle(c.facing(pick.x, pick.z, workX, workZ), inward, ease(p, BUILD.go - 0.025, BUILD.go));
    walking = true;
    walk = w * TAU * 1.5;
  } else if (p >= BUILD.go && p < BUILD.look) {
    x = workX;
    z = workZ;
    rot = inward;
    // Ogladajac robote, cofa sie o pol kroku.
    if (p > BUILD.hammer) {
      const back = ease(p, BUILD.hammer, BUILD.hammer + 0.025) * 0.06;
      x -= Math.sin(inward) * back;
      z -= Math.cos(inward) * back;
    }
  } else if (p >= BUILD.look) {
    const w = ease(p, BUILD.look, 0.995);
    x = lerp(workX, pick.x, w);
    z = lerp(workZ, pick.z, w);
    rot = lerpAngle(c.facing(workX, workZ, pick.x, pick.z), toPile, ease(p, 0.975, 1));
    walking = true;
    walk = w * TAU * 1.5;
  }
  const pose = basePose(serf, x, c.ground(x, z), z, rot);
  pose.tool = undefined;
  if (walking) walkLegs(pose, walk);
  let carry: 'none' | 'shoulder' | 'hands' = 'none';
  if (p < BUILD.pick) {
    // Schyla sie po material i podnosi go (deske na prawe ramie).
    const k = Math.sin(clamp01(p / BUILD.pick) * Math.PI);
    bendPose(pose, k);
    pose.tool = null;
    if (p > BUILD.pick * 0.5) {
      carry = plank ? 'shoulder' : 'hands';
      if (plank) {
        const up = ease(p, BUILD.pick * 0.5, BUILD.pick);
        pose.armR = lerp(-0.6, -2.75, up);
        pose.armROut = 0.25 * up;
      }
    }
  } else if (p < BUILD.go) {
    pose.tool = null;
    carry = plank ? 'shoulder' : 'hands';
    if (plank) {
      pose.armR = -2.75;
      pose.armROut = 0.25;
      pose.armL = -Math.sin(walk) * 0.5;
    } else {
      pose.armL = -1.05;
      pose.armR = -1.05;
      pose.lean = -0.08;
    }
  } else if (p < BUILD.place) {
    // Przyklada deske do podwaliny albo kladzie kamien.
    const k = ease(p, BUILD.go, BUILD.place);
    pose.tool = null;
    carry = 'hands';
    if (plank) {
      const low = ph.n % 2 === 1;
      pose.armL = lerp(-1.0, low ? -0.9 : -1.35, k);
      pose.armR = lerp(-2.75, -1.2, k);
      pose.armROut = 0.25 * (1 - k);
      pose.crouch = low ? 0.06 * k : 0;
      pose.lean = (low ? 0.35 : 0.12) * k;
    } else {
      bendPose(pose, k);
      pose.crouch = 0.07 * k;
    }
  } else if (p < BUILD.hammer) {
    const bt = c.beat(plank ? 1.7 : 1.3, serf.id * 0.37);
    const up = c.strike(bt.f);
    if (plank) {
      // Lewa reka trzyma deske, prawa wbija gwozdzie.
      const low = ph.n % 2 === 1;
      pose.crouch = low ? 0.06 : 0;
      pose.lean = (low ? 0.35 : 0.12) - up * 0.05;
      pose.armL = low ? -0.9 : -1.35;
      pose.armLYaw = 0.35;
      pose.armR = (low ? -0.7 : -1.15) - up * 1.4;
      pose.armRYaw = -0.15;
      pose.headTurn = 0.15;
      pose.head = low ? 0.25 : 0.1;
    } else {
      // Kleczy przy podwalinie, przytrzymuje kamien i dobija go mlotkiem.
      pose.crouch = 0.08;
      pose.lean = 0.6;
      pose.armL = -0.55;
      pose.armLYaw = 0.3;
      pose.armR = -0.45 - up * 1.1;
      pose.head = 0.2;
    }
    const hit = c.at(o, wpx + 0.03, wpy - 0.01, plank ? wpz : 0.03, vC);
    c.fx.burst(serf.id * 31 + bt.n, bt.age, hit.x, hit.y, hit.z, {
      kind: 'bit', n: 3, life: 0.4, vy: 0.45, spread: 0.3, gravity: 2.6, size: 0.014, sizeEnd: 0.008,
      color: plank ? WOOD_CHIP : STONE_CHIP, floor: o.y + 0.005, sound: plank ? 'hammer_wood' : 'chisel',
    });
  } else if (p < BUILD.look) {
    // Oglada robote: glowa w gore, reka ociera czolo.
    const k = ease(p, BUILD.hammer, BUILD.hammer + 0.02) * (1 - ease(p, BUILD.look - 0.015, BUILD.look));
    pose.head = -0.35 * k;
    pose.armL = -2.6 * k;
    pose.armLOut = 0.35 * k;
    pose.armR = 0.1;
  }
  const f = c.figure(pose);
  if (pose.tool === null) belt(c, f);
  if (carry === 'shoulder') {
    c.propAt('ppl_plank', f.torso, 0.085, 0.385, 0.02, -0.12, Math.PI / 2, 0, 1);
  } else if (carry === 'hands') {
    const m = handsMid(f, vC);
    const k = p >= BUILD.go ? ease(p, BUILD.go, BUILD.place) : 0;
    if (plank) {
      // Z rak do podwaliny: deska obraca sie z osi postaci wzdluz sciany.
      const wall = c.at(o, wp.x, wp.y, wp.z, vA);
      c.prop('ppl_plank', lerp(m.x, wall.x, k), lerp(m.y - 0.02, wall.y, k), lerp(m.z, wall.z, k), lerpAngle(rot - Math.PI / 2, BROT_RAD, k), PLANK_S);
    } else {
      const wall = c.at(o, wp.x, wp.y - 0.01, 0, vA);
      c.good(G.STONE, lerp(m.x, wall.x, k), lerp(m.y - 0.04, wall.y, k), lerp(m.z, wall.z, k), lerpAngle(rot, BROT_RAD, k), UNIT_SCALE);
    }
  }
  return true;
}

/** Pierwsze pole placu jeszcze niewyrownane (jak w sim/construction.ts: pole budynku i 6 sasiadow) albo -1. */
function levelTarget(s: GameState, b: Building): number {
  const h = s.map.height;
  if (h[b.pos] !== b.levelHeight) return b.pos;
  const t = nb(s.map);
  for (let d = 0; d < 6; d++) {
    const j = t[b.pos * 6 + d];
    if (j >= 0 && h[j] !== b.levelHeight) return j;
  }
  return -1;
}

/** Strona, z ktorej kopacz pracuje przy polu (wg budynku - kopczyki ziemi leza po tej samej stronie). */
function digTurn(b: Building): number {
  return b.id % 2 ? 1.45 : -1.45;
}

/** Wysokosc podloza: na placu plyta ubitej ziemi z modelu site_*, poza nim teren. */
function siteFloor(c: WorkCtx, b: Building, x: number, z: number): number {
  const o = c.origin(b);
  const dx = (x - o.x) / o.sc, dz = (z - o.z) / o.sc;
  const lx = dx * COS30 - dz * SIN30, ly = -dx * SIN30 - dz * COS30;
  const g = siteOf(b.kind);
  const gr = c.ground(x, z);
  const inside = Math.abs(lx) < g.hx / 0.42 * 0.49 && Math.abs(ly) < g.hy / 0.36 * 0.43;
  return inside ? Math.max(gr, o.y + 0.012 * o.sc) : gr;
}
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);
/** Odleglosc kopacza i kopczyka odrzuconej ziemi od srodka pola. */
const DIG_R = 0.17;
const HEAP_R = 0.46;
/** Ruchy lopata na jedno obnizenie/podniesienie pola (LEVEL_TICKS). */
const DIG_STROKES = 3;
/** Ile razy wyrownywano pole (zdarzenia 'height'): rozmiar kopczyka ziemi obok niego. */
const dugCells = new Map<number, number>();
/** Kopacz: pole, przy ktorym pracuje, jego miejsce, punkt, z ktorego przyszedl (przejscie miedzy polami), i chwila przyjscia. */
const digSpot = new Map<number, { cell: number; x: number; z: number; fx: number; fz: number; moving: boolean; t0: number }>();

/** Miejsce kopacza przy polu wyrownywanym jako pierwsze. */
function diggerSpot(c: WorkCtx, b: Building, out: Vec3): Vec3 {
  const cell = levelTarget(c.s, b);
  const ct = c.cell(cell >= 0 ? cell : b.pos, out);
  const st = c.beside(ct.x, ct.z, DIG_R, digTurn(b));
  out.x = st.x;
  out.y = st.y;
  out.z = st.z;
  return out;
}

/**
 * Kopacz: na kazdy poziom wyrownywanego pola trzy ruchy lopata - wbija ja w ziemie, podwaza, skreca sie
 * i odrzuca ziemie za siebie przez prawe ramie (grudki spadaja na kopczyk). Miedzy polami przechodzi.
 */
function digger(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.DIGGER) return siteSteps(c, serf, at, diggerSpot);
  const s = c.s;
  const b = s.buildings[serf.target];
  if (!b) return false;
  const cell = levelTarget(s, b);
  const ct = c.cell(cell >= 0 ? cell : b.pos, vA);
  const st = c.beside(ct.x, ct.z, DIG_R, digTurn(b));
  const p = clamp01((serf.timer + c.alpha) / LEVEL_TICKS);
  let mem = digSpot.get(serf.id);
  if (!mem) {
    mem = { cell, x: st.x, z: st.z, fx: st.x, fz: st.z, moving: false, t0: c.time };
    digSpot.set(serf.id, mem);
    prune(digSpot, 500);
  }
  if (mem.cell !== cell) {
    mem.fx = mem.x;
    mem.fz = mem.z;
    mem.cell = cell;
    mem.moving = true;
  }
  mem.x = st.x;
  mem.z = st.z;
  rememberSpot(serf.id, b.pos, st.x, st.z);
  const k = Math.min(DIG_STROKES - 1, Math.floor(p * DIG_STROKES));
  const sf = p * DIG_STROKES - k;
  if (mem.moving && k > 0) mem.moving = false;
  if (mem.moving) {
    // Przejscie do nastepnego pola z lopata na ramieniu.
    const w = ease(sf, 0.05, 0.85);
    const x = lerp(mem.fx, st.x, w), z = lerp(mem.fz, st.z, w);
    const pose = basePose(serf, x, siteFloor(c, b, x, z), z, lerpAngle(c.facing(mem.fx, mem.fz, st.x, st.z), st.rot, ease(sf, 0.8, 1)));
    pose.tool = undefined;
    walkLegs(pose, w * TAU * 1.5, w > 0 && w < 1 ? 1 : 0);
    pose.armR = -2.5;
    pose.armROut = 0.15;
    pose.armL = -Math.sin(w * TAU * 1.5) * 0.4;
    c.figure(pose);
    return true;
  }
  const pose = basePose(serf, st.x, siteFloor(c, b, st.x, st.z), st.z, st.rot);
  // Wbicie (0-0.25), podwazenie (0.25-0.45), zamach i rzut za siebie (0.45-0.6), powrot.
  const thrust = ease(sf, 0.02, 0.22) * (1 - ease(sf, 0.25, 0.42));
  const lift = ease(sf, 0.25, 0.42) * (1 - ease(sf, 0.47, 0.6));
  const thr = ease(sf, 0.45, 0.6) * (1 - ease(sf, 0.66, 0.95));
  // Po dojsciu na plac pochyla sie do pierwszego ruchu stopniowo.
  const settle = ease(c.time - mem.t0, 0, 0.5);
  pose.lean = (0.25 + thrust * 0.2 - lift * 0.15 - thr * 0.3) * settle;
  pose.legR = -0.35 * thrust;
  pose.legL = 0.1 * thrust;
  pose.armR = -0.42 + thrust * 0.12 - lift * 0.6 - thr * 1.9;
  pose.armL = -0.75 + thrust * 0.1 - lift * 0.45 - thr * 1.15;
  pose.armLYaw = 0.5 - thr * 0.2;
  pose.armRYaw = -thr * 0.35;
  pose.twist = -thr * 1.0;
  pose.head = 0.3 - thr * 0.35;
  pose.headTurn = thr * 0.5;
  pose.tool = null;
  const f = c.figure(pose);
  c.propAt('ppl_dig_shovel', f.armR, 0, 0, 0);
  // Ziemia na lopacie przy podwazaniu i zamachu.
  if (sf > 0.27 && sf < 0.59) {
    Rig.point(f.armR, 0, HAND - 0.215, 0.02, hR);
    c.prop('ppl_heap', hR.x, hR.y - 0.01, hR.z, pose.rot, 0.32);
  }
  // Rzut: grudki leca za plecy kopacza i spadaja na kopczyk.
  const age = (sf - 0.58) * (LEVEL_TICKS / 5 / DIG_STROKES);
  if (age > 0) {
    Rig.point(f.armR, 0, HAND - 0.215, 0.02, hR);
    const back = st.rot + Math.PI;
    c.fx.burst(serf.id * 53 + k + serf.pos * 7, age, hR.x, hR.y, hR.z, {
      kind: 'bit', n: 6, life: 0.8, vx: Math.sin(back) * 0.5, vz: Math.cos(back) * 0.5, vy: 0.35, spread: 0.12,
      gravity: 2.6, size: 0.026, sizeEnd: 0.02, color: EARTH, floor: siteFloor(c, b, st.x - Math.sin(st.rot) * 0.3, st.z - Math.cos(st.rot) * 0.3) + 0.008,
      sound: 'dirt',
    });
  }
  return true;
}

/**
 * Plac budowy: stos desek i kamieni (bez tych, ktore niesie budowniczy), deska przybijana do podwaliny,
 * kopczyki ziemi przy wyrownanych polach.
 */
function site(c: WorkCtx, b: Building, o: Origin): void {
  const g = siteOf(b.kind);
  const ph = buildPhase(c, b);
  const taken = ph.p >= BUILD.pick * 0.5 ? 1 : 0;
  const planks = b.planks - (ph.p >= 0 && ph.plank ? taken : 0);
  const stones = b.stones - (ph.p >= 0 && !ph.plank ? taken : 0);
  const px = pileX(g);
  // Deski w stosie na krzyz po dwie, kamienie w piramidke.
  const fr = c.frameOf(o);
  for (let i = 0; i < Math.min(planks, 8); i++) {
    const layer = i >> 1, side = i & 1;
    const along = layer % 2 === 0;
    const off = (side - 0.5) * 0.05;
    c.propAt('ppl_plank', fr, px + (along ? 0 : off), 0.004 + layer * 0.011, -(pileY(g, true) + (along ? off : 0)),
      0, along ? Math.PI / 2 : 0, 0, PLANK_S / o.sc);
  }
  const sy = pileY(g, false);
  for (let i = 0; i < Math.min(stones, 7); i++) {
    const row = i < 4 ? 0 : i < 6 ? 1 : 2;
    const k = row === 0 ? i : row === 1 ? i - 4 : 0;
    const lx = px + (row < 2 ? ((k % 2) - 0.5) * 0.075 : 0);
    const ly = sy + (row === 0 ? (Math.floor(k / 2) - 0.5) * 0.065 : 0);
    const pt = c.at(o, lx, ly, row * 0.045, vA);
    c.good(G.STONE, pt.x, pt.y, pt.z, BROT_RAD + i * 0.3, 1);
  }
  // Przybijana deska (do konca jednostki - potem budynek urosl) albo kamien przy podwalinie.
  if (ph.p >= BUILD.place) {
    const wp = wallPlank(g, ph.n, vB);
    if (ph.plank) {
      const w = c.at(o, wp.x, wp.y, wp.z, vA);
      c.prop('ppl_plank', w.x, w.y, w.z, BROT_RAD, PLANK_S);
    } else {
      const w = c.at(o, wp.x, wp.y - 0.01, 0, vA);
      c.good(G.STONE, w.x, w.y, w.z, BROT_RAD, UNIT_SCALE);
    }
  }
  // Kopczyki ziemi obok wyrownanych pol (i pola, ktore kopacz wlasnie wyrownuje).
  if (b.levelHeight < 0) return;
  const t = nb(c.s.map);
  const cur = levelTarget(c.s, b);
  const dg = b.digger >= 0 ? c.s.serfs[b.digger] : null;
  const digP = dg && dg.state === SS.DIGGER ? clamp01((dg.timer + c.alpha) / LEVEL_TICKS) : 0;
  for (let d = -1; d < 6; d++) {
    const cell = d < 0 ? b.pos : t[b.pos * 6 + d];
    if (cell < 0) continue;
    const n = (dugCells.get(cell) ?? 0) + (cell === cur ? digP : 0);
    if (n <= 0) continue;
    const ct = c.cell(cell, vA);
    const hp = c.beside(ct.x, ct.z, HEAP_R, digTurn(b));
    c.prop('ppl_heap', hp.x, siteFloor(c, b, hp.x, hp.z), hp.z, cell * 1.7, Math.min(2.4, 1.0 + n * 0.45), Math.min(2.2, 0.8 + n * 0.45));
  }
}

/** Zdarzenia 'height' (kopacz wyrownal pole o jeden poziom): kopczyki ziemi. */
function constructionEvents(ev: readonly GameEvent[]): void {
  for (const e of ev) {
    if (e.type !== 'height') continue;
    dugCells.set(e.pos, (dugCells.get(e.pos) ?? 0) + 1);
    prune(dugCells, 3000);
  }
}

// ---------------------------------------------------------------- geolog

const ROCK_CHIP = 0x9a968f;
const SPARK = 0xffd27a;
/** Etapy badania pola (postep odliczania GEO_TICKS 0..1). */
const GEO = { kneel: 0.06, tap: 0.4, listen: 0.62, take: 0.7, plant: 0.76, drive: 0.95 } as const;
/** Gdzie geolog kleczal przy ostatnim badanym polu (pamiec klienta, do plynnego odejscia). */
const geoSpot = new Map<number, { cell: number; x: number; z: number }>();
/** Pole i czas znalezienia zloza (zdarzenie 'found'): geolog, odchodzac, unosi mlotek. */
const foundAt = new Map<number, number>();

/** Punkt i obrot znaku na polu (jak obiekt O.SIGN w mapObjects.ts) - znak geologa stoi tam, gdzie potem obiekt mapy. */
function signSpot(c: WorkCtx, cell: number, out: Vec3): number {
  const sp = objectSpot(c.s.map, cell);
  out.x = sp.x;
  out.y = sp.y;
  out.z = sp.z;
  return sp.rot;
}

/** Wiazka znakow na plecach (gdy zostaly jakies do postawienia). */
function stakesOnBack(c: WorkCtx, serf: Serf, f: RigFrames): void {
  const left = serf.sub === 3 ? 0 : GEO_PROBES - Math.max(0, serf.road);
  if (left > 0 && c.details) c.propAt('ppl_stakes', f.torso, 0, 0, 0, 0, 0, 0, 1);
}

/**
 * Geolog: na badanym polu kleka, stuka mlotkiem w skale (odpryski, iskierki), przyklada ucho do ziemi
 * i nasluchuje, potem wyciaga znak z wiazki na plecach, wbija go w ziemie i dobija mlotkiem od gory
 * (znak z kazdym uderzeniem siedzi glebiej); na koncu staje i oglada go. Po znalezieniu zloza
 * odchodzi z mlotkiem uniesionym w gore.
 */
function geologist(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.GEOLOGIST) return false;
  const turn = serf.id % 2 ? 1.35 : -1.35;
  if (serf.sub !== 2 || at.to >= 0) {
    const pose = c.walkPose(serf, at);
    // Krok z miejsca, gdzie kleczal przy znaku, i ostatni krok do badanego pola - prosto na miejsce pracy.
    if (at.to >= 0) {
      const mem = geoSpot.get(serf.id);
      const from = c.cell(at.from, vA);
      const to = c.cell(at.to, vB);
      let fx = from.x, fz = from.z, tx = to.x, tz = to.z;
      if (mem && mem.cell === at.from) {
        fx = mem.x;
        fz = mem.z;
      }
      if (serf.sub === 1 && serf.path.length === 0) {
        signSpot(c, at.to, vC);
        const ws = c.beside(vC.x, vC.z, 0.17, turn);
        tx = ws.x;
        tz = ws.z;
      }
      pose.x = lerp(fx, tx, at.t);
      pose.z = lerp(fz, tz, at.t);
      pose.y = c.ground(pose.x, pose.z);
      pose.rot = Math.atan2(tx - fx, tz - fz);
    }
    const t0 = foundAt.get(serf.pos);
    const cheer = t0 !== undefined && at.to >= 0 ? 1 - ease(c.time - t0, 1.6, 2.2) : 0;
    if (cheer > 0) {
      pose.armR = lerp(pose.armR ?? 0, -2.95 + Math.sin(c.time * 9) * 0.15, cheer);
      pose.head = -0.25 * cheer;
    }
    stakesOnBack(c, serf, c.figure(pose));
    return true;
  }
  const signRot = signSpot(c, serf.pos, vA);
  const st = c.beside(vA.x, vA.z, 0.17, turn);
  let mem = geoSpot.get(serf.id);
  if (!mem) {
    mem = { cell: serf.pos, x: st.x, z: st.z };
    geoSpot.set(serf.id, mem);
    prune(geoSpot, 200);
  }
  mem.cell = serf.pos;
  mem.x = st.x;
  mem.z = st.z;
  const p = c.progress(serf.timer, GEO_TICKS);
  const pose = basePose(serf, st.x, st.y, st.z, st.rot);
  pose.tool = undefined;
  let sign = -1;
  if (p < GEO.listen) {
    // Kleczy: stuka mlotkiem w skale, potem przyklada ucho do ziemi.
    const k = ease(p, 0, GEO.kneel) * (1 - ease(p, GEO.listen - 0.01, GEO.listen + 0.04));
    pose.crouch = 0.085 * k;
    pose.lean = 0.45 * k;
    pose.head = 0.35 * k;
    pose.armL = -0.5 * k;
    pose.armLOut = 0.15 * k;
    if (p >= GEO.kneel && p < GEO.tap) {
      const bt = c.beat(2.2, serf.id * 0.41);
      const up = c.strike(bt.f);
      pose.armR = -0.2 - up * 1.4;
      pose.armRYaw = 0.1;
      stakesOnBack(c, serf, c.figure(pose));
      // Odpryski skaly w miejscu uderzenia (przy ziemi przed geologiem), co drugie z iskierkami.
      const gx = st.x + Math.sin(st.rot) * 0.18, gz = st.z + Math.cos(st.rot) * 0.18;
      const gy = c.ground(gx, gz);
      c.fx.burst(serf.id * 37 + bt.n, bt.age, gx, gy + 0.01, gz, {
        kind: 'bit', n: 4, life: 0.45, vy: 0.5, spread: 0.3, gravity: 2.6, size: 0.014, sizeEnd: 0.008,
        color: ROCK_CHIP, floor: gy + 0.003, sound: 'pick_stone', soundGain: 0.8,
      });
      if (bt.n % 2 === 0) {
        c.fx.burst(serf.id * 41 + bt.n, bt.age, gx, gy + 0.02, gz, {
          kind: 'bit', n: 3, life: 0.18, vy: 0.4, spread: 0.45, gravity: 1, size: 0.009, sizeEnd: 0.002, color: SPARK,
        });
      }
      return true;
    }
    if (p >= GEO.tap) {
      // Ucho przy ziemi: tulow nisko, glowa obrocona bokiem, rece oparte o ziemie.
      const l = ease(p, GEO.tap, GEO.tap + 0.05) * (1 - ease(p, GEO.listen - 0.02, GEO.listen + 0.03));
      pose.lean = lerp(pose.lean, 1.3, l);
      pose.headTurn = 1.45 * l;
      pose.head = lerp(pose.head ?? 0, 0.1, l);
      pose.armL = lerp(pose.armL ?? 0, -0.35, l);
      pose.armR = lerp(-0.55, -0.35, l);
      pose.armLOut = lerp(pose.armLOut ?? 0, 0.5, l);
      pose.armROut = 0.5 * l;
    } else {
      pose.armR = -0.55 * k;
    }
  } else if (p < GEO.plant) {
    // Wstaje i siega lewa reka za plecy po znak.
    const k = ease(p, GEO.listen + 0.02, GEO.take);
    pose.armL = lerp(0, -2.9, k);
    pose.armLOut = 0.35 * k;
    pose.armLYaw = 0.6 * k;
    pose.head = -0.1 * k;
    if (p >= GEO.take) {
      const d = ease(p, GEO.take, GEO.plant);
      pose.armL = lerp(-2.9, -1.0, d);
      pose.armLOut = lerp(0.35, 0.05, d);
      pose.armLYaw = lerp(0.6, 0.3, d);
      pose.head = 0.2 * d;
      sign = 0.16 - d * 0.04;
    }
  } else if (p < GEO.drive) {
    // Dobija znak mlotkiem od gory: z kazdym uderzeniem znak siedzi glebiej.
    const n = 4;
    const q = (p - GEO.plant) / (GEO.drive - GEO.plant) * n;
    const f = q - Math.floor(q);
    const up = f < 0.65 ? Math.sin((f / 0.65) * Math.PI / 2) : Math.cos(((f - 0.65) / 0.35) * Math.PI / 2);
    const hits = Math.floor(q + 0.35);
    sign = 0.12 * (1 - Math.min(n, hits) / n);
    pose.armL = -1.15;
    pose.armLYaw = 0.3;
    pose.armR = -2.1 - up * 0.8;
    pose.armROut = 0.1;
    pose.armRYaw = 0.25;
    pose.head = -0.15;
    pose.lean = -0.05;
    const age = (f - 0.98 + 1) % 1;
    if (f > 0.97 || f < 0.25) {
      c.fx.burst(serf.id * 43 + hits, age * 0.45, vA.x, vA.y + 0.45 + sign, vA.z, {
        kind: 'bit', n: 3, life: 0.3, vy: 0.35, spread: 0.3, gravity: 2.2, size: 0.01, sizeEnd: 0.006, color: WOOD_CHIP, sound: 'hammer_wood',
      });
    }
  } else {
    // Oglada wbity znak.
    pose.head = 0.15;
    pose.armR = 0.05;
    pose.armL = 0.05;
    sign = 0;
  }
  const f = c.figure(pose);
  stakesOnBack(c, serf, f);
  if (sign >= 0) c.prop('sign', vA.x, vA.y + sign, vA.z, signRot, 1);
  return true;
}

// ---------------------------------------------------------------- rycerze

/** Odleglosc walczacych od srodka pola (stoja na jednym polu, bokiem do kamery). */
const DUEL_R = 0.14;
/** Czas trwania rundy pojedynku w sekundach czasu gry. */
const ROUND_S = ROUND_TICKS / TICKS_PER_SECOND;
/** Uderzenia w rundzie (ulamek rundy): atakujacy, obronca. */
const STRIKE_A = 0.48;
const STRIKE_D = 0.93;
/** Po smierci: upadek (s), lezenie, zapadanie sie w ziemie. */
const FALL_S = 1.1;
const LIE_S = 3.2;
const SINK_S = 1.2;
/** Zwyciezca unosi miecz przez tyle sekund po smierci przeciwnika. */
const CHEER_S = 2.4;
const SPARK_HIT = 0xfff0b0;

/** Ostatnio narysowany rycerz (pamiec klienta): pole, polozenie, wyglad - do upadku po zdarzeniu 'death'. */
interface KnightMem {
  cell: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  owner: number;
  level: number;
  t: number;
  hp: number;
  hit: number;
  /** Poczatek biezacego kroku: pole i punkt (ustalane raz na krok - w polowie kroku m.x to juz biezace polozenie). */
  stepCell: number;
  sx: number;
  sz: number;
}
const knightMem = new Map<number, KnightMem>();
/** Padajacy rycerze (po zdarzeniu 'death'). */
const fallen: { x: number; y: number; z: number; rot: number; owner: number; level: number; t: number }[] = [];
/** Pole i czas ostatniej smierci w pojedynku (zwyciezca unosi miecz). */
const deathAt = new Map<number, number>();

/** Rycerz w pozie p: helm, miecz i tarcza w kolorze gracza (guard: 0 przy boku - 1 przed piersia). */
function knightFigure(c: WorkCtx, p: Pose, guard: number): RigFrames {
  p.type = -1;
  p.tool = null;
  p.hat = false;
  const f = c.figure(p);
  c.propAt('knight_helmet', f.head, 0, 0, 0);
  const g = clamp01(guard);
  const sx = lerp(-0.108, -0.03, g), sy = lerp(0.17, 0.245, g), sz = lerp(0.0, 0.11, g);
  const ry = lerp(-Math.PI / 2, 0.25, g);
  c.propAt('ppl_shield', f.torso, sx, sy, sz, 0, ry, 0, 1, c.playerColor(p.owner));
  c.propAt('ppl_shield_rim', f.torso, sx, sy, sz, 0, ry, 0, 1);
  c.propAt('knight_sword', f.armR, 0, 0, 0);
  return f;
}

/** Lewa reka przy tarczy (g = 0..1 jak w knightFigure). */
function shieldArm(p: Pose, g: number): void {
  p.armL = lerp(p.armL ?? 0, -1.25, g);
  p.armLYaw = lerp(p.armLYaw ?? 0, 0.55, g);
  p.armLOut = lerp(p.armLOut ?? 0, 0.1, g);
}

function rememberKnight(serf: Serf, p: Pose, c: WorkCtx): void {
  let m = knightMem.get(serf.id);
  if (!m) {
    m = { cell: serf.pos, x: 0, y: 0, z: 0, rot: 0, owner: serf.owner, level: serf.level, t: 0, hp: serf.hp, hit: -10, stepCell: -1, sx: 0, sz: 0 };
    knightMem.set(serf.id, m);
    prune(knightMem, 600);
  }
  m.cell = serf.pos;
  m.x = p.x;
  m.y = p.y;
  m.z = p.z;
  m.rot = p.rot;
  m.owner = serf.owner;
  m.level = serf.level;
  m.t = c.time;
}

/** Os pojedynku: kierunek w poprzek widoku (walczacy stoja bokiem do kamery). */
const axis = { ux: 0, uz: 0 };
function duelAxis(c: WorkCtx): typeof axis {
  axis.ux = Math.cos(c.toCamera);
  axis.uz = -Math.sin(c.toCamera);
  return axis;
}

/** Miejsce rycerza przy pojedynku na polu cell: atakujacy po jednej stronie, obronca po drugiej. */
function duelSpot(c: WorkCtx, cell: number, attacker: boolean, out: Vec3): Vec3 {
  const ct = c.cell(cell, out);
  const { ux, uz } = duelAxis(c);
  const k = attacker ? DUEL_R : -DUEL_R;
  out.x = ct.x + ux * k;
  out.z = ct.z + uz * k;
  out.y = c.ground(out.x, out.z);
  return out;
}

/** Zamach i ciecie mieczem: wind = 0..1 zamach (miecz w gorze za glowa), cut = 0..1 ciecie (z gory w przod, na tarcze). */
function swordSwing(p: Pose, wind: number, cut: number): void {
  p.armR = lerp(-0.9 - 1.9 * wind, -0.7, cut);
  p.armROut = 0.15 + wind * 0.15 - cut * 0.1;
  p.armRYaw = -0.2 * wind + 0.35 * cut;
  p.twist = 0.35 * wind - 0.45 * cut;
  p.lean = -0.1 * wind + 0.3 * cut;
  p.legL = -0.2 - 0.12 * cut;
  p.legR = 0.15 + 0.1 * cut;
}

/**
 * Pojedynek: rycerze stoja naprzeciw siebie bokiem do kamery. W kazdej rundzie atakujacy bierze zamach
 * i tnie, obronca zastawia sie tarcza (iskry), potem obronca tnie, a atakujacy sie zastawia. Trafiony
 * (spadek punktow zycia) zatacza sie do tylu.
 */
function duel(c: WorkCtx, serf: Serf, attacker: boolean): void {
  const s = c.s;
  const opp = s.serfs[serf.sub];
  const a = attacker ? serf : opp;
  const spot = duelSpot(c, serf.pos, attacker, vA);
  const { ux, uz } = duelAxis(c);
  const rot = Math.atan2(attacker ? -ux : ux, attacker ? -uz : uz);
  // Faza rundy z zegara atakujacego (6, 5, ... 1, 6, ...).
  const f = a ? clamp01((ROUND_TICKS - a.timer + c.alpha) / ROUND_TICKS) : 0;
  const p = basePose(serf, spot.x, spot.y, spot.z, rot);
  p.legLOut = 0.12;
  p.legROut = 0.1;
  let guard: number;
  let strikeAt: number;
  if (attacker) {
    const wind = ease(f, 0.06, 0.36) * (1 - ease(f, 0.38, 0.47));
    const cut = ease(f, 0.38, STRIKE_A) * (1 - ease(f, 0.55, 0.75));
    swordSwing(p, wind, cut);
    guard = 0.45 + 0.55 * ease(f, 0.68, 0.82);
    strikeAt = STRIKE_A;
  } else {
    const wind = ease(f, 0.56, 0.84) * (1 - ease(f, 0.86, 0.92));
    const cut = ease(f, 0.86, STRIKE_D) * (1 - ease(f, 0.95, 1));
    swordSwing(p, wind, cut);
    guard = 0.45 + 0.55 * ease(f, 0.25, 0.38) * (1 - ease(f, 0.55, 0.65));
    strikeAt = STRIKE_D;
  }
  // Trafiony: zatacza sie do tylu (pamiec punktow zycia).
  let mem = knightMem.get(serf.id);
  if (mem && serf.hp < mem.hp) mem.hit = c.time;
  const hitAge = mem ? c.time - mem.hit : 99;
  if (hitAge < 0.5) {
    const k = Math.sin(clamp01(hitAge / 0.5) * Math.PI);
    p.lean = (p.lean ?? 0) - 0.25 * k;
    p.head = -0.25 * k;
    p.x -= Math.sin(rot) * 0.035 * k;
    p.z -= Math.cos(rot) * 0.035 * k;
    guard *= 1 - k;
  }
  shieldArm(p, guard);
  // Lekkie kolysanie na ugietych nogach.
  p.bob = Math.abs(Math.sin(c.time * 5 + serf.id)) * 0.006;
  knightFigure(c, p, guard);
  rememberKnight(serf, p, c);
  mem = knightMem.get(serf.id)!;
  mem.hp = serf.hp;
  // Iskry przy zderzeniu miecza z tarcza przeciwnika.
  const age = (f - strikeAt) * ROUND_S;
  if (age >= 0 && age < 0.3) {
    const hx = spot.x + Math.sin(rot) * DUEL_R * 1.1, hz = spot.z + Math.cos(rot) * DUEL_R * 1.1;
    const tick0 = c.s.tick - (a ? ROUND_TICKS - a.timer : 0);
    c.fx.burst(serf.id * 89 + tick0, age, hx, spot.y + 0.2, hz, {
      kind: 'bit', n: 5, life: 0.25, vy: 0.5, spread: 0.6, gravity: 2, size: 0.012, sizeEnd: 0.003, color: SPARK_HIT, sound: 'clash', soundGain: 0.8,
    });
  }
}

/** Rycerz w marszu albo stojacy: tarcza, miecz i zwyciestwo (miecz w gorze po smierci przeciwnika obok). */
function knight(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  const s = c.s;
  if (at.to < 0) {
    const m = knightMem.get(serf.id);
    if (m) m.stepCell = -1;
  }
  if (serf.state === SS.KNIGHT_FIGHT) {
    const opp = s.serfs[serf.sub];
    if (opp && opp.state === SS.KNIGHT_FIGHT) {
      duel(c, serf, serf.home !== serf.target);
      return true;
    }
  }
  const p = c.walkPose(serf, at);
  let guard = 0;
  // Pole pojedynku: atakujacy czeka z boku pola (tam bedzie walczyl), obronca dochodzi na swoje miejsce.
  if (at.to >= 0) {
    const mem = knightMem.get(serf.id);
    const from = c.cell(at.from, vB);
    const to = c.cell(at.to, vC);
    let ax = from.x, az = from.z, bx = to.x, bz = to.z;
    if (mem) {
      // Krok zaczyna sie tam, gdzie rycerz stal (np. z boku pola po pojedynku), jesli to na polu startu.
      if (mem.stepCell !== at.from) {
        const here = mem.cell === at.from && Math.hypot(mem.x - from.x, mem.z - from.z) < 0.3;
        mem.stepCell = at.from;
        mem.sx = here ? mem.x : from.x;
        mem.sz = here ? mem.z : from.z;
      }
      ax = mem.sx;
      az = mem.sz;
    }
    if (serf.path.length === 0 && serf.state === SS.KNIGHT_ATTACK && serf.sub !== -3) {
      duelSpot(c, at.to, true, vC);
      bx = vC.x;
      bz = vC.z;
    } else if (serf.path.length === 0 && serf.state === SS.KNIGHT_DEFEND && serf.sub >= 0) {
      duelSpot(c, at.to, false, vC);
      bx = vC.x;
      bz = vC.z;
    }
    p.x = lerp(ax, bx, at.t);
    p.z = lerp(az, bz, at.t);
    p.y = c.ground(p.x, p.z);
    p.rot = Math.atan2(bx - ax, bz - az);
  } else if (serf.state === SS.KNIGHT_WAIT) {
    // Czeka na obronce z boku pola, przodem do miejsca, w ktorym stanie obronca.
    duelSpot(c, serf.pos, true, vB);
    p.x = vB.x;
    p.y = vB.y;
    p.z = vB.z;
    const { ux, uz } = duelAxis(c);
    p.rot = Math.atan2(-ux, -uz);
    p.legLOut = 0.1;
    p.legROut = 0.1;
    p.legL = -0.15;
    p.legR = 0.12;
    p.armR = -0.95 + Math.sin(c.time * 2 + serf.id) * 0.08;
    p.armROut = 0.15;
    p.bob = Math.abs(Math.sin(c.time * 3 + serf.id)) * 0.006;
    guard = 0.55;
  }
  const marching = at.to >= 0 && (serf.state === SS.KNIGHT_ATTACK || (serf.state === SS.KNIGHT_DEFEND && serf.sub >= 0));
  if (marching) {
    // Do walki: tarcza wysunieta, miecz gotowy.
    guard = 0.4;
    p.armR = -0.75 + Math.sin(at.walk) * 0.15;
    p.armROut = 0.12;
  } else if (at.to >= 0) {
    p.armR = (p.armR ?? 0) * 0.6;
  }
  // Zwyciestwo: przeciwnik wlasnie padl na tym polu.
  const dt = deathAt.get(serf.pos) ?? deathAt.get(at.from);
  const cheer = dt !== undefined ? 1 - ease(c.time - dt, CHEER_S - 0.5, CHEER_S) : 0;
  if (cheer > 0 && (serf.state === SS.KNIGHT_WAIT || serf.state === SS.KNIGHT_DEFEND)) {
    const k = cheer * ease(c.time - (dt ?? 0), 0.1, 0.45);
    p.armR = lerp(p.armR ?? 0, -3.05 + Math.sin(c.time * 7) * 0.1, k);
    p.armROut = lerp(p.armROut ?? 0, 0.2, k);
    p.head = -0.25 * k;
    p.lean = -0.08 * k;
    guard *= 1 - k;
    p.bob = (p.bob ?? 0) + Math.abs(Math.sin(c.time * 6)) * 0.012 * k;
  }
  shieldArm(p, guard);
  knightFigure(c, p, guard);
  rememberKnight(serf, p, c);
  const mem = knightMem.get(serf.id);
  if (mem) mem.hp = serf.hp;
  return true;
}

/** Zdarzenia rycerzy: atak (alarm wartownikow celu), smierc w pojedynku (padajacy rycerz, zwyciezca unosi miecz). */
function knightEvents(c: WorkCtx, ev: readonly GameEvent[]): void {
  for (const e of ev) {
    if (e.type === 'attack') {
      alarmAt.set(e.pos, c.time);
      prune(alarmAt, 200);
      continue;
    }
    if (e.type !== 'death') continue;
    // Ginacy rycerz zniknal juz ze stanu: jego ostatnie polozenie z pamieci (na tym polu, tego wlasciciela).
    let best: KnightMem | null = null;
    let bestId = -1;
    for (const [id, m] of knightMem) {
      if (m.cell !== e.pos || m.owner !== e.player || c.time - m.t > 0.6) continue;
      if (c.s.serfs[id]) continue;
      if (!best || m.t > best.t) {
        best = m;
        bestId = id;
      }
    }
    if (!best) continue;
    knightMem.delete(bestId);
    fallen.push({ x: best.x, y: best.y, z: best.z, rot: best.rot, owner: best.owner, level: best.level, t: c.time });
    deathAt.set(e.pos, c.time);
    prune(deathAt, 200);
  }
}

/** Padajacy rycerz: zatacza sie, pada na plecy (miecz i tarcza obok), lezy, zapada sie w ziemie. */
function drawFallen(c: WorkCtx): void {
  for (let i = fallen.length - 1; i >= 0; i--) {
    const d = fallen[i];
    const age = c.time - d.t;
    if (age > FALL_S + LIE_S + SINK_S || age < 0) {
      fallen.splice(i, 1);
      continue;
    }
    if (!c.inView(d.x, d.z)) continue;
    const buckle = ease(age, 0, 0.45);
    const fall = ease(age, 0.35, FALL_S);
    const sink = ease(age, FALL_S + LIE_S, FALL_S + LIE_S + SINK_S);
    const back = 0.06 * buckle + 0.08 * fall;
    const p: Pose = {
      x: d.x - Math.sin(d.rot) * back, y: d.y - (HIP - 0.035) * UNIT_SCALE * fall - sink * 0.14, z: d.z - Math.cos(d.rot) * back,
      rot: d.rot, owner: d.owner, type: -1,
    };
    p.crouch = 0.07 * buckle * (1 - fall);
    p.lean = -0.35 * buckle * (1 - fall) - 1.5 * fall;
    p.legL = -1.45 * fall;
    p.legR = -1.35 * fall;
    p.legLOut = 0.15 * fall;
    p.legROut = 0.2 * fall;
    p.armL = lerp(-0.4 * buckle, 0.4, fall);
    p.armR = lerp(-1.6 * buckle, 0.2, fall);
    p.armLOut = 1.1 * fall;
    p.armROut = 1.2 * fall;
    p.head = -0.4 * buckle * (1 - fall) - 0.2 * fall;
    p.hat = false;
    p.tool = null;
    const f = c.figure(p);
    c.propAt('knight_helmet', f.head, 0, 0, 0);
    if (age < 0.5) c.propAt('knight_sword', f.armR, 0, 0, 0);
    else {
      // Miecz i tarcza leza obok: miecz przy prawej rece, tarcza przy lewej (cialo lezy glowa do tylu).
      const bx = -Math.sin(d.rot) * 0.2, bz = -Math.cos(d.rot) * 0.2;
      const sx = d.x + bx + Math.cos(d.rot) * 0.15, sz = d.z + bz - Math.sin(d.rot) * 0.15;
      const gy = c.ground(sx, sz) - sink * 0.14;
      mFlat.makeTranslation(sx, gy, sz).multiply(mTmp.makeRotationY(d.rot + 0.5));
      c.goodAt(G.SWORD, mFlat, 0, 0.01, -0.12, Math.PI / 2, 0, 0, 1.1);
      const hx = d.x + bx * 0.5 - Math.cos(d.rot) * 0.16, hz = d.z + bz * 0.5 + Math.sin(d.rot) * 0.16;
      const hy = c.ground(hx, hz) - sink * 0.14;
      mFlat.makeTranslation(hx, hy + 0.012, hz).multiply(mTmp.makeRotationY(d.rot - 0.5)).multiply(mTmp.makeRotationX(-Math.PI / 2))
        .multiply(mTmp.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
      c.propM('ppl_shield', mFlat, c.playerColor(d.owner));
      c.propM('ppl_shield_rim', mFlat);
    }
  }
}
const mFlat = new THREE.Matrix4();
const mTmp = new THREE.Matrix4();

/**
 * Warta przed budynkami wojskowymi (uklad modelu): srodek i polowa dlugosci sciezki obchodu, jej odleglosc
 * od srodka budynku i miejsce drugiego wartownika przy wejsciu (wieza, twierdza).
 */
const PATROL: Partial<Record<number, { cx: number; gx: number; gy: number; sx?: number; sy?: number }>> = {
  [B.GUARDHUT]: { cx: 0, gx: 0.2, gy: -0.29 },
  [B.TOWER]: { cx: 0.02, gx: 0.2, gy: -0.3, sx: -0.3, sy: -0.24 },
  [B.FORTRESS]: { cx: 0.16, gx: 0.18, gy: -0.55, sx: -0.13, sy: -0.5 },
  [B.GUARDHOUSE]: { cx: 0.06, gx: 0.2, gy: -0.33 },
};
/** Atak na budynek (zdarzenie 'attack'): czas alarmu wartownikow; tyle sekund trwa gotowosc. */
const alarmAt = new Map<number, number>();
const ALARM_S = 12;
/** Obchod: marsz (s), postoj, marsz z powrotem, postoj. */
const PATROL_WALK = 5;
const PATROL_STOP = 3;

/**
 * Warta przed obsadzonym budynkiem wojskowym: rycerz przechadza sie wzdluz frontu, na koncach staje
 * przodem do przedpola i rozglada sie. W wiekszych budynkach drugi stoi na bacznosc przy wejsciu.
 * Przy ataku na budynek obaj staja w gotowosci, z tarcza przed soba.
 */
function guardPost(c: WorkCtx, b: Building, o: Origin): void {
  if (b.knights.length === 0) return;
  const path = PATROL[b.kind];
  if (!path) return;
  const T = 2 * (PATROL_WALK + PATROL_STOP);
  const t = (c.time + b.id * 3.7) % T;
  // u: -1 (lewy koniec) .. 1 (prawy koniec)
  let u: number, walking = false, dir = 1;
  if (t < PATROL_WALK) {
    u = -1 + 2 * ease(t, 0, PATROL_WALK);
    walking = true;
  } else if (t < PATROL_WALK + PATROL_STOP) u = 1;
  else if (t < 2 * PATROL_WALK + PATROL_STOP) {
    u = 1 - 2 * ease(t, PATROL_WALK + PATROL_STOP, 2 * PATROL_WALK + PATROL_STOP);
    walking = true;
    dir = -1;
  } else u = -1;
  const pt = c.at(o, path.cx + path.gx * u, path.gy, 0, vA);
  const along = c.at(o, path.cx + path.gx * u + dir * 0.1, path.gy, 0, vB);
  const out = c.frontRot;
  const walkRot = Math.atan2(along.x - pt.x, along.z - pt.z);
  // Obrot na koncach: z kierunku marszu przodem do przedpola i z powrotem.
  const stopT = t < PATROL_WALK + PATROL_STOP ? t - PATROL_WALK : t - (2 * PATROL_WALK + PATROL_STOP);
  const turnK = walking ? 0 : ease(stopT, 0, 0.5) * (1 - ease(stopT, PATROL_STOP - 0.5, PATROL_STOP));
  const p: Pose = { x: pt.x, y: c.ground(pt.x, pt.z), z: pt.z, rot: lerpAngle(walkRot, out, turnK), owner: b.owner, type: -1 };
  if (walking) {
    const w = t * 3.4;
    walkLegs(p, w, 0.85);
    p.armL = -Math.sin(w) * 0.25;
    p.armR = -0.35 + Math.sin(w) * 0.2;
  } else {
    p.headTurn = Math.sin(stopT * 1.6) * 0.8 * turnK;
    p.armR = -0.25;
  }
  // Alarm (atak na budynek): wartownik staje obok wejscia przodem do przedpola, tarcza i miecz w gotowosci.
  const t0 = alarmAt.get(b.pos);
  const age = t0 === undefined ? 99 : c.time - t0;
  const alarm = ease(age, 0, 0.8) * (1 - ease(age, ALARM_S - 1, ALARM_S));
  let guard = 0;
  if (alarm > 0) {
    const ctr = c.at(o, path.cx + 0.1, path.gy + 0.02, 0, vB);
    p.x = lerp(p.x, ctr.x, alarm);
    p.z = lerp(p.z, ctr.z, alarm);
    p.y = c.ground(p.x, p.z);
    p.rot = lerpAngle(p.rot, out, alarm);
    if (alarm < 1) walkLegs(p, age * 9, 0.8);
    else {
      p.legL = -0.15;
      p.legR = 0.12;
      p.legLOut = 0.1;
      p.legROut = 0.1;
      p.bob = Math.abs(Math.sin(c.time * 3 + b.id)) * 0.006;
    }
    p.armR = lerp(p.armR ?? 0, -0.95, alarm);
    p.armROut = 0.15 * alarm;
    p.headTurn = (p.headTurn ?? 0) * (1 - alarm);
    guard = 0.6 * alarm;
  }
  shieldArm(p, guard);
  knightFigure(c, p, guard);
  // Drugi wartownik: na bacznosc obok wejscia (wieza, twierdza).
  if (path.sx !== undefined && path.sy !== undefined && b.knights.length >= 3) {
    const g = c.at(o, path.sx, path.sy, 0, vC);
    const q: Pose = { x: g.x, y: c.ground(g.x, g.z), z: g.z, rot: out, owner: b.owner, type: -1 };
    const sh = Math.sin(c.time * 0.7 + b.id);
    q.tilt = sh * 0.04;
    q.headTurn = Math.sin(c.time * 0.31 + b.id) * 0.6;
    q.armR = lerp(-0.2, -0.95, alarm);
    q.armROut = 0.15 * alarm;
    q.headTurn *= 1 - alarm;
    shieldArm(q, guard);
    knightFigure(c, q, guard);
  }
}

// ---------------------------------------------------------------- katapulta

/**
 * Katapulta w ukladzie modelu (jak catapult() w art/scripts/buildings.py): os ramienia (wzdluz Y), kat ramienia
 * wokol niej po strzale (oparte o poprzeczke, w prawo) i napietego (lezy na lewej podporze), srodek kosza
 * w ukladzie ramienia, kolo zapadkowe na przednim koncu osi, stos pociskow i miejsca katapulciarza (przy kole, przy stosie,
 * przy koszu napietego ramienia).
 */
const CATAPULT = {
  pivotX: 0.02, pivotY: -0.06, pivotZ: 0.16,
  fired: -0.35, cocked: 1.5, bucketX: 0.062, bucketZ: 0.375,
  wheelY: -0.2,
  pileX: -0.27, pileY: -0.2,
  crankX: -0.1, crankY: -0.3,
  pickX: -0.19, pickY: -0.29,
  loadX: -0.5, loadY: -0.16,
} as const;
/** Przebieg cyklu po strzale (sekundy czasu gry): ramie wyrzuca, katapulciarz patrzy za pociskiem, kreci kolem
 *  (ramie schodzi zapadka w dol), idzie po kamien, laduje go do kosza, wraca do kola i czeka na strzal. */
const CAT = { swing: 0.22, watch: 3, crank: 13, toPile: 14.6, pick: 15.6, toLoad: 17.4, load: 18.6, back: 20.4 } as const;
/** Ostatni strzal katapulty na polu (tick) - do przebiegu cyklu i lotu pocisku. */
const catShots = new Map<number, number>();
/** Pociski w locie: start, cel, czas wystrzalu, czy trafil w budynek. */
const shells: { sx: number; sy: number; sz: number; tx: number; ty: number; tz: number; t: number; dur: number; hit: boolean; key: number }[] = [];
const DUST = 0xb8a88c;
const ROOF_BIT = 0xb8532c;

/** Punkt kosza (srodek kamienia) dla kata ramienia (uklad modelu -> swiat). */
function bucketAt(c: WorkCtx, o: Origin, ang: number, out: Vec3): Vec3 {
  const C = CATAPULT;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return c.at(o, C.pivotX + C.bucketX * cs - C.bucketZ * sn, C.pivotY, C.pivotZ + C.bucketX * sn + C.bucketZ * cs, out);
}

/** Kat ramienia przy kreceniu kolem: schodzi w dol skokami zapadki. */
function crankAngle(k: number): number {
  const n = 9;
  const q = k * n;
  const step = Math.floor(q);
  const e = step >= n ? 1 : (step + ease(q - step, 0.0, 0.35)) / n;
  return lerp(CATAPULT.fired, CATAPULT.cocked, e);
}

/**
 * Katapulta: ramie z koszem i kolo zapadkowe rysowane osobno. Po strzale ramie uderza w poprzeczke,
 * katapulciarz odprowadza pocisk wzrokiem, kreci kolem (ramie schodzi w dol), bierze kamien ze stosu,
 * kladzie go do kosza i czeka przy kole. Bez strzalu (brak celu) ramie czeka napiete i zaladowane.
 */
function catapult(c: WorkCtx, b: Building, o: Origin): void {
  const C = CATAPULT;
  const def = BUILDINGS[b.kind];
  const shot = catShots.get(b.pos);
  const recent = shot !== undefined && c.s.tick - shot < def.cycle;
  const ts = recent ? c.progress(b.timer, def.cycle) * def.cycle / TICKS_PER_SECOND : 999;
  const worker = c.workerInside(b);
  const stock = b.stock[0] ?? 0;
  // Kat ramienia i obrot kola.
  let ang: number = C.cocked;
  let wheel = 0;
  if (ts < CAT.swing) {
    const k = clamp01(ts / CAT.swing);
    ang = lerp(C.cocked, C.fired, k * k);
  } else if (ts < CAT.watch) {
    // Odbicie od poprzeczki.
    const k = ts - CAT.swing;
    ang = C.fired - Math.abs(Math.sin(k * 14)) * 0.12 * Math.exp(-k * 5);
  } else if (ts < CAT.crank) {
    const k = (ts - CAT.watch) / (CAT.crank - CAT.watch);
    ang = crankAngle(k);
    wheel = -k * 26;
  } else wheel = -26;
  const loaded = ts >= CAT.load || (!recent && stock > 0);
  const carried = ts >= CAT.pick - 0.4 && ts < CAT.load;
  const fr = c.frameOf(o);
  c.propAt('ppl_cat_arm', fr, C.pivotX, C.pivotZ, -C.pivotY, 0, 0, ang, 1);
  c.propAt('ppl_cat_wheel', fr, C.pivotX, C.pivotZ, -C.wheelY, 0, 0, wheel, 1);
  const bk = bucketAt(c, o, ang, vA);
  if (loaded && (recent || stock > 0)) c.prop('ppl_cat_stone', bk.x, bk.y - 0.005, bk.z, b.id, o.sc * 0.9);
  // Stos pociskow (zapas bez kamienia w koszu i niesionego).
  const pile = Math.min(6, stock - (loaded || carried ? 1 : 0));
  for (let i = 0; i < pile; i++) {
    const row = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = row === 0 ? i : row === 1 ? i - 3 : 0;
    const lx = C.pileX + (row === 0 ? (k - 1) * 0.05 : row === 1 ? (k - 0.5) * 0.05 : 0);
    const pt = c.at(o, lx, C.pileY + (k % 2) * 0.012, row * 0.04, vB);
    c.prop('ppl_cat_stone', pt.x, pt.y + 0.03 * o.sc * 0.8, pt.z, i * 1.3, o.sc * 0.8);
  }
  if (!worker) return;
  catapulter(c, b, o, ts, recent, wheel, carried);
}

/** Katapulciarz przy katapulcie (pracownik jest w srodku - rysujemy go przy maszynie). */
function catapulter(c: WorkCtx, b: Building, o: Origin, ts: number, recent: boolean, wheel: number, carried: boolean): void {
  const C = CATAPULT;
  const crank = c.at(o, C.crankX, C.crankY, 0, vA);
  const cx = crank.x, cz = crank.z;
  const wh = c.at(o, C.pivotX, C.wheelY, 0, vC);
  const crankFace = c.facing(cx, cz, wh.x, wh.z);
  const pick = c.at(o, C.pickX, C.pickY, 0, vB);
  const px = pick.x, pz = pick.z;
  const pileW = c.at(o, C.pileX, C.pileY, 0, vB);
  const pileFace = c.facing(px, pz, pileW.x, pileW.z);
  const load = c.at(o, C.loadX, C.loadY, 0, vB);
  const lx = load.x, lz = load.z;
  const bucket = bucketAt(c, o, C.cocked, vB);
  const bx = bucket.x, by = bucket.y, bz = bucket.z;
  const loadFace = c.facing(lx, lz, bx, bz);
  const p: Pose = { x: cx, y: 0, z: cz, rot: crankFace, owner: b.owner, type: S.CATAPULTER };
  let walking = false, walk = 0;
  const leg = (ax: number, az: number, ex: number, ez: number, t0: number, t1: number, endRot: number): void => {
    const w = ease(ts, t0, t1);
    p.x = lerp(ax, ex, w);
    p.z = lerp(az, ez, w);
    p.rot = lerpAngle(c.facing(ax, az, ex, ez), endRot, ease(ts, t1 - 0.25, t1));
    walking = w > 0 && w < 1;
    walk = w * TAU * 1.5;
  };
  let hold = false;
  if (!recent || ts >= CAT.back) {
    // Czeka przy kole: rozglada sie, co jakis czas oslania oczy reka i patrzy w dal.
    standIdle(c, p, b.id, 1);
    const cyc = (c.time + b.id * 2.1) % 10;
    const look = ease(cyc, 6, 6.5) * (1 - ease(cyc, 8.5, 9));
    p.armR = lerp(p.armR ?? 0, -2.55, look);
    p.armROut = lerp(p.armROut ?? 0, 0.5, look);
    p.armRYaw = -0.6 * look;
    p.head = lerp(p.head ?? 0, -0.15, look);
    p.headTurn = lerp(p.headTurn ?? 0, 0.9, look);
  } else if (ts < CAT.watch) {
    // Odprowadza pocisk wzrokiem.
    const k = ease(ts, 0.1, 0.6);
    p.headTurn = 1.0 * k;
    p.head = -0.25 * k;
    p.armR = -0.6 * (1 - k);
  } else if (ts < CAT.crank) {
    // Kreci kolem zapadkowym obiema rekami na zmiane.
    p.armR = -1.25 + Math.sin(wheel) * 0.4;
    p.armL = -1.25 - Math.sin(wheel) * 0.4;
    p.armRYaw = 0.25;
    p.armLYaw = 0.25;
    p.lean = 0.2 + Math.sin(wheel) * 0.05;
    p.legL = -0.25;
    p.legR = 0.2;
    p.bob = Math.abs(Math.sin(wheel)) * 0.005;
  } else if (ts < CAT.toPile) {
    leg(cx, cz, px, pz, CAT.crank, CAT.toPile, pileFace);
  } else if (ts < CAT.pick) {
    // Schyla sie po kamien.
    p.x = px;
    p.z = pz;
    p.rot = pileFace;
    bendPose(p, Math.sin(clamp01((ts - CAT.toPile) / (CAT.pick - CAT.toPile)) * Math.PI));
    hold = ts > (CAT.toPile + CAT.pick) / 2;
  } else if (ts < CAT.toLoad) {
    leg(px, pz, lx, lz, CAT.pick, CAT.toLoad, loadFace);
    hold = true;
    p.armL = -1.05;
    p.armR = -1.05;
  } else if (ts < CAT.load) {
    // Unosi kamien i kladzie go do kosza.
    p.x = lx;
    p.z = lz;
    p.rot = loadFace;
    const k = ease(ts, CAT.toLoad, CAT.toLoad + 0.5);
    p.armL = lerp(-1.05, -1.55, k);
    p.armR = p.armL;
    p.lean = 0.1 * k;
    hold = true;
  } else {
    leg(lx, lz, cx, cz, CAT.load, CAT.back, crankFace);
  }
  p.y = c.ground(p.x, p.z);
  if (walking) walkLegs(p, walk);
  const f = c.figure(p);
  if (hold && carried) {
    // Kamien w rekach; przy ladowaniu przechodzi do kosza.
    const m = handsMid(f, vC);
    let gx = m.x, gy = m.y - 0.03, gz = m.z;
    if (ts >= CAT.toLoad) {
      const k = ease(ts, CAT.toLoad + 0.3, CAT.load - 0.1);
      gx = lerp(gx, bx, k);
      gy = lerp(gy, by, k);
      gz = lerp(gz, bz, k);
    }
    c.prop('ppl_cat_stone', gx, gy, gz, b.id, o.sc * 0.9);
  }
}

/** Lot pocisku: luk od kosza do celu, kamien sie obraca; przy uderzeniu pyl i odpryski (dachowki przy trafieniu). */
function drawShells(c: WorkCtx): void {
  for (let i = shells.length - 1; i >= 0; i--) {
    const sh = shells[i];
    const age = c.time - sh.t;
    if (age > sh.dur + 2 || age < 0) {
      shells.splice(i, 1);
      continue;
    }
    if (age < sh.dur) {
      const k = age / sh.dur;
      const d = Math.hypot(sh.tx - sh.sx, sh.tz - sh.sz);
      const h = 0.8 + d * 0.22;
      const x = lerp(sh.sx, sh.tx, k), z = lerp(sh.sz, sh.tz, k);
      const y = lerp(sh.sy, sh.ty, k) + 4 * h * k * (1 - k);
      if (c.inView(x, z)) {
        mFlat.makeTranslation(x, y, z).multiply(mTmp.makeRotationX(age * 9)).multiply(mTmp.makeScale(1.9, 1.9, 1.9));
        c.propM('ppl_cat_stone', mFlat);
        c.fx.stream(sh.key, x, y, z, { kind: 'puff', n: 4, life: 0.4, size: 0.05, sizeEnd: 0.015, color: DUST, fade: 0.5 });
      }
      continue;
    }
    if (!c.inView(sh.tx, sh.tz)) continue;
    const a = age - sh.dur;
    c.fx.burst(sh.key * 3 + 1, a, sh.tx, sh.ty, sh.tz, {
      kind: 'puff', n: 9, life: 1.4, vy: 0.35, spread: 0.45, spreadY: 0.15, gravity: 0.15, size: 0.09, sizeEnd: 0.22,
      color: DUST, colorEnd: 0xd8d0c0, fade: 0.4, sound: 'impact',
    });
    c.fx.burst(sh.key * 3 + 2, a, sh.tx, sh.ty + 0.05, sh.tz, {
      kind: 'bit', n: 10, life: 0.9, vy: 1.1, spread: 0.7, gravity: 3.2, size: 0.03, sizeEnd: 0.02,
      color: sh.hit ? ROOF_BIT : 0x7d5733, floor: c.ground(sh.tx, sh.tz) + 0.01,
    });
  }
}

/** Zdarzenie 'catapult' (pole katapulty, a = pole celu): strzal; trafienie, gdy w tym ticku zginal rycerz celu. */
function catapultEvents(c: WorkCtx, ev: readonly GameEvent[]): void {
  for (const e of ev) {
    if (e.type !== 'catapult' || e.a === undefined) continue;
    catShots.set(e.pos, c.s.tick);
    prune(catShots, 100);
    const cat = c.s.map.obj[e.pos] === O.BUILDING ? c.s.buildings[c.s.map.objId[e.pos]] : null;
    const tgt = c.s.map.obj[e.a] === O.BUILDING ? c.s.buildings[c.s.map.objId[e.a]] : null;
    if (!cat) continue;
    const o = c.origin(cat);
    const from = bucketAt(c, o, CATAPULT.fired, vA);
    let hit = false;
    for (const d of ev) if (d.type === 'death' && d.pos === e.a) hit = true;
    let tx: number, ty: number, tz: number;
    if (tgt) {
      const to = c.origin(tgt);
      if (hit) {
        tx = to.x;
        tz = to.z;
        ty = to.y + 0.35 * to.sc;
      } else {
        // Chybienie: kamien spada obok budynku, troche przed nim.
        const ang = Math.atan2(from.x - to.x, from.z - to.z) + (((c.s.tick * 0.618034) % 1) - 0.5) * 2.2;
        tx = to.x + Math.sin(ang) * 0.75;
        tz = to.z + Math.cos(ang) * 0.75;
        ty = c.ground(tx, tz);
      }
    } else {
      const t = c.cell(e.a, vB);
      tx = t.x;
      ty = t.y;
      tz = t.z;
    }
    const dist = Math.hypot(tx - from.x, tz - from.z);
    shells.push({ sx: from.x, sy: from.y, sz: from.z, tx, ty, tz, t: c.time, dur: 0.7 + dist * 0.12, hit, key: e.pos * 7 + c.s.tick });
    if (shells.length > 20) shells.shift();
  }
}

// ---------------------------------------------------------------- osiol

/** Stawy osla w ukladzie modelu (jak w art/scripts/props_people.py): szyja, nogi, nasada ogona; skala jak w entities.ts. */
const DONKEY = { neckY: 0.12, neckZ: 0.21, legX: 0.035, legY: 0.085, legZ: 0.14, tailY: 0.135, tailZ: 0.22, s: 1.1 * UNIT_SCALE, load: 0.25 };
const mRoot = new THREE.Matrix4();

/**
 * Osiol na drodze: w marszu nogi ida klusem (na krzyz), leb kiwa sie w rytm krokow, ogon macha.
 * Stojac (bez pracy) skubie trawe, czekajac z towarem przy pelnej fladze kiwa lbem i przestepuje.
 */
function donkey(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  const s = c.s;
  const road = serf.state === SS.CARRIER ? s.roads[serf.road] : null;
  let x = at.x, z = at.z, rot = at.rot;
  // Przy fladze staje od strony swojej drogi (jak tragarz), nie na maszcie.
  if (road) {
    const map = s.map;
    if (at.to >= 0) {
      const fromFlag = map.obj[at.from] === O.FLAG, toFlag = map.obj[at.to] === O.FLAG;
      if (fromFlag || toFlag) {
        const a = fromFlag ? roadStand(c, road, at.from, vA) : c.cell(at.from, vA);
        const b = toFlag ? roadStand(c, road, at.to, vB) : c.cell(at.to, vB);
        x = lerp(a.x, b.x, at.t);
        z = lerp(a.z, b.z, at.t);
        rot = Math.atan2(b.x - a.x, b.z - a.z);
      }
    } else if (map.obj[serf.pos] === O.FLAG) {
      const st = roadStand(c, road, serf.pos, vA);
      x = st.x;
      z = st.z;
      const f = c.cell(serf.pos, vB);
      rot = c.facing(f.x, f.z, x, z) + Math.PI * 0.5;
    }
  }
  const D = DONKEY;
  const moving = at.to >= 0;
  const t = c.time + serf.id * 1.37;
  const walk = moving ? at.t * TAU * 2 : 0;
  const bob = moving ? Math.abs(Math.sin(walk)) * 0.012 : 0;
  // Leb: kiwanie w marszu, skubanie trawy na postoju (bez towaru), niecierpliwe kiwanie z towarem.
  let neck: number;
  if (moving) neck = Math.sin(walk * 2) * 0.12;
  else if (serf.carry < 0) {
    const cyc = t % 9;
    const graze = ease(cyc, 3, 3.8) * (1 - ease(cyc, 7, 7.8));
    neck = graze * (1.05 + Math.sin(t * 7) * 0.06) + Math.sin(t * 0.7) * 0.08 * (1 - graze);
  } else neck = Math.max(0, Math.sin(t * 2.2)) * 0.25;
  const y = c.ground(x, z) + bob;
  mRoot.makeTranslation(x, y, z).multiply(mTmp.makeRotationY(rot)).multiply(mTmp.makeScale(D.s, D.s, D.s));
  c.propM('ppl_donkey_body', mRoot);
  c.propAt('ppl_donkey_head', mRoot, 0, D.neckZ, D.neckY, neck, 0, 0);
  const swing = moving ? Math.sin(walk) * 0.5 : 0;
  const shift = moving ? 0 : Math.sin(t * 0.9) * 0.06;
  // Klus: lewa przednia z prawa tylna i na odwrot.
  c.propAt('ppl_donkey_leg', mRoot, -D.legX, D.legZ, D.legY, swing + shift, 0, 0);
  c.propAt('ppl_donkey_leg', mRoot, D.legX, D.legZ, D.legY, -swing - shift, 0, 0);
  c.propAt('ppl_donkey_leg', mRoot, -D.legX, D.legZ, -D.legY, -swing, 0, 0);
  c.propAt('ppl_donkey_leg', mRoot, D.legX, D.legZ, -D.legY, swing, 0, 0);
  c.propAt('ppl_donkey_tail', mRoot, 0, D.tailZ, -D.tailY, 0.15, Math.sin(t * 3.1) * 0.5, 0);
  if (serf.carry >= 0) c.goodAt(serf.carry, mRoot, 0, D.load, 0.01, 0, 0, 0, 1);
  return true;
}

// ---------------------------------------------------------------- przewoznik

const SPLASH = 0xd8ecf4;
/** Lodka w swiecie: skala modelu, wysokosc lawki, dulki (polowa szerokosci) i miejsce towaru (na dziobie). */
const BOAT = { s: 1.5, seat: 0.03, lock: 0.084, lockZ: 0.045, good: 0.13 };
const mBoat = new THREE.Matrix4();

/**
 * Przewoznik na drodze wodnej: siedzi w lodce tylem do kierunku plyniecia i wiosluje (wiosla zanurzaja sie
 * przy pociagnieciu, chlapie woda); towar lezy na dziobie. Bez pracy lodka kolysze sie na srodku drogi,
 * a przewoznik odpoczywa z wioslami w gorze. Na ladzie chodzi jak tragarz.
 */
function sailor(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  const map = c.s.map;
  const wet = map.terrain[at.from] === T.WATER || (at.to >= 0 && map.terrain[at.to] === T.WATER);
  if (!wet) return carrier(c, serf, at);
  const moving = at.to >= 0;
  const t = c.time + serf.id * 0.77;
  const road = c.s.roads[serf.road];
  let rot = at.rot;
  if (!moving && road) rot = idleFacing(c, road, serf.pos) + Math.PI / 2;
  const roll = Math.sin(t * 1.3) * 0.05;
  const y = c.ground(at.x, at.z) + Math.sin(t * 1.7) * 0.006;
  mBoat.makeTranslation(at.x, y, at.z).multiply(mTmp.makeRotationY(rot)).multiply(mTmp.makeRotationZ(roll))
    .multiply(mTmp.makeScale(BOAT.s, BOAT.s, BOAT.s));
  c.propM('ppl_boat', mBoat);
  // Wioslowanie: zaciag (pioro w wodzie, ciagnie do siebie), potem pioro nad woda w przod.
  const ph = moving ? (t * 1.1) % 1 : 0;
  const drive = moving ? (ph < 0.5 ? ease(ph, 0, 0.5) : 1 - ease(ph, 0.5, 1)) : 0.5;
  const dip = moving ? (ph < 0.5 ? 1 : 0) : 0;
  // Rekojesc wiosla (u wioslarza) przy zaciagu idzie do piersi - pioro do tylu lodzi.
  const sweep = lerp(-0.55, 0.5, drive);
  const pitch = moving ? lerp(0.12, -0.18, dip) : 0.25;
  for (const sx of [-1, 1]) {
    c.propAt('ppl_oar', mBoat, sx * BOAT.lock, BOAT.lockZ, 0, 0, sx > 0 ? sweep : Math.PI - sweep, pitch);
  }
  if (moving && ph < 0.44) {
    for (const sx of [-1, 1]) {
      Rig.point(mBoat, sx * 0.27, 0, 0.11, hR);
      c.fx.burst(serf.id * 61 + sx + Math.floor(t * 1.1) * 3, ph / 1.1, hR.x, y, hR.z, {
        kind: 'puff', n: 4, life: 0.4, vy: 0.35, spread: 0.12, gravity: 1.6, size: 0.02, sizeEnd: 0.01, color: SPLASH, sound: 'splash_small', soundGain: 0.5,
      });
    }
  }
  // Wioslarz siedzi tylem do dziobu.
  const p: Pose = {
    x: at.x, y: y + (BOAT.seat + 0.012) * BOAT.s - (HIP - 0.03) * UNIT_SCALE, z: at.z, rot: rot + Math.PI,
    owner: serf.owner, type: serf.type, tool: null, tilt: -roll,
  };
  p.legL = -1.35;
  p.legR = -1.3;
  p.legLOut = 0.12;
  p.legROut = 0.12;
  if (moving) {
    p.lean = lerp(0.45, -0.25, drive);
    p.armL = lerp(-1.45, -0.55, drive);
    p.armR = p.armL;
    p.armLOut = 0.35;
    p.armROut = 0.35;
  } else {
    p.lean = -0.1;
    p.armL = -0.9;
    p.armR = -0.9;
    p.armLOut = 0.15;
    p.armROut = 0.15;
    p.headTurn = Math.sin(t * 0.4) * 0.7;
  }
  c.figure(p);
  if (serf.carry >= 0) c.goodAt(serf.carry, mBoat, 0, 0.03, BOAT.good, 0, 0, 0, 1 / BOAT.s);
  return true;
}

export const peopleScenes: Scenes = {
  serf: { [S.TRANSPORTER]: carrier, [S.DONKEY]: donkey, [S.SAILOR]: sailor, [S.BUILDER]: builder, [S.DIGGER]: digger, [S.GEOLOGIST]: geologist, [S.KNIGHT]: knight },
  building: { [B.GUARDHUT]: guardPost, [B.TOWER]: guardPost, [B.FORTRESS]: guardPost, [B.GUARDHOUSE]: guardPost, [B.CATAPULT]: catapult },
  site,
  events: (c, ev) => {
    constructionEvents(ev);
    knightEvents(c, ev);
    catapultEvents(c, ev);
    for (const e of ev) {
      if (e.type === 'found') {
        foundAt.set(e.pos, c.time);
        prune(foundAt, 200);
      }
    }
  },
  frame: (c) => {
    drawFallen(c);
    drawShells(c);
  },
};
