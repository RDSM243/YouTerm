import React, { useState } from 'react';
import { ThemeConfig } from '../types';
import { Link2, Download, X, AlertCircle, CheckCircle, Music } from 'lucide-react';

interface ImportPlaylistModalProps {
  theme: ThemeConfig;
  onImport: (urlOrId: string) => Promise<boolean>;
  onClose: () => void;
}

export const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({
  theme,
  onImport,
  onClose,
}) => {
  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const success = await onImport(inputUrl.trim());
      if (success) {
        setSuccessMsg('Playlist imported successfully! Loading tracks...');
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setErrorMsg('Could not load playlist. Check if the URL/ID is valid or public/unlisted.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to import playlist');
    } finally {
      setIsLoading(false);
    }
  };

  const samplePlaylists = [
    { name: 'Top Brasil Hits', url: 'https://music.youtube.com/playlist?list=RDCLAK5uy_kmPRjHDECIcuVwnKsx2scAIaqQIStVO0U' },
    { name: 'Lofi Girl Relax', url: 'https://www.youtube.com/playlist?list=PLofht4PTcKYnaH8w5olJCI-wUVxuoMHqM' },
    { name: 'Synthwave / Cyberpunk', url: 'https://www.youtube.com/playlist?list=PL2v7pGvN56F1v5m4e7C1Qz8j5Z8d9vG4k' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        className="w-full max-w-lg border p-5 shadow-2xl relative flex flex-col gap-4 text-xs"
        style={{
          borderColor: theme.accent,
          backgroundColor: theme.cardBg,
          boxShadow: `0 0 30px ${theme.accentGlow}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.border }}>
          <div className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <Link2 className="w-4 h-4" style={{ color: theme.accent }} />
            <span>┌─ Import YouTube Music Playlist ─</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc / Close]
          </button>
        </div>

        <p className="text-[11px]" style={{ color: theme.text }}>
          Paste any public or unlisted <strong>YouTube Music</strong> or <strong>YouTube Playlist URL / ID</strong> to stream and manage your own songs directly in the Unix TUI:
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold" style={{ color: theme.textDim }}>
              PLAYLIST URL OR ID:
            </label>
            <div
              className="flex items-center border p-1.5"
              style={{ borderColor: theme.border, backgroundColor: theme.bg }}
            >
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://music.youtube.com/playlist?list=... or PLxxxxxx"
                className="w-full bg-transparent outline-none font-mono text-xs"
                style={{ color: theme.text }}
                autoFocus
                required
              />
              {inputUrl && (
                <button
                  type="button"
                  onClick={() => setInputUrl('')}
                  className="px-1 text-[10px] hover:opacity-80"
                  style={{ color: theme.textDim }}
                >
                  [×]
                </button>
              )}
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold opacity-70" style={{ color: theme.textDim }}>
              QUICK SAMPLES / PRESETS:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {samplePlaylists.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInputUrl(sample.url)}
                  className="px-2 py-0.5 border text-[10px] flex items-center gap-1 hover:brightness-125 transition-all"
                  style={{
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    color: theme.accent,
                  }}
                >
                  <Music className="w-2.5 h-2.5" />
                  <span>{sample.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Status Message */}
          {errorMsg && (
            <div
              className="p-2 border flex items-center gap-2 text-[11px]"
              style={{ borderColor: theme.error, color: theme.error, backgroundColor: 'rgba(239,68,68,0.1)' }}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              className="p-2 border flex items-center gap-2 text-[11px]"
              style={{ borderColor: theme.accent, color: theme.accent, backgroundColor: 'rgba(34,197,94,0.1)' }}
            >
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: theme.border }}>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border hover:opacity-80"
              style={{ borderColor: theme.border, color: theme.textDim }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !inputUrl.trim()}
              className="px-4 py-1 border font-bold flex items-center gap-1.5 hover:brightness-125 disabled:opacity-50"
              style={{
                borderColor: theme.accent,
                backgroundColor: theme.accent,
                color: '#000000',
              }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isLoading ? 'Fetching from YouTube...' : 'Import & Stream'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
