import { AsciiConfig, AsciiRenderMode } from '../types';

export interface AsciiPixel {
  char: string;
  color?: string;       // fg color
  bgColor?: string;     // bg color (for half block)
}

export interface AsciiResult {
  lines: AsciiPixel[][];
  rawText: string;
  rawAnsi: string;
  width: number;
  height: number;
}

// Density ramps from high luminance to low luminance
export const DENSITY_RAMPS = {
  standard: ' .:-=+*#%@',
  detailed: ' .`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  simple: ' .oO0@',
  blocks: ' ░▒▓█',
  matrix: ' 0123456789ABCDEFｱｲｳｴｵｶｷｸｹｺｻｼｽ',
};

// Cache for generated ASCII
const asciiCache = new Map<string, AsciiResult>();

export async function convertImageToAscii(
  imageUrl: string,
  config: AsciiConfig
): Promise<AsciiResult> {
  const cacheKey = `${imageUrl}_${config.mode}_${config.width}_${config.contrast}_${config.brightness}_${config.inverted}_${config.colorEnabled}`;
  if (asciiCache.has(cacheKey)) {
    return asciiCache.get(cacheKey)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    // Fallback proxy if direct load encounters CORS issues
    img.onerror = () => {
      const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';
      proxyImg.onload = () => {
        const result = processImage(proxyImg, config);
        asciiCache.set(cacheKey, result);
        resolve(result);
      };
      proxyImg.onerror = () => {
        resolve(generateFallbackAscii(config));
      };
      proxyImg.src = proxyUrl;
    };

    img.onload = () => {
      try {
        const result = processImage(img, config);
        asciiCache.set(cacheKey, result);
        resolve(result);
      } catch (err) {
        resolve(generateFallbackAscii(config));
      }
    };

    img.src = imageUrl;
  });
}

function processImage(img: HTMLImageElement, config: {
  mode: AsciiRenderMode;
  width: number;
  contrast: number;
  brightness: number;
  inverted: boolean;
  colorEnabled: boolean;
}): AsciiResult {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return generateFallbackAscii(config);

  const targetWidth = Math.max(20, Math.min(120, config.width));

  if (config.mode === 'half_block' || config.mode === 'original_hd') {
    // In half-block mode, each character cell represents 2 vertical pixels (top and bottom)
    const targetHeight = Math.round((targetWidth * (img.height / img.width)) / 1.0); // 2 pixels per char vertically
    const evenHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

    canvas.width = targetWidth;
    canvas.height = evenHeight;
    ctx.drawImage(img, 0, 0, targetWidth, evenHeight);

    const imgData = ctx.getImageData(0, 0, targetWidth, evenHeight);
    return renderHalfBlockMode(imgData, targetWidth, evenHeight, config);
  } else if (config.mode === 'braille') {
    // Braille uses 2x4 dots per character cell
    const targetHeight = Math.round(targetWidth * (img.height / img.width) * 0.5) * 4;
    const targetPixelWidth = targetWidth * 2;

    canvas.width = targetPixelWidth;
    canvas.height = targetHeight;
    ctx.drawImage(img, 0, 0, targetPixelWidth, targetHeight);

    const imgData = ctx.getImageData(0, 0, targetPixelWidth, targetHeight);
    return renderBrailleMode(imgData, targetPixelWidth, targetHeight, config);
  } else {
    // Density ramp mode (matrix_code, retro_crt)
    const targetHeight = Math.round(targetWidth * (img.height / img.width) * 0.55);
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    return renderDensityMode(imgData, targetWidth, targetHeight, config);
  }
}

// 1. Half Block Mode: Top & Bottom pixel rendered with ▀ (char is top fg color, bg is bottom bg color)
function renderHalfBlockMode(
  imgData: ImageData,
  width: number,
  height: number,
  config: { contrast: number; brightness: number; colorEnabled: boolean }
): AsciiResult {
  const { data } = imgData;
  const lines: AsciiPixel[][] = [];
  let rawText = '';
  let rawAnsi = '';

  for (let y = 0; y < height; y += 2) {
    const line: AsciiPixel[] = [];
    for (let x = 0; x < width; x++) {
      // Top pixel
      const topIdx = (y * width + x) * 4;
      let topR = adjustColor(data[topIdx], config.brightness, config.contrast);
      let topG = adjustColor(data[topIdx + 1], config.brightness, config.contrast);
      let topB = adjustColor(data[topIdx + 2], config.brightness, config.contrast);

      // Bottom pixel
      const botIdx = ((y + 1) * width + x) * 4;
      let botR = adjustColor(data[botIdx], config.brightness, config.contrast);
      let botG = adjustColor(data[botIdx + 1], config.brightness, config.contrast);
      let botB = adjustColor(data[botIdx + 2], config.brightness, config.contrast);

      if (!config.colorEnabled) {
        const topGray = Math.round(0.299 * topR + 0.587 * topG + 0.114 * topB);
        const botGray = Math.round(0.299 * botR + 0.587 * botG + 0.114 * botB);
        topR = topG = topB = topGray;
        botR = botG = botB = botGray;
      }

      const fgColor = `rgb(${topR}, ${topG}, ${topB})`;
      const bgColor = `rgb(${botR}, ${botG}, ${botB})`;

      line.push({
        char: '▀',
        color: fgColor,
        bgColor: bgColor,
      });

      rawText += '▀';
      rawAnsi += `\x1b[38;2;${topR};${topG};${topB}m\x1b[48;2;${botR};${botG};${botB}m▀`;
    }
    lines.push(line);
    rawText += '\n';
    rawAnsi += '\x1b[0m\n';
  }

  return {
    lines,
    rawText,
    rawAnsi,
    width,
    height: Math.floor(height / 2),
  };
}

// 2. Braille Dot Matrix Mode
function renderBrailleMode(
  imgData: ImageData,
  pixelWidth: number,
  pixelHeight: number,
  config: { contrast: number; brightness: number; colorEnabled: boolean }
): AsciiResult {
  const { data } = imgData;
  const lines: AsciiPixel[][] = [];
  let rawText = '';
  let rawAnsi = '';

  const charWidth = Math.floor(pixelWidth / 2);
  const charHeight = Math.floor(pixelHeight / 4);

  // Braille dot offsets:
  // 1 4
  // 2 5
  // 3 6
  // 7 8
  const dotWeights = [
    [0x1, 0x8],
    [0x2, 0x10],
    [0x4, 0x20],
    [0x40, 0x80],
  ];

  for (let cy = 0; cy < charHeight; cy++) {
    const line: AsciiPixel[] = [];
    for (let cx = 0; cx < charWidth; cx++) {
      let brailleCode = 0x2800; // empty braille
      let totalR = 0, totalG = 0, totalB = 0, count = 0;

      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = cx * 2 + dx;
          const py = cy * 4 + dy;
          if (px < pixelWidth && py < pixelHeight) {
            const idx = (py * pixelWidth + px) * 4;
            const r = adjustColor(data[idx], config.brightness, config.contrast);
            const g = adjustColor(data[idx + 1], config.brightness, config.contrast);
            const b = adjustColor(data[idx + 2], config.brightness, config.contrast);
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            totalR += r;
            totalG += g;
            totalB += b;
            count++;

            if (lum > 110) {
              brailleCode |= dotWeights[dy][dx];
            }
          }
        }
      }

      const avgR = count > 0 ? Math.round(totalR / count) : 200;
      const avgG = count > 0 ? Math.round(totalG / count) : 200;
      const avgB = count > 0 ? Math.round(totalB / count) : 200;
      const char = String.fromCharCode(brailleCode);
      const color = config.colorEnabled ? `rgb(${avgR}, ${avgG}, ${avgB})` : '#87cf3e';

      line.push({ char, color });
      rawText += char;
      rawAnsi += `\x1b[38;2;${avgR};${avgG};${avgB}m${char}`;
    }
    lines.push(line);
    rawText += '\n';
    rawAnsi += '\x1b[0m\n';
  }

  return {
    lines,
    rawText,
    rawAnsi,
    width: charWidth,
    height: charHeight,
  };
}

// 3. Density Ramp Mode
function renderDensityMode(
  imgData: ImageData,
  width: number,
  height: number,
  config: { mode: AsciiRenderMode; contrast: number; brightness: number; inverted: boolean; colorEnabled: boolean }
): AsciiResult {
  const { data } = imgData;
  const lines: AsciiPixel[][] = [];
  let rawText = '';
  let rawAnsi = '';

  let ramp = DENSITY_RAMPS.standard;
  if (config.mode === 'matrix_code') {
    ramp = DENSITY_RAMPS.matrix;
  } else if (config.mode === 'retro_crt') {
    ramp = DENSITY_RAMPS.detailed;
  }

  for (let y = 0; y < height; y++) {
    const line: AsciiPixel[] = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r = adjustColor(data[idx], config.brightness, config.contrast);
      let g = adjustColor(data[idx + 1], config.brightness, config.contrast);
      let b = adjustColor(data[idx + 2], config.brightness, config.contrast);

      const lum = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
      const normalizedLum = config.inverted ? 255 - lum : lum;

      const charIndex = Math.floor((normalizedLum / 255) * (ramp.length - 1));
      const char = ramp[charIndex] || ' ';

      let color = `rgb(${r}, ${g}, ${b})`;
      if (config.mode === 'retro_crt') {
        color = `rgb(34, ${Math.max(100, Math.round(lum * 0.9 + 50))}, 50)`;
      } else if (config.mode === 'matrix_code') {
        color = `rgb(0, ${Math.max(80, lum)}, 70)`;
      } else if (!config.colorEnabled) {
        color = '#a6b0be';
      }

      line.push({ char, color });
      rawText += char;
      rawAnsi += `\x1b[38;2;${r};${g};${b}m${char}`;
    }
    lines.push(line);
    rawText += '\n';
    rawAnsi += '\x1b[0m\n';
  }

  return {
    lines,
    rawText,
    rawAnsi,
    width,
    height,
  };
}

function adjustColor(val: number, brightness: number, contrast: number): number {
  let adjusted = val + brightness * 25.5;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  adjusted = factor * (adjusted - 128) + 128;
  return Math.max(0, Math.min(255, Math.round(adjusted)));
}

// Fallback ASCII art for album vinyl
function generateFallbackAscii(config: { width: number }): AsciiResult {
  const asciiArt = [
    "  .----------------------------------------.  ",
    " /  .------------------------------------.  \\ ",
    "|  /  .--------------------------------.  \\  |",
    "| |  /  .----------------------------.  \\  | |",
    "| | |  /      .----------------.      \\  | | |",
    "| | | |      /   .----------.   \\      | | | |",
    "| | | |     /   /   .----.   \\   \\     | | | |",
    "| | | |    |   |   /  ()  \\   |   |    | | | |",
    "| | | |    |   |   \\  ()  /   |   |    | | | |",
    "| | | |     \\   \\   '----'   /   /     | | | |",
    "| | | |      \\   '----------'   /      | | | |",
    "| | |  \\      '----------------'      /  | | |",
    "| |  \\  '----------------------------'  /  | |",
    "|  \\  '--------------------------------'  /  |",
    " \\  '------------------------------------'  / ",
    "  '----------------------------------------'  "
  ];

  const lines: AsciiPixel[][] = asciiArt.map((row) =>
    row.split('').map((char) => ({
      char,
      color: '#87cf3e',
    }))
  );

  return {
    lines,
    rawText: asciiArt.join('\n'),
    rawAnsi: asciiArt.join('\n'),
    width: 46,
    height: asciiArt.length,
  };
}
