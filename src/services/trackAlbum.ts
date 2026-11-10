import type { Track } from '../types';

export interface TrackAlbum {
  name: string;
  id: string;
}

// Earlier imports used the playlist title as the album. Retain only metadata
// backed by a YouTube Music album ID; resolve older entries when selected.
export function normalizeTrackAlbum(track: Track): Track {
  if (track.albumId && track.album?.trim()) return track;
  return track.album || track.albumId ? { ...track, album: '', albumId: undefined } : track;
}

export function applyTrackAlbum(track: Track, videoId: string, album: TrackAlbum | null): Track {
  if ((track.youtubeId || track.id) !== videoId) return track;
  if (!album) return normalizeTrackAlbum(track);
  if (track.album === album.name && track.albumId === album.id) return track;
  return { ...track, album: album.name, albumId: album.id };
}

const cache = new Map<string, { album: TrackAlbum | null; expires: number }>();

export async function loadTrackAlbum(videoId: string, signal: AbortSignal): Promise<TrackAlbum | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  const previous = cache.get(videoId);
  if (previous && previous.expires > Date.now()) return previous.album;
  const response = await fetch(`/api/tracks/${encodeURIComponent(videoId)}/album`, { signal });
  if (!response.ok) throw new Error('Could not load song album');
  const { album } = await response.json() as { album: TrackAlbum | null };
  const result = album?.name?.trim() && album?.id?.trim() ? album : null;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(videoId, { album: result, expires: Date.now() + (result ? 6 * 60 * 60_000 : 5 * 60_000) });
  return result;
}
