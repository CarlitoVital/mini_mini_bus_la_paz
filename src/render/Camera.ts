import { ZOOM_MAX, ZOOM_MIN } from '../config';
import { clamp, type Vec2 } from '../core/math';

/**
 * 2D-Kamera mit Pan & Zoom. (x, y) ist der Weltpunkt in der Bildschirmmitte,
 * zoom ist der Faktor Bildschirmpixel (CSS px) pro World Unit.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewWidth = 1;
  viewHeight = 1;

  constructor(
    private readonly worldWidth: number,
    private readonly worldHeight: number,
  ) {}

  setViewport(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
    this.clampPosition();
  }

  /** Zoom so wählen, dass die ganze Karte (mit Rand) sichtbar ist. */
  fitWorld(margin = 40): void {
    const zx = (this.viewWidth - margin * 2) / this.worldWidth;
    const zy = (this.viewHeight - margin * 2) / this.worldHeight;
    this.zoom = clamp(Math.min(zx, zy), ZOOM_MIN, ZOOM_MAX);
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.viewWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewHeight / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: (wx - this.x) * this.zoom + this.viewWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  /** Verschiebung um einen Bildschirm-Delta (z. B. Maus-Drag). */
  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampPosition();
  }

  /** Zoom um einen Faktor, wobei der Weltpunkt unter (sx, sy) fix bleibt. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampPosition();
  }

  /** Kamera-Transformation auf einen Context anwenden (dpr = devicePixelRatio). */
  apply(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(
      this.zoom * dpr,
      0,
      0,
      this.zoom * dpr,
      (this.viewWidth / 2 - this.x * this.zoom) * dpr,
      (this.viewHeight / 2 - this.y * this.zoom) * dpr,
    );
  }

  /** Sichtbarer Weltausschnitt. */
  visibleBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.viewWidth, this.viewHeight);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  /** Mittelpunkt bleibt innerhalb der Karte, damit man sich nicht "verliert". */
  private clampPosition(): void {
    this.x = clamp(this.x, 0, this.worldWidth);
    this.y = clamp(this.y, 0, this.worldHeight);
  }
}
