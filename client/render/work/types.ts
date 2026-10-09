/**
 * Sceny pracy zawodow: krotkie, czytelne sekwencje ruchow (jak drwal okrzesujacy drzewo na pienku).
 * Kazdy plik w client/render/work/ eksportuje zestaw scen (Scenes) dla swoich zawodow i budynkow;
 * index.ts laczy je w jeden rejestr. Sceny tylko rysuja (nic nie zmieniaja w stanie gry): pozycje,
 * etapy i postep biora ze stanu symulacji (podstan osadnika, timer, faza budynku) i z czasu animacji.
 */
import type * as THREE from 'three';
import type { Animal, Building, GameEvent, GameState, Serf } from '../../../sim/types.ts';
import type { Fx } from '../fx.ts';
import type { Pose, RigFrames } from '../rig.ts';
import type { Rect } from '../yard.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Srodek modelu budynku w swiecie i jego skala (modele budynkow sa obrocone o 30 stopni ku fladze); y - poziom
 * budynku: najwyzszy punkt terenu pod jego obrysem, najwyzej o MAX_LIFT ponad polem (client/render/entities.ts);
 * nizej sciany schodza do terenu jak podmurowka.
 */
export interface Origin extends Vec3 {
  sc: number;
  /** obrys konstrukcji modelu (client/render/yard.ts) - poza nim podworko lezy na terenie; null - brak podworka */
  yard: readonly Rect[] | null;
}

/** Polozenie osadnika w tej klatce (interpolowane miedzy polami). */
export interface SerfAt extends Vec3 {
  /** kierunek ruchu albo domyslny obrot postaci (atan2(dx, dz)) */
  rot: number;
  /** czy idzie (krok miedzy polami) */
  moving: boolean;
  /** postep biezacego kroku 0..1 */
  t: number;
  /** faza chodu (rad) - do wymachu nog i rak */
  walk: number;
  /** podskok chodu (swiat) */
  bob: number;
  /** pole, z ktorego idzie, i pole docelowe kroku (-1 gdy stoi) */
  from: number;
  to: number;
}

export interface WorkCtx {
  readonly s: GameState;
  /** czas animacji (s) - plynie z tempem gry, stoi przy pauzie */
  readonly time: number;
  /** krok czasu animacji tej klatki (s) */
  readonly dt: number;
  /** postep miedzy tickami symulacji 0..1 */
  readonly alpha: number;
  readonly fx: Fx;
  /** czy rysowac drobne detale (czapki, narzedzia, drobne rekwizyty) - przy przyblizeniu */
  readonly details: boolean;

  /** Postac w pozie; zwraca macierze stawow (do przyczepiania rekwizytow). Pole carry - towar na glowie. */
  figure(p: Pose): RigFrames;
  /** Domyslna poza osadnika w tej klatce (chod, towar na glowie, ogolne machanie przy pracy) - do zmiany w scenie. */
  walkPose(serf: Serf, at: SerfAt): Pose;
  /**
   * Rytm uderzen (mlotek, siekiera, kilof): `rate` uderzen na sekunde, przesuniete o `offset` (np. id osadnika).
   * n - numer biezacego uderzenia, f - faza 0..1 od uderzenia, age - sekundy od uderzenia (do burst()).
   */
  beat(rate: number, offset?: number): { n: number; f: number; age: number };
  /** Krzywa zamachu dla fazy f z beat(): 0 w chwili uderzenia, plynnie w gore do 1 (f = 0.7), szybko w dol. */
  strike(f: number): number;
  /**
   * Rekwizyt (model art/models/<name>.glb) w punkcie swiata, obrocony wokol pionu; zwraca indeks instancji.
   * color (hex) - kolor instancji mnozony przez kolory wierzcholkow (model bialy = dowolny kolor), np. kolor gracza.
   */
  prop(name: string, x: number, y: number, z: number, rot?: number, s?: number, sy?: number, color?: number): number;
  /** Rekwizyt z dowolna macierza swiata. */
  propM(name: string, m: THREE.Matrix4, color?: number): number;
  /** Rekwizyt w ukladzie `frame` (staw postaci, uklad budynku): przesuniecie, obroty X, Y, Z (w tej kolejnosci od ukladu), skala. */
  propAt(name: string, frame: THREE.Matrix4, ox: number, oy: number, oz: number, rx?: number, ry?: number, rz?: number, s?: number, color?: number): number;
  /** Kolor gracza (hex). */
  playerColor(owner: number): number;
  /** Towar (model good_<g>) w punkcie swiata. */
  good(g: number, x: number, y: number, z: number, rot?: number, s?: number): void;
  /** Towar w ukladzie `frame`. */
  goodAt(g: number, frame: THREE.Matrix4, ox: number, oy: number, oz: number, rx?: number, ry?: number, rz?: number, s?: number): void;

  /** Srodek modelu gotowego budynku i skala (jak przy rysowaniu budynku). */
  origin(b: Building): Origin;
  /**
   * Punkt w ukladzie modelu budynku (wspolrzedne Blendera: lx w prawo, ly w glab - front na -Y, lz w gore)
   * w swiecie; y = podloze w tym miejscu (floor) + lz * skala. Wynik w `out` (domyslnie nowy obiekt).
   */
  at(o: Origin, lx: number, ly: number, lz?: number, out?: Vec3): Vec3;
  /**
   * Podloze w punkcie (lx, ly) ukladu modelu budynku, tak jak lezy tam model: przy scianach poziom budynku,
   * na podworku teren (plynne przejscie jak w shaderze modeli, client/render/yard.ts).
   */
  floor(o: Origin, lx: number, ly: number): number;
  /** Macierz ukladu modelu budynku (y w gore, os x jak w Blenderze, front budynku na +z) ze skala - do propAt. */
  frameOf(o: Origin): THREE.Matrix4;
  /** Obrot postaci patrzacej z punktu a na punkt b. */
  facing(ax: number, az: number, bx: number, bz: number): number;
  /** Kierunek od sceny ku kamerze (obrot jak u postaci: atan2(dx, dz)), zaokraglony do 60 stopni. */
  readonly toCamera: number;
  /**
   * Miejsce pracy przy obiekcie w (cx, cz): w odleglosci dist od niego, od strony kamery (kierunek zaokraglony
   * do 60 stopni, przesuniety o `turn` radianow), z obrotem twarza do obiektu; y = teren w tym miejscu.
   */
  beside(cx: number, cz: number, dist: number, turn?: number): Vec3 & { rot: number };
  /** Kierunek "na zewnatrz" frontu budynku (od drzwi ku fladze) jako obrot postaci. */
  readonly frontRot: number;
  /** Pole mapy w swiecie. */
  cell(i: number, out?: Vec3): Vec3;
  /** Pozycja flagi budynku w swiecie. */
  flagOf(b: Building, out?: Vec3): Vec3;
  /** Wysokosc terenu w punkcie swiata. */
  ground(x: number, z: number): number;
  /** Czy punkt jest w kadrze. */
  inView(x: number, z: number): boolean;
  /** Ukrywa w tej klatce statyczny obiekt mapy na polu (np. zboze koszone przez rolnika - scena rysuje je sama). */
  hideObject(cell: number): void;

  /** Pracownik budynku, jesli jest w srodku (nie wynosi towaru na flage), albo null. */
  workerInside(b: Building): Serf | null;
  /** Postep cyklu warsztatu 0..1 (b.phase != 0), albo -1, gdy warsztat stoi. */
  cycle(b: Building): number;
  /** Postep odliczania timera: 1 - (timer - alpha) / total, w granicach 0..1. */
  progress(timer: number, total: number): number;
}

/** Osadnik danego zawodu: zwraca true, gdy scena narysowala go sama (domyslny rysunek jest pomijany). */
export type SerfScene = (c: WorkCtx, serf: Serf, at: SerfAt) => boolean;
/** Gotowy budynek danego rodzaju (w kadrze): rekwizyty, postacie i efekty przed budynkiem. */
export type BuildingScene = (c: WorkCtx, b: Building, o: Origin) => void;
/** Plac budowy (w kadrze). */
export type SiteScene = (c: WorkCtx, b: Building, o: Origin) => void;
/** Dzikie zwierze: true, gdy scena narysowala je sama. */
export type AnimalScene = (c: WorkCtx, a: Animal, at: SerfAt) => boolean;

export interface Scenes {
  /** wg typu osadnika (S.*) */
  serf?: Partial<Record<number, SerfScene>>;
  /** wg rodzaju budynku (B.*), tylko gotowe budynki */
  building?: Partial<Record<number, BuildingScene>>;
  site?: SiteScene;
  animal?: AnimalScene;
  /** zdarzenia symulacji po tickach (efekty przejsciowe: upadek, lot pocisku) */
  events?: (c: WorkCtx, ev: readonly GameEvent[]) => void;
  /** co klatke, po osadnikach i budynkach (efekty przejsciowe) */
  frame?: (c: WorkCtx) => void;
}
