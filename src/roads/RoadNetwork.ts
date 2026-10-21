import { CELL_SIZE } from '../config';
import type { Vec2 } from '../core/math';

export interface Cell {
  cx: number;
  cy: number;
}

/** Knoten-ID einer Gitterzelle (cy * cols + cx). */
export type NodeId = number;

/** Ungerichtete Straßenkante zwischen zwei benachbarten Zellen (a < b). */
export interface Edge {
  a: NodeId;
  b: NodeId;
}

/**
 * Straßennetz als ungerichteter Graph über dem Spielgitter.
 * Knoten sind Zellmittelpunkte; Kanten verbinden Zellen der 8er-Nachbarschaft
 * (orthogonal und diagonal) – wie die Straßenkacheln in Mini Motorways.
 */
export class RoadNetwork {
  private readonly adj = new Map<NodeId, Set<NodeId>>();
  /** Wird bei jeder Änderung erhöht (für Render-Caches / Pfadfindung). */
  version = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {}

  id(cx: number, cy: number): NodeId {
    return cy * this.cols + cx;
  }

  cellOf(id: NodeId): Cell {
    const cx = id % this.cols;
    return { cx, cy: (id - cx) / this.cols };
  }

  /** Mittelpunkt einer Zelle in Weltkoordinaten. */
  centerOf(id: NodeId): Vec2 {
    const { cx, cy } = this.cellOf(id);
    return { x: (cx + 0.5) * CELL_SIZE, y: (cy + 0.5) * CELL_SIZE };
  }

  inBounds(c: Cell): boolean {
    return c.cx >= 0 && c.cy >= 0 && c.cx < this.cols && c.cy < this.rows;
  }

  /** true, wenn a und b direkte Nachbarn (inkl. diagonal) sind. */
  areAdjacent(a: NodeId, b: NodeId): boolean {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    const dx = Math.abs(ca.cx - cb.cx);
    const dy = Math.abs(ca.cy - cb.cy);
    return a !== b && dx <= 1 && dy <= 1;
  }

  /** Viadukt-Kante: überspannt mehr als eine Zelle (Chebyshev-Abstand > 1). */
  isLong(a: NodeId, b: NodeId): boolean {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    return Math.max(Math.abs(ca.cx - cb.cx), Math.abs(ca.cy - cb.cy)) > 1;
  }

  /** Zellen, die ein Viadukt a–b überspannt (ohne Endpunkte). */
  spannedCells(a: NodeId, b: NodeId): NodeId[] {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    const n = Math.max(Math.abs(cb.cx - ca.cx), Math.abs(cb.cy - ca.cy));
    const out: NodeId[] = [];
    for (let i = 1; i < n; i++) {
      out.push(this.id(ca.cx + (Math.sign(cb.cx - ca.cx) * i), ca.cy + Math.sign(cb.cy - ca.cy) * i));
    }
    return out;
  }

  /** Alle Viadukt-Kanten. */
  longEdges(): Edge[] {
    const out: Edge[] = [];
    for (const e of this.edges()) if (this.isLong(e.a, e.b)) out.push(e);
    return out;
  }

  /** Liegt die Zelle unter einem Viadukt? */
  isUnderViaduct(id: NodeId): boolean {
    for (const e of this.longEdges()) if (this.spannedCells(e.a, e.b).includes(id)) return true;
    return false;
  }

  /** Horizontale Länge einer Kante in World Units. */
  edgeLength(a: NodeId, b: NodeId): number {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    return Math.hypot(ca.cx - cb.cx, ca.cy - cb.cy) * CELL_SIZE;
  }

  hasNode(id: NodeId): boolean {
    return this.adj.has(id);
  }

  hasEdge(a: NodeId, b: NodeId): boolean {
    return this.adj.get(a)?.has(b) ?? false;
  }

  neighbors(id: NodeId): ReadonlySet<NodeId> {
    return this.adj.get(id) ?? EMPTY;
  }

  degree(id: NodeId): number {
    return this.adj.get(id)?.size ?? 0;
  }

  /**
   * Würde eine diagonale Kante a–b eine bestehende Gegendiagonale kreuzen?
   * (Zwei Diagonalen in einem 2×2-Block schneiden sich ohne Kreuzung.)
   */
  crossesDiagonal(a: NodeId, b: NodeId): boolean {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    if (ca.cx === cb.cx || ca.cy === cb.cy) return false;
    return this.hasEdge(this.id(ca.cx, cb.cy), this.id(cb.cx, ca.cy));
  }

  /** Fügt eine Kante hinzu; liefert false, wenn sie bereits existierte. */
  addEdge(a: NodeId, b: NodeId): boolean {
    if (this.hasEdge(a, b)) return false;
    this.link(a, b);
    this.link(b, a);
    this.version++;
    return true;
  }

  removeEdge(a: NodeId, b: NodeId): boolean {
    if (!this.hasEdge(a, b)) return false;
    this.unlink(a, b);
    this.unlink(b, a);
    this.version++;
    return true;
  }

  /** Entfernt alle Kanten eines Knotens und liefert die entfernten Kanten. */
  removeNode(id: NodeId): Edge[] {
    const removed: Edge[] = [];
    for (const n of [...this.neighbors(id)]) {
      this.removeEdge(id, n);
      removed.push(id < n ? { a: id, b: n } : { a: n, b: id });
    }
    return removed;
  }

  *edges(): IterableIterator<Edge> {
    for (const [a, set] of this.adj) {
      for (const b of set) if (a < b) yield { a, b };
    }
  }

  *nodes(): IterableIterator<NodeId> {
    yield* this.adj.keys();
  }

  /** Nächstgelegene Kante zu einem Weltpunkt (Suche in der 3×3-Umgebung), oder null. */
  edgeNear(p: Vec2, maxDist: number): Edge | null {
    const cx = Math.floor(p.x / CELL_SIZE);
    const cy = Math.floor(p.y / CELL_SIZE);
    let best: Edge | null = null;
    let bestD = maxDist;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = { cx: cx + dx, cy: cy + dy };
        if (!this.inBounds(c)) continue;
        const a = this.id(c.cx, c.cy);
        for (const b of this.neighbors(a)) {
          if (b < a) continue;
          const d = distToSegment(p, this.centerOf(a), this.centerOf(b));
          if (d < bestD) {
            bestD = d;
            best = { a, b };
          }
        }
      }
    }
    return best;
  }

  get edgeCount(): number {
    let n = 0;
    for (const set of this.adj.values()) n += set.size;
    return n / 2;
  }

  clear(): void {
    this.adj.clear();
    this.version++;
  }

  private link(a: NodeId, b: NodeId): void {
    let set = this.adj.get(a);
    if (!set) this.adj.set(a, (set = new Set()));
    set.add(b);
  }

  private unlink(a: NodeId, b: NodeId): void {
    const set = this.adj.get(a);
    if (!set) return;
    set.delete(b);
    if (set.size === 0) this.adj.delete(a);
  }
}

const EMPTY: ReadonlySet<NodeId> = new Set();

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * Zellen entlang einer Linie von a nach b (exklusive a, inklusive b), 8er-zusammenhängend.
 * Wird beim schnellen Ziehen benutzt, wenn die Maus mehrere Zellen pro Frame überspringt.
 */
export function cellsOnLine(a: Cell, b: Cell): Cell[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const out: Cell[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ cx: Math.round(a.cx + (dx * i) / steps), cy: Math.round(a.cy + (dy * i) / steps) });
  }
  return out;
}
