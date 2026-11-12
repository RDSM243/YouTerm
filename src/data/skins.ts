import type { AppearanceConfig, AsciiRenderMode, BuiltinThemeId, SkinConfig, TuiViewMode } from '../types';
import { DEFAULT_SKIN } from '../services/skin';

export interface SkinPreset {
  id: string;
  name: string;
  description: string;
  themeId: BuiltinThemeId;
  appearance: Pick<AppearanceConfig, 'font' | 'fontSize' | 'density' | 'glow' | 'scanlines'>;
  skin: SkinConfig;
  viewMode: TuiViewMode;
  artworkMode: AsciiRenderMode;
}

export const SKIN_PRESETS: SkinPreset[] = [
  {
    id: 'terminal', name: 'Terminal',
    description: 'Sharp edges, monospace text and an ASCII progress bar.',
    themeId: 'linux_mint',
    appearance: { font: 'system', fontSize: 12, density: 'compact', glow: true, scanlines: false },
    skin: { ...DEFAULT_SKIN }, viewMode: 'split', artworkMode: 'half_block',
  },
  {
    id: 'rounded', name: 'Rounded',
    description: 'Soft panels, clean typography and simple playback controls.',
    themeId: 'tokyonight',
    appearance: { font: 'sans', fontSize: 13, density: 'comfortable', glow: true, scanlines: false },
    skin: { ...DEFAULT_SKIN, panelRadius: 18, controlRadius: 16, artworkRadius: 14,
      panelGap: 12, shadow: 'soft', controlStyle: 'minimal', progressStyle: 'continuous', showHeader: false },
    viewMode: 'split', artworkMode: 'original_hd',
  },
  {
    id: 'cover_focus', name: 'Cover Focus',
    description: 'A spacious album cover with the player at the top and the sidebar tucked away.',
    themeId: 'nord',
    appearance: { font: 'sans', fontSize: 13, density: 'comfortable', glow: true, scanlines: false },
    skin: { ...DEFAULT_SKIN, panelRadius: 24, controlRadius: 24, artworkRadius: 24,
      panelGap: 16, borderWidth: 0, shadow: 'deep', sidebar: 'hidden',
      playerPosition: 'top', controlStyle: 'minimal', progressStyle: 'continuous', showHeader: false },
    viewMode: 'ascii_cover', artworkMode: 'original_hd',
  },
];
