import type { RoadNetwork } from '../roads/RoadNetwork';
import type { RoadTool } from '../roads/RoadTool';
import type { Simulation } from '../sim/Simulation';
import type { Topography } from '../terrain/Topography';
import type { Camera } from './Camera';
import { COLORS } from './palette';
import { RoadRenderer } from './RoadRenderer';
import { SimRenderer } from './SimRenderer';
import { TerrainRenderer } from './TerrainRenderer';

export interface RenderState {
  hoverCell: { cx: number; cy: number } | null;
  /** Vorschau beim Platzieren eines Kreuzungs-Upgrades. */
  placement?: { node: number; ok: boolean } | null;
}

/** Haupt-Renderer: verwaltet das Canvas (HiDPI) und zeichnet die Szene in Ebenen. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainRenderer;
  readonly roads: RoadRenderer;
  readonly simRenderer: SimRenderer;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private topo: Topography,
    private readonly camera: Camera,
    net: RoadNetwork,
    private readonly tool: RoadTool,
    sim: Simulation,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = new TerrainRenderer(topo);
    this.roads = new RoadRenderer(net, topo, sim.buildings);
    this.simRenderer = new SimRenderer(net, sim);
  }

  setWorld(topo: Topography, sim: Simulation): void {
    this.topo = topo;
    this.terrain = new TerrainRenderer(topo);
    this.roads.setTopography(topo);
    this.roads.rules = sim.buildings;
    this.simRenderer.sim = sim;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.camera.setViewport(w, h);
  }

  render(state: RenderState): void {
    const { ctx, camera, topo } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    camera.apply(ctx, this.dpr);

    // Weicher Schatten unter der Karte (Mini-Motorways-"Spielbrett"-Look)
    ctx.save();
    ctx.shadowColor = 'rgba(70, 50, 30, 0.18)';
    ctx.shadowBlur = 24 * camera.zoom * this.dpr;
    ctx.shadowOffsetY = 6 * camera.zoom * this.dpr;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, topo.width, topo.height);
    ctx.restore();

    this.terrain.draw(ctx, camera.zoom);
    this.drawGrid();
    if (state.hoverCell && !this.tool.isActive) this.drawHoverCell(state.hoverCell.cx, state.hoverCell.cy);
    this.roads.draw(ctx, camera.zoom);
    this.simRenderer.draw(ctx, camera.zoom);
    this.roads.drawPreview(ctx, this.tool, camera.zoom);
    if (state.placement) this.roads.drawPlacement(ctx, state.placement.node, state.placement.ok);

    ctx.strokeStyle = COLORS.mapEdge;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeRect(0, 0, topo.width, topo.height);
  }

  /** Dezentes Spielgitter, blendet bei kleinem Zoom aus. */
  private drawGrid(): void {
    const { ctx, camera, topo } = this;
    const alpha = Math.min(1, Math.max(0, (camera.zoom - 0.6) / 0.6));
    if (alpha <= 0) return;
    const b = camera.visibleBounds();
    const s = topo.cellSize;
    const cx0 = Math.max(0, Math.floor(b.x0 / s));
    const cx1 = Math.min(topo.cols, Math.ceil(b.x1 / s));
    const cy0 = Math.max(0, Math.floor(b.y0 / s));
    const cy1 = Math.min(topo.rows, Math.ceil(b.y1 / s));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    for (let x = cx0; x <= cx1; x++) {
      ctx.moveTo(x * s, cy0 * s);
      ctx.lineTo(x * s, cy1 * s);
    }
    for (let y = cy0; y <= cy1; y++) {
      ctx.moveTo(cx0 * s, y * s);
      ctx.lineTo(cx1 * s, y * s);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawHoverCell(cx: number, cy: number): void {
    const { ctx, camera, topo } = this;
    const s = topo.cellSize;
    const inset = 3;
    ctx.strokeStyle = COLORS.hoverCell;
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.beginPath();
    ctx.roundRect(cx * s + inset, cy * s + inset, s - inset * 2, s - inset * 2, 6);
    ctx.stroke();
  }
}
