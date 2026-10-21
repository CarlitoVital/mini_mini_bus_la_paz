import { ELEVATION_MAX_M, ELEVATION_MIN_M, GRID_COLS, METERS_PER_CELL } from '../config';
import { SimplexNoise2D } from '../core/noise';
import { mulberry32 } from '../core/random';
import { clamp, lerp, smoothstep } from '../core/math';

/** Höhenspanne der Karte in Metern (normierte Höhe 1.0). */
const SPAN_M = ELEVATION_MAX_M - ELEVATION_MIN_M;
/** Kartenbreite in Metern (normiertes u = 1.0). */
const MAP_WIDTH_M = GRID_COLS * METERS_PER_CELL;

/** Durchschnittliches Gefälle der Laderas (Westhang unterhalb der Ceja). */
const LADERA_GRADE = 0.105;
/** Anteil des Höhenunterschieds Tal → Plateau, den die Ceja-Steilwand ausmacht. */
const CEJA_FRACTION = 0.32;
/** Gefälle der Ceja als Steilwand bzw. in einer Rampa (Pass). */
const CEJA_CLIFF_GRADE = 0.6;
const CEJA_RAMP_GRADE = 0.185;
/** Durchschnittliches Gefälle der Osthänge. */
const EAST_GRADE = 0.085;

/** Horizontale Breite (in u) für einen Höhenunterschied Δe bei gegebenem Gefälle. */
const widthFor = (deltaE: number, grade: number): number => (deltaE * SPAN_M) / (grade * MAP_WIDTH_M);

/**
 * Prozeduraler Höhengenerator, der die Topografie von La Paz / El Alto nachbildet.
 *
 * Koordinaten sind normiert: u ∈ [0,1] (West → Ost), v ∈ [0,1] (Nord → Süd).
 * Die Karte ist zentriert auf das Stadtzentrum (Plaza Murillo, -16.52448 / -68.12382).
 *
 * Aufbau (grob von West nach Ost):
 *   1. El Alto  – flaches Altiplano-Plateau im Westen (≈ 4.050–4.150 m)
 *   2. La Ceja  – Abbruchkante des Plateaus: eine unbebaubare Steilwand, die nur an
 *                 wenigen Rampas (Pässen) auf ein per Serpentine bezwingbares Gefälle abflacht
 *   3. Laderas  – lange, von Quebradas (Erosionsrinnen) zerfurchte Hänge
 *   4. Talboden – Tal des Río Choqueyapu, das von Norden (≈ 3.800 m) über das Centro
 *                 (≈ 3.600 m) nach Südosten (Zona Sur, ≈ 3.200 m) abfällt
 *   5. Osthänge – die Hügel von Miraflores / Villa Fátima
 *
 * Die Hangprofile sind in realen Gefällen parametrisiert, damit das Steigungslimit
 * für Straßen (MAX_ALLOWED_SLOPE) planbar greift.
 */
export class LaPazGenerator {
  private readonly n: SimplexNoise2D;
  private readonly aspect: number;
  /** v-Positionen der Rampas, an denen die Ceja befahrbar abflacht. */
  readonly passes: number[];

  constructor(seed: number, aspect: number) {
    this.n = new SimplexNoise2D(seed);
    this.aspect = aspect; // Breite / Höhe – für isotrope Noise-Frequenzen
    const rand = mulberry32(seed ^ 0x5eed);
    this.passes = [0.14, 0.48, 0.8].map((v) => v + (rand() - 0.5) * 0.12);
  }

  /** x-Position des Río Choqueyapu (Talachse) in Abhängigkeit von v. */
  riverX(v: number): number {
    return 0.5 + 0.28 * Math.pow(v, 1.5) + 0.03 * Math.sin(v * 7.5 + 0.6) + 0.02 * this.n.fbm(v * 2.2, 17.3, 3);
  }

  /** Höhe des Talbodens entlang der Talachse (Nord hoch, Südost tief). */
  private floorHeight(v: number): number {
    return 0.62 - 0.6 * Math.pow(v, 1.6);
  }

  /** Grundhöhe des Plateaus El Alto – nach Süden (Richtung Achocalla) niedriger. */
  private plateauBase(v: number): number {
    return 0.95 - 0.15 * smoothstep(0.6, 1.05, v) + 0.015 * this.n.fbm(v * 3, 40, 2);
  }

  /** Feines Relief auf dem Plateau. */
  private plateauRelief(u: number, v: number): number {
    return 0.02 * this.n.fbm(u * 3 * this.aspect, v * 3, 3) + 0.03 * (0.15 - u);
  }

  /** 0..1 – wie stark die Ceja an dieser Stelle zur Rampa abgeflacht ist. */
  passFactor(v: number): number {
    let p = 0;
    for (const pv of this.passes) {
      const d = (v - pv) / 0.045;
      p = Math.max(p, Math.exp(-d * d));
    }
    return smoothstep(0.15, 0.85, p);
  }

  /** Normierte Höhe an (u, v) in ca. [0, 1]. */
  sample(u: number, v: number): number {
    const n = this.n;
    const nu = u * this.aspect;

    const rx = this.riverX(v);
    const floor = this.floorHeight(v);
    const floorHalfWidth = 0.01 + 0.012 * v; // Zona Sur hat breiteren Talboden

    let e: number;
    /** 0 auf Plateau/Talboden, 1 mitten am Hang – steuert Detail & Quebradas. */
    let slopeMask: number;

    if (u <= rx) {
      // ---------- Westhang: Talboden → Laderas → Ceja → El Alto ----------
      const rise = this.plateauBase(v) - floor;
      const cejaRise = rise * CEJA_FRACTION;
      const laderaRise = rise - cejaRise;
      const pass = this.passFactor(v);
      const laderaW = widthFor(laderaRise, LADERA_GRADE) * (1 + 0.12 * n.fbm(v * 4, 2.5, 2));
      const cejaW = widthFor(cejaRise, lerp(CEJA_CLIFF_GRADE, CEJA_RAMP_GRADE, pass));
      const d = rx - floorHalfWidth - u; // Abstand vom Talboden nach Westen

      if (d <= 0) {
        e = floor;
        slopeMask = 0;
      } else if (d < laderaW) {
        const t = d / laderaW;
        e = floor + laderaRise * Math.pow(t, 1.2);
        slopeMask = smoothstep(0, 0.12, t) * (1 - smoothstep(0.85, 1, t) * (1 - pass));
      } else if (d < laderaW + cejaW) {
        const t = (d - laderaW) / cejaW;
        // Steilwand: s-förmig; Rampa: nahezu linear (konstantes, fahrbares Gefälle)
        e = floor + laderaRise + cejaRise * lerp(smoothstep(0, 1, t), t, pass);
        slopeMask = 0.4 * pass;
      } else {
        const beyond = d - laderaW - cejaW;
        e = this.plateauBase(v) + this.plateauRelief(u, v) * smoothstep(0, 0.04, beyond);
        slopeMask = 0;
      }
    } else {
      // ---------- Osthang: Talboden → Miraflores / Villa Fátima ----------
      const rise = 0.25 + 0.06 * n.fbm(nu * 2 + 9.1, v * 2.5, 3);
      const width = widthFor(rise, EAST_GRADE);
      const d = Math.max(0, u - rx - floorHalfWidth);
      const t = clamp(d / width, 0, 1);
      e = floor + rise * smoothstep(0, 1, t);
      // jenseits des Hangs: Hügelkuppen mit leichtem Relief
      e += 0.04 * smoothstep(1, 1.5, d / width) * n.fbm(nu * 4 + 3, v * 4, 3);
      slopeMask = smoothstep(0.0, 0.15, t);
    }

    // Quebradas: Erosionsrinnen, die quer zum Tal in die Hänge schneiden.
    // Ridged-Noise mit gestauchter Frequenz entlang der Talachse.
    const gully = n.ridged(nu * 3.2 + 31, v * 7.5 + 11, 3);
    e -= 0.04 * Math.pow(gully, 3) * slopeMask;

    // Feines Relief – stärker an den Hängen, schwach auf Plateau und Talboden.
    e += (0.006 + 0.014 * slopeMask) * n.fbm(nu * 9 + 5, v * 9 - 3, 4);

    return clamp(e, 0, 1);
  }
}
