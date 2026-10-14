import './style.css';
import { DEFAULT_SEED, GRID_COLS, GRID_ROWS, METERS_PER_WU, WORLD_HEIGHT, WORLD_WIDTH } from './config';
import { GameLoop } from './core/GameLoop';
import { InputController } from './input/InputController';
import { Camera } from './render/Camera';
import { Renderer } from './render/Renderer';
import { RoadNetwork } from './roads/RoadNetwork';
import { REJECTION_TEXT, gradeStatus, segmentGrade } from './roads/RoadRules';
import { RoadTool } from './roads/RoadTool';
import { Topography } from './terrain/Topography';
import { createLegend } from './ui/Legend';
import { Tooltip } from './ui/Tooltip';

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
const roadTool = new RoadTool(network, topo);
const renderer = new Renderer(canvas, topo, camera, network, roadTool);
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
  // N: neue Karte mit zufälligem Seed (Straßennetz wird geleert)
  if (e.code === 'KeyN' && !roadTool.isActive) {
    const seed = Math.floor(Math.random() * 1_000_000);
    topo = new Topography(seed);
    network.clear();
    roadTool.setTopography(topo);
    renderer.setTopography(topo);
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
  if (!topo.cellAt(w.x, w.y)) return tooltip.hide();
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

const loop = new GameLoop(
  () => {
    // Simulation folgt in Phase 3 (Minibusse, Spawning).
  },
  (frameDt) => {
    input.update(frameDt);
    updateTooltip();
    updateStats();

    let hoverCell: { cx: number; cy: number } | null = null;
    if (input.pointer && !input.isPanning) {
      const w = camera.screenToWorld(input.pointer.x, input.pointer.y);
      hoverCell = topo.cellAt(w.x, w.y);
    }
    renderer.render({ hoverCell });
  },
);
loop.start();
