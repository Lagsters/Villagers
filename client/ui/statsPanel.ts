/**
 * Statystyki: zapasy i produkcja (tabele) oraz porownanie graczy w czasie (wykres liniowy).
 * Kolor linii = kolor gracza (ta sama tozsamosc co w swiecie gry); tozsamosc zawsze niesie tez
 * legenda z nazwami, etykieta na koncu linii (do 4 graczy) i tabela biezacych wartosci.
 */
import { GOOD_NAMES_PL, GOODS_COUNT, PLAYER_COLORS } from '../../sim/defs.ts';
import { ST, summarize } from '../../sim/stats.ts';
import type { GameState } from '../../sim/types.ts';
import type { GameSession } from '../game/session.ts';
import { el } from './dom.ts';
import { Modal } from './modal.ts';

const METRICS: [string, number][] = [
  ['Terytorium', ST.TERRITORY],
  ['Budynki', ST.BUILDINGS],
  ['Osadnicy', ST.SERFS],
  ['Rycerze', ST.KNIGHTS],
  ['Siła wojska', ST.STRENGTH],
];

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function fmtTime(tick: number): string {
  const m = Math.floor(tick / 600);
  return `${m} min`;
}

function goodsTable(s: GameState, me: number): HTMLElement {
  const sum = summarize(s, me);
  const produced = s.players[me].stats.produced;
  const t = el('table', 'data-table');
  const head = el('tr');
  for (const h of ['Towar', 'W magazynach', 'Wyprodukowano']) head.appendChild(el('th', '', h));
  t.appendChild(head);
  for (let g = 0; g < GOODS_COUNT; g++) {
    const tr = el('tr');
    tr.appendChild(el('td', '', GOOD_NAMES_PL[g]));
    tr.appendChild(el('td', 'num', String(sum.goods[g])));
    tr.appendChild(el('td', 'num', String(produced[g])));
    t.appendChild(tr);
  }
  return t;
}

function compareChart(body: HTMLElement, s: GameState, me: number): void {
  const controls = el('div', 'chart-controls');
  const select = el('select');
  for (const [name, idx] of METRICS) {
    const o = el('option', '', name);
    o.value = String(idx);
    select.appendChild(o);
  }
  controls.appendChild(select);
  body.appendChild(controls);
  const wrap = el('div', 'chart-wrap');
  const canvas = el('canvas', 'chart');
  const tip = el('div', 'chart-tip hidden');
  wrap.appendChild(canvas);
  wrap.appendChild(tip);
  body.appendChild(wrap);
  const legend = el('div', 'legend');
  body.appendChild(legend);
  const table = el('table', 'data-table');
  body.appendChild(table);

  const players = s.players;
  for (const p of players) {
    const item = el('span', 'legend-item');
    const sw = el('span', 'swatch');
    sw.style.background = hex(PLAYER_COLORS[p.id]);
    item.appendChild(sw);
    item.appendChild(el('span', '', p.id === me && p.name !== 'Ty' ? `${p.name} (ty)` : p.name));
    legend.appendChild(item);
  }

  const W = 640, H = 300;
  const pad = { l: 44, r: players.length <= 4 ? 90 : 12, t: 12, b: 26 };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = '100%';
  canvas.style.aspectRatio = `${W} / ${H}`;
  const ctx = canvas.getContext('2d')!;

  let hoverI = -1;
  const draw = () => {
    const metric = Number(select.value);
    const series = players.map((p) => p.stats.samples.map((smp) => [smp[ST.TICK], smp[metric]] as [number, number]));
    const n = Math.max(0, ...series.map((x) => x.length));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px system-ui, sans-serif';
    const muted = 'rgba(242,234,211,0.55)';
    if (n < 2) {
      ctx.fillStyle = muted;
      ctx.fillText('Za mało danych - próbka co 30 s gry.', pad.l, H / 2);
      return;
    }
    let maxV = 1, maxT = 1;
    for (const ser of series) for (const [t, v] of ser) { maxV = Math.max(maxV, v); maxT = Math.max(maxT, t); }
    const nice = Math.pow(10, Math.floor(Math.log10(maxV)));
    maxV = Math.ceil(maxV / nice) * nice;
    const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r);
    const y = (v: number) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);
    // Siatka: recesywna, tylko poziome linie.
    ctx.strokeStyle = 'rgba(242,234,211,0.1)';
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = (maxV * k) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y(v) + 0.5);
      ctx.lineTo(W - pad.r, y(v) + 0.5);
      ctx.stroke();
      ctx.fillText(String(Math.round(v)), pad.l - 6, y(v) + 4);
    }
    ctx.textAlign = 'center';
    ctx.fillText(fmtTime(maxT), W - pad.r, H - 8);
    ctx.fillText('0', pad.l, H - 8);
    // Linie 2px; wlasny gracz na wierzchu.
    const order = players.map((p) => p.id).sort((a, b) => (a === me ? 1 : 0) - (b === me ? 1 : 0));
    for (const pid of order) {
      const ser = series[pid];
      if (ser.length < 2) continue;
      ctx.strokeStyle = hex(PLAYER_COLORS[pid]);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ser.forEach(([t, v], i) => (i ? ctx.lineTo(x(t), y(v)) : ctx.moveTo(x(t), y(v))));
      ctx.stroke();
    }
    // Etykiety na koncu linii (do 4 graczy), tekst w kolorze tekstu, nie serii.
    if (players.length <= 4) {
      ctx.textAlign = 'left';
      const ends = order.map((pid) => ({ pid, yy: y(series[pid].at(-1)?.[1] ?? 0) })).sort((a, b) => a.yy - b.yy);
      for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 13) ends[i].yy = ends[i - 1].yy + 13;
      for (const e of ends) {
        ctx.fillStyle = hex(PLAYER_COLORS[e.pid]);
        ctx.fillRect(W - pad.r + 6, e.yy - 4, 8, 8);
        ctx.fillStyle = 'rgba(242,234,211,0.9)';
        ctx.fillText(players[e.pid].name, W - pad.r + 18, e.yy + 4);
      }
    }
    // Celownik.
    if (hoverI >= 0) {
      const ref = series.find((sr) => sr.length === n)!;
      const t = ref[Math.min(hoverI, ref.length - 1)][0];
      ctx.strokeStyle = 'rgba(242,234,211,0.4)';
      ctx.beginPath();
      ctx.moveTo(x(t) + 0.5, pad.t);
      ctx.lineTo(x(t) + 0.5, H - pad.b);
      ctx.stroke();
      for (const pid of order) {
        const pt = series[pid][hoverI];
        if (!pt) continue;
        ctx.fillStyle = hex(PLAYER_COLORS[pid]);
        ctx.strokeStyle = '#1c2018';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x(pt[0]), y(pt[1]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Tabela biezacych wartosci.
    table.textContent = '';
    const hr = el('tr');
    hr.appendChild(el('th', '', 'Gracz'));
    hr.appendChild(el('th', '', select.selectedOptions[0].textContent ?? ''));
    table.appendChild(hr);
    for (const p of players) {
      const tr = el('tr');
      tr.appendChild(el('td', '', p.name));
      tr.appendChild(el('td', 'num', String(series[p.id].at(-1)?.[1] ?? 0)));
      table.appendChild(tr);
    }
  };

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const metric = Number(select.value);
    const ref = players.map((p) => p.stats.samples).find((x) => x.length) ?? [];
    if (ref.length < 2) return;
    const maxT = Math.max(...players.map((p) => p.stats.samples.at(-1)?.[ST.TICK] ?? 0), 1);
    const t = ((px - pad.l) / (W - pad.l - pad.r)) * maxT;
    let best = 0;
    ref.forEach((smp, i) => { if (Math.abs(smp[ST.TICK] - t) < Math.abs(ref[best][ST.TICK] - t)) best = i; });
    hoverI = best;
    draw();
    tip.classList.remove('hidden');
    tip.textContent = '';
    tip.appendChild(el('div', 'tip-title', fmtTime(ref[best][ST.TICK])));
    for (const p of players) {
      const smp = p.stats.samples[best];
      if (!smp) continue;
      const row = el('div', 'tip-row');
      const sw = el('span', 'swatch');
      sw.style.background = hex(PLAYER_COLORS[p.id]);
      row.appendChild(sw);
      row.appendChild(el('span', '', `${p.name}: `));
      row.appendChild(el('b', '', String(smp[metric])));
      tip.appendChild(row);
    }
    const left = (e.clientX - r.left) > r.width / 2;
    tip.style.left = left ? '' : `${e.clientX - r.left + 14}px`;
    tip.style.right = left ? `${r.right - e.clientX + 14}px` : '';
    tip.style.top = `${e.clientY - r.top + 8}px`;
  });
  canvas.addEventListener('pointerleave', () => {
    hoverI = -1;
    tip.classList.add('hidden');
    draw();
  });
  select.addEventListener('change', draw);
  draw();
}

export function openStats(parent: HTMLElement, session: GameSession): Modal {
  const m = new Modal(parent, 'Statystyki', true);
  const s = session.state;
  const me = session.localPlayer;
  m.tabs([
    ['Porównanie', (body) => compareChart(body, s, me)],
    ['Towary', (body) => body.appendChild(goodsTable(s, me))],
  ]);
  return m;
}
