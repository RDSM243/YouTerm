import React, { useRef, useState } from 'react';
import { Check, Play, RotateCcw, Undo2 } from 'lucide-react';
import type { AppearanceConfig, AsciiRenderMode, PlayerSkin, SkinConfig, ThemeConfig, TuiViewMode } from '../types';
import { SKIN_PRESETS } from '../data/skins';
import { THEMES } from '../data/themes';
import { DEFAULT_SKIN } from '../services/skin';
import { dockPanels } from '../services/dockLayout';

interface SkinSettingsProps {
  theme: ThemeConfig;
  appearance: AppearanceConfig;
  viewMode: TuiViewMode;
  artworkMode: AsciiRenderMode;
  onChangeAppearance: (appearance: AppearanceConfig) => void;
  onApplySkin: (skin: PlayerSkin) => void;
  onEditLayout: () => void;
}

export function SkinSettings({ theme, appearance, viewMode, artworkMode, onChangeAppearance, onApplySkin, onEditLayout }: SkinSettingsProps) {
  const [previous, setPrevious] = useState<PlayerSkin | null>(null);
  const [status, setStatus] = useState('');
  const rangeStart = useRef<AppearanceConfig | null>(null);
  const skin = appearance.skin;
  const panelStyle = { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };
  const snapshot = (): PlayerSkin => ({ theme, appearance, viewMode, artworkMode });
  const change = (change: Partial<SkinConfig>, remember = true) => {
    try {
      onChangeAppearance({ ...appearance, skin: { ...skin, ...change } });
      if (remember) setPrevious(snapshot());
      setStatus('Look updated. Close settings to see the full player.');
    } catch { setStatus('The look could not be saved. Check the available storage space.'); }
  };

  return <section aria-label="Skin editor" className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-bold text-sm" style={{ color: theme.highlight }}>Make it your own</h3>
        <p className="mt-1 text-[11px]" style={{ color: theme.textDim }}>Start with a preset, then adjust each detail. Changes apply immediately.</p>
      </div>
      <button type="button" disabled={!previous} className="flex items-center gap-1.5 border px-3 py-1.5 disabled:opacity-40"
        style={panelStyle} onClick={() => {
          if (!previous) return;
          try { const current = snapshot(); onApplySkin(previous); setPrevious(current); setStatus('Previous look restored.'); }
          catch { setStatus('The previous look could not be restored.'); }
        }}><Undo2 className="h-3 w-3" /> Undo / redo look</button>
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {SKIN_PRESETS.map(preset => {
        const active = theme.id === preset.themeId && viewMode === preset.viewMode && artworkMode === preset.artworkMode
          && Object.entries(preset.skin).every(([key, value]) => skin[key as keyof SkinConfig] === value)
          && Object.entries(preset.appearance).every(([key, value]) => appearance[key as keyof AppearanceConfig] === value);
        return <button type="button" key={preset.id} aria-label={`Apply ${preset.name} skin`} aria-pressed={active}
          className="flex flex-col gap-2 border p-3 text-left hover:brightness-125"
          style={{ ...panelStyle, borderColor: active ? theme.accent : theme.border }} onClick={() => {
            try {
              onApplySkin({ theme: THEMES[preset.themeId],
                appearance: { ...appearance, ...preset.appearance, skin: { ...preset.skin } },
                viewMode: preset.viewMode, artworkMode: preset.artworkMode });
              setPrevious(snapshot()); setStatus(`${preset.name} applied. You can keep customizing it below.`);
            } catch { setStatus('This preset could not be saved.'); }
          }}>
          <div aria-hidden="true" className="flex h-14 w-full gap-1.5 p-2"
            style={{ backgroundColor: THEMES[preset.themeId].bg, borderRadius: preset.skin.panelRadius / 2 }}>
            {preset.skin.sidebar !== 'hidden' && <span className="w-1/5" style={{ backgroundColor: THEMES[preset.themeId].cardBg, borderRadius: preset.skin.panelRadius / 3 }} />}
            <span className="flex flex-1 flex-col justify-end gap-1.5" style={{ backgroundColor: THEMES[preset.themeId].cardBg, borderRadius: preset.skin.panelRadius / 3 }}>
              <span className="mx-2 h-1" style={{ backgroundColor: THEMES[preset.themeId].accent, borderRadius: preset.skin.controlRadius }} />
              <span className="mx-2 mb-2 h-1 w-1/2" style={{ backgroundColor: THEMES[preset.themeId].textDim, borderRadius: preset.skin.controlRadius }} />
            </span>
          </div>
          <span className="flex w-full items-center justify-between font-bold">{preset.name}{active && <Check className="h-3 w-3" style={{ color: theme.accent }} />}</span>
          <span className="text-[10px] leading-relaxed" style={{ color: theme.textDim }}>{preset.description}</span>
        </button>;
      })}
    </div>

    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border p-3" style={panelStyle}>
        <span><span className="block font-bold">Arrange your panels</span>
          <span className="mt-1 block text-[11px]" style={{ color: theme.textDim }}>{skin.layout
            ? `${dockPanels(skin.layout.root).length} panels in your saved layout. Positions and sizes are included when you save a skin.`
            : 'Move artwork, lyrics, tracks, the library, spectrum and playback controls by dragging.'}</span></span>
        <button type="button" onClick={onEditLayout} className="shrink-0 border px-3 py-2" style={{ ...panelStyle, color: theme.accent }}>Edit layout</button>
      </div>
      <p className="mb-2 text-[11px] font-bold" style={{ color: theme.textDim }}>Live preview</p>
      <div role="img" aria-label="Live skin preview" className="flex h-40 flex-col border p-3"
        style={{ ...panelStyle, gap: Math.min(skin.panelGap, 12), borderRadius: skin.panelRadius }}>
        <div className="flex min-h-0 flex-1" style={{ order: 1, gap: Math.min(skin.panelGap || 4, 12), flexDirection: skin.sidebar === 'right' ? 'row-reverse' : 'row' }}>
          {skin.sidebar !== 'hidden' && <div className="flex w-1/4 flex-col gap-2 p-3"
            style={{ backgroundColor: theme.cardBg, borderRadius: skin.panelRadius, boxShadow: 'var(--skin-shadow)' }}>
            <span style={{ color: theme.accent }}>Library</span><span style={{ color: theme.textDim }}>Playlists</span>
          </div>}
          <div className="flex min-w-0 flex-1 items-center gap-3 p-3"
            style={{ backgroundColor: theme.cardBg, borderRadius: skin.panelRadius, boxShadow: 'var(--skin-shadow)' }}>
            <span className="h-12 w-12 shrink-0" style={{ borderRadius: skin.artworkRadius, background: `linear-gradient(135deg, ${theme.accent}, ${theme.border})` }} />
            <span className="min-w-0"><span className="block font-bold" style={{ color: theme.highlight }}>Your music</span><span style={{ color: theme.textDim }}>Artist · Album</span></span>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2" style={{ order: skin.playerPosition === 'top' ? 0 : 2,
          borderRadius: skin.panelRadius, backgroundColor: theme.cardBg, boxShadow: 'var(--skin-shadow)' }}>
          <span className="flex items-center gap-1 px-2 py-1" style={{ border: `${skin.borderWidth}px solid ${theme.accent}`, borderRadius: skin.controlRadius, color: theme.accent }}>
            <Play className="h-3 w-3" />{skin.controlStyle === 'terminal' && 'PLAY'}
          </span>
          {skin.progressStyle === 'continuous' ? <span className="h-1 flex-1" style={{ backgroundColor: theme.border, borderRadius: skin.controlRadius }}>
            <span className="block h-full w-1/3" style={{ backgroundColor: theme.accent, borderRadius: skin.controlRadius }} /></span>
            : <span className="ascii-progress truncate" style={{ color: theme.accent }}>[████░░░░░░░░]</span>}
          <span style={{ color: theme.textDim }}>1:24</span>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 border p-3 sm:grid-cols-2" style={panelStyle}>
      {([
        ['panelRadius', 'Panel corners', 32], ['controlRadius', 'Button & field corners', 32],
        ['artworkRadius', 'Artwork corners', 48], ['panelGap', 'Space between panels', 24],
        ['borderWidth', 'Border thickness', 3],
      ] as const).map(([field, label, max]) => <label key={field} className="flex min-w-0 flex-col gap-2">
        <span className="flex justify-between gap-2"><span>{label}</span><span style={{ color: theme.accent }}>{skin[field]}px</span></span>
        <input type="range" aria-label={label} min={0} max={max} step={1} value={skin[field]}
          onFocus={() => { rangeStart.current = appearance; }}
          onPointerDown={() => { rangeStart.current = appearance; }}
          onChange={event => {
            const before = rangeStart.current || appearance;
            change({ [field]: Number(event.target.value) }, false);
            setPrevious({ theme, appearance: before, viewMode, artworkMode });
          }} />
      </label>)}
      {([
        ['shadow', 'Panel shadows', [['none', 'None'], ['soft', 'Soft'], ['deep', 'Deep']]],
        ['sidebar', 'Sidebar position', [['left', 'Left'], ['right', 'Right'], ['hidden', 'Hidden']]],
        ['playerPosition', 'Player position', [['bottom', 'Bottom'], ['top', 'Top']]],
        ['controlStyle', 'Playback controls', [['terminal', 'Terminal labels'], ['minimal', 'Minimal icons']]],
        ['progressStyle', 'Progress bar', [['ascii', 'ASCII blocks'], ['continuous', 'Continuous']]],
      ] as const).map(([field, label, choices]) => <label key={field} className="flex min-w-0 flex-col gap-2">
        <span>{label}</span>
        <select aria-label={label} value={skin[field]} className="min-w-0 border p-2" style={panelStyle}
          disabled={viewMode === 'custom' && (field === 'sidebar' || field === 'playerPosition')}
          onChange={event => change({ [field]: event.target.value })}>
          {choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>)}
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={skin.showHeader} onChange={event => change({ showHeader: event.target.checked })} />
        Show terminal header
      </label>
      {viewMode === 'custom' && <p className="text-[11px] sm:col-span-2" style={{ color: theme.textDim }}>Your custom layout controls panel positions. Use Edit layout to move them.</p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className="flex items-center gap-1.5 border px-3 py-1.5" style={panelStyle}
        onClick={() => change({ ...DEFAULT_SKIN })}><RotateCcw className="h-3 w-3" /> Reset shapes & layout</button>
      <span className="text-[10px]" style={{ color: theme.textDim }}>Keep this look in Themes → Save current look, or share it with Export skin.</span>
    </div>
    {status && <p role="status" className="text-[11px]" style={{ color: theme.accent }}>{status}</p>}
  </section>;
}
