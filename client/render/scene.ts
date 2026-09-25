/**
 * Glowny renderer: WebGL2, bez post-processingu i dynamicznych cieni.
 * Jedno swiatlo kierunkowe + polkula; opcje jakosci steruja DPR i limitem FPS.
 */
import * as THREE from 'three';
import type { MapData } from '../../sim/mapgen.ts';
import { CameraController } from './camera.ts';
import { H_SCALE, ROW_H, nearestIdx, vx, vz } from './coords.ts';
import { MapObjectsRenderer } from './mapObjects.ts';
import { TerrainRenderer } from './terrain.ts';
import { RoadsRenderer } from './roads.ts';
import { EntitiesRenderer } from './entities.ts';
import { OverlayRenderer } from './overlay.ts';
import type { GameEvent, GameState } from '../../sim/types.ts';

export interface GraphicsOptions {
  quality: 'low' | 'medium';
  maxDpr: number;
  fpsLimit: number;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new CameraController();
  readonly modelMaterial: THREE.MeshLambertMaterial;
  terrain!: TerrainRenderer;
  objects!: MapObjectsRenderer;
  roads = new RoadsRenderer();
  entities!: EntitiesRenderer;
  overlay = new OverlayRenderer();
  map!: MapData;
  private cursor: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private sun: THREE.DirectionalLight;
  width = 1;
  height = 1;

  readonly canvas: HTMLCanvasElement;
  options: GraphicsOptions;

  constructor(canvas: HTMLCanvasElement, options: GraphicsOptions) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.quality !== 'low',
      powerPreference: 'default',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x1d2a1f);
    this.renderer.shadowMap.enabled = false;
    // Ocean wokol mapy to po prostu kolor tla (kolor oswietlonej glebokiej wody) - bez dodatkowej
    // plaszczyzny pod mapa, ktora podwajala koszt wypelniania ekranu.
    this.scene.background = new THREE.Color().setRGB(99 / 255, 147 / 255, 172 / 255, THREE.SRGBColorSpace);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.2));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    this.sun.position.set(-30, 60, 20);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.modelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    const ring = new THREE.RingGeometry(0.28, 0.4, 6);
    ring.rotateX(-Math.PI / 2);
    ring.rotateY(Math.PI / 6);
    this.cursor = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
  }

  setMap(map: MapData): void {
    this.map = map;
    this.terrain = new TerrainRenderer(map);
    this.scene.add(this.terrain.group);
    this.objects = new MapObjectsRenderer(map, this.modelMaterial);
    this.scene.add(this.objects.group);
    this.scene.add(this.roads.mesh);
    this.entities = new EntitiesRenderer(this.modelMaterial);
    this.scene.add(this.entities.group);
    this.scene.add(this.overlay.group);
    this.cam.bounds = { minX: 2, maxX: map.w - 2, minZ: 2, maxZ: (map.h - 2) * ROW_H };
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.maxDpr));
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, h);
  }

  applyOptions(o: GraphicsOptions): void {
    this.options = o;
    this.resize(this.width, this.height);
  }

  /** Pole mapy pod punktem ekranu albo -1. */
  pick(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    const ray = this.raycaster.ray;
    const m = this.map;
    // Start na wysokosci ponad najwyzszym terenem, marsz w dol wzdluz promienia.
    const topY = 32 * H_SCALE;
    const t0 = (ray.origin.y - topY) / -ray.direction.y;
    const p = new THREE.Vector3();
    const step = 0.2;
    let prevIdx = -1;
    for (let t = Math.max(0, t0); t < t0 + 400; t += step) {
      ray.at(t, p);
      if (p.y < -1) break;
      const idx = nearestIdx(m, p.x, p.z);
      if (idx < 0) { if (prevIdx >= 0) break; continue; }
      prevIdx = idx;
      const gy = m.height[idx] * H_SCALE;
      if (p.y <= gy) return idx;
    }
    return prevIdx;
  }

  setCursor(idx: number): void {
    if (idx < 0) { this.cursor.visible = false; return; }
    const m = this.map;
    const x = idx % m.w, y = (idx / m.w) | 0;
    this.cursor.position.set(vx(x, y), m.height[idx] * H_SCALE + 0.03, vz(y));
    this.cursor.visible = true;
  }

  lookAtIdx(idx: number): void {
    const m = this.map;
    const x = idx % m.w, y = (idx / m.w) | 0;
    this.cam.target.y = m.height[idx] * H_SCALE;
    this.cam.lookAt(vx(x, y), vz(y));
  }

  /** Po tickach symulacji: zmiany obiektow mapy, drog, wysokosci terenu. */
  syncState(s: GameState, events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'height') {
        this.terrain.markDirty(e.pos);
        this.objects.markHeight(e.pos);
        this.roads.invalidate();
      }
    }
    this.objects.sync();
    this.roads.sync(s);
  }

  /** Pozycja pola na ekranie (piksele CSS wzgledem okna). */
  project(idx: number): { x: number; y: number } {
    const m = this.map;
    const v = new THREE.Vector3(vx(idx % m.w, (idx / m.w) | 0), m.height[idx] * H_SCALE, vz((idx / m.w) | 0));
    v.project(this.cam.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Pole mapy pod srodkiem widoku. */
  centerIdx(): number {
    return nearestIdx(this.map, this.cam.target.x, this.cam.target.z);
  }

  render(dt: number, s?: GameState, alpha = 0, me = 0): boolean {
    const moved = this.cam.update(dt);
    this.terrain.update();
    this.objects.update(this.cam.camera, moved);
    if (s) {
      if (moved) this.entities.setView(this.cam.camera);
      this.entities.update(s, alpha, dt);
      this.overlay.updateSites(s, me, this.centerIdx(), Math.ceil(14 / this.cam.zoom));
    }
    this.renderer.render(this.scene, this.cam.camera);
    return moved;
  }
}
