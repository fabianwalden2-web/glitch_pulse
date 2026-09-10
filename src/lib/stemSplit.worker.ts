/// <reference lib="webworker" />
import { separate, encodeWav, STEM_NAMES } from './stemSplit';

// Separation is CPU-bound for several seconds, so it runs off the main thread and
// reports progress. WAVs are transferred, not copied.
self.onmessage = (e: MessageEvent) => {
  try {
    const { channels, sampleRate } = e.data as { channels: ArrayBuffer[]; sampleRate: number };
    const chans = channels.map(b => new Float32Array(b));
    const stems = separate(chans, sampleRate, p => (self as any).postMessage({ type: 'progress', p }));

    const wavs: Record<string, ArrayBuffer> = {};
    for (const n of STEM_NAMES) wavs[n] = encodeWav(stems[n], sampleRate);
    (self as any).postMessage({ type: 'done', wavs }, Object.values(wavs));
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
