export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  durationFormatted?: string;
  thumbnailUrl: string;
  youtubeId: string;
  isLiked?: boolean;
  playCount?: number;
  genre?: string;
  year?: number;
  sourceType?: 'yt_music' | 'official_audio' | 'lyric_video' | 'video';
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  tracks: Track[];
  thumbnailUrl?: string;
  isCustom?: boolean;
  author?: string;
  updatedAt?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  coverUrl: string;
  tracks: Track[];
  genre?: string;
  label?: string;
}

export interface Artist {
  id: string;
  name: string;
  subscribers?: string;
  thumbnailUrl: string;
  bio?: string;
  albums: Album[];
  topTracks: Track[];
}

export type LibraryCategory =
  | 'made_for_you'
  | 'recently_played'
  | 'liked_songs'
  | 'albums'
  | 'artists'
  | 'podcasts'
  | 'explore';

export interface SidebarPreferences {
  showLibrary: boolean;
  showPlaylists: boolean;
  libraryItems: Record<LibraryCategory, boolean>;
  libraryExpanded: boolean;
  playlistsExpanded: boolean;
}

export type TuiViewMode =
  | 'tracklist'
  | 'ascii_cover'
  | 'split'
  | 'visualizer'
  | 'lyrics';

export type AsciiRenderMode =
  | 'half_block'    // ANSI Half-Block (24-bit TrueColor) ▀
  | 'braille'       // Braille Matrix (⠶⠿⣶)
  | 'original_hd'   // High-Definition Original Image
  | 'matrix_code'   // Digital Matrix Rain Style
  | 'retro_crt';    // Retro Monochrome CRT Style

export type BuiltinThemeId =
  | 'clean_minimalism'
  | 'tokyonight'
  | 'linux_mint'
  | 'retro_green'
  | 'amber_crt'
  | 'nord'
  | 'dracula'
  | 'monokai'
  | 'cyberpunk'
  | 'solarized_dark'
  | 'gruvbox'
  | 'crimson_moon';

export type ThemeId = BuiltinThemeId | `custom_${string}`;

export interface AppearanceConfig {
  font: string;
  fontSize: number;
  density: 'compact' | 'comfortable';
  animations: boolean;
  glow: boolean;
  scanlines: boolean;
  lowPower: boolean;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  bg: string;
  cardBg: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentGlow: string;
  highlight: string;
  warning: string;
  error: string;
  promptSymbol: string;
  hostname: string;
}

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering?: boolean;
  isChangingFormat?: boolean;
  audioFormat?: 'm4a' | 'webm';
  currentTime: number;
  duration: number;
  volume: number; // 0 to 100
  isMuted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  queue: Track[];
  queueIndex: number;
}

export interface AsciiPixel {
  char: string;
  color?: string;       // fg color
  bgColor?: string;     // bg color (for half block)
}

export interface AsciiResult {
  lines: AsciiPixel[][];
  rawText: string;
  rawAnsi: string;
  width: number;
  height: number;
}

export interface AsciiConfig {
  mode: AsciiRenderMode;
  width: number;
  contrast: number;
  brightness: number;
  inverted: boolean;
  colorEnabled: boolean;
  charSet: string;
}

export interface UserSession {
  isLoggedIn: boolean;
  email?: string;
  username: string;
  hostname: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  avatarUrl?: string;
  connectedAt?: string;
}
