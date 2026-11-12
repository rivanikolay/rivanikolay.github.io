'use strict';

// The maths behind the contour map in the hero (assets/js/hero-map.js).

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const m = require('../assets/js/hero-map.js');

// Builds RGBA pixels like dem.png has them: height in decimetres, red = high byte, green = low byte.
function pixels(heights) {
  const px = new Uint8ClampedArray(heights.length * 4);
  heights.forEach((metres, i) => {
    const dm = Math.round(metres * 10);
    px[i * 4] = dm >> 8;
    px[i * 4 + 1] = dm & 255;
    px[i * 4 + 3] = 255;
  });
  return px;
}

// Runs the step-by-step march to the end and collects every segment.
function contours(F, cols, rows, step) {
  const segments = [];
  const steps = m.march({ F: Float32Array.from(F), cols, rows }, step, (level, x1, y1, x2, y2) => {
    segments.push({ level, from: [x1, y1], to: [x2, y2] });
  });
  for (const pause of steps) void pause;
  return segments;
}

describe('decodeHeights(): dem.png → heights and water', () => {
  it('reads heights in decimetres from the red and green bytes', () => {
    const { dem } = m.decodeHeights(pixels([405.9, 1234.5, 0, 6553.5]), 4, 1);
    assert.deepEqual([...dem].map((v) => Number(v.toFixed(1))), [405.9, 1234.5, 0, 6553.5]);
  });

  it('marks a flat area at lake level as water, but not the hills around it', () => {
    const L = m.LAKE;
    // 5 × 5: a flat lake in the middle, hills at the edge.
    const grid = [
      600, 600, 600, 600, 600,
      600, L, L, L, 600,
      600, L, L, L, 600,
      600, L, L, L, 600,
      600, 600, 600, 600, 600,
    ];
    const { water } = m.decodeHeights(pixels(grid), 5, 5);
    assert.equal(water[2 * 5 + 2], 1, 'centre of the lake');
    assert.equal(water[0], 0, 'corner hill');
    assert.equal(water[1 * 5 + 2], 1, 'shore cell at lake level, directly next to open water');
    assert.equal(water[1 * 5 + 1], 0, 'only diagonal to open water: counted as land');
  });

  it('never marks a slope as water', () => {
    const slope = Array.from({ length: 25 }, (_, i) => 400 + i * 3);
    const { water } = m.decodeHeights(pixels(slope), 5, 5);
    assert.ok([...water].every((w) => w === 0));
  });

  it('only extends water to shore cells that are at lake level', () => {
    // Flat ground at 500 m forms a "core" in the middle, but its sloping edge is far above the lake.
    const grid = [
      520, 520, 520, 520, 520,
      520, 500, 500, 500, 520,
      520, 500, 500, 500, 520,
      520, 500, 500, 500, 520,
      520, 520, 520, 520, 520,
    ];
    const { water } = m.decodeHeights(pixels(grid), 5, 5);
    assert.equal(water[12], 1, 'the perfectly flat centre counts as water');
    assert.equal(water[7], 0, 'its neighbour at 500 m is not lake level, so it stays land');
  });
});

describe('march(): contour lines', () => {
  it('draws a closed diamond around a single hill', () => {
    const segs = contours([400, 400, 400, 400, 600, 400, 400, 400, 400], 3, 3, 100);
    assert.equal(segs.length, 4);
    assert.ok(segs.every((s) => s.level === 500));
    const points = segs.flatMap((s) => [s.from, s.to]).map(([x, y]) => `${x},${y}`);
    assert.deepEqual([...new Set(points)].sort(), ['0.5,1', '1,0.5', '1,1.5', '1.5,1']);
  });

  it('draws no lines at or below the lake surface', () => {
    assert.equal(contours([300, 300, 300, 410], 2, 2, 100).length, 0);
  });

  it('draws one line per level crossed', () => {
    const segs = contours([400, 400, 900, 900], 2, 2, 100);
    assert.deepEqual(segs.map((s) => s.level), [500, 600, 700, 800]);
    // On a straight slope every line is straight across the cell.
    for (const s of segs) assert.equal(s.from[1], s.to[1]);
  });

  it('places the line where the slope crosses the level', () => {
    const [seg] = contours([400, 400, 600, 600], 2, 2, 500);
    assert.ok(Math.abs(seg.from[1] - 0.5) < 1e-9, `y = ${seg.from[1]}`);
  });
});

describe('small maths helpers', () => {
  it('ease() starts slow, ends slow and is symmetric', () => {
    assert.equal(m.ease(0), 0);
    assert.equal(m.ease(1), 1);
    assert.equal(m.ease(0.5), 0.5);
    assert.ok(m.ease(0.1) < 0.1);
    assert.ok(Math.abs(m.ease(0.3) + m.ease(0.7) - 1) < 1e-12);
  });

  it('mix() blends colours along the gradient stops', () => {
    const stops = [[0, 0, 0], [100, 100, 100], [200, 0, 0]];
    assert.deepEqual(m.mix(stops, 0), [0, 0, 0]);
    assert.deepEqual(m.mix(stops, 0.25), [50, 50, 50]);
    assert.deepEqual(m.mix(stops, 1), [200, 0, 0]);
    assert.deepEqual(m.mix(stops, 5), [200, 0, 0], 'clamped');
  });

  it('rgba() writes a CSS colour', () => {
    assert.equal(m.rgba([12.7, 0, 255], 0.5), 'rgba(12,0,255,0.5)');
  });

  it('view() centres on the Obersee and scales to the screen', () => {
    const wide = m.view(2100, 1000);
    assert.equal(wide.cE, 2709600);
    assert.equal(wide.s, 0.1);
    assert.equal(m.view(400, 800).cE, 2708200, 'phones look a bit further west, at Rapperswil');
  });
});
