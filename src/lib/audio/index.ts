// Public facade for the decoupled audio module.
//
// Usage from the app:
//
//   import { audio } from './lib/audio';
//   await audio.init();                       // after a user gesture
//   audio.signals.define({ ... });            // or audio.loadDefaultSignals()
//   audio.matrix.registerTarget({ ... });     // host wires visual params
//   audio.matrix.connect({ ... });            // patch cords
//
//   // once per animation frame, before you read visual params:
//   const frame = audio.tick();
//
// Phase 1 keeps the existing `engine` (audioEngine.ts) as the transport; this
// module shares its AudioContext and analyses whatever the engine is playing.

import { analysis } from './AnalysisEngine';
import { audioGraph } from './AudioGraph';
import { matrix } from './ModulationMatrix';
import { defaultSignalBank, signals } from './Signals';
import {
  FileSource,
  LiveInputSource,
  SourceManager,
  StemGroupSource,
  TabAudioSource,
  sources,
} from './SourceManager';
import { AudioEvent, CordSpec, FeatureFrame, SignalSpec } from './types';

class AudioModule {
  readonly graph = audioGraph;
  readonly analysis = analysis;
  readonly signals = signals;
  readonly matrix = matrix;
  readonly sources = sources;

  private _lastTick = 0;
  private _inited = false;

  // Manual tempo (until Phase 2 realtime beat tracking lands). When set, it
  // drives frame.bpm / beatPhase / barPhase so beat-LFO signals work now.
  private _manualBpm = 0;
  private _beatPhaseAcc = 0;
  private _beatCount = 0;

  /** Set a manual tempo in BPM (0 disables). Call `syncTempo()` on a downbeat. */
  setManualTempo(bpm: number): void {
    this._manualBpm = bpm > 0 ? bpm : 0;
  }

  /** Reset beat phase to 0 now (tap on the "1"). */
  syncTempo(): void {
    this._beatPhaseAcc = 0;
    this._beatCount = 0;
  }

  get manualBpm(): number {
    return this._manualBpm;
  }

  get context(): AudioContext {
    return audioGraph.context;
  }

  get frame(): FeatureFrame {
    return analysis.frame;
  }

  /** Create the graph + load the worklet. Safe to call repeatedly. */
  async init(): Promise<void> {
    audioGraph.ensure();
    await analysis.start();
    if (!this._inited) {
      this._lastTick = performance.now();
      this._inited = true;
    }
  }

  loadDefaultSignals(): void {
    for (const s of defaultSignalBank()) signals.define(s);
  }

  /** Call once per animation frame. Returns the fresh FeatureFrame. */
  tick(): FeatureFrame {
    const now = performance.now();
    let dt = (now - this._lastTick) / 1000;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    this._lastTick = now;

    const frame = analysis.tick();

    if (this._manualBpm > 0) {
      const beatsPerSec = this._manualBpm / 60;
      this._beatPhaseAcc += dt * beatsPerSec;
      while (this._beatPhaseAcc >= 1) {
        this._beatPhaseAcc -= 1;
        this._beatCount += 1;
        const downbeat = this._beatCount % 4 === 0;
        analysis.events.emit('beat', {
          kind: 'beat',
          t: frame.t,
          index: this._beatCount,
          downbeat,
          bpm: this._manualBpm,
        });
        analysis.events.emit('event', {
          kind: 'beat',
          t: frame.t,
          index: this._beatCount,
          downbeat,
          bpm: this._manualBpm,
        });
      }
      frame.bpm = this._manualBpm;
      frame.bpmConfidence = 1;
      frame.beatPhase = this._beatPhaseAcc;
      frame.barPhase = ((this._beatCount % 4) + this._beatPhaseAcc) / 4;
    }

    signals.tick(frame, dt);
    matrix.tick(dt);
    return frame;
  }

  on(type: 'event', fn: (e: AudioEvent) => void): () => void;
  on(type: 'onset', fn: (e: Extract<AudioEvent, { kind: 'onset' }>) => void): () => void;
  on(type: 'beat', fn: (e: Extract<AudioEvent, { kind: 'beat' }>) => void): () => void;
  on(type: any, fn: any): () => void {
    return analysis.events.on(type, fn);
  }

  // --- source helpers (transport still lives in engine for Phase 1) ---
  async addFile(url: string, label: string): Promise<string> {
    await this.init();
    return sources.add(await FileSource.load(url, label));
  }
  async addStemGroup(files: { url: string; label: string }[], label: string): Promise<string> {
    await this.init();
    return sources.add(await StemGroupSource.load(files, label));
  }
  async addLiveInput(deviceId: string | undefined, label = 'Live Input'): Promise<string> {
    await this.init();
    return sources.add(await LiveInputSource.open(deviceId, label));
  }
  async addTabAudio(label = 'Tab / System Audio'): Promise<string> {
    await this.init();
    return sources.add(await TabAudioSource.open(label));
  }

  /** Snapshot for the project file. */
  serialize(): { signals: SignalSpec[]; cords: CordSpec[] } {
    return { signals: signals.list(), cords: matrix.serialize() };
  }

  load(state: { signals?: SignalSpec[]; cords?: CordSpec[] }): void {
    if (state.signals) {
      signals.clear();
      for (const s of state.signals) signals.define(s);
    }
    if (state.cords) matrix.load(state.cords);
  }
}

export const audio = new AudioModule();

// dev inspection
if (typeof window !== 'undefined') {
  (window as any).__audio = audio;
}

export { audioGraph } from './AudioGraph';
export { analysis } from './AnalysisEngine';
export { signals, defaultSignalBank } from './Signals';
export { matrix } from './ModulationMatrix';
export {
  sources,
  SourceManager,
  FileSource,
  StemGroupSource,
  LiveInputSource,
  TabAudioSource,
} from './SourceManager';
export * from './types';
