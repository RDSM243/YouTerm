import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { ThemeConfig, Track } from '../types';
import { activeLyricIndex, loadLyrics, lyricsRequestKey, type SongLyrics } from '../services/lyrics';
import { openExternal } from '../services/desktop';

interface LyricsViewProps {
  theme: ThemeConfig;
  track: Track | null;
  currentTime: number;
  duration: number;
  animations: boolean;
  onSeek: (seconds: number) => void;
}

type LyricsState = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  lyrics: SongLyrics | null;
};

export const LyricsView: React.FC<LyricsViewProps> = ({ theme, track, currentTime, duration, animations, onSeek }) => {
  const key = track ? lyricsRequestKey(track, duration || track.duration) : '';
  const [state, setState] = useState<LyricsState>({ key: '', status: 'loading', lyrics: null });
  const [revision, setRevision] = useState(0);
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyrics = state.key === key ? state.lyrics : null;
  const status = state.key === key ? state.status : 'loading';
  const activeIndex = activeLyricIndex(lyrics?.lines || [], currentTime);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setState({ key, status: 'loading', lyrics: null });
    setFollow(true);
    scroller.current?.scrollTo({ top: 0 });
    // Avoid duplicate provider requests from StrictMode and rapid track changes.
    const timer = setTimeout(() => {
      void loadLyrics(key, controller.signal).then(result => {
        if (!controller.signal.aborted) setState({ key, status: 'ready', lyrics: result });
      }).catch(() => {
        if (!controller.signal.aborted) setState({ key, status: 'error', lyrics: null });
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, revision]);

  useEffect(() => {
    if (!follow || !activeLine.current || !scroller.current) return;
    const container = scroller.current;
    const button = activeLine.current;
    const top = button.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight / 2 + button.clientHeight / 2), behavior: animations ? 'smooth' : 'instant' });
  }, [activeIndex, follow, animations, lyrics]);

  useEffect(() => () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  const pauseFollow = () => {
    setFollow(false);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setFollow(true), 8000);
  };

  const synced = !!lyrics?.lines.some(line => line.text);
  return (
    <section aria-label="Song lyrics" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden select-text font-mono">
      {track && <dl aria-label="Song information" className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-b px-3 py-3 text-[11px]"
        style={{ borderColor: theme.border }}>
        <dt style={{ color: theme.textDim }}>Title:</dt>
        <dd className="min-w-0 break-words font-bold" style={{ color: theme.highlight }}>{track.title}</dd>
        <dt style={{ color: theme.textDim }}>Artist:</dt>
        <dd className="min-w-0 break-words" style={{ color: theme.text }}>{track.artist}</dd>
        {track.album && <><dt style={{ color: theme.textDim }}>Album:</dt>
          <dd className="min-w-0 break-words" style={{ color: theme.text }}>{track.album}</dd></>}
      </dl>}

      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-[11px]"
        style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-card-bg)' }}>
        <h2 className="font-bold" style={{ color: theme.highlight }}>┌─ Lyrics ─</h2>
        {synced && !follow && <button type="button" onClick={() => setFollow(true)}
          className="border px-2 py-1 text-[11px] hover:brightness-125" style={{ borderColor: theme.accent, color: theme.accent }}>[Follow song]</button>}
        {track && status === 'ready' && <span className="text-[10px]" style={{ color: theme.textDim }}>{synced ? '[Synced lyrics]' : lyrics?.instrumental ? '[Instrumental]' : lyrics ? '[Lyrics]' : ''}</span>}
      </header>

      <div ref={scroller} tabIndex={0} aria-label="Lyrics content" onWheel={pauseFollow} onTouchMove={pauseFollow}
        onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) { pauseFollow(); event.stopPropagation(); } }}
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ color: theme.text }}>
        {!track ? <p role="status" className="text-center text-xs" style={{ color: theme.textDim }}>[ Select a song to see its lyrics. ]</p>
          : status === 'loading' ? <p role="status" className="flex items-center justify-center gap-2 text-xs" style={{ color: theme.textDim }}>
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> Looking for lyrics…</p>
          : status === 'error' ? <div role="status" className="flex flex-col items-center gap-4 text-center text-xs" style={{ color: theme.textDim }}>
            <p>Could not load lyrics. Check your connection or try again later.</p>
            <button type="button" onClick={() => setRevision(value => value + 1)} className="flex items-center gap-1 border px-3 py-1.5 hover:brightness-125"
              style={{ borderColor: theme.border, color: theme.accent }}><RefreshCw className="h-3 w-3" aria-hidden="true" />[Try again]</button>
          </div>
          : !lyrics ? <p role="status" className="text-center text-xs" style={{ color: theme.textDim }}>[ No lyrics found for this song. ]</p>
          : lyrics.instrumental ? <p role="status" className="text-center text-xs" style={{ color: theme.textDim }}>[ Instrumental — no lyrics. ]</p>
          : synced ? <div className="space-y-1 pb-16">
            {lyrics.lines.map((line, index) => <button type="button" key={`${line.time}-${index}`}
              ref={index === activeIndex ? activeLine : null} aria-current={index === activeIndex ? 'true' : undefined}
              aria-label={`Seek to ${Math.floor(line.time / 60)}:${String(Math.floor(line.time % 60)).padStart(2, '0')}: ${line.text || 'Instrumental break'}`}
              onClick={() => { onSeek(line.time); setFollow(true); }}
              className={`flex w-full items-start gap-1.5 px-1 py-1.5 text-left text-xs leading-relaxed hover:brightness-125 focus-visible:outline focus-visible:outline-1 ${index === activeIndex ? 'font-bold' : ''}`}
              style={{ color: index === activeIndex ? theme.highlight : theme.textDim, outlineColor: theme.accent }}>
              <ChevronRight className={`mt-0.5 h-3 w-3 shrink-0 ${index === activeIndex ? '' : 'invisible'}`} style={{ color: theme.accent }} aria-hidden="true" />
              <span className="whitespace-pre-line">{line.text || '♪'}</span>
            </button>)}
          </div>
          : <div className="whitespace-pre-wrap text-xs leading-loose">{lyrics.plainText}</div>}
      </div>

      {track && status === 'ready' && lyrics && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-[10px]"
        style={{ borderColor: theme.border, color: theme.textDim }}>
        <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer"
          onClick={event => { event.preventDefault(); openExternal('https://lrclib.net'); }} className="hover:underline">Lyrics from LRCLIB</a>
        {synced ? <span>Click a line to seek.</span> : !lyrics.instrumental && <span>Synced lyrics unavailable for this recording.</span>}
      </footer>}
    </section>
  );
};
