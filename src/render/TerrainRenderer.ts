import { CONTOUR_INDEX_EVERY, CONTOUR_INTERVAL_M, ELEVATION_MAX_M, ELEVATION_MIN_M, metersToElevation } from '../config';
import type { Vec2 } from '../core/math';
import { chaikin, extractContours } from '../terrain/contours';
import type { Topography } from '../terrain/Topography';
import { COLORS, bandColor } from './palette';

interface ContourLabel {
  x: number;
  y: number;
  angle: number;
  text: string;
}

const LABEL_SPACING_WU = 720;
const LABEL_EDGE_MARGIN_WU = 60;

/**
 * Vorberechnete Geländedarstellung:
 *  - Bitmap mit gestuften Höhenfarben (+ dezentes Hillshading)
 *  - Höhenlinien als Vektorpfade (gestochen scharf bei jedem Zoom)
 *  - Beschriftung der Zähllinien, Flusslauf des Río Choqueyapu
 */
export class TerrainRenderer {
  private readonly bitmap: HTMLCanvasElement;
  private readonly contourPath = new Path2D();
  private readonly indexContourPath = new Path2D();
  private readonly labels: ContourLabel[] = [];
  private readonly riverPath = new Path2D();
  private readonly passMarkers: Vec2[] = [];

  constructor(private readonly topo: Topography) {
    this.bitmap = this.buildBitmap();
    this.buildContours();
    this.buildRiver();
    this.buildPassMarkers();
  }

  /** Position jeder Rampa: dort, wo die Höhe westlich des Tals unter das Plateauniveau fällt. */
  private buildPassMarkers(): void {
    const { topo } = this;
    for (const y of topo.passY) {
      if (y < LABEL_EDGE_MARGIN_WU || y > topo.height - LABEL_EDGE_MARGIN_WU) continue;
      const plateau = topo.metersAt(topo.cellSize, y);
      for (let x = topo.cellSize; x < topo.width / 2; x += 4) {
        if (topo.metersAt(x, y) < plateau - 90) {
          this.passMarkers.push({ x, y });
          break;
        }
      }
    }
  }

  private buildBitmap(): HTMLCanvasElement {
    const { topo } = this;
    const w = topo.width;
    const h = topo.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const span = ELEVATION_MAX_M - ELEVATION_MIN_M;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = topo.elevationAt(x + 0.5, y + 0.5);
        const [r, g, b] = bandColor(ELEVATION_MIN_M + e * span);
        // Hillshading mit Licht aus Nordwesten, sehr zurückhaltend.
        const dzdx = topo.elevationAt(x + 2.5, y + 0.5) - topo.elevationAt(x - 1.5, y + 0.5);
        const dzdy = topo.elevationAt(x + 0.5, y + 2.5) - topo.elevationAt(x + 0.5, y - 1.5);
        const shade = Math.max(-0.06, Math.min(0.035, (-dzdx - dzdy) * 5));
        const f = 1 + shade;
        const i = (y * w + x) * 4;
        data[i] = r * f;
        data[i + 1] = g * f;
        data[i + 2] = b * f;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private buildContours(): void {
    const { topo } = this;
    const s = topo.sampleSpacing;
    const first = Math.ceil(ELEVATION_MIN_M / CONTOUR_INTERVAL_M) * CONTOUR_INTERVAL_M;

    for (let m = first; m <= ELEVATION_MAX_M; m += CONTOUR_INTERVAL_M) {
      const isIndex = (m / CONTOUR_INTERVAL_M) % CONTOUR_INDEX_EVERY === 0;
      const contours = extractContours(topo.heights, topo.sw, topo.sh, metersToElevation(m));
      for (const c of contours) {
        if (c.points.length < 4) continue; // Mini-Fragmente (Rauschen) weglassen
        const pts = chaikin(c.points, c.closed, 2).map((p) => ({ x: p.x * s, y: p.y * s }));
        const path = isIndex ? this.indexContourPath : this.contourPath;
        path.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
        if (c.closed) path.closePath();
        if (isIndex) this.placeLabels(pts, `${m.toLocaleString('de-DE')} m`);
      }
    }
  }

  /** Beschriftungen in regelmäßigen Abständen entlang einer Zähllinie. */
  private placeLabels(pts: Vec2[], text: string): void {
    const { width, height } = this.topo;
    let acc = LABEL_SPACING_WU * 0.4;
    for (let i = 1; i < pts.length - 1; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc < LABEL_SPACING_WU) continue;
      const p = pts[i];
      if (p.x < LABEL_EDGE_MARGIN_WU || p.y < LABEL_EDGE_MARGIN_WU) continue;
      if (p.x > width - LABEL_EDGE_MARGIN_WU || p.y > height - LABEL_EDGE_MARGIN_WU) continue;
      const a = pts[i - 1];
      const b = pts[i + 1];
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      // Text immer "aufrecht" lesbar halten.
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      this.labels.push({ x: p.x, y: p.y, angle, text });
      acc = 0;
    }
  }

  private buildRiver(): void {
    const pts = chaikin(this.topo.river, false, 3);
    this.riverPath.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) this.riverPath.lineTo(pts[i].x, pts[i].y);
  }

  /** Zeichnet das Gelände. Erwartet, dass die Kamera-Transformation bereits gesetzt ist. */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    const { topo } = this;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bitmap, 0, 0, topo.width, topo.height);

    // Höhenlinien – Linienbreite in Bildschirmpixeln konstant halten.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.contour;
    ctx.lineWidth = 1 / zoom;
    ctx.stroke(this.contourPath);
    ctx.strokeStyle = COLORS.contourIndex;
    ctx.lineWidth = 1.6 / zoom;
    ctx.stroke(this.indexContourPath);

    // Río Choqueyapu
    ctx.strokeStyle = COLORS.riverBank;
    ctx.lineWidth = 14;
    ctx.stroke(this.riverPath);
    ctx.strokeStyle = COLORS.river;
    ctx.lineWidth = 6;
    ctx.stroke(this.riverPath);

    if (zoom > 0.45) this.drawLabels(ctx, zoom);
    this.drawPassMarkers(ctx, zoom);
  }

  /** Dezente Markierung "Rampa" an den Pässen durch die Ceja. */
  private drawPassMarkers(ctx: CanvasRenderingContext2D, zoom: number): void {
    const fontPx = 11 / Math.min(zoom, 1.4);
    ctx.font = `700 ${fontPx}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.passMarkers) {
      ctx.lineWidth = 3.5 / Math.min(zoom, 1.4);
      ctx.strokeStyle = 'rgba(246, 241, 230, 0.9)';
      ctx.fillStyle = COLORS.pass;
      ctx.strokeText('⟋ Rampa', p.x, p.y - fontPx * 1.2);
      ctx.fillText('⟋ Rampa', p.x, p.y - fontPx * 1.2);
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, zoom: number): void {
    const fontPx = 10.5 / zoom;
    ctx.font = `600 ${fontPx}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5 / zoom;
    ctx.strokeStyle = 'rgba(246, 241, 230, 0.9)';
    ctx.fillStyle = COLORS.contourLabel;
    for (const l of this.labels) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.angle);
      ctx.strokeText(l.text, 0, 0);
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }
}
