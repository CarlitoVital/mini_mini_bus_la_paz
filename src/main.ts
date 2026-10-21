import './style.css';
import { DEFAULT_SEED } from './config';
import { Game } from './game/Game';

function readSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEED;
}

new Game(document.querySelector<HTMLDivElement>('#app')!, document.querySelector<HTMLCanvasElement>('#game')!, readSeed());
