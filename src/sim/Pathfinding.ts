import type { NodeId, RoadNetwork } from '../roads/RoadNetwork';
import { segmentGrade } from '../roads/RoadRules';
import type { Topography } from '../terrain/Topography';
import { MAX_SPEED, expectedSpeed } from './physics';

export interface PathResult {
  nodes: NodeId[];
  /** Erwartete Fahrzeit in Sekunden. */
  time: number;
}

/** Erwartete Fahrzeit über eine gerichtete Kante (Distanz / erwartete Geschwindigkeit). */
export function edgeTravelTime(topo: Topography, net: RoadNetwork, a: NodeId, b: NodeId): number {
  return net.edgeLength(a, b) / expectedSpeed(segmentGrade(topo, net, a, b));
}

/**
 * A*-Suche im Straßengraph. Kantengewichte sind die erwarteten Fahrzeiten, d. h. der
 * Algorithmus nimmt lieber einen flacheren Umweg als eine steile Direktverbindung –
 * und die Kosten sind richtungsabhängig (bergauf teurer als bergab).
 *
 * `blocked` sind Knoten, die nicht durchfahren werden dürfen (z. B. fremde Gebäude-Eingänge);
 * Start und Ziel sind davon ausgenommen.
 */
export function findPath(
  topo: Topography,
  net: RoadNetwork,
  start: NodeId,
  goal: NodeId,
  blocked?: (n: NodeId) => boolean,
): PathResult | null {
  if (start === goal) return { nodes: [start], time: 0 };
  if (!net.hasNode(start) || !net.hasNode(goal)) return null;

  const goalPos = net.centerOf(goal);
  const h = (n: NodeId) => {
    const p = net.centerOf(n);
    return Math.hypot(p.x - goalPos.x, p.y - goalPos.y) / MAX_SPEED;
  };

  const g = new Map<NodeId, number>([[start, 0]]);
  const came = new Map<NodeId, NodeId>();
  const closed = new Set<NodeId>();
  const open = new MinHeap();
  open.push(start, h(start));

  while (open.size) {
    const cur = open.pop();
    if (cur === goal) {
      const nodes = [goal];
      for (let n = goal; came.has(n); ) {
        n = came.get(n)!;
        nodes.push(n);
      }
      nodes.reverse();
      return { nodes, time: g.get(goal)! };
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const gc = g.get(cur)!;
    for (const nb of net.neighbors(cur)) {
      if (closed.has(nb)) continue;
      if (nb !== goal && blocked?.(nb)) continue;
      const tentative = gc + edgeTravelTime(topo, net, cur, nb);
      if (tentative < (g.get(nb) ?? Infinity)) {
        g.set(nb, tentative);
        came.set(nb, cur);
        open.push(nb, tentative + h(nb));
      }
    }
  }
  return null;
}

/** Binärer Min-Heap (Knoten, Priorität) mit Lazy-Deletion. */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    this.ids.push(id);
    this.pri.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastP = this.pri.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.pri[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}
