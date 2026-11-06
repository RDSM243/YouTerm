import React from 'react';
import { ThemeConfig } from '../types';
import { HelpCircle } from 'lucide-react';

interface HelpModalProps {
  theme: ThemeConfig;
  onClose: () => void;
  embedded?: boolean;
}

export const HelpModal: React.FC<HelpModalProps> = ({ theme, onClose, embedded = false }) => {
  const shortcuts = [
    { key: 'Space', desc: 'Toggle Play / Pause audio stream' },
    { key: 'j / ↓', desc: 'Move cursor down in tracklist' },
    { key: 'k / ↑', desc: 'Move cursor up in tracklist' },
    { key: 'Enter', desc: 'Play currently selected track / Open playlist' },
    { key: 'n', desc: 'Next track in queue' },
    { key: 'p', desc: 'Previous track in queue' },
    { key: 'l', desc: 'Toggle Like / Favorite on current track' },
    { key: '/', desc: 'Focus instant Search bar' },
    { key: 'Tab', desc: 'Switch focus between Sidebar and Tracklist' },
    { key: '1 - 4', desc: 'Switch views: 1=Tracks, 2=Cover, 3=Split, 4=Visualizer' },
    { key: 's', desc: 'Toggle Shuffle mode (randomize queue)' },
    { key: 'r', desc: 'Cycle Repeat mode (Off -> All -> One)' },
    { key: 'm', desc: 'Mute / Unmute audio volume' },
    { key: '+ / -', desc: 'Volume Up / Down by 5%' },
    { key: '[ / ]', desc: 'Seek backward / forward 5 seconds' },
    { key: 'Right-click / Menu / Shift+F10', desc: 'Context menu: play next, queue, add/remove from playlist, copy link and more' },
    { key: 'Click & Drag', desc: 'Drag and drop tracks to reorder in custom playlists' },
    { key: 't', desc: 'Cycle Unix color themes (Tokyo Night, Mint, CRT Green, Amber, Dracula, Nord...)' },
    { key: '?', desc: 'Toggle this Help & Keybindings window' },
    { key: 'Esc', desc: 'Close any active modal or return to tracklist' },
  ];

  return (
    <div className={embedded ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none'}>
      <div
        className={embedded ? 'flex flex-col gap-4 text-xs' : 'w-full max-w-2xl border p-5 shadow-2xl relative flex flex-col gap-4 text-xs max-h-[90vh] overflow-hidden'}
        style={embedded ? { color: theme.text } : {
          borderColor: theme.warning,
          backgroundColor: theme.cardBg,
          boxShadow: `0 0 30px rgba(245, 158, 11, 0.2)`,
        }}
      >
        {/* Header */}
        {!embedded && <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.border }}>
          <div className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <HelpCircle className="w-4 h-4" style={{ color: theme.warning }} />
            <span>┌─ YouTerm Keyboard Shortcuts & Manual ─</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc / Close]
          </button>
        </div>}

        {/* Shortcuts Grid */}
        <div className={embedded ? '' : 'flex-1 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar'}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {shortcuts.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 border"
                style={{
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                }}
              >
                <span
                  className="px-1.5 py-0.5 border font-bold text-[11px]"
                  style={{
                    borderColor: theme.accent,
                    color: theme.highlight,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {item.key}
                </span>
                <span className="text-[11px] text-right pl-2" style={{ color: theme.text }}>
                  {item.desc}
                </span>
              </div>
            ))}
          </div>
        </div>

        {!embedded && <div className="flex justify-end pt-2 border-t" style={{ borderColor: theme.border }}>
          <button
            onClick={onClose}
            className="px-4 py-1 border font-bold hover:brightness-125"
            style={{
              borderColor: theme.accent,
              backgroundColor: theme.cardBg,
              color: theme.highlight,
            }}
          >
            Got it [Esc]
          </button>
        </div>}
      </div>
    </div>
  );
};
