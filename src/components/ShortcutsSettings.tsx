import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import type { ShortcutActionId, ShortcutBindings, ThemeConfig } from '../types';
import {
  assignShortcutBinding,
  cloneDefaultShortcuts,
  eventToShortcut,
  FIXED_SHORTCUT_NOTES,
  formatShortcut,
  hasCustomShortcuts,
  isActionCustomized,
  resetActionShortcut,
  SHORTCUT_DEFINITIONS,
} from '../services/shortcutsStorage';

interface ShortcutsSettingsProps {
  theme: ThemeConfig;
  shortcuts: ShortcutBindings;
  onChangeShortcuts: (next: ShortcutBindings) => void;
  onRecordingChange?: (recording: boolean) => void;
}

interface RecordingTarget {
  actionId: ShortcutActionId;
  slotIndex: number;
}

const IGNORED_MODIFIER_KEYS = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'AltGraph',
  'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Symbol', 'SymbolLock', 'Hyper', 'Super',
]);

export const ShortcutsSettings: React.FC<ShortcutsSettingsProps> = ({
  theme,
  shortcuts,
  onChangeShortcuts,
  onRecordingChange,
}) => {
  const [recording, setRecording] = useState<RecordingTarget | null>(null);
  const [undoStack, setUndoStack] = useState<ShortcutBindings[]>([]);
  const [status, setStatus] = useState('');

  const customized = hasCustomShortcuts(shortcuts);
  const canUndo = undoStack.length > 0;
  const recordingDef = recording ? SHORTCUT_DEFINITIONS.find(item => item.id === recording.actionId) : null;

  const stopRecording = useCallback(() => {
    onRecordingChange?.(false);
    setRecording(null);
  }, [onRecordingChange]);

  const startRecording = (actionId: ShortcutActionId, slotIndex: number) => {
    if (recording?.actionId === actionId && recording.slotIndex === slotIndex) {
      stopRecording();
      setStatus('Shortcut edit cancelled.');
      return;
    }
    onRecordingChange?.(true);
    setRecording({ actionId, slotIndex });
    setStatus('');
  };

  useEffect(() => () => { onRecordingChange?.(false); }, [onRecordingChange]);

  useEffect(() => {
    if (!recording) return;
    onRecordingChange?.(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (IGNORED_MODIFIER_KEYS.has(event.key)) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        stopRecording();
        setStatus('Shortcut edit cancelled.');
        return;
      }

      const pressed = eventToShortcut(event);
      if (!pressed) return;

      const targetDef = SHORTCUT_DEFINITIONS.find(item => item.id === recording.actionId);
      const result = assignShortcutBinding(shortcuts, recording.actionId, recording.slotIndex, pressed);
      stopRecording();

      if (!result.changed) {
        setStatus(`Shortcut kept as ${formatShortcut(pressed)}.`);
        return;
      }

      try {
        onChangeShortcuts(result.next);
        setUndoStack(prev => [...prev.slice(-49), shortcuts]);
        if (result.swappedWith) {
          const swappedDef = SHORTCUT_DEFINITIONS.find(item => item.id === result.swappedWith!.actionId);
          setStatus(
            `Updated "${targetDef?.label}" to ${formatShortcut(pressed)} (swapped with "${swappedDef?.label}").`
          );
        } else {
          setStatus(`Updated "${targetDef?.label}" to ${formatShortcut(pressed)}.`);
        }
      } catch {
        setStatus('Shortcuts could not be saved. Check available storage space.');
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-shortcut-key-btn]')) return;
      stopRecording();
      setStatus('Shortcut edit cancelled.');
    };

    const handleBlur = () => {
      stopRecording();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [recording, shortcuts, onChangeShortcuts, onRecordingChange, stopRecording]);

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    try {
      onChangeShortcuts(previous);
      setUndoStack(prev => prev.slice(0, -1));
      setStatus('Reverted to previous shortcut.');
    } catch {
      setStatus('Could not revert shortcut change.');
    }
  };

  const handleResetAction = (actionId: ShortcutActionId) => {
    const def = SHORTCUT_DEFINITIONS.find(item => item.id === actionId);
    const next = resetActionShortcut(shortcuts, actionId);
    try {
      onChangeShortcuts(next);
      setUndoStack(prev => [...prev.slice(-49), shortcuts]);
      setStatus(`Reset "${def?.label}" to default.`);
    } catch {
      setStatus('Could not reset shortcut.');
    }
  };

  const handleResetAll = () => {
    try {
      onChangeShortcuts(cloneDefaultShortcuts());
      setUndoStack(prev => [...prev.slice(-49), shortcuts]);
      setStatus('All shortcuts reset to defaults.');
    } catch {
      setStatus('Could not reset shortcuts.');
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs" style={{ color: theme.text }}>
      {/* Action / Status Toolbar */}
      <div
        className="flex min-h-[38px] flex-wrap items-center justify-between gap-2 border px-3 py-1.5"
        style={{
          borderColor: recording ? theme.warning : theme.border,
          backgroundColor: theme.bg,
        }}
      >
        <p
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 text-[11px]"
          style={{
            color: recording ? theme.warning : status ? theme.accent : theme.textDim,
          }}
        >
          {recording && recordingDef
            ? `Press a new key for "${recordingDef.label}" (Esc to cancel)...`
            : status || 'Click any key badge to edit its shortcut.'}
        </p>

        {(canUndo || customized) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {canUndo && (
              <button
                type="button"
                onClick={handleUndo}
                aria-label="Revert to previous shortcut"
                title="Revert to previous shortcut"
                className="flex h-7 w-7 items-center justify-center border hover:brightness-125"
                style={{
                  borderColor: theme.accent,
                  backgroundColor: theme.cardBg,
                  color: theme.accent,
                }}
              >
                <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
            {customized && (
              <button
                type="button"
                onClick={handleResetAll}
                aria-label="Reset all shortcuts to defaults"
                title="Reset all shortcuts to defaults"
                className="flex h-7 items-center gap-1.5 border px-2.5 text-[11px] hover:brightness-125"
                style={{
                  borderColor: theme.border,
                  backgroundColor: theme.cardBg,
                  color: theme.text,
                }}
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" style={{ color: theme.accent }} />
                <span>Reset all</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Editable Shortcuts Grid */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {SHORTCUT_DEFINITIONS.map((def) => {
          const keys = shortcuts[def.id];
          const isModified = isActionCustomized(shortcuts, def.id);
          const defaultHint = def.defaults.map(formatShortcut).join(' / ');

          return (
            <div
              key={def.id}
              className="flex flex-wrap items-center justify-between gap-2 border p-2"
              style={{
                borderColor: isModified ? theme.accent : theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {keys.map((key, slotIndex) => {
                  const isRecordingThis =
                    recording?.actionId === def.id && recording.slotIndex === slotIndex;
                  const keyLabel = formatShortcut(key);
                  const refKey = `${def.id}:${slotIndex}`;

                  return (
                    <React.Fragment key={refKey}>
                      {slotIndex > 0 && (
                        <span className="text-[10px]" style={{ color: theme.textDim }} aria-hidden="true">/</span>
                      )}
                      <button
                        type="button"
                        data-shortcut-key-btn=""
                        aria-pressed={isRecordingThis}
                        aria-label={`Edit ${def.label} shortcut${keys.length > 1 ? ` (${slotIndex + 1})` : ''}: ${keyLabel}`}
                        title={isRecordingThis ? 'Press any key (Esc to cancel)' : `Click to edit "${def.label}" (${keyLabel})`}
                        onClick={() => startRecording(def.id, slotIndex)}
                        className={`min-h-[24px] min-w-[24px] border px-1.5 py-0.5 font-bold text-[11px] hover:brightness-125 ${
                          isRecordingThis ? 'animate-pulse' : ''
                        }`}
                        style={
                          isRecordingThis
                            ? {
                                borderColor: theme.warning,
                                color: theme.warning,
                                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                              }
                            : {
                                borderColor: theme.accent,
                                color: theme.highlight,
                                backgroundColor: 'rgba(255,255,255,0.04)',
                              }
                        }
                      >
                        {isRecordingThis ? 'Press key…' : keyLabel}
                      </button>
                    </React.Fragment>
                  );
                })}

                {isModified && (
                  <button
                    type="button"
                    onClick={() => handleResetAction(def.id)}
                    aria-label={`Reset ${def.label} shortcut to default (${defaultHint})`}
                    title={`Reset to default (${defaultHint})`}
                    className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center border hover:brightness-125"
                    style={{
                      borderColor: theme.border,
                      backgroundColor: theme.cardBg,
                      color: theme.accent,
                    }}
                  >
                    <RotateCcw aria-hidden="true" className="h-3 w-3" />
                  </button>
                )}
              </div>

              <span className="min-w-0 flex-1 text-right text-[11px]" style={{ color: theme.text }}>
                {def.description}
              </span>
            </div>
          );
        })}
      </div>

      {/* Fixed Mouse & System Controls */}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: theme.border }}>
        <span className="text-[11px] font-bold" style={{ color: theme.textDim }}>
          Mouse gestures & fixed controls
        </span>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {FIXED_SHORTCUT_NOTES.map((item) => (
            <div
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 border p-2 opacity-80"
              style={{
                borderColor: theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <span
                className="shrink-0 border px-1.5 py-0.5 font-bold text-[11px]"
                style={{
                  borderColor: theme.border,
                  color: theme.textDim,
                  backgroundColor: 'rgba(255,255,255,0.02)',
                }}
              >
                {item.key}
              </span>
              <span className="min-w-0 flex-1 text-right text-[11px]" style={{ color: theme.textDim }}>
                {item.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
