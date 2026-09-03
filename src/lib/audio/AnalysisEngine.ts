// Turns the shared analysis bus into a FeatureFrame + event stream.
//
// - time-domain level/transients come from the analyzer AudioWorklet (sample-accurate)
// - per-band energy, spectral flux, centroid, flatness, rolloff come from the
//   main-thread multi-resolution FFT (fast 1024 + detail 8192)
// - per-band adaptive onset peak-picking runs here on the fast FFT
//
// Call `tick()` once per animation frame. Read `frame` any time.

import { audioGraph } from './AudioGraph';
import { Emitter } from './emitter';
import {
  AnalysisEvents,
  BandName,
  BAND_EDGES,
  BAND_ORDER,
  FeatureFrame,
  WorkletMsg,
} from './types';

function emptyBandRecord(): Record<BandName, number> {
  const r = {} as Record<BandName, number>;
  for (const b of BAND_ORDER) r[b] = 0;
  return r;
}

function makeEmptyFrame(): FeatureFrame {
  return {
    t: 0,
    ctxTime: 0,
    rms: 0,
    peak: 0,
    crest: 1,
    zcr: 0,
    loudness: 0,
    bandEnergy: emptyBandRecord(),
    bandFlux: emptyBandRecord(),
    flux: 0,
    centroid: 0,
    flatness: 0,
    rolloff: 0,
    spread: 0,
    width: 0,
    balance: 0,
    bpm: 0,
    bpmConfidence: 0,
    beatPhase: 0,
    barPhase: 0,
    energyState: 'silent',
  };
}

interface BandOnsetState {
  prevMag: Float32Array | null;
  odfMean: number;   // running mean of the onset-detection function
  odfVar: number;    // running variance (for adaptive margin)
  lastOnset: number; // performance.now()
  armed: boolean;
}

const ONSET_REFRACTORY_MS = 60;

export class AnalysisEngine {
  readonly events = new Emitter<AnalysisEvents>();
  frame: FeatureFrame = makeEmptyFrame();

  private started = false;
  private starting: Promise<void> | null = null;
  private freqFast: Float32Array = new Float32Array(0);   // dB
  private freqDetail: Float32Array = new Float32Array(0); // dB
  private timeL: Uint8Array = new Uint8Array(0);
  private timeR: Uint8Array = new Uint8Array(0);
  private splitL: AnalyserNode | null = null;
  private splitR: AnalyserNode | null = null;
  private splitReady = false;
  private wlBound = false;

  private bandOnset: Record<BandName, BandOnsetState> = {} as any;

  // worklet-fed values (updated by messages, read on tick)
  private wl = { rms: 0, peak: 0, crest: 1, zcr: 0, loudness: 0 };
  private pendingOnsetStrength = 0;

  // energy-state machine
  private energyAvgShort = 0;
  private energyAvgLong = 0;
  private silentSince = 0;
  private wasSilent = true;

  /** Idempotent. Safe to call repeatedly (e.g. React StrictMode double-mount). */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.starting) return this.starting;
    this.starting = this._start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async _start(): Promise<void> {
    audioGraph.ensure();
    await audioGraph.ensureWorklet();

    const fast = audioGraph.fft.fast;
    const detail = audioGraph.fft.detail;
    this.freqFast = new Float32Array(fast.frequencyBinCount);
    this.freqDetail = new Float32Array(detail.frequencyBinCount);

    // split L/R for stereo metrics (only wire once)
    if (!this.splitReady) {
      const ctx = audioGraph.context;
      // force a stereo upmix so mono sources (most mics / DI) read width 0, not 1
      const stereoize = ctx.createGain();
      stereoize.channelCount = 2;
      stereoize.channelCountMode = 'explicit';
      stereoize.channelInterpretation = 'speakers';
      const splitter = ctx.createChannelSplitter(2);
      audioGraph.analysisBus.connect(stereoize);
      stereoize.connect(splitter);
      this.splitL = ctx.createAnalyser();
      this.splitR = ctx.createAnalyser();
      this.splitL.fftSize = 1024;
      this.splitR.fftSize = 1024;
      splitter.connect(this.splitL, 0);
      splitter.connect(this.splitR, 1);
      this.timeL = new Uint8Array(this.splitL.fftSize);
      this.timeR = new Uint8Array(this.splitR.fftSize);
      this.splitReady = true;
    }

    for (const b of BAND_ORDER) {
      if (this.bandOnset[b]) continue;
      this.bandOnset[b] = {
        prevMag: null,
        odfMean: 0,
        odfVar: 0,
        lastOnset: 0,
        armed: true,
      };
    }

    const node = audioGraph.analyzerNode;
    if (node && !this.wlBound) {
      this.wlBound = true;
      node.port.onmessage = (e: MessageEvent<WorkletMsg>) => {
        const d = e.data;
        if (d.type === 'frame') {
          this.wl.rms = d.rms;
          this.wl.peak = d.peak;
          this.wl.crest = d.crest;
          this.wl.zcr = d.zcr;
          this.wl.loudness = d.loudness;
        } else if (d.type === 'onset') {
          // broadband onset straight from the worklet (lowest latency)
          this.pendingOnsetStrength = Math.max(this.pendingOnsetStrength, d.strength);
          this.events.emit('onset', {
            kind: 'onset',
            t: performance.now(),
            band: 'broadband',
            strength: d.strength,
          });
          this.events.emit('event', {
            kind: 'onset',
            t: performance.now(),
            band: 'broadband',
            strength: d.strength,
          });
        }
      };
    }

    this.started = true;
  }

  stop(): void {
    // keep graph wiring intact; just pause the tick path
    this.started = false;
  }

  /** Run once per frame. Cheap: a few FFT reads + O(bins) math. */
  tick(): FeatureFrame {
    if (!this.started || this.freqFast.length === 0) return this.frame;

    const fast = audioGraph.fft.fast;
    const detail = audioGraph.fft.detail;
    const sr = audioGraph.context.sampleRate;

    if (this.freqFast.length !== fast.frequencyBinCount) {
      this.freqFast = new Float32Array(fast.frequencyBinCount);
    }
    if (this.freqDetail.length !== detail.frequencyBinCount) {
      this.freqDetail = new Float32Array(detail.frequencyBinCount);
    }

    fast.getFloatFrequencyData(this.freqFast as any);
    detail.getFloatFrequencyData(this.freqDetail as any);

    const now = performance.now();
    const f = this.frame;
    f.t = now;
    f.ctxTime = audioGraph.now();

    // ---- worklet level values ----
    f.rms = this.wl.rms;
    f.peak = this.wl.peak;
    f.crest = this.wl.crest;
    f.zcr = this.wl.zcr;
    f.loudness = this.wl.loudness;

    // ---- per-band energy + flux (fast FFT) ----
    const binHzFast = sr / fast.fftSize;
    let totalFlux = 0;
    let weightedFreq = 0;
    let magSum = 0;
    let logSum = 0;
    let sqSum = 0;
    let binN = 0;
    let rolloffTarget = 0;
    const magForRolloff: number[] = [];

    for (const band of BAND_ORDER) {
      const [lo, hi] = BAND_EDGES[band];
      const i0 = Math.max(1, Math.floor(lo / binHzFast));
      const i1 = Math.min(this.freqFast.length - 1, Math.ceil(hi / binHzFast));
      const st = this.bandOnset[band];
      if (!st.prevMag || st.prevMag.length !== i1 - i0 + 1) {
        st.prevMag = new Float32Array(Math.max(1, i1 - i0 + 1));
      }

      let energy = 0;
      let flux = 0;
      let k = 0;
      for (let i = i0; i <= i1; i++, k++) {
        // dB -> linear 0..1 (min/max dB set on the analyser to -100..-10)
        const db = this.freqFast[i];
        const mag = Math.min(1, Math.max(0, (db + 100) / 90));
        energy += mag;
        const prev = st.prevMag[k];
        const d = mag - prev;
        if (d > 0) flux += d;
        st.prevMag[k] = mag;

        weightedFreq += mag * (i * binHzFast);
        magSum += mag;
        logSum += Math.log(mag + 1e-6);
        sqSum += mag * mag;
        binN++;
        magForRolloff.push(mag);
      }
      const bins = Math.max(1, i1 - i0 + 1);
      const energyN = energy / bins;
      const fluxN = flux / bins;
      f.bandEnergy[band] = energyN;
      f.bandFlux[band] = Math.min(1, fluxN * 6);
      totalFlux += fluxN;

      // ---- adaptive per-band onset ----
      const odf = fluxN;
      const a = 0.92;
      const mean = st.odfMean * a + odf * (1 - a);
      const varr = st.odfVar * a + (odf - mean) * (odf - mean) * (1 - a);
      st.odfMean = mean;
      st.odfVar = varr;
      const margin = Math.sqrt(varr) * 2.0 + 0.004;
      const thresh = mean + margin;
      if (st.armed && odf > thresh && now - st.lastOnset > ONSET_REFRACTORY_MS) {
        st.lastOnset = now;
        st.armed = false;
        const strength = Math.min(1, (odf - mean) / (margin * 3 + 1e-4));
        const ev = { kind: 'onset' as const, t: now, band, strength };
        this.events.emit('onset', ev);
        this.events.emit('event', ev);
      } else if (!st.armed && odf < mean + margin * 0.5) {
        st.armed = true;
      }
    }

    f.flux = Math.min(1, totalFlux * 4);

    // ---- spectral shape ----
    const centroidHz = magSum > 1e-6 ? weightedFreq / magSum : 0;
    const nyquist = sr / 2;
    f.centroid = Math.min(1, centroidHz / (nyquist * 0.5)); // most musical energy < nyquist/2
    const gmean = Math.exp(logSum / Math.max(1, binN));
    const amean = magSum / Math.max(1, binN);
    f.flatness = amean > 1e-6 ? Math.min(1, gmean / amean) : 0;
    const variance = sqSum / Math.max(1, binN) - amean * amean;
    f.spread = Math.min(1, Math.sqrt(Math.max(0, variance)) * 4);

    // 85% rolloff
    rolloffTarget = magSum * 0.85;
    let acc = 0;
    let rolloffBin = 0;
    for (let i = 0; i < magForRolloff.length; i++) {
      acc += magForRolloff[i];
      if (acc >= rolloffTarget) {
        rolloffBin = i;
        break;
      }
    }
    f.rolloff = Math.min(1, (rolloffBin * binHzFast) / (nyquist * 0.5));

    // ---- stereo ----
    if (this.splitL && this.splitR) {
      this.splitL.getByteTimeDomainData(this.timeL as any);
      this.splitR.getByteTimeDomainData(this.timeR as any);
      let sumL = 0;
      let sumR = 0;
      let sumLR = 0;
      let sumLL = 0;
      let sumRR = 0;
      const n = this.timeL.length;
      for (let i = 0; i < n; i++) {
        const l = (this.timeL[i] - 128) / 128;
        const r = (this.timeR[i] - 128) / 128;
        sumL += l * l;
        sumR += r * r;
        sumLR += l * r;
        sumLL += l * l;
        sumRR += r * r;
      }
      const rmsL = Math.sqrt(sumL / n);
      const rmsR = Math.sqrt(sumR / n);
      const denom = Math.sqrt(sumLL * sumRR) + 1e-9;
      const corr = sumLR / denom; // 1 = mono, 0 = uncorrelated, -1 = out of phase
      f.width = Math.min(1, Math.max(0, 1 - corr));
      const tot = rmsL + rmsR + 1e-9;
      f.balance = (rmsR - rmsL) / tot;
    }

    // ---- energy-state machine ----
    const e = f.loudness;
    this.energyAvgShort += (e - this.energyAvgShort) * 0.08;   // ~fast
    this.energyAvgLong += (e - this.energyAvgLong) * 0.005;    // ~slow
    const silent = this.energyAvgShort < 0.012;
    if (silent && !this.wasSilent) {
      this.wasSilent = true;
      this.silentSince = now;
      this.events.emit('event', { kind: 'silence', t: now });
    } else if (!silent && this.wasSilent) {
      this.wasSilent = false;
      this.events.emit('event', { kind: 'resume', t: now });
    }
    if (silent) {
      f.energyState = 'silent';
    } else {
      const ratio = this.energyAvgShort / (this.energyAvgLong + 1e-6);
      if (ratio > 1.25) f.energyState = 'rising';
      else if (ratio < 0.8) f.energyState = 'falling';
      else if (this.energyAvgShort > 0.45) f.energyState = 'peak';
      else f.energyState = 'low';
    }

    this.pendingOnsetStrength *= 0.6; // decay the shared impulse
    return f;
  }
}

export const analysis = new AnalysisEngine();
