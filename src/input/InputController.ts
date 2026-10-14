import type { Vec2 } from '../core/math';
import type { Camera } from '../render/Camera';

const KEY_PAN_SPEED = 600; // Bildschirmpixel pro Sekunde
const WHEEL_ZOOM_STEP = 1.0015;

/**
 * Maus-/Tastatursteuerung der Kamera.
 *  - Mausrad: Zoom zum Cursor
 *  - Mittlere Maustaste ziehen (oder Leertaste + Linksklick): Pan
 *  - WASD / Pfeiltasten: Pan, +/-: Zoom
 * Links-/Rechtsklick sind für Straßenbau und Abriss (Phase 2) reserviert.
 */
export class InputController {
  /** Letzte Mausposition in Bildschirmkoordinaten (CSS px) oder null außerhalb. */
  pointer: Vec2 | null = null;

  private panning = false;
  private spaceHeld = false;
  private readonly keys = new Set<string>();
  private lastPan: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
  ) {
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.spaceHeld = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.spaceHeld = false;
      this.panning = false;
    });
  }

  /** Kontinuierliche Eingaben (Tastatur-Pan) pro Frame anwenden. */
  update(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (dx || dy) this.camera.panByScreen(-dx * KEY_PAN_SPEED * dt, -dy * KEY_PAN_SPEED * dt);
  }

  get isPanning(): boolean {
    return this.panning;
  }

  private localPos(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.localPos(e);
    // deltaMode 1 = Zeilen (Firefox), auf Pixel normieren
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.camera.zoomAt(Math.pow(WHEEL_ZOOM_STEP, -delta), p.x, p.y);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.panning = true;
      this.lastPan = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.panning) {
      this.camera.panByScreen(e.clientX - this.lastPan.x, e.clientY - this.lastPan.y);
      this.lastPan = { x: e.clientX, y: e.clientY };
    }
    if (e.target === this.canvas || this.panning) this.pointer = this.localPos(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.panning && (e.button === 1 || e.button === 0)) {
      this.panning = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.code);
    if (e.code === 'Space') {
      this.spaceHeld = true;
      e.preventDefault();
    }
    const cx = this.camera.viewWidth / 2;
    const cy = this.camera.viewHeight / 2;
    if (e.key === '+' || e.key === '=') this.camera.zoomAt(1.2, cx, cy);
    if (e.key === '-') this.camera.zoomAt(1 / 1.2, cx, cy);
  };
}
