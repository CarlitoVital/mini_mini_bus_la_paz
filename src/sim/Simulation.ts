import {
  BOARDING_TIME_PER_PIN,
  BUS_CAPACITY,
  BUSES_PER_HOUSE,
  DAY_LENGTH_S,
  MARKET_MAX_PINS,
  MARKET_OVERLOAD_PINS,
  MARKET_OVERLOAD_TIME_S,
  NEW_COLOR_EVERY_DAYS,
} from '../config';
import { mulberry32 } from '../core/random';
import type { NodeId, RoadNetwork } from '../roads/RoadNetwork';
import type { Topography } from '../terrain/Topography';
import { BuildingRegistry, type ColorId, type House, type Market } from './Buildings';
import { type BusContext, FOLLOW_LOOKAHEAD, Minibus } from './Minibus';
import { type PathResult, findPath } from './Pathfinding';
import { Route } from './Route';
import { type ColorRegion, Spawner } from './Spawner';

/** Anzahl verfügbarer Linienfarben. */
export const COLOR_COUNT = 5;

/** Spawn-Taktung in Sekunden (bei 1x). */
const HOUSE_INTERVAL: [number, number] = [9, 15];
const MARKET_INTERVAL_S = 75;
const NEW_COLOR_INTERVAL_S = DAY_LENGTH_S * NEW_COLOR_EVERY_DAYS;
const MAX_HOUSES = 60;
/** Pin-Intervall pro Markt: startet bei PIN_INTERVAL_START, wird täglich kürzer. */
const PIN_INTERVAL_START = 8;
const PIN_INTERVAL_MIN = 3.2;
const PIN_INTERVAL_DAILY_FACTOR = 0.96;
const DISPATCH_INTERVAL_S = 0.3;
/** Mindestabstand zwischen zwei Abfahrten aus derselben Garage. */
const DEPARTURE_SPACING_S = 1.2;

export interface SimEvents {
  onDelivered?: (bus: Minibus) => void;
  onSpawn?: (kind: 'house' | 'market') => void;
  onOverflow?: (market: Market) => void;
}

/**
 * Die Verkehrssimulation: Gebäude, Nachfrage, Disposition und Minibus-Agenten.
 * Unabhängig vom DOM – läuft headless in Tests mit festem Zeitschritt.
 */
export class Simulation implements BusContext {
  time = 0;
  /** Beförderte Passagiere. */
  score = 0;
  readonly buildings = new BuildingRegistry();
  readonly buses: Minibus[] = [];
  readonly regions: ColorRegion[] = [];
  /** Freigeschaltete Farben. */
  colors = 0;
  /** Wird true, sobald ein Markt überläuft (Game Over folgt in Phase 4). */
  overflowed = false;

  private readonly rand: () => number;
  private readonly spawner: Spawner;
  private readonly routeCache = new Map<string, PathResult | null>();
  private cacheVersion = -1;
  private readonly junctions = new Map<NodeId, Minibus>();
  /** Zeitpunkt, ab dem eine Garage wieder einen Bus losschicken darf. */
  private readonly nextDeparture = new Map<number, number>();
  private nextHouse = 0;
  private nextMarket = MARKET_INTERVAL_S;
  private nextColor = NEW_COLOR_INTERVAL_S;
  private dispatchTimer = 0;

  constructor(
    private readonly topo: Topography,
    private readonly net: RoadNetwork,
    seed: number,
    private readonly events: SimEvents = {},
    /** false: keine automatischen Gebäude (Tests, Sandbox). */
    private readonly autoSpawn = true,
  ) {
    this.rand = mulberry32(seed * 7919 + 13);
    this.spawner = new Spawner(topo, net, this.buildings, this.rand);
    if (autoSpawn) {
      this.unlockColor();
      this.spawnHouse(0);
      this.nextHouse = this.randomHouseInterval();
    }
  }

  get day(): number {
    return Math.floor(this.time / DAY_LENGTH_S);
  }

  /** Anteil des aktuellen Tages (0..1). */
  get dayFraction(): number {
    return (this.time % DAY_LENGTH_S) / DAY_LENGTH_S;
  }

  // ---------------------------------------------------------------------------
  // Hauptschleife
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    if (this.cacheVersion !== this.net.version) this.onNetworkChanged();

    if (this.autoSpawn) this.updateSpawning();
    for (const m of this.buildings.markets) this.updateMarket(m, dt);

    this.dispatchTimer -= dt;
    if (this.dispatchTimer <= 0) {
      this.dispatchTimer = DISPATCH_INTERVAL_S;
      this.dispatch();
    }

    for (const bus of this.buses) bus.update(dt, this);
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  private updateSpawning(): void {
    if (this.time >= this.nextColor && this.colors < COLOR_COUNT) {
      this.nextColor += NEW_COLOR_INTERVAL_S;
      this.unlockColor();
    }
    if (this.time >= this.nextMarket) {
      this.nextMarket += MARKET_INTERVAL_S;
      // Markt für die Farbe mit dem größten Garagen-Überschuss
      let best = 0;
      let bestRatio = -1;
      for (let c = 0; c < this.colors; c++) {
        const ratio = this.housesOf(c).length / Math.max(1, this.marketsOf(c).length);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = c;
        }
      }
      this.spawnMarket(best);
    }
    if (this.time >= this.nextHouse) {
      this.nextHouse = this.time + this.randomHouseInterval();
      if (this.buildings.houses.length < MAX_HOUSES) {
        // Garage für die Farbe mit dem geringsten Angebot pro Markt
        let best = 0;
        let bestRatio = Infinity;
        for (let c = 0; c < this.colors; c++) {
          const ratio = this.housesOf(c).length / Math.max(1, this.marketsOf(c).length) + this.rand() * 0.5;
          if (ratio < bestRatio) {
            bestRatio = ratio;
            best = c;
          }
        }
        this.spawnHouse(best);
      }
    }
  }

  private randomHouseInterval(): number {
    return HOUSE_INTERVAL[0] + this.rand() * (HOUSE_INTERVAL[1] - HOUSE_INTERVAL[0]);
  }

  private unlockColor(): void {
    const color = this.colors++;
    this.regions[color] = this.spawner.regionFor(color);
    this.spawnMarket(color);
    this.spawnHouse(color);
  }

  housesOf(color: ColorId): House[] {
    return this.buildings.houses.filter((h) => h.color === color);
  }

  marketsOf(color: ColorId): Market[] {
    return this.buildings.markets.filter((m) => m.color === color);
  }

  spawnHouse(color: ColorId): House | null {
    const region = this.regions[color];
    // Neue Garagen bevorzugt neben bestehenden derselben Farbe (Viertel wachsen)
    const siblings = this.housesOf(color);
    const anchor =
      siblings.length && this.rand() < 0.6 ? this.net.centerOf(siblings[Math.floor(this.rand() * siblings.length)].entrance) : region.houseCenter;
    const site = this.spawner.findHouseSite(anchor, siblings.length ? 2.5 : 3.5);
    if (!site) return null;
    return this.addHouse(color, site.entrance, site.driveway);
  }

  spawnMarket(color: ColorId): Market | null {
    const region = this.regions[color];
    const site = this.spawner.findMarketSite(region.marketCenter, 3 + this.marketsOf(color).length * 2);
    if (!site) return null;
    return this.addMarket(color, site.origin, site.cells, site.entrance, site.driveway);
  }

  /** Direktes Platzieren (auch für Tests). */
  addHouse(color: ColorId, entrance: NodeId, driveway: NodeId): House {
    this.colors = Math.max(this.colors, color + 1);
    const h = this.buildings.addHouse(color, entrance, driveway, BUSES_PER_HOUSE, this.time);
    this.buildings.enforceOn(this.net, h);
    for (let i = 0; i < BUSES_PER_HOUSE; i++) this.buses.push(new Minibus(color, h));
    this.events.onSpawn?.('house');
    return h;
  }

  addMarket(color: ColorId, origin: { cx: number; cy: number }, cells: NodeId[], entrance: NodeId, driveway: NodeId): Market {
    this.colors = Math.max(this.colors, color + 1);
    const m = this.buildings.addMarket(color, origin, cells, entrance, driveway, this.time);
    this.buildings.enforceOn(this.net, m);
    this.events.onSpawn?.('market');
    return m;
  }

  // ---------------------------------------------------------------------------
  // Nachfrage & Überlastung
  // ---------------------------------------------------------------------------

  private updateMarket(m: Market, dt: number): void {
    m.pinTimer -= dt;
    if (m.pinTimer <= 0) {
      const interval = Math.max(PIN_INTERVAL_MIN, PIN_INTERVAL_START * Math.pow(PIN_INTERVAL_DAILY_FACTOR, this.day));
      m.pinTimer += interval * (0.8 + this.rand() * 0.4);
      if (m.pins < MARKET_MAX_PINS) m.pins++;
    }
    if (m.pins >= MARKET_OVERLOAD_PINS) {
      m.overload = Math.min(1, m.overload + dt / MARKET_OVERLOAD_TIME_S);
      if (m.overload >= 1 && !this.overflowed) {
        this.overflowed = true;
        this.events.onOverflow?.(m);
      }
    } else {
      m.overload = Math.max(0, m.overload - dt / (MARKET_OVERLOAD_TIME_S * 0.5));
    }
  }

  // ---------------------------------------------------------------------------
  // Disposition: nächster freier Bus derselben Farbe (nach erwarteter Fahrzeit)
  // ---------------------------------------------------------------------------

  private dispatch(): void {
    const markets = [...this.buildings.markets].sort((a, b) => b.overload - a.overload || b.pins - b.claimed - (a.pins - a.claimed));
    for (const m of markets) {
      while (m.pins - m.claimed > 0) {
        let best: { house: House; path: PathResult } | null = null;
        for (const h of this.buildings.houses) {
          if (h.color !== m.color || h.parked <= 0) continue;
          if ((this.nextDeparture.get(h.id) ?? 0) > this.time) continue;
          const path = this.route(h.entrance, m.entrance);
          if (path && (!best || path.time < best.path.time)) best = { house: h, path };
        }
        if (!best) break;
        const { house, path } = best;
        const bus = this.buses.find((b) => b.home === house && b.state === 'parked');
        if (!bus) break;
        this.nextDeparture.set(house.id, this.time + DEPARTURE_SPACING_S);
        const claim = Math.min(BUS_CAPACITY, m.pins - m.claimed);
        m.claimed += claim;
        house.parked--;
        bus.market = m;
        bus.claimed = claim;
        bus.passengers = 0;
        bus.alpha = 1;
        bus.speed = 0;
        const p0 = this.net.centerOf(path.nodes[0]);
        const p1 = this.net.centerOf(path.nodes[1]);
        bus.angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        bus.setRoute(new Route(this.topo, this.net, path.nodes), 'toMarket');
      }
    }
  }

  /** A*-Route mit Cache (wird bei jeder Netzänderung verworfen). */
  route(from: NodeId, to: NodeId): PathResult | null {
    const key = `${from}>${to}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const path = findPath(this.topo, this.net, from, to, (n) => this.buildings.isOccupied(n));
    const result = path && path.nodes.length >= 2 ? path : null;
    this.routeCache.set(key, result);
    return result;
  }

  /** Straßennetz geändert: Cache leeren und laufende Fahrten prüfen / neu planen. */
  private onNetworkChanged(): void {
    this.cacheVersion = this.net.version;
    this.routeCache.clear();
    for (const bus of this.buses) {
      if (!bus.isMoving || !bus.route) continue;
      const r = bus.route;
      const edge = r.sample(bus.s).edge;
      let intact = true;
      for (let i = edge; i < r.nodes.length - 1; i++) {
        if (!this.net.hasEdge(r.nodes[i], r.nodes[i + 1])) {
          intact = false;
          break;
        }
      }
      if (intact) continue;
      const from = r.nodes[edge];
      const next = r.nodes[edge + 1];
      const goal = r.nodes[r.nodes.length - 1];
      const rest = this.net.hasEdge(from, next) ? this.route(next, goal) : null;
      if (!rest && next !== goal) {
        this.loseBus(bus);
        continue;
      }
      if (!this.net.hasEdge(from, next)) {
        this.loseBus(bus);
        continue;
      }
      const nodes = rest ? [from, ...rest.nodes] : [from, next];
      const centerline = r.sample(bus.s);
      const route = new Route(this.topo, this.net, nodes);
      bus.releaseJunctions(this);
      bus.setRoute(route, bus.state as 'toMarket' | 'toHome', route.project(centerline, route.nodeS[1] ?? route.length));
    }
  }

  /** Bus hat keinen Weg mehr: ausblenden, Reservierungen freigeben, zurück in die Garage. */
  private loseBus(bus: Minibus): void {
    bus.releaseJunctions(this);
    if (bus.market && bus.state === 'toMarket') bus.market.claimed -= bus.claimed;
    bus.claimed = 0;
    bus.passengers = 0;
    bus.market = null;
    bus.state = 'lost';
    bus.timer = 1;
    bus.speed = 0;
  }

  // ---------------------------------------------------------------------------
  // BusContext
  // ---------------------------------------------------------------------------

  leaderGap(bus: Minibus): { gap: number; speed: number } {
    const hx = Math.cos(bus.angle);
    const hy = Math.sin(bus.angle);
    let gap = Infinity;
    let speed = 0;
    for (const o of this.buses) {
      if (o === bus || !o.isOnRoad || o.state === 'lost') continue;
      const dx = o.x - bus.x;
      const dy = o.y - bus.y;
      const along = dx * hx + dy * hy;
      if (along <= 0 || along > FOLLOW_LOOKAHEAD || along >= gap) continue;
      const lateral = Math.abs(dx * hy - dy * hx);
      if (lateral > 3.5 + along * 0.2) continue;
      // Gegenverkehr (entgegengesetzte Richtung) ignorieren
      if (Math.cos(o.angle - bus.angle) < -0.3) continue;
      gap = along;
      speed = o.speed;
    }
    return { gap, speed };
  }

  degree(node: NodeId): number {
    return this.net.degree(node);
  }

  junctionOwner(node: NodeId): Minibus | undefined {
    return this.junctions.get(node);
  }

  setJunctionOwner(node: NodeId, bus: Minibus | undefined): void {
    if (bus) this.junctions.set(node, bus);
    else this.junctions.delete(node);
  }

  arrived(bus: Minibus): void {
    if (bus.state === 'toMarket') {
      bus.state = 'loading';
      bus.timer = BOARDING_TIME_PER_PIN;
    } else if (bus.state === 'toHome') {
      bus.state = 'unloading';
      bus.timer = BOARDING_TIME_PER_PIN;
    }
  }

  boarded(bus: Minibus): void {
    const m = bus.market!;
    m.pins--;
    m.claimed--;
  }

  delivered(bus: Minibus): void {
    this.score++;
    this.events.onDelivered?.(bus);
  }

  serviceDone(bus: Minibus): void {
    if (bus.state === 'loading') {
      const m = bus.market!;
      bus.claimed = 0;
      const path = this.route(m.entrance, bus.home.entrance);
      if (!path) {
        this.loseBus(bus);
        return;
      }
      bus.setRoute(new Route(this.topo, this.net, path.nodes), 'toHome');
    } else {
      bus.state = 'parked';
      bus.route = null;
      bus.market = null;
      bus.home.parked++;
    }
  }

  recovered(bus: Minibus): void {
    bus.state = 'parked';
    bus.route = null;
    bus.alpha = 1;
    bus.home.parked++;
  }
}
