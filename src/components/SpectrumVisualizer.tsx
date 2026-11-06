import React, { useEffect, useState, useRef } from 'react';
import { ThemeConfig, Track } from '../types';
import { audioEngine } from '../services/youtubeAudioEngine';
import { loadPlayerPreferences, savePlayerPreferences } from '../services/libraryStorage';
import { Activity, Waves, Cpu, BarChart2 } from 'lucide-react';

interface SpectrumVisualizerProps {
  theme: ThemeConfig;
  isPlaying: boolean;
  currentTrack: Track | null;
  maxFrameRate?: number;
}

type VisualizerMode = 'bars' | 'wave' | 'matrix';

// 10 ISO standard acoustic center octave frequencies
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
  { db: -6, label: '-6dB' },
  { db: -12, label: '-12dB' },
  { db: -18, label: '-18dB' },
  { db: -24, label: '-24dB' },
  { db: -36, label: '-36dB' },
  { db: -48, label: '-48dB' },
];

const GAIN_PRESETS = [0, 0.5, 0.8, 1.0, 1.3, 1.6]; // 0 = automatic gain

function freqToNote(freq: number): string {
  if (freq < 20 || freq > 20000 || !Number.isFinite(freq)) return '--';
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  if (midi < 12 || midi > 127) return `${Math.round(freq)} Hz`;
  const noteName = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteName}${octave} (${Math.round(freq)} Hz)`;
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({
  theme,
  isPlaying,
  currentTrack,
  maxFrameRate = 60,
}) => {
  const [mode, setMode] = useState<VisualizerMode>(() => loadPlayerPreferences().spectrumMode);
  const [fps, setFps] = useState<number>(60);
  const [rmsDb, setRmsDb] = useState<number>(-96);
  const [peakDb, setPeakDb] = useState<number>(-96);
  const [peakNote, setPeakNote] = useState<string>('--');
  const [sensitivity, setSensitivity] = useState<number>(() => loadPlayerPreferences().spectrumSensitivity);
  const [liveAutoGain, setLiveAutoGain] = useState<number>(1.0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Audio analysis state references (persisted across frames without React re-render churn)
  const barValuesRef = useRef<Float32Array>(new Float32Array(56));
  const barVelocitiesRef = useRef<Float32Array>(new Float32Array(56));
  const peakValuesRef = useRef<Float32Array>(new Float32Array(56));
  const peakVelocitiesRef = useRef<Float32Array>(new Float32Array(56));
  const peakHoldTimersRef = useRef<Int32Array>(new Int32Array(56));
  const autoGainRef = useRef<number>(1.0);
  const matrixDropsRef = useRef<{ y: number; speed: number; chars: string[] }[]>([]);

  // FPS tracking
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const lastMetricsUpdateRef = useRef(0);

  // Initialize matrix drops
  useEffect(() => {
    const chars = '0123456789ABCDEFλ§µπΩψ∆Ж¥$#@!*';
    const drops = [];
    for (let i = 0; i < 56; i++) {
      drops.push({
        y: Math.random() * 50,
        speed: 0.3 + Math.random() * 0.7,
        chars: Array.from({ length: 24 }).map(() => chars[Math.floor(Math.random() * chars.length)]),
      });
    }
    matrixDropsRef.current = drops;
  }, []);

  // Main rendering animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    let lastRender = 0;
    const MIN_FREQ = 25;
    const MAX_FREQ = 16000;
    const NUM_BARS = 56;

    let freqDataBuffer: Uint8Array | null = null;
    let timeDataBuffer: Uint8Array | null = null;

    const render = (now: number) => {
      if (!running) return;
      if (document.hidden || now - lastRender < 1000 / maxFrameRate) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      lastRender = now;

      // Track FPS
      frameCountRef.current++;
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // Handle Canvas Sizing with HiDPI / devicePixelRatio
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.max(100, Math.floor(rect.width));
      const displayHeight = Math.max(100, Math.floor(rect.height));

      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const width = displayWidth;
      const height = displayHeight;

      // Clear Canvas with authentic terminal CRT dark background
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, width, height);

      // Fetch Real Web Audio Analyser
      const analyser = audioEngine.getAnalyser();
      let hasSignal = false;
      let rawRms = 0;
      let rawPeak = 0;
      let dominantBin = 0;
      let dominantVal = 0;
      let sampleRate = 44100;

      if (analyser) {
        if (analyser.fftSize !== 2048) analyser.fftSize = 2048;
        if (analyser.minDecibels !== -85) analyser.minDecibels = -85;
        if (analyser.maxDecibels !== -10) analyser.maxDecibels = -10;
        if (analyser.smoothingTimeConstant > 0.45) analyser.smoothingTimeConstant = 0.4;

        sampleRate = analyser.context.sampleRate || 44100;
        if (!freqDataBuffer || freqDataBuffer.length !== analyser.frequencyBinCount) {
          freqDataBuffer = new Uint8Array(analyser.frequencyBinCount);
        }
        if (!timeDataBuffer || timeDataBuffer.length !== analyser.fftSize) {
          timeDataBuffer = new Uint8Array(analyser.fftSize);
        }

        if (isPlaying) {
          analyser.getByteFrequencyData(freqDataBuffer);
          analyser.getByteTimeDomainData(timeDataBuffer);

          // Calculate Signal Presence, RMS, and Peak dBFS
          let sumSquares = 0;
          for (let i = 0; i < timeDataBuffer.length; i++) {
            const normalized = (timeDataBuffer[i] - 128) / 128;
            const absVal = Math.abs(normalized);
            if (absVal > rawPeak) rawPeak = absVal;
            sumSquares += normalized * normalized;
          }
          rawRms = Math.sqrt(sumSquares / timeDataBuffer.length);

          // Dominant peak frequency search
          for (let i = 1; i < freqDataBuffer.length; i++) {
            if (freqDataBuffer[i] > dominantVal) {
              dominantVal = freqDataBuffer[i];
              dominantBin = i;
            }
          }

          if (rawRms > 0.002 || dominantVal > 10) {
            hasSignal = true;
          }
        }
      }

      const binWidthHz = sampleRate / (analyser?.fftSize || 2048);
      const rawTargets = new Float32Array(NUM_BARS);

      // 1. Calculate Logarithmic Frequency Bands with Smooth Interpolation & Calibrated Tilt
      if (hasSignal && freqDataBuffer) {
        let maxRaw = 0;

        for (let i = 0; i < NUM_BARS; i++) {
          const fLow = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / NUM_BARS);
          const fHigh = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 1) / NUM_BARS);

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
            // Smooth fractional interpolation between adjacent bins for fluid sub-bass curve
            const exactBin = Math.sqrt(fLow * fHigh) / binWidthHz;
            const b0 = Math.max(1, Math.floor(exactBin));
            const b1 = Math.min(freqDataBuffer.length - 1, b0 + 1);
            const fract = exactBin - b0;
            const interpVal = freqDataBuffer[b0] * (1 - fract) + freqDataBuffer[b1] * fract;
            rawMag = interpVal / 255.0;
          }

          // Acoustic equal-loudness curve:
          // Bass has high natural acoustic energy in music (scaled ~0.68x to avoid pegging at 0dB).
          // Highs have lower energy (scaled smoothly up to ~1.30x for sparkling treble balance).
          const normIdx = i / (NUM_BARS - 1);
          const tilt = 0.68 + 0.62 * Math.pow(normIdx, 0.75);
          const val = rawMag * tilt;
          rawTargets[i] = val;
          if (val > maxRaw) maxRaw = val;
        }

        // Auto-Gain Control (Autosens like CAVA)
        if (maxRaw * autoGainRef.current > 0.90) {
          // Rapid pull-down on loud sections to prevent red ceiling clipping
          autoGainRef.current = Math.max(0.35, autoGainRef.current * 0.95);
        } else if (maxRaw * autoGainRef.current < 0.55 && maxRaw > 0.04) {
          // Gradual float up when music is quieter
          autoGainRef.current = Math.min(2.5, autoGainRef.current * 1.003);
        }
      }

      // Effective gain: sensitivity === 0 means AUTO
      const effectiveGain = sensitivity === 0 ? autoGainRef.current : sensitivity;

      // 2. Monstercat Spatial Smoothing across adjacent bars
      // 5-tap kernel: [0.08, 0.21, 0.42, 0.21, 0.08]
      const K = [0.08, 0.21, 0.42, 0.21, 0.08];
      const targets = new Float32Array(NUM_BARS);

      for (let i = 0; i < NUM_BARS; i++) {
        if (!hasSignal) {
          targets[i] = 0;
          continue;
        }
        let weightedSum = 0;
        let weightTotal = 0;
        for (let offset = -2; offset <= 2; offset++) {
          const neighbor = i + offset;
          if (neighbor >= 0 && neighbor < NUM_BARS) {
            const w = K[offset + 2];
            weightedSum += rawTargets[neighbor] * w;
            weightTotal += w;
          }
        }
        const spatial = (weightedSum / weightTotal) * effectiveGain;
        targets[i] = Math.min(1.0, Math.max(0, spatial));
      }

      // 3. CAVA Ballistics: Snappy Attack Transient + Gravity Falloff
      const bars = barValuesRef.current;
      const barVels = barVelocitiesRef.current;
      const peaks = peakValuesRef.current;
      const peakVels = peakVelocitiesRef.current;
      const holdTimers = peakHoldTimersRef.current;

      for (let i = 0; i < NUM_BARS; i++) {
        const target = targets[i];
        let h = bars[i];
        let v = barVels[i];

        if (target > h) {
          // Fast attack transient
          h += (target - h) * 0.72;
          v = 0;
        } else {
          // Gravity acceleration downward
          v += 0.0016;
          v *= 0.96;
          h -= v + 0.005;
          if (h < target) {
            h = target;
            v = 0;
          }
          if (h < 0) {
            h = 0;
            v = 0;
          }
        }
        bars[i] = h;
        barVels[i] = v;

        // Floating Peak Caps (Hold + Gravity descent)
        let p = peaks[i];
        let pv = peakVels[i];
        let hold = holdTimers[i];

        if (h >= p) {
          p = h;
          pv = 0;
          hold = 18; // ~300ms hold at 60fps
        } else {
          if (hold > 0) {
            hold--;
          } else {
            pv += 0.0010;
            p -= pv + 0.0035;
            if (p < h) {
              p = h;
              pv = 0;
            }
          }
        }
        peaks[i] = Math.max(0, p);
        peakVels[i] = pv;
        holdTimers[i] = hold;
      }

      // Update metrics throttled to 10 FPS for React readability
      if (now - lastMetricsUpdateRef.current > 100) {
        lastMetricsUpdateRef.current = now;
        if (sensitivity === 0) {
          setLiveAutoGain(Math.round(autoGainRef.current * 10) / 10);
        }
        if (hasSignal) {
          const calcRms = rawRms > 0.0001 ? 20 * Math.log10(rawRms) : -96;
          const calcPeak = rawPeak > 0.0001 ? 20 * Math.log10(rawPeak) : -96;
          setRmsDb(Math.max(-96, Math.min(0, Math.round(calcRms * 10) / 10)));
          setPeakDb(Math.max(-96, Math.min(0, Math.round(calcPeak * 10) / 10)));
          const domFreq = dominantBin * binWidthHz;
          setPeakNote(freqToNote(domFreq));
        } else {
          setRmsDb(-96);
          setPeakDb(-96);
          setPeakNote('--');
        }
      }

      // Margins for grid & labels
      const leftMargin = 48;
      const rightMargin = 20;
      const topMargin = 24;
      const bottomMargin = 28;
      const plotWidth = width - leftMargin - rightMargin;
      const plotHeight = height - topMargin - bottomMargin;

      // Draw Background Terminal Grid Lines (dB markers)
      ctx.lineWidth = 1;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

      for (const marker of DB_MARKERS) {
        // Map dB (0 to -48) to Y
        const normY = Math.abs(marker.db) / 48;
        const y = topMargin + normY * plotHeight;

        // Dotted grid line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(width - rightMargin, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // dB text label on left
        ctx.fillStyle = marker.db === 0 ? theme.error : theme.textDim;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(marker.label, leftMargin - 6, y);
      }

      // ==========================================
      // MODE 1: GRAPHIC EQUALIZER SPECTRUM BARS (Segmented LED Quadradinhos)
      // ==========================================
      if (mode === 'bars') {
        const barTotalWidth = plotWidth / NUM_BARS;
        const gap = Math.max(1, Math.min(3, Math.floor(barTotalWidth * 0.22)));
        const barWidth = Math.max(2, barTotalWidth - gap);

        const segmentHeight = 6;
        const segmentGap = 2;
        const totalSegmentUnit = segmentHeight + segmentGap;
        const totalSegments = Math.floor(plotHeight / totalSegmentUnit);

        for (let i = 0; i < NUM_BARS; i++) {
          const x = leftMargin + i * barTotalWidth;
          const val = bars[i];
          const activeSegments = val * totalSegments;
          const fullSegments = Math.floor(activeSegments);
          const frac = activeSegments - fullSegments;
          const peakSegment = Math.round(peaks[i] * totalSegments);

          // Draw vertical segmented LED / ASCII quadradinhos
          for (let s = 0; s < totalSegments; s++) {
            const segmentY = topMargin + plotHeight - (s + 1) * totalSegmentUnit;
            const segRatio = s / totalSegments;

            // Authentic 3-zone color scheme matching dB markers:
            // > -6dB (ratio >= 0.875): Red / Error
            // -12dB to -6dB (0.75 <= ratio < 0.875): Amber / Warning
            // < -12dB (ratio < 0.75): Green / Accent
            let segColor: string;
            if (segRatio >= 0.875) {
              segColor = theme.error;
            } else if (segRatio >= 0.75) {
              segColor = theme.warning;
            } else {
              segColor = theme.accent;
            }

            if (s < fullSegments) {
              ctx.fillStyle = segColor;
              ctx.fillRect(x, segmentY, barWidth, segmentHeight);
            } else if (s === fullSegments && frac > 0.08) {
              // Smooth sub-segment partial alpha: enables silky fluid transitions between quadradinhos
              ctx.save();
              ctx.globalAlpha = Math.min(1.0, frac * 1.25);
              ctx.fillStyle = segColor;
              ctx.fillRect(x, segmentY, barWidth, segmentHeight);
              ctx.restore();
            } else {
              // Unfilled subtle terminal LED slot
              ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
              ctx.fillRect(x, segmentY, barWidth, segmentHeight);
            }
          }

          // Draw Floating Peak Hold Line
          if (peakSegment > 0 && peakSegment <= totalSegments) {
            const peakY = topMargin + plotHeight - peakSegment * totalSegmentUnit;
            const isPeakRed = peakSegment / totalSegments >= 0.875;
            ctx.fillStyle = isPeakRed ? theme.error : theme.warning;
            ctx.fillRect(x - 0.5, peakY - 1, barWidth + 1, 2.5);
          }
        }

        // Draw Frequency Axis Labels (Logarithmically Placed)
        ctx.fillStyle = theme.textDim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (const iso of ISO_FREQUENCIES) {
          const logFraction = Math.log(iso.freq / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ);
          if (logFraction >= 0 && logFraction <= 1) {
            const x = leftMargin + logFraction * plotWidth;
            ctx.strokeStyle = theme.border;
            ctx.beginPath();
            ctx.moveTo(x, topMargin + plotHeight);
            ctx.lineTo(x, topMargin + plotHeight + 4);
            ctx.stroke();
            ctx.fillText(iso.label, x, topMargin + plotHeight + 6);
          }
        }
      }

      // ==========================================
      // MODE 2: OSCILLOSCOPE TIME-DOMAIN WAVEFORM
      // ==========================================
      else if (mode === 'wave') {
        const centerY = topMargin + plotHeight / 2;

        // Zero-line center
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(leftMargin, centerY);
        ctx.lineTo(width - rightMargin, centerY);
        ctx.stroke();

        if (timeDataBuffer && hasSignal) {
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = theme.accent;
          ctx.shadowBlur = 8;
          ctx.shadowColor = theme.accentGlow || theme.accent;

          const sliceWidth = plotWidth / timeDataBuffer.length;
          let x = leftMargin;

          for (let i = 0; i < timeDataBuffer.length; i++) {
            const v = (timeDataBuffer[i] - 128) / 128; // -1.0 to +1.0
            const y = centerY - v * (plotHeight / 2) * 0.92;

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }

          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          // Flat standby resting line
          ctx.beginPath();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = theme.textDim;
          ctx.moveTo(leftMargin, centerY);
          ctx.lineTo(width - rightMargin, centerY);
          ctx.stroke();
        }

        // Oscilloscope HUD Info
        ctx.fillStyle = theme.highlight;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('OSCILLOSCOPE: 2048-PT TIME-DOMAIN PCM TRACE', leftMargin + 8, topMargin + 8);

        ctx.fillStyle = theme.textDim;
        ctx.fillText('+1.0V (0dBFS)', leftMargin - 6, topMargin);
        ctx.fillText(' 0.0V (GND)', leftMargin - 6, centerY);
        ctx.fillText('-1.0V (-inf)', leftMargin - 6, topMargin + plotHeight);
      }

      // ==========================================
      // MODE 3: CYBER FREQUENCY MATRIX WATERFALL
      // ==========================================
      else if (mode === 'matrix') {
        const drops = matrixDropsRef.current;
        const colWidth = plotWidth / NUM_BARS;

        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.textAlign = 'center';

        for (let i = 0; i < Math.min(drops.length, NUM_BARS); i++) {
          const drop = drops[i];
          const x = leftMargin + i * colWidth + colWidth / 2;
          const energy = bars[i];

          // Advance drop based on band energy + base speed
          if (hasSignal) {
            drop.y += drop.speed * (0.8 + energy * 3.5);
          } else {
            drop.y += 0.2;
          }

          if (drop.y * 14 > plotHeight) {
            drop.y = 0;
          }

          const startRow = Math.floor(drop.y);

          for (let r = 0; r < 14; r++) {
            const charIndex = (r + i) % drop.chars.length;
            const char = drop.chars[charIndex];
            const charY = topMargin + (startRow - r) * 14;

            if (charY >= topMargin && charY <= topMargin + plotHeight) {
              if (r === 0) {
                // Leading character (bright glow)
                ctx.fillStyle = energy > 0.6 ? theme.highlight : '#ffffff';
              } else if (r < 4) {
                ctx.fillStyle = energy > 0.4 ? theme.accent : theme.highlight;
              } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
              }
              ctx.fillText(char, x, charY);
            }
          }
        }
      }

      // Overlay Standby / Paused Banner if not playing
      if (!isPlaying || !hasSignal) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(leftMargin, topMargin, plotWidth, plotHeight);

        ctx.strokeStyle = theme.border;
        ctx.strokeRect(leftMargin + plotWidth / 2 - 190, topMargin + plotHeight / 2 - 24, 380, 48);

        ctx.fillStyle = theme.bg;
        ctx.fillRect(leftMargin + plotWidth / 2 - 189, topMargin + plotHeight / 2 - 23, 378, 46);

        ctx.fillStyle = isPlaying ? theme.warning : theme.highlight;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

        if (isPlaying) {
          ctx.fillText('⏳ BUFFERING / AWAITING PCM AUDIO STREAM...', leftMargin + plotWidth / 2, topMargin + plotHeight / 2);
        } else {
          ctx.fillText('○ [ STANDBY ] PLAY TRACK TO ACTIVATE SPECTRUM', leftMargin + plotWidth / 2, topMargin + plotHeight / 2);
        }
      }

      ctx.restore();

      if (isPlaying) animFrameRef.current = requestAnimationFrame(render);
      else setFps(0);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [mode, isPlaying, theme, sensitivity, maxFrameRate]);

  // Stereo VU bar percentage calculation
  const rmsNorm = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));
  const peakNorm = Math.max(0, Math.min(100, Math.round(((peakDb + 60) / 60) * 100)));

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col min-h-0 relative select-none font-mono overflow-hidden text-xs w-full h-full"
      style={{ backgroundColor: theme.bg }}
    >
      {/* Top Header Bar */}
      <div
        className="px-3 py-2 border-b flex items-center justify-between z-10 flex-wrap gap-2"
        style={{
          borderColor: theme.border,
          backgroundColor: theme.cardBg,
        }}
      >
        <div className="flex items-center gap-2 truncate">
          <Activity className="w-4 h-4 animate-pulse" style={{ color: theme.accent }} />
          <span className="font-bold text-xs" style={{ color: theme.highlight }}>
            {mode === 'bars'
              ? '┌─ Real-time 56-Band FFT Audio Equalizer ─'
              : mode === 'wave'
              ? '┌─ Real-time Audio Oscilloscope Waveform ─'
              : '┌─ Real-time Frequency Matrix Waterfall ─'}
          </span>
          <span
            className="px-2 py-0.5 border text-[10px] font-bold"
            style={{
              borderColor: isPlaying ? theme.accent : theme.border,
              color: isPlaying ? theme.accent : theme.textDim,
              backgroundColor: isPlaying ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
            }}
          >
            {isPlaying ? `● LIVE: ${currentTrack?.title || 'Playing'}` : '○ [ PAUSED ]'}
          </span>
        </div>

        {/* Action Controls & Modes */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* Sensitivity Adjuster */}
          <button
            type="button"
            onClick={() => {
              const currentIndex = GAIN_PRESETS.findIndex(value => Math.abs(value - sensitivity) < 0.05);
              const nextSensitivity = GAIN_PRESETS[(currentIndex + 1) % GAIN_PRESETS.length];
              setSensitivity(nextSensitivity);
              savePlayerPreferences({ spectrumSensitivity: nextSensitivity });
            }}
            title="Adjust visualizer gain / automatic sensitivity"
            className="px-2 py-0.5 border hover:brightness-125 transition-all text-[10px]"
            style={{
              borderColor: sensitivity === 0 ? theme.accent : theme.border,
              color: sensitivity === 0 ? theme.highlight : theme.textDim,
              backgroundColor: sensitivity === 0 ? 'rgba(0, 240, 255, 0.08)' : theme.bg,
            }}
          >
            Gain: {sensitivity === 0 ? `AUTO (${liveAutoGain.toFixed(1)}x)` : `${sensitivity.toFixed(1)}x`}
          </button>

          {(['bars', 'wave', 'matrix'] as const).map(value => (
            <button key={value} type="button" aria-pressed={mode === value}
              onClick={() => { setMode(value); savePlayerPreferences({ spectrumMode: value }); }}
              className="px-2.5 py-0.5 border uppercase font-bold hover:brightness-125 transition-all flex items-center gap-1"
              style={{ borderColor: mode === value ? theme.accent : theme.border,
                color: mode === value ? theme.highlight : theme.textDim,
                backgroundColor: mode === value ? 'rgba(255,255,255,0.08)' : theme.bg }}>
              {value === 'bars' && <BarChart2 className="w-3 h-3" />}
              {value === 'wave' && <Waves className="w-3 h-3" />}
              {value === 'matrix' && <Cpu className="w-3 h-3" />}
              <span>[{value}]</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Full-Size Visualization Canvas Area */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden flex flex-col p-2 sm:p-3">
        <div
          className="flex-1 w-full h-full min-h-0 border relative flex flex-col shadow-inner overflow-hidden"
          style={{ borderColor: theme.border, backgroundColor: '#040608' }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full flex-1 block"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      </div>

      {/* Bottom Live Acoustic Metrics & Stereo VU Meter */}
      <div
        className="px-3 py-2 border-t flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px]"
        style={{
          borderColor: theme.border,
          backgroundColor: theme.cardBg,
        }}
      >
        {/* Left: Stereo VU Meters */}
        <div className="flex items-center gap-4 w-full sm:w-auto">
          {/* L Channel */}
          <div className="flex items-center gap-1.5 flex-1 sm:flex-initial">
            <span className="font-bold text-[10px]" style={{ color: theme.accent }}>L:</span>
            <div className="w-28 sm:w-36 h-2.5 border bg-black/60 relative overflow-hidden" style={{ borderColor: theme.border }}>
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${rmsNorm}%`,
                  backgroundColor: rmsNorm > 85 ? theme.error : rmsNorm > 70 ? theme.warning : theme.accent,
                }}
              />
            </div>
            <span className="text-[10px] w-12 font-mono text-right" style={{ color: theme.textDim }}>
              {rmsDb <= -90 ? '-inf' : `${rmsDb}dB`}
            </span>
          </div>

          {/* R Channel */}
          <div className="flex items-center gap-1.5 flex-1 sm:flex-initial">
            <span className="font-bold text-[10px]" style={{ color: theme.accent }}>R:</span>
            <div className="w-28 sm:w-36 h-2.5 border bg-black/60 relative overflow-hidden" style={{ borderColor: theme.border }}>
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${peakNorm}%`,
                  backgroundColor: peakNorm > 85 ? theme.error : peakNorm > 70 ? theme.warning : theme.highlight,
                }}
              />
            </div>
            <span className="text-[10px] w-12 font-mono text-right" style={{ color: theme.textDim }}>
              {peakDb <= -90 ? '-inf' : `${peakDb}dB`}
            </span>
          </div>
        </div>

        {/* Center / Right: Live Engine Telemetry */}
        <div className="flex items-center gap-3 text-[10px] flex-wrap justify-end" style={{ color: theme.textDim }}>
          <div>
            <span>Peak Note: </span>
            <span className="font-bold" style={{ color: theme.highlight }}>{peakNote}</span>
          </div>
          <div className="hidden md:inline">
            <span>Filter: </span>
            <span style={{ color: theme.highlight }}>Monstercat 5-pt</span>
          </div>
          <div className="hidden md:inline">
            <span>DAC: </span>
            <span style={{ color: theme.text }}>44.1kHz • 24-Bit</span>
          </div>
          <div>
            <span>FFT: </span>
            <span style={{ color: theme.text }}>2048 Bins</span>
          </div>
          <div className="font-bold" style={{ color: fps >= 55 ? theme.accent : theme.warning }}>
            [{fps} FPS]
          </div>
        </div>
      </div>
    </div>
  );
};
