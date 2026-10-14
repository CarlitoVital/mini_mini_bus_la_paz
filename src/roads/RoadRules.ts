import { MAX_ALLOWED_SLOPE, METERS_PER_WU, SLOPE_WARN_RATIO } from '../config';
import type { Topography } from '../terrain/Topography';
import type { NodeId, RoadNetwork } from './RoadNetwork';

export type GradeStatus = 'ok' | 'steep' | 'blocked';

export type BuildRejection = 'too-steep' | 'crossing' | 'not-adjacent' | 'out-of-bounds';

export interface BuildCheck {
  ok: boolean;
  /** Vorzeichenbehaftete Steigung von a nach b (0.1 = +10 % bergauf). */
  grade: number;
  reason?: BuildRejection;
}

/** Höhe eines Knotens in Metern (Zellmittelpunkt). */
export function nodeMeters(topo: Topography, net: RoadNetwork, id: NodeId): number {
  const c = net.centerOf(id);
  return topo.metersAt(c.x, c.y);
}

/**
 * Steigung eines Segments A → B als reales Gefälle:
 *   grade = (elevation(B) − elevation(A)) / distance(A, B)
 * mit Höhen in Metern und horizontaler Distanz in Metern. |grade| ist die "slope".
 */
export function segmentGrade(topo: Topography, net: RoadNetwork, a: NodeId, b: NodeId): number {
  const horizontalM = net.edgeLength(a, b) * METERS_PER_WU;
  return (nodeMeters(topo, net, b) - nodeMeters(topo, net, a)) / horizontalM;
}

/** Ampel-Einstufung einer Steigung: grün / gelb / rot. */
export function gradeStatus(grade: number): GradeStatus {
  const r = Math.abs(grade) / MAX_ALLOWED_SLOPE;
  if (r > 1) return 'blocked';
  if (r > SLOPE_WARN_RATIO) return 'steep';
  return 'ok';
}

/** Prüft, ob die Straße a–b gebaut werden darf (Nachbarschaft, Steigungslimit, Kreuzung). */
export function checkSegment(topo: Topography, net: RoadNetwork, a: NodeId, b: NodeId): BuildCheck {
  if (!net.areAdjacent(a, b)) return { ok: false, grade: 0, reason: 'not-adjacent' };
  const grade = segmentGrade(topo, net, a, b);
  if (net.hasEdge(a, b)) return { ok: true, grade };
  if (Math.abs(grade) > MAX_ALLOWED_SLOPE) return { ok: false, grade, reason: 'too-steep' };
  if (net.crossesDiagonal(a, b)) return { ok: false, grade, reason: 'crossing' };
  return { ok: true, grade };
}

export const REJECTION_TEXT: Record<BuildRejection, string> = {
  'too-steep': 'Zu steil! Serpentine nötig',
  crossing: 'Kreuzt eine Diagonale',
  'not-adjacent': 'Nicht benachbart',
  'out-of-bounds': 'Außerhalb der Karte',
};
