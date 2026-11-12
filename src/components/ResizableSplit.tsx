import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ThemeConfig } from '../types';

type Direction = 'row' | 'column';
type Size = number | Record<Direction, number>;

interface ResizableSplitProps {
  theme: ThemeConfig;
  storageKey: string;
  label: string;
  regionLabel?: string;
  first: React.ReactNode;
  second: React.ReactNode;
  showFirst?: boolean;
  rowAt?: 'md' | 'lg';
  unit?: 'pixels' | 'percent';
  defaultSize: Size;
  minFirst: Size;
  minSecond: Size;
  maxFirst?: number;
  reverse?: boolean;
  spacing?: number;
  axis?: Direction;
  value?: number;
  onValueChange?: (value: number, commit: boolean) => void;
}

const sizeFor = (size: Size, direction: Direction) => typeof size === 'number' ? size : size[direction];

export function ResizableSplit({
  theme, storageKey, label, regionLabel, first, second, showFirst = true, rowAt,
  unit = 'percent', defaultSize, minFirst, minSecond, maxFirst = Infinity,
  reverse = false, spacing = 0,
  axis, value, onValueChange,
}: ResizableSplitProps) {
  const key = `youterm_layout_${storageKey}_v1`;
  const query = rowAt ? `(min-width: ${rowAt === 'md' ? 48 : 64}rem)` : null;
  const [wide, setWide] = useState(() => !query || window.matchMedia(query).matches);
  const direction: Direction = axis || (wide ? 'row' : 'column');
  const [sizes, setSizes] = useState<Partial<Record<Direction, number>>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      const result: Partial<Record<Direction, number>> = {};
      for (const axis of ['row', 'column'] as const) {
        if (typeof saved?.[axis] === 'number' && Number.isFinite(saved[axis]) && saved[axis] > 0
          && (unit === 'pixels' || saved[axis] < 100)) result[axis] = saved[axis];
      }
      return result;
    } catch { return {}; }
  });
  const sizesRef = useRef(sizes);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extent, setExtent] = useState(0);
  const firstId = useId();

  useEffect(() => {
    if (!query) return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setExtent(direction === 'row' ? container.clientWidth : container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [direction]);

  useEffect(() => {
    setDragging(false);
    return () => {
      if (dragRef.current) delete document.documentElement.dataset.panelResizing;
      dragRef.current = null;
    };
  }, [direction, showFirst, reverse, spacing]);

  const handleSize = Math.max(6, spacing);
  const reversed = direction === 'row' && reverse;
  const available = Math.max(0, extent - handleSize);
  const firstMinimum = sizeFor(minFirst, direction);
  const secondMinimum = sizeFor(minSecond, direction);
  // Share the space proportionally when a small window cannot fit both minimums.
  const scale = Math.min(1, available / (firstMinimum + secondMinimum));
  const minimum = firstMinimum * scale;
  const maximum = Math.max(minimum, Math.min(maxFirst, available - secondMinimum * scale));
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const preferredSize = value ?? sizes[direction] ?? sizeFor(defaultSize, direction);
  const pixels = clamp(unit === 'percent' ? preferredSize / 100 * available : preferredSize);

  useLayoutEffect(() => {
    if (value !== undefined && !dragRef.current) sizesRef.current = { ...sizesRef.current, [direction]: value };
  }, [value, direction]);

  const save = () => {
    if (onValueChange) { onValueChange(sizesRef.current[direction] ?? preferredSize, true); return; }
    try { localStorage.setItem(key, JSON.stringify(sizesRef.current)); }
    catch { /* Resizing still works when local storage is unavailable. */ }
  };
  const resize = (value: number, persist = false) => {
    if (!available) return;
    const next = { ...sizesRef.current, [direction]: unit === 'percent' ? clamp(value) / available * 100 : clamp(value) };
    sizesRef.current = next;
    setSizes(next);
    if (onValueChange && !persist) onValueChange(next[direction]!, false);
    if (persist) save();
  };
  const reset = () => {
    if (onValueChange) { onValueChange(sizeFor(defaultSize, direction), true); return; }
    const next = { ...sizesRef.current };
    delete next[direction];
    sizesRef.current = next;
    setSizes(next);
    save();
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    delete document.documentElement.dataset.panelResizing;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    save();
  };

  return (
    <div ref={containerRef} role={regionLabel ? 'region' : undefined} aria-label={regionLabel}
      data-split={storageKey} className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ flexDirection: reversed ? 'row-reverse' : direction }}>
      <div id={firstId} className="min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ display: showFirst ? 'flex' : 'none', flex: second == null ? '1 1 0%' : `0 0 ${extent ? `${pixels}px` : `${preferredSize}${unit === 'percent' ? '%' : 'px'}`}` }}>
        {first}
      </div>
      {showFirst && second != null && <div role="separator" tabIndex={0} aria-label={label} aria-controls={firstId}
        aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(pixels)}
        aria-valuetext={`${Math.round(pixels)} pixels`}
        title="Drag to resize · Double-click to reset · Arrow keys to adjust"
        className="resize-handle" data-direction={direction} data-dragging={dragging}
        style={{ '--resize-border': theme.border, '--resize-accent': theme.accent, flexBasis: handleSize } as React.CSSProperties}
        onDoubleClick={reset}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, start: direction === 'row' ? event.clientX : event.clientY, size: pixels };
          setDragging(true);
          document.documentElement.dataset.panelResizing = direction;
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          resize(drag.size + ((direction === 'row' ? event.clientX : event.clientY) - drag.start) * (reversed ? -1 : 1));
        }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={event => {
          if (event.key === 'Tab') { event.stopPropagation(); return; }
          const decrease = direction === 'row' ? reversed ? 'ArrowRight' : 'ArrowLeft' : 'ArrowUp';
          const increase = direction === 'row' ? reversed ? 'ArrowLeft' : 'ArrowRight' : 'ArrowDown';
          if (![decrease, increase, 'Home', 'End', 'Enter'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Enter') reset();
          else if (event.key === 'Home') resize(minimum, true);
          else if (event.key === 'End') resize(maximum, true);
          else resize(pixels + (event.key === decrease ? -1 : 1) * (event.shiftKey ? 40 : 10), true);
        }}
      />}
      <div className="min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ display: second == null ? 'none' : 'flex' }}>{second}</div>
    </div>
  );
}
