import { BUS_CAPACITY, BUS_LENGTH, BUS_WIDTH, CELL_SIZE, MARKET_MAX_PINS } from '../config';
import type { Vec2 } from '../core/math';
import type { RoadNetwork } from '../roads/RoadNetwork';
import type { Building, House, Market } from '../sim/Buildings';
import type { Minibus } from '../sim/Minibus';
import type { Simulation } from '../sim/Simulation';
import { COLORS, LINE_COLORS, shade, tint } from './palette';

const ROAD_WIDTH = CELL_SIZE * 0.42;
const POP_IN_S = 0.45;

/** "Ease out back" für die Einblend-Animation neuer Gebäude. */
function popScale(age: number): number {
  const t = Math.min(1, Math.max(0, age / POP_IN_S));
  const c = 1.7;
  return Math.max(0, 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2));
}

/** Zeichnet Garagen, Märkte (inkl. Pins & Überlastungs-Timer) und Minibusse. */
export class SimRenderer {
  constructor(
    private readonly net: RoadNetwork,
    public sim: Simulation,
  ) {}

  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    const { sim } = this;
    for (const b of sim.buildings.all) this.drawDriveway(ctx, b);
    for (const m of sim.buildings.markets) this.drawMarket(ctx, m);
    for (const h of sim.buildings.houses) this.drawHouse(ctx, h);
    for (const bus of sim.buses) if (bus.isOnRoad) this.drawBus(ctx, bus);
    for (const m of sim.buildings.markets) if (m.overload > 0) this.drawOverload(ctx, m, zoom);
  }

  /** Kurzes Straßenstück vom Eingang zur Zufahrtsseite – zeigt, wo angeschlossen wird. */
  private drawDriveway(ctx: CanvasRenderingContext2D, b: Building): void {
    const e = this.net.centerOf(b.entrance);
    const d = this.net.centerOf(b.driveway);
    const edge = { x: (e.x + d.x) / 2, y: (e.y + d.y) / 2 };
    ctx.lineCap = 'butt';
    ctx.strokeStyle = COLORS.roadCasing;
    ctx.lineWidth = ROAD_WIDTH + 4;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(edge.x, edge.y);
    ctx.stroke();
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = ROAD_WIDTH;
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  private drawHouse(ctx: CanvasRenderingContext2D, h: House): void {
    const color = LINE_COLORS[h.color % LINE_COLORS.length];
    const e = this.net.centerOf(h.entrance);
    const d = this.net.centerOf(h.driveway);
    const dir = { x: Math.sign(d.x - e.x), y: Math.sign(d.y - e.y) };
    const k = popScale(this.sim.time - h.bornAt);
    const size = 21 * k;
    // Haus etwas von der Zufahrt weg versetzt, damit der Stummel sichtbar bleibt
    const cx = e.x - dir.x * 3;
    const cy = e.y - dir.y * 3;

    ctx.save();
    ctx.shadowColor = 'rgba(60, 40, 20, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 5 * k);
    ctx.fill();
    ctx.restore();

    // Garagentor zur Zufahrtsseite
    ctx.fillStyle = tint(color, 0.55);
    const door = { w: 11 * k, h: 4 * k };
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    ctx.fillRect(size / 2 - door.h - 1.5 * k, -door.w / 2, door.h, door.w);
    ctx.restore();

    // Geparkte Busse als Punkte, quer zur Zufahrt aufgereiht
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const perp = { x: -dir.y, y: dir.x };
    for (let i = 0; i < h.parked; i++) {
      const o = (i - (h.parked - 1) / 2) * 5 * k;
      ctx.beginPath();
      ctx.arc(cx - dir.x * 3 * k + perp.x * o, cy - dir.y * 3 * k + perp.y * o, 1.7 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawMarket(ctx: CanvasRenderingContext2D, m: Market): void {
    const color = LINE_COLORS[m.color % LINE_COLORS.length];
    const k = popScale(this.sim.time - m.bornAt);
    const x0 = m.origin.cx * CELL_SIZE;
    const y0 = m.origin.cy * CELL_SIZE;
    const size = 2 * CELL_SIZE;
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const s = (size - 8) * k;

    ctx.save();
    ctx.shadowColor = 'rgba(60, 40, 20, 0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = tint(color, 0.72);
    ctx.beginPath();
    ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 9 * k);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Markise (gestreiftes Vordach) oben – typischer Markt-Look
    const awningH = 7 * k;
    const stripes = 6;
    const sw = (s - 10 * k) / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? color : '#fffaf0';
      ctx.beginPath();
      ctx.roundRect(cx - s / 2 + 5 * k + i * sw, cy - s / 2 + 5 * k, sw, awningH, i === 0 ? [3, 0, 0, 3] : i === stripes - 1 ? [0, 3, 3, 0] : 0);
      ctx.fill();
    }

    // Pins: wartende Passagiere (hohl = bereits einem Bus zugeteilt)
    if (k < 0.95) return;
    const cols = 4;
    const gap = 11;
    const startX = cx - ((cols - 1) * gap) / 2;
    const startY = cy - 4;
    const shown = Math.min(m.pins, MARKET_MAX_PINS);
    for (let i = 0; i < shown; i++) {
      const px = startX + (i % cols) * gap;
      const py = startY + Math.floor(i / cols) * 10;
      this.drawPin(ctx, { x: px, y: py }, color, i >= shown - m.claimed);
    }
  }

  private drawPin(ctx: CanvasRenderingContext2D, p: Vec2, color: string, claimed: boolean): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y - 2, 3.4, Math.PI * 0.85, Math.PI * 0.15);
    ctx.lineTo(p.x, p.y + 3.6);
    ctx.closePath();
    if (claimed) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Runder Überlastungs-Timer an der Marktecke (pulsiert, wenn kritisch). */
  private drawOverload(ctx: CanvasRenderingContext2D, m: Market, zoom: number): void {
    const x = (m.origin.cx + 2) * CELL_SIZE - 4;
    const y = m.origin.cy * CELL_SIZE + 4;
    const pulse = m.overload > 0.6 ? 1 + 0.12 * Math.sin(this.sim.time * 10) : 1;
    const r = (9 / Math.min(1, zoom)) * pulse;
    ctx.save();
    ctx.shadowColor = 'rgba(60, 40, 20, 0.3)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = m.overload > 0.75 ? '#d9534f' : '#e5a530';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r * 0.78, -Math.PI / 2, -Math.PI / 2 + m.overload * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  private drawBus(ctx: CanvasRenderingContext2D, bus: Minibus): void {
    const color = LINE_COLORS[bus.color % LINE_COLORS.length];
    const L = BUS_LENGTH;
    const W = BUS_WIDTH;
    ctx.save();
    ctx.globalAlpha = bus.alpha;
    ctx.translate(bus.x, bus.y);
    ctx.rotate(bus.angle);

    // Schatten
    ctx.fillStyle = 'rgba(40, 25, 10, 0.22)';
    ctx.beginPath();
    ctx.roundRect(-L / 2 + 0.8, -W / 2 + 1.2, L, W, 2.4);
    ctx.fill();
    // Karosserie
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, 2.4);
    ctx.fill();
    // Weißer Zierstreifen an den Flanken (typisch für die Trufis)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(-L / 2 + 1, -W / 2 + 0.5, L - 3, 0.7);
    ctx.fillRect(-L / 2 + 1, W / 2 - 1.2, L - 3, 0.7);
    // Dachgepäckträger
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = 0.6;
    ctx.strokeRect(-L / 2 + 2, -W / 2 + 1.7, L - 5.6, W - 3.4);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = -L / 2 + 2 + ((L - 5.6) * i) / 4;
      ctx.moveTo(x, -W / 2 + 1.7);
      ctx.lineTo(x, W / 2 - 1.7);
    }
    ctx.stroke();
    // Windschutzscheibe vorne
    ctx.fillStyle = 'rgba(35, 40, 55, 0.65)';
    ctx.beginPath();
    ctx.roundRect(L / 2 - 2.8, -W / 2 + 1, 1.8, W - 2, 0.8);
    ctx.fill();
    // Fahrgäste als Punkte auf dem Dach
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < Math.min(bus.passengers, BUS_CAPACITY); i++) {
      ctx.beginPath();
      ctx.arc(-L / 2 + 2 + ((L - 5.6) * (i + 0.5)) / 4, 0, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Bus unter einem Weltpunkt (für den Tooltip). */
  busAt(p: Vec2, radius = 9): Minibus | null {
    let best: Minibus | null = null;
    let bestD = radius;
    for (const b of this.sim.buses) {
      if (!b.isOnRoad || b.state === 'lost') continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
