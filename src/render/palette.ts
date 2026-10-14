import { CONTOUR_INTERVAL_M } from '../config';

type RGB = [number, number, number];

/**
 * Hypsometrische Farbskala im zurückhaltenden Mini-Motorways-Stil:
 * Zona Sur grünlich, Centro sandfarben, Laderas in Adobe-/Ziegeltönen,
 * Altiplano (El Alto) kühl und blass.
 */
const HYPSO_STOPS: { m: number; c: RGB }[] = [
  { m: 3200, c: [200, 221, 186] },
  { m: 3400, c: [222, 229, 191] },
  { m: 3600, c: [238, 231, 200] },
  { m: 3780, c: [241, 219, 192] },
  { m: 3950, c: [233, 205, 190] },
  { m: 4060, c: [222, 214, 214] },
  { m: 4150, c: [214, 216, 226] },
];

function interpolate(m: number): RGB {
  if (m <= HYPSO_STOPS[0].m) return HYPSO_STOPS[0].c;
  for (let i = 1; i < HYPSO_STOPS.length; i++) {
    const a = HYPSO_STOPS[i - 1];
    const b = HYPSO_STOPS[i];
    if (m <= b.m) {
      const t = (m - a.m) / (b.m - a.m);
      return [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t];
    }
  }
  return HYPSO_STOPS[HYPSO_STOPS.length - 1].c;
}

/** Flache (gestufte) Bandfarbe für eine Höhe – jede Höhenstufe hat genau eine Farbe. */
export function bandColor(meters: number): RGB {
  const band = Math.floor(meters / CONTOUR_INTERVAL_M);
  const mid = (band + 0.5) * CONTOUR_INTERVAL_M;
  // Leichter Wechsel der Helligkeit zwischen benachbarten Bändern verstärkt die Stufung.
  const lift = band % 2 === 0 ? 0 : 4;
  const [r, g, b] = interpolate(mid);
  return [r + lift, g + lift, b + lift];
}

/** Stetige Farbe (für die Legende). */
export function smoothColor(meters: number): string {
  const [r, g, b] = interpolate(meters);
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

export const COLORS = {
  background: '#e9e4d8',
  contour: 'rgba(120, 96, 72, 0.22)',
  contourIndex: 'rgba(110, 82, 60, 0.42)',
  contourLabel: 'rgba(100, 74, 54, 0.75)',
  river: '#8fb8d6',
  riverBank: 'rgba(143, 184, 214, 0.35)',
  grid: 'rgba(90, 70, 50, 0.07)',
  hoverCell: 'rgba(60, 50, 40, 0.55)',
  mapEdge: 'rgba(80, 60, 40, 0.25)',
} as const;
