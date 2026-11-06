import React, { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { FolderPlus, X } from 'lucide-react';

interface CreatePlaylistModalProps {
  theme: ThemeConfig;
  defaultName?: string;
  defaultDescription?: string;
  /** Header label, e.g. "Create New Playlist" or "Rename Playlist". */
  heading?: string;
  helpText?: string;
  confirmLabel?: string;
  onConfirm: (name: string, description?: string) => void;
  onClose: () => void;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  theme,
  defaultName = 'My Playlist',
  defaultDescription = '',
  heading = 'Create New Playlist',
  helpText = 'Organize your favorite YouTube Music tracks into a custom local playlist.',
  confirmLabel = 'Create Playlist',
  onConfirm,
  onClose,
}) => {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, description.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 font-mono select-none">
      <div
        className="w-full max-w-md border p-5 shadow-2xl relative flex flex-col gap-4 text-xs"
        style={{
          borderColor: theme.accent,
          backgroundColor: theme.cardBg,
          boxShadow: `0 0 28px ${theme.accentGlow}`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b pb-2"
          style={{ borderColor: theme.border }}
        >
          <div className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <FolderPlus className="w-4 h-4" style={{ color: theme.accent }} />
            <span>┌─ {heading} ─────────────────────────┐</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border text-[11px]"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc]
          </button>
        </div>

        <p className="text-[11px]" style={{ color: theme.textDim }}>
          {helpText}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {/* Name Field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: theme.textDim }}>
              Playlist Name:
            </label>
            <div
              className="flex items-center border px-2 py-1.5 gap-2"
              style={{ borderColor: theme.border, backgroundColor: theme.bg }}
            >
              <span className="font-bold select-none" style={{ color: theme.accent }}>
                &gt;
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playlist name..."
                maxLength={80}
                className="w-full bg-transparent outline-none font-mono text-xs"
                style={{ color: theme.highlight }}
                autoFocus
                required
              />
            </div>
          </div>

          {/* Description Field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: theme.textDim }}>
              Description (Optional):
            </label>
            <div
              className="flex items-center border px-2 py-1.5 gap-2"
              style={{ borderColor: theme.border, backgroundColor: theme.bg }}
            >
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Synthwave for coding..."
                maxLength={120}
                className="w-full bg-transparent outline-none font-mono text-xs"
                style={{ color: theme.text }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: theme.border }}>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border hover:opacity-80 transition-opacity font-mono text-xs"
              style={{ borderColor: theme.border, color: theme.textDim }}
            >
              [ Cancel ]
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3.5 py-1 border hover:brightness-125 transition-all font-bold font-mono text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              style={{
                borderColor: theme.accent,
                backgroundColor: theme.accent,
                color: '#000000',
              }}
            >
              <span>[ {confirmLabel} ]</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
