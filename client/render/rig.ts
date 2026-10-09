/**
 * Szkielet postaci skladanej z czesci (art/scripts/units.py): tulow, glowa, nogi, rece, nakrycie glowy,
 * narzedzia. Poza (Pose) opisuje ustawienie stawow; Rig rysuje czesci do warstw instancji i zostawia
 * macierze stawow (frames), do ktorych sceny przyczepiaja rekwizyty (worek w rece, luk, kosz na plecach).
 *
 * Uklad czesci (jednostki modelu, przed skala UNIT_SCALE): y w gore, przod postaci na +z, bark prawej
 * reki (z narzedziem) na +x. Katy: wymach (Rx) ujemny = do przodu; odwiedzenie na bok dodatnie = na zewnatrz.
 */
import * as THREE from 'three';
import { G, S } from '../../sim/defs.ts';
import { InstancedLayer } from './instanced.ts';

export const HIP = 0.14;
export const SHOULDER = 0.31;
/** Odsuniecie barku od osi postaci (jak ARM_X w art/scripts/units.py). */
export const ARM_X = 0.078;
/** Dlon wzgledem barku (jak HAND w art/scripts/units.py). */
export const HAND = -0.15;
/** Lokiec wzgledem barku (jak ELBOW w art/scripts/units.py). */
export const ELBOW = -0.078;
/** Szyja: os pochylania glowy (jak NECK w art/scripts/units.py). */
export const NECK = 0.315;
/** Dlugosc nogi od biodra do podeszwy. */
export const LEG = 0.14;
/** Skala jednostek (drobne postacie z duzymi glowami, jak w pierwowzorze). */
export const UNIT_SCALE = 0.85;
/** Wysokosc towaru niesionego na glowie (jednostki modelu). */
export const CARRY_Y = 0.47;

/**
 * Sposob niesienia towaru (zalezy od jego ciezaru i ksztaltu): na glowie (lekkie), na prawym ramieniu (dlugie: pnie,
 * deski), oburacz przed soba (ciezkie i zwarte: kamien, ruda, wegiel, stal, beczka, swinia), w prawej rece u boku
 * (wiadro z woda).
 */
export type CarryStyle = 'head' | 'shoulder' | 'arms' | 'hand';
const SHOULDER_GOODS: readonly number[] = [G.LUMBER, G.PLANK];
const ARMS_GOODS: readonly number[] = [G.PIG, G.BEER, G.STONE, G.IRON_ORE, G.STEEL, G.COAL, G.GOLD_ORE];

export function carryStyle(g: number): CarryStyle {
  if (SHOULDER_GOODS.includes(g)) return 'shoulder';
  if (ARMS_GOODS.includes(g)) return 'arms';
  return g === G.WATER ? 'hand' : 'head';
}

/**
 * Rece (i tulow) postaci niosacej towar sposobem st; swing - wymach do kroku (rece wolne go zachowuja). Na glowie
 * obie rece w gorze, na ramieniu prawa trzyma pien, lewa macha; oburacz - rece przed soba, tulow odchylony do tylu;
 * wiadro - prawa reka w dol, odsunieta, tulow przechylony w druga strone.
 */
export function carryArms(p: Pose, st: CarryStyle, swing = 0): void {
  if (st === 'head') {
    // Rece w gorze, lekko zgiete w lokciach - dlonie przytrzymuja towar na glowie.
    p.armL = p.armR = -2.9;
    p.elbowL = p.elbowR = 0.5;
  } else if (st === 'shoulder') {
    // Prawa reka zgieta, dlon na pniu nad barkiem; lewa macha do kroku.
    p.armR = -1.9;
    p.elbowR = 1.4;
    p.armROut = 0.32;
    swingArm(p, -1, swing);
    p.tilt = (p.tilt ?? 0) - 0.05;
  } else if (st === 'arms') {
    // Ramiona w dol, przedramiona poziomo przed piersia - towar na przedramionach i w dloniach.
    p.armL = p.armR = -0.5 + swing * 0.1;
    p.elbowL = p.elbowR = 1.1;
    p.armLOut = p.armROut = 0.12;
    p.lean = (p.lean ?? 0) - 0.08;
  } else {
    p.armR = -swing * 0.25;
    p.elbowR = 0.08;
    p.armROut = 0.2;
    swingArm(p, -1, swing);
    p.tilt = (p.tilt ?? 0) - 0.07;
  }
}

/** Reka wolna przy chodzie (side 1 - prawa, -1 - lewa): wymach i lokiec zgiety mocniej, gdy reka idzie do przodu. */
export function swingArm(p: Pose, side: number, swing: number): void {
  const elbow = 0.18 + Math.max(0, -swing) * 0.5;
  if (side > 0) {
    p.armR = swing;
    p.elbowR = elbow;
  } else {
    p.armL = swing;
    p.elbowL = elbow;
  }
}

/** Polozenie niesionego towaru (macierz instancji) wzgledem stawow postaci narysowanej z towarem sposobem st. */
export function carryMatrix(out: THREE.Matrix4, f: RigFrames, st: CarryStyle): THREE.Matrix4 {
  if (st === 'shoulder') return out.copy(f.torso).multiply(m1.makeTranslation(ARM_X + 0.01, SHOULDER + 0.006, 0)).multiply(m1.makeRotationY(Math.PI / 2));
  if (st === 'arms') return out.copy(f.torso).multiply(m1.makeTranslation(0, SHOULDER - 0.12, 0.1));
  if (st === 'hand') return out.copy(f.armR).multiply(m1.makeTranslation(0, HAND - 0.11, 0));
  return out.copy(f.root).multiply(m1.makeTranslation(0, CARRY_Y, 0));
}

/** Wyglad zawodow: nakrycie glowy (hat_*) i narzedzie w prawej rece (tool_*), wg typu osadnika. */
export const HATS = ['hair', 'cap', 'straw', 'hood', 'feather', 'miner', 'brim', 'miller', 'chef', 'leather', 'explorer', 'sailor', 'kettle', 'beret', 'mask',
  'redhair', 'redcap', 'beanie', 'blackhat', 'bandana', 'bald', 'striped'] as const;
export const TOOLS = ['axe', 'hammer', 'pick', 'shovel', 'scythe', 'rod', 'bow', 'saw', 'rolling_pin', 'cleaver', 'tongs', 'bucket'] as const;
export type Hat = (typeof HATS)[number];
export type Tool = (typeof TOOLS)[number];
export const LOOK: Partial<Record<number, [Hat | null, Tool | null]>> = {
  [S.GENERIC]: ['hair', null], [S.TRANSPORTER]: ['hair', null], [S.SAILOR]: ['sailor', null],
  [S.DIGGER]: ['straw', 'shovel'], [S.BUILDER]: ['leather', 'hammer'], [S.WOODCUTTER]: ['redcap', 'axe'],
  [S.FORESTER]: ['feather', 'shovel'], [S.SAWYER]: ['blackhat', 'saw'], [S.STONECUTTER]: ['bandana', 'pick'],
  [S.MINER]: ['miner', 'pick'], [S.FISHER]: ['beanie', 'rod'], [S.HUNTER]: ['feather', 'bow'],
  [S.FARMER]: ['redhair', 'scythe'], [S.MILLER]: ['miller', null], [S.BAKER]: ['chef', 'rolling_pin'],
  [S.PIGFARMER]: ['redhair', 'bucket'], [S.BUTCHER]: ['striped', 'cleaver'], [S.SMELTER]: ['mask', 'tongs'],
  [S.TOOLMAKER]: ['hair', 'hammer'], [S.WEAPONSMITH]: ['bald', 'hammer'], [S.BOATBUILDER]: ['beanie', 'hammer'],
  [S.GEOLOGIST]: ['explorer', 'hammer'], [S.WELLER]: ['cap', 'bucket'], [S.BREWER]: ['hood', 'bucket'],
  [S.DONKEYBREEDER]: ['straw', null], [S.CHARBURNER]: ['hood', 'shovel'], [S.CATAPULTER]: ['kettle', null],
  [S.MINTER]: ['beret', 'tongs'],
};

/**
 * Ustawienie postaci. Pola opcjonalne maja wartosc 0 / domyslna zawodu.
 * Katy w radianach; przesuniecia w jednostkach modelu (przed skala UNIT_SCALE).
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** obrot wokol pionu: kierunek, w ktorym patrzy postac (atan2(dx, dz)) */
  rot: number;
  owner: number;
  /** typ osadnika (S.*) - nakrycie glowy i domyslne narzedzie */
  type: number;
  /** podskok calej postaci (jednostki swiata) */
  bob?: number;
  /** pochylenie tulowia do przodu wokol bioder (+ = do przodu) */
  lean?: number;
  /** skret tulowia wzgledem nog (+ = przodem ku prawej rece, tej z narzedziem) */
  twist?: number;
  /** przechyl tulowia na bok (+ = ku prawej rece) */
  tilt?: number;
  /**
   * Obnizenie bioder (0..0.09): postac przyklekuje w wykroku - lewa noga do przodu, prawa do tylu,
   * katy nog dobierane tak, zeby stopy zostaly na ziemi (legL/legR dodaja sie do nich).
   */
  crouch?: number;
  /** wymach nog (Rx; ujemny = do przodu) */
  legL?: number;
  legR?: number;
  /** rozkrok: odwiedzenie nog na boki (+ = na zewnatrz) */
  legLOut?: number;
  legROut?: number;
  /** wymach rak (Rx; ujemny = do przodu, -PI/2 = poziomo przed soba, -PI = pionowo w gore) */
  armL?: number;
  armR?: number;
  /** zgiecie lokcia (+ = przedramie do przodu, ku piersi); 0 - reka prosta */
  elbowL?: number;
  elbowR?: number;
  /** odwiedzenie rak na boki (+ = na zewnatrz) */
  armLOut?: number;
  armROut?: number;
  /** obrot reki wokol pionu w barku (+ = ku prawej rece); dziala na reke uniesiona do przodu (zamiatanie, siew) */
  armLYaw?: number;
  armRYaw?: number;
  /** pochylenie glowy (+ = w dol) i skret glowy (+ = ku prawej rece) */
  head?: number;
  headTurn?: number;
  /** narzedzie w prawej rece: model (np. 'tool_hammer', dowolny rekwizyt z poczatkiem w barku), null = nic,
   *  undefined = narzedzie zawodu */
  tool?: string | null;
  /** obrot narzedzia wokol osi reki */
  toolRoll?: number;
  /** rekwizyt w lewej rece (model z poczatkiem w barku, jak narzedzia) */
  toolL?: string | null;
  toolLRoll?: number;
  /** towar niesiony na glowie albo -1 */
  carry?: number;
  /** czapka zawodu (domyslnie tak) */
  hat?: boolean;
}

/** Macierze stawow ostatnio narysowanej postaci (uklad swiata). */
export interface RigFrames {
  /** stopy: pozycja i obrot postaci, ze skala UNIT_SCALE */
  root: THREE.Matrix4;
  /** tulow: poczatek na ziemi pod biodrami (jak model tulowia), pochylony z tulowiem */
  torso: THREE.Matrix4;
  /** glowa (uklad jak model glowy: poczatek na ziemi) */
  head: THREE.Matrix4;
  /** przedramie prawe / lewe: uklad barku obrocony o zgiecie lokcia - dlon w (0, HAND, 0) */
  armR: THREE.Matrix4;
  armL: THREE.Matrix4;
}

const m1 = new THREE.Matrix4();
const v1 = new THREE.Vector3();

export class Rig {
  readonly frames: RigFrames = {
    root: new THREE.Matrix4(), torso: new THREE.Matrix4(), head: new THREE.Matrix4(),
    armR: new THREE.Matrix4(), armL: new THREE.Matrix4(),
  };
  /** Rysowac czapki i narzedzia (tylko przy przyblizeniu - z daleka i tak niewidoczne). */
  details = true;
  readonly torsoL: InstancedLayer;
  readonly headL: InstancedLayer;
  readonly legL: InstancedLayer;
  readonly upperArm: InstancedLayer;
  readonly foreArm: InstancedLayer;
  readonly helmet: InstancedLayer;
  readonly shield: InstancedLayer;
  readonly sword: InstancedLayer;
  private hats = new Map<string, InstancedLayer>();
  private extra: (name: string) => InstancedLayer;
  private m = new THREE.Matrix4();
  private hip = new THREE.Matrix4();
  private tmpColor = new THREE.Color();
  private colors: readonly number[];

  /** layer(nazwa, kolor gracza?) tworzy warstwe; extra(nazwa) daje warstwe rekwizytu (narzedzia z puli rekwizytow). */
  constructor(layer: (name: string, cap: number, color?: boolean) => InstancedLayer, extra: (name: string) => InstancedLayer, colors: readonly number[]) {
    this.torsoL = layer('serf_torso', 512, true);
    this.headL = layer('serf_head', 512);
    this.legL = layer('serf_leg', 1024);
    this.upperArm = layer('serf_upperarm', 1024, true); // rekawy koszulki w kolorze gracza
    this.foreArm = layer('serf_forearm', 1024);
    this.helmet = layer('knight_helmet', 64);
    this.shield = layer('knight_shield', 64);
    this.sword = layer('knight_sword', 64);
    for (const h of HATS) this.hats.set(h, layer(`hat_${h}`, h === 'hair' ? 256 : 32));
    this.extra = extra;
    this.colors = colors;
  }

  layers(): InstancedLayer[] {
    return [this.torsoL, this.headL, this.legL, this.upperArm, this.foreArm, this.helmet, this.shield, this.sword, ...this.hats.values()];
  }

  private color(owner: number): THREE.Color {
    return this.tmpColor.setHex(this.colors[owner % this.colors.length]);
  }

  /** Rysuje postac w pozie p; macierze stawow zostaja w `frames`. */
  figure(p: Pose): RigFrames {
    const f = this.frames;
    const c = this.color(p.owner);
    // Stopy.
    f.root.makeTranslation(p.x, p.y + (p.bob ?? 0), p.z).multiply(m1.makeRotationY(p.rot)).multiply(m1.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
    // Biodra (przysiad: obnizone, nogi w wykroku tak, by stopy zostaly na ziemi).
    const crouch = Math.max(0, Math.min(0.09, p.crouch ?? 0));
    const kneel = crouch > 0 ? Math.acos(Math.max(0.2, (LEG - crouch) / LEG)) : 0;
    this.hip.copy(f.root).multiply(m1.makeTranslation(0, HIP - crouch, 0));
    this.limb(this.legL, this.hip, -0.035, 0, -(p.legLOut ?? 0), (p.legL ?? 0) - kneel, 0);
    this.limb(this.legL, this.hip, 0.035, 0, p.legROut ?? 0, (p.legR ?? 0) + kneel * 0.8, 0);
    // Tulow: pochylenie wokol bioder (model tulowia ma poczatek na ziemi).
    f.torso.copy(this.hip);
    if (p.twist) f.torso.multiply(m1.makeRotationY(p.twist));
    if (p.lean) f.torso.multiply(m1.makeRotationX(p.lean));
    if (p.tilt) f.torso.multiply(m1.makeRotationZ(-p.tilt));
    f.torso.multiply(m1.makeTranslation(0, -HIP, 0));
    this.torsoL.color(this.torsoL.pushMatrix(f.torso), c.r, c.g, c.b);
    // Glowa i nakrycie glowy (modele z poczatkiem na ziemi, obrot wokol szyi).
    f.head.copy(f.torso);
    if (p.head || p.headTurn) {
      f.head.multiply(m1.makeTranslation(0, NECK, 0));
      if (p.headTurn) f.head.multiply(m1.makeRotationY(p.headTurn));
      if (p.head) f.head.multiply(m1.makeRotationX(p.head));
      f.head.multiply(m1.makeTranslation(0, -NECK, 0));
    }
    this.headL.pushMatrix(f.head);
    // Rece: bark -> obrot w pionie (yaw) -> odwiedzenie (Rz) -> wymach (Rx); ramie w ukladzie barku, przedramie
    // z dlonia obrocone wokol lokcia.
    for (const [out, x, yaw, abd, swing, elbow] of [
      [f.armR, ARM_X, p.armRYaw ?? 0, p.armROut ?? 0, p.armR ?? 0, p.elbowR ?? 0],
      [f.armL, -ARM_X, p.armLYaw ?? 0, -(p.armLOut ?? 0), p.armL ?? 0, p.elbowL ?? 0],
    ] as const) {
      this.arm(out, f.torso, x, yaw, abd, swing);
      this.upperArm.color(this.upperArm.pushMatrix(out), c.r, c.g, c.b);
      if (elbow) out.multiply(m1.makeTranslation(0, ELBOW, 0)).multiply(m1.makeRotationX(-elbow)).multiply(m1.makeTranslation(0, -ELBOW, 0));
      this.foreArm.pushMatrix(out);
    }
    const look = LOOK[p.type];
    if (this.details) {
      const hat = look?.[0];
      if (hat && p.hat !== false) this.hats.get(hat)!.pushMatrix(f.head);
      const tool = p.tool === undefined ? (look?.[1] ? `tool_${look[1]}` : null) : p.tool;
      if (tool) this.attach(tool, f.armR, p.toolRoll ?? 0);
      if (p.toolL) this.attach(p.toolL, f.armL, p.toolLRoll ?? 0);
    }
    if (p.type === S.KNIGHT) {
      this.helmet.pushMatrix(f.head);
      this.shield.pushMatrix(f.torso);
      this.sword.pushMatrix(f.armR);
    }
    return f;
  }

  /** Rekwizyt z poczatkiem w barku (narzedzie) w ukladzie reki, obrocony wokol osi reki. */
  private attach(name: string, arm: THREE.Matrix4, roll: number): void {
    this.m.copy(arm);
    if (roll) this.m.multiply(m1.makeRotationY(roll));
    this.extra(name).pushMatrix(this.m);
  }

  private arm(out: THREE.Matrix4, torso: THREE.Matrix4, x: number, yaw: number, abd: number, swing: number): void {
    out.copy(torso).multiply(m1.makeTranslation(x, SHOULDER, 0));
    if (yaw) out.multiply(m1.makeRotationY(yaw));
    if (abd) out.multiply(m1.makeRotationZ(abd));
    if (swing) out.multiply(m1.makeRotationX(swing));
  }

  private limb(layer: InstancedLayer, base: THREE.Matrix4, x: number, y: number, abd: number, swing: number, z: number): void {
    this.m.copy(base).multiply(m1.makeTranslation(x, y, z));
    if (abd) this.m.multiply(m1.makeRotationZ(abd));
    if (swing) this.m.multiply(m1.makeRotationX(swing));
    layer.pushMatrix(this.m);
  }

  /** Punkt w ukladzie stawu (np. dlon: frames.armR, (0, HAND, 0)) w swiecie. */
  static point(frame: THREE.Matrix4, x: number, y: number, z: number, out = v1): THREE.Vector3 {
    return out.set(x, y, z).applyMatrix4(frame);
  }
}
