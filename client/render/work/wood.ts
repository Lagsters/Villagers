/**
 * Drwal i tracz - wzorcowe sceny pracy.
 * Drwal: siekiera tkwi w pienku przed chata; bierze ja, gdy po wyjsciu stanie na fladze. Przy drzewie
 * rabie zamachem z boku (przy kazdym uderzeniu leca wiory), drzewo pada, drwal niesie je na ramieniu, kladzie
 * na pienku, okrzesuje i z samym pniem na ramieniu idzie na flage (etap WS.LIMBING w symulacji).
 * Tracz: w trakcie cyklu tartaku piluje klode na kozle przed budynkiem (sypia sie trociny) i odnosi deske na stos.
 */
import * as THREE from 'three';
import { B, BUILDINGS, G, O, S } from '../../../sim/defs.ts';
import { LIMB_TICKS, WS } from '../../../sim/production.ts';
import { SS } from '../../../sim/serfs.ts';
import type { Building, Serf } from '../../../sim/types.ts';
import { treeLook } from '../mapObjects.ts';
import { SHOULDER, UNIT_SCALE } from '../rig.ts';
import type { Origin, Scenes, SerfAt, WorkCtx } from './types.ts';

/** Pieniek przed chata drwala (srodek, wysokosc wierzchu) i miejsce drwala przy nim, w ukladzie modelu. */
const CHOP_BLOCK = { x: 0.22, y: -0.29, top: 0.074, standX: 0.36, standY: -0.31 };
/** Koziol przed tartakiem (srodek klody, wysokosc oparcia) i miejsce tracza za nim, w ukladzie modelu. */
const SAW_HORSE = { x: -0.12, y: -0.44, top: 0.075, sawyerX: -0.12, sawyerY: -0.33 };
const WOOD_CHIP = 0xd8b07a;
const LEAF = 0x5b8f3a;
const SAWDUST = 0xe8cf9c;

const m = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const fallM = new THREE.Matrix4();
const rotM = new THREE.Matrix4();

/**
 * Siekiera drwala jest w reku od chwili, gdy po wyjsciu z chaty stanie na fladze, do odlozenia pnia
 * na flage (wtedy wraca do pienka); poza tym tkwi w pienku przed chata.
 */
function axeInHand(home: Building, serf: Serf): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.TO_TARGET) return serf.pos !== home.pos;
  return serf.sub === WS.WORKING || serf.sub === WS.RETURN || serf.sub === WS.LIMBING;
}

/** Sciete drzewo (branches = false - sam pien) na prawym ramieniu postaci stojacej w (x, y, z) i zwroconej o rot. */
function shoulderTree(c: WorkCtx, x: number, y: number, z: number, rot: number, branches = true): void {
  m.makeTranslation(x, y, z).multiply(m2.makeRotationY(rot)).multiply(m2.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
  m.multiply(m2.makeTranslation(0.1, SHOULDER + 0.06, -0.03)).multiply(m2.makeRotationY(Math.PI / 2)).multiply(m2.makeRotationZ(-0.15));
  c.propM('felled_trunk', m);
  if (branches) c.propM('felled_branches', m);
}

/**
 * Drwal przy pienku: podchodzi od flagi z drzewem na ramieniu, kladzie je na pienku, okrzesuje siekiera
 * galezie (potem lezy juz sam pien) i wraca z pniem na ramieniu na flage.
 */
function limbing(c: WorkCtx, serf: Serf, flag: SerfAt): void {
  const b = c.s.buildings[serf.home];
  if (!b) return;
  const o = c.origin(b);
  const block = c.at(o, CHOP_BLOCK.x, CHOP_BLOCK.y);
  const stand = c.at(o, CHOP_BLOCK.standX, CHOP_BLOCK.standY);
  const p = c.progress(serf.timer, LIMB_TICKS);
  // Krotki marsz od flagi do pienka na poczatku i z powrotem na koncu.
  const go = p < 0.15 ? p / 0.15 : p > 0.88 ? (1 - p) / 0.12 : 1;
  const walking = go < 1;
  const x = flag.x + (stand.x - flag.x) * go, z = flag.z + (stand.z - flag.z) * go;
  const y = flag.y + (stand.y - flag.y) * go;
  const toBlock = c.facing(stand.x, stand.z, block.x, block.z);
  const toStand = c.facing(flag.x, flag.z, stand.x, stand.z);
  const rot = !walking ? toBlock : p < 0.5 ? toStand : toStand + Math.PI;
  const top = block.y + CHOP_BLOCK.top * o.sc;
  // Drzewo lezy w poprzek przed drwalem; do 2/3 pracy z galeziami, potem ten sam pien bez nich.
  const across = toBlock - Math.PI / 2;
  if (walking) shoulderTree(c, x, y, z, rot, p < 0.5);
  else {
    c.prop('felled_trunk', block.x, top + 0.035, block.z, across, UNIT_SCALE);
    if (p < 0.66) c.prop('felled_branches', block.x, top + 0.035, block.z, across, UNIT_SCALE);
  }
  const walk = p * 40;
  const bt = c.beat(1.3, serf.id * 0.37);
  const up = c.strike(bt.f);
  if (!walking && p < 0.66) {
    // Odcinane galezie: listki i wiory przy kazdym uderzeniu.
    c.fx.burst(serf.id * 7 + bt.n, bt.age, block.x, top + 0.06, block.z,
      { kind: 'bit', n: 4, life: 0.5, vy: 0.5, spread: 0.35, gravity: 2.2, size: 0.018, sizeEnd: 0.012, color: bt.n % 2 ? LEAF : WOOD_CHIP, floor: block.y + 0.01, sound: 'chop', soundGain: 0.7 });
  }
  c.figure({
    x, y, z, rot, owner: serf.owner, type: serf.type,
    legL: walking ? Math.sin(walk) * 0.6 : -0.2, legR: walking ? -Math.sin(walk) * 0.6 : 0.2,
    armL: walking ? -Math.sin(walk) * 0.5 : -0.6, armR: walking ? -2.7 : -1.0 - up * 1.8,
    lean: walking ? 0 : 0.3 - up * 0.2, tool: walking ? null : undefined,
  });
}

/** Etapy pracy przy drzewie (postep WORKING): rabanie, padanie drzewa, podnoszenie lezacego pnia. */
const CHOP_END = 0.72;
const FALL_END = 0.86;
const CHOP_TICKS = BUILDINGS[B.WOODCUTTER].cycle - LIMB_TICKS;
/** Sekundy animacji na tick symulacji (5 tickow na sekunde przy tempie 1x). */
const TICK_S = 0.2;

/**
 * Rabanie drzewa: drwal staje bokiem do kamery przy pniu i rabie zamachem z boku (wiory przy kazdym
 * uderzeniu); pod koniec drzewo przechyla sie i pada z przyspieszeniem w strone, w ktora drwal patrzy
 * (wzbija liscie i pyl), drwal odstepuje, potem schyla sie po lezacy pien.
 */
function chopping(c: WorkCtx, serf: Serf): void {
  const m = c.s.map;
  const tree = treeLook(m, serf.target);
  const p = c.progress(serf.timer, CHOP_TICKS);
  const standing = m.obj[serf.target] === O.TREE;
  const st = c.beside(tree.x, tree.z, 0.27, 0.75);
  const { rot } = st;
  if (!standing || p < CHOP_END) {
    const bt = c.beat(1.2, serf.id * 0.29);
    const up = c.strike(bt.f);
    if (standing) {
      c.fx.burst(serf.id * 13 + bt.n, bt.age, tree.x - Math.sin(rot) * 0.05, tree.y + 0.1, tree.z - Math.cos(rot) * 0.05,
        { kind: 'bit', n: 5, life: 0.55, vx: -Math.sin(rot) * 0.4, vz: -Math.cos(rot) * 0.4, vy: 0.5, spread: 0.3, gravity: 2.4,
          size: 0.02, sizeEnd: 0.014, color: WOOD_CHIP, floor: tree.y + 0.01, sound: 'chop' });
    }
    c.figure({
      x: st.x, y: st.y, z: st.z, rot, owner: serf.owner, type: serf.type,
      // Zamach z boku: tulow skreca sie od pnia, rece wysoko za barkiem; uderzenie poziomo w pien.
      twist: -0.2 - up * 0.7, lean: 0.15, legL: -0.25, legR: 0.25,
      armR: -1.35 - up * 0.5, armRYaw: 0.25 - up * 0.9, armL: -1.25 - up * 0.4, armLYaw: 0.45 - up * 0.9, toolRoll: -1.3,
    });
    return;
  }
  // Drzewo pada: obrot wokol podstawy pnia w strone, w ktora patrzy drwal (z przyspieszeniem i lekkim odbiciem).
  c.hideObject(serf.target);
  c.sfx('wood_crack', tree.x, tree.z, serf.id * 4096 + serf.target);
  const f = Math.min(1, (p - CHOP_END) / (FALL_END - CHOP_END));
  const lie = Math.PI / 2 - 0.06;
  const angle = f < 1 ? lie * f * f : lie - Math.abs(Math.sin((p - FALL_END) * 40)) * 0.06 * Math.max(0, 1 - (p - FALL_END) * 12);
  fallM.makeTranslation(tree.x, tree.y, tree.z).multiply(rotM.makeRotationY(rot)).multiply(rotM.makeRotationX(angle))
    .multiply(rotM.makeRotationY(tree.rot - rot)).multiply(rotM.makeScale(tree.s, tree.sy, tree.s));
  c.propM(tree.model, fallM, tree.tintHex);
  if (p >= FALL_END) {
    const age = (p - FALL_END) * CHOP_TICKS * TICK_S;
    const dist = tree.s * 0.55;
    const hx = tree.x + Math.sin(rot) * dist, hz = tree.z + Math.cos(rot) * dist;
    c.fx.burst(serf.id * 17 + 3, age, hx, tree.y + 0.04, hz,
      { kind: 'bit', n: 8, life: 0.9, vy: 0.6, spread: 0.5, gravity: 1.6, size: 0.026, sizeEnd: 0.014, color: LEAF, floor: tree.y + 0.01, sound: 'tree_land' });
    c.fx.burst(serf.id * 17 + 4, age, hx, tree.y + 0.03, hz,
      { kind: 'puff', n: 5, life: 1.0, vy: 0.12, spread: 0.25, spreadY: 0.05, size: 0.06, sizeEnd: 0.14, color: 0xb9a27c, fade: 0.5 });
  }
  // Drwal odstepuje i patrzy, jak drzewo pada; na koniec schyla sie po pien.
  const back = 0.08 * Math.min(1, f * 2);
  const lift = p >= FALL_END ? Math.min(1, (p - FALL_END) / (1 - FALL_END) * 1.4) : 0;
  const bx = st.x - Math.sin(rot) * back + Math.sin(rot) * 0.16 * lift;
  const bz = st.z - Math.cos(rot) * back + Math.cos(rot) * 0.16 * lift;
  c.figure({
    x: bx, y: c.ground(bx, bz), z: bz, rot, owner: serf.owner, type: serf.type,
    lean: lift * 0.9, crouch: lift * 0.05, armR: -0.3 - lift * 0.9, armL: -0.2 - lift * 1.0, head: f < 1 ? -0.2 : 0.2,
    legL: -0.15, legR: 0.15, tool: lift > 0.5 ? null : undefined,
  });
}

function woodcutter(c: WorkCtx, serf: Serf, at: SerfAt): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  if (serf.sub === WS.LIMBING) {
    limbing(c, serf, at);
    return true;
  }
  if (serf.sub === WS.WORKING && serf.target >= 0) {
    chopping(c, serf);
    return true;
  }
  if (serf.sub === WS.RETURN && serf.carry === G.LUMBER) {
    // Sciete drzewo na prawym ramieniu: odziomek z przodu, korona z tylu, prawa reka przytrzymuje pien.
    c.figure({ ...c.walkPose(serf, at), armL: at.moving ? -Math.sin(at.walk) * 0.5 : 0, armR: -2.7, carry: -1, tool: null });
    shoulderTree(c, at.x, at.y + at.bob, at.z, at.rot);
    return true;
  }
  const home = c.s.buildings[serf.home];
  const pose = c.walkPose(serf, at);
  if (home && !axeInHand(home, serf)) pose.tool = null;
  c.figure(pose);
  return true;
}

/** Chata drwala: siekiera w pienku, gdy drwal nie ma jej w reku. */
function woodcutterHut(c: WorkCtx, b: Building, o: Origin): void {
  const w = b.worker >= 0 ? c.s.serfs[b.worker] : null;
  // Model siekiery jest w ukladzie chaty: przesuniety w pionie razem z pienkiem na podworku.
  if (!w || !axeInHand(b, w)) c.prop('woodcutter_axe', o.x, c.floor(o, CHOP_BLOCK.x, CHOP_BLOCK.y), o.z, 0, o.sc);
}

/** Stos desek przed tartakiem (model: plank_stack w (0.3, -0.34), 4 warstwy) i miejsce tracza przy nim. */
const PLANK_STACK = { x: 0.3, y: -0.34, top: 0.066, standX: 0.17, standY: -0.43 };
/** Do tego postepu cyklu tracz piluje; potem niesie deske na stos. */
const SAW_END = 0.76;

/**
 * Tartak: w trakcie cyklu tracz piluje klode na kozle przed budynkiem (spod pily sypia sie trociny), potem
 * niesie gotowa deske na stos obok. Na stosie leza deski czekajace na wyniesienie na flage (b.out).
 */
function sawmill(c: WorkCtx, b: Building, o: Origin): void {
  let waiting = 0;
  for (const g of b.out) if (g === G.PLANK) waiting++;
  for (let i = 0; i < Math.min(3, waiting); i++) {
    const q = c.at(o, PLANK_STACK.x, PLANK_STACK.y + (i % 2) * 0.01, PLANK_STACK.top + i * 0.05);
    c.good(G.PLANK, q.x, q.y, q.z, c.frontRot + (i % 2) * 0.05, o.sc * 1.15);
  }
  const p = c.cycle(b);
  if (p < 0 || !c.workerInside(b)) return;
  const log = c.at(o, SAW_HORSE.x, SAW_HORSE.y, SAW_HORSE.top);
  const st = c.at(o, SAW_HORSE.sawyerX, SAW_HORSE.sawyerY);
  if (p < SAW_END) {
    c.good(G.LUMBER, log.x, log.y, log.z, c.frontRot, o.sc * 1.1);
    // Pila tam i z powrotem: obie rece na raczce, wymach od barku; pociagniecie pily przy kazdej zmianie kierunku.
    const k = Math.sin(c.time * 7 + b.id);
    c.sfx('saw', log.x, log.z, b.id * 4096 + Math.floor((c.time * 7 + b.id) / Math.PI + 0.5));
    c.figure({
      x: st.x, y: st.y + Math.abs(k) * 0.006, z: st.z, rot: c.frontRot, owner: b.owner, type: S.SAWYER,
      lean: 0.18, armL: -0.75 + k * 0.4, armR: -0.95 + k * 0.4,
    });
    c.fx.stream(b.id * 16 + 1, log.x, log.y - 0.02, log.z, {
      kind: 'bit', n: 6, life: 0.7, vy: -0.05, spread: 0.12, spreadY: 0.05, gravity: 0.8, size: 0.012, sizeEnd: 0.008,
      color: SAWDUST, jitter: 0.02, floor: c.floor(o, SAW_HORSE.x, SAW_HORSE.y) + 0.005,
    });
    return;
  }
  // Deska z kozla na stos: schylenie, przejscie z deska przed soba, polozenie na stosie i powrot.
  const f = (p - SAW_END) / (1 - SAW_END);
  const end = c.at(o, PLANK_STACK.standX, PLANK_STACK.standY);
  const stack = c.at(o, PLANK_STACK.x, PLANK_STACK.y);
  const go = f < 0.2 ? 0 : f < 0.6 ? (f - 0.2) / 0.4 : f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2;
  const x = st.x + (end.x - st.x) * go, z = st.z + (end.z - st.z) * go;
  const walking = (f > 0.2 && f < 0.6) || f > 0.8;
  const rot = f < 0.2 ? c.frontRot : f < 0.6 ? c.facing(st.x, st.z, end.x, end.z) : f < 0.8 ? c.facing(x, z, stack.x, stack.z) : c.facing(end.x, end.z, st.x, st.z);
  const bend = f < 0.2 ? Math.sin((f / 0.2) * Math.PI) : f >= 0.6 && f < 0.8 ? Math.sin(((f - 0.6) / 0.2) * Math.PI) : 0;
  const holding = f >= 0.1 && f < 0.7;
  const w = walking ? f * 30 : 0;
  const fr = c.figure({
    x, y: c.ground(x, z), z, rot, owner: b.owner, type: S.SAWYER, tool: null,
    lean: bend * 0.7, legL: Math.sin(w) * 0.5, legR: -Math.sin(w) * 0.5,
    armL: holding ? -1.1 + bend * 0.4 : -Math.sin(w) * 0.4, armR: holding ? -1.1 + bend * 0.4 : Math.sin(w) * 0.4,
  });
  if (holding) c.goodAt(G.PLANK, fr.torso, 0, 0.2 - bend * 0.03, 0.13 + bend * 0.05, 0, Math.PI / 2, 0, 1.15);
  else if (f < 0.1) c.good(G.PLANK, log.x, log.y, log.z, c.frontRot, o.sc * 1.15);
}

export const woodScenes: Scenes = {
  serf: { [S.WOODCUTTER]: woodcutter },
  building: { [B.WOODCUTTER]: woodcutterHut, [B.SAWMILL]: sawmill },
};
