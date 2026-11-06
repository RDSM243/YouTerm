import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ThemeConfig } from '../types';

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: React.ElementType;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a check mark (toggle / membership state). */
  checked?: boolean;
  separator?: boolean;
  /** Non-interactive section label. */
  header?: string;
  onSelect?: () => void;
  children?: ContextMenuItem[];
}

export interface ContextMenuState {
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  theme: ThemeConfig;
  menu: ContextMenuState;
  onClose: () => void;
}

const MARGIN = 6;

const isSelectable = (item: ContextMenuItem) => !item.separator && !item.header && !item.disabled;

function selectableIndexes(items: ContextMenuItem[]): number[] {
  return items.flatMap((item, index) => (isSelectable(item) ? [index] : []));
}

function stepIndex(items: ContextMenuItem[], current: number, delta: 1 | -1): number {
  const indexes = selectableIndexes(items);
  if (indexes.length === 0) return -1;
  const pos = indexes.indexOf(current);
  if (pos === -1) return delta === 1 ? indexes[0] : indexes[indexes.length - 1];
  return indexes[(pos + delta + indexes.length) % indexes.length];
}

type Anchor = { x: number; y: number } | { rect: DOMRect };

interface PanelProps {
  theme: ThemeConfig;
  items: ContextMenuItem[];
  depth: number;
  highlight: number;
  anchor: Anchor;
  title?: string;
  onHover: (depth: number, index: number) => void;
  onActivate: (depth: number, index: number) => void;
  registerItem: (depth: number, index: number, el: HTMLElement | null) => void;
}

const MenuPanel: React.FC<PanelProps> = ({ theme, items, depth, highlight, anchor, title, onHover, onActivate, registerItem }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if ('rect' in anchor) {
      left = anchor.rect.right - 2;
      if (left + w > vw - MARGIN) left = anchor.rect.left - w + 2;
      top = anchor.rect.top - 4;
    } else {
      left = anchor.x;
      top = anchor.y;
      if (left + w > vw - MARGIN) left = anchor.x - w;
    }
    top = Math.min(top, vh - h - MARGIN);
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [anchor, items]);

  // Keep the highlighted row visible inside long (scrollable) menus.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed font-mono text-xs border shadow-2xl overflow-y-auto custom-scrollbar select-none"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        minWidth: 208,
        maxWidth: 340,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
        backgroundColor: theme.cardBg,
        borderColor: theme.accent,
        color: theme.text,
        boxShadow: `0 0 18px ${theme.accentGlow}, 0 8px 24px rgba(0,0,0,0.6)`,
        zIndex: 100 + depth,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {title && (
        <div
          className="px-3 py-1 border-b truncate text-[10px] uppercase tracking-wider"
          style={{ borderColor: theme.border, color: theme.textDim }}
        >
          ┌─ {title} ─
        </div>
      )}
      <div className="py-1">
        {items.map((item, index) => {
          if (item.separator) {
            return <div key={item.id} role="separator" className="my-1 border-t" style={{ borderColor: theme.border }} />;
          }
          if (item.header) {
            return (
              <div key={item.id} className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider" style={{ color: theme.textDim }}>
                {item.header}
              </div>
            );
          }
          const active = index === highlight;
          const Icon = item.icon;
          const color = item.disabled
            ? theme.textDim
            : item.danger
            ? theme.error
            : active
            ? theme.highlight
            : theme.text;
          return (
            <div
              key={item.id}
              ref={(el) => registerItem(depth, index, el)}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              aria-haspopup={item.children ? 'menu' : undefined}
              data-active={active}
              onMouseEnter={() => !item.disabled && onHover(depth, index)}
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) onActivate(depth, index);
              }}
              className="flex items-center gap-2 px-2 py-1 whitespace-nowrap"
              style={{
                color,
                opacity: item.disabled ? 0.45 : 1,
                cursor: item.disabled ? 'default' : 'pointer',
                backgroundColor: active ? `${theme.highlight}26` : 'transparent',
              }}
            >
              <span className="w-3 text-center flex-shrink-0" style={{ color: theme.accent }}>
                {item.checked ? '✓' : active ? '›' : ''}
              </span>
              {Icon ? <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: item.danger ? theme.error : theme.accent }} /> : <span className="w-3.5" />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="text-[10px] ml-3" style={{ color: theme.textDim }}>
                  {item.hint}
                </span>
              )}
              {item.children && <span style={{ color: theme.textDim }}>▸</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Themed, keyboard-navigable context menu with nested submenus.
 * Arrow keys navigate, Right/Enter opens a submenu, Left/Esc goes back, Enter activates.
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ theme, menu, onClose }) => {
  // path[d] = highlighted index at depth d; its length is the number of open levels.
  const [path, setPath] = useState<number[]>([-1]);
  const itemEls = useRef(new Map<string, HTMLElement>());

  const itemsAt = useCallback(
    (depth: number, currentPath: number[]): ContextMenuItem[] => {
      let items = menu.items;
      for (let d = 0; d < depth; d++) items = items[currentPath[d]]?.children ?? [];
      return items;
    },
    [menu.items]
  );

  const activate = useCallback(
    (depth: number, index: number, currentPath: number[]) => {
      const item = itemsAt(depth, currentPath)[index];
      if (!item || !isSelectable(item)) return;
      if (item.children) {
        setPath([...currentPath.slice(0, depth), index, stepIndex(item.children, -1, 1)]);
        return;
      }
      onClose();
      item.onSelect?.();
    },
    [itemsAt, onClose]
  );

  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const current = pathRef.current;
      const depth = current.length - 1;
      const items = itemsAt(depth, current);
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      switch (e.key) {
        case 'Escape':
          handled();
          if (depth > 0) setPath(current.slice(0, -1));
          else onClose();
          break;
        case 'ArrowDown':
          handled();
          setPath([...current.slice(0, -1), stepIndex(items, current[depth], 1)]);
          break;
        case 'ArrowUp':
          handled();
          setPath([...current.slice(0, -1), stepIndex(items, current[depth], -1)]);
          break;
        case 'Home':
          handled();
          setPath([...current.slice(0, -1), stepIndex(items, -1, 1)]);
          break;
        case 'End':
          handled();
          setPath([...current.slice(0, -1), stepIndex(items, -1, -1)]);
          break;
        case 'ArrowRight':
          handled();
          if (items[current[depth]]?.children) activate(depth, current[depth], current);
          break;
        case 'ArrowLeft':
          handled();
          if (depth > 0) setPath(current.slice(0, -1));
          break;
        case 'Enter':
        case ' ':
          handled();
          if (current[depth] >= 0) activate(depth, current[depth], current);
          break;
        case 'Tab':
          handled();
          break;
        default:
          // Menu is modal: swallow shortcuts so j/k/space don't act on the page behind it.
          if (!e.ctrlKey && !e.metaKey && !e.altKey) handled();
      }
    };
    // Capture phase so the global shortcut handler never sees keys while the menu is open.
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [itemsAt, activate, onClose]);

  const registerItem = useCallback((depth: number, index: number, el: HTMLElement | null) => {
    const key = `${depth}:${index}`;
    if (el) itemEls.current.set(key, el);
    else itemEls.current.delete(key);
  }, []);

  const handleHover = useCallback(
    (depth: number, index: number) => {
      const item = itemsAt(depth, pathRef.current)[index];
      if (!item) return;
      const base = pathRef.current.slice(0, depth);
      setPath(item.children ? [...base, index, -1] : [...base, index]);
    },
    [itemsAt]
  );

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 99 }}
      onMouseDown={onClose}
      onWheel={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div onMouseDown={(e) => e.stopPropagation()}>
        {path.map((highlight, depth) => {
          const items = itemsAt(depth, path);
          let anchor: Anchor = { x: menu.x, y: menu.y };
          if (depth > 0) {
            const parentEl = itemEls.current.get(`${depth - 1}:${path[depth - 1]}`);
            if (!parentEl) return null;
            anchor = { rect: parentEl.getBoundingClientRect() };
          }
          return (
            <MenuPanel
              key={depth}
              theme={theme}
              items={items}
              depth={depth}
              highlight={highlight}
              anchor={anchor}
              title={depth === 0 ? menu.title : undefined}
              onHover={handleHover}
              onActivate={(d, i) => activate(d, i, pathRef.current)}
              registerItem={registerItem}
            />
          );
        })}
      </div>
    </div>
  );
};
