import React, { useRef, useState, useEffect, useCallback } from 'react';
import { PlayerState, SkinConfig, ThemeConfig } from '../types';
import { Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Volume2, VolumeX, Heart, Eye, Loader2 } from 'lucide-react';

interface BottomPlayerBarProps {
  theme: ThemeConfig;
  showBackground?: boolean;
  progressStyle?: SkinConfig['progressStyle'];
  controlStyle?: SkinConfig['controlStyle'];
  playerState: PlayerState;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onSeek: (seconds: number) => void;
  onToggleLike: () => void;
  onViewAscii: () => void;
  onToggleFormat?: () => void;
}

export const BottomPlayerBar: React.FC<BottomPlayerBarProps> = ({
  theme,
  showBackground = false,
  progressStyle = 'ascii',
  controlStyle = 'terminal',
  playerState,
  onTogglePlay,
  onNext,
  onPrev,
  onToggleShuffle,
  onCycleRepeat,
  onToggleMute,
  onVolumeChange,
  onSeek,
  onToggleLike,
  onViewAscii,
  onToggleFormat,
}) => {
  const barContainerRef = useRef<HTMLDivElement>(null);
  const barTextRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const hasDraggedRef = useRef(false);
  const dragTimeRef = useRef<number | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const [totalBlocks, setTotalBlocks] = useState(36);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const {
    currentTrack,
    isPlaying,
    isBuffering,
    isChangingFormat,
    audioFormat,
    currentTime,
    duration,
    volume,
    isMuted,
    shuffle,
    repeat,
  } = playerState;

  const isChanging = Boolean(isChangingFormat);
  const displayTime = isDragging && dragTime !== null ? dragTime : currentTime;
  const progressPercent = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;
  const remainingTime = Math.max(0, duration - displayTime);

  // Responsive ASCII progress bar blocks
  const filledBlocks = Math.round((progressPercent / 100) * totalBlocks);
  const emptyBlocks = Math.max(0, totalBlocks - filledBlocks);
  const asciiBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

  useEffect(() => {
    return () => {
      if (cleanupDragRef.current) {
        cleanupDragRef.current();
      }
    };
  }, [progressStyle]);

  useEffect(() => {
    const container = barContainerRef.current;
    if (!container) return;

    const updateBlocks = () => {
      const containerWidth = container.clientWidth;
      const charWidth = measureRef.current?.getBoundingClientRect().width || 7.2;
      // Padding px-2 is 8px left + 8px right = 16px. Plus 2 brackets '[' and ']' = 2 * charWidth.
      const available = containerWidth - 16 - (2 * charWidth);
      if (available > 0 && charWidth > 0) {
        const blocks = Math.max(10, Math.floor(available / charWidth));
        setTotalBlocks(blocks);
      }
    };

    updateBlocks();
    const observer = new ResizeObserver(updateBlocks);
    observer.observe(container);
    return () => observer.disconnect();
  }, [progressStyle]);

  const getTimeFromClientX = useCallback(
    (clientX: number): number => {
      if (duration <= 0) return 0;

      if (barTextRef.current) {
        const rect = barTextRef.current.getBoundingClientRect();
        const charWidth = measureRef.current?.getBoundingClientRect().width || 7.2;
        // Text is: '[' (charWidth) + blocks (rect.width - 2*charWidth) + ']' (charWidth)
        const blocksLeft = rect.left + charWidth;
        const blocksWidth = Math.max(1, rect.width - 2 * charWidth);

        const clickX = clientX - blocksLeft;
        const ratio = Math.max(0, Math.min(1, clickX / blocksWidth));
        return ratio * duration;
      }

      if (barContainerRef.current) {
        const rect = barContainerRef.current.getBoundingClientRect();
        const clickX = clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, clickX / rect.width));
        return ratio * duration;
      }

      return 0;
    },
    [duration]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0 || e.button !== 0) return;
    e.preventDefault();

    const initialTime = getTimeFromClientX(e.clientX);
    hasDraggedRef.current = false;
    dragTimeRef.current = initialTime;
    setIsDragging(true);
    setDragTime(initialTime);
    onSeek(initialTime);

    const handleMouseMoveWindow = (moveEvent: MouseEvent) => {
      hasDraggedRef.current = true;
      const scrubTime = getTimeFromClientX(moveEvent.clientX);
      dragTimeRef.current = scrubTime;
      setDragTime(scrubTime);
    };

    const handleMouseUpWindow = () => {
      if (hasDraggedRef.current && dragTimeRef.current !== null) {
        onSeek(dragTimeRef.current);
      }
      setIsDragging(false);
      setDragTime(null);
      dragTimeRef.current = null;
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMoveWindow);
      window.removeEventListener('mouseup', handleMouseUpWindow);
      cleanupDragRef.current = null;
    };
    cleanupDragRef.current = cleanup;

    window.addEventListener('mousemove', handleMouseMoveWindow);
    window.addEventListener('mouseup', handleMouseUpWindow);
  };

  const handleMouseMoveBar = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const time = getTimeFromClientX(e.clientX);
    setHoverTime(time);
  };

  const handleMouseLeaveBar = () => {
    setIsHovered(false);
    setHoverTime(null);
  };

  return (
    <footer
      data-background-region="player" data-background-enabled={showBackground}
      className="app-player skin-panel shrink-0 border-t select-none font-mono text-xs z-20 flex flex-col"
      style={{
        borderColor: theme.border,
        backgroundColor: showBackground ? 'transparent' : theme.bg,
        ...(!showBackground ? { '--app-surface-bg': theme.bg, '--app-surface-card-bg': theme.cardBg } : {}),
      } as React.CSSProperties}
    >

      {/* Main Player Row */}
      <div className="player-row p-3 flex flex-col items-center justify-between gap-3">
        {/* Left: Current Track Details */}
        <div className="player-track flex items-center gap-3 w-full min-w-0">
          {currentTrack ? (
            <>
              {/* Like Heart Button */}
              <button
                onClick={onToggleLike}
                className="hover:scale-125 transition-transform flex-shrink-0"
                title={currentTrack.isLiked ? 'Unlike song' : 'Like song'}
              >
                <Heart
                  className={`w-4 h-4 ${currentTrack.isLiked ? 'fill-current' : 'opacity-40 hover:opacity-100'
                    }`}
                  style={{ color: currentTrack.isLiked ? theme.accent : theme.textDim }}
                />
              </button>

              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-bold truncate" style={{ color: theme.highlight }}>
                    {currentTrack.title}
                  </span>
                </div>
                <div className="text-[11px] truncate flex items-center gap-2" style={{ color: theme.textDim }}>
                  <span className="truncate">{currentTrack.artist}</span>
                  {currentTrack.album && (
                    <>
                      <span>•</span>
                      <span className="truncate opacity-80">{currentTrack.album}</span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[11px]" style={{ color: theme.textDim }}>
              [ No track playing. Select a song to begin ]
            </div>
          )}
        </div>

        {/* Center: Interactive ASCII Progress Bar */}
        <div className="player-timeline flex-1 min-w-0 w-full max-w-xl flex flex-col gap-1 items-center">
          {/* Controls button row */}
          <div className="flex items-center gap-3">
            {/* Shuffle */}
            <button
              onClick={onToggleShuffle}
              className="p-1 hover:brightness-125 transition-colors"
              title="Shuffle [s]"
              style={{ color: shuffle ? theme.accent : theme.textDim }}
            >
              <Shuffle className="w-3.5 h-3.5" />
            </button>

            {/* Prev */}
            <button
              onClick={onPrev}
              className="p-1 hover:brightness-125 transition-colors"
              title="Previous [p]"
              style={{ color: theme.text }}
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={onTogglePlay}
              className="play-toggle px-2.5 py-1 border hover:brightness-125 transition-all font-bold flex items-center justify-center gap-1.5"
              aria-label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
              title="Play/Pause [Space]"
              style={{
                borderColor: theme.accent,
                backgroundColor: controlStyle === 'minimal' ? theme.accent : 'var(--app-surface-card-bg)',
                color: controlStyle === 'minimal' ? theme.bg : theme.highlight,
              }}
            >
              {isBuffering ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {controlStyle === 'terminal' && <span>BUFFERING</span>}
                </>
              ) : isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  {controlStyle === 'terminal' && <span>PAUSE</span>}
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {controlStyle === 'terminal' && <span>PLAY</span>}
                </>
              )}
            </button>

            {/* Next */}
            <button
              onClick={onNext}
              className="p-1 hover:brightness-125 transition-colors"
              title="Next [n]"
              style={{ color: theme.text }}
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Repeat */}
            <button
              onClick={onCycleRepeat}
              className="p-1 hover:brightness-125 transition-colors flex items-center gap-0.5"
              title={`Repeat: ${repeat} [r]`}
              style={{ color: repeat !== 'off' ? theme.accent : theme.textDim }}
            >
              <Repeat className="w-3.5 h-3.5" />
              {repeat === 'one' && <span className="text-[9px] font-bold">1</span>}
            </button>
          </div>

          {/* Hidden element to measure character width accurately */}
          <span
            ref={measureRef}
            className="ascii-progress invisible absolute -top-[9999px] left-0 font-mono text-[11px] tracking-wider pointer-events-none select-none"
            aria-hidden="true"
          >
            █
          </span>

          {/* ASCII Progress Bar Graphic */}
          <div className="w-full flex items-center justify-between gap-2 px-1">
            {/* Current Time */}
            <span
              className="text-[11px] font-mono w-10 text-right select-none"
              style={{ color: theme.accent }}
            >
              {formatTime(displayTime)}
            </span>

            {/* Visual ASCII Bar */}
            {progressStyle === 'continuous' ? <input type="range" aria-label="Playback progress"
              min={0} max={Math.max(0, duration)} step={0.1} value={Math.max(0, Math.min(duration, displayTime))}
              disabled={duration <= 0} aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
              className="min-w-0 flex-1 cursor-pointer disabled:opacity-40"
              onChange={event => onSeek(Number(event.target.value))} /> : <div
              ref={barContainerRef}
              onMouseDown={handleMouseDown}
              onMouseEnter={() => setIsHovered(true)}
              onMouseMove={handleMouseMoveBar}
              onMouseLeave={handleMouseLeaveBar}
              title={duration > 0 && hoverTime !== null ? `Seek: ${formatTime(hoverTime)}` : undefined}
              className={`ascii-progress flex-1 border px-2 py-0.5 font-mono text-[11px] tracking-wider text-center select-none transition-colors overflow-hidden truncate ${duration > 0 ? 'cursor-pointer' : 'cursor-default'
                }`}
              style={{
                borderColor: isHovered || isDragging ? theme.accent : theme.border,
                backgroundColor: 'var(--app-surface-bg)',
              }}
            >
              <span ref={barTextRef}>
                <span style={{ color: theme.highlight }}>[{asciiBar.slice(0, filledBlocks)}</span>
                <span style={{ color: theme.textDim }}>{asciiBar.slice(filledBlocks)}]</span>
              </span>
            </div>}

            {/* Total / Remaining Time */}
            <span
              className="text-[11px] font-mono text-left flex gap-1 select-none"
              style={{ color: theme.textDim }}
            >
              <span style={{ color: theme.text }}>{formatTime(duration)}</span>
              <span className="opacity-60 hidden sm:inline">(-{formatTime(remainingTime)})</span>
            </span>
          </div>
        </div>

        {/* Right: Volume Slider & Shortcut hints */}
        <div className="player-volume flex items-center justify-end gap-3 w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleMute}
              className="hover:brightness-125 transition-colors"
              title="Mute/Unmute [m]"
              style={{ color: isMuted ? theme.error : theme.accent }}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-20 accent-[#87cf3e] cursor-pointer"
            />
            <span className="text-[11px] w-8 font-mono" style={{ color: theme.textDim }}>
              {isMuted ? '0%' : `${volume}%`}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

function formatTime(sec: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
