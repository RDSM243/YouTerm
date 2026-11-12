import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DockLayout, DockPanelId, DockPosition } from '../src/types';
import { createDockLayout, addDockPanel, dockDropPosition, dockPanels, moveDockPanel, normalizeDockLayout, removeDockPanel, resizeDockSplit } from '../src/services/dockLayout';
import { DEFAULT_SKIN } from '../src/services/skin';
import { THEMES } from '../src/data/themes';
import { exportThemeJson, importThemeBundleJson, normalizeAppearance, validateCustomTheme } from '../src/services/themeStorage';

test('starting the editor reflects the current view and the chosen sidebar and playback positions', () => {
  const cover = createDockLayout('ascii_cover', { sidebar: 'hidden', playerPosition: 'top' });
  assert.deepEqual(dockPanels(cover.root), ['player', 'artwork']);
  const tracks = createDockLayout('tracklist', { sidebar: 'right', playerPosition: 'bottom' });
  assert.deepEqual(dockPanels(tracks.root), ['tracks', 'sidebar', 'player']);
  assert.deepEqual(dockPanels(createDockLayout('split', DEFAULT_SKIN, false).root), ['tracks', 'artwork', 'lyrics', 'player']);
});

test('every panel can dock on every edge or swap without losing, duplicating or mutating any panel', () => {
  const layout = addDockPanel(createDockLayout('split', DEFAULT_SKIN), 'spectrum');
  const original = JSON.stringify(layout);
  const ids = dockPanels(layout.root);
  for (const source of ids) for (const target of ids.filter(id => id !== source)) {
    for (const position of ['left', 'right', 'top', 'bottom', 'center'] as DockPosition[]) {
      const moved = moveDockPanel(layout, source, target, position);
      assert.deepEqual([...dockPanels(moved.root)].sort(), [...ids].sort());
      assert.deepEqual(normalizeDockLayout(moved), moved);
      if (position === 'center') {
        assert.equal(dockPanels(moved.root).indexOf(target), ids.indexOf(source));
      }
    }
  }
  assert.equal(JSON.stringify(layout), original);
  assert.equal(moveDockPanel(layout, 'tracks', 'tracks', 'left'), layout);
});

test('moving between siblings collapses the old split and places the source at the requested edge', () => {
  const layout: DockLayout = { version: 1, root: { type: 'split', id: 'original', axis: 'row', ratio: 40,
    first: { type: 'panel', panel: 'tracks' }, second: { type: 'panel', panel: 'artwork' } } };
  const moved = moveDockPanel(layout, 'artwork', 'tracks', 'top');
  assert.equal(moved.root.type, 'split');
  if (moved.root.type !== 'split') throw new Error('Expected a split');
  assert.equal(moved.root.axis, 'column');
  assert.deepEqual(moved.root.first, { type: 'panel', panel: 'artwork' });
  assert.deepEqual(moved.root.second, { type: 'panel', panel: 'tracks' });
  assert.notEqual(moved.root.id, 'original');
});

test('hiding panels leaves at least one usable panel and adding them back keeps each one unique', () => {
  let layout = createDockLayout('split', DEFAULT_SKIN);
  for (const id of ['sidebar', 'artwork', 'lyrics', 'player'] as DockPanelId[]) layout = removeDockPanel(layout, id);
  assert.deepEqual(layout.root, { type: 'panel', panel: 'tracks' });
  assert.equal(removeDockPanel(layout, 'tracks'), layout);
  layout = addDockPanel(addDockPanel(layout, 'player'), 'sidebar');
  assert.equal(addDockPanel(layout, 'sidebar'), layout);
  assert.deepEqual([...dockPanels(layout.root)].sort(), ['player', 'sidebar', 'tracks']);
  assert.equal(moveDockPanel(layout, 'tracks', 'lyrics', 'top'), layout);
});

test('resized splits survive named skin storage and a complete export/import round trip', () => {
  let layout = createDockLayout('split', DEFAULT_SKIN);
  if (layout.root.type !== 'split') throw new Error('Expected a split');
  const id = layout.root.id;
  layout = resizeDockSplit(layout, id, 71.25);
  const appearance = normalizeAppearance({ skin: { ...DEFAULT_SKIN, layout } });
  const look = { appearance, viewMode: 'custom' as const, artworkMode: 'original_hd' as const };
  const theme = validateCustomTheme({ ...THEMES.nord, id: 'custom_dock_layout', name: 'My desk', look });
  assert.deepEqual(validateCustomTheme(JSON.parse(JSON.stringify(theme))).look, look);
  const imported = importThemeBundleJson(exportThemeJson(theme, look)).skin!;
  assert.equal(imported.viewMode, 'custom');
  assert.deepEqual(imported.appearance.skin.layout, layout);
});

test('corrupted layouts recover valid panels and bound dimensions and recursion', () => {
  const layout = normalizeDockLayout({ version: 1, root: { type: 'split', id: 'x', axis: 'row', ratio: -500,
    first: { type: 'panel', panel: 'tracks' }, second: { type: 'split', id: 'x', axis: 'column', ratio: Infinity,
      first: { type: 'panel', panel: 'tracks' }, second: { type: 'panel', panel: 'lyrics' } } } });
  assert.ok(layout && layout.root.type === 'split');
  assert.equal(layout.root.ratio, 10);
  assert.deepEqual(dockPanels(layout.root), ['tracks', 'lyrics']);
  const cyclic: Record<string, unknown> = { type: 'split', axis: 'row' };
  cyclic.first = cyclic; cyclic.second = cyclic;
  assert.equal(normalizeDockLayout({ version: 1, root: cyclic }), null);
  assert.equal(normalizeDockLayout({ version: 2, root: { type: 'panel', panel: 'tracks' } }), null);
  assert.equal(normalizeDockLayout({ version: 1, root: { type: 'panel', panel: 'unknown' } }), null);
  assert.throws(() => importThemeBundleJson(JSON.stringify({ version: 2, theme: THEMES.nord,
    appearance: { skin: { layout: null } }, viewMode: 'custom', artworkMode: 'original_hd' })), /valid custom layout/);
});

test('pointer destinations distinguish the four docking edges from a center swap', () => {
  const rect = { left: 100, top: 200, width: 400, height: 300 };
  for (const [x, y, position] of [[110, 350, 'left'], [490, 350, 'right'], [300, 210, 'top'], [300, 490, 'bottom'], [300, 350, 'center']] as const) {
    assert.equal(dockDropPosition(x, y, rect), position);
  }
});
