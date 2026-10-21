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

/**
 * Maximal zulässige Straßensteigung als reales Gefälle (Höhenmeter / horizontale Meter).
 * 0.15 = 15 %. Steilere Direktverbindungen sind verboten → Serpentinen nötig.
 */
export const MAX_ALLOWED_SLOPE = 0.15;
/** Ab diesem Anteil von MAX_ALLOWED_SLOPE wird die Steigung gelb (Warnung) angezeigt. */
export const SLOPE_WARN_RATIO = 0.6;

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

// ---------------------------------------------------------------------------
// Simulation (Phase 3)
// ---------------------------------------------------------------------------

/** Grundgeschwindigkeit eines Minibusses in der Ebene (World Units pro Sekunde). */
export const BUS_BASE_SPEED = 46;
/** Bergauf: speed = base * max(MIN_SPEED_FACTOR, 1 − grade * UPHILL_PENALTY_FACTOR). */
export const UPHILL_PENALTY_FACTOR = 5;
export const MIN_SPEED_FACTOR = 0.2;
/** Bergab: leichter Bonus, gedeckelt (und zusätzlich durch Kurvenradien begrenzt). */
export const DOWNHILL_BONUS_FACTOR = 2;
export const DOWNHILL_MAX_BONUS = 0.25;
/** Beschleunigung / Bremsverzögerung in WU/s². */
export const BUS_ACCEL = 40;
export const BUS_BRAKE = 160;
/** Fahrzeugmaße in WU und Seitenversatz der Fahrspur (Rechtsverkehr). */
export const BUS_LENGTH = 12;
export const BUS_WIDTH = 6.5;
export const LANE_OFFSET = 3.4;
/** Passagiere (Pins) pro Minibus und Busse pro Garage. */
export const BUS_CAPACITY = 4;
export const BUSES_PER_HOUSE = 2;
/** Sekunden pro ein-/aussteigendem Passagier. */
export const BOARDING_TIME_PER_PIN = 0.45;

/** Länge eines In-Game-Tages in Sekunden (bei 1x). */
export const DAY_LENGTH_S = 40;
/** Ab so vielen wartenden Pins läuft der Überlastungs-Timer eines Marktes. */
export const MARKET_OVERLOAD_PINS = 8;
/** Zeit bis zum Überlauf (Timer voll) in Sekunden. */
export const MARKET_OVERLOAD_TIME_S = 45;
/** Maximal angezeigte/angesammelte Pins pro Markt. */
export const MARKET_MAX_PINS = 12;

// ---------------------------------------------------------------------------
// Spielablauf & Ressourcen (Phase 4)
// ---------------------------------------------------------------------------

/** Tage pro Woche – am Wochenende gibt es Belohnungen. */
export const DAYS_PER_WEEK = 7;
/** Alle so viele Tage kommt eine neue Linienfarbe hinzu. */
export const NEW_COLOR_EVERY_DAYS = 3;
/** Straßenteile (1 Teil = 1 Straßenzelle) zu Spielbeginn und als Wochenbelohnung. */
export const START_ROAD_TILES = 45;
export const WEEKLY_ROAD_TILES = 25;
/** Viadukte zu Spielbeginn. */
export const START_VIADUCTS = 1;
/** Max. Spannweite eines Viadukts in Zellen (gerade Linie, orthogonal oder diagonal). */
export const VIADUCT_MAX_SPAN = 4;
/** Dauer einer Ampelphase in Sekunden. */
export const LIGHT_PHASE_S = 3.5;
/** Tempolimit im Kreisverkehr (Anteil der Grundgeschwindigkeit). */
export const ROUNDABOUT_SPEED_FACTOR = 0.55;
