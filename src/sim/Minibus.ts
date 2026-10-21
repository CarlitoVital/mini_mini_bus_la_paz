import {
  BOARDING_TIME_PER_PIN,
  BUS_ACCEL,
  BUS_BASE_SPEED,
  BUS_BRAKE,
  BUS_LENGTH,
  LANE_OFFSET,
  ROUNDABOUT_SPEED_FACTOR,
} from '../config';
import type { NodeId } from '../roads/RoadNetwork';
import type { ColorId, House, Market } from './Buildings';
import { gradeSpeedFactor } from './physics';
import type { Route } from './Route';

export type BusState = 'parked' | 'toMarket' | 'loading' | 'toHome' | 'unloading' | 'lost';

/** Mindestabstand Mittelpunkt–Mittelpunkt zum Vordermann. */
export const MIN_GAP = BUS_LENGTH + 3;
/** Sichtweite der Abstandsregelung. */
export const FOLLOW_LOOKAHEAD = 48;
/** Radius, in dem eine Kreuzung als "belegt" gilt. */
export const JUNCTION_RADIUS = 13;
/** Nach so vielen Sekunden Warten an einer Kreuzung wird die Reservierung ignoriert (Deadlock-Schutz). */
const JUNCTION_PATIENCE_S = 3;
/** Wie weit vorausschauend auf Kurven gebremst wird (WU). */
const CURVE_LOOKAHEAD = 14;

/** Was ein Bus pro Tick von der Simulation braucht. */
export interface BusContext {
  /** Abstand (entlang der eigenen Fahrtrichtung) zum nächsten Bus voraus, oder Infinity. */
  leaderGap(bus: Minibus): { gap: number; speed: number };
  /** Kreuzungsgrad eines Knotens. */
  degree(node: NodeId): number;
  /** Kreuzungs-Upgrade (Kreisverkehr / Ampel) an einem Knoten. */
  junctionKind(node: NodeId): 'roundabout' | 'light' | undefined;
  /** Hat die Zufahrt from → node an einer Ampel gerade Grün? */
  lightGreen(node: NodeId, from: NodeId): boolean;
  junctionOwner(node: NodeId): Minibus | undefined;
  setJunctionOwner(node: NodeId, bus: Minibus | undefined): void;
  /** Wird aufgerufen, sobald ein Bus das Ende seiner Route erreicht. */
  arrived(bus: Minibus): void;
  /** Ein Passagier steigt in der Garage aus. */
  delivered(bus: Minibus): void;
  /** Ein Passagier steigt am Markt ein. */
  boarded(bus: Minibus): void;
  /** Ein- bzw. Ausstieg beendet. */
  serviceDone(bus: Minibus): void;
  /** Bus ist nach dem "Verirren" zurück in der Garage. */
  recovered(bus: Minibus): void;
}

let nextBusId = 1;

/**
 * Ein La-Paz-Minibus (Trufi). Lebenszyklus:
 * parked → toMarket → loading → toHome → unloading → parked
 * (bei abgerissener Straße: lost → nach kurzer Ausblendung zurück in der Garage).
 */
export class Minibus {
  readonly id = nextBusId++;
  state: BusState = 'parked';
  route: Route | null = null;
  /** Bogenlänge auf der Route. */
  s = 0;
  speed = 0;
  /** Zielmarkt der aktuellen Tour. */
  market: Market | null = null;
  /** Für diese Tour reservierte Pins am Markt. */
  claimed = 0;
  passengers = 0;
  /** Timer für Ein-/Ausstieg bzw. Ausblenden. */
  timer = 0;
  /** Darstellung (Fahrspur-versetzt). */
  x = 0;
  y = 0;
  angle = 0;
  alpha = 1;
  /** Aktuelle Steigung in Fahrtrichtung (für Debug/Tooltip). */
  grade = 0;
  private junctionWait = 0;
  private readonly heldJunctions = new Set<NodeId>();

  constructor(
    readonly color: ColorId,
    readonly home: House,
  ) {}

  get isMoving(): boolean {
    return this.state === 'toMarket' || this.state === 'toHome';
  }

  get isOnRoad(): boolean {
    return this.state !== 'parked';
  }

  /** Neue Route zuweisen (Fahrt beginnt am Anfang oder an Position s). */
  setRoute(route: Route, state: 'toMarket' | 'toHome', s = 0): void {
    this.route = route;
    this.state = state;
    this.s = s;
    this.updatePose(1);
  }

  update(dt: number, ctx: BusContext): void {
    switch (this.state) {
      case 'parked':
        return;
      case 'loading':
      case 'unloading':
        this.service(dt, ctx);
        return;
      case 'lost':
        this.timer -= dt;
        this.alpha = Math.max(0, this.timer);
        if (this.timer <= 0) ctx.recovered(this);
        return;
      default:
        this.drive(dt, ctx);
    }
  }

  /** Ein-/Ausstieg: alle BOARDING_TIME_PER_PIN Sekunden ein Passagier. */
  private service(dt: number, ctx: BusContext): void {
    this.speed = 0;
    this.timer -= dt;
    while (this.timer <= 0) {
      if (this.state === 'loading') {
        if (this.passengers >= this.claimed) return ctx.serviceDone(this);
        this.passengers++;
        ctx.boarded(this);
      } else {
        if (this.passengers <= 0) return ctx.serviceDone(this);
        this.passengers--;
        ctx.delivered(this);
      }
      this.timer += BOARDING_TIME_PER_PIN;
    }
  }

  private drive(dt: number, ctx: BusContext): void {
    const route = this.route!;
    const len = route.length;

    // 1) Neigung: bergauf drastisch langsamer, bergab leicht schneller
    this.grade = route.gradeAt(this.s);
    let target = BUS_BASE_SPEED * gradeSpeedFactor(this.grade);

    // 2) Kurvenradien deckeln die Geschwindigkeit (auch den Bergab-Bonus)
    const curve = Math.min(route.curveAt(this.s), route.curveAt(this.s + CURVE_LOOKAHEAD / 2), route.curveAt(this.s + CURVE_LOOKAHEAD));
    target = Math.min(target, BUS_BASE_SPEED * curve);

    // 3) Am Routenende sanft anhalten
    target = Math.min(target, Math.sqrt(2 * BUS_BRAKE * 0.35 * Math.max(0, len - this.s)) + 4);

    // 4) Abstand zum Vordermann (Rückstau bei langsamen Bussen bergauf)
    const lead = ctx.leaderGap(this);
    if (lead.gap < Infinity) {
      const free = lead.gap - MIN_GAP;
      target = Math.min(target, free <= 0 ? 0 : lead.speed + free * 1.8);
    }

    // 5) Kreuzungen: nur ein Bus gleichzeitig im Knoten
    target = Math.min(target, this.junctionLimit(dt, ctx));

    // Beschleunigen (bergauf träger) bzw. bremsen
    if (this.speed < target) {
      const accel = BUS_ACCEL * (this.grade > 0 ? Math.max(0.3, 1 - this.grade * 4) : 1);
      this.speed = Math.min(target, this.speed + accel * dt);
    } else {
      this.speed = Math.max(target, this.speed - BUS_BRAKE * dt);
    }

    this.s = Math.min(len, this.s + this.speed * dt);
    this.updatePose(dt);

    if (this.s >= len - 0.01) {
      this.releaseJunctions(ctx);
      this.speed = 0;
      ctx.arrived(this);
    }
  }

  /** Geschwindigkeitslimit durch belegte Kreuzungen vor dem Bus; verwaltet Reservierungen. */
  private junctionLimit(dt: number, ctx: BusContext): number {
    const route = this.route!;
    let limit = Infinity;
    let waiting = false;
    for (let i = 1; i < route.nodes.length - 1; i++) {
      const node = route.nodes[i];
      const at = route.nodeS[i];
      if (at > this.s + JUNCTION_RADIUS + 20) break;
      if (this.heldJunctions.has(node)) {
        if (this.s > at + JUNCTION_RADIUS) {
          if (ctx.junctionOwner(node) === this) ctx.setJunctionOwner(node, undefined);
          this.heldJunctions.delete(node);
        }
        continue;
      }
      if (this.s > at + JUNCTION_RADIUS || ctx.degree(node) < 3) continue;
      const entry = at - JUNCTION_RADIUS;
      if (this.s < entry - 20) continue;
      const kind = ctx.junctionKind(node);
      if (kind === 'roundabout') {
        // Kreisverkehr: keine Reservierung, alle fahren gleichzeitig – aber langsam
        if (this.s >= entry - 8) limit = Math.min(limit, BUS_BASE_SPEED * ROUNDABOUT_SPEED_FACTOR);
      } else if (kind === 'light') {
        // Ampel: bei Rot vor der Haltelinie warten; einmal drin, wird durchgefahren
        if (this.s < entry - 1 && !ctx.lightGreen(node, route.nodes[i - 1])) {
          limit = Math.min(limit, Math.max(0, (entry - 1 - this.s) * 2.5));
        }
      } else {
        const owner = ctx.junctionOwner(node);
        if (!owner || owner === this || !owner.isOnRoad || this.junctionWait > JUNCTION_PATIENCE_S) {
          if (this.s >= entry - 2) {
            ctx.setJunctionOwner(node, this);
            this.heldJunctions.add(node);
          }
        } else {
          waiting = true;
          limit = Math.min(limit, Math.max(0, (entry - this.s) * 2.5));
        }
      }
      break; // nur die nächste Kreuzung zählt
    }
    this.junctionWait = waiting && this.speed < 1 ? this.junctionWait + dt : 0;
    return limit;
  }

  releaseJunctions(ctx: BusContext): void {
    for (const n of this.heldJunctions) if (ctx.junctionOwner(n) === this) ctx.setJunctionOwner(n, undefined);
    this.heldJunctions.clear();
    this.junctionWait = 0;
  }

  /** Position/Ausrichtung inkl. Fahrspur-Versatz nach rechts (Rechtsverkehr). */
  updatePose(dt: number): void {
    const route = this.route;
    if (!route) return;
    const p = route.sample(this.s);
    // An Routenenden (Garage, Markt) auf die Mittellinie einschwenken – weiche Wende.
    const fade = Math.min(1, this.s / 10, (route.length - this.s) / 10);
    const off = LANE_OFFSET * Math.max(0, fade);
    this.x = p.x - Math.sin(p.angle) * off;
    this.y = p.y + Math.cos(p.angle) * off;
    let d = p.angle - this.angle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.angle += d * Math.min(1, dt * 14);
  }
}
