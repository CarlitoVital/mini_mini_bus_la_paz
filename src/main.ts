import './style.css';
import {
  BUS_BASE_SPEED,
  BUS_CAPACITY,
  BUSES_PER_HOUSE,
  DEFAULT_SEED,
  GRID_COLS,
  GRID_ROWS,
  METERS_PER_WU,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './config';
import type { Vec2 } from './core/math';
import { GameLoop } from './core/GameLoop';
import { InputController } from './input/InputController';
import { Camera } from './render/Camera';
import { LINE_COLORS, LINE_NAMES } from './render/palette';
import { Renderer } from './render/Renderer';
import { RoadNetwork } from './roads/RoadNetwork';
import { REJECTION_TEXT, gradeStatus, segmentGrade } from './roads/RoadRules';
import { RoadTool } from './roads/RoadTool';
import type { Building } from './sim/Buildings';
import type { BusState, Minibus } from './sim/Minibus';
import { Simulation } from './sim/Simulation';
import { Topography } from './terrain/Topography';
import { Hud } from './ui/Hud';
import { createLegend } from './ui/Legend';
import { Tooltip, formatGrade } from './ui/Tooltip';

function readSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEED;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const seedLabel = document.querySelector<HTMLSpanElement>('#seed')!;
const statsLabel = document.querySelector<HTMLDivElement>('#stats')!;

let topo = new Topography(readSeed());
const camera = new Camera(WORLD_WIDTH, WORLD_HEIGHT);
const network = new RoadNetwork(GRID_COLS, GRID_ROWS);
const loop = new GameLoop(
  (dt) => sim.update(dt),
  (frameDt) => frame(frameDt),
);
const hud = new Hud(app, (s) => (loop.timeScale = s));
const simEvents = {
  onOverflow: () => hud.toast('Ein Markt ist überlastet! (Game Over folgt in Phase 4)'),
};
let sim = new Simulation(topo, network, topo.seed, simEvents);
const roadTool = new RoadTool(network, topo, {}, sim.buildings);
const renderer = new Renderer(canvas, topo, camera, network, roadTool, sim);
const input = new InputController(canvas, camera);
const tooltip = new Tooltip(app);
createLegend(app);

// Links-/Rechtsklick-Gesten in Weltkoordinaten an das Straßenwerkzeug weiterreichen
input.tool = {
  pointerDown: (button, s) => roadTool.pointerDown(button, camera.screenToWorld(s.x, s.y)),
  pointerMove: (s) => roadTool.pointerMove(camera.screenToWorld(s.x, s.y)),
  pointerUp: () => roadTool.pointerUp(),
};

seedLabel.textContent = String(topo.seed);
renderer.resize();
camera.fitWorld();
window.addEventListener('resize', () => renderer.resize());

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    roadTool.undo();
    return;
  }
  // N: neue Karte mit zufälligem Seed (Straßennetz und Simulation werden zurückgesetzt)
  if (e.code === 'KeyN' && !roadTool.isActive) {
    const seed = Math.floor(Math.random() * 1_000_000);
    topo = new Topography(seed);
    network.clear();
    sim = new Simulation(topo, network, seed, simEvents);
    roadTool.setTopography(topo);
    roadTool.rules = sim.buildings;
    renderer.setWorld(topo, sim);
    seedLabel.textContent = String(seed);
    history.replaceState(null, '', `?seed=${seed}`);
  }
});

const kmFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let statsVersion = -1;
function updateStats(): void {
  if (statsVersion === network.version) return;
  statsVersion = network.version;
  let lengthWu = 0;
  for (const e of network.edges()) lengthWu += network.edgeLength(e.a, e.b);
  statsLabel.textContent = `Straßennetz ${kmFormat.format((lengthWu * METERS_PER_WU) / 1000)} km · ${network.edgeCount} Segmente`;
}

const BUS_STATE_TEXT: Record<BusState, string> = {
  parked: 'in der Garage',
  toMarket: 'fährt zum Markt',
  loading: 'Fahrgäste steigen ein',
  toHome: 'fährt heim',
  unloading: 'Fahrgäste steigen aus',
  lost: 'kein Weg – kehrt um',
};

function showBusInfo(screen: Vec2, bus: Minibus): void {
  const lines = [`${bus.passengers}/${BUS_CAPACITY} Fahrgäste · ${BUS_STATE_TEXT[bus.state]}`];
  if (bus.isMoving) {
    lines.push(`Steigung ${formatGrade(bus.grade)} · Tempo ${Math.round((bus.speed / BUS_BASE_SPEED) * 100)} %`);
  }
  tooltip.showInfo(screen, `Minibus ${LINE_NAMES[bus.color]}`, LINE_COLORS[bus.color], lines);
}

function showBuildingInfo(screen: Vec2, b: Building): void {
  const connected = network.hasEdge(b.entrance, b.driveway);
  const lines: string[] = [];
  if (b.kind === 'market') {
    lines.push(`${b.pins} wartend · ${b.claimed} zugeteilt`);
    if (b.overload > 0) lines.push(`Überlastung ${Math.round(b.overload * 100)} %`);
  } else {
    lines.push(`${b.parked}/${BUSES_PER_HOUSE} Busse in der Garage`);
  }
  if (!connected) lines.push('Nicht angeschlossen – Straße zur Zufahrt bauen');
  const title = `${b.kind === 'market' ? 'Mercado' : 'Garaje'} ${LINE_NAMES[b.color]}`;
  tooltip.showInfo(screen, title, LINE_COLORS[b.color], lines);
}

function updateTooltip(): void {
  if (!input.pointer || input.isPanning) return tooltip.hide();

  if (roadTool.mode === 'build') {
    const blocked = roadTool.blocked;
    if (blocked) {
      tooltip.showBuild(input.pointer, {
        grade: blocked.check.grade,
        status: 'blocked',
        message: REJECTION_TEXT[blocked.check.reason ?? 'too-steep'],
      });
    } else if (roadTool.lastGrade !== null) {
      tooltip.showBuild(input.pointer, { grade: roadTool.lastGrade, status: gradeStatus(roadTool.lastGrade) });
    } else {
      tooltip.hide();
    }
    return;
  }
  if (roadTool.mode === 'erase') return tooltip.hide();

  const w = camera.screenToWorld(input.pointer.x, input.pointer.y);
  const cell = topo.cellAt(w.x, w.y);
  if (!cell) return tooltip.hide();

  const bus = renderer.simRenderer.busAt(w);
  if (bus) return showBusInfo(input.pointer, bus);
  const building = sim.buildings.at(network.id(cell.cx, cell.cy));
  if (building) return showBuildingInfo(input.pointer, building);

  const edge = network.edgeNear(w, topo.cellSize * 0.3);
  const roadGrade = edge ? Math.abs(segmentGrade(topo, network, edge.a, edge.b)) : undefined;
  tooltip.showTerrain(input.pointer, {
    meters: topo.metersAt(w.x, w.y),
    grade: topo.terrainGradeAt(w.x, w.y),
    zone: topo.zoneAt(w.x, w.y),
    roadGrade,
    roadStatus: roadGrade === undefined ? undefined : gradeStatus(roadGrade),
  });
}

function frame(frameDt: number): void {
  input.update(frameDt);
  updateTooltip();
  updateStats();
  hud.update(sim.score, sim.day, sim.dayFraction, frameDt);

  let hoverCell: { cx: number; cy: number } | null = null;
  if (input.pointer && !input.isPanning) {
    const w = camera.screenToWorld(input.pointer.x, input.pointer.y);
    hoverCell = topo.cellAt(w.x, w.y);
  }
  renderer.render({ hoverCell });
}

loop.start();
