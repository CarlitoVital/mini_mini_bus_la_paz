import type { Vec2 } from '../core/math';

const meterFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export interface TerrainInfo {
  meters: number;
  /** Geländeneigung als Anteil (0.12 = 12 %). */
  grade: number;
  zone: string;
}

/** Schwebende Info-Box neben dem Cursor (Höhe ü. NN, Neigung, Stadtteil). */
export class Tooltip {
  private readonly el: HTMLDivElement;
  private lastHtml = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    parent.appendChild(this.el);
  }

  show(screen: Vec2, info: TerrainInfo): void {
    const html =
      `<div class="tt-height">${meterFormat.format(info.meters)} m ü. NN</div>` +
      `<div class="tt-meta"><span>${info.zone}</span><span>Neigung ${percentFormat.format(info.grade * 100)} %</span></div>`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
    // Rechts unten vom Cursor, am Fensterrand umklappen.
    const pad = 16;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = screen.x + pad;
    let y = screen.y + pad;
    if (x + w > window.innerWidth - 8) x = screen.x - pad - w;
    if (y + h > window.innerHeight - 8) y = screen.y - pad - h;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.classList.add('visible');
  }

  hide(): void {
    this.el.classList.remove('visible');
  }
}
