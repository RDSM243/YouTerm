import React, { useRef, useEffect } from 'react';
import { ThemeConfig, UserSession } from '../types';
import { Search, LogIn, Settings } from 'lucide-react';

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
  isSearching: boolean;
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
  isSearching,
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
      className="flex items-center justify-between gap-2 px-3 py-1.5 border-b text-xs select-none"
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
          className="min-w-0 flex-1 flex items-center px-2 py-0.5 border rounded-none transition-colors"
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
        ) : isSearching ? (
          <div
            className="px-2 py-0.5 border text-[11px]"
            style={{
              borderColor: theme.accent,
              color: theme.accent,
            }}
          >
            [ Search Active ]
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
