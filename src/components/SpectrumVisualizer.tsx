import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Activity, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ThemeConfig, Track } from '../types';
import { audioEngine } from '../services/youtubeAudioEngine';
import { loadPlayerPreferences, savePlayerPreferences } from '../services/libraryStorage';
import { surfaceColor } from '../services/background';
import {
  computeBarLayout,
  DEFAULT_SPECTRUM_CONFIG,
  interpolateColorStops,
  loadSpectrumConfig,
  normalizeSpectrumConfig,
  saveSpectrumConfig,
  SPECTRUM_GRADIENT_PRESETS,
  SPECTRUM_PROFILE_PRESETS,
  SPECTRUM_SOLID_SWATCHES,
  type SpectrumConfig,
} from '../services/spectrumConfig';

interface SpectrumVisualizerProps {
  theme: ThemeConfig;
  isPlaying: boolean;
  currentTrack: Track | null;
  maxFrameRate?: number;
  showBackground?: boolean;
}

const MAX_BARS = 128;
const MIN_FREQ = 32;
const MAX_FREQ = 16000;

const ISO_FREQUENCIES = [
  { freq: 32, label: '32' },
  { freq: 64, label: '64' },
  { freq: 125, label: '125' },
  { freq: 250, label: '250' },
  { freq: 500, label: '500' },
  { freq: 1000, label: '1k' },
  { freq: 2000, label: '2k' },
  { freq: 4000, label: '4k' },
  { freq: 8000, label: '8k' },
  { freq: 16000, label: '16k' },
];

const DB_MARKERS = [
  { db: 0, label: ' 0dB' },
  { db: -12, label: '-12dB' },
  { db: -24, label: '-24dB' },
  { db: -36, label: '-36dB' },
  { db: -48, label: '-48dB' },
];

const GAIN_PRESETS = [0, 0.6, 0.8, 1.0, 1.4, 2.0];

function freqToNote(freq: number): string {
  if (freq < 20 || freq > 20000 || !Number.isFinite(freq)) return '--';
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  if (midi < 12 || midi > 127) return `${Math.round(freq)} Hz`;
  const noteName = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteName}${octave} (${Math.round(freq)} Hz)`;
}

function measureChannelDb(analyser: AnalyserNode, buffer: Uint8Array): number {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const normalized = (buffer[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / buffer.length);
  if (rms <= 0.0001) return -96;
  return Math.max(-96, Math.min(0, Math.round(20 * Math.log10(rms) * 10) / 10));
}

function fillRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  if (w <= 0 || h <= 0) return;
  const r = Math.min(radius, w / 2, h / 2);
  if (r < 0.75) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  ctx.fill();
}

function getGradientStops(config: SpectrumConfig, theme: ThemeConfig): string[] {
  if (config.colorMode === 'solid') return [config.solidColor];
  if (config.colorMode === 'gradient') {
    return config.gradientUseMid
      ? [config.gradientBottom, config.gradientMid, config.gradientTop]
      : [config.gradientBottom, config.gradientTop];
  }
  return [theme.accent, theme.highlight, theme.warning, theme.error];
}

function buildBarFillStyle(
  ctx: CanvasRenderingContext2D,
  config: SpectrumConfig,
  theme: ThemeConfig,
  topMargin: number,
  plotHeight: number,
): string | CanvasGradient {
  if (config.colorMode === 'solid') {
    return config.solidColor;
  }
  const stops = getGradientStops(config, theme);
  const maxReach = plotHeight * (config.heightScale / 100);

  if (config.orientation === 'mirror') {
    const centerY = topMargin + plotHeight / 2;
    const halfReach = maxReach / 2;
    const grad = ctx.createLinearGradient(0, centerY - halfReach, 0, centerY + halfReach);
    if (config.colorMode === 'theme') {
      grad.addColorStop(0, theme.error);
      grad.addColorStop(0.15, theme.warning);
      grad.addColorStop(0.5, theme.accent);
      grad.addColorStop(0.85, theme.warning);
      grad.addColorStop(1, theme.error);
    } else if (stops.length === 3) {
      grad.addColorStop(0, stops[2]);
      grad.addColorStop(0.25, stops[1]);
      grad.addColorStop(0.5, stops[0]);
      grad.addColorStop(0.75, stops[1]);
      grad.addColorStop(1, stops[2]);
    } else {
      grad.addColorStop(0, stops[1]);
      grad.addColorStop(0.5, stops[0]);
      grad.addColorStop(1, stops[1]);
    }
    return grad;
  }

  const isTop = config.orientation === 'top';
  const yStart = isTop ? topMargin : topMargin + plotHeight;
  const yEnd = isTop ? topMargin + maxReach : topMargin + plotHeight - maxReach;
  const grad = ctx.createLinearGradient(0, yStart, 0, yEnd);

  if (config.colorMode === 'theme') {
    grad.addColorStop(0, theme.accent);
    grad.addColorStop(0.65, theme.highlight);
    grad.addColorStop(0.84, theme.warning);
    grad.addColorStop(1, theme.error);
  } else if (stops.length === 3) {
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.55, stops[1]);
    grad.addColorStop(1, stops[2]);
  } else {
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(1, stops[1]);
  }
  return grad;
}

function getBlockColor(config: SpectrumConfig, theme: ThemeConfig, ratio: number): string {
  if (config.colorMode === 'solid') return config.solidColor;
  if (config.colorMode === 'theme') {
    if (ratio >= 0.875) return theme.error;
    if (ratio >= 0.72) return theme.warning;
    if (ratio >= 0.45) return theme.highlight;
    return theme.accent;
  }
  const stops = getGradientStops(config, theme);
  return interpolateColorStops(stops, ratio);
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({
  theme,
  isPlaying,
  currentTrack,
  maxFrameRate = 60,
  showBackground = false,
}) => {
  const surfaceOpacity = showBackground ? 0 : 1;
  const [config, setConfig] = useState<SpectrumConfig>(() => {
    const legacySens = loadPlayerPreferences().spectrumSensitivity;
    return loadSpectrumConfig(legacySens);
  });
  const [showConfig, setShowConfig] = useState(false);
  const [fps, setFps] = useState<number>(0);
  const [leftDb, setLeftDb] = useState<number>(-96);
  const [rightDb, setRightDb] = useState<number>(-96);
  const [peakNote, setPeakNote] = useState<string>('--');
  const [renderedBars, setRenderedBars] = useState<number>(0);
  const [liveAutoGain, setLiveAutoGain] = useState<number>(1.0);
  const configPanelId = useId();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const scheduleDrawRef = useRef<(() => void) | null>(null);

  // Live refs so changing settings/theme never tears down the animation loop
  const configRef = useRef(config);
  const themeRef = useRef(theme);
  const isPlayingRef = useRef(isPlaying);
  const maxFrameRateRef = useRef(maxFrameRate);
  const surfaceOpacityRef = useRef(surfaceOpacity);

  configRef.current = config;
  themeRef.current = theme;
  isPlayingRef.current = isPlaying;
  maxFrameRateRef.current = maxFrameRate;
  surfaceOpacityRef.current = surfaceOpacity;

  // Physics state buffers (fixed max capacity, sliced dynamically to activeBars)
  const barValuesRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const barVelocitiesRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const peakValuesRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const peakVelocitiesRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const peakHoldMsRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const autoGainRef = useRef<number>(1.0);

  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const lastMetricsUpdateRef = useRef(0);
  const lastActiveBarsRef = useRef(0);
  const silenceSinceRef = useRef<number | null>(null);

  const updateConfig = useCallback((patch: Partial<SpectrumConfig>) => {
    setConfig(prev => {
      const next = normalizeSpectrumConfig({ ...prev, ...patch });
      saveSpectrumConfig(next);
      if (patch.sensitivity !== undefined) {
        savePlayerPreferences({ spectrumSensitivity: next.sensitivity });
      }
      return next;
    });
  }, []);

  // Re-trigger render when paused and visual config/theme/play state changes
  useEffect(() => {
    scheduleDrawRef.current?.();
  }, [config, theme, isPlaying, surfaceOpacity, maxFrameRate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    let lastRender = 0;
    let lastPhysics = performance.now();
    let freqDataBuffer: Uint8Array | null = null;
    let timeDataBuffer: Uint8Array | null = null;
    let leftTimeBuffer: Uint8Array | null = null;
    let rightTimeBuffer: Uint8Array | null = null;

    const render = (now: number) => {
      animFrameRef.current = null;
      if (!running) return;

      const targetFrameRate = maxFrameRateRef.current;
      if (document.hidden || (lastRender > 0 && now - lastRender < 1000 / targetFrameRate)) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const dtMs = lastRender > 0 ? Math.min(80, Math.max(4, now - lastPhysics)) : 16.6667;
      const dtScale = dtMs / 16.6667;
      lastRender = now;
      lastPhysics = now;

      const cfg = configRef.current;
      const thm = themeRef.current;
      const playing = isPlayingRef.current;
      const bgOpacity = surfaceOpacityRef.current;

      // FPS counter
      frameCountRef.current++;
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // HiDPI sizing (rounded to integer backing pixels so fractional DPR never reallocates every frame)
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(24, Math.floor(rect.width));
      const height = Math.max(24, Math.floor(rect.height));
      const targetBackingW = Math.max(24, Math.round(width * dpr));
      const targetBackingH = Math.max(24, Math.round(height * dpr));

      if (canvas.width !== targetBackingW || canvas.height !== targetBackingH) {
        canvas.width = targetBackingW;
        canvas.height = targetBackingH;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background clear
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = surfaceColor(thm.bg, bgOpacity);
      ctx.fillRect(0, 0, width, height);

      // Compute margins & bar geometry first so FFT extracts exact band count
      const compactW = width < 320;
      const tinyW = width < 220 || height < 72;
      const compactH = height < 180;
      const tinyH = height < 120;
      const showLabels = cfg.showGrid && !tinyW;
      const leftMargin = cfg.showGrid ? (tinyW ? 8 : compactW ? 32 : 44) : 8;
      const rightMargin = cfg.showGrid ? (compactW ? 8 : 14) : 8;
      const topMargin = cfg.showGrid ? (tinyH ? 8 : compactH ? 12 : 18) : 8;
      const bottomMargin = cfg.showGrid ? (tinyH ? 8 : compactH ? 18 : 24) : 8;
      const plotWidth = Math.max(24, width - leftMargin - rightMargin);
      const plotHeight = Math.max(24, height - topMargin - bottomMargin);

      const layout = computeBarLayout(plotWidth, leftMargin, cfg.barCount, cfg.barWidth, cfg.barGap);
      const { activeBars, barWidth, barGap, startX } = layout;

      if (lastActiveBarsRef.current !== activeBars) {
        lastActiveBarsRef.current = activeBars;
        setRenderedBars(activeBars);
      }

      // Fetch Web Audio Analyser & Stereo Taps
      const analyser = audioEngine.getAnalyser();
      const stereo = playing ? audioEngine.getStereoAnalysers() : null;
      let hasSignal = false;
      let rawRms = 0;
      let dominantBin = 0;
      let dominantVal = 0;
      let sampleRate = 44100;
      let chLeftDb = -96;
      let chRightDb = -96;

      if (analyser) {
        if (analyser.fftSize !== 4096) analyser.fftSize = 4096;
        if (analyser.minDecibels !== -85) analyser.minDecibels = -85;
        if (analyser.maxDecibels !== -10) analyser.maxDecibels = -10;
        if (analyser.smoothingTimeConstant > 0.4) analyser.smoothingTimeConstant = 0.35;

        sampleRate = analyser.context.sampleRate || 44100;
        if (!freqDataBuffer || freqDataBuffer.length !== analyser.frequencyBinCount) {
          freqDataBuffer = new Uint8Array(analyser.frequencyBinCount);
        }
        if (!timeDataBuffer || timeDataBuffer.length !== analyser.fftSize) {
          timeDataBuffer = new Uint8Array(analyser.fftSize);
        }

        if (playing) {
          analyser.getByteFrequencyData(freqDataBuffer);
          analyser.getByteTimeDomainData(timeDataBuffer);

          let sumSquares = 0;
          for (let i = 0; i < timeDataBuffer.length; i++) {
            const normalized = (timeDataBuffer[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          rawRms = Math.sqrt(sumSquares / timeDataBuffer.length);

          for (let i = 1; i < freqDataBuffer.length; i++) {
            if (freqDataBuffer[i] > dominantVal) {
              dominantVal = freqDataBuffer[i];
              dominantBin = i;
            }
          }

          if (rawRms > 0.0015 || dominantVal > 8) {
            hasSignal = true;
            silenceSinceRef.current = null;
          } else if (silenceSinceRef.current === null) {
            silenceSinceRef.current = now;
          }

          if (stereo) {
            if (!leftTimeBuffer || leftTimeBuffer.length !== stereo.left.fftSize) {
              leftTimeBuffer = new Uint8Array(stereo.left.fftSize);
            }
            if (!rightTimeBuffer || rightTimeBuffer.length !== stereo.right.fftSize) {
              rightTimeBuffer = new Uint8Array(stereo.right.fftSize);
            }
            chLeftDb = measureChannelDb(stereo.left, leftTimeBuffer);
            chRightDb = measureChannelDb(stereo.right, rightTimeBuffer);
          } else {
            const monoDb = rawRms > 0.0001 ? Math.max(-96, Math.min(0, Math.round(20 * Math.log10(rawRms) * 10) / 10)) : -96;
            chLeftDb = monoDb;
            chRightDb = monoDb;
          }
        } else {
          silenceSinceRef.current = null;
        }
      }

      const binWidthHz = sampleRate / (analyser?.fftSize || 4096);
      const rawTargets = new Float32Array(activeBars);

      if (hasSignal && freqDataBuffer) {
        let maxRaw = 0;
        for (let i = 0; i < activeBars; i++) {
          const fLow = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / activeBars);
          const fHigh = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 1) / activeBars);
          const binStart = Math.max(1, Math.floor(fLow / binWidthHz));
          const binEnd = Math.max(binStart, Math.min(freqDataBuffer.length - 1, Math.floor(fHigh / binWidthHz)));

          let rawMag = 0;
          if (binEnd > binStart) {
            let bandSum = 0;
            let bandMax = 0;
            for (let b = binStart; b <= binEnd; b++) {
              const v = freqDataBuffer[b];
              bandSum += v;
              if (v > bandMax) bandMax = v;
            }
            const bandAvg = bandSum / (binEnd - binStart + 1);
            rawMag = (bandAvg * 0.65 + bandMax * 0.35) / 255.0;
          } else {
            const exactBin = Math.sqrt(fLow * fHigh) / binWidthHz;
            const b0 = Math.max(1, Math.floor(exactBin));
            const b1 = Math.min(freqDataBuffer.length - 1, b0 + 1);
            const fract = exactBin - b0;
            rawMag = (freqDataBuffer[b0] * (1 - fract) + freqDataBuffer[b1] * fract) / 255.0;
          }

          // Noise floor gate & equal-loudness tilt
          const gated = rawMag < 0.02 ? 0 : (rawMag - 0.02) / 0.98;
          const normIdx = activeBars > 1 ? i / (activeBars - 1) : 0;
          const tilt = 0.72 + 0.58 * Math.pow(normIdx, 0.75);
          const val = gated * tilt;
          rawTargets[i] = val;
          if (val > maxRaw) maxRaw = val;
        }

        // CAVA-style Autosens (when sensitivity === 0)
        if (maxRaw * autoGainRef.current > 0.92) {
          autoGainRef.current = Math.max(0.35, autoGainRef.current * Math.pow(0.94, dtScale));
        } else if (maxRaw * autoGainRef.current < 0.58 && maxRaw > 0.04) {
          autoGainRef.current = Math.min(2.6, autoGainRef.current * Math.pow(1.004, dtScale));
        }
      }

      const effectiveGain = cfg.sensitivity === 0 ? autoGainRef.current : cfg.sensitivity;
      const targets = new Float32Array(activeBars);

      // Spatial smoothing across adjacent bars (0 = Raw, 1 = Monstercat 5-pt, 2 = Wide 7-pt)
      const kernel = cfg.smoothing === 0
        ? [1]
        : cfg.smoothing === 2
          ? [0.05, 0.11, 0.19, 0.30, 0.19, 0.11, 0.05]
          : [0.08, 0.21, 0.42, 0.21, 0.08];
      const radius = Math.floor(kernel.length / 2);

      for (let i = 0; i < activeBars; i++) {
        if (!hasSignal) {
          targets[i] = 0;
          continue;
        }
        let weightedSum = 0;
        let weightTotal = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const neighbor = i + offset;
          if (neighbor >= 0 && neighbor < activeBars) {
            const w = kernel[offset + radius];
            weightedSum += rawTargets[neighbor] * w;
            weightTotal += w;
          }
        }
        const spatial = (weightedSum / weightTotal) * effectiveGain;
        targets[i] = Math.min(1.0, Math.max(0, spatial));
      }

      // Frame-rate-independent CAVA ballistics
      const bars = barValuesRef.current;
      const barVels = barVelocitiesRef.current;
      const peaks = peakValuesRef.current;
      const peakVels = peakVelocitiesRef.current;
      const holdMs = peakHoldMsRef.current;

      const attackAlpha = 1 - Math.pow(1 - 0.72, dtScale);
      const gravityAccel = 0.0017 * cfg.gravity * dtScale;
      const gravityFloor = 0.0045 * cfg.gravity * dtScale;
      const damping = Math.pow(0.96, dtScale);
      const peakAccel = 0.0011 * cfg.gravity * dtScale;
      const peakFloor = 0.003 * cfg.gravity * dtScale;

      let anyMoving = false;
      for (let i = 0; i < activeBars; i++) {
        const target = targets[i];
        let h = bars[i];
        let v = barVels[i];

        if (target > h) {
          h += (target - h) * attackAlpha;
          v = 0;
        } else {
          v = (v + gravityAccel) * damping;
          h -= v + gravityFloor;
          if (h <= target) {
            h = target;
            v = 0;
          }
          if (h < 0.001) {
            h = 0;
            v = 0;
          }
        }
        bars[i] = h;
        barVels[i] = v;

        let p = peaks[i];
        let pv = peakVels[i];
        let hold = holdMs[i];

        if (h >= p) {
          p = h;
          pv = 0;
          hold = 280;
        } else if (hold > 0) {
          hold = Math.max(0, hold - dtMs);
        } else {
          pv += peakAccel;
          p -= pv + peakFloor;
          if (p <= h) {
            p = h;
            pv = 0;
          }
          if (p < 0.001) {
            p = 0;
            pv = 0;
          }
        }
        peaks[i] = p;
        peakVels[i] = pv;
        holdMs[i] = hold;

        if (h > 0 || p > 0) anyMoving = true;
      }

      // Throttled React telemetry updates (10 Hz)
      if (now - lastMetricsUpdateRef.current > 100) {
        lastMetricsUpdateRef.current = now;
        if (cfg.sensitivity === 0) {
          setLiveAutoGain(Math.round(autoGainRef.current * 10) / 10);
        }
        if (playing && hasSignal) {
          setLeftDb(chLeftDb);
          setRightDb(chRightDb);
          setPeakNote(freqToNote(dominantBin * binWidthHz));
        } else if (!playing) {
          setLeftDb(-96);
          setRightDb(-96);
          setPeakNote('--');
        }
      }

      // Optional Terminal Grid & Axis Labels
      if (cfg.showGrid) {
        ctx.lineWidth = 1;
        ctx.font = `${compactW ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

        if (cfg.orientation === 'mirror') {
          const centerY = topMargin + plotHeight / 2;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.beginPath();
          ctx.moveTo(leftMargin, centerY);
          ctx.lineTo(width - rightMargin, centerY);
          ctx.stroke();

          if (showLabels) {
            ctx.fillStyle = thm.textDim;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('0dB', leftMargin - 5, centerY);
          }
        } else {
          const visibleMarkers = plotHeight < 48
            ? []
            : plotHeight < 84
              ? DB_MARKERS.filter(m => m.db === 0 || m.db === -48)
              : compactH
                ? DB_MARKERS.filter(m => m.db === 0 || m.db === -24 || m.db === -48)
                : DB_MARKERS;

          for (const marker of visibleMarkers) {
            const normY = Math.abs(marker.db) / 48;
            const y = cfg.orientation === 'top'
              ? topMargin + (1 - normY) * plotHeight
              : topMargin + normY * plotHeight;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(leftMargin, y);
            ctx.lineTo(width - rightMargin, y);
            ctx.stroke();
            ctx.setLineDash([]);

            if (showLabels) {
              ctx.fillStyle = marker.db === 0 ? thm.error : thm.textDim;
              ctx.textAlign = 'right';
              ctx.textBaseline = 'middle';
              ctx.fillText(compactW ? marker.label.replace('dB', '') : marker.label, leftMargin - 5, y);
            }
          }
        }

        if (!tinyH) {
          ctx.fillStyle = thm.textDim;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const freqStep = plotWidth < 200 ? 3 : plotWidth < 340 ? 2 : 1;
          const axisY = topMargin + plotHeight;
          ISO_FREQUENCIES.forEach((iso, idx) => {
            if (idx % freqStep !== 0) return;
            const logFraction = Math.log(iso.freq / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ);
            if (logFraction >= 0 && logFraction <= 1) {
              const x = leftMargin + logFraction * plotWidth;
              ctx.strokeStyle = thm.border;
              ctx.beginPath();
              ctx.moveTo(x, axisY);
              ctx.lineTo(x, axisY + 3);
              ctx.stroke();
              ctx.fillText(iso.label, x, axisY + 5);
            }
          });
        }
      }

      // Draw CAVA Bars
      const maxReach = plotHeight * (cfg.heightScale / 100);
      const fillStyle = buildBarFillStyle(ctx, cfg, thm, topMargin, plotHeight);
      const peakColor = cfg.colorMode === 'solid'
        ? cfg.solidColor
        : cfg.colorMode === 'gradient'
          ? cfg.gradientTop
          : thm.highlight;

      if (cfg.barStyle === 'blocks') {
        const segH = cfg.blockHeight;
        const segGap = Math.max(1, Math.round(segH * 0.35));
        const unit = segH + segGap;
        const radius = Math.min(1.5, barWidth / 4);

        if (cfg.orientation === 'mirror') {
          const centerY = topMargin + plotHeight / 2;
          const halfReach = maxReach / 2;
          const halfSegments = Math.max(2, Math.floor(halfReach / unit));

          for (let i = 0; i < activeBars; i++) {
            const x = startX + i * (barWidth + barGap);
            const val = bars[i];
            const activeSegs = val * halfSegments;
            const fullSegs = Math.floor(activeSegs);
            const frac = activeSegs - fullSegs;

            for (let s = 0; s < halfSegments; s++) {
              const ratio = s / halfSegments;
              const yUp = centerY - (s + 1) * unit + segGap / 2;
              const yDown = centerY + s * unit + segGap / 2;
              const color = getBlockColor(cfg, thm, ratio);

              if (s < fullSegs) {
                ctx.fillStyle = color;
                fillRoundedBar(ctx, x, yUp, barWidth, segH, radius);
                fillRoundedBar(ctx, x, yDown, barWidth, segH, radius);
              } else if (s === fullSegs && frac > 0.08) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, frac * 1.25);
                ctx.fillStyle = color;
                fillRoundedBar(ctx, x, yUp, barWidth, segH, radius);
                fillRoundedBar(ctx, x, yDown, barWidth, segH, radius);
                ctx.restore();
              } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
                ctx.fillRect(x, yUp, barWidth, segH);
                ctx.fillRect(x, yDown, barWidth, segH);
              }
            }

            if (cfg.showPeaks && peaks[i] > 0.01) {
              const offset = Math.min(halfReach - 2, peaks[i] * halfReach);
              ctx.fillStyle = peaks[i] > 0.85 && cfg.colorMode === 'theme' ? thm.error : peakColor;
              ctx.fillRect(x, centerY - offset - 2, barWidth, 2);
              ctx.fillRect(x, centerY + offset, barWidth, 2);
            }
          }
        } else {
          const totalSegments = Math.max(3, Math.floor(maxReach / unit));
          const isTop = cfg.orientation === 'top';

          for (let i = 0; i < activeBars; i++) {
            const x = startX + i * (barWidth + barGap);
            const val = bars[i];
            const activeSegs = val * totalSegments;
            const fullSegs = Math.floor(activeSegs);
            const frac = activeSegs - fullSegs;

            for (let s = 0; s < totalSegments; s++) {
              const ratio = s / totalSegments;
              const segY = isTop
                ? topMargin + s * unit
                : topMargin + plotHeight - (s + 1) * unit + segGap;
              const color = getBlockColor(cfg, thm, ratio);

              if (s < fullSegs) {
                ctx.fillStyle = color;
                fillRoundedBar(ctx, x, segY, barWidth, segH, radius);
              } else if (s === fullSegs && frac > 0.08) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, frac * 1.25);
                ctx.fillStyle = color;
                fillRoundedBar(ctx, x, segY, barWidth, segH, radius);
                ctx.restore();
              } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
                ctx.fillRect(x, segY, barWidth, segH);
              }
            }

            if (cfg.showPeaks && peaks[i] > 0.01) {
              const reachPx = Math.min(maxReach - 2, peaks[i] * totalSegments * unit);
              const peakY = isTop
                ? topMargin + reachPx
                : topMargin + plotHeight - reachPx - 2;
              ctx.fillStyle = peaks[i] > 0.85 && cfg.colorMode === 'theme' ? thm.error : peakColor;
              ctx.fillRect(x, Math.max(topMargin, Math.min(topMargin + plotHeight - 2, peakY)), barWidth, 2);
            }
          }
        }
      } else {
        // 'solid' or 'rounded' continuous CAVA bars
        const cornerRadius = cfg.barStyle === 'rounded' ? Math.min(barWidth / 2, 8) : 0;

        for (let i = 0; i < activeBars; i++) {
          const x = startX + i * (barWidth + barGap);
          const val = bars[i];
          const barH = val * maxReach;

          if (cfg.orientation === 'mirror') {
            const centerY = topMargin + plotHeight / 2;
            const halfH = barH / 2;
            // Subtle resting baseline tick
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.fillRect(x, centerY - 0.5, barWidth, 1);

            if (halfH >= 0.5) {
              ctx.fillStyle = fillStyle;
              if (cornerRadius > 0) {
                fillRoundedBar(ctx, x, centerY - halfH, barWidth, halfH * 2, cornerRadius);
              } else {
                ctx.fillRect(x, centerY - halfH, barWidth, halfH * 2);
              }
            }

            if (cfg.showPeaks && peaks[i] > 0.01) {
              const peakOffset = Math.min(maxReach / 2 - 2, peaks[i] * (maxReach / 2));
              ctx.fillStyle = peaks[i] > 0.85 && cfg.colorMode === 'theme' ? thm.error : peakColor;
              ctx.fillRect(x, centerY - peakOffset - 2, barWidth, 2);
              ctx.fillRect(x, centerY + peakOffset, barWidth, 2);
            }
          } else {
            const isTop = cfg.orientation === 'top';
            const baseY = isTop ? topMargin : topMargin + plotHeight;

            // Subtle CAVA resting baseline tick
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(x, isTop ? baseY : baseY - 1, barWidth, 1);

            if (barH >= 0.5) {
              ctx.fillStyle = fillStyle;
              const drawY = isTop ? baseY : baseY - barH;
              if (cornerRadius > 0) {
                fillRoundedBar(ctx, x, drawY, barWidth, barH, cornerRadius);
              } else {
                ctx.fillRect(x, drawY, barWidth, barH);
              }
            }

            if (cfg.showPeaks && peaks[i] > 0.01) {
              const peakReach = Math.min(maxReach - 2, peaks[i] * maxReach);
              const peakY = isTop ? baseY + peakReach : baseY - peakReach - 2;
              ctx.fillStyle = peaks[i] > 0.85 && cfg.colorMode === 'theme' ? thm.error : peakColor;
              ctx.fillRect(x, Math.max(topMargin, Math.min(topMargin + plotHeight - 2, peakY)), barWidth, 2);
            }
          }
        }
      }

      // Non-flickering Standby / Awaiting PCM Status
      if (!playing && !anyMoving) {
        const boxWidth = Math.min(280, Math.max(88, plotWidth - 16));
        const boxHeight = Math.min(34, Math.max(22, plotHeight - 12));
        const boxX = leftMargin + (plotWidth - boxWidth) / 2;
        const boxY = topMargin + (plotHeight - boxHeight) / 2;

        ctx.fillStyle = surfaceColor(thm.bg, Math.max(0.82, bgOpacity));
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = thm.border;
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);

        ctx.fillStyle = thm.textDim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${boxWidth < 180 ? 10 : 11}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        const label = boxWidth >= 230 ? '○ [ STANDBY ] PLAY TRACK' : '○ STANDBY';
        ctx.fillText(label, leftMargin + plotWidth / 2, topMargin + plotHeight / 2, boxWidth - 12);
      } else if (playing && silenceSinceRef.current !== null && now - silenceSinceRef.current > 1500) {
        // Unobtrusive corner indicator only after 1.5s continuous silence while playing
        const badgeText = '⏳ AWAITING PCM';
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        const badgeW = Math.min(plotWidth - 8, 114);
        const badgeX = width - rightMargin - badgeW;
        const badgeY = topMargin + 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(badgeX, badgeY, badgeW, 18);
        ctx.strokeStyle = thm.border;
        ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, 17);
        ctx.fillStyle = thm.warning;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 9, badgeW - 8);
      }

      ctx.restore();

      // Keep running while playing OR while bars/peaks are still decaying to 0
      if (playing || anyMoving) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        setFps(0);
        setLeftDb(-96);
        setRightDb(-96);
        setPeakNote('--');
      }
    };

    const scheduleDraw = () => {
      if (!running || animFrameRef.current !== null) return;
      animFrameRef.current = requestAnimationFrame(render);
    };
    scheduleDrawRef.current = scheduleDraw;

    scheduleDraw();

    const resizeObserver = new ResizeObserver(() => {
      scheduleDraw();
    });
    resizeObserver.observe(canvas);

    return () => {
      running = false;
      scheduleDrawRef.current = null;
      resizeObserver.disconnect();
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []);

  const leftNorm = Math.max(0, Math.min(100, Math.round(((leftDb + 60) / 60) * 100)));
  const rightNorm = Math.max(0, Math.min(100, Math.round(((rightDb + 60) / 60) * 100)));

  const colorPreview = config.colorMode === 'solid'
    ? config.solidColor
    : config.colorMode === 'gradient'
      ? `linear-gradient(90deg, ${config.gradientBottom}, ${config.gradientUseMid ? `${config.gradientMid}, ` : ''}${config.gradientTop})`
      : theme.accent;

  return (
    <div
      data-background-region="spectrum"
      data-background-enabled={showBackground}
      className="spectrum-root skin-panel flex-1 flex flex-col min-h-0 min-w-0 relative select-none font-mono overflow-hidden text-xs w-full h-full"
      style={{
        backgroundColor: showBackground ? 'transparent' : theme.bg,
        ...(!showBackground ? { '--app-surface-bg': theme.bg, '--app-surface-card-bg': theme.cardBg } : {}),
      } as React.CSSProperties}
    >
      {/* Top Header Bar */}
      <div
        className="spectrum-header px-3 py-2 border-b flex shrink-0 items-center justify-between z-10 flex-wrap gap-2"
        style={{
          borderColor: theme.border,
          backgroundColor: 'var(--app-surface-card-bg)',
        }}
      >
        <div className="flex min-w-0 flex-[1_1_10rem] items-center gap-2">
          <Activity
            className={`w-4 h-4 shrink-0 ${isPlaying ? 'animate-pulse' : ''}`}
            style={{ color: theme.accent }}
          />
          <span className="spectrum-title-full min-w-0 truncate font-bold text-xs" style={{ color: theme.highlight }}>
            ┌─ CAVA Audio Spectrum ─
          </span>
          <span className="spectrum-title-short min-w-0 truncate font-bold text-xs" style={{ color: theme.highlight }}>
            ┌─ Spectrum ─
          </span>
          <span
            className="min-w-0 max-w-full truncate shrink px-2 py-0.5 border text-[10px] font-bold"
            style={{
              borderColor: isPlaying ? theme.accent : theme.border,
              color: isPlaying ? theme.accent : theme.textDim,
              backgroundColor: isPlaying ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
            }}
          >
            {isPlaying ? `● LIVE: ${currentTrack?.title || 'Playing'}` : '○ PAUSED'}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => {
              const currentIndex = GAIN_PRESETS.findIndex(v => Math.abs(v - config.sensitivity) < 0.05);
              const nextSensitivity = GAIN_PRESETS[(currentIndex + 1) % GAIN_PRESETS.length];
              updateConfig({ sensitivity: nextSensitivity });
            }}
            title="Cycle gain / CAVA autosens"
            className="px-2 py-0.5 border hover:brightness-125 transition-all text-[10px] whitespace-nowrap"
            style={{
              borderColor: config.sensitivity === 0 ? theme.accent : theme.border,
              color: config.sensitivity === 0 ? theme.highlight : theme.textDim,
              backgroundColor: config.sensitivity === 0 ? 'rgba(0, 240, 255, 0.08)' : 'var(--app-surface-bg)',
            }}
          >
            Gain: {config.sensitivity === 0 ? `AUTO (${liveAutoGain.toFixed(1)}x)` : `${config.sensitivity.toFixed(1)}x`}
          </button>

          <button
            type="button"
            aria-label="Visualizer settings"
            aria-expanded={showConfig}
            aria-controls={configPanelId}
            onClick={() => setShowConfig(prev => !prev)}
            title="Configure CAVA spectrum bars, colors and physics"
            className="px-2 py-0.5 border hover:brightness-125 transition-all flex items-center gap-1.5 text-[10px] font-bold whitespace-nowrap"
            style={{
              borderColor: showConfig ? theme.accent : theme.border,
              color: showConfig ? theme.highlight : theme.text,
              backgroundColor: showConfig ? 'rgba(255, 255, 255, 0.08)' : 'var(--app-surface-bg)',
            }}
          >
            <span
              aria-hidden="true"
              className="w-2.5 h-2.5 border shrink-0"
              style={{ background: colorPreview, borderColor: theme.border }}
            />
            <SlidersHorizontal className="w-3 h-3 shrink-0" />
            <span>[Config]</span>
          </button>
        </div>
      </div>

      {/* Collapsible CAVA Configuration Panel */}
      {showConfig && (
        <div
          id={configPanelId}
          role="region"
          aria-label="CAVA spectrum settings"
          className="spectrum-config-drawer shrink-0 max-h-[54%] overflow-y-auto custom-scrollbar border-b px-3 py-2.5 flex flex-col gap-3 text-[11px]"
          style={{
            borderColor: theme.border,
            backgroundColor: 'var(--app-surface-bg)',
            color: theme.text,
          }}
        >
          {/* Presets & Reset */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: theme.border }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase mr-1" style={{ color: theme.textDim }}>
                Presets:
              </span>
              {SPECTRUM_PROFILE_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => updateConfig(preset.patch)}
                  className="px-2 py-0.5 border text-[10px] hover:brightness-125"
                  style={{
                    borderColor: theme.border,
                    color: theme.highlight,
                    backgroundColor: 'var(--app-surface-card-bg)',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateConfig({ ...DEFAULT_SPECTRUM_CONFIG })}
              className="px-2 py-0.5 border text-[10px] flex items-center gap-1 hover:brightness-125"
              style={{ borderColor: theme.border, color: theme.textDim }}
              title="Reset visualizer settings to defaults"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Colors Section */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase" style={{ color: theme.textDim }}>
                Color Mode
              </span>
              <div className="flex items-center gap-1">
                {(['theme', 'solid', 'gradient'] as const).map(modeOpt => (
                  <button
                    key={modeOpt}
                    type="button"
                    aria-pressed={config.colorMode === modeOpt}
                    onClick={() => updateConfig({ colorMode: modeOpt })}
                    className="px-2 py-0.5 border text-[10px] uppercase font-bold hover:brightness-125"
                    style={{
                      borderColor: config.colorMode === modeOpt ? theme.accent : theme.border,
                      color: config.colorMode === modeOpt ? theme.highlight : theme.textDim,
                      backgroundColor: config.colorMode === modeOpt ? 'rgba(255,255,255,0.08)' : 'var(--app-surface-card-bg)',
                    }}
                  >
                    {modeOpt}
                  </button>
                ))}
              </div>
            </div>

            {config.colorMode === 'solid' && (
              <div className="flex flex-wrap items-center gap-2 border p-2" style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-card-bg)' }}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SPECTRUM_SOLID_SWATCHES.map(hex => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Select color ${hex}`}
                      onClick={() => updateConfig({ solidColor: hex })}
                      className="w-4 h-4 border hover:scale-110 transition-transform"
                      style={{
                        backgroundColor: hex,
                        borderColor: config.solidColor.toLowerCase() === hex.toLowerCase() ? '#ffffff' : theme.border,
                        outline: config.solidColor.toLowerCase() === hex.toLowerCase() ? `1px solid ${theme.accent}` : 'none',
                      }}
                    />
                  ))}
                </div>
                <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-[10px]">
                  <span style={{ color: theme.textDim }}>Custom:</span>
                  <input
                    aria-label="Custom bar color"
                    type="color"
                    value={config.solidColor}
                    onChange={e => updateConfig({ solidColor: e.target.value })}
                    className="w-6 h-5 p-0 border bg-transparent cursor-pointer"
                    style={{ borderColor: theme.border }}
                  />
                  <span className="tabular-nums" style={{ color: theme.highlight }}>{config.solidColor.toUpperCase()}</span>
                </label>
              </div>
            )}

            {config.colorMode === 'gradient' && (
              <div className="flex flex-col gap-2 border p-2" style={{ borderColor: theme.border, backgroundColor: 'var(--app-surface-card-bg)' }}>
                <div className="flex flex-wrap items-center gap-1">
                  {SPECTRUM_GRADIENT_PRESETS.map(preset => {
                    const active = config.gradientPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => updateConfig({
                          gradientPreset: preset.id,
                          gradientBottom: preset.bottom,
                          gradientMid: preset.mid,
                          gradientTop: preset.top,
                          gradientUseMid: preset.useMid,
                        })}
                        className="px-2 py-0.5 border text-[10px] flex items-center gap-1.5 hover:brightness-125"
                        style={{
                          borderColor: active ? theme.accent : theme.border,
                          color: active ? theme.highlight : theme.textDim,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="w-3 h-2 border"
                          style={{
                            borderColor: theme.border,
                            background: `linear-gradient(90deg, ${preset.bottom}, ${preset.mid}, ${preset.top})`,
                          }}
                        />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[10px]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span style={{ color: theme.textDim }}>Base:</span>
                    <input
                      aria-label="Gradient base color"
                      type="color"
                      value={config.gradientBottom}
                      onChange={e => updateConfig({ gradientPreset: 'custom', gradientBottom: e.target.value })}
                      className="w-6 h-5 p-0 border bg-transparent cursor-pointer"
                      style={{ borderColor: theme.border }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.gradientUseMid}
                      onChange={e => updateConfig({ gradientPreset: 'custom', gradientUseMid: e.target.checked })}
                      style={{ accentColor: theme.accent }}
                    />
                    <span style={{ color: theme.textDim }}>Mid:</span>
                    <input
                      aria-label="Gradient middle color"
                      type="color"
                      disabled={!config.gradientUseMid}
                      value={config.gradientMid}
                      onChange={e => updateConfig({ gradientPreset: 'custom', gradientMid: e.target.value })}
                      className="w-6 h-5 p-0 border bg-transparent cursor-pointer disabled:opacity-40"
                      style={{ borderColor: theme.border }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span style={{ color: theme.textDim }}>Peak:</span>
                    <input
                      aria-label="Gradient top color"
                      type="color"
                      value={config.gradientTop}
                      onChange={e => updateConfig({ gradientPreset: 'custom', gradientTop: e.target.value })}
                      className="w-6 h-5 p-0 border bg-transparent cursor-pointer"
                      style={{ borderColor: theme.border }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Geometry & CAVA Sliders */}
          <div
            className="grid gap-x-4 gap-y-2.5"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10.5rem), 1fr))' }}
          >
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>THICKNESS (WIDTH)</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>{config.barWidth}px</span>
              </span>
              <input
                aria-label="Bar thickness"
                type="range"
                min={2}
                max={24}
                step={1}
                value={config.barWidth}
                onChange={e => updateConfig({ barWidth: Number(e.target.value) })}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>SPACING (GAP)</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>{config.barGap}px</span>
              </span>
              <input
                aria-label="Bar spacing"
                type="range"
                min={0}
                max={10}
                step={1}
                value={config.barGap}
                onChange={e => updateConfig({ barGap: Number(e.target.value) })}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>BAR HEIGHT</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>{config.heightScale}%</span>
              </span>
              <input
                aria-label="Bar height scale"
                type="range"
                min={30}
                max={100}
                step={5}
                value={config.heightScale}
                onChange={e => updateConfig({ heightScale: Number(e.target.value) })}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>BAR COUNT</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>
                  {config.barCount === 0 ? `AUTO (${renderedBars})` : config.barCount}
                </span>
              </span>
              <input
                aria-label="Number of bars"
                type="range"
                min={0}
                max={96}
                step={4}
                value={config.barCount}
                onChange={e => {
                  const val = Number(e.target.value);
                  updateConfig({ barCount: val > 0 && val < 16 ? 16 : val });
                }}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>SENSITIVITY</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>
                  {config.sensitivity === 0 ? 'AUTO' : `${config.sensitivity.toFixed(1)}x`}
                </span>
              </span>
              <input
                aria-label="Visualizer sensitivity"
                type="range"
                min={0}
                max={3.0}
                step={0.1}
                value={config.sensitivity}
                onChange={e => {
                  const val = Number(e.target.value);
                  updateConfig({ sensitivity: val > 0 && val < 0.4 ? 0.4 : val });
                }}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[10px]">
                <span style={{ color: theme.textDim }}>GRAVITY (FALL)</span>
                <span className="tabular-nums" style={{ color: theme.accent }}>{config.gravity.toFixed(1)}x</span>
              </span>
              <input
                aria-label="Bar fall gravity"
                type="range"
                min={0.3}
                max={2.5}
                step={0.1}
                value={config.gravity}
                onChange={e => updateConfig({ gravity: Number(e.target.value) })}
                className="w-full cursor-pointer"
                style={{ accentColor: theme.accent }}
              />
            </label>
          </div>

          {/* Style, Orientation, Smoothing & Toggles */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t" style={{ borderColor: theme.border }}>
            <div className="flex items-center gap-1">
              <span className="text-[10px] mr-1" style={{ color: theme.textDim }}>STYLE:</span>
              {(['solid', 'blocks', 'rounded'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={config.barStyle === st}
                  onClick={() => updateConfig({ barStyle: st })}
                  className="px-1.5 py-0.5 border text-[10px] uppercase hover:brightness-125"
                  style={{
                    borderColor: config.barStyle === st ? theme.accent : theme.border,
                    color: config.barStyle === st ? theme.highlight : theme.textDim,
                  }}
                >
                  {st}
                </button>
              ))}
            </div>

            {config.barStyle === 'blocks' && (
              <label className="flex items-center gap-2 text-[10px]">
                <span style={{ color: theme.textDim }}>BLOCK: {config.blockHeight}px</span>
                <input
                  aria-label="Block segment height"
                  type="range"
                  min={3}
                  max={10}
                  step={1}
                  value={config.blockHeight}
                  onChange={e => updateConfig({ blockHeight: Number(e.target.value) })}
                  className="w-16 cursor-pointer"
                  style={{ accentColor: theme.accent }}
                />
              </label>
            )}

            <div className="flex items-center gap-1">
              <span className="text-[10px] mr-1" style={{ color: theme.textDim }}>ALIGN:</span>
              {(['bottom', 'mirror', 'top'] as const).map(ori => (
                <button
                  key={ori}
                  type="button"
                  aria-pressed={config.orientation === ori}
                  onClick={() => updateConfig({ orientation: ori })}
                  className="px-1.5 py-0.5 border text-[10px] uppercase hover:brightness-125"
                  style={{
                    borderColor: config.orientation === ori ? theme.accent : theme.border,
                    color: config.orientation === ori ? theme.highlight : theme.textDim,
                  }}
                >
                  {ori}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] mr-1" style={{ color: theme.textDim }}>SMOOTH:</span>
              {([
                [0, 'Raw'],
                [1, 'Med'],
                [2, 'High'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={config.smoothing === val}
                  onClick={() => updateConfig({ smoothing: val })}
                  className="px-1.5 py-0.5 border text-[10px] uppercase hover:brightness-125"
                  style={{
                    borderColor: config.smoothing === val ? theme.accent : theme.border,
                    color: config.smoothing === val ? theme.highlight : theme.textDim,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-[10px]">
              <input
                type="checkbox"
                checked={config.showPeaks}
                onChange={e => updateConfig({ showPeaks: e.target.checked })}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ color: config.showPeaks ? theme.highlight : theme.textDim }}>Peak Caps</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-[10px]">
              <input
                type="checkbox"
                checked={config.showGrid}
                onChange={e => updateConfig({ showGrid: e.target.checked })}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ color: config.showGrid ? theme.highlight : theme.textDim }}>Grid &amp; dB/Hz</span>
            </label>
          </div>
        </div>
      )}

      {/* Main Full-Size Bar Spectrum Canvas */}
      <div className="spectrum-canvas-wrap flex-1 min-h-0 w-full relative overflow-hidden flex flex-col p-2.5">
        <div
          className="flex-1 w-full h-full min-h-0 border relative flex flex-col shadow-inner overflow-hidden"
          style={{ borderColor: theme.border, backgroundColor: surfaceOpacity < 1 ? 'transparent' : '#040608' }}
        >
          <canvas ref={canvasRef} className="w-full h-full flex-1 block" />
        </div>
      </div>

      {/* Bottom Live Stereo VU Meter & Telemetry */}
      <div
        className="spectrum-footer px-3 py-2 border-t flex flex-col items-stretch justify-between gap-2 text-[11px] shrink-0"
        style={{
          borderColor: theme.border,
          backgroundColor: 'var(--app-surface-card-bg)',
        }}
      >
        <div className="spectrum-meters grid grid-cols-1 gap-x-4 gap-y-1 w-full">
          <div className="spectrum-vu-group flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-[10px] shrink-0" style={{ color: theme.accent }}>L:</span>
            <div className="spectrum-vu-bar min-w-[1.5rem] flex-1 h-2.5 border bg-black/60 relative overflow-hidden" style={{ borderColor: theme.border }}>
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${leftNorm}%`,
                  backgroundColor: leftNorm > 85 ? theme.error : leftNorm > 70 ? theme.warning : theme.accent,
                }}
              />
            </div>
            <span className="text-[10px] w-auto min-w-[2.4rem] shrink-0 font-mono text-right tabular-nums" style={{ color: theme.textDim }}>
              {leftDb <= -90 ? '-inf' : `${leftDb}dB`}
            </span>
          </div>

          <div className="spectrum-vu-group flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-[10px] shrink-0" style={{ color: theme.accent }}>R:</span>
            <div className="spectrum-vu-bar min-w-[1.5rem] flex-1 h-2.5 border bg-black/60 relative overflow-hidden" style={{ borderColor: theme.border }}>
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${rightNorm}%`,
                  backgroundColor: rightNorm > 85 ? theme.error : rightNorm > 70 ? theme.warning : theme.highlight,
                }}
              />
            </div>
            <span className="text-[10px] w-auto min-w-[2.4rem] shrink-0 font-mono text-right tabular-nums" style={{ color: theme.textDim }}>
              {rightDb <= -90 ? '-inf' : `${rightDb}dB`}
            </span>
          </div>
        </div>

        <div className="spectrum-telemetry flex items-center gap-x-3 gap-y-1 text-[10px] flex-wrap justify-between" style={{ color: theme.textDim }}>
          <div className="truncate">
            <span>Peak: </span>
            <span className="font-bold" style={{ color: theme.highlight }}>{peakNote}</span>
          </div>
          <div className="spectrum-telemetry-extra">
            <span>Bars: </span>
            <span className="tabular-nums" style={{ color: theme.highlight }}>{renderedBars}</span>
          </div>
          <div className="spectrum-telemetry-fft">
            <span>FFT: </span>
            <span style={{ color: theme.text }}>4096</span>
          </div>
          <div className="font-bold shrink-0 tabular-nums" style={{ color: fps >= 55 ? theme.accent : theme.warning }}>
            [{fps} FPS]
          </div>
        </div>
      </div>
    </div>
  );
};
