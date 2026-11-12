import type { DockLayout, DockNode, DockPanelId, DockPosition, SkinConfig, TuiViewMode } from '../types';

export const DOCK_PANELS: Record<DockPanelId, string> = {
  sidebar: 'Library', tracks: 'Tracks', artwork: 'Artwork', lyrics: 'Lyrics', spectrum: 'Spectrum', player: 'Playback',
};
const panel = (id: DockPanelId): DockNode => ({ type: 'panel', panel: id });
const split = (axis: 'row' | 'column', first: DockNode, second: DockNode, ratio = 50): DockNode => ({
  type: 'split', id: `split_${crypto.randomUUID()}`, axis, ratio, first, second,
});

export function dockPanels(node: DockNode): DockPanelId[] {
  return node.type === 'panel' ? [node.panel] : [...dockPanels(node.first), ...dockPanels(node.second)];
}

export function createDockLayout(mode: TuiViewMode, skin: Pick<SkinConfig, 'sidebar' | 'playerPosition'>, showSidebar = true): DockLayout {
  let content = mode === 'ascii_cover' ? panel('artwork') : mode === 'visualizer' ? panel('spectrum')
    : mode === 'tracklist' ? panel('tracks') : split('row', panel('tracks'), split('row', panel('artwork'), panel('lyrics'), 55), 44);
  if (showSidebar && skin.sidebar !== 'hidden') {
    content = skin.sidebar === 'right' ? split('row', content, panel('sidebar'), 78) : split('row', panel('sidebar'), content, 22);
  }
  return { version: 1, root: skin.playerPosition === 'top'
    ? split('column', panel('player'), content, 16) : split('column', content, panel('player'), 84) };
}

export function normalizeDockLayout(value: unknown): DockLayout | null {
  if (!value || typeof value !== 'object' || (value as DockLayout).version !== 1) return null;
  const panels = new Set<DockPanelId>();
  const ids = new Set<string>();
  let visited = 0;
  const read = (value: unknown, depth: number): DockNode | null => {
    if (!value || typeof value !== 'object' || depth > 12 || ++visited > 40) return null;
    const input = value as Record<string, unknown>;
    if (input.type === 'panel') {
      if (typeof input.panel !== 'string') return null;
      const id = input.panel as DockPanelId;
      if (!Object.hasOwn(DOCK_PANELS, id) || panels.has(id)) return null;
      panels.add(id);
      return panel(id);
    }
    if (input.type !== 'split' || (input.axis !== 'row' && input.axis !== 'column')) return null;
    const first = read(input.first, depth + 1);
    const second = read(input.second, depth + 1);
    if (!first) return second;
    if (!second) return first;
    let id = typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ? input.id : `recovered_${visited}`;
    while (ids.has(id)) id = `recovered_${++visited}`;
    ids.add(id);
    return { type: 'split', id, axis: input.axis, first, second,
      ratio: typeof input.ratio === 'number' && Number.isFinite(input.ratio) ? Math.max(10, Math.min(90, input.ratio)) : 50 };
  };
  const root = read((value as DockLayout).root, 0);
  return root ? { version: 1, root } : null;
}

function mapNode(node: DockNode, fn: (node: DockNode) => DockNode): DockNode {
  const mapped = node.type === 'split' ? { ...node, first: mapNode(node.first, fn), second: mapNode(node.second, fn) } : node;
  return fn(mapped);
}

function removeNode(node: DockNode, id: DockPanelId): DockNode | null {
  if (node.type === 'panel') return node.panel === id ? null : node;
  const first = removeNode(node.first, id);
  const second = removeNode(node.second, id);
  return first && second ? { ...node, first, second } : first || second;
}

export function removeDockPanel(layout: DockLayout, id: DockPanelId): DockLayout {
  const root = removeNode(layout.root, id);
  return root ? { ...layout, root } : layout;
}

function insertNode(root: DockNode, source: DockPanelId, target: DockPanelId, position: Exclude<DockPosition, 'center'>): DockNode {
  return mapNode(root, node => {
    if (node.type !== 'panel' || node.panel !== target) return node;
    const before = position === 'left' || position === 'top';
    return split(position === 'left' || position === 'right' ? 'row' : 'column',
      before ? panel(source) : node, before ? node : panel(source));
  });
}

export function moveDockPanel(layout: DockLayout, source: DockPanelId, target: DockPanelId, position: DockPosition): DockLayout {
  const panels = dockPanels(layout.root);
  if (source === target || !panels.includes(source) || !panels.includes(target)) return layout;
  if (position === 'center') return { ...layout, root: mapNode(layout.root, node => node.type !== 'panel' ? node
    : panel(node.panel === source ? target : node.panel === target ? source : node.panel)) };
  const root = removeNode(layout.root, source);
  return root ? { ...layout, root: insertNode(root, source, target, position) } : layout;
}

export function addDockPanel(layout: DockLayout, id: DockPanelId): DockLayout {
  const panels = dockPanels(layout.root);
  if (panels.includes(id)) return layout;
  // Keep the usual sidebar and player proportions when adding them back.
  return { ...layout, root: id === 'player' ? split('column', layout.root, panel(id), 80)
    : id === 'sidebar' ? split('row', panel(id), layout.root, 22) : split('row', layout.root, panel(id), 65) };
}

export function resizeDockSplit(layout: DockLayout, id: string, ratio: number): DockLayout {
  if (!Number.isFinite(ratio)) return layout;
  return { ...layout, root: mapNode(layout.root, node => node.type === 'split' && node.id === id
    ? { ...node, ratio: Math.max(10, Math.min(90, ratio)) } : node) };
}

export function dockMinimum(node: DockNode, spacing = 6): { width: number; height: number } {
  if (node.type === 'panel') return { width: node.panel === 'player' ? 240 : node.panel === 'tracks' ? 240 : 160, height: 100 };
  const first = dockMinimum(node.first, spacing);
  const second = dockMinimum(node.second, spacing);
  return node.axis === 'row' ? { width: first.width + spacing + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + spacing + second.height };
}

export function dockDropPosition(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): DockPosition {
  const horizontal = (x - rect.left) / Math.max(1, rect.width);
  const vertical = (y - rect.top) / Math.max(1, rect.height);
  if (horizontal > 0.25 && horizontal < 0.75 && vertical > 0.25 && vertical < 0.75) return 'center';
  const distances = { left: horizontal, right: 1 - horizontal, top: vertical, bottom: 1 - vertical };
  return (Object.entries(distances) as [Exclude<DockPosition, 'center'>, number][]).sort((a, b) => a[1] - b[1])[0][0];
}
