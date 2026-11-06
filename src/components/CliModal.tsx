import React, { useState, useRef, useEffect } from 'react';
import { ThemeConfig, ThemeId, AsciiRenderMode } from '../types';
import { Terminal, Send, HelpCircle } from 'lucide-react';
import { THEMES } from '../data/themes';

interface CliModalProps {
  theme: ThemeConfig;
  onExecuteCommand: (command: string) => string;
  onClose: () => void;
}

export const CliModal: React.FC<CliModalProps> = ({
  theme,
  onExecuteCommand,
  onClose,
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ cmd: string; output: string }[]>([
    { cmd: 'help', output: 'ytmusic-tui command interface initialized. Type :help for a list of commands.' },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCmd = input.trim();
    if (!cleanCmd) return;

    if (cleanCmd.toLowerCase() === 'clear' || cleanCmd.toLowerCase() === ':clear') {
      setHistory([]);
      setInput('');
      return;
    }

    if (cleanCmd.toLowerCase() === 'exit' || cleanCmd.toLowerCase() === ':q' || cleanCmd.toLowerCase() === ':quit') {
      onClose();
      return;
    }

    const output = onExecuteCommand(cleanCmd);
    setHistory((prev) => [...prev, { cmd: cleanCmd, output }]);
    setInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none">
      <div
        className="w-full max-w-2xl border p-4 shadow-2xl relative flex flex-col gap-3 text-xs h-[480px]"
        style={{
          borderColor: theme.accent,
          backgroundColor: '#070a0c',
          boxShadow: `0 0 35px ${theme.accentGlow}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.border }}>
          <div className="flex items-center gap-2 font-bold" style={{ color: theme.highlight }}>
            <Terminal className="w-4 h-4" style={{ color: theme.accent }} />
            <span>┌─ ytmusic-tui Interactive Unix CLI ─</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc / Exit]
          </button>
        </div>

        {/* Terminal Output Stream */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar font-mono text-xs">
          {history.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2">
                <span style={{ color: theme.accent }}>{theme.promptSymbol}</span>
                <span className="font-bold" style={{ color: theme.highlight }}>
                  {item.cmd}
                </span>
              </div>
              <div className="pl-4 whitespace-pre-wrap leading-5" style={{ color: theme.text }}>
                {item.output}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Command Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t pt-2" style={{ borderColor: theme.border }}>
          <span className="font-bold" style={{ color: theme.accent }}>
            {theme.promptSymbol}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. :play Daft Punk, :theme nord, :volume 80, :like, :help"
            className="flex-1 bg-transparent outline-none font-mono text-xs"
            style={{ color: theme.highlight }}
          />
          <button
            type="submit"
            className="px-2.5 py-1 border hover:brightness-125 font-bold"
            style={{ borderColor: theme.accent, backgroundColor: theme.cardBg, color: theme.accent }}
          >
            [Enter]
          </button>
        </form>
      </div>
    </div>
  );
};
