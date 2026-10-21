import type { Cell, NodeId, RoadNetwork } from '../roads/RoadNetwork';
import type { BuildRejection } from '../roads/RoadRules';

/** Farbindex einer Linie (Haus- und Marktfarbe müssen übereinstimmen). */
export type ColorId = number;

export interface BuildingBase {
  id: number;
  color: ColorId;
  /** Zelle, über die der Bus ein- und ausfährt (Knoten im Straßengraph). */
  entrance: NodeId;
  /** Nachbarzelle, von der aus die Zufahrt angeschlossen werden muss. */
  driveway: NodeId;
  /** Alle belegten Zellen. */
  cells: NodeId[];
  /** Spielzeit der Entstehung (für Einblend-Animation). */
  bornAt: number;
}

/** Garage / Haltestelle im Wohnviertel – Heimat der Minibusse. */
export interface House extends BuildingBase {
  kind: 'house';
  /** Anzahl Busse, die gerade in der Garage stehen. */
  parked: number;
}

/** Markt / Station – erzeugt Nachfrage-Pins (wartende Passagiere). */
export interface Market extends BuildingBase {
  kind: 'market';
  /** Wartende Passagiere. */
  pins: number;
  /** Davon bereits einem anfahrenden Bus zugeteilt. */
  claimed: number;
  /** Sekunden bis zum nächsten Pin. */
  pinTimer: number;
  /** Überlastungs-Timer 0..1 (1 = Überlauf). */
  overload: number;
  /** Ecke oben links der 2×2-Fläche. */
  origin: Cell;
}

export type Building = House | Market;

/**
 * Register aller Gebäude mit Zellbelegung. Liefert die Anschlussregel für den
 * Straßenbau: Gebäudezellen sind tabu, nur der Eingang darf – und zwar ausschließlich
 * von seiner Zufahrtszelle aus – angeschlossen werden.
 */
export class BuildingRegistry {
  readonly houses: House[] = [];
  readonly markets: Market[] = [];
  private readonly occupancy = new Map<NodeId, Building>();
  private readonly driveways = new Set<NodeId>();
  private nextId = 1;

  get all(): Building[] {
    return [...this.houses, ...this.markets];
  }

  at(node: NodeId): Building | undefined {
    return this.occupancy.get(node);
  }

  isOccupied(node: NodeId): boolean {
    return this.occupancy.has(node);
  }

  isDriveway(node: NodeId): boolean {
    return this.driveways.has(node);
  }

  addHouse(color: ColorId, entrance: NodeId, driveway: NodeId, parked: number, time: number): House {
    const h: House = { kind: 'house', id: this.nextId++, color, entrance, driveway, cells: [entrance], parked, bornAt: time };
    this.houses.push(h);
    this.register(h);
    return h;
  }

  addMarket(color: ColorId, origin: Cell, cells: NodeId[], entrance: NodeId, driveway: NodeId, time: number): Market {
    const m: Market = {
      kind: 'market',
      id: this.nextId++,
      color,
      origin,
      entrance,
      driveway,
      cells,
      bornAt: time,
      pins: 0,
      claimed: 0,
      pinTimer: 3,
      overload: 0,
    };
    this.markets.push(m);
    this.register(m);
    return m;
  }

  /**
   * Anschlussregel für ein Straßensegment a–b; null = erlaubt.
   * Wird von RoadRules.checkSegment abgefragt.
   */
  connectionRule(a: NodeId, b: NodeId): BuildRejection | null {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const bld = this.occupancy.get(x);
      if (!bld) continue;
      if (x !== bld.entrance) return 'building';
      if (y !== bld.driveway) return 'wrong-side';
    }
    return null;
  }

  clear(): void {
    this.houses.length = 0;
    this.markets.length = 0;
    this.occupancy.clear();
    this.driveways.clear();
  }

  /** Entfernt Straßen, die nach dem Platzieren gegen die Anschlussregel verstoßen würden. */
  enforceOn(net: RoadNetwork, b: Building): void {
    for (const c of b.cells) {
      for (const n of [...net.neighbors(c)]) {
        if (this.connectionRule(c, n)) net.removeEdge(c, n);
      }
    }
  }

  private register(b: Building): void {
    for (const c of b.cells) this.occupancy.set(c, b);
    this.driveways.add(b.driveway);
  }
}
