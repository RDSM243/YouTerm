import { DEFAULT_THEME_ID, THEMES } from '../data/themes';
import { loadCustomThemes } from './themeStorage';
import { AsciiConfig, LibraryCategory, Playlist, ThemeId, Track, TuiViewMode, UserSession } from '../types';

const STORAGE_KEYS = {
  LIKED_TRACKS: 'ytmusic_liked_tracks_v1',
  LIKED_TRACK_METADATA: 'ytmusic_liked_track_metadata_v1',
  PLAYLISTS: 'ytmusic_playlists_v1',
  HISTORY: 'ytmusic_history_v1',
  SESSION: 'ytmusic_session_v1',
  THEME: 'ytmusic_theme_v1',
  ASCII_CONFIG: 'ytmusic_ascii_config_v1',
  PLAYER_PREFERENCES: 'ytmusic_player_preferences_v1',
};

export interface PlayerPreferences {
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  audioFormat: 'm4a' | 'webm';
  viewMode: TuiViewMode;
  activeCategory: LibraryCategory;
  spectrumMode: 'bars' | 'wave' | 'matrix';
  spectrumSensitivity: number;
}

export const defaultPlayerPreferences: PlayerPreferences = {
  volume: 100,
  isMuted: false,
  shuffle: false,
  repeat: 'off',
  audioFormat: 'm4a',
  viewMode: 'tracklist',
  activeCategory: 'explore',
  spectrumMode: 'bars',
  spectrumSensitivity: 1.0,
};

export const defaultAsciiConfig: AsciiConfig = {
  mode: 'half_block',
  width: 48,
  contrast: 20,
  brightness: 5,
  inverted: false,
  colorEnabled: true,
  charSet: 'standard',
};

export const defaultSession: UserSession = {
  isLoggedIn: false,
  username: typeof window !== 'undefined' ? window.__YOUTERM_DESKTOP__?.username || 'user' : 'user',
  hostname: typeof window !== 'undefined' ? window.__YOUTERM_DESKTOP__?.hostname || 'linux' : 'linux',
};

const NON_MUSIC_FILTER = /\b(cs50[a-z0-9]*|web\s*dev|data\s*science|gamedev|godot|unity|unreal|programação|programming|curso|course|tutorial|aulas?|videos?\s+(de|sobre|para|da|do)|review|unboxing|gameplay)\b/i;

export function loadLikedTrackIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIKED_TRACKS);
    if (raw) {
      const accountTracks = loadAccountLikedTracks();
      if (accountTracks.length > 0) {
        return new Set<string>(accountTracks.map(t => t.id));
      }
      return new Set<string>(JSON.parse(raw) as string[]);
    }
  } catch (e) {}
  return new Set<string>();
}

export function saveLikedTrackIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LIKED_TRACKS, JSON.stringify(Array.from(ids)));
  } catch (e) {}
}

export function loadAccountLikedTracks(): Track[] {
  try {
    const tracks = JSON.parse(localStorage.getItem(STORAGE_KEYS.LIKED_TRACK_METADATA) || '[]');
    if (Array.isArray(tracks)) {
      return tracks.filter((t: Track) => (t.duration || 0) <= 1200 && !NON_MUSIC_FILTER.test(t.title || ''));
    }
    return [];
  } catch { return []; }
}

export function saveAccountLikedTracks(tracks: Track[]): void {
  try { localStorage.setItem(STORAGE_KEYS.LIKED_TRACK_METADATA, JSON.stringify(tracks)); }
  catch {}
}

export function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const filtered = parsed.filter((p: Playlist) => !NON_MUSIC_FILTER.test(p.title || ''));
        const userPlaylists = filtered.filter((p: Playlist) => !p.id.startsWith('yt-cat-'));
        if (userPlaylists.length > 0) {
          return userPlaylists;
        }
        return filtered;
      }
    }
  } catch (e) {}
  return [];
}

export function savePlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
  } catch (e) {}
}

export function loadHistory(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

export function saveHistory(history: Track[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history.slice(0, 50)));
  } catch (e) {}
}

export function loadUserSession(): UserSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return defaultSession;
}

export function saveUserSession(session: UserSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
  } catch (e) {}
}

export function loadThemeId(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.THEME) as ThemeId;
    if (raw && (Object.hasOwn(THEMES, raw) || loadCustomThemes().some(theme => theme.id === raw))) return raw;
  } catch (e) {}
  return DEFAULT_THEME_ID;
}

export function saveThemeId(themeId: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEYS.THEME, themeId);
  } catch (e) {}
}

export function loadAsciiConfig(): AsciiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ASCII_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      const validModes = ['half_block', 'braille', 'original_hd', 'matrix_code', 'retro_crt'];
      if (parsed && !validModes.includes(parsed.mode)) {
        parsed.mode = 'half_block';
      }
      return { ...defaultAsciiConfig, ...parsed };
    }
  } catch (e) {}
  return defaultAsciiConfig;
}

export function saveAsciiConfig(config: AsciiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ASCII_CONFIG, JSON.stringify(config));
  } catch (e) {}
}

export function loadPlayerPreferences(): PlayerPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PLAYER_PREFERENCES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
            ? Math.max(0, Math.min(100, Math.round(parsed.volume)))
            : defaultPlayerPreferences.volume,
          isMuted: typeof parsed.isMuted === 'boolean' ? parsed.isMuted : defaultPlayerPreferences.isMuted,
          shuffle: typeof parsed.shuffle === 'boolean' ? parsed.shuffle : defaultPlayerPreferences.shuffle,
          repeat: ['off', 'all', 'one'].includes(parsed.repeat) ? parsed.repeat : defaultPlayerPreferences.repeat,
          audioFormat: ['m4a', 'webm'].includes(parsed.audioFormat) ? parsed.audioFormat : defaultPlayerPreferences.audioFormat,
          viewMode: ['tracklist', 'ascii_cover', 'split', 'visualizer', 'lyrics'].includes(parsed.viewMode)
            ? parsed.viewMode
            : defaultPlayerPreferences.viewMode,
          activeCategory: ['explore', 'made_for_you', 'recently_played', 'liked_songs', 'albums', 'artists', 'podcasts'].includes(parsed.activeCategory)
            ? parsed.activeCategory
            : defaultPlayerPreferences.activeCategory,
          spectrumMode: ['bars', 'wave', 'matrix'].includes(parsed.spectrumMode)
            ? parsed.spectrumMode
            : defaultPlayerPreferences.spectrumMode,
          spectrumSensitivity: typeof parsed.spectrumSensitivity === 'number' && Number.isFinite(parsed.spectrumSensitivity)
            ? (parsed.spectrumSensitivity === 0 ? 0 : Math.max(0.4, Math.min(4.0, parsed.spectrumSensitivity)))
            : defaultPlayerPreferences.spectrumSensitivity,
        };
      }
    }
  } catch {}
  return defaultPlayerPreferences;
}

export function savePlayerPreferences(partial: Partial<PlayerPreferences>): void {
  try {
    const current = loadPlayerPreferences();
    const updated = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEYS.PLAYER_PREFERENCES, JSON.stringify(updated));
  } catch {}
}
