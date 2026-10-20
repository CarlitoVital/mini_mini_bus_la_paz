import {
  BUS_BASE_SPEED,
  DOWNHILL_BONUS_FACTOR,
  DOWNHILL_MAX_BONUS,
  MIN_SPEED_FACTOR,
  UPHILL_PENALTY_FACTOR,
} from '../config';

/**
 * Neigungsabhängiger Geschwindigkeitsfaktor in Fahrtrichtung.
 *  - bergauf (grade > 0): base * max(0.2, 1 − grade * UPHILL_PENALTY_FACTOR)  → drastisch langsamer
 *  - eben    (grade = 0): 1
 *  - bergab  (grade < 0): leicht schneller, gedeckelt
 */
export function gradeSpeedFactor(grade: number): number {
  if (grade > 0) return Math.max(MIN_SPEED_FACTOR, 1 - grade * UPHILL_PENALTY_FACTOR);
  return 1 + Math.min(DOWNHILL_MAX_BONUS, -grade * DOWNHILL_BONUS_FACTOR);
}

/**
 * Kurvenfaktor aus dem Richtungswechsel an einem Knoten (0 = geradeaus, π = Kehrtwende).
 * Enge Serpentinen-Kehren (135°) drosseln auf ~55 % – das deckelt auch den Bergab-Bonus.
 */
export function curveSpeedFactor(turnAngle: number): number {
  const t = Math.min(1, Math.abs(turnAngle) / ((3 * Math.PI) / 4));
  return 1 - 0.45 * t;
}

/** Erwartete Geschwindigkeit (WU/s) auf einem Segment – Grundlage der A*-Kantengewichte. */
export function expectedSpeed(grade: number): number {
  return BUS_BASE_SPEED * gradeSpeedFactor(grade);
}

/** Höchstmögliche Geschwindigkeit (für eine zulässige A*-Heuristik). */
export const MAX_SPEED = BUS_BASE_SPEED * (1 + DOWNHILL_MAX_BONUS);
