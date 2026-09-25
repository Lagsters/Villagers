/**
 * Widok rozgrywki: renderer, HUD, wejscie i petla klatek dla dowolnego zrodla komend
 * (gra lokalna z botami albo lockstep sieciowy).
 */
import '../../sim/index.ts';
import { findRoadPath } from '../../sim/roads.ts';
import { hexDist, spiral } from '../../sim/grid.ts';
import { Sound } from '../audio.ts';
import type { GameState } from '../../sim/types.ts';
import { canBuild, canPlaceFlag, neighbor } from '../../sim/world.ts';
import { InputController } from '../input.ts';
import { SceneRenderer, type GraphicsOptions } from '../render/scene.ts';
import { Hud } from '../ui/hud.ts';
import { openSettings } from '../ui/settingsPanel.ts';
import { openStats } from '../ui/statsPanel.ts';
import { GameSession, type TickDriver } from './session.ts';

export interface GameViewOptions {
  graphics: GraphicsOptions;
  volume: number;
  /** gra sieciowa: bez zmiany tempa i pauzy */
  network: boolean;
  onMenu(): void;
}

export class GameView {
  readonly session: GameSession;
  readonly view: SceneRenderer;
  readonly hud: Hud;
  private input: InputController;
  private raf = 0;
  private canvas: HTMLCanvasElement;
  private app: HTMLElement;
  private endShown = false;
  private onResize: () => void;
  private overlay: HTMLElement | null = null;
  readonly sound: Sound;

  constructor(app: HTMLElement, state: GameState, driver: TickDriver, localPlayer: number, opts: GameViewOptions) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'view';
    app.appendChild(this.canvas);
    this.view = new SceneRenderer(this.canvas, opts.graphics);
    this.view.setMap(state.map);
    this.onResize = () => this.view.resize(app.clientWidth, app.clientHeight);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.view.lookAtIdx(state.players[localPlayer].start);
    this.session = new GameSession(state, driver, localPlayer);
    this.sound = new Sound(opts.volume);
    this.sound.ambient(true);
    this.hud = new Hud(app, this.session, {
      setPreview: (cells, ok) => this.view.overlay.setPreview(this.session.state, cells, ok),
      setCursor: (i) => this.view.setCursor(i),
      lookAt: (i) => this.view.lookAtIdx(i),
      toggleSites: (on) => { this.view.overlay.enabledSites = on; },
      openMenu: () => opts.onMenu(),
      openPanel: (name) => (name === 'settings' ? openSettings(app, this.session) : openStats(app, this.session)),
    });
    this.hud.setSpeedEnabled(!opts.network);
    this.input = new InputController(this.canvas, this.view.cam, {
      onTap: (x, y, b) => {
        this.sound.click();
        this.hud.onTap(this.view.pick(x, y), b);
      },
      onHover: (x, y) => this.hud.onHover(this.view.pick(x, y)),
      onKey: (e) => this.hud.onKey(e),
    }, () => this.view.height);
    this.loop();
    // Dostep dla testow e2e i debugowania.
    (window as unknown as { __game: unknown }).__game = { session: this.session, view: this.view, hud: this.hud, sim: { canBuild, canPlaceFlag, neighbor, findRoadPath, spiral } };
  }

  private loop(): void {
    let last = performance.now();
    let lastFrame = 0;
    let lastHud = 0;
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const minDt = 1000 / this.view.options.fpsLimit;
      if (now - lastFrame < minDt - 2) return;
      lastFrame = now;
      const dtMs = Math.min(250, now - last);
      last = now;
      this.input.update(dtMs / 1000);
      const t0 = this.session.state.tick;
      this.session.update(dtMs);
      if (this.session.state.tick !== t0) {
        const ev = this.session.takeEvents();
        this.view.syncState(this.session.state, ev);
        this.hud.onEvents(ev);
        const center = this.view.centerIdx();
        const w = this.session.state.map.w;
        const reach = Math.ceil(16 / this.view.cam.zoom);
        this.sound.onEvents(ev, this.session.localPlayer, (pos) => hexDist(pos % w, (pos / w) | 0, center % w, (center / w) | 0) <= reach);
        if (this.session.state.winner !== -1 && !this.endShown) {
          this.endShown = true;
          this.showEnd(this.session.state.winner);
        }
      }
      this.view.render(dtMs / 1000, this.session.state, this.session.alpha, this.session.localPlayer);
      if (now - lastHud > 250) {
        lastHud = now;
        this.hud.update();
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Komunikat na srodku ekranu (koniec gry, utrata hosta, desynchronizacja). */
  showMessage(title: string, text: string, buttons: [string, () => void][]): void {
    this.overlay?.remove();
    const box = document.createElement('div');
    box.className = 'end-screen';
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    box.append(h, p);
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => fn();
      box.appendChild(b);
    }
    this.app.appendChild(box);
    this.overlay = box;
  }

  private showEnd(winner: number): void {
    const s = this.session.state;
    const won = winner === this.session.localPlayer;
    this.showMessage(won ? 'Zwycięstwo!' : 'Koniec gry', winner >= 0 ? `Wygrywa: ${s.players[winner].name}` : 'Remis', [
      ['Oglądaj dalej', () => { this.overlay?.remove(); this.overlay = null; }],
    ]);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.sound.ambient(false);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.session.driver.dispose?.();
    this.view.renderer.dispose();
    this.app.textContent = '';
  }
}
