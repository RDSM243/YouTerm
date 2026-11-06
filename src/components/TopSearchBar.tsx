import React, { useRef, useEffect } from 'react';
import { ThemeConfig, UserSession } from '../types';
import { Search, HelpCircle, Palette, Key, Eye, RefreshCw, User } from 'lucide-react';

interface TopSearchBarProps {
  theme: ThemeConfig;
  session?: UserSession;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  onOpenHelp: () => void;
  onOpenAuth: () => void;
  onOpenTheme: () => void;
  asciiMode: string;
  onCycleAsciiMode: () => void;
  isSearching: boolean;
}

export const TopSearchBar: React.FC<TopSearchBarProps> = ({
  theme,
  session,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  isLoading,
  onOpenHelp,
  onOpenAuth,
  onOpenTheme,
  asciiMode,
  onCycleAsciiMode,
  isSearching,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, []);

  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-1.5 border-b text-xs select-none"
      style={{
        borderColor: theme.border,
        backgroundColor: theme.cardBg,
      }}
    >
      {/* Search Input with Box Border */}
      <form onSubmit={onSearchSubmit} className="flex-1 flex items-center gap-2 max-w-2xl">
        <span style={{ color: theme.accent }} className="font-bold flex items-center gap-1">
          <Search className="w-3.5 h-3.5" />
          <span>Search:</span>
        </span>
        <div
          className="flex-1 flex items-center px-2 py-0.5 border rounded-none transition-colors"
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
      <div className="flex items-center gap-1.5 flex-wrap">
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

        {/* Cover Mode Selector */}
        <button
          onClick={onCycleAsciiMode}
          className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125 transition-all text-[11px]"
          title="Cycle Cover Art Mode"
          style={{
            borderColor: theme.border,
            color: theme.accent,
            backgroundColor: theme.bg,
          }}
        >
          <Eye className="w-3 h-3" />
          <span>Cover: {asciiMode}</span>
        </button>


        {/* Theme Switcher */}
        <button
          onClick={onOpenTheme}
          className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125 transition-all text-[11px]"
          title="Change Color Theme (or press 't')"
          style={{
            borderColor: theme.border,
            color: theme.text,
            backgroundColor: theme.bg,
          }}
        >
          <Palette className="w-3 h-3" />
          <span>Theme [{theme.name.split(' ')[0]}]</span>
        </button>

        {/* Auth / Account / Sync */}
        <button
          onClick={onOpenAuth}
          className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125 transition-all text-[11px]"
          title={
            session?.isLoggedIn
              ? `Connected: ${session.email || session.username} (Click to manage account)`
              : 'Connect & Sync YouTube Music Account'
          }
          style={{
            borderColor: theme.border,
            color: session?.isLoggedIn ? theme.highlight : theme.accent,
            backgroundColor: theme.bg,
          }}
        >
          {session?.isLoggedIn ? (
            <>
              <User className="w-3 h-3" />
              <span>{session.email || session.username || 'Account'}</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" />
              <span>Sync Account</span>
            </>
          )}
        </button>

        {/* Help */}
        <button
          onClick={onOpenHelp}
          className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125 transition-all text-[11px] font-bold"
          title="Keyboard Shortcuts & Help"
          style={{
            borderColor: theme.warning,
            color: theme.warning,
            backgroundColor: theme.bg,
          }}
        >
          <HelpCircle className="w-3 h-3" />
          <span>Help [?]</span>
        </button>
      </div>
    </div>
  );
};
