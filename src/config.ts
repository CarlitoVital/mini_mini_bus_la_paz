/**
 * Zentrale Spielkonstanten. Alle Weltkoordinaten sind in "World Units" (WU)
 * angegeben; eine Gitterzelle ist CELL_SIZE WU breit.
 */

/** Gittergröße der Spielkarte (Zellen). */
export const GRID_COLS = 64;
export const GRID_ROWS = 40;

/** Kantenlänge einer Zelle in World Units. */
export const CELL_SIZE = 32;

/** Realer Maßstab: eine Zelle entspricht so vielen Metern in der Horizontalen. */
export const METERS_PER_CELL = 150;

/** Höhen-Samples pro Zelle (feineres Raster für weiche Höhenlinien). */
export const SAMPLES_PER_CELL = 4;

/** Referenz-Topografie: Zentrum La Paz (Plaza Murillo). */
export const GEO_CENTER = { lat: -16.52448, lon: -68.12382 } as const;

/** Normierte Höhe 0.0 ↔ Talkessel (Zona Sur), 1.0 ↔ Plateau El Alto. */
export const ELEVATION_MIN_M = 3200;
export const ELEVATION_MAX_M = 4150;

/** Abstand der Höhenlinien (Isohypsen) in Metern. */
export const CONTOUR_INTERVAL_M = 50;
/** Jede n-te Linie wird als Zähllinie (dicker, beschriftet) gezeichnet. */
export const CONTOUR_INDEX_EVERY = 4;

/** Kamera-Zoomgrenzen. */
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 4;

/** Standard-Seed der Kartengenerierung (über ?seed=… überschreibbar). */
export const DEFAULT_SEED = 1548;

export const WORLD_WIDTH = GRID_COLS * CELL_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * CELL_SIZE;

/** Horizontaler Maßstab: Meter pro World Unit. */
export const METERS_PER_WU = METERS_PER_CELL / CELL_SIZE;

/** Normierte Höhe → Meter über NN. */
export function elevationToMeters(e: number): number {
  return ELEVATION_MIN_M + e * (ELEVATION_MAX_M - ELEVATION_MIN_M);
}

/** Meter über NN → normierte Höhe. */
export function metersToElevation(m: number): number {
  return (m - ELEVATION_MIN_M) / (ELEVATION_MAX_M - ELEVATION_MIN_M);
}
