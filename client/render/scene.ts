/**
 * Glowny renderer: WebGL2, bez post-processingu i dynamicznych cieni.
 * Jedno swiatlo kierunkowe + polkula; opcje jakosci steruja DPR i limitem FPS.
 */
import * as THREE from 'three';
import type { MapData } from '../../sim/mapgen.ts';
import { CameraController } from './camera.ts';
import { stepXY } from '../../sim/grid.ts';
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

/**
 * Wzory powierzchni modeli (dachowki, deski, bale, papa, twarz) liczone w shaderze z atrybutu `pat` (UV z Blendera,
 * zob. surface_pattern i face_pattern w art/scripts/lib.py): u = numer * 1000 + polozenie poziome (na glowie:
 * kat od przodu), v = 1 - wysokosc albo odleglosc od okapu (eksporter glTF odwraca v). Wymiary w metrach modelu.
 * Gdy wzor robi sie drobniejszy niz kilka pikseli, kontrast gasnie do sredniej - bez migotania z daleka.
 * Wzor 6 (PLAIN) to brak wzoru i brak koloru gracza w czesciach barwionych instancja (skora, spodnie postaci).
 */
const MODEL_PATTERNS = /* glsl */ `
varying vec2 vPat;
float patHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float patFade(vec2 g) { vec2 w = fwidth(g); return clamp(1.8 - max(w.x, w.y) * 3.0, 0.0, 1.0); }
float patternShade(vec2 q) {
  float id = floor((q.x + 500.0) / 1000.0);
  if (id < 0.5) return 1.0;
  float u = q.x - id * 1000.0;
  float v = 1.0 - q.y;
  if (id < 1.5) {
    // Dachowki: rzedy przesuniete o pol dachowki, zaokraglony dolny brzeg, cien pod zakladka wyzszego rzedu.
    vec2 g = vec2(u / 0.03, v / 0.024);
    float row = floor(g.y);
    float cu = g.x + 0.5 * mod(row, 2.0);
    vec2 t = vec2(fract(cu), fract(g.y));
    float x = 2.0 * t.x - 1.0;
    float k = (0.9 + 0.14 * (1.0 - x * x)) * (1.0 - 0.38 * smoothstep(0.55, 1.0, t.y));
    k *= 0.9 + 0.18 * patHash(vec2(row, floor(cu)));
    if (t.y < 0.3 * x * x) k = 0.62;
    k *= mix(0.72, 1.0, smoothstep(0.0, 0.06, min(t.x, 1.0 - t.x)));
    return mix(0.86, k, patFade(g));
  }
  if (id < 2.5) {
    // Deski: pionowe, ciemne spoiny, kazda deska w nieco innym odcieniu, delikatne sloje.
    vec2 g = vec2(u / 0.042, v / 0.042);
    float b = floor(g.x);
    float t = fract(g.x);
    float k = (0.88 + 0.22 * patHash(vec2(b, 7.0))) * (1.0 + 0.05 * sin(v * 150.0 + patHash(vec2(b, 3.0)) * 40.0));
    k *= mix(0.55, 1.0, smoothstep(0.0, 0.08, min(t, 1.0 - t)));
    return mix(0.95, k, patFade(g));
  }
  if (id > 3.5 && id < 4.5) {
    // Papa: poziome pasy z zakladem (cien pod brzegiem wyzszego pasa) i listwy dociskowe w dol polaci.
    vec2 g = vec2(u / 0.12, v / 0.075);
    float t = fract(g.y);
    float k = (0.93 + 0.12 * patHash(vec2(floor(g.y), 5.0))) * (1.0 - 0.3 * smoothstep(0.84, 1.0, t)) * (1.0 + 0.1 * (1.0 - smoothstep(0.0, 0.1, t)));
    float bd = abs(fract(g.x) - 0.5);
    k = bd < 0.05 ? 1.25 - bd * 3.0 : k * mix(0.72, 1.0, smoothstep(0.05, 0.12, bd));
    return mix(0.95, k, patFade(g));
  }
  // Bale: poziome, okragly przekroj (jasny srodek, ciemne styki).
  vec2 g = vec2(u / 0.3, v / 0.045);
  float row = floor(g.y);
  float y = 2.0 * fract(g.y) - 1.0;
  float k = (0.5 + 0.6 * sqrt(max(0.0, 1.0 - y * y))) * (0.92 + 0.14 * patHash(vec2(row, 1.0)));
  return mix(0.85, k, patFade(g));
}
// Twarz jak na portretach zawodow: duze biale oczy ze zrenicami, brwi, usmiech, rumience.
// a = kat od przodu glowy (rad), h = wysokosc od srodka glowy (m, promien glowy ~0.056).
vec3 faceColor(float a, float h, vec3 skin) {
  float fw = max(fwidth(a), fwidth(h) * 18.0);
  float soft = max(0.08, fw * 4.0);
  float aa = abs(a);
  vec3 c = skin;
  float cheek = length(vec2((aa - 0.6) / 0.26, (h + 0.012) / 0.014));
  c = mix(c, vec3(0.8, 0.28, 0.22), 0.35 * (1.0 - smoothstep(0.5, 1.0, cheek)));
  float hb = 0.021 + 0.003 * (1.0 - pow((aa - 0.34) / 0.2, 2.0));
  float brow = (1.0 - smoothstep(0.0028, 0.0028 + 0.002 * soft * 10.0, abs(h - hb))) * step(abs(aa - 0.34), 0.2);
  c = mix(c, vec3(0.22, 0.1, 0.04), brow);
  float hm = -0.03 + 0.05 * a * a;
  float mouth = (1.0 - smoothstep(0.0035, 0.0035 + 0.002 * soft * 10.0, abs(h - hm))) * step(aa, 0.28);
  c = mix(c, vec3(0.4, 0.08, 0.06), mouth);
  float e = length(vec2((aa - 0.34) / 0.19, (h - 0.006) / 0.012));
  c = mix(c, vec3(0.3, 0.16, 0.1), 0.45 * (1.0 - smoothstep(1.0, 1.0 + soft, e)));
  c = mix(c, vec3(0.95), 1.0 - smoothstep(0.92 - soft * 0.5, 0.92, e));
  float pupil = length(vec2((aa - 0.3) / 0.085, (h - 0.004) / 0.008));
  c = mix(c, vec3(0.02), 1.0 - smoothstep(1.0 - soft, 1.0, pupil));
  // Z daleka (twarz na kilka pikseli) zostaja tylko ciemne plamki oczu - bez migotania.
  vec3 far = mix(skin, vec3(0.05), 0.7 * (1.0 - smoothstep(0.6, 1.3, e)));
  return mix(far, c, clamp(2.0 - fw * 6.0, 0.0, 1.0));
}
vec3 patternColor(vec2 q, vec3 c) {
  float id = floor((q.x + 500.0) / 1000.0);
  if (id > 5.5) return c;
  if (id > 4.5) return faceColor(q.x - id * 1000.0, 1.0 - q.y, c);
  return c * patternShade(q);
}
`;

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
  /** Kursor zaznaczenia: kropki wokol pola (jak w pierwowzorze) zamiast obrysu szesciokata. */
  private cursor = new THREE.Group();
  private cursorDots: THREE.Mesh[] = [];
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
    // Kolor oswietlonej glebokiej wody (DEEP_WATER pod swiatlem sceny) - brzeg mapy zlewa sie z tlem.
    this.scene.background = new THREE.Color().setRGB(17 / 255, 51 / 255, 95 / 255, THREE.LinearSRGBColorSpace);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.2));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    this.sun.position.set(-30, 60, 20);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Normalne z modeli: gladkie krzywizny, ostre krawedzie bryl (zastepniki licza normalne plaskie).
    this.modelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.modelMaterial.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 pat;\nvarying vec2 vPat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pat;')
        // Kolor gracza tylko na koszulce: sciany PLAIN (skora, spodnie) zostaja w kolorze wierzcholkow.
        .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nif (abs(floor((pat.x + 500.0) / 1000.0) - 6.0) < 0.5) vColor.xyz = color.xyz;\n#endif');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + MODEL_PATTERNS)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = patternColor(vPat, diffuseColor.rgb);');
    };

    const dot = new THREE.CircleGeometry(0.045, 8);
    dot.rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
    for (let k = 0; k < 7; k++) {
      const d = new THREE.Mesh(dot, dotMat);
      d.renderOrder = 10;
      if (k === 6) d.scale.setScalar(0.7);
      this.cursorDots.push(d);
      this.cursor.add(d);
    }
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
    // Kropki na szesciu sasiednich wierzcholkach (jak w pierwowzorze) i jedna na samym polu.
    for (let k = 0; k < 7; k++) {
      let nx = x, ny = y;
      if (k < 6) [nx, ny] = stepXY(x, y, k);
      const dot = this.cursorDots[k];
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) { dot.visible = false; continue; }
      dot.visible = true;
      dot.position.set(vx(nx, ny), m.height[ny * m.w + nx] * H_SCALE + 0.02, vz(ny));
    }
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
    if (events.length) this.entities.onEvents(events);
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

  /**
   * dt - czas rzeczywisty klatki (s); animScale - tempo gry (0 przy pauzie): w nim plyna animacje postaci
   * i czasteczki, kamera zawsze w czasie rzeczywistym.
   */
  render(dt: number, s?: GameState, alpha = 0, me = 0, animScale = 1): boolean {
    const moved = this.cam.update(dt);
    this.terrain.update();
    if (s) {
      if (moved) this.entities.setView(this.cam.camera, this.cam.zoom);
      this.entities.update(s, alpha, dt, dt * animScale);
      this.objects.setHidden(this.entities.hidden);
      this.overlay.updateSites(s, me, this.centerIdx(), Math.ceil(14 / this.cam.zoom));
    }
    this.objects.update(this.cam.camera, moved);
    this.renderer.render(this.scene, this.cam.camera);
    return moved;
  }
}
