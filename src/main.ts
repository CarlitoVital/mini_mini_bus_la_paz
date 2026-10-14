import './style.css';
import { DEFAULT_SEED, WORLD_HEIGHT, WORLD_WIDTH } from './config';
import { GameLoop } from './core/GameLoop';
import { InputController } from './input/InputController';
import { Camera } from './render/Camera';
import { Renderer } from './render/Renderer';
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

let topo = new Topography(readSeed());
const camera = new Camera(WORLD_WIDTH, WORLD_HEIGHT);
const renderer = new Renderer(canvas, topo, camera);
const input = new InputController(canvas, camera);
const tooltip = new Tooltip(app);
createLegend(app);

const seedLabel = document.querySelector<HTMLSpanElement>('#seed')!;
seedLabel.textContent = String(topo.seed);

renderer.resize();
camera.fitWorld();
window.addEventListener('resize', () => renderer.resize());

// N: neue Karte mit zufälligem Seed (Debug-Hilfe für die Topografie)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyN') return;
  const seed = Math.floor(Math.random() * 1_000_000);
  topo = new Topography(seed);
  renderer.setTopography(topo);
  seedLabel.textContent = String(seed);
  history.replaceState(null, '', `?seed=${seed}`);
});

const loop = new GameLoop(
  () => {
    // Simulation folgt in Phase 3 (Minibusse, Spawning).
  },
  (frameDt) => {
    input.update(frameDt);

    let hoverCell: { cx: number; cy: number } | null = null;
    if (input.pointer && !input.isPanning) {
      const w = camera.screenToWorld(input.pointer.x, input.pointer.y);
      hoverCell = topo.cellAt(w.x, w.y);
      if (hoverCell) {
        tooltip.show(input.pointer, {
          meters: topo.metersAt(w.x, w.y),
          grade: topo.terrainGradeAt(w.x, w.y),
          zone: topo.zoneAt(w.x, w.y),
        });
      } else {
        tooltip.hide();
      }
    } else {
      tooltip.hide();
    }

    renderer.render({ hoverCell });
  },
);
loop.start();
