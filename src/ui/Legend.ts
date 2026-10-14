import { ELEVATION_MAX_M, ELEVATION_MIN_M } from '../config';
import { smoothColor } from '../render/palette';

/** Höhenlegende (unten links): Farbverlauf von Zona Sur bis El Alto. */
export function createLegend(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'legend';

  const stops: string[] = [];
  for (let m = ELEVATION_MIN_M; m <= ELEVATION_MAX_M; m += 50) {
    const pct = ((m - ELEVATION_MIN_M) / (ELEVATION_MAX_M - ELEVATION_MIN_M)) * 100;
    stops.push(`${smoothColor(m)} ${pct.toFixed(1)}%`);
  }

  el.innerHTML = `
    <div class="legend-title">Höhe ü. NN</div>
    <div class="legend-bar" style="background: linear-gradient(to right, ${stops.join(', ')})"></div>
    <div class="legend-scale">
      <span>3.200 m</span><span>3.640 m</span><span>4.150 m</span>
    </div>
    <div class="legend-places">
      <span>Zona Sur</span><span>Centro</span><span>El Alto</span>
    </div>`;
  parent.appendChild(el);
}
