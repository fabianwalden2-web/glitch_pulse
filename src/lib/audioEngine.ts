export type FrequencyBand = 'bass' | 'mid' | 'high' | 'all';

export interface AudioStemNode {
  id: string;
  name: string;
  audioElement?: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null;
  analyserNode: AnalyserNode | null;
  gainNode: GainNode | null;
  isMuted: boolean;
  isSoloed: boolean;
  prevDataArray: Uint8Array | null;
  stream?: MediaStream;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stems: Map<string, AudioStemNode> = new Map();
  public isPlaying: boolean = false;
  
  // For FFT logic
  private fftSize = 8192; // Hugely increased for powerful bass/sub-bass precision
  private freqDataArray: Uint8Array | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.freqDataArray = new Uint8Array(this.fftSize / 2);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  async addStem(id: string, name: string, fileUrl: string): Promise<void> {
    this.init();
    
    const audio = new Audio(fileUrl);
    audio.crossOrigin = "anonymous";
    audio.loop = true; // Stems usually loop or play once, let's keep them looping for test
    audio.preservesPitch = true;

    // Load it fully to ensure sync
    await new Promise((resolve) => {
      audio.addEventListener('canplaythrough', resolve, { once: true });
      audio.load();
    });

    let sourceNode: MediaElementAudioSourceNode | null = null;
    let analyserNode: AnalyserNode | null = null;
    let gainNode: GainNode | null = null;

    if (this.ctx) {
      sourceNode = this.ctx.createMediaElementSource(audio);
      analyserNode = this.ctx.createAnalyser();
      gainNode = this.ctx.createGain();
      
      analyserNode.fftSize = this.fftSize;
      analyserNode.smoothingTimeConstant = 0.5;
      
      // Default analyser maxDecibels is -30dB, which means a mastered modern track (-6dB to 0dB) 
      // will constantly hit the 255 limit (clip), making it impossible to set a threshold *above* it.
      // Adjusting min/max decibels gives us back dynamic range on loud modern music.
      analyserNode.minDecibels = -100;
      analyserNode.maxDecibels = -10;

      // Routing: Source -> Analyser -> Gain -> Destination
      // This ensures we can mute the track (Gain=0) without stopping the Analyser (Visuals)
      sourceNode.connect(analyserNode);
      analyserNode.connect(gainNode);
      gainNode.connect(this.ctx.destination);
    }

    this.stems.set(id, {
      id,
      name,
      audioElement: audio,
      sourceNode,
      analyserNode,
      gainNode,
      isMuted: false,
      isSoloed: false,
      prevDataArray: new Uint8Array(this.fftSize / 2)
    });
  }

  async addLiveInput(id: string = "live-mic", name: string = "Live Mic/Line", deviceId?: string): Promise<void> {
    this.init();
    
    try {
      const constraints: MediaStreamConstraints = { 
        audio: { 
          echoCancellation: false, 
          autoGainControl: false, 
          noiseSuppression: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {})
        }, 
        video: false 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const sourceNode = this.ctx!.createMediaStreamSource(stream);
      const analyserNode = this.ctx!.createAnalyser();
      
      analyserNode.fftSize = this.fftSize;
      analyserNode.smoothingTimeConstant = 0.5;
      analyserNode.minDecibels = -100;
      analyserNode.maxDecibels = -10;
      
      const micGainNode = this.ctx!.createGain();
      micGainNode.gain.value = 2.5; // Apply +8dB boost for low-level mics/instruments
      
      sourceNode.connect(micGainNode);
      micGainNode.connect(analyserNode);
      // NOTE: We do not connect analyserNode to destination or gainNode to avoid speaker feedback loops
      
      // Stop old stream if replacing
      const existing = this.stems.get(id);
      if (existing && existing.stream) {
        existing.stream.getTracks().forEach(track => track.stop());
      }
      
      this.stems.set(id, {
        id,
        name,
        sourceNode,
        analyserNode,
        gainNode: null,
        isMuted: false,
        isSoloed: false,
        prevDataArray: new Uint8Array(this.fftSize / 2),
        stream
      });
    } catch (e) {
      console.error("Microphone access denied or failed", e);
    }
  }

  removeStem(id: string) {
    const stem = this.stems.get(id);
    if (!stem) return;
    
    if (stem.audioElement) {
      stem.audioElement.pause();
      stem.audioElement.src = "";
    }
    if (stem.stream) {
      stem.stream.getTracks().forEach(track => track.stop());
    }
    stem.sourceNode?.disconnect();
    stem.analyserNode?.disconnect();
    if (stem.gainNode) {
      stem.gainNode.disconnect();
    }
    this.stems.delete(id);
  }

  playAll() {
    this.init();
    this.stems.forEach(stem => {
      if (stem.audioElement) {
        stem.audioElement.currentTime = 0;
        stem.audioElement.play().catch(e => console.error("Audio playback failed:", e));
      }
    });
    this.isPlaying = true;
  }

  stopAll() {
    this.stems.forEach(stem => {
      if (stem.audioElement) {
        stem.audioElement.pause();
        stem.audioElement.currentTime = 0;
      }
    });
    this.isPlaying = false;
  }

  seek(timeInSeconds: number) {
    this.stems.forEach(stem => {
      if (stem.audioElement) {
        // Ensure sync bounds
        if (timeInSeconds >= 0 && timeInSeconds <= stem.audioElement.duration) {
           stem.audioElement.currentTime = timeInSeconds;
        } else if (timeInSeconds > stem.audioElement.duration) {
           // If a track is shorter, loop it or clip it
           stem.audioElement.currentTime = timeInSeconds % stem.audioElement.duration;
        }
      }
    });
  }

  getMaxDuration(): number {
    let max = 0;
    this.stems.forEach(stem => {
        if (stem.audioElement && !isNaN(stem.audioElement.duration) && stem.audioElement.duration > max) max = stem.audioElement.duration;
    });
    return max;
  }

  getCurrentTime(): number {
     const first = Array.from(this.stems.values()).find(s => s.audioElement);
     return first ? (first.audioElement!.currentTime || 0) : 0;
  }

  toggleMute(id: string) {
     const stem = this.stems.get(id);
     if (stem) {
         stem.isMuted = !stem.isMuted;
         this._updateGainNodes();
     }
  }

  toggleSolo(id: string) {
     const stem = this.stems.get(id);
     if (stem) {
         stem.isSoloed = !stem.isSoloed;
         this._updateGainNodes();
     }
  }

  private _updateGainNodes() {
      // If any track is soloed, mute everything else (unless it's also soloed)
      let anySolo = false;
      this.stems.forEach(stem => { if (stem.isSoloed) anySolo = true; });

      this.stems.forEach(stem => {
          if (!stem.gainNode) return;
          if (stem.isMuted) {
              stem.gainNode.gain.value = 0;
          } else if (anySolo && !stem.isSoloed) {
              stem.gainNode.gain.value = 0;
          } else {
              stem.gainNode.gain.value = 1;
          }
      });
  }

  getRawFrequencyData(stemId: string): Uint8Array | null {
     if (!this.ctx || !this.freqDataArray) return null;
     let stem = this.stems.get(stemId);
     if (!stem) {
       stem = this.stems.values().next().value;
     }
     if (!stem || !stem.analyserNode) return null;
     
     // Pull live array
     stem.analyserNode.getByteFrequencyData(this.freqDataArray as any);
     return this.freqDataArray;
  }

  getBandIntensity(stemId: string, freqRange: [number, number]): { intensity: number, flux: number } {
    if (!this.ctx || !this.freqDataArray) return { intensity: 0, flux: 0 };
    let stem = this.stems.get(stemId);
    if (!stem) {
       stem = this.stems.values().next().value;
    }
    if (!stem || !stem.analyserNode || !stem.prevDataArray) return { intensity: 0, flux: 0 };

    // Pull current frequency data
    stem.analyserNode.getByteFrequencyData(this.freqDataArray as any);

    const sampleRate = this.ctx.sampleRate;
    const hzPerBin = sampleRate / this.fftSize;

    const lowFreq = Math.max(20, freqRange[0]);
    const highFreq = Math.min(20000, freqRange[1]);

    const startIndex = Math.max(0, Math.floor(lowFreq / hzPerBin));
    const endIndex = Math.min(this.freqDataArray.length - 1, Math.ceil(highFreq / hzPerBin));

    let maxVal = 0;
    let prevMaxVal = 0;
    const binCount = (endIndex - startIndex) + 1;
    if (binCount <= 0) return { intensity: 0, flux: 0 };

    let totalMagnitude = 0;
    let prevTotalMagnitude = 0;

    for (let i = startIndex; i <= endIndex; i++) {
        totalMagnitude += this.freqDataArray[i];
        prevTotalMagnitude += stem.prevDataArray[i];
    }
    
    // Save snapshot of ONLY the bins processed (or entire array) for next frame?
    // Safer to save entire array independently since getRawData might mutate, but we must snapshot fully.
    stem.prevDataArray.set(this.freqDataArray);

    const intensity = (totalMagnitude / binCount) / 255.0;
    const prevIntensity = (prevTotalMagnitude / binCount) / 255.0;
    const flux = Math.max(0, intensity - prevIntensity);

    return { intensity, flux };
  }
}

// Singleton global export
export const engine = new AudioEngine();
