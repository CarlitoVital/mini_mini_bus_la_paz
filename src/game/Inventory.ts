import { START_ROAD_TILES, START_VIADUCTS } from '../config';
import type { NodeId, RoadNetwork } from '../roads/RoadNetwork';
import type { BuildRejection, ConnectionRules } from '../roads/RoadRules';
import type { BuildingRegistry } from '../sim/Buildings';

/** Kreuzungs-Upgrades, die auf einem Knoten mit ≥ 3 Ästen platziert werden. */
export type JunctionUpgrade = 'roundabout' | 'light';

export type ItemKind = 'tiles' | 'viaduct' | JunctionUpgrade;

export type PlaceRejection = 'not-junction' | 'occupied' | 'none-left' | 'building';

export const PLACE_REJECTION_TEXT: Record<PlaceRejection, string> = {
  'not-junction': 'Nur auf Kreuzungen (≥ 3 Äste)',
  occupied: 'Hier ist schon ein Upgrade',
  'none-left': 'Keins mehr im Inventar',
  building: 'Nicht auf Gebäuden',
};

/**
 * Ressourcen des Spielers. "Besitz" (owned) wird durch Wochenbelohnungen erhöht;
 * der Verbrauch wird immer aus dem aktuellen Straßennetz abgeleitet. Abriss und
 * Rückgängig erstatten dadurch automatisch zurück.
 *
 *  - Straßenteil: jede Straßenzelle, die kein Gebäude ist
 *  - Viadukt: jede Kante, die mehr als eine Zelle überspannt
 *  - Kreisverkehr / Ampel: auf Kreuzungen platziert (fallen bei Abriss zurück ins Inventar)
 */
export class Inventory implements ConnectionRules {
  owned: Record<ItemKind, number> = {
    tiles: START_ROAD_TILES,
    viaduct: START_VIADUCTS,
    roundabout: 0,
    light: 0,
  };
  readonly upgrades = new Map<NodeId, JunctionUpgrade>();
  private cacheVersion = -1;
  private cachedTiles = 0;
  private cachedViaducts = 0;

  constructor(
    private readonly net: RoadNetwork,
    private readonly buildings: BuildingRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // Verbrauch
  // ---------------------------------------------------------------------------

  private refresh(): void {
    if (this.cacheVersion === this.net.version) return;
    this.cacheVersion = this.net.version;
    let tiles = 0;
    for (const n of this.net.nodes()) if (!this.buildings.isOccupied(n)) tiles++;
    this.cachedTiles = tiles;
    this.cachedViaducts = this.net.longEdges().length;
    // Upgrades auf Knoten, die keine Kreuzung mehr sind, fallen zurück ins Inventar
    for (const [node] of this.upgrades) if (this.net.degree(node) < 3) this.upgrades.delete(node);
  }

  used(kind: ItemKind): number {
    this.refresh();
    if (kind === 'tiles') return this.cachedTiles;
    if (kind === 'viaduct') return this.cachedViaducts;
    let n = 0;
    for (const u of this.upgrades.values()) if (u === kind) n++;
    return n;
  }

  available(kind: ItemKind): number {
    return this.owned[kind] - this.used(kind);
  }

  add(kind: ItemKind, n: number): void {
    this.owned[kind] += n;
  }

  // ---------------------------------------------------------------------------
  // ConnectionRules (Gebäude + Budget)
  // ---------------------------------------------------------------------------

  /** Kosten in Straßenteilen, wenn a–b neu gebaut wird. */
  tileCost(a: NodeId, b: NodeId): number {
    let cost = 0;
    for (const n of [a, b]) if (!this.net.hasNode(n) && !this.buildings.isOccupied(n)) cost++;
    return cost;
  }

  connectionRule(a: NodeId, b: NodeId): BuildRejection | null {
    const building = this.buildings.connectionRule(a, b);
    if (building) return building;
    if (this.tileCost(a, b) > this.available('tiles')) return 'no-tiles';
    return null;
  }

  viaductsAvailable(): number {
    return this.available('viaduct');
  }

  isBlockedCell(id: NodeId): boolean {
    return this.buildings.isOccupied(id);
  }

  // ---------------------------------------------------------------------------
  // Kreuzungs-Upgrades
  // ---------------------------------------------------------------------------

  canPlace(kind: JunctionUpgrade, node: NodeId): PlaceRejection | null {
    this.refresh();
    if (this.buildings.isOccupied(node)) return 'building';
    if (this.net.degree(node) < 3) return 'not-junction';
    if (this.upgrades.has(node)) return 'occupied';
    if (this.available(kind) <= 0) return 'none-left';
    return null;
  }

  place(kind: JunctionUpgrade, node: NodeId): PlaceRejection | null {
    const r = this.canPlace(kind, node);
    if (!r) this.upgrades.set(node, kind);
    return r;
  }

  /** Upgrade entfernen (zurück ins Inventar). */
  remove(node: NodeId): boolean {
    return this.upgrades.delete(node);
  }

  junction(node: NodeId): JunctionUpgrade | undefined {
    this.refresh();
    return this.upgrades.get(node);
  }
}
