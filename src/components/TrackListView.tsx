import React, { useRef, useEffect, useState, useMemo } from 'react';
import { AsciiConfig, AsciiResult, Track, ThemeConfig } from '../types';
import { Play, Pause, Heart, Plus, Eye, GripVertical } from 'lucide-react';

interface TrackListViewProps {
  theme: ThemeConfig;
  title: string;
  subtitle?: string;
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  selectedTrackIndex: number;
  onSelectTrack: (track: Track, index: number) => void;
  onPlayTrack: (track: Track) => void;
  onPrepareTrack?: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onViewAscii: (track: Track) => void;
  /** Right-click / Menu key. `track` is undefined when the empty area of the list was clicked. */
  onContextMenu?: (target: { track?: Track; index?: number }, x: number, y: number) => void;
  backgroundAscii?: AsciiResult | null;
  showBackgroundAscii?: boolean;
  asciiConfig?: AsciiConfig;
  coverArtworkUrl?: string | null;
  isReorderable?: boolean;
  onReorderTrack?: (fromIndex: number, toIndex: number) => void;
}

export const TrackListView: React.FC<TrackListViewProps> = ({
  theme,
  title,
  subtitle,
  tracks,
  currentTrack,
  isPlaying,
  selectedTrackIndex,
  onSelectTrack,
  onPlayTrack,
  onPrepareTrack,
  onToggleLike,
  onAddToQueue,
  onViewAscii,
  onContextMenu,
  backgroundAscii,
  showBackgroundAscii = true,
  asciiConfig,
  coverArtworkUrl,
  isReorderable = false,
  onReorderTrack,
}) => {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prepareTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(prepareTimerRef.current), []);

  // Drag and drop reordering state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const isDraggingRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);
  const targetIndexRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastClientYRef = useRef<number | null>(null);
  const autoScrollAnimRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);

  // Stop auto-scroll and reset drag state on unmount
  useEffect(() => {
    return () => {
      if (autoScrollAnimRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimRef.current);
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  // Calculate target drop index from clientY
  const calcTargetIndex = (clientY: number) => {
    const container = listContainerRef.current;
    if (!container || tracks.length === 0) return;

    const rect = container.getBoundingClientRect();
    const relativeY = clientY - rect.top + container.scrollTop;
    const rowHeight = rowRefs.current[0]?.offsetHeight || 32;
    const rawIndex = Math.floor(relativeY / rowHeight);
    const clampedIndex = Math.max(0, Math.min(tracks.length - 1, rawIndex));

    targetIndexRef.current = clampedIndex;
    setTargetIndex(clampedIndex);
  };

  // Auto-scroll loop when dragging near top/bottom edges of the list
  const startAutoScroll = () => {
    const scrollSpeed = 10;
    const edgeThreshold = 45;

    const step = () => {
      if (!isDraggingRef.current) return;
      const container = listContainerRef.current;
      const currentY = lastClientYRef.current;
      if (container && currentY !== null) {
        const rect = container.getBoundingClientRect();
        if (currentY < rect.top + edgeThreshold && container.scrollTop > 0) {
          const intensity = Math.max(0.2, (rect.top + edgeThreshold - currentY) / edgeThreshold);
          container.scrollTop -= scrollSpeed * intensity;
          calcTargetIndex(currentY);
        } else if (
          currentY > rect.bottom - edgeThreshold &&
          container.scrollTop + container.clientHeight < container.scrollHeight
        ) {
          const intensity = Math.max(0.2, (currentY - (rect.bottom - edgeThreshold)) / edgeThreshold);
          container.scrollTop += scrollSpeed * intensity;
          calcTargetIndex(currentY);
        }
      }
      autoScrollAnimRef.current = requestAnimationFrame(step);
    };

    autoScrollAnimRef.current = requestAnimationFrame(step);
  };

  const handleRowMouseDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0 || !isReorderable || !onReorderTrack || tracks.length <= 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    startPosRef.current = { x: startX, y: startY };
    dragIndexRef.current = index;
    targetIndexRef.current = index;
    lastClientYRef.current = startY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const dist = Math.hypot(dx, dy);

      if (!isDraggingRef.current) {
        if (dist >= 5) {
          isDraggingRef.current = true;
          setDragIndex(index);
          setTargetIndex(index);
          setCursorPos({ x: moveEvent.clientX, y: moveEvent.clientY });
          lastClientYRef.current = moveEvent.clientY;
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'grabbing';
          startAutoScroll();
          calcTargetIndex(moveEvent.clientY);
        }
        return;
      }

      setCursorPos({ x: moveEvent.clientX, y: moveEvent.clientY });
      lastClientYRef.current = moveEvent.clientY;
      calcTargetIndex(moveEvent.clientY);
    };

    const handleMouseUp = () => {
      cleanup();
      if (isDraggingRef.current) {
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 120);

        const from = dragIndexRef.current;
        const to = targetIndexRef.current;
        if (from !== null && to !== null && from !== to) {
          onReorderTrack(from, to);
        }
      }

      isDraggingRef.current = false;
      dragIndexRef.current = null;
      targetIndexRef.current = null;
      startPosRef.current = null;
      lastClientYRef.current = null;
      setDragIndex(null);
      setTargetIndex(null);
      setCursorPos(null);
    };

    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        cleanup();
        isDraggingRef.current = false;
        dragIndexRef.current = null;
        targetIndexRef.current = null;
        startPosRef.current = null;
        lastClientYRef.current = null;
        setDragIndex(null);
        setTargetIndex(null);
        setCursorPos(null);
      }
    };

    const cleanup = () => {
      if (autoScrollAnimRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimRef.current);
        autoScrollAnimRef.current = null;
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
  };

  // Preview tracks computed dynamically while dragging
  const displayTracks = useMemo(() => {
    if (dragIndex === null || targetIndex === null || dragIndex === targetIndex) {
      return tracks;
    }
    const result = [...tracks];
    const [dragged] = result.splice(dragIndex, 1);
    result.splice(targetIndex, 0, dragged);
    return result;
  }, [tracks, dragIndex, targetIndex]);

  const draggedTrack = dragIndex !== null ? tracks[dragIndex] : null;

  // Automatically scroll selected track into view when navigating with j/k or arrows
  useEffect(() => {
    if (selectedTrackIndex >= 0 && rowRefs.current[selectedTrackIndex]) {
      rowRefs.current[selectedTrackIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedTrackIndex]);

  // Keyboard access: Menu key / Shift+F10 opens the menu for the selected row.
  useEffect(() => {
    if (!onContextMenu) return;
    const handleKey = (e: KeyboardEvent) => {
      const isMenuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
      if (!isMenuKey) return;
      const target = document.activeElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const track = tracks[selectedTrackIndex];
      const row = rowRefs.current[selectedTrackIndex];
      if (!track || !row) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      onContextMenu({ track, index: selectedTrackIndex }, rect.left + Math.min(rect.width / 2, 160), rect.bottom - 4);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onContextMenu, tracks, selectedTrackIndex]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden select-none">
      {/* Background Cover Art Watermark (follows the render mode indicated on the cover screen) */}
      {showBackgroundAscii && (
        <div
          data-album-watermark="" aria-hidden="true"
          className="absolute inset-0 pointer-events-none overflow-hidden opacity-30 flex items-center justify-end pr-8"
          style={{ zIndex: 0 }}
        >
          {asciiConfig?.mode === 'original_hd' ? (
            (coverArtworkUrl || currentTrack?.thumbnailUrl) ? (
              <img
                src={coverArtworkUrl || currentTrack?.thumbnailUrl}
                alt={currentTrack?.title || 'Cover'}
                className="max-h-[250px] max-w-[270px] object-contain shadow-2xl"
                style={{
                  filter: `drop-shadow(0 0 16px rgba(0,0,0,0.95)) contrast(${(asciiConfig?.contrast ?? 0) + 100}%) brightness(${100 + (asciiConfig?.brightness ?? 0) * 10}%) ${asciiConfig?.inverted ? 'invert(1)' : ''} ${asciiConfig && !asciiConfig.colorEnabled ? 'grayscale(1)' : ''}`,
                }}
              />
            ) : null
          ) : backgroundAscii && backgroundAscii.lines.length > 0 ? (
            <pre
              className="font-mono text-[9px] leading-[9px] select-none text-right whitespace-pre"
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.8))',
              }}
            >
              {backgroundAscii.lines.map((line, lIdx) => (
                <div key={lIdx}>
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
          ) : null}
        </div>
      )}

      {/* Header Bar */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between z-20 relative"
        style={{
          borderColor: theme.border,
          backgroundColor: 'var(--app-surface-card-bg)',
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
          <span className="truncate font-bold text-xs" title={title} style={{ color: theme.highlight }}>
            ┌─ {title} {subtitle ? `— ${subtitle}` : ''} ─
          </span>
          <span className="text-xs opacity-60 hidden sm:inline">
            ({tracks.length} track{tracks.length === 1 ? '' : 's'} {tracks.length > 0 ? `| #${selectedTrackIndex + 1}` : ''})
          </span>
        </div>
        <div className="flex min-w-0 max-w-[55%] items-center gap-2 text-xs">
          {dragIndex !== null && draggedTrack ? (
            <span className="truncate font-bold animate-pulse text-[11px]" style={{ color: theme.accent }}>
              [ ⠿ Moving: "{draggedTrack.title}" → Release at #{targetIndex !== null ? targetIndex + 1 : dragIndex + 1} | Esc: Cancel ]
            </span>
          ) : isReorderable ? (
            <span style={{ color: theme.textDim }} className="truncate text-[11px]" title="Drag with click to reorder | Enter: Play | Space: Pause | L: Like">
              [Drag with click to reorder | Enter: Play | Space: Pause | L: Like]
            </span>
          ) : (
            <span style={{ color: theme.textDim }} className="truncate text-[11px]" title="j/k: Scroll & Select | Enter: Play | Space: Pause | L: Like">
              [j/k: Scroll & Select | Enter: Play | Space: Pause | L: Like]
            </span>
          )}
        </div>
      </div>

      {/* Table Column Headers */}
      <div
        className="grid grid-cols-12 gap-2 px-4 py-1.5 border-b text-[11px] font-mono font-semibold uppercase tracking-wider z-20 relative"
        style={{
          borderColor: theme.border,
          color: theme.textDim,
          backgroundColor: 'var(--app-surface-bg)',
        }}
      >
        <div className="col-span-1 text-center">#</div>
        <div className="col-span-1 text-center">♥</div>
        <div className="col-span-5 sm:col-span-5 md:col-span-5 truncate">Title</div>
        <div className="col-span-3 sm:col-span-3 md:col-span-3 truncate">Artist</div>
        <div className="col-span-2 text-right truncate">Length</div>
      </div>

      {/* Track Rows */}
      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto z-10 custom-scrollbar focus:outline-none"
        onScroll={() => {
          if (isDraggingRef.current && lastClientYRef.current !== null) {
            calcTargetIndex(lastClientYRef.current);
          }
        }}
        onContextMenu={(e) => {
          if (isDraggingRef.current) {
            e.preventDefault();
            return;
          }
          if (e.defaultPrevented || !onContextMenu) return;
          e.preventDefault();
          onContextMenu({}, e.clientX, e.clientY);
        }}
      >
        {displayTracks.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-xs opacity-60">
            <span>[ No tracks found in this category or playlist ]</span>
            <span className="mt-1 text-[11px]">Use Search (/) or select another library category.</span>
          </div>
        ) : (
          displayTracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id || currentTrack?.youtubeId === track.youtubeId;
            const isSelected = selectedTrackIndex === index;
            const isDropTarget = dragIndex !== null && targetIndex !== null && index === targetIndex && dragIndex !== targetIndex;
            const isOriginDuringDrag = dragIndex !== null && targetIndex !== null && dragIndex === targetIndex && index === dragIndex;

            return (
              <div
                key={track.id ? `track-${track.id}` : `idx-${index}`}
                ref={(el) => (rowRefs.current[index] = el)}
                onMouseDown={(e) => handleRowMouseDown(e, index)}
                onClick={() => {
                  if (justDraggedRef.current || isDraggingRef.current) return;
                  onSelectTrack(track, index);
                }}
                onDoubleClick={() => {
                  if (justDraggedRef.current || isDraggingRef.current) return;
                  onPlayTrack(track);
                }}
                onMouseEnter={() => {
                  if (isDraggingRef.current) return;
                  clearTimeout(prepareTimerRef.current);
                  prepareTimerRef.current = setTimeout(() => onPrepareTrack?.(track), 300);
                }}
                onMouseLeave={() => clearTimeout(prepareTimerRef.current)}
                onFocus={() => {
                  if (!isDraggingRef.current) onPrepareTrack?.(track);
                }}
                onContextMenu={(e) => {
                  if (isDraggingRef.current) {
                    e.preventDefault();
                    return;
                  }
                  if (!onContextMenu) return;
                  e.preventDefault();
                  onSelectTrack(track, index);
                  onContextMenu({ track, index }, e.clientX, e.clientY);
                }}
                className={`track-row grid grid-cols-12 gap-2 px-4 py-1.5 items-center text-xs font-mono border-b transition-colors group relative ${
                  isReorderable ? (dragIndex !== null ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'
                }`}
                style={{
                  borderColor: isDropTarget ? theme.accent : 'rgba(255, 255, 255, 0.04)',
                  borderStyle: isDropTarget ? 'dashed' : 'solid',
                  borderWidth: isDropTarget ? '2px' : '0 0 1px 0',
                  backgroundColor: isDropTarget
                    ? `${theme.accent}33`
                    : isCurrent
                    ? `${theme.accent}24`
                    : isSelected
                    ? `${theme.highlight}22`
                    : isOriginDuringDrag
                    ? 'var(--app-surface-card-bg)'
                    : 'transparent',
                  color: isDropTarget ? theme.highlight : isCurrent ? theme.highlight : theme.text,
                  boxShadow: isDropTarget ? `0 0 16px ${theme.accentGlow || 'rgba(34, 197, 94, 0.4)'}` : undefined,
                }}
              >
                {/* Track Number / Play Indicator / Reorder Handle */}
                <div className="col-span-1 text-center flex items-center justify-center relative z-20">
                  {isDropTarget ? (
                    <span className="font-bold flex items-center gap-0.5 text-xs animate-pulse" style={{ color: theme.accent }}>
                      #{index + 1}
                    </span>
                  ) : isCurrent ? (
                    <span
                      className="font-bold flex items-center gap-0.5 animate-pulse"
                      style={{ color: theme.accent }}
                    >
                      {isPlaying ? '▶' : '❚❚'}
                    </span>
                  ) : (
                    <div className="flex items-center justify-center gap-0.5 w-full">
                      {isReorderable && (
                        <GripVertical
                          className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0"
                          style={{ color: isSelected ? theme.highlight : theme.textDim }}
                        />
                      )}
                      <span style={{ color: isSelected ? theme.highlight : theme.textDim }}>
                        {index + 1}
                      </span>
                    </div>
                  )}
                </div>

                {/* Heart / Liked icon */}
                <div className="col-span-1 text-center flex items-center justify-center relative z-20">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLike(track);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="hover:scale-125 transition-transform"
                    title={track.isLiked ? 'Unlike song' : 'Like song'}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        track.isLiked ? 'fill-current' : 'opacity-30 hover:opacity-100'
                      }`}
                      style={{ color: track.isLiked ? theme.accent : theme.textDim }}
                    />
                  </button>
                </div>

                {/* Track Title */}
                <div className="col-span-5 sm:col-span-5 md:col-span-5 flex items-center gap-2 truncate relative z-20">
                  {isCurrent && !isDropTarget && (
                    <span style={{ color: theme.accent }} className="text-[10px] hidden sm:inline">
                      ▶
                    </span>
                  )}
                  {isDropTarget && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 border uppercase tracking-wider font-bold animate-pulse flex-shrink-0"
                      style={{
                        borderColor: theme.accent,
                        backgroundColor: 'var(--app-surface-bg)',
                        color: theme.accent,
                      }}
                    >
                      [ ◄ DROP HERE ◄ ]
                    </span>
                  )}
                  <span
                    className={`truncate ${isCurrent || isDropTarget ? 'font-bold' : ''}`}
                    style={{
                      color: isDropTarget ? theme.highlight : isCurrent ? theme.highlight : theme.text,
                    }}
                  >
                    {track.title}
                  </span>
                </div>

                {/* Artist Name */}
                <div className="col-span-3 sm:col-span-3 md:col-span-3 truncate text-[11px] relative z-20" style={{ color: isDropTarget ? theme.highlight : isCurrent ? theme.text : theme.textDim }}>
                  {track.artist}
                </div>

                {/* Duration & Quick Hover Actions */}
                <div className="col-span-2 min-w-0 text-right flex items-center justify-end relative z-20">
                  <span className="text-[11px] group-hover:opacity-0 group-focus-within:opacity-0" style={{ color: isDropTarget ? theme.accent : isCurrent ? theme.highlight : theme.textDim }}>
                    {track.duration && track.duration !== 210
                      ? formatSeconds(track.duration)
                      : track.durationFormatted && track.durationFormatted !== '3:30'
                      ? track.durationFormatted
                      : track.duration
                      ? formatSeconds(track.duration)
                      : '3:30'}
                  </span>

                  {/* Hover Buttons */}
                  <div className="absolute inset-y-0 right-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto flex items-center gap-1 transition-opacity"
                    style={{ backgroundColor: 'var(--app-surface-bg)' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewAscii(track);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 hover:brightness-125 text-[10px] border"
                      style={{ borderColor: theme.border, color: theme.accent }}
                      title="View Album Cover in ASCII"
                    >
                      <Eye className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToQueue(track);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 hover:brightness-125 text-[10px] border"
                      style={{ borderColor: theme.border, color: theme.highlight }}
                      title="Add to queue"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Dragged Track Preview (Follows cursor) */}
      {dragIndex !== null && cursorPos && draggedTrack && (
        <div
          className="fixed z-50 pointer-events-none flex items-center gap-2.5 px-3 py-1.5 text-xs font-mono border shadow-2xl select-none"
          style={{
            left: `${cursorPos.x + 14}px`,
            top: `${cursorPos.y + 14}px`,
            backgroundColor: 'var(--app-surface-card-bg)',
            borderColor: theme.accent,
            color: theme.highlight,
            boxShadow: `0 0 20px ${theme.accentGlow || 'rgba(34, 197, 94, 0.45)'}`,
          }}
        >
          <GripVertical className="w-3.5 h-3.5 flex-shrink-0" style={{ color: theme.accent }} />
          <span
            className="font-bold px-1.5 py-0.5 border text-[10px]"
            style={{ borderColor: theme.border, color: theme.accent, backgroundColor: 'var(--app-surface-bg)' }}
          >
            #{targetIndex !== null ? targetIndex + 1 : dragIndex + 1}
          </span>
          <span className="truncate max-w-[200px] font-semibold">{draggedTrack.title}</span>
          <span className="opacity-60 text-[10px] hidden sm:inline truncate max-w-[120px]">
            — {draggedTrack.artist}
          </span>
        </div>
      )}
    </div>
  );
};

export function formatSeconds(sec: number): string {
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
