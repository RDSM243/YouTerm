import type { CSSProperties } from 'react';
import type { SkinConfig } from '../types';
import { normalizeDockLayout } from './dockLayout';

export type PanelStyleConfig = Pick<
  SkinConfig,
  | 'panelRadius'
  | 'controlRadius'
  | 'artworkRadius'
  | 'panelGap'
  | 'borderWidth'
  | 'shadow'
  | 'controlStyle'
  | 'progressStyle'
>;

export type LayoutSkinConfig = Pick<
  SkinConfig,
  'sidebar' | 'playerPosition' | 'showHeader' | 'layout'
>;

export const DEFAULT_PANEL_STYLE: PanelStyleConfig = {
  panelRadius: 0,
  controlRadius: 0,
  artworkRadius: 0,
  panelGap: 0,
  borderWidth: 1,
  shadow: 'none',
  controlStyle: 'terminal',
  progressStyle: 'ascii',
};

export const DEFAULT_LAYOUT_SKIN: LayoutSkinConfig = {
  sidebar: 'left',
  playerPosition: 'bottom',
  showHeader: true,
  layout: null,
};

export const DEFAULT_SKIN: SkinConfig = {
  ...DEFAULT_PANEL_STYLE,
  ...DEFAULT_LAYOUT_SKIN,
};

const PANEL_STYLE_KEYS: readonly (keyof PanelStyleConfig)[] = [
  'panelRadius',
  'controlRadius',
  'artworkRadius',
  'panelGap',
  'borderWidth',
  'shadow',
  'controlStyle',
  'progressStyle',
];

export function pickPanelStyle(skin: PanelStyleConfig): PanelStyleConfig {
  return {
    panelRadius: skin.panelRadius,
    controlRadius: skin.controlRadius,
    artworkRadius: skin.artworkRadius,
    panelGap: skin.panelGap,
    borderWidth: skin.borderWidth,
    shadow: skin.shadow,
    controlStyle: skin.controlStyle,
    progressStyle: skin.progressStyle,
  };
}

export function isPanelStyleEqual(a: PanelStyleConfig, b: PanelStyleConfig): boolean {
  return PANEL_STYLE_KEYS.every(key => a[key] === b[key]);
}

export function skinShadowValue(shadow: SkinConfig['shadow']): string {
  return shadow === 'deep'
    ? '0 12px 36px rgba(0, 0, 0, 0.45)'
    : shadow === 'soft'
      ? '0 4px 16px rgba(0, 0, 0, 0.2)'
      : 'none';
}

export function normalizeSkin(value: unknown): SkinConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_SKIN };
  for (const [field, max] of [
    ['panelRadius', 32], ['controlRadius', 32], ['artworkRadius', 48],
    ['panelGap', 24], ['borderWidth', 3],
  ] as const) {
    if (typeof input[field] === 'number' && Number.isFinite(input[field])) {
      result[field] = Math.max(0, Math.min(max, Math.round(input[field] as number)));
    }
  }
  const choices = {
    shadow: ['none', 'soft', 'deep'],
    sidebar: ['left', 'right', 'hidden'],
    playerPosition: ['bottom', 'top'],
    controlStyle: ['terminal', 'minimal'],
    progressStyle: ['ascii', 'continuous'],
  } as const;
  for (const field of Object.keys(choices) as (keyof typeof choices)[]) {
    if ((choices[field] as readonly unknown[]).includes(input[field])) {
      Object.assign(result, { [field]: input[field] });
    }
  }
  if (typeof input.showHeader === 'boolean') result.showHeader = input.showHeader;
  result.layout = normalizeDockLayout(input.layout);
  return result;
}

export function skinVariables(skin: SkinConfig): CSSProperties {
  return {
    '--skin-panel-radius': `${skin.panelRadius}px`,
    '--skin-control-radius': `${skin.controlRadius}px`,
    '--skin-artwork-radius': `${skin.artworkRadius}px`,
    '--skin-gap': `${skin.panelGap}px`,
    '--skin-border-width': `${skin.borderWidth}px`,
    '--skin-shadow': skinShadowValue(skin.shadow),
  } as CSSProperties;
}
