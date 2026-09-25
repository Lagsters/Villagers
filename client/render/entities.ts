/**
 * Dynamiczne encje: budynki, place budowy, skrzydla wiatrakow, flagi z towarami, osadnicy
 * (skladani z czesci animowanych w kodzie), zwierzeta, pozary i granice. Wszystko na InstancedMesh.
 */
import * as THREE from 'three';
import { BUILDINGS, B, GOODS_COUNT, O, S, SIZE, PLAYER_COLORS } from '../../sim/defs.ts';
import { STAGE, FLAG_SLOTS, type Building, type GameState, type Serf } from '../../sim/types.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';

const tmpColor = new THREE.Color();

function playerColor(p: number): THREE.Color {
  return tmpColor.setHex(PLAYER_COLORS[p % PLAYER_COLORS.length]);
}

/** Przesuniecie srodka duzego budynku (zajmuje pola W, NW, NE). */
const LARGE_OFF_X = -0.25;
const LARGE_OFF_Z = -0.43;
/** Budynki sa obrocone o 30 stopni (drzwi na flage). */
const BROT = Math.PI / 6;
const COS30 = Math.cos(BROT);
const SIN30 = Math.sin(BROT);

/** Punkt lokalny modelu budynku (uklad Blendera x, y) -> przesuniecie w swiecie (x, z). */
function local(lx: number, ly: number): [number, number] {
  const rx = lx * COS30 - ly * SIN30;
  const ry = lx * SIN30 + ly * COS30;
  return [rx, -ry];
}

/** Szczyt masztu flagi na budynkach wojskowych i zamku: [lx, ly, wysokosc]. */
const BANNER: Record<number, [number, number, number]> = {
  [B.CASTLE]: [0, 0.1, 1.37],
  [B.GUARDHUT]: [0, 0.05, 0.73],
  [B.TOWER]: [0, 0, 1.06],
  [B.FORTRESS]: [0, 0.08, 1.26],
  [B.GUARDHOUSE]: [0, 0, 0.68],
};
const MILL_HUB = local(0, -0.2);

const HIP = 0.14;
const SHOULDER = 0.31;
/** Jednostki nieco wieksze niz w skali budynkow - czytelnosc z kamery izometrycznej. */
const UNIT_SCALE = 1.25;

export class EntitiesRenderer {
  readonly group = new THREE.Group();
  private buildingLayers: InstancedLayer[] = [];
  private sites: InstancedLayer[];
  private sails: InstancedLayer;
  private fire: InstancedLayer;
  private flagPole: InstancedLayer;
  private flagCloth: InstancedLayer;
  private goods: InstancedLayer[] = [];
  private torso: InstancedLayer;
  private head: InstancedLayer;
  private leg: InstancedLayer;
  private arm: InstancedLayer;
  private helmet: InstancedLayer;
  private shield: InstancedLayer;
  private sword: InstancedLayer;
  private donkey: InstancedLayer;
  private border: InstancedLayer;
  private animals: InstancedLayer;
  private material: THREE.Material;
  private lastOwner: Uint8Array | null = null;
  private borderDirty = true;
  private time = 0;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private m3 = new THREE.Matrix4();
  /** Prostokat widocznosci (swiat x/z) - encje poza nim nie sa rysowane. */
  private vis = { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Wyznacza prostokat widocznosci: rzut naroznikow ekranu na plaszczyzny terenu (y = 0 i y = 7). */
  setView(camera: THREE.Camera): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const h of [0, 7]) {
      this.plane.constant = -h;
      for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        this.ndc.set(nx, ny);
        this.ray.setFromCamera(this.ndc, camera);
        if (!this.ray.ray.intersectPlane(this.plane, this.hit)) continue;
        x0 = Math.min(x0, this.hit.x); x1 = Math.max(x1, this.hit.x);
        z0 = Math.min(z0, this.hit.z); z1 = Math.max(z1, this.hit.z);
      }
    }
    const M = 1.5;
    this.vis = Number.isFinite(x0) ? { x0: x0 - M, x1: x1 + M, z0: z0 - M, z1: z1 + M } : { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  }

  private inView(x: number, z: number): boolean {
    const v = this.vis;
    return x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1;
  }

  constructor(material: THREE.Material) {
    this.material = material;
    for (let k = 0; k < BUILDINGS.length; k++) this.buildingLayers.push(this.layer(`building_${k}`, 16));
    this.sites = ['site_small', 'site_medium', 'site_large'].map((n) => this.layer(n, 16));
    this.sails = this.layer('mill_sails', 8);
    this.fire = this.layer('fire', 16);
    this.flagPole = this.layer('flag', 256);
    this.flagCloth = this.layer('flag_cloth', 256, true);
    for (let g = 0; g < GOODS_COUNT; g++) this.goods.push(this.layer(`good_${g}`, 32));
    this.torso = this.layer('serf_torso', 512, true);
    this.head = this.layer('serf_head', 512);
    this.leg = this.layer('serf_leg', 1024);
    this.arm = this.layer('serf_arm', 1024, true);
    this.helmet = this.layer('knight_helmet', 64);
    this.shield = this.layer('knight_shield', 64);
    this.sword = this.layer('knight_sword', 64);
    this.donkey = this.layer('donkey', 32);
    this.border = this.layer('border', 1024, true);
    this.animals = this.layer('animal', 64);
  }

  private layer(model: string, cap: number, color = false): InstancedLayer {
    return new InstancedLayer(this.group, getModel(model), this.material, cap, color);
  }

  private wp(s: GameState, i: number, out: THREE.Vector3): THREE.Vector3 {
    const x = i % s.map.w, y = (i / s.map.w) | 0;
    return out.set(vx(x, y), s.map.height[i] * H_SCALE, vz(y));
  }

  update(s: GameState, alpha: number, dt: number): void {
    this.time += dt;
    for (const g of this.goods) g.begin();
    this.updateBuildings(s);
    this.updateFlags(s);
    this.updateSerfs(s, alpha);
    this.updateAnimals(s, alpha);
    for (const g of this.goods) g.end();
    this.updateBorders(s);
  }

  private pushGood(g: number, x: number, y: number, z: number, rot: number, scale = 1): void {
    if (g >= 0 && g < GOODS_COUNT) this.goods[g].push(x, y, z, rot, scale);
  }

  private updateBuildings(s: GameState): void {
    for (const l of this.buildingLayers) l.begin();
    for (const l of this.sites) l.begin();
    this.sails.begin();
    this.fire.begin();
    this.flagCloth.begin();
    this.flagPole.begin();
    const p = new THREE.Vector3();
    for (const b of s.buildings) {
      if (!b) continue;
      this.wp(s, b.pos, p);
      const def = BUILDINGS[b.kind];
      let ox = 0, oz = 0;
      if (def.size === SIZE.LARGE) { ox = LARGE_OFF_X; oz = LARGE_OFF_Z; }
      const layer = this.buildingLayers[b.kind];
      const bx = p.x + ox, bz = p.z + oz;
      if (!this.inView(bx, bz)) continue;
      if (b.stage === STAGE.DONE) {
        layer.push(bx, p.y, bz, 0, 1);
        this.decorate(b, bx, p.y, bz);
      } else if (b.stage === STAGE.BURN) {
        const k = b.burn / 150;
        layer.push(bx, p.y - (1 - k) * 0.3, bz, 0, 1, Math.max(0.15, k));
        const flicker = 0.85 + Math.sin(this.time * 17 + b.id) * 0.15;
        this.fire.push(bx, p.y, bz, this.time * 2, flicker * (0.6 + k * 0.6));
      } else {
        const si = def.size === SIZE.LARGE ? 2 : def.size === SIZE.MEDIUM ? 1 : 0;
        this.sites[si].push(bx, p.y, bz);
        const total = def.planks + def.stones;
        const done = total > 0 ? (b.planksUsed + b.stonesUsed) / total : 0;
        if (done > 0) layer.push(bx, p.y, bz, 0, 1, Math.max(0.05, done));
        // Materialy lezace na placu.
        for (let i = 0; i < Math.min(3, b.planks); i++) this.pushGood(9, bx - 0.2, p.y + i * 0.02, bz + 0.25, 0);
        for (let i = 0; i < Math.min(3, b.stones); i++) this.pushGood(11, bx + 0.2, p.y + i * 0.07, bz + 0.25, 0.3);
      }
    }
    for (const l of this.buildingLayers) l.end();
    for (const l of this.sites) l.end();
    this.sails.end();
    this.fire.end();
  }

  /** Dodatki gotowych budynkow: skrzydla wiatraka, flaga gracza. */
  private decorate(b: Building, x: number, y: number, z: number): void {
    if (b.kind === B.MILL) {
      const spin = b.phase !== 0 ? this.time * 2.2 : this.time * 0.3;
      this.m.makeTranslation(x + MILL_HUB[0], y + 0.55, z + MILL_HUB[1]);
      this.m2.makeRotationY(BROT);
      this.m3.makeRotationZ(spin + b.id);
      this.m.multiply(this.m2).multiply(this.m3);
      this.sails.pushMatrix(this.m);
    }
    const ban = BANNER[b.kind];
    if (ban && (b.kind === B.CASTLE || b.knights.length > 0)) {
      const [ox, oz] = local(ban[0], ban[1]);
      const wave = Math.sin(this.time * 4 + b.id) * 0.3;
      const ci = this.flagCloth.push(x + ox, y + ban[2] - 0.52, z + oz, wave);
      const c = playerColor(b.owner);
      this.flagCloth.color(ci, c.r, c.g, c.b);
    }
  }

  private updateFlags(s: GameState): void {
    const p = new THREE.Vector3();
    for (const f of s.flags) {
      if (!f) continue;
      this.wp(s, f.pos, p);
      if (!this.inView(p.x, p.z)) continue;
      this.flagPole.push(p.x, p.y, p.z);
      const wave = Math.sin(this.time * 4 + f.id) * 0.3;
      const ci = this.flagCloth.push(p.x, p.y, p.z, wave);
      const c = playerColor(f.owner);
      this.flagCloth.color(ci, c.r, c.g, c.b);
      for (let i = 0; i < FLAG_SLOTS; i++) {
        const g = f.slotGood[i];
        if (g < 0) continue;
        const a = (i / FLAG_SLOTS) * Math.PI * 2;
        this.pushGood(g, p.x + Math.cos(a) * 0.2, p.y + 0.01, p.z + Math.sin(a) * 0.2, a + 1.2);
      }
    }
    this.flagPole.end();
    this.flagCloth.end();
  }

  /** Czesc osadnika: T(pos) * Ry(obrot) * T(przesuniecie) * Rx(kat). */
  private part(layer: InstancedLayer, x: number, y: number, z: number, rot: number, ox: number, oy: number, oz: number, swing: number): number {
    this.m.makeTranslation(x, y, z);
    this.m.multiply(this.m2.makeRotationY(rot));
    this.m.multiply(this.m2.makeScale(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE));
    this.m.multiply(this.m2.makeTranslation(ox, oy, oz));
    if (swing) this.m.multiply(this.m3.makeRotationX(swing));
    return layer.pushMatrix(this.m);
  }

  private updateSerfs(s: GameState, alpha: number): void {
    const layers = [this.torso, this.head, this.leg, this.arm, this.helmet, this.shield, this.sword, this.donkey];
    for (const l of layers) l.begin();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const serf of s.serfs) {
      if (!serf) continue;
      this.wp(s, serf.pos, a);
      if (!this.inView(a.x, a.z) || !this.visible(s, serf)) continue;
      let rot: number;
      let bob = 0;
      let walk = 0;
      if (serf.to >= 0) {
        this.wp(s, serf.to, b);
        const t = Math.min(1, (serf.t + alpha) / Math.max(1, serf.dur));
        rot = Math.atan2(b.x - a.x, b.z - a.z);
        a.lerp(b, t);
        walk = t * Math.PI * 2;
        bob = Math.abs(Math.sin(walk)) * 0.02;
      } else {
        rot = (serf.id * 1.3) % (Math.PI * 2);
      }
      if (serf.type === S.DONKEY) {
        this.donkey.push(a.x, a.y + bob, a.z, rot, 1.1 * UNIT_SCALE);
        if (serf.carry >= 0) this.pushGood(serf.carry, a.x, a.y + 0.34 * UNIT_SCALE + bob, a.z, rot, UNIT_SCALE);
        continue;
      }
      let legSwing = walk ? Math.sin(walk) * 0.6 : 0;
      let armL = walk ? -Math.sin(walk) * 0.5 : 0;
      let armR = -armL;
      if (serf.anim === 1) {
        // Praca: rytmiczne machanie rekami.
        const w = Math.sin(this.time * 9 + serf.id);
        armR = -1.2 + w * 0.8;
        armL = -0.6 - w * 0.4;
        legSwing = 0;
      } else if (serf.anim === 2) {
        // Pojedynek: zwrot do przeciwnika i zamach mieczem.
        const opp = serf.sub >= 0 ? s.serfs[serf.sub] : null;
        if (opp) {
          this.wp(s, opp.pos, b);
          if (opp.pos !== serf.pos) rot = Math.atan2(b.x - a.x, b.z - a.z);
          else a.x += serf.home === serf.target ? 0.12 : -0.12;
        }
        const w = Math.sin(this.time * 10 + serf.id);
        armR = -1.8 - w;
        armL = -0.5;
        legSwing = w * 0.2;
      }
      const carrying = serf.carry >= 0;
      if (carrying) {
        armL = Math.PI;
        armR = Math.PI;
      }
      const y = a.y + bob;
      const c = playerColor(serf.owner);
      const ti = this.part(this.torso, a.x, y, a.z, rot, 0, 0, 0, 0);
      this.torso.color(ti, c.r, c.g, c.b);
      this.part(this.head, a.x, y, a.z, rot, 0, 0, 0, 0);
      this.part(this.leg, a.x, y, a.z, rot, -0.035, HIP, 0, legSwing);
      this.part(this.leg, a.x, y, a.z, rot, 0.035, HIP, 0, -legSwing);
      const li = this.part(this.arm, a.x, y, a.z, rot, -0.09, SHOULDER, 0, armL);
      const ri = this.part(this.arm, a.x, y, a.z, rot, 0.09, SHOULDER, 0, armR);
      this.arm.color(li, c.r, c.g, c.b);
      this.arm.color(ri, c.r, c.g, c.b);
      if (serf.type === S.KNIGHT) {
        this.part(this.helmet, a.x, y, a.z, rot, 0, 0, 0, 0);
        this.part(this.shield, a.x, y, a.z, rot, 0, 0, 0, 0);
        this.part(this.sword, a.x, y, a.z, rot, 0.09, SHOULDER, 0, armR);
      }
      if (carrying) this.pushGood(serf.carry, a.x, y + 0.47 * UNIT_SCALE, a.z, rot, UNIT_SCALE);
    }
    for (const l of layers) l.end();
  }

  private updateAnimals(s: GameState, alpha: number): void {
    this.animals.begin();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const an of s.animals) {
      if (!an) continue;
      this.wp(s, an.pos, a);
      if (!this.inView(a.x, a.z)) continue;
      let rot = an.id * 1.7;
      if (an.to >= 0) {
        this.wp(s, an.to, b);
        rot = Math.atan2(b.x - a.x, b.z - a.z);
        a.lerp(b, Math.min(1, (an.t + alpha) / Math.max(1, an.dur)));
      }
      this.animals.push(a.x, a.y, a.z, rot, UNIT_SCALE);
    }
    this.animals.end();
  }

  /** Osadnicy w srodku gotowego budynku sa niewidoczni. */
  private visible(s: GameState, serf: Serf): boolean {
    if (serf.to >= 0) return true;
    if (s.map.obj[serf.pos] === O.BUILDING) {
      const bld = s.buildings[s.map.objId[serf.pos]];
      return !!bld && bld.stage !== STAGE.DONE;
    }
    return true;
  }

  /** Pola graniczne (x, z, wlasciciel) - przeliczane tylko po zmianie terytorium. */
  private borderCells: number[] = [];
  private bordersDrawnFor = '';

  /** Slupki graniczne na polach, ktorych sasiad nalezy do kogos innego (tylko w kadrze). */
  private updateBorders(s: GameState): void {
    const owner = s.map.owner;
    if (!this.lastOwner || this.lastOwner.length !== owner.length) {
      this.lastOwner = new Uint8Array(owner);
      this.borderDirty = true;
    } else if (s.tick % 5 === 0) {
      for (let i = 0; i < owner.length; i++) {
        if (owner[i] !== this.lastOwner[i]) {
          this.lastOwner.set(owner);
          this.borderDirty = true;
          break;
        }
      }
    }
    if (this.borderDirty) {
      this.borderDirty = false;
      const m = s.map;
      const cells: number[] = [];
      for (let y = 1; y < m.h - 1; y++) {
        for (let x = 1; x < m.w - 1; x++) {
          const i = y * m.w + x;
          const o = owner[i];
          if (o === 0) continue;
          const odd = y & 1;
          const nbs = [i + 1, (y + 1) * m.w + x + odd, (y + 1) * m.w + x - 1 + odd, i - 1, (y - 1) * m.w + x - 1 + odd, (y - 1) * m.w + x + odd];
          for (const j of nbs) {
            if (owner[j] !== o) {
              cells.push(vx(x, y), m.height[i] * H_SCALE, vz(y), o - 1);
              break;
            }
          }
        }
      }
      this.borderCells = cells;
      this.bordersDrawnFor = '';
    }
    const v = this.vis;
    const key = `${v.x0.toFixed(1)},${v.x1.toFixed(1)},${v.z0.toFixed(1)},${v.z1.toFixed(1)},${this.borderCells.length}`;
    if (key === this.bordersDrawnFor) return;
    this.bordersDrawnFor = key;
    this.border.begin();
    const c = this.borderCells;
    for (let k = 0; k < c.length; k += 4) {
      if (!this.inView(c[k], c[k + 2])) continue;
      const bi = this.border.push(c[k], c[k + 1], c[k + 2]);
      const col = playerColor(c[k + 3]);
      this.border.color(bi, col.r, col.g, col.b);
    }
    this.border.end();
  }
}
