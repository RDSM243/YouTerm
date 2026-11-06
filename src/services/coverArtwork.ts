export interface CoverArtwork {
  url: string;
  width: number;
  height: number;
}

const artworkCache = new Map<string, CoverArtwork>();

export function getArtworkCandidates(thumbnailUrl: string, videoId: string): string[] {
  const candidates: string[] = [];
  try {
    const url = new URL(thumbnailUrl);
    const googleImage = /(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(url.hostname);
    const youtubeImage = /(^|\.)ytimg\.com$/.test(url.hostname);
    if (url.protocol === 'https:' && googleImage) {
      url.pathname = url.pathname.replace(/=(?:w|h|s)\d+[^/]*$/, '') + '=s0';
      candidates.push(url.toString());
    }
    if ((googleImage || youtubeImage) && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      candidates.push(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
      candidates.push(`https://i.ytimg.com/vi/${videoId}/sddefault.jpg`);
    }
  } catch {
    // Custom artwork can also use relative URLs.
  }
  if (thumbnailUrl) candidates.push(thumbnailUrl);
  return [...new Set(candidates)];
}

function loadImage(url: string, signal: AbortSignal): Promise<CoverArtwork> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (artwork?: CoverArtwork) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (artwork) resolve(artwork);
      else {
        image.removeAttribute('src');
        reject(new Error('Artwork unavailable.'));
      }
    };
    const abort = () => finish();
    const timeout = setTimeout(() => finish(), 8000);
    image.onload = () => {
      // Missing YouTube thumbnails can be returned as a small placeholder.
      if (!image.naturalWidth || (/\/(maxresdefault|sddefault)\.jpg$/.test(url) && image.naturalWidth < 300)) finish();
      else finish({ url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

export async function loadCoverArtwork(thumbnailUrl: string, videoId: string, signal: AbortSignal): Promise<CoverArtwork> {
  const key = `${videoId}:${thumbnailUrl}`;
  const cached = artworkCache.get(key);
  if (cached) return cached;
  for (const url of getArtworkCandidates(thumbnailUrl, videoId)) {
    signal.throwIfAborted();
    try {
      const artwork = await loadImage(url, signal);
      if (artworkCache.size >= 100) artworkCache.delete(artworkCache.keys().next().value!);
      artworkCache.set(key, artwork);
      return artwork;
    } catch {
      signal.throwIfAborted();
    }
  }
  throw new Error('No artwork is available for this track.');
}
