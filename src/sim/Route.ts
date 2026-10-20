import type { Vec2 } from '../core/math';
import type { NodeId, RoadNetwork } from '../roads/RoadNetwork';
import { segmentGrade } from '../roads/RoadRules';
import type { Topography } from '../terrain/Topography';
import { curveSpeedFactor } from './physics';

const CURVE_SUBDIVISIONS = 8;

export interface RouteSample extends Vec2 {
  /** Fahrtrichtung (Radiant). */
  angle: number;
  /** Index der Graph-Kante (nodes[edge] → nodes[edge+1]), auf der der Punkt liegt. */
  edge: number;
}

/**
 * Fahrgeometrie eines Pfads: dieselben Bezier-Kurven wie im RoadRenderer
 * (Zellmitte → Kantenmitte → quadratische Kurve um jede Zwischenzelle),
 * als Polylinie mit kumulierter Länge, Kantenzuordnung, Steigung und Kurvenfaktor.
 */
export class Route {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  /** Kumulierte Länge bis Punkt i. */
  readonly cum: number[] = [];
  /** Für Abschnitt i (Punkt i → i+1): Kantenindex und Kurvenfaktor. */
  readonly segEdge: number[] = [];
  readonly segCurve: number[] = [];
  /** Steigung je Kante in Fahrtrichtung. */
  readonly grades: number[] = [];
  /** Bogenlänge am Knoten i (Zwischenknoten: Scheitel der Kurve). */
  readonly nodeS: number[] = [];

  constructor(
    topo: Topography,
    net: RoadNetwork,
    readonly nodes: NodeId[],
  ) {
    const k = nodes.length - 1;
    for (let i = 0; i < k; i++) this.grades.push(segmentGrade(topo, net, nodes[i], nodes[i + 1]));

    const c = nodes.map((n) => net.centerOf(n));
    const mid = (i: number): Vec2 => ({ x: (c[i].x + c[i + 1].x) / 2, y: (c[i].y + c[i + 1].y) / 2 });

    this.push(c[0], 0, 1);
    this.nodeS.push(0);
    for (let i = 1; i < k; i++) {
      const m0 = mid(i - 1);
      const m1 = mid(i);
      const a0 = Math.atan2(c[i].y - c[i - 1].y, c[i].x - c[i - 1].x);
      const a1 = Math.atan2(c[i + 1].y - c[i].y, c[i + 1].x - c[i].x);
      let turn = a1 - a0;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const curve = curveSpeedFactor(turn);

      this.push(m0, i - 1, curve);
      for (let j = 1; j <= CURVE_SUBDIVISIONS; j++) {
        const t = j / CURVE_SUBDIVISIONS;
        const u = 1 - t;
        const p = {
          x: u * u * m0.x + 2 * u * t * c[i].x + t * t * m1.x,
          y: u * u * m0.y + 2 * u * t * c[i].y + t * t * m1.y,
        };
        // Erste Kurvenhälfte gehört noch zur ankommenden Kante
        this.push(p, j < CURVE_SUBDIVISIONS / 2 ? i - 1 : i, curve);
        if (j === CURVE_SUBDIVISIONS / 2) this.nodeS.push(this.length);
      }
    }
    if (k > 0) {
      this.push(c[k], k - 1, 1);
      this.nodeS.push(this.length);
    }
  }

  get length(): number {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }

  /** Punkt bei Bogenlänge s (geklemmt). */
  sample(s: number): RouteSample {
    const n = this.xs.length;
    if (n === 1) return { x: this.xs[0], y: this.ys[0], angle: 0, edge: 0 };
    const i = this.segmentAt(s);
    const segLen = this.cum[i + 1] - this.cum[i] || 1;
    const t = Math.min(1, Math.max(0, (s - this.cum[i]) / segLen));
    const dx = this.xs[i + 1] - this.xs[i];
    const dy = this.ys[i + 1] - this.ys[i];
    return { x: this.xs[i] + dx * t, y: this.ys[i] + dy * t, angle: Math.atan2(dy, dx), edge: this.segEdge[i] };
  }

  /** Index des Abschnitts, der s enthält. */
  segmentAt(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    if (hi < 0) return 0;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  /** Steigung in Fahrtrichtung bei s. */
  gradeAt(s: number): number {
    return this.grades[this.segEdge[this.segmentAt(s)]] ?? 0;
  }

  /** Kurvenfaktor bei s. */
  curveAt(s: number): number {
    return this.segCurve[this.segmentAt(s)] ?? 1;
  }

  /** Bogenlänge des Punkts, der p am nächsten liegt (für Neuplanung während der Fahrt). */
  project(p: Vec2, maxS = Infinity): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.xs.length - 1 && this.cum[i] <= maxS; i++) {
      const ax = this.xs[i];
      const ay = this.ys[i];
      const vx = this.xs[i + 1] - ax;
      const vy = this.ys[i + 1] - ay;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / len2));
      const d = Math.hypot(p.x - (ax + vx * t), p.y - (ay + vy * t));
      if (d < bestD) {
        bestD = d;
        best = this.cum[i] + t * Math.sqrt(len2);
      }
    }
    return best;
  }

  private push(p: Vec2, edge: number, curve: number): void {
    const n = this.xs.length;
    if (n) {
      const d = Math.hypot(p.x - this.xs[n - 1], p.y - this.ys[n - 1]);
      if (d < 1e-6) return;
      this.cum.push(this.cum[n - 1] + d);
      // Abschnitt (n-1 → n) erhält die Attribute des Zielpunkts
      this.segEdge.push(edge);
      this.segCurve.push(curve);
    } else {
      this.cum.push(0);
    }
    this.xs.push(p.x);
    this.ys.push(p.y);
  }
}
