/// <reference lib="webworker" />
import { separate, encodeWav, STEM_NAMES } from './stemSplit';

// Separation is CPU-bound for several seconds, so it runs off the main thread and
// reports progress. WAVs are transferred, not copied.
self.onmessage = (e: MessageEvent) => {
  try {
    const { channels, sampleRate } = e.data as { channels: ArrayBuffer[]; sampleRate: number };
    const chans = channels.map(b => new Float32Array(b));
    // The bar must cover the whole job. Separation is the bulk of it, but encoding
    // six full-length WAVs is seconds more, and the app still has to load them
    // afterwards — so this stage tops out well below 100%.
    const post = (p: number, phase: string) => (self as any).postMessage({ type: 'progress', p, phase });
    const stems = separate(chans, sampleRate, p => post(p * 0.72, 'separating'));

    const wavs: Record<string, ArrayBuffer> = {};
    STEM_NAMES.forEach((n, i) => {
      wavs[n] = encodeWav(stems[n], sampleRate);
      post(0.72 + 0.16 * ((i + 1) / STEM_NAMES.length), 'encoding');
    });
    (self as any).postMessage({ type: 'done', wavs }, Object.values(wavs));
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
