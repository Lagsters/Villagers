/**
 * Interfejs gry w DOM: gorny pasek, panel kontekstowy wybranego pola, tryb budowy drogi,
 * komunikaty. Nie zmienia stanu gry bezposrednio - wysyla komendy przez sesje.
 */
import { BUILDINGS, B, FIRST_TOOL, G, GOOD_NAMES_PL, GOODS_COUNT, O, S, SERF_NAMES_PL, SIZE, TOOLS_COUNT, isMilitary } from '../../sim/defs.ts';
import { DIR_SE } from '../../sim/grid.ts';
import { findRoadPath, roadAt } from '../../sim/roads.ts';
import { STAGE, type Building, type GameEvent, type GameState } from '../../sim/types.ts';
import { attackersAvailable } from '../../sim/military.ts';
import { iconUrl } from '../render/assets.ts';
import { canBuild, canPlaceFlag, neighbor } from '../../sim/world.ts';
import type { GameSession } from '../game/session.ts';
import { el, button, clear } from './dom.ts';

const TERRAIN_PL = ['Woda', 'Trawa', 'Pustynia', 'Góry', 'Śnieg'];

/** Ikona towaru z liczba (tooltip z nazwa). */
function goodChip(g: number, n: number): HTMLElement {
  const chip = el('span', 'inv-item good-chip');
  chip.title = GOOD_NAMES_PL[g];
  const src = iconUrl(`good_${g}`);
  if (src) {
    const img = el('img', 'good-icon');
    img.src = src;
    img.alt = GOOD_NAMES_PL[g];
    chip.appendChild(img);
  } else chip.appendChild(el('span', '', GOOD_NAMES_PL[g] + ':'));
  chip.appendChild(el('b', '', String(n)));
  return chip;
}
const RES_PL = ['nic', 'węgiel', 'żelazo', 'złoto', 'kamień', 'ryby'];
const STAGE_PL = ['Wyrównywanie terenu', 'W budowie', 'Gotowy', 'Płonie'];

export interface HudCallbacks {
  setPreview(cells: number[] | null, ok: boolean): void;
  setCursor(idx: number): void;
  lookAt(idx: number): void;
  toggleSites(on: boolean): void;
  openMenu(): void;
  openPanel(name: 'settings' | 'stats'): void;
}

export class Hud {
  readonly root: HTMLElement;
  private top: HTMLElement;
  private panel: HTMLElement;
  private toasts: HTMLElement;
  private resEls = new Map<string, HTMLElement>();
  private timeEl: HTMLElement;
  private speedEls: HTMLElement[] = [];
  selected = -1;
  mode: 'select' | 'road' = 'select';
  roadStart = -1;
  private hover = -1;
  private lastPanelKey = '';
  sitesOn = false;
  private session: GameSession;
  private cb: HudCallbacks;

  constructor(parent: HTMLElement, session: GameSession, cb: HudCallbacks) {
    this.session = session;
    this.cb = cb;
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.top = el('div', 'topbar');
    this.root.appendChild(this.top);
    this.panel = el('div', 'panel hidden');
    this.root.appendChild(this.panel);
    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);

    const menuBtn = button('☰', () => cb.openMenu(), 'Menu');
    menuBtn.classList.add('icon-btn');
    this.top.appendChild(menuBtn);
    this.timeEl = el('span', 'time', '0:00');
    this.top.appendChild(this.timeEl);
    const speeds = el('span', 'speeds');
    for (const [label, v] of [['❚❚', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as const) {
      const b = button(label, () => this.setSpeed(v), v === 0 ? 'Pauza' : `Tempo ${label}`);
      b.classList.add('speed');
      this.speedEls.push(b);
      speeds.appendChild(b);
    }
    this.top.appendChild(speeds);
    const res = el('span', 'res');
    const RES_ICON: Record<string, string> = { plank: 'good_9', stone: 'good_11', lumber: 'good_8', food: 'good_5', tools: 'good_18', gold: 'good_16', serfs: 'icon_serf', knights: 'icon_knight' };
    for (const [key, label] of [['plank', 'Deski'], ['stone', 'Kamień'], ['lumber', 'Pnie'], ['food', 'Jedzenie'], ['tools', 'Narzędzia'], ['gold', 'Monety'], ['serfs', 'Osadnicy'], ['knights', 'Rycerze']] as const) {
      const item = el('span', `res-item res-${key}`);
      item.title = label;
      const src = iconUrl(RES_ICON[key]);
      if (src) {
        const img = el('img', 'res-icon');
        img.src = src;
        img.alt = label;
        item.appendChild(img);
      } else item.appendChild(el('span', 'res-label', label));
      const v = el('b', '', '0');
      item.appendChild(v);
      this.resEls.set(key, v);
      res.appendChild(item);
    }
    this.top.appendChild(res);
    const sites = button('Miejsca budowy', () => {
      this.sitesOn = !this.sitesOn;
      sites.classList.toggle('active', this.sitesOn);
      cb.toggleSites(this.sitesOn);
    }, 'Pokaż miejsca pod budowę (B)');
    sites.classList.add('sites-btn');
    this.top.appendChild(sites);
    this.top.appendChild(button('Gospodarka', () => cb.openPanel('settings'), 'Ustawienia gospodarki'));
    this.top.appendChild(button('Statystyki', () => cb.openPanel('stats'), 'Statystyki'));
    this.setSpeed(1);
  }

  get state(): GameState {
    return this.session.state;
  }

  get me(): number {
    return this.session.localPlayer;
  }

  setSpeed(v: number): void {
    if (v === 0) this.session.paused = !this.session.paused;
    else {
      this.session.paused = false;
      this.session.speed = v;
    }
    const cur = this.session.paused ? 0 : this.session.speed;
    [0, 1, 2, 4].forEach((sp, i) => this.speedEls[i].classList.toggle('active', sp === cur));
  }

  /** Czy gra lokalna pozwala zmieniac tempo (w sieci nie). */
  setSpeedEnabled(on: boolean): void {
    for (const b of this.speedEls) b.style.display = on ? '' : 'none';
  }

  toast(text: string, kind = ''): void {
    const t = el('div', `toast ${kind}`, text);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('fade'), 3500);
    setTimeout(() => t.remove(), 4200);
    while (this.toasts.children.length > 5) this.toasts.firstChild!.remove();
  }

  // ---------- Wejscie ----------

  onTap(idx: number, button: number): void {
    if (button === 2) {
      this.cancel();
      return;
    }
    if (this.mode === 'road') {
      this.tryRoad(idx);
      return;
    }
    this.select(idx);
  }

  onHover(idx: number): void {
    this.hover = idx;
    if (this.mode === 'road') this.updateRoadPreview();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    if (e.key === 'b' || e.key === 'B') {
      this.sitesOn = !this.sitesOn;
      this.top.querySelector('.sites-btn')?.classList.toggle('active', this.sitesOn);
      this.cb.toggleSites(this.sitesOn);
      return true;
    }
    if (e.key === ' ') {
      this.setSpeed(0);
      return true;
    }
    return false;
  }

  cancel(): void {
    if (this.mode === 'road') {
      this.mode = 'select';
      this.cb.setPreview(null, false);
      this.lastPanelKey = '';
      this.refreshPanel();
      return;
    }
    this.select(-1);
  }

  select(idx: number): void {
    this.selected = idx;
    this.cb.setCursor(idx);
    this.lastPanelKey = '';
    this.refreshPanel();
  }

  startRoad(flagPos: number): void {
    this.mode = 'road';
    this.roadStart = flagPos;
    this.lastPanelKey = '';
    this.refreshPanel();
    this.updateRoadPreview();
  }

  private updateRoadPreview(): void {
    const s = this.state;
    if (this.hover < 0 || this.roadStart < 0 || s.map.obj[this.roadStart] !== O.FLAG) {
      this.cb.setPreview(null, false);
      return;
    }
    const path = findRoadPath(s, this.me, this.roadStart, this.hover);
    if (!path) {
      this.cb.setPreview([this.roadStart, this.hover], false);
      return;
    }
    const cells = [this.roadStart];
    let c = this.roadStart;
    for (const d of path) {
      c = neighbor(s.map, c, d);
      cells.push(c);
    }
    this.cb.setPreview(cells, true);
  }

  private tryRoad(idx: number): void {
    const s = this.state;
    if (this.roadStart < 0 || s.map.obj[this.roadStart] !== O.FLAG) return;
    if (idx === this.roadStart) {
      this.cancel();
      return;
    }
    const path = findRoadPath(s, this.me, this.roadStart, idx);
    if (!path) {
      this.toast('Tu nie da się poprowadzić drogi', 'warn');
      return;
    }
    this.session.submit({ type: 'road', player: this.me, pos: this.roadStart, dirs: path });
    const endIsFlag = s.map.obj[idx] === O.FLAG;
    if (endIsFlag) {
      this.mode = 'select';
      this.cb.setPreview(null, false);
      this.select(idx);
    } else {
      // Kontynuuj budowe od nowej flagi (pojawi sie po nastepnym ticku).
      this.roadStart = idx;
      this.cb.setPreview(null, false);
    }
  }

  // ---------- Odswiezanie ----------

  update(): void {
    const s = this.state;
    const me = this.me;
    const tot = new Array(GOODS_COUNT).fill(0);
    let serfs = 0;
    let knights = 0;
    for (const b of s.buildings) {
      if (!b || b.owner !== me) continue;
      if (b.inv) {
        for (let g = 0; g < GOODS_COUNT; g++) tot[g] += b.inv.goods[g];
        for (let t = 0; t < b.inv.serfs.length; t++) if (t !== S.DONKEY) serfs += b.inv.serfs[t];
        for (const k of b.inv.knights) knights += k;
      }
      knights += b.knights.length;
    }
    for (const sf of s.serfs) if (sf && sf.owner === me && sf.type !== S.DONKEY) {
      if (sf.type === S.KNIGHT) knights++;
      else serfs++;
    }
    let tools = 0;
    for (let g: number = FIRST_TOOL; g < FIRST_TOOL + TOOLS_COUNT; g++) tools += tot[g];
    this.resEls.get('plank')!.textContent = String(tot[G.PLANK]);
    this.resEls.get('stone')!.textContent = String(tot[G.STONE]);
    this.resEls.get('lumber')!.textContent = String(tot[G.LUMBER]);
    this.resEls.get('food')!.textContent = String(tot[G.FISH] + tot[G.BREAD] + tot[G.MEAT]);
    this.resEls.get('tools')!.textContent = String(tools);
    this.resEls.get('gold')!.textContent = String(tot[G.GOLD]);
    this.resEls.get('serfs')!.textContent = String(serfs);
    this.resEls.get('knights')!.textContent = String(knights);
    const sec = Math.floor(s.tick / 10);
    this.timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    this.refreshPanel();
    if (this.mode === 'road' && s.map.obj[this.roadStart] === O.FLAG) this.updateRoadPreview();
  }

  private refreshPanel(): void {
    const s = this.state;
    const idx = this.selected;
    if (this.mode === 'road') {
      if (this.lastPanelKey === 'road') return;
      this.lastPanelKey = 'road';
      this.show();
      clear(this.panel);
      this.panel.appendChild(el('h3', '', 'Budowa drogi'));
      this.panel.appendChild(el('p', 'hint', 'Kliknij pole docelowe: istniejącą flagę albo wolne miejsce (powstanie nowa flaga). Esc lub prawy przycisk kończy.'));
      this.panel.appendChild(button('Zakończ', () => this.cancel()));
      return;
    }
    if (idx < 0) {
      this.hide();
      this.lastPanelKey = '';
      return;
    }
    const key = this.panelKey(idx);
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    this.show();
    clear(this.panel);
    const close = button('×', () => this.select(-1), 'Zamknij');
    close.classList.add('close');
    this.panel.appendChild(close);
    const map = s.map;
    const o = map.obj[idx];
    if ((o === O.BUILDING || o === O.BUILDING_PART) && map.objId[idx] >= 0) {
      const b = s.buildings[map.objId[idx]];
      if (b) {
        this.buildingPanel(b);
        return;
      }
    }
    if (o === O.FLAG) {
      const f = s.flags[map.objId[idx]]!;
      this.panel.appendChild(el('h3', '', f.owner === this.me ? 'Flaga' : `Flaga (${s.players[f.owner].name})`));
      if (f.owner === this.me) {
        const goods = f.slotGood.filter((g) => g >= 0).map((g) => GOOD_NAMES_PL[g]);
        this.panel.appendChild(el('p', '', goods.length ? `Towary: ${goods.join(', ')}` : 'Brak towarów'));
        this.panel.appendChild(button('Buduj drogę', () => this.startRoad(idx), 'Poprowadź drogę z tej flagi'));
        this.panel.appendChild(button('Wyślij geologa', () => {
          this.session.submit({ type: 'geologist', player: this.me, pos: idx });
          this.toast('Geolog wyrusza');
        }, 'Geolog zbada okoliczne góry'));
        const bld = f.building >= 0 ? s.buildings[f.building] : null;
        if (!(bld && bld.kind === B.CASTLE)) {
          this.panel.appendChild(button('Usuń flagę', () => {
            this.session.submit({ type: 'demolish', player: this.me, pos: idx });
            this.select(-1);
          }, 'Usuwa flagę, jej drogi i budynek', 'danger'));
        }
        this.buildButtons(idx);
      }
      return;
    }
    const rid = roadAt(s, idx);
    if (rid >= 0) {
      const r = s.roads[rid]!;
      this.panel.appendChild(el('h3', '', r.water ? 'Droga wodna' : 'Droga'));
      if (r.owner === this.me) {
        const carrier = r.carrier >= 0 ? s.serfs[r.carrier] : null;
        this.panel.appendChild(el('p', '', carrier && carrier.state === 10 ? 'Tragarz pracuje' : 'Czeka na tragarza'));
        if (canPlaceFlag(s, this.me, idx)) {
          this.panel.appendChild(button('Postaw flagę', () => {
            this.session.submit({ type: 'flag', player: this.me, pos: idx });
          }, 'Dzieli drogę - drugi tragarz przyspiesza transport'));
        }
        this.panel.appendChild(button('Usuń drogę', () => {
          this.session.submit({ type: 'demolish', player: this.me, pos: idx });
          this.select(-1);
        }, '', 'danger'));
      }
      return;
    }
    const owner = map.owner[idx];
    this.panel.appendChild(el('h3', '', TERRAIN_PL[map.terrain[idx]]));
    this.panel.appendChild(el('p', 'sub', owner === 0 ? 'Ziemia niczyja' : owner - 1 === this.me ? 'Twoje terytorium' : `Terytorium: ${s.players[owner - 1].name}`));
    if (owner - 1 === this.me) {
      if (canPlaceFlag(s, this.me, idx)) {
        this.panel.appendChild(button('Postaw flagę', () => {
          this.session.submit({ type: 'flag', player: this.me, pos: idx });
        }));
      }
      this.buildButtons(idx);
    }
  }

  /** Klucz stanu panelu - przebudowujemy DOM tylko przy zmianie. */
  private panelKey(idx: number): string {
    const s = this.state;
    const m = s.map;
    const o = m.obj[idx];
    let k = `${idx}:${o}:${m.objId[idx]}:${m.roads[idx]}:${m.owner[idx]}`;
    if ((o === O.BUILDING || o === O.BUILDING_PART) && m.objId[idx] >= 0) {
      const b = s.buildings[m.objId[idx]];
      if (b) k += `:${b.paused}:${b.stage}:${b.planks}:${b.stones}:${b.planksUsed}:${b.stonesUsed}:${b.stock.join(',')}:${b.worker}:${b.workerInside}:${b.knights.length}:${b.gold}:${b.out.length}:${b.inv ? b.inv.goods.join(',') + b.inv.serfs.join(',') + b.inv.knights.join(',') : ''}`;
    }
    if (o === O.FLAG) {
      const f = s.flags[m.objId[idx]];
      if (f) k += ':' + f.slotGood.join(',');
    }
    // Mozliwosci budowy zaleza od sasiadow.
    if (o === O.NONE || o === O.FLAG) {
      for (let d = 0; d < 6; d++) {
        const j = neighbor(m, idx, d);
        if (j >= 0) k += `|${m.obj[j]}`;
      }
    }
    return k;
  }

  private buildButtons(idx: number): void {
    const s = this.state;
    // Pole flagi -> budynek stoi na NW od niej. Pole puste -> budynek na tym polu.
    let pos = idx;
    if (s.map.obj[idx] === O.FLAG) {
      pos = neighbor(s.map, idx, 4);
      if (pos < 0 || neighbor(s.map, pos, DIR_SE) !== idx) return;
    }
    const groups: [string, number[]][] = [['Chaty', []], ['Domy', []], ['Duże budynki', []], ['Kopalnie', []]];
    for (let k = 1; k < BUILDINGS.length; k++) {
      if (!canBuild(s, this.me, pos, k)) continue;
      const size = BUILDINGS[k].size;
      groups[size === SIZE.SMALL ? 0 : size === SIZE.MEDIUM ? 1 : size === SIZE.LARGE ? 2 : 3][1].push(k);
    }
    for (const [title, kinds] of groups) {
      if (!kinds.length) continue;
      this.panel.appendChild(el('h4', '', title));
      const grid = el('div', 'build-grid');
      for (const k of kinds) {
        const d = BUILDINGS[k];
        const cost = `${d.planks}D${d.stones ? ` ${d.stones}K` : ''}`;
        const b = button('', () => {
          this.session.submit({ type: 'build', player: this.me, pos, kind: k });
          this.select(-1);
        }, `${d.name} — koszt: ${d.planks} desek, ${d.stones} kamieni`);
        b.classList.add('build-btn');
        b.dataset.kind = String(k);
        const src = iconUrl(`building_${k}`);
        if (src) {
          const img = el('img', 'bicon');
          img.src = src;
          img.alt = '';
          b.appendChild(img);
        }
        b.appendChild(el('span', 'bname', d.name));
        b.appendChild(el('span', 'bcost', cost));
        grid.appendChild(b);
      }
      this.panel.appendChild(grid);
    }
  }

  private buildingPanel(b: Building): void {
    const s = this.state;
    const def = BUILDINGS[b.kind];
    const mine = b.owner === this.me;
    this.panel.appendChild(el('h3', '', mine ? def.name : `${def.name} (${s.players[b.owner].name})`));
    this.panel.appendChild(el('p', 'sub', STAGE_PL[b.stage]));
    if (!mine) {
      if (isMilitary(b.kind) || b.kind === B.CASTLE) this.attackUi(b);
      return;
    }
    if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
      this.panel.appendChild(el('p', '', `Deski: ${b.planksUsed + b.planks}/${def.planks}, kamień: ${b.stonesUsed + b.stones}/${def.stones}`));
      this.panel.appendChild(el('p', 'sub', b.builder >= 0 ? 'Budowniczy w drodze lub przy pracy' : 'Czeka na budowniczego'));
    } else if (b.stage === STAGE.DONE) {
      if (b.inv) {
        const inv = b.inv;
        const list = el('div', 'inv-list');
        for (let g = 0; g < GOODS_COUNT; g++) if (inv.goods[g] > 0) list.appendChild(goodChip(g, inv.goods[g]));
        this.panel.appendChild(el('h4', '', 'Towary'));
        this.panel.appendChild(list);
        const sl = el('div', 'inv-list');
        for (let t = 0; t < inv.serfs.length; t++) if (inv.serfs[t] > 0) sl.appendChild(el('span', 'inv-item', `${SERF_NAMES_PL[t]}: ${inv.serfs[t]}`));
        const kn = inv.knights.map((n, l) => (n ? `P${l}: ${n}` : '')).filter(Boolean).join(', ');
        if (kn) sl.appendChild(el('span', 'inv-item', `Rycerze ${kn}`));
        this.panel.appendChild(el('h4', '', 'Osadnicy'));
        this.panel.appendChild(sl);
      } else if (isMilitary(b.kind)) {
        const lv = b.knights.map((id) => s.serfs[id]?.level ?? 0);
        this.panel.appendChild(el('p', '', `Rycerze: ${b.knights.length}/${def.knights}${lv.length ? ` (poziomy ${lv.join(', ')})` : ''}`));
        this.panel.appendChild(el('p', '', `Złoto: ${b.gold}/${def.gold}`));
      } else {
        this.panel.appendChild(el('p', '', b.workerInside ? `Pracownik: ${SERF_NAMES_PL[def.worker]}` : `Czeka na: ${SERF_NAMES_PL[def.worker]}`));
        const inputs = b.kind >= B.COALMINE && b.kind <= B.STONEMINE ? ['Jedzenie'] : def.inputs.map((g) => GOOD_NAMES_PL[g]);
        if (inputs.length) this.panel.appendChild(el('p', '', inputs.map((n, i) => `${n}: ${b.stock[i]}`).join(', ')));
        this.panel.appendChild(el('p', 'sub', `Wyprodukowano: ${b.produced}${b.paused ? ' — produkcja wstrzymana' : ''}`));
        this.panel.appendChild(button(b.paused ? 'Wznów produkcję' : 'Wstrzymaj produkcję', () => {
          this.session.submit({ type: 'pause', player: this.me, pos: b.pos, on: !b.paused });
        }, 'Wstrzymany budynek nie pracuje i nie zamawia surowców'));
      }
    }
    if (b.kind !== B.CASTLE && b.stage !== STAGE.BURN) {
      this.panel.appendChild(button('Zburz', () => {
        this.session.submit({ type: 'demolish', player: this.me, pos: b.pos });
        this.select(-1);
      }, 'Budynek spłonie, materiały przepadną', 'danger'));
    }
  }

  /** Panel ataku na wrogi budynek wojskowy lub zamek. */
  private attackUi(b: Building): void {
    const s = this.state;
    if (b.stage !== STAGE.DONE) return;
    const def = BUILDINGS[b.kind];
    if (b.inv) {
      const kn = b.inv.knights.reduce((a, c) => a + c, 0);
      this.panel.appendChild(el('p', '', `Obrońców w zamku: ${kn}`));
    } else {
      this.panel.appendChild(el('p', '', `Rycerze: ${b.knights.length}/${def.knights}`));
    }
    const avail = attackersAvailable(s, this.me, b);
    if (avail <= 0) {
      this.panel.appendChild(el('p', 'sub', 'Brak rycerzy w zasięgu ataku (budynki wojskowe w promieniu 14, każdy zostawia jednego).'));
      return;
    }
    const row = el('label', 'slider-row');
    row.appendChild(el('span', 'slider-label', 'Liczba rycerzy'));
    const input = el('input');
    input.type = 'range';
    input.min = '1';
    input.max = String(avail);
    input.value = String(avail);
    const val = el('span', 'slider-val', input.value);
    input.addEventListener('input', () => { val.textContent = input.value; });
    row.appendChild(input);
    row.appendChild(val);
    this.panel.appendChild(row);
    this.panel.appendChild(button('Atakuj', () => {
      this.session.submit({ type: 'attack', player: this.me, pos: b.pos, count: Number(input.value) });
      this.toast(`Wysłano ${input.value} rycerzy do ataku`);
      this.select(-1);
    }, 'Rycerze pójdą pod flagę budynku i stoczą pojedynki', 'danger'));
  }

  /** Komunikaty o zdarzeniach gry. */
  onEvents(events: GameEvent[]): void {
    const s = this.state;
    const me = this.me;
    for (const e of events) {
      const name = BUILDINGS[e.a ?? 0]?.name ?? '';
      switch (e.type) {
        case 'attack':
          if (e.player === me) this.toast('Wróg atakuje twój budynek!', 'bad');
          break;
        case 'captured':
          if (e.player === me) this.toast('Zdobyliśmy wrogi budynek!');
          else if (e.a === me) this.toast('Wróg przejął nasz budynek!', 'bad');
          break;
        case 'castleLost':
          if (e.player === me) this.toast('Nasz zamek upadł!', 'bad');
          else if (e.a === me) this.toast(`Zamek gracza ${s.players[e.player].name} zdobyty!`);
          break;
        case 'eliminated':
          this.toast(e.player === me ? 'Przegrana - twoja osada upadła.' : `${s.players[e.player].name} odpada z gry.`, e.player === me ? 'bad' : '');
          break;
        case 'built':
          if (e.player === me && e.a !== undefined && e.a !== B.CASTLE) this.toast(`Gotowe: ${name}`);
          break;
        case 'exhausted':
          if (e.player === me) this.toast(`${name}: złoże wyczerpane`, 'warn');
          break;
        case 'found':
          if (e.player === me) this.toast(`Geolog znalazł: ${RES_PL[e.a ?? 0]}`);
          break;
        case 'burned':
          if (e.player === me) this.toast(`Spłonął budynek: ${name}`, 'bad');
          break;
      }
    }
  }

  private show(): void {
    this.panel.classList.remove('hidden');
  }

  private hide(): void {
    this.panel.classList.add('hidden');
  }
}

