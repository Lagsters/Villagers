/**
 * Ekrany poza rozgrywka: menu glowne, gra z botami, gra wieloosobowa, lobby, opcje.
 */
import { MAP_SIZES, PLAYER_COLORS, PLAYER_COLOR_NAMES_PL } from '../../sim/defs.ts';
import type { GameConfig } from '../../sim/types.ts';
import type { LobbyState } from '../../net/protocol.ts';
import { button, clear, el } from './dom.ts';

export interface GraphicsPrefs {
  quality: 'low' | 'medium';
  maxDpr: number;
  fpsLimit: number;
}

const PREFS_KEY = 'osadnicy.prefs';

export interface Prefs {
  name: string;
  graphics: GraphicsPrefs;
  volume: number;
}

export function loadPrefs(): Prefs {
  const def: Prefs = { name: 'Gracz', graphics: { quality: 'medium', maxDpr: 1, fpsLimit: 30 }, volume: 0.6 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...def, ...p, graphics: { ...def.graphics, ...(p.graphics ?? {}) } };
  } catch {
    return def;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // brak localStorage (tryb prywatny) - trudno
  }
}

function screen(parent: HTMLElement, title: string): HTMLElement {
  clear(parent);
  const wrap = el('div', 'menu-screen');
  const card = el('div', 'menu-card');
  card.appendChild(el('h1', 'menu-title', 'Osadnicy Doliny'));
  if (title) card.appendChild(el('h2', 'menu-sub', title));
  wrap.appendChild(card);
  parent.appendChild(wrap);
  return card;
}

function field(label: string, input: HTMLElement): HTMLElement {
  const row = el('label', 'menu-field');
  row.appendChild(el('span', '', label));
  row.appendChild(input);
  return row;
}

function textInput(value: string, maxLength: number, placeholder = ''): HTMLInputElement {
  const i = el('input');
  i.type = 'text';
  i.value = value;
  i.maxLength = maxLength;
  i.placeholder = placeholder;
  return i;
}

function sizeSelect(value: number): HTMLSelectElement {
  const s = el('select');
  const names: Record<number, string> = { 64: 'Mała (64)', 96: 'Średnia (96)', 128: 'Duża (128)', 160: 'Ogromna (160)' };
  for (const n of MAP_SIZES) {
    const o = el('option', '', names[n]);
    o.value = String(n);
    if (n === value) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

export function randomMapCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

export interface MenuActions {
  startLocal(cfg: GameConfig): void;
  createRoom(name: string): void;
  joinRoom(code: string, name: string): void;
  loadSaved(): void;
  hasSave(): boolean;
  options(): void;
}

export function showMainMenu(parent: HTMLElement, prefs: Prefs, a: MenuActions): void {
  const c = screen(parent, '');
  c.appendChild(el('p', 'menu-lead', 'Buduj drogi, stawiaj warsztaty, prowadź rycerzy. Gra z botami albo z przyjaciółmi (2–8 graczy).'));
  const list = el('div', 'menu-buttons');
  list.appendChild(button('Gra z botami', () => showLocalSetup(parent, prefs, a)));
  list.appendChild(button('Gra wieloosobowa', () => showMultiplayer(parent, prefs, a)));
  if (a.hasSave()) list.appendChild(button('Wczytaj zapisaną grę', () => a.loadSaved()));
  list.appendChild(button('Opcje', () => a.options()));
  c.appendChild(list);
}

export function showLocalSetup(parent: HTMLElement, prefs: Prefs, a: MenuActions): void {
  const c = screen(parent, 'Gra z botami');
  const name = textInput(prefs.name, 20);
  const code = textInput(randomMapCode(), 12, 'np. DOLINA');
  const size = sizeSelect(96);
  const bots = el('select');
  for (let i = 1; i <= 7; i++) {
    const o = el('option', '', String(i));
    o.value = String(i);
    if (i === 1) o.selected = true;
    bots.appendChild(o);
  }
  const level = el('select');
  for (const [v, t] of [['1', 'Łatwy'], ['2', 'Trudny']]) {
    const o = el('option', '', t);
    o.value = v;
    level.appendChild(o);
  }
  c.appendChild(field('Twoje imię', name));
  const codeRow = field('Kod mapy', code);
  codeRow.appendChild(button('Losuj', () => { code.value = randomMapCode(); }, 'Nowy losowy kod'));
  c.appendChild(codeRow);
  c.appendChild(field('Rozmiar mapy', size));
  c.appendChild(field('Liczba botów', bots));
  c.appendChild(field('Poziom botów', level));
  const row = el('div', 'menu-buttons row');
  row.appendChild(button('Wstecz', () => showMainMenu(parent, prefs, a)));
  const go = button('Rozpocznij', () => {
    prefs.name = name.value.trim() || 'Gracz';
    savePrefs(prefs);
    const n = Number(bots.value);
    const lv = Number(level.value);
    a.startLocal({
      mapCode: code.value,
      mapSize: Number(size.value),
      players: [
        { name: prefs.name, color: PLAYER_COLORS[0], ai: 0 },
        ...Array.from({ length: n }, (_, i) => ({ name: `${lv >= 2 ? 'Trudny' : 'Łatwy'} bot ${i + 1}`, color: PLAYER_COLORS[i + 1], ai: lv })),
      ],
      seed: (Math.random() * 0xffffffff) >>> 0,
    });
  });
  go.classList.add('primary');
  row.appendChild(go);
  c.appendChild(row);
}

export function showMultiplayer(parent: HTMLElement, prefs: Prefs, a: MenuActions, error = ''): void {
  const c = screen(parent, 'Gra wieloosobowa');
  if (error) c.appendChild(el('p', 'menu-error', error));
  const name = textInput(prefs.name, 20);
  c.appendChild(field('Twoje imię', name));
  const create = button('Utwórz pokój', () => {
    prefs.name = name.value.trim() || 'Gracz';
    savePrefs(prefs);
    a.createRoom(prefs.name);
  });
  create.classList.add('primary');
  c.appendChild(create);
  c.appendChild(el('p', 'menu-or', 'albo dołącz do pokoju znajomego'));
  const code = textInput('', 6, 'KOD');
  code.classList.add('room-code-input');
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const joinRow = field('Kod pokoju', code);
  const join = button('Dołącz', () => {
    prefs.name = name.value.trim() || 'Gracz';
    savePrefs(prefs);
    if (code.value.length === 6) a.joinRoom(code.value, prefs.name);
  });
  joinRow.appendChild(join);
  c.appendChild(joinRow);
  const row = el('div', 'menu-buttons row');
  row.appendChild(button('Wstecz', () => showMainMenu(parent, prefs, a)));
  c.appendChild(row);
}

export function showConnecting(parent: HTMLElement, text: string, onCancel: () => void): void {
  const c = screen(parent, text);
  c.appendChild(el('div', 'spinner'));
  c.appendChild(button('Anuluj', onCancel));
}

export interface LobbyActions {
  isHost: boolean;
  myPeer: string;
  setReady(v: boolean): void;
  setColor(c: number): void;
  setMap(code: string, size: number): void;
  addBot(level: number): void;
  remove(index: number): void;
  start(): void;
  canStart(): boolean;
  leave(): void;
}

/** Lobby: rysowane od nowa przy kazdej zmianie stanu. */
export function showLobby(parent: HTMLElement, st: LobbyState, a: LobbyActions): void {
  const c = screen(parent, 'Lobby');
  const codeBox = el('div', 'room-code');
  codeBox.appendChild(el('span', '', 'Kod pokoju'));
  const code = el('b', 'room-code-value', st.room);
  code.dataset.testid = 'room-code';
  codeBox.appendChild(code);
  codeBox.appendChild(el('span', 'hint', 'Podaj go znajomym - dołączą w menu „Gra wieloosobowa”.'));
  c.appendChild(codeBox);

  const table = el('div', 'lobby-players');
  st.players.forEach((p, i) => {
    const row = el('div', 'lobby-player');
    const sw = el('span', 'swatch big');
    sw.style.background = '#' + p.color.toString(16).padStart(6, '0');
    row.appendChild(sw);
    row.appendChild(el('span', 'lp-name', p.name + (p.peerId === a.myPeer ? ' (ty)' : '') + (i === 0 ? ' — gospodarz' : '')));
    row.appendChild(el('span', 'lp-kind', p.ai > 0 ? (p.ai >= 2 ? 'bot trudny' : 'bot łatwy') : 'człowiek'));
    const mine = p.peerId === a.myPeer;
    if (mine) {
      const sel = el('select');
      PLAYER_COLORS.forEach((col, k) => {
        const taken = st.players.some((x) => x !== p && x.color === col);
        const o = el('option', '', PLAYER_COLOR_NAMES_PL[k]);
        o.value = String(col);
        o.disabled = taken;
        if (col === p.color) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => a.setColor(Number(sel.value)));
      row.appendChild(sel);
    }
    row.appendChild(el('span', p.ready ? 'lp-ready yes' : 'lp-ready', p.ready ? 'gotowy' : 'czeka'));
    if (a.isHost && i > 0) row.appendChild(button('Usuń', () => a.remove(i), 'Usuń z pokoju'));
    table.appendChild(row);
  });
  c.appendChild(table);

  if (a.isHost) {
    const mapCode = textInput(st.mapCode, 12);
    const size = sizeSelect(st.mapSize);
    const apply = () => a.setMap(mapCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DOLINA', Number(size.value));
    mapCode.addEventListener('change', apply);
    size.addEventListener('change', apply);
    c.appendChild(field('Kod mapy', mapCode));
    c.appendChild(field('Rozmiar mapy', size));
    const bots = el('div', 'menu-buttons row');
    bots.appendChild(button('+ Łatwy bot', () => a.addBot(1)));
    bots.appendChild(button('+ Trudny bot', () => a.addBot(2)));
    c.appendChild(bots);
  } else {
    c.appendChild(el('p', '', `Mapa: ${st.mapCode}, rozmiar ${st.mapSize}`));
    const me = st.players.find((p) => p.peerId === a.myPeer);
    const r = button(me?.ready ? 'Nie jestem gotowy' : 'Jestem gotowy', () => a.setReady(!me?.ready));
    r.classList.add('primary');
    c.appendChild(r);
  }
  const row = el('div', 'menu-buttons row');
  row.appendChild(button('Wyjdź', () => a.leave()));
  if (a.isHost) {
    const start = button('Rozpocznij grę', () => a.start());
    start.classList.add('primary');
    start.disabled = !a.canStart();
    start.title = a.canStart() ? '' : 'Potrzeba co najmniej 2 graczy i wszyscy muszą być gotowi';
    row.appendChild(start);
  }
  c.appendChild(row);
}

export function showOptions(parent: HTMLElement, prefs: Prefs, onBack: () => void): void {
  const c = screen(parent, 'Opcje');
  const q = el('select');
  for (const [v, t] of [['low', 'Niska (bez wygładzania)'], ['medium', 'Średnia']]) {
    const o = el('option', '', t);
    o.value = v;
    if (v === prefs.graphics.quality) o.selected = true;
    q.appendChild(o);
  }
  const dpr = el('select');
  for (const v of [1, 1.5, 2]) {
    const o = el('option', '', v === 1 ? '1 (najszybciej)' : String(v));
    o.value = String(v);
    if (v === prefs.graphics.maxDpr) o.selected = true;
    dpr.appendChild(o);
  }
  const fps = el('select');
  for (const v of [30, 60]) {
    const o = el('option', '', `${v} kl./s`);
    o.value = String(v);
    if (v === prefs.graphics.fpsLimit) o.selected = true;
    fps.appendChild(o);
  }
  const vol = el('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.05';
  vol.value = String(prefs.volume);
  c.appendChild(field('Jakość grafiki', q));
  c.appendChild(field('Maks. gęstość pikseli', dpr));
  c.appendChild(field('Limit klatek', fps));
  c.appendChild(field('Głośność', vol));
  const row = el('div', 'menu-buttons row');
  const save = button('Zapisz', () => {
    prefs.graphics = { quality: q.value as 'low' | 'medium', maxDpr: Number(dpr.value), fpsLimit: Number(fps.value) };
    prefs.volume = Number(vol.value);
    savePrefs(prefs);
    onBack();
  });
  save.classList.add('primary');
  row.appendChild(button('Wstecz', onBack));
  row.appendChild(save);
  c.appendChild(row);
}
