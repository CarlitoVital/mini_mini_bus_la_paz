import { describe, expect, it } from 'vitest';
import { CELL_SIZE, DAY_LENGTH_S, DAYS_PER_WEEK } from '../src/config';
import { Inventory } from '../src/game/Inventory';
import { RoadNetwork } from '../src/roads/RoadNetwork';
import { checkViaduct } from '../src/roads/RoadRules';
import { RoadTool } from '../src/roads/RoadTool';
import { BuildingRegistry } from '../src/sim/Buildings';
import { JUNCTION_RADIUS } from '../src/sim/Minibus';
import { Simulation } from '../src/sim/Simulation';
import type { Topography } from '../src/terrain/Topography';

const COLS = 16;
const ROWS = 12;

/** Synthetisches Gelände inkl. cellAt (für das Straßenwerkzeug). */
function fakeTopo(metersAt: (x: number, y: number) => number): Topography {
  return {
    metersAt,
    cellSize: CELL_SIZE,
    cellAt: (x: number, y: number) => {
      const cx = Math.floor(x / CELL_SIZE);
      const cy = Math.floor(y / CELL_SIZE);
      return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS ? { cx, cy } : null;
    },
  } as unknown as Topography;
}

const flat = fakeTopo(() => 3500);
/** Flaches Gelände mit einer 100 m tiefen, eine Zelle breiten Quebrada bei cx = 5. */
const gully = fakeTopo((x) => (Math.floor(x / CELL_SIZE) === 5 ? 3400 : 3500));
const at = (cx: number, cy: number) => ({ x: (cx + 0.5) * CELL_SIZE, y: (cy + 0.5) * CELL_SIZE });

function setup(topo: Topography, tiles = 100, viaducts = 0) {
  const net = new RoadNetwork(COLS, ROWS);
  const reg = new BuildingRegistry();
  const inv = new Inventory(net, reg);
  inv.owned.tiles = tiles;
  inv.owned.viaduct = viaducts;
  const tool = new RoadTool(net, topo, {}, inv);
  const drag = (from: [number, number], to: [number, number]) => {
    tool.pointerDown(0, at(...from));
    tool.pointerMove(at(...to));
    const blocked = tool.blocked;
    const hint = tool.viaductHint;
    tool.pointerUp();
    return { blocked, hint };
  };
  return { net, reg, inv, tool, drag };
}

describe('Straßenteile (Budget)', () => {
  it('jede neue Straßenzelle kostet ein Teil; ohne Teile wird nicht gebaut', () => {
    const { net, inv, drag } = setup(flat, 3);
    const r = drag([1, 1], [6, 1]);
    expect(net.edgeCount).toBe(2);
    expect(inv.available('tiles')).toBe(0);
    expect(r.blocked?.check.reason).toBe('no-tiles');
  });

  it('Abriss und Rückgängig erstatten Teile zurück', () => {
    const { inv, tool, drag } = setup(flat, 10);
    drag([1, 1], [5, 1]);
    expect(inv.available('tiles')).toBe(5);
    tool.undo();
    expect(inv.available('tiles')).toBe(10);
    drag([1, 1], [3, 1]);
    tool.pointerDown(2, at(2, 1));
    tool.pointerUp();
    expect(inv.available('tiles')).toBe(10); // beide Endzellen verlieren ihre Kante → keine Knoten mehr
  });

  it('Gebäudezellen kosten nichts', () => {
    const { reg, net, inv } = setup(flat, 10);
    reg.addHouse(0, net.id(2, 2), net.id(3, 2), 2, 0);
    expect(inv.tileCost(net.id(2, 2), net.id(3, 2))).toBe(1);
    net.addEdge(net.id(2, 2), net.id(3, 2));
    expect(inv.available('tiles')).toBe(9);
  });
});

describe('Viadukt', () => {
  it('prüft gerade Spannweite 2–4 und die Steigung zwischen den Endpunkten', () => {
    const { net, inv } = setup(gully, 100, 1);
    expect(checkViaduct(gully, net, net.id(4, 3), net.id(6, 3), inv).ok).toBe(true);
    expect(checkViaduct(gully, net, net.id(4, 3), net.id(6, 4), inv).reason).toBe('not-adjacent');
    expect(checkViaduct(gully, net, net.id(4, 3), net.id(9, 3), inv).reason).toBe('not-adjacent');
    inv.owned.viaduct = 0;
    expect(checkViaduct(gully, net, net.id(4, 3), net.id(6, 3), inv).reason).toBe('no-viaduct');
  });

  it('wird beim geraden Weiterziehen über eine Quebrada automatisch gebaut', () => {
    const { net, inv, drag } = setup(gully, 100, 1);
    const r = drag([2, 3], [9, 3]);
    expect(r.blocked).toBeNull();
    expect(net.hasEdge(net.id(4, 3), net.id(6, 3))).toBe(true);
    expect(net.longEdges()).toHaveLength(1);
    expect(net.hasEdge(net.id(8, 3), net.id(9, 3))).toBe(true);
    expect(inv.available('viaduct')).toBe(0);
    // Zelle unter dem Viadukt ist kein Straßenknoten und kostet kein Teil
    expect(net.hasNode(net.id(5, 3))).toBe(false);
    expect(net.isUnderViaduct(net.id(5, 3))).toBe(true);
  });

  it('ohne Viadukt bleibt die Quebrada gesperrt', () => {
    const { net, drag } = setup(gully, 100, 0);
    const r = drag([2, 3], [9, 3]);
    expect(r.blocked?.check.reason).toBe('too-steep');
    expect(r.hint).toBe(false);
    expect(net.hasNode(net.id(6, 3))).toBe(false);
  });

  it('Abriss über der überspannten Zelle entfernt das Viadukt und erstattet es', () => {
    const { net, inv, tool, drag } = setup(gully, 100, 1);
    drag([2, 3], [9, 3]);
    tool.pointerDown(2, at(5, 3));
    tool.pointerUp();
    expect(net.longEdges()).toHaveLength(0);
    expect(inv.available('viaduct')).toBe(1);
  });
});

describe('Kreuzungs-Upgrades', () => {
  it('nur auf Kreuzungen, fällt bei Abriss eines Astes zurück ins Inventar', () => {
    const { net, inv, drag } = setup(flat);
    inv.owned.roundabout = 1;
    drag([1, 5], [9, 5]);
    expect(inv.place('roundabout', net.id(5, 5))).toBe('not-junction');
    drag([5, 5], [5, 8]);
    expect(inv.place('roundabout', net.id(5, 5))).toBeNull();
    expect(inv.available('roundabout')).toBe(0);
    expect(inv.place('roundabout', net.id(5, 5))).toBe('occupied');
    net.removeEdge(net.id(5, 5), net.id(5, 6));
    expect(inv.junction(net.id(5, 5))).toBeUndefined();
    expect(inv.available('roundabout')).toBe(1);
  });
});

/** T-Kreuzung bei (5,5): Garage links, Markt rechts, Abzweig nach Süden. */
function junctionScenario() {
  const net = new RoadNetwork(COLS, ROWS);
  const sim = new Simulation(flat, net, 1, {}, false);
  const house = sim.addHouse(0, net.id(1, 4), net.id(1, 5));
  const market = sim.addMarket(0, { cx: 10, cy: 3 }, [net.id(10, 4), net.id(11, 4), net.id(10, 3), net.id(11, 3)], net.id(10, 4), net.id(10, 5));
  for (let x = 1; x < 10; x++) net.addEdge(net.id(x, 5), net.id(x + 1, 5));
  net.addEdge(net.id(5, 5), net.id(5, 6));
  net.addEdge(net.id(5, 6), net.id(5, 7));
  net.addEdge(house.entrance, house.driveway);
  net.addEdge(market.entrance, market.driveway);
  market.pinTimer = Infinity;
  return { net, sim, market };
}

const run = (sim: Simulation, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) sim.update(1 / 60);
};

describe('Ampel & Kreisverkehr in der Simulation', () => {
  it('Ampelphasen wechseln zwischen Ost-West und Nord-Süd', () => {
    const { net, sim } = junctionScenario();
    const node = net.id(5, 5);
    const fromWest = net.id(4, 5);
    const fromSouth = net.id(5, 6);
    expect(sim.lightGreen(node, fromWest)).not.toBe(sim.lightGreen(node, fromSouth));
    const before = sim.lightGreen(node, fromWest);
    run(sim, 3.6);
    expect(sim.lightGreen(node, fromWest)).toBe(!before);
  });

  it('bei Rot hält der Bus vor der Kreuzung, bei Grün fährt er weiter', () => {
    const { net, sim, market } = junctionScenario();
    const node = net.id(5, 5);
    sim.junctionUpgrade = (n) => (n === node ? 'light' : undefined);
    let green = false;
    sim.lightGreen = () => green;
    market.pins = 1;
    run(sim, 12);
    const bus = sim.buses.find((b) => b.state === 'toMarket')!;
    expect(bus).toBeDefined();
    expect(bus.speed).toBeLessThan(0.5);
    expect(bus.x).toBeLessThan((5.5) * CELL_SIZE - JUNCTION_RADIUS + 2);
    green = true;
    run(sim, 12);
    expect(['loading', 'toHome', 'unloading', 'parked']).toContain(bus.state);
  });

  it('im Kreisverkehr wird nicht reserviert, aber gedrosselt', () => {
    const { net, sim, market } = junctionScenario();
    const node = net.id(5, 5);
    sim.junctionUpgrade = (n) => (n === node ? 'roundabout' : undefined);
    market.pins = 1;
    let maxSpeedNearJunction = 0;
    for (let t = 0; t < 30; t += 1 / 60) {
      sim.update(1 / 60);
      const bus = sim.buses.find((b) => b.state === 'toMarket');
      if (bus && Math.abs(bus.x - 5.5 * CELL_SIZE) < 4) maxSpeedNearJunction = Math.max(maxSpeedNearJunction, bus.speed);
      expect(sim.junctionOwner(node)).toBeUndefined();
    }
    expect(maxSpeedNearJunction).toBeGreaterThan(0);
    expect(maxSpeedNearJunction).toBeLessThan(46 * 0.6);
    expect(sim.score).toBeGreaterThan(0);
  });
});

describe('Spielablauf', () => {
  it('meldet das Wochenende und stoppt bei Game Over', () => {
    const { sim, market } = junctionScenario();
    const weeks: number[] = [];
    (sim as unknown as { events: { onWeekEnd: (w: number) => void } }).events.onWeekEnd = (w) => weeks.push(w);
    for (let t = 0; t < DAY_LENGTH_S * DAYS_PER_WEEK + 1; t += 0.5) sim.update(0.5);
    expect(weeks).toEqual([2]);
    expect(sim.week).toBe(2);

    market.pins = 12;
    sim.buildings.houses[0].parked = 0; // niemand holt ab
    for (let t = 0; t < 60 && !sim.overflowed; t += 0.5) sim.update(0.5);
    expect(sim.overflowed).toBe(true);
    expect(sim.overflowMarket).toBe(market);
    sim.halted = true;
    const time = sim.time;
    sim.update(1);
    expect(sim.time).toBe(time);
  });
});
