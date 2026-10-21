import type { Vec2 } from '../core/math';
import type { GradeStatus } from '../roads/RoadRules';

const meterFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export interface TerrainInfo {
  meters: number;
  /** Geländeneigung als Anteil (0.12 = 12 %). */
  grade: number;
  zone: string;
  /** Steigung der Straße unter dem Cursor (Betrag), falls vorhanden. */
  roadGrade?: number;
  roadStatus?: GradeStatus;
}

export interface BuildInfo {
  /** Vorzeichenbehaftete Steigung in Ziehrichtung. */
  grade: number;
  status: GradeStatus;
  message?: string;
}

/** Formatiert eine Steigung, z. B. "↗ 12 %" bzw. "↘ 4 %". */
export function formatGrade(grade: number): string {
  const arrow = Math.abs(grade) < 0.005 ? '→' : grade > 0 ? '↗' : '↘';
  return `${arrow} ${percentFormat.format(Math.abs(grade) * 100)} %`;
}

/** Schwebende Info-Box neben dem Cursor (Höhe ü. NN, Neigung, Straßensteigung, Bau-Feedback). */
export class Tooltip {
  private readonly el: HTMLDivElement;
  private lastHtml = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    parent.appendChild(this.el);
  }

  showTerrain(screen: Vec2, info: TerrainInfo): void {
    let html =
      `<div class="tt-height">${meterFormat.format(info.meters)} m ü. NN</div>` +
      `<div class="tt-meta"><span>${info.zone}</span><span>Gelände ${percentFormat.format(info.grade * 100)} %</span></div>`;
    if (info.roadGrade !== undefined && info.roadStatus) {
      html +=
        `<div class="tt-road"><span class="tt-dot ${info.roadStatus}"></span>` +
        `Straße · Steigung ${percentFormat.format(info.roadGrade * 100)} %</div>`;
    }
    this.render(screen, html, '');
  }

  showBuild(screen: Vec2, info: BuildInfo): void {
    let html = `<div class="tt-grade ${info.status}">Steigung ${formatGrade(info.grade)}</div>`;
    if (info.message) html += `<div class="tt-warning">${info.message}</div>`;
    this.render(screen, html, info.status === 'blocked' ? 'alert' : '');
  }

  /** Allgemeine Info (Bus, Markt, Garage): Titel mit Farbmarke + Zeilen. */
  showInfo(screen: Vec2, title: string, color: string, lines: string[]): void {
    const html =
      `<div class="tt-title"><span class="tt-swatch" style="background:${color}"></span>${title}</div>` +
      lines.map((l) => `<div class="tt-meta"><span>${l}</span></div>`).join('');
    this.render(screen, html, '');
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  private render(screen: Vec2, html: string, variant: string): void {
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
    this.el.classList.toggle('alert', variant === 'alert');
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
}
