/** Auswahl-Karte im Wochen-Dialog. */
export interface ChoiceCard {
  icon: string;
  title: string;
  text: string;
  onPick: () => void;
}

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/**
 * Zentrierter Dialog über dem Spielfeld (Intro, Wochenbelohnung, Game Over).
 * Inhalte werden aus Textbausteinen des Spiels zusammengesetzt (kein Nutzer-HTML).
 */
export class Modal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.card = document.createElement('div');
    this.card.className = 'modal';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.backdrop.appendChild(this.card);
    parent.appendChild(this.backdrop);
  }

  get isOpen(): boolean {
    return this.backdrop.classList.contains('visible');
  }

  show(opts: { kicker?: string; title: string; body?: string; choices?: ChoiceCard[]; buttons?: ModalButton[]; tone?: 'alert' }): void {
    const { card } = this;
    card.className = `modal ${opts.tone ?? ''}`;
    card.innerHTML = '';
    if (opts.kicker) card.appendChild(el('div', 'modal-kicker', opts.kicker));
    card.appendChild(el('h2', 'modal-title', opts.title));
    if (opts.body) {
      const body = el('div', 'modal-body', '');
      body.innerHTML = opts.body;
      card.appendChild(body);
    }
    if (opts.choices?.length) {
      const row = el('div', 'modal-choices', '');
      opts.choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'choice';
        b.innerHTML = `<span class="choice-icon">${c.icon}</span><span class="choice-title"></span><span class="choice-text"></span><kbd class="choice-key">${i + 1}</kbd>`;
        b.querySelector('.choice-title')!.textContent = c.title;
        b.querySelector('.choice-text')!.textContent = c.text;
        b.addEventListener('click', () => this.close(c.onPick));
        row.appendChild(b);
      });
      card.appendChild(row);
    }
    if (opts.buttons?.length) {
      const row = el('div', 'modal-buttons', '');
      for (const btn of opts.buttons) {
        const b = document.createElement('button');
        b.className = btn.primary ? 'btn primary' : 'btn';
        b.textContent = btn.label;
        b.addEventListener('click', () => this.close(btn.onClick));
        row.appendChild(b);
      }
      card.appendChild(row);
    }

    // Tastatur: 1/2 für Auswahlkarten, Enter für den primären Button
    this.detachKeys();
    this.keyHandler = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (opts.choices && idx >= 0 && idx < opts.choices.length) {
        e.preventDefault();
        this.close(opts.choices[idx].onPick);
      } else if (e.key === 'Enter') {
        const primary = opts.buttons?.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          this.close(primary.onClick);
        }
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.backdrop.classList.add('visible');
    (card.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  close(then?: () => void): void {
    this.detachKeys();
    this.backdrop.classList.remove('visible');
    then?.();
  }

  private detachKeys(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, true);
    this.keyHandler = null;
  }
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}
