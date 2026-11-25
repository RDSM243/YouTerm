import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeBarLayout,
  DEFAULT_SPECTRUM_CONFIG,
  interpolateColorStops,
  normalizeSpectrumConfig,
} from '../src/services/spectrumConfig';

test('normalizeSpectrumConfig clamps invalid inputs and preserves valid CAVA settings', () => {
  const normalized = normalizeSpectrumConfig({
    colorMode: 'gradient',
    solidColor: '#ff00aa',
    gradientBottom: 'not-a-hex',
    barCount: 4,
    barWidth: 99,
    barGap: -5,
    heightScale: 10,
    barStyle: 'blocks',
    blockHeight: 20,
    orientation: 'mirror',
    sensitivity: 9,
    gravity: 0.05,
    smoothing: 2,
    showPeaks: false,
    showGrid: false,
  });

  assert.equal(normalized.colorMode, 'gradient');
  assert.equal(normalized.solidColor, '#ff00aa');
  assert.equal(normalized.gradientBottom, DEFAULT_SPECTRUM_CONFIG.gradientBottom);
  assert.equal(normalized.barCount, 16);
  assert.equal(normalized.barWidth, 24);
  assert.equal(normalized.barGap, 0);
  assert.equal(normalized.heightScale, 30);
  assert.equal(normalized.barStyle, 'blocks');
  assert.equal(normalized.blockHeight, 10);
  assert.equal(normalized.orientation, 'mirror');
  assert.equal(normalized.sensitivity, 3.0);
  assert.equal(normalized.gravity, 0.3);
  assert.equal(normalized.smoothing, 2);
  assert.equal(normalized.showPeaks, false);
  assert.equal(normalized.showGrid, false);
});

test('computeBarLayout auto-fits bars by thickness and centers them without overflow', () => {
  const autoLayout = computeBarLayout(300, 40, 0, 10, 2);
  assert.equal(autoLayout.activeBars, 25);
  assert.equal(autoLayout.barWidth, 10);
  assert.equal(autoLayout.barGap, 2);
  const usedWidth = autoLayout.activeBars * autoLayout.barWidth + (autoLayout.activeBars - 1) * autoLayout.barGap;
  assert.ok(usedWidth <= 300);
  assert.ok(autoLayout.startX >= 40);

  const clampedLayout = computeBarLayout(120, 10, 64, 16, 4);
  assert.equal(clampedLayout.activeBars, 64);
  assert.ok(clampedLayout.barWidth >= 1.5);
  const clampedUsed = clampedLayout.activeBars * clampedLayout.barWidth + (clampedLayout.activeBars - 1) * clampedLayout.barGap;
  assert.ok(clampedUsed <= 120.01);
});

test('interpolateColorStops smoothly interpolates multi-stop CAVA gradients', () => {
  const stops = ['#00ff00', '#ffff00', '#ff0000'];
  assert.equal(interpolateColorStops(stops, 0), 'rgb(0, 255, 0)');
  assert.equal(interpolateColorStops(stops, 0.5), 'rgb(255, 255, 0)');
  assert.equal(interpolateColorStops(stops, 1), 'rgb(255, 0, 0)');
  assert.equal(interpolateColorStops(stops, 0.25), 'rgb(128, 255, 0)');
});
