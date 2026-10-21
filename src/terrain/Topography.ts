import {
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  METERS_PER_WU,
  SAMPLES_PER_CELL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  elevationToMeters,
} from '../config';
import { clamp, type Vec2 } from '../core/math';
import { LaPazGenerator } from './LaPazGenerator';

export type ZoneName = 'El Alto' | 'La Ceja' | 'Laderas Oeste' | 'Centro' | 'Zona Sur' | 'Miraflores' | 'Laderas Este';

/**
 * Höhenfeld der Spielkarte. Speichert die normierte Höhe (0..1) auf einem
 * Sample-Raster, das feiner ist als das Spielgitter (SAMPLES_PER_CELL pro Zelle),
 * und liefert kontinuierliche Höhen per bilinearer Interpolation.
 */
export class Topography {
  readonly cols = GRID_COLS;
  readonly rows = GRID_ROWS;
  readonly cellSize = CELL_SIZE;
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;

  /** Anzahl Samples in x/y (Raster inkl. Randpunkte). */
  readonly sw = GRID_COLS * SAMPLES_PER_CELL + 1;
  readonly sh = GRID_ROWS * SAMPLES_PER_CELL + 1;
  /** Abstand zweier Samples in World Units. */
  readonly sampleSpacing = CELL_SIZE / SAMPLES_PER_CELL;

  /** Normierte Höhen, zeilenweise (index = sy * sw + sx). */
  readonly heights: Float32Array;

  /** Verlauf des Río Choqueyapu in Weltkoordinaten (Nord → Süd). */
  readonly river: Vec2[];

  /** y-Positionen (Welt) der Rampas, an denen die Ceja per Serpentine befahrbar ist. */
  readonly passY: number[];

  constructor(readonly seed: number) {
    const gen = new LaPazGenerator(seed, WORLD_WIDTH / WORLD_HEIGHT);
    this.heights = new Float32Array(this.sw * this.sh);

    for (let sy = 0; sy < this.sh; sy++) {
      const v = sy / (this.sh - 1);
      for (let sx = 0; sx < this.sw; sx++) {
        this.heights[sy * this.sw + sx] = gen.sample(sx / (this.sw - 1), v);
      }
    }

    this.passY = gen.passes.map((v) => v * WORLD_HEIGHT);
    this.river = [];
    for (let i = 0; i <= 80; i++) {
      const v = i / 80;
      this.river.push({ x: gen.riverX(v) * WORLD_WIDTH, y: v * WORLD_HEIGHT });
    }
  }

  /** Höhe am Sample (sx, sy), Koordinaten werden an den Rand geklemmt. */
  sampleAt(sx: number, sy: number): number {
    const x = clamp(sx, 0, this.sw - 1);
    const y = clamp(sy, 0, this.sh - 1);
    return this.heights[y * this.sw + x];
  }

  /** Kontinuierliche normierte Höhe an einer Weltposition (bilinear). */
  elevationAt(wx: number, wy: number): number {
    const fx = clamp(wx / this.sampleSpacing, 0, this.sw - 1);
    const fy = clamp(wy / this.sampleSpacing, 0, this.sh - 1);
    const x0 = Math.min(Math.floor(fx), this.sw - 2);
    const y0 = Math.min(Math.floor(fy), this.sh - 2);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * this.sw + x0;
    const h = this.heights;
    const top = h[i] + (h[i + 1] - h[i]) * tx;
    const bottom = h[i + this.sw] + (h[i + this.sw + 1] - h[i + this.sw]) * tx;
    return top + (bottom - top) * ty;
  }

  /** Höhe in Metern über NN an einer Weltposition. */
  metersAt(wx: number, wy: number): number {
    return elevationToMeters(this.elevationAt(wx, wy));
  }

  /** Normierte Höhe im Mittelpunkt einer Gitterzelle. */
  cellElevation(cx: number, cy: number): number {
    return this.elevationAt((cx + 0.5) * CELL_SIZE, (cy + 0.5) * CELL_SIZE);
  }

  /** Gitterzelle unter einer Weltposition (oder null außerhalb der Karte). */
  cellAt(wx: number, wy: number): { cx: number; cy: number } | null {
    const cx = Math.floor(wx / CELL_SIZE);
    const cy = Math.floor(wy / CELL_SIZE);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return null;
    return { cx, cy };
  }

  /**
   * Geländeneigung (Betrag des Gradienten) als reales Gefälle, z. B. 0.12 = 12 %.
   * Berechnet aus zentralen Differenzen über eine halbe Zelle.
   */
  terrainGradeAt(wx: number, wy: number): number {
    const d = CELL_SIZE * 0.5;
    const dzdx = (this.metersAt(wx + d, wy) - this.metersAt(wx - d, wy)) / (2 * d * METERS_PER_WU);
    const dzdy = (this.metersAt(wx, wy + d) - this.metersAt(wx, wy - d)) / (2 * d * METERS_PER_WU);
    return Math.hypot(dzdx, dzdy);
  }

  /** Grobe Stadtteil-Zuordnung für Tooltips. */
  zoneAt(wx: number, wy: number): ZoneName {
    const e = this.elevationAt(wx, wy);
    const u = wx / this.width;
    const v = wy / this.height;
    const riverX = this.riverXAt(wy) / this.width;
    const grade = this.terrainGradeAt(wx, wy);

    if (u < riverX) {
      if (e > 0.8 && grade < 0.12) return 'El Alto';
      if (e > 0.6 && grade > 0.22) return 'La Ceja';
    }
    if (e < 0.25 && v > 0.55) return 'Zona Sur';
    if (Math.abs(u - riverX) < 0.07 && v < 0.62) return 'Centro';
    if (u < riverX) return 'Laderas Oeste';
    return v < 0.55 ? 'Miraflores' : 'Laderas Este';
  }

  /** x-Position des Flusses in einer gegebenen Weltzeile. */
  private riverXAt(wy: number): number {
    const t = clamp(wy / this.height, 0, 1) * (this.river.length - 1);
    const i = Math.min(Math.floor(t), this.river.length - 2);
    const f = t - i;
    return this.river[i].x + (this.river[i + 1].x - this.river[i].x) * f;
  }
}
