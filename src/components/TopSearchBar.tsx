import React, { useRef, useEffect } from 'react';
import { ThemeConfig, TuiViewMode, UserSession } from '../types';
import { Search, LogIn, Settings, LayoutDashboard } from 'lucide-react';

interface TopSearchBarProps {
  theme: ThemeConfig;
  session?: UserSession;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  onOpenAuth: () => void;
  onOpenSettings: () => void;
  isModalOpen: boolean;
  compactNavigation?: boolean;
  viewMode: TuiViewMode;
  onChangeViewMode: (view: TuiViewMode) => void;
  onEditLayout: () => void;
  isLayoutEditing: boolean;
  hasCustomLayout: boolean;
}

export const TopSearchBar: React.FC<TopSearchBarProps> = ({
  theme,
  session,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  isLoading,
  onOpenAuth,
  onOpenSettings,
  isModalOpen,
  compactNavigation = false,
  viewMode,
  onChangeViewMode,
  onEditLayout,
  isLayoutEditing,
  hasCustomLayout,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen) return;
      // '/' focuses search if not already in an input
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Esc blurs search
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  return (
    <div
      className="app-search skin-panel flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 border-b text-xs select-none"
      style={{
        borderColor: theme.border,
        backgroundColor: 'var(--app-surface-card-bg)',
      }}
    >
      {/* Search Input with Box Border */}
      <form onSubmit={onSearchSubmit} className="min-w-0 flex-1 flex items-center gap-2 max-w-2xl">
        <span style={{ color: theme.accent }} className="font-bold flex items-center gap-1">
          <Search className="w-3.5 h-3.5" />
          <span>Search:</span>
        </span>
        <div
          className="skin-field min-w-0 flex-1 flex items-center px-2 py-0.5 border rounded-none transition-colors"
          style={{
            borderColor: theme.border,
            backgroundColor: theme.bg,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Type song, album or artist name... (Press '/' to focus, 'Enter' to search)"
            className="w-full bg-transparent outline-none text-xs"
            style={{ color: theme.text }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="text-[10px] px-1 hover:opacity-80"
              style={{ color: theme.textDim }}
            >
              [×]
            </button>
          )}
        </div>
      </form>

      {/* Right Quick Action Status Badges */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" aria-label="Edit layout" disabled={isLayoutEditing || isModalOpen} onClick={onEditLayout}
          className="flex items-center gap-1 border px-2 py-1 text-[11px] disabled:opacity-40"
          style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.accent }} title="Arrange panels by dragging">
          <LayoutDashboard className="h-3.5 w-3.5" /><span className="hidden sm:inline">Edit layout</span>
        </button>
        {compactNavigation && <select aria-label="Player view" value={viewMode}
          disabled={isLayoutEditing}
          onChange={event => onChangeViewMode(event.target.value as TuiViewMode)}
          className="max-w-28 border px-2 py-1 text-[11px]" style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }}>
          <option value="tracklist">Tracks</option><option value="ascii_cover">Cover</option>
          <option value="split">Split view</option><option value="visualizer">Spectrum</option>
          {hasCustomLayout && <option value="custom">Custom layout</option>}
        </select>}
        {/* Loading Indicator */}
        {isLoading ? (
          <div
            className="px-2 py-0.5 border animate-pulse text-[11px]"
            style={{
              borderColor: theme.warning,
              color: theme.warning,
              backgroundColor: 'rgba(240, 198, 116, 0.1)',
            }}
          >
            [ Loading... ]
          </div>
        ) : null}

        {!session?.isLoggedIn && <button
          type="button"
          onClick={onOpenAuth}
          className="px-2 py-0.5 border flex items-center gap-1 whitespace-nowrap hover:brightness-125 transition-all text-[11px]"
          title="Log in to your YouTube Music account"
          style={{
            borderColor: theme.border,
            color: theme.accent,
            backgroundColor: 'var(--app-surface-bg)',
          }}
        >
          <LogIn className="w-3 h-3" />
          <span>Log in</span>
        </button>}

        <button
          type="button"
          onClick={onOpenSettings}
          disabled={isLayoutEditing}
          aria-label="Open settings"
          aria-haspopup="dialog"
          className="p-1 border flex items-center justify-center hover:brightness-125 transition-all"
          title="Settings"
          style={{
            borderColor: theme.border,
            color: theme.accent,
            backgroundColor: 'var(--app-surface-bg)',
          }}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
