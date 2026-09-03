// Named, conditioned scalars derived from the FeatureFrame + event stream.
//
// A signal takes one raw feature and runs it through:
//   look-ahead -> normalize -> gate (hysteresis / refractory) -> smooth (A/R)
//   -> curve -> scale/offset
//
// Signals are computed once per frame and fanned out by the modulation matrix,
// so "kick" or "brightness" is only evaluated a single time.

import { analysis } from './AnalysisEngine';
import {
  BandName,
  CurveShape,
  FeatureFrame,
  GateSpec,
  NormalizeMode,
  SignalReadout,
  SignalSource,
  SignalSpec,
} from './types';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function applyCurve(v: number, c: CurveShape): number {
  switch (c.type) {
    case 'linear':
      return v;
    case 'gamma':
      return Math.pow(clamp01(v), Math.max(0.01, c.exp));
    case 'scurve': {
      const k = c.k;
      const x = clamp01(v) * 2 - 1;
      const s = x / (1 + Math.abs(x) * (k - 1) || 1);
      return (s + 1) / 2;
    }
    case 'quantize': {
      const steps = Math.max(1, Math.floor(c.steps));
      return Math.round(clamp01(v) * steps) / steps;
    }
    case 'threshold':
      return v >= c.at ? 1 : 0;
    case 'invert':
      return 1 - clamp01(v);
  }
}

interface RingStats {
  buf: number[];
  maxLen: number;
  push(v: number): void;
  min(): number;
  max(): number;
  percentile(p: number): number;
}

function makeRing(maxLen: number): RingStats {
  return {
    buf: [],
    maxLen,
    push(v: number) {
      this.buf.push(v);
      if (this.buf.length > this.maxLen) this.buf.shift();
    },
    min() {
      let m = Infinity;
      for (const x of this.buf) if (x < m) m = x;
      return m === Infinity ? 0 : m;
    },
    max() {
      let m = -Infinity;
      for (const x of this.buf) if (x > m) m = x;
      return m === -Infinity ? 1 : m;
    },
    percentile(p: number) {
      if (this.buf.length === 0) return p < 0.5 ? 0 : 1;
      const s = [...this.buf].sort((a, b) => a - b);
      const idx = clamp01(p) * (s.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return s[lo] + (s[hi] - s[lo]) * (idx - lo);
    },
  };
}

interface SignalRuntime {
  spec: SignalSpec;
  ring: RingStats;
  smoothed: number;
  gateOpen: boolean;
  firedAt: number;
  lastRefractory: number;
  // onset-source impulse state
  impulse: number;
  onsetUnsub?: () => void;
}

const FRAME_HZ = 60;

export class SignalRegistry {
  private signals = new Map<string, SignalRuntime>();
  private readouts = new Map<string, SignalReadout>();

  define(spec: SignalSpec): void {
    const existing = this.signals.get(spec.id);
    if (existing?.onsetUnsub) existing.onsetUnsub();

    const windowSec =
      spec.normalize.type === 'adaptive' || spec.normalize.type === 'percentile'
        ? (spec.normalize as any).windowSec ?? 4
        : 4;

    const rt: SignalRuntime = {
      spec,
      ring: makeRing(Math.max(8, Math.round(windowSec * FRAME_HZ))),
      smoothed: 0,
      gateOpen: false,
      firedAt: 0,
      lastRefractory: 0,
      impulse: 0,
    };

    if (spec.source.kind === 'onset') {
      const wantBand = spec.source.band;
      rt.onsetUnsub = analysis.events.on('onset', (ev) => {
        if (wantBand === ev.band || (wantBand === 'broadband' && ev.band === 'broadband')) {
          rt.impulse = Math.max(rt.impulse, ev.strength || 1);
        }
      });
    }

    this.signals.set(spec.id, rt);
    this.readouts.set(spec.id, {
      id: spec.id,
      value: 0,
      raw: 0,
      gateOpen: false,
      firedAt: 0,
    });
  }

  remove(id: string): void {
    const rt = this.signals.get(id);
    if (rt?.onsetUnsub) rt.onsetUnsub();
    this.signals.delete(id);
    this.readouts.delete(id);
  }

  clear(): void {
    for (const rt of this.signals.values()) rt.onsetUnsub?.();
    this.signals.clear();
    this.readouts.clear();
  }

  list(): SignalSpec[] {
    return Array.from(this.signals.values()).map((r) => r.spec);
  }

  read(id: string): number {
    return this.readouts.get(id)?.value ?? 0;
  }

  readout(id: string): SignalReadout | undefined {
    return this.readouts.get(id);
  }

  readouts_(): SignalReadout[] {
    return Array.from(this.readouts.values());
  }

  private rawFromSource(src: SignalSource, f: FeatureFrame, rt: SignalRuntime, dt: number): number {
    switch (src.kind) {
      case 'constant':
        return src.value;
      case 'feature':
        return (f as any)[src.path] ?? 0;
      case 'band':
        return src.metric === 'energy' ? f.bandEnergy[src.band as BandName] : f.bandFlux[src.band as BandName];
      case 'onset': {
        // decay the impulse with the signal's release time
        const rel = Math.max(0.03, rt.spec.releaseSec || 0.15);
        rt.impulse = Math.max(0, rt.impulse - dt / rel);
        return rt.impulse;
      }
      case 'beatLfo': {
        const div = src.div || 1;
        const phase = (f.beatPhase * div) % 1;
        switch (src.shape) {
          case 'ramp':
            return phase;
          case 'sine':
            return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
          case 'tri':
            return phase < 0.5 ? phase * 2 : 2 - phase * 2;
          case 'pulse':
            return phase < (src.pulseWidth ?? 0.5) ? 1 : 0;
        }
        return 0;
      }
    }
  }

  private normalize(v: number, mode: NormalizeMode, ring: RingStats): number {
    switch (mode.type) {
      case 'none':
        return v;
      case 'fixed': {
        const { min, max } = mode;
        return max > min ? clamp01((v - min) / (max - min)) : 0;
      }
      case 'adaptive': {
        ring.push(v);
        const lo = Math.max(mode.floor ?? 0, ring.min());
        const hi = ring.max();
        return hi > lo ? clamp01((v - lo) / (hi - lo)) : 0;
      }
      case 'percentile': {
        ring.push(v);
        const lo = ring.percentile(mode.low);
        const hi = ring.percentile(mode.high);
        return hi > lo ? clamp01((v - lo) / (hi - lo)) : 0;
      }
    }
  }

  private gate(v: number, g: GateSpec, rt: SignalRuntime, now: number, ring: RingStats): { out: number; open: boolean; fired: boolean } {
    if (!g.enabled) return { out: v, open: true, fired: false };

    let open = rt.gateOpen;
    let fired = false;

    if (g.mode === 'absolute') {
      if (!open && v >= g.on) open = true;
      else if (open && v <= g.off) open = false;
    } else {
      // adaptive: fire when value exceeds recent median + delta
      const median = ring.percentile(0.5);
      if (!open && v > median + g.adaptiveDelta) open = true;
      else if (open && v < median + g.adaptiveDelta * 0.4) open = false;
    }

    if (open && !rt.gateOpen) {
      if (now - rt.lastRefractory >= g.refractoryMs) {
        rt.lastRefractory = now;
        rt.firedAt = now;
        fired = true;
      } else {
        open = false; // still in refractory window
      }
    }
    rt.gateOpen = open;
    return { out: open ? v : 0, open, fired };
  }

  /** Evaluate every signal for this frame. */
  tick(f: FeatureFrame, dtSec: number): void {
    const now = f.t || performance.now();
    for (const rt of this.signals.values()) {
      const s = rt.spec;
      let raw = this.rawFromSource(s.source, f, rt, dtSec);

      const normalized = this.normalize(raw, s.normalize, rt.ring);

      const gated = this.gate(normalized, s.gate, rt, now, rt.ring);
      let v = gated.out;

      // one-pole attack / release smoothing
      const tc = v > rt.smoothed ? s.attackSec : s.releaseSec;
      if (tc > 0.0005) {
        const a = Math.exp(-dtSec / tc);
        rt.smoothed = v + a * (rt.smoothed - v);
      } else {
        rt.smoothed = v;
      }

      let out = applyCurve(clamp01(rt.smoothed), s.curve);
      out = out * (s.scale ?? 1) + (s.offset ?? 0);

      const ro = this.readouts.get(s.id)!;
      ro.raw = raw;
      ro.value = out;
      ro.gateOpen = gated.open;
      if (gated.fired) ro.firedAt = now;
    }
  }
}

export const signals = new SignalRegistry();

// ---------------------------------------------------------------------------
// Presets — a sensible starting bank so the matrix has something to route.
// ---------------------------------------------------------------------------

export function defaultSignalBank(): SignalSpec[] {
  const base = (over: Partial<SignalSpec>): SignalSpec => ({
    id: 'sig',
    label: 'Signal',
    source: { kind: 'feature', path: 'rms' },
    gate: { enabled: false, mode: 'absolute', on: 0.5, off: 0.4, adaptiveDelta: 0.08, refractoryMs: 120 },
    normalize: { type: 'adaptive', windowSec: 4, floor: 0 },
    attackSec: 0.01,
    releaseSec: 0.18,
    curve: { type: 'linear' },
    lookAheadMs: 0,
    scale: 1,
    offset: 0,
    ...over,
  });

  return [
    base({ id: 'level', label: 'Level (RMS)', source: { kind: 'feature', path: 'loudness' }, releaseSec: 0.12 }),
    base({ id: 'kick', label: 'Kick', source: { kind: 'onset', band: 'low' }, releaseSec: 0.16, curve: { type: 'gamma', exp: 0.6 } }),
    base({ id: 'snare', label: 'Snare / Clap', source: { kind: 'onset', band: 'highMid' }, releaseSec: 0.22 }),
    base({ id: 'hats', label: 'Hi-hats', source: { kind: 'onset', band: 'air' }, releaseSec: 0.08 }),
    base({ id: 'bass', label: 'Bass energy', source: { kind: 'band', band: 'low', metric: 'energy' }, releaseSec: 0.1 }),
    base({ id: 'brightness', label: 'Brightness', source: { kind: 'feature', path: 'centroid' }, normalize: { type: 'percentile', windowSec: 6, low: 0.05, high: 0.95 }, releaseSec: 0.25 }),
    base({ id: 'noisiness', label: 'Noisiness', source: { kind: 'feature', path: 'flatness' }, releaseSec: 0.3 }),
    base({ id: 'punch', label: 'Punch (crest)', source: { kind: 'feature', path: 'crest' }, normalize: { type: 'fixed', min: 1, max: 8 }, releaseSec: 0.12 }),
    base({ id: 'width', label: 'Stereo width', source: { kind: 'feature', path: 'width' }, releaseSec: 0.4 }),
    base({ id: 'flux', label: 'Spectral flux', source: { kind: 'feature', path: 'flux' }, releaseSec: 0.1 }),
  ];
}
