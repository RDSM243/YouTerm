import { DEFAULT_THEME_ID, THEMES } from '../data/themes';
import type { AppearanceConfig, ThemeConfig, ThemeId } from '../types';
import { DEFAULT_BACKGROUND, normalizeBackground } from './background';

const CUSTOM_THEMES_KEY = 'youterm_custom_themes_v1';
const APPEARANCE_KEY = 'youterm_appearance_v1';
export const THEME_COLORS = {
  bg: 'Background', cardBg: 'Panels', border: 'Borders', text: 'Text', textDim: 'Muted text',
  accent: 'Accent', highlight: 'Highlight', warning: 'Warning', error: 'Error',
} as const;
export type ThemeColor = keyof typeof THEME_COLORS;
export const FONT_OPTIONS = {
  system: 'ui-monospace, "DejaVu Sans Mono", "Liberation Mono", monospace',
  jetbrains: '"JetBrains Mono", ui-monospace, monospace',
  fira: '"Fira Code", ui-monospace, monospace',
  ubuntu: '"Ubuntu Mono", ui-monospace, monospace',
} as const;

export function getFontFamily(font: string): string {
  if (font && Object.hasOwn(FONT_OPTIONS, font)) {
    return FONT_OPTIONS[font as keyof typeof FONT_OPTIONS];
  }
  if (font && /^[a-zA-Z0-9_\-\s]{1,80}$/.test(font)) {
    return `"${font}", ui-monospace, monospace`;
  }
  return FONT_OPTIONS.system;
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  font: 'system', fontSize: 12, density: 'compact', animations: true,
  glow: true, scanlines: false, lowPower: true, hideAlbumCover: false,
  background: { ...DEFAULT_BACKGROUND },
};

export function accentGlow(accent: string): string {
  return `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.22)`;
}

export function cloneTheme(theme: ThemeConfig, name = `${theme.name} Custom`): ThemeConfig {
  return { ...theme, id: `custom_${crypto.randomUUID()}`, name: name.slice(0, 60) };
}

export function validateCustomTheme(value: unknown): ThemeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid YouTerm theme JSON file.');
  const input = value as Record<string, unknown>;
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) throw new Error('Theme name must contain 1–60 characters.');
  const result = { ...THEMES[DEFAULT_THEME_ID], name: input.name.trim(),
    id: typeof input.id === 'string' && /^custom_[a-zA-Z0-9_-]{1,80}$/.test(input.id)
      ? input.id as ThemeId : `custom_${crypto.randomUUID()}` as ThemeId };
  for (const field of Object.keys(THEME_COLORS) as ThemeColor[]) {
    if (typeof input[field] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input[field] as string)) {
      throw new Error(`${THEME_COLORS[field]} must be a six-digit hex color, for example #22c55e.`);
    }
    result[field] = (input[field] as string).toLowerCase();
  }
  for (const field of ['hostname', 'promptSymbol'] as const) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || (input[field] as string).length > 80 || /[\u0000-\u001f]/.test(input[field] as string)) {
        throw new Error(`${field} must be text with at most 80 characters.`);
      }
      result[field] = input[field] as string;
    }
  }
  result.accentGlow = accentGlow(result.accent);
  return result;
}

export function importThemeJson(json: string): ThemeConfig {
  if (json.length > 64 * 1024) throw new Error('Theme files must be smaller than 64 KB.');
  let value: any;
  try { value = JSON.parse(json); } catch { throw new Error('The theme file is not valid JSON.'); }
  if (value?.version !== undefined && value.version !== 1) throw new Error('This theme format version is not supported.');
  return validateCustomTheme(value?.theme ?? value);
}

export function exportThemeJson(theme: ThemeConfig): string {
  return JSON.stringify({ version: 1, theme }, null, 2) + '\n';
}

export function loadCustomThemes(): ThemeConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    const themes = new Map<ThemeId, ThemeConfig>();
    for (const input of saved.slice(0, 50)) {
      try { const theme = validateCustomTheme(input); themes.set(theme.id, theme); } catch {}
    }
    return [...themes.values()];
  } catch { return []; }
}

export function saveCustomThemes(themes: ThemeConfig[]): void {
  if (themes.length > 50) throw new Error('You can keep up to 50 custom themes. Export or remove one before adding another.');
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes.map(validateCustomTheme)));
}

export function resolveTheme(id: ThemeId, customThemes: ThemeConfig[]): ThemeConfig {
  return customThemes.find(theme => theme.id === id) || (Object.hasOwn(THEMES, id) ? THEMES[id as keyof typeof THEMES] : THEMES[DEFAULT_THEME_ID]);
}

export function normalizeAppearance(value: unknown): AppearanceConfig {
  const input = value && typeof value === 'object' ? value as Partial<AppearanceConfig> : {};
  const result = { ...DEFAULT_APPEARANCE };
  if (typeof input.font === 'string') {
    if (Object.hasOwn(FONT_OPTIONS, input.font)) {
      result.font = input.font;
    } else if (/^[a-zA-Z0-9_\-\s]{1,80}$/.test(input.font)) {
      result.font = input.font;
    }
  }
  if (Number.isFinite(input.fontSize)) result.fontSize = Math.max(10, Math.min(18, Math.round(input.fontSize!)));
  if (input.density === 'comfortable' || input.density === 'compact') result.density = input.density;
  for (const field of ['animations', 'glow', 'scanlines', 'lowPower', 'hideAlbumCover'] as const) {
    if (typeof input[field] === 'boolean') result[field] = input[field];
  }
  result.background = normalizeBackground(input.background);
  return result;
}

export function loadAppearance(): AppearanceConfig {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}')); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function saveAppearance(appearance: AppearanceConfig): void {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(normalizeAppearance(appearance)));
}
