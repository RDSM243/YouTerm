export type AudioEngineStateCallback = (state: number) => void;
export type AudioEngineTimeCallback = (currentTime: number, duration: number) => void;
export type AudioEngineErrorCallback = (errorCode: number, videoId: string, message?: string) => void;
export type AudioEngineFormatCallback = (format: AudioFormat, isChanging: boolean) => void;

type AudioFormat = 'm4a' | 'webm';
const AUDIO_TYPES: Record<AudioFormat, string> = {
  m4a: 'audio/mp4; codecs="mp4a.40.2"',
  webm: 'audio/webm; codecs="opus"',
};

// Preserve the player's state values: ended=0, playing=1, paused=2, buffering=3.
export class YouTubeAudioEngine {
  private audio: HTMLAudioElement | null = null;
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
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserGain: GainNode | null = null;
  private analyserAudio: HTMLAudioElement | null = null;
  private onStateChangeCallback?: AudioEngineStateCallback;
  private onTimeUpdateCallback?: AudioEngineTimeCallback;
  private onErrorCallback?: AudioEngineErrorCallback;
  private onFormatChangeCallback?: AudioEngineFormatCallback;
  private stallWatchdog: ReturnType<typeof setTimeout> | null = null;

  private clearWatchdog() {
    if (this.stallWatchdog) {
      clearTimeout(this.stallWatchdog);
      this.stallWatchdog = null;
    }
  }

  private resetWatchdog(timeoutMs = 15000) {
    this.clearWatchdog();
    if (this.playbackRequested) {
      this.stallWatchdog = setTimeout(() => {
        const audio = this.audio;
        const videoId = this.currentVideoId;
        if (!audio || !videoId) return;
        if (audio.paused && !audio.ended) {
          audio.play().catch(() => {});
        }
        if (audio.readyState < 2 || audio.paused) {
          void this.reportMediaError(audio, videoId);
        }
      }, timeoutMs);
    }
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
    this.attemptedFormats.clear();
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

  private loadAudio(videoId: string, requestedFormat?: AudioFormat, resumeAt = 0) {
    const previous = this.audio;
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
    audio.volume = this.currentVolume / 100;
    audio.muted = this.muted;
    this.currentFormat = requestedFormat ?? prepared?.format ?? this.chooseFormat(audio);
    this.attemptedFormats.add(this.currentFormat);
    const formatQuery = this.currentFormat === 'webm' ? '?format=webm' : '';

    const onState = (state: number) => {
      if (this.audio === audio) this.onStateChangeCallback?.(state);
    };
    const format = this.currentFormat;
    audio.addEventListener('playing', () => {
      this.clearWatchdog();
      if (this.audio === audio) {
        this.preferredFormat = format;
        this.isChangingFormat = false;
        this.onFormatChangeCallback?.(format, false);
      }
      onState(1);
    });
    audio.addEventListener('canplay', () => {
      if (this.audio !== audio) return;
      if (this.playbackRequested && audio.paused) {
        audio.play().catch((error: DOMException) => {
          if (this.audio === audio && error.name !== 'AbortError') {
            void this.reportMediaError(audio, videoId, error);
          }
        });
      }
    });
    audio.addEventListener('pause', () => {
      this.clearWatchdog();
      if (this.audio !== audio) return;
      if (!audio.ended) onState(2);
      this.isChangingFormat = false;
      this.onFormatChangeCallback?.(this.currentFormat, false);
    });
    audio.addEventListener('waiting', () => {
      if (this.audio === audio) {
        onState(3);
        this.resetWatchdog(12000);
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
      onState(0);
    });
    const updateTime = () => {
      if (this.audio === audio) this.onTimeUpdateCallback?.(this.getCurrentTime(), this.getDuration());
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
      void this.reportMediaError(audio, videoId);
    });
    if (!prepared) audio.src = `/api/audio/${encodeURIComponent(videoId)}/stream${formatQuery}`;
    onState(3);
    if (audio.readyState > 0) updateTime();
    this.resetWatchdog(16000);
    // Call play during the user's interaction, without waiting for extraction.
    this.play();
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
    void audio.play().catch((error: DOMException) => {
      if (this.audio !== audio || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.onStateChangeCallback?.(2);
        this.onErrorCallback?.(0, videoId, 'Playback was blocked by the browser. Click PLAY to start the audio.');
      } else {
        void this.reportMediaError(audio, videoId, error);
      }
    });
  }

  public pause() {
    this.playbackRequested = false;
    this.clearWatchdog();
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
      this.analyserAudio.currentTime = targetTime;
    }
  }

  public setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.currentVolume = Math.max(0, Math.min(100, volume));
    if (this.audio) this.audio.volume = this.currentVolume / 100;
  }

  public mute() {
    this.muted = true;
    if (this.audio) this.audio.muted = true;
  }

  public unMute() {
    this.muted = false;
    if (this.audio) this.audio.muted = false;
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

  public getAnalyser(): AnalyserNode | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        this.audioContext = new AudioCtx();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.minDecibels = -85;
        this.analyser.maxDecibels = -10;
        this.analyser.smoothingTimeConstant = 0.4;
        this.analyserGain = this.audioContext.createGain();
        this.analyserGain.gain.value = 0;
        this.analyser.connect(this.analyserGain);
        this.analyserGain.connect(this.audioContext.destination);
      }

      if (!this.analyserAudio && this.audioContext && this.analyser) {
        const tap = new Audio();
        tap.crossOrigin = 'anonymous';
        tap.preload = 'auto';
        const source = this.audioContext.createMediaElementSource(tap);
        source.connect(this.analyser);
        this.analyserAudio = tap;
      }

      if (this.analyserAudio && this.audio) {
        const mainSrc = this.audio.src;
        if (mainSrc && this.analyserAudio.src !== mainSrc) {
          this.analyserAudio.src = mainSrc;
          this.analyserAudio.currentTime = this.audio.currentTime || 0;
        }
        const isMainPlaying = !this.audio.paused && !this.audio.ended && !!mainSrc;
        if (isMainPlaying) {
          if (this.audioContext && this.audioContext.state === 'suspended') {
            void this.audioContext.resume();
          }
          if (this.analyserAudio.readyState >= 1 && Math.abs(this.analyserAudio.currentTime - this.audio.currentTime) > 0.35) {
            this.analyserAudio.currentTime = this.audio.currentTime;
          }
          if (this.analyserAudio.paused) {
            void this.analyserAudio.play().catch(() => {});
          }
        } else if (!this.analyserAudio.paused) {
          this.analyserAudio.pause();
        }
      }

      return this.analyser;
    } catch {
      return null;
    }
  }
}

export const audioEngine = new YouTubeAudioEngine();
