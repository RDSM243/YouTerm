export type SpectrumColorMode = 'theme' | 'solid' | 'gradient';
export type SpectrumBarStyle = 'solid' | 'blocks' | 'rounded';
export type SpectrumOrientation = 'bottom' | 'mirror' | 'top';

export interface SpectrumGradientPreset {
  id: string;
  name: string;
  bottom: string;
  mid: string;
  top: string;
  useMid: boolean;
}

export interface SpectrumConfig {
  colorMode: SpectrumColorMode;
  solidColor: string;
  gradientPreset: string;
  gradientBottom: string;
  gradientMid: string;
  gradientTop: string;
  gradientUseMid: boolean;
  barCount: number; // 0 = Auto-fit based on barWidth & barGap
  barWidth: number; // 2..24 px
  barGap: number; // 0..10 px
  heightScale: number; // 30..100 %
  barStyle: SpectrumBarStyle;
  blockHeight: number; // 3..10 px
  orientation: SpectrumOrientation;
  sensitivity: number; // 0 = AUTO, else 0.4..3.0
  gravity: number; // 0.3..2.5
  smoothing: 0 | 1 | 2;
  showPeaks: boolean;
  showGrid: boolean;
}

export const SPECTRUM_CONFIG_STORAGE_KEY = 'ytmusic_spectrum_config_v1';

export const SPECTRUM_GRADIENT_PRESETS: readonly SpectrumGradientPreset[] = [
  { id: 'cava_classic', name: 'CAVA', bottom: '#22c55e', mid: '#eab308', top: '#ef4444', useMid: true },
  { id: 'cyberpunk', name: 'Cyber', bottom: '#06b6d4', mid: '#a855f7', top: '#ec4899', useMid: true },
  { id: 'fire', name: 'Fire', bottom: '#dc2626', mid: '#f97316', top: '#fde047', useMid: true },
  { id: 'ocean', name: 'Ocean', bottom: '#1d4ed8', mid: '#06b6d4', top: '#67e8f9', useMid: true },
  { id: 'aurora', name: 'Aurora', bottom: '#10b981', mid: '#06b6d4', top: '#8b5cf6', useMid: true },
  { id: 'synthwave', name: 'Synth', bottom: '#7c3aed', mid: '#ec4899', top: '#fbbf24', useMid: true },
  { id: 'monochrome', name: 'Mono', bottom: '#52525b', mid: '#a1a1aa', top: '#fafafa', useMid: true },
];

export const SPECTRUM_SOLID_SWATCHES: readonly string[] = [
  '#87cf3e',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#f59e0b',
  '#ef4444',
  '#e4e4e7',
];

export const DEFAULT_SPECTRUM_CONFIG: SpectrumConfig = {
  colorMode: 'theme',
  solidColor: '#87cf3e',
  gradientPreset: 'cava_classic',
  gradientBottom: '#22c55e',
  gradientMid: '#eab308',
  gradientTop: '#ef4444',
  gradientUseMid: true,
  barCount: 0,
  barWidth: 8,
  barGap: 3,
  heightScale: 100,
  barStyle: 'solid',
  blockHeight: 5,
  orientation: 'bottom',
  sensitivity: 0,
  gravity: 1.0,
  smoothing: 1,
  showPeaks: true,
  showGrid: true,
};

export interface SpectrumProfilePreset {
  id: string;
  label: string;
  patch: Partial<SpectrumConfig>;
}

export const SPECTRUM_PROFILE_PRESETS: readonly SpectrumProfilePreset[] = [
  {
    id: 'cava',
    label: 'CAVA Classic',
    patch: {
      colorMode: 'gradient',
      gradientPreset: 'cava_classic',
      gradientBottom: '#22c55e',
      gradientMid: '#eab308',
      gradientTop: '#ef4444',
      gradientUseMid: true,
      barCount: 0,
      barWidth: 8,
      barGap: 3,
      heightScale: 100,
      barStyle: 'solid',
      orientation: 'bottom',
      gravity: 1.0,
      smoothing: 1,
      showPeaks: true,
      showGrid: true,
    },
  },
  {
    id: 'led',
    label: 'LED Matrix',
    patch: {
      colorMode: 'theme',
      barCount: 0,
      barWidth: 8,
      barGap: 2,
      heightScale: 100,
      barStyle: 'blocks',
      blockHeight: 5,
      orientation: 'bottom',
      gravity: 1.1,
      smoothing: 1,
      showPeaks: true,
      showGrid: true,
    },
  },
  {
    id: 'mirror',
    label: 'Mirror',
    patch: {
      colorMode: 'gradient',
      gradientPreset: 'cyberpunk',
      gradientBottom: '#06b6d4',
      gradientMid: '#a855f7',
      gradientTop: '#ec4899',
      gradientUseMid: true,
      barCount: 0,
      barWidth: 6,
      barGap: 2,
      heightScale: 95,
      barStyle: 'rounded',
      orientation: 'mirror',
      gravity: 0.9,
      smoothing: 1,
      showPeaks: false,
      showGrid: false,
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    patch: {
      colorMode: 'theme',
      barCount: 0,
      barWidth: 3,
      barGap: 2,
      heightScale: 85,
      barStyle: 'solid',
      orientation: 'bottom',
      gravity: 1.25,
      smoothing: 1,
      showPeaks: false,
      showGrid: false,
    },
  },
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim()) ? value.trim() : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizeSpectrumConfig(raw: unknown): SpectrumConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SPECTRUM_CONFIG };
  }
  const input = raw as Record<string, unknown>;
  const colorMode: SpectrumColorMode =
    input.colorMode === 'theme' || input.colorMode === 'solid' || input.colorMode === 'gradient'
      ? input.colorMode
      : DEFAULT_SPECTRUM_CONFIG.colorMode;
  const barStyle: SpectrumBarStyle =
    input.barStyle === 'solid' || input.barStyle === 'blocks' || input.barStyle === 'rounded'
      ? input.barStyle
      : DEFAULT_SPECTRUM_CONFIG.barStyle;
  const orientation: SpectrumOrientation =
    input.orientation === 'bottom' || input.orientation === 'mirror' || input.orientation === 'top'
      ? input.orientation
      : DEFAULT_SPECTRUM_CONFIG.orientation;

  const rawCount = clampNumber(input.barCount, 0, 96, DEFAULT_SPECTRUM_CONFIG.barCount);
  const barCount = rawCount === 0 ? 0 : Math.max(16, Math.round(rawCount));

  const rawSens = typeof input.sensitivity === 'number' && Number.isFinite(input.sensitivity)
    ? input.sensitivity
    : DEFAULT_SPECTRUM_CONFIG.sensitivity;
  const sensitivity = rawSens === 0 ? 0 : Math.round(Math.max(0.4, Math.min(3.0, rawSens)) * 10) / 10;

  const smoothingVal = input.smoothing === 0 || input.smoothing === 1 || input.smoothing === 2
    ? input.smoothing
    : DEFAULT_SPECTRUM_CONFIG.smoothing;

  return {
    colorMode,
    solidColor: sanitizeHexColor(input.solidColor, DEFAULT_SPECTRUM_CONFIG.solidColor),
    gradientPreset: typeof input.gradientPreset === 'string' && input.gradientPreset.length > 0
      ? input.gradientPreset
      : DEFAULT_SPECTRUM_CONFIG.gradientPreset,
    gradientBottom: sanitizeHexColor(input.gradientBottom, DEFAULT_SPECTRUM_CONFIG.gradientBottom),
    gradientMid: sanitizeHexColor(input.gradientMid, DEFAULT_SPECTRUM_CONFIG.gradientMid),
    gradientTop: sanitizeHexColor(input.gradientTop, DEFAULT_SPECTRUM_CONFIG.gradientTop),
    gradientUseMid: typeof input.gradientUseMid === 'boolean'
      ? input.gradientUseMid
      : DEFAULT_SPECTRUM_CONFIG.gradientUseMid,
    barCount,
    barWidth: Math.round(clampNumber(input.barWidth, 2, 24, DEFAULT_SPECTRUM_CONFIG.barWidth)),
    barGap: Math.round(clampNumber(input.barGap, 0, 10, DEFAULT_SPECTRUM_CONFIG.barGap)),
    heightScale: Math.round(clampNumber(input.heightScale, 30, 100, DEFAULT_SPECTRUM_CONFIG.heightScale)),
    barStyle,
    blockHeight: Math.round(clampNumber(input.blockHeight, 3, 10, DEFAULT_SPECTRUM_CONFIG.blockHeight)),
    orientation,
    sensitivity,
    gravity: Math.round(clampNumber(input.gravity, 0.3, 2.5, DEFAULT_SPECTRUM_CONFIG.gravity) * 10) / 10,
    smoothing: smoothingVal,
    showPeaks: typeof input.showPeaks === 'boolean' ? input.showPeaks : DEFAULT_SPECTRUM_CONFIG.showPeaks,
    showGrid: typeof input.showGrid === 'boolean' ? input.showGrid : DEFAULT_SPECTRUM_CONFIG.showGrid,
  };
}

export function loadSpectrumConfig(fallbackSensitivity?: number): SpectrumConfig {
  try {
    const raw = localStorage.getItem(SPECTRUM_CONFIG_STORAGE_KEY);
    if (raw) {
      return normalizeSpectrumConfig(JSON.parse(raw));
    }
  } catch {}
  return normalizeSpectrumConfig({
    ...DEFAULT_SPECTRUM_CONFIG,
    ...(typeof fallbackSensitivity === 'number' ? { sensitivity: fallbackSensitivity } : {}),
  });
}

export function saveSpectrumConfig(config: SpectrumConfig): void {
  try {
    localStorage.setItem(SPECTRUM_CONFIG_STORAGE_KEY, JSON.stringify(normalizeSpectrumConfig(config)));
  } catch {}
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (!Number.isFinite(num)) return [135, 207, 62];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Interpolates a hex color from an ordered list of color stops for ratio `t` in [0, 1].
 */
export function interpolateColorStops(stops: readonly string[], t: number): string {
  if (stops.length === 0) return '#87cf3e';
  if (stops.length === 1) return stops[0];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const [r1, g1, b1] = parseHexRgb(stops[idx]);
  const [r2, g2, b2] = parseHexRgb(stops[idx + 1]);
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

export interface BarLayout {
  activeBars: number;
  barWidth: number;
  barGap: number;
  startX: number;
}

/**
 * Computes CAVA-style bar layout inside `plotWidth`.
 * When `barCount === 0`, automatically fits as many bars of `desiredWidth` + `desiredGap` as possible.
 */
export function computeBarLayout(
  plotWidth: number,
  leftMargin: number,
  barCount: number,
  desiredWidth: number,
  desiredGap: number,
): BarLayout {
  const safePlot = Math.max(24, plotWidth);
  const maxBars = 128;

  if (barCount === 0) {
    const unit = Math.max(2, desiredWidth + desiredGap);
    const activeBars = Math.max(8, Math.min(maxBars, Math.floor((safePlot + desiredGap) / unit)));
    const totalDesired = activeBars * desiredWidth + Math.max(0, activeBars - 1) * desiredGap;
    let barWidth = desiredWidth;
    let barGap = desiredGap;
    if (totalDesired > safePlot) {
      const slot = safePlot / activeBars;
      barGap = Math.min(desiredGap, Math.max(0, slot * 0.25));
      barWidth = Math.max(1.5, slot - barGap);
    }
    const contentWidth = activeBars * barWidth + Math.max(0, activeBars - 1) * barGap;
    const startX = leftMargin + Math.max(0, (safePlot - contentWidth) / 2);
    return { activeBars, barWidth, barGap, startX };
  }

  const activeBars = Math.max(8, Math.min(maxBars, Math.round(barCount)));
  const slot = safePlot / activeBars;
  const barGap = Math.min(desiredGap, Math.max(0, slot - 1.5));
  const barWidth = Math.min(desiredWidth, Math.max(1.5, slot - barGap));
  const contentWidth = activeBars * barWidth + Math.max(0, activeBars - 1) * barGap;
  const startX = leftMargin + Math.max(0, (safePlot - contentWidth) / 2);
  return { activeBars, barWidth, barGap, startX };
}
