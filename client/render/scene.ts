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
 * Wzor 6 (PLAIN) to brak wzoru i brak koloru gracza w czesciach barwionych instancja (skora, spodnie postaci,
 * slupek znaku geologa). Wzory 7-12 to natura (kepy lisci, igliwie, kora, skala, zdzbla, klosy - art/scripts/nature.py).
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
float patNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(patHash(i), patHash(i + vec2(1.0, 0.0)), f.x), mix(patHash(i + vec2(0.0, 1.0)), patHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Natura (art/scripts/nature.py): u - wokol bryly albo wzdluz rzedu, v - w gore.
float natureShade(float id, float u, float v) {
  if (id < 8.5) {
    // Kepy lisci (7) albo galezie igliwia (8, splaszczone w poziomie): nieregularne kepy (komorki wokol losowych
    // punktow), kazda oswietlona od gory, z ciemna szczelina na brzegu i plamami jak od pedzla.
    vec2 g = id < 7.5 ? vec2(u / 0.075, v / 0.06) : vec2(u / 0.07, v / 0.035);
    vec2 c = floor(g);
    vec2 f = fract(g);
    float d1 = 9.0;
    vec2 to = vec2(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 p = o + 0.15 + 0.7 * vec2(patHash(c + o), patHash(c + o + 17.0)) - f;
        float d = dot(p, p);
        if (d < d1) { d1 = d; to = p; }
      }
    }
    float k = 0.84 + 0.3 * clamp(0.45 - to.y * 0.9 + to.x * 0.25, 0.0, 1.0);
    k *= 1.0 - 0.28 * smoothstep(0.22, 0.55, d1);
    k *= 0.9 + 0.2 * patNoise(vec2(u, v) * 7.0);
    return mix(0.97, k, patFade(g));
  }
  if (id < 9.5) {
    // Kora: pionowe, lekko faliste bruzdy.
    vec2 g = vec2(u / 0.016, v / 0.06);
    float w = g.x + 0.3 * sin(v * 55.0 + patHash(vec2(floor(g.x), 2.0)) * 6.0);
    float k = mix(0.62, 1.08, smoothstep(0.04, 0.3, abs(fract(w) - 0.5))) * (0.9 + 0.2 * patHash(vec2(floor(w), floor(g.y))));
    return mix(0.92, k, patFade(g));
  }
  if (id < 10.5) {
    // Skala: plamy i cienkie spekania.
    vec2 p = vec2(u, v) / 0.08;
    float n = patNoise(p) * 0.65 + patNoise(p * 2.7 + 3.1) * 0.35;
    float crack = 1.0 - smoothstep(0.0, 0.03, abs(n - 0.52));
    float k = (0.86 + 0.26 * n) * (1.0 - 0.25 * crack);
    return mix(0.98, k, patFade(p * 2.7));
  }
  if (id < 11.5) {
    // Zdzbla: gesto stojace, pionowe, kazde w nieco innym odcieniu.
    vec2 g = vec2(u / 0.011, v / 0.05);
    float k = mix(0.7, 1.1, smoothstep(0.08, 0.32, abs(fract(g.x) - 0.5))) * (0.9 + 0.2 * patHash(vec2(floor(g.x), 4.0)));
    return mix(0.95, k, patFade(g));
  }
  // Klosy: ziarna w rzedach przesunietych o pol, ciemne szczeliny.
  vec2 g = vec2(u / 0.016, v / 0.012);
  float row = floor(g.y);
  vec2 t = vec2(fract(g.x + 0.5 * mod(row, 2.0)), fract(g.y)) - 0.5;
  float k = mix(1.14, 0.68, smoothstep(0.2, 0.5, length(t * vec2(1.7, 1.0)))) * (0.9 + 0.2 * patHash(vec2(row, floor(g.x))));
  return mix(0.95, k, patFade(g));
}
vec3 patternColor(vec2 q, vec3 c) {
  float id = floor((q.x + 500.0) / 1000.0);
  if (id > 6.5) return c * natureShade(id, q.x - id * 1000.0, 1.0 - q.y);
  if (id > 5.5) return c;
  if (id > 4.5) return faceColor(q.x - id * 1000.0, 1.0 - q.y, c);
  return c * patternShade(q);
}
`;

/**
 * Wysokosc terenu w shaderze wierzcholkow (tekstura wysokosci pol): ten sam rachunek co groundHeight
 * w client/render/coords.ts - zmieniac razem.
 */
const GROUND_GLSL = /* glsl */ `
uniform sampler2D groundMap;
float groundCell(float x, float y) {
  ivec2 s = textureSize(groundMap, 0);
  return texelFetch(groundMap, clamp(ivec2(int(x), int(y)), ivec2(0), s - 1), 0).r;
}
float groundAt(vec2 p) {
  float rf = p.y / ${ROW_H.toFixed(8)};
  float r = floor(rf);
  float t = rf - r;
  float odd = mod(r, 2.0);
  float q = p.x - odd * 0.5 - 0.5 * t;
  float i = floor(q);
  float f = q - i;
  if (f + t <= 1.0) return (1.0 - f - t) * groundCell(i, r) + f * groundCell(i + 1.0, r) + t * groundCell(i + odd, r + 1.0);
  return (1.0 - t) * groundCell(i + 1.0, r) + (1.0 - f) * groundCell(i + odd, r + 1.0) + (f + t - 1.0) * groundCell(i + 1.0 + odd, r + 1.0);
}
`;

/**
 * Podworko budynku (client/render/yard.ts): atrybut `yard` z Blendera - x = waga podworka (wierzcholek schodzi
 * albo wchodzi na teren), y = 1 na spodzie konstrukcji (sciana siega w dol do nizszego terenu, zamiast wisiec);
 * `yardAt` - punkt modelu (x, z), w ktorym brac wysokosc terenu (srodek zwartego sprzetu albo sam wierzcholek).
 * Przesuniecie liczone w swiecie wzgledem wysokosci instancji, dzielone przez jej skale pionowa.
 * vFound: x > 0 na scianach przy spodzie konstrukcji, y = wysokosc w modelu - ponizej zera sciana jest podmurowka.
 */
const YARD_VERTEX = /* glsl */ `
vFound = vec2(0.0, 1.0);
#ifdef USE_INSTANCING
if (yard.x > 0.0 || yard.y > 0.5) {
  vec4 yw = instanceMatrix * vec4(yardAt.x, 0.0, yardAt.y, 1.0);
  float yd = groundAt(yw.xz) - instanceMatrix[3].y;
  transformed.y += (yard.x * yd + yard.y * min(yd, 0.0)) / instanceMatrix[1][1];
  vFound = vec2(yard.y, transformed.y);
}
#endif
`;

/** Podmurowka (sciana wydluzona w dol do terenu): kamien w pasach co 0,05 wysokosci modelu, ciemniejszy u dolu. */
const FOUNDATION_FRAGMENT = /* glsl */ `
if (vFound.x > 0.001 && vFound.y < 0.0) {
  float row = fract(vFound.y / 0.05);
  float k = mix(0.62, 1.0, smoothstep(0.0, 0.16, min(row, 1.0 - row)));
  diffuseColor.rgb = vec3(0.6, 0.56, 0.5) * k * (0.8 + 0.2 * clamp(1.0 + vFound.y * 4.0, 0.0, 1.0));
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
  /** Wysokosci pol (swiat) dla shadera modeli - podworka budynkow na terenie (GROUND_GLSL). */
  private groundMap: { value: THREE.DataTexture | null } = { value: null };
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
      sh.uniforms.groundMap = this.groundMap;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 pat;\nattribute vec2 yard;\nattribute vec2 yardAt;\nvarying vec2 vPat;\nvarying vec2 vFound;\n' + GROUND_GLSL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pat;\n' + YARD_VERTEX)
        // Kolor gracza tylko na koszulce: sciany PLAIN (skora, spodnie) zostaja w kolorze wierzcholkow.
        .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nif (abs(floor((pat.x + 500.0) / 1000.0) - 6.0) < 0.5) vColor.xyz = color.xyz;\n#endif');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFound;\n' + MODEL_PATTERNS)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = patternColor(vPat, diffuseColor.rgb);\n' + FOUNDATION_FRAGMENT);
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
    this.groundMap.value?.dispose();
    const tex = new THREE.DataTexture(new Float32Array(map.w * map.h), map.w, map.h, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    this.groundMap.value = tex;
    this.refreshGround();
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

  /** Wysokosci wszystkich pol do tekstury shadera (np. po przewinieciu gry z wyrownywaniem terenu). */
  refreshGround(): void {
    const tex = this.groundMap.value;
    if (!tex) return;
    const data = tex.image.data as Float32Array;
    for (let i = 0; i < data.length; i++) data[i] = this.map.height[i] * H_SCALE;
    tex.needsUpdate = true;
    this.entities?.clearBases();
  }

  /** Po tickach symulacji: zmiany obiektow mapy, drog, wysokosci terenu. */
  syncState(s: GameState, events: GameEvent[]): void {
    if (events.length) this.entities.onEvents(events);
    for (const e of events) {
      if (e.type === 'height') {
        this.terrain.markDirty(e.pos);
        this.objects.markHeight(e.pos);
        this.roads.invalidate();
        const tex = this.groundMap.value;
        if (tex) {
          (tex.image.data as Float32Array)[e.pos] = s.map.height[e.pos] * H_SCALE;
          tex.needsUpdate = true;
        }
      }
    }
    this.objects.sync(s);
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
