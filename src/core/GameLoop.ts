/**
 * requestAnimationFrame-Loop mit festem Simulationsschritt (deterministisch für
 * spätere Fahrzeug-Simulation) und variablem Render-Takt.
 */
export class GameLoop {
  /** Fester Simulationsschritt in Sekunden. */
  static readonly STEP = 1 / 60;
  /** Simulationsgeschwindigkeit (0 = Pause, 1 = normal, 2 = schnell). */
  timeScale = 1;

  private running = false;
  private last = 0;
  private acc = 0;
  private rafId = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    // Lange Pausen (Tab im Hintergrund) nicht nachsimulieren.
    const frameDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;

    this.acc += frameDt * this.timeScale;
    while (this.acc >= GameLoop.STEP) {
      this.update(GameLoop.STEP);
      this.acc -= GameLoop.STEP;
    }
    this.render(frameDt);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
