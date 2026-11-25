import type { AudioMixerState } from '../types';
import {
  computeEffectivePreampDb,
  DEFAULT_AUDIO_MIXER_STATE,
  loadAudioMixerState,
  MIXER_ISO_BANDS,
  normalizeAudioMixerState,
} from './audioMixerStorage';

export type AudioEngineStateCallback = (state: number) => void;
export type AudioEngineTimeCallback = (currentTime: number, duration: number) => void;
export type AudioEngineErrorCallback = (errorCode: number, videoId: string, message?: string) => void;
export type AudioEngineFormatCallback = (format: AudioFormat, isChanging: boolean) => void;

type AudioFormat = 'm4a' | 'webm';
const AUDIO_TYPES: Record<AudioFormat, string> = {
  m4a: 'audio/mp4; codecs="mp4a.40.2"',
  webm: 'audio/webm; codecs="opus"',
};

function isMixerEqActive(state: AudioMixerState): boolean {
  if (!state.enabled) return false;
  return (
    Math.abs(state.bass) >= 0.1 ||
    Math.abs(state.mid) >= 0.1 ||
    Math.abs(state.treble) >= 0.1 ||
    Math.abs(state.subBass) >= 0.1 ||
    Math.abs(state.presence) >= 0.1 ||
    Math.abs(state.air) >= 0.1 ||
    Math.abs(state.balance) >= 1 ||
    state.compressor ||
    state.mono ||
    state.bands.some(b => Math.abs(b) >= 0.1)
  );
}

function buildMixerEqQuery(state: AudioMixerState): string {
  if (!isMixerEqActive(state)) return '';
  const { effectivePreampDb } = computeEffectivePreampDb(state);
  const params = new URLSearchParams();
  params.set('eq', '1');
  params.set('bass', state.bass.toFixed(1));
  params.set('mid', state.mid.toFixed(1));
  params.set('treble', state.treble.toFixed(1));
  params.set('sub', state.subBass.toFixed(1));
  params.set('pres', state.presence.toFixed(1));
  params.set('air', state.air.toFixed(1));
  params.set('preamp', effectivePreampDb.toFixed(1));
  params.set('pan', (state.balance / 100).toFixed(2));
  if (state.compressor) params.set('comp', '1');
  if (state.mono) params.set('mono', '1');
  params.set('bands', state.bands.map(b => b.toFixed(1)).join(','));
  return params.toString();
}

// Preserve the player's state values: ended=0, playing=1, paused=2, buffering=3.
export class YouTubeAudioEngine {
  private audio: HTMLAudioElement | null = null;
  private swapAudio: HTMLAudioElement | null = null;
  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private activeEqSignature = '';
  private currentVideoId: string | null = null;
  private currentVolume = 100;
  private muted = false;
  private reportedError: HTMLAudioElement | null = null;
  private currentFormat: AudioFormat = 'm4a';
  private isChangingFormat = false;
  private attemptedFormats = new Set<AudioFormat>();
  private playbackRequested = false;
  private preferredFormat: AudioFormat | null = null;
  private preparedAudio = new Map<string, { audio: HTMLAudioElement; format: AudioFormat; expiresAt: number }>();
  private sourceQueue: string[] = [];
  private warmingSource: string | null = null;
  private warmingSources = false;
  private sourcePreparation: Promise<void> = Promise.resolve();
  private preparedSources = new Map<string, number>();

  // Secondary silent WebAudio tap strictly for SpectrumVisualizer & Mixer VU meters.
  // Never attaches createMediaElementSource to `this.audio` so native playback is never muted.
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserLeft: AnalyserNode | null = null;
  private analyserRight: AnalyserNode | null = null;
  private analyserSplitter: ChannelSplitterNode | null = null;
  private analyserGain: GainNode | null = null;
  private analyserAudio: HTMLAudioElement | null = null;
  private analyserTapSrc = '';
  private analyserPreamp: GainNode | null = null;
  private analyserSubBass: BiquadFilterNode | null = null;
  private analyserBass: BiquadFilterNode | null = null;
  private analyserMid: BiquadFilterNode | null = null;
  private analyserPresence: BiquadFilterNode | null = null;
  private analyserTreble: BiquadFilterNode | null = null;
  private analyserAir: BiquadFilterNode | null = null;
  private analyserEqFilters: BiquadFilterNode[] = [];

  private mixerState: AudioMixerState = typeof window !== 'undefined'
    ? loadAudioMixerState()
    : { ...DEFAULT_AUDIO_MIXER_STATE, bands: [...DEFAULT_AUDIO_MIXER_STATE.bands] };

  private onStateChangeCallback?: AudioEngineStateCallback;
  private onTimeUpdateCallback?: AudioEngineTimeCallback;
  private onErrorCallback?: AudioEngineErrorCallback;
  private onFormatChangeCallback?: AudioEngineFormatCallback;
  private stallWatchdog: ReturnType<typeof setTimeout> | null = null;
  private lastEmittedState: number | null = null;
  private streamRecoveryCount = 0;
  private lastAnalyserSeekAt = 0;
  private lastAnalyserPlayAt = 0;

  private emitState(audio: HTMLAudioElement, state: number) {
    if (this.audio !== audio) return;
    if (this.lastEmittedState === state && (state === 1 || state === 3)) return;
    this.lastEmittedState = state;
    this.onStateChangeCallback?.(state);
  }

  private clearWatchdog() {
    if (this.stallWatchdog) {
      clearTimeout(this.stallWatchdog);
      this.stallWatchdog = null;
    }
  }

  private clearSwap() {
    if (this.swapTimer) {
      clearTimeout(this.swapTimer);
      this.swapTimer = null;
    }
    if (this.swapAudio) {
      const pending = this.swapAudio;
      this.swapAudio = null;
      pending.pause();
      pending.removeAttribute('src');
      pending.load();
    }
  }

  private recoverMidStream(audio: HTMLAudioElement, videoId: string): boolean {
    if (this.audio !== audio || !this.playbackRequested || this.streamRecoveryCount >= 2) {
      return false;
    }
    this.streamRecoveryCount += 1;
    const resumeAt = Number.isFinite(audio.currentTime) && audio.currentTime > 0.5 ? audio.currentTime : 0;
    this.loadAudio(videoId, this.currentFormat, resumeAt);
    return true;
  }

  private resetWatchdog(timeoutMs = 12000) {
    this.clearWatchdog();
    if (this.playbackRequested) {
      this.stallWatchdog = setTimeout(() => {
        const audio = this.audio;
        const videoId = this.currentVideoId;
        if (!audio || !videoId || !this.playbackRequested) return;
        // If playback is actually ready and advancing, clear buffering instead of triggering an error.
        if (!audio.paused && !audio.ended && audio.readyState >= 3) {
          this.emitState(audio, 1);
          return;
        }
        if (audio.paused && !audio.ended) {
          audio.play().catch(() => {});
        }
        if (audio.readyState < 3 || audio.paused) {
          if (!this.recoverMidStream(audio, videoId)) {
            void this.reportMediaError(audio, videoId);
          }
        }
      }, timeoutMs);
    }
  }

  public isReadyForPlayback(): boolean {
    return !!this.audio && this.audio.readyState >= 3 && !this.audio.error;
  }

  public setCallbacks(
    onStateChange: AudioEngineStateCallback,
    onTimeUpdate: AudioEngineTimeCallback,
    onError?: AudioEngineErrorCallback,
    onFormatChange?: AudioEngineFormatCallback,
  ) {
    this.onStateChangeCallback = onStateChange;
    this.onTimeUpdateCallback = onTimeUpdate;
    this.onErrorCallback = onError;
    this.onFormatChangeCallback = onFormatChange;
  }

  public loadAndPlay(videoId: string) {
    if (!videoId || typeof Audio === 'undefined') return;
    this.sourceQueue = [];
    this.clearWatchdog();
    this.clearSwap();
    this.attemptedFormats.clear();
    this.streamRecoveryCount = 0;
    this.isChangingFormat = false;
    this.loadAudio(videoId);
  }

  public prepare(videoId: string) {
    if (!videoId || typeof Audio === 'undefined' || (videoId === this.currentVideoId && !this.audio?.error)) return;
    const existing = this.preparedAudio.get(videoId);
    if (existing && existing.expiresAt > Date.now() && !existing.audio.error) return;
    if (existing) this.discardPrepared(videoId);
    // Keep only the selection and the next track buffered in memory.
    if (this.preparedAudio.size >= 2) this.discardPrepared(this.preparedAudio.keys().next().value!);
    const audio = new Audio();
    const format = this.chooseFormat(audio);
    audio.preload = 'metadata';
    audio.muted = true;
    this.preparedAudio.set(videoId, { audio, format, expiresAt: Date.now() + 4 * 60_000 });
    audio.addEventListener('error', () => {
      if (this.preparedAudio.get(videoId)?.audio === audio) this.discardPrepared(videoId);
    }, { once: true });
    audio.src = `/api/audio/${encodeURIComponent(videoId)}/stream${format === 'webm' ? '?format=webm' : ''}`;
    audio.load();
  }

  public prepareList(videoIds: string[]): Promise<void> {
    // Warm metadata separately from the two audio buffers, keeping bandwidth bounded.
    this.sourceQueue = [...new Set(videoIds)].filter(videoId => this.shouldPrepareSource(videoId)).slice(0, 12);
    if (!this.warmingSources && this.sourceQueue.length > 0) {
      this.warmingSources = true;
      this.sourcePreparation = this.prepareSources();
    }
    return this.sourcePreparation;
  }

  public clearPreparation() {
    this.sourceQueue = [];
    for (const id of this.preparedAudio.keys()) this.discardPrepared(id);
  }

  private shouldPrepareSource(videoId: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId) && videoId !== this.currentVideoId &&
      videoId !== this.warmingSource && !this.preparedAudio.has(videoId) &&
      (this.preparedSources.get(videoId) || 0) <= Date.now();
  }

  private async prepareSources() {
    try {
      while (this.sourceQueue.length > 0) {
        const videoId = this.sourceQueue.shift()!;
        if (!this.shouldPrepareSource(videoId)) continue;
        this.warmingSource = videoId;
        let lifetime = 10_000;
        try {
          const query = (this.preferredFormat ?? this.currentFormat) === 'webm' ? '?format=webm' : '';
          const response = await fetch(`/api/audio/${encodeURIComponent(videoId)}${query}`);
          if (response.ok) lifetime = 4 * 60_000;
          // Consume the response so background requests release their connections.
          await response.text();
        } catch {
          // Background preparation must not interrupt playback or report a track error.
        } finally {
          this.warmingSource = null;
        }
        if (this.preparedSources.size >= 100) this.preparedSources.delete(this.preparedSources.keys().next().value!);
        this.preparedSources.set(videoId, Date.now() + lifetime);
      }
    } finally {
      this.warmingSources = false;
    }
  }

  private chooseFormat(audio: HTMLAudioElement): AudioFormat {
    if (this.preferredFormat && audio.canPlayType(AUDIO_TYPES[this.preferredFormat])) return this.preferredFormat;
    return audio.canPlayType(AUDIO_TYPES.m4a) ? 'm4a' : 'webm';
  }

  private discardPrepared(videoId: string) {
    const prepared = this.preparedAudio.get(videoId);
    if (!prepared) return;
    this.preparedAudio.delete(videoId);
    prepared.audio.pause();
    prepared.audio.removeAttribute('src');
    prepared.audio.load();
  }

  private computeElementVolume(): number {
    const { effectivePreampDb } = computeEffectivePreampDb(this.mixerState);
    const preampGain = this.mixerState.enabled && !this.activeEqSignature
      ? Math.pow(10, effectivePreampDb / 20)
      : 1;
    return Math.max(0, Math.min(1, (this.currentVolume / 100) * preampGain));
  }

  private syncVolumeToAudio(target: HTMLAudioElement | null = this.audio) {
    if (!target) return;
    target.volume = this.computeElementVolume();
    target.muted = this.muted;
  }

  private updateAnalyserFilters() {
    const active = this.mixerState.enabled;
    const { effectivePreampDb } = computeEffectivePreampDb(this.mixerState);
    if (this.analyserPreamp) {
      this.analyserPreamp.gain.value = active ? Math.pow(10, effectivePreampDb / 20) : 1.0;
    }
    if (this.analyserSubBass) this.analyserSubBass.gain.value = active ? this.mixerState.subBass : 0;
    if (this.analyserBass) this.analyserBass.gain.value = active ? this.mixerState.bass : 0;
    if (this.analyserMid) this.analyserMid.gain.value = active ? this.mixerState.mid : 0;
    if (this.analyserPresence) this.analyserPresence.gain.value = active ? this.mixerState.presence : 0;
    if (this.analyserTreble) this.analyserTreble.gain.value = active ? this.mixerState.treble : 0;
    if (this.analyserAir) this.analyserAir.gain.value = active ? this.mixerState.air : 0;
    for (let i = 0; i < this.analyserEqFilters.length; i++) {
      this.analyserEqFilters[i].gain.value = active ? (this.mixerState.bands[i] || 0) : 0;
    }
  }

  public getMixerState(): AudioMixerState {
    return this.mixerState;
  }

  public setMixerState(state: AudioMixerState) {
    this.mixerState = normalizeAudioMixerState(state);
    this.syncVolumeToAudio();
    this.updateAnalyserFilters();
    this.scheduleEqHotSwap();
  }

  /**
   * Prepares an equalized GStreamer stream in the background while `this.audio` continues playing
   * uninterrupted, swapping over only once the new stream is ready and playing at the current timestamp.
   */
  private scheduleEqHotSwap(delayMs = 380) {
    const nextSignature = buildMixerEqQuery(this.mixerState);
    if (nextSignature === this.activeEqSignature) {
      this.clearSwap();
      return;
    }
    if (this.swapTimer) {
      clearTimeout(this.swapTimer);
      this.swapTimer = null;
    }
    const videoId = this.currentVideoId;
    const currentAudio = this.audio;
    if (!videoId || !currentAudio) return;

    this.swapTimer = setTimeout(() => {
      this.swapTimer = null;
      if (this.currentVideoId !== videoId || !this.audio) return;
      const targetSignature = buildMixerEqQuery(this.mixerState);
      if (targetSignature === this.activeEqSignature) return;

      if (this.swapAudio) {
        this.swapAudio.pause();
        this.swapAudio.removeAttribute('src');
        this.swapAudio.load();
        this.swapAudio = null;
      }

      const wasPlaying = this.playbackRequested && !this.audio.paused && !this.audio.ended;
      const next = new Audio();
      next.preload = 'auto';
      next.volume = this.computeElementVolume();
      next.muted = this.muted;
      this.swapAudio = next;

      const format = this.currentFormat;
      const queryParts: string[] = [];
      if (format === 'webm') queryParts.push('format=webm');
      if (targetSignature) queryParts.push(targetSignature);
      const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

      let swapped = false;
      const promoteSwap = () => {
        if (swapped || this.swapAudio !== next || this.currentVideoId !== videoId) return;
        swapped = true;
        this.swapAudio = null;
        const oldAudio = this.audio;
        const targetTime = oldAudio ? oldAudio.currentTime : 0;
        if (targetTime > 0 && Math.abs(next.currentTime - targetTime) > 0.25) {
          try { next.currentTime = targetTime; } catch {}
        }

        const completePromotion = () => {
          if (this.currentVideoId !== videoId) {
            next.pause();
            next.removeAttribute('src');
            next.load();
            return;
          }
          this.activeEqSignature = targetSignature;
          this.attachPrimaryListeners(next, videoId, format);
          this.audio = next;
          this.syncVolumeToAudio(next);
          if (oldAudio && oldAudio !== next) {
            oldAudio.pause();
            oldAudio.removeAttribute('src');
            oldAudio.load();
          }
        };

        if (wasPlaying || (this.playbackRequested && oldAudio && !oldAudio.paused)) {
          next.play().then(completePromotion).catch(() => {
            // If the equalized stream fails to play, keep the original audio playing uninterrupted.
            next.pause();
            next.removeAttribute('src');
            next.load();
          });
        } else {
          completePromotion();
        }
      };

      next.addEventListener('canplay', promoteSwap, { once: true });
      next.addEventListener('error', () => {
        if (this.swapAudio === next) {
          this.swapAudio = null;
        }
      }, { once: true });

      next.src = `/api/audio/${encodeURIComponent(videoId)}/stream${queryString}`;
      next.load();
    }, delayMs);
  }

  private attachPrimaryListeners(audio: HTMLAudioElement, videoId: string, format: AudioFormat, resumeAt = 0) {
    let lastProgressTime = -1;

    const markPlaying = () => {
      this.clearWatchdog();
      if (this.audio === audio) {
        this.streamRecoveryCount = 0;
        this.preferredFormat = format;
        this.isChangingFormat = false;
        this.onFormatChangeCallback?.(format, false);
        this.emitState(audio, 1);
        this.syncAnalyserTap(true);
      }
    };

    audio.addEventListener('playing', markPlaying);
    audio.addEventListener('canplaythrough', () => {
      if (this.audio !== audio) return;
      if (this.playbackRequested && !audio.paused && !audio.ended) {
        markPlaying();
      }
    });
    audio.addEventListener('canplay', () => {
      if (this.audio !== audio) return;
      if (this.playbackRequested && audio.paused) {
        audio.play().then(() => {
          if (this.audio === audio && this.playbackRequested && !audio.paused && audio.readyState >= 3) {
            markPlaying();
          }
        }).catch((error: DOMException) => {
          if (this.audio === audio && error.name !== 'AbortError') {
            void this.reportMediaError(audio, videoId, error);
          }
        });
      } else if (this.playbackRequested && !audio.paused && audio.readyState >= 3) {
        markPlaying();
      }
    });
    audio.addEventListener('pause', () => {
      this.clearWatchdog();
      if (this.audio !== audio) return;
      if (!audio.ended) this.emitState(audio, 2);
      this.isChangingFormat = false;
      this.onFormatChangeCallback?.(this.currentFormat, false);
      if (this.analyserAudio && !this.analyserAudio.paused) {
        this.analyserAudio.pause();
      }
    });
    audio.addEventListener('waiting', () => {
      if (this.audio === audio && this.playbackRequested && !audio.paused && audio.readyState < 3) {
        this.emitState(audio, 3);
        this.resetWatchdog(10000);
      }
    });
    audio.addEventListener('stalled', () => {
      if (this.audio === audio && this.playbackRequested && !audio.paused && !audio.ended && audio.readyState < 3) {
        this.emitState(audio, 3);
        this.resetWatchdog(6500);
      }
    });
    audio.addEventListener('ended', () => {
      this.clearWatchdog();
      if (this.audio !== audio) return;
      this.isChangingFormat = false;
      this.onFormatChangeCallback?.(this.currentFormat, false);
      if (this.analyserAudio) {
        this.analyserAudio.pause();
      }
      this.emitState(audio, 0);
    });
    const updateTime = () => {
      if (this.audio !== audio) return;
      const nowTime = this.getCurrentTime();
      if (nowTime > lastProgressTime + 0.01) {
        lastProgressTime = nowTime;
        this.clearWatchdog();
        this.streamRecoveryCount = 0;
        if (this.playbackRequested && !audio.paused && !audio.ended && audio.readyState >= 3) {
          this.emitState(audio, 1);
        }
      }
      this.onTimeUpdateCallback?.(nowTime, this.getDuration());
    };
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('durationchange', updateTime);
    audio.addEventListener('loadedmetadata', () => {
      if (this.audio !== audio) return;
      if (resumeAt > 0) this.seekTo(resumeAt);
      updateTime();
    });
    audio.addEventListener('error', () => {
      this.clearWatchdog();
      if (this.audio !== audio) return;
      if (audio.currentTime > 0.5 && this.recoverMidStream(audio, videoId)) {
        return;
      }
      void this.reportMediaError(audio, videoId);
    });
  }

  private loadAudio(videoId: string, requestedFormat?: AudioFormat, resumeAt = 0) {
    const previous = this.audio;
    this.clearSwap();
    this.activeEqSignature = '';
    this.lastEmittedState = null;
    let prepared = this.preparedAudio.get(videoId);
    if (prepared && (prepared.expiresAt <= Date.now() || prepared.audio.error)) {
      this.discardPrepared(videoId);
      prepared = undefined;
    }
    if (requestedFormat && prepared?.format !== requestedFormat) prepared = undefined;
    if (prepared) this.preparedAudio.delete(videoId);
    // Isolate events from tracks whose media requests were still pending.
    const audio = prepared?.audio ?? new Audio();
    this.audio = audio;
    this.currentVideoId = videoId;
    this.reportedError = null;
    if (previous) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    if (this.analyserAudio) {
      this.analyserAudio.pause();
    }
    audio.preload = 'auto';
    this.syncVolumeToAudio(audio);
    this.currentFormat = requestedFormat ?? prepared?.format ?? this.chooseFormat(audio);
    this.attemptedFormats.add(this.currentFormat);
    const formatQuery = this.currentFormat === 'webm' ? '?format=webm' : '';

    this.attachPrimaryListeners(audio, videoId, this.currentFormat, resumeAt);

    if (!prepared) audio.src = `/api/audio/${encodeURIComponent(videoId)}/stream${formatQuery}`;
    this.emitState(audio, audio.readyState >= 3 ? 1 : 3);
    if (audio.readyState > 0) this.onTimeUpdateCallback?.(this.getCurrentTime(), this.getDuration());
    this.resetWatchdog(14000);
    // Start the analyser WebM tap immediately in parallel with primary playback so the spectrum wakes up fast.
    this.ensureAnalyserGraph();
    this.syncAnalyserTap(true);
    // Call play during the user's interaction, without waiting for extraction.
    this.play();

    // If the user has active EQ settings, prepare the GStreamer-equalized stream in the background.
    if (isMixerEqActive(this.mixerState)) {
      this.scheduleEqHotSwap(180);
    }
  }

  private async reportMediaError(audio: HTMLAudioElement, videoId: string, playError?: DOMException) {
    this.clearWatchdog();
    if (this.audio !== audio || this.reportedError === audio) return;
    this.reportedError = audio;
    const format = this.currentFormat;
    const formatError = audio.error?.code === 3 || audio.error?.code === 4 || playError?.name === 'NotSupportedError';
    let tryAnotherFormat = false;
    let code = 502;
    let message = 'Could not play this audio stream. Check your connection and try again.';
    try {
      const formatQuery = format === 'webm' ? '?format=webm' : '';
      const response = await fetch(`/api/audio/${encodeURIComponent(videoId)}${formatQuery}`);
      if (!response.ok) {
        code = response.status;
        const data = await response.json();
        if (typeof data.error === 'string') message = data.error;
        tryAnotherFormat = code === 422;
      } else if (formatError) {
        tryAnotherFormat = true;
        message = 'Could not load or decode this track in a supported audio format. Try again or choose another version.';
      }
    } catch {
      message = 'Could not reach the audio server. Check your connection and try again.';
    }
    if (this.audio !== audio) return;
    const alternative = format === 'm4a' ? 'webm' : 'm4a';
    // Capability checks are estimates; retry the same recording once in the other format.
    if (tryAnotherFormat && this.playbackRequested && !this.attemptedFormats.has(alternative) && audio.canPlayType(AUDIO_TYPES[alternative])) {
      this.isChangingFormat = true;
      this.onFormatChangeCallback?.(alternative, true);
      this.loadAudio(videoId, alternative, this.getCurrentTime());
      return;
    }
    this.isChangingFormat = false;
    this.onFormatChangeCallback?.(format, false);
    this.onStateChangeCallback?.(2);
    this.onErrorCallback?.(code, videoId, message);
  }

  public play() {
    const audio = this.audio;
    const videoId = this.currentVideoId;
    if (!audio || !videoId) return;
    this.playbackRequested = true;
    if (audio.error) {
      this.loadAndPlay(videoId);
      return;
    }
    // Pre-warm and resume the analyser tap in the same user gesture.
    this.ensureAnalyserGraph();
    this.syncAnalyserTap(true);

    if (!audio.paused && !audio.ended && audio.readyState >= 3) {
      this.clearWatchdog();
      this.emitState(audio, 1);
      return;
    }

    void audio.play().then(() => {
      if (this.audio === audio && this.playbackRequested && !audio.paused && !audio.ended && audio.readyState >= 3) {
        this.clearWatchdog();
        this.emitState(audio, 1);
        this.syncAnalyserTap(true);
      }
    }).catch((error: DOMException) => {
      if (this.audio !== audio || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.emitState(audio, 2);
        this.onErrorCallback?.(0, videoId, 'Playback was blocked by the browser. Click PLAY to start the audio.');
      } else if (audio.currentTime > 0.5 && this.recoverMidStream(audio, videoId)) {
        return;
      } else {
        void this.reportMediaError(audio, videoId, error);
      }
    });
  }

  public pause() {
    this.playbackRequested = false;
    this.clearWatchdog();
    this.clearSwap();
    this.isChangingFormat = false;
    this.onFormatChangeCallback?.(this.currentFormat, false);
    this.audio?.pause();
    this.analyserAudio?.pause();
  }

  public seekTo(seconds: number) {
    if (!this.audio || !Number.isFinite(seconds) || this.audio.readyState === 0) return;
    const duration = this.getDuration();
    const targetTime = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
    this.audio.currentTime = targetTime;
    if (this.analyserAudio && this.analyserAudio.readyState > 0) {
      this.lastAnalyserSeekAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try { this.analyserAudio.currentTime = targetTime; } catch {}
    }
  }

  public setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.currentVolume = Math.max(0, Math.min(100, volume));
    this.syncVolumeToAudio();
  }

  public mute() {
    this.muted = true;
    this.syncVolumeToAudio();
  }

  public unMute() {
    this.muted = false;
    this.syncVolumeToAudio();
  }

  public getCurrentTime(): number {
    return this.audio?.currentTime || 0;
  }

  public getDuration(): number {
    const duration = this.audio?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  public getCurrentFormat(): AudioFormat {
    return this.currentFormat;
  }

  public isFormatChanging(): boolean {
    return this.isChangingFormat;
  }

  public toggleFormat() {
    this.setFormat(this.currentFormat === 'm4a' ? 'webm' : 'm4a');
  }

  public setFormat(nextFormat: AudioFormat) {
    if (this.isChangingFormat) return;
    this.preferredFormat = nextFormat;
    if (this.currentFormat === nextFormat) return;
    for (const videoId of this.preparedAudio.keys()) this.discardPrepared(videoId);
    if (!this.currentVideoId) {
      this.currentFormat = nextFormat;
      this.onFormatChangeCallback?.(nextFormat, false);
      return;
    }
    this.attemptedFormats.clear();
    this.isChangingFormat = true;
    this.onFormatChangeCallback?.(nextFormat, true);
    this.loadAudio(this.currentVideoId, nextFormat, this.getCurrentTime());
  }

  public getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }

  public isPlayerReady(): boolean {
    return !!this.audio && this.audio.readyState > 0;
  }

  public getAudioElement(): HTMLAudioElement | null {
    return this.audio;
  }

  public stopAnalyser() {
    if (this.analyserAudio && !this.analyserAudio.paused) {
      this.analyserAudio.pause();
    }
  }

  private ensureAnalyserGraph(): boolean {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return false;
    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return false;
        const ctx = new AudioCtx();
        this.audioContext = ctx;

        const createFilter = (type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode => {
          const filter = ctx.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = frequency;
          filter.Q.value = q;
          filter.gain.value = 0;
          return filter;
        };

        this.analyserPreamp = ctx.createGain();
        this.analyserSubBass = createFilter('lowshelf', 55, 0.707);
        this.analyserBass = createFilter('lowshelf', 115, 0.707);
        this.analyserMid = createFilter('peaking', 1000, 0.85);
        this.analyserPresence = createFilter('peaking', 2800, 1.15);
        this.analyserTreble = createFilter('highshelf', 7500, 0.707);
        this.analyserAir = createFilter('highshelf', 13500, 0.707);
        this.analyserEqFilters = MIXER_ISO_BANDS.map(band => createFilter(band.type, band.freq, band.q));

        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.minDecibels = -85;
        this.analyser.maxDecibels = -10;
        this.analyser.smoothingTimeConstant = 0.35;

        this.analyserLeft = ctx.createAnalyser();
        this.analyserLeft.fftSize = 512;
        this.analyserRight = ctx.createAnalyser();
        this.analyserRight.fftSize = 512;
        this.analyserSplitter = ctx.createChannelSplitter(2);

        this.analyserGain = ctx.createGain();
        this.analyserGain.gain.value = 0;

        const chain: AudioNode[] = [
          this.analyserPreamp,
          this.analyserSubBass,
          this.analyserBass,
          this.analyserMid,
          this.analyserPresence,
          this.analyserTreble,
          this.analyserAir,
          ...this.analyserEqFilters,
          this.analyser,
          this.analyserGain,
          ctx.destination,
        ];
        for (let i = 0; i < chain.length - 1; i++) {
          chain[i].connect(chain[i + 1]);
        }

        // Parallel stereo split tap so L/R VU meters read true Left and Right channels.
        const lastEq = this.analyserEqFilters[this.analyserEqFilters.length - 1] ?? this.analyserAir;
        lastEq.connect(this.analyserSplitter);
        this.analyserSplitter.connect(this.analyserLeft, 0);
        this.analyserSplitter.connect(this.analyserRight, 1);
        this.analyserLeft.connect(this.analyserGain);
        this.analyserRight.connect(this.analyserGain);

        this.updateAnalyserFilters();
      }

      if (!this.analyserAudio && this.audioContext && this.analyserPreamp) {
        const tap = new Audio();
        tap.crossOrigin = 'anonymous';
        tap.preload = 'auto';
        const resumeTap = () => {
          if (this.analyserAudio !== tap || !this.audio || !this.playbackRequested) return;
          if (!this.audio.paused && !this.audio.ended && tap.paused && !tap.error) {
            void tap.play().catch(() => {});
          }
        };
        tap.addEventListener('loadedmetadata', () => {
          if (this.analyserAudio === tap && this.audio && this.audio.currentTime > 1.2 && Math.abs(tap.currentTime - this.audio.currentTime) > 0.75) {
            this.lastAnalyserSeekAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            try { tap.currentTime = this.audio.currentTime; } catch {}
          }
        });
        tap.addEventListener('canplay', resumeTap);
        const source = this.audioContext.createMediaElementSource(tap);
        source.connect(this.analyserPreamp);
        this.analyserAudio = tap;
      }

      return true;
    } catch {
      return false;
    }
  }

  private syncAnalyserTap(forcePlay = false): void {
    if (!this.analyserAudio || !this.audio || !this.currentVideoId) return;
    // Use WebM/Opus for the analyser tap because GStreamer's opusdec outputs interleaved PCM
    // which links directly with WebKitGTK's AudioSourceProviderGStreamer deinterleave element.
    const tapSrc = new URL(`/api/audio/${encodeURIComponent(this.currentVideoId)}/stream?format=webm`, window.location.origin).toString();
    if (this.analyserTapSrc !== tapSrc) {
      this.analyserTapSrc = tapSrc;
      this.analyserAudio.src = tapSrc;
      this.analyserAudio.load();
    }

    const shouldPlay = this.playbackRequested && !this.audio.ended && !!this.audio.src && (forcePlay || !this.audio.paused);
    if (shouldPlay) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        void this.audioContext.resume();
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Never seek-thrash on every animation frame while the tap is still seeking or starting from 0s.
      if (
        !this.analyserAudio.seeking &&
        this.analyserAudio.readyState >= 2 &&
        this.audio.currentTime >= 1.2 &&
        now - this.lastAnalyserSeekAt >= 1500 &&
        Math.abs(this.analyserAudio.currentTime - this.audio.currentTime) > 0.75
      ) {
        this.lastAnalyserSeekAt = now;
        try { this.analyserAudio.currentTime = this.audio.currentTime; } catch {}
      }
      if (this.analyserAudio.paused && !this.analyserAudio.error && (forcePlay || now - this.lastAnalyserPlayAt >= 300)) {
        this.lastAnalyserPlayAt = now;
        void this.analyserAudio.play().catch(() => {});
      }
    } else if (!this.analyserAudio.paused) {
      this.analyserAudio.pause();
    }
  }

  public getAnalyser(): AnalyserNode | null {
    if (!this.ensureAnalyserGraph()) return null;
    this.syncAnalyserTap(false);
    return this.analyser;
  }

  public getStereoAnalysers(): { left: AnalyserNode; right: AnalyserNode } | null {
    if (!this.ensureAnalyserGraph()) return null;
    if (!this.analyserLeft || !this.analyserRight) return null;
    return { left: this.analyserLeft, right: this.analyserRight };
  }
}

export const audioEngine = new YouTubeAudioEngine();
