import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, HelpCircle, LayoutPanelLeft, Palette, Settings, Sliders, User, Volume2, X } from 'lucide-react';
import type { SidebarPreferences, ThemeConfig, UserSession } from '../types';
import { LIBRARY_ITEMS } from '../data/library';
import { DEFAULT_SIDEBAR_PREFERENCES } from '../services/sidebarStorage';
import type { PlayerPreferences } from '../services/libraryStorage';
import { AuthModal } from './AuthModal';
import { HelpModal } from './HelpModal';
import { ThemeModal, type ThemeModalProps } from './ThemeModal';

const TABS = [
  { id: 'general', label: 'General', icon: LayoutPanelLeft, description: 'Choose which sections appear in the sidebar.' },
  { id: 'appearance', label: 'Appearance', icon: Sliders, description: 'Fonts, spacing, effects and performance.' },
  { id: 'themes', label: 'Themes', icon: Palette, description: 'Choose a theme or create your own terminal colors.' },
  { id: 'playback', label: 'Playback', icon: Volume2, description: 'Playback volume, mute and audio format.' },
  { id: 'account', label: 'Account', icon: User, description: 'Connect to YouTube Music and manage library sync.' },
  { id: 'help', label: 'Help', icon: HelpCircle, description: 'Keyboard shortcuts for playback and navigation.' },
] as const;

export type SettingsTab = typeof TABS[number]['id'];
export type PlaybackSettings = Pick<PlayerPreferences, 'volume' | 'isMuted' | 'audioFormat'>;

interface SettingsModalProps extends Omit<ThemeModalProps, 'embedded' | 'section'> {
  initialTab: SettingsTab;
  sidebarPreferences: SidebarPreferences;
  onChangeSidebarPreferences: (change: Partial<SidebarPreferences>) => void;
  preferences: PlaybackSettings;
  onChangePreferences: (change: Partial<PlaybackSettings>) => void;
  isChangingFormat: boolean;
  session: UserSession;
  onSaveSession: (session: UserSession) => void;
  onSyncAccount: (session?: UserSession) => Promise<string>;
  onDisconnect: () => void;
}

interface SelectSettingProps {
  theme: ThemeConfig;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

const SelectSetting = ({ theme, label, value, options, onChange, disabled }: SelectSettingProps) => (
  <label className="flex min-w-0 flex-col gap-2">
    <span className="font-bold" style={{ color: theme.textDim }}>{label}</span>
    <span className="relative flex items-center">
      <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
        className="w-full min-w-0 border p-2 pr-8 outline-none disabled:opacity-40"
        style={{ borderColor: theme.border, backgroundColor: theme.bg, color: theme.text }}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 h-3.5 w-3.5" style={{ color: theme.accent }} />
    </span>
  </label>
);

const ToggleSetting = ({ theme, label, description, checked, onChange, disabled = false }: {
  theme: ThemeConfig; label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) => (
  <label className="flex cursor-pointer items-start gap-3 border p-3" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
    <input aria-label={label} type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="mt-0.5" style={{ accentColor: theme.accent }} />
    <span><span className="block font-bold">{label}</span>
      {description && <span className="mt-1 block text-[11px]" style={{ color: theme.textDim }}>{description}</span>}
    </span>
  </label>
);

const RangeSetting = ({ theme, label, value, min, max, step = 1, displayValue, onChange }: {
  theme: ThemeConfig; label: string; value: number; min: number; max: number; step?: number;
  displayValue?: string; onChange: (value: number) => void;
}) => (
  <label className="flex flex-col gap-3">
    <span className="flex justify-between gap-3">
      <span className="font-bold" style={{ color: theme.textDim }}>{label}</span>
      <span style={{ color: theme.accent }}>{displayValue ?? value}</span>
    </span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
      onChange={event => onChange(Number(event.target.value))} style={{ accentColor: theme.accent }} />
  </label>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab, sidebarPreferences, onChangeSidebarPreferences, preferences, onChangePreferences, isChangingFormat,
  session, onSaveSession, onSyncAccount, onDisconnect, onClose, ...themeProps
}) => {
  const theme = themeProps.currentTheme;
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const currentTab = TABS.find(tab => tab.id === activeTab)!;
  const panelStyle = { borderColor: theme.border, backgroundColor: theme.bg, color: theme.text };

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const dialog: HTMLDivElement | null = dialogRef.current;
        const elements = Array.from(dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
        ) || []).filter(element => element.offsetParent !== null);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!dialog?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [activeTab]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 font-mono"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border text-xs shadow-2xl"
        style={{ borderColor: theme.accent, backgroundColor: theme.cardBg, color: theme.text, boxShadow: `0 0 30px ${theme.accentGlow}` }}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4" style={{ borderColor: theme.border }}>
          <h2 id="settings-title" className="flex items-center gap-2 text-sm font-bold" style={{ color: theme.highlight }}>
            <Settings className="h-4 w-4" style={{ color: theme.accent }} /> Settings
          </h2>
          <button type="button" onClick={onClose} aria-label="Close settings" title="Close settings (Esc)"
            className="border p-1.5 hover:brightness-125" style={panelStyle}><X className="h-3.5 w-3.5" /></button>
        </div>

        <div role="tablist" aria-label="Settings categories" className="flex shrink-0 flex-wrap gap-1 border-b p-3" style={{ borderColor: theme.border }}>
          {TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`}
            aria-controls="settings-panel" aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={event => {
              let target = index;
              if (event.key === 'ArrowRight') target = (index + 1) % TABS.length;
              else if (event.key === 'ArrowLeft') target = (index + TABS.length - 1) % TABS.length;
              else if (event.key === 'Home') target = 0;
              else if (event.key === 'End') target = TABS.length - 1;
              else return;
              event.preventDefault();
              const next = TABS[target].id;
              setActiveTab(next);
              dialogRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus();
            }}
            className="flex items-center gap-1.5 whitespace-nowrap border px-3 py-2 hover:brightness-125"
            style={{ ...panelStyle, borderColor: activeTab === tab.id ? theme.accent : theme.border, color: activeTab === tab.id ? theme.highlight : theme.textDim }}>
            <tab.icon className="h-3.5 w-3.5" />{tab.label}
          </button>)}
        </div>

        <div ref={scrollRef} id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          <p className="mb-5" style={{ color: theme.textDim }}>{currentTab.description}</p>

          {activeTab === 'general' && <div className="flex flex-col gap-5">
            <ToggleSetting theme={theme} label="Show Library" checked={sidebarPreferences.showLibrary}
              description="Show or hide the entire Library section."
              onChange={showLibrary => onChangeSidebarPreferences({ showLibrary })} />
            <fieldset disabled={!sidebarPreferences.showLibrary}
              className={`flex min-w-0 flex-col gap-3 ${sidebarPreferences.showLibrary ? '' : 'opacity-50'}`}>
              <legend className="mb-3 font-bold" style={{ color: theme.highlight }}>Library items</legend>
              <p role="status" className="text-[11px]" style={{ color: theme.textDim }}>
                {sidebarPreferences.showLibrary
                  ? `${LIBRARY_ITEMS.filter(item => sidebarPreferences.libraryItems[item.id]).length} of ${LIBRARY_ITEMS.length} items visible.`
                  : 'Library is hidden. Your item selection is kept.'}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {LIBRARY_ITEMS.map(item => <div key={item.id}>
                  <ToggleSetting theme={theme} label={item.label} checked={sidebarPreferences.libraryItems[item.id]}
                    onChange={checked => onChangeSidebarPreferences({ libraryItems: { ...sidebarPreferences.libraryItems, [item.id]: checked } })} />
                </div>)}
              </div>
            </fieldset>
            <ToggleSetting theme={theme} label="Show Playlists" checked={sidebarPreferences.showPlaylists}
              description="Show or hide all playlists, including the Import and New buttons."
              onChange={showPlaylists => onChangeSidebarPreferences({ showPlaylists })} />
            <button type="button" className="self-start border px-3 py-1.5 hover:brightness-125" style={panelStyle}
              onClick={() => onChangeSidebarPreferences(DEFAULT_SIDEBAR_PREFERENCES)}>Reset sidebar</button>
          </div>}

          {(activeTab === 'themes' || activeTab === 'appearance') && <ThemeModal {...themeProps} onClose={onClose} embedded section={activeTab} />}

          {activeTab === 'playback' && <div className="flex flex-col gap-5">
            <RangeSetting theme={theme} label="Playback volume" min={0} max={100} value={preferences.volume}
              displayValue={`${preferences.volume}%`} onChange={volume => onChangePreferences({ volume })} />
            <ToggleSetting theme={theme} label="Mute audio" checked={preferences.isMuted}
              onChange={isMuted => onChangePreferences({ isMuted })} />
            <SelectSetting theme={theme} label="Audio format" value={preferences.audioFormat} disabled={isChangingFormat}
              options={[{ value: 'm4a', label: 'M4A / AAC' }, { value: 'webm', label: 'WebM / Opus' }]}
              onChange={audioFormat => onChangePreferences({ audioFormat: audioFormat as PlaybackSettings['audioFormat'] })} />
          </div>}

          {activeTab === 'account' && <AuthModal theme={theme} session={session} onSaveSession={onSaveSession}
            onSyncAccount={onSyncAccount} onDisconnect={onDisconnect} onClose={onClose} embedded />}

          {activeTab === 'help' && <HelpModal theme={theme} onClose={onClose} embedded />}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3 text-[11px]" style={{ borderColor: theme.border, color: theme.textDim }}>
          <span>Changes apply immediately.</span>
          <button type="button" onClick={onClose} className="shrink-0 border px-3 py-1 hover:brightness-125" style={panelStyle}>Close [Esc]</button>
        </div>
      </div>
    </div>
  );
};
