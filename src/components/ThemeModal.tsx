import React, { useRef, useState, useEffect } from 'react';
import type { AppearanceConfig, ThemeConfig, ThemeId } from '../types';
import { THEMES } from '../data/themes';
import { Check, Download, Palette, Plus, Upload, ChevronDown } from 'lucide-react';
import { accentGlow, cloneTheme, DEFAULT_APPEARANCE, exportThemeJson, importThemeJson, THEME_COLORS, validateCustomTheme, type ThemeColor } from '../services/themeStorage';

interface ThemeModalProps {
  currentTheme: ThemeConfig;
  customThemes: ThemeConfig[];
  appearance: AppearanceConfig;
  onSelectTheme: (themeId: ThemeId) => void;
  onSaveCustomTheme: (theme: ThemeConfig) => void;
  onDeleteCustomTheme: (themeId: ThemeId) => void;
  onChangeAppearance: (appearance: AppearanceConfig) => void;
  onClose: () => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({ currentTheme, customThemes, appearance,
  onSelectTheme, onSaveCustomTheme, onDeleteCustomTheme, onChangeAppearance, onClose }) => {
  const [draft, setDraft] = useState<ThemeConfig | null>(null);
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState<'themes' | 'appearance'>('themes');
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/system/fonts')
      .then(res => res.json())
      .then(data => {
        if (active && Array.isArray(data.fonts) && data.fonts.length > 0) {
          setSystemFonts(data.fonts);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const theme = currentTheme;
  const panelStyle = { borderColor: theme.border, backgroundColor: theme.bg, color: theme.text };
  const buttonClass = 'border px-3 py-1.5 hover:brightness-125 disabled:opacity-40';
  const updateAppearance = (change: Partial<AppearanceConfig>) => {
    try { onChangeAppearance({ ...appearance, ...change }); setStatus('Preferences saved.'); }
    catch { setStatus('Preferences could not be saved. Check the available storage space.'); }
  };
  const saveTheme = (value: ThemeConfig) => {
    try {
      const valid = validateCustomTheme(value);
      onSaveCustomTheme(valid);
      setDraft(null);
      setStatus(`Theme “${valid.name}” saved and applied.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'The theme could not be saved.'); }
  };
  const exportTheme = () => {
    const value = draft || currentTheme;
    const url = URL.createObjectURL(new Blob([exportThemeJson(value)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${value.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'youterm'}.theme.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono">
      <div role="dialog" aria-modal="true" aria-label="Themes and personalization"
        className="w-full max-w-3xl border p-5 shadow-2xl flex flex-col gap-4 text-xs max-h-[90vh] overflow-hidden"
        style={{ borderColor: theme.accent, backgroundColor: theme.cardBg, color: theme.text, boxShadow: `0 0 30px ${theme.accentGlow}` }}>
        <div className="flex items-center justify-between border-b pb-3 gap-2" style={{ borderColor: theme.border }}>
          <span className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <Palette className="w-4 h-4" style={{ color: theme.accent }} /> Themes & Personalization
          </span>
          <button onClick={onClose} className={buttonClass} style={panelStyle}>[Esc / Close]</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['themes', 'appearance'] as const).map(value => (
            <button key={value} onClick={() => { setTab(value); setStatus(''); }} className={buttonClass}
              style={{ ...panelStyle, borderColor: tab === value ? theme.accent : theme.border, color: tab === value ? theme.accent : theme.text }}>
              {value === 'themes' ? 'Themes' : 'Appearance & Performance'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 min-h-0">
          {tab === 'themes' ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 flex-wrap">
                <button className={`${buttonClass} flex items-center gap-1.5`} style={panelStyle}
                  onClick={() => { setDraft(cloneTheme(currentTheme)); setStatus(''); }}><Plus className="w-3 h-3" /> Create theme</button>
                <button className={`${buttonClass} flex items-center gap-1.5`} style={panelStyle} onClick={() => importRef.current?.click()}>
                  <Upload className="w-3 h-3" /> Import JSON
                </button>
                <button className={`${buttonClass} flex items-center gap-1.5`} style={panelStyle} onClick={exportTheme}>
                  <Download className="w-3 h-3" /> Export theme
                </button>
                <input ref={importRef} aria-label="Import theme JSON" type="file" accept=".json,application/json" className="hidden"
                  onChange={async event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    try {
                      if (file.size > 64 * 1024) throw new Error('Theme files must be smaller than 64 KB.');
                      const imported = importThemeJson(await file.text());
                      saveTheme({ ...imported, id: cloneTheme(imported).id });
                    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not import this theme.'); }
                  }} />
              </div>
              {draft && (
                <form className="border p-3 flex flex-col gap-3" style={panelStyle} onSubmit={event => { event.preventDefault(); saveTheme(draft); }}>
                  <label className="flex flex-col gap-1">Theme name
                    <input aria-label="Theme name" value={draft.name} maxLength={60} required
                      onChange={event => setDraft({ ...draft, name: event.target.value })} className="border px-2 py-1.5 outline-none" style={panelStyle} />
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(Object.entries(THEME_COLORS) as [ThemeColor, string][]).map(([field, label]) => (
                      <label key={field} className="flex items-center gap-2">
                        <input aria-label={`${label} color`} type="color" value={draft[field]}
                          onChange={event => { const color = event.target.value; setDraft({ ...draft, [field]: color,
                            ...(field === 'accent' ? { accentGlow: accentGlow(color) } : {}) }); }} className="w-8 h-7 border-0 p-0 bg-transparent cursor-pointer" />
                        <span>{label}<span className="block text-[10px] opacity-60">{draft[field]}</span></span>
                      </label>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1">Terminal prompt
                    <input aria-label="Terminal prompt" value={draft.promptSymbol} maxLength={80}
                      onChange={event => setDraft({ ...draft, promptSymbol: event.target.value })} className="border px-2 py-1.5" style={panelStyle} />
                  </label>
                  <div className="border p-3" style={{ backgroundColor: draft.bg, borderColor: draft.border, color: draft.text }}>
                    <div style={{ color: draft.accent }}>{draft.promptSymbol} play music</div>
                    <div className="mt-2 p-2" style={{ backgroundColor: draft.cardBg, color: draft.highlight }}>▶ YouTerm — Theme preview</div>
                    <div className="mt-2" style={{ color: draft.textDim }}>Artist · Album · 3:42</div>
                    <div className="mt-1 flex gap-3"><span style={{ color: draft.warning }}>Loading</span><span style={{ color: draft.error }}>Error</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className={buttonClass} style={{ borderColor: theme.accent, color: theme.accent }}>Save & apply theme</button>
                    <button type="button" className={buttonClass} style={panelStyle} onClick={() => setDraft(null)}>Cancel editing</button>
                  </div>
                </form>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Object.values(THEMES), ...customThemes].map(value => (
                  <div key={value.id} className="border" style={{ borderColor: theme.id === value.id ? value.accent : value.border, backgroundColor: value.bg }}>
                    <button className="text-left w-full p-3 flex flex-col gap-2" onClick={() => onSelectTheme(value.id)} aria-label={`Apply ${value.name}`}>
                      <span className="flex items-center justify-between font-bold" style={{ color: value.highlight }}>{value.name}
                        {theme.id === value.id && <Check className="w-3 h-3" style={{ color: value.accent }} />}
                      </span>
                      <span className="flex gap-1.5">{[value.accent, value.highlight, value.text, value.warning].map((color, index) =>
                        <span key={index} className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />)}</span>
                    </button>
                    {value.id.startsWith('custom_') && <div className="flex gap-3 px-3 pb-2 text-[10px]" style={{ color: value.textDim }}>
                      <button onClick={() => { setDraft({ ...value }); setStatus(''); }}>Edit</button>
                      <button onClick={() => { try { onDeleteCustomTheme(value.id); setStatus('Custom theme removed.'); if (draft?.id === value.id) setDraft(null); }
                        catch { setStatus('The theme could not be removed.'); } }}>Delete</button>
                    </div>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: theme.textDim }}>Font (uses fonts installed on your system)</span>
                <div className="relative flex items-center">
                  <select aria-label="Interface font" className="w-full border p-2 pr-8 appearance-none outline-none font-mono text-xs cursor-pointer" style={panelStyle} value={appearance.font}
                    onChange={event => updateAppearance({ font: event.target.value })}>
                    <option value="system" style={{ backgroundColor: theme.bg, color: theme.text }}>System monospace (Default)</option>
                    {systemFonts.length > 0 ? (
                      systemFonts.map(fontName => (
                        <option key={fontName} value={fontName} style={{ backgroundColor: theme.bg, color: theme.text, fontFamily: `"${fontName}", monospace` }}>
                          {fontName}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="jetbrains" style={{ backgroundColor: theme.bg, color: theme.text }}>JetBrains Mono</option>
                        <option value="fira" style={{ backgroundColor: theme.bg, color: theme.text }}>Fira Code</option>
                        <option value="ubuntu" style={{ backgroundColor: theme.bg, color: theme.text }}>Ubuntu Mono</option>
                      </>
                    )}
                  </select>
                  <ChevronDown className="w-4 h-4 pointer-events-none absolute right-2.5" style={{ color: theme.accent }} />
                </div>
              </label>
              <label className="flex flex-col gap-2">
                <div className="flex justify-between text-[11px]">
                  <span className="font-bold" style={{ color: theme.textDim }}>Font size:</span>
                  <span style={{ color: theme.accent }}>{appearance.fontSize}px</span>
                </div>
                <input aria-label="Interface font size" type="range" min={10} max={18} step={1} value={appearance.fontSize}
                  onChange={event => updateAppearance({ fontSize: Number(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: theme.textDim }}>Track spacing</span>
                <div className="relative flex items-center">
                  <select aria-label="Track spacing" className="w-full border p-2 pr-8 appearance-none outline-none font-mono text-xs cursor-pointer" style={panelStyle} value={appearance.density}
                    onChange={event => updateAppearance({ density: event.target.value as AppearanceConfig['density'] })}>
                    <option value="compact" style={{ backgroundColor: theme.bg, color: theme.text }}>Compact</option>
                    <option value="comfortable" style={{ backgroundColor: theme.bg, color: theme.text }}>Comfortable</option>
                  </select>
                  <ChevronDown className="w-4 h-4 pointer-events-none absolute right-2.5" style={{ color: theme.accent }} />
                </div>
              </label>
              {([
                ['lowPower', 'Low power mode', 'Limit background track preparation and render the spectrum at up to 15 FPS.'],
                ['animations', 'Interface animations', 'Animate transitions and playback indicators.'],
                ['glow', 'Accent glow', 'Show terminal glow and shadows.'],
                ['scanlines', 'CRT scanlines', 'Add a retro scanline overlay.'],
              ] as const).map(([field, label, description]) => (
                <label key={field} className="flex items-start gap-3 border p-3 cursor-pointer" style={panelStyle}>
                  <input type="checkbox" className="mt-0.5" checked={appearance[field]} onChange={event => updateAppearance({ [field]: event.target.checked })} />
                  <span><span className="block font-bold">{label}</span><span className="block mt-1 text-[10px]" style={{ color: theme.textDim }}>{description}</span></span>
                </label>
              ))}
              <button className={`${buttonClass} self-start`} style={panelStyle} onClick={() => updateAppearance(DEFAULT_APPEARANCE)}>Reset appearance</button>
            </div>
          )}
        </div>
        {status && <p role="status" className="border-t pt-2 text-[11px]" style={{ borderColor: theme.border, color: theme.accent }}>{status}</p>}
      </div>
    </div>
  );
};
