import React, { useEffect, useState } from 'react';
import { AsciiConfig, AsciiRenderMode, AsciiResult, Track, ThemeConfig } from '../types';
import { loadCoverArtwork, type CoverArtwork } from '../services/coverArtwork';
import { Copy, Download, Sliders, RefreshCw, Check, Image as ImageIcon, Sparkles, ExternalLink, Eye, ChevronDown } from 'lucide-react';

interface AsciiArtViewerProps {
  theme: ThemeConfig;
  track: Track | null;
  asciiResult: AsciiResult | null;
  asciiConfig: AsciiConfig;
  onChangeConfig: (newConfig: Partial<AsciiConfig>) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export const AsciiArtViewer: React.FC<AsciiArtViewerProps> = ({
  theme,
  track,
  asciiResult,
  asciiConfig,
  onChangeConfig,
  onRefresh,
  isLoading,
}) => {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [artwork, setArtwork] = useState<(CoverArtwork & { key: string }) | null>(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [artworkRevision, setArtworkRevision] = useState(0);
  const artworkKey = `${track?.youtubeId}:${track?.thumbnailUrl}`;
  const currentArtwork = artwork?.key === artworkKey ? artwork : null;
  const artworkUrl = currentArtwork?.url;
  const needsArtwork = asciiConfig.mode === 'original_hd' || showOriginal;
  const resolution = currentArtwork ? `${currentArtwork.width} × ${currentArtwork.height}` : 'Loading…';

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

  const modes: { id: AsciiRenderMode; label: string }[] = [
    { id: 'half_block', label: 'ANSI Half-Block (24-bit TrueColor)' },
    { id: 'braille', label: 'Braille Matrix (⠶⠿⣶)' },
    { id: 'original_hd', label: 'Original Image (HD)' },
    { id: 'matrix_code', label: 'Matrix Code (Digital Rain)' },
    { id: 'retro_crt', label: 'Retro Monochrome CRT' },
  ];

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

  const handleDownloadTxt = async () => {
    if (!track) return;
    if (asciiConfig.mode === 'original_hd') {
      if (!artworkUrl || !currentArtwork) return;
      try {
        let response: Response;
        try {
          response = await fetch(artworkUrl);
          if (!response.ok) throw new Error('Artwork download failed.');
        } catch {
          response = await fetch(`/api/image-proxy?url=${encodeURIComponent(artworkUrl)}`);
          if (!response.ok) throw new Error('Artwork download failed.');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
        a.download = `${track.artist} - ${track.title} [${currentArtwork.width}x${currentArtwork.height}].${extension}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        window.open(artworkUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (!asciiResult) return;
    const blob = new Blob([asciiResult.rawText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${track.artist} - ${track.title} [ASCII].txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!track) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-xs font-mono select-none" style={{ color: theme.textDim }}>
        <p>[ No track selected for ASCII Cover Art conversion ]</p>
        <p className="mt-2 text-[11px]">Select a song from your library or search to generate its ASCII album cover.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative select-none font-mono overflow-hidden">
      {/* Top Header */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between z-10 text-xs"
        style={{
          borderColor: theme.border,
          backgroundColor: theme.cardBg,
        }}
      >
        <div className="flex items-center gap-2 truncate">
          <span className="font-bold" style={{ color: theme.highlight }}>
            ┌─ {asciiConfig.mode === 'original_hd' ? 'HD Album Art' : 'ASCII Album Art'}: {track.album || track.title} by {track.artist} ─
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
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
            onClick={() => setShowControls(!showControls)}
            className="px-2 py-0.5 border text-[11px] flex items-center gap-1 hover:brightness-125"
            style={{
              borderColor: theme.border,
              color: showControls ? theme.accent : theme.text,
              backgroundColor: theme.bg,
            }}
          >
            <Sliders className="w-3 h-3" />
            <span>[Settings]</span>
          </button>

          <button
            onClick={handleCopyText}
            disabled={asciiConfig.mode === 'original_hd' && !artworkUrl}
            className="px-2 py-0.5 border text-[11px] flex items-center gap-1 hover:brightness-125 font-bold"
            style={{
              borderColor: theme.accent,
              color: theme.accent,
              backgroundColor: theme.bg,
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

          <button
            onClick={handleDownloadTxt}
            disabled={asciiConfig.mode === 'original_hd' && !artworkUrl}
            className="px-2 py-0.5 border text-[11px] flex items-center gap-1 hover:brightness-125"
            style={{
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.bg,
            }}
          >
            <Download className="w-3 h-3" />
            <span>{asciiConfig.mode === 'original_hd' ? '[.jpg HD]' : '[.txt]'}</span>
          </button>
        </div>
      </div>

      {/* Settings Sub-Bar */}
      {showControls && (
        <div
          className="px-4 py-2 border-b grid grid-cols-1 md:grid-cols-4 gap-3 text-xs"
          style={{
            borderColor: theme.border,
            backgroundColor: theme.bg,
          }}
        >
          {/* Mode Selection */}
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-bold tracking-wider" style={{ color: theme.textDim }}>RENDER MODE</span>
            <div className="relative flex items-center">
              <select
                value={asciiConfig.mode}
                onChange={(e) => onChangeConfig({ mode: e.target.value as AsciiRenderMode })}
                className="w-full border px-2.5 py-1 pr-7 text-xs outline-none cursor-pointer appearance-none font-mono"
                style={{ borderColor: theme.border, color: theme.highlight, backgroundColor: theme.cardBg }}
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id} style={{ backgroundColor: theme.bg, color: theme.text }}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 pointer-events-none absolute right-2" style={{ color: theme.accent }} />
            </div>
          </div>

          {/* Width / Resolution Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px]" style={{ color: theme.textDim }}>
              <span>{asciiConfig.mode === 'original_hd' ? 'DISPLAY SIZE:' : 'WIDTH (COLS):'}</span>
              <span style={{ color: theme.accent }}>
                {asciiConfig.mode === 'original_hd' ? `${Math.round(asciiConfig.width / 96 * 100)}%` : `${asciiConfig.width} chars`}
              </span>
            </div>
            <input
              type="range"
              min="24"
              max="96"
              step="4"
              value={asciiConfig.width}
              onChange={(e) => onChangeConfig({ width: Number(e.target.value) })}
              className="accent-[#87cf3e] cursor-pointer"
            />
          </div>

          {/* Contrast Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px]" style={{ color: theme.textDim }}>
              <span>CONTRAST:</span>
              <span style={{ color: theme.accent }}>{asciiConfig.contrast}%</span>
            </div>
            <input
              type="range"
              min="-50"
              max="80"
              step="5"
              value={asciiConfig.contrast}
              onChange={(e) => onChangeConfig({ contrast: Number(e.target.value) })}
              className="accent-[#87cf3e] cursor-pointer"
            />
          </div>

          {/* Color & Invert Toggles */}
          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-1 cursor-pointer text-[11px]">
              <input
                type="checkbox"
                checked={asciiConfig.colorEnabled}
                onChange={(e) => onChangeConfig({ colorEnabled: e.target.checked })}
                className="accent-[#87cf3e]"
              />
              <span style={{ color: asciiConfig.colorEnabled ? theme.highlight : theme.textDim }}>
                {asciiConfig.mode === 'original_hd' ? 'TrueColor' : 'ANSI Color'}
              </span>
            </label>

            <label className="flex items-center gap-1 cursor-pointer text-[11px]">
              <input
                type="checkbox"
                checked={asciiConfig.inverted}
                onChange={(e) => onChangeConfig({ inverted: e.target.checked })}
                className="accent-[#87cf3e]"
              />
              <span style={{ color: asciiConfig.inverted ? theme.highlight : theme.textDim }}>Invert</span>
            </label>

            <button
              onClick={() => asciiConfig.mode === 'original_hd' ? setArtworkRevision(value => value + 1) : onRefresh()}
              className="px-2 py-0.5 border text-[10px] ml-auto hover:brightness-125 flex items-center gap-1"
              style={{ borderColor: theme.border, color: theme.text }}
            >
              <RefreshCw className={`w-2.5 h-2.5 ${(asciiConfig.mode === 'original_hd' ? !currentArtwork && !artworkFailed : isLoading) ? 'animate-spin' : ''}`} />
              <span>{asciiConfig.mode === 'original_hd' ? 'Reload' : 'Rerender'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas & Metadata */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left / Center: Display Area */}
        <div className="flex-1 overflow-auto p-4 flex flex-col items-center justify-center custom-scrollbar bg-black/40">
          {asciiConfig.mode === 'original_hd' && artworkFailed && !currentArtwork ? (
            <span className="text-xs" style={{ color: theme.warning }}>[ Could not load this artwork. ]</span>
          ) : (asciiConfig.mode === 'original_hd' ? !currentArtwork : isLoading) ? (
            <div className="flex flex-col items-center gap-2" style={{ color: theme.warning }}>
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
              className="p-3 border rounded-none max-w-full flex flex-col items-center gap-2.5 shadow-2xl transition-all"
              style={{
                borderColor: theme.accent,
                backgroundColor: '#050708',
                boxShadow: `0 0 30px ${theme.accentGlow}`,
              }}
            >
              <div className="w-full flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono border-b pb-1.5" style={{ borderColor: theme.border }}>
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: theme.accent }} />
                  <span className="font-bold uppercase tracking-wider" style={{ color: theme.highlight }}>
                    ┌─ Original Album Artwork ─┐
                  </span>
                </div>
                <span className="px-1.5 py-0.2 border text-[10px]" style={{ borderColor: theme.border, color: theme.accent }}>
                  {resolution}
                </span>
              </div>

              <div className="relative group overflow-hidden border p-1 bg-black/50 max-w-full" style={{ borderColor: theme.border }}>
                <img
                  src={artworkUrl}
                  alt={track.title}
                  className="max-h-[65vh] max-w-full object-contain"
                  style={{
                    filter: `contrast(${asciiConfig.contrast + 100}%) ${asciiConfig.inverted ? 'invert(1)' : ''} ${!asciiConfig.colorEnabled ? 'grayscale(1)' : ''}`,
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

              <div className="w-full flex items-center justify-between gap-2 text-[10px] font-mono pt-1" style={{ color: theme.textDim }}>
                <span style={{ color: theme.accent }}>[ Original source image ]</span>
                <span style={{ color: theme.highlight }}>{resolution} px</span>
                {currentArtwork && currentArtwork.width < 720 && (
                  <span style={{ color: theme.warning }}>Higher resolution unavailable</span>
                )}
              </div>
            </div>
          ) : asciiResult && asciiResult.lines.length > 0 ? (
            <div className="p-2 border rounded-none max-w-full overflow-x-auto" style={{ borderColor: theme.border, backgroundColor: '#050708' }}>
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
            <span className="text-xs opacity-60">[ Failed to generate ASCII art ]</span>
          )}
        </div>

        {/* Right Panel: Track Metadata */}
        {(showOriginal || track) && (
          <div
            className="w-full md:w-72 border-t md:border-t-0 md:border-l p-4 flex flex-col gap-3 text-xs overflow-y-auto"
            style={{
              borderColor: theme.border,
              backgroundColor: theme.cardBg,
            }}
          >
            <div className="font-bold border-b pb-1 flex items-center justify-between" style={{ borderColor: theme.border, color: theme.accent }}>
              <span>┌─ Metadata ─────────┐</span>
              <span className="text-[10px]" style={{ color: theme.highlight }}>YT-ID: {track.youtubeId.slice(0, 6)}..</span>
            </div>

            {/* Original Image Preview (only in ASCII mode when showOriginal is active) */}
            {showOriginal && asciiConfig.mode !== 'original_hd' && (
              <div className="border p-1" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
                <img
                  src={artworkUrl || track.thumbnailUrl}
                  alt={track.title}
                  className="w-full h-40 object-cover"
                />
                <div className="text-[9px] text-center mt-1" style={{ color: theme.textDim }}>
                  Original artwork {currentArtwork ? `(${resolution})` : ''}
                </div>
              </div>
            )}

            {/* Track Info */}
            <div className="space-y-1.5 text-xs">
              <div>
                <span style={{ color: theme.textDim }}>Title: </span>
                <span className="font-semibold" style={{ color: theme.highlight }}>{track.title}</span>
              </div>
              <div>
                <span style={{ color: theme.textDim }}>Artist: </span>
                <span style={{ color: theme.text }}>{track.artist}</span>
              </div>
              <div>
                <span style={{ color: theme.textDim }}>Album: </span>
                <span style={{ color: theme.text }}>{track.album}</span>
              </div>
              {track.year && (
                <div>
                  <span style={{ color: theme.textDim }}>Year: </span>
                  <span style={{ color: theme.text }}>{track.year}</span>
                </div>
              )}
              {track.genre && (
                <div>
                  <span style={{ color: theme.textDim }}>Genre: </span>
                  <span className="px-1 border text-[10px]" style={{ borderColor: theme.border, color: theme.accent }}>{track.genre}</span>
                </div>
              )}
              <div>
                <span style={{ color: theme.textDim }}>Resolution: </span>
                <span style={{ color: theme.text }}>
                  {asciiConfig.mode === 'original_hd'
                    ? artworkFailed ? 'Unavailable' : `${resolution} px`
                    : `${asciiResult?.width || 48} x ${asciiResult?.height || 24} cells`}
                </span>
              </div>
              <div>
                <span style={{ color: theme.textDim }}>Render Mode: </span>
                <span className="px-1 border text-[10px]" style={{ borderColor: theme.border, color: theme.accent }}>
                  {modes.find((m) => m.id === asciiConfig.mode)?.label || asciiConfig.mode}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
