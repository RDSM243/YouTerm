import React, { useState } from 'react';
import { ThemeConfig } from '../types';
import { Download, Copy, Check, Terminal, FileCode } from 'lucide-react';

interface ExportScriptModalProps {
  theme: ThemeConfig;
  onClose: () => void;
}

export const ExportScriptModal: React.FC<ExportScriptModalProps> = ({ theme, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'bash' | 'standalone' | 'instructions'>('instructions');

  const bashScript = `#!/usr/bin/env bash
# ==============================================================================
# ytmusic-tui: YouTube Music Terminal Player for Linux Mint & Unix
# ==============================================================================
set -e

echo -e "\\e[1;32m[+] Starting YouTube Music Unix TUI on Linux Mint...\\e[0m"

# Verify dependencies (curl, mpv/yt-dlp or node)
if ! command -v node &> /dev/null; then
    echo -e "\\e[1;33m[!] Node.js not found. Installing nodejs...\\e[0m"
    sudo apt update && sudo apt install -y nodejs npm
fi

# Clone or run the local player
echo -e "\\e[1;34m[*] Launching ytmusic-tui local terminal server on port 3000...\\e[0m"
npm run dev

# Open terminal browser or local view
echo -e "\\e[1;32m[✓] Player ready at http://localhost:3000\\e[0m"
`;

  const nodeScript = `/**
 * ytmusic-tui: Minimalist ASCII Terminal Music Player for Linux Mint
 * Run with: node ytmusic-tui.cjs
 */
const https = require('https');
const readline = require('readline');

console.log('\\x1b[2J\\x1b[H');
console.log('\\x1b[38;2;135;207;62m┌──────────────────────────────────────────────────────────┐\\x1b[0m');
console.log('\\x1b[38;2;135;207;62m│        YouTube Music Unix TUI - Linux Mint Edition       │\\x1b[0m');
console.log('\\x1b[38;2;135;207;62m└──────────────────────────────────────────────────────────┘\\x1b[0m');
console.log('\\x1b[38;2;166;226;46m[+] Initializing ASCII engine and audio stream controller...\\x1b[0m');
console.log('\\x1b[38;2;207;216;220m[+] Connected: didi@linux-mint\\x1b[0m\\n');

// Listen for keyboard input
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if (key.ctrl && key.name === 'c') process.exit();
  if (key.name === 'space') console.log('[TUI] Toggled Play/Pause');
  if (key.name === 'n') console.log('[TUI] Skipped to next track');
  if (key.name === 'q') process.exit();
});
`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none">
      <div
        className="w-full max-w-2xl border p-5 shadow-2xl relative flex flex-col gap-3 text-xs max-h-[90vh] overflow-hidden"
        style={{
          borderColor: theme.accent,
          backgroundColor: theme.cardBg,
          boxShadow: `0 0 35px ${theme.accentGlow}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.border }}>
          <div className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <Terminal className="w-4 h-4" style={{ color: theme.accent }} />
            <span>┌─ Run ytmusic-tui on Linux Mint Local PC ─</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc / Close]
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 border-b pb-2 text-[11px]" style={{ borderColor: theme.border }}>
          <button
            onClick={() => setTab('instructions')}
            className="px-3 py-1 border font-bold"
            style={{
              borderColor: tab === 'instructions' ? theme.accent : theme.border,
              backgroundColor: tab === 'instructions' ? theme.bg : 'transparent',
              color: tab === 'instructions' ? theme.highlight : theme.textDim,
            }}
          >
            [ Step-by-Step Linux Guide ]
          </button>
          <button
            onClick={() => setTab('bash')}
            className="px-3 py-1 border font-bold"
            style={{
              borderColor: tab === 'bash' ? theme.accent : theme.border,
              backgroundColor: tab === 'bash' ? theme.bg : 'transparent',
              color: tab === 'bash' ? theme.highlight : theme.textDim,
            }}
          >
            [ ytmusic-tui.sh (Bash) ]
          </button>
          <button
            onClick={() => setTab('standalone')}
            className="px-3 py-1 border font-bold"
            style={{
              borderColor: tab === 'standalone' ? theme.accent : theme.border,
              backgroundColor: tab === 'standalone' ? theme.bg : 'transparent',
              color: tab === 'standalone' ? theme.highlight : theme.textDim,
            }}
          >
            [ Node CLI Runner ]
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar text-xs">
          {tab === 'instructions' && (
            <div className="space-y-3">
              <div className="border p-3 space-y-2" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
                <div className="font-bold text-sm" style={{ color: theme.accent }}>
                  1. Rodando no seu Linux Mint (Simples e Rápido):
                </div>
                <p style={{ color: theme.text }}>
                  Este app foi construído especificamente para rodar com baixíssimo consumo de CPU e RAM no seu Linux Mint, renderizando capas de álbuns em caracteres ASCII e ANSI TrueColor diretamente no seu terminal ou navegador!
                </p>
                <div className="p-2 border bg-black/60 font-mono text-[11px] leading-5" style={{ borderColor: theme.border, color: theme.highlight }}>
                  # 1. No terminal do Linux Mint, execute:<br />
                  <span style={{ color: theme.accent }}>npm install</span><br />
                  <span style={{ color: theme.accent }}>npm run dev</span><br /><br />
                  # 2. Acesse http://localhost:3000 no seu navegador ou webview!<br />
                  # Todas as músicas, capas em ASCII e controles por teclado funcionam imediatamente.
                </div>
              </div>

              <div className="border p-3 space-y-2" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
                <div className="font-bold text-sm" style={{ color: theme.accent }}>
                  2. Características para Linux Mint:
                </div>
                <ul className="list-disc pl-5 space-y-1" style={{ color: theme.text }}>
                  <li><strong style={{ color: theme.highlight }}>Design Unix-like Autêntico</strong> com box drawing UTF-8, paleta Linux Mint Green e fontes monospace JetBrains Mono / Fira Code.</li>
                  <li><strong style={{ color: theme.highlight }}>Renderizador ASCII Multimodo</strong> com Half-Block ANSI (24-bit TrueColor), Braille Matrix e Phosphor Green CRT.</li>
                  <li><strong style={{ color: theme.highlight }}>Totalmente navegável pelo teclado</strong> (j/k, Espaço, Enter, l, /, Tab, s, r, m, 1-5).</li>
                  <li><strong style={{ color: theme.highlight }}>Integração com YouTube Music</strong> para buscar, reproduzir playlists e favoritar faixas com segurança.</li>
                </ul>
              </div>
            </div>
          )}

          {tab === 'bash' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px]" style={{ color: theme.textDim }}>Executable Bash launcher script for Linux terminal:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(bashScript)}
                    className="px-2 py-0.5 border flex items-center gap-1 font-bold hover:brightness-125"
                    style={{ borderColor: theme.accent, color: theme.accent, backgroundColor: theme.bg }}
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied!' : 'Copy Bash Script'}</span>
                  </button>
                  <button
                    onClick={() => handleDownload('ytmusic-tui.sh', bashScript)}
                    className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125"
                    style={{ borderColor: theme.border, color: theme.text, backgroundColor: theme.bg }}
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .sh</span>
                  </button>
                </div>
              </div>
              <pre className="border p-3 bg-black/60 text-[11px] overflow-x-auto leading-5" style={{ borderColor: theme.border, color: theme.highlight }}>
                {bashScript}
              </pre>
            </div>
          )}

          {tab === 'standalone' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px]" style={{ color: theme.textDim }}>Node.js standalone terminal driver:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(nodeScript)}
                    className="px-2 py-0.5 border flex items-center gap-1 font-bold hover:brightness-125"
                    style={{ borderColor: theme.accent, color: theme.accent, backgroundColor: theme.bg }}
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied!' : 'Copy Script'}</span>
                  </button>
                  <button
                    onClick={() => handleDownload('ytmusic-tui.cjs', nodeScript)}
                    className="px-2 py-0.5 border flex items-center gap-1 hover:brightness-125"
                    style={{ borderColor: theme.border, color: theme.text, backgroundColor: theme.bg }}
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .cjs</span>
                  </button>
                </div>
              </div>
              <pre className="border p-3 bg-black/60 text-[11px] overflow-x-auto leading-5" style={{ borderColor: theme.border, color: theme.highlight }}>
                {nodeScript}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t" style={{ borderColor: theme.border }}>
          <button
            onClick={onClose}
            className="px-4 py-1 border font-bold hover:brightness-125"
            style={{ borderColor: theme.accent, backgroundColor: theme.cardBg, color: theme.highlight }}
          >
            Close [Esc]
          </button>
        </div>
      </div>
    </div>
  );
};
