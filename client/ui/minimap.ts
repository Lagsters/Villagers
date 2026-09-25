/**
 * Minimapa: teren i terytoria (odswiezane co sekunde), budynki jako kropki, prostokat widoku kamery.
 * Klikniecie przenosi kamere. Rysowana w Canvas 2D (tanio).
 */
import { O, PLAYER_COLORS, T } from '../../sim/defs.ts';
import type { GameState } from '../../sim/types.ts';
import { ROW_H } from '../render/coords.ts';
import type { SceneRenderer } from '../render/scene.ts';

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [T.WATER]: [60, 110, 150],
  [T.GRASS]: [100, 150, 70],
  [T.DESERT]: [210, 190, 130],
  [T.MOUNTAIN]: [125, 115, 105],
  [T.SNOW]: [235, 238, 242],
};

export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  /** Bufor z obrazem mapy w skali 1 piksel = 1 pole. */
  private buf = document.createElement('canvas');
  private lastDraw = 0;
  private view: SceneRenderer;
  private state: () => GameState;
  private size = 176;

  constructor(parent: HTMLElement, view: SceneRenderer, state: () => GameState) {
    this.view = view;
    this.state = state;
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.title = 'Mapa - kliknij, żeby przenieść widok';
    this.el.width = this.size;
    this.el.height = this.size;
    parent.appendChild(this.el);
    this.ctx = this.el.getContext('2d')!;
    const go = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      const s = this.state();
      const mx = ((e.clientX - r.left) / r.width) * s.map.w;
      const my = ((e.clientY - r.top) / r.height) * s.map.h;
      this.view.cam.lookAt(mx, my * ROW_H);
    };
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      go(e);
      const move = (ev: PointerEvent) => go(ev);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** Odswiezenie (teren/terytorium co sekunde, prostokat kamery co klatke). */
  update(now: number): void {
    const s = this.state();
    const m = s.map;
    if (!this.img || now - this.lastDraw > 1000) {
      this.lastDraw = now;
      if (!this.img || this.img.width !== m.w) {
        this.buf.width = m.w;
        this.buf.height = m.h;
        this.img = this.buf.getContext('2d')!.createImageData(m.w, m.h);
      }
      const d = this.img.data;
      for (let i = 0; i < m.w * m.h; i++) {
        let [r, g, b] = TERRAIN_RGB[m.terrain[i]] ?? [0, 0, 0];
        const o = m.owner[i];
        if (o) {
          const pc = PLAYER_COLORS[o - 1];
          const k = 0.5;
          r = r * (1 - k) + ((pc >> 16) & 255) * k;
          g = g * (1 - k) + ((pc >> 8) & 255) * k;
          b = b * (1 - k) + (pc & 255) * k;
        }
        if (m.obj[i] === O.TREE) { r *= 0.7; g *= 0.8; b *= 0.7; }
        if (m.roads[i]) { r = 200; g = 170; b = 120; }
        if (m.obj[i] === O.BUILDING || m.obj[i] === O.BUILDING_PART) { r = 30; g = 25; b = 20; }
        d[i * 4] = r;
        d[i * 4 + 1] = g;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = 255;
      }
      this.buf.getContext('2d')!.putImageData(this.img, 0, 0);
    }
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.buf, 0, 0, this.size, this.size);
    // Prostokat widoku (srodek kamery i przyblizony zasieg).
    const cam = this.view.cam;
    const sx = this.size / m.w;
    const sy = this.size / m.h;
    const cx = cam.target.x * sx;
    const cy = (cam.target.z / ROW_H) * sy;
    const half = (cam.viewHalf / cam.zoom) * sx;
    const aspect = this.view.width / Math.max(1, this.view.height);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.5;
    c.strokeRect(cx - half * aspect, cy - half * 1.2, half * aspect * 2, half * 2.4);
  }
}
