import { describe, expect, it } from 'vitest';
import { CELL_SIZE, MAX_ALLOWED_SLOPE } from '../src/config';
import { RoadNetwork, cellsOnLine } from '../src/roads/RoadNetwork';
import { checkSegment, gradeStatus, segmentGrade } from '../src/roads/RoadRules';
import { RoadTool } from '../src/roads/RoadTool';
import { Topography } from '../src/terrain/Topography';

const world = (cx: number, cy: number) => ({ x: (cx + 0.5) * CELL_SIZE, y: (cy + 0.5) * CELL_SIZE });

describe('RoadNetwork', () => {
  it('verwaltet Kanten ungerichtet und zählt Versionen', () => {
    const net = new RoadNetwork(10, 10);
    const a = net.id(1, 1);
    const b = net.id(2, 1);
    const v0 = net.version;
    expect(net.addEdge(a, b)).toBe(true);
    expect(net.addEdge(b, a)).toBe(false);
    expect(net.hasEdge(b, a)).toBe(true);
    expect(net.edgeCount).toBe(1);
    expect(net.version).toBeGreaterThan(v0);
    expect(net.removeNode(a)).toEqual([{ a, b }]);
    expect(net.edgeCount).toBe(0);
    expect(net.hasNode(b)).toBe(false);
  });

  it('erkennt sich kreuzende Diagonalen', () => {
    const net = new RoadNetwork(10, 10);
    net.addEdge(net.id(0, 0), net.id(1, 1));
    expect(net.crossesDiagonal(net.id(1, 0), net.id(0, 1))).toBe(true);
    expect(net.crossesDiagonal(net.id(1, 0), net.id(2, 1))).toBe(false);
  });

  it('rastert Linien 8er-zusammenhängend', () => {
    const cells = cellsOnLine({ cx: 0, cy: 0 }, { cx: 4, cy: 2 });
    expect(cells).toHaveLength(4);
    expect(cells[3]).toEqual({ cx: 4, cy: 2 });
    let prev = { cx: 0, cy: 0 };
    for (const c of cells) {
      expect(Math.max(Math.abs(c.cx - prev.cx), Math.abs(c.cy - prev.cy))).toBe(1);
      prev = c;
    }
  });

  it('findet die nächstgelegene Kante', () => {
    const net = new RoadNetwork(10, 10);
    net.addEdge(net.id(3, 3), net.id(4, 3));
    expect(net.edgeNear({ x: 4 * CELL_SIZE, y: 3.6 * CELL_SIZE }, 10)).toEqual({ a: net.id(3, 3), b: net.id(4, 3) });
    expect(net.edgeNear({ x: 1 * CELL_SIZE, y: 1 * CELL_SIZE }, 10)).toBeNull();
  });
});

describe('Steigungsregel', () => {
  const topo = new Topography(1548);
  const net = new RoadNetwork(topo.cols, topo.rows);

  it('Steigung ist antisymmetrisch und Ampel-Stufen passen', () => {
    const a = net.id(30, 20);
    const b = net.id(31, 21);
    expect(segmentGrade(topo, net, a, b)).toBeCloseTo(-segmentGrade(topo, net, b, a), 10);
    expect(gradeStatus(0.01)).toBe('ok');
    expect(gradeStatus(MAX_ALLOWED_SLOPE * 0.9)).toBe('steep');
    expect(gradeStatus(-MAX_ALLOWED_SLOPE * 1.1)).toBe('blocked');
  });

  it('blockiert direkte Straßen die Ceja hinauf', () => {
    // Zwischen zwei Rampas: von Ost nach West die Zeile entlang gehen, bis ein Schritt blockiert
    const passRows = topo.passY.map((y) => Math.floor(y / CELL_SIZE));
    const row = Math.round((passRows[0] + passRows[1]) / 2);
    let blocked = false;
    for (let cx = 30; cx > 1; cx--) {
      const r = checkSegment(topo, net, net.id(cx, row), net.id(cx - 1, row));
      if (!r.ok) {
        expect(r.reason).toBe('too-steep');
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  for (const seed of [1548, 777, 42, 9001]) {
    it(`El Alto ist nur über Rampas erreichbar (Seed ${seed})`, () => {
      const t = new Topography(seed);
      const n = new RoadNetwork(t.cols, t.rows);
      const reachable = (minRow: number, maxRow: number, start: number) => {
        const seen = new Set([start]);
        const queue = [start];
        while (queue.length) {
          const id = queue.pop()!;
          const c = n.cellOf(id);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nc = { cx: c.cx + dx, cy: c.cy + dy };
              if ((!dx && !dy) || !n.inBounds(nc) || nc.cy < minRow || nc.cy > maxRow) continue;
              const nid = n.id(nc.cx, nc.cy);
              if (!seen.has(nid) && checkSegment(t, n, id, nid).ok) {
                seen.add(nid);
                queue.push(nid);
              }
            }
        }
        return seen;
      };
      const elAlto = n.id(2, Math.floor(t.rows / 2));
      const centro = n.id(Math.floor(t.river[40].x / CELL_SIZE), Math.floor(t.river[40].y / CELL_SIZE));
      expect(t.zoneAt(world(2, Math.floor(t.rows / 2)).x, world(2, Math.floor(t.rows / 2)).y)).toBe('El Alto');

      // Mit der ganzen Karte: Plateau erreichbar (über die Rampas)
      expect(reachable(0, t.rows - 1, centro).has(elAlto)).toBe(true);

      // Nur zwischen zwei Rampas: die Ceja ist eine geschlossene Wand
      const passRows = t.passY.map((y) => Math.floor(y / CELL_SIZE));
      const r0 = passRows[0] + 4;
      const r1 = passRows[1] - 4;
      const band = reachable(r0, r1, n.id(40, Math.floor((r0 + r1) / 2)));
      expect(band.has(n.id(2, Math.floor((r0 + r1) / 2)))).toBe(false);
    });
  }
});

describe('RoadTool', () => {
  const topo = new Topography(1548);

  it('baut beim Ziehen Segment für Segment und unterstützt Undo', () => {
    const net = new RoadNetwork(topo.cols, topo.rows);
    const tool = new RoadTool(net, topo);
    // im flachen Talboden nahe des Flusses entlang
    const p = topo.river[60];
    const cx = Math.floor(p.x / CELL_SIZE);
    const cy = Math.floor(p.y / CELL_SIZE);
    tool.pointerDown(0, world(cx, cy));
    tool.pointerMove(world(cx, cy + 3));
    tool.pointerUp();
    expect(net.edgeCount).toBe(3);
    expect(tool.undo()).toBe(true);
    expect(net.edgeCount).toBe(0);
  });

  it('stoppt an zu steilen Schritten und meldet "too-steep"', () => {
    const net = new RoadNetwork(topo.cols, topo.rows);
    const blockedReasons: string[] = [];
    const tool = new RoadTool(net, topo, { onBlocked: (c) => blockedReasons.push(c.reason!) });
    const passRows = topo.passY.map((y) => Math.floor(y / CELL_SIZE));
    const row = Math.round((passRows[0] + passRows[1]) / 2);
    tool.pointerDown(0, world(30, row));
    tool.pointerMove(world(1, row));
    expect(tool.blocked?.check.reason).toBe('too-steep');
    expect(blockedReasons).toContain('too-steep');
    // Anker steht auf der letzten gültigen Zelle, nicht am Cursor
    expect(tool.anchor).not.toBe(net.id(1, row));
    tool.pointerUp();
    for (const e of net.edges()) expect(Math.abs(segmentGrade(topo, net, e.a, e.b))).toBeLessThanOrEqual(MAX_ALLOWED_SLOPE);
  });

  it('reißt mit Rechtsklick ab', () => {
    const net = new RoadNetwork(topo.cols, topo.rows);
    const tool = new RoadTool(net, topo);
    net.addEdge(net.id(40, 5), net.id(41, 5));
    tool.pointerDown(2, world(40, 5));
    tool.pointerUp();
    expect(net.edgeCount).toBe(0);
    expect(tool.undo()).toBe(true);
    expect(net.edgeCount).toBe(1);
  });
});
