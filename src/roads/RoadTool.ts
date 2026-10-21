import { VIADUCT_MAX_SPAN } from '../config';
import type { Vec2 } from '../core/math';
import type { Topography } from '../terrain/Topography';
import { type Cell, type Edge, type NodeId, type RoadNetwork, cellsOnLine } from './RoadNetwork';
import { type BuildCheck, type ConnectionRules, checkSegment, checkViaduct } from './RoadRules';

type Mode = 'idle' | 'build' | 'erase';

/** Ein Pinselstrich (ein Drag) – für Undo. */
interface Stroke {
  added: Edge[];
  removed: Edge[];
}

/** Abgelehntes Segment, das als rote Vorschau angezeigt wird. */
export interface BlockedPreview {
  from: NodeId;
  to: NodeId;
  check: BuildCheck;
}

export interface RoadToolEvents {
  onBuild?: (grade: number, viaduct: boolean) => void;
  onBlocked?: (check: BuildCheck) => void;
  onErase?: () => void;
}

const MAX_UNDO = 50;

/**
 * Straßenbau-Werkzeug:
 *  - Linksklick + Ziehen: Straße Zelle für Zelle bauen (jedes Segment wird sofort geprüft)
 *  - Rechtsklick + Ziehen: Straßen unter dem Cursor abreißen
 *  - Strg+Z: letzten Strich rückgängig machen
 *
 * Ist der nächste Schritt zu steil, bleibt der Anker auf der letzten gültigen Zelle stehen
 * und eine rote Vorschau zeigt, wohin nicht gebaut werden kann. Der Spieler kann dann
 * entlang der Höhenlinien weiterziehen (Serpentine) – der Bau setzt automatisch fort.
 * Zieht er stattdessen geradeaus über die steile Stelle weiter und besitzt ein Viadukt,
 * wird automatisch ein Viadukt über 2–4 Zellen gespannt (z. B. über eine Quebrada).
 */
export class RoadTool {
  mode: Mode = 'idle';
  /** Letzte erfolgreich erreichte Zelle des aktuellen Bau-Strichs. */
  anchor: NodeId | null = null;
  /** Zielzelle unter dem Cursor (beim Ziehen). */
  cursorNode: NodeId | null = null;
  blocked: BlockedPreview | null = null;
  /** Steigung des zuletzt gebauten Segments (in Fahrtrichtung des Ziehens). */
  lastGrade: number | null = null;
  /** true, wenn ein Weiterziehen in gerader Linie ein Viadukt ermöglichen könnte. */
  viaductHint = false;

  private stroke: Stroke | null = null;
  private eraseLast: Cell | null = null;
  private readonly undoStack: Stroke[] = [];

  constructor(
    private readonly net: RoadNetwork,
    private topo: Topography,
    private readonly events: RoadToolEvents = {},
    public rules?: ConnectionRules,
  ) {}

  setTopography(topo: Topography): void {
    this.topo = topo;
    this.cancel();
    this.undoStack.length = 0;
  }

  /** button: 0 = links (bauen), 2 = rechts (abreißen). */
  pointerDown(button: number, world: Vec2): void {
    const cell = this.topo.cellAt(world.x, world.y);
    if (!cell) return;
    this.stroke = { added: [], removed: [] };
    if (button === 0) {
      this.mode = 'build';
      this.anchor = this.net.id(cell.cx, cell.cy);
      this.cursorNode = this.anchor;
      this.blocked = null;
      this.lastGrade = null;
    } else if (button === 2) {
      this.mode = 'erase';
      this.eraseLast = cell;
      this.eraseCell(cell);
    }
  }

  pointerMove(world: Vec2): void {
    const cell = this.topo.cellAt(world.x, world.y);
    if (!cell) return;
    if (this.mode === 'build') this.extendTo(cell);
    else if (this.mode === 'erase') {
      for (const c of [this.eraseLast ?? cell, ...cellsOnLine(this.eraseLast ?? cell, cell)]) this.eraseCell(c);
      this.eraseLast = cell;
    }
  }

  pointerUp(): void {
    if (this.stroke && (this.stroke.added.length || this.stroke.removed.length)) {
      this.undoStack.push(this.stroke);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.cancel();
  }

  /** Letzten Strich rückgängig machen. */
  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    for (const e of s.added) this.net.removeEdge(e.a, e.b);
    for (const e of s.removed) {
      // Abgerissenes nur wiederherstellen, solange das Budget reicht
      if (this.rules?.connectionRule(e.a, e.b) === 'no-tiles') break;
      this.net.addEdge(e.a, e.b);
    }
    return true;
  }

  get isActive(): boolean {
    return this.mode !== 'idle';
  }

  private cancel(): void {
    this.mode = 'idle';
    this.anchor = null;
    this.cursorNode = null;
    this.blocked = null;
    this.viaductHint = false;
    this.stroke = null;
    this.eraseLast = null;
  }

  /** Baut vom Anker aus Schritt für Schritt Richtung Zielzelle, bis ein Schritt abgelehnt wird. */
  private extendTo(target: Cell): void {
    if (this.anchor === null) return;
    const targetId = this.net.id(target.cx, target.cy);
    this.cursorNode = targetId;
    if (targetId === this.anchor) {
      this.blocked = null;
      return;
    }
    const wasBlocked = this.blocked;
    this.blocked = null;
    this.viaductHint = false;
    const path = cellsOnLine(this.net.cellOf(this.anchor), target);
    for (let i = 0; i < path.length; i++) {
      const next = this.net.id(path[i].cx, path[i].cy);
      const check = checkSegment(this.topo, this.net, this.anchor, next, this.rules);
      if (check.ok) {
        this.commit(this.anchor, next, check.grade, false);
        continue;
      }
      if (check.reason === 'too-steep' || check.reason === 'crossing') {
        const end = this.tryViaduct(path, i);
        if (end !== null) {
          i = end;
          continue;
        }
      }
      this.blocked = { from: this.anchor, to: next, check };
      // Feedback nur beim Wechsel in den blockierten Zustand / auf ein neues Ziel auslösen
      if (!wasBlocked || wasBlocked.to !== next || wasBlocked.from !== this.anchor) this.events.onBlocked?.(check);
      return;
    }
  }

  /**
   * Viadukt ab dem Anker in Richtung path[i], sofern der Cursor-Pfad mindestens zwei Zellen
   * geradeaus weiterführt. Liefert den Pfadindex des Viadukt-Endes oder null.
   */
  private tryViaduct(path: Cell[], i: number): number | null {
    const anchor = this.anchor!;
    const a = this.net.cellOf(anchor);
    const dx = path[i].cx - a.cx;
    const dy = path[i].cy - a.cy;
    let reach = 0;
    for (let k = 1; k <= VIADUCT_MAX_SPAN && i + k - 1 < path.length; k++) {
      const c = path[i + k - 1];
      if (c.cx !== a.cx + dx * k || c.cy !== a.cy + dy * k) break;
      reach = k;
    }
    const available = this.rules?.viaductsAvailable?.() ?? 0;
    for (let k = 2; k <= reach; k++) {
      const b = { cx: a.cx + dx * k, cy: a.cy + dy * k };
      if (!this.net.inBounds(b)) break;
      const end = this.net.id(b.cx, b.cy);
      const check = checkViaduct(this.topo, this.net, anchor, end, this.rules);
      if (check.ok) {
        this.commit(anchor, end, check.grade, true);
        return i + k - 1;
      }
    }
    if (available > 0 && reach < VIADUCT_MAX_SPAN) this.viaductHint = true;
    return null;
  }

  private commit(a: NodeId, b: NodeId, grade: number, viaduct: boolean): void {
    if (this.net.addEdge(a, b)) {
      this.stroke?.added.push(a < b ? { a, b } : { a: b, b: a });
      this.events.onBuild?.(grade, viaduct);
    }
    this.lastGrade = grade;
    this.anchor = b;
  }

  private eraseCell(c: Cell): void {
    const id = this.net.id(c.cx, c.cy);
    const removed = this.net.removeNode(id);
    // Viadukte, die über diese Zelle führen, ebenfalls abreißen
    for (const e of this.net.longEdges()) {
      if (this.net.spannedCells(e.a, e.b).includes(id) && this.net.removeEdge(e.a, e.b)) removed.push(e);
    }
    if (removed.length) {
      this.stroke?.removed.push(...removed);
      this.events.onErase?.();
    }
  }
}
