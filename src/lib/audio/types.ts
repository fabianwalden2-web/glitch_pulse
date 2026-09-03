// Shared types for the decoupled audio module.
//
// The module is layered:
//   Sources  -> raw WebAudio nodes / MediaStreams
//   Routing  -> per-source gain/mute/solo + analysis taps
//   Analysis -> extractors produce a FeatureFrame @ ~90-120Hz + an event stream
//   Signals  -> named, conditioned scalars derived from features (gate/normalize/smooth/curve)
//   Matrix   -> patch cords: signal -> visual parameter, with amount/curve/mode
//
// Everything here is serialisable so it can live inside the project JSON.

export type BandName = 'sub' | 'low' | 'lowMid' | 'mid' | 'highMid' | 'high' | 'air';

export const BAND_ORDER: BandName[] = ['sub', 'low', 'lowMid', 'mid', 'highMid', 'high', 'air'];

// Upper edge (Hz) of each band; lower edge is the previous band's upper edge (or 20).
export const BAND_EDGES: Record<BandName, [number, number]> = {
  sub: [20, 60],
  low: [60, 120],
  lowMid: [120, 300],
  mid: [300, 900],
  highMid: [900, 2500],
  high: [2500, 6000],
  air: [6000, 20000],
};

/** One analysis snapshot. Produced every analysis tick, kept as "latest". */
export interface FeatureFrame {
  /** performance.now() when assembled. */
  t: number;
  /** audio-clock time (ctx.currentTime) when assembled. */
  ctxTime: number;

  // --- level / dynamics (broadband, from the worklet, sample-accurate) ---
  rms: number;        // 0..1 (approx, post per-source gain)
  peak: number;       // 0..1
  crest: number;      // peak / rms, 1..~10  (punchiness)
  zcr: number;        // zero-crossing rate, 0..1 normalised
  loudness: number;   // A-weighted-ish perceptual level, 0..1

  // --- per-band energy + flux (main thread FFT) ---
  bandEnergy: Record<BandName, number>; // 0..1
  bandFlux: Record<BandName, number>;   // positive spectral flux per band, 0..1

  // --- spectral shape ---
  flux: number;       // total positive spectral flux, 0..1
  centroid: number;   // spectral centroid normalised 0..1 ("brightness")
  flatness: number;   // spectral flatness 0..1 (tonal -> noisy)
  rolloff: number;    // 85% rolloff freq normalised 0..1
  spread: number;     // spectral spread normalised 0..1

  // --- stereo ---
  width: number;      // 0 (mono) .. 1 (wide), from L/R correlation
  balance: number;    // -1 (left) .. +1 (right)

  // --- rhythm (filled from Phase 2 onward; safe defaults for now) ---
  bpm: number;
  bpmConfidence: number;
  beatPhase: number;  // 0..1 continuous phase between detected beats
  barPhase: number;   // 0..1 continuous phase across a 4-beat bar

  // --- macro ---
  energyState: 'silent' | 'low' | 'rising' | 'peak' | 'falling';
}

export type AudioEvent =
  | { kind: 'onset'; t: number; band: BandName | 'broadband'; strength: number }
  | { kind: 'beat'; t: number; index: number; downbeat: boolean; bpm: number }
  | { kind: 'section'; t: number; label: string }
  | { kind: 'drop'; t: number; magnitude: number }
  | { kind: 'silence'; t: number }
  | { kind: 'resume'; t: number };

export interface AnalysisEvents {
  frame: FeatureFrame;
  event: AudioEvent;
  onset: Extract<AudioEvent, { kind: 'onset' }>;
  beat: Extract<AudioEvent, { kind: 'beat' }>;
}

// ----------------------------------------------------------------------------
// Signals
// ----------------------------------------------------------------------------

export type NormalizeMode =
  | { type: 'none' }
  | { type: 'fixed'; min: number; max: number }
  | { type: 'adaptive'; windowSec: number; floor?: number } // rolling min/max
  | { type: 'percentile'; windowSec: number; low: number; high: number };

export type CurveShape =
  | { type: 'linear' }
  | { type: 'gamma'; exp: number }        // exp>1 = expand highs, <1 = compress
  | { type: 'scurve'; k: number }         // logistic contrast
  | { type: 'quantize'; steps: number }
  | { type: 'threshold'; at: number }     // -> 0/1
  | { type: 'invert' };

/** Adaptive/absolute gate with hysteresis to stop flicker. */
export interface GateSpec {
  enabled: boolean;
  /** absolute level, or "adaptive" to use median+delta from recent history. */
  mode: 'absolute' | 'adaptive';
  on: number;          // rising edge threshold (absolute mode)
  off: number;         // falling edge threshold (absolute mode); off < on
  adaptiveDelta: number; // adaptive mode: fire when value > median + delta
  refractoryMs: number;  // ignore re-triggers within this window
}

/** How a raw feature is turned into a usable 0..1 signal or a trigger. */
export interface SignalSpec {
  id: string;
  label: string;
  /** which feature to read; dotted path into FeatureFrame, or a synthetic source. */
  source: SignalSource;
  gate: GateSpec;
  normalize: NormalizeMode;
  /** one-pole smoothing time constants (seconds). 0 = instant. */
  attackSec: number;
  releaseSec: number;
  curve: CurveShape;
  /** shift the read point forward by N ms (only meaningful with offline look-ahead). */
  lookAheadMs: number;
  /** final output multiply + offset. */
  scale: number;
  offset: number;
}

export type SignalSource =
  | { kind: 'feature'; path: FeaturePath }
  | { kind: 'band'; band: BandName; metric: 'energy' | 'flux' }
  | { kind: 'onset'; band: BandName | 'broadband' }  // -> impulse decayed by release
  | { kind: 'beatLfo'; div: number; shape: 'ramp' | 'sine' | 'tri' | 'pulse'; pulseWidth?: number }
  | { kind: 'constant'; value: number };

export type FeaturePath =
  | 'rms' | 'peak' | 'crest' | 'zcr' | 'loudness'
  | 'flux' | 'centroid' | 'flatness' | 'rolloff' | 'spread'
  | 'width' | 'balance'
  | 'bpm' | 'beatPhase' | 'barPhase';

/** Live read-out of a signal, for the scope UI. */
export interface SignalReadout {
  id: string;
  value: number;       // conditioned 0..1 (usually)
  raw: number;         // pre-conditioning
  gateOpen: boolean;
  firedAt: number;     // performance.now() of last trigger edge
}

// ----------------------------------------------------------------------------
// Modulation matrix
// ----------------------------------------------------------------------------

export type CordMode = 'add' | 'multiply' | 'replace' | 'trigger' | 'max';

export interface CordSpec {
  id: string;
  signalId: string;
  targetId: string;   // opaque id understood by the host (e.g. "layer:xyz/opacity")
  amount: number;     // -1..1
  mode: CordMode;
  curve: CurveShape;
  smoothSec: number;
  enabled: boolean;
}

/** The host registers targets; the matrix calls `apply` each frame. */
export interface ModTarget {
  id: string;
  label: string;
  /** base/rest value when no cord is driving it. */
  getBase: () => number;
  /** receive the resolved value for this frame. */
  apply: (value: number) => void;
  min: number;
  max: number;
}

// ----------------------------------------------------------------------------
// Sources
// ----------------------------------------------------------------------------

export type SourceKind = 'file' | 'stemGroup' | 'liveInput' | 'tabAudio';

export interface SourceHandle {
  id: string;
  kind: SourceKind;
  label: string;
  /** node feeding both the monitor path and the analysis bus. */
  output: AudioNode;
  gain: GainNode;
  muted: boolean;
  soloed: boolean;
  dispose: () => void;
}

/** Messages from the analyzer AudioWorklet. */
export interface WorkletFrameMsg {
  type: 'frame';
  rms: number;
  peak: number;
  crest: number;
  zcr: number;
  loudness: number;
}
export interface WorkletOnsetMsg {
  type: 'onset';
  strength: number;
}
export type WorkletMsg = WorkletFrameMsg | WorkletOnsetMsg;
