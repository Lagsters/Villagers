/**
 * Dynamiczne encje: budynki, place budowy, flagi z towarami, osadnicy (skladani z czesci animowanych
 * w kodzie, rig.ts), zwierzeta, pozary i granice. Wszystko na InstancedMesh.
 * Prace zawodow (postacie przed budynkami, rekwizyty, czasteczki) rysuja sceny z client/render/work/.
 */
import * as THREE from 'three';
import { BUILDINGS, B, GOODS_COUNT, O, S, SIZE, PLAYER_COLORS } from '../../sim/defs.ts';
import { SS } from '../../sim/serfs.ts';
import { STAGE, FLAG_SLOTS, type Building, type GameEvent, type GameState, type Serf } from '../../sim/types.ts';
import { H_SCALE, groundHeight, vx, vz } from './coords.ts';
import { Fx } from './fx.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';
import { PropPool } from './props.ts';
import { CARRY_Y, Rig, UNIT_SCALE, type Pose, type RigFrames } from './rig.ts';
import { animalScenes, buildingScenes, eventScenes, frameScenes, serfScenes, siteScenes } from './work/index.ts';
import type { Origin, SerfAt, Vec3, WorkCtx } from './work/types.ts';
import { yardRects, yardWeight, type Rect } from './yard.ts';

const tmpColor = new THREE.Color();

function playerColor(p: number): THREE.Color {
  return tmpColor.setHex(PLAYER_COLORS[p % PLAYER_COLORS.length]);
}

/** Budynki sa obrocone o 30 stopni (drzwi na flage). */
export const BROT = Math.PI / 6;
const COS30 = Math.cos(BROT);
const SIN30 = Math.sin(BROT);

/** Punkt lokalny modelu budynku (uklad Blendera x, y) -> przesuniecie w swiecie (x, z). */
export function local(lx: number, ly: number): [number, number] {
  const rx = lx * COS30 - ly * SIN30;
  const ry = lx * SIN30 + ly * COS30;
  return [rx, -ry];
}

/** Szczyt masztu flagi na budynkach wojskowych i zamku: [lx, ly, wysokosc]. */
const BANNER: Record<number, [number, number, number]> = {
  [B.CASTLE]: [0, 0.12, 1.46],
  [B.GUARDHUT]: [0, 0, 0.68],
  [B.TOWER]: [0.02, 0.1, 1.34],
  [B.FORTRESS]: [-0.12, 0.14, 1.12],
  [B.GUARDHOUSE]: [-0.2, 0.12, 0.8],
};

/**
 * Ustawienie modelu budynku wzgledem jego pola (jak w pierwowzorze): budynek wiekszy niz pole,
 * przesuniety ku swojej fladze (pole SE), tak ze drzwi wychodza prawie wprost na flage, a reszta
 * budynku siega w gore i w lewo. Kazdy budynek stoi na jednym polu; duze wizualnie wychodza poza nie.
 */
export const FLAG_DIR = local(0, -1); // kierunek z pola budynku do jego flagi (SE)
const PLACEMENT: Record<number, { s: number; d: number }> = {
  [SIZE.SMALL]: { s: 1.7, d: 0.22 },
  [SIZE.MEDIUM]: { s: 1.55, d: 0.2 },
  [SIZE.MINE]: { s: 1.6, d: 0.18 },
  [SIZE.LARGE]: { s: 1.3, d: 0.1 },
};
function placement(size: number): { s: number; ox: number; oz: number } {
  const pl = PLACEMENT[size] ?? PLACEMENT[SIZE.SMALL];
  return { s: pl.s, ox: FLAG_DIR[0] * pl.d, oz: FLAG_DIR[1] * pl.d };
}

/**
 * Najwyzej tyle budynek stoi ponad swoim polem, gdy teren pod obrysem wznosi sie (pol jednostki wysokosci terenu):
 * na lagodnym stoku nie tonie, a przy urwisku nie stoi na wysokiej podmurowce - tam wbija sie w zbocze.
 */
const MAX_LIFT = 0.5 * H_SCALE;

/** Obrys konstrukcji modeli budynkow wg rodzaju (podworko - client/render/yard.ts). */
const YARDS: readonly (readonly Rect[] | null)[] = BUILDINGS.map((_, k) => yardRects(`building_${k}`));

/** Od tego przyblizenia rysujemy czapki, narzedzia i drobne rekwizyty. */
const DETAIL_ZOOM = 1.6;
/** Flagi na drogach mniejsze niz na budynkach - drobne proporczyki. */
const FLAG_SCALE = 0.8;
const FRONT_ROT = Math.atan2(FLAG_DIR[0], FLAG_DIR[1]);

export class EntitiesRenderer {
  readonly group = new THREE.Group();
  private buildingLayers: InstancedLayer[] = [];
  private sites: InstancedLayer[];
  private fire: InstancedLayer;
  private flagPole: InstancedLayer;
  private flagCloth: InstancedLayer;
  private goods: InstancedLayer[] = [];
  private donkey: InstancedLayer;
  private border: InstancedLayer;
  private animals: InstancedLayer;
  private material: THREE.Material;
  private props: PropPool;
  private rig: Rig;
  private fx: Fx;
  private ctx: Ctx;
  private pendingEvents: GameEvent[] = [];
  private lastOwner: Uint8Array | null = null;
  private borderDirty = true;
  private time = 0;
  private at: SerfAt = { x: 0, y: 0, z: 0, rot: 0, moving: false, t: 0, walk: 0, bob: 0, from: -1, to: -1 };
  private tmpV = new THREE.Vector3();
  private tmpO = { x: 0, y: 0, z: 0 };
  /** Prostokat widocznosci (swiat x/z) - encje poza nim nie sa rysowane. */
  private vis = { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  /** Drobne detale postaci (czapki, narzedzia) - tylko przy przyblizeniu, z daleka i tak niewidoczne. */
  private details = true;
  /** Kierunek ku kamerze na plaszczyznie (obrot postaci), zaokraglony do 60 stopni. */
  cameraRot = 0;
  private camDir = new THREE.Vector3();
  /** Pola, ktorych statyczne obiekty sceny ukryly w tej klatce (rysuja je same). */
  readonly hidden = new Set<number>();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** Poziom budynkow (najwyzszy teren pod obrysem) - liczony raz, do zmiany wysokosci terenu. */
  private bases = new Map<number, { pos: number; kind: number; y: number }>();

  /** Wyznacza prostokat widocznosci: rzut naroznikow ekranu na plaszczyzny terenu (y = 0 i y = 7). */
  setView(camera: THREE.Camera, zoom = 1): void {
    this.details = zoom >= DETAIL_ZOOM;
    this.rig.details = this.details;
    camera.getWorldDirection(this.camDir);
    const sector = Math.PI / 3;
    this.cameraRot = Math.round(Math.atan2(-this.camDir.x, -this.camDir.z) / sector) * sector;
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

  inView(x: number, z: number): boolean {
    const v = this.vis;
    return x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1;
  }

  constructor(material: THREE.Material) {
    this.material = material;
    for (let k = 0; k < BUILDINGS.length; k++) this.buildingLayers.push(this.layer(`building_${k}`, 16));
    this.sites = ['site_small', 'site_medium', 'site_large'].map((n) => this.layer(n, 16));
    this.fire = this.layer('fire', 16);
    this.flagPole = this.layer('flag', 256);
    this.flagCloth = this.layer('flag_cloth', 256, true);
    for (let g = 0; g < GOODS_COUNT; g++) this.goods.push(this.layer(`good_${g}`, 32));
    this.donkey = this.layer('donkey', 32);
    this.border = this.layer('border', 1024, true);
    this.animals = this.layer('animal', 64);
    this.props = new PropPool(this.group, material);
    this.rig = new Rig((n, cap, color) => this.layer(n, cap, color), (n) => this.props.get(n), PLAYER_COLORS);
    this.fx = new Fx((n, cap, color) => this.layer(n, cap, color));
    this.ctx = new Ctx(this);
  }

  private layer(model: string, cap: number, color = false): InstancedLayer {
    return new InstancedLayer(this.group, getModel(model), this.material, cap, color);
  }

  // ---------- dostep dla scen (Ctx) ----------

  /** @internal */ propLayer(name: string, color = false): InstancedLayer {
    return color ? this.props.colored(name) : this.props.get(name);
  }
  /** @internal */ figure(p: Pose): RigFrames {
    return this.rig.figure(p);
  }
  /** @internal */ get fxs(): Fx {
    return this.fx;
  }
  /** @internal */ get showDetails(): boolean {
    return this.details;
  }

  wp(s: GameState, i: number, out: { x: number; y: number; z: number }): typeof out {
    const x = i % s.map.w, y = (i / s.map.w) | 0;
    out.x = vx(x, y);
    out.y = s.map.height[i] * H_SCALE;
    out.z = vz(y);
    return out;
  }

  /** Zdarzenia symulacji (po tickach) - sceny dostaja je w nastepnej klatce. */
  onEvents(ev: readonly GameEvent[]): void {
    for (const e of ev) {
      this.pendingEvents.push(e);
      if (e.type === 'height') this.bases.clear();
    }
  }

  /** Wysokosc terenu sie zmienila (np. przewiniecie gry) - poziomy budynkow do przeliczenia. */
  clearBases(): void {
    this.bases.clear();
  }

  /**
   * Uklad modelu budynku: srodek, skala i poziom - najwyzszy punkt terenu pod obrysem konstrukcji (naroza, srodki
   * bokow i srodki prostokatow obrysu, do tego pole budynku), najwyzej MAX_LIFT ponad polem. Nizej sciany
   * schodza do terenu jako podmurowka (shader modeli), wiec budynek na zboczu nie wisi.
   */
  originOf(s: GameState, b: Building, out: Origin): Origin {
    const p = this.wp(s, b.pos, this.tmpO);
    const pl = placement(BUILDINGS[b.kind].size);
    out.x = p.x + pl.ox;
    out.z = p.z + pl.oz;
    out.sc = pl.s;
    out.yard = YARDS[b.kind];
    const c = this.bases.get(b.id);
    if (c && c.pos === b.pos && c.kind === b.kind) {
      out.y = c.y;
      return out;
    }
    let y = p.y;
    for (const r of out.yard ?? []) {
      for (let i = 0; i < 9; i++) {
        const [dx, dz] = local(r[0] + (r[2] - r[0]) * (i % 3) / 2, r[1] + (r[3] - r[1]) * Math.floor(i / 3) / 2);
        y = Math.max(y, groundHeight(s.map, out.x + dx * pl.s, out.z + dz * pl.s));
      }
    }
    y = Math.min(y, p.y + MAX_LIFT);
    this.bases.set(b.id, { pos: b.pos, kind: b.kind, y });
    out.y = y;
    return out;
  }

  /**
   * dt - czas rzeczywisty klatki (s); animDt - czas animacji (dt * tempo gry, 0 przy pauzie),
   * w ktorym plyna rytmiczne ruchy postaci i czasteczki.
   */
  update(s: GameState, alpha: number, dt: number, animDt = dt): void {
    this.time += animDt;
    this.fx.time = this.time;
    this.ctx.frame(s, this.time, animDt, alpha);
    this.hidden.clear();
    for (const g of this.goods) g.begin();
    for (const l of this.rig.layers()) l.begin();
    for (const l of this.fx.layers()) l.begin();
    this.props.begin();
    this.donkey.begin();
    if (this.pendingEvents.length) {
      for (const h of eventScenes) h(this.ctx, this.pendingEvents);
      this.pendingEvents.length = 0;
    }
    this.updateBuildings(s);
    this.updateFlags(s);
    this.updateSerfs(s, alpha);
    this.updateAnimals(s, alpha);
    for (const f of frameScenes) f(this.ctx);
    for (const g of this.goods) g.end();
    for (const l of this.rig.layers()) l.end();
    for (const l of this.fx.layers()) l.end();
    this.props.end();
    this.donkey.end();
    this.updateBorders(s);
  }

  pushGood(g: number, x: number, y: number, z: number, rot: number, scale = 1): void {
    if (g >= 0 && g < GOODS_COUNT) this.goods[g].push(x, y, z, rot, scale);
  }

  pushGoodM(g: number, m: THREE.Matrix4): void {
    if (g >= 0 && g < GOODS_COUNT) this.goods[g].pushMatrix(m);
  }

  private updateBuildings(s: GameState): void {
    for (const l of this.buildingLayers) l.begin();
    for (const l of this.sites) l.begin();
    this.fire.begin();
    this.flagCloth.begin();
    this.flagPole.begin();
    const p = this.tmpV;
    for (const b of s.buildings) {
      if (!b) continue;
      this.wp(s, b.pos, p);
      const def = BUILDINGS[b.kind];
      const pl = placement(def.size);
      if (!this.inView(p.x + pl.ox, p.z + pl.oz)) continue;
      const o = this.originOf(s, b, { x: 0, y: 0, z: 0, sc: 1, yard: null });
      const sc = o.sc;
      const layer = this.buildingLayers[b.kind];
      const bx = o.x, bz = o.z;
      p.y = o.y;
      if (b.stage === STAGE.DONE) {
        layer.push(bx, p.y, bz, 0, sc);
        this.banner(b, o);
        buildingScenes[b.kind]?.(this.ctx, b, o);
      } else if (b.stage === STAGE.BURN) {
        const k = b.burn / 150;
        layer.push(bx, p.y - (1 - k) * 0.3 * sc, bz, 0, sc, sc * Math.max(0.15, k));
        const flicker = 0.85 + Math.sin(this.time * 17 + b.id) * 0.15;
        this.fire.push(bx, p.y, bz, this.time * 2, sc * flicker * (0.6 + k * 0.6));
        this.fx.smoke(b.id * 16 + 9, bx, p.y + 0.5 * sc, bz, 1, 0x4a4542);
      } else {
        const si = def.size === SIZE.LARGE ? 2 : def.size === SIZE.MEDIUM ? 1 : 0;
        this.sites[si].push(bx, p.y, bz, 0, sc);
        const total = def.planks + def.stones;
        const done = total > 0 ? (b.planksUsed + b.stonesUsed) / total : 0;
        if (done > 0) layer.push(bx, p.y, bz, 0, sc, sc * Math.max(0.05, done));
        if (siteScenes.length) for (const f of siteScenes) f(this.ctx, b, o);
        else {
          // Materialy lezace na placu (przed budowa, od strony flagi).
          const mx = bx + FLAG_DIR[0] * 0.2 * sc, mz = bz + FLAG_DIR[1] * 0.2 * sc;
          for (let i = 0; i < Math.min(3, b.planks); i++) this.pushGood(9, mx - 0.2, p.y + i * 0.02, mz, 0);
          for (let i = 0; i < Math.min(3, b.stones); i++) this.pushGood(11, mx + 0.15, p.y + i * 0.07, mz - 0.1, 0.3);
        }
      }
    }
    for (const l of this.buildingLayers) l.end();
    for (const l of this.sites) l.end();
    this.fire.end();
  }

  /** Flaga gracza na budynkach wojskowych i zamku. */
  private banner(b: Building, o: Origin): void {
    const ban = BANNER[b.kind];
    if (ban && (b.kind === B.CASTLE || b.knights.length > 0)) {
      const [ox, oz] = local(ban[0], ban[1]);
      const wave = Math.sin(this.time * 4 + b.id) * 0.3;
      const ci = this.flagCloth.push(o.x + ox * o.sc, o.y + ban[2] * o.sc - 0.52, o.z + oz * o.sc, wave);
      const c = playerColor(b.owner);
      this.flagCloth.color(ci, c.r, c.g, c.b);
    }
  }

  private updateFlags(s: GameState): void {
    const p = this.tmpV;
    for (const f of s.flags) {
      if (!f) continue;
      this.wp(s, f.pos, p);
      if (!this.inView(p.x, p.z)) continue;
      this.flagPole.push(p.x, p.y, p.z, 0, FLAG_SCALE);
      const wave = Math.sin(this.time * 4 + f.id) * 0.3;
      const ci = this.flagCloth.push(p.x, p.y, p.z, wave, FLAG_SCALE);
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

  /** Polozenie osadnika (albo zwierzecia) w tej klatce: interpolacja kroku, kierunek, faza chodu. */
  locate(s: GameState, e: { id: number; pos: number; to: number; t: number; dur: number }, alpha: number, out: SerfAt, idleRot: number): SerfAt {
    this.wp(s, e.pos, out);
    out.from = e.pos;
    out.to = e.to;
    if (e.to >= 0) {
      const b = this.tmpV;
      this.wp(s, e.to, b);
      const t = Math.min(1, (e.t + alpha) / Math.max(1, e.dur));
      out.rot = Math.atan2(b.x - out.x, b.z - out.z);
      out.x += (b.x - out.x) * t;
      out.y += (b.y - out.y) * t;
      out.z += (b.z - out.z) * t;
      out.moving = true;
      out.t = t;
      out.walk = t * Math.PI * 2;
      out.bob = Math.abs(Math.sin(out.walk)) * 0.02;
    } else {
      out.rot = idleRot;
      out.moving = false;
      out.t = 0;
      out.walk = 0;
      out.bob = 0;
    }
    return out;
  }

  /** Domyslna poza osadnika: chod, praca (rytmiczne machanie), pojedynek, niesienie towaru na glowie. */
  walkPose(serf: Serf, at: SerfAt): Pose {
    const walk = at.moving ? at.walk : 0;
    let legSwing = walk ? Math.sin(walk) * 0.6 : 0;
    let armL = walk ? -Math.sin(walk) * 0.5 : 0;
    let armR = -armL;
    if (serf.anim === 1) {
      const w = Math.sin(this.time * 9 + serf.id);
      armR = -1.2 + w * 0.8;
      armL = -0.6 - w * 0.4;
      legSwing = 0;
    } else if (serf.anim === 2) {
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
    return {
      x: at.x, y: at.y, z: at.z, rot: at.rot, bob: at.bob, owner: serf.owner, type: serf.type,
      legL: legSwing, legR: -legSwing, armL, armR, carry: serf.carry, tool: carrying ? null : undefined,
    };
  }

  private updateSerfs(s: GameState, alpha: number): void {
    const at = this.at;
    for (const serf of s.serfs) {
      if (!serf) continue;
      this.wp(s, serf.pos, at);
      if (!this.inView(at.x, at.z) || !this.visible(s, serf)) continue;
      this.locate(s, serf, alpha, at, (serf.id * 1.3) % (Math.PI * 2));
      const sc = serfScenes[serf.type];
      if (sc && sc(this.ctx, serf, at)) continue;
      if (serf.type === S.DONKEY) {
        this.donkey.push(at.x, at.y + at.bob, at.z, at.rot, 1.1 * UNIT_SCALE);
        if (serf.carry >= 0) this.pushGood(serf.carry, at.x, at.y + 0.34 * UNIT_SCALE + at.bob, at.z, at.rot, UNIT_SCALE);
        continue;
      }
      if (serf.anim === 2) {
        // Pojedynek: zwrot do przeciwnika.
        const opp = serf.sub >= 0 ? s.serfs[serf.sub] : null;
        if (opp) {
          const b = this.wp(s, opp.pos, this.tmpV);
          if (opp.pos !== serf.pos) at.rot = Math.atan2(b.x - at.x, b.z - at.z);
          else at.x += serf.home === serf.target ? 0.12 : -0.12;
        }
      }
      this.drawPose(this.walkPose(serf, at));
    }
  }

  /** Postac w pozie wraz z towarem na glowie (pole carry). */
  drawPose(p: Pose): RigFrames {
    const f = this.rig.figure(p);
    if (p.carry !== undefined && p.carry >= 0) this.pushGood(p.carry, p.x, p.y + (p.bob ?? 0) + CARRY_Y * UNIT_SCALE, p.z, p.rot, UNIT_SCALE);
    return f;
  }

  private updateAnimals(s: GameState, alpha: number): void {
    this.animals.begin();
    const at = this.at;
    for (const an of s.animals) {
      if (!an) continue;
      this.wp(s, an.pos, at);
      if (!this.inView(at.x, at.z)) continue;
      this.locate(s, an, alpha, at, an.id * 1.7);
      let drawn = false;
      for (const f of animalScenes) if ((drawn = f(this.ctx, an, at))) break;
      if (!drawn) this.animals.push(at.x, at.y, at.z, at.rot, UNIT_SCALE);
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

const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const eul = new THREE.Euler();

/** Kontekst scen pracy (WorkCtx) - cienka warstwa nad rendererem encji. */
class Ctx implements WorkCtx {
  s!: GameState;
  time = 0;
  dt = 0;
  alpha = 0;
  readonly frontRot = FRONT_ROT;
  private r: EntitiesRenderer;
  private frameM = new THREE.Matrix4();

  constructor(r: EntitiesRenderer) {
    this.r = r;
  }

  frame(s: GameState, time: number, dt: number, alpha: number): void {
    this.s = s;
    this.time = time;
    this.dt = dt;
    this.alpha = alpha;
  }

  get fx(): Fx {
    return this.r.fxs;
  }

  get details(): boolean {
    return this.r.showDetails;
  }

  figure(p: Pose): RigFrames {
    return this.r.drawPose(p);
  }

  walkPose(serf: Serf, at: SerfAt): Pose {
    return this.r.walkPose(serf, at);
  }

  beat(rate: number, offset = 0): { n: number; f: number; age: number } {
    const k = this.time * rate + offset;
    const n = Math.floor(k);
    return { n, f: k - n, age: (k - n) / rate };
  }

  strike(f: number): number {
    return f < 0.7 ? Math.sin((f / 0.7) * Math.PI / 2) : Math.cos(((f - 0.7) / 0.3) * Math.PI / 2);
  }

  prop(name: string, x: number, y: number, z: number, rot = 0, s = 1, sy = s, color?: number): number {
    const l = this.r.propLayer(name, color !== undefined);
    const i = l.push(x, y, z, rot, s, sy);
    if (color !== undefined) this.tint(l, i, color);
    return i;
  }

  propM(name: string, m: THREE.Matrix4, color?: number): number {
    const l = this.r.propLayer(name, color !== undefined);
    const i = l.pushMatrix(m);
    if (color !== undefined) this.tint(l, i, color);
    return i;
  }

  propAt(name: string, frame: THREE.Matrix4, ox: number, oy: number, oz: number, rx = 0, ry = 0, rz = 0, s = 1, color?: number): number {
    return this.propM(name, this.local(frame, ox, oy, oz, rx, ry, rz, s), color);
  }

  private tint(l: InstancedLayer, i: number, hex: number): void {
    const c = tmpColor.setHex(hex);
    l.color(i, c.r, c.g, c.b);
  }

  playerColor(owner: number): number {
    return PLAYER_COLORS[owner % PLAYER_COLORS.length];
  }

  good(g: number, x: number, y: number, z: number, rot = 0, s = 1): void {
    this.r.pushGood(g, x, y, z, rot, s);
  }

  goodAt(g: number, frame: THREE.Matrix4, ox: number, oy: number, oz: number, rx = 0, ry = 0, rz = 0, s = 1): void {
    this.r.pushGoodM(g, this.local(frame, ox, oy, oz, rx, ry, rz, s));
  }

  private local(frame: THREE.Matrix4, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number, s: number): THREE.Matrix4 {
    mA.copy(frame).multiply(mB.makeTranslation(ox, oy, oz));
    if (rx || ry || rz) mA.multiply(mB.makeRotationFromEuler(eul.set(rx, ry, rz, 'XYZ')));
    if (s !== 1) mA.multiply(mB.makeScale(s, s, s));
    return mA;
  }

  origin(b: Building): Origin {
    return this.r.originOf(this.s, b, { x: 0, y: 0, z: 0, sc: 1, yard: null });
  }

  at(o: Origin, lx: number, ly: number, lz = 0, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const [dx, dz] = local(lx, ly);
    out.x = o.x + dx * o.sc;
    out.z = o.z + dz * o.sc;
    out.y = this.floorAt(o, lx, ly, out.x, out.z) + lz * o.sc;
    return out;
  }

  floor(o: Origin, lx: number, ly: number): number {
    const [dx, dz] = local(lx, ly);
    return this.floorAt(o, lx, ly, o.x + dx * o.sc, o.z + dz * o.sc);
  }

  private floorAt(o: Origin, lx: number, ly: number, x: number, z: number): number {
    if (!o.yard) return o.y;
    const w = yardWeight(o.yard, lx, ly);
    return w > 0 ? o.y + w * (this.ground(x, z) - o.y) : o.y;
  }

  frameOf(o: Origin): THREE.Matrix4 {
    return this.frameM.makeTranslation(o.x, o.y, o.z).multiply(mB.makeRotationY(BROT)).multiply(mA.makeScale(o.sc, o.sc, o.sc));
  }

  facing(ax: number, az: number, bx: number, bz: number): number {
    return Math.atan2(bx - ax, bz - az);
  }

  get toCamera(): number {
    return this.r.cameraRot;
  }

  beside(cx: number, cz: number, dist: number, turn = 0): Vec3 & { rot: number } {
    const a = this.r.cameraRot + turn;
    const x = cx + Math.sin(a) * dist, z = cz + Math.cos(a) * dist;
    return { x, y: this.ground(x, z), z, rot: a + Math.PI };
  }

  cell(i: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    return this.r.wp(this.s, i, out);
  }

  flagOf(b: Building, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const f = this.s.flags[b.flag];
    return this.r.wp(this.s, f ? f.pos : b.pos, out);
  }

  ground(x: number, z: number): number {
    return groundHeight(this.s.map, x, z);
  }

  inView(x: number, z: number): boolean {
    return this.r.inView(x, z);
  }

  hideObject(cell: number): void {
    this.r.hidden.add(cell);
  }

  workerInside(b: Building): Serf | null {
    if (b.worker < 0 || !b.workerInside) return null;
    const w = this.s.serfs[b.worker];
    return w && w.state === SS.INSIDE ? w : null;
  }

  cycle(b: Building): number {
    if (b.phase === 0) return -1;
    const total = BUILDINGS[b.kind].cycle;
    return this.progress(b.timer, total);
  }

  progress(timer: number, total: number): number {
    if (total <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - (timer - this.alpha) / total));
  }
}
