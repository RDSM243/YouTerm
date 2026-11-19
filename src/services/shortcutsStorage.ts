import type { ShortcutActionId, ShortcutBindings } from '../types';

const SHORTCUTS_KEY = 'youterm_shortcuts_v1';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
  defaults: readonly string[];
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: 'playPause', label: 'Play / Pause', description: 'Toggle Play / Pause audio stream', defaults: ['Space'] },
  { id: 'moveDown', label: 'Move down', description: 'Move cursor down in tracklist', defaults: ['j', 'ArrowDown'] },
  { id: 'moveUp', label: 'Move up', description: 'Move cursor up in tracklist', defaults: ['k', 'ArrowUp'] },
  { id: 'selectTrack', label: 'Play / Open', description: 'Play currently selected track / Open playlist', defaults: ['Enter'] },
  { id: 'nextTrack', label: 'Next track', description: 'Next track in queue', defaults: ['n'] },
  { id: 'prevTrack', label: 'Previous track', description: 'Previous track in queue', defaults: ['p'] },
  { id: 'toggleLike', label: 'Like track', description: 'Toggle Like / Favorite on current track', defaults: ['l'] },
  { id: 'focusSearch', label: 'Focus search', description: 'Focus instant Search bar', defaults: ['/'] },
  { id: 'switchFocus', label: 'Switch focus', description: 'Switch focus between Sidebar and Tracklist', defaults: ['Tab'] },
  { id: 'viewTracklist', label: 'Tracks view', description: 'Switch view: Tracks', defaults: ['1'] },
  { id: 'viewCover', label: 'Cover view', description: 'Switch view: Cover', defaults: ['2'] },
  { id: 'viewSplit', label: 'Split view', description: 'Switch view: Split', defaults: ['3'] },
  { id: 'viewVisualizer', label: 'Visualizer view', description: 'Switch view: Visualizer', defaults: ['4'] },
  { id: 'toggleShuffle', label: 'Shuffle', description: 'Toggle Shuffle mode (randomize queue)', defaults: ['s'] },
  { id: 'cycleRepeat', label: 'Repeat', description: 'Cycle Repeat mode (Off -> All -> One)', defaults: ['r'] },
  { id: 'toggleMute', label: 'Mute', description: 'Mute / Unmute audio volume', defaults: ['m'] },
  { id: 'volumeUp', label: 'Volume up', description: 'Volume Up by 5%', defaults: ['+'] },
  { id: 'volumeDown', label: 'Volume down', description: 'Volume Down by 5%', defaults: ['-'] },
  { id: 'seekBackward', label: 'Seek backward', description: 'Seek backward 5 seconds', defaults: ['['] },
  { id: 'seekForward', label: 'Seek forward', description: 'Seek forward 5 seconds', defaults: [']'] },
  { id: 'contextMenu', label: 'Context menu', description: 'Context menu for selected track (also Right-click / Menu)', defaults: ['Shift+F10'] },
  { id: 'importPlaylist', label: 'Import playlist', description: 'Import YouTube / YouTube Music playlist', defaults: ['i'] },
  { id: 'cycleTheme', label: 'Cycle theme', description: 'Cycle Unix color themes (Tokyo Night, Mint, Dracula...)', defaults: ['t'] },
  { id: 'openShortcuts', label: 'Shortcuts window', description: 'Open this Shortcuts window', defaults: ['?'] },
];

export const FIXED_SHORTCUT_NOTES: readonly { key: string; description: string }[] = [
  { key: 'Click & Drag', description: 'Drag and drop tracks to reorder in custom playlists' },
  { key: 'Drag divider', description: 'Resize the sidebar, artwork and lyrics panels. Double-click a divider to reset its size.' },
  { key: 'Esc', description: 'Close any active modal, cancel recording, or blur search' },
];

export const DEFAULT_SHORTCUTS: ShortcutBindings = SHORTCUT_DEFINITIONS.reduce((acc, def) => {
  acc[def.id] = [...def.defaults];
  return acc;
}, {} as ShortcutBindings);

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const IGNORED_KEYS = new Set([
  '', 'Control', 'Shift', 'Alt', 'Meta', 'AltGraph',
  'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Symbol', 'SymbolLock', 'Hyper', 'Super',
  'Dead', 'Process', 'Unidentified',
]);

export function cloneShortcuts(bindings: ShortcutBindings = DEFAULT_SHORTCUTS): ShortcutBindings {
  const result = {} as ShortcutBindings;
  for (const def of SHORTCUT_DEFINITIONS) {
    result[def.id] = [...bindings[def.id]];
  }
  return result;
}

export function cloneDefaultShortcuts(): ShortcutBindings {
  return cloneShortcuts(DEFAULT_SHORTCUTS);
}

function splitBinding(binding: string): { modifiers: string[]; base: string } | null {
  if (typeof binding !== 'string' || !binding || binding.length > 40 || /[\u0000-\u001f\u007f]/.test(binding)) {
    return null;
  }
  let rest = binding;
  const modifiers: string[] = [];
  for (const mod of MODIFIER_ORDER) {
    const prefix = `${mod}+`;
    if (rest.startsWith(prefix)) {
      modifiers.push(mod);
      rest = rest.slice(prefix.length);
    }
  }
  if (!rest) return null;
  // Reject leftover modifier prefixes out of canonical order or duplicate modifiers.
  for (const mod of MODIFIER_ORDER) {
    if (rest.startsWith(`${mod}+`)) return null;
  }
  if (rest === 'Escape' || IGNORED_KEYS.has(rest) || (MODIFIER_ORDER as readonly string[]).includes(rest)) return null;
  return { modifiers, base: rest };
}

export function isValidShortcutBinding(value: unknown): value is string {
  return typeof value === 'string' && splitBinding(value) !== null;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  getModifierState?: (keyArg: string) => boolean;
}

/**
 * Converts a KeyboardEvent into a canonical shortcut string (e.g. "Space", "Shift+F10", "Ctrl+k"),
 * or null if the key should be ignored (modifier-only, IME composition, repeat, or Escape).
 */
export function eventToShortcut(event: KeyEventLike): string | null {
  if (event.repeat || event.isComposing) return null;
  const rawKey = event.key;
  if (!rawKey || IGNORED_KEYS.has(rawKey) || rawKey === 'Escape') return null;

  const isAltGraph = typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');
  const ctrl = isAltGraph && rawKey.length === 1 ? false : Boolean(event.ctrlKey);
  const alt = isAltGraph && rawKey.length === 1 ? false : Boolean(event.altKey);
  const meta = Boolean(event.metaKey);

  // Non-alphanumeric printable characters (e.g. '?', '+', '!') already carry Shift in event.key.
  const isAlphanumeric = /^[a-zA-Z0-9]$/.test(rawKey);
  const isSpace = rawKey === ' ' || rawKey === 'Spacebar';
  const shift = Boolean(event.shiftKey) && (rawKey.length > 1 || isSpace || isAlphanumeric);

  let base: string;
  if (isSpace) {
    base = 'Space';
  } else if (/^[a-zA-Z]$/.test(rawKey)) {
    base = rawKey.toLowerCase();
  } else {
    base = rawKey;
  }

  const parts: string[] = [];
  if (ctrl) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  if (meta) parts.push('Meta');
  parts.push(base);
  return parts.join('+');
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ContextMenu: 'Menu',
  Space: 'Space',
};

export function formatShortcut(binding: string): string {
  const parsed = splitBinding(binding);
  if (!parsed) return binding;
  const { modifiers, base } = parsed;
  const baseLabel = KEY_LABELS[base] ?? (modifiers.length > 0 && /^[a-z]$/.test(base) ? base.toUpperCase() : base);
  return modifiers.length > 0 ? `${modifiers.join('+')}+${baseLabel}` : baseLabel;
}

export function formatActionShortcuts(keys: readonly string[]): string {
  return keys.map(formatShortcut).join(' / ');
}

export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result = {} as Record<ShortcutActionId, (string | null)[]>;
  const used = new Set<string>();

  for (const def of SHORTCUT_DEFINITIONS) {
    const rawList = Array.isArray(input[def.id]) ? input[def.id] as unknown[] : [];
    const slots: (string | null)[] = [];
    for (let i = 0; i < def.defaults.length; i++) {
      const candidate = rawList[i];
      if (isValidShortcutBinding(candidate) && !used.has(candidate)) {
        slots.push(candidate);
        used.add(candidate);
      } else {
        slots.push(null);
      }
    }
    result[def.id] = slots;
  }

  const allDefaultKeys = SHORTCUT_DEFINITIONS.flatMap(def => def.defaults);
  for (const def of SHORTCUT_DEFINITIONS) {
    const slots = result[def.id];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== null) continue;
      const preferred = def.defaults[i];
      const fill = !used.has(preferred)
        ? preferred
        : allDefaultKeys.find(candidate => !used.has(candidate))!;
      slots[i] = fill;
      used.add(fill);
    }
  }

  return result as ShortcutBindings;
}

export function loadShortcuts(): ShortcutBindings {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if (!raw) return cloneDefaultShortcuts();
    return normalizeShortcutBindings(JSON.parse(raw));
  } catch {
    return cloneDefaultShortcuts();
  }
}

export function saveShortcuts(bindings: ShortcutBindings): void {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(normalizeShortcutBindings(bindings)));
}

export function assignShortcutBinding(
  bindings: ShortcutBindings,
  actionId: ShortcutActionId,
  slotIndex: number,
  newKey: string,
): { next: ShortcutBindings; swappedWith?: { actionId: ShortcutActionId; slotIndex: number }; changed: boolean } {
  if (!isValidShortcutBinding(newKey)) {
    return { next: bindings, changed: false };
  }
  const currentSlots = bindings[actionId];
  if (!currentSlots || slotIndex < 0 || slotIndex >= currentSlots.length) {
    return { next: bindings, changed: false };
  }
  const oldKey = currentSlots[slotIndex];
  if (oldKey === newKey) {
    return { next: bindings, changed: false };
  }

  const next = cloneShortcuts(bindings);
  let swappedWith: { actionId: ShortcutActionId; slotIndex: number } | undefined;

  for (const def of SHORTCUT_DEFINITIONS) {
    const slots = next[def.id];
    for (let i = 0; i < slots.length; i++) {
      if (def.id === actionId && i === slotIndex) continue;
      if (slots[i] === newKey) {
        slots[i] = oldKey;
        if (def.id !== actionId) {
          swappedWith = { actionId: def.id, slotIndex: i };
        }
        break;
      }
    }
  }

  next[actionId][slotIndex] = newKey;
  return { next, swappedWith, changed: true };
}

export function resetActionShortcut(bindings: ShortcutBindings, actionId: ShortcutActionId): ShortcutBindings {
  const def = SHORTCUT_DEFINITIONS.find(item => item.id === actionId);
  if (!def) return bindings;
  let next = cloneShortcuts(bindings);
  for (let i = 0; i < def.defaults.length; i++) {
    next = assignShortcutBinding(next, actionId, i, def.defaults[i]).next;
  }
  return next;
}

export function isActionCustomized(bindings: ShortcutBindings, actionId: ShortcutActionId): boolean {
  const def = SHORTCUT_DEFINITIONS.find(item => item.id === actionId);
  if (!def) return false;
  const current = bindings[actionId];
  return def.defaults.some((key, index) => current[index] !== key);
}

export function hasCustomShortcuts(bindings: ShortcutBindings): boolean {
  return SHORTCUT_DEFINITIONS.some(def => isActionCustomized(bindings, def.id));
}

export function areShortcutsEqual(a: ShortcutBindings, b: ShortcutBindings): boolean {
  return SHORTCUT_DEFINITIONS.every(def =>
    def.defaults.every((_, index) => a[def.id][index] === b[def.id][index])
  );
}

export type ResolvedGlobalShortcut = ShortcutActionId | 'pageDown' | 'pageUp' | 'home' | 'end';

export function resolveGlobalShortcut(event: KeyEventLike, bindings: ShortcutBindings): ResolvedGlobalShortcut | null {
  const pressed = eventToShortcut(event);
  if (!pressed) return null;

  for (const def of SHORTCUT_DEFINITIONS) {
    if (bindings[def.id].includes(pressed)) {
      return def.id;
    }
  }

  // Compatibility aliases only apply when the target action keeps its default key and the alias isn't bound elsewhere.
  if (pressed === '=' && bindings.volumeUp.includes('+')) return 'volumeUp';
  if (pressed === 'h' && bindings.seekBackward.includes('[')) return 'seekBackward';
  if (pressed === 'ContextMenu') return 'contextMenu';
  if (pressed === 'PageDown') return 'pageDown';
  if (pressed === 'PageUp') return 'pageUp';
  if (pressed === 'Home') return 'home';
  if (pressed === 'End') return 'end';

  return null;
}
