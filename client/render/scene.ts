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
import { DEEP_WATER } from './palette.ts';

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
    this.scene.background = new THREE.Color(DEEP_WATER[0] * 0.8, DEEP_WATER[1] * 0.8, DEEP_WATER[2] * 0.8);
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
    // Ocean wokol mapy (tuz pod poziomem wody terenu).
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(map.w * 6, map.h * 6), new THREE.MeshLambertMaterial({ color: new THREE.Color(...DEEP_WATER) }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(map.w / 2, 4 * H_SCALE - 0.05, (map.h / 2) * ROW_H);
    this.scene.add(sea);
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

  render(dt: number): boolean {
    const moved = this.cam.update(dt);
    this.terrain.update();
    this.objects.update(this.cam.camera, moved);
    this.renderer.render(this.scene, this.cam.camera);
    return moved;
  }
}
