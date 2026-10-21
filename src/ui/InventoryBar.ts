import type { Inventory, ItemKind, JunctionUpgrade } from '../game/Inventory';

const ICONS: Record<ItemKind, string> = {
  tiles: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" class="i-fill"/><path d="M12 6v3M12 11v2M12 15v3" class="i-line"/></svg>`,
  viaduct: `<svg viewBox="0 0 24 24"><path d="M2 8h20" class="i-thick"/><path d="M5 9v9M12 9v9M19 9v9" class="i-line-dark"/><path d="M5 18c0-4 7-4 7 0M12 18c0-4 7-4 7 0" class="i-line-dark"/></svg>`,
  roundabout: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" class="i-ring"/><circle cx="12" cy="12" r="2.6" class="i-green"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" class="i-thick-thin"/></svg>`,
  light: `<svg viewBox="0 0 24 24"><rect x="7.5" y="2" width="9" height="20" rx="3" class="i-box"/><circle cx="12" cy="7" r="2.2" class="i-red"/><circle cx="12" cy="12" r="2.2" class="i-amber"/><circle cx="12" cy="17" r="2.2" class="i-green"/></svg>`,
};

const LABELS: Record<ItemKind, string> = {
  tiles: 'Straßenteile',
  viaduct: 'Viadukte – automatisch beim geraden Ziehen über steile Stellen',
  roundabout: 'Kreisverkehr – auf eine Kreuzung setzen (Klick, dann Kreuzung wählen)',
  light: 'Ampel – auf eine Kreuzung setzen (Klick, dann Kreuzung wählen)',
};

/**
 * Inventar unten mittig (Mini-Motorways-Stil): verfügbare Straßenteile und Spezialelemente.
 * Kreisverkehr/Ampel sind anklickbar und starten den Platzierungsmodus.
 */
export class InventoryBar {
  private readonly el: HTMLDivElement;
  private readonly items = new Map<ItemKind, { root: HTMLButtonElement; count: HTMLSpanElement; last: number }>();
  selected: JunctionUpgrade | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onSelect: (kind: JunctionUpgrade | null) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'inventory';
    for (const kind of ['tiles', 'viaduct', 'roundabout', 'light'] as ItemKind[]) {
      const root = document.createElement('button');
      root.className = `inv-item inv-${kind}`;
      root.title = LABELS[kind];
      root.innerHTML = `${ICONS[kind]}<span class="inv-count">0</span>`;
      const selectable = kind === 'roundabout' || kind === 'light';
      if (selectable) root.addEventListener('click', () => this.select(this.selected === kind ? null : kind));
      else root.tabIndex = -1;
      this.el.appendChild(root);
      this.items.set(kind, { root, count: root.querySelector('.inv-count')!, last: -1 });
    }
    parent.appendChild(this.el);
  }

  select(kind: JunctionUpgrade | null): void {
    this.selected = kind;
    for (const [k, item] of this.items) item.root.classList.toggle('selected', k === kind);
    this.onSelect(kind);
  }

  update(inv: Inventory): void {
    for (const [kind, item] of this.items) {
      const n = inv.available(kind);
      if (n === item.last) continue;
      item.count.textContent = String(n);
      item.root.classList.toggle('empty', n <= 0);
      if (item.last >= 0) this.retrigger(item.root, n > item.last ? 'gain' : 'spend');
      item.last = n;
    }
    if (this.selected && inv.available(this.selected) <= 0) this.select(null);
  }

  /** Kurzes Schütteln, z. B. wenn keine Straßenteile mehr da sind. */
  flash(kind: ItemKind): void {
    const item = this.items.get(kind);
    if (item) this.retrigger(item.root, 'shake');
  }

  private retrigger(el: HTMLElement, cls: string): void {
    el.classList.remove('gain', 'spend', 'shake');
    void el.offsetWidth;
    el.classList.add(cls);
  }
}
