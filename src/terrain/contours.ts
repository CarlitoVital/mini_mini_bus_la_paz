import type { Vec2 } from '../core/math';

export interface Contour {
  /** Punkte in Sample-Koordinaten. */
  points: Vec2[];
  closed: boolean;
}

/**
 * Marching Squares: extrahiert alle Isolinien eines Höhenwerts aus einem
 * regelmäßigen Raster und verbindet die Einzelsegmente zu Polylinien.
 *
 * Segment-Endpunkte liegen immer auf Rasterkanten; jede Kante wird durch eine
 * eindeutige ID identifiziert, über die benachbarte Segmente verkettet werden.
 */
export function extractContours(heights: Float32Array, w: number, h: number, level: number): Contour[] {
  const at = (x: number, y: number) => heights[y * w + x];
  // Kanten-IDs: horizontale Kante (x,y)-(x+1,y) → 2*(y*w+x), vertikale (x,y)-(x,y+1) → 2*(y*w+x)+1
  const hEdge = (x: number, y: number) => 2 * (y * w + x);
  const vEdge = (x: number, y: number) => 2 * (y * w + x) + 1;

  const edgePoint = new Map<number, Vec2>();
  const point = (id: number): Vec2 => {
    let p = edgePoint.get(id);
    if (p) return p;
    const base = id >> 1;
    const x = base % w;
    const y = (base - x) / w;
    const a = at(x, y);
    if ((id & 1) === 0) {
      const t = (level - a) / (at(x + 1, y) - a);
      p = { x: x + t, y };
    } else {
      const t = (level - a) / (at(x, y + 1) - a);
      p = { x, y: y + t };
    }
    edgePoint.set(id, p);
    return p;
  };

  const segments: [number, number][] = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = hEdge(x, y);
      const bottom = hEdge(x, y + 1);
      const left = vEdge(x, y);
      const right = vEdge(x + 1, y);

      switch (code) {
        case 1: case 14: segments.push([left, bottom]); break;
        case 2: case 13: segments.push([bottom, right]); break;
        case 3: case 12: segments.push([left, right]); break;
        case 4: case 11: segments.push([top, right]); break;
        case 6: case 9: segments.push([top, bottom]); break;
        case 7: case 8: segments.push([left, top]); break;
        case 5: case 10: {
          // Sattelpunkt: über den Mittelwert der Zelle auflösen.
          const center = (tl + tr + br + bl) / 4;
          const centerHigh = center >= level;
          if ((code === 5) === centerHigh) {
            segments.push([left, top], [bottom, right]);
          } else {
            segments.push([left, bottom], [top, right]);
          }
          break;
        }
      }
    }
  }

  // Segmente über gemeinsame Kanten-IDs zu Polylinien verketten.
  const byEdge = new Map<number, number[]>();
  segments.forEach(([a, b], i) => {
    for (const e of [a, b]) {
      const list = byEdge.get(e);
      if (list) list.push(i);
      else byEdge.set(e, [i]);
    }
  });

  const used = new Uint8Array(segments.length);
  const nextSegment = (edge: number): number => {
    for (const s of byEdge.get(edge) ?? []) if (!used[s]) return s;
    return -1;
  };
  const walk = (startEdge: number): number[] => {
    const chain: number[] = [];
    let edge = startEdge;
    for (let s = nextSegment(edge); s !== -1; s = nextSegment(edge)) {
      used[s] = 1;
      const [a, b] = segments[s];
      edge = a === edge ? b : a;
      chain.push(edge);
    }
    return chain;
  };

  const contours: Contour[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [a, b] = segments[i];
    const forward = walk(b);
    const backward = walk(a);
    const edges = [...backward.reverse(), a, b, ...forward];
    const closed = edges.length > 3 && edges[0] === edges[edges.length - 1];
    if (closed) edges.pop();
    contours.push({ points: edges.map(point), closed });
  }
  return contours;
}

/** Chaikin-Glättung – offene Linien behalten ihre Endpunkte (wichtig am Kartenrand). */
export function chaikin(points: Vec2[], closed: boolean, iterations = 2): Vec2[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out: Vec2[] = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}
