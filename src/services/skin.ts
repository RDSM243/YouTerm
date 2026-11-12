import type { CSSProperties } from 'react';
import type { SkinConfig } from '../types';
import { normalizeDockLayout } from './dockLayout';

export const DEFAULT_SKIN: SkinConfig = {
  panelRadius: 0,
  controlRadius: 0,
  artworkRadius: 0,
  panelGap: 0,
  borderWidth: 1,
  shadow: 'none',
  sidebar: 'left',
  playerPosition: 'bottom',
  controlStyle: 'terminal',
  progressStyle: 'ascii',
  showHeader: true,
  layout: null,
};

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
    '--skin-shadow': skin.shadow === 'deep' ? '0 12px 36px rgba(0, 0, 0, 0.45)'
      : skin.shadow === 'soft' ? '0 4px 16px rgba(0, 0, 0, 0.2)' : 'none',
  } as CSSProperties;
}
