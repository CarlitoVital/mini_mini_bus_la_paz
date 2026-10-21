import { CELL_SIZE, MAX_ALLOWED_SLOPE } from '../config';
import { clamp, type Vec2 } from '../core/math';
import type { Cell, NodeId, RoadNetwork } from '../roads/RoadNetwork';
import { segmentGrade } from '../roads/RoadRules';
import type { Topography } from '../terrain/Topography';
import type { BuildingRegistry, ColorId } from './Buildings';

/** Wohin eine Farblinie gehört: Wohnviertel (Garagen) und Zielgebiet (Märkte). */
export interface ColorRegion {
  houseCenter: Vec2;
  marketCenter: Vec2;
}

const ORTHO: Cell[] = [
  { cx: 1, cy: 0 },
  { cx: -1, cy: 0 },
  { cx: 0, cy: 1 },
  { cx: 0, cy: -1 },
];

/** Max. Höhenunterschied (m) innerhalb der 2×2-Fläche eines Marktes. */
const MARKET_MAX_RELIEF_M = 30;
/** Mindestabstand eines Gebäudes vom Fluss (WU). */
const RIVER_CLEARANCE = 22;

/**
 * Sucht gültige Bauplätze für Garagen (1×1) und Märkte (2×2).
 * Eine Zufahrt muss orthogonal liegen, frei sein und innerhalb des Steigungslimits
 * anschließbar sein – sonst wäre das Gebäude nie erreichbar.
 */
export class Spawner {
  constructor(
    private readonly topo: Topography,
    private readonly net: RoadNetwork,
    private readonly reg: BuildingRegistry,
    private readonly rand: () => number,
  ) {}

  /**
   * Regionen der Farblinien – angelehnt an die Pendlerströme von La Paz:
   * Wohnen an den Hängen und in El Alto, Märkte im Tal (Centro, Zona Sur),
   * später auch Gegenverkehr hinauf zur Feria nach El Alto.
   */
  regionFor(color: ColorId): ColorRegion {
    const { topo } = this;
    const riverAt = (v: number) => topo.river[Math.round(clamp(v, 0, 1) * (topo.river.length - 1))].x / topo.width;
    const elAltoU = 0.07;
    const jitter = () => (this.rand() - 0.5) * 0.08;
    const pt = (u: number, v: number): Vec2 => ({
      x: clamp(u + jitter(), 0.05, 0.95) * topo.width,
      y: clamp(v + jitter(), 0.08, 0.92) * topo.height,
    });
    const plans: [number, number, number, number][] = [
      // [house u, house v, market u, market v]
      [riverAt(0.32) + 0.13, 0.32, riverAt(0.45) - 0.03, 0.45], // Miraflores → Centro
      [elAltoU, 0.42, riverAt(0.58) - 0.02, 0.58], // El Alto → Prado
      [riverAt(0.75) - 0.15, 0.72, riverAt(0.88) - 0.02, 0.86], // Laderas → Zona Sur
      [riverAt(0.85) + 0.1, 0.84, elAltoU + 0.02, 0.24], // Zona Sur → Feria El Alto
      [elAltoU, 0.82, riverAt(0.25) + 0.1, 0.2], // El Alto Süd → Villa Fátima
    ];
    const [hu, hv, mu, mv] = plans[color % plans.length];
    return { houseCenter: pt(hu, hv), marketCenter: pt(mu, mv) };
  }

  /** Versucht eine Garage nahe `center` zu platzieren. */
  findHouseSite(center: Vec2, spread = 4): { entrance: NodeId; driveway: NodeId } | null {
    for (let attempt = 0; attempt < 80; attempt++) {
      const sigma = spread + attempt * 0.08;
      const c = this.gaussianCell(center, sigma);
      if (!this.cellFree(c, 1)) continue;
      const entrance = this.net.id(c.cx, c.cy);
      if (this.topo.terrainGradeAt((c.cx + 0.5) * CELL_SIZE, (c.cy + 0.5) * CELL_SIZE) > 0.35) continue;
      const driveway = this.bestDriveway(entrance, [c]);
      if (driveway !== null) return { entrance, driveway };
    }
    return null;
  }

  /** Versucht einen 2×2-Markt nahe `center` zu platzieren. */
  findMarketSite(center: Vec2, spread = 3): { origin: Cell; cells: NodeId[]; entrance: NodeId; driveway: NodeId } | null {
    for (let attempt = 0; attempt < 120; attempt++) {
      const sigma = spread + attempt * 0.06;
      const o = this.gaussianCell(center, sigma);
      const fp = [o, { cx: o.cx + 1, cy: o.cy }, { cx: o.cx, cy: o.cy + 1 }, { cx: o.cx + 1, cy: o.cy + 1 }];
      if (!fp.every((c) => this.cellFree(c, 1))) continue;
      const heights = fp.map((c) => this.topo.metersAt((c.cx + 0.5) * CELL_SIZE, (c.cy + 0.5) * CELL_SIZE));
      if (Math.max(...heights) - Math.min(...heights) > MARKET_MAX_RELIEF_M) continue;
      // Eingang: die Zelle mit der am besten anschließbaren Zufahrt
      let best: { entrance: NodeId; driveway: NodeId; g: number } | null = null;
      for (const c of fp) {
        const entrance = this.net.id(c.cx, c.cy);
        const driveway = this.bestDriveway(entrance, fp);
        if (driveway === null) continue;
        const g = Math.abs(segmentGrade(this.topo, this.net, entrance, driveway));
        if (!best || g < best.g) best = { entrance, driveway, g };
      }
      if (best) {
        return { origin: o, cells: fp.map((c) => this.net.id(c.cx, c.cy)), entrance: best.entrance, driveway: best.driveway };
      }
    }
    return null;
  }

  /** Zelle frei für ein Gebäude? (im Rand, keine Straße, kein Gebäude, keine fremde Zufahrt, nicht im Fluss) */
  private cellFree(c: Cell, margin: number): boolean {
    const { net, reg } = this;
    if (c.cx < margin || c.cy < margin || c.cx >= net.cols - margin || c.cy >= net.rows - margin) return false;
    const id = net.id(c.cx, c.cy);
    if (net.hasNode(id) || reg.isOccupied(id) || reg.isDriveway(id) || net.isUnderViaduct(id)) return false;
    return this.riverDistance({ x: (c.cx + 0.5) * CELL_SIZE, y: (c.cy + 0.5) * CELL_SIZE }) > RIVER_CLEARANCE;
  }

  /** Beste orthogonale Zufahrt (flachste anschließbare, mit Weiterbau-Möglichkeit). */
  private bestDriveway(entrance: NodeId, footprint: Cell[]): NodeId | null {
    const { net, reg, topo } = this;
    const e = net.cellOf(entrance);
    let best: NodeId | null = null;
    let bestG = Infinity;
    for (const d of ORTHO) {
      const c = { cx: e.cx + d.cx, cy: e.cy + d.cy };
      if (!net.inBounds(c) || footprint.some((f) => f.cx === c.cx && f.cy === c.cy)) continue;
      const id = net.id(c.cx, c.cy);
      if (reg.isOccupied(id)) continue;
      const g = Math.abs(segmentGrade(topo, net, entrance, id));
      if (g > MAX_ALLOWED_SLOPE * 0.9 || g >= bestG) continue;
      if (!this.hasOnwardStep(id, entrance)) continue;
      best = id;
      bestG = g;
    }
    return best;
  }

  /** Kann von der Zufahrt aus noch irgendwohin weitergebaut werden? */
  private hasOnwardStep(from: NodeId, except: NodeId): boolean {
    const { net, reg, topo } = this;
    const c = net.cellOf(from);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { cx: c.cx + dx, cy: c.cy + dy };
        if ((!dx && !dy) || !net.inBounds(n)) continue;
        const id = net.id(n.cx, n.cy);
        if (id === except || reg.isOccupied(id)) continue;
        if (Math.abs(segmentGrade(topo, net, from, id)) <= MAX_ALLOWED_SLOPE) return true;
      }
    }
    return false;
  }

  private gaussianCell(center: Vec2, sigmaCells: number): Cell {
    // Box-Muller
    const r = Math.sqrt(-2 * Math.log(1 - this.rand())) * sigmaCells * CELL_SIZE;
    const a = this.rand() * Math.PI * 2;
    return {
      cx: Math.floor((center.x + Math.cos(a) * r) / CELL_SIZE),
      cy: Math.floor((center.y + Math.sin(a) * r) / CELL_SIZE),
    };
  }

  private riverDistance(p: Vec2): number {
    const river = this.topo.river;
    let best = Infinity;
    for (let i = 0; i < river.length - 1; i++) {
      const a = river[i];
      const b = river[i + 1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy), 0, 1);
      best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)));
    }
    return best;
  }
}
