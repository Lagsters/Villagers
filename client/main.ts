/**
 * Kontroler aplikacji: menu, gra z botami, gra sieciowa (lobby -> lockstep), zapis i odczyt.
 */
import { Bot } from '../ai/bot.ts';
import { PLAYER_COLORS } from '../sim/defs.ts';
import { deserialize, serialize } from '../sim/hash.ts';
import { createGame } from '../sim/state.ts';
import type { GameConfig, GameState } from '../sim/types.ts';
import { SIM_VERSION } from '../sim/version.ts';
import type { LockstepClient, LockstepHost } from '../net/lockstep.ts';
import { NetClient, NetHost } from '../net/netgame.ts';
import { SignalClient, signalErrorText } from '../net/signaling.ts';
import { SIGNAL_URL } from './config.ts';
import { GameView } from './game/gameView.ts';
import { LocalDriver } from './game/session.ts';
import { button, el } from './ui/dom.ts';
import { loadPrefs, savePrefs, showConnecting, showLobby, showMainMenu, showMultiplayer, showOptions, type MenuActions } from './ui/menu.ts';
import { Modal } from './ui/modal.ts';

const app = document.getElementById('app')!;
const prefs = loadPrefs();
let game: GameView | null = null;
let room: NetHost | NetClient | null = null;
const SAVE_KEY = 'osadnicy.save';

function endGame(): void {
  game?.dispose();
  game = null;
  room?.close();
  room = null;
}

function toMenu(): void {
  endGame();
  showMainMenu(app, prefs, actions);
}

function graphics() {
  return { ...prefs.graphics };
}

// ---------------- Gra lokalna ----------------

function localDriverFor(state: GameState): LocalDriver {
  const driver = new LocalDriver();
  for (const p of state.players) {
    if (p.ai > 0) {
      const bot = new Bot(p.id, p.ai, state.config.seed * 7919 + p.id);
      driver.producers.push((s) => bot.think(s));
    }
  }
  return driver;
}

function startLocalState(state: GameState): void {
  endGame();
  app.textContent = '';
  game = new GameView(app, state, localDriverFor(state), 0, { graphics: graphics(), network: false, onMenu: () => gameMenu(false) });
  app.dataset.ready = '1';
}

function saveGame(): boolean {
  if (!game) return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SIM_VERSION, when: Date.now(), state: serialize(game.session.state) }));
    return true;
  } catch {
    return false;
  }
}

function hasSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

function loadSaved(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { v: number; state: string };
    if (data.v !== SIM_VERSION) {
      alert('Zapis pochodzi z innej wersji gry.');
      return;
    }
    const state = deserialize<GameState>(data.state);
    state._events = [];
    startLocalState(state);
  } catch (e) {
    console.error(e);
    alert('Nie udało się wczytać zapisu.');
  }
}

/** Menu w trakcie gry. */
function gameMenu(network: boolean): void {
  const m = new Modal(app, 'Menu');
  const b = m.body;
  if (!network) {
    b.appendChild(button('Zapisz grę', () => {
      const ok = saveGame();
      game?.hud.toast(ok ? 'Gra zapisana' : 'Nie udało się zapisać (brak miejsca?)', ok ? '' : 'warn');
      m.close();
    }));
  }
  b.appendChild(button('Wróć do gry', () => m.close()));
  const quit = button(network ? 'Opuść grę' : 'Wyjdź do menu', () => { m.close(); toMenu(); });
  quit.classList.add('danger');
  b.appendChild(quit);
  b.appendChild(el('p', 'hint', network ? 'Po wyjściu twoją osadę przejmie bot.' : 'Niezapisany postęp przepadnie.'));
}

// ---------------- Gra sieciowa ----------------

function startNetGame(config: GameConfig, player: number, driver: LockstepHost | LockstepClient): void {
  const state = createGame(config);
  game?.dispose();
  app.textContent = '';
  game = new GameView(app, state, driver, player, { graphics: graphics(), network: true, onMenu: () => gameMenu(true) });
  app.dataset.ready = '1';
  app.dataset.net = 'game';
  driver.onDesync = (d) => {
    console.error('Desynchronizacja', { tick: d.tick, gracz: d.player, lokalny: d.local, zdalny: d.remote, tury: d.recentTurns });
    game?.showMessage('Desynchronizacja', `Stany gry rozjechały się w ticku ${d.tick}. Gra nie może być kontynuowana.`, [
      ['Pobierz diagnostykę', () => downloadText(`desync-${d.tick}.json`, JSON.stringify(d))],
      ['Menu', toMenu],
    ]);
  };
  driver.onTakeover = (p) => game?.hud.toast(`${state.players[p].name} rozłączył się - osadę przejmuje bot.`, 'warn');
}

function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function connectSignal(): Promise<SignalClient> {
  const s = new SignalClient();
  await s.connect(SIGNAL_URL);
  return s;
}

async function createRoom(name: string): Promise<void> {
  showConnecting(app, 'Łączenie z serwerem…', () => { room?.close(); room = null; showMultiplayer(app, prefs, actions); });
  try {
    const sig = await connectSignal();
    const code = await sig.create(name);
    const host = new NetHost(sig, code, name);
    room = host;
    const redraw = () => {
      if (game) return;
      showLobby(app, host.state, {
        isHost: true,
        myPeer: sig.peerId,
        setReady: () => {},
        setColor: (c) => host.setColor(c),
        setMap: (c, s) => host.setMap(c, s),
        addBot: (l) => host.addBot(l),
        remove: (i) => host.removePlayer(i),
        start: () => host.start(),
        canStart: () => host.canStart(),
        leave: () => { host.close(); room = null; showMultiplayer(app, prefs, actions); },
      });
      app.dataset.net = 'lobby';
    };
    host.events = {
      onLobby: redraw,
      onStart: (cfg, player, driver) => startNetGame(cfg, player, driver),
      onError: (t) => { endGame(); showMultiplayer(app, prefs, actions, t); },
      onPeerLeft: (n) => game?.hud.toast(`${n} opuścił grę`, 'warn'),
    };
    redraw();
    // Odswiezanie przycisku startu, gdy kanaly sie otwieraja.
    const iv = setInterval(() => { if (room !== host || game) clearInterval(iv); else redraw(); }, 1000);
  } catch (e) {
    showMultiplayer(app, prefs, actions, (e as Error).message);
  }
}

async function joinRoom(code: string, name: string): Promise<void> {
  showConnecting(app, 'Dołączanie…', () => { room?.close(); room = null; showMultiplayer(app, prefs, actions); });
  try {
    const sig = await connectSignal();
    const hostId = await sig.join(code, name);
    const client = new NetClient(sig, hostId, name);
    room = client;
    let myColor = PLAYER_COLORS[1];
    client.events = {
      onLobby: (st) => {
        if (game) return;
        myColor = st.players.find((p) => p.peerId === sig.peerId)?.color ?? myColor;
        showLobby(app, st, {
          isHost: false,
          myPeer: sig.peerId,
          setReady: (v) => client.setReady(v),
          setColor: (c) => client.setColor(c),
          setMap: () => {},
          addBot: () => {},
          remove: () => {},
          start: () => {},
          canStart: () => false,
          leave: () => { client.close(); room = null; showMultiplayer(app, prefs, actions); },
        });
        app.dataset.net = 'lobby';
      },
      onStart: (cfg, player, driver) => startNetGame(cfg, player, driver),
      onHostLost: () => {
        if (game) game.showMessage('Koniec gry', 'Gospodarz opuścił grę - rozgrywka zakończona.', [['Menu', toMenu]]);
        else { room = null; showMultiplayer(app, prefs, actions, 'Gospodarz zamknął pokój.'); }
      },
      onError: (t) => { room = null; showMultiplayer(app, prefs, actions, t); },
    };
    showConnecting(app, 'Łączenie z gospodarzem…', () => { client.close(); room = null; showMultiplayer(app, prefs, actions); });
  } catch (e) {
    showMultiplayer(app, prefs, actions, signalErrorText((e as Error).message));
  }
}

const actions: MenuActions = {
  startLocal: (cfg) => startLocalState(createGame(cfg)),
  createRoom: (n) => void createRoom(n),
  joinRoom: (c, n) => void joinRoom(c, n),
  loadSaved,
  hasSave,
  options: () => showOptions(app, prefs, () => { savePrefs(prefs); showMainMenu(app, prefs, actions); }),
};

// Szybki start (dev, testy e2e): ?map=KOD&size=64&players=2
const params = new URLSearchParams(location.search);
if (params.has('map')) {
  const n = Number(params.get('players') ?? 2);
  startLocalState(createGame({
    mapCode: params.get('map')!,
    mapSize: Number(params.get('size') ?? 96),
    players: Array.from({ length: n }, (_, i) => ({ name: i === 0 ? 'Ty' : `Bot ${i}`, color: PLAYER_COLORS[i], ai: i === 0 ? 0 : Number(params.get('ai') ?? 1) })),
    seed: Number(params.get('seed') ?? 1),
  }));
} else {
  showMainMenu(app, prefs, actions);
  app.dataset.ready = 'menu';
}
