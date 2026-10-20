import { CELL_SIZE } from '../config';
import type { Vec2 } from '../core/math';
import type { NodeId, RoadNetwork } from '../roads/RoadNetwork';
import { type ConnectionRules, type GradeStatus, checkSegment, gradeStatus, segmentGrade } from '../roads/RoadRules';
import type { RoadTool } from '../roads/RoadTool';
import type { Topography } from '../terrain/Topography';
import { COLORS } from './palette';

const ROAD_WIDTH = CELL_SIZE * 0.42;
const CASING_WIDTH = ROAD_WIDTH + 4;
/** Ab diesem Gefälle werden Bergauf-Pfeile auf die Fahrbahn gemalt. */
const CHEVRON_MIN_GRADE = 0.04;

export const STATUS_COLORS: Record<GradeStatus, string> = {
  ok: '#4fae6c',
  steep: '#e5a530',
  blocked: '#d9534f',
};

interface Chevron {
  x: number;
  y: number;
  /** Richtung bergauf (Radiant). */
  angle: number;
  count: number;
}

/**
 * Zeichnet das Straßennetz im Mini-Motorways-Stil: Zellmittelpunkte werden über
 * die Kantenmitten mit quadratischen Bezier-Kurven verbunden. Dadurch werden Ecken
 * und Serpentinen-Kehren automatisch weich gerundet.
 */
export class RoadRenderer {
  private path = new Path2D();
  private chevrons: Chevron[] = [];
  private builtVersion = -1;

  constructor(
    private readonly net: RoadNetwork,
    private topo: Topography,
    public rules?: ConnectionRules,
  ) {}

  setTopography(topo: Topography): void {
    this.topo = topo;
    this.builtVersion = -1;
  }

  private rebuild(): void {
    const { net } = this;
    const path = new Path2D();
    const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    for (const id of net.nodes()) {
      const c = net.centerOf(id);
      const ns = [...net.neighbors(id)];
      if (ns.length === 2) {
        // Durchgangsknoten: weiche Kurve von Kantenmitte zu Kantenmitte, Kontrollpunkt = Zellmitte
        const m0 = mid(c, net.centerOf(ns[0]));
        const m1 = mid(c, net.centerOf(ns[1]));
        path.moveTo(m0.x, m0.y);
        path.quadraticCurveTo(c.x, c.y, m1.x, m1.y);
      } else {
        // Sackgasse oder Kreuzung: gerade Halbsegmente zur Zellmitte
        for (const n of ns) {
          const m = mid(c, net.centerOf(n));
          path.moveTo(c.x, c.y);
          path.lineTo(m.x, m.y);
        }
      }
    }
    this.path = path;

    this.chevrons = [];
    for (const e of net.edges()) {
      const grade = segmentGrade(this.topo, net, e.a, e.b);
      if (Math.abs(grade) < CHEVRON_MIN_GRADE) continue;
      const [lo, hi] = grade > 0 ? [e.a, e.b] : [e.b, e.a];
      const p = net.centerOf(lo);
      const q = net.centerOf(hi);
      this.chevrons.push({
        x: (p.x + q.x) / 2,
        y: (p.y + q.y) / 2,
        angle: Math.atan2(q.y - p.y, q.x - p.x),
        count: gradeStatus(grade) === 'ok' ? 1 : 2,
      });
    }
    this.builtVersion = net.version;
  }

  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (this.builtVersion !== this.net.version) this.rebuild();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.roadCasing;
    ctx.lineWidth = CASING_WIDTH;
    ctx.stroke(this.path);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = ROAD_WIDTH;
    ctx.stroke(this.path);

    if (zoom > 0.7) this.drawChevrons(ctx);
  }

  /** Kleine Pfeile "^" in Bergauf-Richtung (doppelt bei steilen Abschnitten). */
  private drawChevrons(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.roadMarking;
    ctx.lineWidth = 1.6;
    const back = 3.2; // Länge der Pfeilschenkel entlang der Fahrbahn
    const half = 2.4; // halbe Pfeilbreite quer zur Fahrbahn
    ctx.beginPath();
    for (const c of this.chevrons) {
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);
      for (let k = 0; k < c.count; k++) {
        const off = (k - (c.count - 1) / 2) * 4.5;
        const tx = c.x + cos * off;
        const ty = c.y + sin * off;
        // Spitze zeigt bergauf
        ctx.moveTo(tx - cos * back - sin * half, ty - sin * back + cos * half);
        ctx.lineTo(tx, ty);
        ctx.lineTo(tx - cos * back + sin * half, ty - sin * back - cos * half);
      }
    }
    ctx.stroke();
  }

  /** Bau-Vorschau: Steigungs-Ampel der Nachbarzellen und rote Sperr-Vorschau. */
  drawPreview(ctx: CanvasRenderingContext2D, tool: RoadTool, zoom: number): void {
    if (tool.mode !== 'build' || tool.anchor === null) return;
    const { net, topo } = this;
    const anchor = tool.anchor;
    const a = net.centerOf(anchor);
    const ac = net.cellOf(anchor);

    // Ampelpunkte auf den 8 Nachbarzellen: wohin darf der nächste Schritt gehen?
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const c = { cx: ac.cx + dx, cy: ac.cy + dy };
        if (!net.inBounds(c)) continue;
        const n: NodeId = net.id(c.cx, c.cy);
        const check = checkSegment(topo, net, anchor, n, this.rules);
        const status: GradeStatus = check.ok ? gradeStatus(check.grade) : 'blocked';
        const p = net.centerOf(n);
        ctx.fillStyle = STATUS_COLORS[status];
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(a.x + (p.x - a.x) * 0.72, a.y + (p.y - a.y) * 0.72, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Anker-Ring
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = 2 / Math.min(zoom, 1.5);
    ctx.beginPath();
    ctx.arc(a.x, a.y, ROAD_WIDTH * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    if (!tool.blocked) return;
    const b = net.centerOf(tool.blocked.to);
    const color = STATUS_COLORS.blocked;
    // Rote, gestrichelte Geister-Straße
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = ROAD_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (tool.cursorNode !== null && tool.cursorNode !== tool.blocked.to) {
      const t = net.centerOf(tool.cursorNode);
      ctx.lineTo(t.x, t.y);
    } else {
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();

    // Sperr-Markierung (×) auf der blockierten Zelle
    const r = 6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x - r, b.y - r);
    ctx.lineTo(b.x + r, b.y + r);
    ctx.moveTo(b.x + r, b.y - r);
    ctx.lineTo(b.x - r, b.y + r);
    ctx.stroke();
  }
}
