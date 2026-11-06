import type { LibraryCategory, Playlist, SidebarPreferences } from '../types';
import { LIBRARY_ITEMS } from '../data/library';

const SIDEBAR_KEY = 'youterm_sidebar_v1';

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  showLibrary: true,
  showPlaylists: true,
  libraryExpanded: true,
  playlistsExpanded: true,
  libraryItems: {
    explore: true,
    made_for_you: true,
    recently_played: true,
    liked_songs: true,
    albums: true,
    artists: true,
    podcasts: true,
  },
};

export function normalizeSidebarPreferences(value: unknown): SidebarPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<SidebarPreferences> : {};
  const result = { ...DEFAULT_SIDEBAR_PREFERENCES, libraryItems: { ...DEFAULT_SIDEBAR_PREFERENCES.libraryItems } };
  for (const key of ['showLibrary', 'showPlaylists', 'libraryExpanded', 'playlistsExpanded'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  if (input.libraryItems && typeof input.libraryItems === 'object' && !Array.isArray(input.libraryItems)) {
    for (const { id } of LIBRARY_ITEMS) {
      if (typeof input.libraryItems[id] === 'boolean') result.libraryItems[id] = input.libraryItems[id];
    }
  }
  return result;
}

export function loadSidebarPreferences(): SidebarPreferences {
  try { return normalizeSidebarPreferences(JSON.parse(localStorage.getItem(SIDEBAR_KEY) || '{}')); }
  catch { return normalizeSidebarPreferences(null); }
}

export function saveSidebarPreferences(preferences: SidebarPreferences): void {
  localStorage.setItem(SIDEBAR_KEY, JSON.stringify(normalizeSidebarPreferences(preferences)));
}

export function getVisibleLibraryCategories(preferences: SidebarPreferences): LibraryCategory[] {
  return preferences.showLibrary ? LIBRARY_ITEMS.filter(item => preferences.libraryItems[item.id]).map(item => item.id) : [];
}

export function resolveSidebarSelection(
  preferences: SidebarPreferences,
  playlists: Playlist[],
  current: { activeCategory: LibraryCategory | null; selectedPlaylistId: string | null },
): { activeCategory: LibraryCategory | null; selectedPlaylist: Playlist | null } {
  const visibleCategories = getVisibleLibraryCategories(preferences);
  const playlist = preferences.showPlaylists ? playlists.find(item => item.id === current.selectedPlaylistId) : undefined;
  if (playlist) return { activeCategory: null, selectedPlaylist: playlist };
  if (current.activeCategory && visibleCategories.includes(current.activeCategory)) {
    return { activeCategory: current.activeCategory, selectedPlaylist: null };
  }
  if (visibleCategories.length > 0) return { activeCategory: visibleCategories[0], selectedPlaylist: null };
  return { activeCategory: null, selectedPlaylist: preferences.showPlaylists ? playlists[0] || null : null };
}
