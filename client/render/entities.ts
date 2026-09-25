/**
 * Dynamiczne encje: budynki, flagi (z towarami), osadnicy (z interpolacja miedzy tickami),
 * pozary i granice terytorium. Wszystko na InstancedMesh: jeden draw call na rodzaj modelu.
 */
import * as THREE from 'three';
import { BUILDINGS, B, O, S, SIZE, PLAYER_COLORS, isMine } from '../../sim/defs.ts';
import { STAGE, FLAG_SLOTS, type Building, type GameState, type Serf } from '../../sim/types.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';
import { GOOD_COLORS } from './palette.ts';

const tmpColor = new THREE.Color();

function playerColor(p: number): THREE.Color {
  return tmpColor.setHex(PLAYER_COLORS[p % PLAYER_COLORS.length]);
}

function modelForBuilding(kind: number): string {
  switch (kind) {
    case B.CASTLE: return 'building_castle';
    case B.WAREHOUSE: return 'building_warehouse';
    case B.GUARDHUT: return 'building_guardhut';
    case B.TOWER: return 'building_tower';
    case B.FORTRESS: return 'building_fortress';
  }
  if (isMine(kind)) return 'building_mine';
  if (BUILDINGS[kind].size === SIZE.LARGE) return 'building_large';
  return `building_${kind}`;
}

/** Przesuniecie srodka duzego budynku (zajmuje pola W, NW, NE). */
const LARGE_OFF_X = -0.25;
const LARGE_OFF_Z = -0.43;

export class EntitiesRenderer {
  readonly group = new THREE.Group();
  private buildingLayers = new Map<string, InstancedLayer>();
  private site: InstancedLayer;
  private fire: InstancedLayer;
  private flagPole: InstancedLayer;
  private flagCloth: InstancedLayer;
  private goods: InstancedLayer;
  private serfBody: InstancedLayer;
  private serfHead: InstancedLayer;
  private knightHead: InstancedLayer;
  private border: InstancedLayer;
  private animals: InstancedLayer;
  private material: THREE.Material;
  private lastOwner: Uint8Array | null = null;
  private borderDirty = true;
  private time = 0;

  constructor(material: THREE.Material) {
    this.material = material;
    this.site = this.layer('site', 64);
    this.fire = this.layer('fire', 16);
    this.flagPole = this.layer('flag', 256);
    this.flagCloth = this.layer('flag_cloth', 256, true);
    this.goods = this.layer('good', 512, true);
    this.serfBody = this.layer('serf_body', 512, true);
    this.serfHead = this.layer('serf_head', 512);
    this.knightHead = this.layer('knight_head', 64);
    this.border = this.layer('border', 1024, true);
    this.animals = this.layer('animal', 64);
  }

  private layer(model: string, cap: number, color = false): InstancedLayer {
    return new InstancedLayer(this.group, getModel(model), this.material, cap, color);
  }

  private buildingLayer(model: string): InstancedLayer {
    let l = this.buildingLayers.get(model);
    if (!l) {
      l = this.layer(model, 16);
      this.buildingLayers.set(model, l);
    }
    return l;
  }

  /** Swiatowa pozycja pola. */
  private wp(s: GameState, i: number, out: THREE.Vector3): THREE.Vector3 {
    const x = i % s.map.w, y = (i / s.map.w) | 0;
    return out.set(vx(x, y), s.map.height[i] * H_SCALE, vz(y));
  }

  update(s: GameState, alpha: number, dt: number): void {
    this.time += dt;
    this.updateBuildings(s);
    this.updateFlags(s);
    this.updateSerfs(s, alpha);
    this.updateAnimals(s, alpha);
    this.updateBorders(s);
  }

  private updateAnimals(s: GameState, alpha: number): void {
    this.animals.begin();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const an of s.animals) {
      if (!an) continue;
      this.wp(s, an.pos, a);
      let rot = an.id * 1.7;
      if (an.to >= 0) {
        this.wp(s, an.to, b);
        rot = Math.atan2(b.x - a.x, b.z - a.z);
        a.lerp(b, Math.min(1, (an.t + alpha) / Math.max(1, an.dur)));
      }
      this.animals.push(a.x, a.y, a.z, rot);
    }
    this.animals.end();
  }

  private updateBuildings(s: GameState): void {
    for (const l of this.buildingLayers.values()) l.begin();
    this.site.begin();
    this.fire.begin();
    const p = new THREE.Vector3();
    for (const b of s.buildings) {
      if (!b) continue;
      this.wp(s, b.pos, p);
      const def = BUILDINGS[b.kind];
      let ox = 0, oz = 0;
      if (def.size === SIZE.LARGE) { ox = LARGE_OFF_X; oz = LARGE_OFF_Z; }
      const model = modelForBuilding(b.kind);
      if (b.stage === STAGE.DONE) {
        this.buildingLayer(model).push(p.x + ox, p.y, p.z + oz, 0, 1);
      } else if (b.stage === STAGE.BURN) {
        const k = b.burn / 150;
        this.buildingLayer(model).push(p.x + ox, p.y - (1 - k) * 0.3, p.z + oz, 0, 1, Math.max(0.15, k));
        const flicker = 0.85 + Math.sin(this.time * 17 + b.id) * 0.15;
        this.fire.push(p.x + ox, p.y, p.z + oz, this.time * 2, flicker * (0.6 + k * 0.6));
      } else {
        this.site.push(p.x + ox, p.y, p.z + oz, 0, def.size === SIZE.LARGE ? 1.6 : 1);
        const total = def.planks + def.stones;
        const done = total > 0 ? (b.planksUsed + b.stonesUsed) / total : 0;
        if (done > 0) this.buildingLayer(model).push(p.x + ox, p.y, p.z + oz, 0, 1, Math.max(0.05, done));
      }
    }
    for (const l of this.buildingLayers.values()) l.end();
    this.site.end();
    this.fire.end();
  }

  private updateFlags(s: GameState): void {
    this.flagPole.begin();
    this.flagCloth.begin();
    this.goods.begin();
    const p = new THREE.Vector3();
    for (const f of s.flags) {
      if (!f) continue;
      this.wp(s, f.pos, p);
      this.flagPole.push(p.x, p.y, p.z);
      const wave = Math.sin(this.time * 4 + f.id) * 0.3;
      const ci = this.flagCloth.push(p.x, p.y, p.z, wave);
      const c = playerColor(f.owner);
      this.flagCloth.color(ci, c.r, c.g, c.b);
      // Towary ulozone w dwoch rzedach wokol masztu.
      for (let i = 0; i < FLAG_SLOTS; i++) {
        const g = f.slotGood[i];
        if (g < 0) continue;
        const a = (i / FLAG_SLOTS) * Math.PI * 2;
        const gi = this.goods.push(p.x + Math.cos(a) * 0.22, p.y + 0.04, p.z + Math.sin(a) * 0.22, a);
        const gc = GOOD_COLORS[g];
        this.goods.color(gi, gc[0], gc[1], gc[2]);
      }
    }
  }

  private updateSerfs(s: GameState, alpha: number): void {
    this.serfBody.begin();
    this.serfHead.begin();
    this.knightHead.begin();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const serf of s.serfs) {
      if (!serf) continue;
      if (!this.visible(s, serf)) continue;
      this.wp(s, serf.pos, a);
      let rot = 0;
      let bob = 0;
      if (serf.to >= 0) {
        this.wp(s, serf.to, b);
        const t = Math.min(1, (serf.t + alpha) / Math.max(1, serf.dur));
        rot = Math.atan2(b.x - a.x, b.z - a.z);
        a.lerp(b, t);
        bob = Math.abs(Math.sin(t * Math.PI * 2)) * 0.03;
      } else if (serf.anim === 1) {
        bob = Math.abs(Math.sin(this.time * 8 + serf.id)) * 0.04;
        rot = serf.id;
      }
      const scale = serf.type === S.DONKEY ? 1.2 : 1;
      const bi = this.serfBody.push(a.x, a.y + bob, a.z, rot, scale);
      if (serf.type === S.DONKEY) this.serfBody.color(bi, 0.55, 0.5, 0.45);
      else {
        const c = playerColor(serf.owner);
        this.serfBody.color(bi, c.r, c.g, c.b);
      }
      if (serf.type === S.KNIGHT) this.knightHead.push(a.x, a.y + bob, a.z, rot, scale);
      else this.serfHead.push(a.x, a.y + bob, a.z, rot, scale);
      if (serf.carry >= 0) {
        const gi = this.goods.push(a.x, a.y + bob + 0.46, a.z, rot);
        const gc = GOOD_COLORS[serf.carry];
        this.goods.color(gi, gc[0], gc[1], gc[2]);
      }
    }
    this.serfBody.end();
    this.serfHead.end();
    this.knightHead.end();
    this.goods.end();
    this.flagPole.end();
    this.flagCloth.end();
  }

  /** Osadnicy w srodku budynku sa niewidoczni. */
  private visible(s: GameState, serf: Serf): boolean {
    if (serf.to >= 0) return true;
    const o = s.map.obj[serf.pos];
    if (o === O.BUILDING) {
      const bld: Building | null = s.buildings[s.map.objId[serf.pos]];
      // Budowniczy i kopacz stoja przy placu - widoczni.
      if (bld && bld.stage !== STAGE.DONE) return true;
      return false;
    }
    return true;
  }

  /** Slupki graniczne na polach, ktorych sasiad nalezy do kogos innego. */
  private updateBorders(s: GameState): void {
    const owner = s.map.owner;
    if (!this.lastOwner || this.lastOwner.length !== owner.length) {
      this.lastOwner = new Uint8Array(owner);
      this.borderDirty = true;
    } else {
      for (let i = 0; i < owner.length; i++) {
        if (owner[i] !== this.lastOwner[i]) {
          this.lastOwner.set(owner);
          this.borderDirty = true;
          break;
        }
      }
    }
    if (!this.borderDirty) return;
    this.borderDirty = false;
    const m = s.map;
    this.border.begin();
    for (let y = 1; y < m.h - 1; y++) {
      for (let x = 1; x < m.w - 1; x++) {
        const i = y * m.w + x;
        const o = owner[i];
        if (o === 0) continue;
        // Sasiedzi E, SE, SW - wystarczy sprawdzic polowe kierunkow i postawic slupek w polowie krawedzi.
        const odd = y & 1;
        const nbs = [i + 1, (y + 1) * m.w + x + odd, (y + 1) * m.w + x - 1 + odd, i - 1, (y - 1) * m.w + x - 1 + odd, (y - 1) * m.w + x + odd];
        let border = false;
        for (const j of nbs) if (owner[j] !== o) { border = true; break; }
        if (!border) continue;
        const bi = this.border.push(vx(x, y), m.height[i] * H_SCALE, vz(y));
        const c = playerColor(o - 1);
        this.border.color(bi, c.r, c.g, c.b);
      }
    }
    this.border.end();
  }
}
