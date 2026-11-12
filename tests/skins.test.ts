import assert from 'node:assert/strict';
import { test } from 'node:test';
import './layout.test';
import { SKIN_PRESETS } from '../src/data/skins';
import { THEMES } from '../src/data/themes';
import { DEFAULT_SKIN, normalizeSkin } from '../src/services/skin';
import { exportThemeJson, importThemeBundleJson, importThemeJson, normalizeAppearance, validateCustomTheme } from '../src/services/themeStorage';

test('existing appearance preferences acquire the terminal layout without losing their settings', () => {
  const previous = { font: 'fira', fontSize: 15, density: 'comfortable', glow: false,
    background: { enabled: true, imageRevision: 'a0000000-0000-0000-0000-000000000000', imageName: 'cover.png', darkness: 60 } };
  const upgraded = normalizeAppearance(previous);
  assert.equal(upgraded.font, 'fira');
  assert.equal(upgraded.fontSize, 15);
  assert.equal(upgraded.glow, false);
  assert.equal(upgraded.background.enabled, true);
  assert.equal(upgraded.background.darkness, 60);
  assert.deepEqual(upgraded.skin, DEFAULT_SKIN);
});

test('a customized skin can be shared and restored with its layout, typography, effects and view', () => {
  const preset = SKIN_PRESETS.find(value => value.id === 'rounded')!;
  const appearance = normalizeAppearance({ ...preset.appearance,
    skin: { ...preset.skin, sidebar: 'right', controlRadius: 27, playerPosition: 'top' } });
  const file = exportThemeJson(THEMES[preset.themeId], { appearance, viewMode: preset.viewMode, artworkMode: preset.artworkMode });
  const imported = importThemeBundleJson(file);
  assert.ok(imported.skin);
  assert.deepEqual(imported.skin.appearance, appearance);
  assert.equal(imported.skin.theme.accent, THEMES[preset.themeId].accent);
  assert.equal(imported.skin.viewMode, preset.viewMode);
  assert.equal(imported.skin.artworkMode, 'original_hd');
  assert.equal(imported.skin.appearance.font, 'sans');
});

test('portable skins omit device-local image references', () => {
  const appearance = normalizeAppearance({ background: { enabled: true,
    imageRevision: 'a0000000-0000-0000-0000-000000000000', imageName: 'private-background.png' } });
  const file = exportThemeJson(THEMES.linux_mint, { appearance, viewMode: 'tracklist', artworkMode: 'braille' });
  assert.ok(!file.includes('private-background.png'));
  assert.ok(!file.includes(appearance.background.imageRevision));
  assert.equal(importThemeBundleJson(file).skin!.appearance.background.enabled, false);
});

test('older color-only files still import as palettes without changing the layout', () => {
  const theme = { ...THEMES.nord, id: 'custom_my_palette' as const, name: 'My palette' };
  const wrapped = exportThemeJson(theme);
  const imported = importThemeJson(wrapped);
  assert.equal(imported.id, theme.id);
  assert.equal(imported.name, theme.name);
  assert.equal(imported.accent, theme.accent);
  assert.equal(importThemeBundleJson(wrapped).skin, undefined);
  assert.deepEqual(importThemeJson(JSON.stringify(theme)), imported);
});

test('saved named looks retain their complete snapshot and exports omit nested local image references', () => {
  const appearance = normalizeAppearance({ skin: SKIN_PRESETS[1].skin, background: { enabled: true,
    imageRevision: 'a0000000-0000-0000-0000-000000000000', imageName: 'local-only.png' } });
  const look = { appearance, viewMode: 'split' as const, artworkMode: 'original_hd' as const };
  const theme = validateCustomTheme({ ...THEMES.nord, id: 'custom_saved_look', look });
  const restored = validateCustomTheme(JSON.parse(JSON.stringify(theme)));
  assert.deepEqual(restored.look, look);
  const playerSkin = { theme: restored, ...look };
  const file = exportThemeJson(restored, playerSkin);
  assert.ok(!file.includes('local-only.png'));
  assert.ok(!file.includes(appearance.background.imageRevision));
  assert.deepEqual(importThemeBundleJson(file).skin!.appearance.skin, appearance.skin);
});

test('invalid stored geometry cannot produce negative dimensions, unbounded gaps or unknown layouts', () => {
  const appearance = normalizeAppearance({ skin: { panelRadius: -30, panelGap: 10000,
    controlRadius: '20px', borderWidth: Infinity, sidebar: 'diagonal', showHeader: 'false' } });
  assert.equal(appearance.skin.panelRadius, 0);
  assert.equal(appearance.skin.panelGap, 24);
  assert.equal(appearance.skin.controlRadius, 0);
  assert.equal(appearance.skin.borderWidth, 1);
  assert.equal(appearance.skin.sidebar, 'left');
  assert.equal(appearance.skin.showHeader, true);
  assert.deepEqual(normalizeSkin(null), DEFAULT_SKIN);
});

test('damaged, oversized or unsupported files report an error before application', () => {
  assert.throws(() => importThemeBundleJson('{'), /valid JSON/);
  assert.throws(() => importThemeBundleJson(JSON.stringify({ version: 99, theme: THEMES.nord })), /version/);
  assert.throws(() => importThemeBundleJson(JSON.stringify({ version: 2, theme: THEMES.nord })), /missing/);
  assert.throws(() => importThemeBundleJson(JSON.stringify({ version: 1, theme: { ...THEMES.nord, accent: 'url(example)' } })), /hex color/);
  assert.throws(() => importThemeBundleJson(' '.repeat(65537)), /64 KB/);
});
