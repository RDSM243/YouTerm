import type { Playlist, Track } from '../types';

/** Auto-generated YouTube Music charts are read-only; everything else can be edited locally. */
export function isEditablePlaylist(playlist: Playlist): boolean {
  return !playlist.id.startsWith('yt-cat-');
}

export function isSameTrack(a: Track, b: Track): boolean {
  return a.id === b.id || (!!a.youtubeId && a.youtubeId === b.youtubeId);
}

export function playlistHasTrack(playlist: Playlist, track: Track): boolean {
  return playlist.tracks.some(item => isSameTrack(item, track));
}

/** Tracks are stored without view-derived flags such as `isLiked`. */
function toStoredTrack(track: Track): Track {
  const { isLiked: _isLiked, ...stored } = track;
  return stored;
}

/** Returns the same playlist reference when the track is already present. */
export function addTrackToPlaylist(playlist: Playlist, track: Track): Playlist {
  if (playlistHasTrack(playlist, track)) return playlist;
  return { ...playlist, tracks: [...playlist.tracks, toStoredTrack(track)], updatedAt: new Date().toISOString() };
}

export function addTracksToPlaylist(playlist: Playlist, tracks: Track[]): Playlist {
  return tracks.reduce(addTrackToPlaylist, playlist);
}

export function removeTrackAt(playlist: Playlist, index: number): Playlist {
  if (index < 0 || index >= playlist.tracks.length) return playlist;
  return { ...playlist, tracks: playlist.tracks.filter((_, i) => i !== index), updatedAt: new Date().toISOString() };
}

export function removeTrackFromPlaylist(playlist: Playlist, track: Track): Playlist {
  const next = playlist.tracks.filter(item => !isSameTrack(item, track));
  if (next.length === playlist.tracks.length) return playlist;
  return { ...playlist, tracks: next, updatedAt: new Date().toISOString() };
}

export function moveTrack(playlist: Playlist, from: number, to: number): Playlist {
  const last = playlist.tracks.length - 1;
  if (from < 0 || from > last || to < 0 || to > last || from === to) return playlist;
  const tracks = [...playlist.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return { ...playlist, tracks, updatedAt: new Date().toISOString() };
}

export function renamePlaylist(playlist: Playlist, title: string, description?: string): Playlist {
  return {
    ...playlist,
    title: title.trim() || playlist.title,
    description: description === undefined ? playlist.description : description.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
}

/** Creates an editable local copy; the `custom-pl-` prefix keeps it across account syncs. */
export function duplicatePlaylist(playlist: Playlist, author?: string, now = Date.now()): Playlist {
  return {
    ...playlist,
    id: `custom-pl-${now}`,
    title: `${playlist.title} (copy)`,
    tracks: playlist.tracks.map(toStoredTrack),
    isCustom: true,
    author: author || playlist.author,
    updatedAt: new Date(now).toISOString(),
  };
}

export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Inserts a track right after the current queue position ("play next"). */
export function insertAfterIndex<T>(queue: T[], index: number, item: T): T[] {
  const at = Math.min(Math.max(index + 1, 0), queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}
