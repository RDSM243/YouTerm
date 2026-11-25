import React, { useState } from 'react';
import { ChevronDown, LayoutDashboard, RotateCcw } from 'lucide-react';
import type { SkinConfig, ThemeConfig, TuiViewMode } from '../types';
import { DEFAULT_LAYOUT_SKIN, type LayoutSkinConfig } from '../services/skin';
import { dockPanels } from '../services/dockLayout';

interface LayoutSettingsProps {
  theme: ThemeConfig;
  skin: SkinConfig;
  viewMode: TuiViewMode;
  onChangeSkin: (change: Partial<SkinConfig>) => void;
  onEditLayout: () => void;
}

const LAYOUT_SELECTS = [
  ['sidebar', 'Sidebar position', [['left', 'Left'], ['right', 'Right'], ['hidden', 'Hidden']]],
  ['playerPosition', 'Player position', [['bottom', 'Bottom'], ['top', 'Top']]],
] as const;

export function LayoutSettings({ theme, skin, viewMode, onChangeSkin, onEditLayout }: LayoutSettingsProps) {
  const [status, setStatus] = useState('');
  const panelStyle = { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };

  const updateLayout = (change: Partial<LayoutSkinConfig>, message = 'Layout updated.') => {
    try {
      onChangeSkin(change);
      setStatus(message);
    } catch {
      setStatus('The layout could not be saved. Check the available storage space.');
    }
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border p-3" style={panelStyle}>
      <legend className="px-1 font-bold" style={{ color: theme.highlight }}>Layout</legend>
      <p className="text-[11px]" style={{ color: theme.textDim }}>
        Choose where the sidebar, playback bar and header appear, or arrange every panel freely without changing your panel style or colors.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border p-3" style={panelStyle}>
        <span className="min-w-0">
          <span className="block font-bold">Arrange your panels</span>
          <span className="mt-1 block text-[11px]" style={{ color: theme.textDim }}>
            {skin.layout
              ? `${dockPanels(skin.layout.root).length} panels in your saved layout.`
              : 'Move artwork, lyrics, tracks, the library, playlists, spectrum, mixer and playback controls by dragging.'}
          </span>
        </span>
        <button
          type="button"
          onClick={onEditLayout}
          className="flex shrink-0 items-center gap-1.5 border px-3 py-2 hover:brightness-125"
          style={{ ...panelStyle, color: theme.accent }}
        >
          <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5" /> Edit layout
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 border p-3 sm:grid-cols-2" style={panelStyle}>
        {LAYOUT_SELECTS.map(([field, label, choices]) => (
          <label key={field} className="flex min-w-0 flex-col gap-2">
            <span style={{ color: theme.textDim }}>{label}</span>
            <span className="relative flex items-center">
              <select
                aria-label={label}
                value={skin[field]}
                disabled={viewMode === 'custom'}
                className="w-full min-w-0 border p-2 pr-8 outline-none disabled:opacity-40"
                style={panelStyle}
                onChange={event =>
                  updateLayout({ [field]: event.target.value } as Partial<LayoutSkinConfig>)
                }
              >
                {choices.map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 h-3.5 w-3.5" style={{ color: theme.accent }} />
            </span>
          </label>
        ))}

        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={skin.showHeader}
            style={{ accentColor: theme.accent }}
            onChange={event => updateLayout({ showHeader: event.target.checked })}
          />
          <span>Show terminal header</span>
        </label>

        {viewMode === 'custom' && (
          <p className="text-[11px] sm:col-span-2" style={{ color: theme.textDim }}>
            Your custom layout controls panel positions. Use Edit layout to move them, or Reset layout to return to defaults.
          </p>
        )}
      </div>

      <button
        type="button"
        className="flex items-center gap-1.5 self-start border px-3 py-1.5 hover:brightness-125"
        style={panelStyle}
        onClick={() => updateLayout({ ...DEFAULT_LAYOUT_SKIN }, 'Layout reset to defaults.')}
      >
        <RotateCcw aria-hidden="true" className="h-3 w-3" /> Reset layout
      </button>

      {status && <p role="status" className="text-[11px]" style={{ color: theme.accent }}>{status}</p>}
    </fieldset>
  );
}
