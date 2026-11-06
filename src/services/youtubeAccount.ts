import type { Playlist, Track } from '../types';
import { isDesktopApp, openExternal } from './desktop';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function accountRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(url.startsWith('/api/auth/') ? 15_000 : 120_000);
    response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (error) {
    if (init.signal?.aborted) throw new Error('Google sign-in was cancelled.');
    throw new Error('Cannot reach the YouTerm server. Check your connection and make sure YouTerm is running, then try again.');
  }
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error('The YouTerm server returned an invalid response. Restart YouTerm and try again.'); }
  if (!data || typeof data !== 'object') throw new Error('The YouTerm server returned an invalid response. Restart YouTerm and try again.');
  if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Account request failed (${response.status}).`);
  return data as T;
}

export async function connectGoogleAccount(signal: AbortSignal): Promise<GoogleTokens> {
  if (isDesktopApp()) return connectDesktopAccount(signal);
  // Reserve the popup before awaiting the server so browsers retain the click's
  // user activation and do not block the Google sign-in window.
  const popup = window.open('about:blank', 'youterm_google_oauth', 'width=600,height=700');
  if (!popup) throw new Error('Your browser blocked Google sign-in. Allow popups for this site and connect again.');
  try {
    popup.document.title = 'YouTerm — Connecting to Google…';
    popup.document.body.textContent = 'Connecting to Google…';
    const auth = await accountRequest<{ configured: boolean; url: string; redirectUri: string; state: string }>('/api/auth/url', {
      headers: { 'X-YouTerm-Origin': window.location.origin }, signal,
    });
    if (!auth.configured || !auth.url || !auth.state || !auth.redirectUri) throw new Error('Google sign-in is not configured on the YouTerm server.');
    if (signal.aborted) throw new Error('Google sign-in was cancelled.');
    const callback = await new Promise<{ code: string }>((resolve, reject) => {
      // Google may remove window.opener during sign-in. The channel is scoped
      // to this origin and this attempt's unpredictable state, so the callback
      // can still return safely after crossing that browsing-context boundary.
      const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`youterm_oauth_${auth.state}`) : undefined;
      const cleanup = () => {
        channel?.close();
        window.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
        window.clearInterval(closedTimer);
        window.clearTimeout(timeout);
      };
      const onAbort = () => { cleanup(); reject(new Error('Google sign-in was cancelled.')); };
      const onCallback = (data: any) => {
        if (data?.type !== 'YOUTERM_OAUTH_CALLBACK' || data.state !== auth.state || data.redirectUri !== auth.redirectUri) return;
        cleanup();
        if (data.error || !data.code) reject(new Error(data.error || 'Google did not return a sign-in code. Please connect again.'));
        else resolve({ code: data.code });
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin === new URL(auth.redirectUri).origin && event.source === popup) onCallback(event.data);
      };
      const closedTimer = window.setInterval(() => {
        // A cross-origin opener policy can make an open Google window appear
        // closed. Keep listening on the channel until completion or cancellation.
        if (!channel && popup.closed) { cleanup(); reject(new Error('Google sign-in was closed before it completed. Please connect again.')); }
      }, 1000);
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Google sign-in timed out. Please connect again.')); }, 5 * 60_000);
      window.addEventListener('message', onMessage);
      if (channel) channel.onmessage = event => {
        if (event.origin === window.location.origin) onCallback(event.data);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try { popup.location.replace(auth.url); }
      catch { cleanup(); reject(new Error('Could not open Google sign-in. Please connect again.')); }
    });
    return await accountRequest<GoogleTokens>('/api/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ code: callback.code, state: auth.state, redirectUri: auth.redirectUri }),
    });
  } finally {
    if (!popup.closed) popup.close();
  }
}

async function connectDesktopAccount(signal: AbortSignal): Promise<GoogleTokens> {
  const auth = await accountRequest<{ startUrl?: string; redirectUri: string; state: string; nativeWindow?: boolean }>('/api/auth/url?desktop=1', {
    headers: { 'X-YouTerm-Origin': window.location.origin }, signal,
  });
  if (!auth.nativeWindow) {
    if (!auth.startUrl || new URL(auth.startUrl).origin !== window.location.origin) throw new Error('The server did not provide a valid desktop sign-in URL.');
    openExternal(auth.startUrl);
  }
  const deadline = Date.now() + 5 * 60_000;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await accountRequest<{ pending: boolean; code?: string }>(`/api/auth/desktop/result?state=${encodeURIComponent(auth.state)}`, { signal });
    if (result.code) return accountRequest<GoogleTokens>('/api/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ code: result.code, state: auth.state, redirectUri: auth.redirectUri }),
    });
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Google sign-in was cancelled.')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error(signal.aborted ? 'Google sign-in was cancelled.' : 'Google sign-in timed out. Please connect again.');
}

export async function syncYouTubeLibrary(accessToken?: string): Promise<{ playlists: Playlist[]; tracks: Track[] }> {
  const token = accessToken?.trim();
  if (!token || token.startsWith('AIza')) throw new Error('Connect with Google or paste an OAuth access token to sync your personal library. A YouTube API key cannot access your account.');
  const headers = { Authorization: `Bearer ${token}` };
  const [playlists, liked] = await Promise.all([
    accountRequest<{ playlists: Playlist[] }>('/api/user/playlists', { headers }),
    accountRequest<{ tracks: Track[] }>('/api/user/liked', { headers }),
  ]);
  if (!Array.isArray(playlists.playlists) || !Array.isArray(liked.tracks)) throw new Error('The YouTerm server returned an invalid library response. Please restart YouTerm and try again.');
  return { playlists: playlists.playlists, tracks: liked.tracks };
}
