interface DesktopBridge {
  platform: 'linux' | 'windows' | 'macos';
  username?: string;
  hostname?: string;
  openExternal: (url: string) => void;
}

declare global {
  interface Window { __YOUTERM_DESKTOP__?: DesktopBridge; }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.__YOUTERM_DESKTOP__;
}

export function openExternal(url: string): void {
  if (isDesktopApp()) window.__YOUTERM_DESKTOP__!.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
