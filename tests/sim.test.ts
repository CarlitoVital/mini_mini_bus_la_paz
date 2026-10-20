import { describe, expect, it } from 'vitest';
import { BUS_BASE_SPEED, CELL_SIZE, MAX_ALLOWED_SLOPE } from '../src/config';
import { RoadNetwork } from '../src/roads/RoadNetwork';
import { checkSegment } from '../src/roads/RoadRules';
import { MIN_GAP } from '../src/sim/Minibus';
import { findPath } from '../src/sim/Pathfinding';
import { gradeSpeedFactor } from '../src/sim/physics';
import { Route } from '../src/sim/Route';
import { Simulation } from '../src/sim/Simulation';
import { Topography } from '../src/terrain/Topography';

const STEP = 1 / 60;

/** Synthetisches Gelände für deterministische Tests. */
function fakeTopo(metersAt: (x: number, y: number) => number): Topography {
  return { metersAt, cellSize: CELL_SIZE } as unknown as Topography;
}

/** Straße als Kette von Zellen. */
function road(net: RoadNetwork, cells: [number, number][]): void {
  for (let i = 1; i < cells.length; i++) net.addEdge(net.id(...cells[i - 1]), net.id(...cells[i]));
}

/** Gerade Zellkette von a nach b (gleiche Zeile oder Spalte). */
function line(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let i = 0; i <= n; i++) out.push([a[0] + Math.sign(b[0] - a[0]) * i, a[1] + Math.sign(b[1] - a[1]) * i]);
  return out;
}

describe('Bergauf-Physik', () => {
  it('verlangsamt bergauf drastisch und beschleunigt bergab leicht (gedeckelt)', () => {
    expect(gradeSpeedFactor(0)).toBe(1);
    expect(gradeSpeedFactor(0.1)).toBeCloseTo(0.5);
    expect(gradeSpeedFactor(MAX_ALLOWED_SLOPE)).toBeCloseTo(0.25);
    expect(gradeSpeedFactor(0.5)).toBe(0.2);
    expect(gradeSpeedFactor(-0.05)).toBeCloseTo(1.1);
    expect(gradeSpeedFactor(-0.5)).toBeCloseTo(1.25);
  });
});

describe('A* nach Fahrzeit', () => {
  // Ein Hügel bei Zelle (7,5): 130 m hoch
  const hill = fakeTopo((x, y) => {
    const dx = x / CELL_SIZE - 7.5;
    const dy = y / CELL_SIZE - 5.5;
    return 3500 + 130 * Math.exp(-(dx * dx + dy * dy) / 2.5);
  });

  it('umfährt einen steilen Hügel, wenn der Umweg schneller ist', () => {
    const net = new RoadNetwork(16, 12);
    road(net, line([2, 5], [12, 5])); // direkt über den Gipfel
    road(net, [...line([2, 5], [2, 1]), ...line([2, 1], [12, 1]).slice(1), ...line([12, 1], [12, 5]).slice(1)]); // Umweg
    const p = findPath(hill, net, net.id(2, 5), net.id(12, 5))!;
    expect(p.nodes.some((n) => net.cellOf(n).cy === 1)).toBe(true);
    // Ohne Hügel wäre der direkte Weg kürzer
    const flat = findPath(fakeTopo(() => 3500), net, net.id(2, 5), net.id(12, 5))!;
    expect(flat.nodes).toHaveLength(11);
    expect(flat.time).toBeCloseTo((10 * CELL_SIZE) / BUS_BASE_SPEED, 5);
  });

  it('Kosten sind richtungsabhängig (bergauf teurer)', () => {
    const slope = fakeTopo((x) => 3500 + x * 0.3);
    const net = new RoadNetwork(12, 4);
    road(net, line([1, 1], [10, 1]));
    const up = findPath(slope, net, net.id(1, 1), net.id(10, 1))!;
    const down = findPath(slope, net, net.id(10, 1), net.id(1, 1))!;
    expect(up.time).toBeGreaterThan(down.time * 1.5);
  });

  it('findet keinen Weg in getrennten Netzen', () => {
    const net = new RoadNetwork(10, 10);
    road(net, line([1, 1], [3, 1]));
    road(net, line([6, 6], [8, 6]));
    expect(findPath(fakeTopo(() => 3500), net, net.id(1, 1), net.id(8, 6))).toBeNull();
  });
});

describe('Route', () => {
  it('folgt den Bezier-Kurven und ordnet Kanten korrekt zu', () => {
    const topo = fakeTopo(() => 3500);
    const net = new RoadNetwork(10, 10);
    const nodes = [net.id(1, 1), net.id(2, 1), net.id(2, 2)];
    road(net, [
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    const r = new Route(topo, net, nodes);
    // Kurve schneidet die Ecke ab: kürzer als 2 volle Zellen
    expect(r.length).toBeLessThan(2 * CELL_SIZE);
    expect(r.length).toBeGreaterThan(1.7 * CELL_SIZE);
    expect(r.sample(0)).toMatchObject({ x: 1.5 * CELL_SIZE, y: 1.5 * CELL_SIZE, edge: 0 });
    expect(r.sample(r.length).edge).toBe(1);
    expect(r.curveAt(r.nodeS[1])).toBeLessThan(1);
    expect(r.project(r.sample(20))).toBeCloseTo(20, 0);
  });
});

/** Kleines Testszenario: Garage oben, Markt unten, gerade Straße dazwischen. */
function scenario(metersAt: (x: number, y: number) => number, length = 8) {
  const topo = fakeTopo(metersAt);
  const net = new RoadNetwork(20, 20);
  const sim = new Simulation(topo, net, 1, {}, false);
  const top = 2;
  const bottom = top + length;
  const house = sim.addHouse(0, net.id(6, top), net.id(5, top));
  const market = sim.addMarket(0, { cx: 6, cy: bottom }, [net.id(6, bottom), net.id(7, bottom), net.id(6, bottom + 1), net.id(7, bottom + 1)], net.id(6, bottom), net.id(5, bottom));
  road(net, line([5, top], [5, bottom]));
  net.addEdge(house.entrance, house.driveway);
  net.addEdge(market.entrance, market.driveway);
  market.pinTimer = Infinity; // keine automatischen Pins
  return { sim, net, house, market };
}

function run(sim: Simulation, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += STEP) {
    sim.update(STEP);
    each?.();
  }
}

describe('Simulation', () => {
  it('fährt eine komplette Tour: Garage → Markt → Garage und zählt Passagiere', () => {
    const { sim, house, market } = scenario(() => 3500);
    market.pins = 4;
    run(sim, 30);
    expect(market.pins).toBe(0);
    expect(market.claimed).toBe(0);
    expect(sim.score).toBe(4);
    expect(house.parked).toBe(2);
  });

  it('Busse brauchen bergauf deutlich länger als bergab', () => {
    // Markt liegt 8 Zellen südlich und ~115 m höher (≈ 10 % Steigung)
    const { sim, market } = scenario((_x, y) => 3500 + y * 0.45);
    market.pins = 1;
    const bus = sim.buses[0];
    const t: Record<string, number> = {};
    let prev = bus.state;
    run(sim, 40, () => {
      if (bus.state !== prev) {
        t[bus.state] = sim.time;
        prev = bus.state;
      }
    });
    const up = t.loading - t.toMarket;
    const down = t.unloading - t.toHome;
    expect(sim.score).toBe(1);
    expect(up).toBeGreaterThan(down * 1.4);
  });

  it('hält Abstand – langsame Busse bergauf erzeugen Rückstau statt Überlappung', () => {
    const { sim, market } = scenario((_x, y) => 3500 + y * 0.4, 12);
    market.pins = 8; // zwei Busse derselben Garage nacheinander
    let minGap = Infinity;
    run(sim, 25, () => {
      const moving = sim.buses.filter((b) => b.state === 'toMarket');
      if (moving.length === 2) minGap = Math.min(minGap, Math.hypot(moving[0].x - moving[1].x, moving[0].y - moving[1].y));
    });
    expect(minGap).toBeLessThan(Infinity);
    expect(minGap).toBeGreaterThan(MIN_GAP * 0.9);
  });

  it('plant neu, wenn eine Straße abgerissen wird, und verliert den Bus ohne Alternative', () => {
    const { sim, net, market } = scenario(() => 3500);
    market.pins = 2;
    run(sim, 1.5);
    const bus = sim.buses.find((b) => b.state === 'toMarket')!;
    expect(bus).toBeDefined();
    // Umleitung bauen, dann das Originalstück entfernen
    road(net, [
      [5, 6],
      [4, 7],
      [5, 8],
    ]);
    net.removeEdge(net.id(5, 7), net.id(5, 8));
    run(sim, 0.1);
    expect(bus.state).toBe('toMarket');
    expect(bus.route!.nodes).toContain(net.id(4, 7));
    // Jetzt komplett trennen → Bus geht verloren, Pins werden wieder freigegeben
    net.removeNode(net.id(5, 9));
    run(sim, 0.1);
    expect(bus.state).toBe('lost');
    expect(market.claimed).toBe(0);
    run(sim, 2);
    expect(bus.state).toBe('parked');
  });

  it('Überlastungs-Timer läuft bei zu vielen Pins und baut sich wieder ab', () => {
    const { sim, market, net } = scenario(() => 3500);
    net.clear(); // keine Verbindung
    market.pins = 10;
    run(sim, 10);
    expect(market.overload).toBeGreaterThan(0.15);
    market.pins = 0;
    run(sim, 10);
    expect(market.overload).toBe(0);
  });
});

describe('Spawning auf echter Karte', () => {
  it('platziert Gebäude regelkonform und anschließbar', () => {
    const topo = new Topography(1548);
    const net = new RoadNetwork(topo.cols, topo.rows);
    const sim = new Simulation(topo, net, 1548);
    run(sim, 200);
    expect(sim.colors).toBeGreaterThanOrEqual(3);
    expect(sim.buildings.markets.length).toBeGreaterThanOrEqual(3);
    expect(sim.buildings.houses.length).toBeGreaterThanOrEqual(10);
    const occupied = new Set<number>();
    for (const b of sim.buildings.all) {
      for (const c of b.cells) {
        expect(occupied.has(c)).toBe(false);
        occupied.add(c);
      }
      expect(checkSegment(topo, net, b.entrance, b.driveway, sim.buildings).ok).toBe(true);
      expect(sim.buildings.connectionRule(b.entrance, b.driveway)).toBeNull();
    }
    // Gebäudezellen dürfen nicht überbaut werden
    const m = sim.buildings.markets[0];
    const other = m.cells.find((c) => c !== m.entrance)!;
    expect(sim.buildings.connectionRule(other, m.entrance)).toBe('building');
  });
});
