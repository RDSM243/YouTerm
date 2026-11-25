import React, { useEffect, useRef, useState } from 'react';
import { Sliders, RotateCcw, Power, ShieldCheck, Activity, Volume2, Radio } from 'lucide-react';
import type { AudioMixerPresetId, AudioMixerState, AudioMixerViewMode, ThemeConfig, Track } from '../types';
import {
  applyMixerPreset,
  AUDIO_MIXER_PRESETS,
  computeEffectivePreampDb,
  MIXER_ISO_BANDS,
  normalizeAudioMixerState,
  resetAudioMixerState,
  sampleMixerResponseDb,
} from '../services/audioMixerStorage';
import { audioEngine } from '../services/youtubeAudioEngine';

interface AudioMixerProps {
  theme: ThemeConfig;
  mixerState: AudioMixerState;
  onChangeMixer: (next: AudioMixerState) => void;
  isPlaying: boolean;
  currentTrack: Track | null;
}

function formatDb(value: number, showUnit = true): string {
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  const sign = clean > 0 ? '+' : '';
  return `${sign}${clean.toFixed(1)}${showUnit ? ' dB' : ''}`;
}

function formatBalance(balance: number): string {
  const rounded = Math.round(balance);
  if (rounded === 0) return 'CENTER';
  return rounded < 0 ? `L ${Math.abs(rounded)}%` : `R ${rounded}%`;
}

interface ToneChannelConfig {
  field: 'bass' | 'mid' | 'treble';
  title: string;
  subtitle: string;
  freqLabel: string;
  min: number;
  max: number;
}

const PRIMARY_TONE_CHANNELS: readonly ToneChannelConfig[] = [
  {
    field: 'bass',
    title: 'GRAVES / BASS',
    subtitle: 'Low-Shelf Filter',
    freqLabel: '100 Hz',
    min: -15,
    max: 15,
  },
  {
    field: 'mid',
    title: 'MÉDIOS / MID',
    subtitle: 'Peak Presence Bell',
    freqLabel: '1.0 kHz',
    min: -15,
    max: 15,
  },
  {
    field: 'treble',
    title: 'AGUDOS / TREBLE',
    subtitle: 'High-Shelf Filter',
    freqLabel: '8.0 kHz',
    min: -15,
    max: 15,
  },
];

interface ContourChannelConfig {
  field: 'subBass' | 'presence' | 'air' | 'preamp';
  title: string;
  freqLabel: string;
  min: number;
  max: number;
}

const CONTOUR_CHANNELS: readonly ContourChannelConfig[] = [
  { field: 'subBass', title: 'SUB-BASS (PUNCH)', freqLabel: '55 Hz', min: -12, max: 12 },
  { field: 'presence', title: 'PRESENÇA (VOCAL)', freqLabel: '2.8 kHz', min: -12, max: 12 },
  { field: 'air', title: 'BRILHO (AIR)', freqLabel: '13.5 kHz', min: -12, max: 12 },
  { field: 'preamp', title: 'PREAMP (GAIN)', freqLabel: 'MASTER', min: -12, max: 12 },
];

export const AudioMixer: React.FC<AudioMixerProps> = ({
  theme,
  mixerState,
  onChangeMixer,
  isPlaying,
  currentTrack,
}) => {
  const [peakDb, setPeakDb] = useState<number>(-96);
  const [rmsDb, setRmsDb] = useState<number>(-96);
  const faderTrackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const draggingBandRef = useRef<{ index: number; pointerId: number } | null>(null);

  const { effectivePreampDb, autoTrimDb, peakBoostDb } = computeEffectivePreampDb(mixerState);

  // Sample live output meter from Web Audio analyser when playing
  useEffect(() => {
    if (!isPlaying) {
      setPeakDb(-96);
      setRmsDb(-96);
      return;
    }

    let active = true;
    let timeBuffer: Uint8Array | null = null;
    const interval = setInterval(() => {
      if (!active || document.hidden) return;
      const analyser = audioEngine.getAnalyser();
      if (!analyser) return;
      if (!timeBuffer || timeBuffer.length !== analyser.fftSize) {
        timeBuffer = new Uint8Array(analyser.fftSize);
      }
      analyser.getByteTimeDomainData(timeBuffer);
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < timeBuffer.length; i++) {
        const norm = (timeBuffer[i] - 128) / 128;
        const abs = Math.abs(norm);
        if (abs > peak) peak = abs;
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / timeBuffer.length);
      const nextRms = rms > 0.0001 ? Math.max(-96, Math.min(0, 20 * Math.log10(rms))) : -96;
      const nextPeak = peak > 0.0001 ? Math.max(-96, Math.min(0, 20 * Math.log10(peak))) : -96;
      setRmsDb(Math.round(nextRms * 10) / 10);
      setPeakDb(Math.round(nextPeak * 10) / 10);
    }, 110);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isPlaying]);

  const updateMixer = (patch: Partial<AudioMixerState>, markCustom = true) => {
    const next = normalizeAudioMixerState({
      ...mixerState,
      ...patch,
      ...(markCustom && patch.preset === undefined ? { preset: 'custom' as const } : {}),
    });
    onChangeMixer(next);
  };

  const updateBand = (index: number, gainDb: number) => {
    const nextBands = [...mixerState.bands];
    nextBands[index] = gainDb;
    updateMixer({ bands: nextBands }, true);
  };

  const computeGainFromPointerY = (index: number, clientY: number): number => {
    const trackEl = faderTrackRefs.current[index];
    if (!trackEl) return mixerState.bands[index] || 0;
    const rect = trackEl.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const norm = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
    const rawDb = -12 + norm * 24;
    return Math.round(rawDb * 2) / 2;
  };

  // Build SVG path for real-time frequency response curve (20 Hz to 20 kHz)
  const curvePoints = React.useMemo(() => {
    const width = 420;
    const height = 96;
    const steps = 64;
    const minFreq = 20;
    const maxFreq = 20000;
    const maxRangeDb = 18;
    const pts: string[] = [];
    const fillPts: string[] = [`0,${height / 2}`];

    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps;
      const freq = minFreq * Math.pow(maxFreq / minFreq, ratio);
      const db = sampleMixerResponseDb(mixerState, freq);
      const clampedDb = Math.max(-maxRangeDb, Math.min(maxRangeDb, db));
      const x = (ratio * width).toFixed(1);
      const y = (height / 2 - (clampedDb / maxRangeDb) * (height / 2 - 8)).toFixed(1);
      pts.push(`${x},${y}`);
      fillPts.push(`${x},${y}`);
    }
    fillPts.push(`${width},${height / 2}`);
    return {
      polyline: pts.join(' '),
      polygon: fillPts.join(' '),
      width,
      height,
    };
  }, [mixerState]);

  const peakNorm = Math.max(0, Math.min(100, Math.round(((peakDb + 60) / 60) * 100)));
  const rmsNorm = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));
  const isClipping = isPlaying && peakDb >= -0.4;

  const panelStyle = {
    borderColor: theme.border,
    backgroundColor: 'var(--app-surface-card-bg)',
    color: theme.text,
  };

  return (
    <section
      aria-label="Audio mixer and equalizer"
      className="mixer-root skin-panel flex-1 flex flex-col min-h-0 min-w-0 relative select-none font-mono overflow-hidden text-xs w-full h-full"
      style={{ backgroundColor: 'var(--app-surface-bg)', color: theme.text }}
    >
      {/* Top Mixer Console Header */}
      <header
        className="mixer-header px-3 py-2 border-b flex shrink-0 flex-wrap items-center justify-between gap-2 z-10"
        style={panelStyle}
      >
        <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-2">
          <Sliders className="w-3.5 h-3.5 shrink-0" style={{ color: theme.accent }} />
          <h2 className="mixer-title-full truncate font-bold text-xs" style={{ color: theme.highlight }}>
            ┌─ Studio Audio Mixer &amp; 10-Band EQ ─
          </h2>
          <h2 className="mixer-title-short truncate font-bold text-xs" style={{ color: theme.highlight }}>
            ┌─ Audio Mixer ─
          </h2>
          <button
            type="button"
            aria-label={mixerState.enabled ? 'Disable audio mixer (Bypass)' : 'Enable audio mixer'}
            aria-pressed={mixerState.enabled}
            onClick={() => updateMixer({ enabled: !mixerState.enabled }, false)}
            className="px-2 py-0.5 border text-[10px] font-bold flex items-center gap-1 hover:brightness-125 transition-all shrink-0"
            style={{
              borderColor: mixerState.enabled ? theme.accent : theme.border,
              color: mixerState.enabled ? theme.accent : theme.textDim,
              backgroundColor: mixerState.enabled ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
            }}
            title="Toggle Master Equalizer & Tone Processing"
          >
            <Power className="w-2.5 h-2.5 shrink-0" />
            <span>{mixerState.enabled ? '● EQ ON' : '○ BYPASS'}</span>
          </button>
        </div>

        {/* Preset Selector, View Mode Tabs & Reset */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <label className="flex items-center gap-1">
            <span className="mixer-preset-label text-[10px]" style={{ color: theme.textDim }}>Preset:</span>
            <select
              aria-label="Equalizer preset"
              value={mixerState.preset}
              onChange={(e) => {
                const value = e.target.value as AudioMixerPresetId;
                if (value !== 'custom') {
                  onChangeMixer(applyMixerPreset(mixerState, value));
                }
              }}
              className="border px-2 py-0.5 text-[11px] outline-none max-w-[11.5rem]"
              style={{
                borderColor: theme.border,
                backgroundColor: theme.bg,
                color: theme.highlight,
              }}
            >
              {AUDIO_MIXER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
              {mixerState.preset === 'custom' && <option value="custom">* Custom Curve</option>}
            </select>
          </label>

          {(['all', 'tone', 'bands'] as readonly AudioMixerViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={`Mixer view: ${mode}`}
              aria-pressed={mixerState.viewMode === mode}
              onClick={() => updateMixer({ viewMode: mode }, false)}
              className="px-2 py-0.5 border uppercase font-bold text-[10px] hover:brightness-125 transition-all"
              style={{
                borderColor: mixerState.viewMode === mode ? theme.accent : theme.border,
                color: mixerState.viewMode === mode ? theme.highlight : theme.textDim,
                backgroundColor: mixerState.viewMode === mode ? 'rgba(255,255,255,0.07)' : 'var(--app-surface-bg)',
              }}
            >
              [{mode === 'all' ? 'ALL' : mode === 'tone' ? 'TONE' : '10-EQ'}]
            </button>
          ))}

          <button
            type="button"
            aria-label="Reset mixer to 0 dB"
            onClick={() => onChangeMixer(resetAudioMixerState(mixerState))}
            title="Reset all Graves, Médios, Agudos and EQ bands to 0 dB"
            className="px-2 py-0.5 border flex items-center gap-1 text-[10px] hover:brightness-125 transition-all"
            style={{
              borderColor: theme.border,
              color: theme.textDim,
              backgroundColor: 'var(--app-surface-bg)',
            }}
          >
            <RotateCcw className="w-2.5 h-2.5 shrink-0" />
            <span className="mixer-reset-label">Reset</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Console Stage */}
      <div className="mixer-body custom-scrollbar flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        {/* 1. Primary 3-Band Tone Console: GRAVES (Bass), MÉDIOS (Mid), AGUDOS (Treble) */}
        {(mixerState.viewMode === 'all' || mixerState.viewMode === 'tone') && (
          <div className="mixer-tone-grid grid grid-cols-1 gap-2.5">
            {PRIMARY_TONE_CHANNELS.map((channel) => {
              const value = mixerState[channel.field];
              const norm = (value - channel.min) / (channel.max - channel.min); // 0 to 1
              const totalCells = 20;
              const centerCell = totalCells / 2;
              const activeCell = Math.round(norm * totalCells);
              const isBoosted = value > 0.05;
              const isCut = value < -0.05;

              return (
                <div
                  key={channel.field}
                  className="border p-2.5 flex flex-col gap-1.5"
                  style={{
                    borderColor: isBoosted || isCut ? theme.accent : theme.border,
                    backgroundColor: 'var(--app-surface-card-bg)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs tracking-tight" style={{ color: theme.highlight }}>
                          {channel.title}
                        </span>
                        <span
                          className="px-1.5 py-0.2 border text-[9px]"
                          style={{ borderColor: theme.border, color: theme.textDim }}
                        >
                          {channel.freqLabel}
                        </span>
                      </div>
                      <span className="block text-[10px] truncate" style={{ color: theme.textDim }}>
                        {channel.subtitle}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => updateMixer({ [channel.field]: 0 })}
                      title={`Click to reset ${channel.title} to 0.0 dB`}
                      className="px-2 py-0.5 border font-bold text-[11px] tabular-nums hover:brightness-125 shrink-0"
                      style={{
                        borderColor: isBoosted ? theme.accent : isCut ? theme.warning : theme.border,
                        color: isBoosted ? theme.accent : isCut ? theme.warning : theme.text,
                        backgroundColor: theme.bg,
                      }}
                    >
                      {formatDb(value)}
                    </button>
                  </div>

                  {/* Bipolar Segmented LED Meter (-15 dB .. 0 dB .. +15 dB) */}
                  <div
                    aria-hidden="true"
                    className="grid grid-cols-20 gap-0.5 h-2.5 p-0.5 border"
                    style={{ borderColor: theme.border, backgroundColor: '#050709' }}
                  >
                    {Array.from({ length: totalCells }).map((_, idx) => {
                      const lit =
                        value > 0
                          ? idx >= centerCell && idx < activeCell
                          : value < 0
                            ? idx >= activeCell && idx < centerCell
                            : false;
                      const isExtreme = idx >= totalCells - 2;
                      const cellColor = !lit
                        ? 'rgba(255,255,255,0.05)'
                        : isExtreme
                          ? theme.error
                          : value > 0
                            ? theme.accent
                            : theme.warning;
                      return (
                        <span
                          key={idx}
                          className="block h-full"
                          style={{ backgroundColor: cellColor }}
                        />
                      );
                    })}
                  </div>

                  {/* Interactive Range Slider + Fine Step Controls */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Decrease ${channel.title}`}
                      onClick={() => updateMixer({ [channel.field]: Math.max(channel.min, value - 0.5) })}
                      className="border px-1.5 py-0.5 text-[10px] font-bold hover:brightness-125"
                      style={{ borderColor: theme.border, backgroundColor: theme.bg, color: theme.textDim }}
                    >
                      -
                    </button>
                    <input
                      type="range"
                      aria-label={`${channel.title} (${channel.freqLabel})`}
                      aria-valuetext={formatDb(value)}
                      min={channel.min}
                      max={channel.max}
                      step={0.5}
                      value={value}
                      onDoubleClick={() => updateMixer({ [channel.field]: 0 })}
                      onChange={(e) => updateMixer({ [channel.field]: parseFloat(e.target.value) })}
                      className="flex-1 min-w-0 cursor-pointer"
                      style={{ accentColor: theme.accent }}
                    />
                    <button
                      type="button"
                      aria-label={`Increase ${channel.title}`}
                      onClick={() => updateMixer({ [channel.field]: Math.min(channel.max, value + 0.5) })}
                      className="border px-1.5 py-0.5 text-[10px] font-bold hover:brightness-125"
                      style={{ borderColor: theme.border, backgroundColor: theme.bg, color: theme.textDim }}
                    >
                      +
                    </button>
                  </div>

                  <div className="flex justify-between text-[9px] tabular-nums" style={{ color: theme.textDim }}>
                    <span>{channel.min}dB</span>
                    <button
                      type="button"
                      onClick={() => updateMixer({ [channel.field]: 0 })}
                      className="hover:underline"
                      style={{ color: value === 0 ? theme.highlight : theme.textDim }}
                    >
                      0dB
                    </button>
                    <span>+{channel.max}dB</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 2. Extended Contour & Master Bus (Sub-Bass, Presença, Brilho/Air, Preamp, Balance L/R) */}
        {(mixerState.viewMode === 'all' || mixerState.viewMode === 'tone') && (
          <div
            className="border p-2.5 flex flex-col gap-2"
            style={panelStyle}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5" style={{ borderColor: theme.border }}>
              <span className="font-bold text-[11px]" style={{ color: theme.highlight }}>
                ┌─ Acoustic Contour, Preamp &amp; Stereo Balance ─
              </span>
              {mixerState.antiClip && autoTrimDb < 0 && (
                <span
                  className="px-1.5 py-0.5 border text-[9px] font-bold"
                  style={{ borderColor: theme.warning, color: theme.warning }}
                  title="Anti-Clip automatically attenuated preamp headroom to prevent distortion"
                >
                  ANTI-CLIP TRIM: {formatDb(autoTrimDb)} (EFF: {formatDb(effectivePreampDb)})
                </span>
              )}
            </div>

            <div className="mixer-contour-grid grid grid-cols-1 gap-2.5">
              {CONTOUR_CHANNELS.map((item) => {
                const val = mixerState[item.field];
                return (
                  <div
                    key={item.field}
                    className="border p-2 flex flex-col gap-1"
                    style={{ borderColor: theme.border, backgroundColor: theme.bg }}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="font-bold truncate" style={{ color: theme.text }}>
                        {item.title}{' '}
                        <span style={{ color: theme.textDim }}>({item.freqLabel})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => updateMixer({ [item.field]: 0 })}
                        title={`Reset ${item.title} to 0.0 dB`}
                        className="font-bold tabular-nums px-1 border hover:brightness-125"
                        style={{
                          borderColor: val !== 0 ? theme.accent : theme.border,
                          color: val > 0 ? theme.accent : val < 0 ? theme.warning : theme.textDim,
                        }}
                      >
                        {formatDb(val)}
                      </button>
                    </div>
                    <input
                      type="range"
                      aria-label={item.title}
                      aria-valuetext={formatDb(val)}
                      min={item.min}
                      max={item.max}
                      step={0.5}
                      value={val}
                      onDoubleClick={() => updateMixer({ [item.field]: 0 })}
                      onChange={(e) => updateMixer({ [item.field]: parseFloat(e.target.value) })}
                      className="w-full cursor-pointer"
                      style={{ accentColor: theme.accent }}
                    />
                  </div>
                );
              })}

              {/* Stereo Balance (L / R Pan) */}
              <div
                className="border p-2 flex flex-col gap-1"
                style={{ borderColor: theme.border, backgroundColor: theme.bg }}
              >
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span className="font-bold truncate" style={{ color: theme.text }}>
                    BALANÇO ESTÉREO <span style={{ color: theme.textDim }}>(L / R PAN)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => updateMixer({ balance: 0 }, false)}
                    title="Reset Stereo Balance to Center"
                    className="font-bold tabular-nums px-1 border hover:brightness-125"
                    style={{
                      borderColor: mixerState.balance !== 0 ? theme.accent : theme.border,
                      color: mixerState.balance !== 0 ? theme.accent : theme.textDim,
                    }}
                  >
                    {formatBalance(mixerState.balance)}
                  </button>
                </div>
                <input
                  type="range"
                  aria-label="Stereo balance L/R"
                  aria-valuetext={formatBalance(mixerState.balance)}
                  min={-100}
                  max={100}
                  step={1}
                  value={mixerState.balance}
                  onDoubleClick={() => updateMixer({ balance: 0 }, false)}
                  onChange={(e) => updateMixer({ balance: parseInt(e.target.value, 10) }, false)}
                  className="w-full cursor-pointer"
                  style={{ accentColor: theme.accent }}
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. Live Frequency Response Curve & Output Level Meter */}
        <div
          className="border p-2.5 flex flex-col gap-2"
          style={panelStyle}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <span className="font-bold" style={{ color: theme.highlight }}>
              ┌─ Frequency Response Curve (20 Hz – 20 kHz) ─
            </span>
            <div className="flex flex-wrap items-center gap-2 tabular-nums">
              <span style={{ color: theme.textDim }}>
                PEAK BOOST: <strong style={{ color: theme.accent }}>+{peakBoostDb.toFixed(1)} dB</strong>
              </span>
              <span style={{ color: theme.textDim }}>
                EFF PREAMP: <strong style={{ color: effectivePreampDb < 0 ? theme.warning : theme.highlight }}>{formatDb(effectivePreampDb)}</strong>
              </span>
              <span
                className="px-1.5 py-0.2 border font-bold"
                style={{
                  borderColor: isClipping ? theme.error : theme.border,
                  color: isClipping ? theme.error : isPlaying ? theme.accent : theme.textDim,
                }}
              >
                {isClipping ? '▲ CLIP' : isPlaying ? `OUT: ${peakDb > -90 ? `${peakDb.toFixed(1)} dB` : '--'}` : 'STANDBY'}
              </span>
            </div>
          </div>

          <div
            className="relative w-full h-24 border overflow-hidden"
            style={{ borderColor: theme.border, backgroundColor: '#040608' }}
          >
            <svg
              viewBox={`0 0 ${curvePoints.width} ${curvePoints.height}`}
              preserveAspectRatio="none"
              className="w-full h-full block"
              aria-label="Equalizer frequency response curve"
            >
              {/* Horizontal dB grid lines (+12dB, 0dB, -12dB) */}
              <line x1="0" y1="18" x2={curvePoints.width} y2="18" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
              <line x1="0" y1={curvePoints.height / 2} x2={curvePoints.width} y2={curvePoints.height / 2} stroke="rgba(255,255,255,0.22)" />
              <line x1="0" y1={curvePoints.height - 18} x2={curvePoints.width} y2={curvePoints.height - 18} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />

              {/* Region dividers: GRAVES (<250Hz) | MÉDIOS (250Hz-4kHz) | AGUDOS (>4kHz) */}
              <line x1="153" y1="0" x2="153" y2={curvePoints.height} stroke="rgba(255,255,255,0.1)" strokeDasharray="2 4" />
              <line x1="322" y1="0" x2="322" y2={curvePoints.height} stroke="rgba(255,255,255,0.1)" strokeDasharray="2 4" />

              {/* Filled response area */}
              <polygon
                points={curvePoints.polygon}
                fill={mixerState.enabled ? theme.accent : theme.textDim}
                fillOpacity={mixerState.enabled ? 0.16 : 0.06}
              />

              {/* Response trace */}
              <polyline
                fill="none"
                stroke={mixerState.enabled ? theme.accent : theme.textDim}
                strokeWidth="2.2"
                points={curvePoints.polyline}
              />
            </svg>

            {/* Overlay Region Labels */}
            <div className="pointer-events-none absolute inset-x-2 top-1 flex justify-between text-[9px] font-bold opacity-75">
              <span style={{ color: theme.accent }}>GRAVES (LOW)</span>
              <span style={{ color: theme.highlight }}>MÉDIOS (MID)</span>
              <span style={{ color: theme.warning }}>AGUDOS (HIGH)</span>
            </div>
            <div className="pointer-events-none absolute left-1.5 bottom-1 text-[9px]" style={{ color: theme.textDim }}>
              -12dB / 0dB / +12dB
            </div>
            <div className="pointer-events-none absolute right-1.5 bottom-1 text-[9px] truncate max-w-[60%]" style={{ color: theme.textDim }}>
              {currentTrack ? `${currentTrack.title}` : '20Hz .. 20kHz'}
            </div>
          </div>

          {/* Live Output Bar Meter */}
          <div className="flex items-center gap-2 text-[10px]">
            <span className="w-12 shrink-0 font-bold" style={{ color: theme.textDim }}>MASTER:</span>
            <div
              className="flex-1 h-2.5 border relative overflow-hidden"
              style={{ borderColor: theme.border, backgroundColor: '#050709' }}
            >
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${rmsNorm}%`,
                  backgroundColor: peakNorm > 92 ? theme.error : peakNorm > 78 ? theme.warning : theme.accent,
                }}
              />
              {peakNorm > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5"
                  style={{
                    left: `calc(${peakNorm}% - 1px)`,
                    backgroundColor: peakNorm > 92 ? theme.error : theme.highlight,
                  }}
                />
              )}
            </div>
            <span className="w-16 text-right tabular-nums shrink-0" style={{ color: theme.textDim }}>
              {isPlaying && rmsDb > -90 ? `${rmsDb.toFixed(1)} dB` : '-∞ dB'}
            </span>
          </div>
        </div>

        {/* 4. 10-Band ISO Graphic Equalizer (32Hz .. 16kHz) */}
        {(mixerState.viewMode === 'all' || mixerState.viewMode === 'bands') && (
          <div
            className="border p-2.5 flex flex-col gap-2"
            style={panelStyle}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[11px]" style={{ color: theme.highlight }}>
                ┌─ 10-Band ISO Octave Graphic Equalizer (-12 dB to +12 dB) ─
              </span>
              <span className="text-[10px]" style={{ color: theme.textDim }}>
                Click any dB badge or double-click a fader to reset band to 0 dB
              </span>
            </div>

            <div className="mixer-bands-grid grid grid-cols-5 sm:grid-cols-10 gap-1.5 pt-1">
              {MIXER_ISO_BANDS.map((band, index) => {
                const gain = mixerState.bands[index] || 0;
                const norm = (gain + 12) / 24; // 0 to 1
                const regionColor =
                  band.region === 'low'
                    ? theme.accent
                    : band.region === 'mid'
                      ? theme.highlight
                      : theme.warning;

                return (
                  <div
                    key={band.freq}
                    className="border p-1.5 flex flex-col items-center gap-1.5"
                    style={{
                      borderColor: gain !== 0 ? regionColor : theme.border,
                      backgroundColor: theme.bg,
                    }}
                  >
                    {/* Top dB readout badge (click to reset band) */}
                    <button
                      type="button"
                      onClick={() => updateBand(index, 0)}
                      title={`Reset ${band.label} to 0 dB`}
                      className="w-full text-center py-0.5 border text-[10px] font-bold tabular-nums hover:brightness-125"
                      style={{
                        borderColor: gain !== 0 ? regionColor : theme.border,
                        color: gain > 0 ? regionColor : gain < 0 ? theme.warning : theme.textDim,
                      }}
                    >
                      {formatDb(gain, false)}
                    </button>

                    {/* Custom Vertical Fader Track with Pointer Capture & Keyboard Support */}
                    <div
                      ref={(el) => { faderTrackRefs.current[index] = el; }}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${band.label} graphic EQ band (${band.region})`}
                      aria-valuemin={-12}
                      aria-valuemax={12}
                      aria-valuenow={gain}
                      aria-valuetext={`${band.label}: ${formatDb(gain)}`}
                      onDoubleClick={() => updateBand(index, 0)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          updateBand(index, Math.min(12, gain + 0.5));
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                          e.preventDefault();
                          updateBand(index, Math.max(-12, gain - 0.5));
                        } else if (e.key === 'Home') {
                          e.preventDefault();
                          updateBand(index, 0);
                        }
                      }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.currentTarget.focus({ preventScroll: true });
                        e.currentTarget.setPointerCapture(e.pointerId);
                        draggingBandRef.current = { index, pointerId: e.pointerId };
                        updateBand(index, computeGainFromPointerY(index, e.clientY));
                      }}
                      onPointerMove={(e) => {
                        const drag = draggingBandRef.current;
                        if (!drag || drag.index !== index || drag.pointerId !== e.pointerId) return;
                        updateBand(index, computeGainFromPointerY(index, e.clientY));
                      }}
                      onPointerUp={(e) => {
                        if (draggingBandRef.current?.pointerId === e.pointerId) {
                          draggingBandRef.current = null;
                        }
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      }}
                      onPointerCancel={(e) => {
                        if (draggingBandRef.current?.pointerId === e.pointerId) {
                          draggingBandRef.current = null;
                        }
                      }}
                      className="mixer-fader-track relative w-6 h-28 border cursor-ns-resize touch-none flex flex-col justify-between p-0.5"
                      style={{ borderColor: theme.border, backgroundColor: '#050709' }}
                    >
                      {/* Center 0 dB reference line */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t"
                        style={{ borderColor: 'rgba(255,255,255,0.28)' }}
                      />

                      {/* Active bipolar fill from center 50% */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1"
                        style={{
                          top: gain >= 0 ? `${(1 - norm) * 100}%` : '50%',
                          bottom: gain >= 0 ? '50%' : `${norm * 100}%`,
                          backgroundColor: regionColor,
                          opacity: 0.45,
                        }}
                      />

                      {/* Thumb handle */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0.5 h-2.5 -translate-y-1/2 border"
                        style={{
                          top: `${(1 - norm) * 100}%`,
                          backgroundColor: gain !== 0 ? regionColor : theme.text,
                          borderColor: '#000000',
                        }}
                      />
                    </div>

                    {/* Frequency & Region Label */}
                    <div className="flex flex-col items-center leading-tight">
                      <span className="font-bold text-[10px]" style={{ color: theme.highlight }}>
                        {band.shortLabel}
                      </span>
                      <span className="text-[8px] uppercase" style={{ color: regionColor }}>
                        {band.region}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom DSP Hardware Switches & Telemetry Footer */}
      <footer
        className="mixer-footer px-3 py-2 border-t flex flex-wrap items-center justify-between gap-2 text-[10px] shrink-0"
        style={panelStyle}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={mixerState.antiClip}
            onClick={() => updateMixer({ antiClip: !mixerState.antiClip }, false)}
            title="Automatic Preamp Headroom Protection (prevents digital clipping on heavy bass/treble boosts)"
            className="px-2 py-0.5 border font-bold flex items-center gap-1 hover:brightness-125 transition-all"
            style={{
              borderColor: mixerState.antiClip ? theme.accent : theme.border,
              color: mixerState.antiClip ? theme.accent : theme.textDim,
              backgroundColor: mixerState.antiClip ? 'rgba(0, 240, 255, 0.08)' : 'var(--app-surface-bg)',
            }}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>[ANTI-CLIP: {mixerState.antiClip ? 'ON' : 'OFF'}]</span>
          </button>

          <button
            type="button"
            aria-pressed={mixerState.compressor}
            onClick={() => updateMixer({ compressor: !mixerState.compressor }, false)}
            title="Dynamic Range Loudness Compressor (normalizes quiet and loud passages)"
            className="px-2 py-0.5 border font-bold flex items-center gap-1 hover:brightness-125 transition-all"
            style={{
              borderColor: mixerState.compressor ? theme.accent : theme.border,
              color: mixerState.compressor ? theme.accent : theme.textDim,
              backgroundColor: mixerState.compressor ? 'rgba(0, 240, 255, 0.08)' : 'var(--app-surface-bg)',
            }}
          >
            <Activity className="w-3 h-3 shrink-0" />
            <span>[COMPRESSOR: {mixerState.compressor ? 'ON' : 'OFF'}]</span>
          </button>

          <button
            type="button"
            aria-pressed={mixerState.mono}
            onClick={() => updateMixer({ mono: !mixerState.mono }, false)}
            title="Switch between Stereo and Mono (L+R sum) output"
            className="px-2 py-0.5 border font-bold flex items-center gap-1 hover:brightness-125 transition-all"
            style={{
              borderColor: mixerState.mono ? theme.warning : theme.border,
              color: mixerState.mono ? theme.warning : theme.textDim,
              backgroundColor: mixerState.mono ? 'rgba(234, 179, 8, 0.08)' : 'var(--app-surface-bg)',
            }}
          >
            {mixerState.mono ? <Radio className="w-3 h-3 shrink-0" /> : <Volume2 className="w-3 h-3 shrink-0" />}
            <span>[OUT: {mixerState.mono ? 'MONO' : 'STEREO'}]</span>
          </button>
        </div>

        <div className="mixer-summary flex flex-wrap items-center gap-x-2.5 gap-y-1 tabular-nums" style={{ color: theme.textDim }}>
          <span>
            GRAVES: <strong style={{ color: theme.accent }}>{formatDb(mixerState.bass)}</strong>
          </span>
          <span>
            MÉDIOS: <strong style={{ color: theme.highlight }}>{formatDb(mixerState.mid)}</strong>
          </span>
          <span>
            AGUDOS: <strong style={{ color: theme.warning }}>{formatDb(mixerState.treble)}</strong>
          </span>
        </div>
      </footer>
    </section>
  );
};
