import React, { useState, useEffect, useRef, useCallback } from 'react';
import { version as appVersion } from '../package.json';
import {
  Album,
  AppearanceConfig,
  BackgroundConfig,
  DockLayout,
  DockPanelId,
  AsciiConfig,
  AsciiResult,
  LibraryCategory,
  PlayerState,
  PlayerSkin,
  Playlist,
  SidebarPreferences,
  ThemeConfig,
  ThemeId,
  Track,
  TuiViewMode,
  UserSession,
} from './types';
import { DEFAULT_THEME_ID, THEMES } from './data/themes';
import { getFontFamily, loadAppearance, loadCustomThemes, normalizeAppearance, resolveTheme, saveAppearance, saveCustomThemes, validateCustomTheme } from './services/themeStorage';
import { skinVariables } from './services/skin';
import { createDockLayout, dockPanels } from './services/dockLayout';
import {
  defaultSession,
  loadAsciiConfig,
  loadHistory,
  loadAccountLikedTracks,
  loadLikedTrackIds,
  loadPlaylists,
  loadPlayerPreferences,
  loadThemeId,
  loadUserSession,
  saveAsciiConfig,
  saveHistory,
  saveAccountLikedTracks,
  saveLikedTrackIds,
  savePlaylists,
  savePlayerPreferences,
  saveThemeId,
  saveUserSession,
} from './services/libraryStorage';
import { audioEngine } from './services/youtubeAudioEngine';
import { syncYouTubeLibrary } from './services/youtubeAccount';
import { loadCoverArtwork } from './services/coverArtwork';
import { applyTrackAlbum, loadTrackAlbum, normalizeTrackAlbum } from './services/trackAlbum';
import { normalizeBackground, surfaceColor } from './services/background';
import { convertImageToAscii } from './utils/asciiConverter';
import {
  addTrackToPlaylist,
  addTracksToPlaylist,
  duplicatePlaylist,
  insertAfterIndex,
  isEditablePlaylist,
  moveTrack,
  playlistHasTrack,
  removeTrackAt,
  removeTrackFromPlaylist,
  renamePlaylist,
  shuffled,
} from './services/playlistOps';
import { copyText } from './services/clipboard';
import { openExternal } from './services/desktop';
import { getVisibleLibraryCategories, loadSidebarPreferences, normalizeSidebarPreferences, resolveSidebarSelection, saveSidebarPreferences } from './services/sidebarStorage';

import { TopSearchBar } from './components/TopSearchBar';
import { BackgroundLayer } from './components/BackgroundLayer';
import { Sidebar } from './components/Sidebar';
import { ResizableSplit } from './components/ResizableSplit';
import { DockWorkspace } from './components/DockWorkspace';
import { TrackListView, formatSeconds } from './components/TrackListView';
import { AsciiArtViewer } from './components/AsciiArtViewer';
import { SpectrumVisualizer } from './components/SpectrumVisualizer';
import { LyricsView } from './components/LyricsView';
import { BottomPlayerBar } from './components/BottomPlayerBar';
import { AuthModal } from './components/AuthModal';
import { ImportPlaylistModal } from './components/ImportPlaylistModal';
import { SettingsModal, type PlaybackSettings, type SettingsTab } from './components/SettingsModal';
import { CreatePlaylistModal } from './components/CreatePlaylistModal';
import { ContextMenu, ContextMenuItem, ContextMenuState } from './components/ContextMenu';

import {
  Terminal, Eye, Disc, Activity, Sparkles, Layers, ListMusic, Compass, Link2,
  Play, Pause, SkipBack, SkipForward, ListStart, ListEnd, ListPlus, Heart, Trash2,
  Copy, CopyPlus, Link as LinkIcon, ExternalLink, Search, Shuffle, Repeat, Volume2, Pencil, FolderPlus,
  Settings, HelpCircle, FolderOpen,
} from 'lucide-react';

export default function App() {
  // Theme and Session
  const [themeId, setThemeId] = useState<ThemeId>(loadThemeId);
  const [customThemes, setCustomThemes] = useState<ThemeConfig[]>(loadCustomThemes);
  const [appearance, setAppearance] = useState<AppearanceConfig>(loadAppearance);
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const handleChangeAppearance = useCallback((value: AppearanceConfig) => {
    const next = normalizeAppearance(value);
    saveAppearance(next);
    appearanceRef.current = next;
    setAppearance(next);
  }, []);
  const handleChangeBackground = useCallback((change: Partial<BackgroundConfig>) => {
    const previous = appearanceRef.current;
    handleChangeAppearance({ ...previous, background: normalizeBackground({ ...previous.background, ...change }) });
  }, [handleChangeAppearance]);
  const [loadedBackground, setLoadedBackground] = useState('');
  const handleBackgroundReady = useCallback((revision: string, ready: boolean) => {
    setLoadedBackground(previous => ready ? revision : previous === revision ? '' : previous);
  }, []);
  const backgroundVisible = appearance.background.enabled && !!appearance.background.imageRevision
    && loadedBackground === appearance.background.imageRevision;
  const surfaceOpacity = backgroundVisible ? appearance.background.panelOpacity / 100 : 1;
  const availableThemes = React.useMemo(() => [...Object.values(THEMES), ...customThemes], [customThemes]);
  const selectedTheme = resolveTheme(themeId, customThemes);
  const theme = React.useMemo(() => appearance.glow ? selectedTheme : { ...selectedTheme, accentGlow: 'transparent' }, [selectedTheme, appearance.glow]);
  useEffect(() => {
    document.documentElement.style.setProperty('--font-interface', getFontFamily(appearance.font));
    document.documentElement.style.setProperty('--app-accent', theme.accent);
    document.documentElement.style.fontSize = `${appearance.fontSize / 12 * 16}px`;
  }, [appearance.font, appearance.fontSize, theme.accent]);
  const [session, setSession] = useState<UserSession>(loadUserSession);

  const initialPreferences = React.useMemo(() => loadPlayerPreferences(), []);
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(loadSidebarPreferences);
  const visibleLibraryCategories = React.useMemo(() => getVisibleLibraryCategories(sidebarPreferences), [sidebarPreferences]);
  const sidebarAvailable = visibleLibraryCategories.length > 0 || sidebarPreferences.showPlaylists;

  // Library & Playlists State
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(loadLikedTrackIds);
  const [accountLikedTracks, setAccountLikedTracks] = useState<Track[]>(loadAccountLikedTracks);
  const [history, setHistory] = useState<Track[]>(loadHistory);
  const [exploreTracks, setExploreTracks] = useState<Track[]>([]);
  const initialSidebarSelection = React.useMemo(() => resolveSidebarSelection(sidebarPreferences, playlists,
    { activeCategory: initialPreferences.activeCategory, selectedPlaylistId: null }), []);
  const [activeCategory, setActiveCategory] = useState<LibraryCategory | null>(initialSidebarSelection.activeCategory);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(initialSidebarSelection.selectedPlaylist);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [playingPlaylistId, setPlayingPlaylistId] = useState<string | null>(null);
  const [playingCategory, setPlayingCategory] = useState<LibraryCategory | null>(null);
  const [coverArtworkUrl, setCoverArtworkUrl] = useState<string | null>(null);

  // Views & UI State
  const [viewMode, setViewMode] = useState<TuiViewMode>(initialPreferences.viewMode);
  const [isLayoutEditing, setIsLayoutEditing] = useState(false);
  const [draftLayout, setDraftLayout] = useState<DockLayout | null>(null);
  const defaultDockLayout = React.useMemo(() => createDockLayout(viewMode === 'custom' ? 'split' : viewMode,
    appearance.skin, sidebarAvailable), [viewMode, appearance.skin.sidebar, appearance.skin.playerPosition, sidebarAvailable]);
  const dockLayout = draftLayout || appearance.skin.layout || defaultDockLayout;
  const customWorkspace = isLayoutEditing || viewMode === 'custom';
  const hasSidebar = sidebarAvailable && (customWorkspace ? dockPanels(dockLayout.root).includes('sidebar') : appearance.skin.sidebar !== 'hidden');
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [isSidebarFocused, setIsSidebarFocused] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingSearch, setIsLoadingSearch] = useState<boolean>(false);
  const scanlinesEnabled = appearance.scanlines;
  const [playbackWarning, setPlaybackWarning] = useState<string | null>(null);
  const failedVideoIdsRef = useRef<Set<string>>(new Set());
  const trackRetryCountRef = useRef<Record<string, number>>({});

  // Modals
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState<boolean>(false);
  const [createSeedTracks, setCreateSeedTracks] = useState<Track[] | null>(null);
  const [renamingPlaylist, setRenamingPlaylist] = useState<Playlist | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ASCII Engine State
  const [asciiConfig, setAsciiConfig] = useState<AsciiConfig>(loadAsciiConfig);
  const [asciiResult, setAsciiResult] = useState<AsciiResult | null>(null);
  const [backgroundAscii, setBackgroundAscii] = useState<AsciiResult | null>(null);
  const [isAsciiLoading, setIsAsciiLoading] = useState<boolean>(false);

  // Player State - Starts clean and loads live from YouTube Music
  const [playerState, setPlayerState] = useState<PlayerState>({
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    isChangingFormat: false,
    audioFormat: initialPreferences.audioFormat,
    currentTime: 0,
    duration: 0,
    volume: initialPreferences.volume,
    isMuted: initialPreferences.isMuted,
    shuffle: initialPreferences.shuffle,
    repeat: initialPreferences.repeat,
    queue: [],
    queueIndex: 0,
  });

  useEffect(() => {
    audioEngine.setFormat(initialPreferences.audioFormat);
    audioEngine.setVolume(initialPreferences.volume);
    if (initialPreferences.isMuted) {
      audioEngine.mute();
    } else {
      audioEngine.unMute();
    }
  }, [initialPreferences]);

  useEffect(() => {
    if (viewMode === 'custom' && !appearance.skin.layout && !isLayoutEditing) {
      setViewMode('split'); savePlayerPreferences({ viewMode: 'split' });
    }
  }, [viewMode, appearance.skin.layout, isLayoutEditing]);

  useEffect(() => {
    const next = resolveSidebarSelection(sidebarPreferences, playlists,
      { activeCategory, selectedPlaylistId: selectedPlaylist?.id || null });
    const sourceChanged = next.activeCategory !== activeCategory || next.selectedPlaylist?.id !== selectedPlaylist?.id;
    if (next.activeCategory !== activeCategory) setActiveCategory(next.activeCategory);
    if (next.selectedPlaylist !== selectedPlaylist) setSelectedPlaylist(next.selectedPlaylist);
    if (sourceChanged) {
      setSelectedAlbum(null);
      setSelectedTrackIndex(0);
    }
    if (!hasSidebar) setIsSidebarFocused(false);
  }, [sidebarPreferences, playlists, activeCategory, selectedPlaylist, hasSidebar]);

  // Fetch Live YouTube Music Explore Feed on Mount
  const fetchExploreFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/explore');
      const data = await res.json();
      if (data.categories && data.categories.length > 0) {
        const allTracks: Track[] = data.categories.flatMap((cat: any) => cat.tracks || []);
        if (allTracks.length > 0) {
          setExploreTracks(allTracks);

          // Generate dynamic live playlists from YouTube Music categories
          const dynamicPlaylists: Playlist[] = data.categories.map((cat: any) => ({
            id: `yt-cat-${cat.id}`,
            title: cat.name,
            description: `YouTube Music: ${cat.name}`,
            tracks: cat.tracks,
            thumbnailUrl: cat.tracks[0]?.thumbnailUrl,
            author: 'YouTube Music',
          }));

          setPlaylists((prev) => {
            const userCustoms = prev.filter((p) => p.isCustom && !p.id.startsWith('yt-cat-'));
            if (session.isLoggedIn || userCustoms.length > 0) {
              savePlaylists(userCustoms);
              return userCustoms;
            }
            return dynamicPlaylists;
          });
        }
      } else if (data.items && data.items.length > 0) {
        setExploreTracks(data.items);
      }
    } catch (e) {
      console.warn('Failed to load YouTube Music explore feed:', e);
    }
  }, []);

  useEffect(() => {
    fetchExploreFeed();
  }, [fetchExploreFeed]);

  // Use the supplied credentials immediately after Google sign-in or token entry.
  const handleSyncAccount = useCallback(async (credentials: UserSession = session): Promise<string> => {
    const library = await syncYouTubeLibrary(credentials.accessToken);
    const customPlaylists = library.playlists.map(playlist => ({ ...playlist, isCustom: true }));
    setSelectedPlaylist(previous => previous ? customPlaylists.find(playlist => playlist.id === previous.id) || previous : previous);
    setPlaylists(previous => {
      const nonMusicFilter = /\b(cs50[a-z0-9]*|web\s*dev|data\s*science|gamedev|godot|unity|unreal|programação|programming|curso|course|tutorial|aulas?|videos?\s+(de|sobre|para|da|do)|review|unboxing|gameplay)\b/i;
      const localOnly = previous.filter(p => !p.id.startsWith('yt-cat-') && p.id.startsWith('custom-pl-') && !nonMusicFilter.test(p.title || ''));
      const merged = [...customPlaylists, ...localOnly];
      savePlaylists(merged);
      return merged;
    });
    setLikedTrackIds(() => {
      const freshLiked = new Set<string>(library.tracks.map(track => track.id));
      saveLikedTrackIds(freshLiked);
      return freshLiked;
    });
    setAccountLikedTracks(library.tracks);
    saveAccountLikedTracks(library.tracks);
    return `Successfully synced! Loaded ${customPlaylists.length} playlists and ${library.tracks.length} liked tracks from YouTube Music.`;
  }, [session]);

  // Import Playlist by URL or ID
  const handleImportPlaylist = useCallback(
    async (urlOrId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/playlist/fetch?url=${encodeURIComponent(urlOrId)}`);
        const data = await res.json();

        if (data.playlist && data.playlist.tracks && data.playlist.tracks.length > 0) {
          const newPlaylist: Playlist = {
            id: data.playlist.id || `yt-pl-${Date.now()}`,
            title: data.playlist.title || 'YouTube Music Playlist',
            description: data.playlist.description || `Imported from YouTube (${data.playlist.trackCount || data.playlist.tracks.length} tracks)`,
            tracks: data.playlist.tracks,
            isCustom: true,
            author: session.username,
          };

          const updated = [newPlaylist, ...playlists.filter((p) => p.id !== newPlaylist.id)];
          setPlaylists(updated);
          savePlaylists(updated);
          setSelectedPlaylist(newPlaylist);
          setActiveCategory(null);
          setIsSearching(false);
          setSelectedTrackIndex(0);

          // Auto play first track
          if (newPlaylist.tracks.length > 0) {
            handlePlayTrack(newPlaylist.tracks[0], newPlaylist.tracks, { playlistId: newPlaylist.id });
          }
          return true;
        }
        return false;
      } catch (e) {
        console.error('Import playlist error:', e);
        return false;
      }
    },
    [playlists, session.username]
  );

  // Calculate current tracks to display
  const displayedTracks: Track[] = React.useMemo(() => {
    if (isSearching && searchResults.length > 0) {
      return searchResults;
    }
    if (selectedPlaylist) {
      return selectedPlaylist.tracks.map((t) => ({
        ...t,
        isLiked: likedTrackIds.has(t.id),
      }));
    }
    if (activeCategory === 'explore') {
      return exploreTracks.map((t) => ({
        ...t,
        isLiked: likedTrackIds.has(t.id),
      }));
    }
    if (activeCategory === 'liked_songs') {
      const allKnown = [...accountLikedTracks, ...history, ...exploreTracks, ...searchResults, ...playlists.flatMap(playlist => playlist.tracks)];
      const seen = new Set<string>();
      return allKnown
        .filter((t) => likedTrackIds.has(t.id) && !seen.has(t.id) && (seen.add(t.id), true))
        .map((t) => ({
          ...t,
          isLiked: true,
        }));
    }
    if (activeCategory === 'recently_played') {
      return history.map((t) => ({
        ...t,
        isLiked: likedTrackIds.has(t.id),
      }));
    }
    if (activeCategory === 'albums' && selectedAlbum) {
      return selectedAlbum.tracks.map((t) => ({
        ...t,
        isLiked: likedTrackIds.has(t.id),
      }));
    }
    if (activeCategory === 'made_for_you') {
      return playlists[0]?.tracks || exploreTracks;
    }
    if (activeCategory === 'podcasts') {
      return exploreTracks.slice(10, 25);
    }
    return activeCategory ? exploreTracks : [];
  }, [isSearching, searchResults, selectedPlaylist, activeCategory, exploreTracks, selectedAlbum, playlists, likedTrackIds, history, accountLikedTracks]);

  useEffect(() => {
    if (playerState.currentTrack || isSearching || displayedTracks.length === 0) return;
    setPlayerState(previous => previous.currentTrack ? previous : {
      ...previous,
      currentTrack: normalizeTrackAlbum(displayedTracks[0]),
      queue: displayedTracks,
      queueIndex: 0,
      duration: displayedTracks[0].duration || 210,
    });
  }, [displayedTracks, isSearching, playerState.currentTrack]);

  useEffect(() => {
    const track = playerState.currentTrack;
    if (!track?.youtubeId || track.albumId) return;
    const videoId = track.youtubeId;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadTrackAlbum(videoId, controller.signal).then(album => {
        if (controller.signal.aborted) return;
        const updateTracks = (tracks: Track[]): Track[] => {
          const next = tracks.map(item => applyTrackAlbum(item, videoId, album));
          return next.some((item, index) => item !== tracks[index]) ? next : tracks;
        };
        setPlayerState(previous => ({
          ...previous,
          currentTrack: previous.currentTrack ? applyTrackAlbum(previous.currentTrack, videoId, album) : null,
          queue: updateTracks(previous.queue),
        }));
        setPlaylists(previous => {
          const next = previous.map(playlist => {
            const tracks = updateTracks(playlist.tracks);
            return tracks === playlist.tracks ? playlist : { ...playlist, tracks };
          });
          if (!next.some((playlist, index) => playlist !== previous[index])) return previous;
          savePlaylists(next);
          return next;
        });
        setHistory(previous => {
          const next = updateTracks(previous);
          if (next !== previous) saveHistory(next);
          return next;
        });
        setAccountLikedTracks(previous => {
          const next = updateTracks(previous);
          if (next !== previous) saveAccountLikedTracks(next);
          return next;
        });
        setExploreTracks(updateTracks);
        setSearchResults(updateTracks);
      }).catch(() => {
        // Missing album metadata must not interrupt playback.
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [playerState.currentTrack?.youtubeId, playerState.currentTrack?.albumId]);

  const selectedVideoId = displayedTracks[selectedTrackIndex]?.youtubeId;
  const nextQueueIndex = playerState.queueIndex + 1 < playerState.queue.length
    ? playerState.queueIndex + 1
    : playerState.repeat === 'all' ? 0 : -1;
  const nextVideoId = playerState.queue[nextQueueIndex]?.youtubeId;
  useEffect(() => { if (appearance.lowPower) audioEngine.clearPreparation(); }, [appearance.lowPower]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedVideoId && !appearance.lowPower) audioEngine.prepare(selectedVideoId);
      if (nextVideoId && (!appearance.lowPower || playerState.isPlaying)) audioEngine.prepare(nextVideoId);
    }, 250);
    return () => clearTimeout(timer);
  }, [selectedVideoId, nextVideoId, playerState.currentTrack?.youtubeId, playerState.isPlaying, appearance.lowPower]);

  const sourcePreparationIds = React.useMemo(() => [
    ...displayedTracks.slice(selectedTrackIndex, selectedTrackIndex + 7),
    ...playerState.queue.slice(playerState.queueIndex + 1, playerState.queueIndex + 8),
  ].map(track => track.youtubeId), [displayedTracks, selectedTrackIndex, playerState.queue, playerState.queueIndex]);
  useEffect(() => {
    if (appearance.lowPower) { void audioEngine.prepareList([]); return; }
    const timer = setTimeout(() => { void audioEngine.prepareList(sourcePreparationIds); }, 500);
    return () => clearTimeout(timer);
  }, [sourcePreparationIds, appearance.lowPower]);

  // Batch resolve real durations for tracks with placeholder 3:30 / 210s duration
  const resolvedDurationsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toResolve = displayedTracks.filter(
      (t) =>
        t.youtubeId &&
        (!t.duration || t.duration === 210 || t.durationFormatted === '3:30') &&
        !resolvedDurationsRef.current.has(t.youtubeId)
    );
    if (toResolve.length === 0) return;

    toResolve.forEach((t) => {
      if (t.youtubeId) resolvedDurationsRef.current.add(t.youtubeId);
    });

    const ids = Array.from(new Set(toResolve.map((t) => t.youtubeId).filter(Boolean) as string[]));
    let isCancelled = false;

    fetch('/api/tracks/durations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify({ ids }),
    })
      .then((res) => res.json())
      .then((data: { durations?: Record<string, number> }) => {
        if (isCancelled || !data?.durations || Object.keys(data.durations).length === 0) return;
        const durMap = data.durations;

        const applyDuration = (t: Track): Track => {
          const ytId = t.youtubeId || t.id;
          const realSec = ytId ? durMap[ytId] : undefined;
          if (realSec && realSec > 0) {
            return {
              ...t,
              duration: realSec,
              durationFormatted: formatSeconds(realSec),
            };
          }
          return t;
        };

        if (selectedPlaylist) {
          const hasUpdates = selectedPlaylist.tracks.some(
            (t) => t.youtubeId && durMap[t.youtubeId] && durMap[t.youtubeId] !== t.duration
          );
          if (hasUpdates) {
            const updated = {
              ...selectedPlaylist,
              tracks: selectedPlaylist.tracks.map(applyDuration),
            };
            replacePlaylist(updated);
          }
        }

        setPlaylists((prevPlaylists) => {
          let anyChanged = false;
          const next = prevPlaylists.map((pl) => {
            const updatedTracks = pl.tracks.map(applyDuration);
            const changed = updatedTracks.some((ut, idx) => ut.duration !== pl.tracks[idx].duration);
            if (changed) {
              anyChanged = true;
              return { ...pl, tracks: updatedTracks };
            }
            return pl;
          });
          if (anyChanged) {
            savePlaylists(next);
            return next;
          }
          return prevPlaylists;
        });

        setPlayerState((prev) => ({
          ...prev,
          currentTrack: prev.currentTrack ? applyDuration(prev.currentTrack) : null,
          queue: prev.queue.map(applyDuration),
        }));
      })
      .catch((err) => {
        console.warn('Could not resolve track durations:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [displayedTracks, selectedPlaylist, session.token]);

  // Current view title
  const currentViewTitle = React.useMemo(() => {
    if (isSearching) return `YouTube Search Results for "${searchQuery}"`;
    if (selectedPlaylist) return selectedPlaylist.title;
    if (!activeCategory) return sidebarPreferences.showPlaylists ? 'Your playlists' : 'Your music';
    if (activeCategory === 'explore') return 'YouTube Music Live Charts & Trending';
    if (activeCategory === 'liked_songs') return 'Liked Songs (Favorites)';
    if (activeCategory === 'recently_played') return 'Recently Played Tracks';
    if (activeCategory === 'albums' && selectedAlbum) return `${selectedAlbum.title} by ${selectedAlbum.artist}`;
    if (activeCategory === 'made_for_you') return 'Made For You (Daily Mixes)';
    if (activeCategory === 'artists') return 'Top Artists Library';
    if (activeCategory === 'podcasts') return 'Podcasts, Classical & Ambient Space';
    return 'YouTube Music Stream';
  }, [isSearching, searchQuery, selectedPlaylist, activeCategory, selectedAlbum, sidebarPreferences.showPlaylists]);

  // Load HD cover artwork when active track changes
  useEffect(() => {
    const track = playerState.currentTrack;
    if (!track?.thumbnailUrl) {
      setCoverArtworkUrl(null);
      return;
    }
    const controller = new AbortController();
    loadCoverArtwork(track.thumbnailUrl, track.youtubeId, controller.signal)
      .then((art) => {
        if (!controller.signal.aborted) {
          setCoverArtworkUrl(art.url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCoverArtworkUrl(track.thumbnailUrl);
        }
      });
    return () => controller.abort();
  }, [playerState.currentTrack?.thumbnailUrl, playerState.currentTrack?.youtubeId]);

  // Convert current track thumbnail into ASCII art
  const updateAsciiCover = useCallback(async (track: Track | null, config: AsciiConfig) => {
    if (!track || !track.thumbnailUrl) return;
    setIsAsciiLoading(true);
    try {
      const artUrl = coverArtworkUrl || track.thumbnailUrl;
      const result = await convertImageToAscii(artUrl, config);
      setAsciiResult(result);

      // Also generate low-contrast background watermark matching the chosen render mode
      const bgResult = await convertImageToAscii(artUrl, {
        ...config,
        width: 38,
        mode: config.mode === 'original_hd' ? 'half_block' : config.mode,
      });
      setBackgroundAscii(bgResult);
    } catch (e) {
      console.warn('ASCII conversion failed:', e);
    } finally {
      setIsAsciiLoading(false);
    }
  }, [coverArtworkUrl]);

  useEffect(() => {
    if (playerState.currentTrack) {
      updateAsciiCover(playerState.currentTrack, asciiConfig);
    }
  }, [playerState.currentTrack, asciiConfig, updateAsciiCover]);

  // Handle Play Track
  const handlePlayTrack = useCallback(
    (
      track: Track,
      newQueue?: Track[],
      sourceContext?: { playlistId?: string | null; category?: LibraryCategory | null }
    ) => {
      track = normalizeTrackAlbum(track);
      const queueToUse = newQueue || displayedTracks;
      const idx = queueToUse.findIndex((t) => t.id === track.id || t.youtubeId === track.youtubeId);

      setPlaybackWarning(null);

      // Determine the playback source for visual feedback
      if (sourceContext !== undefined) {
        setPlayingPlaylistId(sourceContext.playlistId ?? null);
        setPlayingCategory(sourceContext.category ?? null);
      } else if (!newQueue) {
        if (isSearching) {
          setPlayingPlaylistId(null);
          setPlayingCategory(null);
        } else if (selectedPlaylist) {
          setPlayingPlaylistId(selectedPlaylist.id);
          setPlayingCategory(null);
        } else if (activeCategory) {
          setPlayingPlaylistId(null);
          setPlayingCategory(activeCategory);
        } else {
          setPlayingPlaylistId(null);
          setPlayingCategory(null);
        }
      }

      setPlayerState((prev) => ({
        ...prev,
        currentTrack: track,
        isPlaying: true,
        isBuffering: true,
        isChangingFormat: false,
        queue: queueToUse,
        queueIndex: idx !== -1 ? idx : 0,
        duration: track.duration || 188,
        currentTime: 0,
      }));

      // Update history
      const updatedHistory = [track, ...history.filter((t) => t.id !== track.id)].slice(0, 50);
      setHistory(updatedHistory);
      saveHistory(updatedHistory);

      // Stream via YouTube Audio Engine
      if (track.youtubeId) {
        audioEngine.loadAndPlay(track.youtubeId);
      } else {
        // Resolve on the fly if youtubeId is missing
        setPlaybackWarning(`[INFO] Finding audio stream for "${track.title}"...`);
        fetch(`/api/resolve-track?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.track?.youtubeId) {
              const updated: Track = { ...track, youtubeId: data.track.youtubeId };
              setPlayerState((prev) => ({
                ...prev,
                currentTrack: updated,
                queue: prev.queue.map((t) => (t.id === track.id ? updated : t)),
              }));
              audioEngine.loadAndPlay(data.track.youtubeId);
              setPlaybackWarning(null);
            } else {
              setPlaybackWarning(`[WARN] Audio unavailable for "${track.title}".`);
              setPlayerState((prev) => ({ ...prev, isBuffering: false, isPlaying: false }));
            }
          })
          .catch(() => {
            setPlaybackWarning(`[WARN] Audio unavailable for "${track.title}".`);
            setPlayerState((prev) => ({ ...prev, isBuffering: false, isPlaying: false }));
          });
      }
    },
    [displayedTracks, history, isSearching, selectedPlaylist, activeCategory]
  );

  // Play / Pause Toggle
  const handleTogglePlay = useCallback(() => {
    if (!playerState.currentTrack) {
      if (displayedTracks.length > 0) handlePlayTrack(displayedTracks[0]);
      return;
    }
    if (playerState.isPlaying) {
      audioEngine.pause();
      setPlayerState((prev) => ({ ...prev, isPlaying: false, isBuffering: false }));
    } else {
      if (playerState.currentTrack?.youtubeId && audioEngine.getCurrentVideoId() !== playerState.currentTrack.youtubeId) {
        audioEngine.loadAndPlay(playerState.currentTrack.youtubeId);
      } else {
        audioEngine.play();
      }
      setPlayerState((prev) => ({ ...prev, isPlaying: true }));
    }
  }, [playerState.currentTrack, playerState.isPlaying, displayedTracks, handlePlayTrack]);

  // Next Track
  const handleNextTrack = useCallback(() => {
    const { queue, queueIndex, shuffle, repeat } = playerState;
    if (queue.length === 0) return;

    let nextIndex = queueIndex + 1;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      if (repeat === 'all') {
        nextIndex = 0;
      } else {
        return;
      }
    }

    const nextTrack = queue[nextIndex];
    if (nextTrack) {
      handlePlayTrack(nextTrack, queue);
    }
  }, [playerState, handlePlayTrack]);

  // Prev Track
  const handlePrevTrack = useCallback(() => {
    const { queue, queueIndex } = playerState;
    if (queue.length === 0) return;

    const prevIndex = Math.max(0, queueIndex - 1);
    const prevTrack = queue[prevIndex];
    if (prevTrack) {
      handlePlayTrack(prevTrack, queue);
    }
  }, [playerState, handlePlayTrack]);

  // Handle Audio Engine Error with Safe, Loop-Free Auto-Fallback
  const handleAudioError = useCallback(
    async (errorCode: number, failedVideoId: string, message?: string) => {
      console.warn(`[App] Handling audio error ${errorCode} for video ${failedVideoId}`);
      const current = playerState.currentTrack;
      if (!current || current.youtubeId !== failedVideoId) return;

      setPlayerState((prev) => ({ ...prev, isPlaying: false, isBuffering: false }));
      // Browser autoplay policy / user interaction requirement:
      if (errorCode === 0) {
        setPlaybackWarning(`[WARN] ${message || 'Playback was blocked. Click PLAY to start audio.'}`);
        return;
      }

      failedVideoIdsRef.current.add(failedVideoId);
      const retryCount = (trackRetryCountRef.current[current.id] || 0) + 1;
      trackRetryCountRef.current[current.id] = retryCount;

      if (retryCount > 1) {
        console.warn(`[App] Track "${current.title}" exceeded retry limit. Advancing to next track.`);
        setPlaybackWarning(`[INFO] Audio unavailable for "${current.title}". Skipping to next song...`);
        setTimeout(() => setPlaybackWarning(null), 3000);
        handleNextTrack();
        return;
      }

      setPlaybackWarning(`[WARN] Audio unavailable. Finding alternative version for "${current.title}"...`);

      try {
        let altTrack: any = null;

        // 1. Try /api/resolve-track
        try {
          const res = await fetch(
            `/api/resolve-track?artist=${encodeURIComponent(current.artist)}&title=${encodeURIComponent(
              current.title
            )}&excludeId=${encodeURIComponent(failedVideoId)}`
          );
          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const data = await res.json();
              if (data.success && data.track && data.track.youtubeId && !failedVideoIdsRef.current.has(data.track.youtubeId)) {
                altTrack = data.track;
              }
            }
          }
        } catch (e) {
          console.warn('[App] resolve-track endpoint error:', e);
        }

        // 2. Secondary fallback: search directly via /api/search
        if (!altTrack) {
          try {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(current.artist + ' ' + current.title + ' audio')}`);
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              if (searchData.items && searchData.items.length > 0) {
                const found = searchData.items.find(
                  (i: Track) => i.youtubeId && !failedVideoIdsRef.current.has(i.youtubeId)
                );
                if (found) {
                  altTrack = found;
                }
              }
            }
          } catch (e) {
            console.warn('[App] search fallback error:', e);
          }
        }

        if (audioEngine.getCurrentVideoId() !== failedVideoId) return;
        if (altTrack && altTrack.youtubeId) {
          console.log(`[App] Found alternative video ID: ${altTrack.youtubeId} for track "${current.title}"`);
          setPlaybackWarning(`[OK] Switched to alternative audio stream for "${current.title}"`);
          setTimeout(() => setPlaybackWarning(null), 2500);

          const updatedTrack: Track = {
            ...current,
            youtubeId: altTrack.youtubeId,
          };

          setPlayerState((prev) => ({
            ...prev,
            currentTrack: updatedTrack,
            queue: prev.queue.map((t) => (t.id === current.id ? updatedTrack : t)),
          }));

          audioEngine.loadAndPlay(altTrack.youtubeId);
          return;
        }
      } catch (err) {
        console.error('[App] Error resolving alternative track:', err);
      }

      // If resolving failed, skip immediately to next track
      if (audioEngine.getCurrentVideoId() !== failedVideoId) return;
      setPlaybackWarning(`[INFO] Audio unavailable for "${current.title}". Advancing to next track...`);
      setTimeout(() => setPlaybackWarning(null), 3000);
      handleNextTrack();
    },
    [playerState.currentTrack, handleNextTrack]
  );

  // Audio Engine Event Callbacks
  useEffect(() => {
    audioEngine.setCallbacks(
      (state: number) => {
        if (state === 1) {
          // Playing
          setPlaybackWarning(null);
          setPlayerState((prev) => ({ ...prev, isPlaying: true, isBuffering: false, isChangingFormat: false }));
        } else if (state === 3) {
          setPlayerState((prev) => ({ ...prev, isBuffering: true }));
        } else if (state === 2 || state === 0) {
          // Paused / Ended
          setPlayerState((prev) => ({ ...prev, isPlaying: false, isBuffering: false, isChangingFormat: false }));
          if (state === 0) {
            handleNextTrack();
          }
        }
      },
      (currentTime: number, duration: number) => {
        setPlayerState((prev) => {
          const validDuration = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : prev.duration;
          const current = prev.currentTrack;
          let updatedTrack = current;
          if (current && validDuration > 0 && (current.duration !== validDuration || current.durationFormatted === '3:30')) {
            updatedTrack = {
              ...current,
              duration: validDuration,
              durationFormatted: formatSeconds(validDuration),
            };
          }
          return {
            ...prev,
            currentTime,
            duration: validDuration > 0 ? validDuration : prev.duration,
            currentTrack: updatedTrack,
            queue: updatedTrack && updatedTrack !== current
              ? prev.queue.map((t) => (t.id === updatedTrack.id || t.youtubeId === updatedTrack.youtubeId ? updatedTrack : t))
              : prev.queue,
          };
        });
      },
      handleAudioError,
      (format: 'm4a' | 'webm', isChanging: boolean) => {
        setPlayerState((prev) => ({
          ...prev,
          audioFormat: format,
          isChangingFormat: isChanging,
        }));
        if (!isChanging) {
          savePlayerPreferences({ audioFormat: format });
        }
      }
    );
  }, [playerState.queue, playerState.queueIndex, handleNextTrack, handleAudioError]);

  const handleVolumeChange = useCallback((vol: number) => {
    const bounded = Math.max(0, Math.min(100, Math.round(vol)));
    audioEngine.setVolume(bounded);
    audioEngine.unMute();
    setPlayerState((prev) => ({ ...prev, volume: bounded, isMuted: false }));
    savePlayerPreferences({ volume: bounded, isMuted: false });
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    const target = Math.max(0, playerState.duration > 0 ? Math.min(seconds, playerState.duration) : seconds);
    audioEngine.seekTo(target);
    setPlayerState(previous => ({ ...previous, currentTime: target }));
  }, [playerState.duration]);

  const handleToggleMute = useCallback(() => {
    setPlayerState((prev) => {
      const nextMuted = !prev.isMuted;
      if (nextMuted) {
        audioEngine.mute();
      } else {
        audioEngine.unMute();
      }
      savePlayerPreferences({ isMuted: nextMuted });
      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  const handleToggleShuffle = useCallback(() => {
    setPlayerState((prev) => {
      const nextShuffle = !prev.shuffle;
      savePlayerPreferences({ shuffle: nextShuffle });
      return { ...prev, shuffle: nextShuffle };
    });
  }, []);

  const handleCycleRepeat = useCallback(() => {
    setPlayerState((prev) => {
      const nextRepeat: 'off' | 'all' | 'one' =
        prev.repeat === 'off' ? 'all' : prev.repeat === 'all' ? 'one' : 'off';
      savePlayerPreferences({ repeat: nextRepeat });
      return { ...prev, repeat: nextRepeat };
    });
  }, []);

  const handleStartLayoutEditing = useCallback(() => {
    setContextMenu(null); setSettingsTab(null);
    setDraftLayout(viewMode === 'custom' ? appearanceRef.current.skin.layout || defaultDockLayout : defaultDockLayout);
    setIsLayoutEditing(true);
  }, [viewMode, defaultDockLayout]);

  const handleCancelLayout = useCallback(() => {
    setDraftLayout(null); setIsLayoutEditing(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Edit layout"]')?.focus());
  }, []);

  const handleDockLayoutChange = (layout: DockLayout, commit: boolean) => {
    if (isLayoutEditing) { setDraftLayout(layout); return; }
    const previous = appearanceRef.current;
    const next = { ...previous, skin: { ...previous.skin, layout } };
    if (commit) {
      try { handleChangeAppearance(next); }
      catch { showToast('The panel sizes could not be saved.'); }
    } else { appearanceRef.current = next; setAppearance(next); }
  };

  const handleSaveLayout = () => {
    if (!draftLayout) return;
    try {
      const previous = appearanceRef.current;
      handleChangeAppearance({ ...previous, skin: { ...previous.skin, layout: draftLayout } });
      setViewMode('custom'); savePlayerPreferences({ viewMode: 'custom' });
      handleCancelLayout();
      showToast('Custom layout saved.');
    } catch { showToast('The layout could not be saved. Your draft is still open.'); }
  };

  const handleSetViewMode = useCallback((mode: TuiViewMode) => {
    if (isLayoutEditing) return;
    if (mode === 'custom' && !appearanceRef.current.skin.layout) { handleStartLayoutEditing(); return; }
    setViewMode(mode);
    savePlayerPreferences({ viewMode: mode });
  }, [isLayoutEditing, handleStartLayoutEditing]);

  const handleSetActiveCategory = useCallback((cat: LibraryCategory | null) => {
    setActiveCategory(cat);
    if (cat) {
      savePlayerPreferences({ activeCategory: cat });
    }
  }, []);

  const handleChangeSidebarPreferences = (change: Partial<SidebarPreferences>) => {
    const next = normalizeSidebarPreferences({ ...sidebarPreferences, ...change });
    setSidebarPreferences(next);
    try { saveSidebarPreferences(next); }
    catch { showToast('Sidebar preferences apply for this session but could not be saved.'); }
  };

  const handleChangeAsciiConfig = useCallback((change: Partial<AsciiConfig>) => {
    const next = { ...asciiConfig, ...change };
    setAsciiConfig(next);
    saveAsciiConfig(next);
  }, [asciiConfig]);

  const handleApplySkin = useCallback((value: PlayerSkin) => {
    const nextAppearance = normalizeAppearance(value.appearance);
    const isNewTheme = value.theme.id.startsWith('custom_') && !customThemes.some(item => item.id === value.theme.id);
    const nextTheme = isNewTheme ? validateCustomTheme({ ...value.theme,
      look: { appearance: nextAppearance, viewMode: value.viewMode, artworkMode: value.artworkMode } }) : value.theme;
    const nextThemes = isNewTheme ? [...customThemes, nextTheme] : customThemes;
    if (isNewTheme) saveCustomThemes(nextThemes);
    handleChangeAppearance(nextAppearance);
    setCustomThemes(nextThemes);
    setThemeId(nextTheme.id);
    saveThemeId(nextTheme.id);
    handleSetViewMode(value.viewMode);
    handleChangeAsciiConfig({ mode: value.artworkMode });
  }, [customThemes, handleChangeAppearance, handleSetViewMode, handleChangeAsciiConfig]);

  const handleChangePreferences = (change: Partial<PlaybackSettings>) => {
    if (change.volume !== undefined) handleVolumeChange(change.volume);
    if (change.isMuted !== undefined && change.isMuted !== playerState.isMuted) handleToggleMute();
    if (change.audioFormat !== undefined) {
      audioEngine.setFormat(change.audioFormat);
      setPlayerState(previous => ({ ...previous, audioFormat: change.audioFormat }));
    }
    savePlayerPreferences(change);
  };

  // Toggle Like Status
  const handleToggleLike = useCallback(
    (track?: Track) => {
      const target = track || playerState.currentTrack;
      if (!target) return;

      const newLikedIds = new Set<string>(likedTrackIds);
      if (newLikedIds.has(target.id)) {
        newLikedIds.delete(target.id);
      } else {
        newLikedIds.add(target.id);
      }

      setLikedTrackIds(newLikedIds);
      saveLikedTrackIds(newLikedIds);

      if (playerState.currentTrack && playerState.currentTrack.id === target.id) {
        setPlayerState((prev) => ({
          ...prev,
          currentTrack: prev.currentTrack
            ? { ...prev.currentTrack, isLiked: newLikedIds.has(target.id) }
            : null,
        }));
      }
    },
    [likedTrackIds, playerState.currentTrack]
  );

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsTab !== null || isLayoutEditing) return;
      const isInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement;
      if (isInput) return;
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement instanceof HTMLButtonElement) return;

      if (showAuthModal || showImportModal || showCreatePlaylistModal || renamingPlaylist) {
        if (e.key === 'Escape') {
          setShowAuthModal(false);
          setShowImportModal(false);
          setShowCreatePlaylistModal(false);
          setRenamingPlaylist(null);
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setSelectedTrackIndex((prev) => Math.min(displayedTracks.length - 1, prev + 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setSelectedTrackIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'PageDown':
          e.preventDefault();
          setSelectedTrackIndex((prev) => Math.min(displayedTracks.length - 1, prev + 8));
          break;
        case 'PageUp':
          e.preventDefault();
          setSelectedTrackIndex((prev) => Math.max(0, prev - 8));
          break;
        case 'Home':
          e.preventDefault();
          setSelectedTrackIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setSelectedTrackIndex(Math.max(0, displayedTracks.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (displayedTracks[selectedTrackIndex]) {
            handlePlayTrack(displayedTracks[selectedTrackIndex]);
          }
          break;
        case 'n':
          e.preventDefault();
          handleNextTrack();
          break;
        case 'p':
          e.preventDefault();
          handlePrevTrack();
          break;
        case 'l':
          e.preventDefault();
          handleToggleLike(displayedTracks[selectedTrackIndex] || playerState.currentTrack || undefined);
          break;
        case 's':
          e.preventDefault();
          handleToggleShuffle();
          break;
        case 'r':
          e.preventDefault();
          handleCycleRepeat();
          break;
        case 'm':
          e.preventDefault();
          handleToggleMute();
          break;
        case '+':
        case '=':
          e.preventDefault();
          handleVolumeChange(playerState.volume + 5);
          break;
        case '-':
          e.preventDefault();
          handleVolumeChange(playerState.volume - 5);
          break;
        case 'h':
        case '[':
          e.preventDefault();
          audioEngine.seekTo(Math.max(0, playerState.currentTime - 5));
          break;
        case ']':
          e.preventDefault();
          audioEngine.seekTo(Math.min(playerState.duration, playerState.currentTime + 5));
          break;
        case 'Tab':
          if (hasSidebar) {
            e.preventDefault();
            setIsSidebarFocused((prev) => !prev);
          }
          break;
        case '1':
          e.preventDefault();
          handleSetViewMode('tracklist');
          break;
        case '2':
          e.preventDefault();
          handleSetViewMode('ascii_cover');
          break;
        case '3':
          e.preventDefault();
          handleSetViewMode('split');
          break;
        case '4':
          e.preventDefault();
          handleSetViewMode('visualizer');
          break;
        case 'i':
          e.preventDefault();
          setShowImportModal(true);
          break;
        case 't':
          e.preventDefault();
          const currentIdx = availableThemes.findIndex(theme => theme.id === themeId);
          const nextTheme = availableThemes[(currentIdx + 1) % availableThemes.length];
          if (nextTheme.look) handleApplySkin({ theme: nextTheme, ...nextTheme.look });
          else { setThemeId(nextTheme.id); saveThemeId(nextTheme.id); }
          break;
        case '?':
          e.preventDefault();
          setSettingsTab('help');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    displayedTracks,
    selectedTrackIndex,
    playerState,
    handleTogglePlay,
    handlePlayTrack,
    handleNextTrack,
    handlePrevTrack,
    handleToggleLike,
    showAuthModal,
    showImportModal,
    settingsTab,
    isLayoutEditing,
    showCreatePlaylistModal,
    renamingPlaylist,
    themeId,
    availableThemes,
    hasSidebar,
    handleApplySkin,
  ]);

  // YouTube Search Handler
  const runSearch = async (query: string) => {
    if (!query.trim()) {
      setIsSearching(false);
      return;
    }

    setIsLoadingSearch(true);
    setIsSearching(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        setSearchResults(data.items);
        setSelectedTrackIndex(0);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.warn('Search error:', err);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchQuery);
  };

  // Create Custom Playlist
  const handleCreatePlaylist = () => {
    setCreateSeedTracks(null);
    setShowCreatePlaylistModal(true);
  };

  const handleConfirmCreatePlaylist = (name: string, description?: string) => {
    if (!name.trim()) return;

    const newPl: Playlist = {
      id: `custom-pl-${Date.now()}`,
      title: name.trim(),
      description: description?.trim() || 'Custom user playlist on Linux Mint',
      tracks: addTracksToPlaylist(
        { id: '', title: '', tracks: [] },
        createSeedTracks ?? (playerState.currentTrack ? [playerState.currentTrack] : [])
      ).tracks,
      isCustom: true,
      author: session.username,
    };

    const updated = [newPl, ...playlists];
    setPlaylists(updated);
    savePlaylists(updated);
    if (createSeedTracks) {
      // Created from a context menu: stay on the current view instead of navigating away.
      showToast(`Created "${newPl.title}" with ${newPl.tracks.length} track${newPl.tracks.length === 1 ? '' : 's'}`);
    } else {
      setSelectedPlaylist(newPl);
      setActiveCategory(null);
    }
    setShowCreatePlaylistModal(false);
    setCreateSeedTracks(null);
  };

  // ── Context menus ──────────────────────────────────────────────────────────
  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  };
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const commitPlaylists = (next: Playlist[]) => {
    setPlaylists(next);
    savePlaylists(next);
    setSelectedPlaylist((prev) => (prev ? next.find((p) => p.id === prev.id) ?? prev : prev));
  };

  const replacePlaylist = (updated: Playlist) =>
    commitPlaylists(playlists.map((p) => (p.id === updated.id ? updated : p)));

  const openCreatePlaylistWith = (seed: Track[]) => {
    setCreateSeedTracks(seed);
    setShowCreatePlaylistModal(true);
  };

  const queueTrack = (track: Track, playNext: boolean) => {
    setPlayerState((prev) => ({
      ...prev,
      queue: playNext && prev.currentTrack ? insertAfterIndex(prev.queue, prev.queueIndex, track) : [...prev.queue, track],
    }));
    showToast(playNext ? `Playing next: "${track.title}"` : `Added to queue: "${track.title}"`);
  };

  const queueTracks = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    setPlayerState((prev) => ({ ...prev, queue: [...prev.queue, ...tracks] }));
    showToast(`Added ${tracks.length} track${tracks.length === 1 ? '' : 's'} to queue`);
  };

  const toggleTrackInPlaylist = (playlist: Playlist, track: Track) => {
    const had = playlistHasTrack(playlist, track);
    replacePlaylist(had ? removeTrackFromPlaylist(playlist, track) : addTrackToPlaylist(playlist, track));
    showToast(had ? `Removed "${track.title}" from ${playlist.title}` : `Added "${track.title}" to ${playlist.title}`);
  };

  const removeFromPlaylistAt = (playlist: Playlist, index: number) => {
    const track = playlist.tracks[index];
    if (!track) return;
    replacePlaylist(removeTrackAt(playlist, index));
    setSelectedTrackIndex((prev) => Math.max(0, Math.min(prev, playlist.tracks.length - 2)));
    showToast(`Removed "${track.title}" from ${playlist.title}`);
  };

  const moveInPlaylist = (playlist: Playlist, from: number, to: number) => {
    const track = playlist.tracks[from];
    replacePlaylist(moveTrack(playlist, from, to));
    setSelectedTrackIndex(to);
    if (track) {
      showToast(`Moved "${track.title}" to #${to + 1}`);
    }
  };

  const deletePlaylist = (playlist: Playlist) => {
    const next = playlists.filter((p) => p.id !== playlist.id);
    setPlaylists(next);
    savePlaylists(next);
    if (selectedPlaylist?.id === playlist.id) {
      setSelectedPlaylist(null);
      handleSetActiveCategory('explore');
    }
    if (playingPlaylistId === playlist.id) setPlayingPlaylistId(null);
    showToast(`Deleted playlist "${playlist.title}"`);
  };

  const openPlaylist = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    handleSetActiveCategory(null);
    setIsSearching(false);
  };

  const viewTrackAscii = (track: Track) => {
    updateAsciiCover(track, asciiConfig);
    if (viewMode !== 'split') handleSetViewMode('ascii_cover');
  };

  const searchForArtist = (artist: string) => {
    if (viewMode !== 'tracklist' && viewMode !== 'split') handleSetViewMode('tracklist');
    setSearchQuery(artist);
    void runSearch(artist);
  };

  const copyWithToast = async (text: string, label: string) => {
    showToast((await copyText(text)) ? `Copied ${label}` : `Could not copy ${label}`);
  };

  const buildTrackMenu = (track: Track, index: number): ContextMenuItem[] => {
    const showingSearch = isSearching && searchResults.length > 0;
    const viewed = !showingSearch && selectedPlaylist ? selectedPlaylist : null;
    const editableViewed = viewed && isEditablePlaylist(viewed) ? viewed : null;
    const editable = playlists.filter(isEditablePlaylist);
    const liked = likedTrackIds.has(track.id);
    const ytUrl = track.youtubeId ? `https://music.youtube.com/watch?v=${track.youtubeId}` : '';

    const items: ContextMenuItem[] = [
      { id: 'play', label: 'Play now', icon: Play, hint: 'Enter', onSelect: () => handlePlayTrack(track) },
      { id: 'play-next', label: 'Play next', icon: ListStart, onSelect: () => queueTrack(track, true) },
      { id: 'queue', label: 'Add to queue', icon: ListEnd, onSelect: () => queueTrack(track, false) },
      { id: 'sep-1', separator: true },
      {
        id: 'like',
        label: liked ? 'Remove from Liked Songs' : 'Add to Liked Songs',
        icon: Heart,
        hint: 'L',
        onSelect: () => handleToggleLike(track),
      },
      {
        id: 'add-to-playlist',
        label: 'Add to playlist',
        icon: ListPlus,
        children: [
          { id: 'new-playlist', label: 'New playlist…', icon: FolderPlus, onSelect: () => openCreatePlaylistWith([track]) },
          { id: 'sep-pl', separator: true },
          ...(editable.length > 0
            ? editable.map((pl) => ({
                id: `pl-${pl.id}`,
                label: pl.title,
                hint: String(pl.tracks.length),
                checked: playlistHasTrack(pl, track),
                onSelect: () => toggleTrackInPlaylist(pl, track),
              }))
            : [{ id: 'no-playlists', label: 'No playlists yet', disabled: true }]),
        ],
      },
    ];

    if (editableViewed) {
      items.push({
        id: 'remove-from-playlist',
        label: `Remove from "${editableViewed.title}"`,
        icon: Trash2,
        danger: true,
        onSelect: () => removeFromPlaylistAt(editableViewed, index),
      });
    }

    items.push(
      { id: 'sep-2', separator: true },
      { id: 'ascii', label: 'View cover in ASCII', icon: Eye, onSelect: () => viewTrackAscii(track) },
      { id: 'search-artist', label: `Search "${track.artist}"`, icon: Search, disabled: !track.artist, onSelect: () => searchForArtist(track.artist) },
      { id: 'copy-title', label: 'Copy title – artist', icon: Copy, onSelect: () => copyWithToast(`${track.title} – ${track.artist}`, 'title') },
      { id: 'copy-link', label: 'Copy YouTube link', icon: LinkIcon, disabled: !ytUrl, onSelect: () => copyWithToast(ytUrl, 'link') },
      { id: 'open-yt', label: 'Open on YouTube Music', icon: ExternalLink, disabled: !ytUrl, onSelect: () => openExternal(ytUrl) }
    );
    return items;
  };

  const buildListMenu = (): ContextMenuItem[] => {
    const empty = displayedTracks.length === 0;
    const showingSearch = isSearching && searchResults.length > 0;
    const source = {
      playlistId: !showingSearch && selectedPlaylist ? selectedPlaylist.id : null,
      category: !showingSearch && !selectedPlaylist ? activeCategory : null,
    };
    return [
      { id: 'play-all', label: 'Play all', icon: Play, disabled: empty, onSelect: () => handlePlayTrack(displayedTracks[0], displayedTracks, source) },
      {
        id: 'shuffle-all',
        label: 'Shuffle all',
        icon: Shuffle,
        disabled: empty,
        onSelect: () => {
          const queue = shuffled(displayedTracks);
          handlePlayTrack(queue[0], queue, source);
        },
      },
      { id: 'queue-all', label: 'Add all to queue', icon: ListEnd, disabled: empty, onSelect: () => queueTracks(displayedTracks) },
      { id: 'sep-1', separator: true },
      { id: 'save-all', label: 'Save as new playlist…', icon: FolderPlus, disabled: empty, onSelect: () => openCreatePlaylistWith(displayedTracks) },
    ];
  };

  const buildPlaylistMenu = (playlist: Playlist): ContextMenuItem[] => {
    const empty = playlist.tracks.length === 0;
    const editable = isEditablePlaylist(playlist);
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Open', icon: FolderOpen, onSelect: () => openPlaylist(playlist) },
      { id: 'play', label: 'Play', icon: Play, disabled: empty, onSelect: () => handlePlayTrack(playlist.tracks[0], playlist.tracks, { playlistId: playlist.id }) },
      {
        id: 'shuffle',
        label: 'Shuffle play',
        icon: Shuffle,
        disabled: empty,
        onSelect: () => {
          const queue = shuffled(playlist.tracks);
          handlePlayTrack(queue[0], queue, { playlistId: playlist.id });
        },
      },
      { id: 'queue', label: 'Add to queue', icon: ListEnd, disabled: empty, onSelect: () => queueTracks(playlist.tracks) },
      { id: 'sep-1', separator: true },
    ];
    if (editable) items.push({ id: 'rename', label: 'Rename…', icon: Pencil, onSelect: () => setRenamingPlaylist(playlist) });
    items.push({
      id: 'duplicate',
      label: editable ? 'Duplicate' : 'Save a copy',
      icon: CopyPlus,
      onSelect: () => {
        const copy = duplicatePlaylist(playlist, session.username);
        commitPlaylists([copy, ...playlists]);
        showToast(`Created "${copy.title}"`);
      },
    });
    if (editable) {
      items.push(
        { id: 'sep-2', separator: true },
        {
          id: 'delete',
          label: 'Delete playlist',
          icon: Trash2,
          danger: true,
          children: [
            { id: 'delete-confirm', label: `Yes, delete "${playlist.title}"`, icon: Trash2, danger: true, onSelect: () => deletePlaylist(playlist) },
            { id: 'delete-cancel', label: 'Cancel' },
          ],
        }
      );
    }
    return items;
  };

  const buildAppMenu = (): ContextMenuItem[] => [
    {
      id: 'toggle-play',
      label: playerState.isPlaying ? 'Pause' : 'Play',
      icon: playerState.isPlaying ? Pause : Play,
      hint: 'Space',
      onSelect: handleTogglePlay,
    },
    { id: 'next', label: 'Next track', icon: SkipForward, hint: 'n', onSelect: handleNextTrack },
    { id: 'prev', label: 'Previous track', icon: SkipBack, hint: 'p', onSelect: handlePrevTrack },
    { id: 'sep-1', separator: true },
    { id: 'shuffle', label: 'Shuffle', icon: Shuffle, hint: 's', checked: playerState.shuffle, onSelect: handleToggleShuffle },
    { id: 'repeat', label: `Repeat: ${playerState.repeat}`, icon: Repeat, hint: 'r', onSelect: handleCycleRepeat },
    { id: 'mute', label: 'Mute', icon: Volume2, hint: 'm', checked: playerState.isMuted, onSelect: handleToggleMute },
    { id: 'sep-2', separator: true },
    {
      id: 'view',
      label: 'View',
      icon: Layers,
      children: (
        [
          ['tracklist', 'Tracks', '1'],
          ['ascii_cover', 'Cover', '2'],
          ['split', 'Split view', '3'],
          ['visualizer', 'Spectrum', '4'],
          ['custom', 'Custom layout', ''],
        ] as [TuiViewMode, string, string][]
      ).map(([mode, label, hint]) => ({
        id: `view-${mode}`,
        label,
        hint,
        checked: viewMode === mode,
        onSelect: () => handleSetViewMode(mode),
      })),
    },
    { id: 'new-playlist', label: 'New playlist…', icon: FolderPlus, onSelect: handleCreatePlaylist },
    { id: 'edit-layout', label: 'Edit layout…', icon: Layers, onSelect: handleStartLayoutEditing },
    { id: 'import', label: 'Import playlist…', icon: Link2, hint: 'i', onSelect: () => setShowImportModal(true) },
    { id: 'settings', label: 'Settings…', icon: Settings, onSelect: () => setSettingsTab('general') },
    { id: 'help', label: 'Keyboard shortcuts', icon: HelpCircle, hint: '?', onSelect: () => setSettingsTab('help') },
  ];

  const openMenu = (x: number, y: number, items: ContextMenuItem[], title?: string) =>
    setContextMenu({ x, y, items, title });

  const anyModalOpen =
    showAuthModal || showImportModal || settingsTab !== null || showCreatePlaylistModal || !!renamingPlaylist;

  const handleTrackListContextMenu = (target: { track?: Track; index?: number }, x: number, y: number) => {
    if (target.track && target.index !== undefined) {
      openMenu(x, y, buildTrackMenu(target.track, target.index), target.track.title);
    } else {
      openMenu(x, y, buildListMenu(), currentViewTitle);
    }
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    // Children (track rows, playlists, list area) handle their own menus and call preventDefault.
    if (e.defaultPrevented) return;
    // Keep the native menu for text fields so cut/copy/paste still work.
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    if (anyModalOpen || isLayoutEditing) return;
    openMenu(e.clientX, e.clientY, buildAppMenu(), 'YouTerm');
  };


  const sidebarPanel = (
    <Sidebar
      theme={theme}
      showBackground={backgroundVisible && appearance.background.showInSidebar}
      preferences={sidebarPreferences}
      onChangePreferences={handleChangeSidebarPreferences}
      activeCategory={activeCategory}
      selectedPlaylistId={selectedPlaylist?.id || null}
      playingPlaylistId={playingPlaylistId}
      playingCategory={playingCategory}
      isPlaying={playerState.isPlaying}
      playlists={playlists}
      likedCount={likedTrackIds.size}
      onSelectCategory={(cat) => {
        handleSetActiveCategory(cat);
        setSelectedPlaylist(null);
        setIsSearching(false);
        if (cat === 'explore' && exploreTracks.length === 0) {
          fetchExploreFeed();
        }
      }}
      onSelectPlaylist={(pl) => {
        setSelectedPlaylist(pl);
        handleSetActiveCategory(null);
        setIsSearching(false);
      }}
      onCreatePlaylist={handleCreatePlaylist}
      onOpenImport={() => setShowImportModal(true)}
      onPlaylistContextMenu={(playlist, x, y) => openMenu(x, y, buildPlaylistMenu(playlist), playlist.title)}
      isFocused={isSidebarFocused}
      isLoggedIn={session.isLoggedIn}
    />
  );

  const trackListPanel = (
    <TrackListView
      theme={theme}
      onPrepareTrack={appearance.lowPower ? undefined : (track) => audioEngine.prepare(track.youtubeId)}
      title={currentViewTitle}
      subtitle={selectedAlbum?.genre || selectedPlaylist?.description}
      tracks={displayedTracks}
      currentTrack={playerState.currentTrack}
      isPlaying={playerState.isPlaying}
      selectedTrackIndex={selectedTrackIndex}
      onSelectTrack={(track, index) => {
        setSelectedTrackIndex(index);
      }}
      onPlayTrack={handlePlayTrack}
      onToggleLike={handleToggleLike}
      onAddToQueue={(track) => {
        setPlayerState((prev) => ({
          ...prev,
          queue: [...prev.queue, track],
        }));
      }}
      onViewAscii={(track) => {
        updateAsciiCover(track, asciiConfig);
        if (viewMode !== 'split' && !customWorkspace) handleSetViewMode('ascii_cover');
      }}
      onContextMenu={handleTrackListContextMenu}
      backgroundAscii={viewMode === 'tracklist' ? backgroundAscii : null}
      showBackgroundAscii={!appearance.hideAlbumCover && viewMode === 'tracklist'}
      asciiConfig={asciiConfig}
      coverArtworkUrl={coverArtworkUrl}
      isReorderable={!isSearching && !!selectedPlaylist && isEditablePlaylist(selectedPlaylist)}
      onReorderTrack={(from, to) => {
        if (selectedPlaylist && isEditablePlaylist(selectedPlaylist)) {
          moveInPlaylist(selectedPlaylist, from, to);
        }
      }}
    />
  );

  const lyricsPanel = (
    <LyricsView
      theme={theme}
      track={playerState.currentTrack}
      currentTime={playerState.currentTime}
      duration={playerState.duration}
      animations={appearance.animations && !appearance.lowPower}
      onSeek={handleSeek}
    />
  );

  const artworkPanel = (
    <AsciiArtViewer
      theme={theme}
      track={playerState.currentTrack}
      asciiResult={asciiResult}
      asciiConfig={asciiConfig}
      onChangeConfig={handleChangeAsciiConfig}
      onRefresh={() => {
        if (playerState.currentTrack) {
          updateAsciiCover(playerState.currentTrack, asciiConfig);
        }
      }}
      isLoading={isAsciiLoading}
    />
  );

  const splitArtworkPanel = (
    <AsciiArtViewer showArtworkIcon={false} sidePanel={lyricsPanel}
      theme={theme}
      track={playerState.currentTrack}
      asciiResult={asciiResult}
      asciiConfig={asciiConfig}
      onChangeConfig={handleChangeAsciiConfig}
      onRefresh={() => {
        if (playerState.currentTrack) {
          updateAsciiCover(playerState.currentTrack, asciiConfig);
        }
      }}
      isLoading={isAsciiLoading}
    />
  );

  const spectrumPanel = (
    <SpectrumVisualizer
      maxFrameRate={appearance.lowPower ? 15 : 60}
      showBackground={backgroundVisible && appearance.background.showInSpectrum}
      theme={theme}
      isPlaying={playerState.isPlaying}
      currentTrack={playerState.currentTrack}
    />
  );

  const playerPanel = (
    <BottomPlayerBar
      theme={theme}
      progressStyle={appearance.skin.progressStyle}
      controlStyle={appearance.skin.controlStyle}
      showBackground={backgroundVisible && appearance.background.showInPlayer}
      playerState={playerState}
      onTogglePlay={handleTogglePlay}
      onNext={handleNextTrack}
      onPrev={handlePrevTrack}
      onToggleShuffle={handleToggleShuffle}
      onCycleRepeat={handleCycleRepeat}
      onToggleMute={handleToggleMute}
      onVolumeChange={handleVolumeChange}
      onSeek={handleSeek}
      onToggleLike={() => handleToggleLike()}
      onViewAscii={() => handleSetViewMode('ascii_cover')}
      onToggleFormat={() => audioEngine.toggleFormat()}
    />
  );

  const renderDockPanel = (id: DockPanelId): React.ReactNode => {
    if (id === 'sidebar' && !sidebarAvailable) return <div className="flex flex-1 items-center justify-center p-4 text-center text-xs" style={{ color: theme.textDim }}>
      Library sections are hidden. Enable them in Settings → General.
    </div>;
    return ({ sidebar: sidebarPanel, tracks: trackListPanel, artwork: artworkPanel,
      lyrics: lyricsPanel, spectrum: spectrumPanel, player: playerPanel })[id];
  };


  return (
    <div
      onContextMenu={handleRootContextMenu}
      data-density={appearance.density}
      data-animations={appearance.animations}
      data-glow={appearance.glow}
      data-player-position={appearance.skin.playerPosition}
      data-control-style={appearance.skin.controlStyle}
      className="youterm relative isolate h-screen max-h-screen w-screen flex flex-col font-mono select-none overflow-hidden"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
        ...skinVariables(appearance.skin),
        '--skin-border-color': theme.border,
        '--app-theme-bg': theme.bg,
        '--app-theme-card-bg': theme.cardBg,
        '--app-theme-text': theme.text,
        '--app-surface-bg': surfaceColor(theme.bg, surfaceOpacity),
        '--app-surface-card-bg': surfaceColor(theme.cardBg, surfaceOpacity),
      } as React.CSSProperties}
    >
      <BackgroundLayer config={appearance.background} onReady={handleBackgroundReady} />
      {scanlinesEnabled && <div aria-hidden="true" className="crt-scanlines pointer-events-none absolute inset-0 z-[1]" />}
      {/* Terminal Window Content */}
      <div className="app-shell relative z-10 flex-1 flex flex-col w-full h-full max-h-full min-h-0 overflow-hidden">
        {/* Authentic Unix / Linux Mint Terminal Header Bar */}
          {appearance.skin.showHeader && <div
            inert={isLayoutEditing}
            className="app-header skin-panel flex shrink-0 items-center justify-between gap-3 px-3 py-1.5 border-b text-xs select-none"
            style={{
              borderColor: theme.border,
              backgroundColor: 'var(--app-surface-card-bg)',
            }}
          >
            {/* Window title */}
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-bold text-xs flex items-center gap-1.5" style={{ color: theme.highlight }}>
                <Terminal className="w-3.5 h-3.5" style={{ color: theme.accent }} />
                <span>YouTerm v{appVersion}</span>
              </span>
            </div>

            {/* View Mode Navigation Tabs */}
            <div className="flex items-center gap-1 text-[11px] overflow-x-auto">
              <button
                onClick={() => handleSetViewMode('tracklist')}
                className="px-2 py-0.5 border flex items-center gap-1 transition-all"
                style={{
                  borderColor: viewMode === 'tracklist' ? theme.accent : theme.border,
                  backgroundColor: viewMode === 'tracklist' ? 'var(--app-surface-bg)' : 'transparent',
                  color: viewMode === 'tracklist' ? theme.highlight : theme.textDim,
                }}
              >
                <ListMusic className="w-3 h-3" />
                <span>[1: Tracks]</span>
              </button>

              <button
                onClick={() => handleSetViewMode('ascii_cover')}
                className="px-2 py-0.5 border flex items-center gap-1 transition-all"
                style={{
                  borderColor: viewMode === 'ascii_cover' ? theme.accent : theme.border,
                  backgroundColor: viewMode === 'ascii_cover' ? 'var(--app-surface-bg)' : 'transparent',
                  color: viewMode === 'ascii_cover' ? theme.highlight : theme.textDim,
                }}
              >
                <Eye className="w-3 h-3" />
                <span>[2: Cover]</span>
              </button>

              <button
                onClick={() => handleSetViewMode('split')}
                className="px-2 py-0.5 border flex items-center gap-1 transition-all"
                style={{
                  borderColor: viewMode === 'split' ? theme.accent : theme.border,
                  backgroundColor: viewMode === 'split' ? 'var(--app-surface-bg)' : 'transparent',
                  color: viewMode === 'split' ? theme.highlight : theme.textDim,
                }}
              >
                <Layers className="w-3 h-3" />
                <span>[3: Split View]</span>
              </button>

              <button
                onClick={() => handleSetViewMode('visualizer')}
                className="px-2 py-0.5 border flex items-center gap-1 transition-all"
                style={{
                  borderColor: viewMode === 'visualizer' ? theme.accent : theme.border,
                  backgroundColor: viewMode === 'visualizer' ? 'var(--app-surface-bg)' : 'transparent',
                  color: viewMode === 'visualizer' ? theme.highlight : theme.textDim,
                }}
              >
                <Activity className="w-3 h-3" />
                <span>[4: Spectrum]</span>
              </button>
              {appearance.skin.layout && <button type="button" onClick={() => handleSetViewMode('custom')}
                className="flex items-center gap-1 border px-2 py-0.5" aria-pressed={viewMode === 'custom'}
                style={{ borderColor: viewMode === 'custom' ? theme.accent : theme.border, color: viewMode === 'custom' ? theme.highlight : theme.textDim }}>
                <Layers className="h-3 w-3" /> Custom layout
              </button>}
            </div>
          </div>}

          {/* Top Search & Action Bar */}
          <TopSearchBar
            theme={theme}
            compactNavigation={!appearance.skin.showHeader}
            viewMode={viewMode}
            onChangeViewMode={handleSetViewMode}
            onEditLayout={handleStartLayoutEditing}
            isLayoutEditing={isLayoutEditing}
            hasCustomLayout={!!appearance.skin.layout}
            session={session}
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
              if (!q) setIsSearching(false);
            }}
            onSearchSubmit={handleSearchSubmit}
            isLoading={isLoadingSearch}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenSettings={() => setSettingsTab('general')}
            isModalOpen={anyModalOpen}
          />

          {/* The custom workspace keeps every panel independently movable. */}
          {customWorkspace ? <DockWorkspace layout={dockLayout} editing={isLayoutEditing} theme={theme}
            spacing={appearance.skin.panelGap} renderPanel={renderDockPanel} onChange={handleDockLayoutChange}
            onReset={() => createDockLayout('split', appearance.skin, sidebarAvailable)}
            onSave={handleSaveLayout} onCancel={handleCancelLayout} /> :
          <ResizableSplit theme={theme} storageKey="sidebar" label="Resize sidebar"
            reverse={appearance.skin.sidebar === 'right'} spacing={appearance.skin.panelGap}
            unit="pixels" defaultSize={256} minFirst={176} minSecond={420} maxFirst={480}
            showFirst={hasSidebar} first={sidebarPanel}
            second={<>
              {viewMode === 'tracklist' && trackListPanel}
              {viewMode === 'ascii_cover' && artworkPanel}
              {viewMode === 'split' && <ResizableSplit theme={theme} storageKey="artwork" label="Resize album artwork panel" regionLabel="Split view"
                spacing={appearance.skin.panelGap} rowAt="lg" defaultSize={{ row: 40, column: 100 / 3 }}
                minFirst={{ row: 260, column: 120 }} minSecond={{ row: 300, column: 260 }}
                first={trackListPanel} second={splitArtworkPanel} />}
              {viewMode === 'visualizer' && spectrumPanel}
            </>} />}

          {/* Playback Toast / Warning */}
          {playbackWarning && (
            <div
              className="playback-warning px-3 py-1.5 text-xs font-mono border-t flex items-center gap-2 animate-pulse"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                borderColor: theme.border,
                color: '#eab308',
              }}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{playbackWarning}</span>
            </div>
          )}

          {/* Bottom Player Bar */}
          {!customWorkspace && playerPanel}
        </div>

      {/* Context menu & toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-mono border shadow-2xl max-w-[80vw] truncate pointer-events-none"
          style={{ zIndex: 90, backgroundColor: 'var(--app-surface-card-bg)', borderColor: theme.accent, color: theme.highlight, boxShadow: `0 0 14px ${theme.accentGlow}` }}
        >
          <span style={{ color: theme.accent }}>$ </span>
          {toast}
        </div>
      )}
      {contextMenu && <ContextMenu theme={theme} menu={contextMenu} onClose={closeContextMenu} />}

      {/* Modals */}
      {showAuthModal && (
        <AuthModal
          theme={theme}
          session={session}
          onSaveSession={(newSession) => {
            setSession(newSession);
            saveUserSession(newSession);
          }}
          onSyncAccount={handleSyncAccount}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {showImportModal && (
        <ImportPlaylistModal
          theme={theme}
          onImport={handleImportPlaylist}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {settingsTab !== null && (
        <SettingsModal
          initialTab={settingsTab}
          sidebarPreferences={sidebarPreferences}
          onChangeSidebarPreferences={handleChangeSidebarPreferences}
          currentTheme={theme}
          onEditLayout={handleStartLayoutEditing}
          viewMode={viewMode}
          artworkMode={asciiConfig.mode}
          onApplySkin={handleApplySkin}
          customThemes={customThemes}
          appearance={appearance}
          preferences={{
            volume: playerState.volume,
            isMuted: playerState.isMuted,
            audioFormat: playerState.audioFormat || initialPreferences.audioFormat,
          }}
          onChangePreferences={handleChangePreferences}
          isChangingFormat={!!playerState.isChangingFormat}
          session={session}
          onSaveSession={newSession => { setSession(newSession); saveUserSession(newSession); }}
          onSyncAccount={handleSyncAccount}
          onDisconnect={() => { setSession(defaultSession); saveUserSession(defaultSession); }}
          onChangeAppearance={handleChangeAppearance}
          onChangeBackground={handleChangeBackground}
          onSaveCustomTheme={(value) => {
            const next = [...customThemes.filter(theme => theme.id !== value.id), value];
            saveCustomThemes(next);
            setCustomThemes(next);
            setThemeId(value.id);
            saveThemeId(value.id);
          }}
          onDeleteCustomTheme={(id) => {
            const next = customThemes.filter(theme => theme.id !== id);
            saveCustomThemes(next);
            setCustomThemes(next);
            if (themeId === id) { setThemeId(DEFAULT_THEME_ID); saveThemeId(DEFAULT_THEME_ID); }
          }}
          onSelectTheme={(tId) => {
            const selected = resolveTheme(tId, customThemes);
            if (selected.look) handleApplySkin({ theme: selected, ...selected.look });
            else { setThemeId(tId); saveThemeId(tId); }
          }}
          onClose={() => setSettingsTab(null)}
        />
      )}

      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          theme={theme}
          onConfirm={handleConfirmCreatePlaylist}
          onClose={() => {
            setShowCreatePlaylistModal(false);
            setCreateSeedTracks(null);
          }}
        />
      )}

      {renamingPlaylist && (
        <CreatePlaylistModal
          theme={theme}
          heading="Rename Playlist"
          helpText="Playlist changes are stored locally and are not written back to YouTube."
          confirmLabel="Save"
          defaultName={renamingPlaylist.title}
          defaultDescription={renamingPlaylist.description || ''}
          onConfirm={(name, description) => {
            replacePlaylist(renamePlaylist(renamingPlaylist, name, description ?? ''));
            showToast(`Renamed to "${name}"`);
          }}
          onClose={() => setRenamingPlaylist(null)}
        />
      )}
    </div>
  );
}
