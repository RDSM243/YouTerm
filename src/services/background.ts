import type { BackgroundConfig } from '../types';

export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024;
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  enabled: false,
  imageRevision: '',
  imageName: '',
  brightness: 100,
  darkness: 35,
  panelOpacity: 70,
  showInSidebar: false,
  showInPlayer: false,
  showInSpectrum: false,
};

export function normalizeBackground(value: unknown): BackgroundConfig {
  const input = value && typeof value === 'object' ? value as Partial<BackgroundConfig> : {};
  const result = { ...DEFAULT_BACKGROUND };
  for (const field of ['enabled', 'showInSidebar', 'showInPlayer', 'showInSpectrum'] as const) {
    if (typeof input[field] === 'boolean') result[field] = input[field];
  }
  for (const [field, max] of [['brightness', 200], ['darkness', 100], ['panelOpacity', 100]] as const) {
    if (typeof input[field] === 'number' && Number.isFinite(input[field])) {
      result[field] = Math.max(0, Math.min(max, Math.round(input[field])));
    }
  }
  if (typeof input.imageRevision === 'string' && /^[a-f0-9-]{36}$/.test(input.imageRevision)) {
    result.imageRevision = input.imageRevision;
    if (typeof input.imageName === 'string') result.imageName = input.imageName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
  }
  if (!result.imageRevision) result.enabled = false;
  return result;
}

export function backgroundImageUrl(revision: string): string {
  return `/api/background/image?v=${encodeURIComponent(revision)}`;
}

export function surfaceColor(color: string, opacity: number): string {
  const channels = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
  return `rgba(${channels.join(', ')}, ${Math.max(0, Math.min(1, opacity))})`;
}

export async function importBackgroundImage(file: File): Promise<string> {
  if (!file.size || file.size > MAX_BACKGROUND_BYTES) throw new Error('Choose an image smaller than 12 MB.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (offset: number, bytes: number[]) => bytes.every((byte, index) => header[offset + index] === byte);
  if (!matches(0, [137, 80, 78, 71, 13, 10, 26, 10])
    && !matches(0, [255, 216, 255])
    && !(matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]))) {
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error('This image could not be opened. Choose another image.'); }
    if (image.naturalWidth * image.naturalHeight > 32_000_000) {
      throw new Error('Choose an image with at most 32 megapixels.');
    }
  } finally { URL.revokeObjectURL(url); }
  const response = await fetch('/api/background/image', {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
  if (!response.ok) throw new Error('The background image could not be saved. Please try again.');
  return crypto.randomUUID();
}

export async function removeBackgroundImage(): Promise<void> {
  const response = await fetch('/api/background/image', { method: 'DELETE' });
  if (!response.ok) throw new Error('The background image could not be removed. Please try again.');
}
