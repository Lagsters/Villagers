import { createGame } from '../sim/state.ts';
import { PLAYER_COLORS } from '../sim/defs.ts';
import { SceneRenderer } from './render/scene.ts';
import { InputController } from './input.ts';

const TERRAIN_PL = ['Woda', 'Trawa', 'Pustynia', 'Góry', 'Śnieg'];

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'view';
app.appendChild(canvas);
const info = document.createElement('div');
info.className = 'hud-info';
app.appendChild(info);

const params = new URLSearchParams(location.search);
const state = createGame({
  mapCode: params.get('map') ?? 'DOLINA',
  mapSize: Number(params.get('size') ?? 96),
  players: Array.from({ length: Number(params.get('players') ?? 4) }, (_, i) => ({ name: `Gracz ${i + 1}`, color: PLAYER_COLORS[i], ai: i === 0 ? 0 : 1 })),
  seed: 1,
});

const view = new SceneRenderer(canvas, { quality: 'medium', maxDpr: 1, fpsLimit: 30 });
view.setMap(state.map);
const fit = () => view.resize(app.clientWidth, app.clientHeight);
fit();
window.addEventListener('resize', fit);
view.lookAtIdx(state.players[0].start);

let selected = -1;
const input = new InputController(canvas, view.cam, {
  onTap: (x, y) => {
    selected = view.pick(x, y);
    view.setCursor(selected);
    const m = state.map;
    if (selected >= 0) {
      info.textContent = `Pole ${selected % m.w},${(selected / m.w) | 0} — ${TERRAIN_PL[m.terrain[selected]]}, wys. ${m.height[selected]}, obiekt ${m.obj[selected]}, złoże ${m.res[selected]}:${m.resAmt[selected]}`;
    }
  },
  onHover: () => {},
}, () => view.height);

let last = performance.now();
let lastFrame = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const minDt = 1000 / view.options.fpsLimit;
  if (now - lastFrame < minDt - 2) return;
  lastFrame = now;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  view.render(dt);
}
requestAnimationFrame(frame);
app.dataset.ready = '1';
(window as unknown as { __game: unknown }).__game = { state, view };
