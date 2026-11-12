import React, { useEffect, useId, useState } from 'react';
import { AsciiConfig, AsciiRenderMode, AsciiResult, Track, ThemeConfig } from '../types';
import { COVER_MODES } from '../data/settings';
import { loadCoverArtwork, type CoverArtwork } from '../services/coverArtwork';
import { ResizableSplit } from './ResizableSplit';
import { Copy, RefreshCw, Check, Image as ImageIcon, Sparkles, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';

interface AsciiArtViewerProps {
  theme: ThemeConfig;
  track: Track | null;
  asciiResult: AsciiResult | null;
  asciiConfig: AsciiConfig;
  onChangeConfig: (change: Partial<AsciiConfig>) => void;
  onRefresh: () => void;
  isLoading: boolean;
  showArtworkIcon?: boolean;
  sidePanel?: React.ReactNode;
}

export const AsciiArtViewer: React.FC<AsciiArtViewerProps> = ({
  theme,
  track,
  asciiResult,
  asciiConfig,
  onChangeConfig,
  onRefresh,
  isLoading,
  showArtworkIcon = true,
  sidePanel,
}) => {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsId = useId();
  const [artwork, setArtwork] = useState<(CoverArtwork & { key: string }) | null>(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [artworkRevision, setArtworkRevision] = useState(0);
  const artworkKey = `${track?.youtubeId}:${track?.thumbnailUrl}`;
  const currentArtwork = artwork?.key === artworkKey ? artwork : null;
  const artworkUrl = currentArtwork?.url;
  const needsArtwork = asciiConfig.mode === 'original_hd' || showOriginal;

  useEffect(() => {
    if (!needsArtwork || !track?.thumbnailUrl) return;
    const controller = new AbortController();
    setArtworkFailed(false);
    void loadCoverArtwork(track.thumbnailUrl, track.youtubeId, controller.signal).then(result => {
      if (!controller.signal.aborted) setArtwork({ ...result, key: artworkKey });
    }).catch(() => {
      if (!controller.signal.aborted) setArtworkFailed(true);
    });
    return () => controller.abort();
  }, [needsArtwork, track?.thumbnailUrl, track?.youtubeId, artworkKey, artworkRevision]);

  const handleCopyText = () => {
    if (!track) return;
    if (asciiConfig.mode === 'original_hd') {
      if (!artworkUrl) return;
      navigator.clipboard.writeText(artworkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    if (!asciiResult) return;
    navigator.clipboard.writeText(asciiResult.rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAnsi = () => {
    if (!asciiResult) return;
    navigator.clipboard.writeText(asciiResult.rawAnsi);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!track) {
    return (
      <div className="skin-panel flex-1 flex flex-col items-center justify-center p-8 text-xs font-mono select-none" style={{ color: theme.textDim, backgroundColor: 'var(--app-surface-bg)' }}>
        <p>[ No song selected ]</p>
        <p className="mt-2 text-[11px]">Select a song to see its artwork.</p>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Album artwork" className="skin-panel flex-1 flex flex-col min-h-0 min-w-0 relative select-none font-mono overflow-hidden"
      style={{ backgroundColor: 'var(--app-surface-bg)' }}>
      {/* Top Header */}
      <div
        className="px-4 py-2 border-b flex shrink-0 flex-wrap items-center justify-between gap-2 z-10 text-xs"
        style={{
          borderColor: theme.border,
          backgroundColor: 'var(--app-surface-card-bg)',
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-bold" title={`${track.title} — ${track.artist}`} style={{ color: theme.highlight }}>
            {sidePanel ? '┌─ Album artwork ─' : `${track.title} — ${track.artist}`}
          </span>
          {!sidePanel && track.album && <span className="truncate text-[11px]" title={track.album} style={{ color: theme.textDim }}>{track.album}</span>}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" aria-label="Display settings" aria-expanded={showControls} aria-controls={controlsId}
            title={`${showControls ? 'Hide' : 'Show'} display settings`} onClick={() => setShowControls(previous => !previous)}
            className="flex items-center gap-1 border px-2 py-0.5 text-[11px] hover:brightness-125"
            style={{ borderColor: theme.border, color: showControls ? theme.accent : theme.textDim, backgroundColor: 'var(--app-surface-bg)' }}>
            {showControls ? <ChevronDown aria-hidden="true" className="h-3 w-3" /> : <ChevronRight aria-hidden="true" className="h-3 w-3" />}
            <span>[Display]</span>
          </button>

          {asciiConfig.mode !== 'original_hd' && (
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className="px-2 py-0.5 border text-[11px] flex items-center gap-1 hover:brightness-125"
              style={{
                borderColor: theme.border,
                color: showOriginal ? theme.highlight : theme.text,
                backgroundColor: showOriginal ? 'rgba(255,255,255,0.05)' : theme.bg,
              }}
            >
              <ImageIcon className="w-3 h-3" />
              <span>{showOriginal ? '[Hide Orig]' : '[Show Orig]'}</span>
            </button>
          )}

          <button
            onClick={handleCopyText}
            disabled={asciiConfig.mode === 'original_hd' && !artworkUrl}
            className="px-2 py-0.5 border text-[11px] flex items-center gap-1 hover:brightness-125 font-bold"
            style={{
              borderColor: theme.accent,
              color: theme.accent,
              backgroundColor: 'var(--app-surface-bg)',
            }}
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            <span>
              {copied
                ? asciiConfig.mode === 'original_hd'
                  ? '[Copied URL!]'
                  : '[Copied!]'
                : asciiConfig.mode === 'original_hd'
                  ? '[Copy Link]'
                  : '[Copy ASCII]'}
            </span>
          </button>

        </div>
      </div>

      <div id={controlsId} role="group" aria-label="Cover art controls" hidden={!showControls}
        className={`${showControls ? 'grid' : 'hidden'} shrink-0 gap-3 border-b px-4 py-2 text-xs`}
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', borderColor: theme.border, backgroundColor: 'var(--app-surface-bg)' }}>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-bold tracking-wider" style={{ color: theme.textDim }}>RENDER MODE</span>
          <span className="relative flex items-center">
            <select aria-label="Cover render mode" value={asciiConfig.mode}
              onChange={event => onChangeConfig({ mode: event.target.value as AsciiRenderMode })}
              className="w-full min-w-0 border px-2.5 py-1 pr-7 text-xs outline-none cursor-pointer font-mono"
              style={{ borderColor: theme.border, color: theme.highlight, backgroundColor: 'var(--app-surface-card-bg)' }}>
              {COVER_MODES.map(mode => <option key={mode.id} value={mode.id} style={{ backgroundColor: 'var(--app-surface-bg)', color: theme.text }}>{mode.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" style={{ color: theme.accent }} />
          </span>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="flex justify-between gap-2 text-[10px]" style={{ color: theme.textDim }}>
            <span>{asciiConfig.mode === 'original_hd' ? 'DISPLAY SIZE:' : 'WIDTH (COLS):'}</span>
            <span style={{ color: theme.accent }}>{asciiConfig.mode === 'original_hd' ? `${Math.round(asciiConfig.width / 96 * 100)}%` : `${asciiConfig.width} chars`}</span>
          </span>
          <input aria-label={asciiConfig.mode === 'original_hd' ? 'Cover display size' : 'ASCII width'}
            type="range" min={24} max={96} step={4} value={asciiConfig.width}
            onChange={event => onChangeConfig({ width: Number(event.target.value) })}
            className="cursor-pointer" style={{ accentColor: theme.accent }} />
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="flex justify-between gap-2 text-[10px]" style={{ color: theme.textDim }}>
            <span>CONTRAST:</span><span style={{ color: theme.accent }}>{asciiConfig.contrast}%</span>
          </span>
          <input aria-label="Cover contrast" type="range" min={-50} max={80} step={5} value={asciiConfig.contrast}
            onChange={event => onChangeConfig({ contrast: Number(event.target.value) })}
            className="cursor-pointer" style={{ accentColor: theme.accent }} />
        </label>

        <div className="flex min-w-0 flex-wrap items-center gap-3 pt-2 text-[11px]">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={asciiConfig.colorEnabled}
              onChange={event => onChangeConfig({ colorEnabled: event.target.checked })} style={{ accentColor: theme.accent }} />
            <span style={{ color: asciiConfig.colorEnabled ? theme.highlight : theme.textDim }}>{asciiConfig.mode === 'original_hd' ? 'TrueColor' : 'ANSI Color'}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={asciiConfig.inverted}
              onChange={event => onChangeConfig({ inverted: event.target.checked })} style={{ accentColor: theme.accent }} />
            <span style={{ color: asciiConfig.inverted ? theme.highlight : theme.textDim }}>Invert</span>
          </label>
          <button type="button" onClick={() => asciiConfig.mode === 'original_hd' ? setArtworkRevision(value => value + 1) : onRefresh()}
            className="ml-auto flex items-center gap-1 border px-2 py-0.5 text-[10px] hover:brightness-125"
            style={{ borderColor: theme.border, color: theme.text }}>
            <RefreshCw className={`h-2.5 w-2.5 ${(asciiConfig.mode === 'original_hd' ? !currentArtwork && !artworkFailed : isLoading) ? 'animate-spin' : ''}`} />
            <span>{asciiConfig.mode === 'original_hd' ? 'Reload' : 'Rerender'}</span>
          </button>
        </div>
      </div>

      {/* Artwork and independently scrolling song details */}
      <ResizableSplit theme={theme} storageKey="lyrics" label="Resize artwork and lyrics"
        rowAt="md" defaultSize={50} minFirst={{ row: 140, column: 100 }} minSecond={{ row: 180, column: 120 }}
        first={<div className={`flex min-h-0 min-w-0 flex-1 ${sidePanel ? 'flex-col' : 'flex-col md:flex-row'}`}>
          {/* Left / Center: Display Area */}
          <div data-background-region="artwork" className="flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col items-center custom-scrollbar"
            style={{ backgroundColor: 'transparent' }}>
            {asciiConfig.mode === 'original_hd' && artworkFailed && !currentArtwork ? (
              <span className="my-auto text-xs" style={{ color: theme.warning }}>[ Could not load this artwork. ]</span>
            ) : (asciiConfig.mode === 'original_hd' ? !currentArtwork : isLoading) ? (
              <div className="my-auto flex flex-col items-center gap-2" style={{ color: theme.warning }}>
                <div className="animate-spin text-lg">⚙</div>
                <span className="text-xs">
                  {asciiConfig.mode === 'original_hd'
                    ? '[ Loading original artwork... ]'
                    : '[ Converting album thumbnail to ASCII matrix... ]'}
                </span>
              </div>
            ) : asciiConfig.mode === 'original_hd' ? (
              /* High-Definition Original Image Canvas */
              <div
                className="skin-artwork-frame my-auto shrink-0 p-3 border rounded-none max-w-full flex flex-col items-center gap-2.5 shadow-2xl transition-all"
                style={{
                  borderColor: theme.accent,
                  backgroundColor: 'var(--app-surface-bg)',
                  boxShadow: `0 0 30px ${theme.accentGlow}`,
                }}
              >
                <div className="w-full flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono border-b pb-1.5" style={{ borderColor: theme.border }}>
                  <div className="flex items-center gap-1.5">
                    {showArtworkIcon && <Sparkles className="w-3.5 h-3.5" style={{ color: theme.accent }} />}
                    <span className="font-bold uppercase tracking-wider" style={{ color: theme.highlight }}>
                      ┌─ Album artwork ─┐
                    </span>
                  </div>
                </div>

                <div className="skin-artwork-frame relative group overflow-hidden border p-1 max-w-full" style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-bg)' }}>
                  <img
                    src={artworkUrl}
                    alt={track.title}
                    className="max-h-[65vh] max-w-full object-contain"
                    style={{
                      filter: `contrast(${asciiConfig.contrast + 100}%) brightness(${100 + asciiConfig.brightness * 10}%) ${asciiConfig.inverted ? 'invert(1)' : ''} ${!asciiConfig.colorEnabled ? 'grayscale(1)' : ''}`,
                      width: `${Math.min(currentArtwork?.width || 800, Math.max(220, asciiConfig.width / 96 * 800))}px`,
                    }}
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/85 p-1 border text-[10px]" style={{ borderColor: theme.border }}>
                    <a
                      href={artworkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:brightness-125 flex items-center gap-1"
                      style={{ color: theme.highlight }}
                      title="Open original high-res in new browser tab"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Fullscreen</span>
                    </a>
                  </div>
                </div>

              </div>
            ) : asciiResult && asciiResult.lines.length > 0 ? (
              <div className="my-auto shrink-0 p-2 border rounded-none max-w-full overflow-x-auto" style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-bg)' }}>
                <pre
                  className="font-mono text-[9px] sm:text-[10px] md:text-[11px] leading-[9px] sm:leading-[10px] md:leading-[11px] select-all whitespace-pre tracking-normal"
                  style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  }}
                >
                  {asciiResult.lines.map((line, lIdx) => (
                    <div key={lIdx} className="flex">
                      {line.map((pixel, pIdx) => (
                        <span
                          key={pIdx}
                          style={{
                            color: pixel.color || theme.accent,
                            backgroundColor: pixel.bgColor || 'transparent',
                          }}
                        >
                          {pixel.char}
                        </span>
                      ))}
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <span className="my-auto text-xs opacity-60">[ Failed to generate ASCII art ]</span>
            )}
          </div>

          {showOriginal && asciiConfig.mode !== 'original_hd' && (
            <div
              role="region" aria-label="Original artwork preview"
              className={`${sidePanel ? 'w-full border-t max-h-48' : 'w-full md:w-72 border-t md:border-t-0 md:border-l'} shrink-0 p-4 text-xs overflow-y-auto`}
              style={{
                borderColor: theme.border,
                backgroundColor: 'var(--app-surface-card-bg)',
              }}
            >
              <div className="border p-1" style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-bg)' }}>
                <img src={artworkUrl || track.thumbnailUrl} alt={`Original artwork for ${track.title}`} className="w-full h-40 object-cover" />
                <div className="text-[9px] text-center mt-1" style={{ color: theme.textDim }}>
                  {track.album || track.title}
                </div>
              </div>
            </div>
          )}
        </div>}

        second={sidePanel ? <aside aria-label="Song details and lyrics"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          style={{ backgroundColor: 'transparent' }}>
          {sidePanel}
        </aside> : null}
      />
    </div>
  );
};
