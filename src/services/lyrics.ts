import type { Track } from '../types';

export interface LyricLine {
  time: number;
  text: string;
}

export interface SongLyrics {
  lines: LyricLine[];
  plainText: string;
  instrumental: boolean;
}

interface LyricsResponse {
  lyrics: {
    plainLyrics: string | null;
    syncedLyrics: string | null;
    syncAvailable: boolean;
    instrumental: boolean;
  } | null;
}

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const offsetValue = Number(text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im)?.[1] || 0) / 1000;
  const offset = Number.isFinite(offsetValue) ? offsetValue : 0;
  for (const raw of text.split(/\r?\n/)) {
    let remaining = raw.trim();
    const times: number[] = [];
    let match: RegExpMatchArray | null;
    while ((match = remaining.match(/^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/))) {
      times.push(Math.max(0, Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`) - offset));
      remaining = remaining.slice(match[0].length).trimStart();
    }
    for (const time of times) lines.push({ time, text: remaining.trim() });
  }
  lines.sort((a, b) => a.time - b.time);
  // Simultaneous lines (e.g. duets/translations) should highlight together.
  const grouped: LyricLine[] = [];
  for (const line of lines) {
    const previous = grouped[grouped.length - 1];
    if (previous?.time === line.time) previous.text = [previous.text, line.text].filter(Boolean).join('\n');
    else grouped.push({ ...line });
  }
  return grouped;
}

export function activeLyricIndex(lines: LyricLine[], currentTime: number): number {
  let low = 0;
  let high = lines.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time <= currentTime) {
      active = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return active;
}

export function lyricsRequestKey(track: Track, duration: number): string {
  const params = new URLSearchParams({ title: track.title, artist: track.artist, album: track.album || '' });
  if (Number.isFinite(duration) && duration >= 1) params.set('duration', String(Math.round(duration)));
  return params.toString();
}

export async function loadLyrics(key: string, signal: AbortSignal): Promise<SongLyrics | null> {
  const response = await fetch(`/api/lyrics?${key}`, { signal });
  if (!response.ok) throw new Error('Could not load lyrics');
  const { lyrics } = await response.json() as LyricsResponse;
  if (!lyrics) return null;
  const parsed = parseLrc(lyrics.syncedLyrics || '');
  const plainText = lyrics.plainLyrics?.trim() || parsed.map(line => line.text).join('\n').trim();
  const lines = lyrics.syncAvailable ? parsed : [];
  if (!lyrics.instrumental && !plainText && !lines.some(line => line.text)) return null;
  return { lines, plainText, instrumental: lyrics.instrumental };
}
