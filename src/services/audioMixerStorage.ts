import type { AudioMixerPresetId, AudioMixerState, AudioMixerViewMode } from '../types';

const STORAGE_KEY = 'ytmusic_audio_mixer_v1';

export interface MixerBandDefinition {
  freq: number;
  label: string;
  shortLabel: string;
  region: 'low' | 'mid' | 'high';
  type: BiquadFilterType;
  q: number;
}

export const MIXER_ISO_BANDS: readonly MixerBandDefinition[] = [
  { freq: 32, label: '32 Hz', shortLabel: '32', region: 'low', type: 'lowshelf', q: 0.707 },
  { freq: 64, label: '64 Hz', shortLabel: '64', region: 'low', type: 'peaking', q: 1.414 },
  { freq: 125, label: '125 Hz', shortLabel: '125', region: 'low', type: 'peaking', q: 1.414 },
  { freq: 250, label: '250 Hz', shortLabel: '250', region: 'mid', type: 'peaking', q: 1.414 },
  { freq: 500, label: '500 Hz', shortLabel: '500', region: 'mid', type: 'peaking', q: 1.414 },
  { freq: 1000, label: '1 kHz', shortLabel: '1k', region: 'mid', type: 'peaking', q: 1.414 },
  { freq: 2000, label: '2 kHz', shortLabel: '2k', region: 'mid', type: 'peaking', q: 1.414 },
  { freq: 4000, label: '4 kHz', shortLabel: '4k', region: 'high', type: 'peaking', q: 1.414 },
  { freq: 8000, label: '8 kHz', shortLabel: '8k', region: 'high', type: 'peaking', q: 1.414 },
  { freq: 16000, label: '16 kHz', shortLabel: '16k', region: 'high', type: 'highshelf', q: 0.707 },
];

export interface AudioMixerPreset {
  id: AudioMixerPresetId;
  name: string;
  description: string;
  bass: number;
  mid: number;
  treble: number;
  subBass: number;
  presence: number;
  air: number;
  preamp: number;
  bands: readonly [number, number, number, number, number, number, number, number, number, number];
}

export const AUDIO_MIXER_PRESETS: readonly AudioMixerPreset[] = [
  {
    id: 'flat',
    name: 'Flat / Studio (0 dB)',
    description: 'Neutral reference response with zero coloration.',
    bass: 0,
    mid: 0,
    treble: 0,
    subBass: 0,
    presence: 0,
    air: 0,
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'bass_boost',
    name: 'Bass Boost (Graves+)',
    description: 'Deep sub-bass punch and warm low-end reinforcement.',
    bass: 6.5,
    mid: -0.5,
    treble: 1.5,
    subBass: 5.0,
    presence: 0.5,
    air: 1.0,
    preamp: 0,
    bands: [6.0, 5.5, 4.0, 1.5, 0, -0.5, 0, 1.0, 1.5, 2.0],
  },
  {
    id: 'treble_clarity',
    name: 'Treble & Clarity (Agudos+)',
    description: 'Sparkling high frequencies, crisp cymbals and airy detail.',
    bass: 0,
    mid: 1.0,
    treble: 6.5,
    subBass: 0,
    presence: 3.0,
    air: 5.5,
    preamp: 0,
    bands: [0, 0, 0, 0.5, 1.0, 1.5, 3.0, 4.5, 6.0, 6.5],
  },
  {
    id: 'mid_vocal',
    name: 'Mid & Vocal (Médios+)',
    description: 'Forward vocals, guitars and midrange clarity with controlled rumble.',
    bass: -2.0,
    mid: 5.5,
    treble: 2.0,
    subBass: -3.0,
    presence: 4.5,
    air: 1.5,
    preamp: 0,
    bands: [-2.5, -1.5, 0, 2.5, 4.5, 5.5, 5.0, 3.5, 1.5, 0.5],
  },
  {
    id: 'v_shape',
    name: 'V-Shape / Loudness',
    description: 'Energetic low-end thump and brilliant highs with a scooped midrange.',
    bass: 5.5,
    mid: -2.5,
    treble: 5.5,
    subBass: 4.0,
    presence: 1.5,
    air: 4.5,
    preamp: 0,
    bands: [5.5, 4.5, 2.5, -1.0, -2.5, -2.0, 0.5, 3.5, 5.0, 6.0],
  },
  {
    id: 'rock',
    name: 'Rock / Metal',
    description: 'Punchy kick drums, aggressive guitar bite and crisp attack.',
    bass: 4.5,
    mid: 1.5,
    treble: 4.5,
    subBass: 2.5,
    presence: 3.5,
    air: 3.0,
    preamp: 0,
    bands: [4.0, 3.5, 2.0, -0.5, -1.0, 1.5, 3.5, 4.5, 4.0, 3.5],
  },
  {
    id: 'electronic',
    name: 'Electronic / EDM',
    description: 'Sub-harmonic club bass and crystalline synth highs.',
    bass: 6.0,
    mid: -1.5,
    treble: 5.0,
    subBass: 6.0,
    presence: 1.0,
    air: 5.0,
    preamp: 0,
    bands: [6.5, 5.5, 3.0, 0, -2.0, -1.0, 1.0, 3.0, 5.0, 6.0],
  },
  {
    id: 'hip_hop',
    name: 'Hip-Hop / Trap 808',
    description: 'Heavy 808 sub-bass extension with crisp vocal presence.',
    bass: 7.0,
    mid: 0.5,
    treble: 3.5,
    subBass: 6.5,
    presence: 3.0,
    air: 2.5,
    preamp: 0,
    bands: [7.0, 6.0, 3.5, 0.5, -1.0, 0.5, 2.5, 3.0, 3.5, 4.0],
  },
  {
    id: 'acoustic',
    name: 'Acoustic / Jazz',
    description: 'Natural warmth, organic midrange body and silky high frequencies.',
    bass: 2.5,
    mid: 2.0,
    treble: 3.0,
    subBass: 1.0,
    presence: 2.0,
    air: 2.5,
    preamp: 0,
    bands: [2.0, 2.5, 2.0, 1.0, 1.5, 2.0, 2.0, 2.5, 3.0, 2.5],
  },
  {
    id: 'late_night',
    name: 'Late Night / Smooth',
    description: 'Tamed sub-bass rumble and softened treble glare for relaxed listening.',
    bass: -1.5,
    mid: 2.0,
    treble: -2.0,
    subBass: -3.5,
    presence: 1.5,
    air: -2.5,
    preamp: 0,
    bands: [-3.5, -1.5, 0.5, 1.5, 2.0, 2.0, 1.0, -1.0, -2.5, -3.5],
  },
];

const VALID_PRESET_IDS = new Set<AudioMixerPresetId>([
  ...AUDIO_MIXER_PRESETS.map(p => p.id),
  'custom',
]);

const VALID_VIEW_MODES = new Set<AudioMixerViewMode>(['all', 'tone', 'bands']);

export const DEFAULT_AUDIO_MIXER_STATE: AudioMixerState = {
  enabled: true,
  preset: 'flat',
  viewMode: 'all',
  bass: 0,
  mid: 0,
  treble: 0,
  subBass: 0,
  presence: 0,
  air: 0,
  preamp: 0,
  balance: 0,
  compressor: false,
  antiClip: true,
  mono: false,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

function clampStep(value: unknown, min: number, max: number, step = 0.5, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(min, Math.min(max, value));
  const rounded = Math.round(clamped / step) * step;
  return Object.is(rounded, -0) ? 0 : Number(rounded.toFixed(2));
}

export function normalizeAudioMixerState(value: unknown): AudioMixerState {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const bandsInput = Array.isArray(input.bands) ? input.bands : [];
  const bands = MIXER_ISO_BANDS.map((_, index) =>
    clampStep(bandsInput[index], -12, 12, 0.5, 0)
  );

  const preset = typeof input.preset === 'string' && VALID_PRESET_IDS.has(input.preset as AudioMixerPresetId)
    ? (input.preset as AudioMixerPresetId)
    : DEFAULT_AUDIO_MIXER_STATE.preset;

  const viewMode = typeof input.viewMode === 'string' && VALID_VIEW_MODES.has(input.viewMode as AudioMixerViewMode)
    ? (input.viewMode as AudioMixerViewMode)
    : DEFAULT_AUDIO_MIXER_STATE.viewMode;

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_AUDIO_MIXER_STATE.enabled,
    preset,
    viewMode,
    bass: clampStep(input.bass, -15, 15, 0.5, 0),
    mid: clampStep(input.mid, -15, 15, 0.5, 0),
    treble: clampStep(input.treble, -15, 15, 0.5, 0),
    subBass: clampStep(input.subBass, -12, 12, 0.5, 0),
    presence: clampStep(input.presence, -12, 12, 0.5, 0),
    air: clampStep(input.air, -12, 12, 0.5, 0),
    preamp: clampStep(input.preamp, -12, 12, 0.5, 0),
    balance: clampStep(input.balance, -100, 100, 1, 0),
    compressor: typeof input.compressor === 'boolean' ? input.compressor : DEFAULT_AUDIO_MIXER_STATE.compressor,
    antiClip: typeof input.antiClip === 'boolean' ? input.antiClip : DEFAULT_AUDIO_MIXER_STATE.antiClip,
    mono: typeof input.mono === 'boolean' ? input.mono : DEFAULT_AUDIO_MIXER_STATE.mono,
    bands,
  };
}

export function applyMixerPreset(
  current: AudioMixerState,
  presetId: Exclude<AudioMixerPresetId, 'custom'>
): AudioMixerState {
  const found = AUDIO_MIXER_PRESETS.find(item => item.id === presetId) || AUDIO_MIXER_PRESETS[0];
  return normalizeAudioMixerState({
    ...current,
    enabled: true,
    preset: found.id,
    bass: found.bass,
    mid: found.mid,
    treble: found.treble,
    subBass: found.subBass,
    presence: found.presence,
    air: found.air,
    preamp: found.preamp,
    bands: [...found.bands],
  });
}

export function resetAudioMixerState(current?: AudioMixerState): AudioMixerState {
  return normalizeAudioMixerState({
    ...DEFAULT_AUDIO_MIXER_STATE,
    viewMode: current?.viewMode ?? DEFAULT_AUDIO_MIXER_STATE.viewMode,
    antiClip: current?.antiClip ?? DEFAULT_AUDIO_MIXER_STATE.antiClip,
  });
}

/**
 * Estimates the combined dB response at `freqHz` (20 Hz .. 20 kHz) from the tone controls
 * (Graves, Médios, Agudos, Sub-Bass, Presence, Air) and the 10-band ISO graphic equalizer.
 */
export function sampleMixerResponseDb(state: AudioMixerState, freqHz: number): number {
  if (!state.enabled) return 0;
  const f = Math.max(20, Math.min(20000, freqHz));

  const lowShelf = (fc: number, gainDb: number, slope = 1.6) => {
    if (gainDb === 0) return 0;
    const ratio = f / fc;
    return gainDb / (1 + Math.pow(ratio, 2 * slope));
  };

  const highShelf = (fc: number, gainDb: number, slope = 1.6) => {
    if (gainDb === 0) return 0;
    const ratio = fc / f;
    return gainDb / (1 + Math.pow(ratio, 2 * slope));
  };

  const bell = (fc: number, gainDb: number, q = 1.1) => {
    if (gainDb === 0) return 0;
    const octaves = Math.log2(f / fc);
    const bandwidth = 1 / Math.max(0.25, q);
    return gainDb * Math.exp(-(octaves * octaves) / (2 * bandwidth * bandwidth * 0.42));
  };

  let total = state.preamp;
  // Macro Tone & Contour filters
  total += lowShelf(55, state.subBass, 1.8);
  total += lowShelf(115, state.bass, 1.45);
  total += bell(1000, state.mid, 0.85);
  total += bell(2800, state.presence, 1.15);
  total += highShelf(7500, state.treble, 1.45);
  total += highShelf(13500, state.air, 1.8);

  // 10-Band ISO Graphic EQ filters
  for (let i = 0; i < MIXER_ISO_BANDS.length; i++) {
    const band = MIXER_ISO_BANDS[i];
    const gain = state.bands[i] || 0;
    if (gain === 0) continue;
    if (band.type === 'lowshelf') {
      total += lowShelf(band.freq * 1.25, gain, 1.7);
    } else if (band.type === 'highshelf') {
      total += highShelf(band.freq * 0.8, gain, 1.7);
    } else {
      total += bell(band.freq, gain, band.q);
    }
  }

  return total;
}

/**
 * Calculates the peak positive boost across the audible spectrum and returns
 * the effective preamp gain in dB (applying automatic headroom protection when antiClip is enabled).
 */
export function computeEffectivePreampDb(state: AudioMixerState): {
  effectivePreampDb: number;
  autoTrimDb: number;
  peakBoostDb: number;
} {
  if (!state.enabled) {
    return { effectivePreampDb: 0, autoTrimDb: 0, peakBoostDb: 0 };
  }
  let maxDb = state.preamp;
  const probeFreqs = [32, 48, 64, 90, 125, 180, 250, 350, 500, 700, 1000, 1400, 2000, 2800, 4000, 6000, 8000, 12000, 16000];
  for (const freq of probeFreqs) {
    const resp = sampleMixerResponseDb(state, freq);
    if (resp > maxDb) maxDb = resp;
  }
  const peakBoostDb = Math.max(0, maxDb - state.preamp);
  // If antiClip is enabled and total boost exceeds +1.5 dB, gently trim headroom to prevent digital clipping
  const excess = Math.max(0, maxDb - 1.5);
  const autoTrimDb = state.antiClip && excess > 0 ? -Math.min(15, Number((excess * 0.72).toFixed(1))) : 0;
  const effectivePreampDb = Math.max(-18, Math.min(12, Number((state.preamp + autoTrimDb).toFixed(2))));
  return {
    effectivePreampDb,
    autoTrimDb: Object.is(autoTrimDb, -0) ? 0 : autoTrimDb,
    peakBoostDb: Number(peakBoostDb.toFixed(1)),
  };
}

export function loadAudioMixerState(): AudioMixerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeAudioMixerState(JSON.parse(raw));
    }
  } catch {}
  return { ...DEFAULT_AUDIO_MIXER_STATE, bands: [...DEFAULT_AUDIO_MIXER_STATE.bands] };
}

export function saveAudioMixerState(state: AudioMixerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAudioMixerState(state)));
  } catch {}
}
