/**
 * Tlo menu: mala partia dwoch botow z powoli krazaca kamera. Na niskiej jakosci grafiki wylaczone.
 */
import { Bot } from '../../ai/bot.ts';
import { PLAYER_COLORS } from '../../sim/defs.ts';
import { createGame } from '../../sim/state.ts';
import { step } from '../../sim/step.ts';
import type { GameState } from '../../sim/types.ts';
import { SceneRenderer, type GraphicsOptions } from '../render/scene.ts';

export class MenuBackdrop {
  private canvas: HTMLCanvasElement;
  private view: SceneRenderer;
  private state: GameState;
  private bots: Bot[];
  private raf = 0;
  private onResize: () => void;
  private angle = 0;
  private center = 0;

  constructor(parent: HTMLElement, graphics: GraphicsOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'backdrop';
    parent.prepend(this.canvas);
    this.state = createGame({
      mapCode: 'DOLINA',
      mapSize: 64,
      players: [0, 1].map((i) => ({ name: `Bot ${i}`, color: PLAYER_COLORS[i], ai: 2 })),
      seed: 7,
    });
    this.bots = [new Bot(0, 2, 11), new Bot(1, 2, 12)];
    // Osada na starcie juz troche rozbudowana.
    for (let i = 0; i < 4000; i++) this.tick();
    this.view = new SceneRenderer(this.canvas, { ...graphics, fpsLimit: 30 });
    this.view.setMap(this.state.map);
    this.view.syncState(this.state, []);
    this.center = this.state.buildings[this.state.players[0].castle]!.pos;
    this.view.cam.zoom = 1.3;
    this.view.lookAtIdx(this.center);
    this.onResize = () => this.view.resize(parent.clientWidth, parent.clientHeight);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private tick(): void {
    const cmds = [];
    for (const b of this.bots) for (const c of b.think(this.state)) cmds.push(c);
    step(this.state, cmds);
  }

  private loop(): void {
    let last = performance.now();
    let acc = 0;
    let lastFrame = 0;
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      if (now - lastFrame < 31) return;
      lastFrame = now;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt * 1000;
      let ticked = false;
      while (acc >= 100) {
        this.tick();
        acc -= 100;
        ticked = true;
      }
      if (ticked) this.view.syncState(this.state, this.state._events);
      // Powolne krazenie kamery wokol zamku.
      this.angle += dt * 0.05;
      const m = this.state.map;
      const cx = (this.center % m.w) + Math.cos(this.angle) * 4;
      const cy = ((this.center / m.w) | 0) + Math.sin(this.angle) * 4;
      this.view.cam.lookAt(cx, cy * 0.866);
      this.view.render(dt, this.state, acc / 100, 0);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.view.renderer.dispose();
    this.canvas.remove();
  }
}
