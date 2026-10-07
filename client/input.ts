/**
 * Wejscie: mysz (klik = wybor, przeciaganie lewym = przesuwanie, przeciaganie prawym/srodkowym =
 * obrot (poziomo) i pochylenie (pionowo), kolko = zoom), klawiatura (WASD/strzalki, Q/E obrot,
 * R/F pochylenie, Home widok domyslny, +/- zoom) i dotyk (1 palec przesuwa, dotkniecie wybiera,
 * 2 palce: rozsuwanie = zoom, skret = obrot).
 */
import type { CameraController } from './render/camera.ts';

export interface InputHandlers {
  onTap(clientX: number, clientY: number, button: number): void;
  onHover(clientX: number, clientY: number): void;
  onKey?(e: KeyboardEvent): boolean;
}

const DRAG_THRESHOLD = 6;

export class InputController {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number }>();
  private dragging = false;
  private pinchDist = 0;
  private pinchAngle = 0;
  private keys = new Set<string>();
  private disposers: (() => void)[] = [];

  private el: HTMLElement;
  private cam: CameraController;
  private h: InputHandlers;
  private viewportH: () => number;

  constructor(el: HTMLElement, cam: CameraController, h: InputHandlers, viewportH: () => number) {
    this.el = el;
    this.cam = cam;
    this.h = h;
    this.viewportH = viewportH;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.cancel(e));
    on('wheel', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
      // Proporcjonalnie do ruchu (touchpad i plynne przewijanie wysylaja wiele malych zdarzen);
      // deltaMode 1 = linie, 2 = strony. Jeden zabek kolka (~100 px) to okolo 14%.
      // Gest szczypania na touchpadzie przychodzi jako wheel z ctrlKey i malymi wartosciami.
      const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1) * (e.ctrlKey ? 8 : 1);
      const f = Math.exp(-Math.max(-300, Math.min(300, px)) * 0.0013);
      this.cam.zoomAt(f, nx, ny);
    }, { passive: false });
    on('contextmenu', (e) => e.preventDefault());
    const kd = (e: KeyboardEvent) => this.keyDown(e);
    const ku = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.disposers.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); });
  }

  private down(e: PointerEvent): void {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
      this.dragging = true;
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.h.onHover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.cam.zoomBy(d / this.pinchDist);
      this.pinchDist = d;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      let da = ang - this.pinchAngle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.cam.rotateBy(-da);
      this.pinchAngle = ang;
      this.cam.panPixels(dx / 2, dy / 2, this.viewportH());
      return;
    }
    if (!this.dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG_THRESHOLD) this.dragging = true;
    if (this.dragging && (p.button === 1 || p.button === 2)) {
      // Prawy/srodkowy przycisk: obrot wokol pionu i pochylenie.
      this.cam.rotateBy(-dx * 0.008);
      this.cam.tiltBy(dy * 0.006);
    } else if (this.dragging) this.cam.panPixels(dx, dy, this.viewportH());
    else if (e.pointerType === 'mouse') this.h.onHover(e.clientX, e.clientY);
  }

  private up(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (!this.dragging && this.pointers.size === 0) this.h.onTap(e.clientX, e.clientY, p.button);
    if (this.pointers.size === 0) { this.dragging = false; this.pinchDist = 0; }
  }

  private cancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) { this.dragging = false; this.pinchDist = 0; }
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (this.h.onKey && this.h.onKey(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'q') this.cam.rotate(-1);
    else if (k === 'e') this.cam.rotate(1);
    else if (k === 'r') this.cam.tiltBy(0.15, true);
    else if (k === 'f') this.cam.tiltBy(-0.15, true);
    else if (k === 'home') this.cam.resetView();
    else if (k === '+' || k === '=') this.cam.zoomBy(1.15);
    else if (k === '-') this.cam.zoomBy(0.87);
    else this.keys.add(k);
  }

  /** Przesuwanie klawiatura - wywolywane co klatke. */
  update(dt: number): void {
    const sp = 18 * dt;
    let dx = 0, dz = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= sp;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += sp;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz += sp;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz -= sp;
    if (dx || dz) this.cam.panWorld(dx, dz);
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
