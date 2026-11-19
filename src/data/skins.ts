import { DEFAULT_PANEL_STYLE, type PanelStyleConfig } from '../services/skin';

export interface PanelStylePreset {
  id: 'terminal' | 'rounded';
  name: string;
  description: string;
  style: PanelStyleConfig;
}

export const PANEL_STYLE_PRESETS: PanelStylePreset[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Sharp edges, crisp borders and ASCII playback controls.',
    style: { ...DEFAULT_PANEL_STYLE },
  },
  {
    id: 'rounded',
    name: 'Rounded',
    description: 'Soft rounded panels, comfortable spacing and minimal playback controls.',
    style: {
      ...DEFAULT_PANEL_STYLE,
      panelRadius: 18,
      controlRadius: 16,
      artworkRadius: 14,
      panelGap: 12,
      borderWidth: 1,
      shadow: 'soft',
      controlStyle: 'minimal',
      progressStyle: 'continuous',
    },
  },
];
