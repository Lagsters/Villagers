/**
 * Samouczek w formie podpowiedzi: kolejne zadania z automatycznym przejsciem po wykonaniu.
 * Stan "ukonczony/pominiety" pamietany w localStorage.
 */
import { B, isMilitary } from '../../sim/defs.ts';
import { STAGE, type GameState } from '../../sim/types.ts';
import { button, el } from './dom.ts';

const KEY = 'osadnicy.tutorial';

interface Step {
  text: string;
  done: (s: GameState, me: number, t: number) => boolean;
}

function has(s: GameState, me: number, kinds: number[], connected = false): boolean {
  return s.buildings.some((b) => {
    if (!b || b.owner !== me || !kinds.includes(b.kind)) return false;
    if (!connected) return true;
    const f = s.flags[b.flag];
    return !!f && f.roads.some((r) => r >= 0);
  });
}

const STEPS: Step[] = [
  { text: 'Witaj w dolinie! To twój zamek. Kliknij wolne pole na trawie niedaleko niego i wybierz „Drwal” z listy chat.', done: (s, me) => has(s, me, [B.WOODCUTTER]) },
  { text: 'Każdy budynek potrzebuje drogi. Kliknij flagę przed budynkiem, wybierz „Buduj drogę” i kliknij flagę zamku.', done: (s, me) => has(s, me, [B.WOODCUTTER], true) },
  { text: 'Tragarz już idzie na drogę. Teraz postaw „Tartak” (wśród domów) i też połącz go drogą - z pni zrobi deski.', done: (s, me) => has(s, me, [B.SAWMILL], true) },
  { text: 'Leśnik sadzi nowe drzewa, a Kamieniarz obok skał wydobywa kamień. Postaw oba.', done: (s, me) => has(s, me, [B.FORESTER]) && has(s, me, [B.STONECUTTER]) },
  { text: 'Przycisk „Miejsca budowy” (klawisz B) pokazuje, co się gdzie zmieści: zielone - chata lub dom, niebieskie - duży budynek, brązowe - kopalnia, żółte - flaga.', done: (_s, _me, t) => t > 600 },
  { text: 'Granice poszerzasz budynkami wojskowymi. Postaw „Barak” przy granicy - gdy wejdzie rycerz, terytorium urośnie.', done: (s, me) => s.buildings.some((b) => !!b && b.owner === me && isMilitary(b.kind) && b.stage === STAGE.DONE && b.knights.length > 0) },
  { text: 'Kopalnie potrzebują jedzenia: Rybak, Myśliwy albo Farma + Młyn + Piekarnia + Studnia. Zadbaj o jedzenie.', done: (s, me) => has(s, me, [B.FISHER, B.HUNTER, B.BAKERY]) },
  { text: 'Rycerz powstaje z miecza, tarczy i piwa: kopalnie węgla i żelaza, Huta żelaza, Zbrojownia, a Browar (zboże + woda) robi piwo.', done: (s, me) => has(s, me, [B.WEAPONSMITH]) },
  { text: 'Wrogi budynek wojskowy w zasięgu możesz zaatakować: kliknij go i wybierz liczbę rycerzy. Zdobądź zamki przeciwników, aby wygrać!', done: (_s, _me, t) => t > 900 },
];

export class Tutorial {
  private box: HTMLElement;
  private textEl: HTMLElement;
  private idx = 0;
  private stepStart = -1;
  private active: boolean;

  constructor(parent: HTMLElement) {
    let saved: number;
    try {
      saved = Number(localStorage.getItem(KEY) ?? 0);
    } catch {
      saved = 0;
    }
    this.active = saved >= 0 && saved < STEPS.length;
    this.idx = Math.max(0, saved);
    this.box = el('div', 'tutorial');
    this.box.appendChild(el('div', 'tut-title', 'Podpowiedź'));
    this.textEl = el('p', 'tut-text');
    this.box.appendChild(this.textEl);
    const row = el('div', 'tut-row');
    row.appendChild(button('Dalej', () => this.next()));
    row.appendChild(button('Wyłącz podpowiedzi', () => this.finish(), 'Samouczek nie pokaże się ponownie'));
    this.box.appendChild(row);
    parent.appendChild(this.box);
    this.render();
  }

  private save(v: number): void {
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // brak localStorage (tryb prywatny)
    }
  }

  private render(): void {
    this.box.style.display = this.active ? '' : 'none';
    if (this.active) this.textEl.textContent = `${this.idx + 1}/${STEPS.length}. ${STEPS[this.idx].text}`;
  }

  private next(): void {
    this.idx++;
    if (this.idx >= STEPS.length) {
      this.finish();
      return;
    }
    this.save(this.idx);
    this.stepStart = -1;
    this.render();
  }

  private finish(): void {
    this.active = false;
    this.save(-1);
    this.render();
  }

  /** Sprawdzenie zadania (wywolywane kilka razy na sekunde). */
  update(s: GameState, me: number): void {
    if (!this.active) return;
    if (this.stepStart < 0) this.stepStart = s.tick;
    if (STEPS[this.idx].done(s, me, s.tick - this.stepStart)) this.next();
  }
}
