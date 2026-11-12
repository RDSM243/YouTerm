import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GripVertical, Plus, Redo2, RotateCcw, Shuffle, Undo2, X } from 'lucide-react';
import type { DockLayout, DockNode, DockPanelId, DockPosition, ThemeConfig } from '../types';
import { addDockPanel, DOCK_PANELS, dockDropPosition, dockMinimum, dockPanels, moveDockPanel, removeDockPanel, resizeDockSplit } from '../services/dockLayout';
import { ResizableSplit } from './ResizableSplit';

interface DockWorkspaceProps {
  layout: DockLayout;
  editing: boolean;
  theme: ThemeConfig;
  spacing: number;
  renderPanel: (id: DockPanelId) => React.ReactNode;
  onChange: (layout: DockLayout, commit: boolean) => void;
  onReset: () => DockLayout;
  onSave: () => void;
  onCancel: () => void;
}

const destinations = [
  { position: 'left', icon: ArrowLeft, label: 'left of' },
  { position: 'top', icon: ArrowUp, label: 'above' },
  { position: 'center', icon: Shuffle, label: 'swap with' },
  { position: 'bottom', icon: ArrowDown, label: 'below' },
  { position: 'right', icon: ArrowRight, label: 'right of' },
] as const;

export function DockWorkspace({ layout, editing, theme, spacing, renderPanel, onChange, onReset, onSave, onCancel }: DockWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ panel: DockPanelId; pointer: number; x: number; y: number; active: boolean } | null>(null);
  const skipClick = useRef(false);
  const resizeStart = useRef<DockLayout | null>(null);
  const [drag, setDrag] = useState<{ panel: DockPanelId; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ panel: DockPanelId; position: DockPosition } | null>(null);
  const dropRef = useRef(drop);
  const [picked, setPicked] = useState<DockPanelId | null>(null);
  const [past, setPast] = useState<DockLayout[]>([]);
  const [future, setFuture] = useState<DockLayout[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const panels = dockPanels(layout.root);
  const panelStyle = { borderColor: theme.border, backgroundColor: 'var(--app-surface-card-bg)', color: theme.text };

  const clearDrag = () => {
    dragRef.current = null; dropRef.current = null;
    setDrag(null); setDrop(null);
    delete document.documentElement.dataset.layoutDragging;
  };
  useEffect(() => {
    setPast([]); setFuture([]); setPicked(null); clearDrag(); resizeStart.current = null;
    if (editing) requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[data-dock-grip]')?.focus({ preventScroll: true }));
    return () => { delete document.documentElement.dataset.layoutDragging; };
  }, [editing]);

  const remember = (previous: DockLayout) => { setPast(items => [...items.slice(-39), previous]); setFuture([]); };
  const change = (next: DockLayout, message: string) => {
    if (next !== layout) { remember(layout); onChange(next, true); }
    setPicked(null); setAnnouncement(message);
  };
  const focusPanel = (id: DockPanelId) => requestAnimationFrame(() => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-dock-grip="${id}"]`)?.focus({ preventScroll: true });
  });
  const move = (source: DockPanelId, target: DockPanelId, position: DockPosition) => {
    change(moveDockPanel(layout, source, target, position), `${DOCK_PANELS[source]} moved. Resize the dividers to adjust its space.`);
    focusPanel(source);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture(items => [...items, layout]);
    onChange(past[past.length - 1], true); setPast(items => items.slice(0, -1));
    setPicked(null); setAnnouncement('Layout change undone.');
  };
  const redo = () => {
    if (!future.length) return;
    setPast(items => [...items, layout]);
    onChange(future[future.length - 1], true); setFuture(items => items.slice(0, -1));
    setPicked(null); setAnnouncement('Layout change restored.');
  };
  useEffect(() => {
    if (!editing) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (dragRef.current) clearDrag();
        else if (picked) setPicked(null);
        else onCancel();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [editing, picked, past, future, layout, onCancel]);

  const finish = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = dragRef.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.active) {
      skipClick.current = true;
      setTimeout(() => { skipClick.current = false; }, 0);
      if (!cancelled && dropRef.current) move(current.panel, dropRef.current.panel, dropRef.current.position);
    }
    clearDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const render = (node: DockNode): React.ReactNode => {
    if (node.type === 'split') {
      const firstMinimum = dockMinimum(node.first, Math.max(6, spacing));
      const secondMinimum = dockMinimum(node.second, Math.max(6, spacing));
      return <React.Fragment key={node.id}><ResizableSplit theme={theme} storageKey={`dock-${node.id}`} axis={node.axis}
        label={`Resize ${dockPanels(node.first).map(id => DOCK_PANELS[id]).join(', ')} and ${dockPanels(node.second).map(id => DOCK_PANELS[id]).join(', ')}`}
        value={node.ratio} defaultSize={50} spacing={spacing}
        minFirst={node.axis === 'row' ? firstMinimum.width : firstMinimum.height}
        minSecond={node.axis === 'row' ? secondMinimum.width : secondMinimum.height}
        onValueChange={(value, commit) => {
          if (editing && !resizeStart.current) resizeStart.current = layout;
          if (editing && commit && resizeStart.current) { remember(resizeStart.current); resizeStart.current = null; }
          onChange(resizeDockSplit(layout, node.id, value), commit);
        }} first={render(node.first)} second={render(node.second)} /></React.Fragment>;
    }
    const id = node.panel;
    return <section key={id} data-dock-panel={id} aria-label={`${DOCK_PANELS[id]} panel`}
      className="dock-panel skin-panel min-h-0 min-w-0 flex flex-1 flex-col" data-picked={picked === id}
      data-drop={drop?.panel === id ? drop.position : undefined}>
      {editing && <div className="dock-panel-heading flex shrink-0 items-center justify-between gap-1 border-b px-1 text-[11px]" style={panelStyle}>
        <button type="button" data-dock-grip={id} aria-label={`Move ${DOCK_PANELS[id]} panel`} aria-pressed={picked === id}
          aria-describedby="dock-layout-instructions" className="dock-grip flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1.5 text-left"
          onClick={() => { if (!skipClick.current) setPicked(value => value === id ? null : id); }}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { panel: id, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false };
          }}
          onPointerMove={event => {
            const current = dragRef.current;
            if (!current || current.pointer !== event.pointerId) return;
            if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
            current.active = true; setPicked(null);
            document.documentElement.dataset.layoutDragging = 'true';
            setDrag({ panel: id, x: event.clientX, y: event.clientY });
            const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-dock-panel]');
            const target = element?.dataset.dockPanel as DockPanelId | undefined;
            const next = element && rootRef.current?.contains(element) && target && target !== id
              ? { panel: target, position: dockDropPosition(event.clientX, event.clientY, element.getBoundingClientRect()) } : null;
            dropRef.current = next; setDrop(next);
          }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
          <GripVertical className="h-3.5 w-3.5 shrink-0" style={{ color: theme.accent }} /><span className="truncate">{DOCK_PANELS[id]}</span>
        </button>
        <button type="button" aria-label={`Hide ${DOCK_PANELS[id]} panel`} disabled={panels.length === 1}
          className="shrink-0 p-1 disabled:opacity-30" onClick={() => change(removeDockPanel(layout, id), `${DOCK_PANELS[id]} hidden. Add it back from the toolbar.`)}><X className="h-3 w-3" /></button>
      </div>}
      <div className="dock-panel-content flex min-h-0 min-w-0 flex-1 flex-col" inert={editing && id !== 'player'}>{renderPanel(id)}</div>
      {drop?.panel === id && <div className="dock-drop-preview pointer-events-none" aria-hidden="true" style={{ borderColor: theme.accent, backgroundColor: `${theme.accent}38` }} />}
      {editing && picked && picked !== id && !drag && <div className="dock-destinations" style={{ backgroundColor: 'var(--app-theme-bg)' }}>
        <span className="text-center text-[11px]">Move {DOCK_PANELS[picked]} here</span>
        <div className="flex flex-wrap items-center justify-center gap-1">
          {destinations.map(({ position, label, icon: Icon }) => <button key={position} type="button"
            aria-label={position === 'center' ? `Swap ${DOCK_PANELS[picked!]} with ${DOCK_PANELS[id]}` : `Place ${DOCK_PANELS[picked!]} ${label} ${DOCK_PANELS[id]}`}
            title={position === 'center' ? 'Swap panels' : `Place ${label}`} className="border p-2 hover:brightness-125"
            style={panelStyle} onClick={() => move(picked!, id, position)}><Icon className="h-4 w-4" /></button>)}
        </div>
      </div>}
    </section>;
  };

  return <div ref={rootRef} className="dock-workspace flex min-h-0 min-w-0 flex-1 flex-col" data-editing={editing}>
    {editing && <div className="dock-toolbar skin-panel flex shrink-0 flex-col gap-2 p-2 text-xs" style={panelStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold" style={{ color: theme.highlight }}>Edit layout</span>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label="Undo layout change" disabled={!past.length} className="border p-1.5 disabled:opacity-30" style={panelStyle} onClick={undo}><Undo2 className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Redo layout change" disabled={!future.length} className="border p-1.5 disabled:opacity-30" style={panelStyle} onClick={redo}><Redo2 className="h-3.5 w-3.5" /></button>
          <button type="button" className="flex items-center gap-1 border px-2 py-1.5" style={panelStyle}
            onClick={() => change(onReset(), 'Default layout restored. Save to keep it.')}><RotateCcw className="h-3 w-3" /> Reset layout</button>
          <button type="button" className="border px-2 py-1.5" style={panelStyle} onClick={onCancel}>Cancel layout</button>
          <button type="button" className="flex items-center gap-1 border px-2 py-1.5 font-bold" style={{ ...panelStyle, color: theme.accent, borderColor: theme.accent }} onClick={onSave}><Check className="h-3 w-3" /> Save layout</button>
        </div>
      </div>
      <p id="dock-layout-instructions" className="text-[11px]" style={{ color: theme.textDim }}>Drag a panel handle to an edge, or the center to swap. You can also click a handle and choose a destination. Drag dividers to resize.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px]" style={{ color: theme.textDim }}>Add panel:</span>
        {(Object.keys(DOCK_PANELS) as DockPanelId[]).filter(id => !panels.includes(id)).map(id => <button key={id} type="button"
          aria-label={`Add ${DOCK_PANELS[id]} panel`} className="flex items-center gap-1 border px-2 py-1" style={panelStyle}
          onClick={() => change(addDockPanel(layout, id), `${DOCK_PANELS[id]} added. Drag its handle to place it.`)}><Plus className="h-3 w-3" />{DOCK_PANELS[id]}</button>)}
        {panels.length === Object.keys(DOCK_PANELS).length && <span className="text-[11px]" style={{ color: theme.textDim }}>All panels are visible.</span>}
      </div>
    </div>}
    <div role="region" aria-label="Custom player layout" className="dock-tree flex min-h-0 min-w-0 flex-1"
      style={{ minHeight: editing ? dockMinimum(layout.root, Math.max(6, spacing)).height : undefined }}>{render(layout.root)}</div>
    {editing && <p role="status" className="shrink-0 px-1 text-[11px]" style={{ color: theme.textDim }}>{announcement || 'Your changes will be kept when you save the layout. Esc cancels.'}</p>}
    {drag && <div className="dock-drag-label fixed pointer-events-none z-[100] flex items-center gap-1.5 border px-3 py-2 text-xs"
      style={{ ...panelStyle, borderColor: theme.accent, left: Math.min(drag.x + 16, window.innerWidth - 130), top: Math.min(drag.y + 16, window.innerHeight - 40) }}><GripVertical className="h-3.5 w-3.5" />{DOCK_PANELS[drag.panel]}</div>}
  </div>;
}
