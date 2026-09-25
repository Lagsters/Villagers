/** Okno modalne z tytulem, zakladkami i zamykaniem (Esc / x / klik w tlo). */
import { button, clear, el } from './dom.ts';

export class Modal {
  readonly back: HTMLElement;
  readonly body: HTMLElement;
  private tabsEl: HTMLElement;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, title: string, wide = false) {
    this.back = el('div', 'modal-back');
    const win = el('div', wide ? 'modal wide' : 'modal');
    const head = el('div', 'modal-head');
    head.appendChild(el('h2', '', title));
    const x = button('×', () => this.close(), 'Zamknij');
    x.classList.add('close');
    head.appendChild(x);
    win.appendChild(head);
    this.tabsEl = el('div', 'tabs');
    win.appendChild(this.tabsEl);
    this.body = el('div', 'modal-body');
    win.appendChild(this.body);
    this.back.appendChild(win);
    this.back.addEventListener('pointerdown', (e) => {
      if (e.target === this.back) this.close();
    });
    parent.appendChild(this.back);
  }

  /** Zakladki: kazda ma funkcje rysujaca tresc. */
  tabs(list: [string, (body: HTMLElement) => void][], initial = 0): void {
    clear(this.tabsEl);
    const btns: HTMLButtonElement[] = [];
    const show = (i: number) => {
      btns.forEach((b, k) => b.classList.toggle('active', k === i));
      clear(this.body);
      list[i][1](this.body);
    };
    list.forEach(([name], i) => {
      const b = button(name, () => show(i));
      btns.push(b);
      this.tabsEl.appendChild(b);
    });
    show(initial);
  }

  close(): void {
    this.back.remove();
    this.onClose?.();
  }
}
