/**
 * Offline stem separation, no model required.
 *
 * Two-stage harmonic/percussive separation (Driedger & Müller, 2014). A single
 * HPSS pass has to choose one STFT resolution, and that is the compromise that
 * smears drums: harmonics want fine FREQUENCY resolution, transients want fine
 * TIME resolution. So we run it twice.
 *
 *   Stage 1 — long window (4096): pull out the harmonic layer cleanly.
 *   Stage 2 — short window (1024) on what is left: pull out percussion cleanly.
 *
 * Each stage uses a separation margin β, so bins that are not clearly one thing
 * or the other fall into a residual instead of being forced into a stem. That is
 * what gives a drum track with defined kick and snare rather than a wash.
 *
 * Audio is processed in overlapping blocks so memory stays bounded on long tracks.
 * This is real separation, but it is not a trained model — expect some bleed.
 */

const BLOCK_SEC = 20;
const OVERLAP_SEC = 1;

const STAGE1 = { n: 4096, hop: 1024, wTime: 17, wFreq: 17 };
const STAGE2 = { n: 1024, hop: 256, wTime: 17, wFreq: 17 };
const BETA = 2.0;   // how decisive each mask is; higher sends more to the residual

// ---------- FFT ----------

export class FFT {
  readonly n: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  forward(re: Float64Array, im: Float64Array) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k], s = sin[k];
          const tr = re[j + half] * c - im[j + half] * s;
          const ti = re[j + half] * s + im[j + half] * c;
          re[j + half] = re[j] - tr;
          im[j + half] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }

  inverse(re: Float64Array, im: Float64Array) {
    const { n } = this;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] = -im[i] * inv; }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export interface Spectrogram {
  re: Float32Array;
  im: Float32Array;
  frames: number;
  bins: number;
  length: number;
  n: number;
  hop: number;
}

export function stft(x: Float32Array, fft: FFT, win: Float64Array, hop: number): Spectrogram {
  const n = fft.n;
  const bins = n / 2 + 1;
  const frames = Math.max(1, Math.ceil(x.length / hop));
  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < n; i++) {
      const s = off + i - (n >> 1);
      br[i] = (s >= 0 && s < x.length ? x[s] : 0) * win[i];
      bi[i] = 0;
    }
    fft.forward(br, bi);
    const base = f * bins;
    for (let k = 0; k < bins; k++) { re[base + k] = br[k]; im[base + k] = bi[k]; }
  }
  return { re, im, frames, bins, length: x.length, n, hop };
}

export function istft(sp: Spectrogram, fft: FFT, win: Float64Array): Float32Array {
  const n = fft.n;
  const out = new Float64Array(sp.length + n);
  const norm = new Float64Array(sp.length + n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);

  for (let f = 0; f < sp.frames; f++) {
    const base = f * sp.bins;
    for (let k = 0; k < sp.bins; k++) { br[k] = sp.re[base + k]; bi[k] = sp.im[base + k]; }
    for (let k = sp.bins; k < n; k++) { br[k] = sp.re[base + (n - k)]; bi[k] = -sp.im[base + (n - k)]; }
    fft.inverse(br, bi);
    const off = f * sp.hop - (n >> 1);
    for (let i = 0; i < n; i++) {
      const s = off + i;
      if (s < 0 || s >= out.length) continue;
      out[s] += br[i] * win[i];
      norm[s] += win[i] * win[i];
    }
  }

  const y = new Float32Array(sp.length);
  for (let i = 0; i < sp.length; i++) y[i] = norm[i] > 1e-8 ? out[i] / norm[i] : 0;
  return y;
}

// ---------- median filters ----------

/**
 * Sliding-window median over a strided 1-D slice.
 *
 * Re-sorting the window at every position is what makes naive HPSS slow. Keeping
 * one sorted window and doing a single remove + insert per step turns the inner
 * cost from a sort into two short memmoves, which is the whole ballgame here
 * because these two passes dominate the run.
 */
function slidingMedian(
  src: Float32Array, dst: Float32Array,
  start: number, stride: number, count: number, w: number,
) {
  const half = w >> 1;
  const sorted = new Float32Array(w);
  let n = 0;

  const insert = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    for (let i = n; i > lo; i--) sorted[i] = sorted[i - 1];
    sorted[lo] = v;
    n++;
  };
  const remove = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    // lo is the first entry >= v; it is v itself because we only remove what we put in
    for (let i = lo; i < n - 1; i++) sorted[i] = sorted[i + 1];
    n--;
  };

  // prime with the first window
  for (let i = 0; i <= Math.min(half, count - 1); i++) insert(src[start + i * stride]);

  for (let i = 0; i < count; i++) {
    dst[start + i * stride] = sorted[n >> 1];
    const drop = i - half;
    const add = i + half + 1;
    if (add < count) insert(src[start + add * stride]);
    if (drop >= 0) remove(src[start + drop * stride]);
  }
}

/** Median across TIME for each bin — keeps steady tones (harmonic). */
export function medianTime(mag: Float32Array, frames: number, bins: number, w: number): Float32Array {
  const out = new Float32Array(mag.length);
  for (let k = 0; k < bins; k++) slidingMedian(mag, out, k, bins, frames, w);
  return out;
}

/** Median across FREQUENCY for each frame — keeps broadband transients (percussive). */
export function medianFreq(mag: Float32Array, frames: number, bins: number, w: number): Float32Array {
  const out = new Float32Array(mag.length);
  for (let f = 0; f < frames; f++) slidingMedian(mag, out, f * bins, 1, bins, w);
  return out;
}

// ---------- one HPSS stage ----------

interface StageMasks { mh: Float32Array; mp: Float32Array; mr: Float32Array }

/**
 * Driedger's hard masks with a margin: a bin is harmonic only if the harmonic
 * view beats the percussive one by β, and vice versa. Anything ambiguous becomes
 * residual instead of being smeared across both.
 */
function stageMasks(specs: Spectrogram[], wTime: number, wFreq: number, beta: number): StageMasks {
  const { frames, bins } = specs[0];
  const mag = new Float32Array(frames * bins);
  for (let i = 0; i < mag.length; i++) {
    let sr = 0, si = 0;
    for (const sp of specs) { sr += sp.re[i]; si += sp.im[i]; }
    mag[i] = Math.hypot(sr, si);
  }
  const H = medianTime(mag, frames, bins, wTime);
  const P = medianFreq(mag, frames, bins, wFreq);

  const mh = new Float32Array(mag.length);
  const mp = new Float32Array(mag.length);
  const mr = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    const h = H[i], p = P[i];
    if (h >= p * beta) mh[i] = 1;
    else if (p > h * beta) mp[i] = 1;
    else mr[i] = 1;
  }
  return { mh, mp, mr };
}

const applyMask = (sp: Spectrogram, m: Float32Array, extra?: Float32Array): Spectrogram => {
  const re = new Float32Array(sp.re.length);
  const im = new Float32Array(sp.im.length);
  for (let i = 0; i < m.length; i++) {
    const g = extra ? m[i] * extra[i] : m[i];
    re[i] = sp.re[i] * g;
    im[i] = sp.im[i] * g;
  }
  return { ...sp, re, im };
};

// ---------- the split ----------

export type StemName = 'drums' | 'kick' | 'snare' | 'bass' | 'vocals' | 'music';
export const STEM_NAMES: StemName[] = ['drums', 'kick', 'snare', 'bass', 'vocals', 'music'];

const ramp = (v: number, a: number, b: number) => v <= a ? 1 : v >= b ? 0 : (b - v) / (b - a);

function separateBlock(
  channels: Float32Array[],
  sampleRate: number,
): Record<StemName, Float32Array[]> {
  const nCh = channels.length;
  const out: Record<string, Float32Array[]> = {};
  for (const s of STEM_NAMES) out[s] = [];

  // ---- stage 1: long window, take the harmonic layer ----
  const f1 = new FFT(STAGE1.n), w1 = hann(STAGE1.n);
  const sp1 = channels.map(c => stft(c, f1, w1, STAGE1.hop));
  const m1 = stageMasks(sp1, STAGE1.wTime, STAGE1.wFreq, BETA);

  const harmonic: Float32Array[] = [];
  const rest1: Float32Array[] = [];
  const notHarmonic = new Float32Array(m1.mh.length);
  for (let i = 0; i < notHarmonic.length; i++) notHarmonic[i] = 1 - m1.mh[i];
  for (let c = 0; c < nCh; c++) {
    harmonic.push(istft(applyMask(sp1[c], m1.mh), f1, w1));
    rest1.push(istft(applyMask(sp1[c], notHarmonic), f1, w1));
  }

  // ---- stage 2: short window on the remainder, take the percussion ----
  const f2 = new FFT(STAGE2.n), w2 = hann(STAGE2.n);
  const sp2 = rest1.map(c => stft(c, f2, w2, STAGE2.hop));
  const m2 = stageMasks(sp2, STAGE2.wTime, STAGE2.wFreq, BETA);
  const { frames: fr2, bins: bn2 } = sp2[0];

  const residual: Float32Array[] = [];
  const notPerc = new Float32Array(m2.mp.length);
  for (let i = 0; i < notPerc.length; i++) notPerc[i] = 1 - m2.mp[i];
  for (let c = 0; c < nCh; c++) {
    out.drums.push(istft(applyMask(sp2[c], m2.mp), f2, w2));
    residual.push(istft(applyMask(sp2[c], notPerc), f2, w2));
  }

  // Kick and snare are carved out of the CLEAN drum track, not the full mix.
  // Stage 2's short window is only ~43 Hz per bin, far too coarse to place a
  // kick, so re-analyse the drums at a longer window purely for this split.
  const f3 = new FFT(2048), w3 = hann(2048);
  const spD = out.drums.map(c => stft(c, f3, w3, 512));
  const { frames: fr3, bins: bn3 } = spD[0];
  const hz3 = sampleRate / 2048;
  const kickW = new Float32Array(fr3 * bn3);
  const snareW = new Float32Array(fr3 * bn3);
  for (let k = 0; k < bn3; k++) {
    const hz = k * hz3;
    const kw = ramp(hz, 110, 190);                                   // low thump
    const body = (1 - ramp(hz, 180, 260)) * ramp(hz, 500, 700);      // snare body, clear of the kick
    const snap = (1 - ramp(hz, 1800, 2400)) * ramp(hz, 6000, 8000);  // snare crack
    const sw = Math.min(1, body + snap);
    for (let f = 0; f < fr3; f++) { kickW[f * bn3 + k] = kw; snareW[f * bn3 + k] = sw; }
  }
  for (let c = 0; c < nCh; c++) {
    out.kick.push(istft(applyMask(spD[c], kickW), f3, w3));
    out.snare.push(istft(applyMask(spD[c], snareW), f3, w3));
  }

  // ---- divide the harmonic layer into bass / vocals / music ----
  const spH = harmonic.map(c => stft(c, f1, w1, STAGE1.hop));
  const { frames, bins } = spH[0];
  const hzPerBin = sampleRate / STAGE1.n;
  const mBass = new Float32Array(frames * bins);
  const mVox = new Float32Array(frames * bins);
  const mMusic = new Float32Array(frames * bins);

  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      const i = f * bins + k;
      const hz = k * hzPerBin;
      const low = ramp(hz, 180, 320);
      const band = (1 - ramp(hz, 180, 260)) * ramp(hz, 7000, 9000);

      let coh = 1;
      if (nCh >= 2) {
        const lr = spH[0].re[i], li = spH[0].im[i];
        const rr = spH[1].re[i], ri = spH[1].im[i];
        const dl = Math.hypot(lr, li), dr = Math.hypot(rr, ri);
        const diff = Math.hypot(lr - rr, li - ri);
        coh = 1 - Math.min(1, diff / (dl + dr + 1e-9));
      }
      const vox = band * coh * coh;

      mBass[i] = low;
      mVox[i] = (1 - low) * vox;
      mMusic[i] = (1 - low) * (1 - vox);
    }
  }

  for (let c = 0; c < nCh; c++) {
    out.bass.push(istft(applyMask(spH[c], mBass), f1, w1));
    out.vocals.push(istft(applyMask(spH[c], mVox), f1, w1));
    // Whatever was neither clearly harmonic nor clearly percussive belongs here.
    const music = istft(applyMask(spH[c], mMusic), f1, w1);
    const res = residual[c];
    for (let i = 0; i < music.length; i++) music[i] += res[i];
    out.music.push(music);
  }

  return out as Record<StemName, Float32Array[]>;
}

/**
 * Split a track into stems, processing in overlapping blocks so memory stays flat.
 * `onProgress` receives 0..1.
 */
export function separate(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (p: number) => void,
): Record<StemName, Float32Array[]> {
  const nCh = channels.length;
  const len = channels[0].length;
  const block = Math.floor(BLOCK_SEC * sampleRate);
  const ov = Math.floor(OVERLAP_SEC * sampleRate);

  const out: Record<string, Float32Array[]> = {};
  for (const s of STEM_NAMES) out[s] = Array.from({ length: nCh }, () => new Float32Array(len));

  const step = block - ov;
  const blocks = Math.max(1, Math.ceil(len / step));

  for (let b = 0; b < blocks; b++) {
    const start = b * step;
    const end = Math.min(len, start + block);
    if (start >= end) break;
    const piece = channels.map(c => c.subarray(start, end).slice());
    const res = separateBlock(piece, sampleRate);

    for (const name of STEM_NAMES) {
      for (let c = 0; c < nCh; c++) {
        const src = res[name][c];
        const dst = out[name][c];
        for (let i = 0; i < src.length; i++) {
          const abs = start + i;
          if (abs >= len) break;
          // Equal-power crossfade across the overlap so block seams are inaudible.
          let g = 1;
          if (b > 0 && i < ov) g = Math.sin((i / ov) * Math.PI / 2) ** 2;
          if (g === 1) dst[abs] = src[i]; else dst[abs] = dst[abs] * (1 - g) + src[i] * g;
        }
      }
    }
    onProgress?.((b + 1) / blocks);
  }

  return out as Record<StemName, Float32Array[]>;
}

// ---------- WAV ----------

export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nCh = channels.length;
  const len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  v.setUint32(4, 36 + len * nCh * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len * nCh * 2, true);

  // Write samples through an Int16Array rather than DataView.setInt16: this loop
  // runs once per sample per channel and is a visible part of the wait.
  const pcm = new Int16Array(buf, 44);
  let o = 0;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = channels[c][i];
      const q = s < -1 ? -1 : s > 1 ? 1 : s;
      pcm[o++] = q < 0 ? q * 0x8000 : q * 0x7fff;
    }
  }
  return buf;
}
