import { Sound } from '../audio/Sound';
import {
  BUS_BASE_SPEED,
  BUS_CAPACITY,
  BUSES_PER_HOUSE,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  METERS_PER_WU,
  WEEKLY_ROAD_TILES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../config';
import { GameLoop } from '../core/GameLoop';
import type { Vec2 } from '../core/math';
import { mulberry32 } from '../core/random';
import { InputController } from '../input/InputController';
import { Camera } from '../render/Camera';
import { LINE_COLORS, LINE_NAMES } from '../render/palette';
import { Renderer } from '../render/Renderer';
import { RoadNetwork } from '../roads/RoadNetwork';
import { REJECTION_TEXT, gradeStatus, segmentGrade } from '../roads/RoadRules';
import { RoadTool } from '../roads/RoadTool';
import type { Building, Market } from '../sim/Buildings';
import type { BusState, Minibus } from '../sim/Minibus';
import { Simulation } from '../sim/Simulation';
import { Topography } from '../terrain/Topography';
import { Hud, type SpeedSetting } from '../ui/Hud';
import { InventoryBar } from '../ui/InventoryBar';
import { createLegend } from '../ui/Legend';
import { type ChoiceCard, Modal } from '../ui/Modal';
import { Tooltip, formatGrade } from '../ui/Tooltip';
import { Inventory, type ItemKind, type JunctionUpgrade, PLACE_REJECTION_TEXT } from './Inventory';

const BEST_SCORE_KEY = 'mini-minibuses-lapaz:best';

/** Wochen-Extras, aus denen jeweils zwei zur Wahl stehen. */
const REWARDS: { kind: ItemKind; n: number; title: string; text: string }[] = [
  { kind: 'roundabout', n: 1, title: 'Kreisverkehr', text: 'Alle Richtungen fahren gleichzeitig – dafür langsam.' },
  { kind: 'light', n: 1, title: 'Ampel', text: 'Wechselnde Grünphasen lassen ganze Kolonnen durch.' },
  { kind: 'viaduct', n: 2, title: '2 Viadukte', text: 'Überspannen Quebradas und Steilstellen (bis 4 Zellen).' },
  { kind: 'tiles', n: 20, title: '+20 Straßenteile', text: 'Mehr Asphalt für neue Serpentinen.' },
];

const BUS_STATE_TEXT: Record<BusState, string> = {
  parked: 'in der Garage',
  toMarket: 'fährt zum Markt',
  loading: 'Fahrgäste steigen ein',
  toHome: 'fährt heim',
  unloading: 'Fahrgäste steigen aus',
  lost: 'kein Weg – kehrt um',
};

const kmFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numberFormat = new Intl.NumberFormat('de-DE');

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(n: number): void {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(n));
  } catch {
    /* privater Modus o. Ä. – Rekord ist nur eine Annehmlichkeit */
  }
}

/**
 * Das Spiel: verbindet Gelände, Straßennetz, Simulation, Inventar, Darstellung,
 * Eingabe, UI und Sound und steuert den Ablauf (Intro → Wochen → Game Over).
 */
export class Game {
  private topo: Topography;
  private readonly network = new RoadNetwork(GRID_COLS, GRID_ROWS);
  private sim: Simulation;
  private inventory: Inventory;
  private readonly camera = new Camera(WORLD_WIDTH, WORLD_HEIGHT);
  private readonly roadTool: RoadTool;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly loop: GameLoop;
  private readonly tooltip: Tooltip;
  private readonly hud: Hud;
  private readonly invBar: InventoryBar;
  private readonly modal: Modal;
  private readonly sound = new Sound();
  private readonly hints: HTMLElement;
  private readonly seedLabel: HTMLElement;
  private readonly statsLabel: HTMLElement;

  private placing: JunctionUpgrade | null = null;
  private resumeSpeed: SpeedSetting = 1;
  private focus: Vec2 | null = null;
  private statsVersion = -1;
  private rewardRand: () => number;
  private gameOver = false;

  constructor(
    app: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    seed: number,
  ) {
    this.seedLabel = document.querySelector('#seed')!;
    this.statsLabel = document.querySelector('#stats')!;
    this.hints = document.querySelector('.hints')!;

    this.topo = new Topography(seed);
    this.sim = this.createSimulation();
    this.inventory = this.createInventory();
    this.rewardRand = mulberry32(seed + 77);

    this.roadTool = new RoadTool(
      this.network,
      this.topo,
      {
        onBuild: (_g, viaduct) => this.sound.play(viaduct ? 'viaduct' : 'build'),
        onBlocked: (check) => {
          this.sound.play('blocked');
          if (check.reason === 'no-tiles') this.invBar.flash('tiles');
        },
        onErase: () => this.sound.play('erase'),
      },
      this.inventory,
    );
    this.renderer = new Renderer(canvas, this.topo, this.camera, this.network, this.roadTool, this.sim);
    this.wireRendererSources();

    this.loop = new GameLoop(
      (dt) => this.sim.update(dt),
      (frameDt) => this.frame(frameDt),
    );
    this.hud = new Hud(app, (s) => (this.loop.timeScale = s));
    this.hud.onMute = () => this.toggleMute();
    this.hud.onHelp = () => this.hints.classList.toggle('visible');
    this.invBar = new InventoryBar(app, (kind) => this.setPlacing(kind));
    this.tooltip = new Tooltip(app);
    this.modal = new Modal(app);
    createLegend(app);

    this.input = new InputController(canvas, this.camera);
    this.input.tool = {
      pointerDown: (button, s) => this.pointerDown(button, s),
      pointerMove: (s) => this.roadTool.pointerMove(this.camera.screenToWorld(s.x, s.y)),
      pointerUp: () => this.roadTool.pointerUp(),
    };

    this.seedLabel.textContent = String(seed);
    this.renderer.resize();
    this.camera.fitWorld();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Audio darf erst nach einer Nutzeraktion starten
    window.addEventListener('pointerdown', () => this.sound.unlock(), { once: false });

    this.loop.start();
    this.showIntro();
  }

  // ---------------------------------------------------------------------------
  // Aufbau / Neustart
  // ---------------------------------------------------------------------------

  private createSimulation(): Simulation {
    const sim = new Simulation(this.topo, this.network, this.topo.seed, {
      onDelivered: () => this.sound.play('deliver'),
      onSpawn: (kind) => this.sound.play(kind === 'house' ? 'spawnHouse' : 'spawnMarket'),
      onWeekEnd: (week) => this.onWeekEnd(week),
      onOverflow: (m) => this.onOverflow(m),
    });
    return sim;
  }

  private createInventory(): Inventory {
    const inv = new Inventory(this.network, this.sim.buildings);
    this.sim.junctionUpgrade = (n) => inv.junction(n);
    return inv;
  }

  private wireRendererSources(): void {
    this.renderer.roads.upgradeAt = (n) => this.inventory.junction(n);
    this.renderer.roads.lightPhase = (n) => this.sim.lightPhase(n);
  }

  newGame(seed: number): void {
    this.topo = new Topography(seed);
    this.network.clear();
    this.sim = this.createSimulation();
    this.inventory = this.createInventory();
    this.rewardRand = mulberry32(seed + 77);
    this.roadTool.setTopography(this.topo);
    this.roadTool.rules = this.inventory;
    this.renderer.setWorld(this.topo, this.sim);
    this.renderer.roads.rules = this.inventory;
    this.wireRendererSources();
    this.setPlacing(null);
    this.invBar.select(null);
    this.focus = null;
    this.gameOver = false;
    this.camera.fitWorld();
    this.seedLabel.textContent = String(seed);
    history.replaceState(null, '', `?seed=${seed}`);
    this.hud.setSpeed(1);
  }

  // ---------------------------------------------------------------------------
  // Ablauf: Intro, Wochenende, Game Over
  // ---------------------------------------------------------------------------

  private pause(): void {
    if (this.hud.speed !== 0) this.resumeSpeed = this.hud.speed;
    this.hud.setSpeed(0);
  }

  private resume(): void {
    this.hud.setSpeed(this.resumeSpeed || 1);
  }

  private showIntro(): void {
    this.pause();
    this.modal.show({
      kicker: 'La Paz & El Alto',
      title: 'Mini Minibuses',
      body: `Verbinde die <strong>Garajes</strong> mit den <strong>Mercados</strong> derselben Farbe.
        Minibusse holen dort wartende Fahrgäste ab und bringen sie heim.
        <ul>
          <li><strong>Linksklick + Ziehen:</strong> Straße bauen – höchstens 15 % Steigung, sonst Serpentinen!</li>
          <li><strong>Rechtsklick + Ziehen:</strong> abreißen (Teile kommen zurück)</li>
          <li>Nach <strong>El Alto</strong> führen nur die <strong>Rampas</strong> durch die Ceja.</li>
          <li>Bergauf kriechen die Busse – plane flache Umwege und vermeide Staus.</li>
          <li>Läuft ein Markt über, ist das Spiel vorbei.</li>
        </ul>`,
      buttons: [{ label: "¡Vamos! Los geht's", primary: true, onClick: () => this.start() }],
    });
  }

  private start(): void {
    this.sound.unlock();
    this.sound.play('click');
    this.resumeSpeed = 1;
    this.resume();
  }

  private onWeekEnd(week: number): void {
    this.pause();
    this.sound.play('week');
    this.inventory.add('tiles', WEEKLY_ROAD_TILES);
    // Zwei verschiedene Extras zufällig anbieten
    const pool = [...REWARDS];
    const offers = [pool.splice(Math.floor(this.rewardRand() * pool.length), 1)[0], pool.splice(Math.floor(this.rewardRand() * pool.length), 1)[0]];
    const choices: ChoiceCard[] = offers.map((r) => ({
      icon: this.itemIcon(r.kind),
      title: r.title,
      text: r.text,
      onPick: () => {
        this.inventory.add(r.kind, r.n);
        this.sound.play('place');
        this.resume();
      },
    }));
    this.modal.show({
      kicker: `Woche ${week}`,
      title: 'Neue Woche, neue Straßen',
      body: `Die Alcaldía schickt <strong>+${WEEKLY_ROAD_TILES} Straßenteile</strong>. Wähle zusätzlich ein Extra:`,
      choices,
    });
  }

  private onOverflow(m: Market): void {
    this.sim.halted = true;
    this.gameOver = true;
    this.setPlacing(null);
    this.roadTool.pointerUp();
    this.sound.play('gameOver');
    this.focus = { x: (m.origin.cx + 1) * CELL_SIZE, y: (m.origin.cy + 1) * CELL_SIZE };
    const previousBest = readBest();
    const isRecord = this.sim.score > previousBest;
    const best = Math.max(previousBest, this.sim.score);
    writeBest(best);
    window.setTimeout(() => {
      this.modal.show({
        kicker: `Woche ${this.sim.week} · Tag ${this.sim.day + 1}`,
        title: 'Stau in La Paz!',
        tone: 'alert',
        body: `Der <strong>Mercado ${LINE_NAMES[m.color]}</strong> ist überlastet – die Fahrgäste warten vergeblich.
          <div class="modal-stats">
            <div><b>${numberFormat.format(this.sim.score)}</b>Fahrgäste befördert</div>
            <div><b>${this.sim.day + 1}</b>Tage durchgehalten</div>
            <div><b>${numberFormat.format(best)}</b>${isRecord ? 'Neuer Rekord!' : 'Rekord'}</div>
          </div>`,
        buttons: [
          { label: 'Gleiche Karte', onClick: () => this.newGame(this.topo.seed) },
          { label: 'Neue Karte', primary: true, onClick: () => this.newGame(Math.floor(Math.random() * 1_000_000)) },
        ],
      });
    }, 1400);
  }

  private itemIcon(kind: ItemKind): string {
    return document.querySelector(`.inv-${kind} svg`)?.outerHTML ?? '';
  }

  // ---------------------------------------------------------------------------
  // Eingabe
  // ---------------------------------------------------------------------------

  private setPlacing(kind: JunctionUpgrade | null): void {
    this.placing = kind;
    this.canvas.classList.toggle('placing', kind !== null);
  }

  private pointerDown(button: number, screen: Vec2): void {
    if (this.gameOver) return;
    const w = this.camera.screenToWorld(screen.x, screen.y);
    if (this.placing) {
      if (button === 2) {
        this.invBar.select(null);
        return;
      }
      const cell = this.topo.cellAt(w.x, w.y);
      if (!cell) return;
      const reason = this.inventory.place(this.placing, this.network.id(cell.cx, cell.cy));
      if (reason) {
        this.sound.play('blocked');
        this.hud.toast(PLACE_REJECTION_TEXT[reason], 2);
      } else {
        this.sound.play('place');
        this.invBar.select(null);
      }
      return;
    }
    this.roadTool.pointerDown(button, w);
  }

  private toggleMute(): void {
    this.sound.unlock();
    this.sound.setMuted(!this.sound.muted);
    this.hud.setMuted(this.sound.muted);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.modal.isOpen) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (!this.gameOver) this.roadTool.undo();
      return;
    }
    switch (e.code) {
      case 'Escape':
        this.invBar.select(null);
        break;
      case 'KeyM':
        this.toggleMute();
        break;
      case 'KeyH':
        this.hints.classList.toggle('visible');
        break;
      case 'KeyN':
        if (!this.roadTool.isActive) this.newGame(Math.floor(Math.random() * 1_000_000));
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private frame(frameDt: number): void {
    this.input.update(frameDt);
    this.updateCameraFocus(frameDt);
    this.updateTooltip();
    this.updateStats();
    this.hud.update(this.sim.score, this.sim.day, this.sim.dayFraction, frameDt);
    this.invBar.update(this.inventory);
    if (!this.gameOver && this.loop.timeScale > 0 && this.sim.buildings.markets.some((m) => m.overload > 0.6)) {
      this.sound.play('warning');
    }

    let hoverCell: { cx: number; cy: number } | null = null;
    let placement: { node: number; ok: boolean } | null = null;
    if (this.input.pointer && !this.input.isPanning) {
      const w = this.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y);
      hoverCell = this.topo.cellAt(w.x, w.y);
      if (hoverCell && this.placing) {
        const node = this.network.id(hoverCell.cx, hoverCell.cy);
        placement = { node, ok: this.inventory.canPlace(this.placing, node) === null };
      }
    }
    this.renderer.render({ hoverCell, placement });
  }

  /** Beim Game Over sanft zum übergelaufenen Markt schwenken. */
  private updateCameraFocus(dt: number): void {
    if (!this.focus) return;
    const k = Math.min(1, dt * 3);
    this.camera.x += (this.focus.x - this.camera.x) * k;
    this.camera.y += (this.focus.y - this.camera.y) * k;
    const targetZoom = Math.max(this.camera.zoom, 1.3);
    this.camera.zoom += (targetZoom - this.camera.zoom) * k;
  }

  private updateStats(): void {
    if (this.statsVersion === this.network.version) return;
    this.statsVersion = this.network.version;
    let lengthWu = 0;
    for (const e of this.network.edges()) lengthWu += this.network.edgeLength(e.a, e.b);
    this.statsLabel.textContent = `Straßennetz ${kmFormat.format((lengthWu * METERS_PER_WU) / 1000)} km · ${this.network.edgeCount} Segmente`;
  }

  private updateTooltip(): void {
    const { input, tooltip, roadTool } = this;
    if (!input.pointer || input.isPanning || this.modal.isOpen) return tooltip.hide();

    if (roadTool.mode === 'build') {
      const blocked = roadTool.blocked;
      if (blocked) {
        let message = REJECTION_TEXT[blocked.check.reason ?? 'too-steep'];
        if (roadTool.viaductHint && blocked.check.reason === 'too-steep') {
          message = `Zu steil! Serpentine – oder geradeaus weiterziehen für ein Viadukt (${this.inventory.available('viaduct')} übrig)`;
        }
        tooltip.showBuild(input.pointer, { grade: blocked.check.grade, status: 'blocked', message });
      } else if (roadTool.lastGrade !== null) {
        tooltip.showBuild(input.pointer, { grade: roadTool.lastGrade, status: gradeStatus(roadTool.lastGrade) });
      } else {
        tooltip.hide();
      }
      return;
    }
    if (roadTool.mode === 'erase') return tooltip.hide();

    const w = this.camera.screenToWorld(input.pointer.x, input.pointer.y);
    const cell = this.topo.cellAt(w.x, w.y);
    if (!cell) return tooltip.hide();

    if (this.placing) {
      const reason = this.inventory.canPlace(this.placing, this.network.id(cell.cx, cell.cy));
      const name = this.placing === 'roundabout' ? 'Kreisverkehr' : 'Ampel';
      return tooltip.showInfo(input.pointer, `${name} setzen`, '#3b332b', [
        reason ? PLACE_REJECTION_TEXT[reason] : 'Klicken zum Platzieren · Rechtsklick/Esc bricht ab',
      ]);
    }

    const bus = this.renderer.simRenderer.busAt(w);
    if (bus) return this.showBusInfo(input.pointer, bus);
    const building = this.sim.buildings.at(this.network.id(cell.cx, cell.cy));
    if (building) return this.showBuildingInfo(input.pointer, building);

    const edge = this.network.edgeNear(w, this.topo.cellSize * 0.3);
    const roadGrade = edge ? Math.abs(segmentGrade(this.topo, this.network, edge.a, edge.b)) : undefined;
    tooltip.showTerrain(input.pointer, {
      meters: this.topo.metersAt(w.x, w.y),
      grade: this.topo.terrainGradeAt(w.x, w.y),
      zone: this.topo.zoneAt(w.x, w.y),
      roadGrade,
      roadStatus: roadGrade === undefined ? undefined : gradeStatus(roadGrade),
    });
  }

  private showBusInfo(screen: Vec2, bus: Minibus): void {
    const lines = [`${bus.passengers}/${BUS_CAPACITY} Fahrgäste · ${BUS_STATE_TEXT[bus.state]}`];
    if (bus.isMoving) {
      lines.push(`Steigung ${formatGrade(bus.grade)} · Tempo ${Math.round((bus.speed / BUS_BASE_SPEED) * 100)} %`);
    }
    this.tooltip.showInfo(screen, `Minibus ${LINE_NAMES[bus.color]}`, LINE_COLORS[bus.color], lines);
  }

  private showBuildingInfo(screen: Vec2, b: Building): void {
    const connected = this.network.hasEdge(b.entrance, b.driveway);
    const lines: string[] = [];
    if (b.kind === 'market') {
      lines.push(`${b.pins} wartend · ${b.claimed} zugeteilt`);
      if (b.overload > 0) lines.push(`Überlastung ${Math.round(b.overload * 100)} %`);
    } else {
      lines.push(`${b.parked}/${BUSES_PER_HOUSE} Busse in der Garage`);
    }
    if (!connected) lines.push('Nicht angeschlossen – Straße zur Zufahrt bauen');
    const title = `${b.kind === 'market' ? 'Mercado' : 'Garaje'} ${LINE_NAMES[b.color]}`;
    this.tooltip.showInfo(screen, title, LINE_COLORS[b.color], lines);
  }
}
