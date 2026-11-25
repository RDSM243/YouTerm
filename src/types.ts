export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
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
  | 'custom';

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

export interface BackgroundConfig {
  enabled: boolean;
  imageRevision: string;
  imageName: string;
  brightness: number;
  darkness: number;
  panelOpacity: number;
  showInSidebar: boolean;
  showInPlayer: boolean;
  showInSpectrum: boolean;
}

export interface AppearanceConfig {
  font: string;
  fontSize: number;
  density: 'compact' | 'comfortable';
  animations: boolean;
  glow: boolean;
  scanlines: boolean;
  lowPower: boolean;
  hideAlbumCover: boolean;
  background: BackgroundConfig;
  skin: SkinConfig;
}

export interface SkinConfig {
  panelRadius: number;
  controlRadius: number;
  artworkRadius: number;
  panelGap: number;
  borderWidth: number;
  shadow: 'none' | 'soft' | 'deep';
  sidebar: 'left' | 'right' | 'hidden';
  playerPosition: 'bottom' | 'top';
  controlStyle: 'terminal' | 'minimal';
  progressStyle: 'ascii' | 'continuous';
  showHeader: boolean;
  layout: DockLayout | null;
}

export type DockPanelId = 'sidebar' | 'playlists' | 'tracks' | 'artwork' | 'lyrics' | 'spectrum' | 'mixer' | 'player';
export type DockPosition = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type DockNode = { type: 'panel'; panel: DockPanelId } | {
  type: 'split'; id: string; axis: 'row' | 'column'; ratio: number; first: DockNode; second: DockNode;
};
export interface DockLayout { version: 1; root: DockNode; }

export type AudioMixerPresetId =
  | 'flat'
  | 'bass_boost'
  | 'treble_clarity'
  | 'mid_vocal'
  | 'v_shape'
  | 'rock'
  | 'electronic'
  | 'hip_hop'
  | 'acoustic'
  | 'late_night'
  | 'custom';

export type AudioMixerViewMode = 'all' | 'tone' | 'bands';

export interface AudioMixerState {
  enabled: boolean;
  preset: AudioMixerPresetId;
  viewMode: AudioMixerViewMode;
  bass: number;      // -15 to +15 dB (100 Hz Low Shelf - Graves)
  mid: number;       // -15 to +15 dB (1 kHz Peak - Médios)
  treble: number;    // -15 to +15 dB (8 kHz High Shelf - Agudos)
  subBass: number;   // -12 to +12 dB (55 Hz Deep Sub-Bass)
  presence: number;  // -12 to +12 dB (2.8 kHz Vocal Presence)
  air: number;       // -12 to +12 dB (13.5 kHz High Air / Brilliance)
  preamp: number;    // -12 to +12 dB
  balance: number;   // -100 (Left) to +100 (Right)
  compressor: boolean;
  antiClip: boolean;
  mono: boolean;
  bands: number[];   // 10 ISO bands: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k (-12 to +12 dB)
}

export interface SkinSnapshot {
  appearance: AppearanceConfig;
  viewMode: TuiViewMode;
  artworkMode: AsciiRenderMode;
}

export interface PlayerSkin extends SkinSnapshot {
  theme: ThemeConfig;
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
  look?: SkinSnapshot;
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

export type ShortcutActionId =
  | 'playPause'
  | 'moveDown'
  | 'moveUp'
  | 'selectTrack'
  | 'nextTrack'
  | 'prevTrack'
  | 'toggleLike'
  | 'focusSearch'
  | 'switchFocus'
  | 'viewTracklist'
  | 'viewCover'
  | 'viewSplit'
  | 'viewVisualizer'
  | 'toggleShuffle'
  | 'cycleRepeat'
  | 'toggleMute'
  | 'volumeUp'
  | 'volumeDown'
  | 'seekBackward'
  | 'seekForward'
  | 'contextMenu'
  | 'importPlaylist'
  | 'cycleTheme'
  | 'openShortcuts';

export type ShortcutBindings = Record<ShortcutActionId, string[]>;
