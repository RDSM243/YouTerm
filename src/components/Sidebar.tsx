import React from 'react';
import { LibraryCategory, Playlist, ThemeConfig } from '../types';
import { Sparkles, History, Heart, Disc, User, Radio, Plus, ListMusic, Compass, Link2 } from 'lucide-react';

interface SidebarProps {
  theme: ThemeConfig;
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

export const Sidebar: React.FC<SidebarProps> = ({
  theme,
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
  const libraryItems: { id: LibraryCategory; label: string; icon: any; count?: number }[] = [
    { id: 'explore', label: 'Explore & Trending', icon: Compass },
    { id: 'made_for_you', label: 'Made For You', icon: Sparkles },
    { id: 'recently_played', label: 'Recently Played', icon: History },
    { id: 'liked_songs', label: 'Liked Songs', icon: Heart, count: likedCount },
    { id: 'albums', label: 'Albums & EP', icon: Disc },
    { id: 'artists', label: 'Artists', icon: User },
    { id: 'podcasts', label: 'Podcasts & Ambient', icon: Radio },
  ];

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col border-r select-none overflow-hidden text-xs"
      style={{
        borderColor: theme.border,
        backgroundColor: theme.bg,
      }}
    >
      {/* Box: Library */}
      <div className="border-b" style={{ borderColor: theme.border }}>
        <div
          className="px-3 py-1 font-bold text-[11px] uppercase tracking-wider flex items-center justify-between border-b"
          style={{
            borderColor: theme.border,
            color: theme.accent,
            backgroundColor: theme.cardBg,
          }}
        >
          <span>┌─ Library ────────────────┐</span>
          {isFocused && <span className="text-[10px]" style={{ color: theme.highlight }}>[Focused]</span>}
        </div>
        <div className="py-1">
          {libraryItems.map((item) => {
            const isSelected = activeCategory === item.id && !selectedPlaylistId;
            const isPlayingThis = playingCategory === item.id && !playingPlaylistId;
            return (
              <button
                key={item.id}
                onClick={() => onSelectCategory(item.id)}
                className="w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors group cursor-pointer"
                style={{
                  backgroundColor: isSelected ? theme.cardBg : 'transparent',
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
                  <item.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isPlayingThis ? theme.accent : isSelected ? theme.accent : theme.textDim }} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 border rounded-none"
                    style={{
                      borderColor: isPlayingThis ? theme.accent : theme.border,
                      color: isPlayingThis ? theme.accent : item.id === 'liked_songs' ? theme.accent : theme.textDim,
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Box: Playlists */}
      <div className="flex-1 flex flex-col min-h-0">
        <div
          className="px-3 py-1 font-bold text-[11px] uppercase tracking-wider flex items-center justify-between border-b"
          style={{
            borderColor: theme.border,
            color: theme.accent,
            backgroundColor: theme.cardBg,
          }}
        >
          <span>┌─ Playlists ──────────────┐</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenImport}
              className="hover:opacity-80 transition-opacity flex items-center gap-1 text-[10px] font-mono"
              style={{ color: theme.accent }}
              title="Import YouTube / YouTube Music Playlist URL"
            >
              <Link2 className="w-3 h-3" />
              <span>[Import]</span>
            </button>
            <button
              onClick={onCreatePlaylist}
              className="hover:opacity-80 transition-opacity flex items-center gap-1 text-[10px] font-mono"
              style={{ color: theme.highlight }}
              title="Create New Playlist"
            >
              <Plus className="w-3 h-3" />
              <span>[+New]</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
          {playlists.map((pl) => {
            const isSelected = selectedPlaylistId === pl.id;
            const isPlayingThis = playingPlaylistId === pl.id;
            return (
              <button
                key={pl.id}
                onClick={() => onSelectPlaylist(pl)}
                onContextMenu={(e) => {
                  if (!onPlaylistContextMenu) return;
                  e.preventDefault();
                  onPlaylistContextMenu(pl, e.clientX, e.clientY);
                }}
                className="w-full text-left px-3 py-1 flex items-center justify-between transition-colors group cursor-pointer"
                style={{
                  backgroundColor: isSelected ? theme.cardBg : 'transparent',
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
    </aside>
  );
};
