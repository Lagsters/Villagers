import { createGame } from '../sim/state.ts';
import { PLAYER_COLORS } from '../sim/defs.ts';
import '../sim/index.ts';
import { SceneRenderer } from './render/scene.ts';
import { InputController } from './input.ts';
import { GameSession, LocalDriver } from './game/session.ts';
import { Hud } from './ui/hud.ts';
import { openSettings } from './ui/settingsPanel.ts';
import { openStats } from './ui/statsPanel.ts';
import { canBuild, canPlaceFlag, neighbor } from '../sim/world.ts';
import { findRoadPath } from '../sim/roads.ts';
import { spiral } from '../sim/grid.ts';

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'view';
app.appendChild(canvas);

const params = new URLSearchParams(location.search);
const state = createGame({
  mapCode: params.get('map') ?? 'DOLINA',
  mapSize: Number(params.get('size') ?? 96),
  players: Array.from({ length: Number(params.get('players') ?? 2) }, (_, i) => ({ name: i === 0 ? 'Ty' : `Bot ${i}`, color: PLAYER_COLORS[i], ai: i === 0 ? 0 : 1 })),
  seed: 1,
});

let view: SceneRenderer;
try {
  view = new SceneRenderer(canvas, { quality: 'medium', maxDpr: 1, fpsLimit: 30 });
} catch (e) {
  app.innerHTML = '<div class="fatal"><h1>Brak WebGL</h1><p>Ta przeglądarka nie może wyświetlić grafiki 3D (WebGL). Włącz akcelerację sprzętową albo użyj aktualnej przeglądarki.</p></div>';
  app.dataset.ready = 'nowebgl';
  throw e;
}
view.setMap(state.map);
const fit = () => view.resize(app.clientWidth, app.clientHeight);
fit();
window.addEventListener('resize', fit);
view.lookAtIdx(state.players[0].start);

const driver = new LocalDriver();
const session = new GameSession(state, driver, 0);
const hud = new Hud(app, session, {
  setPreview: (cells, ok) => view.overlay.setPreview(session.state, cells, ok),
  setCursor: (i) => view.setCursor(i),
  lookAt: (i) => view.lookAtIdx(i),
  toggleSites: (on) => { view.overlay.enabledSites = on; },
  openMenu: () => {},
  openPanel: (name) => (name === 'settings' ? openSettings(app, session) : openStats(app, session)),
});

const input = new InputController(canvas, view.cam, {
  onTap: (x, y, b) => hud.onTap(view.pick(x, y), b),
  onHover: (x, y) => hud.onHover(view.pick(x, y)),
  onKey: (e) => hud.onKey(e),
}, () => view.height);

let endShown = false;
function showEnd(winner: number) {
  const s = session.state;
  const box = document.createElement('div');
  box.className = 'end-screen';
  const won = winner === session.localPlayer;
  box.innerHTML = `<h1>${won ? 'Zwycięstwo!' : 'Koniec gry'}</h1><p>${winner >= 0 ? `Wygrywa: ${s.players[winner].name}` : 'Remis'}</p>`;
  const b = document.createElement('button');
  b.textContent = 'Oglądaj dalej';
  b.onclick = () => box.remove();
  box.appendChild(b);
  app.appendChild(box);
}

let last = performance.now();
let lastFrame = 0;
let lastHud = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const minDt = 1000 / view.options.fpsLimit;
  if (now - lastFrame < minDt - 2) return;
  lastFrame = now;
  const dtMs = Math.min(250, now - last);
  last = now;
  input.update(dtMs / 1000);
  const t0 = session.state.tick;
  session.update(dtMs);
  if (session.state.tick !== t0) {
    const ev = session.takeEvents();
    view.syncState(session.state, ev);
    hud.onEvents(ev);
    if (session.state.winner !== -1 && !endShown) {
      endShown = true;
      showEnd(session.state.winner);
    }
  }
  view.render(dtMs / 1000, session.state, session.alpha, session.localPlayer);
  if (now - lastHud > 250) {
    lastHud = now;
    hud.update();
  }
}
requestAnimationFrame(frame);
app.dataset.ready = '1';
// Dostep dla testow e2e i debugowania.
(window as unknown as { __game: unknown }).__game = { session, view, hud, sim: { canBuild, canPlaceFlag, neighbor, findRoadPath, spiral } };
