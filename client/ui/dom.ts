/** Male pomocniki DOM. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, onClick: () => void, title = '', cls = ''): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function clear(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}
