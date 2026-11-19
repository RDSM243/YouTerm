import React, { useRef, useState } from 'react';
import { Check, ChevronDown, Play, RotateCcw, Undo2 } from 'lucide-react';
import type { SkinConfig, ThemeConfig } from '../types';
import { PANEL_STYLE_PRESETS } from '../data/skins';
import {
  DEFAULT_PANEL_STYLE,
  isPanelStyleEqual,
  pickPanelStyle,
  skinShadowValue,
  type PanelStyleConfig,
} from '../services/skin';

interface PanelStyleSettingsProps {
  theme: ThemeConfig;
  skin: SkinConfig;
  onChangeSkin: (change: Partial<SkinConfig>) => void;
}

const RANGE_FIELDS = [
  ['panelRadius', 'Panel corners', 32],
  ['controlRadius', 'Button & field corners', 32],
  ['artworkRadius', 'Artwork corners', 48],
  ['panelGap', 'Space between panels', 24],
  ['borderWidth', 'Border thickness', 3],
] as const;

const SELECT_FIELDS = [
  ['shadow', 'Panel shadows', [['none', 'None'], ['soft', 'Soft'], ['deep', 'Deep']]],
  ['controlStyle', 'Playback controls', [['terminal', 'Terminal labels'], ['minimal', 'Minimal icons']]],
  ['progressStyle', 'Progress bar', [['ascii', 'ASCII blocks'], ['continuous', 'Continuous']]],
] as const;

export function PanelStyleSettings({ theme, skin, onChangeSkin }: PanelStyleSettingsProps) {
  const [previousStyle, setPreviousStyle] = useState<PanelStyleConfig | null>(null);
  const [status, setStatus] = useState('');
  const rangeStart = useRef<PanelStyleConfig | null>(null);
  const currentStyle = pickPanelStyle(skin);
  const panelStyle = { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };

  const applyStyle = (change: Partial<PanelStyleConfig>, message: string, remember = true) => {
    try {
      const before = pickPanelStyle(skin);
      onChangeSkin(change);
      if (remember) setPreviousStyle(before);
      setStatus(message);
    } catch {
      setStatus('The panel style could not be saved. Check the available storage space.');
    }
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border p-3" style={panelStyle}>
      <legend className="px-1 font-bold" style={{ color: theme.highlight }}>Panel Style</legend>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-[11px]" style={{ color: theme.textDim }}>
          Switch between sharp terminal panels and soft rounded surfaces, then fine-tune corners, borders, shadows and controls. Your color theme and layout stay unchanged.
        </p>
        <button
          type="button"
          disabled={!previousStyle}
          className="flex shrink-0 items-center gap-1.5 border px-3 py-1.5 hover:brightness-125 disabled:opacity-40"
          style={panelStyle}
          onClick={() => {
            if (!previousStyle) return;
            try {
              const current = pickPanelStyle(skin);
              onChangeSkin(previousStyle);
              setPreviousStyle(current);
              setStatus('Previous panel style restored.');
            } catch {
              setStatus('The previous panel style could not be restored.');
            }
          }}
        >
          <Undo2 aria-hidden="true" className="h-3 w-3" /> Undo / redo
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PANEL_STYLE_PRESETS.map(preset => {
          const active = isPanelStyleEqual(currentStyle, preset.style);
          const previewGap = preset.style.panelGap > 0 ? 6 : 2;
          const previewRadius = Math.round(preset.style.panelRadius / 2);
          const innerRadius = Math.round(preset.style.panelRadius / 3);
          return (
            <button
              type="button"
              key={preset.id}
              aria-label={`Apply ${preset.name} panel style`}
              aria-pressed={active}
              className="flex flex-col gap-2 border p-3 text-left hover:brightness-125"
              style={{ ...panelStyle, borderColor: active ? theme.accent : theme.border }}
              onClick={() => applyStyle(preset.style, `${preset.name} panel style applied.`)}
            >
              <div
                aria-hidden="true"
                className="flex h-16 w-full"
                style={{
                  backgroundColor: theme.bg,
                  borderRadius: previewRadius,
                  border: `${preset.style.borderWidth}px solid ${theme.border}`,
                  gap: previewGap,
                  padding: preset.style.panelGap > 0 ? 6 : 3,
                }}
              >
                <span
                  className="w-1/4"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderRadius: innerRadius,
                    border: `${preset.style.borderWidth}px solid ${theme.border}`,
                    boxShadow: skinShadowValue(preset.style.shadow),
                  }}
                />
                <span
                  className="flex flex-1 flex-col justify-end gap-1.5 p-2"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderRadius: innerRadius,
                    border: `${preset.style.borderWidth}px solid ${theme.border}`,
                    boxShadow: skinShadowValue(preset.style.shadow),
                  }}
                >
                  {preset.style.progressStyle === 'continuous' ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0"
                        style={{
                          backgroundColor: theme.accent,
                          borderRadius: preset.style.controlRadius,
                        }}
                      />
                      <span
                        className="h-1 flex-1"
                        style={{ backgroundColor: theme.border, borderRadius: preset.style.controlRadius }}
                      >
                        <span
                          className="block h-full w-2/3"
                          style={{ backgroundColor: theme.accent, borderRadius: preset.style.controlRadius }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="ascii-progress truncate text-[10px]" style={{ color: theme.accent }}>
                      [PLAY] [████░░]
                    </span>
                  )}
                  <span
                    className="h-1 w-1/2"
                    style={{ backgroundColor: theme.textDim, borderRadius: preset.style.controlRadius }}
                  />
                </span>
              </div>
              <span className="flex w-full items-center justify-between font-bold" style={{ color: theme.highlight }}>
                {preset.name}
                {active && <Check aria-hidden="true" className="h-3.5 w-3.5" style={{ color: theme.accent }} />}
              </span>
              <span className="text-[10px] leading-relaxed" style={{ color: theme.textDim }}>
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold" style={{ color: theme.textDim }}>Live preview</p>
        <div
          role="img"
          aria-label="Live panel style preview"
          className="flex min-h-40 flex-col p-3"
          style={{
            ...panelStyle,
            border: `${skin.borderWidth}px solid ${theme.border}`,
            gap: Math.min(skin.panelGap, 12),
            borderRadius: skin.panelRadius,
          }}
        >
          <div
            className="flex min-h-0 flex-1"
            style={{
              order: 1,
              gap: Math.min(skin.panelGap || 4, 12),
              flexDirection: skin.sidebar === 'right' ? 'row-reverse' : 'row',
            }}
          >
            {skin.sidebar !== 'hidden' && (
              <div
                className="flex w-1/3 sm:w-1/4 min-w-0 overflow-hidden flex-col gap-2 p-2.5 sm:p-3"
                style={{
                  backgroundColor: theme.cardBg,
                  border: `${skin.borderWidth}px solid ${theme.border}`,
                  borderRadius: skin.panelRadius,
                  boxShadow: skinShadowValue(skin.shadow),
                }}
              >
                <span className="truncate" style={{ color: theme.accent }}>Library</span>
                <span className="truncate" style={{ color: theme.textDim }}>Playlists</span>
              </div>
            )}
            <div
              className="flex min-w-0 flex-1 items-center gap-3 p-3"
              style={{
                backgroundColor: theme.cardBg,
                border: `${skin.borderWidth}px solid ${theme.border}`,
                borderRadius: skin.panelRadius,
                boxShadow: skinShadowValue(skin.shadow),
              }}
            >
              <span
                className="h-12 w-12 shrink-0"
                style={{
                  borderRadius: skin.artworkRadius,
                  background: `linear-gradient(135deg, ${theme.accent}, ${theme.border})`,
                }}
              />
              <span className="min-w-0">
                <span className="block truncate font-bold" style={{ color: theme.highlight }}>Your music</span>
                <span className="block truncate" style={{ color: theme.textDim }}>Artist · Album</span>
              </span>
            </div>
          </div>
          <div
            className="flex min-w-0 items-center gap-3 px-3 py-2"
            style={{
              order: skin.playerPosition === 'top' ? 0 : 2,
              backgroundColor: theme.cardBg,
              border: `${skin.borderWidth}px solid ${theme.border}`,
              borderRadius: skin.panelRadius,
              boxShadow: skinShadowValue(skin.shadow),
            }}
          >
            <span
              className="flex shrink-0 items-center gap-1 px-2 py-1"
              style={{
                border: `${skin.borderWidth}px solid ${theme.accent}`,
                borderRadius: skin.controlRadius,
                backgroundColor: skin.controlStyle === 'minimal' ? theme.accent : 'transparent',
                color: skin.controlStyle === 'minimal' ? theme.bg : theme.accent,
              }}
            >
              <Play aria-hidden="true" className="h-3 w-3" />
              {skin.controlStyle === 'terminal' && 'PLAY'}
            </span>
            {skin.progressStyle === 'continuous' ? (
              <span
                className="h-1 min-w-0 flex-1"
                style={{ backgroundColor: theme.border, borderRadius: skin.controlRadius }}
              >
                <span
                  className="block h-full w-1/3"
                  style={{ backgroundColor: theme.accent, borderRadius: skin.controlRadius }}
                />
              </span>
            ) : (
              <span className="ascii-progress min-w-0 flex-1 truncate" style={{ color: theme.accent }}>
                [████░░░░░░░░]
              </span>
            )}
            <span className="shrink-0" style={{ color: theme.textDim }}>1:24</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border p-3 sm:grid-cols-2" style={panelStyle}>
        {RANGE_FIELDS.map(([field, label, max]) => (
          <label key={field} className="flex min-w-0 flex-col gap-2">
            <span className="flex justify-between gap-2">
              <span style={{ color: theme.textDim }}>{label}</span>
              <span style={{ color: theme.accent }}>{skin[field]}px</span>
            </span>
            <input
              type="range"
              aria-label={label}
              min={0}
              max={max}
              step={1}
              value={skin[field]}
              style={{ accentColor: theme.accent }}
              onFocus={() => { rangeStart.current = pickPanelStyle(skin); }}
              onPointerDown={() => { rangeStart.current = pickPanelStyle(skin); }}
              onChange={event => {
                const before = rangeStart.current || pickPanelStyle(skin);
                applyStyle(
                  { [field]: Number(event.target.value) },
                  'Panel style updated. Close settings to see the full player.',
                  false,
                );
                setPreviousStyle(before);
              }}
            />
          </label>
        ))}

        {SELECT_FIELDS.map(([field, label, choices]) => (
          <label key={field} className="flex min-w-0 flex-col gap-2">
            <span style={{ color: theme.textDim }}>{label}</span>
            <span className="relative flex items-center">
              <select
                aria-label={label}
                value={skin[field]}
                className="w-full min-w-0 border p-2 pr-8 outline-none"
                style={panelStyle}
                onChange={event =>
                  applyStyle(
                    { [field]: event.target.value } as Partial<PanelStyleConfig>,
                    'Panel style updated. Close settings to see the full player.',
                  )
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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 border px-3 py-1.5 hover:brightness-125"
          style={panelStyle}
          onClick={() => applyStyle({ ...DEFAULT_PANEL_STYLE }, 'Panel style reset to Terminal defaults.')}
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" /> Reset panel style
        </button>
      </div>

      {status && <p role="status" className="text-[11px]" style={{ color: theme.accent }}>{status}</p>}
    </fieldset>
  );
}
