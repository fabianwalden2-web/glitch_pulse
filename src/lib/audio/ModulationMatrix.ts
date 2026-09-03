// Patch cords: signal -> visual parameter.
//
// The host registers targets (a layer opacity, a generative param, a filter
// setting, a palette index...). Each frame the matrix resolves every target:
// start from its base value, fold in every enabled cord by mode, write back.
//
// This is the seam that lets you re-tune "how we listen" (signals) without
// touching "what reacts" (targets), and vice-versa.

import { signals } from './Signals';
import { CordMode, CordSpec, CurveShape, ModTarget } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function applyCurve(v: number, c: CurveShape): number {
  const x = clamp(v, 0, 1);
  switch (c.type) {
    case 'linear':
      return x;
    case 'gamma':
      return Math.pow(x, Math.max(0.01, c.exp));
    case 'scurve': {
      const k = c.k;
      const t = x * 2 - 1;
      const s = t / (1 + Math.abs(t) * (k - 1) || 1);
      return (s + 1) / 2;
    }
    case 'quantize': {
      const steps = Math.max(1, Math.floor(c.steps));
      return Math.round(x * steps) / steps;
    }
    case 'threshold':
      return x >= c.at ? 1 : 0;
    case 'invert':
      return 1 - x;
  }
}

interface CordRuntime {
  spec: CordSpec;
  smoothed: number;
}

export class ModulationMatrix {
  private cords = new Map<string, CordRuntime>();
  private targets = new Map<string, ModTarget>();

  registerTarget(t: ModTarget): void {
    this.targets.set(t.id, t);
  }

  unregisterTarget(id: string): void {
    this.targets.delete(id);
  }

  listTargets(): ModTarget[] {
    return Array.from(this.targets.values());
  }

  connect(spec: CordSpec): void {
    this.cords.set(spec.id, { spec, smoothed: 0 });
  }

  disconnect(id: string): void {
    this.cords.delete(id);
  }

  update(id: string, patch: Partial<CordSpec>): void {
    const c = this.cords.get(id);
    if (c) c.spec = { ...c.spec, ...patch };
  }

  list(): CordSpec[] {
    return Array.from(this.cords.values()).map((c) => c.spec);
  }

  clear(): void {
    this.cords.clear();
  }

  /** Serialisable snapshot for the project file. */
  serialize(): CordSpec[] {
    return this.list();
  }

  load(specs: CordSpec[]): void {
    this.cords.clear();
    for (const s of specs) this.connect(s);
  }

  /** Resolve + write every target for this frame. */
  tick(dtSec: number): void {
    // bucket cords by target
    const byTarget = new Map<string, CordRuntime[]>();
    for (const c of this.cords.values()) {
      if (!c.spec.enabled) continue;
      const arr = byTarget.get(c.spec.targetId) ?? [];
      arr.push(c);
      byTarget.set(c.spec.targetId, arr);
    }

    for (const [targetId, target] of this.targets) {
      const cords = byTarget.get(targetId);
      const base = target.getBase();
      if (!cords || cords.length === 0) {
        target.apply(base);
        continue;
      }

      const span = target.max - target.min;
      let acc = base;
      let replaced = false;

      for (const c of cords) {
        const sig = signals.read(c.spec.signalId);
        let shaped = applyCurve(sig, c.spec.curve);

        // per-cord smoothing
        if (c.spec.smoothSec > 0.0005) {
          const a = Math.exp(-dtSec / c.spec.smoothSec);
          c.smoothed = shaped + a * (c.smoothed - shaped);
          shaped = c.smoothed;
        } else {
          c.smoothed = shaped;
        }

        const contribution = shaped * c.spec.amount * span;

        switch (c.spec.mode as CordMode) {
          case 'add':
            acc += contribution;
            break;
          case 'multiply':
            acc = acc * (1 + shaped * c.spec.amount);
            break;
          case 'max':
            acc = Math.max(acc, target.min + shaped * c.spec.amount * span);
            break;
          case 'replace':
            acc = target.min + shaped * c.spec.amount * span;
            replaced = true;
            break;
          case 'trigger':
            // treat >0.5 as a latch to full for this frame
            if (shaped > 0.5) {
              acc = target.min + c.spec.amount * span;
              replaced = true;
            }
            break;
        }
      }

      void replaced;
      target.apply(clamp(acc, target.min, target.max));
    }
  }
}

export const matrix = new ModulationMatrix();
