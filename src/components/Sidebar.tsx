import React from 'react';
import { LibraryCategory, Playlist, SidebarPreferences, ThemeConfig } from '../types';
import { LIBRARY_ITEMS } from '../data/library';
import { Sparkles, History, Heart, Disc, User, Radio, Plus, ListMusic, Compass, Link2, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

interface SidebarProps {
  theme: ThemeConfig;
  showBackground?: boolean;
  preferences: SidebarPreferences;
  onChangePreferences: (change: Partial<SidebarPreferences>) => void;
  activeCategory: LibraryCategory | null;
  selectedPlaylistId: string | null;
  playingPlaylistId?: string | null;
  playingCategory?: LibraryCategory | null;
  isPlaying?: boolean;
  playlists: Playlist[];
  likedCount: number;
  onSelectCategory: (category: LibraryCategory) => void;
  onSelectPlaylist: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  onOpenImport: () => void;
  onPlaylistContextMenu?: (playlist: Playlist, x: number, y: number) => void;
  isFocused: boolean;
  isLoggedIn?: boolean;
}

const LIBRARY_ICONS: Record<LibraryCategory, LucideIcon> = {
  explore: Compass,
  made_for_you: Sparkles,
  recently_played: History,
  liked_songs: Heart,
  albums: Disc,
  artists: User,
  podcasts: Radio,
};

const SectionHeader = ({ theme, label, expanded, controls, focused, onToggle }: {
  theme: ThemeConfig; label: string; expanded: boolean; controls: string; focused: boolean; onToggle: () => void;
}) => (
  <button type="button" aria-label={label} aria-expanded={expanded} aria-controls={controls}
    title={`${expanded ? 'Collapse' : 'Expand'} ${label}`} onClick={onToggle}
    className="flex w-full shrink-0 items-center gap-1.5 border-b px-3 py-1 text-[11px] font-bold uppercase tracking-wider hover:brightness-125"
    style={{ borderColor: theme.border, color: theme.accent, backgroundColor: 'var(--app-surface-card-bg)' }}>
    {expanded ? <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />}
    <span>{label}</span>
    <span aria-hidden="true" className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left">────────────────────────────────</span>
    {focused && <span aria-hidden="true" className="shrink-0 text-[10px]" style={{ color: theme.highlight }}>[Focused]</span>}
    <span aria-hidden="true">┐</span>
  </button>
);

export const Sidebar: React.FC<SidebarProps> = ({
  theme,
  showBackground = false,
  preferences,
  onChangePreferences,
  activeCategory,
  selectedPlaylistId,
  playingPlaylistId,
  playingCategory,
  isPlaying = false,
  playlists,
  likedCount,
  onSelectCategory,
  onSelectPlaylist,
  onCreatePlaylist,
  onOpenImport,
  onPlaylistContextMenu,
  isFocused,
  isLoggedIn,
}) => {
  const libraryItems = LIBRARY_ITEMS.filter(item => preferences.libraryItems[item.id]);
  const showLibrary = preferences.showLibrary && libraryItems.length > 0;
  if (!showLibrary && !preferences.showPlaylists) return null;

  return (
    <aside
      aria-label="Library and playlists"
      data-background-region="sidebar" data-background-enabled={showBackground}
      className="w-full min-h-0 min-w-0 flex-1 flex flex-col select-none overflow-hidden text-xs"
      style={{
        borderColor: theme.border,
        backgroundColor: showBackground ? 'transparent' : theme.bg,
        ...(!showBackground ? { '--app-surface-bg': theme.bg, '--app-surface-card-bg': theme.cardBg } : {}),
      } as React.CSSProperties}
    >
      {/* Box: Library */}
      {showLibrary && <section
        className={`flex min-h-0 flex-col border-b ${preferences.libraryExpanded ? preferences.showPlaylists && preferences.playlistsExpanded ? 'max-h-[60%]' : 'flex-1' : 'shrink-0'}`}
        style={{ borderColor: theme.border }}>
        <SectionHeader theme={theme} label="Library" expanded={preferences.libraryExpanded}
          controls="sidebar-library-items" focused={isFocused}
          onToggle={() => onChangePreferences({ libraryExpanded: !preferences.libraryExpanded })} />
        <div id="sidebar-library-items" hidden={!preferences.libraryExpanded}
          className={preferences.libraryExpanded ? 'min-h-0 overflow-y-auto py-1 custom-scrollbar' : 'hidden'}>
          {libraryItems.map((item) => {
            const isSelected = activeCategory === item.id && !selectedPlaylistId;
            const isPlayingThis = playingCategory === item.id && !playingPlaylistId;
            const Icon = LIBRARY_ICONS[item.id];
            const count = item.id === 'liked_songs' ? likedCount : undefined;
            return (
              <button
                key={item.id}
                aria-label={item.label}
                aria-current={isSelected ? 'page' : undefined}
                onClick={() => onSelectCategory(item.id)}
                className="w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors group cursor-pointer"
                style={{
                  backgroundColor: isSelected ? 'var(--app-surface-card-bg)' : 'transparent',
                  color: isSelected ? theme.highlight : isPlayingThis ? theme.accent : theme.text,
                  fontWeight: isSelected || isPlayingThis ? 600 : 400,
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={`w-3 text-center flex-shrink-0 ${isPlayingThis && isPlaying ? 'animate-pulse' : ''}`}
                    style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.accent : 'transparent' }}
                  >
                    {isPlayingThis ? (isPlaying ? '▶' : '❚❚') : isSelected ? '›' : ' '}
                  </span>
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.accent : theme.textDim }} />
                  <span className="truncate">{item.label}</span>
                </div>
                {count !== undefined && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 border rounded-none"
                    style={{
                      borderColor: isPlayingThis ? theme.accent : theme.border,
                      color: isPlayingThis ? theme.accent : item.id === 'liked_songs' ? theme.accent : theme.textDim,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>}

      {/* Box: Playlists */}
      {preferences.showPlaylists && <section className={`flex min-h-0 flex-col ${preferences.playlistsExpanded ? 'flex-1' : 'shrink-0'}`}>
        <SectionHeader theme={theme} label="Playlists" expanded={preferences.playlistsExpanded}
          controls="sidebar-playlist-items" focused={isFocused && !showLibrary}
          onToggle={() => onChangePreferences({ playlistsExpanded: !preferences.playlistsExpanded })} />

        <div id="sidebar-playlist-items" hidden={!preferences.playlistsExpanded}
          className={preferences.playlistsExpanded ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>

        <div
          role="group"
          aria-label="Playlist actions"
          className="px-3 py-1.5 flex shrink-0 items-center justify-start gap-3 border-b"
          style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-card-bg)' }}
        >
          <button
            type="button"
            onClick={onOpenImport}
            className="hover:opacity-80 transition-opacity flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-mono"
            style={{ color: theme.accent }}
            title="Import YouTube / YouTube Music Playlist URL"
          >
            <Link2 className="w-3 h-3" />
            <span>[Import]</span>
          </button>
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="hover:opacity-80 transition-opacity flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-mono"
            style={{ color: theme.highlight }}
            title="Create New Playlist"
          >
            <Plus className="w-3 h-3" />
            <span>[+New]</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
          {playlists.map((pl) => {
            const isSelected = selectedPlaylistId === pl.id;
            const isPlayingThis = playingPlaylistId === pl.id;
            return (
              <button
                key={pl.id}
                aria-label={pl.title}
                aria-current={isSelected ? 'page' : undefined}
                onClick={() => onSelectPlaylist(pl)}
                onContextMenu={(e) => {
                  if (!onPlaylistContextMenu) return;
                  e.preventDefault();
                  onPlaylistContextMenu(pl, e.clientX, e.clientY);
                }}
                className="w-full text-left px-3 py-1 flex items-center justify-between transition-colors group cursor-pointer"
                style={{
                  backgroundColor: isSelected ? 'var(--app-surface-card-bg)' : 'transparent',
                  color: isPlayingThis ? theme.accent : isSelected ? theme.highlight : theme.textDim,
                  fontWeight: isSelected || isPlayingThis ? 600 : 400,
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={`w-3 text-center flex-shrink-0 ${isPlayingThis && isPlaying ? 'animate-pulse' : ''}`}
                    style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.accent : 'transparent' }}
                  >
                    {isPlayingThis ? (isPlaying ? '▶' : '❚❚') : isSelected ? '›' : '·'}
                  </span>
                  <ListMusic
                    className="w-3 h-3 flex-shrink-0"
                    style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.accent : theme.textDim }}
                  />
                  <span
                    className="truncate"
                    style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.highlight : theme.text }}
                  >
                    {pl.title}
                  </span>
                </div>
                <span
                  className="text-[10px] flex-shrink-0 ml-1"
                  style={{
                    color: isPlayingThis ? theme.accent : undefined,
                    opacity: isPlayingThis ? 0.9 : 0.6,
                  }}
                >
                  {pl.tracks?.length || 0}
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </section>}
    </aside>
  );
};
