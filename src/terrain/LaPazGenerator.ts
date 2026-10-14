import { SimplexNoise2D } from '../core/noise';
import { clamp, lerp, smoothstep } from '../core/math';

/**
 * Prozeduraler Höhengenerator, der die Topografie von La Paz / El Alto nachbildet.
 *
 * Koordinaten sind normiert: u ∈ [0,1] (West → Ost), v ∈ [0,1] (Nord → Süd).
 * Die Karte ist zentriert auf das Stadtzentrum (Plaza Murillo, -16.52448 / -68.12382).
 *
 * Aufbau (grob von West nach Ost):
 *   1. El Alto  – flaches Altiplano-Plateau im Westen/Nordwesten (≈ 4.050–4.150 m)
 *   2. La Ceja  – die Abbruchkante des Plateaus, eine fast senkrechte Steilwand
 *   3. Laderas  – die steilen, von Quebradas (Erosionsrinnen) zerfurchten Hänge
 *   4. Talboden – das Tal des Río Choqueyapu, das von Norden (Centro, ≈ 3.650 m)
 *                 nach Südosten (Zona Sur, ≈ 3.250 m) abfällt
 *   5. Osthänge – die Hügel von Miraflores / Villa Fátima, die wieder ansteigen
 */
export class LaPazGenerator {
  private readonly n: SimplexNoise2D;
  private readonly aspect: number;

  constructor(seed: number, aspect: number) {
    this.n = new SimplexNoise2D(seed);
    this.aspect = aspect; // Breite / Höhe – für isotrope Noise-Frequenzen
  }

  /** x-Position des Río Choqueyapu (Talachse) in Abhängigkeit von v. */
  riverX(v: number): number {
    return 0.46 + 0.3 * Math.pow(v, 1.5) + 0.035 * Math.sin(v * 7.5 + 0.6) + 0.025 * this.n.fbm(v * 2.2, 17.3, 3);
  }

  /** Höhe des Talbodens entlang der Talachse (Nord hoch, Südost tief). */
  private floorHeight(v: number): number {
    return 0.62 - 0.6 * Math.pow(v, 1.6);
  }

  /** x-Position der Ceja (Abbruchkante El Alto). */
  private rimX(v: number): number {
    return 0.22 + 0.12 * v + 0.035 * this.n.fbm(v * 3.1, 4.7, 3);
  }

  /** Plateauhöhe El Alto – nach Süden (Richtung Achocalla) etwas niedriger. */
  private plateauHeight(u: number, v: number): number {
    const south = v + 0.12 * this.n.fbm(u * 2.5 + 40, v * 2.5, 2);
    const base = 0.95 - 0.16 * smoothstep(0.55, 1.05, south) + 0.04 * (0.3 - u);
    return base + 0.018 * this.n.fbm(u * 3 * this.aspect, v * 3, 3);
  }

  /** Höhe der Osthügel. */
  private eastHillHeight(u: number, v: number): number {
    return 0.74 - 0.14 * v + 0.07 * this.n.fbm(u * 2.5 * this.aspect + 9.1, v * 2.5, 3);
  }

  /** Normierte Höhe an (u, v), ungefähr in [0, 1] (wird im Topography-Grid normiert). */
  sample(u: number, v: number): number {
    const n = this.n;
    const nu = u * this.aspect;

    const rx = this.riverX(v);
    const floor = this.floorHeight(v);
    const rim = this.rimX(v);
    const floorHalfWidth = 0.012 + 0.012 * v; // Zona Sur hat breiteren Talboden

    let e: number;
    /** 0 auf Plateau/Talboden, 1 mitten am Hang – steuert Detail & Quebradas. */
    let slopeMask: number;

    if (u <= rim) {
      // ---------- El Alto Plateau ----------
      e = this.plateauHeight(u, v);
      slopeMask = 0.15 * smoothstep(rim - 0.04, rim, u);
    } else if (u <= rx) {
      // ---------- Westhang: Talboden → Laderas → Ceja ----------
      const width = Math.max(0.05, rx - rim - floorHalfWidth);
      const w = clamp((rx - floorHalfWidth - u) / width, 0, 1); // 0 = Talboden, 1 = Kante
      const shape = 0.52 * Math.pow(w, 1.55) + 0.48 * smoothstep(0.76, 1.0, w);
      e = lerp(floor, this.plateauHeight(rim, v), shape);
      slopeMask = smoothstep(0.0, 0.15, w) * (1 - smoothstep(0.82, 0.97, w));
    } else {
      // ---------- Osthang: Talboden → Miraflores / Villa Fátima ----------
      const width = 0.2;
      const d = Math.max(0, u - rx - floorHalfWidth);
      const w = clamp(d / width, 0, 1);
      const shape = Math.pow(smoothstep(0, 1, w), 0.95);
      e = lerp(floor, this.eastHillHeight(u, v), shape);
      // jenseits des Hangs: Hügelkuppen mit leichtem Relief
      e += 0.05 * smoothstep(1, 1.6, d / width) * n.fbm(nu * 4 + 3, v * 4, 3);
      slopeMask = smoothstep(0.0, 0.2, w);
    }

    // Quebradas: Erosionsrinnen, die quer zum Tal in die Hänge schneiden.
    // Ridged-Noise mit gestauchter Frequenz entlang der Talachse.
    const gully = n.ridged(nu * 3.2 + 31, v * 7.5 + 11, 3);
    e -= 0.075 * Math.pow(gully, 3) * slopeMask;

    // Feines Relief – stark an den Hängen, schwach auf Plateau und Talboden.
    e += (0.008 + 0.022 * slopeMask) * n.fbm(nu * 9 + 5, v * 9 - 3, 4);

    return e;
  }
}
