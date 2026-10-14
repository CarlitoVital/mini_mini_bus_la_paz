import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/config';
import { SimplexNoise2D } from '../src/core/noise';
import { Topography } from '../src/terrain/Topography';
import { extractContours } from '../src/terrain/contours';

const topo = new Topography(1548);
const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;

describe('SimplexNoise2D', () => {
  it('ist deterministisch pro Seed', () => {
    const a = new SimplexNoise2D(42);
    const b = new SimplexNoise2D(42);
    expect(a.noise(1.3, 4.2)).toBe(b.noise(1.3, 4.2));
    expect(new SimplexNoise2D(43).noise(1.3, 4.2)).not.toBe(a.noise(1.3, 4.2));
  });
});

describe('Topography (La Paz / El Alto)', () => {
  it('nutzt den vollen Höhenbereich 3.200–4.150 m', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const h of topo.heights) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
  });

  it('El Alto (Westen) liegt auf dem Plateau, Zona Sur (Südosten) im Talkessel', () => {
    expect(topo.metersAt(W * 0.08, H * 0.3)).toBeGreaterThan(3950);
    expect(topo.metersAt(W * 0.78, H * 0.97)).toBeLessThan(3400);
  });

  it('das Zentrum liegt im mittleren Höhenbereich (~3.600 m)', () => {
    const m = topo.metersAt(W * 0.5, H * 0.5);
    expect(m).toBeGreaterThan(3450);
    expect(m).toBeLessThan(3850);
  });

  it('der Fluss fällt von Nord nach Süd', () => {
    const north = topo.river[2];
    const south = topo.river[topo.river.length - 3];
    expect(topo.metersAt(north.x, north.y)).toBeGreaterThan(topo.metersAt(south.x, south.y) + 200);
  });

  it('die Ceja ist deutlich steiler als das Plateau', () => {
    let maxGrade = 0;
    for (let x = 0.15; x < 0.5; x += 0.005) maxGrade = Math.max(maxGrade, topo.terrainGradeAt(W * x, H * 0.35));
    expect(maxGrade).toBeGreaterThan(0.3);
    expect(topo.terrainGradeAt(W * 0.08, H * 0.3)).toBeLessThan(0.1);
  });

  it('ordnet Stadtteile zu', () => {
    expect(topo.zoneAt(W * 0.08, H * 0.3)).toBe('El Alto');
    expect(topo.zoneAt(W * 0.78, H * 0.97)).toBe('Zona Sur');
  });
});

describe('extractContours', () => {
  it('findet einen geschlossenen Ring um einen Hügel', () => {
    const w = 9;
    const h = 9;
    const heights = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) heights[y * w + x] = 1 - Math.hypot(x - 4, y - 4) / 6;
    const contours = extractContours(heights, w, h, 0.5);
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);
    for (const p of contours[0].points) expect(Math.hypot(p.x - 4, p.y - 4)).toBeCloseTo(3, 0);
  });
});
