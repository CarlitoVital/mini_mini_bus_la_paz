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
  private viaducts: { a: Vec2; b: Vec2; pillars: Vec2[] }[] = [];
  /** Kreuzungs-Upgrade je Knoten (vom Inventar). */
  upgradeAt: (node: NodeId) => 'roundabout' | 'light' | undefined = () => undefined;
  /** Ampelphase je Knoten (von der Simulation). */
  lightPhase: (node: NodeId) => 0 | 1 = () => 0;

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
    this.viaducts = net.longEdges().map((e) => ({
      a: net.centerOf(e.a),
      b: net.centerOf(e.b),
      pillars: net.spannedCells(e.a, e.b).map((c) => net.centerOf(c)),
    }));
    this.builtVersion = net.version;
  }

  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (this.builtVersion !== this.net.version) this.rebuild();
    this.drawViaductBase(ctx);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.roadCasing;
    ctx.lineWidth = CASING_WIDTH;
    ctx.stroke(this.path);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = ROAD_WIDTH;
    ctx.stroke(this.path);
    this.drawViaductRails(ctx);

    if (zoom > 0.7) this.drawChevrons(ctx);
    this.drawJunctionUpgrades(ctx);
  }

  /** Schlagschatten und Pfeiler unter Viadukten. */
  private drawViaductBase(ctx: CanvasRenderingContext2D): void {
    if (!this.viaducts.length) return;
    ctx.lineCap = 'butt';
    for (const v of this.viaducts) {
      ctx.strokeStyle = 'rgba(40, 28, 18, 0.18)';
      ctx.lineWidth = ROAD_WIDTH + 6;
      ctx.beginPath();
      ctx.moveTo(v.a.x + 3, v.a.y + 5);
      ctx.lineTo(v.b.x + 3, v.b.y + 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(70, 58, 48, 0.75)';
      for (const p of v.pillars) {
        ctx.beginPath();
        ctx.roundRect(p.x - 3, p.y - 1, 6, 8, 1.5);
        ctx.fill();
      }
    }
  }

  /** Helle Geländer an beiden Seiten des Viadukts. */
  private drawViaductRails(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#f6f1e7';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const v of this.viaducts) {
      const len = Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y);
      const ux = (v.b.x - v.a.x) / len;
      const uy = (v.b.y - v.a.y) / len;
      const off = ROAD_WIDTH / 2 + 1.2;
      const inset = CELL_SIZE * 0.45;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const nx = -uy * off * side;
        const ny = ux * off * side;
        ctx.moveTo(v.a.x + ux * inset + nx, v.a.y + uy * inset + ny);
        ctx.lineTo(v.b.x - ux * inset + nx, v.b.y - uy * inset + ny);
      }
      ctx.stroke();
    }
  }

  /** Kreisverkehre (Insel) und Ampeln (Phasenpunkte) auf Kreuzungen. */
  private drawJunctionUpgrades(ctx: CanvasRenderingContext2D): void {
    for (const node of this.net.nodes()) {
      const kind = this.upgradeAt(node);
      if (!kind) continue;
      const c = this.net.centerOf(node);
      if (kind === 'roundabout') {
        ctx.fillStyle = COLORS.road;
        ctx.beginPath();
        ctx.arc(c.x, c.y, ROAD_WIDTH * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9cc58a';
        ctx.strokeStyle = '#f6f1e7';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        const phase = this.lightPhase(node);
        const r = ROAD_WIDTH * 0.62;
        const dots: [number, number, 0 | 1][] = [
          [r, 0, 0],
          [-r, 0, 0],
          [0, r, 1],
          [0, -r, 1],
        ];
        ctx.fillStyle = 'rgba(30, 26, 22, 0.85)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
        ctx.fill();
        for (const [dx, dy, axis] of dots) {
          ctx.fillStyle = axis === phase ? '#55d07a' : '#ef5a4f';
          ctx.beginPath();
          ctx.arc(c.x + dx, c.y + dy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** Vorschau beim Platzieren eines Kreuzungs-Upgrades. */
  drawPlacement(ctx: CanvasRenderingContext2D, node: NodeId, ok: boolean): void {
    const c = this.net.centerOf(node);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = ok ? STATUS_COLORS.ok : STATUS_COLORS.blocked;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, CELL_SIZE * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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
