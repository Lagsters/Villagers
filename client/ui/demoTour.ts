/**
 * Panel trybu pokazowego (?demo=1): lista zawodow - klik przenosi kamere do pracujacego (budynek albo osadnik
 * w terenie, za ktorym kamera podaza), "Wycieczka" sama przechodzi po wszystkich zawodach co kilkanascie sekund.
 */
import { B, S } from '../../sim/defs.ts';
import { SS } from '../../sim/serfs.ts';
import type { GameState, Serf } from '../../sim/types.ts';
import type { GameView } from '../game/gameView.ts';
import { H_SCALE, vx, vz } from '../render/coords.ts';
import { button, el } from './dom.ts';

/** Zawod w pokazie: budynek, przy ktorym pracuje, albo osadnik do sledzenia (gdy jest w terenie). */
interface Stop {
  label: string;
  building?: number;
  serf?: (x: Serf) => boolean;
}

const out = (type: number) => (x: Serf) => x.type === type && x.state === SS.WORK_OUT;
const STOPS: Stop[] = [
  { label: 'Drwal', serf: out(S.WOODCUTTER), building: B.WOODCUTTER },
  { label: 'Leśnik', serf: out(S.FORESTER), building: B.FORESTER },
  { label: 'Kamieniarz', serf: out(S.STONECUTTER), building: B.STONECUTTER },
  { label: 'Rybak', serf: out(S.FISHER), building: B.FISHER },
  { label: 'Myśliwy', serf: out(S.HUNTER), building: B.HUNTER },
  { label: 'Rolnik', serf: out(S.FARMER), building: B.FARM },
  { label: 'Tracz', building: B.SAWMILL },
  { label: 'Młynarz', building: B.MILL },
  { label: 'Piekarz', building: B.BAKERY },
  { label: 'Rzeźnik', building: B.BUTCHER },
  { label: 'Hodowca świń', building: B.PIGFARM },
  { label: 'Hodowca osłów', building: B.DONKEYBREEDER },
  { label: 'Studniarz', building: B.WELL },
  { label: 'Piwowar', building: B.BREWERY },
  { label: 'Górnik', building: B.COALMINE },
  { label: 'Hutnik', building: B.STEELWORKS },
  { label: 'Kowal narzędzi', building: B.TOOLMAKER },
  { label: 'Płatnerz', building: B.WEAPONSMITH },
  { label: 'Mincerz', building: B.MINT },
  { label: 'Szkutnik', building: B.SHIPYARD },
  { label: 'Smolarz', building: B.CHARBURNER },
  { label: 'Tragarz', serf: (x) => x.type === S.TRANSPORTER && x.state === SS.CARRIER && x.carry >= 0 },
  { label: 'Budowniczy', serf: (x) => x.type === S.BUILDER && x.state === SS.BUILDER },
  { label: 'Kopacz', serf: (x) => x.type === S.DIGGER && x.state === SS.DIGGER },
  { label: 'Geolog', serf: (x) => x.type === S.GEOLOGIST && x.state === SS.GEOLOGIST },
  { label: 'Rycerze w walce', serf: (x) => x.type === S.KNIGHT && x.state >= SS.KNIGHT_ATTACK && x.state <= SS.KNIGHT_WAIT && x.owner === 0 },
  { label: 'Warta', building: B.TOWER },
  { label: 'Katapulta', building: B.CATAPULT },
];

const TOUR_MS = 14000;

export class DemoTour {
  private game: GameView;
  private following: Serf | null = null;
  private buttons: HTMLButtonElement[] = [];
  private tourBtn: HTMLButtonElement;
  private tourIdx = -1;
  private tourAt = 0;
  private touring = false;
  private raf = 0;

  constructor(game: GameView) {
    this.game = game;
    const panel = el('div', 'demo-tour');
    const head = el('div', 'demo-head');
    head.appendChild(el('b', '', 'Pokaz zawodów'));
    const fold = button('–', () => panel.classList.toggle('folded'), 'Zwiń / rozwiń');
    head.appendChild(fold);
    panel.appendChild(head);
    this.tourBtn = button('▶ Wycieczka', () => this.toggleTour(), 'Kamera sama przechodzi po wszystkich zawodach');
    this.tourBtn.classList.add('demo-tour-btn');
    panel.appendChild(this.tourBtn);
    const grid = el('div', 'demo-grid');
    STOPS.forEach((st, i) => {
      const b = button(st.label, () => { this.stopTour(); this.show(i); });
      this.buttons.push(b);
      grid.appendChild(b);
    });
    panel.appendChild(grid);
    game.hud.root.appendChild(panel);
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.update(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }

  private get s(): GameState {
    return this.game.session.state;
  }

  private toggleTour(): void {
    if (this.touring) this.stopTour();
    else {
      this.touring = true;
      this.tourBtn.classList.add('active');
      this.tourBtn.textContent = '■ Zatrzymaj';
      this.tourIdx = this.tourIdx < 0 ? -1 : this.tourIdx;
      this.next(performance.now());
    }
  }

  private stopTour(): void {
    this.touring = false;
    this.tourBtn.classList.remove('active');
    this.tourBtn.textContent = '▶ Wycieczka';
  }

  private next(now: number): void {
    this.tourIdx = (this.tourIdx + 1) % STOPS.length;
    this.tourAt = now;
    this.show(this.tourIdx);
  }

  /** Kamera do zawodu: osadnik pracujacy w terenie (sledzony) albo budynek gracza. */
  private show(i: number): void {
    const st = STOPS[i];
    this.buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    this.following = null;
    const cam = this.game.view.cam;
    if (st.serf) {
      const sf = this.s.serfs.find((x) => !!x && st.serf!(x)) ?? null;
      if (sf) {
        this.following = sf;
        cam.zoom = 9;
        this.game.view.lookAtIdx(sf.pos);
        return;
      }
    }
    if (st.building !== undefined) {
      const b = this.s.buildings.find((x) => x && x.owner === 0 && x.kind === st.building);
      if (b) {
        cam.zoom = 8;
        this.game.view.lookAtIdx(b.pos);
      }
    }
  }

  private update(now: number): void {
    if (this.touring && now - this.tourAt > TOUR_MS) this.next(now);
    const sf = this.following;
    if (!sf) return;
    if (this.s.serfs[sf.id] !== sf) {
      this.following = null;
      return;
    }
    // Plynne sledzenie: pozycja osadnika interpolowana miedzy polami (jak w rendererze).
    const m = this.s.map;
    const ax = vx(sf.pos % m.w, (sf.pos / m.w) | 0), az = vz((sf.pos / m.w) | 0);
    let x = ax, z = az, y = m.height[sf.pos] * H_SCALE;
    if (sf.to >= 0) {
      const t = Math.min(1, (sf.t + this.game.session.alpha) / Math.max(1, sf.dur));
      const bx = vx(sf.to % m.w, (sf.to / m.w) | 0), bz = vz((sf.to / m.w) | 0);
      x = ax + (bx - ax) * t;
      z = az + (bz - az) * t;
      y += (m.height[sf.to] * H_SCALE - y) * t;
    }
    const cam = this.game.view.cam;
    cam.target.y += (y - cam.target.y) * 0.2;
    cam.lookAt(cam.target.x + (x - cam.target.x) * 0.2, cam.target.z + (z - cam.target.z) * 0.2);
  }
}
