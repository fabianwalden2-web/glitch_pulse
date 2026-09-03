/* eslint-disable no-undef */
// Sample-accurate time-domain analyzer.
//
// Why a worklet: a 3-5 ms kick click can fall entirely between two 16 ms
// requestAnimationFrame ticks. Running here, at 128-sample block rate
// (~2.9 ms @ 44.1 kHz), we never miss a transient and RMS is not undersampled.
//
// Output:
//   - batched "frame" messages ~120 Hz with rms / peak / crest / zcr / loudness
//   - immediate "onset" messages on a rising transient (adaptive threshold)
//
// FFT-based features (per-band energy, centroid, flatness, flux) stay on the
// main thread for now (AnalyserNode has a built-in FFT; the worklet does not).

const FRAME_INTERVAL_SEC = 1 / 120;

class AnalyzerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // --- rolling accumulators for the current frame window ---
    this._sumSq = 0;
    this._n = 0;
    this._peak = 0;
    this._zc = 0;
    this._prevSample = 0;
    this._acc = 0; // seconds accumulated toward next frame post

    // --- onset detection state ---
    // Fast envelope (attack ~1 ms, release ~120 ms) of a high-passed signal.
    this._fastEnv = 0;
    this._slowEnv = 0;
    this._hpPrevIn = 0;
    this._hpPrevOut = 0;
    // adaptive threshold = running mean of the onset function + margin
    this._odfMean = 0;
    this._lastOnsetTime = 0;
    this._armed = true;

    this._sr = sampleRate;
    this._refractorySec = 0.045;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'config') {
        if (typeof d.refractoryMs === 'number') this._refractorySec = d.refractoryMs / 1000;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const chL = input[0];
    const chR = input.length > 1 ? input[1] : input[0];
    const len = chL.length;
    if (len === 0) return true;

    const dtPerSample = 1 / this._sr;
    // one-pole coefficients
    const aFast = Math.exp(-1 / (0.001 * this._sr));   // ~1 ms
    const aRelease = Math.exp(-1 / (0.120 * this._sr)); // ~120 ms
    const aSlow = Math.exp(-1 / (0.400 * this._sr));    // ~400 ms
    const aMean = Math.exp(-1 / (0.500 * this._sr));    // adaptive threshold tracker

    for (let i = 0; i < len; i++) {
      const s = 0.5 * (chL[i] + chR[i]);
      const abs = s < 0 ? -s : s;

      this._sumSq += s * s;
      this._n++;
      if (abs > this._peak) this._peak = abs;
      if ((s >= 0 && this._prevSample < 0) || (s < 0 && this._prevSample >= 0)) this._zc++;
      this._prevSample = s;

      // simple 1st-order high-pass (~ 1.5 kHz) to emphasise percussive content
      const hpOut = 0.93 * (this._hpPrevOut + s - this._hpPrevIn);
      this._hpPrevIn = s;
      this._hpPrevOut = hpOut;
      const rect = hpOut < 0 ? -hpOut : hpOut;

      // envelopes
      this._fastEnv = rect > this._fastEnv
        ? rect + aFast * (this._fastEnv - rect)
        : rect + aRelease * (this._fastEnv - rect);
      this._slowEnv = rect + aSlow * (this._slowEnv - rect);

      // onset detection function: how far fast env sits above slow env
      const odf = Math.max(0, this._fastEnv - this._slowEnv);
      this._odfMean = odf + aMean * (this._odfMean - odf);

      const now = currentTime + i * dtPerSample;
      const thresh = this._odfMean * 2.2 + 0.0015;
      if (this._armed && odf > thresh && (now - this._lastOnsetTime) > this._refractorySec) {
        this._lastOnsetTime = now;
        this._armed = false;
        const strength = Math.min(1, odf / (this._odfMean * 6 + 0.01));
        this.port.postMessage({ type: 'onset', strength });
      } else if (!this._armed && odf < thresh * 0.6) {
        this._armed = true;
      }
    }

    this._acc += len * dtPerSample;
    if (this._acc >= FRAME_INTERVAL_SEC) {
      const rms = this._n > 0 ? Math.sqrt(this._sumSq / this._n) : 0;
      const peak = this._peak;
      const crest = rms > 1e-5 ? Math.min(12, peak / rms) : 1;
      const zcr = this._n > 0 ? Math.min(1, this._zc / this._n / 0.5) : 0;
      // crude perceptual weighting: emphasise mids via the hp env, blend with rms
      const loudness = Math.min(1, 0.6 * rms + 0.8 * this._fastEnv);

      this.port.postMessage({ type: 'frame', rms, peak, crest, zcr, loudness });

      this._sumSq = 0;
      this._n = 0;
      this._peak = 0;
      this._zc = 0;
      this._acc = 0;
    }

    return true;
  }
}

registerProcessor('analyzer-processor', AnalyzerProcessor);
