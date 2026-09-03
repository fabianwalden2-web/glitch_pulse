// Owns the single AudioContext and the shared bus topology.
//
//   [sources] --+--> masterBus --> ctx.destination        (what you hear)
//               |
//               +--> analysisBus --> analyzer worklet      (sample-accurate time domain)
//                                --> fastAnalyser (1024)    (transient / onset FFT)
//                                --> detailAnalyser (8192)  (bass pitch / spectral detail)
//
// The analysis path never reaches the destination, so muting a source (gain 0
// on the monitor side) does not stop the visuals.

// Vite emits the worklet file untouched and hands back a URL that resolves
// correctly under `base: './'` (Electron file://).
import analyzerWorkletUrl from './worklets/analyzer-processor.js?url';

export interface MultiFFT {
  fast: AnalyserNode;   // small window, low latency  -> onsets, flux
  detail: AnalyserNode; // large window, fine bins    -> bass, centroid, flatness
}

class AudioGraphImpl {
  private _ctx: AudioContext | null = null;
  private _master: GainNode | null = null;
  private _analysisBus: GainNode | null = null;
  private _fft: MultiFFT | null = null;
  private _workletReady: Promise<void> | null = null;
  private _analyzerNode: AudioWorkletNode | null = null;
  private _sink: GainNode | null = null; // silent sink to keep the worklet pulled

  get context(): AudioContext {
    this.ensure();
    return this._ctx!;
  }

  /** Monitor bus — connect source outputs here to be heard. */
  get master(): GainNode {
    this.ensure();
    return this._master!;
  }

  /** Analysis bus — connect source outputs here to be analysed (silent). */
  get analysisBus(): GainNode {
    this.ensure();
    return this._analysisBus!;
  }

  get fft(): MultiFFT {
    this.ensure();
    return this._fft!;
  }

  get analyzerNode(): AudioWorkletNode | null {
    return this._analyzerNode;
  }

  /** Create the context + buses on first use (needs a user gesture to run). */
  ensure(): void {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') void this._ctx.resume();
      return;
    }
    const Ctx: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this._ctx = new Ctx({ latencyHint: 'interactive' });

    this._master = this._ctx.createGain();
    this._master.gain.value = 1;
    this._master.connect(this._ctx.destination);

    this._analysisBus = this._ctx.createGain();
    this._analysisBus.gain.value = 1;

    this._fft = {
      fast: this._ctx.createAnalyser(),
      detail: this._ctx.createAnalyser(),
    };
    this._fft.fast.fftSize = 1024;              // ~23 ms @ 44.1k
    this._fft.fast.smoothingTimeConstant = 0.15; // light — keep transients
    this._fft.fast.minDecibels = -100;
    this._fft.fast.maxDecibels = -10;

    this._fft.detail.fftSize = 8192;             // ~186 ms — fine bins for bass
    this._fft.detail.smoothingTimeConstant = 0.6;
    this._fft.detail.minDecibels = -100;
    this._fft.detail.maxDecibels = -10;

    this._analysisBus.connect(this._fft.fast);
    this._analysisBus.connect(this._fft.detail);

    // silent sink for the worklet output (some engines need an output pulled)
    this._sink = this._ctx.createGain();
    this._sink.gain.value = 0;
    this._sink.connect(this._ctx.destination);
  }

  /** Load + wire the analyzer AudioWorklet. Idempotent. */
  async ensureWorklet(): Promise<void> {
    this.ensure();
    if (this._workletReady) return this._workletReady;
    this._workletReady = (async () => {
      try {
        await this._ctx!.audioWorklet.addModule(analyzerWorkletUrl);
        const node = new AudioWorkletNode(this._ctx!, 'analyzer-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        this._analysisBus!.connect(node);
        node.connect(this._sink!);
        this._analyzerNode = node;
      } catch (e) {
        console.warn('[audio] analyzer worklet failed to load; falling back to main-thread only', e);
        this._analyzerNode = null;
      }
    })();
    return this._workletReady;
  }

  resume(): Promise<void> {
    this.ensure();
    return this._ctx!.state === 'suspended' ? this._ctx!.resume() : Promise.resolve();
  }

  now(): number {
    return this._ctx ? this._ctx.currentTime : 0;
  }
}

export const audioGraph = new AudioGraphImpl();
export type AudioGraph = AudioGraphImpl;
