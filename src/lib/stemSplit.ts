/**
 * Offline stem separation, no model required.
 *
 * Harmonic/percussive separation (Fitzgerald 2010): median-filter the magnitude
 * spectrogram along time to keep steady tones, and along frequency to keep broadband
 * transients. Those two views become soft masks that sum to one, so nothing is lost.
 * The harmonic half is then divided by frequency (bass) and by stereo coherence
 * (centred content ~ vocals), leaving everything else as "music".
 *
 * This is genuinely separation rather than filtering, but it is not a trained model:
 * expect bleed, most noticeably between vocals and other centred instruments.
 */

const FRAME = 2048;
const HOP = 1024;            // 50% overlap: Hann satisfies COLA, so overlap-add is exact
const MEDIAN_W = 17;         // window for both median passes, in frames / bins

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

  /** In-place forward transform. */
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

  /** In-place inverse transform (conjugate trick), scaled by 1/n. */
  inverse(re: Float64Array, im: Float64Array) {
    const { n } = this;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] = -im[i] * inv; }
  }
}

// ---------- windowing ----------

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export interface Spectrogram {
  re: Float64Array;   // frames * bins
  im: Float64Array;
  frames: number;
  bins: number;
  length: number;     // original sample count
}

export function stft(x: Float32Array, fft: FFT, win: Float64Array): Spectrogram {
  const n = fft.n;
  const bins = n / 2 + 1;
  const frames = Math.max(1, Math.ceil(x.length / HOP));
  const re = new Float64Array(frames * bins);
  const im = new Float64Array(frames * bins);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < n; i++) {
      const s = off + i - (n >> 1);
      br[i] = (s >= 0 && s < x.length ? x[s] : 0) * win[i];
      bi[i] = 0;
    }
    fft.forward(br, bi);
    const base = f * bins;
    for (let k = 0; k < bins; k++) { re[base + k] = br[k]; im[base + k] = bi[k]; }
  }
  return { re, im, frames, bins, length: x.length };
}

export function istft(sp: Spectrogram, fft: FFT, win: Float64Array): Float32Array {
  const n = fft.n;
  const out = new Float64Array(sp.length + n);
  const norm = new Float64Array(sp.length + n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);

  for (let f = 0; f < sp.frames; f++) {
    const base = f * sp.bins;
    // rebuild the full hermitian spectrum from the half we kept
    for (let k = 0; k < sp.bins; k++) { br[k] = sp.re[base + k]; bi[k] = sp.im[base + k]; }
    for (let k = sp.bins; k < n; k++) { br[k] = sp.re[base + (n - k)]; bi[k] = -sp.im[base + (n - k)]; }
    fft.inverse(br, bi);
    const off = f * HOP - (n >> 1);
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

// ---------- median filters over the magnitude spectrogram ----------

function medianOf(buf: Float64Array, count: number): number {
  // insertion sort — count is small (17), so this beats anything fancier
  for (let i = 1; i < count; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = v;
  }
  return buf[count >> 1];
}

/** Median across TIME for each bin — keeps steady tones (harmonic). */
export function medianTime(mag: Float64Array, frames: number, bins: number, w: number): Float64Array {
  const out = new Float64Array(mag.length);
  const half = w >> 1;
  const scratch = new Float64Array(w);
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames; f++) {
      let c = 0;
      for (let d = -half; d <= half; d++) {
        const ff = f + d;
        if (ff < 0 || ff >= frames) continue;
        scratch[c++] = mag[ff * bins + k];
      }
      out[f * bins + k] = medianOf(scratch, c);
    }
  }
  return out;
}

/** Median across FREQUENCY for each frame — keeps broadband transients (percussive). */
export function medianFreq(mag: Float64Array, frames: number, bins: number, w: number): Float64Array {
  const out = new Float64Array(mag.length);
  const half = w >> 1;
  const scratch = new Float64Array(w);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    for (let k = 0; k < bins; k++) {
      let c = 0;
      for (let d = -half; d <= half; d++) {
        const kk = k + d;
        if (kk < 0 || kk >= bins) continue;
        scratch[c++] = mag[base + kk];
      }
      out[base + k] = medianOf(scratch, c);
    }
  }
  return out;
}

// ---------- the split ----------

export type StemName = 'drums' | 'bass' | 'vocals' | 'music';
export const STEM_NAMES: StemName[] = ['drums', 'bass', 'vocals', 'music'];

const ramp = (v: number, a: number, b: number) => v <= a ? 1 : v >= b ? 0 : (b - v) / (b - a);

/**
 * Split interleaved-by-channel PCM into four stems.
 * `onProgress` receives 0..1. Returns one Float32Array per channel per stem.
 */
export function separate(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (p: number) => void,
): Record<StemName, Float32Array[]> {
  const fft = new FFT(FRAME);
  const win = hann(FRAME);
  const nCh = channels.length;

  const specs = channels.map(c => stft(c, fft, win));
  onProgress?.(0.25);

  const { frames, bins } = specs[0];
  // Masks are derived from the channel sum so both channels get the same decision,
  // which keeps the stereo image intact instead of smearing it.
  const mag = new Float64Array(frames * bins);
  for (let i = 0; i < mag.length; i++) {
    let sr = 0, si = 0;
    for (let c = 0; c < nCh; c++) { sr += specs[c].re[i]; si += specs[c].im[i]; }
    mag[i] = Math.hypot(sr, si);
  }

  const H = medianTime(mag, frames, bins, MEDIAN_W);
  onProgress?.(0.5);
  const P = medianFreq(mag, frames, bins, MEDIAN_W);
  onProgress?.(0.65);

  const hzPerBin = sampleRate / FRAME;
  const out: Record<string, Float32Array[]> = {};
  for (const s of STEM_NAMES) out[s] = [];

  const mDrums = new Float64Array(frames * bins);
  const mBass = new Float64Array(frames * bins);
  const mVox = new Float64Array(frames * bins);
  const mMusic = new Float64Array(frames * bins);

  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      const i = f * bins + k;
      const h2 = H[i] * H[i], p2 = P[i] * P[i];
      const denom = h2 + p2 + 1e-12;
      const mh = h2 / denom;
      const mp = p2 / denom;

      const hz = k * hzPerBin;
      const low = ramp(hz, 180, 320);                 // 1 below 180 Hz, 0 above 320
      const band = (1 - ramp(hz, 180, 260)) * ramp(hz, 7000, 9000);

      // Stereo coherence: centred content has near-identical channels.
      let coh = 1;
      if (nCh >= 2) {
        const lr = specs[0].re[i], li = specs[0].im[i];
        const rr = specs[1].re[i], ri = specs[1].im[i];
        const dl = Math.hypot(lr, li), dr = Math.hypot(rr, ri);
        const diff = Math.hypot(lr - rr, li - ri);
        coh = 1 - Math.min(1, diff / (dl + dr + 1e-9));
      }
      const vox = band * coh * coh;

      mDrums[i] = mp;
      mBass[i] = mh * low;
      mVox[i] = mh * (1 - low) * vox;
      mMusic[i] = mh * (1 - low) * (1 - vox);
    }
  }
  onProgress?.(0.75);

  const masks: Record<StemName, Float64Array> = { drums: mDrums, bass: mBass, vocals: mVox, music: mMusic };
  let done = 0;
  const total = STEM_NAMES.length * nCh;
  for (const name of STEM_NAMES) {
    const m = masks[name];
    for (let c = 0; c < nCh; c++) {
      const sp: Spectrogram = {
        re: new Float64Array(specs[c].re.length),
        im: new Float64Array(specs[c].im.length),
        frames, bins, length: specs[c].length,
      };
      for (let i = 0; i < m.length; i++) { sp.re[i] = specs[c].re[i] * m[i]; sp.im[i] = specs[c].im[i] * m[i]; }
      out[name].push(istft(sp, fft, win));
      done++;
      onProgress?.(0.75 + 0.25 * (done / total));
    }
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

  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}
