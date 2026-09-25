/** Ustawienia gospodarki: rozdzial towarow, priorytety narzedzi i transportu, obsada wojska. */
import { FIRST_TOOL, GOOD_NAMES_PL, GOODS_COUNT, TOOLS_COUNT } from '../../sim/defs.ts';
import type { Settings } from '../../sim/types.ts';
import type { GameSession } from '../game/session.ts';
import { button, el } from './dom.ts';
import { Modal } from './modal.ts';

type Key = keyof Settings;

function slider(session: GameSession, label: string, key: Key, max = 8): HTMLElement {
  const row = el('label', 'slider-row');
  row.appendChild(el('span', 'slider-label', label));
  const input = el('input');
  input.type = 'range';
  input.min = '0';
  input.max = String(max);
  input.step = '1';
  const me = session.localPlayer;
  input.value = String(session.state.players[me].settings[key] as number);
  const val = el('span', 'slider-val', input.value);
  input.addEventListener('input', () => {
    val.textContent = input.value;
  });
  input.addEventListener('change', () => {
    session.submit({ type: 'setting', player: me, key, value: Number(input.value) });
  });
  row.appendChild(input);
  row.appendChild(val);
  return row;
}

function group(title: string, rows: HTMLElement[]): HTMLElement {
  const g = el('div', 'set-group');
  g.appendChild(el('h4', '', title));
  for (const r of rows) g.appendChild(r);
  return g;
}

const TOOL_NAMES = GOOD_NAMES_PL.slice(FIRST_TOOL, FIRST_TOOL + TOOLS_COUNT);

export function openSettings(parent: HTMLElement, session: GameSession): Modal {
  const m = new Modal(parent, 'Gospodarka', true);
  const me = session.localPlayer;
  const st = () => session.state.players[me].settings;
  m.tabs([
    ['Rozdział', (body) => {
      const grid = el('div', 'set-grid');
      grid.appendChild(group('Jedzenie dla kopalń', [
        slider(session, 'Węgiel', 'foodCoal'), slider(session, 'Żelazo', 'foodIron'),
        slider(session, 'Złoto', 'foodGold'), slider(session, 'Kamień', 'foodStone'),
      ]));
      grid.appendChild(group('Deski', [
        slider(session, 'Budowa', 'plankConstruction'), slider(session, 'Stocznia', 'plankShipyard'),
        slider(session, 'Kuźnia narzędzi', 'plankToolmaker'),
      ]));
      grid.appendChild(group('Żelazo', [slider(session, 'Kuźnia narzędzi', 'steelToolmaker'), slider(session, 'Zbrojownia', 'steelWeaponsmith')]));
      grid.appendChild(group('Węgiel', [
        slider(session, 'Huta żelaza', 'coalSteel'), slider(session, 'Mennica', 'coalGold'), slider(session, 'Zbrojownia', 'coalWeapons'),
      ]));
      grid.appendChild(group('Zboże', [
        slider(session, 'Młyn', 'wheatMill'), slider(session, 'Chlewnia', 'wheatPig'), slider(session, 'Browar', 'wheatBrewery'),
        slider(session, 'Hodowla osłów', 'wheatDonkey'), slider(session, 'Smolarnia', 'wheatCharburner'),
      ]));
      grid.appendChild(group('Woda', [
        slider(session, 'Piekarnia', 'waterBakery'), slider(session, 'Chlewnia', 'waterPig'), slider(session, 'Browar', 'waterBrewery'),
        slider(session, 'Hodowla osłów', 'waterDonkey'),
      ]));
      body.appendChild(grid);
      body.appendChild(el('p', 'hint', 'Waga 0 = nie dostarczaj. Przy równych wagach odbiorcy dostają na zmianę.'));
    }],
    ['Narzędzia', (body) => {
      body.appendChild(el('p', 'hint', 'Kuźnia robi narzędzie o najwyższym priorytecie, a braki osadników czekających na narzędzie go podbijają.'));
      const rows = TOOL_NAMES.map((name, i) => {
        const row = el('label', 'slider-row');
        row.appendChild(el('span', 'slider-label', name));
        const input = el('input');
        input.type = 'range';
        input.min = '0';
        input.max = '8';
        input.value = String(st().toolPrio[i]);
        const val = el('span', 'slider-val', input.value);
        input.addEventListener('input', () => { val.textContent = input.value; });
        input.addEventListener('change', () => {
          const v = st().toolPrio.slice();
          v[i] = Number(input.value);
          session.submit({ type: 'setting', player: me, key: 'toolPrio', value: v });
        });
        row.appendChild(input);
        row.appendChild(val);
        return row;
      });
      body.appendChild(group('Priorytety', rows));
    }],
    ['Transport', (body) => {
      body.appendChild(el('p', 'hint', 'Tragarze zabierają z flag najpierw towary wyżej na liście.'));
      const list = el('ol', 'prio-list');
      const render = (order: number[]) => {
        list.textContent = '';
        order.forEach((g, i) => {
          const li = el('li');
          li.appendChild(el('span', '', GOOD_NAMES_PL[g]));
          const up = button('▲', () => move(order, i, -1), 'Wyżej');
          const down = button('▼', () => move(order, i, 1), 'Niżej');
          if (i === 0) up.disabled = true;
          if (i === order.length - 1) down.disabled = true;
          li.appendChild(up);
          li.appendChild(down);
          list.appendChild(li);
        });
      };
      const current = () => {
        const prio = st().transportPrio;
        return Array.from({ length: GOODS_COUNT }, (_, g) => g).sort((a, b) => prio[b] - prio[a] || a - b);
      };
      const move = (order: number[], i: number, d: number) => {
        const o = order.slice();
        const j = i + d;
        [o[i], o[j]] = [o[j], o[i]];
        const prio = new Array(GOODS_COUNT).fill(0);
        o.forEach((g, k) => { prio[g] = GOODS_COUNT - k; });
        session.submit({ type: 'setting', player: me, key: 'transportPrio', value: prio });
        render(o);
      };
      render(current());
      body.appendChild(list);
    }],
    ['Wojsko', (body) => {
      body.appendChild(group('Minimalna obsada budynków wojskowych', [
        slider(session, 'W głębi kraju', 'knightsInterior', 8),
        slider(session, 'Przy granicy', 'knightsBorder', 8),
        slider(session, 'Przy wrogu', 'knightsEnemy', 8),
      ]));
      body.appendChild(group('Rezerwy', [
        slider(session, 'Rycerze w zamku', 'castleKnights', 20),
        slider(session, 'Wolni osadnicy (nie zamieniaj na rycerzy)', 'serfReserve', 20),
      ]));
      body.appendChild(el('p', 'hint', 'Wartość większa niż pojemność budynku oznacza pełną obsadę.'));
    }],
  ]);
  return m;
}
