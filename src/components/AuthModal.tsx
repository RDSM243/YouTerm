import React, { useEffect, useRef, useState } from 'react';
import { ThemeConfig, UserSession } from '../types';
import { CheckCircle, ShieldCheck, ExternalLink, LogIn, Save, RefreshCw } from 'lucide-react';
import { connectGoogleAccount } from '../services/youtubeAccount';
import { isDesktopApp } from '../services/desktop';

interface AuthModalProps {
  theme: ThemeConfig;
  session: UserSession;
  onSaveSession: (session: UserSession) => void;
  onSyncAccount: (session?: UserSession) => Promise<string>;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  theme,
  session,
  onSaveSession,
  onSyncAccount,
  onClose,
}) => {
  const [apiKey, setApiKey] = useState(session.apiKey || '');
  const [accessToken, setAccessToken] = useState(session.accessToken || '');
  const [isSaved, setIsSaved] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const oauthAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => oauthAbortRef.current?.abort(), []);

  const draftSession = (): UserSession => ({
    ...session,
    username: session.username || 'user',
    hostname: session.hostname || 'linux',
    apiKey: apiKey.trim(),
    accessToken: accessToken.trim(),
    isLoggedIn: true,
    connectedAt: new Date().toISOString(),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSession(draftSession());
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  const handleConnectOAuth = async () => {
    if (isConnecting || isSyncing) return;
    const controller = new AbortController();
    oauthAbortRef.current = controller;
    setIsConnecting(true);
    let connected = false;
    try {
      setAuthStatus(isDesktopApp() ? 'Complete Google sign-in in the YouTerm login window...' : 'Complete Google sign-in in the popup window...');
      const tokens = await connectGoogleAccount(controller.signal);
      const updatedSession = { ...draftSession(), accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || session.refreshToken };
      setAccessToken(tokens.access_token);
      onSaveSession(updatedSession);
      connected = true;
      oauthAbortRef.current = null;
      setIsConnecting(false);
      setIsSyncing(true);
      setAuthStatus('Google connected. Syncing your playlists and liked songs...');
      const message = await onSyncAccount(updatedSession);
      setAuthStatus(message);
    } catch (e: any) {
      if (!controller.signal.aborted) setAuthStatus(connected ? `Google connected. Sync failed: ${e.message}` : e.message);
    } finally {
      oauthAbortRef.current = null;
      setIsConnecting(false);
      setIsSyncing(false);
    }
  };

  const handleSyncNow = async () => {
    if (isConnecting || isSyncing) return;
    setIsSyncing(true);
    setAuthStatus('Connecting to YouTube Music backend to sync your playlists and liked songs...');
    try {
      const updatedSession = draftSession();
      const msg = await onSyncAccount(updatedSession);
      onSaveSession(updatedSession);
      setAuthStatus(msg);
    } catch (err: any) {
      setAuthStatus(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none overflow-y-auto">
      <div
        className="w-full max-w-xl border p-5 shadow-2xl relative flex flex-col gap-4 text-xs my-auto"
        style={{
          borderColor: theme.accent,
          backgroundColor: theme.cardBg,
          boxShadow: `0 0 30px ${theme.accentGlow}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.border }}>
          <div className="flex items-center gap-2 font-bold text-sm" style={{ color: theme.highlight }}>
            <ShieldCheck className="w-4 h-4" style={{ color: theme.accent }} />
            <span>┌─ YouTube Music Backend & Account Connection ─</span>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 px-2 py-0.5 border"
            style={{ borderColor: theme.border, color: theme.textDim }}
          >
            [Esc / Close]
          </button>
        </div>

        {/* Status banner */}
        <div className="border p-3 flex items-start gap-2.5" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
          <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: theme.accent }} />
          <div>
            <div className="font-bold" style={{ color: theme.highlight }}>
              YouTube Music Audio & Metadata Backend
            </div>
            <p className="text-[11px] mt-0.5 opacity-90" style={{ color: theme.text }}>
              Real-time YouTube search, live explore charts, and direct playlist import are fully enabled.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          {/* Google Access Token */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold" style={{ color: theme.textDim }}>
                GOOGLE / YOUTUBE OAUTH ACCESS TOKEN (OPTIONAL):
              </label>
              <span className="text-[10px]" style={{ color: theme.accent }}>Direct User Sync</span>
            </div>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="border p-1.5 outline-none font-mono"
              style={{ borderColor: theme.border, backgroundColor: theme.bg, color: theme.text }}
              placeholder="ya29.a0AfH6SM... (paste token to sync private playlists & liked songs)"
            />
            <span className="text-[10px] opacity-70" style={{ color: theme.textDim }}>
              Paste an OAuth Access Token from Google OAuth Playground or your Google Cloud OAuth client to sync your personal YouTube library.
            </span>
          </div>

          {/* YouTube Data API Key */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold" style={{ color: theme.textDim }}>
                YOUTUBE DATA API v3 KEY (OPTIONAL):
              </label>
              <span className="text-[10px]" style={{ color: theme.accent }}>Direct API</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="border p-1.5 outline-none font-mono"
              style={{ borderColor: theme.border, backgroundColor: theme.bg, color: theme.text }}
              placeholder="AIzaSy... (leave blank to use high-speed backend search scraper)"
            />
          </div>

          {/* Google OAuth & Sync Actions */}
          <div className="border p-3 flex flex-col gap-2" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
            <div className="flex justify-between items-center">
              <span className="font-bold flex items-center gap-1.5" style={{ color: theme.accent }}>
                <LogIn className="w-3.5 h-3.5" />
                <span>YouTube Account Sync & OAuth:</span>
              </span>
              <span className="text-[10px] opacity-60">Google / YouTube</span>
            </div>
            <p className="text-[11px]" style={{ color: theme.textDim }}>
              Click below to initiate Google OAuth or trigger an immediate sync of your YouTube playlists and liked songs:
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleConnectOAuth}
                disabled={isConnecting || isSyncing}
                className="flex-1 px-3 py-1.5 border flex items-center justify-center gap-2 hover:brightness-125 font-bold"
                style={{
                  borderColor: theme.accent,
                  backgroundColor: theme.cardBg,
                  color: theme.highlight,
                }}
              >
                <ExternalLink className="w-3 h-3" />
                <span>{isConnecting ? 'Connecting...' : '[ Connect via Google OAuth ]'}</span>
              </button>
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={isSyncing || isConnecting}
                className="px-3 py-1.5 border flex items-center justify-center gap-2 hover:brightness-125 font-bold"
                style={{
                  borderColor: theme.border,
                  backgroundColor: theme.cardBg,
                  color: theme.accent,
                }}
              >
                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Playlists Now'}</span>
              </button>
              {isConnecting && (
                <button type="button" onClick={() => {
                  oauthAbortRef.current?.abort();
                  setAuthStatus('Google sign-in was cancelled. You can connect again when ready.');
                }} className="px-3 py-1.5 border" style={{ borderColor: theme.border, color: theme.textDim }}>
                  Cancel sign-in
                </button>
              )}
            </div>
            <details className="text-[10px] leading-relaxed" style={{ color: theme.textDim }}>
              <summary className="cursor-pointer" style={{ color: theme.accent }}>
                How does Google / YouTube Music account sync work?
              </summary>
              <p className="mt-1">
                Click <strong>[ Connect via Google OAuth ]</strong> to sign in directly with any Google account in the native login window—no Google Cloud setup, Client ID, or test-user email approval required.
              </p>
            </details>
            {authStatus && (
              <div role="status" aria-live="polite" className="text-[10px] p-2 border mt-1 font-mono" style={{ borderColor: theme.warning, color: theme.warning }}>
                {authStatus}
              </div>
            )}
          </div>

          {/* Action buttons */}
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
              disabled={isConnecting || isSyncing}
              className="px-4 py-1 border font-bold flex items-center gap-1.5 hover:brightness-125"
              style={{
                borderColor: theme.accent,
                backgroundColor: theme.accent,
                color: '#000000',
              }}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaved ? 'Saved & Connected!' : 'Save & Connect'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
