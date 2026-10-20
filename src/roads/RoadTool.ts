import type { Vec2 } from '../core/math';
import type { Topography } from '../terrain/Topography';
import { type Cell, type Edge, type NodeId, type RoadNetwork, cellsOnLine } from './RoadNetwork';
import { type BuildCheck, type ConnectionRules, checkSegment } from './RoadRules';

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
  onBuild?: (grade: number) => void;
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
    for (const e of s.removed) this.net.addEdge(e.a, e.b);
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
    for (const c of cellsOnLine(this.net.cellOf(this.anchor), target)) {
      const next = this.net.id(c.cx, c.cy);
      const check = checkSegment(this.topo, this.net, this.anchor, next, this.rules);
      if (!check.ok) {
        this.blocked = { from: this.anchor, to: next, check };
        // Feedback nur beim Wechsel in den blockierten Zustand / auf ein neues Ziel auslösen
        if (!wasBlocked || wasBlocked.to !== next || wasBlocked.from !== this.anchor) this.events.onBlocked?.(check);
        return;
      }
      if (this.net.addEdge(this.anchor, next)) {
        this.stroke?.added.push(this.anchor < next ? { a: this.anchor, b: next } : { a: next, b: this.anchor });
        this.events.onBuild?.(check.grade);
      }
      this.lastGrade = check.grade;
      this.anchor = next;
    }
  }

  private eraseCell(c: Cell): void {
    const removed = this.net.removeNode(this.net.id(c.cx, c.cy));
    if (removed.length) {
      this.stroke?.removed.push(...removed);
      this.events.onErase?.();
    }
  }
}
