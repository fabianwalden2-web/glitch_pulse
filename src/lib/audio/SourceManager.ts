// Input sources. Every source exposes a single `output` node that is wired to
// BOTH the monitor bus (audible) and the analysis bus (silent), plus a `gain`
// for mute/solo. Sources are transport-agnostic where possible.
//
// Phase 1 ships:
//   - file        : decoded AudioBuffer, scheduled on the audio clock (tight sync, seekable)
//   - stemGroup   : N files sharing one transport, summed, each also tapped
//   - liveInput   : mic / audio-interface / instrument DI (getUserMedia)
//   - tabAudio    : browser tab or system audio via getDisplayMedia (YouTube, DAW, etc.)
//
// Electron desktopCapturer loopback + offline Demucs stems are Phase 7.

import { audioGraph } from './AudioGraph';
import { SourceHandle, SourceKind } from './types';

let idCounter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

interface BaseSourceInit {
  label: string;
}

abstract class BaseSource implements SourceHandle {
  id: string;
  abstract kind: SourceKind;
  label: string;
  output: GainNode;
  gain: GainNode;
  muted = false;
  soloed = false;

  constructor(init: BaseSourceInit, prefix: string) {
    this.id = uid(prefix);
    this.label = init.label;
    const ctx = audioGraph.context;
    this.gain = ctx.createGain();
    this.output = ctx.createGain();
    this.gain.connect(this.output);
    // fan out: monitor + analysis
    this.output.connect(audioGraph.master);
    this.output.connect(audioGraph.analysisBus);
  }

  setGain(v: number): void {
    this.gain.gain.value = v;
  }

  dispose(): void {
    try {
      this.gain.disconnect();
      this.output.disconnect();
    } catch {
      /* noop */
    }
  }
}

// ---------------------------------------------------------------------------

export class FileSource extends BaseSource {
  kind: SourceKind = 'file';
  buffer: AudioBuffer | null = null;
  private node: AudioBufferSourceNode | null = null;
  private startedAtCtxTime = 0;
  private startOffset = 0;
  playing = false;
  loop = false;

  static async load(url: string, label: string): Promise<FileSource> {
    const src = new FileSource({ label }, 'file');
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    src.buffer = await audioGraph.context.decodeAudioData(arr);
    return src;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get currentTime(): number {
    if (!this.playing) return this.startOffset;
    const t = this.startOffset + (audioGraph.now() - this.startedAtCtxTime);
    return this.loop && this.duration > 0 ? t % this.duration : Math.min(t, this.duration);
  }

  play(at = this.startOffset): void {
    if (!this.buffer) return;
    this.stopNode();
    const ctx = audioGraph.context;
    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    node.loop = this.loop;
    node.connect(this.gain);
    const when = ctx.currentTime + 0.02; // tiny lead for a clean, glitch-free start
    node.start(when, Math.max(0, at % (this.duration || 1)));
    this.node = node;
    this.startedAtCtxTime = when;
    this.startOffset = at;
    this.playing = true;
    node.onended = () => {
      if (this.node === node && !this.loop) this.playing = false;
    };
  }

  pause(): void {
    if (!this.playing) return;
    this.startOffset = this.currentTime;
    this.stopNode();
    this.playing = false;
  }

  stop(): void {
    this.stopNode();
    this.startOffset = 0;
    this.playing = false;
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    this.startOffset = Math.max(0, Math.min(t, this.duration || t));
    if (wasPlaying) this.play(this.startOffset);
  }

  setLoop(v: boolean): void {
    this.loop = v;
    if (this.node) this.node.loop = v;
  }

  private stopNode(): void {
    if (this.node) {
      try {
        this.node.onended = null;
        this.node.stop();
      } catch {
        /* already stopped */
      }
      try {
        this.node.disconnect();
      } catch {
        /* noop */
      }
      this.node = null;
    }
  }

  dispose(): void {
    this.stop();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

export class StemGroupSource extends BaseSource {
  kind: SourceKind = 'stemGroup';
  stems: FileSource[] = [];

  static async load(files: { url: string; label: string }[], label: string): Promise<StemGroupSource> {
    const group = new StemGroupSource({ label }, 'stemgroup');
    group.stems = await Promise.all(files.map((f) => FileSource.load(f.url, f.label)));
    // route each stem's monitor into the group instead of straight to master
    for (const s of group.stems) {
      s.output.disconnect();
      s.output.connect(group.gain);
      // stems still get their own analysis tap for per-stem reactivity
      s.output.connect(audioGraph.analysisBus);
    }
    return group;
  }

  get duration(): number {
    return this.stems.reduce((m, s) => Math.max(m, s.duration), 0);
  }

  get currentTime(): number {
    return this.stems[0]?.currentTime ?? 0;
  }

  play(at = 0): void {
    for (const s of this.stems) s.play(at);
  }
  pause(): void {
    for (const s of this.stems) s.pause();
  }
  stop(): void {
    for (const s of this.stems) s.stop();
  }
  seek(t: number): void {
    for (const s of this.stems) s.seek(t);
  }
  setLoop(v: boolean): void {
    for (const s of this.stems) s.setLoop(v);
  }

  dispose(): void {
    for (const s of this.stems) s.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

export class LiveInputSource extends BaseSource {
  kind: SourceKind = 'liveInput';
  stream: MediaStream | null = null;
  private srcNode: MediaStreamAudioSourceNode | null = null;

  static async open(deviceId: string | undefined, label: string): Promise<LiveInputSource> {
    const src = new LiveInputSource({ label }, 'live');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    });
    src.stream = stream;
    src.srcNode = audioGraph.context.createMediaStreamSource(stream);
    src.srcNode.connect(src.gain);
    // live input is NOT routed to master by default (feedback); analysis only.
    src.output.disconnect(audioGraph.master);
    return src;
  }

  enableMonitor(on: boolean): void {
    try {
      this.output.disconnect(audioGraph.master);
    } catch {
      /* noop */
    }
    if (on) this.output.connect(audioGraph.master);
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      this.srcNode?.disconnect();
    } catch {
      /* noop */
    }
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

export class TabAudioSource extends BaseSource {
  kind: SourceKind = 'tabAudio';
  stream: MediaStream | null = null;
  private srcNode: MediaStreamAudioSourceNode | null = null;

  /** Prompts the user to share a tab/window/screen WITH audio (YouTube etc.). */
  static async open(label = 'Tab / System Audio'): Promise<TabAudioSource> {
    const src = new TabAudioSource({ label }, 'tab');
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: true, // Chrome requires a video track to be requested for tab audio
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });
    // drop the video track, keep audio
    stream.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      throw new Error('No audio track shared. Re-try and tick "Share tab audio".');
    }
    src.stream = stream;
    src.srcNode = audioGraph.context.createMediaStreamSource(stream);
    src.srcNode.connect(src.gain);
    return src;
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      this.srcNode?.disconnect();
    } catch {
      /* noop */
    }
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

export class SourceManager {
  private sources = new Map<string, SourceHandle>();

  add(handle: SourceHandle): string {
    this.sources.set(handle.id, handle);
    this.applySolo();
    return handle.id;
  }

  get(id: string): SourceHandle | undefined {
    return this.sources.get(id);
  }

  list(): SourceHandle[] {
    return Array.from(this.sources.values());
  }

  remove(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    s.dispose();
    this.sources.delete(id);
    this.applySolo();
  }

  clear(): void {
    for (const s of this.sources.values()) s.dispose();
    this.sources.clear();
  }

  setMuted(id: string, muted: boolean): void {
    const s = this.sources.get(id);
    if (s) {
      s.muted = muted;
      this.applySolo();
    }
  }

  setSoloed(id: string, soloed: boolean): void {
    const s = this.sources.get(id);
    if (s) {
      s.soloed = soloed;
      this.applySolo();
    }
  }

  private applySolo(): void {
    const anySolo = this.list().some((s) => s.soloed);
    for (const s of this.list()) {
      const audible = anySolo ? s.soloed && !s.muted : !s.muted;
      s.gain.gain.value = audible ? 1 : 0;
    }
  }
}

export const sources = new SourceManager();
