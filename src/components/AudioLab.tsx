// Audio Lab — a self-contained test bench for the decoupled audio module.
//
// Mount by opening the app with `?lab` in the URL. It exercises the whole
// pipeline end to end: Sources -> AnalysisEngine -> Signals -> ModulationMatrix
// -> a reactive canvas, with live scopes for every stage. Nothing here touches
// App.tsx; it's the proving ground before migrating the real layers.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  audio,
  BAND_ORDER,
  BandName,
  CordMode,
  FileSource,
  SignalSpec,
  StemGroupSource,
} from '../lib/audio';

// --- demo visual targets driven by the matrix -------------------------------

interface VisState {
  bgFlash: number;
  radius: number;
  hue: number;
  spin: number;
  burst: number;
  zoom: number;
  shake: number;
}
const VIS_TARGETS: { id: keyof VisState; label: string }[] = [
  { id: 'bgFlash', label: 'BG flash' },
  { id: 'radius', label: 'Core size' },
  { id: 'hue', label: 'Hue' },
  { id: 'spin', label: 'Spin' },
  { id: 'burst', label: 'Particles' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'shake', label: 'Shake' },
];

const DEFAULT_CORDS: { signalId: string; target: keyof VisState; amount: number; mode: CordMode }[] = [
  { signalId: 'kick', target: 'bgFlash', amount: 1, mode: 'add' },
  { signalId: 'bass', target: 'radius', amount: 1, mode: 'add' },
  { signalId: 'brightness', target: 'hue', amount: 1, mode: 'replace' },
  { signalId: 'snare', target: 'burst', amount: 1, mode: 'add' },
  { signalId: 'hats', target: 'shake', amount: 0.8, mode: 'add' },
  { signalId: 'level', target: 'zoom', amount: 0.6, mode: 'add' },
  { signalId: 'beatSine', target: 'spin', amount: 1, mode: 'add' },
];

const MODE_CYCLE: (CordMode | null)[] = [null, 'add', 'replace', 'multiply', 'max', 'trigger'];

function tid(t: keyof VisState) {
  return `lab:${t}`;
}

// --- particles -------------------------------------------------------------

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; }

export default function AudioLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visRef = useRef<VisState>({ bgFlash: 0, radius: 0.3, hue: 0.6, spin: 0, burst: 0, zoom: 0, shake: 0 });
  const baseRef = useRef<VisState>({ bgFlash: 0, radius: 0.3, hue: 0.6, spin: 0, burst: 0, zoom: 0, shake: 0 });
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<P[]>([]);
  const rotRef = useRef(0);
  const onsetFlashRef = useRef<Record<string, number>>({});

  const [ready, setReady] = useState(false);
  const [, force] = useState(0);
  const [sourceList, setSourceList] = useState<{ id: string; label: string; kind: string; muted: boolean; soloed: boolean }[]>([]);
  const [transport, setTransport] = useState<{ id: string; playing: boolean; time: number; dur: number; loop: boolean } | null>(null);
  const [bpm, setBpm] = useState(120);
  const [tempoOn, setTempoOn] = useState(false);
  const tapRef = useRef<number[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('');

  // cords keyed by `${signalId}|${target}` -> {mode, amount, cordId}
  const [cords, setCords] = useState<Record<string, { mode: CordMode; amount: number; cordId: string }>>({});

  const extraSignals: SignalSpec[] = useMemo(
    () => [
      {
        id: 'beatSine', label: 'Beat sine', source: { kind: 'beatLfo', div: 1, shape: 'sine' },
        gate: { enabled: false, mode: 'absolute', on: 0.5, off: 0.4, adaptiveDelta: 0.08, refractoryMs: 100 },
        normalize: { type: 'none' }, attackSec: 0, releaseSec: 0, curve: { type: 'linear' },
        lookAheadMs: 0, scale: 1, offset: 0,
      },
      {
        id: 'beatRamp', label: 'Beat ramp', source: { kind: 'beatLfo', div: 1, shape: 'ramp' },
        gate: { enabled: false, mode: 'absolute', on: 0.5, off: 0.4, adaptiveDelta: 0.08, refractoryMs: 100 },
        normalize: { type: 'none' }, attackSec: 0, releaseSec: 0, curve: { type: 'linear' },
        lookAheadMs: 0, scale: 1, offset: 0,
      },
    ],
    [],
  );

  const refreshSources = useCallback(() => {
    setSourceList(
      audio.sources.list().map((s) => ({ id: s.id, label: s.label, kind: s.kind, muted: s.muted, soloed: s.soloed })),
    );
  }, []);

  // --- boot -------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      await audio.init();
      audio.loadDefaultSignals();
      for (const s of extraSignals) audio.signals.define(s);

      for (const t of VIS_TARGETS) {
        audio.matrix.registerTarget({
          id: tid(t.id), label: t.label, min: 0, max: 1,
          getBase: () => baseRef.current[t.id],
          apply: (v) => { visRef.current[t.id] = v; },
        });
      }

      // default patch so it reacts immediately
      const initial: Record<string, { mode: CordMode; amount: number; cordId: string }> = {};
      for (const d of DEFAULT_CORDS) {
        const cordId = `${d.signalId}-${d.target}`;
        audio.matrix.connect({
          id: cordId, signalId: d.signalId, targetId: tid(d.target),
          amount: d.amount, mode: d.mode, curve: { type: 'linear' }, smoothSec: d.mode === 'add' ? 0 : 0.08, enabled: true,
        });
        initial[`${d.signalId}|${d.target}`] = { mode: d.mode, amount: d.amount, cordId };
      }
      if (!alive) return;
      setCords(initial);
      setReady(true);
      refreshSources();

      navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
        if (alive) setDevices(ds.filter((d) => d.kind === 'audioinput'));
      });

      const offOnset = audio.on('onset', (e) => {
        onsetFlashRef.current[e.band] = performance.now();
      });

      // Drive the analysis tick from a timer (keeps signals live even when the
      // window is hidden / on another monitor — RAF pauses when not visible).
      // RAF is used only to paint the canvas.
      const tickTimer = setInterval(() => {
        if (!alive) return;
        audio.tick();
      }, 16);
      const draw = () => {
        drawCanvas();
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);

      // throttled UI refresh
      const uiTimer = setInterval(() => {
        if (!alive) return;
        force((n) => n + 1);
        const src = transportSourceRef.current;
        if (src) {
          setTransport({
            id: src.id,
            playing: src instanceof FileSource ? src.playing : (src as StemGroupSource).stems[0]?.playing ?? false,
            time: (src as any).currentTime ?? 0,
            dur: (src as any).duration ?? 0,
            loop: src instanceof FileSource ? src.loop : (src as StemGroupSource).stems[0]?.loop ?? false,
          });
        }
      }, 60);

      cleanupRef.current = () => {
        offOnset();
        clearInterval(uiTimer);
        clearInterval(tickTimer);
      };
    })();

    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cleanupRef.current?.();
      for (const t of VIS_TARGETS) audio.matrix.unregisterTarget(tid(t.id));
      audio.matrix.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanupRef = useRef<(() => void) | null>(null);
  const transportSourceRef = useRef<FileSource | StemGroupSource | null>(null);

  // --- tempo ----------------------------------------------------------
  useEffect(() => {
    audio.setManualTempo(tempoOn ? bpm : 0);
  }, [bpm, tempoOn]);

  const tapTempo = () => {
    const now = performance.now();
    const taps = tapRef.current.filter((t) => now - t < 2500);
    taps.push(now);
    tapRef.current = taps;
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const nb = Math.round(60000 / avg);
      if (nb >= 40 && nb <= 300) {
        setBpm(nb);
        setTempoOn(true);
      }
    }
    audio.syncTempo();
  };

  // --- source actions ----------------------------------------------------
  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []) as File[];
    if (files.length === 0) return;
    try {
      if (files.length === 1) {
        setStatus(`decoding ${files[0].name}…`);
        const url = URL.createObjectURL(files[0]);
        const id = await audio.addFile(url, files[0].name);
        const src = audio.sources.get(id) as FileSource;
        src.setLoop(true);
        transportSourceRef.current = src;
      } else {
        setStatus(`decoding ${files.length} stems…`);
        const id = await audio.addStemGroup(
          files.map((f) => ({ url: URL.createObjectURL(f), label: f.name })),
          `Stem group (${files.length})`,
        );
        const src = audio.sources.get(id) as StemGroupSource;
        src.setLoop(true);
        transportSourceRef.current = src;
      }
      setStatus('');
      refreshSources();
    } catch (err) {
      setStatus(`load failed: ${err}`);
    }
    e.target.value = '';
  };

  const onMic = async () => {
    try {
      setStatus('requesting input…');
      await audio.addLiveInput(deviceId || undefined, 'Live Input');
      setStatus('');
      refreshSources();
    } catch (err) {
      setStatus(`mic failed: ${err}`);
    }
  };

  const onTab = async () => {
    try {
      setStatus('pick a tab and tick "share tab audio"…');
      await audio.addTabAudio();
      setStatus('');
      refreshSources();
    } catch (err) {
      setStatus(`tab capture failed: ${err}`);
    }
  };

  const removeSource = (id: string) => {
    if (transportSourceRef.current?.id === id) transportSourceRef.current = null;
    audio.sources.remove(id);
    refreshSources();
  };

  const play = () => {
    const s = transportSourceRef.current;
    if (!s) return;
    (s as any).play?.(0);
  };
  const pause = () => (transportSourceRef.current as any)?.pause?.();
  const stop = () => (transportSourceRef.current as any)?.stop?.();
  const seek = (t: number) => (transportSourceRef.current as any)?.seek?.(t);

  // --- matrix cell toggle ----------------------------------------------
  const cycleCord = (signalId: string, target: keyof VisState) => {
    const key = `${signalId}|${target}`;
    setCords((prev) => {
      const cur = prev[key];
      const idx = cur ? MODE_CYCLE.indexOf(cur.mode) : 0;
      const nextMode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      const cordId = `${signalId}-${target}`;
      const next = { ...prev };
      if (nextMode === null) {
        audio.matrix.disconnect(cordId);
        delete next[key];
      } else {
        const amount = cur?.amount ?? 1;
        audio.matrix.connect({
          id: cordId, signalId, targetId: tid(target), amount, mode: nextMode,
          curve: { type: 'linear' }, smoothSec: nextMode === 'add' ? 0 : 0.08, enabled: true,
        });
        next[key] = { mode: nextMode, amount, cordId };
      }
      return next;
    });
  };

  const setCordAmount = (signalId: string, target: keyof VisState, amount: number) => {
    const key = `${signalId}|${target}`;
    setCords((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      audio.matrix.update(cur.cordId, { amount });
      return { ...prev, [key]: { ...cur, amount } };
    });
  };

  // --- canvas draw ----------------------------------------------------
  const drawCanvas = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;
    const h = cv.height;
    const v = visRef.current;
    const f = audio.frame;

    ctx.fillStyle = '#060608';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2 + (Math.random() - 0.5) * v.shake * 40;
    const cy = h / 2 + (Math.random() - 0.5) * v.shake * 40;
    const scale = 1 + v.zoom * 0.6;
    rotRef.current += 0.002 + v.spin * 0.06;

    // radial spectrum ring
    const bands = BAND_ORDER.map((b) => f.bandEnergy[b]);
    const baseR = (Math.min(w, h) * 0.16) * (0.6 + v.radius * 1.6) * scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRef.current);
    const N = 64;
    for (let i = 0; i < N; i++) {
      const bi = Math.floor((i / N) * bands.length);
      const amp = bands[bi] ?? 0;
      const a = (i / N) * Math.PI * 2;
      const r0 = baseR;
      const r1 = baseR + amp * baseR * 2.2 + f.flux * 30;
      ctx.strokeStyle = `hsl(${(v.hue * 360 + i * 3) % 360} 90% ${45 + amp * 40}%)`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    // core
    ctx.fillStyle = `hsl(${(v.hue * 360) % 360} 80% ${50 + v.bgFlash * 30}%)`;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // particles
    if (v.burst > 0.15 && particlesRef.current.length < 800) {
      const count = Math.floor(v.burst * 24);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 6 * (0.5 + v.burst);
        particlesRef.current.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, max: 40 + Math.random() * 40 });
      }
    }
    const alive: P[] = [];
    for (const p of particlesRef.current) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.life -= 1 / p.max;
      if (p.life > 0) {
        ctx.fillStyle = `hsla(${(v.hue * 360 + 40) % 360} 90% 60% / ${p.life})`;
        ctx.fillRect(p.x, p.y, 3, 3);
        alive.push(p);
      }
    }
    particlesRef.current = alive;

    // beat pulse
    if (audio.manualBpm > 0) {
      const bp = f.beatPhase;
      const pulse = Math.max(0, 1 - bp * 4);
      ctx.strokeStyle = `hsla(0 0% 100% / ${pulse * 0.5})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    }

    // bg flash
    if (v.bgFlash > 0.01) {
      ctx.fillStyle = `hsla(${(v.hue * 360) % 360} 100% 70% / ${v.bgFlash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }
  };

  // --- render -------------------------------------------------------
  const f = audio.frame;
  const readouts = ready ? audio.signals.readouts_() : [];
  const signalDefs = ready ? audio.signals.list() : [];
  const now = performance.now();

  const featRows: [string, number | string][] = [
    ['rms', f.rms], ['peak', f.peak], ['crest', f.crest], ['zcr', f.zcr],
    ['loudness', f.loudness], ['flux', f.flux], ['centroid', f.centroid],
    ['flatness', f.flatness], ['rolloff', f.rolloff], ['spread', f.spread],
    ['width', f.width], ['balance', f.balance], ['bpm', Math.round(f.bpm)],
    ['beatPhase', f.beatPhase], ['energyState', f.energyState],
  ];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <b>AUDIO LAB</b>
        <span style={{ opacity: 0.5 }}>decoupled audio module · Phase 1 test bench</span>
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{status}</span>
        <a href="?" style={S.link}>← back to app</a>
      </div>

      <div style={S.body}>
        {/* LEFT: sources + transport */}
        <div style={S.col}>
          <div style={S.panel}>
            <div style={S.h}>SOURCES</div>
            <label style={S.btn}>
              + Audio file / stems
              <input type="file" accept="audio/*" multiple onChange={onLoadFile} style={{ display: 'none' }} />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={S.select}>
                <option value="">Default input</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>
                ))}
              </select>
              <button style={S.btn} onClick={onMic}>Mic</button>
            </div>
            <button style={S.btn} onClick={onTab}>+ Capture tab / system audio</button>

            {sourceList.length === 0 && <div style={S.dim}>no sources</div>}
            {sourceList.map((s) => (
              <div key={s.id} style={S.srcRow}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ opacity: 0.4 }}>{s.kind}</span> {s.label}
                </span>
                <button style={s.muted ? S.tagOn : S.tag} onClick={() => { audio.sources.setMuted(s.id, !s.muted); refreshSources(); }}>M</button>
                <button style={s.soloed ? S.tagOn : S.tag} onClick={() => { audio.sources.setSoloed(s.id, !s.soloed); refreshSources(); }}>S</button>
                <button style={S.tag} onClick={() => removeSource(s.id)}>✕</button>
              </div>
            ))}
          </div>

          <div style={S.panel}>
            <div style={S.h}>TRANSPORT</div>
            {!transport && <div style={S.dim}>load a file to enable</div>}
            {transport && (
              <>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={S.btn} onClick={play}>▶</button>
                  <button style={S.btn} onClick={pause}>❚❚</button>
                  <button style={S.btn} onClick={stop}>■</button>
                  <button
                    style={transport.loop ? S.tagOn : S.tag}
                    onClick={() => (transportSourceRef.current as any)?.setLoop?.(!transport.loop)}
                  >loop</button>
                </div>
                <input
                  type="range" min={0} max={transport.dur || 1} step={0.01} value={transport.time}
                  onChange={(e) => seek(parseFloat(e.target.value))} style={{ width: '100%' }}
                />
                <div style={S.dim}>{transport.time.toFixed(1)}s / {transport.dur.toFixed(1)}s</div>
              </>
            )}
          </div>

          <div style={S.panel}>
            <div style={S.h}>TEMPO (manual — Phase 2 = auto)</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button style={tempoOn ? S.tagOn : S.tag} onClick={() => setTempoOn((v) => !v)}>{tempoOn ? 'on' : 'off'}</button>
              <input type="number" min={40} max={300} value={bpm} onChange={(e) => setBpm(parseInt(e.target.value) || 120)} style={{ ...S.select, width: 70 }} />
              <span style={S.dim}>BPM</span>
              <button style={S.btn} onClick={tapTempo}>TAP</button>
              <button style={S.btn} onClick={() => audio.syncTempo()}>sync “1”</button>
            </div>
          </div>
        </div>

        {/* CENTER: reactive visual + matrix */}
        <div style={{ ...S.col, flex: 1 }}>
          <div style={{ ...S.panel, flex: 1 }}>
            <div style={S.h}>REACTIVE OUTPUT</div>
            <canvas ref={canvasRef} width={720} height={420} style={S.canvas} />
          </div>

          <div style={S.panel}>
            <div style={S.h}>MODULATION MATRIX &nbsp;<span style={S.dim}>click to cycle: off → add → replace → mult → max → trig</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.thL}>signal ↓ / target →</th>
                    {VIS_TARGETS.map((t) => <th key={t.id} style={S.th}>{t.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {signalDefs.map((sig) => {
                    const ro = readouts.find((r) => r.id === sig.id);
                    const fired = ro && now - ro.firedAt < 130;
                    return (
                      <tr key={sig.id}>
                        <td style={S.tdL}>
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 6, marginRight: 6, background: fired ? '#fff' : '#555' }} />
                          {sig.label}
                          <span style={S.bar}><span style={{ ...S.barFill, width: `${Math.round((ro?.value ?? 0) * 100)}%` }} /></span>
                        </td>
                        {VIS_TARGETS.map((t) => {
                          const c = cords[`${sig.id}|${t.id}`];
                          return (
                            <td key={t.id} style={S.td}>
                              <button style={c ? S.cellOn : S.cell} onClick={() => cycleCord(sig.id, t.id)}>
                                {c ? c.mode.slice(0, 3) : '·'}
                              </button>
                              {c && (
                                <input
                                  type="range" min={-1} max={1} step={0.05} value={c.amount}
                                  onChange={(e) => setCordAmount(sig.id, t.id, parseFloat(e.target.value))}
                                  style={S.cellSlider}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: scopes */}
        <div style={S.col}>
          <div style={S.panel}>
            <div style={S.h}>ONSET MONITOR</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(['broadband', ...BAND_ORDER] as (BandName | 'broadband')[]).map((b) => {
                const t = onsetFlashRef.current[b] ?? 0;
                const hot = now - t < 140;
                return (
                  <div key={b} style={{ textAlign: 'center' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 4, background: hot ? '#fff' : '#1c1c22', border: '1px solid #333' }} />
                    <div style={{ fontSize: 8, opacity: 0.5 }}>{b === 'broadband' ? 'bb' : b}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={S.panel}>
            <div style={S.h}>BAND ENERGY</div>
            {BAND_ORDER.map((b) => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                <span style={{ width: 46, fontSize: 9, opacity: 0.6 }}>{b}</span>
                <span style={S.bar}><span style={{ ...S.barFill, width: `${Math.round(f.bandEnergy[b] * 100)}%`, background: '#4da3ff' }} /></span>
              </div>
            ))}
          </div>

          <div style={S.panel}>
            <div style={S.h}>SIGNALS</div>
            {readouts.map((r) => {
              const fired = now - r.firedAt < 130;
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: fired ? '#fff' : r.gateOpen ? '#3c3' : '#444' }} />
                  <span style={{ width: 74, fontSize: 9, opacity: 0.7, overflow: 'hidden', whiteSpace: 'nowrap' }}>{r.id}</span>
                  <span style={S.bar}><span style={{ ...S.barFill, width: `${Math.round(Math.max(0, Math.min(1, r.value)) * 100)}%` }} /></span>
                  <span style={{ width: 30, fontSize: 8, opacity: 0.4, textAlign: 'right' }}>{r.value.toFixed(2)}</span>
                </div>
              );
            })}
          </div>

          <div style={S.panel}>
            <div style={S.h}>FEATURE FRAME</div>
            <table style={{ width: '100%', fontSize: 9 }}>
              <tbody>
                {featRows.map(([k, val]) => (
                  <tr key={k}>
                    <td style={{ opacity: 0.5, padding: '1px 0' }}>{k}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {typeof val === 'number' ? val.toFixed(3) : val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- styles (inline, no dependency on the app's CSS) ----------------------
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const S: Record<string, React.CSSProperties> = {
  root: { position: 'fixed', inset: 0, background: '#0a0a0c', color: '#e8e8ea', font: `11px ${mono}`, display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #222', fontSize: 11 },
  link: { color: '#4da3ff', textDecoration: 'none' },
  body: { flex: 1, display: 'flex', gap: 10, padding: 10, overflow: 'auto' },
  col: { display: 'flex', flexDirection: 'column', gap: 10, width: 300, flexShrink: 0 },
  panel: { border: '1px solid #222', borderRadius: 6, padding: 10, background: '#0e0e11' },
  h: { fontSize: 9, letterSpacing: 1, opacity: 0.55, marginBottom: 8, textTransform: 'uppercase' },
  btn: { display: 'block', width: '100%', padding: '7px 8px', margin: '4px 0', background: '#17171c', color: '#e8e8ea', border: '1px solid #333', borderRadius: 4, cursor: 'pointer', textAlign: 'center', font: `11px ${mono}` },
  select: { flex: 1, padding: '6px', background: '#17171c', color: '#e8e8ea', border: '1px solid #333', borderRadius: 4, font: `10px ${mono}` },
  dim: { opacity: 0.4, fontSize: 9, margin: '4px 0' },
  srcRow: { display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #1c1c1c', fontSize: 9 },
  tag: { padding: '2px 5px', background: '#17171c', color: '#888', border: '1px solid #333', borderRadius: 3, cursor: 'pointer', fontSize: 9 },
  tagOn: { padding: '2px 5px', background: '#2a6', color: '#fff', border: '1px solid #2a6', borderRadius: 3, cursor: 'pointer', fontSize: 9 },
  canvas: { width: '100%', height: 'auto', borderRadius: 4, background: '#060608', display: 'block' },
  table: { borderCollapse: 'collapse', fontSize: 9, minWidth: 640 },
  th: { padding: '4px 3px', borderBottom: '1px solid #333', opacity: 0.6, fontWeight: 400, writingMode: 'vertical-rl' as any, height: 60 },
  thL: { padding: '4px 6px', borderBottom: '1px solid #333', opacity: 0.6, fontWeight: 400, textAlign: 'left' },
  td: { padding: '2px', textAlign: 'center', borderBottom: '1px solid #161616' },
  tdL: { padding: '3px 6px', borderBottom: '1px solid #161616', whiteSpace: 'nowrap' },
  cell: { width: 30, padding: '3px 0', background: '#141418', color: '#555', border: '1px solid #2a2a2a', borderRadius: 3, cursor: 'pointer', fontSize: 8 },
  cellOn: { width: 30, padding: '3px 0', background: '#2563eb', color: '#fff', border: '1px solid #2563eb', borderRadius: 3, cursor: 'pointer', fontSize: 8 },
  cellSlider: { width: 42, display: 'block', margin: '2px auto 0' },
  bar: { flex: 1, height: 6, background: '#1c1c22', borderRadius: 3, overflow: 'hidden', display: 'inline-block', minWidth: 40 },
  barFill: { display: 'block', height: '100%', background: '#e8b84d' },
};
