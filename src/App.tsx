/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Upload, 
  Music, 
  Play,
  Pause,
  Volume2,
  VolumeX,
  Repeat,
  Activity, 
  Layers, 
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelRightClose,
  Maximize2,
  Zap,
  Eye,
  EyeOff,
  Plus,
  Terminal,
  GripVertical,
  Sliders,
  RefreshCw,
  Power,
  X,
  Trash2,
  Maximize,
  Download,
  Circle,
  Square,
  Menu,
  Radio,
  Blend,
  Sun,
  RotateCcw,
  Box,
  Lock,
  Unlock,
  Pipette,
  Palette,
  Check,
  Copy,
  Sparkles,
  Mic,
  Webcam,
  Move3d,
  Crosshair,
  Focus,
  ExternalLink,
  Clapperboard
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { parseGeneratives, WebGLGenerativeRenderer, GenerativeDefinition, BUILTIN_PALETTES, GenerativeElement, ColorPalettePreset, GENERATIVE_CATEGORY_ORDER } from './lib/generatives';
import { engine, AudioStemNode } from './lib/audioEngine';
import { AudioSpectrogram } from './components/AudioSpectrogram';
import { Waves } from './components/Waves';
import { createNoise2D } from 'simplex-noise';
import { prepareWithSegments, layoutNextLineRange, materializeLineRange, type LayoutCursor } from '@chenglou/pretext';
import { StepSequencer } from './components/StepSequencer';
import { ThreeDEngine, THREE_D_PARAMETERS, THREE_D_PARAM_GROUPS, THREE_D_ACCEPT, CINEMA_PRESET_NAMES, SEQ_TRIGGER_NAMES, SEQ_SLOT_COUNT, ENV_PRESET_NAMES, detectThreeDAssetKindByExt, detectPlyKind, type ClipMode } from './lib/threeDEngine';
import { ThreeDCameraOverlay } from './components/ThreeDCameraOverlay';

// --- Types ---

export interface AudioMapping {
  enabled: boolean;
  stemId: string;
  freqRange: [number, number];
  threshold: number;
  attack: number;
  release: number;
  smoothing?: number;
  cooldownMs?: number;
  /** Audio-processing engine: 'level' = amplitude follower (original), 'transient' = pops on each hit. */
  engine?: 'level' | 'transient';
  /** 'level' engine tracking style. */
  mode?: 'fast' | 'smooth';
  /** 'transient' engine: how eager the hit detector is (higher = more sensitive). */
  sensitivity?: number;
  /** 'transient' engine: how long each hit takes to fade, ms. */
  decayMs?: number;
  /** optional per-mapping note/envelope settings (used by the 'level' engine). */
  noteSettings?: any;
  target: 'trigger' | 'opacity';
}

interface TriggerState {
  isDown: boolean;
  velocity: number;
  phase: 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
  currentEnvValue: number;
  lastUpdate: number;
  activeUntil: number | null;
  useFixedDuration: boolean;
}

interface LayerTriggerMapping {
  channels: number[];
  noteStart: number;
  noteEnd: number;
  noteSettings: NoteSettings;
  activeUntil: number | null;
  velocity: number;
  triggerBehavior: 'momentary' | 'toggle';
    triggerActive?: Record<string, boolean>;
    triggerAmount?: Record<string, number>;
}

interface RhythmMapping {
  enabled: boolean;
  pattern: string;
  bpm: number;
  customPattern: boolean[];
  noteSettings?: any;
}

interface Layer {
  id: string;
  name: string;
  type: 'video' | 'image' | 'generative' | '3d';
  src: string | null;
  opacity: number;
  blendMode: GlobalCompositeOperation;
  filterId: string | null;
  filterSettings: Record<string, any>;
  isVisible: boolean;
  isActive?: boolean;
  midiMode: boolean; // True = MIDI triggered only, False = Visible by default
  midiCC?: number; // CC to control opacity
  videoStart?: number;
  videoEnd?: number;
  videoDuration?: number;
  speed?: number;
  videoTriggerMode?: 'restart' | 'continuous' | 'advance' | 'rewind' | 'frame-accumulator';
  accumulateThreshold?: number;
  accumulateOpacity?: number;
  accumulateMaxFrames?: number;
  accumulateBlendMode?: GlobalCompositeOperation;
  // Frame Accumulator "Isolate Motion" (multiplicity / chronophotography): each
  // stamp keys out only the pixels that differ from a background reference and
  // composites that cutout onto a persistent buffer over one clean background.
  accumulateIsolateMotion?: boolean;
  accumulateFeather?: number;          // 0..24 px soft-edge blur on the motion mask
  accumulateBgAdaptive?: boolean;      // keep updating the background plate in still regions
  accumulateShowLive?: boolean;        // also draw the live (current) subject cutout on top
  accumulateSuppressShadows?: boolean; // drop pixels that only got darker (cast shadow)
  videoAdvanceUnit?: 'frames' | 'seconds';
  videoAdvanceAmount?: number;
  videoFrameRate?: number;
  videoRewindSpeed?: number;
  isLive?: boolean;
  liveDeviceId?: string;
  threeDKind?: 'mesh' | 'splat' | 'kinect';
  threeDFormat?: 'ply' | 'splat' | 'ksplat';
  threeDSrc?: string | null;
  threeDSettings?: Record<string, number | string>;
  threeDTriggerActive?: Record<string, boolean>;
  threeDTriggerAmount?: Record<string, number>;
  threeDMappings?: EffectMapping[];
  threeDKinectUrl?: string;
  threeDKinectUseSynthetic?: boolean;
  generativeId?: string;
  generativeSettings?: Record<string, number>;
  generativeTriggerActive?: Record<string, boolean>;
  generativeTriggerAmount?: Record<string, number>;
  generativeColors?: Record<string, string>;
  generativeLockedColors?: Record<string, boolean>;
  generativeActivePaletteId?: string;
  generativeColorCycleIndex?: number;
  triggerMapping: LayerTriggerMapping;
  mappings: EffectMapping[];
  missingMedia?: boolean;
  audioMapping?: AudioMapping;
  rhythmMapping?: RhythmMapping;
  isMuted: boolean;
  isSoloed: boolean;
  ccBindings?: Record<string, { cc: number, min: number, max: number }>;
  maskTargetId?: string | null;
  maskInverted?: boolean;
  maskMode?: 'alpha' | 'luma';
  showMaskGraphic?: boolean;
}

interface Scene {
  id: string;
  name: string;
  layers: {
    id: string;
    isVisible: boolean;
    opacity: number;
    filterId: string | null;
    filterSettings: Record<string, any>;
  }[];
  midiNote?: number; // Note to trigger scene
  triggerBehavior?: 'momentary' | 'toggle';
}

interface MidiDevice {
  id: string;
  name: string;
}

interface MidiLogEntry {
  id: number;
  channel: number;
  note: number;
  velocity: number;
  timestamp: number;
  type: 'ON' | 'OFF' | 'CC';
}

interface NoteSettings {
  useFixedDuration: boolean;
  subdivision: string;
  bpm: number;
  useFixedVelocity: boolean;
  fixedVelocity: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

interface EffectMapping {
  id: string;
  name: string;
  description: string;
  channels: number[]; // 0-15
  noteStart: number;
  noteEnd: number;
  active: boolean;
  manualActive: boolean; // Manual override
  isMuted: boolean;
  isSoloed: boolean;
  settings: Record<string, any>;
  noteSettings: NoteSettings;
  activeUntil: number | null;
  velocity: number;
  triggerBehavior: 'momentary' | 'toggle';
  audioMapping?: AudioMapping;
  rhythmMapping?: RhythmMapping;
  triggerActive?: Record<string, boolean>;
  triggerAmount?: Record<string, number>;
}

interface EffectDefinition {
  id: string;
  name: string;
  description: string;
  parameters: {
    id: string;
    name: string;
    description: string;
    min: number;
    max: number;
    type: 'continuous' | 'binary';
    default?: number;
  }[];
}

// --- Constants ---

const SYMBOLS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', '+', '@', '&', '%', '$', '!', '?', '§'];

const ALL_EFFECTS: EffectDefinition[] = [
  {
    id: 'motion-symbols',
    name: 'Symbols',
    description: 'Generates and animates geometric or iconic symbols that react to incoming data, overlaying them on a solid white canvas.',
    parameters: [
      { id: 'size', name: 'Size', description: 'Font size of the symbols.', min: 8, max: 64, type: 'continuous', default: 16 },
      { id: 'spacing', name: 'Spacing', description: 'The gap between individual symbols.', min: 0, max: 50, type: 'continuous', default: 4 },
      { id: 'sensitivity', name: 'Sensitivity', description: 'Sensitivity to movement.', min: 1, max: 100, type: 'continuous', default: 30 },
    ]
  },
  {
    id: 'invert',
    name: 'Invert Colors',
    description: 'Reverses the color or luminance values of the video, creating a negative-film effect.',
    parameters: [
      { id: 'colors', name: 'Colors', description: 'Toggles which specific color channels (R, G, or B) are inverted.', min: 0, max: 3, type: 'continuous' },
      { id: 'saturation', name: 'Saturation', description: 'Adjusts the color intensity of the inverted areas.', min: 0, max: 100, type: 'continuous' },
      { id: 'threshold', name: 'Solarization Point', description: 'Creates a "halfway" effect where pixels are only inverted if they exceed a certain intensity.', min: 0, max: 255, type: 'continuous' },
    ]
  },
  {
    id: 'edges',
    name: 'Edge Detection',
    description: 'Identifies and highlights the high-contrast boundaries in the video to create a structural, "sketch" look.',
    parameters: [
      { id: 'thickness', name: 'Thickness', description: 'Adjusts the width of the detected lines.', min: 1, max: 10, type: 'continuous' },
      { id: 'glow', name: 'Glow', description: 'Adds a neon-style light emission effect to the edges.', min: 0, max: 100, type: 'continuous' },
      { id: 'sensitivity', name: 'Sensitivity', description: 'Determines how much detail is required to define an "edge."', min: 1, max: 100, type: 'continuous' },
    ]
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    description: 'Downsamples the video resolution into a grid of large blocks for a retro or digital-glitch aesthetic.',
    parameters: [
      { id: 'cellSize', name: 'Cell Size', description: 'Determines the scale of the pixels (HD to 8-bit).', min: 2, max: 100, type: 'continuous' },
      { id: 'movement', name: 'Movement', description: 'Lower affects all video, higher affects only moving parts.', min: 0, max: 100, type: 'continuous' },
      { id: 'sensitivity', name: 'Sensitivity', description: 'Controls how much movement triggers pixelation.', min: 1, max: 100, type: 'continuous' },
    ]
  },
  {
    id: 'rgb-shift',
    name: 'Colour Shift',
    description: 'Artificially separates the Red, Green, and Blue color channels and offsets their positions.',
    parameters: [
      { id: 'distance', name: 'Offset Distance', description: 'How far the color channels pull away from each other.', min: 0, max: 100, type: 'continuous' },
      { id: 'saturation', name: 'Saturation', description: 'Adjusts the color intensity of the shifted channels.', min: 0, max: 200, type: 'continuous' },
      { id: 'jitter', name: 'Jitter', description: 'Adds a high-speed "shake" to the offset distance.', min: 0, max: 100, type: 'continuous' },
    ]
  },
  {
    id: 'hue-rotate',
    name: 'Hue Rotate',
    description: 'Shifts the entire color spectrum of the video through the rainbow.',
    parameters: [
      { id: 'speed', name: 'Cycle Speed', description: 'How fast the colors transition through the spectrum.', min: 0, max: 100, type: 'continuous' },
      { id: 'saturation', name: 'Saturation', description: 'Controls the intensity and vividness of the shifted colors.', min: 0, max: 200, type: 'continuous' },
      { id: 'range', name: 'Hue Range', description: 'Limits the rotation to a specific part of the color wheel.', min: 0, max: 360, type: 'continuous', default: 0 },
    ]
  },
  {
    id: 'vhs',
    name: 'VHS',
    description: 'Simulates an 80s analog tape recording with tracking noise, color bleeding, and scanlines.',
    parameters: [
      { id: 'noise', name: 'Noise Amount', description: 'Intensity of the analog static and grain.', min: 0, max: 100, type: 'continuous' },
      { id: 'tracking', name: 'Tracking Error', description: 'Simulates vertical instability and horizontal distortion.', min: 0, max: 100, type: 'continuous' },
      { id: 'bleed', name: 'Color Bleeding', description: 'Controls the horizontal smear of color channels.', min: 0, max: 100, type: 'continuous' },
    ]
  },
  {
    id: 'dithering',
    name: 'Dithering',
    description: 'Creates a retro low-bit look using a Bayer matrix pattern to simulate gradients with limited colors.',
    parameters: [
      { id: 'scale', name: 'Pixel Scale', description: 'Adjusts the size of the dithered pixels.', min: 2, max: 10, type: 'continuous' },
      { id: 'contrast', name: 'Contrast', description: 'Enhances the visibility of the dither pattern.', min: 0, max: 200, type: 'continuous' },
      { id: 'hue', name: 'Hue Shift', description: 'Shifts the color palette of the dithered output.', min: 0, max: 360, type: 'continuous', default: 0 },
    ]
  },
  {
    id: 'ascii',
    name: 'ASCII',
    description: 'Renders the video using character symbols while preserving the original colors.',
    parameters: [
      { id: 'fontSize', name: 'Font Size', description: 'The scale of the ASCII characters.', min: 10, max: 30, type: 'continuous' },
      { id: 'density', name: 'Detail', description: 'Controls the character set complexity.', min: 1, max: 10, type: 'continuous' },
      { id: 'hue', name: 'Hue Shift', description: 'Shifts the color palette of the ASCII characters.', min: 0, max: 360, type: 'continuous', default: 0 },
    ]
  },
  {
    id: 'motion-detector',
    name: 'Motion Detector',
    description: 'Analyzes frame-to-frame changes to identify moving subjects, isolating them with bounding boxes and optional geometric connections.',
    parameters: [
      { id: 'sensitivity', name: 'Sensitivity', description: 'Determines the amount of pixel movement required to trigger a box.', min: 1, max: 100, type: 'continuous' },
      { id: 'maxObjects', name: 'Objects', description: 'Limits how many boxes appear at once to prevent visual clutter.', min: 1, max: 20, type: 'continuous' },
      { id: 'thickness', name: 'Connection', description: 'Controls the width of lines drawn between the centers of each tracked object.', min: 0, max: 5, type: 'continuous' },
    ]
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Transforms the video into a scrolling stream of green-tinted symbols, digits, and complex equations.',
    parameters: [
      { id: 'scale', name: 'Symbol Scale', description: 'Adjusts the font size of the characters.', min: 5, max: 50, type: 'continuous', default: 11 },
      { id: 'density', name: 'Detail Density', description: 'Controls how many characters are drawn in darker areas of the screen.', min: 0, max: 100, type: 'continuous', default: 50 },
      { id: 'hue', name: 'Color Spectrum', description: 'Shifts the palette from the classic "Matrix Green" to other hues.', min: 0, max: 360, type: 'continuous', default: 0 },
    ]
  },
  {
    id: 'windows-98',
    name: 'Windows 98',
    description: 'Wraps moving objects in individual, vintage-styled OS window frames complete with title bars and buttons.',
    parameters: [
      { id: 'sensitivity', name: 'Sensitivity', description: 'Determines the amount of pixel movement required to trigger a window.', min: 1, max: 100, type: 'continuous' },
      { id: 'maxObjects', name: 'Objects', description: 'Limits how many windows appear at once to prevent visual clutter.', min: 1, max: 20, type: 'continuous' },
      { id: 'thickness', name: 'Frame Weight', description: 'Adjusts the thickness of the window borders.', min: 1, max: 5, type: 'continuous' },
    ]
  },
  {
    id: 'glitch-box',
    name: 'Glitch',
    description: 'Applies a localized glitch and glass distortion effect to moving subjects within tracked bounding boxes.',
    parameters: [
      { id: 'sensitivity', name: 'Sensitivity', description: 'Determines the amount of pixel movement required to trigger a glitch box.', min: 1, max: 100, type: 'continuous' },
      { id: 'maxObjects', name: 'Objects', description: 'Limits how many glitch boxes appear at once.', min: 1, max: 20, type: 'continuous' },
      { id: 'persistence', name: 'Persistence', description: 'How long the glitch boxes stay on screen after motion stops.', min: 1, max: 60, type: 'continuous' },
    ]
  },
  {
    id: 'long-exposure',
    name: 'Long Exposure',
    description: 'Isolates moving subjects from a static background and composites them onto a persistent buffer.',
    parameters: [
      { id: 'threshold', name: 'Threshold', description: 'Determines the amount of pixel movement required.', min: 1, max: 100, type: 'continuous', default: 30 },
      { id: 'fade', name: 'Trail Fade', description: 'How fast the trails disappear.', min: 0, max: 50, type: 'continuous', default: 5 },
      { id: 'clear', name: 'Clear', description: 'Triggers a clear of the accumulated trails.', min: 0, max: 1, type: 'binary', default: 0 },
    ]
  }
];

const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  useFixedDuration: false,
  subdivision: '1/4',
  bpm: 120,
  useFixedVelocity: false,
  fixedVelocity: 127,
  attack: 0,
  decay: 100,
  sustain: 1.0,
  release: 50,
};

const DEFAULT_TRIGGER_TYPE: 'momentary' | 'toggle' = 'momentary';



export const DEFAULT_AUDIO_MAPPING: AudioMapping = {
  enabled: false,
  stemId: '',
  freqRange: [20, 20000],
  threshold: 0.1,
  attack: 0.0,
  release: 0.2,
  smoothing: 0.85,
  cooldownMs: 50,
  engine: 'level',
  mode: 'fast',
  sensitivity: 0.7,
  decayMs: 220,
  target: 'trigger'
};

// --- 'transient' audio engine: onset detection on band ENERGY (not 1-frame flux,
// which collapses to ~0 at 60fps). Tracks a fast envelope vs a slow baseline and
// fires when the envelope jumps above the baseline. Returns 0..1: snaps to 1 on a
// detected hit, then fades over `decayMs`.
type TransientTrackerState = {
  value: number;
  lastTriggerTime: number;
  fast?: number;
  base?: number;
  peakRise?: number;
  armed?: boolean;
};
function processTransientHit(
  intensity: number,     // 0..1 band energy from engine.getBandIntensity().intensity
  sensitivity: number,   // 0..1 slider, 1 = most eager
  decayMs: number,
  cooldownMs: number,
  tr: TransientTrackerState,
  dtSec: number,
  now: number,
): number {
  const dt = dtSec > 0 && dtSec < 0.25 ? dtSec : 1 / 60;
  const aBase = Math.exp(-dt / 0.35);   // ~350ms baseline follower

  // fast envelope: instant attack, quick release — tracks the peak of each hit
  const fastPrev = tr.fast ?? intensity;
  tr.fast = intensity > fastPrev ? intensity : intensity + Math.exp(-dt / 0.06) * (fastPrev - intensity);

  // slow baseline: the "recent average" energy in this band
  tr.base = (tr.base ?? intensity) * aBase + intensity * (1 - aBase);

  const rise = tr.fast - (tr.base ?? 0);
  // sensitivity 1 -> needs only +0.02 over baseline; sensitivity 0 -> needs +0.18
  const s = Math.max(0, Math.min(1, sensitivity));
  const openDelta = 0.02 + (1 - s) * 0.16;
  const closeDelta = openDelta * 0.4;

  const armed = tr.armed ?? true;
  if (armed && rise > openDelta && now - tr.lastTriggerTime > cooldownMs) {
    tr.lastTriggerTime = now;
    tr.armed = false;
    tr.value = 1;
  } else if (!armed && rise < closeDelta) {
    tr.armed = true;
  }

  const dec = Math.max(0.001, decayMs / 1000);
  tr.value = Math.max(0, (tr.value ?? 0) - dt / dec);
  return tr.value;
}

const DEFAULT_TRIGGER_MAPPING: LayerTriggerMapping = {
  channels: Array.from({length: 16}, (_, i) => i),
  noteStart: 0,
  noteEnd: 127,
  noteSettings: { ...DEFAULT_NOTE_SETTINGS },
  activeUntil: null,
  velocity: 0,
  triggerBehavior: DEFAULT_TRIGGER_TYPE
};

const RHYTHM_PATTERN_OPTIONS = [
  { value: '4-on-the-Floor', label: '4-on-the-Floor' },
  { value: 'Backbeat', label: 'Backbeat' },
  { value: 'Off-Beat', label: 'Off-Beat' },
  { value: 'Straight Eighths', label: 'Straight Eighths' },
  { value: 'Straight Sixteenths', label: 'Straight Sixteenths' },
  { value: 'The "One"', label: 'The "One"' },
  { value: 'Custom', label: 'Custom' },
];

const INITIAL_MAPPINGS: EffectMapping[] = [
  { 
    id: 'rgb-shift', 
    name: 'Colour Shift', 
    description: 'Artificially separates the Red, Green, and Blue color channels and offsets their positions.',
    channels: Array.from({length: 16}, (_, i) => i), 
    noteStart: 0, 
    noteEnd: 127, 
    active: false,
    manualActive: false,
    isMuted: false,
    isSoloed: false,
    settings: { distance: 20, saturation: 100, jitter: 10 },
    noteSettings: { ...DEFAULT_NOTE_SETTINGS },
    activeUntil: null,
    velocity: 0,
    triggerBehavior: DEFAULT_TRIGGER_TYPE
  },
];

// Stateless 0..1 magnitude for a rhythm mapping at a given wall-clock time (ms).
// Used identically by the layer visibility trigger and every parameter/action trigger
// so "Rhythm" mode behaves the same everywhere.
function computeRhythmMagnitude(rm: RhythmMapping, nowMs: number): number {
  const bpm = rm.bpm || 120;
  const beatTime = (nowMs / 1000.0) * (bpm / 60.0);
  const pattern = rm.pattern;
  const ns: any = rm.noteSettings;
  const fixedVel = ns?.useFixedVelocity ? (ns.fixedVelocity / 127) : 1.0;
  const holdBeats = () => {
    if (ns?.subdivision === '1/2') return 2.0;
    if (ns?.subdivision === '1') return 4.0;
    if (ns?.subdivision === '1/8') return 0.5;
    if (ns?.subdivision === '1/16') return 0.25;
    return 1.0;
  };

  if (pattern === 'Eighth-Note Triplets' || pattern === 'Quarter-Note Triplets') {
    let fraction = pattern === 'Eighth-Note Triplets' ? (beatTime * 3.0) % 1.0 : (beatTime * 1.5) % 1.0;
    fraction = ((fraction % 1.0) + 1.0) % 1.0;
    if (ns?.useFixedDuration) {
      const tripletStepLen = pattern === 'Eighth-Note Triplets' ? (1 / 3) : (2 / 3);
      return (fraction * tripletStepLen) < holdBeats() ? fixedVel : 0.0;
    }
    return Math.exp(-20.0 * fraction) * fixedVel;
  }

  let activePattern = new Array(16).fill(false) as boolean[];
  if (pattern === 'Custom') {
    activePattern = rm.customPattern || activePattern;
  } else {
    switch (pattern) {
      case '4-on-the-Floor': activePattern[0] = activePattern[4] = activePattern[8] = activePattern[12] = true; break;
      case 'Backbeat': activePattern[4] = activePattern[12] = true; break;
      case 'Off-Beat': activePattern[2] = activePattern[6] = activePattern[10] = activePattern[14] = true; break;
      case 'Straight Eighths': for (let i = 0; i < 16; i += 2) activePattern[i] = true; break;
      case 'Straight Sixteenths': activePattern.fill(true); break;
      case 'The "One"': activePattern[0] = true; break;
    }
  }

  const stepsElapsed = beatTime * 4;
  const currentStepIdx = Math.floor(stepsElapsed);
  let lastHitStepIdx = -1;
  for (let i = 0; i < 16; i++) {
    const checkIdx = currentStepIdx - i;
    if (checkIdx < 0) continue;
    if (activePattern[checkIdx % 16]) { lastHitStepIdx = checkIdx; break; }
  }
  if (lastHitStepIdx === -1) return 0.0;
  const beatsSinceHit = (stepsElapsed - lastHitStepIdx) * 0.25;
  if (ns?.useFixedDuration) return beatsSinceHit < holdBeats() ? fixedVel : 0.0;
  return Math.exp(-20.0 * beatsSinceHit) * fixedVel;
}

// --- Color Utilities ---

export function isTransparentColor(c?: string): boolean {
  if (!c) return false;
  const s = c.trim().toLowerCase();
  return s === 'transparent' || s === 'none' || s === 'rgba(0, 0, 0, 0)' || s === 'rgba(0,0,0,0)' || s === '#00000000' || s === '#0000';
}

function hexToRgb(hex: string): { r: number, g: number, b: number } {
  if (!hex || isTransparentColor(hex)) return { r: 0, g: 0, b: 0 };
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return { r: 255, g: 255, b: 255 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number, s: number, v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h: number, s: number, v: number): { r: number, g: number, b: number } {
  h = ((h % 360) + 360) % 360;
  h /= 60;
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function adjustHexBrightness(hex: string, factor: number): string {
  if (isTransparentColor(hex)) return 'transparent';
  const { r, g, b } = hexToRgb(hex);
  if (factor >= 0) {
    return rgbToHex(
      r + (255 - r) * factor,
      g + (255 - g) * factor,
      b + (255 - b) * factor
    );
  } else {
    const f = 1 + factor;
    return rgbToHex(r * f, g * f, b * f);
  }
}

function isColorDark(hex: string): boolean {
  if (isTransparentColor(hex)) return true;
  const { r, g, b } = hexToRgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}


function ColorPickerPopover({
  color,
  onChange,
  onClose,
  title,
  anchorRect,
  paletteColors = [],
  paletteName
}: {
  color: string;
  onChange: (newHex: string) => void;
  onClose: () => void;
  title: string;
  anchorRect?: DOMRect | null;
  paletteColors?: string[];
  paletteName?: string;
}) {
  const isTransparent = isTransparentColor(color);
  const rgb = hexToRgb(color);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

  const [hue, setHue] = useState(isTransparent ? 120 : hsv.h);
  const [sat, setSat] = useState(isTransparent ? 100 : hsv.s);
  const [val, setVal] = useState(isTransparent ? 100 : hsv.v);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const svBoxRef = useRef<HTMLDivElement>(null);

  // Sync internal HSV when incoming color prop changes
  useEffect(() => {
    if (!isTransparentColor(color)) {
      const currRgb = hexToRgb(color);
      const currHsv = rgbToHsv(currRgb.r, currRgb.g, currRgb.b);
      setHue(currHsv.h);
      setSat(currHsv.s);
      setVal(currHsv.v);
    }
  }, [color]);

  // Click outside to dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const updateFromHsv = (newH: number, newS: number, newV: number) => {
    setHue(newH);
    setSat(newS);
    setVal(newV);
    const newRgb = hsvToRgb(newH, newS, newV);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    onChange(hex);
  };

  const handleSvMouseDown = (e: React.MouseEvent) => {
    if (!svBoxRef.current) return;
    const rect = svBoxRef.current.getBoundingClientRect();
    const updateSv = (clientX: number, clientY: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const newSat = (x / rect.width) * 100;
      const newVal = (1 - y / rect.height) * 100;
      updateFromHsv(hue, newSat, newVal);
    };

    updateSv(e.clientX, e.clientY);

    const onMouseMove = (moveEv: MouseEvent) => {
      updateSv(moveEv.clientX, moveEv.clientY);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleEyeDropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          onChange(result.sRGBHex);
        }
      } catch (err) {
        // User cancelled or not supported
      }
    }
  };

  const quickSwatches = [
    'transparent', '#ffffff', '#000000', '#00ff41', '#eb556b', 
    '#7599a4', '#f5a6b5', '#00f0ff', '#ffe600', '#df9bf3', '#6ec7f8', '#d4af37'
  ];

  return createPortal(
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="fixed z-[9999] bg-[#121215] border border-white/20 rounded-lg p-4 shadow-2xl w-80 text-white font-mono text-xs backdrop-blur-xl"
      style={{
        top: anchorRect ? Math.max(16, Math.min(window.innerHeight - 440, anchorRect.top - 380 > 20 ? anchorRect.top - 380 : anchorRect.bottom + 8)) : '50%',
        left: anchorRect ? Math.max(16, Math.min(window.innerWidth - 336, anchorRect.left - 130)) : '50%',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2">
          <div 
            className="w-4 h-4 rounded-full border border-white/30 flex-shrink-0"
            style={{ 
              backgroundColor: isTransparent ? 'transparent' : color,
              backgroundImage: isTransparent ? 'repeating-conic-gradient(#666 0% 25%, #222 0% 50%) 50% / 6px 6px' : undefined
            }} 
          />
          <span className="font-bold tracking-wider text-[11px] uppercase truncate max-w-[200px]">{title}</span>
        </div>
        <button 
          onClick={onClose} 
          className="text-white/40 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Active Palette Quick Selection Swatches */}
      {paletteColors && paletteColors.length > 0 && (
        <div className="mb-3 p-2.5 bg-white/5 border border-white/10 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-white/50 font-mono">
            <span>Current Palette ({paletteName || 'Active'})</span>
            <span className="text-[7px] opacity-60">Click to assign</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
            {paletteColors.map((palHex, pIdx) => {
              const isSelected = !isTransparent && color.toLowerCase() === palHex.toLowerCase();
              return (
                <button
                  key={pIdx}
                  onClick={() => onChange(palHex)}
                  className={`h-7 rounded border flex items-center justify-center transition-all group relative overflow-hidden ${
                    isSelected 
                      ? 'border-white ring-2 ring-white/60 scale-105 shadow-md' 
                      : 'border-white/20 hover:border-white hover:scale-105'
                  }`}
                  style={{ backgroundColor: palHex }}
                  title={`Apply palette color: ${palHex}`}
                >
                  {isSelected && (
                    <Check size={13} className={isColorDark(palHex) ? 'text-white' : 'text-black'} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Transparent Preset Action Button */}
      <div className="mb-3">
        <button
          onClick={() => onChange('transparent')}
          className={`w-full py-1.5 px-3 rounded flex items-center justify-center gap-2 border transition-all text-[11px] font-bold uppercase tracking-wider ${
            isTransparent
              ? 'bg-red-500/20 border-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.4)]'
              : 'bg-white/5 hover:bg-white/10 border-white/15 text-white/70 hover:text-white'
          }`}
          title="Set element to Transparent (allows underlying layers or empty background to show through)"
        >
          <div 
            className="w-3.5 h-3.5 rounded border border-white/40 flex-shrink-0"
            style={{ backgroundImage: 'repeating-conic-gradient(#888 0% 25%, #333 0% 50%) 50% / 5px 5px' }}
          />
          <span>{isTransparent ? '✓ Element Is Transparent' : 'Set As Transparent (Alpha 0)'}</span>
        </button>
      </div>

      {/* 2D Saturation / Value Gradient Box */}
      <div
        ref={svBoxRef}
        onMouseDown={handleSvMouseDown}
        className="w-full h-28 rounded cursor-crosshair relative mb-3 overflow-hidden border border-white/15 select-none"
        style={{
          backgroundColor: `hsl(${hue}, 100%, 50%)`,
          backgroundImage: 'linear-gradient(to right, #fff, transparent), linear-gradient(to top, #000, transparent)'
        }}
      >
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,0.8)] pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${sat}%`,
            top: `${100 - val}%`,
            backgroundColor: isTransparent ? `hsl(${hue}, ${sat}%, ${val}%)` : color
          }}
        />
      </div>

      {/* Hue Slider Bar */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-[9px] text-white/40 uppercase">
          <span>Hue</span>
          <span>{Math.round(hue)}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          value={hue}
          onChange={(e) => updateFromHsv(Number(e.target.value), sat, val)}
          className="w-full h-3 rounded-full appearance-none cursor-pointer border border-white/10"
          style={{
            background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
          }}
        />
      </div>

      {/* HEX and RGB Inputs */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="col-span-2 space-y-1">
          <label className="text-[8px] uppercase tracking-wider text-white/40">HEX</label>
          <div className="flex items-center bg-black/60 border border-white/15 rounded px-2 py-1 focus-within:border-red-500 transition-colors">
            <input
              type="text"
              value={isTransparent ? 'TRANSPARENT' : color.toUpperCase()}
              onChange={(e) => {
                let val = e.target.value.trim().toLowerCase();
                if (val === 'transparent' || val === 'none') {
                  onChange('transparent');
                  return;
                }
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                  onChange(val);
                }
              }}
              className="bg-transparent text-[11px] text-white outline-none w-full font-mono font-bold"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(isTransparent ? 'transparent' : color.toUpperCase());
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="text-white/40 hover:text-white p-0.5 ml-1 transition-colors"
              title="Copy Hex"
            >
              {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[8px] uppercase tracking-wider text-white/40">R</label>
          <input
            type="number"
            min="0"
            max="255"
            value={rgb.r}
            onChange={(e) => {
              const rVal = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
              onChange(rgbToHex(rVal, rgb.g, rgb.b));
            }}
            className="w-full bg-black/60 border border-white/15 rounded px-1.5 py-1 text-[11px] text-center text-white outline-none focus:border-red-500 font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[8px] uppercase tracking-wider text-white/40">G</label>
          <input
            type="number"
            min="0"
            max="255"
            value={rgb.g}
            onChange={(e) => {
              const gVal = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
              onChange(rgbToHex(rgb.r, gVal, rgb.b));
            }}
            className="w-full bg-black/60 border border-white/15 rounded px-1.5 py-1 text-[11px] text-center text-white outline-none focus:border-red-500 font-mono"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
        {/* EyeDropper Tool */}
        {'EyeDropper' in window && (
          <button
            onClick={handleEyeDropper}
            className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/15 border border-white/15 rounded text-[10px] text-white/80 hover:text-white transition-all"
            title="Pick color from screen"
          >
            <Pipette size={12} className="text-red-400" />
            <span>Pick</span>
          </button>
        )}

        {/* Quick Swatches */}
        <div className="flex items-center gap-1 overflow-x-auto py-0.5 custom-scrollbar">
          {quickSwatches.map(sw => {
            const isSwTransparent = isTransparentColor(sw);
            const isSelected = isSwTransparent ? isTransparent : color.toLowerCase() === sw.toLowerCase();
            return (
              <button
                key={sw}
                onClick={() => onChange(sw)}
                className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 flex-shrink-0 relative overflow-hidden ${isSelected ? 'border-white scale-110 shadow-sm' : 'border-white/20'}`}
                style={{ 
                  backgroundColor: isSwTransparent ? 'transparent' : sw,
                  backgroundImage: isSwTransparent ? 'repeating-conic-gradient(#888 0% 25%, #333 0% 50%) 50% / 4px 4px' : undefined
                }}
                title={isSwTransparent ? 'Transparent' : sw}
              >
                {isSwTransparent && <div className="absolute inset-0 border-t border-red-500 transform rotate-45 scale-125" />}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>,
    document.body
  );
}

// --- Components ---

function Knob({ value, min, max, onChange, label, type = 'continuous', id, onContextMenuAction, ccLabel, isLearning }: {
  value: number,
  min: number,
  max: number,
  onChange: (val: number) => void,
  label: string,
  type?: 'continuous' | 'binary',
  id?: string,
  key?: any,
  onContextMenuAction?: (action: 'learn' | 'clear') => void,
  ccLabel?: string,
  isLearning?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [menuPos, setMenuPos] = useState<{x: number, y: number} | null>(null);

  const startY = useRef(0);
  const startX = useRef(0);
  const startVal = useRef(0);

  useEffect(() => {
    const handleGlobalClick = () => setMenuPos(null);
    if (menuPos) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleGlobalClick);
        document.addEventListener('contextmenu', handleGlobalClick);
      }, 50);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleGlobalClick);
        document.removeEventListener('contextmenu', handleGlobalClick);
      };
    }
  }, [menuPos]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startY.current = e.clientY;
    startX.current = e.clientX;
    startVal.current = value;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const deltaY = startY.current - e.clientY;
    const deltaX = e.clientX - startX.current;
    const delta = deltaY + deltaX;
    
    const range = max - min;
    const sensitivity = 200;
    const step = range / sensitivity;
    let newVal = startVal.current + delta * step;
    
    if (type === 'binary') {
      newVal = newVal > (min + max) / 2 ? max : min;
    } else {
      newVal = Math.max(min, Math.min(max, newVal));
    }
    
    onChange(newVal);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    startX.current = e.touches[0].clientX;
    startVal.current = value;
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const deltaY = startY.current - e.touches[0].clientY;
    const deltaX = e.touches[0].clientX - startX.current;
    const delta = deltaY + deltaX;
    
    const range = max - min;
    const sensitivity = 200;
    const step = range / sensitivity;
    let newVal = startVal.current + delta * step;
    
    if (type === 'binary') {
      newVal = newVal > (min + max) / 2 ? max : min;
    } else {
      newVal = Math.max(min, Math.min(max, newVal));
    }
    
    onChange(newVal);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
  };

  const safeVal = typeof value === 'number' && !isNaN(value) ? value : (min || 0);
  const percentage = ((safeVal - min) / (max - min || 1)) * 100;
  const rotation = (percentage / 100) * 270 - 135;

  // Format value for display
  const range = max - min;
  const displayVal = range < 5 ? safeVal.toFixed(2) : range < 20 ? safeVal.toFixed(1) : Math.round(safeVal).toString();

  return (
    <div className="flex flex-col items-center gap-2 group select-none">
      <div className="relative">
        <div 
          className={`relative w-12 h-12 cursor-pointer touch-none transition-transform ${isDragging ? 'scale-110' : ''}`}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onContextMenu={(e) => {
             e.preventDefault();
             e.stopPropagation();
             e.nativeEvent.stopPropagation();
             if (onContextMenuAction) {
                setMenuPos({ x: e.clientX, y: e.clientY });
             }
          }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle 
              cx="50" cy="50" r="40" 
              fill="none" stroke="currentColor" strokeWidth="2" 
              className={`transition-colors ${isLearning ? 'text-red-500 animate-pulse' : 'text-white/10'}`}
            />
            <circle 
              id={id ? `knob-circle-${id}` : undefined}
              cx="50" cy="50" r="40" 
              fill="none" stroke="currentColor" strokeWidth="4" 
              strokeDasharray="251.2"
              strokeDashoffset={251.2 - (percentage / 100) * 188.4}
              transform="rotate(135 50 50)"
              className="text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
              style={{ transition: 'stroke-dashoffset 0.05s linear' }}
            />
            <line 
              id={id ? `knob-line-${id}` : undefined}
              x1="50" y1="50" x2="50" y2="20" 
              stroke="currentColor" strokeWidth="4" strokeLinecap="round"
              transform={`rotate(${rotation} 50 50)`}
              className="text-white"
              style={{ transition: 'transform 0.05s linear' }}
            />
          </svg>
        </div>
        {ccLabel && (
          <div className="absolute -bottom-2 -right-2 bg-red-600 px-1 py-0.5 rounded text-[8px] font-mono font-bold">
            {ccLabel}
          </div>
        )}
        {(isHovered || isDragging) && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-black border border-white/20 rounded px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap pointer-events-none z-50 shadow-lg">
            {displayVal}
          </div>
        )}
      </div>
      {label && <span className="text-[8px] uppercase tracking-widest font-bold opacity-40 group-hover:opacity-100 transition-opacity whitespace-nowrap">{label}</span>}
      {menuPos && createPortal(
         <div 
           className="fixed bg-neutral-900 border border-white/20 rounded shadow-2xl py-1 flex flex-col min-w-[120px] text-[10px] uppercase tracking-widest"
           style={{ left: menuPos.x + 'px', top: menuPos.y + 'px', zIndex: 99999 }}
           onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); }}
           onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); }}
           onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopPropagation(); }}
         >
           <button 
             className="px-3 py-2 text-left hover:bg-neutral-800 text-white/80 hover:text-white transition-colors"
             onClick={(e) => { e.stopPropagation(); onContextMenuAction?.('learn'); setMenuPos(null); }}
           >
             MIDI Learn
           </button>
           {ccLabel && (
             <button 
               className="px-3 py-2 text-left hover:bg-red-900/50 text-red-400 hover:text-red-300 transition-colors"
               onClick={(e) => { e.stopPropagation(); onContextMenuAction?.('clear'); setMenuPos(null); }}
             >
               Remove Mapping
             </button>
           )}
         </div>,
         document.body
      )}
    </div>
  );
}

function RangeSlider({ min, max, start, end, onChange, label }: {
  min: number,
  max: number,
  start: number,
  end: number,
  onChange: (start: number, end: number) => void,
  label: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-[8px] uppercase tracking-widest opacity-40">{label}</label>
        <span className="text-[9px] font-mono opacity-60">{(start ?? 0).toFixed(1)}s - {(end ?? 10).toFixed(1)}s</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute w-full h-1 bg-white/10 rounded-full" />
        <div 
          className="absolute h-1 bg-red-600 rounded-full" 
          style={{ 
            left: `${((start - min) / (max - min)) * 100}%`,
            right: `${100 - ((end - min) / (max - min)) * 100}%`
          }}
        />
        <input 
          type="range" min={min} max={max} step={0.1} value={start}
          onChange={(e) => onChange(Math.min(parseFloat(e.target.value), end - 0.1), end)}
          className="absolute w-full h-1 bg-transparent appearance-none pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none"
        />
        <input 
          type="range" min={min} max={max} step={0.1} value={end}
          onChange={(e) => onChange(start, Math.max(parseFloat(e.target.value), start + 0.1))}
          className="absolute w-full h-1 bg-transparent appearance-none pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none"
        />
      </div>
    </div>
  );
}

function AspectRatioControl({ value, onChange }: { value: number, onChange: (v: number) => void }) {
  let ratio = 1.0;
  if (value < 50) {
    const t = value / 50;
    ratio = 0.5625 + t * (1.0 - 0.5625);
  } else {
    const t = (value - 50) / 50;
    ratio = 1.0 + t * (1.7778 - 1.0);
  }

  const getFormattedRatio = (r: number) => {
    if (Math.abs(r - 0.5625) < 0.02) return '9 : 16';
    if (Math.abs(r - 0.75) < 0.02) return '3 : 4';
    if (Math.abs(r - 1.0) < 0.02) return '1 : 1';
    if (Math.abs(r - 1.3333) < 0.02) return '4 : 3';
    if (Math.abs(r - 1.7778) < 0.02) return '16 : 9';
    if (r >= 1) {
      return `${r.toFixed(2)} : 1`;
    } else {
      return `1 : ${(1 / r).toFixed(2)}`;
    }
  };

  const formattedRatio = getFormattedRatio(ratio);
  const decimalRatio = `${ratio.toFixed(2)}:1`;

  return (
    <div className="p-4 bg-black/40 border border-white/5 space-y-6">
      <div className="flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-widest opacity-40">Aspect Ratio</label>
        <span className="text-[10px] font-mono text-red-500 font-bold">{formattedRatio} ({decimalRatio})</span>
      </div>
      
      <div className="flex items-center gap-8 py-4">
        {/* Reference Image */}
        <div className="w-24 h-24 flex items-center justify-center border border-white/10 rounded bg-black/20 relative">
          <div className="absolute inset-0 border border-dashed border-white/5 scale-90" />
          <motion.div 
            animate={{ 
              width: ratio > 1 ? '100%' : `${ratio * 100}%`,
              height: ratio > 1 ? `${(1/ratio) * 100}%` : '100%'
            }}
            className="border-2 border-white rounded-sm flex items-center justify-center bg-white/5"
          >
            <span className="text-[8px] font-bold opacity-50">{formattedRatio}</span>
          </motion.div>
        </div>

        <div className="flex-1 space-y-4">
           <div className="flex justify-between text-[8px] uppercase tracking-widest opacity-40">
              <button title="Set Portrait (9:16)" onClick={() => onChange(0)} className={value < 25 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Portrait (9:16)</button>
              <button title="Set Square (1:1)" onClick={() => onChange(50)} className={value >= 40 && value <= 60 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Square (1:1)</button>
              <button title="Set Landscape (16:9)" onClick={() => onChange(100)} className={value > 75 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Landscape (16:9)</button>
           </div>
           <input 
             type="range" min="0" max="100" value={value}
             onChange={(e) => onChange(parseInt(e.target.value))}
             className="w-full h-1 bg-white/10 rounded-full appearance-none accent-red-600"
           />
        </div>
      </div>
    </div>
  );
}

function HelpIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block ml-2">
      <button 
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="opacity-30 hover:opacity-100 transition-opacity p-2"
      >
        <Eye size={12} />
      </button>
      <AnimatePresence>
        {show && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-900 border border-white/10 rounded text-[10px] leading-relaxed shadow-xl pointer-events-none"
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Compact modulation-amount stepper: number field + small up/down chevrons,
// matching the app's minimal red/white styling instead of a bare number input.
function TriggerAmountInput({ value, onChange }: { value: number; onChange: (val: number) => void }) {
  const bump = (delta: number) => {
    const next = Math.max(-100, Math.min(100, Math.round(value * 100) + delta));
    onChange(next / 100);
  };
  return (
    <div className="flex items-center gap-0.5">
      <input
        type="number"
        min="-100" max="100"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Math.max(-100, Math.min(100, parseInt(e.target.value) || 0)) / 100)}
        className="w-7 bg-transparent text-[10px] text-right outline-none text-red-400 font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        title="Modulation Amount (-100 to 100)"
      />
      <div className="flex flex-col -space-y-1">
        <button type="button" onClick={() => bump(5)} className="text-white/30 hover:text-red-400 leading-none transition-colors" title="Increase">
          <ChevronUp size={9} strokeWidth={3} />
        </button>
        <button type="button" onClick={() => bump(-5)} className="text-white/30 hover:text-red-400 leading-none transition-colors" title="Decrease">
          <ChevronDown size={9} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

// App-styled dropdown to replace bare native <select> elements: same trigger
// look as other controls, with a custom popover option list (portalled so it
// never gets clipped by a scrolling panel).
function CustomSelect({ value, onChange, options, className, buttonClassName, placeholder }: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={buttonClassName ?? `w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded px-2 py-1.5 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors ${className ?? ''}`}
      >
        <span className="truncate">{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={11} className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="max-h-56 overflow-y-auto bg-[#0a0a0a] border border-white/15 rounded shadow-2xl custom-scrollbar"
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors ${o.value === value ? 'bg-red-600 text-white' : 'text-white/70 hover:bg-white/10'}`}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function NoteSettingsConfigUI({ ns, onUpdateNote }: { ns: NoteSettings, onUpdateNote: (field: string, val: any) => void }) {
  const ToggleSwitch = ({ active }: { active: boolean }) => (
    <div className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${active ? 'bg-red-600' : 'bg-white/20'}`}>
      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform shadow-sm ${active ? 'translate-x-4' : 'translate-x-1'}`} />
    </div>
  );

  return (
    <div className="space-y-3 pt-6 border-t border-white/5">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-70">Trigger Configuration</label>
        
        {/* Duration Card */}
        <div className={`p-3 rounded-md border transition-all ${ns.useFixedDuration ? 'bg-white/10 border-white/20' : 'bg-black/40 border-white/5'}`}>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => onUpdateNote('useFixedDuration', !ns.useFixedDuration)}>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider">Fixed Duration</span>
              <span className="text-[8px] opacity-40">Play for exact musical length</span>
            </div>
            <ToggleSwitch active={ns.useFixedDuration} />
          </div>
          <AnimatePresence>
          {ns.useFixedDuration && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="pt-3 mt-3 border-t border-white/10 space-y-3">
                <div className="grid grid-cols-5 gap-1">
                  {['1', '1/2', '1/4', '1/8', '1/16'].map(sub => (
                    <button key={sub} onClick={() => onUpdateNote('subdivision', sub)} className={`h-6 rounded text-[8px] font-mono transition-all border ${ns.subdivision === sub ? 'bg-red-600 border-red-500 text-white' : 'bg-black/40 border-white/5 text-white/40'}`}>
                      {sub}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[8px] uppercase opacity-30">BPM</label>
                  <input type="number" min="20" max="300" value={ns.bpm} onChange={(e) => onUpdateNote('bpm', parseInt(e.target.value))} className="flex-1 bg-black/40 border border-white/10 rounded p-1 text-[10px] outline-none" />
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        {/* Velocity Card */}
        <div className={`p-3 rounded-md border transition-all ${ns.useFixedVelocity ? 'bg-white/10 border-white/20' : 'bg-black/40 border-white/5'}`}>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => onUpdateNote('useFixedVelocity', !ns.useFixedVelocity)}>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider">Fixed Velocity</span>
              <span className="text-[8px] opacity-40">Ignore input sensitivity</span>
            </div>
            <ToggleSwitch active={ns.useFixedVelocity} />
          </div>
          <AnimatePresence>
          {ns.useFixedVelocity && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="pt-3 mt-3 border-t border-white/10 flex items-center gap-2">
                <input type="range" min="0" max="127" value={ns.fixedVelocity} onChange={(e) => onUpdateNote('fixedVelocity', parseInt(e.target.value))} className="flex-1 accent-red-600" />
                <span className="text-[10px] font-mono w-6 text-right">{ns.fixedVelocity}</span>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        {/* ADSR Card */}
        <div className={`p-3 rounded-md border transition-all ${ns.useFixedDuration ? 'opacity-40 bg-white/2 border-white/5' : 'bg-white/5 border-white/10'}`}>
          <div className="flex justify-between items-start mb-3">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider">Envelope (ADSR)</span>
              <span className="text-[8px] opacity-40">Control attack, decay, sustain, release</span>
            </div>
            {ns.useFixedDuration && (
              <span className="text-[7px] font-mono uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                Superseded by Fixed Duration
              </span>
            )}
          </div>
          
          <div className={`space-y-3 ${ns.useFixedDuration ? 'pointer-events-none' : ''}`}>
            <div className="flex items-center gap-2 group">
              <span className="text-[8px] w-12 opacity-50 uppercase font-bold group-hover:text-red-400 transition-colors">Attack</span>
              <input type="range" min="0" max="2000" value={ns.attack} onChange={(e) => onUpdateNote('attack', parseInt(e.target.value))} className="flex-1 accent-red-600" />
              <span className="text-[8px] font-mono w-8 text-right bg-black/40 px-1 py-0.5 rounded">{ns.attack}</span>
            </div>
            <div className="flex items-center gap-2 group">
              <span className="text-[8px] w-12 opacity-50 uppercase font-bold group-hover:text-red-400 transition-colors">Decay</span>
              <input type="range" min="0" max="2000" value={ns.decay} onChange={(e) => onUpdateNote('decay', parseInt(e.target.value))} className="flex-1 accent-red-600" />
              <span className="text-[8px] font-mono w-8 text-right bg-black/40 px-1 py-0.5 rounded">{ns.decay}</span>
            </div>
            <div className="flex items-center gap-2 group">
              <span className="text-[8px] w-12 opacity-50 uppercase font-bold group-hover:text-red-400 transition-colors">Sustain</span>
              <input type="range" min="0" max="100" value={Math.round(ns.sustain * 100)} onChange={(e) => onUpdateNote('sustain', parseInt(e.target.value) / 100)} className="flex-1 accent-red-600" />
              <span className="text-[8px] font-mono w-8 text-right bg-black/40 px-1 py-0.5 rounded">{Math.round(ns.sustain * 100)}%</span>
            </div>
            <div className="flex items-center gap-2 group">
              <span className="text-[8px] w-12 opacity-50 uppercase font-bold group-hover:text-red-400 transition-colors">Release</span>
              <input type="range" min="0" max="5000" value={ns.release} onChange={(e) => onUpdateNote('release', parseInt(e.target.value))} className="flex-1 accent-red-600" />
              <span className="text-[8px] font-mono w-8 text-right bg-black/40 px-1 py-0.5 rounded">{ns.release}</span>
            </div>
          </div>
        </div>
      </div>
  );
}

function MidiConfigUI({ label, mapping, onUpdate, onUpdateNote, onToggleChannel, onSetAllChannels, onSetNoChannels, isLearnActive, onToggleLearn }: {
  label: string,
  mapping: LayerTriggerMapping | EffectMapping,
  onUpdate: (field: string, val: any) => void,
  onUpdateNote: (field: string, val: any) => void,
  onToggleChannel: (ch: number) => void,
  onSetAllChannels: () => void,
  onSetNoChannels: () => void,
  isLearnActive?: { field: 'noteStart' | 'noteEnd' } | false,
  onToggleLearn?: (field: 'noteStart' | 'noteEnd') => void,
}) {
  const safeMapping = {
    ...DEFAULT_TRIGGER_MAPPING,
    ...(mapping || {}),
    channels: mapping?.channels || Array.from({length: 16}, (_, i) => i),
    noteSettings: mapping?.noteSettings || { ...DEFAULT_NOTE_SETTINGS },
    noteStart: mapping?.noteStart !== undefined ? mapping.noteStart : 0,
    noteEnd: mapping?.noteEnd !== undefined ? mapping.noteEnd : 127,
    triggerBehavior: mapping?.triggerBehavior || 'momentary'
  };
  const ns = safeMapping.noteSettings;

  return (
    <div className="space-y-4 pt-6 border-t border-white/5">
      <div className="flex justify-between items-center">
        <label className="text-[10px] uppercase tracking-widest opacity-40">{label}</label>
        <div className="flex bg-black/40 border border-white/10 rounded p-0.5">
           <button 
             onClick={() => onUpdate('triggerBehavior', 'momentary')}
             className={`px-2 py-0.5 text-[8px] uppercase tracking-tighter rounded-sm transition-all ${safeMapping.triggerBehavior === 'momentary' ? 'bg-red-600 text-white' : 'opacity-40'}`}
           >
             Momentary
           </button>
           <button 
             onClick={() => onUpdate('triggerBehavior', 'toggle')}
             className={`px-2 py-0.5 text-[8px] uppercase tracking-tighter rounded-sm transition-all ${safeMapping.triggerBehavior === 'toggle' ? 'bg-red-600 text-white' : 'opacity-40'}`}
           >
             Toggle
           </button>
        </div>
      </div>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-[8px] uppercase opacity-30">Channels</label>
          <div className="flex gap-2">
            <button onClick={onSetAllChannels} className="text-[8px] uppercase tracking-widest bg-transparent px-2 py-0.5 rounded hover:border border-white hover:bg-white hover:text-black transition-colors">All</button>
            <button onClick={onSetNoChannels} className="text-[8px] uppercase tracking-widest bg-transparent px-2 py-0.5 rounded hover:border border-white hover:bg-white hover:text-black transition-colors">None</button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {Array.from({length: 16}).map((_, i) => {
            const isSelected = safeMapping.channels.includes(i);
            return (
              <button key={i} onClick={() => onToggleChannel(i)} className={`h-8 rounded text-[10px] font-mono transition-all border ${isSelected ? 'bg-red-600 border-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-black/40 border-white/5 text-white/40 hover:border-white/20'}`}>
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[8px] uppercase opacity-30">Note Range</label>
        <div className="flex items-center gap-1">
          <div className="relative w-full flex items-center group">
            <input type="number" min="0" max="127" value={safeMapping.noteStart} onChange={(e) => onUpdate('noteStart', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none pr-6" />
            {onToggleLearn && (
              <button 
                onClick={() => onToggleLearn('noteStart')} 
                className={`absolute right-1 p-1 rounded transition-colors ${isLearnActive && isLearnActive.field === 'noteStart' ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-white/30 hover:text-white'}`}
                title="MIDI Learn Start"
              >
                <Zap size={10} />
              </button>
            )}
          </div>
          <span className="opacity-30">-</span>
          <div className="relative w-full flex items-center group">
            <input type="number" min="0" max="127" value={safeMapping.noteEnd} onChange={(e) => onUpdate('noteEnd', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none pr-6" />
            {onToggleLearn && (
              <button 
                onClick={() => onToggleLearn('noteEnd')} 
                className={`absolute right-1 p-1 rounded transition-colors ${isLearnActive && isLearnActive.field === 'noteEnd' ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-white/30 hover:text-white'}`}
                title="MIDI Learn End"
              >
                <Zap size={10} />
              </button>
            )}
          </div>
        </div>
      </div>

      <NoteSettingsConfigUI ns={safeMapping.noteSettings} onUpdateNote={onUpdateNote} />
    </div>
  );
}

// --- Topography Utils ---
const perm=new Uint8Array(512),p=new Uint8Array(256);
for(let i=0;i<256;i++)p[i]=i;
for(let i=255;i>0;i--){const j=Math.floor(Math.random()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
for(let i=0;i<512;i++)perm[i]=p[i&255];
function fade(t: number){return t*t*t*(t*(t*6-15)+10);}
function lerp(a: number,b: number,t: number){return a+(b-a)*t;}
function grad(h: number,x: number,y: number){h&=3;const u=h<2?x:y,v=h<2?y:x;return((h&1)?-u:u)+((h&2)?-v:v);}
function noise2(x: number,y: number){
  const X=Math.floor(x)&255,Y=Math.floor(y)&255;
  x-=Math.floor(x);y-=Math.floor(y);
  const u=fade(x),v=fade(y),a=perm[X]+Y,b=perm[X+1]+Y;
  return lerp(lerp(grad(perm[a],x,y),grad(perm[b],x-1,y),u),lerp(grad(perm[a+1],x,y-1),grad(perm[b+1],x-1,y-1),u),v);
}
function fbm(x: number,y: number,oct: number){
  let v=0,a=0.5,fx=x,fy=y;
  for(let i=0;i<oct;i++){v+=a*noise2(fx,fy);a*=0.5;fx*=2.1;fy*=2.1;}
  return v;
}

// --- Particle Sphere Utils ---
function hash3(x: number,y: number,z: number){
  let h = Math.sin(x*127.1 + y*311.7 + z*74.7)*43758.5453;
  return h - Math.floor(h);
}
function snoise3d(x: number,y: number,z: number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=x-ix,fy=y-iy,fz=z-iz;
  const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),uz=fz*fz*(3-2*fz);
  const v000=hash3(ix,iy,iz),     v100=hash3(ix+1,iy,iz);
  const v010=hash3(ix,iy+1,iz),   v110=hash3(ix+1,iy+1,iz);
  const v001=hash3(ix,iy,iz+1),   v101=hash3(ix+1,iy,iz+1);
  const v011=hash3(ix,iy+1,iz+1), v111=hash3(ix+1,iy+1,iz+1);
  return (v000*(1-ux)+v100*ux)*(1-uy)*(1-uz)
        +(v010*(1-ux)+v110*ux)*uy*(1-uz)
        +(v001*(1-ux)+v101*ux)*(1-uy)*uz
        +(v011*(1-ux)+v111*ux)*uy*uz;
}

interface SphereParticle {
  nx: number; ny: number; nz: number;
  phase: number; freq: number;
}
function buildSphereParticles(count: number): SphereParticle[] {
  const pts: SphereParticle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push({
      nx: Math.cos(theta) * r,
      ny: y,
      nz: Math.sin(theta) * r,
      phase: Math.random() * Math.PI * 2,
      freq: 0.8 + Math.random() * 0.8,
    });
  }
  return pts;
}

// --- Frame Accumulator "Isolate Motion" helpers ----------------------------
// Background-subtraction chronophotography: given a background reference, key out
// only the pixels of the current frame that changed, so repeated stamps build a
// "multiplicity" image (one clean background, the subject frozen at each moment).
const FA_DIFF_W = 640;   // work width for the diff/mask
const FA_STAMP_W = 1280; // stored cutout width -- caps memory (32 x 1080p canvases = ~265MB)
const _faScratch: Record<string, HTMLCanvasElement> = {};
function faScratch(key: string, w: number, h: number): HTMLCanvasElement {
  let c = _faScratch[key];
  if (!c) { c = document.createElement('canvas'); _faScratch[key] = c; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
function faMedian(frames: ImageData[]): ImageData {
  const n = frames.length, w = frames[0].width, h = frames[0].height;
  const out = new ImageData(w, h);
  const buf = new Array<number>(n);
  const px = w * h;
  for (let p = 0; p < px; p++) {
    const o = p * 4;
    for (let ch = 0; ch < 3; ch++) {
      for (let f = 0; f < n; f++) buf[f] = frames[f].data[o + ch];
      buf.sort((a, b) => a - b);
      out.data[o + ch] = buf[n >> 1];
    }
    out.data[o + 3] = 255;
  }
  return out;
}
// Returns a canvas (<= FA_STAMP_W wide) = current frame with alpha keyed to
// where it differs from `bg` (feathered, speckle-cleaned). null if nothing
// moved. Pass `outCanvas` to reuse it (per-frame path) instead of allocating.
function faBuildCutout(
  src: HTMLCanvasElement,
  bg: CanvasImageSource,
  opts: { threshold: number; feather: number; suppressShadows: boolean },
  outCanvas?: HTMLCanvasElement,
): HTMLCanvasElement | null {
  const srcW = src.width, srcH = src.height;
  if (!srcW || !srcH) return null;
  const W = Math.min(srcW, FA_STAMP_W);
  const H = Math.max(1, Math.round((W * srcH) / srcW));
  const dw = Math.min(W, FA_DIFF_W);
  const dh = Math.max(1, Math.round((dw * H) / W));
  const cur = faScratch('fa-cur', dw, dh);
  const bgc = faScratch('fa-bg', dw, dh);
  const cx = cur.getContext('2d')!;
  const bx = bgc.getContext('2d')!;
  cx.clearRect(0, 0, dw, dh); cx.filter = 'blur(1.2px)'; cx.drawImage(src, 0, 0, dw, dh); cx.filter = 'none';
  bx.clearRect(0, 0, dw, dh); bx.filter = 'blur(1.2px)'; bx.drawImage(bg, 0, 0, dw, dh); bx.filter = 'none';
  const cd = cx.getImageData(0, 0, dw, dh).data;
  const bd = bx.getImageData(0, 0, dw, dh).data;
  const thr = Math.max(2, opts.threshold);
  const maskImg = new ImageData(dw, dh);
  const md = maskImg.data;
  let any = false;
  for (let i = 0; i < cd.length; i += 4) {
    const dr = cd[i] - bd[i], dg = cd[i + 1] - bd[i + 1], db = cd[i + 2] - bd[i + 2];
    let d = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
    if (opts.suppressShadows && dr < 0 && dg < 0 && db < 0) {
      const chroma = Math.abs(dr - dg) + Math.abs(dg - db) + Math.abs(dr - db);
      if (chroma < thr * 1.3) d = 0; // uniform darkening + low chroma shift => shadow
    }
    const a = d <= thr ? 0 : d >= thr * 2 ? 255 : Math.round(((d - thr) / thr) * 255);
    if (a > 0) any = true;
    md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = a;
  }
  if (!any) return null;
  const maskC = faScratch('fa-mask', dw, dh);
  const mctx = maskC.getContext('2d')!;
  mctx.putImageData(maskImg, 0, 0);
  // open (blur + re-threshold) to kill speckle and fill small holes
  const clean = faScratch('fa-clean', dw, dh);
  const clx = clean.getContext('2d')!;
  clx.clearRect(0, 0, dw, dh);
  clx.filter = 'blur(2.5px)'; clx.drawImage(maskC, 0, 0); clx.filter = 'none';
  const cid = clx.getImageData(0, 0, dw, dh);
  for (let i = 3; i < cid.data.length; i += 4) cid.data[i] = cid.data[i] > 110 ? 255 : 0;
  clx.putImageData(cid, 0, 0);
  const out = outCanvas || document.createElement('canvas');
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const octx = out.getContext('2d')!;
  octx.globalCompositeOperation = 'source-over';
  octx.filter = 'none';
  octx.clearRect(0, 0, W, H);
  octx.drawImage(src, 0, 0, W, H);
  octx.globalCompositeOperation = 'destination-in';
  const f = Math.max(0, opts.feather || 0);
  octx.filter = f > 0 ? `blur(${f}px)` : 'none';
  octx.drawImage(clean, 0, 0, W, H);
  octx.filter = 'none';
  octx.globalCompositeOperation = 'source-over';
  return out;
}

export default function App() {
  // State
  const [layers, setLayers] = useState<Layer[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const forceGen = params.get('gen');
    const allDefs = parseGeneratives();
    const matchedDef = forceGen ? allDefs.find(p => p.uuid === forceGen) : null;
    const initColors: Record<string, string> = {};
    if (matchedDef?.elements) {
      matchedDef.elements.forEach(el => {
        initColors[el.id] = el.defaultColor;
      });
    } else {
      initColors.background = '#050a05';
      initColors.cubes_crimson = '#00ff41';
      initColors.cubes_slate = '#008f11';
      initColors.wireframes = '#50ff70';
    }
    const defaultPalId = matchedDef?.defaultPaletteId || (
      (matchedDef?.elements && matchedDef.elements.length <= 2)
        ? (matchedDef.color === 'white' ? 'monochrome_duo_white' : 'monochrome_duo')
        : 'acid_matrix'
    );

    return [
      {
        id: 'layer-1',
        name: 'Dancing Cubes',
        type: 'generative',
        generativeId: forceGen || 'dancing-cubes-canvas-1',
        src: null,
        opacity: 1,
        blendMode: 'source-over',
        filterId: null,
        filterSettings: {},
        isVisible: true,
        isActive: false,
        midiMode: false,
        videoTriggerMode: 'continuous',
        triggerMapping: { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
        rhythmMapping: { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: Array(16).fill(false) },
        mappings: [],
        generativeSettings: {},
        generativeMappings: [
          {
            ...INITIAL_MAPPINGS[0],
            id: 'palette_cycle',
            name: 'Palette Cycle',
            description: 'Cycles colors across unlocked elements on each trigger hit.',
            active: true,
            manualActive: false,
            isMuted: false,
            isSoloed: false,
            channels: Array.from({length: 16}, (_, i) => i),
            noteStart: 0,
            noteEnd: 127,
            triggerBehavior: 'momentary' as any,
            noteSettings: { ...DEFAULT_NOTE_SETTINGS }
          },
          {
            ...INITIAL_MAPPINGS[0],
            id: 'rotate_face',
            name: 'rotate_face',
            description: 'Rotates a cube face on each detected hit.',
            active: true,
            manualActive: false,
            isMuted: false,
            isSoloed: false,
            channels: Array.from({length: 16}, (_, i) => i),
            noteStart: 0,
            noteEnd: 127,
            triggerBehavior: 'momentary' as any,
            noteSettings: { ...DEFAULT_NOTE_SETTINGS },
            audioMapping: {
              ...DEFAULT_AUDIO_MAPPING,
              enabled: true,
              engine: 'transient',
              stemId: 'funky-drums',
              freqRange: [35, 120],
              sensitivity: 0.7,
              decayMs: 200,
            },
          }
        ],
        generativeTriggerActive: {
          palette_cycle: false,
          rotate_face: true
        },
        generativeTriggerAmount: {},
        generativeColors: initColors,
        generativeLockedColors: {},
        generativeActivePaletteId: defaultPalId,
        generativeColorCycleIndex: 0
      }
    ];
  });
  const [activeLayerId, setActiveLayerId] = useState<string | null>('layer-1');
  const [isColorsMenuExpanded, setIsColorsMenuExpanded] = useState(true);
  const [activeColorPickerTarget, setActiveColorPickerTarget] = useState<{
    elementId: string;
    elementName: string;
    color: string;
    anchorRect?: DOMRect | null;
  } | null>(null);
  const [activeMaskMenuLayerId, setActiveMaskMenuLayerId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [webcamError, setWebcamError] = useState<Record<string, string>>({});
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [midiLearnTarget, setMidiLearnTarget] = useState<{layerId: string, effectId?: string, field: 'noteStart' | 'noteEnd'} | null>(null);
  const [isMidiLearnMode, setIsMidiLearnMode] = useState(false);
  const [ccLearnTarget, setCcLearnTarget] = useState<{layerId: string, paramId: string, min: number, max: number} | null>(null);
  const [expandedParamTrigger, setExpandedParamTrigger] = useState<string | null>(null);
  const [midiLogs, setMidiLogs] = useState<MidiLogEntry[]>([]);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'visual' | 'midi' | 'effects'>('visual');
  const [expandedSection, setExpandedSection] = useState<string | null>('layers');
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>('generative-rotate_face');
  const [selectedLayerForEffect, setSelectedLayerForEffect] = useState<string | null>('layer-1');
  const [showEffectBrowser, setShowEffectBrowser] = useState(false);
  const [showAssetBrowser, setShowAssetBrowser] = useState(false);
  const [assetBrowserLayerTarget, setAssetBrowserLayerTarget] = useState<string | null>(null);
  const [showGenerativeBrowser, setShowGenerativeBrowser] = useState(false);
  const [status, setStatus] = useState('STANDBY');
  const [currentProjectFile, setCurrentProjectFile] = useState<string | null>(null);
  const [showRoutingGuide, setShowRoutingGuide] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>('midi-devices');
  const [rightSection, setRightSection] = useState<string | null>('triggers');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [compositionLayout, setCompositionLayout] = useState<'stack' | 'split-vertical' | 'split-horizontal' | 'grid-2x2' | 'grid-3x3' | 'grid-4x4'>('stack');
  const [aspectRatioValue, setAspectRatioValue] = useState<number>(() => { const p = new URLSearchParams(window.location.search); return p.get('gen') ? 50 : 60; });
  const [resolutionScale, setResolutionScale] = useState(1.0); // Default to 100% Quality
  const [sidebarTab, setSidebarTab] = useState<'config' | 'triggers'>('config');
  const [belowPanel, setBelowPanel] = useState<'params' | 'colours' | 'fx'>('params');
  const [isRecording, setIsRecording] = useState(false);
  const [isPanic, setIsPanic] = useState(false);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [isDraggingOverVisuals, setIsDraggingOverVisuals] = useState(false);
  const [isDraggingOverCanvas, setIsDraggingOverCanvas] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const webcamStreamsRef = useRef<Record<string, MediaStream>>({});
  const masterPlaybackStartTimeRef = useRef<number>(performance.now());

  const resyncAllVideos = useCallback(() => {
    const nowTime = performance.now();
    masterPlaybackStartTimeRef.current = nowTime;
    layersRef.current.forEach(layer => {
      if (layer.type === 'video' && !layer.isLive) {
        const vid = videoRefs.current[layer.id];
        if (vid) {
          const start = layer.videoStart || 0;
          if ((vid as any).fastSeek) {
            try { (vid as any).fastSeek(start); } catch (e) { vid.currentTime = start; }
          } else {
            vid.currentTime = start;
          }
        }
      }
    });
  }, []);
  const imageRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Detached "pop-out" window that mirrors the main render canvas (drag to another screen).
  const popoutWinRef = useRef<Window | null>(null);
  const popoutStreamRef = useRef<MediaStream | null>(null);
  // Tracks each video layer's src so stale frame buffers can be wiped on change.
  const lastVideoSrcRef = useRef<Record<string, string | null | undefined>>({});
  const prevFrameRef = useRef<Record<string, Uint8ClampedArray>>({});
  const echoBufferRef = useRef<Uint8ClampedArray[]>([]);
  const lastFrameTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const lastMidiId = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const windowsRef = useRef<{ x: number, y: number, w: number, h: number, id: number, time: number }[]>([]);
  const glitchBoxesRef = useRef<{ x: number, y: number, w: number, h: number, id: number, life: number, value: string }[]>([]);
  const voronoiPointsRef = useRef<{ x: number, y: number, vx: number, vy: number }[]>([]);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const asciiAtlasRef = useRef<HTMLCanvasElement | null>(null);
  const asciiDownsampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const generativesRef = useRef<GenerativeDefinition[]>(
    [...parseGeneratives()].sort((a, b) => {
      const ai = GENERATIVE_CATEGORY_ORDER.indexOf(a.category);
      const bi = GENERATIVE_CATEGORY_ORDER.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.description.localeCompare(b.description);
    })
  );
  const triggerStatesRef = useRef<Record<string, {
    isDown: boolean;
    velocity: number;
    phase: 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
    currentEnvValue: number;
    lastUpdate: number;
    activeUntil: number | null;
    useFixedDuration: boolean;
  }>>({});
  const layersRef = useRef<Layer[]>(layers);
  layersRef.current = layers;
  const audioTrackersRef = useRef<Record<string, { state: 'idle' | 'attack' | 'release', value: number, lastUpdate: number, lastTriggerTime: number }>>({});
  const parameterEasingRef = useRef<Record<string, number>>({});
  const wavesCanvasRef = useRef<Record<string, HTMLCanvasElement>>({}); 
  const wavesNoiseRef = useRef<any>(null);
  const terrainNoiseRef = useRef<any>(null);
  const topographyCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereParticlesRef = useRef<Record<string, { count: number, particles: SphereParticle[] }>>({});
  const layerOutputCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
  const actionTriggerStateRef = useRef<Record<string, { lastTriggered: number, count: number, prevActive: boolean }>>({});
  const dancingCubesRotationRef = useRef<Record<string, { current: number, target: number }>>({});
  const kineticTypeStateRef = useRef<Record<string, { words: any[], lastImpact: number, lastCount: number }>>({});
  const circleBloomStateRef = useRef<Record<string, { circles: any[], lastSpawn: number, lastAction: number }>>({});
  const gridLitStateRef = useRef<Record<string, { lit: number[], lastShuffle: number, lastAction: number, total: number }>>({});
  const stackedBallsStateRef = useRef<Record<string, { balls: any[], lastSpawn: number }>>({});
  const reactionDiffusionStateRef = useRef<Record<string, any>>({});
  const cubesMatrixStateRef = useRef<Record<string, any>>({});
  const debrisGravityStateRef = useRef<Record<string, any>>({});
  const brutalistLuckRef = useRef<Record<string, any>>({});
  const voronoiStateRef = useRef<Record<string, any>>({});
  const contourStateRef = useRef<Record<string, any>>({});
  const neonLabyrinthStateRef = useRef<Record<string, any>>({});
  const pixelSwarmStateRef = useRef<Record<string, any>>({});
  const tetrominoStateRef = useRef<Record<string, any>>({});
  const hillscapeStateRef = useRef<Record<string, any>>({});
  const orbitDeflectionStateRef = useRef<Record<string, any>>({});
  const centipedeStateRef = useRef<Record<string, any>>({});
  const orbClusterStateRef = useRef<Record<string, any>>({});
  const hatchedSummitStateRef = useRef<Record<string, any>>({});
  const symbolPortraitStateRef = useRef<Record<string, any>>({});
  const inkBlotStateRef = useRef<Record<string, any>>({});
  const floatingGemStateRef = useRef<Record<string, any>>({});
  const confettiScatterStateRef = useRef<Record<string, any>>({});
  const wovenHexStateRef = useRef<Record<string, any>>({});
  const circuitRoutesStateRef = useRef<Record<string, any>>({});
  const spiralShellsStateRef = useRef<Record<string, any>>({});
  const polarCheckerStateRef = useRef<Record<string, any>>({});
  const truchetArcsStateRef = useRef<Record<string, any>>({});
  const voxelCrossStateRef = useRef<Record<string, any>>({});
  const flowStrokesStateRef = useRef<Record<string, any>>({});
  const halftoneDriftStateRef = useRef<Record<string, any>>({});
  const deltaMazeStateRef = useRef<Record<string, any>>({});
  const threadNestStateRef = useRef<Record<string, any>>({});
  const isoBarWaveStateRef = useRef<Record<string, any>>({});
  const dragonTextStateRef = useRef<Record<string, any>>({});

  // Accumulation Mode Refs
  const accumulateCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const referenceFrameRef = useRef<Record<string, HTMLCanvasElement>>({});
  const frameAccumulatorSnapshotsRef = useRef<Record<string, HTMLCanvasElement[]>>({});
  const stutterStateRef = useRef<Record<string, { triggerStamp: boolean; clearBuffer: boolean; wasActive?: boolean; lastCaptureTime?: number; setBg?: boolean; medianBg?: { frames: ImageData[]; need: number } | null; liveTick?: number; liveReady?: boolean }>>({});
  // "Isolate Motion" state: persistent composite buffer + background plate + cutout list per layer.
  const frameAccBufRef = useRef<Record<string, HTMLCanvasElement>>({});
  const frameAccBgRef = useRef<Record<string, HTMLCanvasElement>>({});
  const frameAccCutoutsRef = useRef<Record<string, HTMLCanvasElement[]>>({});
  const stickinessCirclesRef = useRef<Record<string, { count: number, circles: any[] }>>({});
  const videoRewindStateRef = useRef<Record<string, { triggered?: boolean; rewinding: boolean; visible?: boolean; lastSeekTime?: number; virtualTime?: number; rewindStartTime?: number }>>({});
  const rewindFramesBufferRef = useRef<Record<string, HTMLCanvasElement[]>>({});
  const boomerangStartFrameRef = useRef<Record<string, HTMLCanvasElement>>({});
  const boomerangLastSnapRef = useRef<Record<string, HTMLCanvasElement>>({});
  const videoRestartTimeRef = useRef<Record<string, number>>({});
  const videoInitialSeekDoneRef = useRef<Record<string, boolean>>({});
  const lastRenderTimeRef = useRef<number>(performance.now());
  const [audioStems, setAudioStems] = useState<{ id: string, name: string, fileUrl: string, isMuted: boolean, isSoloed: boolean }[]>([]);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioLoop, setAudioLoop] = useState(true);
  const [ytUrl, setYtUrl] = useState('');
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [ytStatus, setYtStatus] = useState('');
  const extractYouTubeId = (url: string): string | null => {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null);
  };
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setAudioTime(engine.getCurrentTime());
      setAudioDuration(engine.getMaxDuration());
    }, 150);
    return () => clearInterval(interval);
  }, []);

  // Load the bundled default track ("Funky drums.wav") as a stem on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await engine.addStem('funky-drums', 'Funky Drums', './funky-drums.wav');
        if (cancelled) return;
        engine.setLoop(true);
        setAudioStems(prev => prev.some(s => s.id === 'funky-drums')
          ? prev
          : [{ id: 'funky-drums', name: 'Funky Drums', fileUrl: './funky-drums.wav', isMuted: false, isSoloed: false }, ...prev]);
        setAudioDuration(engine.getMaxDuration());
      } catch (e) {
        console.warn('Default audio failed to load', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Screen Wake Lock & Tablet Keep-Awake Manager
  const wakeLockRef = useRef<any>(null);
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const lastMidiActivityRef = useRef<number>(Date.now());

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        if (wakeLockRef.current && !wakeLockRef.current.released) return;
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        setIsWakeLockActive(true);
        lock.addEventListener('release', () => {
          setIsWakeLockActive(false);
          wakeLockRef.current = null;
        });
      } catch (err) {
        // Can fail if low battery or tab in background
      }
    }
  }, []);

  useEffect(() => {
    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    const handleUserInteraction = () => {
      if (!wakeLockRef.current || wakeLockRef.current.released) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });

    // Periodic check to keep tablet screen awake if receiving MIDI or playing
    const keepAliveInterval = setInterval(() => {
      if (isPlaying || Date.now() - lastMidiActivityRef.current < 300000) {
        requestWakeLock();
      }
    }, 15000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('touchstart', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
      clearInterval(keepAliveInterval);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch (e) {}
      }
    };
  }, [requestWakeLock, isPlaying]);

  const handleAddAudioStem = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newStems = [...audioStems];
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const url = URL.createObjectURL(file);
      const id = Math.random().toString();
      await engine.addStem(id, file.name, url);
      newStems.push({ id, name: file.name, fileUrl: url, isMuted: false, isSoloed: false });
    }
    setAudioStems(newStems);
  };

  
  const handleNewProject = () => {
    setLayers([
      { id: 'layer-1', name: 'Background', type: 'image', src: null, opacity: 1, blendMode: 'source-over', filterId: null, filterSettings: {}, isVisible: true, midiMode: false, videoTriggerMode: 'continuous', triggerMapping: DEFAULT_TRIGGER_MAPPING, mappings: [], isMuted: false, isSoloed: false }
    ]);
    setAudioStems([]);
    setScenes([]);
    setCurrentProjectFile(null);
  };

  const handleSaveProject = async () => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      const projectData = JSON.stringify({ layers, aspectRatioValue, compositionLayout, audioStems, scenes }, null, 2);
      const filePath = await electronAPI.saveProject(projectData);
      if (filePath) {
        setCurrentProjectFile(filePath);
      }
    }
  };

  const handleLoadProject = async () => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      const response = await electronAPI.openProject();
      if (response && response.data) {
        try {
          const parsed = JSON.parse(response.data);
          const processedLayers = await Promise.all(parsed.layers.map(async (l: any) => {
            if (l.isLive) {
              // Live camera streams can't be persisted -- reload as disconnected so the
              // user can re-grant/re-select the camera rather than showing a fake feed.
              return { ...l, isLive: false };
            }
            if (l.assetPath) {
              const exists = await electronAPI.checkFileExists(l.assetPath);
              if (exists) {
                const parts = l.assetPath.split('\\');
                const safePath = parts.map((part: string, i: number) => i === 0 && part.endsWith(':') ? part : encodeURIComponent(part)).join('/');
                return { ...l, src: 'file:///' + safePath, missingAsset: false };
              } else {
                return { ...l, missingAsset: true };
              }
            }
            return l;
          }));
          setLayers(processedLayers);
          if (parsed.aspectRatioValue) setAspectRatioValue(parsed.aspectRatioValue);
          if (parsed.compositionLayout) setCompositionLayout(parsed.compositionLayout);
          if (parsed.audioStems) setAudioStems(parsed.audioStems);
          if (parsed.scenes) setScenes(parsed.scenes);
          setCurrentProjectFile(response.filePath);
        } catch (e) {
          console.error("Failed to load project", e);
        }
      }
    }
  };

  // Auto-Save Effect
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      const data = JSON.stringify({ layers, aspectRatioValue, compositionLayout, audioStems, scenes, currentProjectFile });
      const timeoutId = setTimeout(() => {
        electronAPI.saveAutoSave(data);
      }, 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [layers, aspectRatioValue, compositionLayout, audioStems, scenes, currentProjectFile]);

  // IPC Menu Listeners & Initial Load Auto-Restore
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      // Menu Events
      electronAPI.onMenuNew(handleNewProject);
      electronAPI.onMenuOpen(handleLoadProject);
      electronAPI.onMenuSave(handleSaveProject);
    }
  }, [layers, aspectRatioValue, compositionLayout, audioStems, scenes, currentProjectFile]); // Re-bind when state changes so closures use fresh data!

  // Single initial boot effect
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      electronAPI.loadAutoSave().then(async (data: any) => {
        if (data) {
          try {
            const parsed = JSON.parse(data);
            const processedLayers = await Promise.all(parsed.layers.map(async (l: any) => {
              if (l.isLive) {
                return { ...l, isLive: false };
              }
              if (l.assetPath) {
                const exists = await electronAPI.checkFileExists(l.assetPath);
                if (exists) {
                  const parts = l.assetPath.split('\\');
                  const safePath = parts.map((part: string, i: number) => i === 0 && part.endsWith(':') ? part : encodeURIComponent(part)).join('/');
                  return { ...l, src: 'file:///' + safePath, missingAsset: false };
                } else {
                  return { ...l, missingAsset: true };
                }
              }
              return l;
            }));
            setLayers(processedLayers);
            if (parsed.aspectRatioValue) setAspectRatioValue(parsed.aspectRatioValue);
            if (parsed.compositionLayout) setCompositionLayout(parsed.compositionLayout);
            if (parsed.audioStems) setAudioStems(parsed.audioStems);
            if (parsed.scenes) setScenes(parsed.scenes);
            if (parsed.currentProjectFile) setCurrentProjectFile(parsed.currentProjectFile);
          } catch (e) {
            console.error("Failed to restore autosave", e);
          }
        }
      });
    }
  }, []);


  const toggleAudioPlay = () => {
    if (audioPlaying) { engine.pauseAll(); setAudioPlaying(false); }
    else { engine.resumeAll(); setAudioPlaying(true); }
  };

  const toggleAudioMute = () => {
    setAudioMuted(m => { const nv = !m; engine.setMasterMuted(nv); return nv; });
  };

  const toggleAudioLoop = () => {
    setAudioLoop(l => { const nv = !l; engine.setLoop(nv); return nv; });
  };

  const toggleStemMute = (id: string) => {
    engine.toggleMute(id);
    setAudioStems(prev => prev.map(s => s.id === id ? { ...s, isMuted: !s.isMuted } : s));
  };

  const toggleStemSolo = (id: string) => {
    engine.toggleSolo(id);
    setAudioStems(prev => prev.map(s => s.id === id ? { ...s, isSoloed: !s.isSoloed } : s));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    engine.seek(time);
    setAudioTime(time);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const removeAudioStem = (id: string) => {
    engine.removeStem(id);
    setAudioStems(prev => prev.filter(s => s.id !== id));
  };

  const webglRendererRef = useRef<WebGLGenerativeRenderer | null>(null);
  if (typeof window !== 'undefined' && !webglRendererRef.current) {
    webglRendererRef.current = new WebGLGenerativeRenderer(1920, 1080);
  }
  const threeDEngineRef = useRef<ThreeDEngine | null>(null);
  if (typeof window !== 'undefined' && !threeDEngineRef.current) {
    threeDEngineRef.current = new ThreeDEngine();
  }
  const threeDLoadingRef = useRef<Record<string, boolean>>({});
  const [kinectError, setKinectError] = useState<Record<string, string>>({});
  // Canvas 3D-navigation mode: when on, the ThreeDCameraOverlay captures the
  // pointer (orbit/pan/zoom/anchor) and the anchor + recenter tools show.
  const [threeDControlsActive, setThreeDControlsActive] = useState(false);
  const [threeDAnchorShown, setThreeDAnchorShown] = useState(false);
  // Camera Sequence: rising-edge state per (layer, seq trigger) + current slot per layer.
  const seqEdgeRef = useRef<Record<string, boolean>>({});
  const seqCurRef = useRef<Record<string, number>>({});
  const [anglesPanelOpen, setAnglesPanelOpen] = useState(false);
  // Keep the anchor-toggle button in sync with the (per-layer) engine state
  // when the active layer changes.
  useEffect(() => {
    setThreeDAnchorShown(activeLayerId ? (threeDEngineRef.current?.isAnchorVisible(activeLayerId) ?? false) : false);
  }, [activeLayerId]);

  // --- Recording Logic ---

  const startRecording = () => {
    if (!canvasRef.current) return;
    try {
      const stream = canvasRef.current.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `glitch-pulse-recording-${Date.now()}.webm`;
        a.click();
        recordedChunksRef.current = [];
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Recording Error:", err);
      alert("Recording is not supported in this browser or context.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const stopAll = () => {
    setIsPanic(true);
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setIsPlaying(false);
    
    // Deactivate all effects across all layers
    setLayers(prevLayers => prevLayers.map(layer => ({
      ...layer,
      mappings: layer.mappings.map(m => ({
        ...m,
        active: false,
        manualActive: false,
        velocity: 0
      }))
    })));
    
    // Clear logs
    setMidiLogs([]);
    setStatus('STOPPED');
    
    setTimeout(() => setIsPanic(false), 1000);
  };

  // --- MIDI Logic ---

  const requestMidiAccess = useCallback(() => {
    if (navigator.requestMIDIAccess) {
      console.log("Requesting MIDI access...");
      navigator.requestMIDIAccess().then((access) => {
        console.log("MIDI access granted.");
        setMidiAccess(access);
        const updateDevices = () => {
          const devices: MidiDevice[] = [];
          access.inputs.forEach((input) => {
            devices.push({ id: input.id, name: input.name || 'Unknown Device' });
          });
          console.log("MIDI devices found:", devices);
          setMidiDevices(devices);
          setSelectedDeviceIds(prev => prev.length === 0 ? devices.map(d => d.id) : prev.filter(id => devices.some(d => d.id === id)));
        };
        updateDevices();
        access.onstatechange = updateDevices;
      }).catch(err => {
        console.error("MIDI Access Error:", err);
      });
    } else {
      console.warn("Web MIDI API not supported in this browser.");
    }
  }, []);

  const requestAudioDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      setAudioDevices(inputs);
    } catch (err) {
      console.error("Audio Devices Error:", err);
    }
  }, []);

  const requestVideoDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(inputs);
    } catch (err) {
      console.error("Video Devices Error:", err);
    }
  }, []);

  const stopWebcam = useCallback((layerId: string) => {
    const stream = webcamStreamsRef.current[layerId];
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      delete webcamStreamsRef.current[layerId];
    }
    const vid = videoRefs.current[layerId];
    if (vid) vid.srcObject = null;
  }, []);

  const startWebcam = useCallback(async (layerId: string, deviceId?: string) => {
    try {
      stopWebcam(layerId);
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamStreamsRef.current[layerId] = stream;
      const vid = videoRefs.current[layerId];
      if (vid) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
      setWebcamError(prev => { const next = { ...prev }; delete next[layerId]; return next; });
      setLayers(prev => prev.map(l => l.id === layerId ? {
        ...l,
        type: 'video',
        isLive: true,
        liveDeviceId: deviceId || stream.getVideoTracks()[0]?.getSettings().deviceId || l.liveDeviceId,
        src: null,
        missingMedia: false,
        videoTriggerMode: 'continuous',
        name: 'Live Camera',
      } : l));
      requestVideoDevices();
    } catch (err: any) {
      console.error("Webcam Error:", err);
      setWebcamError(prev => ({ ...prev, [layerId]: err?.message || 'Could not access the camera.' }));
    }
  }, [stopWebcam, requestVideoDevices]);

  useEffect(() => {
    requestMidiAccess();
    requestAudioDevices();
    requestVideoDevices();
    navigator.mediaDevices?.addEventListener('devicechange', requestAudioDevices);
    navigator.mediaDevices?.addEventListener('devicechange', requestVideoDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', requestAudioDevices);
      navigator.mediaDevices?.removeEventListener('devicechange', requestVideoDevices);
    };
  }, [requestMidiAccess, requestAudioDevices, requestVideoDevices]);

  const handleMidiMessage = useCallback((event: any) => {
    // Keep tablet awake while receiving MIDI events
    lastMidiActivityRef.current = Date.now();
    if (!wakeLockRef.current || wakeLockRef.current.released) {
      requestWakeLock();
    }

    const [statusByte, note, velocity] = event.data;
    const channel = statusByte & 0xf;
    const type = statusByte >> 4;

    // Note On (9) or Note Off (8)
    if (type === 9 || type === 8) {
      const isDown = type === 9 && velocity > 0;
      
      if (isDown && midiLearnTarget) {
        setLayers(prev => prev.map(l => {
          if (l.id !== midiLearnTarget.layerId) return l;
          if (midiLearnTarget.effectId) {
            const eid = midiLearnTarget.effectId;
            const patchArr = (arr?: any[]) => (arr || []).map(m => m.id === eid ? {
              ...m,
              channels: m.channels || Array.from({ length: 16 }, (_, i) => i),
              noteSettings: m.noteSettings || { ...DEFAULT_NOTE_SETTINGS },
              [midiLearnTarget.field]: note,
            } : m);
            // The learn target can live in any of the three mapping families.
            if (l.mappings?.some(m => m.id === eid)) return { ...l, mappings: patchArr(l.mappings) };
            if (l.threeDMappings?.some(m => m.id === eid)) return { ...l, threeDMappings: patchArr(l.threeDMappings) };
            return { ...l, generativeMappings: patchArr(l.generativeMappings) };
          }
          const baseTrigger = l.triggerMapping || DEFAULT_TRIGGER_MAPPING;
          return {
            ...l,
            triggerMapping: {
              ...baseTrigger,
              channels: baseTrigger.channels || Array.from({length: 16}, (_, i) => i),
              noteSettings: baseTrigger.noteSettings || { ...DEFAULT_NOTE_SETTINGS },
              [midiLearnTarget.field]: note
            }
          };
        }));
        setMidiLearnTarget(null);
        return;
      }
      
      const log: MidiLogEntry = {
        id: ++lastMidiId.current,
        channel: channel + 1,
        note,
        velocity,
        timestamp: Date.now(),
        type: isDown ? 'ON' : 'OFF'
      };
      setMidiLogs(prev => [log, ...prev].slice(0, 15));

      // 1. Check Scene Triggers
      if (isDown) {
        const sceneToTrigger = scenes.find(s => s.midiNote === note);
        if (sceneToTrigger) {
          setLayers(prev => prev.map(layer => {
            const sceneLayer = sceneToTrigger.layers.find(sl => sl.id === layer.id);
            if (sceneLayer) {
              return {
                ...layer,
                isVisible: sceneLayer.isVisible,
                opacity: sceneLayer.opacity,
                filterId: sceneLayer.filterId,
                filterSettings: { ...sceneLayer.filterSettings }
              };
            }
            return layer;
          }));
          setStatus(`SCENE: ${sceneToTrigger.name}`);
          return;
        }
      }

      // 2. Check Layer Triggers
      layersRef.current.forEach(layer => {
        const tr = layer.triggerMapping || { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } };
        const channels = tr.channels && tr.channels.length > 0 ? tr.channels : Array.from({length: 16}, (_, i) => i);
        const noteStart = tr.noteStart !== undefined ? tr.noteStart : 0;
        const noteEnd = tr.noteEnd !== undefined ? tr.noteEnd : 127;
        const noteSettings = tr.noteSettings || DEFAULT_NOTE_SETTINGS;
        if (channels.includes(channel) && note >= noteStart && note <= noteEnd) {
          const finalVelocity = noteSettings.useFixedVelocity ? (noteSettings.fixedVelocity ?? 127) : velocity;
          const triggerKey = `layer-${layer.id}`;
          
          if (!triggerStatesRef.current[triggerKey]) {
            triggerStatesRef.current[triggerKey] = { isDown: false, velocity: 0, phase: 'idle', currentEnvValue: 0, lastUpdate: Date.now(), activeUntil: null, useFixedDuration: false };
          }
          const state = triggerStatesRef.current[triggerKey];

          // --- Frame Advance Mode ---
          if (layer.videoTriggerMode === 'advance' && layer.type === 'video' && isDown) {
            const vid = videoRefs.current[layer.id];
            if (vid) {
              const unit = layer.videoAdvanceUnit || 'frames';
              const amount = layer.videoAdvanceAmount || 1;
              const fps = layer.videoFrameRate || 30;
              const delta = unit === 'frames' ? (amount / fps) : amount;
              const start = layer.videoStart || 0;
              const end = (layer.videoEnd && layer.videoEnd > start) ? layer.videoEnd : (vid.duration || (start + 10));
              let newTime = vid.currentTime + delta;
              if (newTime >= end) newTime = start + (newTime - end);
              vid.currentTime = Math.max(start, Math.min(end, newTime));
              vid.pause();
            }
          }

          // --- Boomerang Mode ---
          if (layer.videoTriggerMode === 'rewind' && layer.type === 'video') {
            const vid = videoRefs.current[layer.id];
            if (isDown) {
              if (rewindFramesBufferRef.current[layer.id]) {
                rewindFramesBufferRef.current[layer.id] = [];
              }
              const start = layer.videoStart || 0;
              if (vid) {
                vid.currentTime = start;
                if (vid.paused && isPlaying) vid.play().catch(() => {});
              }
              videoRewindStateRef.current[layer.id] = { 
                triggered: true, 
                rewinding: false, 
                visible: true, 
                lastSeekTime: performance.now()
              };
            } else {
              videoRewindStateRef.current[layer.id] = { 
                triggered: false, 
                rewinding: true, 
                visible: true, 
                lastSeekTime: performance.now()
              };
              if (vid) vid.pause();
            }
          }

          // --- Frame Accumulator Mode ---
          if (layer.videoTriggerMode === 'frame-accumulator' && isDown) {
            if (!stutterStateRef.current[layer.id]) {
              stutterStateRef.current[layer.id] = { triggerStamp: true, clearBuffer: false, wasActive: false };
            } else {
              stutterStateRef.current[layer.id].triggerStamp = true;
            }
          }
          
          if (tr.triggerBehavior === 'toggle') {
            if (isDown) {
              const newState = state.phase === 'idle' || state.phase === 'release';
              state.isDown = newState;
              state.velocity = newState ? finalVelocity : 0;
              state.phase = newState ? 'attack' : 'release';
              if (newState && layer.videoTriggerMode === 'restart' && layer.type === 'video') {
                videoRestartTimeRef.current[layer.id] = performance.now();
                const vid = videoRefs.current[layer.id];
                if (vid) {
                  vid.currentTime = layer.videoStart || 0;
                  if (isPlaying && (layer.speed ?? 1.0) > 0) vid.play().catch(() => {});
                }
              }
            }
          } else {
            if (isDown) {
              state.isDown = true;
              state.velocity = finalVelocity;
              state.phase = 'attack';
              if (layer.videoTriggerMode === 'restart' && layer.type === 'video') {
                videoRestartTimeRef.current[layer.id] = performance.now();
                const vid = videoRefs.current[layer.id];
                if (vid) {
                  vid.currentTime = layer.videoStart || 0;
                  if (isPlaying && (layer.speed ?? 1.0) > 0) vid.play().catch(() => {});
                }
              }
            } else {
              if (!tr.noteSettings?.useFixedDuration) {
                state.isDown = false;
                state.phase = 'release';
              }
            }
          }

          if (tr.noteSettings?.useFixedDuration && isDown) {
            const bpm = tr.noteSettings.bpm || 120;
            const beatDuration = 60000 / bpm;
            let duration = beatDuration;
            const sub = tr.noteSettings.subdivision;
            if (sub === '1') duration = beatDuration * 4;
            else if (sub === '1/2') duration = beatDuration * 2;
            else if (sub === '1/4') duration = beatDuration;
            else if (sub === '1/8') duration = beatDuration / 2;
            else if (sub === '1/16') duration = beatDuration / 4;
            state.useFixedDuration = true;
            state.activeUntil = Date.now() + duration;
          } else if (!tr.noteSettings?.useFixedDuration) {
            state.useFixedDuration = false;
            state.activeUntil = null;
          }
        }
      });

      // 3. Check Effect & Generative Mappings
      layersRef.current.forEach(layer => {
        const processMapping = (m: any, type: string) => {
          if (m.channels.includes(channel) && note >= m.noteStart && note <= m.noteEnd) {
            const finalVelocity = m.noteSettings.useFixedVelocity ? m.noteSettings.fixedVelocity : velocity;
            const triggerKey = `${type}-${layer.id}-${m.id}`;
            
            if (!triggerStatesRef.current[triggerKey]) {
              triggerStatesRef.current[triggerKey] = { isDown: false, velocity: 0, phase: 'idle', currentEnvValue: 0, lastUpdate: Date.now(), activeUntil: null, useFixedDuration: false };
            }
            const state = triggerStatesRef.current[triggerKey];

            if (isDown) {
              if (m.triggerBehavior === 'toggle') {
                const newState = state.phase === 'idle' || state.phase === 'release';
                state.isDown = newState;
                state.velocity = newState ? finalVelocity : 0;
                state.phase = newState ? 'attack' : 'release';
              } else {
                state.isDown = true;
                state.velocity = finalVelocity;
                state.phase = 'attack';
              }

              if (m.noteSettings?.useFixedDuration) {
                const bpm = m.noteSettings.bpm || 120;
                const beatDuration = 60000 / bpm;
                let duration = beatDuration;
                const sub = m.noteSettings.subdivision;
                if (sub === '1') duration = beatDuration * 4;
                else if (sub === '1/2') duration = beatDuration * 2;
                else if (sub === '1/4') duration = beatDuration;
                else if (sub === '1/8') duration = beatDuration / 2;
                else if (sub === '1/16') duration = beatDuration / 4;
                state.useFixedDuration = true;
                state.activeUntil = Date.now() + duration;
              } else {
                state.useFixedDuration = false;
                state.activeUntil = null;
              }
            } else {
              if (m.triggerBehavior !== 'toggle' && !m.noteSettings?.useFixedDuration) {
                state.isDown = false;
                state.phase = 'release';
              }
            }
          }
        };

        layer.mappings.forEach(m => processMapping(m, 'effect'));
        layer.generativeMappings?.forEach(m => processMapping(m, 'gen'));
        layer.threeDMappings?.forEach(m => processMapping(m, '3d'));

        ['size', 'rotation', 'posX', 'posY'].forEach(paramName => {
           if (layer.transformTriggerActive?.[paramName]) {
              const triggerKey = `transform-${layer.id}-${paramName}`;
              if (!triggerStatesRef.current[triggerKey]) {
                 triggerStatesRef.current[triggerKey] = { isDown: false, velocity: 0, phase: 'idle', currentEnvValue: 0, lastUpdate: Date.now(), activeUntil: null, useFixedDuration: false };
              }
              const state = triggerStatesRef.current[triggerKey];
              if (isDown) {
                 state.isDown = true;
                 state.velocity = velocity;
                 state.phase = 'attack';
              } else {
                 state.isDown = false;
                 state.phase = 'release';
              }
           }
        });
      });
    }

    // Control Change (11)
    if (type === 11) {
      const log: MidiLogEntry = {
        id: ++lastMidiId.current,
        channel: channel + 1,
        note, // CC Number
        velocity, // CC Value
        timestamp: Date.now(),
        type: 'CC'
      };
      setMidiLogs(prev => [log, ...prev].slice(0, 15));

      if (ccLearnTarget) {
         setLayers(prev => prev.map(l => {
           if (l.id === ccLearnTarget.layerId) {
             return { ...l, ccBindings: { ...(l.ccBindings || {}), [ccLearnTarget.paramId]: { cc: note, min: ccLearnTarget.min, max: ccLearnTarget.max } } };
           }
           return l;
         }));
         setCcLearnTarget(null);
      } else {
        // Check Layer CC Bindings
        setLayers(prev => prev.map(l => {
          let newLayer = { ...l };
          let changed = false;
          
          if (l.midiCC === note) {
            newLayer.opacity = velocity / 127;
            changed = true;
          }
          
          if (l.ccBindings) {
             for (const [paramId, bindingRaw] of Object.entries(l.ccBindings)) {
                const binding = bindingRaw as { cc: number; min: number; max: number };
                if (binding.cc === note) {
                   const mappedValue = binding.min + (velocity / 127) * (binding.max - binding.min);
                   
                   if (paramId === 'opacity') {
                      newLayer.opacity = mappedValue;
                   } else if (paramId.startsWith('generative-')) {
                      const pName = paramId.replace('generative-', '');
                      newLayer.generativeSettings = { ...(newLayer.generativeSettings || {}), [pName]: mappedValue };
                   } else if (paramId.startsWith('3d-')) {
                      const pName = paramId.replace('3d-', '');
                      newLayer.threeDSettings = { ...(newLayer.threeDSettings || {}), [pName]: mappedValue };
                   } else if (paramId.startsWith('effect-')) {
                      const parts = paramId.split('-');
                      const mappingId = parts[1];
                      const effectParamId = parts.slice(2).join('-');
                      newLayer.mappings = newLayer.mappings.map(m => 
                         m.id === mappingId ? { ...m, settings: { ...m.settings, [effectParamId]: mappedValue } } : m
                      );
                   }
                   changed = true;
                }
             }
          }
          
          return changed ? newLayer : l;
        }));
      }
    }
  }, [layers, scenes, midiLearnTarget, ccLearnTarget]);

  useEffect(() => {
    if (!midiAccess || selectedDeviceIds.length === 0) return;
    selectedDeviceIds.forEach(id => {
      const input = midiAccess.inputs.get(id);
      if (input) input.onmidimessage = handleMidiMessage;
    });
    return () => {
      selectedDeviceIds.forEach(id => {
        const input = midiAccess.inputs.get(id);
        if (input) input.onmidimessage = null;
      });
    };
  }, [midiAccess, selectedDeviceIds, handleMidiMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setLayers(prevLayers => {
        let anyNeedsUpdate = false;
        
        // Quick check first
        for (const layer of prevLayers) {
          if (layer.mappings.some(m => m.activeUntil && now >= m.activeUntil)) {
            anyNeedsUpdate = true;
          }
          if (layer.triggerMapping?.activeUntil && now >= layer.triggerMapping.activeUntil) {
            anyNeedsUpdate = true;
          }
          if (layer.generativeMappings?.some(m => m.activeUntil && now >= m.activeUntil)) {
            anyNeedsUpdate = true;
          }
        }
        
        if (!anyNeedsUpdate) return prevLayers;
        
        return prevLayers.map(layer => {
          let layerNeedsUpdate = layer.mappings.some(m => m.activeUntil && now >= m.activeUntil) || 
                                 (layer.triggerMapping?.activeUntil && now >= layer.triggerMapping.activeUntil) ||
                                 (layer.generativeMappings?.some(m => m.activeUntil && now >= m.activeUntil));
          if (!layerNeedsUpdate) return layer;
          
          let newLayer = { ...layer };
          if (newLayer.triggerMapping?.activeUntil && now >= newLayer.triggerMapping.activeUntil) {
            newLayer.isActive = false;
            newLayer.triggerMapping = { ...newLayer.triggerMapping, activeUntil: null, velocity: 0 };
          }
          newLayer.mappings = newLayer.mappings.map(m => {
            if (m.activeUntil && now >= m.activeUntil) {
              return { ...m, active: false, activeUntil: null, velocity: 0 };
            }
            return m;
          });
          if (newLayer.generativeMappings) {
            newLayer.generativeMappings = newLayer.generativeMappings.map(m => {
              if (m.activeUntil && now >= m.activeUntil) {
                return { ...m, active: false, activeUntil: null, velocity: 0 };
              }
              return m;
            });
          }
          return newLayer;
        });
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const simulateMidi = () => {
    const fakeEvent = {
      data: [0x90, 36, 100] // Note On, CH 1, Note 36
    };
    handleMidiMessage(fakeEvent);
    setTimeout(() => {
      handleMidiMessage({ data: [0x80, 36, 0] });
    }, 500);
  };

  const refreshMidi = () => {
    setStatus('SCANNING MIDI...');
    requestMidiAccess();
    setTimeout(() => setStatus('ENGINE READY'), 1000);
  };

  useEffect(() => {
    (window as any).sendMidiNote = (note = 60, velocity = 100, isDown = true) => {
      handleMidiMessage({
        data: [isDown ? 0x90 : 0x80, note, isDown ? velocity : 0]
      });
    };
  }, [handleMidiMessage]);

  // --- Video Processing ---

  const processFrame = useCallback(() => {
    if (!canvasRef.current) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const mainCanvas = canvasRef.current;
    const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: false });
    if (!mainCtx) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Dynamic aspect ratio calculation (0 = 9:16, 50 = 1:1, 100 = 16:9)
    let ratio = 1.0;
    if (aspectRatioValue < 50) {
      const t = aspectRatioValue / 50;
      ratio = 0.5625 + t * (1.0 - 0.5625);
    } else {
      const t = (aspectRatioValue - 50) / 50;
      ratio = 1.0 + t * (1.7778 - 1.0);
    }

    // Stabilize base dimensions (maintaining a 1080p-ish area)
    const baseArea = 1920 * 1080;
    let baseW = Math.sqrt(baseArea * ratio);
    let baseH = baseW / ratio;

    // Check if any heavy pixel effect is currently active to dynamically drop resolution
    let hasActiveEffect = false;
    const heavyEffectsList = ['rgb-shift', 'edges', 'invert', 'pixelate', 'motion-detector', 'ascii', 'dithering', 'motion-symbols', 'glitch-box', 'glitch-slice', 'windows-98'];
    for (const layer of layers) {
      if (layer.isMuted) continue;
      for (const m of layer.mappings) {
        if (m.isMuted || !heavyEffectsList.includes(m.id)) continue;
        if (m.manualActive) {
          hasActiveEffect = true;
          break;
        }
        const state = triggerStatesRef.current[`effect-${layer.id}-${m.id}`];
        if (state && state.currentEnvValue > 0.001) {
          hasActiveEffect = true;
          break;
        }
      }
      if (hasActiveEffect) break;
    }

    // Explicitly reduce the internal resolution dynamically when an effect is active to guarantee 60fps
    const dynamicResScale = hasActiveEffect ? Math.min(resolutionScale, 0.45) : resolutionScale;

    const targetW = Math.floor(baseW * dynamicResScale);
    const targetH = Math.floor(baseH * dynamicResScale);

    if (mainCanvas.width !== targetW) {
      mainCanvas.width = targetW;
      mainCanvas.height = targetH;
    }

    // Setup Offscreen Canvas for per-layer processing
    if (!(window as any).offscreenCanvas) {
      (window as any).offscreenCanvas = document.createElement('canvas');
      (window as any).offscreenCtx = (window as any).offscreenCanvas.getContext('2d');
    }
    const canvas = (window as any).offscreenCanvas as HTMLCanvasElement;
    const ctx = (window as any).offscreenCtx as CanvasRenderingContext2D;
    
    if (canvas.width !== targetW) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    if (!(window as any).rawOffscreenCanvas) {
      (window as any).rawOffscreenCanvas = document.createElement('canvas');
      (window as any).rawOffscreenCtx = (window as any).rawOffscreenCanvas.getContext('2d');
    }
    const rawCanvas = (window as any).rawOffscreenCanvas as HTMLCanvasElement;
    const rawCtx = (window as any).rawOffscreenCtx as CanvasRenderingContext2D;
    
    if (rawCanvas.width !== targetW) {
      rawCanvas.width = targetW;
      rawCanvas.height = targetH;
    }

    // Clear main canvas
    mainCtx.clearRect(0, 0, targetW, targetH);
    if (bufferCtxRef.current) {
      bufferCtxRef.current.clearRect(0, 0, targetW, targetH);
    }

    const now = performance.now();
    const deltaTime = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    // Draw layers from bottom to top (reversed array so index 0 renders last/on top if we sort later, 
    // but the user asked drag and drop to make top cover bottom.
    // If Reorder.Group puts index 0 at top visually, then rendering index N then index 0 is what we want.
    // So we will reverse the `layers` array to render bottom visuals first.)
    const anySolo = layers.some(l => l.isSoloed);
    const layersToDraw = [...layers].reverse().filter(l => {
      if (l.isMuted) return false;
      if (anySolo && !l.isSoloed) return false;
      return true;
    });

    const renderedLayersMap: Record<string, {
      canvas: HTMLCanvasElement;
      opacityMult: number;
      slotX: number;
      slotY: number;
      slotW: number;
      slotH: number;
      isGrid: boolean;
      layer: Layer;
    }> = {};

    layersToDraw.forEach(layer => {
      let audioVisualOpacity = 1.0;
      let audioIsActive = false;
      let audioIntensity = 0.0;
      
      // --- MIDI ADSR PROCESSING ---
      const triggerKey = `layer-${layer.id}`;
      const state = triggerStatesRef.current[triggerKey];
      let midiIsActive = !!layer.isActive;
      const tr = layer.triggerMapping || { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } };
      let midiVisualOpacity = tr ? tr.velocity / 127 : (layer.isActive ? 1.0 : 0.0);
      if (state) {
          const ns = tr.noteSettings || DEFAULT_NOTE_SETTINGS;
          
          if (ns.useFixedDuration || state.useFixedDuration) {
              // Fixed Duration supersedes ADSR: stays fully on for exact duration, then turns off
              if (state.activeUntil && Date.now() < state.activeUntil) {
                  state.currentEnvValue = 1.0;
                  state.phase = 'sustain';
              } else {
                  state.currentEnvValue = 0.0;
                  state.phase = 'idle';
                  state.isDown = false;
                  state.activeUntil = null;
              }
          } else {
              const dt = deltaTime / 1000.0; // delta in seconds
              const sustain = ns.sustain !== undefined ? ns.sustain : 1.0;
              
              if (state.phase === 'attack') {
                 const a = (ns.attack || 0) / 1000.0;
                 if (a <= 0.001) state.currentEnvValue = 1;
                 else state.currentEnvValue += dt / a;
                 if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'decay'; }
              } else if (state.phase === 'decay') {
                 const d = (ns.decay || 0) / 1000.0;
                 if (d <= 0.001) state.currentEnvValue = sustain;
                 else state.currentEnvValue -= dt * (1 - sustain) / d;
                 if (state.currentEnvValue <= sustain) { 
                    state.currentEnvValue = sustain; 
                    state.phase = 'sustain'; 
                 }
              } else if (state.phase === 'sustain') {
                 state.currentEnvValue = sustain;
              } else if (state.phase === 'release') {
                 const r = (ns.release || 0) / 1000.0;
                 if (r <= 0.001) state.currentEnvValue = 0;
                 else state.currentEnvValue -= dt / r;
                 if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
              }
          }
          
          midiVisualOpacity = state.currentEnvValue * (state.velocity / 127);
          midiIsActive = state.currentEnvValue > 0.001;
      }

      // --- HIGH SPEED AUDIO POLLING ---
      if (layer.audioMapping?.enabled) {
          if (!audioTrackersRef.current[layer.id]) {
            audioTrackersRef.current[layer.id] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
          }
          const tracker = audioTrackersRef.current[layer.id];
          const dt = (now - tracker.lastUpdate) / 1000.0; // Seconds
          tracker.lastUpdate = now;

          const mode = layer.audioMapping.mode || 'smooth';
          const audioEngineType = layer.audioMapping.engine || 'level';
          const { intensity, flux } = engine.getBandIntensity(layer.audioMapping.stemId || '', layer.audioMapping.freqRange || [20, 20000]);

          if (audioEngineType === 'transient') {
              const v = processTransientHit(
                  intensity,
                  layer.audioMapping.sensitivity ?? 0.6,
                  layer.audioMapping.decayMs ?? 220,
                  layer.audioMapping.cooldownMs ?? 50,
                  tracker,
                  dt,
                  now,
              );
              audioIntensity = v;
              audioIsActive = v > 0.01;
              audioVisualOpacity = layer.audioMapping.target === 'opacity' ? v : 1.0;
          } else if (mode === 'smooth') {
              const attackSecs = layer.audioMapping.attack ?? 0.05;
              const releaseSecs = layer.audioMapping.release ?? 0.2;

              if (intensity >= layer.audioMapping.threshold) {
                 tracker.state = 'attack';
              }

              if (tracker.state === 'attack') {
                 tracker.value += attackSecs > 0.001 ? (dt / attackSecs) : 1.0;
                 if (tracker.value >= 1.0) {
                     tracker.value = 1.0;
                     tracker.state = 'release';
                 }
              } else {
                 tracker.state = 'release';
                 tracker.value -= releaseSecs > 0.001 ? (dt / releaseSecs) : 1.0;
                 if (tracker.value <= 0.0) {
                     tracker.value = 0.0;
                     tracker.state = 'idle';
                 }
              }

              audioVisualOpacity = Math.max(0, Math.min(1, tracker.value));
              if (layer.audioMapping.target === 'opacity') {
                  audioIsActive = audioVisualOpacity > 0.01;
              } else {
                  audioIsActive = tracker.value > 0.01;
                  audioVisualOpacity = 1.0; 
              }
              audioIntensity = Math.max(0, Math.min(1, tracker.value));
          } else {
              // Classical Fast Mode
              if (intensity >= layer.audioMapping.threshold) {
                 const cooldown = layer.audioMapping.cooldownMs ?? 50;
                 if (now - tracker.lastTriggerTime > cooldown) {
                    tracker.lastTriggerTime = now;
                 }
              }
              const isRawTriggered = (now - tracker.lastTriggerTime) < 50; 
              const targetVal = isRawTriggered ? 1.0 : intensity;
              const smoothing = layer.audioMapping.smoothing !== undefined ? layer.audioMapping.smoothing : 0.8;
              tracker.value = tracker.value + (targetVal - tracker.value) * (1.0 - smoothing);

              audioIsActive = tracker.value > layer.audioMapping.threshold || isRawTriggered;
              
              if (layer.audioMapping.target === 'opacity') {
                  audioVisualOpacity = Math.max(0, Math.min(1, tracker.value));
                  audioIsActive = audioVisualOpacity > 0.01;
              } else {
                  audioVisualOpacity = 1.0;
              }
              audioIntensity = Math.max(0, Math.min(1, tracker.value));
          }
      }
      let rhythmVisualOpacity = 1.0;
      let rhythmIsActive = false;
      let rhythmTrackerValue = 0.0;
      
      if (layer.rhythmMapping?.enabled) {
          rhythmTrackerValue = computeRhythmMagnitude(layer.rhythmMapping, now);
          rhythmVisualOpacity = rhythmTrackerValue;
          rhythmIsActive = rhythmVisualOpacity > 0.01;
      }

      const hasActiveEffect = layer.mappings.some(m => (m.active || m.manualActive) && !m.isMuted);
      let isVisibleNormally = layer.isVisible;
      if (layer.midiMode) {
          // Advance mode: layer is always visible
          if (layer.videoTriggerMode === 'advance' && layer.type === 'video') {
              isVisibleNormally = true;
          }
          // Rewind mode: always visible
          else if (layer.videoTriggerMode === 'rewind' && layer.type === 'video') {
              isVisibleNormally = true;
          }
          // Frame Accumulator mode: always visible (shows reference frame + accumulated stamps)
          else if (layer.videoTriggerMode === 'frame-accumulator' && layer.type === 'video') {
              isVisibleNormally = true;
          }
          else if (layer.audioMapping?.enabled) isVisibleNormally = audioIsActive;
          else if (layer.rhythmMapping?.enabled) isVisibleNormally = rhythmIsActive;
          else isVisibleNormally = midiIsActive;
      }

      // We still process the layer even if hidden if it has effects that could be drawing something (e.g. generative)
      // or if it's midi-triggered but currently silent, we still need to process its parameters.
      if (!(isVisibleNormally || hasActiveEffect || layer.midiMode)) return;
      if (layer.type !== 'generative' && layer.type !== '3d' && !layer.src && !layer.isLive) return;
      if (layer.type === '3d' && !layer.threeDKind) return;

      let element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null | undefined = null;
      if (layer.type === 'generative' && layer.generativeId && webglRendererRef.current) {
        const def = generativesRef.current.find(g => g.uuid === layer.generativeId);
        if (def) {
          const nowSec = performance.now() / 1000;
          
          let unifiedTriggerValue = 0.0;
          if (layer.audioMapping?.enabled) unifiedTriggerValue = audioVisualOpacity;
          else if (layer.rhythmMapping?.enabled) unifiedTriggerValue = rhythmVisualOpacity;
          else if (layer.midiMode) unifiedTriggerValue = midiVisualOpacity;

          let modifiedSettings = { ...(layer.generativeSettings || {}) };
          if (def.parameters) {
              for (const p of def.parameters) {
                  const baseVal = modifiedSettings[p.name] !== undefined ? modifiedSettings[p.name] : p.default;
                  const pMap = layer.generativeMappings?.find(m => m.id === p.name);
                  
                  let activeMagnitude = 0.0;
                  const isTriggerActive = !!layer.generativeTriggerActive?.[p.name];

                  if (isTriggerActive) {
                      if (pMap?.audioMapping?.enabled) {
                          const trackerId = layer.id + '-' + pMap.id + '-audio';
                          if (!audioTrackersRef.current[trackerId]) {
                            audioTrackersRef.current[trackerId] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
                          }
                          const tracker = audioTrackersRef.current[trackerId];
                          const dt = (now - tracker.lastUpdate) / 1000.0;
                          tracker.lastUpdate = now;

                          const mode = pMap.audioMapping.mode || 'smooth';
                          const pAudioEngine = pMap.audioMapping.engine || 'level';
                          const { intensity, flux } = engine.getBandIntensity(pMap.audioMapping.stemId || '', pMap.audioMapping.freqRange || [20, 20000]);

                          if (pAudioEngine === 'transient') {
                              activeMagnitude = processTransientHit(
                                  intensity,
                                  pMap.audioMapping.sensitivity ?? 0.6,
                                  pMap.audioMapping.decayMs ?? 220,
                                  pMap.audioMapping.cooldownMs ?? 50,
                                  tracker,
                                  dt,
                                  now,
                              );
                          } else if (mode === 'smooth') {
                              const attackSecs = pMap.audioMapping.attack ?? 0.05;
                              const releaseSecs = pMap.audioMapping.release ?? 0.2;

                              if (intensity >= pMap.audioMapping.threshold) tracker.state = 'attack';

                              if (tracker.state === 'attack') {
                                 tracker.value += attackSecs > 0.001 ? (dt / attackSecs) : 1.0;
                                 if (tracker.value >= 1.0) { tracker.value = 1.0; tracker.state = 'release'; }
                              } else {
                                 tracker.state = 'release';
                                 tracker.value -= releaseSecs > 0.001 ? (dt / releaseSecs) : 1.0;
                                 if (tracker.value <= 0.0) { tracker.value = 0.0; tracker.state = 'idle'; }
                              }
                              activeMagnitude = Math.max(0, Math.min(1, tracker.value));
                          } else {
                              if (intensity >= pMap.audioMapping.threshold && (now - tracker.lastTriggerTime > 100)) {
                                 tracker.value = 1.0;
                                 tracker.lastTriggerTime = now;
                              }
                              const decay = pMap.audioMapping.smoothing ?? 0.5;
                              tracker.value *= decay;
                              activeMagnitude = tracker.value;
                          }
                      } else if (pMap?.rhythmMapping?.enabled) {
                          activeMagnitude = computeRhythmMagnitude(pMap.rhythmMapping, now);
                      } else {
                          // Check parameter specific MIDI ADSR envelope
                          const paramKey = `gen-${layer.id}-${p.name}`;
                          const state = triggerStatesRef.current[paramKey];
                          if (state) {
                             const ns = pMap?.noteSettings || DEFAULT_NOTE_SETTINGS;
                             
                             if (ns.useFixedDuration || state.useFixedDuration) {
                                 if (state.activeUntil && Date.now() < state.activeUntil) {
                                     state.currentEnvValue = 1.0;
                                     state.phase = 'sustain';
                                 } else {
                                     state.currentEnvValue = 0.0;
                                     state.phase = 'idle';
                                     state.isDown = false;
                                     state.activeUntil = null;
                                 }
                             } else {
                                 const dt = deltaTime / 1000.0;
                                 const sustain = ns.sustain !== undefined ? ns.sustain : 1.0;
                                 
                                 if (state.phase === 'attack') {
                                    const a = (ns.attack || 0) / 1000.0;
                                    if (a <= 0.001) state.currentEnvValue = 1;
                                    else state.currentEnvValue += dt / a;
                                    if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'decay'; }
                                 } else if (state.phase === 'decay') {
                                    const d = (ns.decay || 0) / 1000.0;
                                    if (d <= 0.001) state.currentEnvValue = sustain;
                                    else state.currentEnvValue -= dt * (1 - sustain) / d;
                                    if (state.currentEnvValue <= sustain) { state.currentEnvValue = sustain; state.phase = 'sustain'; }
                                 } else if (state.phase === 'sustain') {
                                    state.currentEnvValue = sustain;
                                 } else if (state.phase === 'release') {
                                    const r = (ns.release || 0) / 1000.0;
                                    if (r <= 0.001) state.currentEnvValue = 0;
                                    else state.currentEnvValue -= dt / r;
                                    if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
                                 }
                             }
                             activeMagnitude = state.currentEnvValue * (state.velocity / 127);
                          } else {
                             activeMagnitude = unifiedTriggerValue;
                          }
                      }
                  }
                  
                  let targetVal = baseVal;
                  if (isTriggerActive && p.type !== 'action') {
                      const amount = layer.generativeTriggerAmount?.[p.name] ?? 0;
                      const range = (p.max ?? 1) - (p.min ?? 0);
                      targetVal = Math.max(p.min ?? 0, Math.min(p.max ?? 1, baseVal + amount * range * activeMagnitude));
                  }
                  
                  let finalVal;
                  if (p.type === 'action') {
                      const actionKey = `action-${layer.id}-${p.name}`;
                      if (!actionTriggerStateRef.current[actionKey]) {
                          actionTriggerStateRef.current[actionKey] = { lastTriggered: 0, count: 0, prevActive: false };
                      }
                      const aState = actionTriggerStateRef.current[actionKey];
                      const isFired = isTriggerActive && activeMagnitude > 0.15;
                      if (isFired && !aState.prevActive) {
                          aState.count += 1;
                          aState.lastTriggered = performance.now();
                      }
                      aState.prevActive = isFired;
                      finalVal = Number(baseVal || 0) + aState.count;
                  } else if (p.type === 'boolean') {
                      if (isTriggerActive) {
                          const actionKey = `action-${layer.id}-${p.name}`;
                          if (!actionTriggerStateRef.current[actionKey]) {
                              actionTriggerStateRef.current[actionKey] = { lastTriggered: 0, count: 0, prevActive: false };
                          }
                          const aState = actionTriggerStateRef.current[actionKey];
                          const isFired = activeMagnitude > 0.15;
                          if (isFired && !aState.prevActive) {
                              aState.count += 1;
                              aState.lastTriggered = performance.now();
                          }
                          aState.prevActive = isFired;
                          const baseBool = Number(baseVal) > 0.5;
                          const flipped = aState.count % 2 === 1;
                          finalVal = (flipped ? !baseBool : baseBool) ? 1 : 0;
                      } else {
                          finalVal = baseVal;
                      }
                  } else if (p.type === 'string') {
                      finalVal = baseVal;
                  } else {
                      const easeKey = layer.id + '-' + p.name;
                      const currentEased = parameterEasingRef.current[easeKey] !== undefined ? parameterEasingRef.current[easeKey] : baseVal;
                      finalVal = (currentEased as number) + ((targetVal as number) - (currentEased as number)) * 0.15;
                      parameterEasingRef.current[easeKey] = finalVal;
                  }
                  
                  modifiedSettings[p.name] = finalVal;

                  const knobId = `layer-${layer.id}-param-${p.name}`;
                  const lineEl = document.getElementById(`knob-line-${knobId}`);
                  const circleEl = document.getElementById(`knob-circle-${knobId}`);
                  if (lineEl && circleEl) {
                      const range = p.max - p.min;
                      const pct = ((finalVal - p.min) / range) * 100;
                      const rot = (pct / 100) * 270 - 135;
                      circleEl.style.strokeDashoffset = (251.2 - (pct / 100) * 188.4).toString();
                      lineEl.setAttribute("transform", `rotate(${rot} 50 50)`);
                  }
              }
          }

          // --- Evaluate Palette Cycle Trigger & Resolve Active Layer Colors ---
          const rawColors = layer.generativeColors || {};
          const lockedMap = layer.generativeLockedColors || {};
          const defaultPalId = (def.elements && def.elements.length <= 2)
              ? (def.color === 'white' ? 'monochrome_duo_white' : 'monochrome_duo')
              : (def.color === 'white' ? 'crimson_slate' : 'monochrome_duo');
          const activePalId = layer.generativeActivePaletteId || defaultPalId;
          const activePalette = BUILTIN_PALETTES.find(p => p.id === activePalId) || BUILTIN_PALETTES[0];
          const isPalTriggerActive = !!layer.generativeTriggerActive?.['palette_cycle'];
          const palKey = `pal-cycle-${layer.id}`;
          if (!actionTriggerStateRef.current[palKey]) {
              actionTriggerStateRef.current[palKey] = { lastTriggered: 0, count: 0, prevActive: false };
          }
          const palState = actionTriggerStateRef.current[palKey];

          if (isPalTriggerActive) {
              const palMapping = layer.generativeMappings?.find(m => m.id === 'palette_cycle');
              let palMagnitude = 0;
              
              if (palMapping?.audioMapping?.enabled) {
                  const trackerId = layer.id + '-palette_cycle-audio';
                  if (!audioTrackersRef.current[trackerId]) {
                    audioTrackersRef.current[trackerId] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
                  }
                  const tracker = audioTrackersRef.current[trackerId];
                  const dt = (now - tracker.lastUpdate) / 1000.0;
                  tracker.lastUpdate = now;
                  const { intensity, flux } = engine.getBandIntensity(palMapping.audioMapping.stemId || '', palMapping.audioMapping.freqRange || [20, 20000]);
                  if ((palMapping.audioMapping.engine || 'level') === 'transient') {
                      palMagnitude = processTransientHit(
                          intensity,
                          palMapping.audioMapping.sensitivity ?? 0.6,
                          palMapping.audioMapping.decayMs ?? 220,
                          Math.max(120, palMapping.audioMapping.cooldownMs ?? 120),
                          tracker,
                          dt,
                          now,
                      );
                  } else {
                      if (intensity >= palMapping.audioMapping.threshold && (now - tracker.lastTriggerTime > 120)) {
                          tracker.value = 1.0;
                          tracker.lastTriggerTime = now;
                      }
                      tracker.value *= (palMapping.audioMapping.smoothing ?? 0.5);
                      palMagnitude = tracker.value;
                  }
              } else if (palMapping?.rhythmMapping?.enabled) {
                  palMagnitude = computeRhythmMagnitude(palMapping.rhythmMapping, now);
              } else {
                  const triggerKey = `gen-${layer.id}-palette_cycle`;
                  const state = triggerStatesRef.current[triggerKey];
                  if (state) {
                      const ns = palMapping?.noteSettings || DEFAULT_NOTE_SETTINGS;
                      if (ns.useFixedDuration || state.useFixedDuration) {
                          if (state.activeUntil && Date.now() < state.activeUntil) {
                              state.currentEnvValue = 1.0;
                              state.phase = 'sustain';
                          } else {
                              state.currentEnvValue = 0.0;
                              state.phase = 'idle';
                              state.isDown = false;
                          }
                      } else {
                          if (state.phase === 'attack') {
                              state.currentEnvValue = 1.0;
                              state.phase = 'decay';
                          } else if (state.phase === 'release') {
                              state.currentEnvValue = 0.0;
                              state.phase = 'idle';
                          }
                      }
                      palMagnitude = state.isDown || state.currentEnvValue > 0.1 ? 1.0 : 0.0;
                  } else {
                      palMagnitude = unifiedTriggerValue;
                  }
              }

              const isFired = palMagnitude > 0.15;
              if (isFired && !palState.prevActive) {
                  palState.count += 1;
                  palState.lastTriggered = performance.now();
              }
              palState.prevActive = isFired;
          }

          const elementsList: GenerativeElement[] = def.elements || [
              { id: "background", name: "Background", defaultColor: def.color === 'white' ? "#ffffff" : "#000000" },
              { id: "foreground", name: "Foreground", defaultColor: def.color === 'white' ? "#000000" : "#ffffff" }
          ];

          const totalCycle = ((layer.generativeColorCycleIndex ?? 0) + palState.count);
          const resolvedGenerativeColors: Record<string, string> = { ...rawColors };

          elementsList.forEach((el, idx) => {
              if (lockedMap[el.id]) {
                  resolvedGenerativeColors[el.id] = rawColors[el.id] || el.defaultColor;
              } else if (palState.count > 0) {
                  resolvedGenerativeColors[el.id] = activePalette.colors[(idx + totalCycle) % activePalette.colors.length];
              } else {
                  resolvedGenerativeColors[el.id] = rawColors[el.id] || (activePalette ? activePalette.colors[idx % activePalette.colors.length] : el.defaultColor);
              }
          });

          // Using targetW and targetH for exact resolution without stretching
          if (def.uuid === 'waves-canvas-gen-1') {
              if (!wavesNoiseRef.current) wavesNoiseRef.current = createNoise2D();
              if (!wavesCanvasRef.current[layer.id]) wavesCanvasRef.current[layer.id] = document.createElement('canvas');
              
              const canvas = wavesCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const waveBg = resolvedGenerativeColors['background'] || '#000000';
              if (!isTransparentColor(waveBg)) {
                  ctx.fillStyle = waveBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              ctx.strokeStyle = resolvedGenerativeColors['waves'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              
              const { speed, freq, amp, lines, thickness } = modifiedSettings;
              const lineThickness = thickness ?? 2.2;
              ctx.lineWidth = lineThickness;
              ctx.lineJoin = 'round';
              
              const W = targetW;
              const H = targetH;
              const spacing = W / lines;
              const Y_GAP = 6;
              const totalY = Math.ceil((H + 40) / Y_GAP);
              const yStart = (H - Y_GAP * totalY) / 2;
              
              const freqX = freq * 0.0008;
              const freqY = freq * 0.0005;
              const tX = nowSec * 1000 * 0.008 * (speed / 5);
              const tY = nowSec * 1000 * 0.003 * (speed / 5);
              
              const noise2D = wavesNoiseRef.current;
              
              ctx.beginPath();
              for (let i = 0; i <= lines; i++) {
                 const bx = spacing * i;
                 let isFirst = true;
                 for (let j = 0; j < totalY; j++) {
                     const by = yStart + Y_GAP * j;
                     const n = noise2D((bx + tX * 40) * freqX, (by + tY * 40) * freqY) * 8; 
                     const wx = Math.cos(n) * amp * 0.85;
                     const wy = Math.sin(n) * amp * 0.42;
                     
                     if (isFirst) {
                         ctx.moveTo(bx + wx, by + wy);
                         isFirst = false;
                     } else {
                         ctx.lineTo(bx + wx, by + wy);
                     }
                 }
              }
              ctx.stroke();
              element = canvas;
          } else if (def.uuid === 'topography-canvas-gen-1') {
              if (!topographyCanvasRef.current[layer.id]) topographyCanvasRef.current[layer.id] = document.createElement('canvas');
              
              const canvas = topographyCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const topoBg = resolvedGenerativeColors['background'] || '#000000';
              const topoFg = resolvedGenerativeColors['contours'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              if (!isTransparentColor(topoBg)) {
                  ctx.fillStyle = topoBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, freq, amp, lines, thickness } = modifiedSettings;
              const lineThickness = thickness ?? 2.2;
              const W = targetW;
              const H = targetH;
              const XSTEP = 3;
              
              const t = nowSec * 1000;
              const rows: {x: number, baseY: number}[][] = [];
              const yStart = H * 0.42;
              const yEnd = H;
              
              for (let i = 0; i < lines; i++) {
                const by = yStart + (yEnd - yStart) * (i / Math.max(1, lines - 1));
                const nx = Math.ceil(W / XSTEP) + 2;
                const pts: {x: number, baseY: number}[] = [];
                for (let j = 0; j <= nx; j++) pts.push({ x: j * XSTEP, baseY: by });
                rows.push(pts);
              }
              
              const getY = (pt: {x: number, baseY: number}, t: number) => {
                const f = freq;
                const s = speed / 5;
                const nx = pt.x / W;
                const detail = fbm(pt.x * 0.004 * f + t * 0.00003 * s, pt.baseY * 0.005 * f, 5);
                const env = fbm(nx * 1.8 + 0.3 + t * 0.0002 * s, pt.baseY * 0.002 + 7.4, 2);
                const mountain = Math.pow(Math.max(0, env + 0.4), 2.2);
                const rowT = (pt.baseY - H * 0.42) / (H * 0.58);
                const peakScale = Math.pow(1.0 - rowT, 0.6);
                return pt.baseY - Math.abs(detail) * amp * 0.25 - mountain * amp * peakScale;
              };
              
              for (let i = 0; i < rows.length; i++) {
                const pts = rows[i];
                const ys = pts.map(p => getY(p, t));
                
                ctx.beginPath();
                ctx.moveTo(-10, H + 10);
                ctx.lineTo(pts[0].x, ys[0]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, ys[j]);
                ctx.lineTo(W + 10, H + 10);
                ctx.closePath();
                if (!isTransparentColor(topoBg)) {
                    ctx.fillStyle = topoBg;
                    ctx.fill();
                }
                
                ctx.beginPath();
                ctx.moveTo(pts[0].x, ys[0]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, ys[j]);
                ctx.strokeStyle = topoFg;
                ctx.lineWidth = lineThickness;
                ctx.stroke();
              }
              
              element = canvas;
                    } else if (def.uuid === 'dragon-text-mask-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);

              const dtmBg = resolvedGenerativeColors['background'] || '#000000';
              const dtmFg = resolvedGenerativeColors['dragon'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              const dtmAccent = resolvedGenerativeColors['accent'] || dtmFg;
              const dtmBgOpaque = !isTransparentColor(dtmBg);

              const { speed: dtmSpeed, font_size: dtmFs, glyph_size: dtmGlyphSize, invert: dtmInvert,
                      line_gap: dtmLineGap, wander: dtmWander, reach: dtmReach, edge_glow: dtmEdgeGlow,
                      glyph: dtmGlyphRaw, text_content: dtmTextRaw } = modifiedSettings;

              const invertOn = (dtmInvert ?? 0) > 0.5;
              const paperColor = (invertOn && dtmBgOpaque) ? dtmFg : dtmBg;
              const inkColor = (invertOn && dtmBgOpaque) ? dtmBg : dtmFg;

              const fs = Math.max(6, (dtmFs ?? 20) * (Math.min(targetW, targetH) / 620));
              const lineGap = fs * (dtmLineGap ?? 1.15);
              const glyphStr = (typeof dtmGlyphRaw === 'string' && dtmGlyphRaw.trim() !== '')
                  ? Array.from(dtmGlyphRaw.trim())[0]
                  : ((def.parameters.find(p => p.name === 'glyph')?.default as string) || 'A');
              const bodyStr = (typeof dtmTextRaw === 'string' && dtmTextRaw.trim() !== '')
                  ? dtmTextRaw : ((def.parameters.find(p => p.name === 'text_content')?.default as string) || 'Text ');

              // --- Real paragraph layout via Pretext (chenglou/pretext), wrapped around a
              // drop-cap column exactly like the library's own "flow text around a floated
              // image" recipe -- no manual char-grid guessing.
              const dtmSt = (dragonTextStateRef.current[layer.id] ||= { coilStart: -99, fireStart: -99, lastCoil: 0, lastFire: 0, fireHeadX: 0, fireHeadY: 0, layout: null });

              const marginX = targetW * 0.07;
              const marginY = targetH * 0.08;
              const maxWidth = Math.max(40, targetW - marginX * 2);
              const fontStr = `500 ${fs.toFixed(1)}px Georgia, 'Times New Roman', serif`;
              const dropFs = fs * 2.6 * Math.max(0.4, dtmGlyphSize ?? 1.05);
              const dropFontStr = `900 ${dropFs.toFixed(1)}px Georgia, 'Times New Roman', serif`;
              const cacheKey = `${bodyStr}|${glyphStr}|${fs.toFixed(1)}|${lineGap.toFixed(1)}|${maxWidth.toFixed(0)}`;

              let dtmLay = dtmSt.layout;
              if (!dtmLay || dtmLay.key !== cacheKey) {
                  ctx.font = dropFontStr;
                  const dropCapWidth = ctx.measureText(glyphStr).width + fs * 0.4;
                  const dropCapLines = Math.max(1, Math.round((dropFs * 1.05) / lineGap));

                  ctx.font = fontStr;
                  const prepared = prepareWithSegments(bodyStr, fontStr);
                  const lines: { text: string; chars: string[]; charX: number[]; indent: number }[] = [];
                  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
                  let li = 0;
                  while (lines.length < 500) {
                      const w = li < dropCapLines ? Math.max(20, maxWidth - dropCapWidth) : maxWidth;
                      const range = layoutNextLineRange(prepared, cursor, w);
                      if (range === null) break;
                      const lm = materializeLineRange(prepared, range);
                      const chars = Array.from(lm.text);
                      const charX: number[] = [0];
                      let acc = 0;
                      for (const ch of chars) { acc += ctx.measureText(ch).width; charX.push(acc); }
                      lines.push({ text: lm.text, chars, charX, indent: li < dropCapLines ? dropCapWidth : 0 });
                      cursor = range.end;
                      li++;
                  }
                  dtmLay = { key: cacheKey, lines, dropCapWidth, dropCapLines };
                  dtmSt.layout = dtmLay;
              }
              const dtmLines = dtmLay.lines as { text: string; chars: string[]; charX: number[]; indent: number }[];

              const blockH = Math.max(lineGap, dtmLines.length * lineGap);
              const blockCx = marginX + maxWidth / 2;
              const blockCy = marginY + blockH / 2;
              const halfW = maxWidth / 2, halfH = blockH / 2;

              // --- Coil action: winds the dragon's glide into a tight spiral for a beat
              const coilCount = Number(modifiedSettings.coil ?? 0);
              if (coilCount > dtmSt.lastCoil) { dtmSt.lastCoil = coilCount; dtmSt.coilStart = nowSec; }
              const coilDur = 1.6;
              const coilT = nowSec - dtmSt.coilStart;
              const coilActive = coilT >= 0 && coilT < coilDur;
              const coilEnv = coilActive ? Math.sin(Math.PI * Math.min(1, coilT / coilDur)) : 0;

              const t = nowSec * (dtmSpeed ?? 1.4);
              const wanderAmt = dtmWander ?? 0.55;
              const freqX = 0.55 + coilEnv * 2.4;
              const freqY = 0.34 * 0.87 + coilEnv * 1.6;
              const radX = halfW * (0.42 + wanderAmt * 0.5) * (1 - coilEnv * 0.55);
              const radY = halfH * (0.4 + wanderAmt * 0.45) * (1 - coilEnv * 0.55);
              const pathPoint = (tt: number) => ({
                  x: blockCx + Math.sin(tt * freqX) * radX,
                  y: blockCy + Math.sin(tt * freqY + 1.3) * radY,
              });

              const segCount = 16;
              const bodyDelay = 0.24;
              const spine: { x: number; y: number }[] = [];
              for (let k = 0; k < segCount; k++) spine.push(pathPoint(t - k * bodyDelay));
              const maxR = fs * 0.95;

              // --- Breathe Fire action: a radial shockwave from the dragon's current head
              const fireCount = Number(modifiedSettings.breathe_fire ?? 0);
              if (fireCount > dtmSt.lastFire) { dtmSt.lastFire = fireCount; dtmSt.fireStart = nowSec; dtmSt.fireHeadX = spine[0].x; dtmSt.fireHeadY = spine[0].y; }
              const fireDur = 0.85;
              const fireT = nowSec - dtmSt.fireStart;
              const fireActive = fireT >= 0 && fireT < fireDur;
              const fireProgress = fireActive ? fireT / fireDur : 1;
              const fireStrength = fireActive ? (1 - fireProgress) : 0;
              const reachPx = Math.max(4, dtmReach ?? 90);
              const fireRadius = reachPx * 2.2 * fireProgress;

              // 1. Paper
              if (dtmBgOpaque) { ctx.fillStyle = paperColor; ctx.fillRect(0, 0, targetW, targetH); }

              // 2. The dragon, gliding beneath the text
              ctx.save();
              if ((dtmEdgeGlow ?? 0) > 0.02) {
                  ctx.strokeStyle = dtmAccent;
                  ctx.lineCap = 'round';
                  ctx.globalAlpha = 0.16 * (dtmEdgeGlow ?? 0);
                  for (let pass = 0; pass < 3; pass++) {
                      ctx.lineWidth = maxR * 2.2 + pass * (10 + coilEnv * 6);
                      ctx.beginPath();
                      ctx.moveTo(spine[0].x, spine[0].y);
                      for (let k = 1; k < spine.length; k++) ctx.lineTo(spine[k].x, spine[k].y);
                      ctx.stroke();
                  }
              }
              ctx.globalAlpha = 1;
              ctx.strokeStyle = dtmAccent;
              ctx.lineCap = 'round';
              for (let k = 0; k < spine.length - 1; k++) {
                  const r0 = Math.max(1, maxR * Math.pow(1 - k / (segCount - 1), 0.6));
                  ctx.lineWidth = r0 * 2;
                  ctx.beginPath();
                  ctx.moveTo(spine[k].x, spine[k].y);
                  ctx.lineTo(spine[k + 1].x, spine[k + 1].y);
                  ctx.stroke();
              }
              const hnx = spine[0].x - spine[1].x, hny = spine[0].y - spine[1].y;
              const hl = Math.hypot(hnx, hny) || 1;
              const dxh = hnx / hl, dyh = hny / hl, px = -dyh, py = dxh;
              const headLen = maxR * 2.6, headW = maxR * 1.7;
              ctx.fillStyle = dtmAccent;
              ctx.beginPath();
              ctx.moveTo(spine[0].x + dxh * headLen, spine[0].y + dyh * headLen);
              ctx.lineTo(spine[0].x + px * headW, spine[0].y + py * headW);
              ctx.lineTo(spine[0].x - px * headW, spine[0].y - py * headW);
              ctx.closePath();
              ctx.fill();
              ctx.restore();

              // 3. Illuminated drop cap
              ctx.save();
              ctx.font = dropFontStr;
              ctx.fillStyle = inkColor;
              ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
              const dropBaseX = marginX, dropBaseY = marginY + dropFs * 0.82;
              if ((dtmEdgeGlow ?? 0) > 0.01) {
                  ctx.strokeStyle = dtmAccent;
                  ctx.lineWidth = Math.max(1, dropFs * 0.025);
                  ctx.globalAlpha = 0.4 + 0.4 * (dtmEdgeGlow ?? 0);
                  ctx.strokeText(glyphStr, dropBaseX, dropBaseY);
                  ctx.globalAlpha = 1;
              }
              ctx.fillText(glyphStr, dropBaseX, dropBaseY);
              ctx.restore();

              // 4. Paragraph text, each glyph nudged away from the dragon's body / fireball
              ctx.save();
              ctx.font = fontStr;
              ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
              for (let li = 0; li < dtmLines.length; li++) {
                  const line = dtmLines[li];
                  const baseY = marginY + fs * 0.9 + li * lineGap;
                  for (let ci = 0; ci < line.chars.length; ci++) {
                      const ch = line.chars[ci];
                      if (ch === ' ') continue;
                      const baseX = marginX + line.indent + line.charX[ci];

                      let bestD = Infinity, bestX = baseX, bestY = baseY;
                      for (const sp of spine) {
                          const dx = baseX - sp.x, dy = baseY - sp.y;
                          const d = dx * dx + dy * dy;
                          if (d < bestD) { bestD = d; bestX = sp.x; bestY = sp.y; }
                      }
                      const dist = Math.sqrt(bestD);
                      let offX = 0, offY = 0, alphaMul = 1;
                      if (dist < reachPx) {
                          const push = 1 - dist / reachPx;
                          const nx = dist > 0.01 ? (baseX - bestX) / dist : 1, ny = dist > 0.01 ? (baseY - bestY) / dist : 0;
                          const mag = push * push * reachPx * 0.55;
                          offX += nx * mag; offY += ny * mag;
                          alphaMul = 0.35 + 0.65 * (1 - push * 0.7);
                      }
                      if (fireActive) {
                          const fdx = baseX - dtmSt.fireHeadX, fdy = baseY - dtmSt.fireHeadY;
                          const fd = Math.sqrt(fdx * fdx + fdy * fdy) || 0.001;
                          if (fd < fireRadius + reachPx) {
                              const ring = Math.max(0, 1 - Math.abs(fd - fireRadius) / (reachPx * 1.4));
                              const fmag = ring * fireStrength * reachPx * 1.6;
                              offX += (fdx / fd) * fmag; offY += (fdy / fd) * fmag;
                              alphaMul = Math.min(alphaMul, 0.4 + 0.6 * (1 - fireStrength));
                          }
                      }
                      ctx.globalAlpha = alphaMul;
                      ctx.fillStyle = inkColor;
                      ctx.fillText(ch, baseX + offX, baseY + offY);
                  }
              }
              ctx.restore();

              element = canvas;
            } else if (def.uuid === 'terrain-lines-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const terrainBg = resolvedGenerativeColors['background'] || '#050a05';
              const terrainFg = resolvedGenerativeColors['terrain_lines'] || resolvedGenerativeColors['foreground'] || '#00ff41';
              const bgRgb = hexToRgb(terrainBg);
              const fgRgb = hexToRgb(terrainFg);
              if (!isTransparentColor(terrainBg)) {
                  ctx.fillStyle = terrainBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              if (!terrainNoiseRef.current) terrainNoiseRef.current = createNoise2D();
              const noise2D = terrainNoiseRef.current;
              
              const { speed, amplitude, density, ruggedness, thickness } = modifiedSettings;
              const spd = speed ?? 0.8;
              const amp = amplitude ?? 140.0;
              const dens = density ?? 1.2;
              const rugg = ruggedness ?? 1.8;
              const lineThickness = thickness ?? 1.5;
              
              const t = nowSec * spd;
              const gridW = Math.round(38 * dens);
              const gridH = Math.round(38 * dens);
              const step = 20 / dens;
              
              const totalExtentX = gridW * step;
              const totalExtentY = gridH * step;
              
              // Mountain Massif Envelopes (Two distinct Alpine mountain groups separated by a valley pass)
              const massif1X = -totalExtentX * 0.22 + Math.sin(t * 0.25) * (totalExtentX * 0.03);
              const massif1Y = -totalExtentY * 0.16 + Math.cos(t * 0.22) * (totalExtentY * 0.03);
              const massif1Width = totalExtentX * 0.26;
              const massif1Height = totalExtentY * 0.24;
              
              const massif2X = totalExtentX * 0.22 + Math.cos(t * 0.28) * (totalExtentX * 0.03);
              const massif2Y = totalExtentY * 0.18 + Math.sin(t * 0.24) * (totalExtentY * 0.03);
              const massif2Width = totalExtentX * 0.25;
              const massif2Height = totalExtentY * 0.23;
              
              const getElevation = (x: number, y: number) => {
                  // 1. Massif Footprint Envelopes
                  const dx1 = (x - massif1X) / massif1Width;
                  const dy1 = (y - massif1Y) / massif1Height;
                  const dSq1 = dx1 * dx1 + dy1 * dy1;
                  const env1 = Math.exp(-0.5 * dSq1 * dSq1);
                  
                  const dx2 = (x - massif2X) / massif2Width;
                  const dy2 = (y - massif2Y) / massif2Height;
                  const dSq2 = dx2 * dx2 + dy2 * dy2;
                  const env2 = Math.exp(-0.5 * dSq2 * dSq2);
                  
                  const env = Math.max(env1 * 1.0, env2 * 0.90);
                  if (env < 0.005) return 0.0;
                  
                  // 2. Multi-Octave Ridged Fractal Noise for Multiple Clustered Mountain Peaks
                  const fx = x * 0.0085;
                  const fy = y * 0.0085;
                  const timeDrift = t * 0.08;
                  
                  // Octave 1: Major mountain spines & peaks
                  const n1 = noise2D(fx + timeDrift, fy + timeDrift * 0.5);
                  const r1 = 1.0 - Math.abs(n1);
                  
                  // Octave 2: Secondary clustered peaks, arêtes, and cols
                  const n2 = noise2D(fx * 2.15 + 17.3, fy * 2.15 + 43.7);
                  const r2 = 1.0 - Math.abs(n2);
                  
                  // Octave 3: Jagged rock facets and cliffs
                  const n3 = noise2D(fx * 4.6 + 89.1, fy * 4.6 + 131.5);
                  const r3 = 1.0 - Math.abs(n3);
                  
                  // Octave 4: Fine crag details
                  const n4 = noise2D(fx * 9.8 + 211.9, fy * 9.8 + 307.3);
                  const r4 = 1.0 - Math.abs(n4);
                  
                  const compositeNoise = (r1 * 0.48 + r2 * 0.28 + r3 * 0.16 + r4 * 0.08);
                  const ridgedElevation = Math.pow(compositeNoise, rugg * 0.9);
                  return env * ridgedElevation;
              };
              
              const viewScale = Math.min(targetW, targetH) / 720;
              const iso = (x: number, y: number, z: number) => {
                  const angle = Math.PI / 6;
                  const cosA = Math.cos(angle);
                  const sinA = Math.sin(angle);
                  return {
                      x: targetW / 2 + (x - y) * cosA * viewScale,
                      y: targetH / 2 + 70 * viewScale + (x + y) * sinA * 0.65 * viewScale - z * viewScale
                  };
              };

              // Elevation → multicolour ramp (deep blue valleys → green → gold → coral → white peaks)
              const rampStops = [
                  { p: 0.0,  c: [bgRgb.r, bgRgb.g, bgRgb.b] },
                  { p: 0.16, c: [26, 60, 120] },
                  { p: 0.38, c: [30, 170, 110] },
                  { p: 0.58, c: [225, 200, 70] },
                  { p: 0.78, c: [235, 110, 90] },
                  { p: 1.0,  c: [255, 255, 255] },
              ];
              const getColorForHeight = (hNorm: number) => {
                  const v = Math.max(0, Math.min(1, hNorm));
                  let a = rampStops[0], b = rampStops[rampStops.length - 1];
                  for (let i = 0; i < rampStops.length - 1; i++) {
                      if (v >= rampStops[i].p && v <= rampStops[i + 1].p) { a = rampStops[i]; b = rampStops[i + 1]; break; }
                  }
                  const f = b.p > a.p ? (v - a.p) / (b.p - a.p) : 0;
                  const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * f);
                  const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * f);
                  const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * f);
                  return `rgb(${r}, ${g}, ${bl})`;
              };
              void fgRgb;
              
              ctx.lineWidth = lineThickness;
              ctx.lineCap = 'square';
              ctx.lineJoin = 'miter';
              
              // 1. Draw horizontal terrain rows
              for (let yi = -gridH; yi <= gridH; yi++) {
                  for (let xi = -gridW; xi < gridW; xi++) {
                      const x1 = xi * step;
                      const y1 = yi * step;
                      const h1 = getElevation(x1, y1);
                      const p1 = iso(x1, y1, h1 * amp);
                      
                      const x2 = (xi + 1) * step;
                      const y2 = yi * step;
                      const h2 = getElevation(x2, y2);
                      const p2 = iso(x2, y2, h2 * amp);
                      
                      const avgH = (h1 + h2) * 0.5;
                      ctx.strokeStyle = getColorForHeight(avgH);
                      
                      ctx.beginPath();
                      ctx.moveTo(p1.x, p1.y);
                      ctx.lineTo(p2.x, p2.y);
                      ctx.stroke();
                  }
              }
              
              // 2. Draw longitudinal terrain columns for 3D wireframe mesh
              for (let xi = -gridW; xi <= gridW; xi++) {
                  for (let yi = -gridH; yi < gridH; yi++) {
                      const x1 = xi * step;
                      const y1 = yi * step;
                      const h1 = getElevation(x1, y1);
                      const p1 = iso(x1, y1, h1 * amp);
                      
                      const x2 = xi * step;
                      const y2 = (yi + 1) * step;
                      const h2 = getElevation(x2, y2);
                      const p2 = iso(x2, y2, h2 * amp);
                      
                      const avgH = (h1 + h2) * 0.5;
                      ctx.strokeStyle = getColorForHeight(avgH);
                      
                      ctx.beginPath();
                      ctx.moveTo(p1.x, p1.y);
                      ctx.lineTo(p2.x, p2.y);
                      ctx.stroke();
                  }
              }
              
              element = canvas;
          } else if (def.uuid === 'squares-noise-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const sqBg = resolvedGenerativeColors['background'] || '#000000';
              const sqFg = resolvedGenerativeColors['squares'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              const sqFgRgb = hexToRgb(sqFg);
              if (!isTransparentColor(sqBg)) {
                  ctx.fillStyle = sqBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, count, size, spacing, movement, rotation, delay } = modifiedSettings;
              const spd = speed ?? 1.0;
              const num = Math.max(3, Math.min(60, Math.floor(count ?? 22)));
              const sqScale = Math.min(targetW, targetH) / 560;
              const sz = (size ?? 130.0) * sqScale;
              const spc = (spacing ?? 32.0) * sqScale;
              const mov = (movement ?? 15.0) * sqScale;
              const rot = rotation ?? 0.0;
              const dly = delay ?? 0.05;
              const t = nowSec * spd;

              const angle = Math.PI / 6;
              const cosA = Math.cos(angle);
              const sinA = Math.sin(angle);

              const iso = (x: number, y: number, z: number) => ({
                 x: targetW / 2 + (x - y) * cosA,
                 y: targetH / 2 + (x + y) * sinA - z
              });
              
              interface SquareItem {
                 depth: number;
                 ptsOuter: { x: number; y: number }[];
                 ptsInner?: { x: number; y: number }[];
                 hasInner: boolean;
                 alpha: number;
                 stipples: { x: number; y: number }[];
              }
              
              const squares: SquareItem[] = [];
              const half = (num - 1) / 2;
              
              for (let i = 0; i < num; i++) {
                 const u = half > 0 ? (i - half) / half : 0; // -1 (left) to +1 (right)
                 
                 // Bell curve size profile: middle squares significantly larger than outer ones
                 const profile = Math.cos(u * Math.PI * 0.46);
                 const baseRadius = sz * (0.2 + 0.8 * Math.pow(Math.max(0, profile), 1.3));
                 
                 // Left-to-right phase delay: ones on the left (smaller i) react/rotate first!
                 const wavePhase = t * 2.0 - i * (dly * 3.0);
                 
                 // Size increases slightly with wave motion
                 const sizePulse = 1.0 + Math.sin(wavePhase) * 0.12 * (mov / 15.0);
                 const r = baseRadius * sizePulse;
                 
                 // Small left-to-right drift movement
                 const driftX = Math.sin(wavePhase * 0.7) * (mov * 0.8);
                 const driftY = Math.cos(wavePhase * 0.7) * (mov * 0.3);
                 
                 // Rotation across main axis with progressive left-to-right delay
                 const rotWave = Math.sin(t * 1.5 - i * (dly * 3.5)) * (0.4 + rot * 0.3);
                 const curRot = rot + rotWave;
                 
                 // Axis coordinate
                 const distAlongAxis = (i - half) * spc;
                 const axisX = distAlongAxis + driftX;
                 const axisY = -distAlongAxis * 0.3 + driftY;
                 const axisZ = distAlongAxis * 0.45;
                 
                 // Local square corners rotated by curRot
                 const localCorners = [
                    { u: -r, v: -r },
                    { u: r, v: -r },
                    { u: r, v: r },
                    { u: -r, v: r }
                 ];
                 
                 const cosR = Math.cos(curRot);
                 const sinR = Math.sin(curRot);
                 
                 const ptsOuter = localCorners.map(c => {
                    const ru = c.u * cosR - c.v * sinR;
                    const rv = c.u * sinR + c.v * cosR;
                    const x3d = axisX + ru * 0.8;
                    const y3d = axisY + ru * 0.5;
                    const z3d = axisZ + rv;
                    return iso(x3d, y3d, z3d);
                 });
                 
                 const hasInner = (i % 2 === 0 || profile > 0.6);
                 let ptsInner: { x: number; y: number }[] | undefined;
                 if (hasInner) {
                    const rIn = r * 0.65;
                    const localIn = [
                       { u: -rIn, v: -rIn },
                       { u: rIn, v: -rIn },
                       { u: rIn, v: rIn },
                       { u: -rIn, v: rIn }
                    ];
                    ptsInner = localIn.map(c => {
                       const ru = c.u * cosR - c.v * sinR;
                       const rv = c.u * sinR + c.v * cosR;
                       const x3d = axisX + ru * 0.8;
                       const y3d = axisY + ru * 0.5;
                       const z3d = axisZ + rv;
                       return iso(x3d, y3d, z3d);
                    });
                 }
                 
                 // Depth sorting key
                 const depth = axisX - axisY * 0.5 + axisZ;
                 
                 // Dynamic stippled edge points
                 const stipples: { x: number; y: number }[] = [];
                 const numDots = Math.floor(18 + profile * 35);
                 for (let d = 0; d < numDots; d++) {
                    const edgeIdx = d % 4;
                    const edgeNext = (edgeIdx + 1) % 4;
                    const tEdge = ((d * 17) % 100) / 100;
                    const pA = ptsOuter[edgeIdx];
                    const pB = ptsOuter[edgeNext];
                    const dotX = pA.x + (pB.x - pA.x) * tEdge + Math.sin(d * 9.1 + t) * 1.5;
                    const dotY = pA.y + (pB.y - pA.y) * tEdge + Math.cos(d * 7.3 + t) * 1.5;
                    stipples.push({ x: dotX, y: dotY });
                 }
                 
                 squares.push({
                    depth,
                    ptsOuter,
                    ptsInner,
                    hasInner,
                    alpha: 0.35 + 0.65 * profile,
                    stipples
                 });
              }
              
              // Sort back to front
              squares.sort((a, b) => a.depth - b.depth);
              
              for (const sq of squares) {
                 // 1. Draw outer stippled frame (bold and visible)
                 ctx.strokeStyle = `rgba(${sqFgRgb.r}, ${sqFgRgb.g}, ${sqFgRgb.b}, ${Math.min(1.0, sq.alpha * 1.15)})`;
                 ctx.lineWidth = 2.4;
                 ctx.setLineDash([4, 2]); // distinct tech dashed frame
                 
                 ctx.beginPath();
                 ctx.moveTo(sq.ptsOuter[0].x, sq.ptsOuter[0].y);
                 for (let k = 1; k < 4; k++) ctx.lineTo(sq.ptsOuter[k].x, sq.ptsOuter[k].y);
                 ctx.closePath();
                 ctx.stroke();
                 
                 // 2. Draw inner nested frame if present
                 if (sq.hasInner && sq.ptsInner) {
                    ctx.strokeStyle = `rgba(${sqFgRgb.r}, ${sqFgRgb.g}, ${sqFgRgb.b}, ${Math.min(1.0, sq.alpha * 0.9)})`;
                    ctx.lineWidth = 1.6;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath();
                    ctx.moveTo(sq.ptsInner[0].x, sq.ptsInner[0].y);
                    for (let k = 1; k < 4; k++) ctx.lineTo(sq.ptsInner[k].x, sq.ptsInner[k].y);
                    ctx.closePath();
                    ctx.stroke();
                 }
                 
                 // 3. Draw edge stipple noise particles
                 ctx.fillStyle = `rgba(${sqFgRgb.r}, ${sqFgRgb.g}, ${sqFgRgb.b}, ${Math.min(1.0, sq.alpha * 0.95)})`;
                 for (const dot of sq.stipples) {
                    ctx.fillRect(dot.x - 1, dot.y - 1, 2, 2);
                 }
                 
                 // 4. Corner dot highlights
                 ctx.fillStyle = `rgba(${sqFgRgb.r}, ${sqFgRgb.g}, ${sqFgRgb.b}, 1.0)`;
                 for (const pt of sq.ptsOuter) {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                 }
              }
              
              ctx.setLineDash([]);
              element = canvas; } else if (def.uuid === 'number-paths-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const numBg = resolvedGenerativeColors['background'] || '#ffffff';
              const numColors = [
                  resolvedGenerativeColors['color_1'] || resolvedGenerativeColors['numbers'] || '#eb556b',
                  resolvedGenerativeColors['color_2'] || '#7599a4',
                  resolvedGenerativeColors['color_3'] || '#f5a6b5',
                  resolvedGenerativeColors['color_4'] || '#233136'
              ];
              if (!isTransparentColor(numBg)) {
                  ctx.fillStyle = numBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, nodes, grid_size, spread, movement, chaos } = modifiedSettings;
              const gs = Math.max(30, Math.min(260, grid_size ?? 45.0)) * (Math.min(targetW, targetH) / 620); // scale to canvas
              const numNodes = Math.max(4, Math.min(60, Math.floor(nodes ?? 16)));
              const spr = spread ?? 0.4;
              const mov = movement ?? 15.0;
              const cha = chaos ?? 0.0;
              const spd = speed ?? 1.0;
              const t = nowSec * spd;
              
              // Draw subtle grid lines
              ctx.strokeStyle = isColorDark(numBg) ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.09)';
              ctx.lineWidth = 1;
              const ox = (targetW / 2) % gs;
              const oy = (targetH / 2) % gs;
              for (let x = ox; x < targetW; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, targetH); ctx.stroke(); }
              for (let y = oy; y < targetH; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(targetW, y); ctx.stroke(); }
              
              interface PathNode {
                 gx: number;
                 gy: number;
                 x: number;
                 y: number;
                 parent: number;
                 color: string;
                 num: number;
              }
              
              const pts: PathNode[] = [];
              const gridSpan = Math.max(3, Math.floor(3 + mov * 0.16));
              
              for (let i = 0; i < numNodes; i++) {
                 // Dynamic time shift along the grid lines
                 const timeShift = t * (0.25 + (i % 4) * 0.08);
                 const rawGx = Math.sin(i * 12.31 + timeShift) * gridSpan;
                 const rawGy = Math.cos(i * 32.17 + timeShift * 0.85) * gridSpan;
                 
                 const gxGrid = Math.round(rawGx);
                 const gyGrid = Math.round(rawGy);
                 
                 // On-grid position
                 const gridX = targetW / 2 + gxGrid * gs;
                 const gridY = targetH / 2 + gyGrid * gs;
                 
                 // Chaotic floating offset (only active when chaos > 0)
                 const continuousFloatX = (targetW / 2 + rawGx * gs) * Math.min(1, cha * 0.5) + gridX * (1.0 - Math.min(1, cha * 0.5));
                 const continuousFloatY = (targetH / 2 + rawGy * gs) * Math.min(1, cha * 0.5) + gridY * (1.0 - Math.min(1, cha * 0.5));
                 
                 const chaoticJitterX = Math.sin(t * 1.5 + i * 2.13) * (mov * 0.4) * cha;
                 const chaoticJitterY = Math.cos(t * 1.2 + i * 2.87) * (mov * 0.4) * cha;
                 
                 const finalX = (cha <= 0.001) ? gridX : (continuousFloatX + chaoticJitterX);
                 const finalY = (cha <= 0.001) ? gridY : (continuousFloatY + chaoticJitterY);
                 
                 // Determine parent for tree branching vs single path
                 let pIdx = i - 1;
                 if (spr > 0.05 && i > 1) {
                    const branchHash = Math.sin(i * 99.73 + 1.23) * 0.5 + 0.5;
                    if (branchHash < spr) {
                       const pick = Math.floor(((Math.sin(i * 37.19 + 4.56) * 0.5 + 0.5) * spr) * (i - 1));
                       pIdx = Math.max(0, Math.min(i - 1, pick));
                    }
                 }
                 
                 const nodeColor = numColors[i % numColors.length];
                 pts.push({
                    gx: gxGrid,
                    gy: gyGrid,
                    x: finalX,
                    y: finalY,
                    parent: pIdx,
                    color: nodeColor,
                    num: i + 1
                 });
              }
              
              // Draw connecting lines (glow underlay + crisp line)
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';

              for (let pass = 0; pass < 2; pass++) {
              for (let i = 1; i < pts.length; i++) {
                 const node = pts[i];
                 const parent = pts[node.parent];
                 if (pass === 0) {
                    ctx.strokeStyle = node.color;
                    ctx.globalAlpha = 0.18;
                    ctx.lineWidth = gs * 0.14;
                 } else {
                    ctx.strokeStyle = node.color;
                    ctx.globalAlpha = 1;
                    ctx.lineWidth = Math.max(2, gs * 0.045);
                 }
                 ctx.beginPath();
                 ctx.moveTo(parent.x, parent.y);
                 
                 // When chaos is 0, routing is strictly Manhattan on the grid lines (horizontal then vertical)
                 if (cha <= 0.2) {
                    ctx.lineTo(node.x, parent.y);
                    ctx.lineTo(node.x, node.y);
                 } else {
                    // With higher chaos, allow direct diagonal/curved connections
                    const useElbow = (Math.sin(i * 31.7) > (cha * 0.5));
                    if (useElbow) {
                       ctx.lineTo(node.x, parent.y);
                       ctx.lineTo(node.x, node.y);
                    } else {
                       ctx.lineTo(node.x, node.y);
                    }
                 }
                 ctx.stroke();
              }
              }
              ctx.globalAlpha = 1;

              // Draw nodes and numbers
              const radius = gs * 0.42;
              ctx.font = `${Math.round(radius * 0.5)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

              for (const p of pts) {
                 ctx.fillStyle = p.color;
                 ctx.beginPath();
                 ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
                 ctx.fill();
                 // ring
                 ctx.strokeStyle = isColorDark(numBg) ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)';
                 ctx.lineWidth = Math.max(1.5, radius * 0.06);
                 ctx.stroke();

                 ctx.fillStyle = isColorDark(p.color) ? '#ffffff' : '#111111';
                 ctx.textAlign = 'center';
                 ctx.textBaseline = 'middle';
                 ctx.fillText(p.num.toString(), p.x, p.y);
                 ctx.textAlign = 'start';
                 ctx.textBaseline = 'alphabetic';
              }

              element = canvas; } else if (def.uuid === 'isometric-buildings-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const bldgBg = resolvedGenerativeColors['background'] || '#ffffff';
              const bldgFg = resolvedGenerativeColors['buildings'] || resolvedGenerativeColors['foreground'] || '#eb556b';
              if (!isTransparentColor(bldgBg)) {
                  ctx.fillStyle = bldgBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, count, size, spacing, max_height, movement, chaos } = modifiedSettings;
              const spd = speed ?? 1.0;
              const n = Math.max(2, Math.min(20, Math.round(count ?? 7)));
              const sz = size ?? 1.0;
              const spc = spacing ?? 2.0;
              const maxH = max_height ?? 220.0;
              const mov = movement ?? 1.0;
              const cha = chaos ?? 1.0;
              const t = nowSec * spd;
              
              const bWidth = 36 * sz;
              const step = bWidth + spc;
              
              const iso = (x: number, y: number, z: number) => {
                 const angle = Math.PI / 6;
                 return {
                    x: targetW / 2 + (x - y) * Math.cos(angle),
                    y: targetH / 2 + 50 + (x + y) * Math.sin(angle) - z
                 };
              };
              
              const drawBlock = (bx: number, by: number, height: number) => {
                 const pTop0 = iso(bx - bWidth/2, by - bWidth/2, height);
                 const pTop1 = iso(bx + bWidth/2, by - bWidth/2, height);
                 const pTop2 = iso(bx + bWidth/2, by + bWidth/2, height);
                 const pTop3 = iso(bx - bWidth/2, by + bWidth/2, height);
                 
                 const pBot0 = iso(bx - bWidth/2, by - bWidth/2, 0);
                 const pBot1 = iso(bx + bWidth/2, by - bWidth/2, 0);
                 const pBot2 = iso(bx + bWidth/2, by + bWidth/2, 0);
                 const pBot3 = iso(bx - bWidth/2, by + bWidth/2, 0);
                 
                 // Draw left face
                 const gradLeft = ctx.createLinearGradient(pTop3.x, pTop3.y, pBot3.x, pBot3.y);
                 gradLeft.addColorStop(0, adjustHexBrightness(bldgFg, -0.15));
                 gradLeft.addColorStop(1, adjustHexBrightness(bldgFg, -0.55));
                 ctx.fillStyle = gradLeft;
                 ctx.beginPath();
                 ctx.moveTo(pTop0.x, pTop0.y); ctx.lineTo(pTop3.x, pTop3.y);
                 ctx.lineTo(pBot3.x, pBot3.y); ctx.lineTo(pBot0.x, pBot0.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Draw right face
                 const gradRight = ctx.createLinearGradient(pTop2.x, pTop2.y, pBot2.x, pBot2.y);
                 gradRight.addColorStop(0, adjustHexBrightness(bldgFg, -0.35));
                 gradRight.addColorStop(1, adjustHexBrightness(bldgFg, -0.75));
                 ctx.fillStyle = gradRight;
                 ctx.beginPath();
                 ctx.moveTo(pTop3.x, pTop3.y); ctx.lineTo(pTop2.x, pTop2.y);
                 ctx.lineTo(pBot2.x, pBot2.y); ctx.lineTo(pBot3.x, pBot3.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Draw top face
                 ctx.fillStyle = bldgFg;
                 ctx.beginPath();
                 ctx.moveTo(pTop0.x, pTop0.y); ctx.lineTo(pTop1.x, pTop1.y);
                 ctx.lineTo(pTop2.x, pTop2.y); ctx.lineTo(pTop3.x, pTop3.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Subtle top edge highlight
                 ctx.strokeStyle = adjustHexBrightness(bldgFg, 0.2);
                 ctx.lineWidth = 1;
                 ctx.stroke();
              };
              
              const buildings: { x: number; y: number; h: number; order: number }[] = [];
              const half = (n - 1) / 2;
              
              for (let ix = 0; ix < n; ix++) {
                 for (let iy = 0; iy < n; iy++) {
                    const cx = (ix - half) * step;
                    const cy = (iy - half) * step;
                    
                    const distCenter = Math.hypot(ix - half, iy - half) / Math.max(1, half);
                    const baseProfile = 0.35 + 0.65 * Math.max(0, 1.0 - distCenter * 0.6);
                    
                    const freq = 0.75 * cha;
                    const w1 = Math.sin((ix * 0.7 - iy * 0.4) * freq + t * 1.5);
                    const w2 = Math.cos((ix * 0.3 + iy * 0.8) * freq - t * 1.2);
                    const w3 = Math.sin(distCenter * Math.PI * cha - t * 2.0);
                    const wave = w1 * 0.45 + w2 * 0.35 + w3 * 0.2;
                    
                    const dynamicFactor = (1.0 - mov * 0.5) + (wave * 0.5 + 0.5) * mov;
                    const h = Math.max(20, maxH * baseProfile * dynamicFactor);
                    
                    buildings.push({ x: cx, y: cy, h, order: ix + iy });
                 }
              }
              
              buildings.sort((a, b) => a.order - b.order);
              
              for (const b of buildings) {
                 drawBlock(b.x, b.y, b.h);
              }
              
              element = canvas;
            } else if (def.uuid === 'growing-circles-canvas-1') {
                if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
                const canvas = sphereCanvasRef.current[layer.id];
                if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW; canvas.height = targetH;
                }
                const ctx = canvas.getContext('2d')!;
                ctx.clearRect(0, 0, targetW, targetH);
                
                const { count, size, speed, duration, delay, drop } = modifiedSettings;
                const numCircles = Math.max(0, Math.min(200, Math.floor(count ?? 25.0)));
                const maxSize = Math.max(10.0, Math.min(2400.0, size ?? 280.0));
                const spd = Math.max(0.05, speed ?? 1.0);
                const lifeDuration = Math.max(0.5, Math.min(60.0, duration ?? 6.0));
                
                const gcBg = resolvedGenerativeColors['background'] || '#050a05';
                const gcCircles = resolvedGenerativeColors['circles'] || resolvedGenerativeColors['primary'] || '#00ff41';
                const gcRgb = hexToRgb(gcCircles);
                
                if (!isTransparentColor(gcBg)) {
                    ctx.fillStyle = gcBg;
                    ctx.fillRect(0, 0, targetW, targetH);
                }
                
                // Growth phase time: how long to grow from 0 to full size
                const growthTime = 1.0 / spd;
                const totalLife = Math.max(growthTime + 0.1, lifeDuration);
                
                if (!(window as any).__dropsState) (window as any).__dropsState = {};
                const dropsGlobal = (window as any).__dropsState;
                const gcMargin = 0.12;
                if (!dropsGlobal[layer.id]) {
                    dropsGlobal[layer.id] = { lastDropAction: 0, activeDrops: [], lastAutoSpawn: 0 };
                    // Pre-seed a spread of ripples at staggered ages so it looks alive from frame 1
                    const seed = Math.min(numCircles, 8);
                    for (let i = 0; i < seed; i++) {
                        dropsGlobal[layer.id].activeDrops.push({
                            birthTime: nowSec - (i / seed) * totalLife * 0.85,
                            x: (gcMargin + Math.random() * (1 - 2 * gcMargin)) * targetW,
                            y: (gcMargin + Math.random() * (1 - 2 * gcMargin)) * targetH,
                            isAuto: true,
                        });
                    }
                    dropsGlobal[layer.id].lastAutoSpawn = nowSec;
                }
                const state = dropsGlobal[layer.id];

                // Clean up dead drops
                state.activeDrops = state.activeDrops.filter((d: any) => (nowSec - d.birthTime) < totalLife);

                // Auto spawning
                const autoDrops = state.activeDrops.filter((d: any) => d.isAuto);
                if (autoDrops.length < numCircles) {
                    const autoSpawnInterval = Math.max(0.01, delay ?? 0.25);
                    if (nowSec - state.lastAutoSpawn >= autoSpawnInterval) {
                        state.lastAutoSpawn = nowSec;
                        const margin = gcMargin;
                        state.activeDrops.push({
                            birthTime: nowSec,
                            x: (margin + Math.random() * (1.0 - 2 * margin)) * targetW,
                            y: (margin + Math.random() * (1.0 - 2 * margin)) * targetH,
                            isAuto: true
                        });
                    }
                }
                
                // Manual spawning via trigger action
                const dropAction = drop ?? 0;
                if (dropAction > state.lastDropAction) {
                    const diff = dropAction - state.lastDropAction;
                    for (let i = 0; i < Math.min(diff, 10); i++) {
                        const margin = 0.15; 
                        state.activeDrops.push({
                            birthTime: nowSec,
                            x: (margin + Math.random() * (1.0 - 2 * margin)) * targetW,
                            y: (margin + Math.random() * (1.0 - 2 * margin)) * targetH,
                            isAuto: false
                        });
                    }
                    state.lastDropAction = dropAction;
                }
                
                // Draw all drops as expanding ripple rings
                void growthTime;
                for (const d of state.activeDrops) {
                    const age = nowSec - d.birthTime;
                    const life = Math.min(1, age / totalLife);
                    if (life >= 1) continue;
                    const ease = 1 - Math.pow(1 - life, 2.2);       // ease-out expansion
                    const baseR = ease * maxSize;
                    const fade = Math.pow(1 - life, 1.4);           // opacity fades as ring expands
                    if (fade <= 0.008 || baseR < 1) continue;

                    for (let ring = 0; ring < 3; ring++) {
                        const rr = baseR - ring * (maxSize * 0.09);
                        if (rr <= 2) continue;
                        const a = fade * (1 - ring * 0.32);
                        ctx.strokeStyle = `rgba(${gcRgb.r}, ${gcRgb.g}, ${gcRgb.b}, ${a.toFixed(3)})`;
                        ctx.lineWidth = Math.max(1, (2.8 - ring * 0.8) * (1 - life * 0.45));
                        ctx.beginPath();
                        ctx.arc(d.x, d.y, rr, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                    // brief bright core at the impact point
                    if (life < 0.22) {
                        const coreA = 1 - life / 0.22;
                        ctx.fillStyle = `rgba(${gcRgb.r}, ${gcRgb.g}, ${gcRgb.b}, ${(coreA * 0.85).toFixed(3)})`;
                        ctx.beginPath();
                        ctx.arc(d.x, d.y, 3 + coreA * 7, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                element = canvas;
            } else if (def.uuid === 'dancing-cubes-canvas-1') {
                if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
                const canvas = sphereCanvasRef.current[layer.id];
                if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW; canvas.height = targetH;
                }
                const ctx = canvas.getContext('2d')!;
                ctx.clearRect(0, 0, targetW, targetH);

                const activeColors = resolvedGenerativeColors;
                const bgHex = activeColors['background'] || '#050a05';
                const primaryHex = activeColors['cubes_crimson'] || activeColors['primary'] || '#00ff41';
                const secondaryHex = activeColors['cubes_slate'] || activeColors['secondary'] || '#008f11';
                const wireframeHex = activeColors['wireframes'] || activeColors['highlight'] || '#50ff70';

                // --- Background: from activeColors ---
                if (!isTransparentColor(bgHex)) {
                    ctx.fillStyle = bgHex;
                    ctx.fillRect(0, 0, targetW, targetH);
                }

                const { grid_size, cube_size, x_movement, y_movement, z_movement, delay, wireframe_ratio, rotate_face } = modifiedSettings;
                const gridSize = Math.max(2, Math.min(8, Math.round(grid_size ?? 5.0)));
                const size = Math.max(25.0, Math.min(300.0, cube_size ?? 115.0));
                const xMove = Math.max(0.0, x_movement ?? 30.0);
                const yMove = Math.max(0.0, y_movement ?? 45.0);
                const zMove = Math.max(0.0, z_movement ?? 30.0);
                const phaseDelay = Math.max(0.0, delay ?? 0.35);
                const wfRatio = Math.max(0.0, Math.min(1.0, wireframe_ratio ?? 0.5));
                const actionTriggerCount = Number(rotate_face ?? 0);

                // --- Rotation Easing Engine for "Rotate Face" Action (90 deg / π/2 per step) ---
                if (!dancingCubesRotationRef.current[layer.id]) {
                    dancingCubesRotationRef.current[layer.id] = { current: 0, target: 0 };
                }
                const rotState = dancingCubesRotationRef.current[layer.id];
                rotState.target = actionTriggerCount * (Math.PI / 2);
                rotState.current += (rotState.target - rotState.current) * 0.18;
                const currentFaceAngle = rotState.current;

                // Isometric math constants
                const ISO_COS = 0.8660254; // cos(30 deg)
                const ISO_SIN = 0.5;       // sin(30 deg)
                const spacing = size * 1.55;
                const centerX = targetW / 2;
                const centerY = targetH / 2;

                // Whole scene rotated 180 degrees
                ctx.save();
                ctx.translate(centerX, centerY);
                ctx.rotate(Math.PI);
                ctx.translate(-centerX, -centerY);

                // 3D Cubes generation & Depth Sorting
                interface DancingCubeItem {
                    gx: number;
                    gy: number;
                    isWireframe: boolean;
                    wireframeColor: string;
                    paletteType: 'crimson' | 'slate';
                    worldX: number;
                    worldY: number;
                    worldZ: number;
                    sortKey: number;
                }

                const cubes: DancingCubeItem[] = [];

                for (let gx = 0; gx < gridSize; gx++) {
                    for (let gy = 0; gy < gridSize; gy++) {
                        const cx = gx - (gridSize - 1) / 2;
                        const cy = gy - (gridSize - 1) / 2;
                        const dist = Math.sqrt(cx * cx + cy * cy);

                        // Spatial wave phase with natural baseline speed and delay parameter
                        const wavePhase = nowSec * 2.8 + dist * phaseDelay * 4.0;

                        // Movement along X, Y, Z directions
                        const offX = Math.sin(wavePhase) * (xMove / 100.0) * size * 0.65;
                        const offY = Math.cos(wavePhase * 1.1 + 0.5) * (yMove / 100.0) * size * 0.65;
                        const offZ = Math.sin(wavePhase * 0.85 + 1.2) * (zMove / 100.0) * size * 0.85;

                        const worldX = cx * spacing + offX;
                        const worldY = cy * spacing + offY;
                        const worldZ = offZ;

                        // Layout: alternating checkerboard between transparent frame and solid colored cube
                        const isWireframe = ((gx + gy) % 2 === 1 && wfRatio > 0.15) || (wfRatio > 0.75);
                        
                        // Each cube strictly uses one color theme: Primary OR Secondary
                        const isCrimson = ((gx * 3 + gy * 2) % 2 === 0);
                        const paletteType: 'crimson' | 'slate' = isCrimson ? 'crimson' : 'slate';
                        
                        // Wireframe color strictly from that cube's single color palette
                        const wireframeColor = isCrimson ? wireframeHex : adjustHexBrightness(secondaryHex, 0.35);

                        // Sort key: Isometric back-to-front depth (gx + gy + depth displacement)
                        const sortKey = (gx + gy) * 1000 + (offX + offY) - offZ;

                        cubes.push({
                            gx, gy, isWireframe, wireframeColor, paletteType,
                            worldX, worldY, worldZ, sortKey
                        });
                    }
                }

                // Sort back to front. The scene is painted through a 180-degree canvas
                // rotation (viewed from the opposite corner), so what was "near" is now
                // "far" -> reverse the painter's-algorithm order to keep occlusion correct.
                cubes.sort((a, b) => b.sortKey - a.sortKey);

                // Vertex local offsets for cube
                const h = size / 2;
                const baseVertices = [
                    { x: -h, y: -h, z: -h }, // 0
                    { x:  h, y: -h, z: -h }, // 1
                    { x:  h, y:  h, z: -h }, // 2
                    { x: -h, y:  h, z: -h }, // 3
                    { x: -h, y: -h, z:  h }, // 4
                    { x:  h, y: -h, z:  h }, // 5
                    { x:  h, y:  h, z:  h }, // 6
                    { x: -h, y:  h, z:  h }, // 7
                ];

                // 6 Faces (quad indices)
                const faces = [
                    { name: 'top',    indices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
                    { name: 'bottom', indices: [0, 3, 2, 1], normal: { x: 0, y: 0, z: -1 } },
                    { name: 'front1', indices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
                    { name: 'front2', indices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
                    { name: 'back1',  indices: [2, 3, 7, 6], normal: { x: 0, y: 1, z: 0 } },
                    { name: 'back2',  indices: [3, 0, 4, 7], normal: { x: -1, y: 0, z: 0 } },
                ];

                // 12 Edges for wireframe
                const edges = [
                    [0, 1], [1, 2], [2, 3], [3, 0], // Bottom square
                    [4, 5], [5, 6], [6, 7], [7, 4], // Top square
                    [0, 4], [1, 5], [2, 6], [3, 7], // Vertical pillars
                ];

                const cosRot = Math.cos(currentFaceAngle);
                const sinRot = Math.sin(currentFaceAngle);

                // Palette definitions with dynamic monochromatic lighting: the top face
                // (whichever face currently points "up" as the cube tumbles) is the light
                // source's target and always the brightest; the two visible side faces
                // both sit in shadow, in two close tones for depth. See the per-face
                // brightness blend below for how this stays smooth through rotation.
                const palettes = {
                    crimson: { base: primaryHex, border: adjustHexBrightness(primaryHex, 0.35) },
                    slate: { base: secondaryHex, border: adjustHexBrightness(secondaryHex, 0.35) }
                };

                for (const cube of cubes) {
                    // Rotate vertices locally around local Y axis for smooth face tumble
                    const projVertices = baseVertices.map(v => {
                        const rx = v.x * cosRot + v.z * sinRot;
                        const ry = v.y;
                        const rz = -v.x * sinRot + v.z * cosRot;

                        // World 3D position
                        const wx = cube.worldX + rx;
                        const wy = cube.worldY + ry;
                        const wz = cube.worldZ + rz;

                        // Isometric projection to screen
                        const sx = centerX + (wx - wy) * ISO_COS;
                        const sy = centerY + (wx + wy) * ISO_SIN - wz;

                        return { sx, sy, wx, wy, wz, rx, ry, rz };
                    });

                    // Cube screen center
                    const cubeCenterX = projVertices.reduce((acc, p) => acc + p.sx, 0) / 8;
                    const cubeCenterY = projVertices.reduce((acc, p) => acc + p.sy, 0) / 8;

                    if (cube.isWireframe) {
                        // --- Render Transparent Wireframe Frame ---
                        ctx.save();
                        ctx.strokeStyle = cube.wireframeColor;
                        ctx.lineWidth = 2.0;
                        ctx.lineJoin = 'round';
                        ctx.lineCap = 'round';

                        for (const [i1, i2] of edges) {
                            const p1 = projVertices[i1];
                            const p2 = projVertices[i2];
                            ctx.beginPath();
                            ctx.moveTo(p1.sx, p1.sy);
                            ctx.lineTo(p2.sx, p2.sy);
                            ctx.stroke();
                        }
                        ctx.restore();
                    } else {
                        // --- Render Solid Monochromatic Cube (100% Solid, No Transparency) ---
                        const pal = palettes[cube.paletteType];

                        // Sort faces by screen depth (average depth of vertices)
                        const sortedFaces = faces.map(f => {
                            const v0 = projVertices[f.indices[0]];
                            const v1 = projVertices[f.indices[1]];
                            const v2 = projVertices[f.indices[2]];
                            const v3 = projVertices[f.indices[3]];

                            // 2D Cross product for screen winding / visibility
                            const cross = (v1.sx - v0.sx) * (v2.sy - v0.sy) - (v1.sy - v0.sy) * (v2.sx - v0.sx);
                            const avgZ = (v0.wz + v1.wz + v2.wz + v3.wz) / 4;
                            const avgIsoDepth = (v0.wx + v0.wy + v1.wx + v1.wy + v2.wx + v2.wy + v3.wx + v3.wy) / 8 - avgZ;

                            // Face screen centroid
                            const faceCenterX = (v0.sx + v1.sx + v2.sx + v3.sx) / 4;
                            const faceCenterY = (v0.sy + v1.sy + v2.sy + v3.sy) / 4;

                            return { face: f, v: [v0, v1, v2, v3], cross, avgIsoDepth, faceCenterX, faceCenterY };
                        }).filter(item => item.cross < 0); // Back-face culling on screen

                        sortedFaces.sort((a, b) => a.avgIsoDepth - b.avgIsoDepth);

                        ctx.save();
                        ctx.lineWidth = 1.8;
                        ctx.lineJoin = 'round';
                        ctx.lineCap = 'round';
                        ctx.strokeStyle = pal.border;

                        for (const item of sortedFaces) {
                            const norm = item.face.normal;
                            // Rotated normal
                            const rnx = norm.x * cosRot + norm.z * sinRot;
                            const rny = norm.y;
                            const rnz = -norm.x * sinRot + norm.z * cosRot;

                            // Relative horizontal offset from cube centroid on screen.
                            // Negated because the whole scene is painted through a
                            // 180-degree canvas rotation, which mirrors on-screen left/right.
                            const relX = -(item.faceCenterX - cubeCenterX);

                            // Continuous top-lit shading: brightness ramps smoothly with how
                            // much this face currently points "up" (rnz), so a tumbling cube
                            // fades between shadow and highlight instead of popping between
                            // fixed light/dark buckets. Faces pointing sideways/down land in
                            // one of two close shadow tones (picked smoothly by which side of
                            // the cube they're on) so the two visible side faces both read as
                            // shadow, with a little depth between them.
                            const upT = Math.max(0, Math.min(1, rnz));
                            const upEase = upT * upT * (3 - 2 * upT);
                            const sideT = Math.max(-1, Math.min(1, relX / Math.max(1, size * 0.4)));
                            const shadowFactor = -0.32 + sideT * 0.14;
                            const litFactor = 0.16;
                            const factor = shadowFactor + (litFactor - shadowFactor) * upEase;

                            ctx.fillStyle = adjustHexBrightness(pal.base, factor);
                            ctx.beginPath();
                            ctx.moveTo(item.v[0].sx, item.v[0].sy);
                            for (let i = 1; i < item.v.length; i++) {
                                ctx.lineTo(item.v[i].sx, item.v[i].sy);
                            }
                            ctx.closePath();
                            ctx.fill();
                            ctx.stroke();
                        }
                        ctx.restore();
                    }
                }

                ctx.restore(); // end 180-degree scene rotation
                element = canvas;
            } else if (def.uuid === 'cubes-matrix-3d-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const cmBg = resolvedGenerativeColors['background'] || '#2e2117';
              const cmColA = hexToRgb(resolvedGenerativeColors['cube_a'] || resolvedGenerativeColors['cubes'] || resolvedGenerativeColors['primary'] || '#cf7d2a');
              const cmColB = hexToRgb(resolvedGenerativeColors['cube_b'] || '#4de8e0');
              const cmColC = hexToRgb(resolvedGenerativeColors['cube_c'] || '#df9bf3');
              const cmPalette = [cmColA, cmColB, cmColC];
              if (!isTransparentColor(cmBg)) {
                  ctx.fillStyle = cmBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }

              const { speed, rotation, count, cube_size, spacing, dispersion, opacity, reshuffle } = modifiedSettings;
              const spd = speed ?? 1.0;
              const rotVal = rotation ?? 0.0;
              const n = Math.max(1, Math.min(6, Math.round(count ?? 3)));
              const baseSz = cube_size ?? 64.0;
              const spc = spacing ?? 55.0;
              const disp = dispersion ?? 90.0;
              const alpha = opacity ?? 0.70;
              const t = nowSec * spd;

              // Reshuffle action -> new per-layer seed scrambling positions, colours & directions
              const cmAction = Number(reshuffle ?? 0);
              if (!cubesMatrixStateRef.current[layer.id]) cubesMatrixStateRef.current[layer.id] = { shuf: 0, lastAction: cmAction };
              const cmSt = cubesMatrixStateRef.current[layer.id];
              if (cmAction > cmSt.lastAction) { cmSt.shuf = (cmSt.shuf + 1) * 2.399 + Math.random() * 40; cmSt.lastAction = cmAction; }
              const shuf = cmSt.shuf;
              const cmRand = (s: number) => { const x = Math.sin(s * 12.9898 + 78.233 + shuf * 3.71) * 43758.5453; return x - Math.floor(x); };

              // Standard Isometric angles (35.264 deg pitch, 45 deg yaw)
              // `rotation` is a manual yaw offset that always applies (works with speed at 0);
              // `speed` adds a continuous auto-spin on top.
              const rotX = 0.61548; // Math.atan(1 / Math.SQRT2)
              const rotY = (Math.PI / 4) + t * 0.6 + rotVal * (Math.PI * 2 / 5);
              const rotZ = 0.0;
              
              // Light direction (from upper right front for isometric shading)
              const lx = 0.5, ly = -0.85, lz = 0.6;
              const lLen = Math.hypot(lx, ly, lz) || 1;
              const lightNorm = { x: lx / lLen, y: ly / lLen, z: lz / lLen };
              
              const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
              const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
              const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
              
              const rotate3D = (x: number, y: number, z: number) => {
                  // Rotate Y (Yaw)
                  const x1 = x * cosY + z * sinY;
                  const z1 = -x * sinY + z * cosY;
                  // Rotate X (Isometric Pitch)
                  const y2 = y * cosX - z1 * sinX;
                  const z2 = y * sinX + z1 * cosX;
                  return { x: x1, y: y2, z: z2 };
              };
              
              // True Orthographic Isometric Projection
              const isoScale = Math.min(targetW, targetH) / 480;
              const project = (p: { x: number; y: number; z: number }) => {
                  return {
                      x: targetW / 2 + p.x * isoScale,
                      y: targetH / 2 + p.y * isoScale,
                      z: p.z
                  };
              };
              
              interface QuadFace {
                  p0: { x: number; y: number; z: number };
                  p1: { x: number; y: number; z: number };
                  p2: { x: number; y: number; z: number };
                  p3: { x: number; y: number; z: number };
                  centerZ: number;
                  fillColor: string;
                  strokeColor: string;
                  isFront: boolean;
              }
              
              const allFaces: QuadFace[] = [];
              const half = (n - 1) / 2.0;

              const localVerts = [
                  { x: -1, y: -1, z: -1 },
                  { x:  1, y: -1, z: -1 },
                  { x:  1, y:  1, z: -1 },
                  { x: -1, y:  1, z: -1 },
                  { x: -1, y: -1, z:  1 },
                  { x:  1, y: -1, z:  1 },
                  { x:  1, y:  1, z:  1 },
                  { x: -1, y:  1, z:  1 }
              ];
              
              const cubeFaces = [
                  { v: [4, 5, 6, 7], n: { x: 0, y: 0, z: 1 } },
                  { v: [1, 0, 3, 2], n: { x: 0, y: 0, z: -1 } },
                  { v: [3, 2, 6, 7], n: { x: 0, y: 1, z: 0 } },
                  { v: [0, 1, 5, 4], n: { x: 0, y: -1, z: 0 } },
                  { v: [1, 2, 6, 5], n: { x: 1, y: 0, z: 0 } },
                  { v: [0, 3, 7, 4], n: { x: -1, y: 0, z: 0 } }
              ];
              
              for (let ix = 0; ix < n; ix++) {
                  for (let iy = 0; iy < n; iy++) {
                      for (let iz = 0; iz < n; iz++) {
                          const seed = ix * 73.1 + iy * 31.7 + iz * 19.3 + 5.7;
                          const cubeColRgb = cmPalette[Math.floor(cmRand(seed * 1.7 + 4.2) * 3) % 3];

                          const stepDist = baseSz + spc;
                          const bx = (ix - half) * stepDist + (cmRand(seed + 11.1) - 0.5) * stepDist * 1.35 * (shuf > 0 ? 1 : 0);
                          const by = (iy - half) * stepDist + (cmRand(seed + 22.2) - 0.5) * stepDist * 1.35 * (shuf > 0 ? 1 : 0);
                          const bz = (iz - half) * stepDist + (cmRand(seed + 33.3) - 0.5) * stepDist * 1.35 * (shuf > 0 ? 1 : 0);

                          // Fixed ~20% size variance (largest / smallest ≈ 1.1 / 0.9)
                          const sizeJitter = cmRand(seed * 7.1 + 1.3);
                          const curRadius = (baseSz / 2) * (0.9 + 0.2 * sizeJitter);

                          // Dispersion: random axis direction (+X, -X, +Y, -Y, +Z, -Z)
                          const dirChoice = Math.floor(cmRand(seed * 13.3 + 2.1) * 6);
                          const dispPulse = Math.sin(t * 1.5 + seed * 2.3) * 0.5 + 0.5;
                          const dispAmount = disp * dispPulse;
                          
                          let dx = 0, dy = 0, dz = 0;
                          if (dirChoice === 0) dx = dispAmount;
                          else if (dirChoice === 1) dx = -dispAmount;
                          else if (dirChoice === 2) dy = dispAmount;
                          else if (dirChoice === 3) dy = -dispAmount;
                          else if (dirChoice === 4) dz = dispAmount;
                          else dz = -dispAmount;
                          
                          const curCx = bx + dx;
                          const curCy = by + dy;
                          const curCz = bz + dz;
                          
                          const rotatedCubeVerts = localVerts.map(v => {
                              const wx = curCx + v.x * curRadius;
                              const wy = curCy + v.y * curRadius;
                              const wz = curCz + v.z * curRadius;
                              return rotate3D(wx, wy, wz);
                          });
                          
                          const projVerts = rotatedCubeVerts.map(project);
                          
                          for (let f = 0; f < cubeFaces.length; f++) {
                              const faceDef = cubeFaces[f];
                              const p0 = projVerts[faceDef.v[0]];
                              const p1 = projVerts[faceDef.v[1]];
                              const p2 = projVerts[faceDef.v[2]];
                              const p3 = projVerts[faceDef.v[3]];
                              
                              const norm2D = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
                              const isFront = norm2D >= 0;
                              
                              const rotNorm = rotate3D(faceDef.n.x, faceDef.n.y, faceDef.n.z);
                              const dotLight = rotNorm.x * lightNorm.x + rotNorm.y * lightNorm.y + rotNorm.z * lightNorm.z;
                              const lightFactor = Math.max(0.25, Math.min(1.0, 0.65 + dotLight * 0.35));
                              
                              const r = Math.round(cubeColRgb.r * lightFactor);
                              const g = Math.round(cubeColRgb.g * lightFactor);
                              const b = Math.round(cubeColRgb.b * lightFactor);

                              const faceAlpha = isFront ? (alpha * 0.85) : (alpha * 0.35);
                              const strokeAlpha = isFront ? Math.min(1.0, alpha * 1.1) : (alpha * 0.4);

                              const fillColor = `rgba(${r}, ${g}, ${b}, ${faceAlpha})`;
                              const strokeColor = `rgba(${cubeColRgb.r}, ${cubeColRgb.g}, ${cubeColRgb.b}, ${strokeAlpha})`;
                              
                              const centerZ = (p0.z + p1.z + p2.z + p3.z) / 4.0;
                              
                              allFaces.push({
                                  p0, p1, p2, p3,
                                  centerZ,
                                  fillColor,
                                  strokeColor,
                                  isFront
                              });
                          }
                      }
                  }
              }
              
              allFaces.sort((a, b) => a.centerZ - b.centerZ);
              
              for (let f = 0; f < allFaces.length; f++) {
                  const face = allFaces[f];
                  ctx.fillStyle = face.fillColor;
                  ctx.strokeStyle = face.strokeColor;
                  ctx.lineWidth = face.isFront ? 1.4 : 0.8;
                  
                  ctx.beginPath();
                  ctx.moveTo(face.p0.x, face.p0.y);
                  ctx.lineTo(face.p1.x, face.p1.y);
                  ctx.lineTo(face.p2.x, face.p2.y);
                  ctx.lineTo(face.p3.x, face.p3.y);
                  ctx.closePath();
                  
                  ctx.fill();
                  ctx.stroke();
              }
              
              element = canvas; } else if (def.uuid === 'vein-labyrinth-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              
              const veinBg = resolvedGenerativeColors['background'] || '#ffffff';
              const veinFg = resolvedGenerativeColors['veins'] || resolvedGenerativeColors['foreground'] || '#000000';
              if (!isTransparentColor(veinBg)) {
                  ctx.fillStyle = veinBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { growth, branch_chance, split_mode, segment_size, grid_mesh } = modifiedSettings;
              const veinAccent = resolvedGenerativeColors['accent'] || veinFg;
              const S = Math.min(targetW, targetH);
              const cx = targetW / 2;
              const cy = targetH / 2;

              // growth 1..45 -> fractional recursion depth 3..13 (progressive reveal)
              const depthF = 3 + ((Math.max(1, Math.min(45, growth ?? 25)) - 1) / 44) * 10;
              const maxDepth = Math.min(13, Math.ceil(depthF));
              const brChance = Math.max(0, Math.min(1, branch_chance ?? 0.45));
              const splitAmt = Math.max(0.5, Math.min(5, split_mode ?? 2.5));
              const segLen0 = Math.max(10, Math.min(45, segment_size ?? 20)) * (S / 340);
              const glowAmt = Math.max(0, Math.min(1, grid_mesh ?? 0.35));

              const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
              const sway = nowSec * 0.4;

              interface Vein { x1: number; y1: number; x2: number; y2: number; cxp: number; cyp: number; depth: number; w: number; }
              const veins: Vein[] = [];
              const baseW = S * 0.019;
              const rootCount = Math.round(2 + splitAmt);
              const spread = (Math.PI / 6) * (0.7 + splitAmt * 0.18);

              interface Seed { x: number; y: number; ang: number; depth: number; len: number; seed: number; }
              const stack: Seed[] = [];
              for (let i = 0; i < rootCount; i++) {
                  const a = (i / rootCount) * Math.PI * 2 + rnd(i * 9.1) * 0.5;
                  stack.push({ x: cx, y: cy, ang: a, depth: 0, len: segLen0 * (0.9 + rnd(i) * 0.3), seed: i * 17.3 + 1 });
              }

              let guard = 0;
              while (stack.length && guard < 4500) {
                  guard++;
                  const b = stack.pop()!;
                  if (b.depth > maxDepth) continue;

                  const drift = (rnd(b.seed * 2.7) - 0.5) * 0.7 + Math.sin(sway + b.seed) * 0.06;
                  const ang = b.ang + drift;
                  const x2 = b.x + Math.cos(ang) * b.len;
                  const y2 = b.y + Math.sin(ang) * b.len;
                  const perp = ang + Math.PI / 2;
                  const bow = (rnd(b.seed * 5.3) - 0.5) * b.len * 0.5;
                  const mx = (b.x + x2) / 2 + Math.cos(perp) * bow;
                  const my = (b.y + y2) / 2 + Math.sin(perp) * bow;
                  const w = Math.max(0.6, baseW * Math.pow(0.72, b.depth));
                  veins.push({ x1: b.x, y1: b.y, x2, y2, cxp: mx, cyp: my, depth: b.depth, w });

                  if (b.depth >= maxDepth) continue;
                  if (x2 < -60 || x2 > targetW + 60 || y2 < -60 || y2 > targetH + 60) continue;

                  const childLen = b.len * 0.85;
                  const forkRoll = rnd(b.seed * 3.9);
                  const doFork = forkRoll < brChance || b.depth === 0;
                  if (doFork) {
                      const n = (forkRoll < brChance * 0.35 && b.depth > 1) ? 3 : 2;
                      for (let k = 0; k < n; k++) {
                          const off = (k - (n - 1) / 2) * spread * (0.8 + rnd(b.seed + k) * 0.5);
                          stack.push({ x: x2, y: y2, ang: ang + off, depth: b.depth + 1, len: childLen * (0.85 + rnd(b.seed * 2.1 + k) * 0.3), seed: b.seed * 3.13 + k + 1 });
                      }
                  } else {
                      stack.push({ x: x2, y: y2, ang, depth: b.depth + 1, len: childLen * (0.9 + rnd(b.seed * 1.7) * 0.2), seed: b.seed * 3.13 + 7 });
                  }
              }

              // thickest trunks drawn last so they sit on top
              veins.sort((a, z) => z.depth - a.depth);
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';

              const floorDepth = Math.floor(depthF);
              const frac = depthF - floorDepth;

              if (glowAmt > 0.02) {
                  ctx.strokeStyle = veinAccent;
                  ctx.globalAlpha = 0.12 * glowAmt;
                  for (const s of veins) {
                      if (s.depth > floorDepth) continue;
                      ctx.lineWidth = s.w + S * 0.02 * glowAmt;
                      ctx.beginPath();
                      ctx.moveTo(s.x1, s.y1);
                      ctx.quadraticCurveTo(s.cxp, s.cyp, s.x2, s.y2);
                      ctx.stroke();
                  }
                  ctx.globalAlpha = 1;
              }

              ctx.strokeStyle = veinFg;
              for (const s of veins) {
                  if (s.depth > floorDepth) continue;
                  let ex = s.x2, ey = s.y2, cxp = s.cxp, cyp = s.cyp;
                  if (s.depth === floorDepth && frac < 0.999) {
                      ex = s.x1 + (s.x2 - s.x1) * frac;
                      ey = s.y1 + (s.y2 - s.y1) * frac;
                      cxp = s.x1 + (s.cxp - s.x1) * frac;
                      cyp = s.y1 + (s.cyp - s.y1) * frac;
                  }
                  ctx.lineWidth = s.w;
                  ctx.beginPath();
                  ctx.moveTo(s.x1, s.y1);
                  ctx.quadraticCurveTo(cxp, cyp, ex, ey);
                  ctx.stroke();
              }

              ctx.fillStyle = veinFg;
              ctx.beginPath();
              ctx.arc(cx, cy, baseW * 0.95, 0, Math.PI * 2);
              ctx.fill();

              element = canvas;
          } else if (def.uuid === 'reaction-diffusion-canvas-1') {
              // Gray-Scott reaction-diffusion on a small CPU grid. `sim_speed` is steps
              // per frame (direct, no wall-clock pacing) so it just grows faster/slower
              // with the slider. 1-bit render, nearest-neighbour upscale (no antialiasing).
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const rdPaper = resolvedGenerativeColors['background'] || '#f2efe6';
              const rdInk = resolvedGenerativeColors['ink'] || resolvedGenerativeColors['foreground'] || '#141414';
              const rdPaperRgb = hexToRgb(rdPaper);
              const rdInkRgb = hexToRgb(rdInk);

              const rs = modifiedSettings;
              const gw = Math.max(70, Math.min(200, Math.round(rs.resolution ?? 120)));
              const gh = Math.max(48, Math.min(200, Math.round(gw * targetH / Math.max(1, targetW))));
              const reseedAction = Number(rs.reseed ?? 0);

              let rdSt = reactionDiffusionStateRef.current[layer.id];
              const needInit = !rdSt || rdSt.w !== gw || rdSt.h !== gh || reseedAction > (rdSt?.lastReseed ?? 0);
              if (needInit) {
                  const n = gw * gh;
                  const grid: HTMLCanvasElement = (rdSt && rdSt.grid) || document.createElement('canvas');
                  grid.width = gw; grid.height = gh;
                  const gctx0 = grid.getContext('2d')!;
                  const A = new Float32Array(n), B = new Float32Array(n);
                  A.fill(1.0);
                  const seeds = [[0.30, 0.40], [0.66, 0.34], [0.48, 0.70]];
                  const sr = Math.max(2, Math.round(gw * 0.02));
                  for (let k = 0; k < seeds.length; k++) {
                      const scx = Math.round(seeds[k][0] * gw), scy = Math.round(seeds[k][1] * gh);
                      for (let dy = -sr; dy <= sr; dy++) for (let dx = -sr; dx <= sr; dx++) {
                          if (dx * dx + dy * dy > sr * sr) continue;
                          const ii = (((scy + dy) % gh + gh) % gh) * gw + (((scx + dx) % gw + gw) % gw);
                          A[ii] = 0.0; B[ii] = 1.0;
                      }
                  }
                  rdSt = {
                      w: gw, h: gh, a: A, b: B,
                      a2: new Float32Array(n), b2: new Float32Array(n),
                      grid, img: gctx0.createImageData(gw, gh),
                      born: nowSec, lastReseed: reseedAction, warm: 200,
                  };
                  reactionDiffusionStateRef.current[layer.id] = rdSt;
              }

              const w = rdSt.w, h = rdSt.h;
              let a = rdSt.a as Float32Array, b = rdSt.b as Float32Array;
              let a2 = rdSt.a2 as Float32Array, b2 = rdSt.b2 as Float32Array;
              const DA = 1.0, DB = 0.5;
              const fBase = Math.max(0.005, Math.min(0.11, rs.feed ?? 0.0545));
              const kBase = Math.max(0.03, Math.min(0.08, rs.kill ?? 0.062));
              const breatheAmt = Math.max(0, Math.min(0.03, rs.breathe ?? 0.006));
              const fNow = fBase + breatheAmt * Math.sin((nowSec - rdSt.born) * (Math.PI * 2 / 28));

              // steps this frame: sim_speed directly (plus a small one-time warm-up burst)
              let steps = Math.max(1, Math.min(30, Math.round(rs.sim_speed ?? 12)));
              if (rdSt.warm > 0) { const ex = Math.min(rdSt.warm, 24); rdSt.warm -= ex; steps += ex; }

              for (let it = 0; it < steps; it++) {
                  for (let y = 0; y < h; y++) {
                      const yUp = (y === 0 ? h - 1 : y - 1) * w;
                      const yDn = (y === h - 1 ? 0 : y + 1) * w;
                      const yC = y * w;
                      for (let x = 0; x < w; x++) {
                          const xL = x === 0 ? w - 1 : x - 1;
                          const xR = x === w - 1 ? 0 : x + 1;
                          const i = yC + x;
                          const av = a[i], bv = b[i];
                          const lapA = (a[yC + xL] + a[yC + xR] + a[yUp + x] + a[yDn + x]) * 0.2
                                     + (a[yUp + xL] + a[yUp + xR] + a[yDn + xL] + a[yDn + xR]) * 0.05 - av;
                          const lapB = (b[yC + xL] + b[yC + xR] + b[yUp + x] + b[yDn + x]) * 0.2
                                     + (b[yUp + xL] + b[yUp + xR] + b[yDn + xL] + b[yDn + xR]) * 0.05 - bv;
                          const abb = av * bv * bv;
                          const na = av + (DA * lapA - abb + fNow * (1.0 - av));
                          const nb = bv + (DB * lapB + abb - (kBase + fNow) * bv);
                          a2[i] = na < 0 ? 0 : (na > 1 ? 1 : na);
                          b2[i] = nb < 0 ? 0 : (nb > 1 ? 1 : nb);
                      }
                  }
                  const ta = a; a = a2; a2 = ta;
                  const tb = b; b = b2; b2 = tb;
              }
              rdSt.a = a; rdSt.b = b; rdSt.a2 = a2; rdSt.b2 = b2;

              const thr = Math.max(0.02, Math.min(0.6, rs.threshold ?? 0.22));
              const px8 = rdSt.img.data as Uint8ClampedArray;
              for (let i = 0; i < w * h; i++) {
                  const p4 = i * 4;
                  if (b[i] > thr) { px8[p4] = rdInkRgb.r; px8[p4 + 1] = rdInkRgb.g; px8[p4 + 2] = rdInkRgb.b; }
                  else { px8[p4] = rdPaperRgb.r; px8[p4 + 1] = rdPaperRgb.g; px8[p4 + 2] = rdPaperRgb.b; }
                  px8[p4 + 3] = 255;
              }
              rdSt.grid.getContext('2d')!.putImageData(rdSt.img, 0, 0);

              ctx.imageSmoothingEnabled = false;
              ctx.fillStyle = rdPaper;
              ctx.fillRect(0, 0, targetW, targetH);
              ctx.drawImage(rdSt.grid, 0, 0, w, h, 0, 0, targetW, targetH);

              element = canvas;
          } else if (def.uuid === 'voronoi-cells-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const vPage = resolvedGenerativeColors['background'] || '#ffffff';
              const vLine = resolvedGenerativeColors['lines'] || '#000000';
              const vHi = resolvedGenerativeColors['highlight'] || '#ff3b00';
              const vs = modifiedSettings;
              const nSeeds = Math.max(6, Math.min(80, Math.round(vs.seeds ?? 34)));
              const vDrift = Math.max(0, vs.drift ?? 1);
              const vLw = Math.max(0.5, vs.line_weight ?? 1);
              const vShowHi = (vs.highlight ?? 1) > 0.5;
              const vReseed = Number(vs.reseed ?? 0);

              let vSt = voronoiStateRef.current[layer.id];
              if (!vSt || vSt.n !== nSeeds || vReseed > (vSt?.lastReseed ?? 0)) {
                  const seeds: any[] = [];
                  for (let i = 0; i < nSeeds; i++) {
                      seeds.push({
                          bx: 0.08 + Math.random() * 0.84, by: 0.08 + Math.random() * 0.84,
                          ax: 0.04 + Math.random() * 0.26, ay: 0.04 + Math.random() * 0.26,
                          fx: 0.5 + Math.random() * 1.6, fy: 0.5 + Math.random() * 1.6,
                          px: Math.random() * 6.283, py: Math.random() * 6.283,
                      });
                  }
                  vSt = { n: nSeeds, seeds, lastReseed: vReseed, grid: document.createElement('canvas'), img: null };
                  voronoiStateRef.current[layer.id] = vSt;
              }

              const vt = nowSec * 0.12 * vDrift;
              const vSX = new Float32Array(nSeeds), vSY = new Float32Array(nSeeds);
              for (let i = 0; i < nSeeds; i++) {
                  const s = vSt.seeds[i];
                  vSX[i] = (s.bx + s.ax * Math.sin(vt * s.fx + s.px)) * targetW;
                  vSY[i] = (s.by + s.ay * Math.cos(vt * s.fy + s.py)) * targetH;
              }

              const vGW = Math.min(500, Math.max(200, Math.round(targetW * 0.5)));
              const vGH = Math.max(1, Math.round(vGW * targetH / Math.max(1, targetW)));
              const vGrid: HTMLCanvasElement = vSt.grid;
              vGrid.width = vGW; vGrid.height = vGH;
              const vgctx = vGrid.getContext('2d')!;
              if (!vSt.img || vSt.img.width !== vGW || vSt.img.height !== vGH) vSt.img = vgctx.createImageData(vGW, vGH);
              const vDat = vSt.img.data;
              const vP = hexToRgb(vPage), vL = hexToRgb(vLine), vH = hexToRgb(vHi);

              let centreOwner = 0, cBest = 1e18;
              for (let i = 0; i < nSeeds; i++) {
                  const dx = vSX[i] - targetW / 2, dy = vSY[i] - targetH / 2;
                  const d = dx * dx + dy * dy;
                  if (d < cBest) { cBest = d; centreOwner = i; }
              }
              const vEdge = (1.4 + vLw * 0.9) * (targetW / vGW);
              const kx = targetW / vGW, ky = targetH / vGH;
              for (let y = 0; y < vGH; y++) {
                  const wy = (y + 0.5) * ky;
                  for (let x = 0; x < vGW; x++) {
                      const wx = (x + 0.5) * kx;
                      let d1 = 1e18, d2 = 1e18, o1 = 0;
                      for (let i = 0; i < nSeeds; i++) {
                          const dx = vSX[i] - wx, dy = vSY[i] - wy;
                          const d = dx * dx + dy * dy;
                          if (d < d1) { d2 = d1; d1 = d; o1 = i; } else if (d < d2) { d2 = d; }
                      }
                      const gap = Math.sqrt(d2) - Math.sqrt(d1);
                      const p4 = (y * vGW + x) * 4;
                      let R = vP.r, G = vP.g, Bv = vP.b;
                      if (gap < vEdge) { R = vL.r; G = vL.g; Bv = vL.b; }
                      else if (vShowHi && o1 === centreOwner) { R = vH.r; G = vH.g; Bv = vH.b; }
                      vDat[p4] = R; vDat[p4 + 1] = G; vDat[p4 + 2] = Bv; vDat[p4 + 3] = 255;
                  }
              }
              vgctx.putImageData(vSt.img, 0, 0);
              ctx.imageSmoothingEnabled = false;
              ctx.fillStyle = vPage; ctx.fillRect(0, 0, targetW, targetH);
              ctx.drawImage(vGrid, 0, 0, vGW, vGH, 0, 0, targetW, targetH);
              element = canvas;
          } else if (def.uuid === 'contour-lines-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const cPaper = resolvedGenerativeColors['background'] || '#ede9e2';
              const cLine = resolvedGenerativeColors['lines'] || '#1a1a1a';
              const cLabelCol = resolvedGenerativeColors['label'] || cLine;
              const cs = modifiedSettings;
              const cLevels = Math.max(4, Math.min(28, Math.round(cs.levels ?? 14)));
              const cZoom = Math.max(0.3, cs.zoom ?? 1);
              const cCrawl = Math.max(0, cs.crawl ?? 1);
              const cLw = Math.max(0.4, cs.line_weight ?? 1) * (Math.min(targetW, targetH) / 900);
              const cLabel = (typeof cs.label === 'string' && cs.label.trim()) ? cs.label : 'SURVEY / FIELD NOTES / SECTOR 07 / SHEET 1 OF 1';

              ctx.fillStyle = cPaper; ctx.fillRect(0, 0, targetW, targetH);

              const h3 = (x: number, y: number, z: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
              const lerp = (a: number, b: number, tt: number) => a + (b - a) * tt;
              const vnoise = (x: number, y: number, z: number) => {
                  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
                  const xf = x - xi, yf = y - yi, zf = z - zi;
                  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
                  const c = (dx: number, dy: number, dz: number) => h3(xi + dx, yi + dy, zi + dz);
                  return lerp(
                      lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
                      lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
              };
              const fbm3 = (x: number, y: number, z: number) =>
                  vnoise(x, y, z) * 0.62 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3, z * 1.7) * 0.28 + vnoise(x * 4.4 + 9.1, y * 4.4 + 7.7, z * 2.3) * 0.1;

              const cCols = Math.min(190, Math.max(24, Math.round(targetW / 9)));
              const cRows = Math.max(2, Math.round(cCols * targetH / Math.max(1, targetW)));
              const fscale = 3.1 * cZoom;
              const aspN = targetH / Math.max(1, targetW);
              const zc = nowSec * 0.05 * cCrawl;
              const fld = new Float32Array((cCols + 1) * (cRows + 1));
              for (let j = 0; j <= cRows; j++) for (let i = 0; i <= cCols; i++) {
                  fld[j * (cCols + 1) + i] = fbm3(i / cCols * fscale, j / cRows * fscale * aspN, zc);
              }
              const cw2 = targetW / cCols, ch2 = targetH / cRows;
              ctx.strokeStyle = cLine; ctx.lineWidth = cLw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
              ctx.beginPath();
              for (let L = 0; L < cLevels; L++) {
                  const iso = 0.2 + (L + 0.5) / cLevels * 0.6;
                  for (let j = 0; j < cRows; j++) {
                      for (let i = 0; i < cCols; i++) {
                          const a = fld[j * (cCols + 1) + i], b = fld[j * (cCols + 1) + i + 1];
                          const cc = fld[(j + 1) * (cCols + 1) + i + 1], d = fld[(j + 1) * (cCols + 1) + i];
                          let code = 0;
                          if (a > iso) code |= 8;
                          if (b > iso) code |= 4;
                          if (cc > iso) code |= 2;
                          if (d > iso) code |= 1;
                          if (code === 0 || code === 15) continue;
                          const x0 = i * cw2, y0 = j * ch2;
                          const it = (p: number, q: number) => (iso - p) / ((q - p) || 1e-6);
                          const tp = [x0 + cw2 * it(a, b), y0];
                          const rt = [x0 + cw2, y0 + ch2 * it(b, cc)];
                          const bt = [x0 + cw2 * it(d, cc), y0 + ch2];
                          const lf = [x0, y0 + ch2 * it(a, d)];
                          const seg = (p: number[], q: number[]) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
                          switch (code) {
                              case 1: case 14: seg(lf, bt); break;
                              case 2: case 13: seg(bt, rt); break;
                              case 3: case 12: seg(lf, rt); break;
                              case 4: case 11: seg(tp, rt); break;
                              case 5: seg(lf, tp); seg(bt, rt); break;
                              case 6: case 9: seg(tp, bt); break;
                              case 7: case 8: seg(lf, tp); break;
                              case 10: seg(lf, bt); seg(tp, rt); break;
                          }
                      }
                  }
              }
              ctx.stroke();

              // tiny italic survey numbers dropped into gaps
              const cFs = Math.max(8, Math.round(Math.min(targetW, targetH) / 95));
              ctx.font = `italic ${cFs}px Georgia, 'Times New Roman', serif`;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              for (let g = 0; g < 48; g++) {
                  const gx = (((g * 0.6180339) % 1)) * targetW;
                  const gy = (((g * 0.2419 + 0.13) % 1)) * targetH;
                  const hh = fbm3(gx / targetW * fscale, gy / targetH * fscale * aspN, zc);
                  const cont = (hh - 0.2) / 0.6 * cLevels;
                  const lvl = Math.round(cont);
                  if (lvl < 0 || lvl >= cLevels) continue;
                  const frac = ((cont % 1) + 1) % 1;
                  if (frac > 0.12 && frac < 0.88) continue;
                  ctx.fillStyle = cPaper;
                  ctx.fillRect(gx - cFs * 1.3, gy - cFs * 0.65, cFs * 2.6, cFs * 1.3);
                  ctx.fillStyle = cLabelCol;
                  ctx.fillText(String(40 + lvl * 10), gx, gy);
              }

              // bottom-left type block
              const bmx = Math.round(Math.min(targetW, targetH) * 0.045);
              const bBase = targetH - bmx;
              const metaFs = Math.max(9, Math.round(Math.min(targetW, targetH) / 88));
              const headFs = Math.round(metaFs * 2.5);
              const parts = cLabel.toUpperCase().split('/').map(s => s.trim()).filter(Boolean);
              ctx.fillStyle = cLabelCol; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
              ctx.font = `${metaFs}px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
              ctx.fillText((parts[0] || 'FIELD NOTES') + (parts[1] ? '   ' + parts[1] : ''), bmx, bBase - headFs * 4.2);
              ctx.font = `700 ${headFs}px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
              const headWords = (parts.slice(2).join(' ') || cLabel).toUpperCase().split(/\s+/);
              const lines: string[] = [];
              let curLine = '';
              for (const wd of headWords) {
                  if ((curLine + ' ' + wd).trim().length > 15 && curLine) { lines.push(curLine); curLine = wd; }
                  else curLine = (curLine + ' ' + wd).trim();
              }
              if (curLine) lines.push(curLine);
              const filler = ['ISOLINE', 'FIELD', 'SURVEY', 'SHEET'];
              while (lines.length < 4) lines.push(filler[lines.length]);
              for (let li = 0; li < 4; li++) ctx.fillText(lines[li], bmx, bBase - headFs * (3 - li) + headFs * 0.15);
              element = canvas;
          } else if (def.uuid === 'neon-labyrinth-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const nl = modifiedSettings;
              const nlBg = resolvedGenerativeColors['background'] || '#05060f';
              const nlWall = resolvedGenerativeColors['walls'] || '#2b1a63';
              const nlPellet = resolvedGenerativeColors['pellets'] || '#ffe600';
              const nlGhost = resolvedGenerativeColors['ghosts'] || '#ff2e88';
              const nlDens = Math.max(0, Math.min(1, nl.corridor_density ?? 0.55));
              const nlAggr = Math.max(0, Math.min(1, nl.ghost_aggression ?? 0.5));
              const nlDecay = Math.max(0, Math.min(1, nl.glow_decay ?? 0.6));
              const nlWrap = Math.max(0, Math.min(6, nl.wrap_frequency ?? 2));
              const nlSurgeA = Number(nl.power_surge ?? 0), nlReseedA = Number(nl.grid_reseed ?? 0);
              const nlCols = 16, nlRows = Math.max(7, Math.round(16 * targetH / Math.max(1, targetW)));
              let nlS = neonLabyrinthStateRef.current[layer.id];
              if (!nlS || nlS.cols !== nlCols || nlS.rows !== nlRows) {
                  nlS = { cols: nlCols, rows: nlRows, seed: (Math.random() * 1e9) | 0, moveAcc: 0,
                          player: { cx: nlCols >> 1, cy: nlRows >> 1, rx: nlCols >> 1, ry: nlRows >> 1, trail: [] as any[] },
                          ghosts: [] as any[], surgeUntil: 0, lastSurge: nlSurgeA, lastReseed: nlReseedA };
                  for (let i = 0; i < 4; i++) nlS.ghosts.push({ cx: i % 2 ? 1 : nlCols - 2, cy: i < 2 ? 1 : nlRows - 2, rx: 0, ry: 0 });
                  for (const g of nlS.ghosts) { g.rx = g.cx; g.ry = g.cy; }
                  neonLabyrinthStateRef.current[layer.id] = nlS;
              }
              if (nlReseedA > nlS.lastReseed) { nlS.seed = (Math.random() * 1e9) | 0; nlS.lastReseed = nlReseedA; }
              if (nlSurgeA > nlS.lastSurge) { nlS.surgeUntil = nowSec + 5; nlS.lastSurge = nlSurgeA; }
              const nlSurging = nowSec < nlS.surgeUntil;
              const nlWH = (a: number, b: number) => { const n = Math.sin(a * 127.1 + b * 311.7 + nlS.seed * 0.00013) * 43758.5453; return n - Math.floor(n); };
              const nlRight = (cx: number, cy: number) => cx < nlCols - 1 && nlWH(cx * 2 + 1, cy * 3) < nlDens * 0.7;
              const nlDown = (cx: number, cy: number) => cy < nlRows - 1 && nlWH(cx * 3, cy * 2 + 1) < nlDens * 0.7;
              const cw = targetW / nlCols, ch = targetH / nlRows;
              const nlTick = 0.16 / (0.55 + nlAggr) / (nlSurging ? 1.7 : 1);
              nlS.moveAcc += (deltaTime || 16.7) / 1000;
              const nlStep = nlS.moveAcc >= nlTick;
              if (nlStep) nlS.moveAcc = 0;
              const nlMove = (e: any, tX: number, tY: number, aggro: number) => {
                  const opts: number[][] = [];
                  if (e.cx < nlCols - 1 && !nlRight(e.cx, e.cy)) opts.push([1, 0]);
                  if (e.cx > 0 && !nlRight(e.cx - 1, e.cy)) opts.push([-1, 0]);
                  if (e.cy < nlRows - 1 && !nlDown(e.cx, e.cy)) opts.push([0, 1]);
                  if (e.cy > 0 && !nlDown(e.cx, e.cy - 1)) opts.push([0, -1]);
                  if (!opts.length) return;
                  let pick = opts[(Math.random() * opts.length) | 0];
                  if (Math.random() < aggro) {
                      pick = opts.reduce((pa, cb) => Math.hypot(e.cx + cb[0] - tX, e.cy + cb[1] - tY) < Math.hypot(e.cx + pa[0] - tX, e.cy + pa[1] - tY) ? cb : pa);
                  }
                  e.cx += pick[0]; e.cy += pick[1];
                  if (nlWrap >= 1 && nlWH(e.cy, 7.0) < nlWrap / 6) {
                      if (e.cx < 0) e.cx = nlCols - 1; else if (e.cx > nlCols - 1) e.cx = 0;
                  }
                  e.cx = Math.max(0, Math.min(nlCols - 1, e.cx)); e.cy = Math.max(0, Math.min(nlRows - 1, e.cy));
              };
              const nlP = nlS.player;
              if (nlStep) {
                  nlMove(nlP, Math.random() * nlCols, Math.random() * nlRows, 0.2);
                  nlP.trail.push([nlP.cx, nlP.cy, nowSec]);
                  const tLife = (nlSurging ? 3.4 : 1.5) * (0.35 + (1 - nlDecay) * 1.9);
                  while (nlP.trail.length && nowSec - nlP.trail[0][2] > tLife) nlP.trail.shift();
                  for (const g of nlS.ghosts) nlMove(g, nlP.cx, nlP.cy, nlSurging ? 0.04 : 0.15 + nlAggr * 0.8);
              }
              const nlLerp = Math.min(1, ((deltaTime || 16.7) / 1000) / Math.max(0.03, nlTick));
              nlP.rx += (nlP.cx - nlP.rx) * nlLerp; nlP.ry += (nlP.cy - nlP.ry) * nlLerp;
              for (const g of nlS.ghosts) { g.rx += (g.cx - g.rx) * nlLerp; g.ry += (g.cy - g.ry) * nlLerp; }

              ctx.fillStyle = nlBg; ctx.fillRect(0, 0, targetW, targetH);
              if (nlSurging) { ctx.fillStyle = nlGhost; ctx.globalAlpha = 0.16 + 0.1 * Math.sin(nowSec * 30); ctx.fillRect(0, 0, targetW, targetH); ctx.globalAlpha = 1; }
              ctx.strokeStyle = nlWall; ctx.lineWidth = Math.max(1.5, S * 0.006);
              ctx.shadowColor = nlWall; ctx.shadowBlur = S * 0.018; ctx.lineCap = 'round';
              ctx.beginPath();
              for (let cy = 0; cy < nlRows; cy++) for (let cx = 0; cx < nlCols; cx++) {
                  if (nlRight(cx, cy)) { ctx.moveTo((cx + 1) * cw, cy * ch); ctx.lineTo((cx + 1) * cw, (cy + 1) * ch); }
                  if (nlDown(cx, cy)) { ctx.moveTo(cx * cw, (cy + 1) * ch); ctx.lineTo((cx + 1) * cw, (cy + 1) * ch); }
              }
              ctx.rect(2, 2, targetW - 4, targetH - 4);
              ctx.stroke(); ctx.shadowBlur = 0;
              ctx.fillStyle = nlPellet;
              const nlPr = Math.max(1.1, S * 0.005);
              for (let cy = 0; cy < nlRows; cy++) for (let cx = 0; cx < nlCols; cx++) {
                  if ((cx * 7 + cy * 5) % 3 === 0) continue;
                  ctx.beginPath(); ctx.arc((cx + 0.5) * cw, (cy + 0.5) * ch, nlPr, 0, 6.283); ctx.fill();
              }
              ctx.strokeStyle = nlPellet; ctx.lineJoin = 'round';
              ctx.shadowColor = nlPellet; ctx.shadowBlur = S * 0.03;
              ctx.lineWidth = Math.max(2, S * 0.013 * (nlSurging ? 1.6 : 1));
              ctx.beginPath();
              for (let i = 0; i < nlP.trail.length; i++) { const tp = nlP.trail[i]; const x = (tp[0] + 0.5) * cw, y = (tp[1] + 0.5) * ch; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
              ctx.lineTo((nlP.rx + 0.5) * cw, (nlP.ry + 0.5) * ch);
              ctx.stroke();
              ctx.fillStyle = nlPellet; ctx.beginPath(); ctx.arc((nlP.rx + 0.5) * cw, (nlP.ry + 0.5) * ch, S * 0.015, 0, 6.283); ctx.fill();
              ctx.shadowBlur = 0;
              for (const g of nlS.ghosts) {
                  ctx.fillStyle = nlGhost; ctx.shadowColor = nlGhost; ctx.shadowBlur = S * 0.022;
                  const gx = (g.rx + 0.5) * cw, gy = (g.ry + 0.5) * ch, gr = S * 0.016;
                  ctx.beginPath(); ctx.arc(gx, gy - gr * 0.15, gr, Math.PI, 0);
                  ctx.lineTo(gx + gr, gy + gr);
                  for (let k = 0; k < 3; k++) { ctx.lineTo(gx + gr - (k + 0.5) * (gr * 2 / 3), gy + gr * 0.5); ctx.lineTo(gx + gr - (k + 1) * (gr * 2 / 3), gy + gr); }
                  ctx.closePath(); ctx.fill();
              }
              ctx.shadowBlur = 0;
              element = canvas;
          } else if (def.uuid === 'pixel-swarm-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const ps = modifiedSettings;
              const psBg = resolvedGenerativeColors['background'] || '#04120a';
              const psInv = resolvedGenerativeColors['invaders'] || '#39ff88';
              const psBul = resolvedGenerativeColors['bullets'] || '#eaffea';
              const psAcc = resolvedGenerativeColors['accent'] || '#00b34a';
              const psMarch = Math.max(0.1, ps.march_speed ?? 1);
              const psRowSp = Math.max(0.4, ps.row_spacing ?? 1);
              const psBarrage = Math.max(0, ps.barrage_rate ?? 1);
              const psJit = Math.max(0, Math.min(1, ps.jitter_amplitude ?? 0.15));
              const psStepA = Number(ps.step_down ?? 0), psScatA = Number(ps.scatter_strike ?? 0);
              const dtSec = Math.min(0.05, (deltaTime || 16.7) / 1000);
              const psCols = 11, psRows = 5;
              let psS = pixelSwarmStateRef.current[layer.id];
              if (!psS) {
                  psS = { ox: 0, dir: 1, drop: 0, tempo: 1, bullets: [] as any[], scatter: [] as any[],
                          lastStep: psStepA, lastScat: psScatA, fireAcc: 0 };
                  pixelSwarmStateRef.current[layer.id] = psS;
              }
              if (psStepA > psS.lastStep) { psS.drop += 1; psS.tempo *= 1.15; psS.lastStep = psStepA; }
              if (psScatA > psS.lastScat) {
                  psS.lastScat = psScatA;
                  for (let k = 0; k < 3; k++) psS.scatter.push({ col: (Math.random() * psCols) | 0, row: (Math.random() * psRows) | 0, t: 0, dur: 2.2, phase: Math.random() * 6.28 });
              }
              const cellW = targetW / (psCols + 3);
              const cellH = cellW * 0.82 * psRowSp;
              const amp = cellW * 1.4;
              psS.ox += psS.dir * psMarch * psS.tempo * dtSec * 60 * (cellW * 0.02);
              if (psS.ox > amp) { psS.ox = amp; psS.dir = -1; psS.drop += 0.5; }
              else if (psS.ox < -amp) { psS.ox = -amp; psS.dir = 1; psS.drop += 0.5; }
              const formTop = targetH * 0.14 + psS.drop * cellH * 0.6;
              const formLeft = targetW * 0.5 - (psCols - 1) * cellW * 0.5;
              // fire barrage
              psS.fireAcc += dtSec * psBarrage * (1.2 + psS.tempo * 0.5);
              while (psS.fireAcc > 1) {
                  psS.fireAcc -= 1;
                  const c = (Math.random() * psCols) | 0;
                  psS.bullets.push({ x: formLeft + c * cellW + psS.ox, y: formTop + (psRows - 1) * cellH, vy: (2.4 + Math.random() * 1.5), z: Math.random() < 0.5 });
              }
              for (const b of psS.bullets) { b.y += b.vy * dtSec * 60 * (S * 0.006); }
              psS.bullets = psS.bullets.filter((b: any) => b.y < targetH + 20);
              for (const s of psS.scatter) s.t += dtSec;
              psS.scatter = psS.scatter.filter((s: any) => s.t < s.dur + 0.5);

              ctx.fillStyle = psBg; ctx.fillRect(0, 0, targetW, targetH);
              // subtle scanlines
              ctx.fillStyle = psAcc; ctx.globalAlpha = 0.06;
              for (let y = 0; y < targetH; y += 3) ctx.fillRect(0, y, targetW, 1);
              ctx.globalAlpha = 1;
              const bmp = [0x08, 0x1c, 0x3e, 0x6b, 0x7f, 0x2a, 0x14, 0x22]; // 8x8-ish invader rows (7 wide)
              const px = cellW / 9;
              const drawInv = (gx: number, gy: number, tint: string) => {
                  ctx.fillStyle = tint;
                  const jx = psJit ? (Math.round((Math.random() - 0.5) * psJit * 4) * px) : 0;
                  const jy = psJit ? (Math.round((Math.random() - 0.5) * psJit * 4) * px) : 0;
                  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
                      if ((bmp[r] >> (6 - c)) & 1) ctx.fillRect(gx + jx + c * px, gy + jy + r * px, px + 0.6, px + 0.6);
                  }
              };
              for (let r = 0; r < psRows; r++) for (let c = 0; c < psCols; c++) {
                  const inScatter = psS.scatter.find((s: any) => s.col === c && s.row === r && s.t < s.dur);
                  let gx = formLeft + c * cellW + psS.ox;
                  let gy = formTop + r * cellH;
                  if (inScatter) {
                      const k = inScatter.t / inScatter.dur;
                      gx += Math.sin(inScatter.t * 6 + inScatter.phase) * cellW * 2.2 * Math.sin(k * Math.PI);
                      gy += Math.sin(k * Math.PI) * targetH * 0.28;
                  }
                  drawInv(gx - 3.5 * px, gy - 3.5 * px, r === 0 ? psAcc : psInv);
              }
              ctx.fillStyle = psBul;
              for (const b of psS.bullets) {
                  if (b.z) ctx.fillRect(b.x - px * 0.6, b.y, px * 1.2, px * 3);
                  else { ctx.fillRect(b.x - px, b.y, px * 2, px); ctx.fillRect(b.x - px * 0.5, b.y + px * 1.5, px, px); }
              }
              element = canvas;
          } else if (def.uuid === 'tetromino-cascade-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const ts = modifiedSettings;
              const tBg = resolvedGenerativeColors['background'] || '#0c0c10';
              const tBlk = resolvedGenerativeColors['blocks'] || '#e63946';
              const tGrid = resolvedGenerativeColors['grid'] || '#1d3557';
              const tFlash = resolvedGenerativeColors['flash'] || '#f1faee';
              const tFall = Math.max(0.2, ts.fall_velocity ?? 1.6);
              const tChaos = Math.max(0, Math.min(1, ts.grid_chaos ?? 0.15));
              const tBounce = Math.max(0, Math.min(1, ts.settle_bounciness ?? 0.3));
              const tDens = Math.max(0, Math.min(0.9, ts.line_density ?? 0.25));
              const tClearA = Number(ts.line_clear ?? 0), tInvA = Number(ts.gravity_invert ?? 0);
              const dtS = Math.min(0.05, (deltaTime || 16.7) / 1000);
              const tCols = 12, tRows = Math.max(10, Math.round(12 * targetH / Math.max(1, targetW)));
              const SHAPES = [[[0,0],[1,0],[0,1],[1,1]], [[0,0],[1,0],[2,0],[3,0]], [[0,0],[1,0],[2,0],[1,1]], [[0,0],[1,0],[1,1],[2,1]], [[1,0],[2,0],[0,1],[1,1]], [[0,0],[0,1],[1,1],[2,1]], [[2,0],[0,1],[1,1],[2,1]]];
              const ODD = [[[0,0],[1,0],[0,1]], [[0,0],[1,0],[2,0],[1,1],[1,2]], [[0,0]], [[0,0],[1,0]]];
              const tCol = (n: number) => { const h = (n * 47) % 360; return `hsl(${h} 70% 58%)`; };
              let tS = tetrominoStateRef.current[layer.id];
              const newPiece = () => {
                  const useOdd = Math.random() < tChaos;
                  const src = useOdd ? ODD[(Math.random() * ODD.length) | 0] : SHAPES[(Math.random() * SHAPES.length) | 0];
                  return { cells: src.map(c => [c[0], c[1]]), x: (tCols / 2 - 1) | 0, y: -2, yf: -2, vy: 0, ci: (Math.random() * 6) | 0, settling: 0 };
              };
              if (!tS || tS.cols !== tCols || tS.rows !== tRows) {
                  const grid: number[] = new Array(tCols * tRows).fill(-1);
                  const baseRows = Math.round(tRows * tDens);
                  for (let r = tRows - baseRows; r < tRows; r++) for (let c = 0; c < tCols; c++) if (Math.random() > 0.28) grid[r * tCols + c] = (Math.random() * 6) | 0;
                  tS = { cols: tCols, rows: tRows, grid, piece: newPiece(), invertUntil: 0, lastClear: tClearA, lastInv: tInvA, flashRows: [] as number[], flashT: 0, dir: 1 };
                  tetrominoStateRef.current[layer.id] = tS;
              }
              if (tInvA > tS.lastInv) { tS.invertUntil = nowSec + 1.4; tS.lastInv = tInvA; }
              const invert = nowSec < tS.invertUntil;
              tS.dir = invert ? -1 : 1;
              const collide = (cells: number[][], px: number, py: number) => {
                  for (const c of cells) {
                      const gx = px + c[0], gy = Math.floor(py) + c[1];
                      if (gx < 0 || gx >= tCols) return true;
                      if (gy >= tRows) return true;
                      if (gy >= 0 && tS.grid[gy * tCols + gx] >= 0) return true;
                  }
                  return false;
              };
              const pc = tS.piece;
              pc.vy += (invert ? -1 : 1) * tFall * dtS * 22;
              pc.vy = Math.max(-14, Math.min(16, pc.vy));
              let ny = pc.yf + pc.vy * dtS * 3.4;
              if (!collide(pc.cells, pc.x, ny)) { pc.yf = ny; pc.y = Math.floor(ny); }
              else {
                  if (Math.abs(pc.vy) > 3 && tBounce > 0.05 && pc.settling < 2) { pc.vy = -pc.vy * tBounce * 0.55; pc.settling++; }
                  else {
                      for (const c of pc.cells) { const gx = pc.x + c[0], gy = Math.floor(pc.yf) + c[1]; if (gy >= 0 && gy < tRows && gx >= 0 && gx < tCols) tS.grid[gy * tCols + gx] = pc.ci; }
                      // check full rows
                      for (let r = 0; r < tRows; r++) { let full = true; for (let c = 0; c < tCols; c++) if (tS.grid[r * tCols + c] < 0) { full = false; break; } if (full) tS.flashRows.push(r); }
                      if (tS.flashRows.length) tS.flashT = nowSec + 0.35;
                      tS.piece = newPiece();
                  }
              }
              if (tClearA > tS.lastClear) {
                  tS.lastClear = tClearA;
                  for (let r = 0; r < tRows; r++) { let cnt = 0; for (let c = 0; c < tCols; c++) if (tS.grid[r * tCols + c] >= 0) cnt++; if (cnt >= tCols - 2) tS.flashRows.push(r); }
                  if (tS.flashRows.length) tS.flashT = nowSec + 0.35;
              }
              if (tS.flashRows.length && nowSec > tS.flashT) {
                  const rem = [...new Set(tS.flashRows)].sort((a, b) => a - b);
                  for (const r of rem) { for (let rr = r; rr > 0; rr--) for (let c = 0; c < tCols; c++) tS.grid[rr * tCols + c] = tS.grid[(rr - 1) * tCols + c]; for (let c = 0; c < tCols; c++) tS.grid[c] = -1; }
                  tS.flashRows = [];
              }
              const cellPx = Math.min(targetW / tCols, targetH / tRows);
              const wellW = cellPx * tCols, wellH = cellPx * tRows;
              const wx0 = (targetW - wellW) / 2, wy0 = (targetH - wellH) / 2;
              ctx.fillStyle = tBg; ctx.fillRect(0, 0, targetW, targetH);
              ctx.strokeStyle = tGrid; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
              ctx.beginPath();
              for (let c = 0; c <= tCols; c++) { ctx.moveTo(wx0 + c * cellPx, wy0); ctx.lineTo(wx0 + c * cellPx, wy0 + wellH); }
              for (let r = 0; r <= tRows; r++) { ctx.moveTo(wx0, wy0 + r * cellPx); ctx.lineTo(wx0 + wellW, wy0 + r * cellPx); }
              ctx.stroke(); ctx.globalAlpha = 1;
              const flashSet = new Set(tS.flashRows);
              const drawCell = (gx: number, gy: number, col: string) => {
                  const x = wx0 + gx * cellPx, y = wy0 + gy * cellPx;
                  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2);
                  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y + 1, cellPx - 2, Math.max(1, cellPx * 0.18));
              };
              for (let r = 0; r < tRows; r++) for (let c = 0; c < tCols; c++) {
                  const v = tS.grid[r * tCols + c];
                  if (v < 0) continue;
                  drawCell(c, r, flashSet.has(r) ? tFlash : (v === 0 ? tBlk : tCol(v)));
              }
              for (const c of pc.cells) {
                  const gx = pc.x + c[0], gy = Math.floor(pc.yf) + c[1];
                  if (gy >= 0) drawCell(gx, gy, pc.ci === 0 ? tBlk : tCol(pc.ci));
              }
              element = canvas;
          } else if (def.uuid === 'hillscape-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const hs = modifiedSettings;
              const hSky = resolvedGenerativeColors['background'] || '#1a2a4a';
              const hTer = resolvedGenerativeColors['terrain'] || '#3aa856';
              const hStr = resolvedGenerativeColors['structures'] || '#2e7d32';
              const hCoin = resolvedGenerativeColors['coins'] || '#ffd23f';
              const hRough = Math.max(0, Math.min(1, hs.terrain_roughness ?? 0.5));
              const hGrav = Math.max(0.2, hs.jump_gravity ?? 1);
              const hPipe = Math.max(0, Math.min(1, hs.pipe_density ?? 0.4));
              const hPar = Math.max(0, Math.min(1, hs.cloud_parallax ?? 0.5));
              const hCoinA = Number(hs.coin_burst ?? 0), hRushA = Number(hs.scroll_rush ?? 0);
              const dtH = Math.min(0.05, (deltaTime || 16.7) / 1000);
              let hS = hillscapeStateRef.current[layer.id];
              if (!hS) hS = hillscapeStateRef.current[layer.id] = { scroll: 0, rushUntil: 0, coins: [] as any[], hopX: targetW * 0.32, hopY: 0, vy: 0, onG: true, lastCoin: hCoinA, lastRush: hRushA };
              if (hRushA > hS.lastRush) { hS.rushUntil = nowSec + 2.5; hS.lastRush = hRushA; }
              const rush = nowSec < hS.rushUntil;
              const baseSpd = (rush ? 3.2 : 1) * (0.6 + hPar) * S * 0.6;
              hS.scroll += baseSpd * dtH;
              const nz = (x: number) => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };
              const terrainY = (wx: number) => {
                  const x = wx * 0.004;
                  const lo = (Math.sin(x * 0.7) * 0.5 + 0.5);
                  const mid = (nz(Math.floor(x)) * (1 - (x - Math.floor(x))) + nz(Math.floor(x) + 1) * (x - Math.floor(x)));
                  return targetH * (0.62 - hRough * 0.22 * (lo * 0.6 + mid * 0.9) - 0.06 * Math.sin(x * 2.3));
              };
              const grav = 2600 * hGrav;
              hS.vy += grav * dtH;
              const groundAt = terrainY(hS.scroll + hS.hopX) - S * 0.03;
              hS.hopY += hS.vy * dtH;
              if (hS.hopY >= groundAt) { hS.hopY = groundAt; hS.vy = -900 - Math.random() * 350; }
              if (hCoinA > hS.lastCoin) {
                  hS.lastCoin = hCoinA;
                  for (let k = 0; k < 10; k++) hS.coins.push({ x: hS.hopX + (Math.random() - 0.5) * 40, y: hS.hopY - S * 0.05, vx: (Math.random() - 0.5) * 260, vy: -420 - Math.random() * 380, t: 0 });
              }
              for (const c of hS.coins) { c.vy += 1800 * dtH; c.x += c.vx * dtH; c.y += c.vy * dtH; c.t += dtH; }
              hS.coins = hS.coins.filter((c: any) => c.t < 2.2 && c.y < targetH + 40);

              const grd = ctx.createLinearGradient(0, 0, 0, targetH);
              grd.addColorStop(0, hSky); grd.addColorStop(1, '#000010');
              ctx.fillStyle = grd; ctx.fillRect(0, 0, targetW, targetH);
              // clouds (parallax)
              ctx.fillStyle = 'rgba(255,255,255,0.5)';
              for (let i = 0; i < 6; i++) {
                  const cx = ((i * 320 - hS.scroll * (0.15 + hPar * 0.25)) % (targetW + 300) + targetW + 300) % (targetW + 300) - 150;
                  const cy = targetH * (0.12 + 0.07 * i % 0.3);
                  ctx.beginPath(); ctx.arc(cx, cy, S * 0.04, 0, 6.283); ctx.arc(cx + S * 0.04, cy + 4, S * 0.03, 0, 6.283); ctx.arc(cx - S * 0.035, cy + 4, S * 0.028, 0, 6.283); ctx.fill();
              }
              // back hills
              ctx.fillStyle = hStr; ctx.globalAlpha = 0.45;
              ctx.beginPath(); ctx.moveTo(0, targetH);
              for (let x = 0; x <= targetW; x += 8) ctx.lineTo(x, terrainY(hS.scroll * 0.4 + x) + S * 0.09);
              ctx.lineTo(targetW, targetH); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
              // terrain
              ctx.fillStyle = hTer;
              ctx.beginPath(); ctx.moveTo(0, targetH);
              for (let x = 0; x <= targetW; x += 6) ctx.lineTo(x, terrainY(hS.scroll + x));
              ctx.lineTo(targetW, targetH); ctx.closePath(); ctx.fill();
              // pipes + ? blocks
              const period = 340 - hPipe * 180;
              for (let k = -1; k < targetW / period + 2; k++) {
                  const wx = k * period - (hS.scroll % period);
                  const seed = Math.floor((hS.scroll + wx) / period);
                  if (nz(seed * 3.3) < hPipe) {
                      const gy = terrainY(hS.scroll + wx);
                      const pw = S * 0.06, phh = S * (0.08 + 0.12 * nz(seed * 7.7));
                      ctx.fillStyle = hStr; ctx.fillRect(wx - pw / 2, gy - phh, pw, phh);
                      ctx.fillRect(wx - pw / 2 - 4, gy - phh, pw + 8, S * 0.03);
                  }
                  if (nz(seed * 5.1 + 2) < hPipe * 0.8) {
                      const by = terrainY(hS.scroll + wx) - S * (0.24 + 0.08 * nz(seed));
                      ctx.fillStyle = hCoin; ctx.fillRect(wx - S * 0.03, by, S * 0.06, S * 0.06);
                      ctx.fillStyle = hStr; ctx.font = `${S * 0.045}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                      ctx.fillText('?', wx, by + S * 0.032);
                  }
              }
              // hopper
              ctx.fillStyle = hCoin;
              ctx.fillRect(hS.hopX - S * 0.022, hS.hopY - S * 0.03, S * 0.044, S * 0.03);
              ctx.fillStyle = hTer; ctx.fillRect(hS.hopX - S * 0.022, hS.hopY - S * 0.03, S * 0.044, S * 0.008);
              // coins
              for (const c of hS.coins) {
                  ctx.fillStyle = hCoin; ctx.globalAlpha = Math.max(0, 1 - c.t / 2.2);
                  const sc = Math.abs(Math.cos(c.t * 12));
                  ctx.fillRect(c.x - S * 0.014 * sc, c.y - S * 0.014, S * 0.028 * sc, S * 0.028);
              }
              ctx.globalAlpha = 1;
              element = canvas;
          } else if (def.uuid === 'orbit-deflection-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const os = modifiedSettings;
              const oBg = resolvedGenerativeColors['background'] || '#12131f';
              const oBrk = resolvedGenerativeColors['bricks'] || '#7aa2f7';
              const oBall = resolvedGenerativeColors['ball'] || '#f7768e';
              const oPad = resolvedGenerativeColors['paddle'] || '#bb9af7';
              const oRings = Math.max(1, Math.min(8, Math.round(os.brick_ring_count ?? 4)));
              const oAccel = Math.max(1, Math.min(1.15, os.ball_speed_multiplier ?? 1.03));
              const oCurve = Math.max(0, Math.min(1, os.paddle_curvature ?? 0.5));
              const oVisc = Math.max(0, Math.min(1, os.trail_viscosity ?? 0.5));
              const oMultA = Number(os.multi_ball ?? 0), oDetA = Number(os.brick_detonation ?? 0);
              const dtO = Math.min(0.05, (deltaTime || 16.7) / 1000);
              const cx = targetW / 2, cy = targetH / 2;
              const segPerRing = 22;
              let oS = orbitDeflectionStateRef.current[layer.id];
              if (!oS || oS.rings !== oRings) {
                  const bricks: number[] = [];
                  for (let r = 0; r < oRings; r++) for (let s = 0; s < segPerRing; s++) bricks.push(1 + ((r + s) % 2));
                  oS = { rings: oRings, bricks, balls: [{ x: cx, y: cy - S * 0.05, a: Math.random() * 6.28, sp: S * 0.42 }], pad: 0, lastMulti: oMultA, lastDet: oDetA };
                  orbitDeflectionStateRef.current[layer.id] = oS;
              }
              oS.pad += dtO * 1.1;
              const r0 = S * 0.14, dr = S * 0.045;
              const arenaR = r0 + oRings * dr + S * 0.06;
              if (oMultA > oS.lastMulti) {
                  oS.lastMulti = oMultA;
                  const add: any[] = [];
                  for (const b of oS.balls.slice(0, 4)) for (const off of [-0.4, 0.4]) add.push({ x: b.x, y: b.y, a: b.a + off, sp: b.sp });
                  oS.balls.push(...add);
                  if (oS.balls.length > 14) oS.balls = oS.balls.slice(-14);
              }
              if (oDetA > oS.lastDet) {
                  oS.lastDet = oDetA;
                  for (let i = 0; i < oS.bricks.length; i++) if (oS.bricks[i] === 1 && Math.random() < 0.6) oS.bricks[i] = 0;
              }
              ctx.fillStyle = oBg;
              if (oVisc > 0.02) { ctx.globalAlpha = 1 - oVisc * 0.82; ctx.fillRect(0, 0, targetW, targetH); ctx.globalAlpha = 1; }
              else ctx.fillRect(0, 0, targetW, targetH);
              // bricks
              for (let r = 0; r < oRings; r++) {
                  const ir = r0 + r * dr, orr = ir + dr * 0.86;
                  for (let s = 0; s < segPerRing; s++) {
                      const hp = oS.bricks[r * segPerRing + s];
                      if (hp <= 0) continue;
                      const a0 = (s / segPerRing) * 6.283 + oS.pad * 0.05 * (r % 2 ? 1 : -1);
                      const a1 = a0 + 6.283 / segPerRing * 0.9;
                      ctx.beginPath();
                      ctx.arc(cx, cy, ir, a0, a1); ctx.arc(cx, cy, orr, a1, a0, true); ctx.closePath();
                      ctx.fillStyle = hp === 2 ? oBrk : oPad; ctx.globalAlpha = hp === 2 ? 0.95 : 0.6;
                      ctx.fill();
                  }
              }
              ctx.globalAlpha = 1;
              // paddles (2 orbiting arcs)
              ctx.strokeStyle = oPad; ctx.lineWidth = S * 0.02; ctx.lineCap = 'round';
              for (let pi = 0; pi < 2; pi++) {
                  const pa = oS.pad + pi * Math.PI;
                  ctx.beginPath(); ctx.arc(cx, cy, arenaR, pa - 0.28, pa + 0.28); ctx.stroke();
              }
              // balls
              for (const b of oS.balls) {
                  b.x += Math.cos(b.a) * b.sp * dtO;
                  b.y += Math.sin(b.a) * b.sp * dtO;
                  const dx = b.x - cx, dy = b.y - cy, dist = Math.hypot(dx, dy) || 1;
                  // brick collision
                  if (dist > r0 - dr && dist < r0 + oRings * dr) {
                      const rr = Math.floor((dist - r0) / dr);
                      let ang = Math.atan2(dy, dx) - oS.pad * 0.05 * (rr % 2 ? 1 : -1);
                      ang = ((ang % 6.283) + 6.283) % 6.283;
                      const ss = Math.floor(ang / (6.283 / segPerRing));
                      const bi = rr * segPerRing + ss;
                      if (rr >= 0 && rr < oRings && oS.bricks[bi] > 0) {
                          oS.bricks[bi]--;
                          b.a = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.3;
                          b.sp = Math.min(S * 1.1, b.sp * oAccel);
                      }
                  }
                  // paddle / wall bounce
                  if (dist > arenaR) {
                      const nrm = Math.atan2(dy, dx);
                      let hitPad = false;
                      for (let pi = 0; pi < 2; pi++) { let da = ((nrm - (oS.pad + pi * Math.PI)) + Math.PI * 3) % (Math.PI * 2) - Math.PI; if (Math.abs(da) < 0.30) { hitPad = true; b.a = nrm + Math.PI + da * oCurve * 2.4; break; } }
                      if (!hitPad) b.a = nrm + Math.PI + (Math.random() - 0.5) * 0.2;
                      b.x = cx + Math.cos(nrm) * (arenaR - 2); b.y = cy + Math.sin(nrm) * (arenaR - 2);
                      b.sp = Math.min(S * 1.1, b.sp * (hitPad ? oAccel : 1));
                  }
                  ctx.fillStyle = oBall; ctx.shadowColor = oBall; ctx.shadowBlur = S * 0.02;
                  ctx.beginPath(); ctx.arc(b.x, b.y, S * 0.012, 0, 6.283); ctx.fill();
              }
              ctx.shadowBlur = 0;
              // regrow bricks slowly
              if (Math.random() < 0.02) { const i = (Math.random() * oS.bricks.length) | 0; if (oS.bricks[i] === 0) oS.bricks[i] = 1; }
              element = canvas;
          } else if (def.uuid === 'centipede-garden-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;
              const S = Math.min(targetW, targetH);
              const gs = modifiedSettings;
              const gBg = resolvedGenerativeColors['background'] || '#071206';
              const gWorm = resolvedGenerativeColors['worm'] || '#39ff88';
              const gObs = resolvedGenerativeColors['obstacles'] || '#b15cff';
              const gAcc = resolvedGenerativeColors['accent'] || '#e6ff5c';
              const gSeg = Math.max(4, Math.min(40, Math.round(gs.segment_count ?? 16)));
              const gObsD = Math.max(0, Math.min(1, gs.obstacle_density ?? 0.4));
              const gTurn = Math.max(0, Math.min(1, gs.turn_radius ?? 0.3));
              const gSpore = Math.max(0, gs.spore_growth_rate ?? 1);
              const gSplitA = Number(gs.segment_split ?? 0), gBloomA = Number(gs.spore_bloom ?? 0);
              const dtC = Math.min(0.05, (deltaTime || 16.7) / 1000);
              const gc = 22, gr = Math.max(10, Math.round(22 * targetH / Math.max(1, targetW)));
              const cellS = targetW / gc;
              let cS = centipedeStateRef.current[layer.id];
              const spawnWorm = (headC: number, dir: number) => {
                  const seg: number[][] = [];
                  for (let i = 0; i < gSeg; i++) seg.push([headC - dir * i * 0.0, -2 - i]);
                  return { seg, dir, down: 0, cd: 0, speed: 3.2 + Math.random() * 1.5 };
              };
              if (!cS || cS.gc !== gc) {
                  const obs: any[] = [];
                  const nObs = Math.round(gc * gr * 0.16 * gObsD * 2.2);
                  for (let i = 0; i < nObs; i++) obs.push({ c: (Math.random() * gc) | 0, r: 2 + ((Math.random() * (gr - 4)) | 0), hp: 3, sz: 1, variant: (Math.random() * 3) | 0, grow: 1 });
                  cS = { gc, gr, worms: [spawnWorm((gc / 2) | 0, 1), spawnWorm(3, 1)], obs, bloomUntil: 0, lastSplit: gSplitA, lastBloom: gBloomA };
                  centipedeStateRef.current[layer.id] = cS;
              }
              if (gBloomA > cS.lastBloom) { cS.bloomUntil = nowSec + 3; cS.lastBloom = gBloomA; }
              if (gSplitA > cS.lastSplit) {
                  cS.lastSplit = gSplitA;
                  const w = cS.worms[(Math.random() * cS.worms.length) | 0];
                  if (w && w.seg.length > 6) {
                      const half = w.seg.splice(w.seg.length >> 1);
                      cS.worms.push({ seg: half.reverse(), dir: -w.dir, down: 0, cd: 0, speed: w.speed });
                  }
              }
              const bloom = nowSec < cS.bloomUntil;
              const obsAt = (c: number, r: number) => cS.obs.find((o: any) => o.hp > 0 && Math.round(o.c) === c && Math.round(o.r) === r);
              for (const w of cS.worms) {
                  w.cd -= dtC * w.speed * (bloom ? 0.7 : 1);
                  if (w.cd <= 0) {
                      w.cd = 1;
                      const head = w.seg[0];
                      let nc = head[0] + w.dir, nr = head[1];
                      const blocked = nc < 0 || nc >= gc || obsAt(Math.round(nc), Math.round(nr));
                      if (blocked) { w.dir = -w.dir; nr = head[1] + 1; nc = head[0] + w.dir; if (nc < 0) nc = 0; if (nc >= gc) nc = gc - 1; if (obsAt(Math.round(nc), Math.round(nr))) { const o = obsAt(Math.round(nc), Math.round(nr)); if (o) o.hp--; } }
                      if (nr > gr + 2) { nr = -2; nc = (Math.random() * gc) | 0; }
                      w.seg.unshift([nc, nr]);
                      w.seg.pop();
                  }
              }
              // obstacle regrow / respawn
              cS.obs = cS.obs.filter((o: any) => o.hp > 0 || (o.dead = (o.dead || 0) + dtC) < 8 / Math.max(0.2, gSpore));
              for (const o of cS.obs) {
                  if (o.hp <= 0 && (o.dead || 0) > 3 / Math.max(0.2, gSpore)) { o.hp = 3; o.variant = (Math.random() * 3) | 0; o.dead = 0; }
                  const target = (bloom ? 2 : 1);
                  o.grow += (target - o.grow) * Math.min(1, dtC * 4);
              }
              const wantObs = Math.round(gc * gr * 0.14 * gObsD * 2.4);
              if (cS.obs.filter((o: any) => o.hp > 0).length < wantObs && Math.random() < gSpore * dtC * 3) {
                  cS.obs.push({ c: (Math.random() * gc) | 0, r: 2 + ((Math.random() * (gr - 4)) | 0), hp: 3, sz: 1, variant: (Math.random() * 3) | 0, grow: 0.2 });
              }

              ctx.fillStyle = gBg; ctx.fillRect(0, 0, targetW, targetH);
              // obstacles
              for (const o of cS.obs) {
                  if (o.hp <= 0) continue;
                  const x = (o.c + 0.5) * cellS, y = (o.r + 0.5) * cellS, rad = cellS * 0.42 * o.grow;
                  ctx.fillStyle = o.variant === 0 ? gObs : (o.variant === 1 ? gAcc : gWorm);
                  ctx.globalAlpha = 0.35 + 0.2 * o.hp;
                  ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.283); ctx.fill();
                  ctx.globalAlpha = 1;
                  ctx.fillStyle = gBg;
                  ctx.beginPath(); ctx.arc(x, y, rad * 0.45, 0, 6.283); ctx.fill();
              }
              // worms
              for (const w of cS.worms) {
                  for (let i = w.seg.length - 1; i >= 0; i--) {
                      const s = w.seg[i];
                      const x = (s[0] + 0.5) * cellS, y = (s[1] + 0.5) * cellS;
                      ctx.fillStyle = i === 0 ? gAcc : gWorm;
                      ctx.shadowColor = gWorm; ctx.shadowBlur = i === 0 ? S * 0.02 : S * 0.008;
                      ctx.beginPath(); ctx.arc(x, y, cellS * (i === 0 ? 0.5 : 0.42), 0, 6.283); ctx.fill();
                  }
              }
              ctx.shadowBlur = 0;
              element = canvas;
          } else if (def.uuid === '3d-polygon-neon-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              
              const polyBg = resolvedGenerativeColors['background'] || '#ffffff';
              const polyWire = resolvedGenerativeColors['wireframe'] || '#eb556b';
              const polyFaces = resolvedGenerativeColors['faces'] || '#7599a4';
              const polyGlow = resolvedGenerativeColors['glow'] || '#f5a6b5';
              const facesRgb = hexToRgb(polyFaces);
              const wireRgb = hexToRgb(polyWire);
              
              if (!isTransparentColor(polyBg)) {
                  ctx.fillStyle = polyBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, shadows, sides, symmetry, size } = modifiedSettings;
              const spd = speed ?? 1.0;
              const shd = shadows ?? 1.0;
              const numSides = Math.max(3, Math.min(16, Math.floor(sides ?? 6)));
              const symm = symmetry ?? 1.0;
              const sz = size ?? 1.0;
              const t = nowSec * spd;
              
              interface Vec3 { x: number; y: number; z: number; }
              
              const rawPts: Vec3[] = [];
              const edges: [number, number][] = [];
              const faces: [number, number, number][] = [];
              
              // Top & bottom vertices
              rawPts.push({ x: 0, y: 1.25, z: 0 });  // 0: top
              rawPts.push({ x: 0, y: -1.25, z: 0 }); // 1: bottom
              
              // Equatorial vertices
              for (let i = 0; i < numSides; i++) {
                 const angle = (i / numSides) * Math.PI * 2;
                 const rad = 1.0 - (1.0 - symm) * (i % 2 === 0 ? 0.45 : 0.0);
                 rawPts.push({
                     x: Math.cos(angle) * rad,
                     y: 0,
                     z: Math.sin(angle) * rad
                 });
              }
              
              for (let i = 0; i < numSides; i++) {
                 const curr = 2 + i;
                 const next = 2 + ((i + 1) % numSides);
                 edges.push([0, curr]);
                 edges.push([1, curr]);
                 edges.push([curr, next]);
                 
                 // Face triangles
                 faces.push([0, next, curr]);
                 faces.push([1, curr, next]);
              }
              
              const scale = Math.min(targetW, targetH) * 0.24 * Math.max(0.1, Math.min(2.4, sz));
              const focal = scale * 3.4;
              const rotX = t * 0.5;
              const rotY = t * 0.7;
              
              // 3D rotation function
              const rotate3D = (p: Vec3): Vec3 => {
                 // Rotate X
                 const y1 = p.y * Math.cos(rotX) - p.z * Math.sin(rotX);
                 const z1 = p.y * Math.sin(rotX) + p.z * Math.cos(rotX);
                 // Rotate Y
                 const x2 = p.x * Math.cos(rotY) + z1 * Math.sin(rotY);
                 const z2 = -p.x * Math.sin(rotY) + z1 * Math.cos(rotY);
                 return { x: x2, y: y1, z: z2 };
              };
              
              const rotatedPts = rawPts.map(rotate3D);
              
              // Project to screen
              const projPts = rotatedPts.map(p => {
                 const f = focal / (focal + p.z * scale);
                 return {
                     x: targetW / 2 + p.x * scale * f,
                     y: targetH / 2 + p.y * scale * f,
                     z: p.z
                 };
              });
              
              // Light direction vector (from upper right front)
              const lx = 0.55, ly = -0.7, lz = 0.45;
              const lLen = Math.hypot(lx, ly, lz) || 1;
              const lightNorm = { x: lx / lLen, y: ly / lLen, z: lz / lLen };
              
              interface FaceInfo {
                 indices: [number, number, number];
                 p0: { x: number; y: number; z: number };
                 p1: { x: number; y: number; z: number };
                 p2: { x: number; y: number; z: number };
                 isFront: boolean;
                 fillColor: string;
                 centerZ: number;
              }
              
              const faceList: FaceInfo[] = [];
              
              for (const face of faces) {
                 const p0 = projPts[face[0]];
                 const p1 = projPts[face[1]];
                 const p2 = projPts[face[2]];
                 
                 const cross2D = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
                 const isFront = cross2D >= 0;
                 
                 const v0 = rotatedPts[face[0]];
                 const v1 = rotatedPts[face[1]];
                 const v2 = rotatedPts[face[2]];
                 
                 const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
                 const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
                 
                 const nx = e1y * e2z - e1z * e2y;
                 const ny = e1z * e2x - e1x * e2z;
                 const nz = e1x * e2y - e1y * e2x;
                 const nLen = Math.hypot(nx, ny, nz) || 1;
                 
                 const norm3D = { x: nx / nLen, y: ny / nLen, z: nz / nLen };
                 const dot = norm3D.x * lightNorm.x + norm3D.y * lightNorm.y + norm3D.z * lightNorm.z;
                 
                 let fillColor: string;
                 if (shd <= 0.02) {
                    fillColor = isFront ? `rgba(${facesRgb.r}, ${facesRgb.g}, ${facesRgb.b}, 0.35)` : `rgba(${facesRgb.r}, ${facesRgb.g}, ${facesRgb.b}, 0.18)`;
                 } else {
                    const lightFactor = Math.max(0, Math.min(1, 0.5 + dot * 0.5 * Math.min(2.0, shd)));
                    const r = Math.round(facesRgb.r * (0.4 + 0.6 * lightFactor));
                    const g = Math.round(facesRgb.g * (0.4 + 0.6 * lightFactor));
                    const b = Math.round(facesRgb.b * (0.4 + 0.6 * lightFactor));
                    const a = isFront ? (0.35 + 0.35 * lightFactor) : (0.15 + 0.2 * lightFactor);
                    fillColor = `rgba(${r}, ${g}, ${b}, ${a})`;
                 }
                 
                 const centerZ = (p0.z + p1.z + p2.z) / 3;
                 faceList.push({ indices: face, p0, p1, p2, isFront, fillColor, centerZ });
              }
              
              // Draw back faces first
              for (const f of faceList) {
                 if (!f.isFront) {
                    ctx.fillStyle = f.fillColor;
                    ctx.beginPath();
                    ctx.moveTo(f.p0.x, f.p0.y);
                    ctx.lineTo(f.p1.x, f.p1.y);
                    ctx.lineTo(f.p2.x, f.p2.y);
                    ctx.closePath();
                    ctx.fill();
                 }
              }
              
              // Draw back wireframe edges
              ctx.strokeStyle = `rgba(${wireRgb.r}, ${wireRgb.g}, ${wireRgb.b}, 0.3)`;
              ctx.lineWidth = 1.2;
              for (const edge of edges) {
                 ctx.beginPath();
                 ctx.moveTo(projPts[edge[0]].x, projPts[edge[0]].y);
                 ctx.lineTo(projPts[edge[1]].x, projPts[edge[1]].y);
                 ctx.stroke();
              }
              
              // Draw front faces
              for (const f of faceList) {
                 if (f.isFront) {
                    ctx.fillStyle = f.fillColor;
                    ctx.beginPath();
                    ctx.moveTo(f.p0.x, f.p0.y);
                    ctx.lineTo(f.p1.x, f.p1.y);
                    ctx.lineTo(f.p2.x, f.p2.y);
                    ctx.closePath();
                    ctx.fill();
                 }
              }
              
              // Draw front wireframe edges — neon: wide soft bloom + core line
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              const drawEdges = (w: number, style: string, blur: number, blurCol: string, alpha: number) => {
                 ctx.strokeStyle = style;
                 ctx.lineWidth = w;
                 ctx.globalAlpha = alpha;
                 ctx.shadowColor = blur > 0 ? blurCol : 'transparent';
                 ctx.shadowBlur = blur;
                 for (const edge of edges) {
                    ctx.beginPath();
                    ctx.moveTo(projPts[edge[0]].x, projPts[edge[0]].y);
                    ctx.lineTo(projPts[edge[1]].x, projPts[edge[1]].y);
                    ctx.stroke();
                 }
              };
              const glowAmt = Math.max(0, shd);
              drawEdges(Math.max(6, scale * 0.03), polyGlow, 24 + glowAmt * 30, polyGlow, 0.22 + glowAmt * 0.15); // outer bloom
              drawEdges(2.6, polyWire, 10 + glowAmt * 16, polyGlow, 1);                                            // core line
              drawEdges(1.2, '#ffffff', 0, 'transparent', 0.6);                                                    // hot centre
              ctx.shadowBlur = 0;
              ctx.globalAlpha = 1;

              element = canvas;
          } else if (def.uuid === 'stacked-balls-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const sbBg = resolvedGenerativeColors['background'] || '#ffffff';
              const sbShade = resolvedGenerativeColors['spheres_shade'] || '#eb556b';
              const sbSparkle = resolvedGenerativeColors['contour'] || resolvedGenerativeColors['spheres_light'] || '#7599a4';
              if (!isTransparentColor(sbBg)) {
                  ctx.fillStyle = sbBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { count, max_size, speed, movement, chaos } = modifiedSettings;
              const target = Math.max(0, Math.min(120, Math.floor(count ?? 40)));
              const maxS = Math.max(6, (max_size ?? 100)) * (Math.min(targetW, targetH) / 780);
              const spd = Math.max(0.1, speed ?? 1.0);
              const spreadX = Math.max(0.05, Math.min(1, (chaos ?? 1) * 0.55));
              const wobble = (movement ?? 30) * 0.02;
              const sbShadeRgb = hexToRgb(sbShade);
              const sbLightRgb = hexToRgb(sbSparkle);

              if (!stackedBallsStateRef.current[layer.id]) {
                  stackedBallsStateRef.current[layer.id] = { balls: [], lastSpawn: nowSec };
                  // pre-build a settled pile so it looks right immediately
                  const seed = Math.min(target, 60);
                  let rowY = targetH - 6;
                  let px = 40;
                  for (let i = 0; i < seed; i++) {
                      const r = maxS * (0.35 + 0.65 * ((i * 97) % 100) / 100);
                      if (px + r * 2 > targetW - 20) { px = 40; rowY -= maxS * 1.3; }
                      stackedBallsStateRef.current[layer.id].balls.push({
                          x: px + r, y: rowY - r, vx: 0, vy: 0, r,
                          tone: 0.25 + ((i * 53) % 100) / 133,
                      });
                      px += r * 2 + 6;
                  }
              }
              const sbSt = stackedBallsStateRef.current[layer.id];
              const dt = Math.min(0.04, Math.max(0.001, deltaTime / 1000)) * spd;
              const floorY = targetH - 6;
              const g = 2600;

              // spawn from the top until we reach target
              if (sbSt.balls.length < target && nowSec - sbSt.lastSpawn > 0.12 / spd) {
                  sbSt.lastSpawn = nowSec;
                  const r = maxS * (0.35 + 0.65 * Math.random());
                  sbSt.balls.push({
                      x: targetW / 2 + (Math.random() - 0.5) * targetW * spreadX,
                      y: -r - Math.random() * 60,
                      vx: (Math.random() - 0.5) * 40, vy: 0,
                      r, tone: 0.25 + Math.random() * 0.75,
                  });
              }
              if (sbSt.balls.length > target) sbSt.balls.splice(0, sbSt.balls.length - target);

              // integrate + collide
              const B = sbSt.balls;
              for (const b of B) {
                  b.vy += g * dt;
                  b.vx += Math.sin(nowSec * 3 + b.r) * wobble * 40;
                  b.x += b.vx * dt; b.y += b.vy * dt;
                  b.vx *= 0.985;
                  if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.4; }
                  if (b.x > targetW - b.r) { b.x = targetW - b.r; b.vx = -Math.abs(b.vx) * 0.4; }
                  if (b.y > floorY - b.r) { b.y = floorY - b.r; b.vy *= -0.18; if (Math.abs(b.vy) < 40) b.vy = 0; b.vx *= 0.7; }
              }
              for (let iter = 0; iter < 3; iter++) {
                  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
                      const a = B[i], c = B[j];
                      let dx = c.x - a.x, dy = c.y - a.y;
                      let d = Math.hypot(dx, dy) || 0.001;
                      const overlap = a.r + c.r - d;
                      if (overlap > 0) {
                          dx /= d; dy /= d;
                          const push = overlap * 0.5;
                          a.x -= dx * push; a.y -= dy * push;
                          c.x += dx * push; c.y += dy * push;
                          const rv = (c.vx - a.vx) * dx + (c.vy - a.vy) * dy;
                          if (rv < 0) { a.vx += dx * rv * 0.5; a.vy += dy * rv * 0.5; c.vx -= dx * rv * 0.5; c.vy -= dy * rv * 0.5; }
                      }
                  }
              }

              // draw with volumetric shading (painter's order: higher balls last)
              [...B].sort((p, q) => p.y - q.y).forEach(b => {
                  const lr = Math.round(sbShadeRgb.r + (sbLightRgb.r - sbShadeRgb.r) * b.tone);
                  const lg = Math.round(sbShadeRgb.g + (sbLightRgb.g - sbShadeRgb.g) * b.tone);
                  const lb = Math.round(sbShadeRgb.b + (sbLightRgb.b - sbShadeRgb.b) * b.tone);
                  const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
                  grad.addColorStop(0, `rgb(${Math.min(255, lr + 60)}, ${Math.min(255, lg + 60)}, ${Math.min(255, lb + 60)})`);
                  grad.addColorStop(0.55, `rgb(${lr}, ${lg}, ${lb})`);
                  grad.addColorStop(1, `rgb(${Math.round(lr * 0.45)}, ${Math.round(lg * 0.45)}, ${Math.round(lb * 0.45)})`);
                  ctx.fillStyle = grad;
                  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
                  // specular dot
                  ctx.fillStyle = 'rgba(255,255,255,0.5)';
                  ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.12, 0, Math.PI * 2); ctx.fill();
              });
              element = canvas;
          } else if (def.uuid === '3d-debris-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const debBg = resolvedGenerativeColors['background'] || '#e0560f';
              const debFg = resolvedGenerativeColors['debris'] || resolvedGenerativeColors['foreground'] || '#0a0a0a';
              const debFgRgb = hexToRgb(debFg);
              const debFgAltRgb = hexToRgb(resolvedGenerativeColors['debris_alt'] || '#ffae5c');
              if (!isTransparentColor(debBg)) {
                  ctx.fillStyle = debBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }

              const { count, scatter, speed, size, transparency, gravity } = modifiedSettings;
              const num = Math.floor(count ?? 80);
              const scat = scatter ?? 400;
              const spd = speed ?? 1.0;
              const sz = size ?? 1.0;
              const debAlpha = 1.0 - Math.max(0, Math.min(1, transparency ?? 0)) * 0.88;
              const t = nowSec * spd;

              // Gravity action: 1st press -> everything falls; next press -> reverses back into place.
              const gravAction = Number(gravity ?? 0);
              if (!debrisGravityStateRef.current[layer.id]) debrisGravityStateRef.current[layer.id] = { mode: 'idle', startT: 0, lastAction: gravAction };
              const gSt = debrisGravityStateRef.current[layer.id];
              if (gravAction > gSt.lastAction) {
                  gSt.lastAction = gravAction;
                  gSt.mode = gSt.mode === 'falling' ? 'rising' : 'falling';
                  gSt.startT = nowSec;
              }
              let gravP = 0; // 0 = home, 1 = fully fallen
              if (gSt.mode === 'falling') {
                  const e = Math.min(1.6, nowSec - gSt.startT);
                  gravP = Math.min(1, (e * e) / 1.9);        // accelerating fall
              } else if (gSt.mode === 'rising') {
                  const e = nowSec - gSt.startT;
                  gravP = Math.max(0, 1 - e / 1.1);
                  gravP = gravP * gravP * (3 - 2 * gravP);    // ease
                  if (gravP <= 0.001) gSt.mode = 'idle';
              }
              
              const project = (p: any, camZ: number) => {
                 const f = 600 / (600 + p.z + camZ);
                 return { x: targetW/2 + p.x * f, y: targetH/2 + p.y * f, z: p.z, f };
              };
              
              const shapes = [];
              for(let i=0; i<num; i++) {
                 const seed = i * 21.1;
                 const type = Math.floor((Math.sin(seed)*0.5+0.5) * 3); // 0=cube, 1=tetra, 2=octa
                 const size = (10 + (Math.cos(seed*3.3)*0.5+0.5) * 40) * sz;
                 
                 const rOffset = scat * (Math.sin(seed*7.7)*0.5+0.5);
                 const angle = t*0.5 + seed*11.1;
                 const yPos = (Math.sin(seed*13.3) * scat * 1.5);

                 const cx = Math.sin(angle) * rOffset;
                 const homeCy = yPos + Math.sin(t + seed)*50;
                 // ground level below the frame, slightly staggered per rock
                 const groundCy = scat * 1.85 + (Math.sin(seed * 4.4) * 0.5 + 0.5) * scat * 0.25;
                 const cy = homeCy + (groundCy - homeCy) * gravP;
                 const cz = Math.cos(angle) * rOffset;

                 const rotX = t * (Math.sin(seed)*2);
                 const rotY = t * (Math.cos(seed)*2);

                 shapes.push({ cx, cy, cz, size, type, rotX, rotY, baseColor: Math.sin(seed*5)*0.5+0.5 });
              }
              
              // We sort shapes by their center Z
              shapes.sort((a,b) => b.cz - a.cz);
              
              for(const s of shapes) {
                 let pts: any[] = [];
                 let faces: any[] = [];
                 if (s.type === 0) { // cube
                    pts = [
                       {x:-1,y:-1,z:-1}, {x:1,y:-1,z:-1}, {x:1,y:1,z:-1}, {x:-1,y:1,z:-1},
                       {x:-1,y:-1,z:1}, {x:1,y:-1,z:1}, {x:1,y:1,z:1}, {x:-1,y:1,z:1}
                    ];
                    faces = [[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[4,5,1,0],[3,2,6,7]];
                 } else if (s.type === 1) { // tetra
                    pts = [ {x:1,y:1,z:1}, {x:-1,y:-1,z:1}, {x:-1,y:1,z:-1}, {x:1,y:-1,z:-1} ];
                    faces = [[0,1,2],[0,3,1],[0,2,3],[1,3,2]];
                 } else { // octa
                    pts = [ {x:0,y:1,z:0}, {x:1,y:0,z:0}, {x:0,y:-1,z:0}, {x:-1,y:0,z:0}, {x:0,y:0,z:1}, {x:0,y:0,z:-1} ];
                    faces = [[4,0,1],[4,1,2],[4,2,3],[4,3,0],[5,1,0],[5,2,1],[5,3,2],[5,0,3]];
                 }
                 
                 // Rotate and translate
                 const transformedPts = pts.map(p => {
                    const y1 = p.y * Math.cos(s.rotX) - p.z * Math.sin(s.rotX);
                    const z1 = p.y * Math.sin(s.rotX) + p.z * Math.cos(s.rotX);
                    const x2 = p.x * Math.cos(s.rotY) + z1 * Math.sin(s.rotY);
                    const z2 = -p.x * Math.sin(s.rotY) + z1 * Math.cos(s.rotY);
                    return { x: s.cx + x2 * s.size, y: s.cy + y1 * s.size, z: s.cz + z2 * s.size };
                 });
                 
                 const projPts = transformedPts.map(p => project(p, 0));
                 
                 // Draw faces
                 faces.forEach(face => {
                    const p0 = projPts[face[0]]; const p1 = projPts[face[1]]; const p2 = projPts[face[2]];
                    const normZ = (p1.x - p0.x)*(p2.y - p0.y) - (p1.y - p0.y)*(p2.x - p0.x);
                    if (normZ >= 0) {
                        const tp0 = transformedPts[face[0]]; const tp1 = transformedPts[face[1]]; const tp2 = transformedPts[face[2]];
                        const nx = (tp1.y - tp0.y)*(tp2.z - tp0.z) - (tp1.z - tp0.z)*(tp2.y - tp0.y);
                        const ny = (tp1.z - tp0.z)*(tp2.x - tp0.x) - (tp1.x - tp0.x)*(tp2.z - tp0.z);
                        const nz = (tp1.x - tp0.x)*(tp2.y - tp0.y) - (tp1.y - tp0.y)*(tp2.x - tp0.x);
                        const len = Math.hypot(nx, ny, nz) || 1;
                        const lightDot = Math.max(0, (nx/len)*0.5 + (ny/len)*0.8 + (nz/len)*0.3);
                        
                        const factor = 0.35 + lightDot * 0.65;
                        const rockCol = s.baseColor > 0.62 ? debFgAltRgb : debFgRgb;
                        const r = Math.round(rockCol.r * factor);
                        const g = Math.round(rockCol.g * factor);
                        const b = Math.round(rockCol.b * factor);
                        ctx.fillStyle = `rgba(${r},${g},${b},${debAlpha.toFixed(3)})`;
                        ctx.beginPath();
                        ctx.moveTo(p0.x, p0.y);
                        for(let i=1; i<face.length; i++) ctx.lineTo(projPts[face[i]].x, projPts[face[i]].y);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = debBg;
                        ctx.globalAlpha = debAlpha;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                 });
              }
              element = canvas;
          } else if (def.uuid === 'random-symbols-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const symBg = resolvedGenerativeColors['background'] || '#ffffff';
              const circleCol = resolvedGenerativeColors['circles'] || resolvedGenerativeColors['symbols'] || resolvedGenerativeColors['foreground'] || '#eb556b';
              const triCol = resolvedGenerativeColors['triangles'] || resolvedGenerativeColors['symbols'] || resolvedGenerativeColors['foreground'] || '#7599a4';
              const sqCol = resolvedGenerativeColors['squares'] || resolvedGenerativeColors['bars'] || resolvedGenerativeColors['symbols'] || resolvedGenerativeColors['foreground'] || '#233136';
              if (!isTransparentColor(symBg)) {
                  ctx.fillStyle = symBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, density, scale: sclValue, movement, chaos } = modifiedSettings;
              const spd = speed ?? 1.0;
              const dens = Math.floor(density ?? 250);
              const scl = sclValue ?? 1.0;
              const mov = movement ?? 20.0;
              const cha = chaos ?? 1.0;
              const t = nowSec * spd;
              
              const a1 = 0.7548776662466927;
              const a2 = 0.5698402909980532;
              
              for (let i = 0; i < dens; i++) {
                 const u = (0.5 + i * a1) % 1.0;
                 const v = (0.5 + i * a2) % 1.0;
                 
                 const baseX = u * targetW;
                 const baseY = v * targetH;
                 
                 const driftX = Math.sin(t * 0.8 * cha + i * 2.13) * mov;
                 const driftY = Math.cos(t * 0.6 * cha + i * 3.17) * mov;
                 
                 const x = (baseX + driftX + targetW) % targetW;
                 const y = (baseY + driftY + targetH) % targetH;
                 
                 const symbolType = i % 3; // 0 = Circle, 1 = Triangle, 2 = Square/Rect
                 let color = circleCol;
                 if (symbolType === 1) color = triCol;
                 else if (symbolType === 2) color = sqCol;
                 
                 if (isTransparentColor(color)) continue;
                 
                 const sizeRand = ((i * 13 + 7) % 100) / 100;
                 const size = (12 + sizeRand * 55) * scl;
                 const rot = t * (Math.sin(i * 1.7) * 0.5) + i * 0.9;
                 
                 ctx.save();
                 ctx.translate(x, y);
                 ctx.rotate(rot);
                 ctx.fillStyle = color;
                 ctx.strokeStyle = color;
                 
                 if (symbolType === 0) {
                     ctx.beginPath();
                     ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
                     ctx.fill();
                 } else if (symbolType === 1) {
                     ctx.beginPath();
                     ctx.moveTo(0, -size * 0.55);
                     ctx.lineTo(size * 0.5, size * 0.45);
                     ctx.lineTo(-size * 0.5, size * 0.45);
                     ctx.closePath();
                     ctx.fill();
                 } else {
                     const barW = size * 0.9;
                     const barH = size * 0.9;
                     ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
                 }
                 ctx.restore();
              }
              element = canvas;
          } else if (def.uuid === 'text-umbrella-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);

              const umbBg = resolvedGenerativeColors['background'] || '#05060a';
              const umbRain = resolvedGenerativeColors['umbrella'] || resolvedGenerativeColors['foreground'] || '#8fd0ff';
              const umbCanopy = resolvedGenerativeColors['canopy'] || '#ff2d55';
              const umbFigure = resolvedGenerativeColors['figure'] || '#e8e8f0';
              const umbBgOpaque = !isTransparentColor(umbBg);
              if (umbBgOpaque) { ctx.fillStyle = umbBg; ctx.fillRect(0, 0, targetW, targetH); }

              const { speed, font_size, rain_density, text_content, umbrella_size, umbrella_x, umbrella_y } = modifiedSettings;
              const fSize = Math.max(9, (font_size || 16) * (Math.min(targetW, targetH) / 620));
              const spd = speed ?? 1.0;
              const dens = Math.max(0.1, Math.min(2.0, rain_density ?? 1.0));
              const uSize = umbrella_size || 1.0;
              const uX = umbrella_x ?? 0.0;
              const uY = umbrella_y ?? 0.0;
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : '01';
              const chars = Array.from(textStr.replace(/\s+/g, ''));
              if (chars.length === 0) chars.push('0');

              const cx = (targetW / 2) + (uX / 100.0) * (targetW * 0.42);
              const cy = (targetH * 0.42) + (uY / 100.0) * (targetH * 0.34);
              const groundY = targetH * 0.9;
              const R = Math.min(targetW, targetH) * 0.24 * uSize;
              const domeH = R * 0.6;
              const t = nowSec * spd;

              // y of the canopy surface at a given x (Infinity where there is no canopy)
              const canopyEdgeY = (px: number) => {
                  const q = (px - cx) / R;
                  if (Math.abs(q) > 1.0) return Infinity;
                  return cy - domeH * (1.0 - q * q);
              };

              // --- rain of glyphs ---
              ctx.font = `600 ${fSize}px "DM Mono", "SF Mono", ui-monospace, monospace`;
              ctx.textBaseline = 'middle';
              ctx.textAlign = 'center';
              const colGap = fSize * (1.9 - Math.min(1.4, dens));
              const rowGap = fSize * 1.15;
              const cols = Math.ceil(targetW / colGap) + 1;
              const rowsN = Math.ceil(targetH / rowGap) + 3;
              const wrap = rowsN * rowGap;

              for (let c = 0; c < cols; c++) {
                  const colX = c * colGap + colGap * 0.5;
                  let rr = (Math.sin(c * 13.37) * 43758.5453) % 1;
                  if (rr < 0) rr += 1;
                  const colSpeed = fSize * (6 + rr * 8) * (0.5 + spd);
                  const off = t * colSpeed + rr * 4000;
                  const domeAt = canopyEdgeY(colX);
                  const underCanopy = Math.abs(colX - cx) < R;

                  for (let rIdx = 0; rIdx < rowsN; rIdx++) {
                      let px = colX;
                      let py = ((rIdx * rowGap + off) % wrap) - rowGap * 2;
                      if (py > groundY || py < -rowGap) continue;

                      // fully sheltered under the canopy
                      if (underCanopy && py > domeAt + fSize * 0.3) continue;

                      // deflect glyphs that land on the dome toward the nearest rim
                      if (underCanopy && py > domeAt - fSize && py <= domeAt + fSize * 0.3) {
                          const side = colX >= cx ? 1 : -1;
                          px = colX + side * (R - Math.abs(colX - cx)) * 0.8;
                          py = canopyEdgeY(px) + fSize * 0.3;
                      }

                      const gi = ((c * 31 + rIdx * 7 + Math.floor(off / rowGap)) % chars.length + chars.length) % chars.length;
                      ctx.globalAlpha = Math.max(0.12, Math.min(0.9, py / targetH + 0.15));
                      ctx.fillStyle = umbRain;
                      ctx.fillText(chars[gi], px, py);
                  }
              }
              ctx.globalAlpha = 1;

              // --- ground line + splashes ---
              ctx.strokeStyle = umbRain;
              ctx.lineCap = 'round';
              ctx.globalAlpha = 0.45;
              ctx.lineWidth = Math.max(1, fSize * 0.08);
              ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(targetW, groundY); ctx.stroke();
              ctx.globalAlpha = 0.3;
              for (let s = 0; s < 26; s++) {
                  const sx = (s * 97.3 + t * 30) % targetW;
                  if (sx > cx - R && sx < cx + R) continue;
                  const sw = fSize * (0.35 + (Math.sin(s * 4.2) + 1) * 0.55);
                  ctx.beginPath();
                  ctx.moveTo(sx - sw, groundY - 1);
                  ctx.quadraticCurveTo(sx, groundY - fSize * 0.7, sx + sw, groundY - 1);
                  ctx.stroke();
              }
              ctx.globalAlpha = 1;

              // --- figure silhouette under the umbrella ---
              const figH = R * 1.4;
              ctx.fillStyle = umbFigure;
              ctx.beginPath();
              ctx.arc(cx, groundY - figH + R * 0.12, R * 0.12, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(cx - R * 0.085, groundY - figH + R * 0.24);
              ctx.lineTo(cx + R * 0.085, groundY - figH + R * 0.24);
              ctx.lineTo(cx + R * 0.16, groundY - R * 0.02);
              ctx.lineTo(cx - R * 0.16, groundY - R * 0.02);
              ctx.closePath();
              ctx.fill();

              // --- pole ---
              ctx.strokeStyle = umbFigure;
              ctx.lineWidth = Math.max(2, R * 0.035);
              ctx.beginPath();
              ctx.moveTo(cx, cy - domeH * 0.1);
              ctx.lineTo(cx, groundY - figH + R * 0.44);
              ctx.stroke();

              // --- umbrella canopy: smooth dome + scalloped rim + ribs ---
              const ribs = 6;
              const apexY = cy - domeH;
              ctx.beginPath();
              ctx.moveTo(cx - R, cy);
              ctx.quadraticCurveTo(cx - R * 0.5, apexY - domeH * 0.12, cx, apexY);
              ctx.quadraticCurveTo(cx + R * 0.5, apexY - domeH * 0.12, cx + R, cy);
              for (let i = 0; i < ribs; i++) {
                  const x2 = cx + R - (2 * R) * ((i + 1) / ribs);
                  const xm = cx + R - (2 * R) * ((i + 0.5) / ribs);
                  ctx.quadraticCurveTo(xm, cy + fSize * 1.15, x2, cy);
              }
              ctx.closePath();
              ctx.fillStyle = umbCanopy;
              ctx.fill();

              ctx.strokeStyle = umbBgOpaque ? umbBg : 'rgba(0,0,0,0.5)';
              ctx.globalAlpha = 0.5;
              ctx.lineWidth = Math.max(1, R * 0.015);
              for (let i = 0; i <= ribs; i++) {
                  const xr = cx - R + (2 * R) * (i / ribs);
                  ctx.beginPath();
                  ctx.moveTo(cx, apexY + domeH * 0.06);
                  ctx.lineTo(xr, cy + fSize * 0.15);
                  ctx.stroke();
              }
              ctx.globalAlpha = 1;

              // ferrule tip
              ctx.fillStyle = umbFigure;
              ctx.beginPath();
              ctx.moveTo(cx, apexY - fSize * 0.9);
              ctx.lineTo(cx - R * 0.03, apexY);
              ctx.lineTo(cx + R * 0.03, apexY);
              ctx.closePath();
              ctx.fill();

              element = canvas;
            } else if (def.uuid === 'text-water-drop-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const wdBg = resolvedGenerativeColors['background'] || '#000000';
              const wdFg = resolvedGenerativeColors['ripples'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              if (!isTransparentColor(wdBg)) {
                  ctx.fillStyle = wdBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, font_size, frequency, amplitude, text_content } = modifiedSettings;
              const fSize = font_size || 20.0;
              const spd = speed || 2.0;
              const freq = frequency || 0.05;
              const amp = amplitude || 20.0;
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : '滴水穿石';
              const chars = Array.from(textStr);
              if (chars.length === 0) chars.push(' ');
              
              const cx = targetW / 2;
              const cy = targetH / 2;
              const t = nowSec * spd * 10.0;
              
              ctx.fillStyle = wdFg;
              ctx.font = `bold ${fSize}px sans-serif`;
              ctx.textBaseline = 'middle';
              
              let textIndex = 0;
              for (let y = 0; y < targetH + fSize; y += fSize * 1.5) {
                  for (let x = 0; x < targetW + fSize; x += fSize * 1.5) {
                      const dx = x - cx;
                      const dy = y - cy;
                      const dist = Math.hypot(dx, dy);
                      
                      let drawX = x;
                      let drawY = y;
                      
                      if (dist > 0.001) {
                          // Ripple math
                          // Decay amplitude over distance
                          const decay = Math.max(0, 1.0 - dist / (Math.max(targetW, targetH) * 0.8));
                          const wave = Math.sin(dist * freq - t) * amp * decay;
                          
                          drawX += (dx / dist) * wave;
                          drawY += (dy / dist) * wave;
                      }
                      
                      const char = chars[textIndex % chars.length];
                      ctx.fillText(char, drawX, drawY);
                      textIndex++;
                  }
              }
              element = canvas;
          } else if (def.uuid === 'text-boat-sea-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const boatBg = resolvedGenerativeColors['background'] || '#000000';
              const boatFg = resolvedGenerativeColors['boat_sea'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              if (!isTransparentColor(boatBg)) {
                  ctx.fillStyle = boatBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, font_size, wave_height, text_content, boat_size, boat_speed, chaos } = modifiedSettings;
              const fSize = font_size || 18.0;
              const spd = speed || 1.0;
              const wHeight = wave_height || 30.0;
              const bSize = boat_size || 1.0;
              const bSpeed = boat_speed ?? 1.0;
              const ch = chaos ?? 1.0;
              
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : '~波浪~海洋~航行~漂流~';
              const chars = Array.from(textStr);
              if (chars.length === 0) chars.push(' ');
              
              const t = nowSec * spd * 2.0;
              
              ctx.fillStyle = boatFg;
              ctx.font = `bold ${fSize}px sans-serif`;
              ctx.textBaseline = 'middle';
              
              const getWaveY = (px: number) => {
                  let w = Math.sin(px * 0.01 + t) * wHeight + Math.sin(px * 0.03 - t * 1.5) * wHeight * 0.5;
                  if (ch > 0) {
                      w += Math.sin(px * 0.1 + t * 4.0) * (5 * ch);
                      w += Math.sin(px * 0.05 - t * 6.0) * (10 * ch);
                  }
                  return w;
              };
              
              // Draw sea of words
              let textIndex = 0;
              for (let y = targetH * 0.3; y < targetH + fSize * 2; y += fSize * 1.2) {
                  for (let x = 0; x < targetW + fSize; x += fSize * 1.2) {
                      const waveY = getWaveY(x);
                      const surfaceY = targetH * 0.6 + waveY;
                      
                      const drawY = y + waveY * (y / targetH); 
                      
                      const char = chars[textIndex % chars.length];
                      if (drawY > surfaceY) {
                          const depth = (drawY - surfaceY) / (targetH * 0.5);
                          ctx.globalAlpha = Math.max(0.1, 1.0 - depth);
                          ctx.fillText(char, x, drawY);
                      }
                      textIndex++;
                  }
              }
              ctx.globalAlpha = 1.0;
              
              // Draw Sailboat
              const boatX = targetW * 0.5 + Math.sin(nowSec * bSpeed) * targetW * 0.3;
              const boatY = targetH * 0.6 + getWaveY(boatX) + 5; // slight dip into wave
              const pitch = Math.cos(boatX * 0.01 + t) * 0.3;
              
              ctx.save();
              ctx.translate(boatX, boatY);
              ctx.rotate(pitch);
              ctx.scale(bSize, bSize);
              
              ctx.fillStyle = boatFg;
              ctx.strokeStyle = boatBg;
              ctx.lineWidth = 2;
              
              // Hull
              ctx.beginPath();
              ctx.moveTo(-40, 0);
              ctx.lineTo(40, 0);
              ctx.lineTo(25, 20);
              ctx.lineTo(-25, 20);
              ctx.closePath();
              ctx.fill();
              
              // Mast
              ctx.fillStyle = boatFg;
              ctx.fillRect(-2, -60, 4, 60);
              
              // Mainsail (right)
              ctx.beginPath();
              ctx.moveTo(2, -55);
              ctx.quadraticCurveTo(40, -20, 35, -5);
              ctx.lineTo(2, -5);
              ctx.closePath();
              ctx.fill();
              
              // Jib (left)
              ctx.beginPath();
              ctx.moveTo(-2, -50);
              ctx.lineTo(-30, -5);
              ctx.lineTo(-2, -5);
              ctx.closePath();
              ctx.fill();
              
              // Flag
              ctx.beginPath();
              ctx.moveTo(-2, -60);
              ctx.lineTo(-20, -55);
              ctx.lineTo(-2, -50);
              ctx.closePath();
              ctx.fill();
              
              ctx.restore();

              element = canvas;
          } else if (def.uuid === 'kinetic-type-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const ktBg = resolvedGenerativeColors['background'] || '#000000';
              const ktWord = resolvedGenerativeColors['words'] || resolvedGenerativeColors['primary'] || '#ffffff';
              const ktAccent = resolvedGenerativeColors['accent'] || resolvedGenerativeColors['secondary'] || '#eb556b';

              const s = modifiedSettings;
              const count = Math.max(2, Math.min(40, Math.round(s.word_count ?? 12)));
              const fontSize = Math.max(12, Math.min(400, s.size ?? 120));
              const kSpeed = Math.max(0, s.speed ?? 32);
              const gravity = (s.gravity ?? 0);
              const spin = Math.max(0, s.spin ?? 18);
              const gather = Math.max(0, Math.min(1, s.gather ?? 0));
              const restitution = Math.max(0.2, Math.min(1, s.bounce ?? 0.92));
              const weight = Math.max(0, Math.min(1, s.weight ?? 0));
              const trail = Math.max(0, Math.min(1, s.trail ?? 0));
              const impactCount = Number(s.impact ?? 0);

              const wordsSrc = ((typeof s.text === 'string' && s.text.trim()) ? s.text : 'TYPE MOTION FLOW PULSE FORM SHIFT')
                  .toUpperCase().split(/\s+/).filter(Boolean);
              if (wordsSrc.length === 0) wordsSrc.push('PULSE');

              if (!kineticTypeStateRef.current[layer.id]) kineticTypeStateRef.current[layer.id] = { words: [], lastImpact: 0, lastCount: 0 };
              const st = kineticTypeStateRef.current[layer.id];

              if (st.words.length !== count) {
                  const old = st.words;
                  st.words = [];
                  for (let i = 0; i < count; i++) {
                      if (old[i]) { st.words.push(old[i]); continue; }
                      const ang = Math.random() * Math.PI * 2;
                      const v = (kSpeed + 8) * (3 + Math.random() * 4);
                      st.words.push({
                          x: Math.random() * targetW, y: Math.random() * targetH,
                          vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
                          a: (Math.random() - 0.5) * 0.7, va: (Math.random() - 0.5) * 0.02,
                          scale: 0.65 + ((i * 37) % 5) * 0.16,
                          wi: i % wordsSrc.length,
                      });
                  }
                  st.lastCount = count;
              }

              if (impactCount > st.lastImpact) {
                  for (const w of st.words) {
                      const ang = Math.random() * Math.PI * 2;
                      const k = (kSpeed + 6) * (8 + Math.random() * 12) + 140;
                      w.vx += Math.cos(ang) * k; w.vy += Math.sin(ang) * k;
                      w.va += (Math.random() - 0.5) * (spin * 0.06 + 0.4);
                  }
                  st.lastImpact = impactCount;
              }

              // background / trails
              if (trail > 0.02 && !isTransparentColor(ktBg)) {
                  const rgb = hexToRgb(ktBg);
                  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(1 - trail * 0.94).toFixed(3)})`;
                  ctx.fillRect(0, 0, targetW, targetH);
              } else {
                  ctx.clearRect(0, 0, targetW, targetH);
                  if (!isTransparentColor(ktBg)) { ctx.fillStyle = ktBg; ctx.fillRect(0, 0, targetW, targetH); }
              }

              const dt = Math.min(0.05, Math.max(0.001, deltaTime / 1000));
              const cx = targetW / 2, cy = targetH / 2;
              const rBase = Math.min(targetW, targetH) * 0.34;
              const gRot = nowSec * 0.22;

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineJoin = 'round';
              ctx.miterLimit = 2;

              const accentIdx = Math.floor(nowSec * 0.55) % Math.max(1, st.words.length);

              for (let i = 0; i < st.words.length; i++) {
                  const w = st.words[i];
                  w.vy += gravity * dt * 9;
                  w.vx *= 0.994; w.vy *= 0.994;
                  w.x += w.vx * dt; w.y += w.vy * dt;
                  w.a += (w.va + spin * 0.0009) * dt * 60;

                  const pad = fontSize * w.scale * 0.55 + 8;
                  if (w.x < pad) { w.x = pad; w.vx = Math.abs(w.vx) * restitution; w.va += (Math.random() - 0.5) * 0.2; }
                  if (w.x > targetW - pad) { w.x = targetW - pad; w.vx = -Math.abs(w.vx) * restitution; w.va += (Math.random() - 0.5) * 0.2; }
                  if (w.y < pad) { w.y = pad; w.vy = Math.abs(w.vy) * restitution; }
                  if (w.y > targetH - pad) { w.y = targetH - pad; w.vy = -Math.abs(w.vy) * restitution; }

                  if (gather > 0.001) {
                      const theta = (i / st.words.length) * Math.PI * 2 + gRot;
                      const rr = rBase * (0.5 + 0.5 * Math.abs(Math.cos(2.5 * theta)));
                      const tx = cx + Math.cos(theta) * rr;
                      const ty = cy + Math.sin(theta) * rr;
                      const ta = theta + Math.PI / 2;
                      w.x += (tx - w.x) * gather * 0.16;
                      w.y += (ty - w.y) * gather * 0.16;
                      let da = ((ta - w.a + Math.PI) % (Math.PI * 2)) - Math.PI;
                      w.a += da * gather * 0.14;
                      w.vx *= (1 - gather * 0.14); w.vy *= (1 - gather * 0.14);
                  }

                  const fs = fontSize * w.scale;
                  ctx.save();
                  ctx.translate(w.x, w.y);
                  ctx.rotate(w.a);
                  ctx.font = `900 ${fs}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
                  const word = wordsSrc[w.wi % wordsSrc.length];
                  const col = (i === accentIdx) ? ktAccent : ktWord;
                  if (weight > 0.02) {
                      ctx.globalAlpha = 0.3 + weight * 0.7;
                      ctx.fillStyle = col;
                      ctx.fillText(word, 0, 0);
                      ctx.globalAlpha = 1;
                  }
                  ctx.strokeStyle = col;
                  ctx.lineWidth = Math.max(1.5, fs * 0.05);
                  ctx.strokeText(word, 0, 0);
                  ctx.restore();
              }

              element = canvas;
          } else if (def.uuid === 'circle-bloom-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const cbBg = resolvedGenerativeColors['background'] || '#000000';
              const cbFg = resolvedGenerativeColors['circles'] || resolvedGenerativeColors['primary'] || '#ffffff';
              const cbAccent = resolvedGenerativeColors['accent'] || resolvedGenerativeColors['secondary'] || '#eb556b';
              const cbRgb = hexToRgb(cbFg);
              const cbaRgb = hexToRgb(cbAccent);

              ctx.clearRect(0, 0, targetW, targetH);
              if (!isTransparentColor(cbBg)) { ctx.fillStyle = cbBg; ctx.fillRect(0, 0, targetW, targetH); }

              const s = modifiedSettings;
              const maxCount = Math.max(0, Math.min(120, Math.round(s.max_count ?? 18)));
              const maxSize = Math.max(4, Math.min(1200, s.max_size ?? 150));
              const grSpeed = Math.max(0.05, s.speed ?? 1.6);
              const spawnDelay = Math.max(0, s.delay ?? 0.35);
              const fadeAmt = Math.max(0, Math.min(1, s.fade ?? 0.4));
              const cbOutline = Math.max(0, Math.min(1, s.outline ?? 0));
              const bloomAction = Number(s.bloom ?? 0);
              const clearAction = Number(s.clear ?? 0);

              const growTime = maxSize / (grSpeed * 110);            // sec to reach full size
              const holdTime = 0.4 + fadeAmt * 3.5;                  // sec of fade-out after grown
              const lifeTotal = growTime + holdTime;

              const spawnAt = (accent: boolean, bornAgo: number) => {
                  const m = 0.08;
                  circleBloomStateRef.current[layer.id].circles.push({
                      x: (m + Math.random() * (1 - 2 * m)) * targetW,
                      y: (m + Math.random() * (1 - 2 * m)) * targetH,
                      birth: nowSec - bornAgo,
                      accent,
                      rs: 0.75 + Math.random() * 0.5,               // per-circle size variation
                  });
              };

              if (!circleBloomStateRef.current[layer.id]) {
                  circleBloomStateRef.current[layer.id] = { circles: [], lastSpawn: nowSec, lastAction: 0, lastClear: clearAction, clearUntil: 0 };
                  const seed = Math.min(maxCount, 22);
                  for (let i = 0; i < seed; i++) spawnAt(i % 5 === 0, (i / Math.max(1, seed)) * (growTime + holdTime) * 0.75);
              }
              const cbSt = circleBloomStateRef.current[layer.id];
              const spawnOne = (accent: boolean) => spawnAt(accent, 0);

              cbSt.circles = cbSt.circles.filter((c: any) => (nowSec - c.birth) < lifeTotal * c.rs + growTime);

              if (clearAction > (cbSt.lastClear ?? 0)) {
                  cbSt.circles = [];
                  cbSt.clearUntil = nowSec + 1.2;         // brief pause before it regrows
                  cbSt.lastClear = clearAction;
              }

              if (bloomAction > cbSt.lastAction) {
                  const n = Math.min(6, bloomAction - cbSt.lastAction);
                  for (let i = 0; i < n; i++) spawnOne(Math.random() < 0.25);
                  cbSt.lastAction = bloomAction;
              }

              if (maxCount > 0 && nowSec >= (cbSt.clearUntil ?? 0) && cbSt.circles.length < maxCount && nowSec - cbSt.lastSpawn >= spawnDelay) {
                  cbSt.lastSpawn = nowSec;
                  spawnOne(cbSt.circles.length % 5 === 0);
              }
              if (maxCount === 0) cbSt.circles = [];

              for (const c of cbSt.circles) {
                  const age = nowSec - c.birth;
                  const cMax = maxSize * c.rs;
                  const g = Math.min(1, age / Math.max(0.001, growTime));
                  const r = (1 - Math.pow(1 - g, 3)) * cMax;         // ease-out grow
                  let alpha = 1;
                  if (age > growTime) {
                      const fp = (age - growTime) / Math.max(0.001, holdTime * c.rs);
                      alpha = Math.max(0, 1 - fp);
                  }
                  if (r < 0.5 || alpha <= 0.01) continue;
                  const rgb = c.accent ? cbaRgb : cbRgb;
                  if (cbOutline > 0.5) {
                      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`;
                      ctx.lineWidth = Math.max(1.5, cMax * 0.02);
                      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
                  } else {
                      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(alpha * (cbOutline > 0.02 ? 1 - cbOutline * 0.5 : 1)).toFixed(3)})`;
                      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
                  }
              }
              element = canvas;
          } else if (def.uuid === 'hex-grid-canvas-1' || def.uuid === 'square-grid-canvas-1') {
              const isHex = def.uuid === 'hex-grid-canvas-1';
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const gBg = resolvedGenerativeColors['background'] || '#000000';
              const gGrid = resolvedGenerativeColors['grid'] || resolvedGenerativeColors['secondary'] || '#444444';
              const gLit = resolvedGenerativeColors['lit'] || resolvedGenerativeColors['primary'] || '#eb556b';
              const gGridRgb = hexToRgb(gGrid);
              const gLitRgb = hexToRgb(gLit);

              ctx.clearRect(0, 0, targetW, targetH);
              if (!isTransparentColor(gBg)) { ctx.fillStyle = gBg; ctx.fillRect(0, 0, targetW, targetH); }

              const s = modifiedSettings;
              const gap = Math.max(0, Math.min(0.45, s.gap ?? 0.07));
              const shuffleRate = Math.max(0, s.shuffle ?? 0.8);
              const flipAction = Number(s.flip ?? 0);
              const centerAction = Number(s.center ?? 0);

              // --- grid geometry ---
              let cols: number, rows: number, cellPos: { cx: number, cy: number }[] = [], cellR = 0;
              if (isHex) {
                  cols = Math.max(3, Math.min(40, Math.round(s.density ?? 12)));
                  const size = targetW / (cols * 1.5 + 0.5);        // flat-top hex "radius"
                  cellR = size;
                  const hStep = size * 1.5;
                  const vStep = size * Math.sqrt(3);
                  rows = Math.ceil(targetH / vStep) + 2;
                  for (let r = -1; r < rows; r++) {
                      for (let c = 0; c < cols + 1; c++) {
                          const cx = c * hStep + size;
                          const cy = r * vStep + (c % 2 ? vStep / 2 : 0) + size;
                          cellPos.push({ cx, cy });
                      }
                  }
              } else {
                  cols = Math.max(2, Math.min(60, Math.round(s.columns ?? 16)));
                  const cell = targetW / cols;
                  cellR = cell / 2;
                  rows = Math.ceil(targetH / cell) + 1;
                  for (let r = 0; r < rows; r++)
                      for (let c = 0; c < cols; c++)
                          cellPos.push({ cx: c * cell + cell / 2, cy: r * cell + cell / 2 });
              }
              const total = cellPos.length;
              const litCount = Math.max(0, Math.min(total, Math.round(s.lit_count ?? 30)));

              if (!gridLitStateRef.current[layer.id]) gridLitStateRef.current[layer.id] = { lit: [], lastShuffle: -999, lastAction: 0, lastCenter: centerAction, total: 0, centered: false };
              const gSt = gridLitStateRef.current[layer.id];

              const reshuffle = () => {
                  let order: number[];
                  if (gSt.centered) {
                      // weight cells toward the frame centre; randomness leaves organic gaps
                      const ccx = targetW / 2, ccy = targetH / 2;
                      const maxD = Math.hypot(targetW, targetH) / 2;
                      order = Array.from({ length: total }, (_, i) => i).map(i => {
                          const d = Math.hypot(cellPos[i].cx - ccx, cellPos[i].cy - ccy) / maxD;
                          return { i, w: Math.pow(1 - Math.min(1, d), 2.4) * (0.3 + 0.7 * Math.random()) };
                      }).sort((a, b) => b.w - a.w).map(o => o.i);
                  } else {
                      order = Array.from({ length: total }, (_, i) => i);
                      for (let i = total - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
                  }
                  gSt.lit = order.slice(0, litCount);
                  gSt.total = total;
                  gSt.lastShuffle = nowSec;
              };
              const shufflePeriod = shuffleRate > 0.01 ? Math.max(0.15, 3.5 / shuffleRate) : 1e9;
              if (gSt.total !== total || gSt.lit.length !== litCount || (nowSec - gSt.lastShuffle) > shufflePeriod) reshuffle();
              if (flipAction > gSt.lastAction) { gSt.centered = false; reshuffle(); gSt.lastAction = flipAction; }
              if (centerAction > (gSt.lastCenter ?? 0)) { gSt.centered = true; reshuffle(); gSt.lastCenter = centerAction; }
              const litSet = new Set(gSt.lit);

              const glow = Math.max(0, Math.min(1, s.glow ?? 0.5));
              const gOutline = Math.max(0, Math.min(1, s.outline ?? 0.3));
              const checker = Math.max(0, Math.min(1, s.checker ?? 0.15));
              const round = Math.max(0, Math.min(0.5, s.round ?? 0));
              const inset = cellR * (1 - gap);
              const pulse = 0.72 + 0.28 * Math.sin(nowSec * 2.2);

              for (let i = 0; i < total; i++) {
                  const { cx, cy } = cellPos[i];
                  const lit = litSet.has(i);
                  ctx.beginPath();
                  if (isHex) {
                      for (let k = 0; k < 6; k++) {
                          const a = (Math.PI / 3) * k;
                          const px = cx + Math.cos(a) * inset;
                          const py = cy + Math.sin(a) * inset;
                          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                      }
                      ctx.closePath();
                  } else {
                      const half = inset;
                      const rr = round * half * 2;
                      const x = cx - half, y = cy - half, w = half * 2, h = half * 2;
                      if (rr > 0.5) {
                          ctx.moveTo(x + rr, y);
                          ctx.arcTo(x + w, y, x + w, y + h, rr);
                          ctx.arcTo(x + w, y + h, x, y + h, rr);
                          ctx.arcTo(x, y + h, x, y, rr);
                          ctx.arcTo(x, y, x + w, y, rr);
                          ctx.closePath();
                      } else {
                          ctx.rect(x, y, w, h);
                      }
                  }
                  if (lit) {
                      const a = glow > 0.01 ? (0.55 + 0.45 * pulse) * (0.4 + glow * 0.6) : 0.95;
                      ctx.fillStyle = `rgba(${gLitRgb.r}, ${gLitRgb.g}, ${gLitRgb.b}, ${Math.min(1, a).toFixed(3)})`;
                      ctx.fill();
                  } else {
                      if (!isHex && checker > 0.02 && (((Math.round(cx / (cellR * 2)) + Math.round(cy / (cellR * 2))) % 2) === 0)) {
                          ctx.fillStyle = `rgba(${gGridRgb.r}, ${gGridRgb.g}, ${gGridRgb.b}, ${(checker * 0.5).toFixed(3)})`;
                          ctx.fill();
                      }
                      if (gOutline > 0.02) {
                          ctx.strokeStyle = `rgba(${gGridRgb.r}, ${gGridRgb.g}, ${gGridRgb.b}, ${(gOutline * 0.7).toFixed(3)})`;
                          ctx.lineWidth = 1.25;
                          ctx.stroke();
                      }
                  }
              }
              element = canvas;
          } else if (def.uuid === 'orb-cluster-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const ocBg = resolvedGenerativeColors['background'] || '#0a0a12';
              const ocA = resolvedGenerativeColors['orb_a'] || '#8b6cf0';
              const ocB = resolvedGenerativeColors['orb_b'] || '#f0a0d8';
              const ocHi = resolvedGenerativeColors['highlight'] || '#ffffff';
              const ocRgbA = hexToRgb(ocA), ocRgbB = hexToRgb(ocB), ocRgbHi = hexToRgb(ocHi);

              const os = modifiedSettings;
              const ocCount = Math.max(6, Math.min(140, Math.round(os.count ?? 45)));
              const ocSize = Math.max(0.2, os.size ?? 1);
              const ocGloss = Math.max(0, Math.min(1, os.glossiness ?? 0.7));
              const ocAttract = Math.max(0, Math.min(1, os.attraction ?? 0.5));
              const ocTurb = Math.max(0, os.turbulence ?? 0.4);
              const ocPop = Number(os.pop ?? 0);
              const ocScatter = Number(os.scatter ?? 0);

              const ocCx = targetW / 2, ocCy = targetH / 2;
              const ocSpread = Math.min(targetW, targetH) * 0.36;
              const ocBaseR = ((Math.min(targetW, targetH) * 0.09) / Math.pow(ocCount / 45, 0.42)) * ocSize;

              let ocSt = orbClusterStateRef.current[layer.id];
              if (!ocSt || ocSt.n !== ocCount) {
                  const orbs: any[] = [];
                  for (let i = 0; i < ocCount; i++) {
                      const a = Math.random() * Math.PI * 2, d = Math.random() * ocSpread;
                      orbs.push({
                          x: ocCx + Math.cos(a) * d, y: ocCy + Math.sin(a) * d,
                          vx: 0, vy: 0,
                          r: ocBaseR * (0.4 + Math.random() * 1.1),
                          hue: Math.random(), phase: Math.random() * 1000,
                          scale: 1, popT: -99,
                      });
                  }
                  ocSt = { n: ocCount, orbs, lastPop: ocPop, lastScatter: ocScatter };
                  orbClusterStateRef.current[layer.id] = ocSt;
              }
              const orbs = ocSt.orbs;

              if (ocPop > ocSt.lastPop) {
                  ocSt.lastPop = ocPop;
                  const nPop = Math.max(1, Math.round(orbs.length * 0.15));
                  for (let k = 0; k < nPop; k++) orbs[Math.floor(Math.random() * orbs.length)].popT = nowSec;
              }
              if (ocScatter > ocSt.lastScatter) {
                  ocSt.lastScatter = ocScatter;
                  for (const o of orbs) {
                      const dx = o.x - ocCx, dy = o.y - ocCy;
                      const d = Math.hypot(dx, dy) || 1;
                      const kick = ocSpread * 1.6;
                      o.vx += (dx / d) * kick; o.vy += (dy / d) * kick;
                  }
              }

              for (const o of orbs) {
                  const dx = ocCx - o.x, dy = ocCy - o.y;
                  o.vx += dx * 0.0009 * (0.3 + ocAttract);
                  o.vy += dy * 0.0009 * (0.3 + ocAttract);
                  o.phase += deltaTime * (0.6 + ocTurb);
                  o.vx += Math.sin(o.phase * 0.9) * 0.06 * ocTurb;
                  o.vy += Math.cos(o.phase * 0.7) * 0.06 * ocTurb;
                  o.vx *= 0.9; o.vy *= 0.9;
                  o.x += o.vx; o.y += o.vy;

                  if (o.popT > -90) {
                      const e = nowSec - o.popT;
                      if (e < 0.4) {
                          o.scale = e < 0.12 ? 1 + (e / 0.12) * 0.8 : 1.8 * (1 - (e - 0.12) / 0.28);
                      } else {
                          const a = Math.random() * Math.PI * 2;
                          o.x = ocCx + Math.cos(a) * ocSpread * 0.9; o.y = ocCy + Math.sin(a) * ocSpread * 0.9;
                          o.r = ocBaseR * (0.35 + Math.random() * 0.6);
                          o.hue = Math.random();
                          o.scale = 1; o.popT = -99;
                      }
                  } else {
                      o.scale += (1 - o.scale) * 0.1;
                  }
              }
              for (let i = 0; i < orbs.length; i++) {
                  for (let j = i + 1; j < orbs.length; j++) {
                      const a = orbs[i], b = orbs[j];
                      const dx = b.x - a.x, dy = b.y - a.y;
                      const d = Math.hypot(dx, dy) || 0.001;
                      const minD = (a.r + b.r) * 0.92;
                      if (d < minD) {
                          const push = ((minD - d) / d) * 0.5;
                          const px = dx * push, py = dy * push;
                          a.x -= px; a.y -= py; b.x += px; b.y += py;
                      }
                  }
              }

              ctx.fillStyle = ocBg; ctx.fillRect(0, 0, targetW, targetH);
              const ocSorted = [...orbs].sort((a, b) => a.y - b.y);
              for (const o of ocSorted) {
                  const r = Math.max(0.5, o.r * o.scale);
                  const lerp = (p: number, q: number, tt: number) => p + (q - p) * tt;
                  const cR = Math.round(lerp(ocRgbA.r, ocRgbB.r, o.hue));
                  const cG = Math.round(lerp(ocRgbA.g, ocRgbB.g, o.hue));
                  const cB = Math.round(lerp(ocRgbA.b, ocRgbB.b, o.hue));
                  const g = ctx.createRadialGradient(o.x - r * 0.35, o.y - r * 0.4, r * 0.05, o.x, o.y, r);
                  g.addColorStop(0, `rgba(${ocRgbHi.r},${ocRgbHi.g},${ocRgbHi.b},${(0.55 + ocGloss * 0.4).toFixed(2)})`);
                  g.addColorStop(0.35, `rgb(${cR},${cG},${cB})`);
                  g.addColorStop(1, `rgba(${Math.round(cR * 0.45)},${Math.round(cG * 0.45)},${Math.round(cB * 0.45)},1)`);
                  ctx.fillStyle = g;
                  ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill();
                  if (ocGloss > 0.15) {
                      ctx.fillStyle = `rgba(255,255,255,${(ocGloss * 0.5).toFixed(2)})`;
                      ctx.beginPath(); ctx.arc(o.x - r * 0.4, o.y - r * 0.45, r * 0.22, 0, Math.PI * 2); ctx.fill();
                  }
              }
              element = canvas;
          } else if (def.uuid === 'hatched-summit-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const hsBg = resolvedGenerativeColors['background'] || '#ede9e2';
              const bands = ['band_1', 'band_2', 'band_3', 'band_4', 'band_5', 'band_6'].map(id => resolvedGenerativeColors[id] || hsBg);

              let hsSt = hatchedSummitStateRef.current[layer.id];
              if (!hsSt) { hsSt = { noise2D: createNoise2D(), regionNoise: createNoise2D(), seed: 0, jitter: 0, erodeFrom: 0, erodeTo: 0, erodeStart: -99, lastErode: 0, lastReplot: 0 }; hatchedSummitStateRef.current[layer.id] = hsSt; }

              const hs = modifiedSettings;
              const peaks = Math.max(1, Math.min(4, Math.round(hs.peaks ?? 2)));
              const elevation = Math.max(10, hs.elevation ?? 150);
              const hatchDensity = Math.max(30, Math.min(200, hs.hatch_density ?? 90));
              const roughness = Math.max(0, Math.min(1, hs.roughness ?? 0.5));
              const hatchAngle = ((hs.hatch_angle ?? -20) * Math.PI) / 180;
              const erodeCount = Number(hs.erode ?? 0);
              const replotCount = Number(hs.replot ?? 0);

              if (replotCount > hsSt.lastReplot) { hsSt.lastReplot = replotCount; hsSt.jitter = Math.random() * 1000; }
              if (erodeCount > hsSt.lastErode) { hsSt.lastErode = erodeCount; hsSt.erodeFrom = hsSt.seed; hsSt.erodeTo = hsSt.seed + 100 + Math.random() * 300; hsSt.erodeStart = nowSec; }
              const erodeDur = 2.2;
              const erodeE = hsSt.erodeStart > -90 ? Math.min(1, (nowSec - hsSt.erodeStart) / erodeDur) : 1;
              const easeE = erodeE * erodeE * (3 - 2 * erodeE);
              hsSt.seed = hsSt.erodeFrom + (hsSt.erodeTo - hsSt.erodeFrom) * easeE;

              ctx.fillStyle = hsBg; ctx.fillRect(0, 0, targetW, targetH);

              const hsCols = Math.max(24, Math.min(140, Math.round(hatchDensity)));
              const hsRows = Math.max(16, Math.round(hsCols * 0.62));
              const hsMarginX = targetW * 0.08, hsMarginY = targetH * 0.14;
              const plotW = targetW * 0.84, plotH = targetH * 0.62;
              const colStep = plotW / hsCols;
              const skewX = (plotW * 0.16) / hsRows;
              const rowStep = plotH / hsRows;
              const ampScale = elevation * (targetH / 900);
              const baseY = hsMarginY + plotH * 0.72;

              const elevAt = (i: number, j: number) => {
                  const fx = i / hsCols, fy = j / hsRows;
                  let e = 0;
                  for (let p = 0; p < peaks; p++) {
                      const px2 = 0.18 + (p / Math.max(1, peaks - 1 || 1)) * 0.64;
                      const dx = fx - px2, dy = fy - 0.5;
                      e = Math.max(e, Math.exp(-((dx * dx) / 0.05 + (dy * dy) / 0.16)));
                  }
                  const n1 = hsSt.noise2D(fx * 3.2 + hsSt.seed, fy * 3.2 + hsSt.seed * 0.7);
                  const n2 = hsSt.noise2D(fx * 7.1 - hsSt.seed * 0.4, fy * 7.1 + hsSt.seed * 1.3) * 0.5;
                  return Math.max(0, e * (0.65 + 0.35 * (n1 * 0.5 + 0.5)) + (n1 + n2) * roughness * 0.18);
              };
              const regionAt = (i: number, j: number) => {
                  const v = hsSt.regionNoise(i * 0.022 + hsSt.jitter, j * 0.032 + hsSt.jitter * 0.6) * 0.5 + 0.5;
                  return Math.min(bands.length - 1, Math.floor(v * bands.length));
              };

              for (let j = 0; j < hsRows; j++) {
                  ctx.beginPath();
                  ctx.moveTo(hsMarginX + j * skewX, targetH + 4);
                  for (let i = 0; i <= hsCols; i++) {
                      const e = elevAt(i, j);
                      const x = hsMarginX + i * colStep + j * skewX;
                      const y = baseY - j * rowStep - e * ampScale;
                      ctx.lineTo(x, y);
                  }
                  ctx.lineTo(hsMarginX + hsCols * colStep + j * skewX, targetH + 4);
                  ctx.closePath();
                  ctx.fillStyle = hsBg;
                  ctx.fill();
              }

              const bandPaths: Path2D[] = bands.map(() => new Path2D());
              for (let j = 0; j < hsRows; j++) {
                  for (let i = 0; i < hsCols; i++) {
                      const e = elevAt(i, j);
                      const x = hsMarginX + i * colStep + j * skewX;
                      const y = baseY - j * rowStep - e * ampScale;
                      const region = regionAt(i, j);
                      const len = rowStep * 1.05 + (Math.random() - 0.5) * roughness * rowStep * 0.4;
                      const ang = hatchAngle + (Math.random() - 0.5) * roughness * 0.6;
                      const path = bandPaths[region];
                      path.moveTo(x, y);
                      path.lineTo(x + Math.sin(ang) * len, y + Math.cos(ang) * len);
                  }
              }
              ctx.lineCap = 'round';
              for (let b = 0; b < bands.length; b++) {
                  ctx.strokeStyle = bands[b];
                  ctx.lineWidth = Math.max(0.6, colStep * 0.55);
                  ctx.stroke(bandPaths[b]);
              }

              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = 1.2;
              ctx.strokeRect(hsMarginX * 0.4, hsMarginY * 0.3, targetW - hsMarginX * 0.8, targetH - hsMarginY * 0.5);

              element = canvas;
          } else if (def.uuid === 'symbol-portrait-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const spBg = resolvedGenerativeColors['background'] || '#000000';
              const spFg = resolvedGenerativeColors['symbols'] || '#ffffff';

              let spSt = symbolPortraitStateRef.current[layer.id];
              if (!spSt) { spSt = { noise2D: createNoise2D(), lastBlink: 0, blinkStart: -99, lastReveal: 0, revealStart: -99 }; symbolPortraitStateRef.current[layer.id] = spSt; }

              const sp = modifiedSettings;
              const resolution = Math.max(5, Math.min(28, sp.resolution ?? 12)) * (Math.min(targetW, targetH) / 700);
              const pose = Math.max(0, Math.min(1, sp.pose ?? 0.5));
              const density = Math.max(0, Math.min(1, sp.density ?? 0.85));
              const shimmer = Math.max(0, sp.shimmer ?? 0.6);
              const contrast = Math.max(0.15, sp.contrast ?? 1.2);
              const blinkCount = Number(sp.blink ?? 0);
              const revealCount = Number(sp.reveal ?? 0);

              if (blinkCount > spSt.lastBlink) { spSt.lastBlink = blinkCount; spSt.blinkStart = nowSec; }
              if (revealCount > spSt.lastReveal) { spSt.lastReveal = revealCount; spSt.revealStart = nowSec; }
              const blinkDur = 0.6, blinkT = nowSec - spSt.blinkStart, blinkActive = blinkT >= 0 && blinkT < blinkDur;
              const revealDur = 1.8, revealT = nowSec - spSt.revealStart;
              const revealE = spSt.revealStart > -90 ? Math.max(0, Math.min(1, revealT / revealDur)) : 1;

              ctx.fillStyle = spBg; ctx.fillRect(0, 0, targetW, targetH);

              const spCx = targetW / 2, spCy = targetH * (0.56 - pose * 0.06);
              const headRX = Math.min(targetW, targetH) * (0.155 + pose * 0.02);
              const headRY = headRX * 1.28;
              const headTiltX = (pose - 0.5) * headRX * 0.5;
              const shoulderY = spCy + headRY * 1.15;
              const shoulderRX = headRX * 2.5;
              const shoulderRY = headRY * 1.6;

              const field = (x: number, y: number) => {
                  const dxH = (x - (spCx + headTiltX)) / headRX, dyH = (y - spCy) / headRY;
                  const head = Math.exp(-((dxH * dxH + dyH * dyH) * 1.7));
                  const dxS = (x - spCx) / shoulderRX, dyS = (y - shoulderY) / shoulderRY;
                  const shoulder = y > spCy ? Math.exp(-((dxS * dxS) * 1.1 + Math.max(0, dyS) * Math.max(0, dyS) * 2.4)) : 0;
                  let v = Math.max(head, shoulder * 0.85);
                  const n = spSt.noise2D(x * 0.012 + nowSec * shimmer * 0.15, y * 0.012) * 0.5 + 0.5;
                  v = v * (0.78 + n * 0.3);
                  return Math.max(0, Math.min(1, Math.pow(v, contrast)));
              };

              const glyphs = ['.', '-', '/', 'o', '▲', '■'];
              const spPaths: Path2D[] = glyphs.map(() => new Path2D());
              const cellsX = Math.ceil(targetW / resolution);
              const cellsY = Math.ceil(targetH / resolution);

              for (let gy = 0; gy < cellsY; gy++) {
                  const rowGate = revealE >= 1 ? true : (gy / cellsY < revealE);
                  if (!rowGate) continue;
                  for (let gx = 0; gx < cellsX; gx++) {
                      const x = gx * resolution + resolution * 0.5;
                      const y = gy * resolution + resolution * 0.5;
                      const v = field(x, y);
                      if (v < 0.03) continue;
                      const keep = Math.abs(spSt.noise2D(gx * 0.31 + 91.1, gy * 0.31 - 41.7)) < density * (0.55 + v * 0.5);
                      if (!keep) continue;
                      let gi = v > 0.82 ? 5 : v > 0.62 ? 4 : v > 0.42 ? 3 : v > 0.24 ? 2 : v > 0.1 ? 1 : 0;
                      if (blinkActive) {
                          const sweepY = (blinkT / blinkDur) * targetH;
                          if (Math.abs(y - sweepY) < resolution * 3) gi = (gi + 3) % glyphs.length;
                      }
                      const s = resolution * (0.32 + v * 0.34);
                      const p = spPaths[gi];
                      if (gi === 0) { p.moveTo(x + s * 0.12, y); p.arc(x, y, s * 0.12, 0, Math.PI * 2); }
                      else if (gi === 1) { p.moveTo(x - s * 0.55, y); p.lineTo(x + s * 0.55, y); }
                      else if (gi === 2) { p.moveTo(x - s * 0.4, y + s * 0.4); p.lineTo(x + s * 0.4, y - s * 0.4); }
                      else if (gi === 3) { p.moveTo(x + s * 0.32, y); p.arc(x, y, s * 0.32, 0, Math.PI * 2); }
                      else if (gi === 4) { p.moveTo(x, y - s * 0.42); p.lineTo(x + s * 0.4, y + s * 0.32); p.lineTo(x - s * 0.4, y + s * 0.32); p.closePath(); }
                      else { p.rect(x - s * 0.3, y - s * 0.3, s * 0.6, s * 0.6); }
                  }
              }

              ctx.fillStyle = spFg;
              ctx.strokeStyle = spFg;
              ctx.lineWidth = Math.max(1, resolution * 0.09);
              for (let i = 0; i < glyphs.length; i++) {
                  if (i === 1 || i === 2) ctx.stroke(spPaths[i]); else ctx.fill(spPaths[i]);
              }

              element = canvas;
          } else if (def.uuid === 'ink-blot-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const ibBg = resolvedGenerativeColors['background'] || '#ffffff';
              const ibInk = resolvedGenerativeColors['ink'] || '#000000';
              const ibHiRgb = hexToRgb(resolvedGenerativeColors['highlight'] || '#ffffff');

              let ibSt = inkBlotStateRef.current[layer.id];
              if (!ibSt) {
                  ibSt = { goo: document.createElement('canvas'), lobes: [], drops: [], lastSplat: 0, splatStart: -99, lastGravity: 0, gravityOn: false };
                  inkBlotStateRef.current[layer.id] = ibSt;
              }

              const ib = modifiedSettings;
              const blobCount = Math.max(2, Math.min(6, Math.round(ib.blob_count ?? 4)));
              const ibSize = Math.max(0.3, ib.size ?? 1);
              const viscosity = Math.max(0, Math.min(1, ib.viscosity ?? 0.4));
              const dropletCount = Math.max(0, Math.min(24, Math.round(ib.droplet_count ?? 10)));
              const sheen = Math.max(0, Math.min(1, ib.sheen ?? 0.5));
              const splatCount = Number(ib.splat ?? 0);
              const gravityCount = Number(ib.gravity ?? 0);

              if (blobCount !== ibSt.lobes.length) {
                  ibSt.lobes = Array.from({ length: blobCount }, () => ({
                      ax: 0.15 + Math.random() * 0.15, ay: 0.15 + Math.random() * 0.15,
                      fx: 0.3 + Math.random() * 0.5, fy: 0.3 + Math.random() * 0.5,
                      px: Math.random() * 10, py: Math.random() * 10,
                  }));
              }
              if (dropletCount !== ibSt.drops.length) {
                  ibSt.drops = Array.from({ length: dropletCount }, () => ({
                      x: targetW / 2 + (Math.random() - 0.5) * targetW * 0.6,
                      y: targetH / 2 + (Math.random() - 0.5) * targetH * 0.6,
                      vx: 0, vy: 0, r: (6 + Math.random() * 14) * (Math.min(targetW, targetH) / 700),
                      ox: Math.random() * 10, oy: Math.random() * 10,
                  }));
              }

              if (splatCount > ibSt.lastSplat) {
                  ibSt.lastSplat = splatCount; ibSt.splatStart = nowSec;
                  for (let k = 0; k < 4; k++) {
                      const a = Math.random() * Math.PI * 2;
                      ibSt.drops.push({ x: targetW / 2, y: targetH / 2, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, r: (5 + Math.random() * 10) * (Math.min(targetW, targetH) / 700), ox: Math.random() * 10, oy: Math.random() * 10 });
                  }
                  if (ibSt.drops.length > 40) ibSt.drops.splice(0, ibSt.drops.length - 40);
              }
              if (gravityCount > ibSt.lastGravity) { ibSt.lastGravity = gravityCount; ibSt.gravityOn = !ibSt.gravityOn; }

              const ibCx = targetW / 2, ibCy = targetH / 2;
              const ibSpread = Math.min(targetW, targetH) * 0.11 * ibSize;
              const ibT = nowSec * 0.3;
              const splatE = Math.max(0, 1 - (nowSec - ibSt.splatStart) / 0.5);

              for (const d of ibSt.drops) {
                  if (ibSt.gravityOn) {
                      d.vy += 0.35;
                      d.x += Math.sin(nowSec * 0.6 + d.ox) * 0.3;
                      const floorY = targetH * 0.92;
                      if (d.y > floorY) { d.y = floorY; d.vy *= -0.3; }
                  } else {
                      const tx = ibCx + Math.sin(ibT * d.fx + d.ox) * (ibSpread * 3.2 || 1);
                      const ty = ibCy + Math.cos(ibT * d.fy + d.oy) * (ibSpread * 3.2 || 1);
                      d.vx += (tx - d.x) * 0.01; d.vy += (ty - d.y) * 0.01;
                  }
                  d.vx *= 0.92; d.vy *= 0.92;
                  d.x += d.vx; d.y += d.vy;
              }

              const goo: HTMLCanvasElement = ibSt.goo;
              goo.width = targetW; goo.height = targetH;
              const gctx = goo.getContext('2d')!;
              gctx.clearRect(0, 0, targetW, targetH);
              gctx.fillStyle = ibBg; gctx.fillRect(0, 0, targetW, targetH);
              gctx.fillStyle = ibInk;
              gctx.filter = `blur(${Math.max(2, (10 + viscosity * 26) * (Math.min(targetW, targetH) / 700))}px)`;
              const squash = 1 - splatE * 0.35;
              for (let i = 0; i < ibSt.lobes.length; i++) {
                  const l = ibSt.lobes[i];
                  const lx = ibCx + Math.sin(ibT * l.fx + l.px) * ibSpread * l.ax * 6;
                  const ly = ibCy + Math.cos(ibT * l.fy + l.py) * ibSpread * l.ay * 6;
                  gctx.beginPath();
                  gctx.ellipse(lx, ly, ibSpread * (1 + splatE * 0.5), Math.max(1, ibSpread * squash), 0, 0, Math.PI * 2);
                  gctx.fill();
              }
              gctx.filter = 'none';

              ctx.fillStyle = ibBg; ctx.fillRect(0, 0, targetW, targetH);
              ctx.filter = 'contrast(28)';
              ctx.drawImage(goo, 0, 0);
              ctx.filter = 'none';

              // droplets rendered crisp, decoupled from the goo blur (a small disc
              // blurred at the same radius as the main mass would nearly vanish)
              ctx.fillStyle = ibInk;
              for (const d of ibSt.drops) {
                  ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
              }

              if (sheen > 0.05) {
                  const g = ctx.createRadialGradient(ibCx - ibSpread * 0.9, ibCy - ibSpread * 1.1, 2, ibCx - ibSpread * 0.5, ibCy - ibSpread * 0.6, ibSpread * 1.6);
                  g.addColorStop(0, `rgba(${ibHiRgb.r},${ibHiRgb.g},${ibHiRgb.b},${(sheen * 0.55).toFixed(2)})`);
                  g.addColorStop(1, `rgba(${ibHiRgb.r},${ibHiRgb.g},${ibHiRgb.b},0)`);
                  ctx.globalCompositeOperation = 'overlay';
                  ctx.fillStyle = g;
                  ctx.beginPath(); ctx.arc(ibCx, ibCy, ibSpread * 2.4, 0, Math.PI * 2); ctx.fill();
                  ctx.globalCompositeOperation = 'source-over';
              }

              element = canvas;
          } else if (def.uuid === 'floating-gem-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const fgSky = resolvedGenerativeColors['background'] || '#1b2140';
              const fgGem = resolvedGenerativeColors['gem'] || '#ffcf5c';
              const fgBeam = resolvedGenerativeColors['beam'] || '#ff7a2e';
              const fgDust = resolvedGenerativeColors['dust'] || '#ffffff';
              const fgBeamRgb = hexToRgb(fgBeam);

              let fgSt = floatingGemStateRef.current[layer.id];
              if (!fgSt) { fgSt = { dust: Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), sp: 0.3 + Math.random() * 0.7, ph: Math.random() * 10 })), lastPulse: 0, pulseStart: -99, lastShatter: 0, shatterStart: -99 }; floatingGemStateRef.current[layer.id] = fgSt; }

              const fg = modifiedSettings;
              const facets = Math.max(4, Math.min(10, Math.round(fg.facets ?? 6)));
              const rotSpeed = Math.max(0, fg.rotation_speed ?? 0.6);
              const bob = Math.max(0, Math.min(1, fg.bob ?? 0.5));
              const glow = Math.max(0, Math.min(1, fg.glow ?? 0.7));
              const beam = Math.max(0, Math.min(1, fg.beam ?? 0.6));
              const pulseCount = Number(fg.pulse ?? 0);
              const shatterCount = Number(fg.shatter ?? 0);

              if (pulseCount > fgSt.lastPulse) { fgSt.lastPulse = pulseCount; fgSt.pulseStart = nowSec; }
              if (shatterCount > fgSt.lastShatter) { fgSt.lastShatter = shatterCount; fgSt.shatterStart = nowSec; }
              const pulseDur = 0.5, pulseT = nowSec - fgSt.pulseStart, pulseActive = pulseT >= 0 && pulseT < pulseDur;
              const pulseEnv = pulseActive ? Math.sin(Math.PI * (pulseT / pulseDur)) : 0;
              const shatterDur = 1.5, shatterT = nowSec - fgSt.shatterStart, shatterActive = shatterT >= 0 && shatterT < shatterDur;
              const shatterProg = shatterActive ? shatterT / shatterDur : 1;
              const shatterKick = shatterActive ? (1 - shatterProg) : 0;

              ctx.fillStyle = fgSky; ctx.fillRect(0, 0, targetW, targetH);

              const fgCx = targetW / 2;
              const fgCy = targetH * 0.42 + Math.sin(nowSec * (0.6 + bob * 1.4)) * targetH * 0.05 * bob;
              const fgScale = Math.min(targetW, targetH) * 0.22;

              if (beam > 0.02) {
                  const beamLen = targetH * (0.4 + beam * 0.4);
                  const g = ctx.createLinearGradient(fgCx, fgCy, fgCx, fgCy + beamLen);
                  g.addColorStop(0, `rgba(${fgBeamRgb.r},${fgBeamRgb.g},${fgBeamRgb.b},${((0.5 + pulseEnv * 0.4) * beam).toFixed(2)})`);
                  g.addColorStop(1, `rgba(${fgBeamRgb.r},${fgBeamRgb.g},${fgBeamRgb.b},0)`);
                  ctx.fillStyle = g;
                  ctx.beginPath();
                  ctx.moveTo(fgCx - fgScale * 0.5, fgCy);
                  ctx.lineTo(fgCx + fgScale * 0.5, fgCy);
                  ctx.lineTo(fgCx + fgScale * 1.6, fgCy + beamLen);
                  ctx.lineTo(fgCx - fgScale * 1.6, fgCy + beamLen);
                  ctx.closePath();
                  ctx.fill();
              }

              for (const d of fgSt.dust) {
                  const y = (d.y + nowSec * 0.03 * d.sp) % 1;
                  const x = d.x + Math.sin(nowSec * 0.5 + d.ph) * 0.03;
                  const px = fgCx + (x - 0.5) * fgScale * 3.2;
                  const py = fgCy + y * targetH * 0.55;
                  const a = (0.15 + 0.35 * Math.sin(nowSec * 2 + d.ph)) * (0.4 + beam * 0.6);
                  ctx.fillStyle = fgDust;
                  ctx.globalAlpha = Math.max(0, a);
                  ctx.beginPath(); ctx.arc(px, py, 1.4 * (Math.min(targetW, targetH) / 700), 0, Math.PI * 2); ctx.fill();
              }
              ctx.globalAlpha = 1;

              const angle = nowSec * rotSpeed;
              const rgbGem = hexToRgb(fgGem);
              const verts: { x: number; y: number; z: number }[] = [{ x: 0, y: -1.15, z: 0 }, { x: 0, y: 0.85, z: 0 }];
              for (let i = 0; i < facets; i++) {
                  const a = (i / facets) * Math.PI * 2 + angle;
                  verts.push({ x: Math.cos(a), y: -0.05, z: Math.sin(a) });
              }
              const proj = verts.map((v, i) => {
                  const persp = 1 / (1 + (v.z * 0.35 + 0.35));
                  const kick = shatterActive ? shatterKick * 40 * (i % 3 === 0 ? 1 : -1) : 0;
                  return { x: fgCx + v.x * fgScale * persp + kick, y: fgCy + v.y * fgScale * persp - kick * 0.6 };
              });

              const fgEdges: [number, number][] = [];
              for (let i = 0; i < facets; i++) {
                  const a = 2 + i, b = 2 + ((i + 1) % facets);
                  fgEdges.push([0, a], [1, a], [a, b]);
              }

              ctx.lineCap = 'round'; ctx.lineJoin = 'round';
              if (glow > 0.02) {
                  ctx.strokeStyle = `rgba(${rgbGem.r},${rgbGem.g},${rgbGem.b},${(0.16 * glow + pulseEnv * 0.25).toFixed(2)})`;
                  for (let pass = 0; pass < 3; pass++) {
                      ctx.lineWidth = 2 + pass * 6 + pulseEnv * 6;
                      ctx.beginPath();
                      for (const [a, b] of fgEdges) { ctx.moveTo(proj[a].x, proj[a].y); ctx.lineTo(proj[b].x, proj[b].y); }
                      ctx.stroke();
                  }
              }
              ctx.globalAlpha = 0.12;
              for (let i = 0; i < facets; i++) {
                  const a = 2 + i, b = 2 + ((i + 1) % facets);
                  ctx.fillStyle = fgGem;
                  ctx.beginPath();
                  ctx.moveTo(proj[0].x, proj[0].y); ctx.lineTo(proj[a].x, proj[a].y); ctx.lineTo(proj[b].x, proj[b].y); ctx.closePath();
                  ctx.fill();
              }
              ctx.globalAlpha = 1;
              ctx.strokeStyle = fgGem;
              ctx.lineWidth = Math.max(1, fgScale * 0.02);
              ctx.beginPath();
              for (const [a, b] of fgEdges) { ctx.moveTo(proj[a].x, proj[a].y); ctx.lineTo(proj[b].x, proj[b].y); }
              ctx.stroke();

              element = canvas;
          } else if (def.uuid === 'confetti-scatter-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const csBg = resolvedGenerativeColors['background'] || '#ffffff';
              const csA = resolvedGenerativeColors['shape_a'] || '#e63946';
              const csB = resolvedGenerativeColors['shape_b'] || '#1d3557';

              let csSt = confettiScatterStateRef.current[layer.id];
              if (!csSt) { csSt = { parts: [], lastBurst: 0 }; confettiScatterStateRef.current[layer.id] = csSt; }

              const cs = modifiedSettings;
              const density = Math.max(10, Math.min(500, Math.round(cs.density ?? 160)));
              const gravity = Math.max(0, cs.gravity ?? 0.6);
              const spin = Math.max(0, cs.spin ?? 1.2);
              const sizeMul = Math.max(0.1, cs.size ?? 1);
              const turb = Math.max(0, cs.turbulence ?? 0.5);
              const burstCount = Number(cs.burst ?? 0);
              const freezeCount = Number(cs.freeze ?? 0);
              const frozen = Math.floor(freezeCount) % 2 === 1;

              const csKinds = ['tri', 'circle', 'dash', 'rect'] as const;
              const spawn = (seeded: boolean) => {
                  const s = (4 + Math.random() * 14) * sizeMul * (Math.min(targetW, targetH) / 700);
                  return {
                      x: Math.random() * targetW, y: seeded ? Math.random() * targetH : -Math.random() * targetH * 0.4,
                      vx: 0, vy: 0,
                      rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * spin * 4,
                      kind: csKinds[Math.floor(Math.random() * csKinds.length)],
                      colorA: Math.random() < 0.5, size: s, ph: Math.random() * 10,
                  };
              };
              while (csSt.parts.length < density) csSt.parts.push(spawn(true));
              if (csSt.parts.length > density) csSt.parts.length = density;

              if (burstCount > csSt.lastBurst) {
                  csSt.lastBurst = burstCount;
                  for (const p of csSt.parts) {
                      const a = Math.atan2(p.y - targetH / 2, p.x - targetW / 2) + (Math.random() - 0.5) * 0.6;
                      const v = 5 + Math.random() * 10;
                      p.x = targetW / 2; p.y = targetH / 2;
                      p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
                  }
              }

              if (!frozen) {
                  for (const p of csSt.parts) {
                      p.vy += gravity * 0.12;
                      p.vx += Math.sin(nowSec * 0.8 + p.ph) * turb * 0.08;
                      p.vx *= 0.985; p.vy *= 0.995;
                      p.x += p.vx; p.y += p.vy;
                      p.rot += p.rotSpeed * deltaTime;
                      if (p.y - p.size > targetH) { p.y = -p.size; p.x = Math.random() * targetW; p.vx = 0; p.vy = 0; }
                      if (p.x < -20) p.x = targetW + 20;
                      if (p.x > targetW + 20) p.x = -20;
                  }
              }

              ctx.fillStyle = csBg; ctx.fillRect(0, 0, targetW, targetH);
              for (const p of csSt.parts) {
                  ctx.save();
                  ctx.translate(p.x, p.y);
                  ctx.rotate(p.rot);
                  ctx.fillStyle = p.colorA ? csA : csB;
                  const s = p.size;
                  if (p.kind === 'tri') { ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(s * 0.55, s * 0.5); ctx.lineTo(-s * 0.55, s * 0.5); ctx.closePath(); ctx.fill(); }
                  else if (p.kind === 'circle') { ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill(); }
                  else if (p.kind === 'dash') { ctx.fillRect(-s * 0.6, -s * 0.09, s * 1.2, s * 0.18); }
                  else { ctx.fillRect(-s * 0.35, -s * 0.35, s * 0.7, s * 0.7); }
                  ctx.restore();
              }

              element = canvas;
          } else if (def.uuid === 'woven-hex-blocks-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const whBg = resolvedGenerativeColors['background'] || '#000000';
              const whLine = resolvedGenerativeColors['lines'] || '#ffffff';
              const whAccent = resolvedGenerativeColors['accent'] || whLine;

              const wh = modifiedSettings;
              const whBlocks = Math.max(4, Math.min(24, Math.round(wh.blocks ?? 14)));
              const whBands = Math.max(3, Math.min(22, Math.round(wh.bands ?? 12)));
              const whTaper = Math.max(-1, Math.min(1, wh.taper ?? -0.9));
              const whBandRatio = Math.max(0.05, Math.min(0.6, wh.band_ratio ?? 0.25));
              const whSpread = Math.max(0.35, Math.min(1.6, wh.spread ?? 0.9));
              const whSize = Math.max(0.3, Math.min(2, wh.size ?? 1));
              const whRnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7 + 137 * 0.113) * 43758.5453; return x - Math.floor(x); };

              let whSt = wovenHexStateRef.current[layer.id];
              if (!whSt) { whSt = { lastReweave: 0, reweaveStart: -99, lastCollapse: 0, collapseStart: -99 }; wovenHexStateRef.current[layer.id] = whSt; }
              const whRw = Number(wh.reweave ?? 0), whCl = Number(wh.collapse ?? 0);
              if (whRw > whSt.lastReweave) { whSt.lastReweave = whRw; whSt.reweaveStart = nowSec; }
              if (whCl > whSt.lastCollapse) { whSt.lastCollapse = whCl; whSt.collapseStart = nowSec; }
              const whRwT = nowSec - whSt.reweaveStart;
              const whRwP = (whRwT >= 0 && whRwT < 1.0) ? whRwT / 1.0 : 1;
              const whClT = nowSec - whSt.collapseStart;
              const whClEnv = (whClT >= 0 && whClT < 1.3) ? Math.sin(Math.PI * (whClT / 1.3)) : 0;

              ctx.fillStyle = whBg; ctx.fillRect(0, 0, targetW, targetH);

              const whRing = Math.ceil((Math.sqrt(Math.max(1, 12 * whBlocks - 3)) - 3) / 6) + 1;
              const whAxial: { q: number; r: number }[] = [];
              for (let q = -whRing; q <= whRing; q++)
                  for (let r = Math.max(-whRing, -q - whRing); r <= Math.min(whRing, -q + whRing); r++)
                      whAxial.push({ q, r });
              whAxial.sort((a, b) => (Math.abs(a.q) + Math.abs(a.r) + Math.abs(a.q + a.r)) - (Math.abs(b.q) + Math.abs(b.r) + Math.abs(b.q + b.r)));
              const whChosen = whAxial.slice(0, whBlocks);

              const whUnit = Math.min(targetW, targetH) / (whRing * 3.6 + 4) * whSpread * whSize * 1.9;
              const whR = whUnit * (1 - whClEnv * 0.12);
              const whEx = { x: whUnit * 1.5, y: whUnit * 0.30 };
              const whEy = { x: 0, y: whUnit * 1.02 * (1 - whClEnv * 0.72) };
              const whCx = targetW / 2, whCy = targetH / 2;
              const whBreath = Math.sin(nowSec * 0.6) * whUnit * 0.06;

              const whHatch = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}, d: {x:number;y:number}, n: number, tp: number, col: string, lw: number) => {
                  ctx.strokeStyle = col; ctx.lineWidth = lw;
                  ctx.beginPath();
                  for (let i = 0; i <= n; i++) {
                      let t = i / n;
                      t = tp >= 0 ? Math.pow(t, 1 + tp * 3) : 1 - Math.pow(1 - t, 1 - tp * 3);
                      ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                      ctx.lineTo(d.x + (c.x - d.x) * t, d.y + (c.y - d.y) * t);
                  }
                  ctx.stroke();
              };

              for (let i = 0; i < whChosen.length; i++) {
                  const cell = whChosen[i];
                  let bx = whCx + cell.q * whEx.x + cell.r * whEy.x;
                  let by = whCy + cell.q * whEx.y + cell.r * whEy.y + whBreath * (i % 2 ? 1 : -1);
                  if (whRwP < 1) {
                      const sx = (whRnd(i * 2.3) - 0.5) * targetW * 1.4;
                      const sy = (whRnd(i * 5.9) - 0.5) * targetH * 1.4;
                      const k = 1 - Math.pow(1 - whRwP, 3);
                      bx += sx * (1 - k); by += sy * (1 - k);
                  }
                  const vs: { x: number; y: number }[] = [];
                  for (let k = 0; k < 6; k++) {
                      const ang = Math.PI / 180 * (60 * k - 90);
                      vs.push({ x: bx + Math.cos(ang) * whR, y: by + Math.sin(ang) * whR * 0.86 });
                  }
                  const O = { x: bx, y: by };
                  const lw = Math.max(0.6, whR * 0.02 * (0.5 + whBandRatio));
                  whHatch(vs[5], vs[0], vs[1], O, whBands, whTaper, whLine, lw);
                  whHatch(vs[1], vs[2], vs[3], O, Math.round(whBands * 0.85), -whTaper, whLine, lw);
                  whHatch(vs[3], vs[4], vs[5], O, whBands, whTaper * 0.6, whLine, lw);
                  ctx.strokeStyle = whLine; ctx.lineWidth = lw * 1.2;
                  ctx.beginPath();
                  vs.forEach((v, k) => k ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
                  ctx.closePath(); ctx.stroke();
                  ctx.strokeStyle = whAccent; ctx.lineWidth = lw * 0.9; ctx.globalAlpha = 0.5 + whClEnv * 0.5;
                  ctx.beginPath();
                  ctx.moveTo(vs[0].x, vs[0].y); ctx.lineTo(O.x, O.y);
                  ctx.moveTo(vs[2].x, vs[2].y); ctx.lineTo(O.x, O.y);
                  ctx.moveTo(vs[4].x, vs[4].y); ctx.lineTo(O.x, O.y);
                  ctx.stroke(); ctx.globalAlpha = 1;
              }
              element = canvas;
          } else if (def.uuid === 'circuit-routes-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const crBg = resolvedGenerativeColors['background'] || '#0d1117';
              const crNode = resolvedGenerativeColors['nodes'] || '#39d353';
              const crTrace = resolvedGenerativeColors['traces'] || '#2ea043';
              const crPulseC = resolvedGenerativeColors['pulse'] || '#00ff66';

              const cr = modifiedSettings;
              const crCols = Math.max(8, Math.min(40, Math.round(cr.columns ?? 19)));
              const crRows = crCols;
              const crNodeSize = Math.max(1, Math.min(10, cr.node_size ?? 5));
              const crRouteDensity = Math.max(0, Math.min(0.5, cr.route_density ?? 0.13));
              const crJitter = Math.max(0, Math.min(30, cr.jitter ?? 0));
              const crRoamers = Math.max(0, Math.min(24, Math.round(cr.roamers ?? 5)));
              const CR_SEED = 90;
              const crRnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7 + CR_SEED * 0.531) * 43758.5453; return x - Math.floor(x); };

              let crSt = circuitRoutesStateRef.current[layer.id];
              if (!crSt) crSt = circuitRoutesStateRef.current[layer.id] = { routes: [], adj: {}, agents: [], key: '', salt: 0, lastPulse: 0, lastRewire: 0, rewireStart: -99, lastRoamAt: -99 };
              const crKey = `${crCols}:${crRouteDensity.toFixed(3)}:${crSt.salt}`;
              if (crSt.key !== crKey) {
                  crSt.key = crKey;
                  crSt.routes = []; crSt.adj = {}; crSt.agents = [];
                  const maxR = Math.floor(crCols * crRows * crRouteDensity);
                  let tries = 0;
                  while (crSt.routes.length < maxR && tries < maxR * 8 + 40) {
                      tries++;
                      const salt = tries + crSt.salt * 131.7;
                      const c = Math.floor(crRnd(salt * 1.1) * crCols);
                      const r = Math.floor(crRnd(salt * 2.7) * crRows);
                      const horiz = crRnd(salt * 3.3) > 0.5;
                      const len = 1 + Math.floor(crRnd(salt * 4.9) * 3);
                      const c2 = horiz ? Math.min(crCols - 1, c + len) : c;
                      const r2 = horiz ? r : Math.min(crRows - 1, r + len);
                      if (c2 === c && r2 === r) continue;
                      const bend = crRnd(salt * 6.1) > 0.4;
                      const idx = crSt.routes.length;
                      crSt.routes.push({ c, r, c2, r2, bend });
                      const ka = c + ',' + r, kb = c2 + ',' + r2;
                      (crSt.adj[ka] || (crSt.adj[ka] = [])).push(idx);
                      (crSt.adj[kb] || (crSt.adj[kb] = [])).push(idx);
                  }
              }
              const routes = crSt.routes;

              const crGx = targetW / (crCols + 1), crGy = targetH / (crRows + 1);
              const crP = (c: number, r: number) => ({
                  x: crGx * (c + 1) + (crJitter ? (crRnd(c * 31.7 + r * 12.3) - 0.5) * crJitter : 0),
                  y: crGy * (r + 1) + (crJitter ? (crRnd(c * 7.1 + r * 51.9) - 0.5) * crJitter : 0),
              });
              const crRoutePos = (rt: any, s: number) => {
                  const a = crP(rt.c, rt.r), b = crP(rt.c2, rt.r2);
                  if (!rt.bend) return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
                  const m = { x: b.x, y: a.y };
                  if (s < 0.5) { const u = s * 2; return { x: a.x + (m.x - a.x) * u, y: a.y + (m.y - a.y) * u }; }
                  const u = (s - 0.5) * 2; return { x: m.x + (b.x - m.x) * u, y: m.y + (b.y - m.y) * u };
              };
              const crAgentScreen = (ag: any) => crRoutePos(routes[ag.route], ag.entA ? ag.t : 1 - ag.t);
              const crArrivalKey = (ag: any) => { const rt = routes[ag.route]; return ag.entA ? (rt.c2 + ',' + rt.r2) : (rt.c + ',' + rt.r); };
              const crAdvance = (ag: any) => {
                  let guard = 0;
                  while (ag.t >= 1 && guard++ < 6) {
                      const ak = crArrivalKey(ag);
                      const cand = (crSt.adj[ak] || []).filter((ri: number) => ri !== ag.route);
                      if (!cand.length) return false;
                      const next = cand[Math.floor(Math.random() * cand.length)];
                      const nrt = routes[next];
                      ag.route = next;
                      ag.entA = (nrt.c + ',' + nrt.r) === ak;
                      ag.t -= 1;
                  }
                  return ag.t < 1;
              };

              const crPulseN = Number(cr.pulse_route ?? 0), crRewireN = Number(cr.rewire ?? 0);
              if (crRewireN > crSt.lastRewire) { crSt.lastRewire = crRewireN; crSt.salt += 1; crSt.key = ''; crSt.rewireStart = nowSec; }
              if (crPulseN > crSt.lastPulse) {
                  crSt.lastPulse = crPulseN;
                  const seen = new Set<number>();
                  for (const kk of Object.keys(crSt.adj)) {
                      const parts = kk.split(','); const pc = +parts[0], pr = +parts[1];
                      if (pc === 0 || pr === 0 || pc === crCols - 1 || pr === crRows - 1) {
                          const ri = crSt.adj[kk][0];
                          if (seen.has(ri)) continue; seen.add(ri);
                          const rt = routes[ri];
                          const entA = (rt.c + ',' + rt.r) === kk;
                          crSt.agents.push({ route: ri, entA, t: 0, speed: 1.5 + Math.random() * 0.6, kind: 'sig' });
                      }
                  }
              }
              const crRewireT = nowSec - crSt.rewireStart, crRewireP = crRewireT >= 0 && crRewireT < 0.9 ? crRewireT / 0.9 : 1;

              const crDt = Math.min(0.05, Math.max(0.001, deltaTime || 0.016));
              if (crRoamers > 0 && routes.length && crSt.agents.filter((a: any) => a.kind === 'roam').length < crRoamers && nowSec - crSt.lastRoamAt > 0.25) {
                  crSt.agents.push({ route: Math.floor(Math.random() * routes.length), entA: Math.random() > 0.5, t: Math.random() * 0.25, speed: 0.55 + Math.random() * 0.7, kind: 'roam' });
                  crSt.lastRoamAt = nowSec;
              }
              const crSurv: any[] = [];
              for (const ag of crSt.agents) {
                  ag.t += ag.speed * crDt;
                  if (!crAdvance(ag)) continue;
                  crSurv.push(ag);
              }
              const crCollR = Math.max(6, crNodeSize * 1.4);
              const crPts = crSurv.map(crAgentScreen);
              const crKill = new Set<number>();
              for (let i = 0; i < crSurv.length; i++) {
                  if (crSurv[i].kind !== 'sig') continue;
                  for (let j = 0; j < crSurv.length; j++) {
                      if (i === j) continue;
                      const dx = crPts[i].x - crPts[j].x, dy = crPts[i].y - crPts[j].y;
                      if (dx * dx + dy * dy < crCollR * crCollR && !(crSurv[i].t < 0.12 && crSurv[j].kind === 'sig' && crSurv[j].t < 0.12)) { crKill.add(i); break; }
                  }
              }
              crSt.agents = crSurv.filter((_: any, i: number) => !crKill.has(i));

              ctx.fillStyle = crBg; ctx.fillRect(0, 0, targetW, targetH);
              ctx.lineCap = 'round'; ctx.lineJoin = 'round';
              ctx.strokeStyle = crTrace; ctx.lineWidth = Math.max(1, crNodeSize * 0.4);
              routes.forEach((rt: any, i: number) => {
                  const reveal = crRewireP < 1 ? Math.max(0, Math.min(1, crRewireP * routes.length - i)) : 1;
                  if (reveal <= 0) return;
                  const steps = rt.bend ? 2 : 1;
                  const p0 = crRoutePos(rt, 0); ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
                  for (let s = 1; s <= steps; s++) { const p = crRoutePos(rt, (s / steps) * reveal); ctx.lineTo(p.x, p.y); }
                  ctx.stroke();
              });
              ctx.fillStyle = crNode;
              for (let r = 0; r < crRows; r++) for (let c = 0; c < crCols; c++) {
                  const p = crP(c, r);
                  ctx.beginPath(); ctx.arc(p.x, p.y, crNodeSize * 0.5, 0, Math.PI * 2); ctx.fill();
              }
              for (const ag of crSt.agents) {
                  const p = crAgentScreen(ag);
                  if (ag.kind === 'sig') {
                      ctx.fillStyle = crPulseC; ctx.shadowColor = crPulseC; ctx.shadowBlur = 16;
                      ctx.beginPath(); ctx.arc(p.x, p.y, crNodeSize * 0.9, 0, Math.PI * 2); ctx.fill();
                      ctx.shadowBlur = 0;
                  } else {
                      const back = crRoutePos(routes[ag.route], Math.max(0, Math.min(1, (ag.entA ? ag.t : 1 - ag.t) + (ag.entA ? -0.06 : 0.06))));
                      ctx.strokeStyle = crPulseC; ctx.globalAlpha = 0.5; ctx.lineWidth = crNodeSize * 0.5;
                      ctx.beginPath(); ctx.moveTo(back.x, back.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.globalAlpha = 1;
                      ctx.fillStyle = crPulseC;
                      ctx.beginPath(); ctx.arc(p.x, p.y, crNodeSize * 0.55, 0, Math.PI * 2); ctx.fill();
                  }
              }
              element = canvas;
          } else if (def.uuid === 'spiral-shells-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const ssBg = resolvedGenerativeColors['background'] || '#000000';
              const ssLine = resolvedGenerativeColors['lines'] || '#ffffff';
              const ssAccent = resolvedGenerativeColors['accent'] || '#7599a4';

              const ss = modifiedSettings;
              const ssSides = Math.max(3, Math.min(12, Math.round(ss.sides ?? 8)));
              const ssRings = Math.max(3, Math.min(44, Math.round(ss.rings ?? 20)));
              const ssSize = Math.max(0.3, Math.min(2, ss.size ?? 1));
              const ssTurns = Math.max(0, Math.min(10, ss.turns ?? 5.5));
              const ssBaseRadius = Math.max(50, Math.min(400, ss.radius ?? 300));
              const ssNoiseAmt = Math.max(0, Math.min(1, ss.noise_amt ?? 0.37));

              let ssSt = spiralShellsStateRef.current[layer.id];
              if (!ssSt) ssSt = spiralShellsStateRef.current[layer.id] = { lastUnwind: 0, unwindStart: -99, lastTwist: 0, twistStart: -99 };
              const ssUw = Number(ss.unwind ?? 0), ssTw = Number(ss.twist ?? 0);
              if (ssUw > ssSt.lastUnwind) { ssSt.lastUnwind = ssUw; ssSt.unwindStart = nowSec; }
              if (ssTw > ssSt.lastTwist) { ssSt.lastTwist = ssTw; ssSt.twistStart = nowSec; }
              const ssUwT = nowSec - ssSt.unwindStart;
              const ssUwEnv = (ssUwT >= 0 && ssUwT < 1.8) ? Math.sin(Math.PI * (ssUwT / 1.8)) : 0;
              const ssTwT = nowSec - ssSt.twistStart;
              const ssTwEnv = (ssTwT >= 0 && ssTwT < 1.4) ? (1 - ssTwT / 1.4) : 0;

              ctx.fillStyle = ssBg; ctx.fillRect(0, 0, targetW, targetH);
              const ssSc = Math.min(targetW, targetH) / 800 * ssSize;
              const ssCx = targetW / 2, ssCy = targetH / 2;
              const ssRot0 = nowSec * 0.15;
              ctx.lineJoin = 'round';
              for (let i = 0; i < ssRings; i++) {
                  const f = i / ssRings;
                  const rad = ssBaseRadius * ssSc * (1 - f * 0.92);
                  const spiralAng = f * ssTurns * Math.PI * 2 + ssRot0;
                  const spiralR = f * ssBaseRadius * ssSc * 0.55 * (1 - ssUwEnv);
                  const ox = ssCx + Math.cos(spiralAng) * spiralR + ssUwEnv * (f - 0.5) * targetW * 0.9;
                  const oy = ssCy + Math.sin(spiralAng) * spiralR * (1 - ssUwEnv);
                  const ringRot = spiralAng + ssTwEnv * f * 6;
                  ctx.strokeStyle = i === 0 ? ssAccent : ssLine;
                  ctx.globalAlpha = 0.25 + 0.75 * (1 - f);
                  ctx.lineWidth = Math.max(0.5, (1.6 - f) * ssSc * 1.3);
                  ctx.beginPath();
                  for (let k = 0; k <= ssSides; k++) {
                      const a = (k / ssSides) * Math.PI * 2 + ringRot;
                      const wob = 1 + Math.sin(a * 3 + nowSec + i) * ssNoiseAmt * 0.22;
                      const rr = rad * wob * (1 - 0.12 * Math.cos(a * ssSides));
                      const px = ox + Math.cos(a) * rr;
                      const py = oy + Math.sin(a) * rr;
                      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                  }
                  ctx.closePath(); ctx.stroke();
              }
              ctx.globalAlpha = 1;
              element = canvas;
          } else if (def.uuid === 'polar-checker-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const pcBg = resolvedGenerativeColors['background'] || '#000000';
              const pcFill = resolvedGenerativeColors['fill'] || '#ffffff';
              const pcGrid = resolvedGenerativeColors['grid'] || '#7599a4';

              const pc = modifiedSettings;
              const pcSectors = Math.max(6, Math.min(64, Math.round(pc.sectors ?? 52)));
              const pcRings = Math.max(3, Math.min(20, Math.round(pc.rings ?? 11)));
              const pcInner = Math.max(10, Math.min(220, pc.inner_radius ?? 64));
              const pcWarp = Math.max(0, Math.min(1, pc.warp ?? 0));
              const pcEdgeNoise = Math.max(0, Math.min(2, pc.edge_noise ?? 0));
              const pcFillNoise = Math.max(0, Math.min(100, pc.fill_noise ?? 45.3)) / 100;

              let pcSt = polarCheckerStateRef.current[layer.id];
              if (!pcSt) pcSt = polarCheckerStateRef.current[layer.id] = { lastSpin: 0, spinStart: -99, lastInvert: 0, invertStart: -99, parity: 0 };
              const pcSpinN = Number(pc.spin_rings ?? 0), pcInvN = Number(pc.invert ?? 0);
              if (pcSpinN > pcSt.lastSpin) { pcSt.lastSpin = pcSpinN; pcSt.spinStart = nowSec; }
              if (pcInvN > pcSt.lastInvert) { pcSt.lastInvert = pcInvN; pcSt.invertStart = nowSec; pcSt.parity = 1 - pcSt.parity; }
              const pcSpinT = nowSec - pcSt.spinStart;
              const pcSpinDecay = (pcSpinT >= 0 && pcSpinT < 2.2) ? (1 - pcSpinT / 2.2) : 0;
              const pcInvT = nowSec - pcSt.invertStart;
              const pcInvWipe = pcInvT >= 0 && pcInvT < 1.0 ? pcInvT / 1.0 : (pcInvT >= 1.0 ? 999 : -1);

              ctx.fillStyle = pcBg; ctx.fillRect(0, 0, targetW, targetH);
              const pcCx = targetW / 2, pcCy = targetH / 2;
              const pcMaxR = Math.min(targetW, targetH) * 0.47;
              const pcSc = pcMaxR / 320;
              const pcInnerR = pcInner * pcSc;
              const pcHash = (a: number) => { const x = Math.sin(a * 12.9898) * 43758.5453; return x - Math.floor(x); };

              for (let ri = 0; ri < pcRings; ri++) {
                  const r0raw = pcInnerR + (pcMaxR - pcInnerR) * (ri / pcRings);
                  const r1raw = pcInnerR + (pcMaxR - pcInnerR) * ((ri + 1) / pcRings);
                  const ringSpin = nowSec * 0.05 * (1 + ri * 0.15) + pcSpinDecay * Math.sin(ri * 1.3) * 6 * (ri + 1) / pcRings;
                  for (let si = 0; si < pcSectors; si++) {
                      const a0 = (si / pcSectors) * Math.PI * 2 + ringSpin;
                      const a1 = ((si + 1) / pcSectors) * Math.PI * 2 + ringSpin;
                      const warpJ = pcWarp * Math.sin(si * 0.7 + ri * 1.1 + nowSec) * (r1raw - r0raw) * 0.35;
                      const r0 = r0raw + warpJ, r1 = r1raw + warpJ;
                      const parity = (si + ri + pcSt.parity) % 2 === 0;
                      const hv = pcHash(si * 3.1 + ri * 7.7 + 1);
                      let filled = parity;
                      if (pcFillNoise > 0.01) filled = hv < (0.5 + (parity ? 0.3 : -0.3)) * (0.4 + pcFillNoise);
                      if (pcInvWipe >= 0 && pcInvWipe < 999) {
                          const cellFrac = (r0 - pcInnerR) / (pcMaxR - pcInnerR);
                          if (cellFrac < pcInvWipe) filled = !filled;
                      }
                      const en = pcEdgeNoise ? (pcHash(si * 5.3 + ri * 2.1) - 0.5) * pcEdgeNoise * 4 : 0;
                      ctx.beginPath();
                      ctx.arc(pcCx, pcCy, Math.max(1, r0 + en), a0, a1);
                      ctx.arc(pcCx, pcCy, Math.max(1, r1 + en), a1, a0, true);
                      ctx.closePath();
                      if (filled) { ctx.fillStyle = pcFill; ctx.fill(); }
                      ctx.strokeStyle = pcGrid; ctx.lineWidth = 1; ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
                  }
              }
              element = canvas;
          } else if (def.uuid === 'truchet-arcs-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const taBg = resolvedGenerativeColors['background'] || '#000000';
              const taLines = resolvedGenerativeColors['lines'] || '#ffffff';
              const taAccent = resolvedGenerativeColors['accent'] || '#eb556b';

              const ta = modifiedSettings;
              const taArcCount = Math.max(2, Math.min(12, Math.round(ta.arc_count ?? 6)));
              const taCols = Math.max(4, Math.min(20, Math.round(ta.columns ?? 10)));
              const taRows = taCols;
              const taSeed0 = Math.floor(ta.seed ?? 6051);
              const taArcRatio = Math.max(0.1, Math.min(0.5, ta.arc_ratio ?? 0.2955));

              let taSt = truchetArcsStateRef.current[layer.id];
              if (!taSt) taSt = truchetArcsStateRef.current[layer.id] = { lastReflow: 0, reflowStart: -99, seed: taSeed0, prevSeed: taSeed0, lastPop: 0, popStart: -99, popSalt: 0 };
              const taReflowN = Number(ta.reflow ?? 0), taPopN = Number(ta.pop ?? 0);
              if (taReflowN > taSt.lastReflow) { taSt.lastReflow = taReflowN; taSt.prevSeed = taSt.seed; taSt.seed = taSeed0 + Math.floor(taReflowN) * 811 + 3; taSt.reflowStart = nowSec; }
              if (taPopN > taSt.lastPop) { taSt.lastPop = taPopN; taSt.popStart = nowSec; taSt.popSalt += 1; }
              const taReflowT = nowSec - taSt.reflowStart;
              const taReflowP = taReflowT >= 0 && taReflowT < 1.2 ? taReflowT / 1.2 : 1;
              const taPopT = nowSec - taSt.popStart;
              const taPopEnv = taPopT >= 0 && taPopT < 0.9 ? Math.sin(Math.PI * (taPopT / 0.9)) : 0;
              const taHash = (c: number, r: number, s: number) => { const x = Math.sin(c * 127.1 + r * 311.7 + s * 0.017) * 43758.5453; return x - Math.floor(x); };

              ctx.fillStyle = taBg; ctx.fillRect(0, 0, targetW, targetH);
              const taTw = targetW / taCols, taTh = targetH / taRows;
              const taTile = Math.min(taTw, taTh);
              ctx.lineCap = 'round';

              const taDrawTile = (c: number, r: number, scale: number, col: string) => {
                  const oNew = taHash(c, r, taSt.seed) > 0.5 ? 1 : 0;
                  const oOld = taHash(c, r, taSt.prevSeed) > 0.5 ? 1 : 0;
                  const dist = (c + r) / (taCols + taRows);
                  const o = taReflowP >= 1 ? oNew : (dist < taReflowP ? oNew : oOld);
                  const cx = c * taTw + taTw / 2, cy = r * taTh + taTh / 2;
                  ctx.save();
                  ctx.translate(cx, cy);
                  ctx.scale(scale, scale);
                  ctx.translate(-taTile / 2, -taTile / 2);
                  ctx.strokeStyle = col;
                  const corners = o === 0 ? [[0, 0], [1, 1]] : [[1, 0], [0, 1]];
                  for (const cc of corners) {
                      const cxU = cc[0], cyU = cc[1];
                      const ccx = cxU * taTile, ccy = cyU * taTile;
                      const quarter = cxU === cyU ? (cxU === 0 ? 0 : 2) : (cxU === 1 ? 1 : 3);
                      const sa = quarter * Math.PI / 2, ea = sa + Math.PI / 2;
                      for (let k = 1; k <= taArcCount; k++) {
                          const rr = (k / (taArcCount + 0.001)) * taTile * 0.5;
                          ctx.lineWidth = Math.max(0.5, taTile * 0.5 / taArcCount * taArcRatio * 2) / scale;
                          ctx.beginPath();
                          ctx.arc(ccx, ccy, rr, sa, ea);
                          ctx.stroke();
                      }
                  }
                  ctx.restore();
              };

              const taPopped: [number, number][] = [];
              for (let r = 0; r < taRows; r++) {
                  for (let c = 0; c < taCols; c++) {
                      if (taPopEnv > 0 && taHash(c, r, taSt.popSalt + 7000) < 0.28) { taPopped.push([c, r]); continue; }
                      taDrawTile(c, r, 1, taLines);
                  }
              }
              // popped tiles scale up toward the viewer, drawn on top with a drop shadow
              for (const [c, r] of taPopped) {
                  const sc = 1 + taPopEnv * 1.1;
                  ctx.shadowColor = 'rgba(0,0,0,0.55)';
                  ctx.shadowBlur = 18 * taPopEnv;
                  ctx.shadowOffsetX = 6 * taPopEnv; ctx.shadowOffsetY = 8 * taPopEnv;
                  taDrawTile(c, r, sc, taAccent);
                  ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
              }
              element = canvas;
          } else if (def.uuid === 'voxel-cross-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const vcBg = resolvedGenerativeColors['background'] || '#000000';
              const vcTop = resolvedGenerativeColors['top'] || '#e5e5e5';
              const vcLeft = resolvedGenerativeColors['left'] || '#888888';
              const vcRight = resolvedGenerativeColors['right'] || '#333333';

              const vc = modifiedSettings;
              const vcRes = Math.max(2, Math.min(6, Math.round(vc.resolution ?? 3)));
              const vcGap = Math.max(0, Math.min(5, vc.gap ?? 2.1));
              const vcSpin = Math.max(0, Math.min(2, vc.spin ?? 0.35));
              const vcFill = Math.max(0.2, Math.min(1, vc.fill ?? 0.75));
              const vcSeed = Math.floor(vc.seed ?? 20);
              const vcHash = (a: number) => { const x = Math.sin(a * 12.9898 + vcSeed * 0.7) * 43758.5453; return x - Math.floor(x); };

              let vcSt = voxelCrossStateRef.current[layer.id];
              if (!vcSt) vcSt = voxelCrossStateRef.current[layer.id] = { lastDis: 0, disStart: -99, lastRot: 0, rotStart: -99, yawFrom: 0, yawTo: 0 };
              const vcDisN = Number(vc.dissolve ?? 0), vcRotN = Number(vc.rotate_step ?? 0);
              if (vcDisN > vcSt.lastDis) { vcSt.lastDis = vcDisN; vcSt.disStart = nowSec; }
              if (vcRotN > vcSt.lastRot) { vcSt.lastRot = vcRotN; vcSt.rotStart = nowSec; vcSt.yawFrom = vcSt.yawTo; vcSt.yawTo = vcSt.yawTo + Math.PI / 2; }
              const vcDisT = nowSec - vcSt.disStart;
              const vcDisEnv = vcDisT >= 0 && vcDisT < 1.8 ? Math.sin(Math.PI * (vcDisT / 1.8)) : 0;
              const vcRotT = nowSec - vcSt.rotStart;
              const vcRotP = vcRotT >= 0 && vcRotT < 0.7 ? vcRotT / 0.7 : 1;
              const vcRotEase = vcRotP < 1 ? (vcRotP < 0.5 ? 2 * vcRotP * vcRotP : 1 - Math.pow(-2 * vcRotP + 2, 2) / 2) : 1;
              const vcYaw = (vcSt.yawFrom + (vcSt.yawTo - vcSt.yawFrom) * vcRotEase) + nowSec * vcSpin * 0.5;

              // A solid 3D plus: three rectangular bars (thickness `vcThick` -> (2*thick+1) wide)
              // of length `vcRes` crossing at the origin. Only surface voxels are drawn.
              const vcThick = vcRes >= 5 ? 2 : 1;
              const vcArm = vcRes;
              const vcOcc = new Set<string>();
              const vcInside = (i: number, j: number, k: number) => {
                  const ai = Math.abs(i), aj = Math.abs(j), ak = Math.abs(k);
                  return (ai <= vcArm && aj <= vcThick && ak <= vcThick)
                      || (aj <= vcArm && ai <= vcThick && ak <= vcThick)
                      || (ak <= vcArm && ai <= vcThick && aj <= vcThick);
              };
              for (let i = -vcArm; i <= vcArm; i++) for (let j = -vcArm; j <= vcArm; j++) for (let k = -vcArm; k <= vcArm; k++) {
                  if (vcInside(i, j, k)) vcOcc.add(i + ',' + j + ',' + k);
              }
              const voxels: { i: number; j: number; k: number }[] = [];
              for (const key of vcOcc) {
                  const [i, j, k] = key.split(',').map(Number);
                  const surface = !vcOcc.has((i + 1) + ',' + j + ',' + k) || !vcOcc.has((i - 1) + ',' + j + ',' + k)
                      || !vcOcc.has(i + ',' + (j + 1) + ',' + k) || !vcOcc.has(i + ',' + (j - 1) + ',' + k)
                      || !vcOcc.has(i + ',' + j + ',' + (k + 1)) || !vcOcc.has(i + ',' + j + ',' + (k - 1));
                  if (!surface) continue;
                  // `fill` thins out the arm cubes (never the central block) for a chunkier look
                  if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) > vcThick && vcHash(i * 31 + j * 71 + k * 131 + 500) > vcFill) continue;
                  voxels.push({ i, j, k });
              }
              ctx.fillStyle = vcBg; ctx.fillRect(0, 0, targetW, targetH);
              const vcS = Math.min(targetW, targetH) / ((vcArm + vcThick) * 2.4 + 4);
              const vcStep = 1 + vcGap * 0.12;
              const vcCx = targetW / 2, vcCy = targetH / 2;
              const vcCosY = Math.cos(vcYaw), vcSinY = Math.sin(vcYaw);
              const vcProj = (i: number, j: number, k: number) => {
                  const x = i * vcStep, z = j * vcStep;
                  const rx = x * vcCosY - z * vcSinY, rz = x * vcSinY + z * vcCosY;
                  return { sx: vcCx + (rx - rz) * vcS, sy: vcCy + (rx + rz) * vcS * 0.5 - k * vcStep * vcS, depth: rx + rz + k };
              };
              voxels.sort((a, b) => vcProj(a.i, a.j, a.k).depth - vcProj(b.i, b.j, b.k).depth);
              const vcSCube = vcS * 0.66;
              for (const v of voxels) {
                  const dist = Math.hypot(v.i, v.j, v.k) || 1;
                  const push = vcDisEnv * (1.4 + dist * 0.6);
                  const p = vcProj(v.i + v.i / dist * push, v.j + v.j / dist * push, v.k + v.k / dist * push);
                  const S = vcSCube;
                  ctx.fillStyle = vcTop;
                  ctx.beginPath();
                  ctx.moveTo(p.sx, p.sy - S); ctx.lineTo(p.sx + S, p.sy - S * 0.5); ctx.lineTo(p.sx, p.sy); ctx.lineTo(p.sx - S, p.sy - S * 0.5);
                  ctx.closePath(); ctx.fill();
                  ctx.fillStyle = vcLeft;
                  ctx.beginPath();
                  ctx.moveTo(p.sx - S, p.sy - S * 0.5); ctx.lineTo(p.sx, p.sy); ctx.lineTo(p.sx, p.sy + S); ctx.lineTo(p.sx - S, p.sy + S * 0.5);
                  ctx.closePath(); ctx.fill();
                  ctx.fillStyle = vcRight;
                  ctx.beginPath();
                  ctx.moveTo(p.sx + S, p.sy - S * 0.5); ctx.lineTo(p.sx, p.sy); ctx.lineTo(p.sx, p.sy + S); ctx.lineTo(p.sx + S, p.sy + S * 0.5);
                  ctx.closePath(); ctx.fill();
                  ctx.strokeStyle = vcBg; ctx.lineWidth = Math.max(0.5, S * 0.04); ctx.stroke();
              }
              element = canvas;
          } else if (def.uuid === 'flow-strokes-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const fsBg = resolvedGenerativeColors['background'] || '#000000';
              const fsLines = resolvedGenerativeColors['lines'] || '#ffffff';
              const fsAccent = resolvedGenerativeColors['accent'] || '#7599a4';

              const fs = modifiedSettings;
              const fsGrid = Math.max(8, Math.min(48, Math.round(fs.grid_size ?? 28)));
              const fsScale = Math.max(10, Math.min(150, fs.flow_scale ?? 79.313));
              const fsLen = Math.max(2, Math.min(30, fs.stroke_length ?? 11.54));
              const fsCurl = Math.max(0, Math.min(1, fs.curl ?? 0.3));
              const fsSeed0 = Math.floor(fs.seed ?? 7);

              let fsSt = flowStrokesStateRef.current[layer.id];
              if (!fsSt) fsSt = flowStrokesStateRef.current[layer.id] = { lastGust: 0, gustStart: -99, lastCenter: 0, centerStart: -99 };
              const fsGustN = Number(fs.gust ?? 0), fsCenterN = Number(fs.center ?? 0);
              if (fsGustN > fsSt.lastGust) { fsSt.lastGust = fsGustN; fsSt.gustStart = nowSec; }
              if (fsCenterN > fsSt.lastCenter) { fsSt.lastCenter = fsCenterN; fsSt.centerStart = nowSec; }
              const fsGustT = nowSec - fsSt.gustStart;
              const fsGustP = fsGustT >= 0 && fsGustT < 1.5 ? fsGustT / 1.5 : -1;
              const fsCenterT = nowSec - fsSt.centerStart;
              const fsCenterEnv = fsCenterT >= 0 && fsCenterT < 2.2 ? Math.sin(Math.PI * Math.min(1, fsCenterT / 2.2)) : 0;

              const fsField = (x: number, y: number) => {
                  const u = x / fsScale, v = y / fsScale;
                  return Math.sin(u + fsSeed0 * 0.3) * 1.7 + Math.cos(v * 1.3 - fsSeed0 * 0.21) * 1.3 + Math.sin((u + v) * 0.7 + nowSec * fsCurl * 0.6) * 1.1;
              };
              ctx.fillStyle = fsBg; ctx.fillRect(0, 0, targetW, targetH);
              ctx.strokeStyle = fsLines; ctx.lineCap = 'round';
              const fsGx = targetW / fsGrid, fsGy = targetH / fsGrid;
              ctx.lineWidth = Math.max(0.6, Math.min(fsGx, fsGy) * 0.12);
              const fsL = fsLen * Math.min(targetW, targetH) / 700;
              const fsCx = targetW / 2, fsCy = targetH / 2;
              for (let r = 0; r <= fsGrid; r++) {
                  for (let c = 0; c <= fsGrid; c++) {
                      const px = c * fsGx, py = r * fsGy;
                      let ang = fsField(px, py);
                      if (fsCenterEnv > 0) {
                          // rotate each stroke toward pointing at the canvas centre (shortest path)
                          const toC = Math.atan2(fsCy - py, fsCx - px);
                          let d = toC - ang;
                          d = Math.atan2(Math.sin(d), Math.cos(d));
                          ang += d * fsCenterEnv;
                      }
                      if (fsGustP >= 0) {
                          const front = fsGustP * targetW * 1.2;
                          const behind = front - px;
                          if (behind > 0 && behind < targetW * 0.5) {
                              const infl = (1 - behind / (targetW * 0.5)) * (1 - fsGustP) * 1.6;
                              ang = ang * (1 - Math.min(1, infl));
                          }
                      }
                      const dx = Math.cos(ang) * fsL, dy = Math.sin(ang) * fsL;
                      ctx.beginPath(); ctx.moveTo(px - dx / 2, py - dy / 2); ctx.lineTo(px + dx / 2, py + dy / 2); ctx.stroke();
                  }
              }
              if (fsGustP >= 0) {
                  const front = fsGustP * targetW * 1.2;
                  ctx.strokeStyle = fsAccent; ctx.globalAlpha = (1 - fsGustP) * 0.6; ctx.lineWidth = 3;
                  ctx.beginPath(); ctx.moveTo(front, 0); ctx.lineTo(front, targetH); ctx.stroke();
                  ctx.globalAlpha = 1;
              }
              element = canvas;
          } else if (def.uuid === 'halftone-drift-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const hdBg = resolvedGenerativeColors['background'] || '#000000';
              const hdCells = resolvedGenerativeColors['cells'] || '#ffffff';

              const hd = modifiedSettings;
              const hdCols = Math.max(6, Math.min(40, Math.round(hd.cols ?? 17)));
              const hdNoiseScale = Math.max(0.5, Math.min(10, hd.noise_scale ?? 4.135));
              const hdRot = Math.max(0, Math.min(2, hd.rotation_amt ?? 0));
              const hdTrans = Math.max(0, Math.min(40, hd.translate_amt ?? 18));
              const hdScaleAmt = Math.max(0, Math.min(2, hd.scale_amt ?? 0));
              const hdSeed = Math.floor(hd.seed ?? 3100);

              let hdSt = halftoneDriftStateRef.current[layer.id];
              if (!hdSt) hdSt = halftoneDriftStateRef.current[layer.id] = { lastRipple: 0, rippleStart: -99, lastSettle: 0, settleStart: -99 };
              const hdRipN = Number(hd.ripple ?? 0), hdSetN = Number(hd.settle ?? 0);
              if (hdRipN > hdSt.lastRipple) { hdSt.lastRipple = hdRipN; hdSt.rippleStart = nowSec; }
              if (hdSetN > hdSt.lastSettle) { hdSt.lastSettle = hdSetN; hdSt.settleStart = nowSec; }
              const hdRipT = nowSec - hdSt.rippleStart;
              const hdRipR = (hdRipT >= 0 && hdRipT < 1.8) ? (hdRipT / 1.8) : -1;
              const hdSetT = nowSec - hdSt.settleStart;
              const hdSetEnv = hdSetT >= 0 && hdSetT < 2.2 ? Math.sin(Math.PI * Math.min(1, hdSetT / 2.2)) : 0;

              const hdHn = (x: number, y: number) => { const a = Math.sin(x * 12.9898 + y * 78.233 + hdSeed * 0.11) * 43758.5453; return a - Math.floor(a); };
              const hdSn = (x: number, y: number) => {
                  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
                  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
                  return hdHn(xi, yi) * (1 - u) * (1 - v) + hdHn(xi + 1, yi) * u * (1 - v) + hdHn(xi, yi + 1) * (1 - u) * v + hdHn(xi + 1, yi + 1) * u * v;
              };

              ctx.fillStyle = hdBg; ctx.fillRect(0, 0, targetW, targetH);
              ctx.fillStyle = hdCells;
              const hdCell = targetW / hdCols;
              const hdRows = Math.ceil(targetH / hdCell);
              const hdCx = targetW / 2, hdCy = targetH / 2;
              const hdMaxD = Math.hypot(hdCx, hdCy);
              const hdT = nowSec * 0.3;
              for (let r = 0; r < hdRows; r++) {
                  for (let c = 0; c < hdCols; c++) {
                      const bx = c * hdCell + hdCell / 2, by = r * hdCell + hdCell / 2;
                      const n = hdSn((c + hdT) / hdCols * hdNoiseScale, (r - hdT) / hdCols * hdNoiseScale);
                      let size = hdCell * (0.15 + n * 0.8);
                      let ox = (hdSn(c * 0.3 + 9, r * 0.3) - 0.5) * hdTrans;
                      let oy = (hdSn(c * 0.3, r * 0.3 + 9) - 0.5) * hdTrans;
                      let rot = (n - 0.5) * hdRot * Math.PI;
                      let scl = 1 + (n - 0.5) * hdScaleAmt;
                      if (hdRipR >= 0) {
                          const d = Math.hypot(bx - hdCx, by - hdCy) / hdMaxD;
                          const band = Math.abs(d - hdRipR);
                          if (band < 0.12) {
                              const w = (1 - band / 0.12);
                              size *= 1 + w * 1.2;
                              const dir = Math.atan2(by - hdCy, bx - hdCx);
                              ox += Math.cos(dir) * w * hdCell * 0.6;
                              oy += Math.sin(dir) * w * hdCell * 0.6;
                          }
                      }
                      if (hdSetEnv > 0) {
                          size = size + (hdCell * 0.5 - size) * hdSetEnv;
                          ox *= 1 - hdSetEnv; oy *= 1 - hdSetEnv; rot *= 1 - hdSetEnv; scl = scl + (1 - scl) * hdSetEnv;
                      }
                      ctx.save();
                      ctx.translate(bx + ox, by + oy);
                      ctx.rotate(rot);
                      ctx.scale(scl, scl);
                      ctx.fillRect(-size / 2, -size / 2, size, size);
                      ctx.restore();
                  }
              }
              element = canvas;
          } else if (def.uuid === 'delta-maze-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const dmBg = resolvedGenerativeColors['background'] || '#000000';
              const dmGrid = resolvedGenerativeColors['grid'] || '#555555';
              const dmPath = resolvedGenerativeColors['path'] || '#ffffff';
              const dmFloodC = resolvedGenerativeColors['flood'] || '#eb556b';

              const dm = modifiedSettings;
              const dmCols = Math.max(8, Math.min(40, Math.round(dm.columns ?? 18)));
              const dmRows = dmCols;
              const dmLineW = Math.max(0.1, Math.min(1, dm.line_width ?? 0.3));
              const dmNoiseScale = Math.max(0.005, Math.min(0.1, dm.noise_scale ?? 0.036));
              const dmDensity = Math.max(0, Math.min(1, dm.density ?? 0.6));

              let dmSt = deltaMazeStateRef.current[layer.id];
              if (!dmSt) dmSt = deltaMazeStateRef.current[layer.id] = { lastCarve: 0, carveStart: -99, seed: 777, lastFlood: 0, floodStart: -99 };
              const dmCarveN = Number(dm.carve ?? 0), dmFloodN = Number(dm.flood ?? 0);
              if (dmCarveN > dmSt.lastCarve) { dmSt.lastCarve = dmCarveN; dmSt.seed = 777 + Math.floor(dmCarveN) * 331 + 1; dmSt.carveStart = nowSec; }
              if (dmFloodN > dmSt.lastFlood) { dmSt.lastFlood = dmFloodN; dmSt.floodStart = nowSec; }
              const dmCarveT = nowSec - dmSt.carveStart;
              const dmCarveP = dmCarveT >= 0 && dmCarveT < 1.6 ? dmCarveT / 1.6 : 1;
              const dmFloodT = nowSec - dmSt.floodStart;
              const dmFloodP = dmFloodT >= 0 && dmFloodT < 2.0 ? dmFloodT / 2.0 : -1;

              const dmHn = (x: number, y: number) => { const a = Math.sin(x * 127.1 + y * 311.7 + dmSt.seed * 0.07) * 43758.5453; return a - Math.floor(a); };
              const dmSn = (x: number, y: number) => {
                  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
                  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
                  return dmHn(xi, yi) * (1 - u) * (1 - v) + dmHn(xi + 1, yi) * u * (1 - v) + dmHn(xi, yi + 1) * (1 - u) * v + dmHn(xi + 1, yi + 1) * u * v;
              };

              ctx.fillStyle = dmBg; ctx.fillRect(0, 0, targetW, targetH);
              const dmTw = targetW / (dmCols / 2), dmTh = targetH / dmRows;
              const dmDrift = nowSec * 6;
              ctx.strokeStyle = dmGrid; ctx.lineWidth = dmLineW * 2;
              for (let r = 0; r < dmRows; r++) {
                  for (let c = 0; c < dmCols; c++) {
                      const up = c % 2 === 0;
                      const x = c * dmTw / 2;
                      const tri = up
                          ? [[x, (r + 1) * dmTh], [x + dmTw, (r + 1) * dmTh], [x + dmTw / 2, r * dmTh]]
                          : [[x, r * dmTh], [x + dmTw, r * dmTh], [x + dmTw / 2, (r + 1) * dmTh]];
                      ctx.beginPath();
                      tri.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
                      ctx.closePath();
                      ctx.stroke();
                      const nv = dmSn((x + dmDrift) * dmNoiseScale * 8 + 30, r * dmTh * dmNoiseScale * 8);
                      if (nv >= dmDensity * 0.85) continue;
                      const prog = r / dmRows;
                      if (dmCarveP < 1 && prog > dmCarveP) continue;
                      ctx.fillStyle = (dmFloodP >= 0 && prog < dmFloodP) ? dmFloodC : dmPath;
                      ctx.fill();
                  }
              }
              element = canvas;
          } else if (def.uuid === 'thread-nest-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const tnBg = resolvedGenerativeColors['background'] || '#000000';
              const tnLines = resolvedGenerativeColors['lines'] || '#ffffff';
              const tnAccent = resolvedGenerativeColors['accent'] || '#eb556b';

              const tn = modifiedSettings;
              const tnCount = Math.max(10, Math.min(120, Math.round(tn.loop_count ?? 54)));
              const tnMinR = Math.max(20, Math.min(200, tn.min_radius ?? 100));
              const tnWobble = Math.max(0, Math.min(0.5, tn.wobble ?? 0.185));
              const tnWeight = Math.max(0.3, Math.min(3, tn.line_weight ?? 1));
              const tnCenter = Math.max(0, Math.min(1, tn.center ?? 0.2));
              const tnRnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7 + 11 * 0.19) * 43758.5453; return x - Math.floor(x); };

              let tnSt = threadNestStateRef.current[layer.id];
              if (!tnSt) tnSt = threadNestStateRef.current[layer.id] = { lastTighten: 0, tightenStart: -99, lastUnspool: 0, unspoolStart: -99 };
              const tnTightN = Number(tn.tighten ?? 0), tnUnspN = Number(tn.unspool ?? 0);
              if (tnTightN > tnSt.lastTighten) { tnSt.lastTighten = tnTightN; tnSt.tightenStart = nowSec; }
              if (tnUnspN > tnSt.lastUnspool) { tnSt.lastUnspool = tnUnspN; tnSt.unspoolStart = nowSec; }
              const tnTightT = nowSec - tnSt.tightenStart;
              const tnTightEnv = tnTightT >= 0 && tnTightT < 1.8 ? Math.sin(Math.PI * (tnTightT / 1.8)) : 0;
              const tnUnspT = nowSec - tnSt.unspoolStart;
              const tnUnspP = tnUnspT >= 0 && tnUnspT < 1.6 ? tnUnspT / 1.6 : -1;

              ctx.fillStyle = tnBg; ctx.fillRect(0, 0, targetW, targetH);
              const tnCx = targetW / 2, tnCy = targetH / 2;
              const tnSc = Math.min(targetW, targetH) / 520;
              ctx.strokeStyle = tnLines; ctx.lineWidth = tnWeight * tnSc * 0.7; ctx.lineJoin = 'round';
              for (let i = 0; i < tnCount; i++) {
                  const baseR = (tnMinR + tnRnd(i * 1.7) * tnMinR * 1.3 * (1 - tnCenter * 0.6)) * tnSc * (1 - tnTightEnv * 0.55);
                  const jx = (tnRnd(i * 3.3) - 0.5) * tnMinR * 0.8 * tnSc * (1 - tnTightEnv) * (1 - tnCenter);
                  const jy = (tnRnd(i * 5.1) - 0.5) * tnMinR * 0.8 * tnSc * (1 - tnTightEnv) * (1 - tnCenter);
                  const ox = tnCx + jx, oy = tnCy + jy;
                  const ph = tnRnd(i * 7.9) * 10;
                  const rotW = nowSec * (0.1 + tnRnd(i * 2.1) * 0.3) * (i % 2 ? 1 : -1);
                  ctx.globalAlpha = 0.35 + 0.4 * tnRnd(i * 9.2);
                  ctx.beginPath();
                  const seg = 40;
                  for (let k = 0; k <= seg; k++) {
                      const a = (k / seg) * Math.PI * 2 + rotW;
                      const w = 1 + Math.sin(a * 3 + ph + nowSec) * tnWobble + Math.sin(a * 7 - ph) * tnWobble * 0.5;
                      const rr = baseR * w;
                      const px = ox + Math.cos(a) * rr, py = oy + Math.sin(a) * rr * 0.92;
                      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                  }
                  ctx.closePath();
                  ctx.stroke();
              }
              ctx.globalAlpha = 1;
              if (tnUnspP >= 0) {
                  ctx.strokeStyle = tnAccent; ctx.lineWidth = tnWeight * tnSc * 1.1;
                  const bigR = Math.min(targetW, targetH) * 0.46;
                  const end = tnUnspP * Math.PI * 4;
                  ctx.beginPath();
                  for (let a = 0; a <= end; a += 0.12) {
                      const rr = bigR * (0.4 + 0.6 * (a / (Math.PI * 4))) * (1 + Math.sin(a * 5 + nowSec * 4) * 0.05);
                      const px = tnCx + Math.cos(a - nowSec * 3) * rr, py = tnCy + Math.sin(a - nowSec * 3) * rr;
                      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                  }
                  ctx.stroke();
              }
              element = canvas;
          } else if (def.uuid === 'iso-bar-wave-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
              const ctx = canvas.getContext('2d')!;

              const ibBg = resolvedGenerativeColors['background'] || '#000000';
              const ibTop = resolvedGenerativeColors['top'] || '#ffffff';
              const ibSide = resolvedGenerativeColors['side'] || '#999999';

              const ib = modifiedSettings;
              const ibBarSize = Math.max(8, Math.min(60, ib.bar_size ?? 34));
              const ibAmp = Math.max(0, Math.min(600, ib.amplitude ?? 422));
              const ibCount = Math.max(20, Math.min(300, Math.round(ib.count ?? 181)));
              const ibFreq = Math.max(0.5, Math.min(12, ib.frequency ?? 5.2));
              const ibBarH = Math.max(10, Math.min(200, ib.bar_height ?? 80));

              let ibSt = isoBarWaveStateRef.current[layer.id];
              if (!ibSt) ibSt = isoBarWaveStateRef.current[layer.id] = { lastPulse: 0, pulseStart: -99, lastFlip: 0, flipStart: -99, phaseOff: 0, phaseFrom: 0 };
              const ibPulseN = Number(ib.pulse_wave ?? 0), ibFlipN = Number(ib.phase_flip ?? 0);
              if (ibPulseN > ibSt.lastPulse) { ibSt.lastPulse = ibPulseN; ibSt.pulseStart = nowSec; }
              if (ibFlipN > ibSt.lastFlip) { ibSt.lastFlip = ibFlipN; ibSt.flipStart = nowSec; ibSt.phaseFrom = ibSt.phaseOff; ibSt.phaseOff = ibSt.phaseOff + Math.PI; }
              const ibPulseT = nowSec - ibSt.pulseStart;
              const ibPulseP = ibPulseT >= 0 && ibPulseT < 1.4 ? ibPulseT / 1.4 : -1;
              const ibFlipT = nowSec - ibSt.flipStart;
              const ibFlipP = ibFlipT >= 0 && ibFlipT < 0.9 ? ibFlipT / 0.9 : 1;
              const ibPhase = ibSt.phaseFrom + (ibSt.phaseOff - ibSt.phaseFrom) * ibFlipP;

              ctx.fillStyle = ibBg; ctx.fillRect(0, 0, targetW, targetH);
              const ibScl = Math.min(targetW, targetH) / 720;
              const ibS = ibBarSize * ibScl * 0.5;
              const ibSpacing = targetW * 1.4 / ibCount;
              const ibStartX = -targetW * 0.2;
              const ibT = nowSec * 1.2;
              const IB_ROWS = 5;
              for (let row = IB_ROWS - 1; row >= 0; row--) {
                  const rowY = targetH * 0.62 - row * ibBarH * ibScl * 0.5;
                  ctx.globalAlpha = 1 - row * 0.16;
                  for (let n = 0; n < ibCount; n++) {
                      const fn = n / ibCount;
                      let amp = ibAmp * ibScl * 0.5;
                      if (ibPulseP >= 0) {
                          const bumpC = ibPulseP * ibCount;
                          amp *= 1 + Math.exp(-Math.pow((n - bumpC) / (ibCount * 0.06), 2)) * 1.6;
                      }
                      const y = rowY + Math.sin(fn * ibFreq * Math.PI * 2 + ibPhase + ibT + row * 0.5) * amp * (0.35 + 0.65 * (1 - row / IB_ROWS));
                      const x = ibStartX + n * ibSpacing;
                      const h = ibBarH * ibScl * (0.4 + 0.6 * Math.abs(Math.sin(fn * ibFreq * Math.PI + ibPhase)));
                      ctx.fillStyle = ibSide;
                      ctx.beginPath();
                      ctx.moveTo(x - ibS, y - ibS * 0.5); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x - ibS, y + h - ibS * 0.5);
                      ctx.closePath(); ctx.fill();
                      ctx.beginPath();
                      ctx.moveTo(x + ibS, y - ibS * 0.5); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + ibS, y + h - ibS * 0.5);
                      ctx.closePath(); ctx.fill();
                      ctx.fillStyle = ibTop;
                      ctx.beginPath();
                      ctx.moveTo(x, y - ibS); ctx.lineTo(x + ibS, y - ibS * 0.5); ctx.lineTo(x, y); ctx.lineTo(x - ibS, y - ibS * 0.5);
                      ctx.closePath(); ctx.fill();
                  }
              }
              ctx.globalAlpha = 1;
              element = canvas;
          } else {
              if (webglRendererRef.current.canvas.width !== targetW || webglRendererRef.current.canvas.height !== targetH) {
                  webglRendererRef.current.resize(targetW, targetH);
              }
              // Brutalist Grid "Luck" action -> slot-machine spin envelope fed to the shader
              if (def.uuid === 'brutalist-grid-1') {
                  const luckCount = Number(modifiedSettings.luck ?? 0);
                  const bl = (brutalistLuckRef.current[layer.id] ||= { last: luckCount, seed: 0, startT: -99 });
                  if (luckCount > bl.last) { bl.last = luckCount; bl.seed += 1; bl.startT = nowSec; }
                  const spinDur = 1.15;
                  const e = nowSec - bl.startT;
                  modifiedSettings.luck_spin = e < spinDur ? Math.pow(1 - e / spinDur, 1.6) : 0;
                  modifiedSettings.luck_seed = bl.seed;
              }
              webglRendererRef.current.render(def, nowSec, modifiedSettings, resolvedGenerativeColors);
              element = webglRendererRef.current.canvas;
          }
        }
      } else if (layer.type === 'video') {
         element = videoRefs.current[layer.id];
         // A new clip loaded into this layer -> drop every stale per-layer frame
         // buffer so Frame Accumulator / Boomerang / Rewind start clean.
         if (!layer.isLive && lastVideoSrcRef.current[layer.id] !== layer.src) {
           lastVideoSrcRef.current[layer.id] = layer.src;
           const freeC = (c?: HTMLCanvasElement | null) => { if (c) { c.width = 0; c.height = 0; } };
           freeC(frameAccBgRef.current[layer.id]);
           delete frameAccBgRef.current[layer.id];
           (frameAccCutoutsRef.current[layer.id] || []).forEach(freeC);
           frameAccCutoutsRef.current[layer.id] = [];
           (frameAccumulatorSnapshotsRef.current[layer.id] || []).forEach(freeC);
           frameAccumulatorSnapshotsRef.current[layer.id] = [];
           (rewindFramesBufferRef.current[layer.id] || []).forEach(freeC);
           rewindFramesBufferRef.current[layer.id] = [];
           const s = stutterStateRef.current[layer.id];
           if (s) { s.clearBuffer = true; s.medianBg = null; s.setBg = false; s.triggerStamp = false; s.wasActive = false; s.liveReady = false; }
           freeC(referenceFrameRef.current[layer.id]);
           delete referenceFrameRef.current[layer.id];
           freeC(boomerangStartFrameRef.current[layer.id]);
           delete boomerangStartFrameRef.current[layer.id];
           freeC(boomerangLastSnapRef.current[layer.id]);
           delete boomerangLastSnapRef.current[layer.id];
           delete videoInitialSeekDoneRef.current[layer.id];
           delete prevFrameRef.current[layer.id];
         }
         if (element && layer.isLive) {
           const vid = element as HTMLVideoElement;
           if (isPlaying && vid.paused && vid.srcObject) {
             vid.play().catch(() => {});
           }
         } else if (element && isPlaying) {
           const vid = element as HTMLVideoElement;
           const start = layer.videoStart || 0;
           const end = (layer.videoEnd && layer.videoEnd > start) ? layer.videoEnd : (vid.duration || (start + 10));
           const segDur = Math.max(0.1, end - start);
           
           // If 'restart' mode, calculate time from when this specific layer was last triggered.
           // If 'continuous' mode (or anything else), use the global static master clock so it never resets.
           const baseTime = layer.videoTriggerMode === 'restart' ? (videoRestartTimeRef.current[layer.id] || masterPlaybackStartTimeRef.current) : masterPlaybackStartTimeRef.current;
           const masterTimeSec = (performance.now() - baseTime) / 1000.0;

           // Frame Advance: keep video paused, start with still frame at videoStart
           if (layer.videoTriggerMode === 'advance') {
             vid.pause();
             if (!videoInitialSeekDoneRef.current[layer.id]) {
               vid.currentTime = start;
               videoInitialSeekDoneRef.current[layer.id] = true;
             }
           }
           // Rewind on Release: handle still frame, forward playback while triggered, and smooth rewind on release
           else if (layer.videoTriggerMode === 'rewind') {
              if (!videoRewindStateRef.current[layer.id]) {
                videoRewindStateRef.current[layer.id] = { triggered: false, rewinding: false, lastSeekTime: 0 };
              }
              const rState = videoRewindStateRef.current[layer.id];
              if (!videoInitialSeekDoneRef.current[layer.id]) {
                vid.pause();
                vid.currentTime = start;
                videoInitialSeekDoneRef.current[layer.id] = true;
              }
              if (!rewindFramesBufferRef.current[layer.id]) {
                rewindFramesBufferRef.current[layer.id] = [];
              }
              const rewindBuf = rewindFramesBufferRef.current[layer.id];
              
              // Check active trigger state across MIDI, Audio, and Rhythm
              let isTriggerActive = !!rState.triggered;
              if (layer.audioMapping?.enabled) {
                isTriggerActive = audioIsActive;
              } else if (layer.rhythmMapping?.enabled) {
                isTriggerActive = rhythmIsActive;
              } else if (layer.midiMode) {
                const triggerKey = `layer-${layer.id}`;
                const trigState = triggerStatesRef.current[triggerKey];
                isTriggerActive = !!trigState?.isDown || (trigState?.phase === 'attack' || trigState?.phase === 'sustain');
              }

              if (isTriggerActive) {
                // While trigger is held: play forward smoothly and record frames for reverse playback
                rState.rewinding = false;
                if (vid.paused && isPlaying) {
                  vid.play().catch(() => {});
                }
                vid.playbackRate = Math.max(0.1, layer.speed ?? 1.0);
                if (vid.currentTime < start) vid.currentTime = start;
                if (end > start && vid.currentTime >= end) vid.currentTime = start;

                // Capture current frame at native video resolution for 100% exact aspect ratio & 60fps boomerang playback
                if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.videoHeight > 0) {
                  const snap = document.createElement('canvas');
                  snap.width = vid.videoWidth;
                  snap.height = vid.videoHeight;
                  const sCtx = snap.getContext('2d');
                  if (sCtx) {
                    sCtx.drawImage(vid, 0, 0);
                    rewindBuf.push(snap);
                    if (rewindBuf.length === 1 || !boomerangStartFrameRef.current[layer.id]) {
                      boomerangStartFrameRef.current[layer.id] = snap;
                    }
                    // Retain up to 360 frames (6 full seconds of forward play at 60fps)
                    if (rewindBuf.length > 360) {
                      rewindBuf.shift();
                    }
                  }
                }
              } else {
                // Note released: smoothly play recorded frames backward (true social media boomerang effect)
                vid.pause();
                if (rewindBuf.length > 0) {
                  rState.rewinding = true;
                  const rewindSpeed = Math.max(0.5, layer.videoRewindSpeed || 1.0);
                  const popCount = Math.max(1, Math.round(rewindSpeed));
                  let currentSnap: HTMLCanvasElement | null = null;
                  for (let i = 0; i < popCount; i++) {
                    if (rewindBuf.length > 0) {
                      currentSnap = rewindBuf.pop()!;
                    }
                  }
                  if (currentSnap) {
                    element = currentSnap;
                    boomerangLastSnapRef.current[layer.id] = currentSnap;
                  }
                  if (rewindBuf.length === 0) {
                    vid.currentTime = start;
                    rState.rewinding = false;
                  }
                } else {
                  // Buffer finished or idle at rest: hold initial still frame at videoStart
                  vid.pause();
                  if (Math.abs(vid.currentTime - start) > 0.05 && !vid.seeking) {
                    vid.currentTime = start;
                  }
                  rState.rewinding = false;
                  // Use saved start frame or last popped snapshot so vid decoder latency never flashes unwanted end frames
                  if (boomerangStartFrameRef.current[layer.id]) {
                    element = boomerangStartFrameRef.current[layer.id];
                  } else if (boomerangLastSnapRef.current[layer.id]) {
                    element = boomerangLastSnapRef.current[layer.id];
                  }
                }
              }
           }
           // Standard modes (continuous, restart, frame-accumulator) - let HTML5 video play smoothly and loop within [start, end]
           else {
             if (vid.paused && isPlaying) {
               vid.play().catch(() => {});
             }
             if (vid.currentTime < start || (end > start && vid.currentTime > end)) {
               vid.currentTime = start;
             }
           }
         }
      } else if (layer.type === '3d' && threeDEngineRef.current) {
          const engine3d = threeDEngineRef.current;
          let unifiedTriggerValue3d = 0.0;
          if (layer.audioMapping?.enabled) unifiedTriggerValue3d = audioVisualOpacity;
          else if (layer.rhythmMapping?.enabled) unifiedTriggerValue3d = rhythmVisualOpacity;
          else if (layer.midiMode) unifiedTriggerValue3d = midiVisualOpacity;

          const baseSettings = { ...(layer.threeDSettings || {}) };
          const modifiedThreeD: Record<string, number> = {};
          // Camera-sequence advance / per-slot triggers ride the same trigger
          // machinery as the knobs; they carry no knob and no easing.
          const threeDLoopParams = [
            ...THREE_D_PARAMETERS,
            ...SEQ_TRIGGER_NAMES.map(n => ({ name: n, min: 0, max: 1, default: 0, type: 'number' as const })),
          ];
          for (const p of threeDLoopParams) {
              const baseVal = Number(baseSettings[p.name] !== undefined ? baseSettings[p.name] : p.default);
              const pMap = layer.threeDMappings?.find(m => m.id === p.name);

              let activeMagnitude = 0.0;
              const isTriggerActive = !!layer.threeDTriggerActive?.[p.name];

              if (isTriggerActive) {
                  if (pMap?.audioMapping?.enabled) {
                      const trackerId = '3d-' + layer.id + '-' + pMap.id + '-audio';
                      if (!audioTrackersRef.current[trackerId]) {
                        audioTrackersRef.current[trackerId] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
                      }
                      const tracker = audioTrackersRef.current[trackerId];
                      const dt = (now - tracker.lastUpdate) / 1000.0;
                      tracker.lastUpdate = now;

                      const mode = pMap.audioMapping.mode || 'smooth';
                      const pAudioEngine = pMap.audioMapping.engine || 'level';
                      const { intensity } = engine.getBandIntensity(pMap.audioMapping.stemId || '', pMap.audioMapping.freqRange || [20, 20000]);

                      if (pAudioEngine === 'transient') {
                          activeMagnitude = processTransientHit(
                              intensity,
                              pMap.audioMapping.sensitivity ?? 0.6,
                              pMap.audioMapping.decayMs ?? 220,
                              pMap.audioMapping.cooldownMs ?? 50,
                              tracker,
                              dt,
                              now,
                          );
                      } else if (mode === 'smooth') {
                          const attackSecs = pMap.audioMapping.attack ?? 0.05;
                          const releaseSecs = pMap.audioMapping.release ?? 0.2;
                          if (intensity >= pMap.audioMapping.threshold) tracker.state = 'attack';
                          if (tracker.state === 'attack') {
                             tracker.value += attackSecs > 0.001 ? (dt / attackSecs) : 1.0;
                             if (tracker.value >= 1.0) { tracker.value = 1.0; tracker.state = 'release'; }
                          } else {
                             tracker.state = 'release';
                             tracker.value -= releaseSecs > 0.001 ? (dt / releaseSecs) : 1.0;
                             if (tracker.value <= 0.0) { tracker.value = 0.0; tracker.state = 'idle'; }
                          }
                          activeMagnitude = Math.max(0, Math.min(1, tracker.value));
                      } else {
                          if (intensity >= pMap.audioMapping.threshold && (now - tracker.lastTriggerTime > 100)) {
                             tracker.value = 1.0;
                             tracker.lastTriggerTime = now;
                          }
                          const decay = pMap.audioMapping.smoothing ?? 0.5;
                          tracker.value *= decay;
                          activeMagnitude = tracker.value;
                      }
                  } else if (pMap?.rhythmMapping?.enabled) {
                      activeMagnitude = computeRhythmMagnitude(pMap.rhythmMapping, now);
                  } else {
                      const paramKey = `3d-${layer.id}-${p.name}`;
                      const state = triggerStatesRef.current[paramKey];
                      if (state) {
                         const ns = pMap?.noteSettings || DEFAULT_NOTE_SETTINGS;
                         if (ns.useFixedDuration || state.useFixedDuration) {
                             if (state.activeUntil && Date.now() < state.activeUntil) {
                                 state.currentEnvValue = 1.0;
                                 state.phase = 'sustain';
                             } else {
                                 state.currentEnvValue = 0.0;
                                 state.phase = 'idle';
                                 state.isDown = false;
                                 state.activeUntil = null;
                             }
                         } else {
                             const dt = deltaTime / 1000.0;
                             const sustain = ns.sustain !== undefined ? ns.sustain : 1.0;
                             if (state.phase === 'attack') {
                                const a = (ns.attack || 0) / 1000.0;
                                if (a <= 0.001) state.currentEnvValue = 1;
                                else state.currentEnvValue += dt / a;
                                if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'decay'; }
                             } else if (state.phase === 'decay') {
                                const d = (ns.decay || 0) / 1000.0;
                                if (d <= 0.001) state.currentEnvValue = sustain;
                                else state.currentEnvValue -= dt * (1 - sustain) / d;
                                if (state.currentEnvValue <= sustain) { state.currentEnvValue = sustain; state.phase = 'sustain'; }
                             } else if (state.phase === 'sustain') {
                                state.currentEnvValue = sustain;
                             } else if (state.phase === 'release') {
                                const r = (ns.release || 0) / 1000.0;
                                if (r <= 0.001) state.currentEnvValue = 0;
                                else state.currentEnvValue -= dt / r;
                                if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
                             }
                         }
                         activeMagnitude = state.currentEnvValue * (state.velocity / 127);
                      } else {
                         activeMagnitude = unifiedTriggerValue3d;
                      }
                  }
              }

              // Sequence triggers just need the raw envelope magnitude; the
              // rising-edge check happens after the loop.
              if (p.name.startsWith('seq_')) { modifiedThreeD[p.name] = activeMagnitude; continue; }

              const range = (p.max ?? 1) - (p.min ?? 0);
              // Rotation params loop through the full circle when triggered past an
              // end (350 + 30 -> 20) instead of clamping. pitch stays clamped (gimbal).
              const isAngular = p.name === 'yaw' || p.name === 'roll' || p.name === 'rot_x' || p.name === 'rot_y' || p.name === 'rot_z';
              const isNavParam = p.name === 'pitch' || p.name === 'zoom' || isAngular;

              let targetVal = baseVal;
              if (isTriggerActive) {
                  const amount = layer.threeDTriggerAmount?.[p.name] ?? 0;
                  const raw = baseVal + amount * range * activeMagnitude;
                  if (isAngular) {
                      const span = range || 360;
                      targetVal = (((raw - (p.min ?? 0)) % span) + span) % span + (p.min ?? 0);
                  } else {
                      targetVal = Math.max(p.min ?? 0, Math.min(p.max ?? 1, raw));
                  }
              }

              const easeKey = '3d-' + layer.id + '-' + p.name;
              let finalVal: number;
              if (isNavParam || !isTriggerActive) {
                // No easing: orbit/rotation triggers + plain knob edits land at once.
                // An untriggered param settling in one frame is also what lets the
                // engine's render cache go cold instead of re-rendering for ~40 frames.
                finalVal = targetVal;
              } else {
                const currentEased = parameterEasingRef.current[easeKey] !== undefined ? parameterEasingRef.current[easeKey] : baseVal;
                finalVal = (currentEased as number) + (targetVal - (currentEased as number)) * 0.15;
                if (Math.abs(targetVal - finalVal) < (range || 1) * 0.0015) finalVal = targetVal; // snap so easing terminates
              }
              parameterEasingRef.current[easeKey] = finalVal;
              modifiedThreeD[p.name] = finalVal;

              const knobId = `layer-${layer.id}-param-${p.name}`;
              const lineEl = document.getElementById(`knob-line-${knobId}`);
              const circleEl = document.getElementById(`knob-circle-${knobId}`);
              if (lineEl && circleEl) {
                  const range = (p.max ?? 1) - (p.min ?? 0);
                  const pct = ((finalVal - (p.min ?? 0)) / range) * 100;
                  const rot = (pct / 100) * 270 - 135;
                  (circleEl as any).style.strokeDashoffset = (251.2 - (pct / 100) * 188.4).toString();
                  lineEl.setAttribute("transform", `rotate(${rot} 50 50)`);
              }
          }

          // Camera Sequence: on a rising edge of a bound trigger, jump to a slot.
          const seqMode = (baseSettings.seqMode as string) || 'off';
          if (seqMode === 'advance' || seqMode === 'perSlot') {
            const seqSlots: any[] = Array.isArray(baseSettings.seqSlots) ? (baseSettings.seqSlots as any[]) : [];
            const filled = seqSlots.map((s, i) => (s ? i : -1)).filter(i => i >= 0);
            const durMs = Number(baseSettings.seqTransitionMs ?? 600);
            const easing = (baseSettings.seqEasing as any) || 'inout';
            const rising = (key: string) => {
              const mag = modifiedThreeD[key] ?? 0;
              const eKey = layer.id + '-' + key;
              const isHigh = mag > 0.5;
              const was = seqEdgeRef.current[eKey] || false;
              seqEdgeRef.current[eKey] = isHigh;
              return isHigh && !was;
            };
            if (seqMode === 'advance' && filled.length > 0 && rising('seq_advance')) {
              const cur = seqCurRef.current[layer.id] ?? -1;
              const pos = filled.indexOf(cur);
              const nextSlot = filled[(pos + 1) % filled.length];
              seqCurRef.current[layer.id] = nextSlot;
              engine3d.goToSeqSnapshot(layer.id, seqSlots[nextSlot], durMs, easing);
            } else if (seqMode === 'perSlot') {
              for (let i = 0; i < 5; i++) {
                if (seqSlots[i] && rising('seq_slot_' + i)) {
                  seqCurRef.current[layer.id] = i;
                  engine3d.goToSeqSnapshot(layer.id, seqSlots[i], durMs, easing);
                  break;
                }
              }
            }
          }

          if (layer.threeDKind && layer.threeDKind !== 'kinect' && layer.threeDSrc) {
            engine3d.ensureLayer(layer.id, layer.threeDKind, layer.threeDSrc, layer.threeDFormat).catch(() => {});
          } else if (layer.threeDKind === 'kinect') {
            engine3d.ensureLayer(layer.id, 'kinect', 'kinect').catch(() => {});
          }

          if (!engine3d.isLoading(layer.id) && !engine3d.getLoadError(layer.id)) {
            engine3d.resize(targetW, targetH);
            const clipMode = (baseSettings.clipMode as ClipMode) || 'off';
            const rendered = engine3d.renderLayer(layer.id, {
              pitch: modifiedThreeD.pitch, yaw: modifiedThreeD.yaw, roll: modifiedThreeD.roll,
              zoom: modifiedThreeD.zoom, fov: modifiedThreeD.fov, bg: modifiedThreeD.bg,
              pos_x: modifiedThreeD.pos_x, pos_y: modifiedThreeD.pos_y, pos_z: modifiedThreeD.pos_z,
              rot_x: modifiedThreeD.rot_x, rot_y: modifiedThreeD.rot_y, rot_z: modifiedThreeD.rot_z,
              glitch: modifiedThreeD.glitch, reconstruction: modifiedThreeD.reconstruction, point_cloud: modifiedThreeD.point_cloud,
              clip_radius: modifiedThreeD.clip_radius, clip_w: modifiedThreeD.clip_w,
              clip_h: modifiedThreeD.clip_h, clip_d: modifiedThreeD.clip_d,
              clipMode,
              cinema_speed: modifiedThreeD.cinema_speed,
              cinema_preset: (baseSettings.cinemaPreset as string) || 'off',
              exposure: modifiedThreeD.exposure,
              env_int: modifiedThreeD.env_int,
              env: (baseSettings.env as string) || 'studio',
              bg_mode: (baseSettings.bgMode as string) || 'transparent',
              bg_color: (baseSettings.bgColor as string) || '#ffffff',
            });
            if (rendered) element = rendered;
          }
      } else {
          let img = imageRefs.current[layer.id];
          if (!img && layer.src) {
            img = new Image();
            img.src = layer.src;
            imageRefs.current[layer.id] = img;
          }
          if (img && (img.complete || img.naturalWidth > 0 || img.width > 0)) {
            element = img;
          }
      }

      if (element) {
        let slotX = 0, slotY = 0, slotW = targetW, slotH = targetH;
        let isGrid = false;
        if (compositionLayout !== 'stack') {
          isGrid = true;
          const index = layers.findIndex(l => l.id === layer.id);
          let cols = 1, rows = 1;
          if (compositionLayout === 'split-vertical') { cols = 2; rows = 1; }
          else if (compositionLayout === 'split-horizontal') { cols = 1; rows = 2; }
          else if (compositionLayout === 'grid-2x2') { cols = 2; rows = 2; }
          else if (compositionLayout === 'grid-3x3') { cols = 3; rows = 3; }
          else if (compositionLayout === 'grid-4x4') { cols = 4; rows = 4; }
          
          const c = index % cols;
          const r = Math.floor(index / cols) % rows;
          slotW = targetW / cols;
          slotH = targetH / rows;
          slotX = c * slotW;
          slotY = r * slotH;
        }

        ctx.clearRect(0, 0, targetW, targetH);
        
        const elW = (element as HTMLVideoElement).videoWidth || (element as HTMLImageElement).naturalWidth || (element as HTMLCanvasElement).width || targetW;
        const elH = (element as HTMLVideoElement).videoHeight || (element as HTMLImageElement).naturalHeight || (element as HTMLCanvasElement).height || targetH;
        
        let destW, destH, x, y;

        if (isGrid || layer.type === 'generative') {
          const scale = Math.max(slotW / elW, slotH / elH);
          destW = elW * scale;
          destH = elH * scale;
          x = slotX + (slotW - destW) / 2;
          y = slotY + (slotH - destH) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(slotX, slotY, slotW, slotH);
          ctx.clip();
        } else {
          const scale = Math.min(targetW / elW, targetH / elH);
          destW = elW * scale;
          destH = elH * scale;
          x = (targetW - destW) / 2;
          y = (targetH - destH) / 2;
        }
        
        let unifiedEnv = 0.0;
        if (layer.audioMapping?.enabled) unifiedEnv = audioVisualOpacity;
        else if (layer.rhythmMapping?.enabled) unifiedEnv = rhythmVisualOpacity;
        else unifiedEnv = midiVisualOpacity;

        const getTransformVal = (paramName: string, baseDefault: number) => {
            const base = (layer as any)[paramName] ?? baseDefault;
            if (layer.transformTriggerActive?.[paramName]) {
                const amt = layer.transformTriggerAmount?.[paramName] ?? 0;
                let paramEnv = unifiedEnv;
                const paramKey = `transform-${layer.id}-${paramName}`;
                const state = triggerStatesRef.current[paramKey];
                if (state) {
                   const dt = deltaTime / 1000.0;
                   if (state.phase === 'attack') {
                      state.currentEnvValue += dt / 0.05;
                      if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'sustain'; }
                   } else if (state.phase === 'release') {
                      state.currentEnvValue -= dt / 0.2;
                      if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
                   }
                   paramEnv = state.currentEnvValue * (state.velocity / 127);
                }
                const modVal = base + amt * 100 * paramEnv;
                // Live-drive the transform knob dial so the trigger is visible.
                const _kId = `layer-${layer.id}-param-${paramName}`;
                const _ln = document.getElementById(`knob-line-${_kId}`);
                const _ci = document.getElementById(`knob-circle-${_kId}`);
                if (_ln && _ci) {
                   const _min = paramName === 'posX' || paramName === 'posY' ? -100 : 0;
                   const _max = paramName === 'size' ? 200 : paramName === 'rotation' ? 360 : paramName === 'speed' ? 2 : 100;
                   const _pct = ((modVal - _min) / ((_max - _min) || 1)) * 100;
                   (_ci as any).style.strokeDashoffset = String(251.2 - (_pct / 100) * 188.4);
                   _ln.setAttribute('transform', `rotate(${(_pct / 100) * 270 - 135} 50 50)`);
                }
                return modVal;
            }
            return base;
        };

        const tSize = getTransformVal('size', 100);
        const tRot = getTransformVal('rotation', 0);
        const tPosX = getTransformVal('posX', 0);
        const tPosY = getTransformVal('posY', 0);
        
        if (layer.type === 'video') {
          const el = element as HTMLVideoElement;
          const finalSpeed = Math.max(0, getTransformVal('speed', 1));
          if (Math.abs(el.playbackRate - finalSpeed) > 0.05) {
             el.playbackRate = finalSpeed === 0 ? 1 : finalSpeed; // Avoid DOM exceptions on 0 playbackRate if unsupported
          }
          if (layer.videoTriggerMode !== 'advance' && layer.videoTriggerMode !== 'rewind') {
            if (el.paused && isPlaying && finalSpeed > 0) {
               el.play().catch(() => {});
            } else if (!el.paused && finalSpeed === 0) {
               el.pause();
            }
          }
        }

        const centerX = x + destW / 2 + (tPosX / 100) * targetW;
        const centerY = y + destH / 2 + (tPosY / 100) * targetH;
        const scaleFactor = Math.max(0.001, tSize / 100);
        const rotRad = (tRot * Math.PI) / 180;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotRad);
        ctx.scale(scaleFactor, scaleFactor);
        ctx.drawImage(element, -destW / 2, -destH / 2, destW, destH);
        ctx.restore();

        if (isGrid || layer.type === 'generative') ctx.restore();

        // Process effects for this layer
        const activeMappings = layer.mappings.filter(m => {
           if (m.isMuted) return false;
           if (m.manualActive) return true;
           const state = triggerStatesRef.current[`effect-${layer.id}-${m.id}`];
           if (state) {
               // Update ADSR state for effect trigger
               const ns = m.noteSettings || DEFAULT_NOTE_SETTINGS;

               if (ns.useFixedDuration || state.useFixedDuration) {
                   if (state.activeUntil && Date.now() < state.activeUntil) {
                       state.currentEnvValue = 1.0;
                       state.phase = 'sustain';
                   } else {
                       state.currentEnvValue = 0.0;
                       state.phase = 'idle';
                       state.isDown = false;
                       state.activeUntil = null;
                   }
               } else {
                   const dt = deltaTime / 1000.0;
                   const sustain = ns.sustain !== undefined ? ns.sustain : 1.0;
                   
                   if (state.phase === 'attack') {
                      const a = (ns.attack || 0) / 1000.0;
                      if (a <= 0.001) state.currentEnvValue = 1;
                      else state.currentEnvValue += dt / a;
                      if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'decay'; }
                   } else if (state.phase === 'decay') {
                      const d = (ns.decay || 0) / 1000.0;
                      if (d <= 0.001) state.currentEnvValue = sustain;
                      else state.currentEnvValue -= dt * (1 - sustain) / d;
                      if (state.currentEnvValue <= sustain) { state.currentEnvValue = sustain; state.phase = 'sustain'; }
                   } else if (state.phase === 'sustain') {
                      state.currentEnvValue = sustain;
                   } else if (state.phase === 'release') {
                      const r = (ns.release || 0) / 1000.0;
                      if (r <= 0.001) state.currentEnvValue = 0;
                      else state.currentEnvValue -= dt / r;
                      if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
                   }
               }

               return state.currentEnvValue > 0.001;
           }
           return m.active;
        });
        const soloedMappings = activeMappings.filter(m => m.isSoloed);
        const mappingsToProcess = soloedMappings.length > 0 ? soloedMappings : activeMappings;

        const rawEffects = ['hue-rotate', 'vhs', 'motion-detector', 'windows-98', 'long-exposure'];
        const needsRawCanvas = layer.videoTriggerMode === 'frame-accumulator' || mappingsToProcess.some(m => rawEffects.includes(m.id));

        if (needsRawCanvas) {
          rawCtx.clearRect(0, 0, targetW, targetH);
          if (isGrid) {
            rawCtx.save();
            rawCtx.beginPath();
            rawCtx.rect(slotX, slotY, slotW, slotH);
            rawCtx.clip();
          }
          rawCtx.drawImage(element, x, y, destW, destH);
          if (isGrid) rawCtx.restore();
        }

        // --- Frame Accumulator Mode ---
        if (layer.videoTriggerMode === 'frame-accumulator') {
          if (!frameAccumulatorSnapshotsRef.current[layer.id]) {
            frameAccumulatorSnapshotsRef.current[layer.id] = [];
          }
          const snapshots = frameAccumulatorSnapshotsRef.current[layer.id];
          const stState = stutterStateRef.current[layer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false, lastCaptureTime: 0 };
          stutterStateRef.current[layer.id] = stState;
          const isolate = !!layer.accumulateIsolateMotion;
          const cutouts = frameAccCutoutsRef.current[layer.id] || (frameAccCutoutsRef.current[layer.id] = []);

          // Clear Canvas if requested
          if (stState.clearBuffer) {
            snapshots.length = 0;
            cutouts.length = 0;
            stState.clearBuffer = false;
          }

          // 1. Detect rising edge of trigger for Audio / Rhythm / MIDI
          let isTriggerDown = false;
          if (layer.audioMapping?.enabled) {
            isTriggerDown = audioIsActive;
          } else if (layer.rhythmMapping?.enabled) {
            isTriggerDown = rhythmIsActive;
          } else if (layer.midiMode) {
            const triggerKey = `layer-${layer.id}`;
            const trigState = triggerStatesRef.current[triggerKey];
            isTriggerDown = !!trigState?.isDown || (trigState?.phase === 'attack');
          }
          if (isTriggerDown && !stState.wasActive) stState.triggerStamp = true;
          stState.wasActive = isTriggerDown;

          const maxSnapshots = Math.max(2, Math.min(32, layer.accumulateMaxFrames || 16));

          if (isolate && element) {
            // ---- Isolate Motion (multiplicity / chronophotography) ----
            // Shared scratch (drawn + read within this layer's pass, then reused).
            const cur = faScratch('fa-frame', targetW, targetH);
            const curCtx = cur.getContext('2d')!;
            curCtx.clearRect(0, 0, targetW, targetH);
            curCtx.drawImage(element, x, y, destW, destH);
            const freeCanvas = (c?: HTMLCanvasElement | null) => { if (c) { c.width = 0; c.height = 0; } };

            let plate = frameAccBgRef.current[layer.id];

            // Background plate: median collection in progress
            if (stState.medianBg) {
              const mw = Math.min(targetW, FA_DIFF_W);
              const mh = Math.max(1, Math.round((mw * targetH) / targetW));
              const s = faScratch('fa-med', mw, mh);
              const sx = s.getContext('2d')!;
              sx.clearRect(0, 0, mw, mh); sx.drawImage(cur, 0, 0, mw, mh);
              stState.medianBg.frames.push(sx.getImageData(0, 0, mw, mh));
              if (stState.medianBg.frames.length >= stState.medianBg.need) {
                const med = faMedian(stState.medianBg.frames);
                const pc = document.createElement('canvas'); pc.width = mw; pc.height = mh;
                pc.getContext('2d')!.putImageData(med, 0, 0);
                freeCanvas(plate);
                frameAccBgRef.current[layer.id] = pc;
                plate = pc;
                stState.medianBg.frames.length = 0;
                stState.medianBg = null;
              }
            }

            // Background plate: explicit snapshot request, or first-run auto
            if (stState.setBg || !plate) {
              const pc = document.createElement('canvas'); pc.width = targetW; pc.height = targetH;
              pc.getContext('2d')!.drawImage(cur, 0, 0);
              freeCanvas(plate);
              frameAccBgRef.current[layer.id] = pc;
              plate = pc;
              stState.setBg = false;
            }

            // Adaptive plate: slowly soak the current frame into the plate so it
            // tracks lighting / small camera drift. Very low alpha so the moving
            // subject only leaves a faint trail the threshold ignores.
            if (layer.accumulateBgAdaptive && plate && !stState.medianBg) {
              const pctx = plate.getContext('2d')!;
              pctx.save();
              pctx.globalAlpha = 0.035;
              pctx.drawImage(cur, 0, 0, plate.width, plate.height);
              pctx.restore();
            }

            const stampOpts = {
              threshold: Math.max(2, Math.round(layer.accumulateThreshold ?? 22)),
              feather: Math.max(0, Math.round(layer.accumulateFeather ?? 3)),
              suppressShadows: !!layer.accumulateSuppressShadows,
            };

            if (stState.triggerStamp) {
              stState.triggerStamp = false;
              if (plate) {
                const cutout = faBuildCutout(cur, plate, stampOpts);
                if (cutout) {
                  cutouts.push(cutout);
                  while (cutouts.length > maxSnapshots) freeCanvas(cutouts.shift());
                }
              }
            }

            // Render: one clean background + every frozen subject cutout
            ctx.clearRect(0, 0, targetW, targetH);
            if (plate) ctx.drawImage(plate, 0, 0, targetW, targetH);
            else ctx.drawImage(cur, 0, 0);
            const stampAlpha = layer.accumulateOpacity ?? 1;
            for (let k = 0; k < cutouts.length; k++) {
              ctx.save();
              ctx.globalAlpha = stampAlpha;
              ctx.drawImage(cutouts[k], 0, 0, targetW, targetH);
              ctx.restore();
            }
            // Optionally show the live subject on top. Recomputed at ~12fps into a
            // reused canvas (a full diff every frame was the main memory churn).
            if (layer.accumulateShowLive && plate) {
              stState.liveTick = ((stState.liveTick || 0) + 1) % 5;
              const liveScratch = faScratch('fa-live', 8, 8);
              if (stState.liveTick === 0 || !stState.liveReady) {
                const built = faBuildCutout(cur, plate, stampOpts, liveScratch);
                stState.liveReady = !!built;
              }
              if (stState.liveReady) ctx.drawImage(liveScratch, 0, 0, targetW, targetH);
            }
          } else {
            // ---- Overlay accumulation (original behaviour) ----
            if (stState.triggerStamp) {
              stState.triggerStamp = false;
              const snapCanvas = document.createElement('canvas');
              snapCanvas.width = targetW;
              snapCanvas.height = targetH;
              snapCanvas.getContext('2d')!.drawImage(element, x, y, destW, destH);
              snapshots.push(snapCanvas);
              while (snapshots.length > maxSnapshots) { const d = snapshots.shift(); if (d) { d.width = 0; d.height = 0; } }
            }
            ctx.clearRect(0, 0, targetW, targetH);
            ctx.drawImage(element, x, y, destW, destH);
            if (snapshots.length > 0) {
              const snapOpacity = layer.accumulateOpacity ?? 0.6;
              const blendMode = layer.accumulateBlendMode || 'source-over';
              for (let k = 0; k < snapshots.length; k++) {
                ctx.save();
                ctx.globalAlpha = snapOpacity;
                ctx.globalCompositeOperation = blendMode;
                ctx.drawImage(snapshots[k], 0, 0);
                ctx.restore();
              }
            }
          }

          // Sync rawCtx
          rawCtx.clearRect(0, 0, targetW, targetH);
          rawCtx.drawImage(canvas, 0, 0);
        }

        // Extract prevFrame matching this layer using current struct
        const _prevFrame = prevFrameRef.current[layer.id] || null;
        const localPrevFrameRef = { current: _prevFrame };

        // Only perform GPU pixel readback if an active effect requires pixel array inspection
        const pixelDataEffects = [
           'motion-symbols', 'invert', 'edges', 'pixelate', 'rgb-shift',
           'dithering', 'ascii', 'motion-detector', 'matrix', 'windows-98', 'glitch-box', 'glitch-slice'
        ];
        const needsPixelData = mappingsToProcess.some(m => pixelDataEffects.includes(m.id));
        const motionSensitiveEffects = ['motion-symbols', 'motion-detector', 'windows-98', 'glitch-box', 'glitch-slice'];
        const needsPrevFrame = mappingsToProcess.some(m => motionSensitiveEffects.includes(m.id) || (m.id === 'pixelate' && (m.settings?.movement ?? 0) > 0));

        let imageData: ImageData | null = null;
        let data: Uint8ClampedArray | null = null;
        const resScaleFactor = targetW / 1920;

        const getEffectBuffer = (len: number, w: number, h: number) => {
          let b = (window as any).__sharedEffectBuffer;
          if (!b || b.data.length !== len || b.imgData.width !== w || b.imgData.height !== h) {
            const bufData = new Uint8ClampedArray(len);
            const imgData = new ImageData(bufData, w, h);
            b = (window as any).__sharedEffectBuffer = { data: bufData, imgData, u32: new Uint32Array(bufData.buffer) };
          }
          return b;
        };

        const getLumaBuffer = (numPixels: number) => {
          let b = (window as any).__lumaBuffer;
          if (!b || b.length !== numPixels) {
            b = (window as any).__lumaBuffer = new Uint8Array(numPixels);
          }
          return b;
        };
        
        if (needsPixelData) {
           imageData = ctx.getImageData(0, 0, targetW, targetH);
           data = imageData.data;
           if (needsPrevFrame) {
              localPrevFrameRef.current = prevFrameRef.current[layer.id] || null;
           }
        }

        if (mappingsToProcess.length > 0) {
          const effect = mappingsToProcess[0];
          const effectDef = ALL_EFFECTS.find(e => e.id === effect.id);
          let modSettings = { ...effect.settings };
          
          let unifiedEnv = 0.0;
          if (layer.audioMapping?.enabled) unifiedEnv = audioVisualOpacity;
          else if (layer.rhythmMapping?.enabled) unifiedEnv = rhythmVisualOpacity;
          else unifiedEnv = midiVisualOpacity;

          // Per-effect trigger source: Audio (Level/Hits) or Rhythm override the layer env.
          const effAny = effect as any;
          let effectTriggerEnv: number | null = null;
          if (effAny.rhythmMapping?.enabled) {
             effectTriggerEnv = computeRhythmMagnitude(effAny.rhythmMapping, now);
          } else if (effAny.audioMapping?.enabled) {
             const trackerId = `${layer.id}-fx-${effect.id}-audio`;
             if (!audioTrackersRef.current[trackerId]) audioTrackersRef.current[trackerId] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
             const tr = audioTrackersRef.current[trackerId];
             const dtA = (now - tr.lastUpdate) / 1000.0; tr.lastUpdate = now;
             const am = effAny.audioMapping;
             const { intensity } = engine.getBandIntensity(am.stemId || '', am.freqRange || [20, 20000]);
             if ((am.engine || 'level') === 'transient') {
                effectTriggerEnv = processTransientHit(intensity, am.sensitivity ?? 0.6, am.decayMs ?? 220, am.cooldownMs ?? 50, tr, dtA, now);
             } else {
                if (intensity >= (am.threshold ?? 0.5) && (now - tr.lastTriggerTime > 100)) { tr.value = 1.0; tr.lastTriggerTime = now; }
                tr.value *= (am.smoothing ?? 0.5);
                effectTriggerEnv = tr.value;
             }
          }

          if (effectDef?.parameters) {
             for (const p of effectDef.parameters) {
                const baseVal = modSettings[p.name] !== undefined ? modSettings[p.name] : (modSettings[p.id] !== undefined ? modSettings[p.id] : p.default);
                if (effect.triggerActive?.[p.name] || effect.triggerActive?.[p.id]) {
                   const triggerAmt = effect.triggerAmount?.[p.name] ?? effect.triggerAmount?.[p.id] ?? 0;
                   const range = (p.max - p.min);
                   let paramEnv = effectTriggerEnv !== null ? effectTriggerEnv : unifiedEnv;

                   const paramKey = `effect-${layer.id}-${effect.id}-${p.name}`;
                   const state = (effectTriggerEnv === null) ? (triggerStatesRef.current[paramKey] || triggerStatesRef.current[`effect-${layer.id}-${effect.id}`]) : null;
                   if (state) {
                      const ns = effect.noteSettings || DEFAULT_NOTE_SETTINGS;
                      const dt = deltaTime / 1000.0;
                      const sustain = ns.sustain !== undefined ? ns.sustain : 1.0;
                      
                      if (state.phase === 'attack') {
                         const a = (ns.attack || 0) / 1000.0;
                         if (a <= 0.001) state.currentEnvValue = 1;
                         else state.currentEnvValue += dt / a;
                         if (state.currentEnvValue >= 1) { state.currentEnvValue = 1; state.phase = 'decay'; }
                      } else if (state.phase === 'decay') {
                         const d = (ns.decay || 0) / 1000.0;
                         if (d <= 0.001) state.currentEnvValue = sustain;
                         else state.currentEnvValue -= dt * (1 - sustain) / d;
                         if (state.currentEnvValue <= sustain) { state.currentEnvValue = sustain; state.phase = 'sustain'; }
                      } else if (state.phase === 'sustain') {
                         state.currentEnvValue = sustain;
                      } else if (state.phase === 'release') {
                         const r = (ns.release || 0) / 1000.0;
                         if (r <= 0.001) state.currentEnvValue = 0;
                         else state.currentEnvValue -= dt / r;
                         if (state.currentEnvValue <= 0) { state.currentEnvValue = 0; state.phase = 'idle'; }
                      }
                      paramEnv = state.currentEnvValue * (state.velocity / 127);
                   }
                   
                   let calculatedVal = baseVal + triggerAmt * range * paramEnv;
                   const clamped = Math.max(p.min, Math.min(p.max, calculatedVal));
                   modSettings[p.name] = clamped;
                   modSettings[p.id] = clamped;

                   // Live-drive the knob dial so the trigger's effect is visible on the control.
                   const _kId = `layer-${layer.id}-param-${p.name}`;
                   const _ln = document.getElementById(`knob-line-${_kId}`);
                   const _ci = document.getElementById(`knob-circle-${_kId}`);
                   if (_ln && _ci && range) {
                      const _pct = ((clamped - p.min) / range) * 100;
                      (_ci as any).style.strokeDashoffset = String(251.2 - (_pct / 100) * 188.4);
                      _ln.setAttribute('transform', `rotate(${(_pct / 100) * 270 - 135} 50 50)`);
                   }
                }
             }
          }
          const settings = modSettings;

      // --- 1. Symbols ---
      if (effect.id === 'motion-symbols') {
        const rawSize = settings.size !== undefined ? settings.size : (settings.Size ?? 16);
        const rawSpacing = settings.spacing !== undefined ? settings.spacing : (settings.Spacing ?? 4);
        const size = Math.max(8, Math.round(rawSize * resScaleFactor));
        const spacing = Math.max(2, Math.round(rawSpacing * resScaleFactor));
        const threshold = settings.sensitivity !== undefined ? settings.sensitivity : (settings.Sensitivity ?? 30);
        const step = size + spacing;
        
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        
        const stateMap = ((window as any).__symbolStates = (window as any).__symbolStates || {});
        if (!stateMap[layer.id]) stateMap[layer.id] = {};
        const cells = stateMap[layer.id];

        if (localPrevFrameRef.current && data) {
          const prevData = localPrevFrameRef.current;
          ctx.font = `bold ${size}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000000';
          
          for (let y = 0; y < targetH; y += step) {
            const rowOffset = y * targetW;
            for (let x = 0; x < targetW; x += step) {
              const i = (rowOffset + x) << 2;
              const b1 = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
              const b2 = (prevData[i] * 77 + prevData[i+1] * 150 + prevData[i+2] * 29) >> 8;
              
              const key = `${Math.floor(x/step)},${Math.floor(y/step)}`;
              if (Math.abs(b1 - b2) > threshold) {
                cells[key] = { char: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)], time: 30 };
              }
              
              if (cells[key]) {
                ctx.fillText(cells[key].char, x, y);
                cells[key].time--;
                if (cells[key].time <= 0) delete cells[key];
              }
            }
          }
        }
        ctx.restore();
      }

      // --- 2. Invert Colors ---
      if (effect.id === 'invert' && imageData && data) {
        const threshold = settings.threshold !== undefined ? settings.threshold : (settings.Threshold ?? 0);
        const channel = Math.floor(settings.colors !== undefined ? settings.colors : (settings.Channel ?? 0));
        const saturation = (settings.saturation !== undefined ? settings.saturation : (settings.Saturation ?? 100)) / 100;

        if (threshold === 0 && channel === 0 && saturation === 1) {
          // Ultra-fast 32-bit bitwise inversion (<0.5ms on 1080p)
          const u32 = new Uint32Array(imageData.data.buffer);
          const len = u32.length;
          for (let i = 0; i < len; i++) {
            u32[i] ^= 0x00FFFFFF;
          }
          ctx.putImageData(imageData, 0, 0);
        } else {
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const brightness = (r * 77 + g * 150 + b * 29) >> 8;
            
            if (brightness >= threshold) {
              let ir = 255 - r, ig = 255 - g, ib = 255 - b;
              
              if (saturation < 1) {
                const invGray = (ir * 77 + ig * 150 + ib * 29) >> 8;
                ir = invGray + (ir - invGray) * saturation;
                ig = invGray + (ig - invGray) * saturation;
                ib = invGray + (ib - invGray) * saturation;
              }

              if (channel === 0) {
                data[i] = ir;
                data[i+1] = ig;
                data[i+2] = ib;
              } else if (channel === 1) {
                data[i] = ir;
              } else if (channel === 2) {
                data[i+1] = ig;
              } else if (channel === 3) {
                data[i+2] = ib;
              }
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }

      // --- 3. Edge Detection ---
      if (effect.id === 'edges' && data) {
        const rawThickness = settings.thickness !== undefined ? settings.thickness : (settings.Thickness ?? 1);
        const thickness = Math.max(1, Math.round(rawThickness * resScaleFactor));
        const sensitivity = settings.sensitivity !== undefined ? settings.sensitivity : (settings.Sensitivity ?? 20);
        
        const buf = getEffectBuffer(data.length, targetW, targetH);
        const edgeU32 = buf.u32;
        const numPixels = targetW * targetH;
        const luma = getLumaBuffer(numPixels);
        
        // Pass 1: Pre-calculate 1-byte luminance
        for (let i = 0, p = 0; p < numPixels; i += 4, p++) {
          luma[p] = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
        }
        
        // Pass 2: Fast gradient difference using 1-byte array lookups (<2.5ms)
        for (let y = 0; y < targetH; y++) {
          const rowStart = y * targetW;
          const downRowStart = Math.min(targetH - 1, y + thickness) * targetW;
          const maxXMid = targetW - thickness;
          
          for (let x = 0; x < maxXMid; x++) {
            const p = rowStart + x;
            const diff = Math.abs(luma[p] - luma[p + thickness]) + Math.abs(luma[p] - luma[downRowStart + x]);
            edgeU32[p] = diff > sensitivity ? 0xFFFFFFFF : 0xFF000000;
          }
          for (let x = Math.max(0, maxXMid); x < targetW; x++) {
            const p = rowStart + x;
            const diff = Math.abs(luma[p] - luma[rowStart + targetW - 1]) + Math.abs(luma[p] - luma[downRowStart + x]);
            edgeU32[p] = diff > sensitivity ? 0xFFFFFFFF : 0xFF000000;
          }
        }
        ctx.putImageData(buf.imgData, 0, 0);
      }

      // --- 4. Pixelate ---
      if (effect.id === 'pixelate' && data) {
        const rawCellSize = settings.cellSize !== undefined ? settings.cellSize : (settings.CellSize ?? 20);
        const cellSize = Math.max(2, Math.round(rawCellSize * resScaleFactor));
        const movement = (settings.movement !== undefined ? settings.movement : (settings.Movement ?? 0)) / 100;
        const sensitivity = settings.sensitivity !== undefined ? settings.sensitivity : (settings.Sensitivity ?? 30);
        
        const stateMap = ((window as any).__pixelateStates = (window as any).__pixelateStates || {});
        if (!stateMap[layer.id]) stateMap[layer.id] = {};
        const cells = stateMap[layer.id];

        if (localPrevFrameRef.current && movement > 0) {
          const prevData = localPrevFrameRef.current;
          for (let y = 0; y < targetH; y += cellSize) {
            const h = Math.min(cellSize, targetH - y);
            for (let x = 0; x < targetW; x += cellSize) {
              const w = Math.min(cellSize, targetW - x);
              const i = (y * targetW + x) << 2;
              const b1 = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
              const b2 = (prevData[i] * 77 + prevData[i+1] * 150 + prevData[i+2] * 29) >> 8;
              
              const key = `${Math.floor(x/cellSize)},${Math.floor(y/cellSize)}`;
              if (Math.abs(b1 - b2) > (sensitivity * movement)) {
                cells[key] = { r: data[i], g: data[i+1], b: data[i+2], time: 20 };
              }
              
              if (cells[key]) {
                const c = cells[key];
                ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
                ctx.fillRect(x, y, w, h);
                c.time--;
                if (c.time <= 0) delete cells[key];
              }
            }
          }
        } else {
          for (let y = 0; y < targetH; y += cellSize) {
            const h = Math.min(cellSize, targetH - y);
            for (let x = 0; x < targetW; x += cellSize) {
              const w = Math.min(cellSize, targetW - x);
              const i = (y * targetW + x) << 2;
              ctx.fillStyle = `rgb(${data[i]},${data[i+1]},${data[i+2]})`;
              ctx.fillRect(x, y, w, h);
            }
          }
        }
      }

      // --- 5. RGB Shift (Glitch) ---
      if (effect.id === 'rgb-shift' && data) {
        const distance = settings.distance !== undefined ? settings.distance : (settings.Distance ?? 10);
        const saturation = (settings.saturation !== undefined ? settings.saturation : (settings.Saturation ?? 100)) / 100;
        const jitter = settings.jitter !== undefined ? settings.jitter : (settings.Jitter ?? 0);
        
        const scaledDistance = distance * resScaleFactor;
        const scaledJitter = jitter * resScaleFactor;
        const shift = scaledDistance + (Math.random() - 0.5) * scaledJitter;
        const shiftX = Math.round(shift);
        
        const buf = getEffectBuffer(data.length, targetW, targetH);
        const outU32 = buf.u32;
        
        if (shiftX === 0 && saturation === 1) {
          // No shift needed
        } else if (saturation === 1) {
          // Ultra-fast 32-bit direct word writes with zero bounds checking in the main loop
          const sX = shiftX;
          const absX = Math.abs(sX);
          const leftEnd = Math.min(targetW, absX);
          const rightStart = Math.max(leftEnd, targetW - absX);
          
          for (let y = 0; y < targetH; y++) {
            const rowOffset = (y * targetW) << 2;
            const rowStart = y * targetW;
            
            // Left edge
            for (let x = 0; x < leftEnd; x++) {
              const rx = Math.min(targetW - 1, Math.max(0, x + sX)) << 2;
              const bx = Math.min(targetW - 1, Math.max(0, x - sX)) << 2;
              const gx = x << 2;
              outU32[rowStart + x] = 0xFF000000 | (data[rowOffset + bx + 2] << 16) | (data[rowOffset + gx + 1] << 8) | data[rowOffset + rx];
            }
            // Center (bulk of the row, safely away from edges)
            for (let x = leftEnd; x < rightStart; x++) {
              const rx = (x + sX) << 2;
              const bx = (x - sX) << 2;
              const gx = x << 2;
              outU32[rowStart + x] = 0xFF000000 | (data[rowOffset + bx + 2] << 16) | (data[rowOffset + gx + 1] << 8) | data[rowOffset + rx];
            }
            // Right edge
            for (let x = rightStart; x < targetW; x++) {
              const rx = Math.min(targetW - 1, Math.max(0, x + sX)) << 2;
              const bx = Math.min(targetW - 1, Math.max(0, x - sX)) << 2;
              const gx = x << 2;
              outU32[rowStart + x] = 0xFF000000 | (data[rowOffset + bx + 2] << 16) | (data[rowOffset + gx + 1] << 8) | data[rowOffset + rx];
            }
          }
          ctx.putImageData(buf.imgData, 0, 0);
        } else {
          // Customized saturation path
          const sX = shiftX;
          const leftEnd = Math.min(targetW, Math.max(0, sX));
          const rightStart = Math.max(leftEnd, targetW - sX);
          
          for (let y = 0; y < targetH; y++) {
            const rowOffset = (y * targetW) << 2;
            const rowStart = y * targetW;
            
            for (let x = 0; x < targetW; x++) {
              // We'll keep the Math.min for the saturation path because it's less commonly used 
              // and the saturation math is the main bottleneck there anyway.
              const rx = Math.min(targetW - 1, Math.max(0, x + sX)) << 2;
              const bx = Math.min(targetW - 1, Math.max(0, x - sX)) << 2;
              const gx = x << 2;
              
              let r = data[rowOffset + rx];
              let g = data[rowOffset + gx + 1];
              let b = data[rowOffset + bx + 2];
              
              const gray = (r + g + b) * 0.333333;
              r = (gray + (r - gray) * saturation) | 0;
              g = (gray + (g - gray) * saturation) | 0;
              b = (gray + (b - gray) * saturation) | 0;
              
              outU32[rowStart + x] = 0xFF000000 | (b << 16) | (g << 8) | r;
            }
          }
          ctx.putImageData(buf.imgData, 0, 0);
        }
      }

      // --- 7. Hue Rotate ---
      if (effect.id === 'hue-rotate') {
        const speed = settings.speed || 10;
        const saturation = (settings.saturation || 100);
        const range = settings.range || 360;
        
        const hue = (now * speed / 100) % range;
        ctx.save();
        ctx.filter = `hue-rotate(${hue}deg) saturate(${saturation}%)`;
        ctx.drawImage(rawCanvas, 0, 0);
        ctx.restore();
      }

      // --- 8. VHS ---
      if (effect.id === 'vhs') {
        const noise = settings.noise || 20;
        const tracking = settings.tracking || 10;
        const bleed = settings.bleed || 30;
        
        ctx.save();
        
        // 1. Color Bleed (Red Shift)
        if (bleed > 0) {
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = bleed / 200;
          ctx.drawImage(rawCanvas, bleed / 5, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        }

        // 2. Tracking Noise & Distortion
        if (tracking > 0) {
          const jump = (Math.sin(now / 500) * tracking);
          if (Math.random() < 0.05) {
            ctx.drawImage(rawCanvas, 0, jump, targetW, targetH, 0, 0, targetW, targetH);
          }
          
          // Horizontal wavy distortion
          for (let i = 0; i < 10; i++) {
            const sy = Math.random() * targetH;
            const sh = 2 + Math.random() * 5;
            const sx = (Math.sin(now / 100 + sy) * tracking / 2);
            ctx.drawImage(rawCanvas, 0, sy, targetW, sh, sx, sy, targetW, sh);
          }
        }

        // 3. Static Noise (Properly blended)
        if (noise > 0) {
          ctx.fillStyle = 'white';
          for (let i = 0; i < noise * 50; i++) {
            const nx = Math.random() * targetW;
            const ny = Math.random() * targetH;
            const size = Math.random() * 2;
            ctx.globalAlpha = Math.random() * (noise / 100);
            ctx.fillRect(nx, ny, size, size);
          }
          ctx.globalAlpha = 1.0;
        }

        // 4. Scanlines
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        for (let y = 0; y < targetH; y += 3) {
          ctx.fillRect(0, y, targetW, 1);
        }
        
        ctx.restore();
      }

      // --- 8a. Dithering ---
      if (effect.id === 'dithering' && data) {
        const rawScale = settings.scale !== undefined ? settings.scale : (settings.Scale ?? 2);
        const scale = Math.max(1, Math.round(rawScale * scaleFactor));
        const contrast = (settings.contrast !== undefined ? settings.contrast : (settings.Contrast ?? 100)) / 100;
        const hueShift = settings.hue !== undefined ? settings.hue : (settings.Hue ?? 0);
        
        const bayer = [
          [0, 8, 2, 10],
          [12, 4, 14, 6],
          [3, 11, 1, 9],
          [15, 7, 13, 5]
        ];

        const buf = getEffectBuffer(data.length, targetW, targetH);
        const dData = buf.data;

        for (let y = 0; y < targetH; y += scale) {
          const bayerRow = bayer[Math.floor(y / scale) & 3];
          const maxDy = Math.min(scale, targetH - y);
          for (let x = 0; x < targetW; x += scale) {
            const i = (y * targetW + x) << 2;
            const r = data[i], g = data[i+1], b = data[i+2];
            const brightness = ((r * 77 + g * 150 + b * 29) >> 8) * contrast;
            const threshold = (bayerRow[Math.floor(x / scale) & 3] << 4);
            const val = brightness > threshold ? 255 : 0;
            
            const maxDx = Math.min(scale, targetW - x);
            for (let dy = 0; dy < maxDy; dy++) {
              const rowOffset = ((y + dy) * targetW + x) << 2;
              for (let dx = 0; dx < maxDx; dx++) {
                const di = rowOffset + (dx << 2);
                dData[di] = val;
                dData[di+1] = val;
                dData[di+2] = val;
                dData[di+3] = 255;
              }
            }
          }
        }
        
        ctx.save();
        if (hueShift !== 0) ctx.filter = `hue-rotate(${hueShift}deg)`;
        ctx.putImageData(buf.imgData, 0, 0);
        ctx.restore();
      }

      // --- 8c. ASCII ---
      if (effect.id === 'ascii') {
        const fontSize = Math.floor(settings.fontSize || 12);
        const density = settings.density || 5;
        const hueShift = settings.hue || 0;
        const chars = density > 7 ? '@#S%?*+;:,. ' : '#W*+:. ';
        
        // 1. Create/Update Atlas
        if (!asciiAtlasRef.current || asciiAtlasRef.current.dataset.chars !== chars || asciiAtlasRef.current.dataset.size !== fontSize.toString()) {
          const atlas = document.createElement('canvas');
          atlas.width = fontSize * chars.length;
          atlas.height = fontSize;
          const atlasCtx = atlas.getContext('2d')!;
          atlasCtx.font = `${fontSize}px monospace`;
          atlasCtx.fillStyle = '#fff';
          atlasCtx.textBaseline = 'top';
          for (let i = 0; i < chars.length; i++) {
            atlasCtx.fillText(chars[i], i * fontSize, 0);
          }
          atlas.dataset.chars = chars;
          atlas.dataset.size = fontSize.toString();
          asciiAtlasRef.current = atlas;
        }

        ctx.save();
        
        // 2. Draw black background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, targetW, targetH);

        // 3. Draw characters from atlas
        if (hueShift !== 0) ctx.filter = `hue-rotate(${hueShift}deg)`;
        
        if (data) {
          for (let y = 0; y < targetH; y += fontSize) {
            for (let x = 0; x < targetW; x += fontSize) {
              const i = (Math.floor(y) * targetW + Math.floor(x)) * 4;
              if (i >= data.length) continue;
              
              const r = data[i], g = data[i+1], b = data[i+2];
              const brightness = (r + g + b) / 3;
              
              // Skip drawing for very dark pixels to save performance
              if (brightness < 10) continue;
              
              const charIdx = Math.floor((brightness / 255) * (chars.length - 1));
              
              ctx.drawImage(
                asciiAtlasRef.current!,
                charIdx * fontSize, 0, fontSize, fontSize,
                x, y, fontSize, fontSize
              );
            }
          }
        }
        
        ctx.restore();
      }

      // --- 9. Motion Detector ---
      if (effect.id === 'motion-detector' && localPrevFrameRef.current && data) {
        const sensitivity = settings.sensitivity || 30;
        const maxObjects = settings.maxObjects || 10;
        const thickness = settings.thickness || 2;
        const prevData = localPrevFrameRef.current;
        
        const gridSize = 20;
        const cellsW = Math.ceil(targetW / gridSize);
        const cellsH = Math.ceil(targetH / gridSize);
        const activeCells: { x: number, y: number }[] = [];

        for (let cy = 0; cy < cellsH; cy++) {
          for (let cx = 0; cx < cellsW; cx++) {
            let diff = 0;
            let count = 0;
            for (let y = cy * gridSize; y < (cy + 1) * gridSize && y < targetH; y += 2) {
              for (let x = cx * gridSize; x < (cx + 1) * gridSize && x < targetW; x += 2) {
                const i = (y * targetW + x) * 4;
                const b1 = (data[i] + data[i+1] + data[i+2]) / 3;
                const b2 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
                diff += Math.abs(b1 - b2);
                count++;
              }
            }
            if (diff / count > sensitivity) {
              activeCells.push({ x: cx, y: cy });
            }
          }
        }

        // Simple clustering
        const objects: { x1: number, y1: number, x2: number, y2: number }[] = [];
        const visited = new Set<string>();
        
        for (const cell of activeCells) {
          const key = `${cell.x},${cell.y}`;
          if (visited.has(key)) continue;
          
          let x1 = cell.x, x2 = cell.x, y1 = cell.y, y2 = cell.y;
          const stack = [cell];
          visited.add(key);
          
          while (stack.length > 0) {
            const c = stack.pop()!;
            x1 = Math.min(x1, c.x); x2 = Math.max(x2, c.x);
            y1 = Math.min(y1, c.y); y2 = Math.max(y2, c.y);
            
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = c.x + dx, ny = c.y + dy;
                const nKey = `${nx},${ny}`;
                if (activeCells.some(ac => ac.x === nx && ac.y === ny) && !visited.has(nKey)) {
                  visited.add(nKey);
                  stack.push({ x: nx, y: ny });
                }
              }
            }
          }
          objects.push({ x1, y1, x2, y2 });
          if (objects.length >= maxObjects) break;
        }

        ctx.save();
        // Black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetW, targetH);
        
        const centers: { x: number, y: number }[] = [];
        
        objects.forEach(obj => {
          const rx = obj.x1 * gridSize;
          const ry = obj.y1 * gridSize;
          const rw = (obj.x2 - obj.x1 + 1) * gridSize;
          const rh = (obj.y2 - obj.y1 + 1) * gridSize;
          
          // Draw the object content from the original video / rawCanvas
          ctx.drawImage(rawCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
          
          // Draw box with white outline for visibility on black
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx, ry, rw, rh);
          
          centers.push({ x: rx + rw/2, y: ry + rh/2 });
        });

        if (thickness > 0 && centers.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = '#8b0000'; // Darker red for connections
          ctx.setLineDash([5, 5]); // Dotted lines
          ctx.lineWidth = thickness;
          ctx.moveTo(centers[0].x, centers[0].y);
          for (let i = 1; i < centers.length; i++) {
            ctx.lineTo(centers[i].x, centers[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // --- 10. Matrix ---
      if (effect.id === 'matrix') {
        const scale = settings.scale || 20;
        const density = settings.density || 50;
        const hue = settings.hue || 120; // Default green
        
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetW, targetH);
        
        ctx.font = `bold ${scale}px monospace`;
        ctx.textAlign = 'center';
        
        const symbols = ['ｱ', 'ｲ', 'ｳ', 'ｴ', 'ｵ', 'ｶ', 'ｷ', 'ｸ', 'ｹ', 'ｺ', 'ｻ', 'ｼ', 'ｽ', 'ｾ', 'ｿ', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '=', '+', '[', ']', '{', '}', ';', ':', ',', '.', '<', '>', '/', '?'];

        for (let y = 0; y < targetH; y += scale) {
          for (let x = 0; x < targetW; x += scale) {
            const i = (Math.floor(y) * targetW + Math.floor(x)) * 4;
            const r = data[i], g = data[i+1], b = data[i+2];
            const brightness = (r + g + b) / 3;
            
            if (brightness > (100 - density) * 2.55) {
              const char = symbols[Math.floor((brightness / 255) * (symbols.length - 1))];
              
              // Use red for dark-ish areas and green for bright areas like the screenshot
              if (brightness > 180) {
                ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${brightness/255})`;
              } else {
                ctx.fillStyle = `hsla(0, 100%, 30%, ${brightness/255})`;
              }
              
              ctx.fillText(char, x + scale/2, y + scale);
            }
          }
        }
        ctx.restore();
      }

      // --- 11. Windows 98 ---
      if (effect.id === 'windows-98' && localPrevFrameRef.current && data) {
        const sensitivity = settings.sensitivity || 30;
        const maxObjects = settings.maxObjects || 10;
        const thickness = settings.thickness || 2;
        const prevData = localPrevFrameRef.current;
        
        // Use clustering to find objects to track
        // Increased grid size for performance
        const gridSize = 40;
        const cellsW = Math.ceil(targetW / gridSize);
        const cellsH = Math.ceil(targetH / gridSize);
        
        // Use a 2D array for fast lookup
        const grid: boolean[][] = Array.from({ length: cellsH }, () => new Array(cellsW).fill(false));
        const activeCells: { x: number, y: number }[] = [];

        for (let cy = 0; cy < cellsH; cy++) {
          for (let cx = 0; cx < cellsW; cx++) {
            let diff = 0;
            let count = 0;
            // Skip more pixels for performance
            for (let y = cy * gridSize; y < (cy + 1) * gridSize && y < targetH; y += 8) {
              for (let x = cx * gridSize; x < (cx + 1) * gridSize && x < targetW; x += 8) {
                const i = (y * targetW + x) * 4;
                const b1 = (data[i] + data[i+1] + data[i+2]) / 3;
                const b2 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
                diff += Math.abs(b1 - b2);
                count++;
              }
            }
            if (diff / count > sensitivity) {
              grid[cy][cx] = true;
              activeCells.push({ x: cx, y: cy });
            }
          }
        }

        const currentObjects: { x1: number, y1: number, x2: number, y2: number }[] = [];
        const visited: boolean[][] = Array.from({ length: cellsH }, () => new Array(cellsW).fill(false));
        
        for (const cell of activeCells) {
          if (visited[cell.y][cell.x]) continue;
          if (currentObjects.length >= maxObjects) break;

          let x1 = cell.x, x2 = cell.x, y1 = cell.y, y2 = cell.y;
          const stack = [cell];
          visited[cell.y][cell.x] = true;
          
          while (stack.length > 0) {
            const c = stack.pop()!;
            x1 = Math.min(x1, c.x); x2 = Math.max(x2, c.x);
            y1 = Math.min(y1, c.y); y2 = Math.max(y2, c.y);
            
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = c.x + dx, ny = c.y + dy;
                if (nx >= 0 && nx < cellsW && ny >= 0 && ny < cellsH && grid[ny][nx] && !visited[ny][nx]) {
                  visited[ny][nx] = true;
                  stack.push({ x: nx, y: ny });
                }
              }
            }
          }
          currentObjects.push({ x1, y1, x2, y2 });
        }

        // Add new windows based on detected objects
        currentObjects.forEach(obj => {
          // Only add if we haven't reached maxObjects in windowsRef too
          if (windowsRef.current.length < maxObjects) {
            windowsRef.current.push({
              x: obj.x1 * gridSize,
              y: obj.y1 * gridSize,
              w: (obj.x2 - obj.x1 + 1) * gridSize,
              h: (obj.y2 - obj.y1 + 1) * gridSize,
              id: Math.random(),
              time: 30 // Fixed trail for performance or could be a param
            });
          }
        });

        // Update existing windows
        windowsRef.current = windowsRef.current.map(w => ({ ...w, time: w.time - 1 })).filter(w => w.time > 0);
        if (windowsRef.current.length > maxObjects) {
          windowsRef.current = windowsRef.current.slice(-maxObjects);
        }

        ctx.save();
        // Black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetW, targetH);

        windowsRef.current.forEach(win => {
          // Draw isolated subject using raw video buffer canvas
          ctx.drawImage((window as any).rawOffscreenCanvas, win.x, win.y, win.w, win.h, win.x, win.y, win.w, win.h);

          // Window Frame
          ctx.strokeStyle = '#c0c0c0';
          ctx.lineWidth = thickness;
          ctx.strokeRect(win.x, win.y, win.w, win.h);
          
          // Title Bar
          ctx.fillStyle = '#000080';
          ctx.fillRect(win.x, win.y, win.w, 24);
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold 12px "MS Sans Serif", sans-serif`;
          ctx.fillText('Tracking.sys', win.x + 8, win.y + 17);
          
          // Buttons
          ctx.fillStyle = '#c0c0c0';
          ctx.fillRect(win.x + win.w - 20, win.y + 4, 16, 16);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.strokeRect(win.x + win.w - 20, win.y + 4, 16, 16);
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 10px Arial';
          ctx.fillText('X', win.x + win.w - 15, win.y + 16);
        });
        ctx.restore();
      }

      // --- 12. Glitch ---
      if (effect.id === 'glitch-box' && localPrevFrameRef.current && data) {
        const sensitivity = settings.sensitivity || 30;
        const maxObjects = settings.maxObjects || 10;
        const strength = 0.7; // Fixed high intensity
        const persistence = settings.persistence || 15;
        const prevData = localPrevFrameRef.current;
        
        const gridSize = 40;
        const cellsW = Math.ceil(targetW / gridSize);
        const cellsH = Math.ceil(targetH / gridSize);
        const grid: boolean[][] = Array.from({ length: cellsH }, () => new Array(cellsW).fill(false));
        const activeCells: { x: number, y: number }[] = [];

        for (let cy = 0; cy < cellsH; cy++) {
          for (let cx = 0; cx < cellsW; cx++) {
            let diff = 0;
            let count = 0;
            for (let y = cy * gridSize; y < (cy + 1) * gridSize && y < targetH; y += 8) {
              for (let x = cx * gridSize; x < (cx + 1) * gridSize && x < targetW; x += 8) {
                const i = (y * targetW + x) * 4;
                const b1 = (data[i] + data[i+1] + data[i+2]) / 3;
                const b2 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
                diff += Math.abs(b1 - b2);
                count++;
              }
            }
            if (diff / count > sensitivity) {
              grid[cy][cx] = true;
              activeCells.push({ x: cx, y: cy });
            }
          }
        }

        const currentFrameObjects: { x1: number, y1: number, x2: number, y2: number }[] = [];
        const visited: boolean[][] = Array.from({ length: cellsH }, () => new Array(cellsW).fill(false));
        for (const cell of activeCells) {
          if (visited[cell.y][cell.x]) continue;
          if (currentFrameObjects.length >= maxObjects) break;
          let x1 = cell.x, x2 = cell.x, y1 = cell.y, y2 = cell.y;
          const stack = [cell];
          visited[cell.y][cell.x] = true;
          while (stack.length > 0) {
            const c = stack.pop()!;
            x1 = Math.min(x1, c.x); x2 = Math.max(x2, c.x);
            y1 = Math.min(y1, c.y); y2 = Math.max(y2, c.y);
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = c.x + dx, ny = c.y + dy;
                if (nx >= 0 && nx < cellsW && ny >= 0 && ny < cellsH && grid[ny][nx] && !visited[ny][nx]) {
                  visited[ny][nx] = true;
                  stack.push({ x: nx, y: ny });
                }
              }
            }
          }
          currentFrameObjects.push({ x1, y1, x2, y2 });
        }

        // Add new boxes to persistence ref
        currentFrameObjects.forEach(obj => {
          const rx = obj.x1 * gridSize;
          const ry = obj.y1 * gridSize;
          const rw = (obj.x2 - obj.x1 + 1) * gridSize;
          const rh = (obj.y2 - obj.y1 + 1) * gridSize;
          
          // Check if we already have a box nearby to "stabilize"
          const existing = glitchBoxesRef.current.find(b => 
            Math.abs(b.x - rx) < gridSize * 2 && Math.abs(b.y - ry) < gridSize * 2
          );

          if (existing) {
            // Update existing box position slightly (smoothing)
            existing.x = existing.x * 0.7 + rx * 0.3;
            existing.y = existing.y * 0.7 + ry * 0.3;
            existing.w = existing.w * 0.7 + rw * 0.3;
            existing.h = existing.h * 0.7 + rh * 0.3;
            existing.life = persistence;
          } else if (glitchBoxesRef.current.length < maxObjects) {
            glitchBoxesRef.current.push({
              x: rx, y: ry, w: rw, h: rh,
              id: Math.random(),
              life: persistence,
              value: Math.random().toFixed(4)
            });
          }
        });

        // Update life and filter
        glitchBoxesRef.current = glitchBoxesRef.current
          .map(b => ({ ...b, life: b.life - 1 }))
          .filter(b => b.life > 0);

        ctx.save();
        
        // Draw connecting lines (Technical Web)
        if (glitchBoxesRef.current.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * strength})`;
          ctx.lineWidth = 1;
          for (let i = 0; i < glitchBoxesRef.current.length; i++) {
            const b1 = glitchBoxesRef.current[i];
            for (let j = i + 1; j < glitchBoxesRef.current.length; j++) {
              const b2 = glitchBoxesRef.current[j];
              ctx.moveTo(b1.x + b1.w / 2, b1.y + b1.h / 2);
              ctx.lineTo(b2.x + b2.w / 2, b2.y + b2.h / 2);
            }
          }
          ctx.stroke();
        }

        glitchBoxesRef.current.forEach((box) => {
          const { x, y, w, h, value, life } = box;
          const opacity = Math.min(1, life / 5);

          if (!(window as any).rawOffscreenCanvas) return;

          // High-Intensity Glitch Rendering
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();

          // 1. Random Blackout Blocks
          if (Math.random() < strength * 0.2) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(x, y, w, h);
          }

          // 2. Aggressive Slicing with Chromatic Aberration
          const sliceCount = Math.floor(5 + strength * 15);
          for (let s = 0; s < sliceCount; s++) {
            const sy = y + (h / sliceCount) * s;
            const sh = h / sliceCount;
            
            const offset = (Math.random() - 0.5) * 60 * strength;
            const rgbOffset = 12 * strength * (Math.random() > 0.5 ? 1 : -1);
            
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            
            // Red Channel
            ctx.globalAlpha = 0.8 * opacity;
            ctx.drawImage((window as any).rawOffscreenCanvas, x + offset + rgbOffset, sy, w, sh, x, sy, w, sh);
            
            // Green Channel
            ctx.globalAlpha = 0.9 * opacity;
            ctx.drawImage((window as any).rawOffscreenCanvas, x + offset, sy, w, sh, x, sy, w, sh);
            
            // Blue Channel
            ctx.globalAlpha = 0.8 * opacity;
            ctx.drawImage((window as any).rawOffscreenCanvas, x + offset - rgbOffset, sy, w, sh, x, sy, w, sh);
            
            ctx.restore();
          }
          
          // 3. Digital Noise / Glass Overlays
          if (strength > 0.4) {
            for (let i = 0; i < 2; i++) {
              if (Math.random() < strength) {
                const bx = x + Math.random() * w * 0.7;
                const by = y + Math.random() * h * 0.7;
                const bw = Math.random() * w * 0.3;
                const bh = Math.random() * h * 0.1;
                ctx.fillStyle = Math.random() > 0.5 ? `rgba(255, 255, 255, ${0.2 * strength})` : `rgba(0, 0, 0, ${0.4 * strength})`;
                ctx.fillRect(bx, by, bw, bh);
              }
            }
          }

          ctx.restore();

          // White Outline
          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);

          // Technical Label
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.fillText(value, x + w / 2, y + h / 2);
          ctx.shadowBlur = 0;
        });
        ctx.restore();
      }

      // --- 14. Long Exposure ---
      if (effect.id === 'long-exposure') {
        const threshold = settings.threshold || 30;
        const fadeVal = (settings.fade || 5) / 100;
        
        // Use layer-specific accumulation canvases
        const leKey = layer.id + '-long-exposure';
        if (!referenceFrameRef.current[leKey]) {
          const refCanvas = document.createElement('canvas');
          refCanvas.width = targetW;
          refCanvas.height = targetH;
          referenceFrameRef.current[leKey] = refCanvas;
          const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!;
          refCtx.drawImage((window as any).rawOffscreenCanvas, 0, 0);
        }
        if (!accumulateCanvasRef.current[leKey]) {
          const accCanvas = document.createElement('canvas');
          accCanvas.width = targetW;
          accCanvas.height = targetH;
          accumulateCanvasRef.current[leKey] = accCanvas;
        }
        
        const leRefCanvas = referenceFrameRef.current[leKey];
        const leAccCanvas = accumulateCanvasRef.current[leKey];
        const leAccCtx = leAccCanvas.getContext('2d', { willReadFrequently: true })!;
        
        // Check for clear signal
        const leState = stutterStateRef.current[layer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false };
        stutterStateRef.current[layer.id] = leState;
        if (leState.clearBuffer) {
          leAccCtx.clearRect(0, 0, targetW, targetH);
          leState.clearBuffer = false;
        }
        
        // Continuous difference calculation every frame
        const currentData = rawCtx.getImageData(0, 0, targetW, targetH).data;
        const leRefCtx = leRefCanvas.getContext('2d', { willReadFrequently: true })!;
        const refData = leRefCtx.getImageData(0, 0, targetW, targetH).data;
        
        if (!(window as any).diffCanvas) {
           (window as any).diffCanvas = document.createElement('canvas');
           (window as any).diffCtx = (window as any).diffCanvas.getContext('2d', { willReadFrequently: true });
        }
        const diffCanvas = (window as any).diffCanvas as HTMLCanvasElement;
        const diffCtx2 = (window as any).diffCtx as CanvasRenderingContext2D;
        if (diffCanvas.width !== targetW) { diffCanvas.width = targetW; diffCanvas.height = targetH; }
        
        const diffImgData = diffCtx2.createImageData(targetW, targetH);
        const diffData = diffImgData.data;
        
        for (let i = 0; i < currentData.length; i += 4) {
           const rDiff = Math.abs(currentData[i] - refData[i]);
           const gDiff = Math.abs(currentData[i+1] - refData[i+1]);
           const bDiff = Math.abs(currentData[i+2] - refData[i+2]);
           const avgDiff = (rDiff + gDiff + bDiff) / 3;
           if (avgDiff > threshold) {
             diffData[i] = currentData[i];
             diffData[i+1] = currentData[i+1];
             diffData[i+2] = currentData[i+2];
             diffData[i+3] = 255;
           } else {
             diffData[i+3] = 0;
           }
        }
        diffCtx2.putImageData(diffImgData, 0, 0);
        leAccCtx.drawImage(diffCanvas, 0, 0);
        
        // Apply fade to trails
        if (fadeVal > 0) {
          leAccCtx.save();
          leAccCtx.globalCompositeOperation = 'destination-out';
          leAccCtx.fillStyle = `rgba(0, 0, 0, ${fadeVal})`;
          leAccCtx.fillRect(0, 0, targetW, targetH);
          leAccCtx.restore();
        }

        // Output: Reference Frame + Accumulated trails
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(leRefCanvas, 0, 0);
        ctx.drawImage(leAccCanvas, 0, 0);
      }

    } // <-- Added closing bracket for if (mappingsToProcess.length > 0)

      if (needsPrevFrame && data) {
        if (!prevFrameRef.current[layer.id] || prevFrameRef.current[layer.id].length !== data.length) {
          prevFrameRef.current[layer.id] = new Uint8ClampedArray(data.length);
        }
        prevFrameRef.current[layer.id].set(data);
      }

      let opacityMult = 1.0;
      if (layer.midiMode) {
          // Advance mode: always visible
          if (layer.videoTriggerMode === 'advance' && layer.type === 'video') {
              opacityMult = 1.0;
          }
          // Rewind mode: always visible
          else if (layer.videoTriggerMode === 'rewind' && layer.type === 'video') {
              opacityMult = 1.0;
          }
          // Frame Accumulator mode: always visible
          else if (layer.videoTriggerMode === 'frame-accumulator' && layer.type === 'video') {
              opacityMult = 1.0;
          }
          else if (layer.audioMapping?.enabled) {
              opacityMult = layer.audioMapping.target === 'opacity' ? audioVisualOpacity : (audioIsActive ? 1.0 : 0.0);
          }
          else if (layer.rhythmMapping?.enabled) opacityMult = rhythmVisualOpacity;
          else opacityMult = midiVisualOpacity;
      }

      if (!layerOutputCanvasesRef.current[layer.id]) {
        layerOutputCanvasesRef.current[layer.id] = document.createElement('canvas');
      }
      const layerCanvas = layerOutputCanvasesRef.current[layer.id];
      if (layerCanvas.width !== targetW || layerCanvas.height !== targetH) {
        layerCanvas.width = targetW;
        layerCanvas.height = targetH;
      }
      const layerCtx = layerCanvas.getContext('2d')!;
      layerCtx.clearRect(0, 0, targetW, targetH);
      layerCtx.drawImage(canvas, 0, 0);

      renderedLayersMap[layer.id] = {
        canvas: layerCanvas,
        opacityMult,
        slotX,
        slotY,
        slotW,
        slotH,
        isGrid,
        layer
      };
    } // End if (element)
    });

    // --- PASS 2: COMPOSITING & TRACK MATTE MASKING ---
    const maskSourceForTarget: Record<string, Layer> = {};
    for (const l of layers) {
      if (l.maskTargetId && l.isVisible && !l.isMuted) {
        maskSourceForTarget[l.maskTargetId] = l;
      }
    }
    const maskSourceIds = new Set(Object.values(maskSourceForTarget).map(m => m.id));

    layersToDraw.forEach(layer => {
      // If this layer is an active mask for another layer, don't draw it as a standalone background layer
      if (maskSourceIds.has(layer.id)) return;

      const info = renderedLayersMap[layer.id];
      if (!info) return;

      let finalSourceCanvas = info.canvas;
      const maskLayer = maskSourceForTarget[layer.id];
      let maskTriggerFactor = 1.0;

      if (maskLayer && renderedLayersMap[maskLayer.id]) {
        const maskInfo = renderedLayersMap[maskLayer.id];
        const maskBuffer = maskInfo.canvas;

        // If the mask layer is modulated by MIDI/Audio/Rhythm triggers, apply its trigger envelope
        if (maskLayer.midiMode || maskLayer.audioMapping?.enabled || maskLayer.rhythmMapping?.enabled) {
          maskTriggerFactor = maskInfo.opacityMult;
        }

        if (!(window as any).matteCanvas) {
          (window as any).matteCanvas = document.createElement('canvas');
          (window as any).matteCtx = (window as any).matteCanvas.getContext('2d', { willReadFrequently: true });
        }
        const matteCanvas = (window as any).matteCanvas as HTMLCanvasElement;
        const matteCtx = (window as any).matteCtx as CanvasRenderingContext2D;
        if (matteCanvas.width !== targetW || matteCanvas.height !== targetH) {
          matteCanvas.width = targetW;
          matteCanvas.height = targetH;
        }
        matteCtx.clearRect(0, 0, targetW, targetH);
        matteCtx.globalCompositeOperation = 'source-over';
        matteCtx.drawImage(finalSourceCanvas, 0, 0);

        const isLuma = maskLayer.maskMode === 'luma';
        const isInverted = Boolean(maskLayer.maskInverted);

        if (isLuma) {
          const imgDataT = matteCtx.getImageData(0, 0, targetW, targetH);
          const maskCtx = maskBuffer.getContext('2d', { willReadFrequently: true })!;
          const imgDataM = maskCtx.getImageData(0, 0, targetW, targetH);
          const dataT = imgDataT.data;
          const dataM = imgDataM.data;
          for (let p = 0; p < dataT.length; p += 4) {
            const luma = (dataM[p] * 0.299 + dataM[p+1] * 0.587 + dataM[p+2] * 0.114) / 255;
            const mAlpha = (dataM[p+3] / 255) * luma;
            const factor = isInverted ? (1.0 - mAlpha) : mAlpha;
            dataT[p+3] = Math.round(dataT[p+3] * factor);
          }
          matteCtx.putImageData(imgDataT, 0, 0);
        } else {
          // Alpha Matte
          if (isInverted) {
            matteCtx.globalCompositeOperation = 'destination-out';
            matteCtx.drawImage(maskBuffer, 0, 0);
          } else {
            matteCtx.globalCompositeOperation = 'destination-in';
            matteCtx.drawImage(maskBuffer, 0, 0);
          }
          matteCtx.globalCompositeOperation = 'source-over';
        }

        // If enabled, also composite the generative mask graphic on top of the masked content
        if (maskLayer.showMaskGraphic) {
          matteCtx.globalCompositeOperation = 'source-over';
          matteCtx.drawImage(maskBuffer, 0, 0);
        }

        finalSourceCanvas = matteCanvas;
      }

      const finalAlpha = Math.max(0, Math.min(1, layer.opacity * info.opacityMult * maskTriggerFactor));

      mainCtx.save();
      if (info.isGrid) {
        mainCtx.beginPath();
        mainCtx.rect(info.slotX, info.slotY, info.slotW, info.slotH);
        mainCtx.clip();
      }
      mainCtx.globalAlpha = finalAlpha;
      mainCtx.globalCompositeOperation = layer.blendMode;
      mainCtx.drawImage(finalSourceCanvas, 0, 0, targetW, targetH);
      mainCtx.restore();

      if (bufferCtxRef.current) {
        bufferCtxRef.current.save();
        if (info.isGrid) {
          bufferCtxRef.current.beginPath();
          bufferCtxRef.current.rect(info.slotX, info.slotY, info.slotW, info.slotH);
          bufferCtxRef.current.clip();
        }
        bufferCtxRef.current.globalAlpha = finalAlpha;
        bufferCtxRef.current.globalCompositeOperation = layer.blendMode;
        bufferCtxRef.current.drawImage(finalSourceCanvas, 0, 0, targetW, targetH);
        bufferCtxRef.current.restore();
      }
    });

    // Pop-out window mirrors the canvas via captureStream() -> <video>, so there
    // is no per-frame pixel copy here (a cross-window drawImage forces a GPU
    // readback and lags playback). Just tidy refs if the window was closed.
    if (popoutWinRef.current?.closed) {
      popoutStreamRef.current?.getTracks().forEach(t => t.stop());
      popoutStreamRef.current = null;
      popoutWinRef.current = null;
    }

    requestRef.current = requestAnimationFrame(processFrame);
  }, [layers, resolutionScale, compositionLayout, aspectRatioValue]);

  useEffect(() => {
    if (isPlaying) requestRef.current = requestAnimationFrame(processFrame);
    else cancelAnimationFrame(requestRef.current);
    return () => cancelAnimationFrame(requestRef.current);
  }, [isPlaying, processFrame]);

  // --- Asset Import & Layer Assignment Engine ---

  const importAssetFiles = (files: File[], targetLayerId?: string) => {
    if (!files || files.length === 0) return;

    const validFiles = files.filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    if (targetLayerId && layersRef.current.find(l => l.id === targetLayerId)?.isLive) {
      stopWebcam(targetLayerId);
    } else if (!targetLayerId && layersRef.current.length === 1 && layersRef.current[0].isLive) {
      stopWebcam(layersRef.current[0].id);
    }

    const preloadImg = (id: string, src: string) => {
      try {
        const img = new Image();
        img.src = src;
        imageRefs.current[id] = img;
      } catch(e) {}
    };

    const createdLayers: Layer[] = [];

    validFiles.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const newId = `layer-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;

      if (!isVideo) {
        preloadImg(targetLayerId && idx === 0 ? targetLayerId : newId, url);
      }

      if (idx === 0 && targetLayerId) {
        // Target layer will be updated directly
      } else {
        createdLayers.push({
          id: newId,
          name: file.name,
          type: isVideo ? 'video' : 'image',
          src: url,
          opacity: 1,
          blendMode: 'source-over',
          filterId: null,
          filterSettings: {},
          isVisible: true,
          isActive: false,
          midiMode: false,
          videoTriggerMode: 'continuous',
          triggerMapping: { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
          mappings: [],
          rhythmMapping: { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: Array(16).fill(false) },
          isMuted: false,
          isSoloed: false
        });
      }
    });

    setLayers(prev => {
      let nextLayers: Layer[];
      if (targetLayerId) {
        const firstFile = validFiles[0];
        const firstIsVideo = firstFile.type.startsWith('video/');
        const firstUrl = URL.createObjectURL(firstFile);
        if (!firstIsVideo) preloadImg(targetLayerId, firstUrl);

        const updated = prev.map(l => l.id === targetLayerId ? {
          ...l,
          missingMedia: false,
          src: firstUrl,
          isLive: false,
          type: firstIsVideo ? 'video' : 'image',
          name: firstFile.name,
          // keep the layer's video mode when swapping the clip (e.g. Frame Accumulator)
          videoTriggerMode: (firstIsVideo ? (l.videoTriggerMode || 'continuous') : 'continuous') as any,
          triggerMapping: l.triggerMapping || { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
          rhythmMapping: l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor' as const, bpm: 120, customPattern: Array(16).fill(false) },
          mappings: [],
          generativeSettings: {},
          generativeMappings: [],
          generativeTriggerActive: {},
          generativeTriggerAmount: {}
        } : l);

        nextLayers = [...updated, ...createdLayers];
      } else {
        // If there's only 1 default empty layer, populate it with first file and append the rest
        if (prev.length === 1 && !prev[0].src && prev[0].type !== 'generative') {
          const firstFile = validFiles[0];
          const firstIsVideo = firstFile.type.startsWith('video/');
          const firstUrl = URL.createObjectURL(firstFile);
          if (!firstIsVideo) preloadImg(prev[0].id, firstUrl);

          const firstUpdated: Layer = {
            ...prev[0],
            name: firstFile.name,
            type: firstIsVideo ? 'video' : 'image',
            src: firstUrl,
            isLive: false,
            missingMedia: false,
            triggerMapping: prev[0].triggerMapping || { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
            rhythmMapping: prev[0].rhythmMapping || { enabled: false, pattern: '4-on-the-Floor' as const, bpm: 120, customPattern: Array(16).fill(false) }
          };
          const additional = validFiles.slice(1).map((file, idx) => {
            const isVid = file.type.startsWith('video/');
            const newId = `layer-${Date.now()}-${idx+1}-${Math.random().toString(36).substring(2, 6)}`;
            const url = URL.createObjectURL(file);
            if (!isVid) preloadImg(newId, url);
            return {
              id: newId,
              name: file.name,
              type: (isVid ? 'video' : 'image') as 'video' | 'image',
              src: url,
              opacity: 1,
              blendMode: 'source-over' as GlobalCompositeOperation,
              filterId: null,
              filterSettings: {},
              isVisible: true,
              isActive: false,
              midiMode: false,
              videoTriggerMode: 'continuous' as const,
              triggerMapping: { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
              mappings: [],
              rhythmMapping: { enabled: false, pattern: '4-on-the-Floor' as const, bpm: 120, customPattern: Array(16).fill(false) },
              isMuted: false,
              isSoloed: false
            };
          });
          nextLayers = [firstUpdated, ...additional];
        } else {
          const allNew: Layer[] = validFiles.map((file, idx) => {
            const isVideo = file.type.startsWith('video/');
            const newId = `layer-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
            const url = URL.createObjectURL(file);
            if (!isVideo) preloadImg(newId, url);
            return {
              id: newId,
              name: file.name,
              type: isVideo ? 'video' : 'image',
              src: url,
              opacity: 1,
              blendMode: 'source-over',
              filterId: null,
              filterSettings: {},
              isVisible: true,
              isActive: false,
              midiMode: false,
              videoTriggerMode: 'continuous',
              triggerMapping: { ...DEFAULT_TRIGGER_MAPPING, channels: Array.from({length: 16}, (_, i) => i), noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
              mappings: [],
              rhythmMapping: { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: Array(16).fill(false) },
              isMuted: false,
              isSoloed: false
            };
          });
          nextLayers = [...prev, ...allNew];
        }
      }
      layersRef.current = nextLayers;
      return nextLayers;
    });

    if (targetLayerId) {
      setActiveLayerId(targetLayerId);
    } else if (createdLayers.length > 0) {
      setActiveLayerId(createdLayers[0].id);
    } else {
      setActiveLayerId('layer-1');
    }

    setShowAssetBrowser(false);
    setStatus('READY');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, layerId: string) => {
    if (e.target.files && e.target.files.length > 0) {
      importAssetFiles(Array.from(e.target.files), layerId);
    }
  };

  const toggleLayerMidiNote = (layerId: string, note: number | undefined) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, midiNote: note } : l));
  };

  const toggleLayerMidiCC = (layerId: string, cc: number | undefined) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, midiCC: cc } : l));
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
    setStatus(!isPlaying ? 'ENGINE ACTIVE' : 'PAUSED');
    
    // Sync Audio Engine with Global Play State
    if (!isPlaying) {
      engine.playAll();
      setAudioPlaying(true);
    } else {
      engine.stopAll();
      setAudioPlaying(false);
    }
    
    // Toggle all video layers
    layers.forEach(layer => {
      if (layer.type === 'video') {
        // Frame Advance layers stay paused — their playback is trigger-controlled
        if (layer.videoTriggerMode === 'advance') return;
        const video = videoRefs.current[layer.id];
        if (video) {
          if (!isPlaying) video.play().catch(() => {});
          else video.pause();
        }
      }
    });
    
    // Also toggle the legacy videoRef if it exists
    if (videoRef.current) {
      if (!isPlaying) videoRef.current.play().catch(() => {});
      else videoRef.current.pause();
    }
  };

  const updateMapping = (layerId: string, effectId: string, field: keyof EffectMapping, value: any) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, [field]: value } : m) } : l));
  };

  const toggleChannel = (layerId: string, effectId: string, channel: number) => {
    setLayers(prev => prev.map(l => l.id === layerId ? {
      ...l, mappings: l.mappings.map(m => {
        if (m.id === effectId) {
          const channels = m.channels.includes(channel) ? m.channels.filter(c => c !== channel) : [...m.channels, channel];
          return { ...m, channels };
        }
        return m;
      })
    } : l));
  };

  const setAllChannels = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, channels: Array.from({length: 16}, (_, i) => i) } : m) } : l));
  };

  const setNoChannels = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, channels: [] } : m) } : l));
  };

  const updateSetting = (layerId: string, effectId: string, key: string, value: number) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, settings: { ...m.settings, [key]: value } } : m) } : l));
  };

  const updateNoteSetting = (layerId: string, effectId: string, key: string, value: any) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, noteSettings: { ...m.noteSettings, [key]: value } } : m) } : l));
  };

  const toggleManual = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, manualActive: !m.manualActive } : m) } : l));
  };

  const addEffect = (layerId: string, def: EffectDefinition) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== layerId) return l;
      if (l.mappings.find(m => m.id === def.id)) {
        return l;
      }
      
      const initialSettings: Record<string, any> = {};
      def.parameters.forEach(p => {
        initialSettings[p.id] = p.default !== undefined ? p.default : (p.min + (p.max - p.min) / 2);
        if (p.type === 'binary') initialSettings[p.id] = p.default !== undefined ? p.default : p.min;
      });

      const newMapping: EffectMapping = {
        id: def.id,
        name: def.name,
        description: def.description,
        channels: Array.from({length: 16}, (_, i) => i),
        noteStart: 0,
        noteEnd: 127,
        active: true,
        manualActive: true,
        isMuted: false,
        isSoloed: false,
        settings: initialSettings,
        noteSettings: { ...DEFAULT_NOTE_SETTINGS },
        activeUntil: null,
        velocity: 0,
        triggerBehavior: 'momentary'
      };

      return { ...l, mappings: [...l.mappings, newMapping] };
    }));
    
    setSelectedEffectId(def.id);
    setSelectedLayerForEffect(layerId);
    setActiveLayerId(layerId);
    setExpandedSection('layers');
  };

  const removeAllEffects = (layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: [] } : l));
    if (selectedLayerForEffect === layerId) {
      setSelectedEffectId(null);
      setSelectedLayerForEffect(null);
    }
  };

  const removeEffect = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== layerId) return l;
      const newBindings = l.ccBindings ? { ...l.ccBindings } : undefined;
      if (newBindings) {
        for (const key of Object.keys(newBindings)) {
          if (key.startsWith(`effect-${effectId}-`)) {
            delete newBindings[key];
          }
        }
      }
      return { ...l, mappings: l.mappings.filter(m => m.id !== effectId), ccBindings: newBindings };
    }));
    if (selectedLayerForEffect === layerId && selectedEffectId === effectId) {
      setSelectedEffectId(null);
      setSelectedLayerForEffect(null);
    }
  };

  const toggleMute = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, isMuted: !m.isMuted } : m) } : l));
  };

  const toggleSolo = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.map(m => m.id === effectId ? { ...m, isSoloed: !m.isSoloed } : m) } : l));
  };

  const toggleFullScreen = () => {
    if (canvasRef.current) {
      if (!document.fullscreenElement) {
        canvasRef.current.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    }
  };

  // Open (or focus) a separate window that mirrors the render canvas. It streams
  // the canvas with captureStream() into a <video>, so mirroring costs nothing
  // per frame (no cross-window pixel copy). Useful for a second screen.
  const toggleCanvasPopout = () => {
    if (popoutWinRef.current && !popoutWinRef.current.closed) {
      popoutWinRef.current.focus();
      return;
    }
    const src = canvasRef.current as HTMLCanvasElement | null;
    if (!src) return;
    // Stop any stream left over from a previous (now-gone) pop-out so captures
    // don't stack up and grow memory unbounded.
    popoutStreamRef.current?.getTracks().forEach(t => t.stop());
    popoutStreamRef.current = null;
    const win = window.open('', 'glitchpulse_canvas', 'width=1280,height=720');
    if (!win) return;
    win.document.title = 'Glitch Pulse — Canvas';
    win.document.body.innerHTML = '';
    win.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;height:100vh';
    const vid = win.document.createElement('video');
    vid.autoplay = true;
    vid.muted = true;
    (vid as any).playsInline = true;
    vid.style.cssText = 'max-width:100vw;max-height:100vh;width:100%;height:100%;object-fit:contain;background:#000';
    win.document.body.appendChild(vid);
    try {
      const stream = (src as any).captureStream ? src.captureStream(30) : null;
      if (stream) {
        vid.srcObject = stream;
        popoutStreamRef.current = stream;
        vid.play().catch(() => {});
      }
    } catch { /* captureStream unsupported -> window still opens, just blank */ }
    popoutWinRef.current = win;
    win.addEventListener('beforeunload', () => {
      popoutStreamRef.current?.getTracks().forEach(t => t.stop());
      popoutStreamRef.current = null;
      popoutWinRef.current = null;
    });
  };

  useEffect(() => () => {
    try { popoutStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { popoutWinRef.current?.close(); } catch {}
  }, []);

  // ---- Reusable panel bodies (placed in sidebars / hamburger drawer) ----
  const audioSourcesPanel = (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <label className="flex-1 border border-white/10 p-3 rounded bg-transparent hover:border-white hover:bg-white hover:text-black transition-colors flex items-center justify-center gap-2 cursor-pointer">
          <Upload size={14} className="opacity-50" />
          <span className="text-[10px] uppercase tracking-widest font-bold">Load Stems</span>
          <input type="file" multiple accept="audio/*" onChange={handleAddAudioStem} className="hidden" />
        </label>
        <button
          onClick={async () => {
            const id = 'live-mic';
            await engine.addLiveInput(id, 'Live Mic/Line', selectedAudioDevice || undefined);
            setAudioStems(prev => [...prev.filter(s => s.id !== id), { id, name: 'Live Mic/Line', fileUrl: 'live', isMuted: false, isSoloed: false }]);
          }}
          className="px-4 border border-white/10 rounded bg-transparent hover:border-white hover:bg-white hover:text-black transition-colors flex items-center justify-center"
          title="Use Live Microphone / Audio Interface"
        >
          <Mic size={14} />
        </button>
        <button
          onClick={toggleAudioPlay}
          className={`px-4 rounded flex items-center justify-center transition-colors ${audioPlaying ? 'bg-red-600 text-white' : 'border border-white/20 hover:bg-white hover:text-black'}`}
        >
          {audioPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[8px] uppercase tracking-widest opacity-40 block">Live Input Device</label>
        <CustomSelect
          className="font-mono normal-case"
          value={selectedAudioDevice}
          onChange={setSelectedAudioDevice}
          options={[
            { value: '', label: 'Default Microphone' },
            ...audioDevices.map(d => ({ value: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0, 5)}` })),
          ]}
        />
      </div>

      <div className="space-y-1.5 pb-3 border-b border-white/5">
        <label className="text-[8px] uppercase tracking-widest opacity-40 block">YouTube / Browser Audio</label>
        <div className="flex gap-1">
          <input
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="Paste a YouTube link…"
            className="flex-1 bg-black/40 border border-white/10 rounded p-1.5 text-[9px] outline-none font-mono min-w-0"
          />
          <button
            onClick={() => { const id = extractYouTubeId(ytUrl); setYtVideoId(id); setYtStatus(id ? '' : 'Not a valid YouTube link'); }}
            className="px-2 border border-white/10 rounded text-[9px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors shrink-0"
          >Load</button>
        </div>
        {ytVideoId && (
          <>
            <iframe
              key={ytVideoId}
              className="w-full rounded border border-white/10 mt-1"
              style={{ aspectRatio: '16 / 9' }}
              src={`https://www.youtube.com/embed/${ytVideoId}`}
              allow="encrypted-media; picture-in-picture; fullscreen"
              title="YouTube source"
            />
            <button
              onClick={async () => {
                setYtStatus('Connecting… choose this tab and enable "Share tab audio".');
                const res = await engine.addTabAudio('yt-audio', 'YouTube');
                if (res.ok) {
                  setAudioStems(prev => [...prev.filter(s => s.id !== 'yt-audio'), { id: 'yt-audio', name: 'YouTube', fileUrl: 'youtube', isMuted: false, isSoloed: false }]);
                  setYtStatus('✓ Connected. Press play on the video, then it drives your triggers.');
                } else {
                  setYtStatus(res.error || 'Could not connect audio.');
                }
              }}
              className="w-full border border-white/10 rounded p-2 mt-1 text-[9px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
            >Connect this audio for reactivity</button>
            <p className="text-[8px] opacity-30 leading-tight">Audio stays muted until you press play on the video and connect it here.</p>
          </>
        )}
        {ytStatus && <p className="text-[8px] opacity-40 leading-tight">{ytStatus}</p>}
      </div>

      <div className="space-y-2">
        {audioStems.length === 0 ? (
          <div className="text-[9px] text-center opacity-40 uppercase tracking-widest py-4 border border-white/5 border-dashed rounded">No audio sources</div>
        ) : audioStems.map(stem => (
          <div key={stem.id} className="flex items-center justify-between p-2 rounded bg-transparent border border-white/5 text-[10px]">
            <span className="truncate w-20 font-mono uppercase text-[9px] opacity-80">{stem.name}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => toggleStemMute(stem.id)} className={`px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider transition-colors ${stem.isMuted ? 'bg-red-500/20 text-red-500 font-bold' : 'bg-transparent opacity-40 hover:opacity-100'}`}>M</button>
              <button onClick={() => toggleStemSolo(stem.id)} className={`px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider transition-colors ${stem.isSoloed ? 'bg-white/20 text-white font-bold' : 'bg-transparent opacity-40 hover:opacity-100'}`}>S</button>
              <button onClick={() => removeAudioStem(stem.id)} className="opacity-40 hover:opacity-100 hover:text-red-400 p-1 ml-1"><X size={10} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const layoutPanel = (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest opacity-40">Layout Mode</label>
        <div className="grid grid-cols-3 gap-1">
          {['stack', 'split-vertical', 'split-horizontal', 'grid-2x2', 'grid-3x3', 'grid-4x4'].map((format: any) => (
            <button key={format} onClick={() => setCompositionLayout(format)}
              className={`p-2 text-[9px] uppercase tracking-wider rounded border transition-all truncate ${compositionLayout === format ? 'bg-red-600 border-red-500 text-white' : 'bg-transparent border-white/5 text-white/40 hover:border-white hover:bg-white hover:text-black'}`}
              title={format.replace('-', ' ')}>
              {format.replace('split-', '').replace('grid-', '')}
            </button>
          ))}
        </div>
      </div>
      <AspectRatioControl value={aspectRatioValue} onChange={setAspectRatioValue} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-red-600 overflow-hidden flex flex-col">
      {/* Dynamic SVG Filters for Stickiness */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          {layers.filter(l => l.generativeId === 'stickiness-canvas-gen-1').map(l => {
            // Apply easing state if available, fallback to un-eased setting, then fallback to default (18)
            const stick = l.generativeSettings?.stickiness || 18;
            const th = 255 / Math.max(0.1, stick);
            const cut = -(th * 0.38);
            return (
              <filter key={l.id} id={`sticky-goo-${l.id}`} colorInterpolationFilters="sRGB" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation={stick} result="blur" />
                <feColorMatrix in="blur" mode="matrix"
                  values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${th} ${cut}`}
                  result="goo" />
                <feComposite in="SourceGraphic" in2="goo" operator="atop" />
              </filter>
            );
          })}
        </defs>
      </svg>
      {/* Background Atmosphere */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-red-900/10 blur-[120px] rounded-none" />
        <div className="absolute bottom-0 right-1/4 w-1/2 h-1/2 bg-red-900/5 blur-[120px] rounded-none" />
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden relative z-50 p-4 flex justify-between items-center border-b border-white/5 bg-black/40 ">
        <button 
          onClick={() => setShowSidebar(!showSidebar)}
          className="p-2 hover:bg-transparent rounded-none transition-colors"
        >
          {showSidebar ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h1 className="text-[10px] font-light tracking-[0.4em] uppercase opacity-80">Glitch Pulse</h1>
        <button onClick={() => setShowSettings(true)} className="p-2 text-white/60 hover:text-white" title="Settings">
          <Sliders size={18} />
        </button>
      </header>

      {/* Main Header (Desktop/Tablet) */}
      <header className="hidden lg:flex relative z-10 px-4 py-3 justify-between items-center border-b border-white/5 gap-2">
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors shrink-0"
            title="Settings — MIDI & audio devices, performance, canvas"
          >
            <Menu size={16} />
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-none ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-[9px] font-mono tracking-widest opacity-40 uppercase">{status}</span>
          </div>
          
          <div className="flex items-center gap-1.5 pl-3 border-l border-white/10" title={midiAccess ? 'MIDI Connected' : 'MIDI Offline'}>
            <Activity size={12} className={midiAccess ? 'text-emerald-500' : 'text-red-500 opacity-50'} />
            <span className="text-[9px] font-mono tracking-widest opacity-40 uppercase">MIDI IN</span>
          </div>
          
          <button
            onClick={() => setIsMidiLearnMode(!isMidiLearnMode)}
            className={`px-2.5 py-1 rounded-full border text-[8px] uppercase tracking-widest transition-all flex items-center gap-1 cursor-pointer ${
              isMidiLearnMode ? 'bg-red-600 border-red-500 text-white animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-black/40 border-white/20 text-white/70 hover:text-white hover:border-white'
            }`}
            title="Toggle Global MIDI Learn Mode"
          >
            <Radio size={11} className={isMidiLearnMode ? 'animate-spin' : ''} />
            MIDI Learn {isMidiLearnMode ? 'ACTIVE' : ''}
          </button>
        </div>
        
        <h1 className="text-xs font-light tracking-[0.5em] uppercase opacity-80 hidden xl:block absolute left-1/2 -translate-x-1/2 pointer-events-none">Glitch Pulse</h1>

        <div className="flex items-center gap-1.5 shrink-0">
          <button 
            onClick={() => {
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ layers, aspectRatioValue, compositionLayout }));
              const downloadAnchorNode = document.createElement('a');
              downloadAnchorNode.setAttribute("href", dataStr);
              downloadAnchorNode.setAttribute("download", `glitch-pulse-project-${Date.now()}.json`);
              document.body.appendChild(downloadAnchorNode);
              downloadAnchorNode.click();
              downloadAnchorNode.remove();
            }}
            className="px-3 py-1.5 rounded border transition-all text-[9px] uppercase tracking-widest bg-transparent border-white/10 hover:border border-white hover:bg-white hover:text-black hover:border-white/20 text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Download size={11} /> Save
          </button>
          <label className="px-3 py-1.5 rounded border transition-all text-[9px] uppercase tracking-widest bg-transparent border-white/10 hover:border border-white hover:bg-white hover:text-black hover:border-white/20 text-white flex items-center gap-1.5 cursor-pointer">
            <Upload size={11} /> Load
            <input 
              type="file" accept=".json" className="hidden" 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    try {
                      const obj = JSON.parse(event.target?.result as string);
                      if (obj.layers) {
                        setLayers(obj.layers.map((l: any) => ({
                           ...l,
                           src: l.src && l.src.startsWith('blob:') ? null : l.src, // blobs are invalid on reconnect
                           missingMedia: !!(l.src && l.src.startsWith('blob:'))
                        })));
                      }
                      if (obj.canvasAspectRatio) setAspectRatioValue(obj.canvasAspectRatio);
                      if (obj.aspectRatioValue) setAspectRatioValue(obj.aspectRatioValue);
                      if (obj.compositionLayout) setCompositionLayout(obj.compositionLayout);
                    } catch (err) { alert('Invalid project file'); }
                  };
                  reader.readAsText(file);
                }
                e.target.value = '';
              }} 
            />
          </label>
        <button 
          onClick={stopAll}
          className={`px-3 py-1.5 rounded border transition-all flex items-center gap-1.5 text-[9px] uppercase tracking-widest ${
            isPanic 
              ? 'bg-red-600 border-red-500 text-white scale-95' 
              : 'bg-red-600/10 border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-500'
          }`}
        >
          <Power size={11} />
          Stop All
        </button>
        </div>
      </header>

      {/* ===== Settings Drawer (hamburger) ===== */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 z-[60] bg-black/60"
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed left-0 top-0 bottom-0 z-[61] w-[92vw] max-w-[400px] bg-[#0a0a0c] border-r border-white/10 flex flex-col shadow-2xl"
            >
              <div className="p-4 flex items-center justify-between border-b border-white/10 shrink-0">
                <span className="text-[11px] uppercase tracking-[0.3em] font-bold opacity-80">Settings</span>
                <button onClick={() => setShowSettings(false)} className="p-1.5 text-white/50 hover:text-white"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">


                <Section
                  title="MIDI Devices"
                  icon={<Music size={16} />}
                  isExpanded={settingsSection === 'midi-devices'}
                  onToggle={() => setSettingsSection(settingsSection === 'midi-devices' ? null : 'midi-devices')}
                >
                  <div className="p-4 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-widest opacity-40">MIDI Device</label>
                        <button onClick={requestMidiAccess} className="p-1 hover:border-white hover:bg-white hover:text-black rounded transition-colors opacity-40 hover:opacity-100" title="Refresh MIDI Devices">
                          <RefreshCw size={10} />
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button onClick={() => setSelectedDeviceIds(midiDevices.map(d => d.id))} className="flex-1 text-[8px] uppercase tracking-widest bg-transparent py-1 rounded border border-white/10 hover:bg-white hover:text-black transition-colors">Select All</button>
                          <button onClick={() => setSelectedDeviceIds([])} className="flex-1 text-[8px] uppercase tracking-widest bg-transparent py-1 rounded border border-white/10 hover:bg-white hover:text-black transition-colors">None</button>
                        </div>
                        <div className="max-h-32 overflow-y-auto">
                          {midiDevices.map(d => (
                            <label key={d.id} className="flex items-center gap-2 text-xs opacity-80 cursor-pointer p-1 hover:bg-white/5 rounded">
                              <input type="checkbox" checked={selectedDeviceIds.includes(d.id)}
                                onChange={(e) => { if (e.target.checked) setSelectedDeviceIds(prev => [...prev, d.id]); else setSelectedDeviceIds(prev => prev.filter(id => id !== d.id)); }}
                                className="accent-red-600" />
                              {d.name}
                            </label>
                          ))}
                        </div>
                        {midiDevices.length === 0 && <div className="text-xs opacity-40 italic py-2">No Devices Found</div>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-widest opacity-40">MIDI Logs</label>
                        <button onClick={() => setShowRoutingGuide(!showRoutingGuide)} className="text-[8px] uppercase tracking-widest text-red-500 hover:underline">
                          {showRoutingGuide ? 'Close Guide' : 'Routing Help'}
                        </button>
                      </div>
                      {showRoutingGuide && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-200/80 font-mono leading-relaxed space-y-2">
                          <p className="font-bold text-red-400">Virtual MIDI Routing:</p>
                          <ol className="list-decimal list-inside space-y-1 opacity-90">
                            <li>Enable <span className="text-white">IAC Driver</span> (Mac) or <span className="text-white">loopMIDI</span> (Win).</li>
                            <li>Route your app's MIDI output to that virtual port.</li>
                            <li>Click the <span className="text-white">Refresh</span> icon above.</li>
                          </ol>
                        </div>
                      )}
                      <div className="bg-black/40 border border-white/5 rounded p-3 h-32 overflow-y-auto font-mono text-[9px] space-y-1 custom-scrollbar">
                        {midiLogs.length === 0 && <div className="opacity-20 italic">Awaiting MIDI signal…</div>}
                        {midiLogs.map(log => (
                          <div key={log.id} className="flex justify-between items-center border-b border-white/5 pb-1">
                            <span className={log.type === 'ON' ? 'text-white' : 'opacity-40'}>CH {log.channel}</span>
                            <span className={log.type === 'ON' ? 'text-red-400' : 'opacity-40'}>NOTE {log.note}</span>
                            <span className="opacity-40">{log.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Section>


                <Section
                  title="Performance"
                  icon={<Terminal size={16} />}
                  isExpanded={settingsSection === 'performance'}
                  onToggle={() => setSettingsSection(settingsSection === 'performance' ? null : 'performance')}
                >
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase tracking-widest opacity-40">Render Resolution</label>
                      <span className="text-[10px] font-mono text-red-500">{Math.round(resolutionScale * 100)}%</span>
                    </div>
                    <input type="range" min="0.2" max="1.0" step="0.1" value={resolutionScale}
                      onChange={(e) => setResolutionScale(parseFloat(e.target.value))}
                      className="w-full accent-red-600 opacity-60 hover:opacity-100 transition-opacity" />
                    <div className="flex justify-between text-[8px] uppercase opacity-30"><span>Performance</span><span>Quality</span></div>
                  </div>
                </Section>

              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 relative z-10 flex flex-col lg:flex-row overflow-hidden">
        {/* Left panel re-open tab (when collapsed) */}
        {leftCollapsed && (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="hidden lg:flex items-center justify-center w-6 shrink-0 border-r border-white/5 bg-black/20 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
            title="Show Visuals panel"
          >
            <ChevronRight size={14} />
          </button>
        )}
        {/* Left Sidebar */}
        <aside className={`
          fixed inset-x-0 bottom-0 z-40 w-full bg-black/95  border-t border-white/10
          lg:relative lg:inset-auto lg:z-0 lg:border-t-0 lg:border-r lg:bg-black/20
          ${leftCollapsed ? 'lg:hidden' : 'lg:w-72 xl:w-80'}
          flex flex-col transition-all duration-300 ease-in-out
          ${showSidebar ? 'h-[70vh] lg:h-full translate-y-0' : 'h-0 lg:h-full translate-y-full lg:translate-y-0'}
        `}>
          <div className="flex-1 overflow-y-auto custom-scrollbar pb-20 lg:pb-0">
            <div className="lg:hidden p-4 flex justify-between items-center border-b border-white/5 sticky top-0 bg-black/80  z-10">
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Settings</span>
              <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-transparent rounded-none">
                <ChevronDown size={20} />
              </button>
            </div>
            <div className="hidden lg:flex justify-end px-2 py-1.5 border-b border-white/5">
              <button onClick={() => setLeftCollapsed(true)} className="p-1 text-white/30 hover:text-white transition-colors" title="Hide panel — more canvas">
                <PanelLeftClose size={14} />
              </button>
            </div>

          <Section
            title="Visuals"
            icon={<Layers size={16} />} 
            isExpanded={expandedSection === 'layers'} 
            onToggle={() => setExpandedSection(expandedSection === 'layers' ? null : 'layers')}
          >
            <div 
              className={`p-2 space-y-2 relative transition-all rounded ${isDraggingOverVisuals ? 'bg-red-950/20 ring-1 ring-red-500/50' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isDraggingOverVisuals) setIsDraggingOverVisuals(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDraggingOverVisuals(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOverVisuals(false);
                setDragOverLayerId(null);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  importAssetFiles(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <div className="flex gap-1.5">
                <button 
                  onClick={() => {
                    const newId = `layer-${Date.now()}`;
                    setLayers(prev => [...prev, {
                      id: newId,
                      name: `Layer ${prev.length + 1}`,
                      type: 'video',
                      src: null,
                      opacity: 1,
                      blendMode: 'source-over',
                      filterId: null,
                      filterSettings: {},
                      isVisible: true,
                      isActive: false,
                      midiMode: false,
                      triggerMapping: { ...DEFAULT_TRIGGER_MAPPING },
                      mappings: [],
                      rhythmMapping: { enabled: false, pattern: '4-on-the-Floor', target: 'opacity', bpm: 120 },
                      isMuted: false,
                      isSoloed: false
                    }]);
                    setActiveLayerId(newId);
                    setSelectedEffectId(null);
                    setSelectedLayerForEffect(null);
                  }}
                  className="flex-1 p-2 rounded border border-dashed border-white/10 hover:border-white/30 hover:bg-transparent transition-all text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center justify-center gap-2"
                >
                  <Plus size={12} />
                  Add Layer
                </button>
                <label className="p-2 px-3 rounded border border-dashed border-white/10 hover:border-white/30 hover:bg-transparent transition-all text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center justify-center gap-1.5 cursor-pointer" title="Import multiple media files as layers">
                  <Upload size={12} />
                  <input 
                    type="file" 
                    multiple 
                    accept="video/*,image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        importAssetFiles(Array.from(e.target.files));
                      }
                      e.target.value = '';
                    }} 
                  />
                </label>
              </div>

              {isDraggingOverVisuals && (
                <div className="p-2.5 border border-dashed border-red-500/60 bg-red-600/10 rounded flex items-center justify-center gap-2 text-red-400 animate-pulse">
                  <Upload size={14} />
                  <span className="text-[8px] font-mono uppercase tracking-widest font-bold">Drop files here to create layers</span>
                </div>
              )}

              <Reorder.Group axis="y" values={layers} onReorder={setLayers} className="space-y-1">
                {layers.map(layer => (
                  <Reorder.Item 
                    key={layer.id}
                    value={layer}
                    onDragStart={() => { setActiveLayerId(layer.id); setSelectedEffectId(null); setSelectedLayerForEffect(null); }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragOverLayerId !== layer.id) setDragOverLayerId(layer.id);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragOverLayerId === layer.id) setDragOverLayerId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverLayerId(null);
                      setIsDraggingOverVisuals(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        importAssetFiles(Array.from(e.dataTransfer.files), layer.id);
                      }
                    }}
                    onClick={() => { setActiveLayerId(layer.id); setSelectedEffectId(null); setSelectedLayerForEffect(null); }}
                    className={`p-2 rounded-none border transition-all cursor-pointer group relative ${
                      dragOverLayerId === layer.id 
                        ? 'border-red-500 bg-red-600/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]' 
                        : activeLayerId === layer.id 
                          ? 'border-white bg-[#111]' 
                          : 'bg-transparent border-transparent hover:border-white/20'
                    }`}
                  >
                    {dragOverLayerId === layer.id && (
                      <div className="absolute inset-0 bg-red-950/85 backdrop-blur-xs border border-red-500 flex items-center justify-center gap-1.5 z-20 pointer-events-none">
                        <Upload size={12} className="text-red-400 animate-bounce" />
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-red-300">
                          Drop to assign asset
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between" onClick={() => { setActiveLayerId(layer.id); setSelectedEffectId(null); setSelectedLayerForEffect(null); }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical size={14} className="opacity-20 cursor-grab active:cursor-grabbing hover:opacity-100 transition-opacity" />
                        {layer.midiMode ? (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setLayers(prev => prev.map(l => l.id === layer.id ? { 
                                ...l, 
                                triggerMapping: { 
                                  ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), 
                                  triggerBehavior: (l.triggerMapping?.triggerBehavior || DEFAULT_TRIGGER_MAPPING.triggerBehavior) === 'toggle' ? 'momentary' : 'toggle' 
                                } 
                              } : l));
                            }}
                            className={`p-1 rounded hover:text-white transition-colors ${(layer.triggerMapping?.triggerBehavior || 'momentary') === 'toggle' ? 'text-red-500 bg-red-500/10' : 'text-white/30'}`}
                            title={`Trigger Mode: ${(layer.triggerMapping?.triggerBehavior || 'momentary') === 'toggle' ? 'Toggle (Retrigger)' : 'Momentary'}`}
                          >
                            <RefreshCw size={12} />
                          </button>
                        ) : (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, isVisible: !l.isVisible } : l));
                            }}
                            className={`p-1 rounded hover:text-white transition-colors ${layer.isVisible ? 'text-white' : 'text-white/20'}`}
                            title="Toggle Visibility"
                          >
                            {layer.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLayerId(layer.id);
                            setSelectedEffectId(null);
                            setSelectedLayerForEffect(null);
                            if (layer.midiMode) {
                              // Toggle OFF
                              setLayers(prev => prev.map(l => l.id === layer.id ? {
                                ...l,
                                midiMode: false,
                                audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false },
                                rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false }
                              } : l));
                            } else {
                              // Toggle ON (default to MIDI!)
                              setLayers(prev => prev.map(l => l.id === layer.id ? {
                                ...l,
                                midiMode: true,
                                audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false },
                                rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false }
                              } : l));
                              setSidebarTab('triggers');
                            }
                          }}
                          className={`p-1 rounded hover:text-white transition-colors ${layer.midiMode ? 'text-red-500 bg-red-500/10' : 'text-white/20'}`}
                          title={layer.midiMode ? "Trigger Active (Click to turn off)" : "Click to activate MIDI Trigger"}
                        >
                          <Zap size={12} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (layer.maskTargetId) {
                              // Deactivate Mask
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskTargetId: null } : l));
                              setActiveMaskMenuLayerId(null);
                            } else {
                              // Activate Mask: pick the other layer as default target
                              const otherLayer = layers.find(l => l.id !== layer.id);
                              const defaultTarget = otherLayer ? otherLayer.id : null;
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskTargetId: defaultTarget } : l));
                              setActiveMaskMenuLayerId(layer.id);
                            }
                          }}
                          className={`p-1 rounded transition-colors ${layer.maskTargetId ? 'text-purple-400 bg-purple-500/20' : 'text-white/30 hover:text-white hover:bg-white/5'}`}
                          title={layer.maskTargetId ? "Mask Active (Click to deactivate mask)" : "Click to activate Mask / Track Matte"}
                        >
                          <Blend size={12} />
                        </button>
                        {(() => {
                          const displayName = layer.type === 'generative' 
                            ? (generativesRef.current.find(g => g.uuid === layer.generativeId)?.description || layer.name || 'Generative Script') 
                            : layer.name;
                          return (
                            <span className="text-[11px] font-medium truncate opacity-80 ml-1" title={displayName}>
                              Layer {layers.findIndex(l => l.id === layer.id) + 1}: {displayName.length > 20 ? displayName.slice(0, 20) + '...' : displayName}
                            </span>
                          );
                        })()}
                        {layer.maskTargetId && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0" title={`Masking Layer`}>
                            MASK ➔ L{layers.findIndex(l => l.id === layer.maskTargetId) + 1}{layer.maskInverted ? ' [INV]' : ''}
                          </span>
                        )}
                        {(() => {
                          const maskSource = layers.find(l => l.maskTargetId === layer.id);
                          if (!maskSource) return null;
                          const maskIdx = layers.findIndex(l => l.id === maskSource.id) + 1;
                          return (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex-shrink-0" title={`Masked by Layer ${maskIdx}`}>
                              MASKED BY L{maskIdx}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, isSoloed: !l.isSoloed } : l));
                          }}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${layer.isSoloed ? 'text-black bg-white opacity-100' : 'opacity-40 hover:opacity-100 border border-white/20 hover:border-white hover:bg-white hover:text-black'}`}
                          title="Solo Layer"
                        >
                          <span className="text-[9px] font-bold">S</span>
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, isMuted: !l.isMuted } : l));
                          }}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${layer.isMuted ? 'text-red-500 bg-red-500/10 opacity-100' : 'opacity-40 hover:opacity-100'}`}
                          title="Mute Layer"
                        >
                          <span className="text-[9px] font-bold">M</span>
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (layer.isLive) stopWebcam(layer.id);
                            if (layers.length > 1) {
                              setLayers(prev => prev.filter(l => l.id !== layer.id));
                              if (activeLayerId === layer.id) setActiveLayerId(layers[0].id);
                            } else {
                              setLayers(prev => prev.map(l => l.id === layer.id ? {
                                ...l,
                                name: 'Empty Layer',
                                src: null,
                                type: 'video',
                                isLive: false,
                                videoTriggerMode: 'continuous',
                                mappings: [],
                                filterId: null
                              } : l));
                              if (videoRefs.current[layer.id]) videoRefs.current[layer.id].src = '';
                            }
                          }}
                          className="p-1 hover:bg-red-500/20 rounded text-red-500/50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {activeMaskMenuLayerId === layer.id && (
                      <div className="mt-2 p-2.5 bg-[#161618] border border-purple-500/40 rounded space-y-2.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-purple-300 tracking-wide">
                            <Blend size={13} className="text-purple-400" />
                            <span>TRACK MATTE / MASK</span>
                          </div>
                          <button onClick={() => setActiveMaskMenuLayerId(null)} className="text-white/40 hover:text-white p-0.5">
                            <X size={12} />
                          </button>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-mono uppercase text-gray-400 block">Use this layer as mask for:</label>
                          <CustomSelect
                            className="normal-case font-mono !text-[11px] bg-black/70 border-white/20"
                            value={layer.maskTargetId || ''}
                            onChange={(v) => {
                              const targetId = v || null;
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskTargetId: targetId } : l));
                            }}
                            options={[
                              { value: '', label: 'None (Standard Layer)' },
                              ...layers.filter(l => l.id !== layer.id).map(other => ({
                                value: other.id,
                                label: `Layer ${layers.findIndex(l => l.id === other.id) + 1}: ${other.name} (${other.type})`,
                              })),
                            ]}
                          />
                        </div>

                        {layer.maskTargetId && (
                          <div className="space-y-2 pt-1 border-t border-white/5">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-mono uppercase text-gray-400">Invert Mask:</span>
                              <button
                                onClick={() => {
                                  setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskInverted: !l.maskInverted } : l));
                                }}
                                className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold transition-colors border ${layer.maskInverted ? 'bg-purple-600 text-white border-purple-400' : 'bg-black/40 text-gray-400 border-white/10 hover:border-white/30'}`}
                              >
                                {layer.maskInverted ? 'INVERTED (OUT)' : 'NORMAL (IN)'}
                              </button>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-mono uppercase text-gray-400">Matte Mode:</span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskMode: 'alpha' } : l));
                                  }}
                                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${(layer.maskMode || 'alpha') === 'alpha' ? 'bg-purple-600/40 text-purple-200 border-purple-400' : 'text-gray-500 border-transparent hover:text-white'}`}
                                >
                                  ALPHA
                                </button>
                                <button
                                  onClick={() => {
                                    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskMode: 'luma' } : l));
                                  }}
                                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${layer.maskMode === 'luma' ? 'bg-purple-600/40 text-purple-200 border-purple-400' : 'text-gray-500 border-transparent hover:text-white'}`}
                                >
                                  LUMA
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-mono uppercase text-gray-400">Show Graphic:</span>
                              <button
                                onClick={() => {
                                  setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, showMaskGraphic: !l.showMaskGraphic } : l));
                                }}
                                className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold transition-colors border ${layer.showMaskGraphic ? 'bg-purple-600 text-white border-purple-400' : 'bg-black/40 text-gray-400 border-white/10 hover:border-white/30'}`}
                                title="Overlay the mask's original visual graphic on top of the masked content"
                              >
                                {layer.showMaskGraphic ? 'OVERLAY ON' : 'MASK ONLY'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {activeLayerId === layer.id && (
                      <div 
                        className="mt-2 pt-2 border-t border-white/5 space-y-4"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Load/Change Asset Icon */}
                         <div className="flex items-center gap-2">
                             <button 
                               onClick={() => { setAssetBrowserLayerTarget(layer.id); setShowAssetBrowser(true); }}
                               className="flex items-center justify-center gap-2 p-2 rounded-none border border-white/10 hover:border-white hover:bg-white hover:text-black transition-colors w-full bg-black/40"
                             >
                                <Upload size={14} />
                                <span className="text-[10px] uppercase tracking-widest font-bold truncate max-w-[180px]">
                                  {layer.type === 'generative'
                                    ? (generativesRef.current.find(g => g.uuid === layer.generativeId)?.description || layer.name || 'Change Script')
                                    : ((layer.src || layer.isLive || (layer.type === '3d' && layer.threeDKind)) ? (layer.name.length > 20 ? layer.name.slice(0, 20) + '...' : layer.name) : 'Load Asset')}
                                </span>
                             </button>
                         </div>

                         {/* Blend Mode */}
                         <div className="space-y-1 border-b border-white/5 pb-4 mb-2">
                           <label className="text-[8px] uppercase tracking-widest opacity-40">Blend Mode</label>
                           <CustomSelect
                              value={layer.blendMode}
                              onChange={(v) => setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, blendMode: v as GlobalCompositeOperation } : l))}
                              options={[
                                { value: 'source-over', label: 'Normal' },
                                { value: 'screen', label: 'Screen' },
                                { value: 'multiply', label: 'Multiply' },
                                { value: 'overlay', label: 'Overlay' },
                                { value: 'color-dodge', label: 'Color Dodge' },
                                { value: 'difference', label: 'Difference' },
                                { value: 'exclusion', label: 'Exclusion' },
                                { value: 'hard-light', label: 'Hard Light' },
                                { value: 'soft-light', label: 'Soft Light' },
                              ]}
                           />
                         </div>

                         {/* Effects List */}
                        <div className="space-y-2 pt-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-widest opacity-40">Layer Effects</label>
                            <button 
                              onClick={() => {
                                setSelectedLayerForEffect(layer.id);
                                setShowEffectBrowser(true);
                              }}
                              className="text-[9px] uppercase tracking-widest bg-transparent px-2 py-0.5 rounded hover:border border-white hover:bg-white hover:text-black transition-colors"
                            >
                              Add Effect
                            </button>
                          </div>
                          <div className="space-y-1">
                            {layer.mappings.length === 0 && (
                              <div className="text-[10px] opacity-20 italic">No effects added to this layer.</div>
                            )}
                            {layer.mappings.map(m => (
                              <div 
                                key={m.id} 
                                className={`p-2 rounded border transition-all cursor-pointer ${m.active || m.manualActive ? 'bg-red-600/20 border-red-500/50' : 'bg-transparent border-white/5 hover:border border-white hover:bg-white hover:text-black'} ${selectedEffectId === m.id && selectedLayerForEffect === layer.id ? 'border-red-500' : ''}`}
                                onClick={() => {
                                  setSelectedEffectId(m.id);
                                  setSelectedLayerForEffect(layer.id);
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-[10px] font-medium ${m.active || m.manualActive ? 'text-red-400' : 'opacity-70'}`}>{m.name}</span>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveLayerId(layer.id);
                                        setSelectedEffectId(m.id);
                                        setSelectedLayerForEffect(layer.id);
                                        setSidebarTab('triggers');
                                      }}
                                      className="p-1 rounded opacity-40 hover:opacity-100 hover:text-red-500 transition-all"
                                      title="Trigger Settings"
                                    >
                                      <Zap size={10} />
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); toggleManual(layer.id, m.id); }}
                                      className={`p-1 rounded transition-colors ${m.manualActive ? 'text-red-500' : 'opacity-20 hover:opacity-100'}`}
                                      title="Power"
                                    >
                                      <Power size={10} />
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); toggleSolo(layer.id, m.id); }}
                                      className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${m.isSoloed ? 'text-white border border-white hover:bg-white hover:text-black' : 'opacity-20 hover:opacity-100'}`}
                                      title="Solo"
                                    >
                                      <span className="text-[8px] font-bold">S</span>
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); toggleMute(layer.id, m.id); }}
                                      className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${m.isMuted ? 'text-red-500 bg-red-500/10' : 'opacity-20 hover:opacity-100'}`}
                                      title="Mute"
                                    >
                                      <span className="text-[8px] font-bold">M</span>
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); removeEffect(layer.id, m.id); }}
                                      className="p-1 rounded opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity text-white/40 hover:text-red-500"
                                      title="Remove"
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </div>
          </Section>

          <Section
            title="Layout"
            icon={<Sliders size={16} />}
            isExpanded={expandedSection === 'layout'}
            onToggle={() => setExpandedSection(expandedSection === 'layout' ? null : 'layout')}
          >
            {layoutPanel}
          </Section>
          </div>
        </aside>
        {/* Sidebar Overlay (Mobile) */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSidebar(false)}
              className="lg:hidden fixed inset-0 z-30 bg-black/40 "
            />
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <div className="flex-1 relative flex flex-col min-w-0 overflow-hidden">
        <main className="shrink-0 relative flex flex-col items-center justify-start p-2 sm:p-4 pt-1 min-w-0 overflow-hidden"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDraggingOverCanvas) setIsDraggingOverCanvas(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDraggingOverCanvas(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOverCanvas(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              importAssetFiles(Array.from(e.dataTransfer.files));
            }
          }}
        >
          <div className="relative w-full max-w-5xl aspect-video group">
            <div className={`absolute inset-0 border rounded-2xl overflow-hidden shadow-2xl bg-black/40 transition-all ${
              isDraggingOverCanvas ? 'border-red-500 ring-2 ring-red-500/50 scale-[0.99]' : 'border-white/10'
            }`}>
              {isDraggingOverCanvas && (
                <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center gap-3 border-2 border-dashed border-red-500 text-white animate-pulse">
                  <Upload size={36} className="text-red-500 animate-bounce" />
                  <span className="text-sm font-light tracking-[0.3em] uppercase">Drop assets to create layers</span>
                  <span className="text-[10px] font-mono text-white/50">Multiple files will automatically create separate layers</span>
                </div>
              )}
              {/* Hidden Layer Elements */}
              <div className="hidden">
                {layers.map(layer => (
                  layer.type === 'video' ? (
                    <video
                      key={layer.id}
                      ref={el => {
                        videoRefs.current[layer.id] = el;
                        if (el && layer.isLive) {
                          const stream = webcamStreamsRef.current[layer.id];
                          if (stream && el.srcObject !== stream) {
                            el.srcObject = stream;
                            el.play().catch(() => {});
                          }
                        }
                      }}
                      src={layer.isLive ? undefined : (layer.src || undefined)}
                      loop={!layer.isLive}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={() => setStatus('READY')}
                    />
                  ) : (
                    <img
                      key={layer.id}
                      ref={el => {
                        if (el) {
                          if (!imageRefs.current[layer.id] || (el.complete && el.naturalWidth > 0)) {
                            imageRefs.current[layer.id] = el;
                          }
                        }
                      }}
                      src={layer.src || undefined}
                      alt={layer.name}
                      loading="eager"
                      decoding="sync"
                      onLoad={(e) => {
                        imageRefs.current[layer.id] = e.currentTarget;
                      }}
                    />
                  )
                ))}
              </div>

              {layers.every(l => (!l.src && !l.isLive && l.type !== 'generative' && l.type !== '3d')) && <Waves className="absolute inset-0 z-0 pointer-events-none" />}
              <canvas id="main-render-canvas" ref={canvasRef} className={`w-full h-full object-contain relative ${layers.every(l => (!l.src && !l.isLive && l.type !== 'generative' && l.type !== '3d')) ? 'opacity-0' : ''} z-10`} />

              <ThreeDCameraOverlay
                active={threeDControlsActive && !!layers.find(l => l.id === activeLayerId && l.type === '3d' && l.threeDKind)}
                canvasRef={canvasRef}
                onOrbit={(dPitch, dYaw) => { if (activeLayerId) threeDEngineRef.current?.orbitBy(activeLayerId, dPitch, dYaw); }}
                onPan={(dx, dy) => { if (activeLayerId) threeDEngineRef.current?.panAnchor(activeLayerId, dx, dy); }}
                onZoom={(factor) => { if (activeLayerId) threeDEngineRef.current?.orbitBy(activeLayerId, 0, 0, factor); }}
                onDoubleClickNDC={(ndcX, ndcY) => {
                  if (!activeLayerId || !threeDEngineRef.current) return;
                  const hit = threeDEngineRef.current.raycastAnchor(activeLayerId, ndcX, ndcY);
                  if (hit) threeDEngineRef.current.setAnchor(activeLayerId, hit);
                }}
                onMoveAnchor={(dir) => { if (activeLayerId) threeDEngineRef.current?.moveAnchor(activeLayerId, dir); }}
                onDragEnd={() => {
                  if (!activeLayerId || !threeDEngineRef.current) return;
                  const l = layers.find(x => x.id === activeLayerId);
                  // While a preset or a sequence owns the camera, a drag just adds
                  // a persistent steering offset in the engine -- don't overwrite
                  // the base pitch/yaw knobs or cancel the motion.
                  const preset = (l?.threeDSettings?.cinemaPreset as string) || 'off';
                  const seqMode = (l?.threeDSettings?.seqMode as string) || 'off';
                  if (preset !== 'off' || seqMode !== 'off') return;
                  const orbit = threeDEngineRef.current.getCameraOrbit(activeLayerId);
                  if (!orbit) return;
                  const boundingRadius = threeDEngineRef.current.getBoundingRadius(activeLayerId);
                  setLayers(prev => prev.map(l => l.id === activeLayerId ? {
                    ...l,
                    threeDSettings: {
                      ...(l.threeDSettings || {}),
                      pitch: orbit.pitch,
                      yaw: orbit.yaw,
                      roll: orbit.roll,
                      zoom: boundingRadius > 0 ? orbit.radius / (boundingRadius * 2.6) : (l.threeDSettings?.zoom ?? 1),
                      cinemaPreset: 'off', // manual nav ends any Camera Motion preset
                    },
                  } : l));
                }}
              />

              {(() => {
                const l3d = layers.find(l => l.id === activeLayerId && l.type === '3d' && l.threeDKind);
                if (!l3d) return null;
                return (
                  <>
                    <button
                      onClick={() => setThreeDControlsActive(v => !v)}
                      className={`absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-widest transition-colors ${threeDControlsActive ? 'bg-red-600 border-red-500 text-white' : 'bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40'}`}
                      title="Toggle full 3D camera control on the canvas (drag to orbit, right-drag to pan, scroll to zoom, double-click to place anchor)"
                    >
                      <Move3d size={13} /> 3D Controls
                    </button>

                    {threeDControlsActive && (() => {
                      const seqSlots3d: any[] = Array.isArray(l3d.threeDSettings?.seqSlots) ? (l3d.threeDSettings!.seqSlots as any[]) : [];
                      const seqDur = Number(l3d.threeDSettings?.seqTransitionMs ?? 600);
                      const seqEase = (l3d.threeDSettings?.seqEasing as string) || 'inout';
                      const filledIdx = seqSlots3d.map((s, i) => (s ? i : -1)).filter(i => i >= 0);
                      const writeSlots = (arr: any[]) => setLayers(prev => prev.map(l => {
                        if (l.id !== l3d.id) return l;
                        const patch: any = { ...(l.threeDSettings || {}), seqSlots: arr };
                        if (((l.threeDSettings?.seqMode as string) || 'off') === 'off') patch.seqMode = 'manual';
                        return { ...l, threeDSettings: patch };
                      }));
                      const setSlot3d = (i: number, val: any) => { const arr = [...seqSlots3d]; while (arr.length < SEQ_SLOT_COUNT) arr.push(null); arr[i] = val; writeSlots(arr); };
                      const addAngle = () => { const idx = Array.from({ length: SEQ_SLOT_COUNT }).findIndex((_, i) => !seqSlots3d[i]); if (idx < 0) return; setSlot3d(idx, threeDEngineRef.current?.captureSeqSnapshot(l3d.id) ?? null); };
                      const goAngle = (i: number) => { seqCurRef.current[l3d.id] = i; threeDEngineRef.current?.goToSeqSnapshot(l3d.id, seqSlots3d[i], seqDur, seqEase as any); };
                      return (
                      <>
                      <div className="absolute top-3 left-3 z-30 flex flex-col gap-2">
                        <button
                          onClick={() => {
                            if (!activeLayerId || !threeDEngineRef.current) return;
                            const next = !threeDEngineRef.current.isAnchorVisible(activeLayerId);
                            threeDEngineRef.current.setAnchorVisible(activeLayerId, next);
                            setThreeDAnchorShown(next);
                          }}
                          className={`p-2 rounded-md border transition-colors ${threeDAnchorShown ? 'bg-red-600 border-red-500 text-white' : 'bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40'}`}
                          title={threeDAnchorShown ? 'Hide anchor point' : 'Show anchor point'}
                        >
                          <Crosshair size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (!activeLayerId || !threeDEngineRef.current) return;
                            threeDEngineRef.current.reframe(activeLayerId);
                            threeDEngineRef.current.cancelCinema(activeLayerId);
                            setLayers(prev => prev.map(l => l.id === activeLayerId ? {
                              ...l,
                              threeDSettings: { ...(l.threeDSettings || {}), pitch: 0, yaw: 0, roll: 0, zoom: 1, cinemaPreset: 'off' },
                            } : l));
                          }}
                          className="p-2 rounded-md border bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                          title="Recenter the camera on the asset"
                        >
                          <Focus size={14} />
                        </button>
                        <button
                          onClick={() => setAnglesPanelOpen(v => !v)}
                          className={`p-2 rounded-md border transition-colors relative ${anglesPanelOpen ? 'bg-red-600 border-red-500 text-white' : 'bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40'}`}
                          title="Camera angles"
                        >
                          <Clapperboard size={14} />
                          {filledIdx.length > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-white text-black text-[8px] font-bold flex items-center justify-center">{filledIdx.length}</span>
                          )}
                        </button>
                      </div>

                      {anglesPanelOpen && (
                        <div className="absolute top-3 left-[3.25rem] z-40 w-44 bg-black/85 backdrop-blur-sm border border-white/15 rounded-md p-2 shadow-2xl">
                          <div className="text-[9px] font-bold uppercase tracking-widest text-white/50 mb-1.5 px-0.5">Camera Angles</div>
                          <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto custom-scrollbar">
                            {Array.from({ length: SEQ_SLOT_COUNT }).map((_, i) => {
                              if (!seqSlots3d[i]) return null;
                              return (
                                <div key={i} className="flex items-center gap-1 bg-white/5 hover:bg-white/10 rounded px-1.5 py-1 transition-colors">
                                  <button onClick={() => goAngle(i)} className="flex-1 text-left text-[10px] uppercase tracking-widest text-white/80 hover:text-white truncate" title="Go to this angle">
                                    Angle {i + 1}
                                  </button>
                                  <button onClick={() => setSlot3d(i, threeDEngineRef.current?.captureSeqSnapshot(l3d.id) ?? null)} className="p-1 text-white/30 hover:text-white" title="Recapture from current view">
                                    <RefreshCw size={10} />
                                  </button>
                                  <button onClick={() => setSlot3d(i, null)} className="p-1 text-white/30 hover:text-red-400" title="Remove angle">
                                    <X size={10} />
                                  </button>
                                </div>
                              );
                            })}
                            {filledIdx.length === 0 && (
                              <div className="text-[9px] text-white/30 px-0.5 py-1 leading-relaxed">No angles yet. Frame a shot and add one.</div>
                            )}
                          </div>
                          <button
                            onClick={addAngle}
                            disabled={filledIdx.length >= SEQ_SLOT_COUNT}
                            className="mt-1.5 w-full flex items-center justify-center gap-1 text-[9px] uppercase tracking-widest px-2 py-1.5 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Plus size={10} /> Add Angle
                          </button>
                        </div>
                      )}
                      </>
                      );
                    })()}
                  </>
                );
              })()}

              {!isPlaying && !layers.every(l => (!l.src && !l.isLive && l.type !== 'generative' && l.type !== '3d')) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-30 transition-all backdrop-blur-sm">
                  <button onClick={togglePlay} className="flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-xl transition-all shadow-xl hover:scale-105 active:scale-95 cursor-pointer">
                    <Play size={20} fill="currentColor" /> Resume Engine
                  </button>
                </div>
              )}


            </div>


            {/* Bottom Controls */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-50">
              <button onClick={togglePlay} className="p-3 rounded-none border transition-colors border-white/20 hover:border-white hover:bg-white hover:text-black">
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <button 
                onClick={isRecording ? stopRecording : startRecording} 
                className={`p-3 rounded-none border transition-all ${
                  isRecording ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'border-white/20 hover:border-white hover:bg-white hover:text-black'
                }`}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
              >
                {isRecording ? <Square size={18} fill="currentColor" /> : <Circle size={18} fill="currentColor" className="text-red-500" />}
              </button>
              <button onClick={toggleFullScreen} className="p-3 rounded-none border transition-colors border-white/20 hover:border-white hover:bg-white hover:text-black">
                <Maximize size={18} />
              </button>
              <button onClick={toggleCanvasPopout} title="Open canvas in a separate window" className="p-3 rounded-none border transition-colors border-white/20 hover:border-white hover:bg-white hover:text-black">
                <ExternalLink size={18} />
              </button>
            </div>
          </div>
        </main>

          {/* Audio Transport Bar */}
          {audioStems.length > 0 && (
            <div className="shrink-0 bg-[#0b0b0d] border-t border-white/10 px-3 sm:px-5 py-2 flex items-center gap-3 w-full relative z-40">
              <button
                onClick={toggleAudioMute}
                title={audioMuted ? 'Unmute' : 'Mute'}
                className={`p-1.5 shrink-0 transition-colors ${audioMuted ? 'text-red-500' : 'text-white/50 hover:text-white'}`}
              >
                {audioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>

              <button
                onClick={toggleAudioPlay}
                className="w-9 h-9 shrink-0 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
                title={audioPlaying ? 'Pause' : 'Play'}
              >
                {audioPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
              </button>

              <span className="text-[10px] font-mono opacity-50 tabular-nums w-9 text-right shrink-0">{formatTime(audioTime)}</span>
              <input
                type="range"
                min={0}
                max={audioDuration || 1}
                step={0.01}
                value={Math.min(audioTime, audioDuration || 0)}
                onChange={handleSeek}
                className="flex-1 h-1 accent-red-600 cursor-pointer"
                aria-label="Seek"
              />
              <span className="text-[10px] font-mono opacity-50 tabular-nums w-9 shrink-0">{formatTime(audioDuration)}</span>

              <button
                onClick={toggleAudioLoop}
                title={audioLoop ? 'Loop on' : 'Loop off'}
                className={`p-1.5 shrink-0 transition-colors ${audioLoop ? 'text-red-500' : 'text-white/35 hover:text-white'}`}
              >
                <Repeat size={16} />
              </button>

              <span className="text-[9px] uppercase tracking-widest opacity-40 truncate max-w-[110px] hidden xl:block shrink-0">
                {audioStems.length === 1 ? audioStems[0].name : `${audioStems.length} stems`}
              </span>
            </div>
          )}

          {/* Bottom Parameter Panel */}
          <div className="flex-1 min-h-[220px] bg-[#050505] border-t border-white/10 p-4 overflow-y-auto custom-scrollbar w-full relative z-40">
             {(() => {
                if (!activeLayerId) {
                  return (
                    <div className="p-8 text-center opacity-40 text-[11px] uppercase tracking-widest font-bold flex flex-col items-center justify-center h-full border border-dashed border-white/10 rounded-xl my-4">
                       SELECT A LAYER OR EFFECT TO VIEW PARAMETERS
                    </div>
                  );
                }
                
                const activeLayer = layers.find(l => l.id === activeLayerId);
                if (!activeLayer) return null;
                const layerIdx = layers.findIndex(l => l.id === activeLayer.id) + 1;

                if (!activeLayer.src && !activeLayer.isLive && !activeLayer.missingAsset && activeLayer.type !== 'generative' && !(activeLayer.type === '3d' && activeLayer.threeDKind)) {
                  return (
                    <div className="p-8 text-center opacity-40 text-[11px] uppercase tracking-widest font-bold flex flex-col items-center justify-center h-full border border-dashed border-white/10 rounded-xl my-4">
                       LOAD AN ASSET OR SELECT A GENERATIVE SCRIPT TO VIEW PARAMETERS
                    </div>
                  );
                }

                const missingAssetWarning = activeLayer.missingAsset ? (
                  <div className="p-4 mb-4 rounded bg-red-900/30 border border-red-500/50 flex items-center justify-between">
                    <div>
                      <h4 className="text-red-400 font-bold text-[10px] uppercase tracking-widest mb-1">Asset Missing</h4>
                      <p className="text-red-300/70 text-[10px] font-mono break-all">{activeLayer.assetPath}</p>
                    </div>
                    <label className="px-4 py-2 ml-4 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] uppercase font-bold tracking-widest cursor-pointer transition-colors whitespace-nowrap">
                      Relink
                      <input 
                        type="file" 
                        accept={activeLayer.type === 'video' ? 'video/*' : 'image/*'} 
                        className="hidden" 
                        onChange={(e) => handleFileUpload(e, activeLayer.id)}
                      />
                    </label>
                  </div>
                ) : null;

                const renderKnob = (p: any, m: any, layerTarget: any, family: 'gen' | 'effect' | '3d') => {
                   const isGen = family === 'gen'; // 3D params are always numeric, so the boolean/action/string
                   // branches below (which only ever branch on isGen) are never reached for family==='3d'.
                   const paramId = family === '3d' ? `3d-${p.name}` : isGen ? `generative-${p.name}` : `effect-${m.id}-${p.name}`;

                   // Determine active state for triggers
                   const isTriggerActive = family === '3d' ?
                      !!layerTarget.threeDTriggerActive?.[p.name] :
                      isGen ?
                      !!layerTarget.generativeTriggerActive?.[p.name] :
                      !!m.triggerActive?.[p.name];

                   const triggerAmount = family === '3d' ?
                      (layerTarget.threeDTriggerAmount?.[p.name] ?? 0) :
                      isGen ?
                      (layerTarget.generativeTriggerAmount?.[p.name] ?? 0) :
                      (m.triggerAmount?.[p.name] ?? 0);

                   
                   if (p.type === 'boolean') {
                      const currentVal = isGen ?
                        (layerTarget.generativeSettings?.[p.name] ?? p.default) :
                        (m.settings?.[p.name] ?? p.default);
                      const boolVal = Number(currentVal) > 0.5;
                      return (
                        <div key={p.name} className="flex flex-col gap-1 p-2 bg-transparent hover:bg-white/5 rounded transition-colors w-full relative">
                           <div className="flex items-center justify-between w-full gap-2 px-2">
                              <span className="text-[7px] font-mono uppercase tracking-widest text-white/30">Toggle</span>
                              <button
                                onClick={() => {
                                   const newState = !isTriggerActive;
                                   const targetId = isGen ? `generative-${p.name}` : `effect-${m.id}-${p.name}`;
                                   if (isGen) {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerActive: { ...(l.generativeTriggerActive || {}), [p.name]: newState } } : l));
                                      const hasMapping = layerTarget.generativeMappings?.find((gm: any) => gm.id === p.name);
                                      if (newState && !hasMapping) {
                                         const targetM = {
                                           ...INITIAL_MAPPINGS[0],
                                           id: p.name,
                                           name: p.name,
                                           active: true,
                                           triggerBehavior: 'momentary' as any,
                                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                           channels: Array.from({length: 16}, (_, i) => i)
                                         };
                                         setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: [...(l.generativeMappings || []), targetM] } : l));
                                      }
                                   } else {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, triggerActive: { ...(map.triggerActive || {}), [p.name]: newState } } : map) } : l));
                                   }
                                   if (newState) {
                                      setSelectedEffectId(targetId);
                                      setSelectedLayerForEffect(layerTarget.id);
                                      setSidebarTab('triggers');
                                   } else {
                                      setSelectedEffectId(prev => prev === targetId ? null : prev);
                                   }
                                }}
                                className={`p-1.5 rounded-full transition-all flex items-center justify-center ${isTriggerActive ? 'text-red-500 bg-red-500/20' : 'text-white/20 hover:text-white hover:bg-white/10'}`}
                                title={isTriggerActive ? "Toggle Trigger Active (Click to turn off)" : "Connect Toggle to Trigger (MIDI, Audio, Rhythm)"}
                              >
                                <Zap size={10} />
                              </button>
                           </div>

                           <div className="flex-1 flex flex-col items-center justify-center mt-0.5">
                             <button
                               onClick={() => {
                                   const newVal = boolVal ? 0.0 : 1.0;
                                   if (isGen) {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: newVal } } : l));
                                   } else {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, settings: { ...map.settings, [p.name]: newVal } } : map) } : l));
                                   }
                               }}
                               className={`w-11 h-11 rounded-full border transition-all flex items-center justify-center shadow-lg active:scale-90 ${boolVal ? 'bg-red-600 border-red-500 text-white' : 'bg-black/60 border-white/20 text-white/40 hover:border-white/40 hover:text-white'}`}
                               title={boolVal ? 'On — click to turn off' : 'Off — click to turn on'}
                             >
                                <Power size={16} />
                             </button>
                             <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider font-mono mt-1 text-center truncate max-w-[85px]">
                                {p.name.replace(/_/g, ' ')}
                             </span>
                           </div>
                        </div>
                      )
                   }

                   if (p.type === 'action') {
                      return (
                        <div key={p.name} className="flex flex-col gap-1 p-2 bg-transparent hover:bg-white/5 rounded transition-colors w-full relative">
                           <div className="flex items-center justify-between w-full gap-2 px-2">
                              <span className="text-[7px] font-mono uppercase tracking-widest text-white/30">Action</span>
                              <button
                                onClick={() => {
                                   const newState = !isTriggerActive;
                                   const targetId = isGen ? `generative-${p.name}` : `effect-${m.id}-${p.name}`;
                                   if (isGen) {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerActive: { ...(l.generativeTriggerActive || {}), [p.name]: newState } } : l));
                                      const hasMapping = layerTarget.generativeMappings?.find((gm: any) => gm.id === p.name);
                                      if (newState && !hasMapping) {
                                         const targetM = { 
                                           ...INITIAL_MAPPINGS[0], 
                                           id: p.name, 
                                           name: p.name, 
                                           active: true, 
                                           triggerBehavior: 'momentary' as any,
                                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                           channels: Array.from({length: 16}, (_, i) => i)
                                         };
                                         setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: [...(l.generativeMappings || []), targetM] } : l));
                                      }
                                   } else {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, triggerActive: { ...(map.triggerActive || {}), [p.name]: newState } } : map) } : l));
                                   }
                                   if (newState) {
                                      setSelectedEffectId(targetId);
                                      setSelectedLayerForEffect(layerTarget.id);
                                      setSidebarTab('triggers');
                                   } else {
                                      setSelectedEffectId(prev => prev === targetId ? null : prev);
                                   }
                                }}
                                className={`p-1.5 rounded-full transition-all flex items-center justify-center ${isTriggerActive ? 'text-red-500 bg-red-500/20' : 'text-white/20 hover:text-white hover:bg-white/10'}`}
                                title={isTriggerActive ? "Action Trigger Active (Click to turn off)" : "Connect Action to Trigger (MIDI, Audio, Rhythm)"}
                              >
                                <Zap size={10} />
                              </button>
                           </div>

                           {/* Center: Action Button matching Knob dimensions & styling */}
                           <div className="flex-1 flex flex-col items-center justify-center mt-0.5">
                             <button
                                onClick={() => {
                                   const currentCount = Number(isGen ? (layerTarget.generativeSettings?.[p.name] ?? 0) : (m.settings?.[p.name] ?? 0));
                                   const nextCount = currentCount + 1;
                                   if (isGen) {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: nextCount } } : l));
                                   } else {
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, settings: { ...map.settings, [p.name]: nextCount } } : map) } : l));
                                   }
                                }}
                                className="w-11 h-11 rounded-full border border-white/20 bg-black/60 hover:bg-red-600 hover:border-red-500 hover:text-white text-white/80 active:scale-90 transition-all flex items-center justify-center shadow-lg group relative cursor-pointer"
                                title={`Trigger Action: ${p.name.replace(/_/g, ' ')}`}
                             >
                                <RotateCcw size={16} className="group-hover:-rotate-90 transition-transform duration-300" />
                                <div className="absolute inset-0 rounded-full border border-white/10 group-hover:border-red-400 group-hover:animate-ping opacity-25 pointer-events-none" />
                             </button>
                             <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider font-mono mt-1 text-center truncate max-w-[85px]">
                                {p.name.replace(/_/g, ' ')}
                             </span>
                           </div>
                        </div>
                      );
                   }
                   
                   if (p.type === 'string') {
                      const currentVal = isGen ? 
                        (layerTarget.generativeSettings?.[p.name] ?? p.default) : 
                        (m.settings?.[p.name] ?? p.default);
                      return (
                        <div key={p.name} className="flex flex-col gap-1 p-2 bg-transparent hover:bg-white/5 rounded transition-colors w-full col-span-2 sm:col-span-4 lg:col-span-6 xl:col-span-8">
                           <div className="flex items-center justify-between w-full px-2">
                              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider font-mono">{p.name.replace(/_/g, ' ')}</span>
                           </div>
                           <textarea
                              value={currentVal}
                              onChange={(e) => {
                                  if (isGen) {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: e.target.value } } : l));
                                  } else {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, settings: { ...map.settings, [p.name]: e.target.value } } : map) } : l));
                                  }
                              }}
                              className="w-full h-16 bg-black/40 text-xs text-white p-2 rounded outline-none border border-white/10 focus:border-white/30 resize-y"
                           />
                        </div>
                      );
                   }

return (
                      <div key={p.name} className="flex flex-col gap-1 p-2 bg-transparent hover:bg-white/5 rounded transition-colors w-full">
                        <div className="flex items-center justify-between w-full gap-2 px-2">
                           {/* Left: Counter (if active) */}
                           {isTriggerActive ? (
                             <TriggerAmountInput
                               value={triggerAmount}
                               onChange={(val) => {
                                  if (family === '3d') {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, threeDTriggerAmount: { ...(l.threeDTriggerAmount || {}), [p.name]: val } } : l));
                                  } else if (isGen) {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerAmount: { ...(l.generativeTriggerAmount || {}), [p.name]: val } } : l));
                                  } else {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, triggerAmount: { ...(map.triggerAmount || {}), [p.name]: val } } : map) } : l));
                                  }
                               }}
                             />
                           ) : <div className="w-10" />}

                           {/* Right: Lightning Button */}
                           <button
                             onClick={() => {
                                const newState = !isTriggerActive;
                                if (family === '3d') {
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? {
                                     ...l,
                                     threeDTriggerActive: { ...(l.threeDTriggerActive || {}), [p.name]: newState },
                                     threeDTriggerAmount: (newState && !(l.threeDTriggerAmount?.[p.name]))
                                       ? { ...(l.threeDTriggerAmount || {}), [p.name]: 0.5 }
                                       : (l.threeDTriggerAmount || {}),
                                   } : l));
                                   const hasMapping = layerTarget.threeDMappings?.find((gm: any) => gm.id === p.name);
                                   if (newState && !hasMapping) {
                                      const targetM = {
                                        ...INITIAL_MAPPINGS[0],
                                        id: p.name,
                                        name: p.name,
                                        active: true,
                                        triggerBehavior: 'momentary' as any,
                                        noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                        channels: Array.from({length: 16}, (_, i) => i)
                                      };
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, threeDMappings: [...(l.threeDMappings || []), targetM] } : l));
                                   }
                                   setSelectedEffectId(`3d-${p.name}`);
                                   setSelectedLayerForEffect(layerTarget.id);
                                } else if (isGen) {
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? {
                                     ...l,
                                     generativeTriggerActive: { ...(l.generativeTriggerActive || {}), [p.name]: newState },
                                     // give a visible default modulation amount when first activating
                                     generativeTriggerAmount: (newState && !(l.generativeTriggerAmount?.[p.name]))
                                       ? { ...(l.generativeTriggerAmount || {}), [p.name]: 0.5 }
                                       : (l.generativeTriggerAmount || {}),
                                   } : l));
                                   const hasMapping = layerTarget.generativeMappings?.find((gm: any) => gm.id === p.name);
                                   if (newState && !hasMapping) {
                                      const targetM = {
                                        ...INITIAL_MAPPINGS[0],
                                        id: p.name,
                                        name: p.name,
                                        active: true,
                                        triggerBehavior: 'momentary' as any,
                                        noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                        channels: Array.from({length: 16}, (_, i) => i)
                                      };
                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: [...(l.generativeMappings || []), targetM] } : l));
                                   }
                                   setSelectedEffectId(`generative-${p.name}`);
                                   setSelectedLayerForEffect(layerTarget.id);
                                } else {
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, triggerActive: { ...(map.triggerActive || {}), [p.name]: newState } } : map) } : l));
                                   setSelectedEffectId(`effect-${m.id}-${p.name}`);
                                   setSelectedLayerForEffect(layerTarget.id);
                                }
                                setSidebarTab('triggers');
                             }}
                             className={`p-1.5 rounded-full transition-all flex items-center justify-center ${isTriggerActive ? 'text-red-500 bg-red-500/20' : 'text-white/20 hover:text-white hover:bg-white/10'}`}
                             title="Toggle Parameter Trigger & Open Settings"
                           >
                             <Zap size={10} />
                           </button>
                        </div>

                        {/* Center: Knob */}
                        <div className="flex-1 flex justify-center mt-1">
                          <Knob
                             id={`layer-${layerTarget.id}-param-${p.name}`}
                             value={family === '3d' ? Number(layerTarget.threeDSettings?.[p.name] ?? p.default) : isGen ? (layerTarget.generativeSettings?.[p.name] ?? (p.id ? layerTarget.generativeSettings?.[p.id] : undefined) ?? p.default) : ((p.id ? m.settings?.[p.id] : undefined) ?? m.settings?.[p.name] ?? p.default ?? p.min)}
                             min={p.min}
                             max={p.max}
                             label={p.name}
                             isLearning={(isMidiLearnMode || (ccLearnTarget?.layerId === layerTarget.id && ccLearnTarget?.paramId === paramId)) ? (ccLearnTarget || { active: true }) : false}
                             onContextMenuAction={(action) => {
                                if (action === 'learn') {
                                  setCcLearnTarget({layerId: layerTarget.id, paramId, min: p.min, max: p.max});
                                } else if (action === 'clear') {
                                  setLayers(prev => prev.map(l => {
                                    if (l.id !== layerTarget.id || !l.ccBindings) return l;
                                    const newBindings = { ...l.ccBindings };
                                    delete newBindings[paramId];
                                    return { ...l, ccBindings: newBindings };
                                  }));
                                  if (ccLearnTarget?.paramId === paramId) setCcLearnTarget(null);
                                }
                              }}
                             ccLabel={layerTarget.ccBindings?.[paramId] ? `CC ${layerTarget.ccBindings[paramId].cc}` : undefined}
                             onChange={(val) => {
                                if (family === '3d') {
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, threeDSettings: { ...(l.threeDSettings || {}), [p.name]: val } } : l));
                                } else if (isGen) {
                                   setLayers(prev => prev.map(l => {
                                      if (l.id !== layerTarget.id) return l;
                                      const nextSettings = { ...(l.generativeSettings || {}), [p.name]: val };
                                      if (p.id) nextSettings[p.id] = val;
                                      return { ...l, generativeSettings: nextSettings };
                                   }));
                                } else {
                                   setLayers(prev => prev.map(l => {
                                      if (l.id !== layerTarget.id) return l;
                                      return { ...l, mappings: l.mappings.map((map: any) => {
                                         if (map.id !== m.id) return map;
                                         const nextSettings = { ...map.settings, [p.name]: val };
                                         if (p.id) nextSettings[p.id] = val;
                                         return { ...map, settings: nextSettings };
                                      })};
                                   }));
                                }
                             }}
                          />
                        </div>
                      </div>
                   );
                };

                // Toggles and action buttons always render after the regular knobs,
                // keeping their relative order among themselves.
                const sortParamsForDisplay = (params: any[]) => {
                   const pushToEnd = (t: string) => t === 'action' || t === 'boolean';
                   return [...params].sort((a, b) => (pushToEnd(a.type) ? 1 : 0) - (pushToEnd(b.type) ? 1 : 0));
                };

                const CollapseHead = ({ id, label }: { id: 'params' | 'colours' | 'fx'; label: string }) => (
                  <button
                    onClick={() => setBelowPanel(id)}
                    className={`w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-widest border-b pb-2 transition-colors ${belowPanel === id ? 'text-red-400 border-white/10' : 'text-white/35 border-white/5 hover:text-white/70'}`}
                  >
                    <span>{label}</span>
                    <span className="opacity-40">{belowPanel === id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                  </button>
                );

                return (
                  <div className="space-y-4 pb-20">
                    {/* 3D Parameters */}
                    {activeLayer.type === '3d' && activeLayer.threeDKind && (
                      <div className="space-y-4">
                        <CollapseHead id="params" label={`Parameters — ${activeLayer.threeDKind === 'mesh' ? '3D Mesh' : activeLayer.threeDKind === 'splat' ? 'Gaussian Splat' : 'Kinect Point Cloud'}`} />
                        {belowPanel === 'params' && (
                        <>
                        {threeDEngineRef.current?.getLoadError(activeLayer.id) && (
                          <div className="p-3 rounded bg-red-900/30 border border-red-500/50 text-red-300/80 text-[10px] font-mono">
                            {threeDEngineRef.current.getLoadError(activeLayer.id)}
                          </div>
                        )}
                        {(() => {
                          const clipMode = (activeLayer.threeDSettings?.clipMode as string) || 'off';
                          const cinemaPreset = (activeLayer.threeDSettings?.cinemaPreset as string) || 'off';
                          const seqMode = (activeLayer.threeDSettings?.seqMode as string) || 'off';
                          const seqSlots: any[] = Array.isArray(activeLayer.threeDSettings?.seqSlots) ? (activeLayer.threeDSettings!.seqSlots as any[]) : [];
                          const seqTransitionMs = Number(activeLayer.threeDSettings?.seqTransitionMs ?? 600);
                          const seqEasing = (activeLayer.threeDSettings?.seqEasing as string) || 'inout';
                          const setSeq = (patch: any) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, threeDSettings: { ...(l.threeDSettings || {}), ...patch } } : l));
                          const setSlot = (i: number, val: any) => {
                            const arr = [...seqSlots];
                            while (arr.length < SEQ_SLOT_COUNT) arr.push(null);
                            arr[i] = val;
                            setSeq({ seqSlots: arr });
                          };
                          const seqZap = (key: string, label: string) => {
                            const on = !!activeLayer.threeDTriggerActive?.[key];
                            return (
                              <button
                                onClick={() => {
                                  const newState = !on;
                                  setLayers(prev => prev.map(l => {
                                    if (l.id !== activeLayer.id) return l;
                                    let maps = l.threeDMappings || [];
                                    if (newState && !maps.find((m: any) => m.id === key)) {
                                      maps = [...maps, { ...INITIAL_MAPPINGS[0], id: key, name: label, active: true, triggerBehavior: 'momentary' as any, noteSettings: { ...DEFAULT_NOTE_SETTINGS }, channels: Array.from({ length: 16 }, (_, i) => i) }];
                                    }
                                    return { ...l, threeDTriggerActive: { ...(l.threeDTriggerActive || {}), [key]: newState }, threeDMappings: maps };
                                  }));
                                  if (newState) { setSelectedEffectId(`3d-${key}`); setSelectedLayerForEffect(activeLayer.id); setSidebarTab('triggers'); }
                                }}
                                className={`p-1.5 rounded-full transition-all flex items-center justify-center ${on ? 'text-red-500 bg-red-500/20' : 'text-white/20 hover:text-white hover:bg-white/10'}`}
                                title={`Connect ${label} to a trigger`}
                              >
                                <Zap size={10} />
                              </button>
                            );
                          };
                          const isClipParam = (name: string) => name === 'clip_radius' || name === 'clip_w' || name === 'clip_h' || name === 'clip_d';
                          // cinema_speed lives under Camera Motion; bg/env_int live in the World section;
                          // exposure/env_int only apply to glTF meshes.
                          const isHiddenGridParam = (name: string) => isClipParam(name) || name === 'cinema_speed' || name === 'bg' || name === 'env_int'
                            || (name === 'exposure' && activeLayer.threeDKind !== 'mesh');
                          const knobFor = (p: any) => {
                            const mapping = activeLayer.threeDMappings?.find(m => m.id === p.name) || { id: p.name, name: p.name, active: false };
                            return renderKnob(p, mapping, activeLayer, '3d');
                          };
                          return (<>
                            {THREE_D_PARAM_GROUPS.map(group => {
                              // Clip knobs are rendered separately, gated on the Clip Region mode.
                              const groupParams = sortParamsForDisplay(THREE_D_PARAMETERS.filter(p => p.group === group.id && !isHiddenGridParam(p.name)));
                              if (groupParams.length === 0) return null;
                              return (
                                <div key={group.id} className="space-y-3">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">{group.label}</label>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                                    {groupParams.map(knobFor)}
                                  </div>
                                  {group.id === 'camera' && (
                                    <div className="space-y-2 pt-1">
                                      <label className="text-[10px] uppercase tracking-widest opacity-40">Camera Motion</label>
                                      <CustomSelect
                                        value={cinemaPreset}
                                        onChange={(v) => {
                                          setLayers(prev => prev.map(l => {
                                            if (l.id !== activeLayer.id) return l;
                                            const next: any = { ...(l.threeDSettings || {}), cinemaPreset: v };
                                            if (v !== 'off') next.seqMode = 'off'; // preset and sequence are mutually exclusive
                                            // Turning the preset off: freeze the camera where it left off so it doesn't jump.
                                            if (v === 'off') {
                                              const orbit = threeDEngineRef.current?.getCameraOrbit(activeLayer.id);
                                              const br = threeDEngineRef.current?.getBoundingRadius(activeLayer.id) ?? 0;
                                              if (orbit) {
                                                next.pitch = orbit.pitch; next.yaw = orbit.yaw; next.roll = orbit.roll;
                                                next.zoom = br > 0 ? orbit.radius / (br * 2.6) : (l.threeDSettings?.zoom ?? 1);
                                              }
                                              threeDEngineRef.current?.cancelCinema(activeLayer.id);
                                            }
                                            return { ...l, threeDSettings: next };
                                          }));
                                        }}
                                        buttonClassName="w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors"
                                        options={[{ value: 'off', label: 'Off (Manual)' }, ...CINEMA_PRESET_NAMES.map(n => ({ value: n, label: n }))]}
                                      />
                                      {cinemaPreset !== 'off' && (
                                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 pt-2">
                                          {THREE_D_PARAMETERS.filter(p => p.name === 'cinema_speed').map(knobFor)}
                                        </div>
                                      )}

                                      <label className="text-[10px] uppercase tracking-widest opacity-40 block pt-2">Camera Sequence</label>
                                      <CustomSelect
                                        value={seqMode}
                                        onChange={(v) => { setSeq({ seqMode: v, ...(v !== 'off' ? { cinemaPreset: 'off' } : {}) }); if (v === 'off') threeDEngineRef.current?.clearSeq(activeLayer.id); }}
                                        buttonClassName="w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors"
                                        options={[
                                          { value: 'off', label: 'Off' },
                                          { value: 'manual', label: 'Manual (buttons)' },
                                          { value: 'advance', label: 'On Trigger → Next' },
                                          { value: 'perSlot', label: 'Per-Slot Triggers' },
                                        ]}
                                      />
                                      {seqMode !== 'off' && (
                                        <div className="space-y-2 pt-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[9px] uppercase tracking-widest text-white/40">Transition</span>
                                            <input
                                              type="number" min={0} max={8000} step={50} value={seqTransitionMs}
                                              onChange={(e) => setSeq({ seqTransitionMs: Math.max(0, Number(e.target.value) || 0) })}
                                              className="w-16 bg-black/40 border border-white/10 rounded p-1 text-[10px] outline-none text-white"
                                            />
                                            <span className="text-[8px] text-white/30">ms · 0 = instant</span>
                                            <CustomSelect
                                              value={seqEasing}
                                              onChange={(v) => setSeq({ seqEasing: v })}
                                              buttonClassName="bg-black/40 border border-white/10 hover:border-white/25 rounded px-2 py-1 text-[9px] uppercase tracking-widest outline-none text-white transition-colors flex items-center gap-1"
                                              options={[
                                                { value: 'inout', label: 'Ease In-Out' },
                                                { value: 'linear', label: 'Linear' },
                                                { value: 'in', label: 'Ease In' },
                                                { value: 'out', label: 'Ease Out' },
                                                { value: 'instant', label: 'Instant' },
                                              ]}
                                            />
                                          </div>
                                          {seqMode === 'advance' && (
                                            <div className="flex items-center justify-between bg-black/30 rounded px-2 py-1.5">
                                              <span className="text-[9px] uppercase tracking-widest text-white/60">Advance Trigger</span>
                                              {seqZap('seq_advance', 'Sequence Advance')}
                                            </div>
                                          )}
                                          <div className="space-y-1.5">
                                            {Array.from({ length: SEQ_SLOT_COUNT }).map((_, i) => {
                                              const filled = !!seqSlots[i];
                                              return (
                                                <div key={i} className={`flex items-center gap-1.5 rounded px-2 py-1.5 border ${filled ? 'bg-red-500/10 border-red-500/30' : 'bg-black/30 border-white/5'}`}>
                                                  <span className="text-[10px] font-bold w-4 text-white/60">{i + 1}</span>
                                                  <button
                                                    onClick={() => setSlot(i, threeDEngineRef.current?.captureSeqSnapshot(activeLayer.id) ?? null)}
                                                    className="text-[8px] uppercase tracking-widest px-2 py-1 rounded border border-white/15 hover:border-white/40 hover:text-white text-white/60"
                                                  >
                                                    {filled ? 'Recapture' : 'Capture'}
                                                  </button>
                                                  {filled && (
                                                    <button
                                                      onClick={() => {
                                                        seqCurRef.current[activeLayer.id] = i;
                                                        threeDEngineRef.current?.goToSeqSnapshot(activeLayer.id, seqSlots[i], seqTransitionMs, seqEasing as any);
                                                      }}
                                                      className="text-[8px] uppercase tracking-widest px-2 py-1 rounded border border-white/15 hover:border-white/40 hover:text-white text-white/60"
                                                    >
                                                      Go
                                                    </button>
                                                  )}
                                                  {filled && (
                                                    <button onClick={() => setSlot(i, null)} className="text-[10px] px-1.5 text-white/30 hover:text-red-400" title="Clear angle">&times;</button>
                                                  )}
                                                  <div className="flex-1" />
                                                  {seqMode === 'perSlot' && filled && seqZap('seq_slot_' + i, 'Slot ' + (i + 1))}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {(() => {
                              const env = (activeLayer.threeDSettings?.env as string) || 'studio';
                              const bgMode = (activeLayer.threeDSettings?.bgMode as string) || 'transparent';
                              const bgColor = (activeLayer.threeDSettings?.bgColor as string) || '#ffffff';
                              const bgOpacity = Number(activeLayer.threeDSettings?.bg ?? 1);
                              const envInt = Number(activeLayer.threeDSettings?.env_int ?? 1.2);
                              const isMesh = activeLayer.threeDKind === 'mesh';
                              const selCls = "w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors";
                              return (
                                <div className="space-y-3 pt-4 border-t border-white/5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">World</label>
                                  {isMesh && (
                                    <>
                                      <div className="space-y-1.5">
                                        <label className="text-[9px] uppercase tracking-widest opacity-40 block">Environment (lighting)</label>
                                        <CustomSelect
                                          value={env}
                                          onChange={(v) => setSeq({ env: v })}
                                          buttonClassName={selCls}
                                          options={[
                                            { value: 'studio', label: 'Studio (neutral)' },
                                            { value: 'bright', label: 'Bright (high-key)' },
                                            { value: 'warm', label: 'Warm / Sunset' },
                                            { value: 'dawn', label: 'Dawn (soft pink)' },
                                            { value: 'cool', label: 'Cool / Daylight' },
                                            { value: 'none', label: 'None (lights only)' },
                                          ]}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Reflections</span><span>{envInt.toFixed(1)}x</span></div>
                                        <input type="range" min={0} max={3} step={0.05} value={envInt} onChange={(e) => setSeq({ env_int: parseFloat(e.target.value) })} className="w-full accent-white h-1" />
                                      </div>
                                    </>
                                  )}
                                  <div className="space-y-1.5">
                                    <label className="text-[9px] uppercase tracking-widest opacity-40 block">Background</label>
                                    <CustomSelect
                                      value={bgMode}
                                      onChange={(v) => setSeq({ bgMode: v })}
                                      buttonClassName={selCls}
                                      options={[
                                        { value: 'transparent', label: 'Transparent' },
                                        { value: 'solid', label: 'Solid Colour' },
                                      ]}
                                    />
                                    {bgMode === 'solid' && (
                                      <div className="flex items-center gap-2 pt-1">
                                        <input type="color" value={bgColor} onChange={(e) => setSeq({ bgColor: e.target.value })} className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/15 p-0" />
                                        <div className="flex-1 space-y-1">
                                          <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Opacity</span><span>{Math.round(bgOpacity * 100)}%</span></div>
                                          <input type="range" min={0} max={1} step={0.02} value={bgOpacity} onChange={(e) => setSeq({ bg: parseFloat(e.target.value) })} className="w-full accent-white h-1" />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            <div className="space-y-2 pt-4 border-t border-white/5">
                              <label className="text-[10px] uppercase tracking-widest opacity-40">Clip Region</label>
                              <CustomSelect
                                value={clipMode}
                                onChange={(v) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, threeDSettings: { ...(l.threeDSettings || {}), clipMode: v } } : l))}
                                buttonClassName="w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors"
                                options={[
                                  { value: 'off', label: 'Off' },
                                  { value: 'sphere', label: 'Sphere' },
                                  { value: 'box', label: 'Box' },
                                ]}
                              />
                              {clipMode !== 'off' && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 pt-2">
                                  {clipMode === 'sphere'
                                    ? THREE_D_PARAMETERS.filter(p => p.name === 'clip_radius').map(knobFor)
                                    : THREE_D_PARAMETERS.filter(p => p.name === 'clip_w' || p.name === 'clip_h' || p.name === 'clip_d').map(knobFor)}
                                </div>
                              )}
                            </div>
                          </>);
                        })()}

                        {activeLayer.threeDKind === 'kinect' && (
                          <div className="space-y-2 pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] uppercase tracking-widest opacity-40">Kinect Source</label>
                              <span className={`text-[9px] uppercase tracking-widest font-bold flex items-center gap-1.5 ${threeDEngineRef.current?.isKinectLive(activeLayer.id) ? 'text-green-400' : 'text-white/40'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${threeDEngineRef.current?.isKinectLive(activeLayer.id) ? 'bg-green-500 animate-pulse' : 'bg-white/30'}`} />
                                {threeDEngineRef.current?.isKinectLive(activeLayer.id) ? 'Live' : 'Synthetic Demo'}
                              </span>
                            </div>
                          </div>
                        )}
                        </>
                        )}
                      </div>
                    )}

                    {/* Generative Parameters */}
                    {activeLayer.type === 'generative' && activeLayer.generativeId && generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.parameters.length > 0 && (
                      <div className="space-y-4">
                        <CollapseHead id="params" label={`Parameters — ${generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.description || 'Script'}`} />
                        {belowPanel === 'params' && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                          {sortParamsForDisplay(generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.parameters || []).map(p => {
                            const mapping = activeLayer.generativeMappings?.find(m => m.id === p.name) || { id: p.name, name: p.name, active: false };
                            return renderKnob(p, mapping, activeLayer, 'gen');
                          })}
                        </div>
                        )}

                        <CollapseHead id="colours" label="Colours & Palette" />
                        {belowPanel === 'colours' && (
                        <>
                        {/* Generative Colours & Palette Presets Section */}
                        {(() => {
                          const genDef = generativesRef.current.find(g => g.uuid === activeLayer.generativeId);
                          const elements: GenerativeElement[] = genDef?.elements || [
                            { id: "background", name: "Background", defaultColor: "#ffffff" },
                            { id: "primary", name: "Primary Geometry", defaultColor: "#eb556b" },
                            { id: "secondary", name: "Secondary Accent", defaultColor: "#7599a4" },
                            { id: "highlight", name: "Highlights & Lines", defaultColor: "#f5a6b5" }
                          ];

                          const currentColors = activeLayer.generativeColors || {};
                          const lockedMap = activeLayer.generativeLockedColors || {};
                          const activePaletteId = activeLayer.generativeActivePaletteId || 'crimson_slate';
                          const activePalette = BUILTIN_PALETTES.find(p => p.id === activePaletteId) || BUILTIN_PALETTES[0];
                          const isPaletteTriggerActive = !!activeLayer.generativeTriggerActive?.['palette_cycle'];
                          const lockedCount = Object.values(lockedMap).filter(Boolean).length;

                          const handleApplyPalette = (palette: ColorPalettePreset) => {
                            const nextColors = { ...currentColors };
                            elements.forEach((el, idx) => {
                              if (!lockedMap[el.id]) {
                                nextColors[el.id] = palette.colors[idx % palette.colors.length];
                              }
                            });
                            if (actionTriggerStateRef.current[`pal-cycle-${activeLayer.id}`]) {
                              actionTriggerStateRef.current[`pal-cycle-${activeLayer.id}`].count = 0;
                            }
                            setLayers(prev => prev.map(l => l.id === activeLayer.id ? {
                              ...l,
                              generativeColors: nextColors,
                              generativeActivePaletteId: palette.id,
                              generativeColorCycleIndex: 0
                            } : l));
                          };

                          const handleCycleColors = () => {
                            const nextColors = { ...currentColors };
                            const nextCycle = ((activeLayer.generativeColorCycleIndex ?? 0) + 1) % activePalette.colors.length;
                            elements.forEach((el, idx) => {
                              if (!lockedMap[el.id]) {
                                nextColors[el.id] = activePalette.colors[(idx + nextCycle) % activePalette.colors.length];
                              }
                            });
                            if (actionTriggerStateRef.current[`pal-cycle-${activeLayer.id}`]) {
                              actionTriggerStateRef.current[`pal-cycle-${activeLayer.id}`].count = 0;
                            }
                            setLayers(prev => prev.map(l => l.id === activeLayer.id ? {
                              ...l,
                              generativeColors: nextColors,
                              generativeColorCycleIndex: nextCycle
                            } : l));
                          };

                          const toggleLock = (elId: string) => {
                            const nextLocked = { ...lockedMap, [elId]: !lockedMap[elId] };
                            setLayers(prev => prev.map(l => l.id === activeLayer.id ? {
                              ...l,
                              generativeLockedColors: nextLocked
                            } : l));
                          };

                          return (
                            <div className="space-y-4 pt-3 border-t border-white/10 mt-4">
                              {/* Collapsible Header */}
                              <div 
                                onClick={() => setIsColorsMenuExpanded(prev => !prev)}
                                className="flex items-center justify-between cursor-pointer py-1 select-none group"
                              >
                                <div className="flex items-center gap-3">
                                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 flex items-center gap-2">
                                    <Palette size={13} className="text-red-400" />
                                    Colours
                                  </h3>
                                  {/* Active palette mini-swatches */}
                                  <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-full px-2 py-0.5">
                                    <span className="text-[9px] text-white/50 font-mono font-medium truncate max-w-[120px]">{activePalette.name}</span>
                                    <div className="flex items-center -space-x-1 ml-1.5">
                                      {elements.map(el => (
                                        <div 
                                          key={el.id}
                                          className="w-2.5 h-2.5 rounded-full border border-black"
                                          style={{ backgroundColor: currentColors[el.id] || el.defaultColor }}
                                        />
                                      ))}
                                    </div>
                                  </div>

                                  {lockedCount > 0 && (
                                    <span className="text-[8px] bg-red-600/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full font-mono flex items-center gap-1">
                                      <Lock size={9} />
                                      {lockedCount} Locked
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {/* Trigger Button: Connect to MIDI / Audio */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newState = !isPaletteTriggerActive;
                                      setLayers(prev => prev.map(l => l.id === activeLayer.id ? {
                                        ...l,
                                        generativeTriggerActive: { ...(l.generativeTriggerActive || {}), ['palette_cycle']: newState }
                                      } : l));

                                      const hasMapping = activeLayer.generativeMappings?.find(gm => gm.id === 'palette_cycle');
                                      if (newState && !hasMapping) {
                                        const targetM = {
                                          ...INITIAL_MAPPINGS[0],
                                          id: 'palette_cycle',
                                          name: 'Palette Cycle',
                                          active: true,
                                          triggerBehavior: 'momentary' as any,
                                          noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                          channels: Array.from({length: 16}, (_, i) => i)
                                        };
                                        setLayers(prev => prev.map(l => l.id === activeLayer.id ? {
                                          ...l,
                                          generativeMappings: [...(l.generativeMappings || []), targetM]
                                        } : l));
                                      }
                                      setSelectedEffectId('generative-palette_cycle');
                                      setSelectedLayerForEffect(activeLayer.id);
                                      setSidebarTab('triggers');
                                    }}
                                    className={`p-1 px-2 rounded flex items-center gap-1.5 transition-all text-[9px] font-mono uppercase ${isPaletteTriggerActive ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-white/5 hover:bg-white/10 text-white/40 hover:text-white border border-white/10'}`}
                                    title="Connect Palette Cycle to Trigger (MIDI, Audio, Rhythm)"
                                  >
                                    <Zap size={11} className={isPaletteTriggerActive ? 'text-red-400 animate-pulse' : ''} />
                                    <span>Trigger</span>
                                  </button>

                                  {/* Manual Cycle Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCycleColors();
                                    }}
                                    className="p-1 px-2 bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30 rounded flex items-center gap-1.5 text-[9px] font-mono uppercase text-white/80 hover:text-white transition-all active:scale-95"
                                    title="Cycle Colors Across Unlocked Elements"
                                  >
                                    <RotateCcw size={11} />
                                    <span>Cycle</span>
                                  </button>

                                  <button className="text-white/40 group-hover:text-white transition-colors p-1">
                                    <ChevronDown size={14} className={`transform transition-transform ${isColorsMenuExpanded ? 'rotate-180' : ''}`} />
                                  </button>
                                </div>
                              </div>

                              {/* Expanded Content */}
                              {isColorsMenuExpanded && (
                                <div className="space-y-4 pt-1">
                                  {/* Top Bar (Palette Preset Deck) */}
                                  <div className="space-y-2">
                                    <span className="text-[8px] uppercase tracking-widest text-white/40 font-mono">Palette Preset Deck</span>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 overflow-x-auto pb-1">
                                      {BUILTIN_PALETTES.map(p => {
                                        const isSelected = activePaletteId === p.id;
                                        return (
                                          <button
                                            key={p.id}
                                            onClick={() => handleApplyPalette(p)}
                                            className={`p-2 rounded border text-left flex flex-col justify-between gap-1.5 transition-all group/pal ${isSelected ? 'bg-red-600/10 border-red-500 text-white shadow-md' : 'bg-black/40 border-white/10 hover:border-white/30 text-white/60 hover:text-white'}`}
                                            title={`Apply ${p.name}`}
                                          >
                                            <div className="flex items-center justify-between w-full">
                                              <span className="text-[9px] font-mono font-bold truncate max-w-[100px]">{p.name}</span>
                                              {isSelected && <Check size={10} className="text-red-400" />}
                                            </div>
                                            {/* Swatch strip */}
                                            <div className="flex items-center h-3 w-full rounded overflow-hidden border border-white/10">
                                              {p.colors.map((c, i) => (
                                                <div 
                                                  key={i} 
                                                  className="flex-1 h-full"
                                                  style={{ backgroundColor: c }}
                                                />
                                              ))}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Element List (Target Mapping) */}
                                  <div className="space-y-2 pt-2 border-t border-white/5">
                                    <span className="text-[8px] uppercase tracking-widest text-white/40 font-mono">Element Color Mappings</span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                      {elements.map(el => {
                                        const elColor = currentColors[el.id] || el.defaultColor;
                                        const isLocked = !!lockedMap[el.id];

                                        return (
                                          <div 
                                            key={el.id}
                                            className={`p-2.5 rounded-lg border transition-all flex items-center justify-between gap-3 ${isLocked ? 'bg-red-950/20 border-red-500/30' : 'bg-black/40 border-white/10 hover:border-white/20'}`}
                                          >
                                            {/* Left: Label */}
                                            <div className="flex flex-col min-w-0 flex-1">
                                              <span className="text-[10px] font-bold text-white tracking-wider font-mono truncate">{el.name}</span>
                                              <span className="text-[8px] text-white/40 font-mono uppercase">{isLocked ? 'Locked' : 'Unlocked'}</span>
                                            </div>

                                            {/* Center: Lock Button */}
                                            <button
                                              onClick={() => toggleLock(el.id)}
                                              className={`p-1.5 rounded transition-all flex items-center justify-center ${isLocked ? 'bg-red-600 text-white shadow-sm' : 'bg-white/5 text-white/40 hover:text-white hover:bg-white/10 border border-white/10'}`}
                                              title={isLocked ? "Element Locked: Ignores Palette Swaps & Trigger Cycles" : "Element Unlocked: Updates with Palettes & Trigger Cycles"}
                                            >
                                              {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                                            </button>

                                            {/* Right: Color Chip (Swatch Circle) + Popover Trigger */}
                                            <button
                                              onClick={(e) => {
                                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                setActiveColorPickerTarget({
                                                  elementId: el.id,
                                                  elementName: el.name,
                                                  color: elColor,
                                                  anchorRect: rect
                                                });
                                              }}
                                              className="flex items-center gap-2 group/chip cursor-pointer"
                                              title="Click to Open Detail Color Picker"
                                            >
                                              <div 
                                                className="w-7 h-7 rounded-full border-2 border-white/40 group-hover/chip:border-white group-hover/chip:scale-105 transition-all shadow-md flex-shrink-0 relative overflow-hidden"
                                                style={{ 
                                                  backgroundColor: isTransparentColor(elColor) ? 'transparent' : elColor,
                                                  backgroundImage: isTransparentColor(elColor) ? 'repeating-conic-gradient(#888 0% 25%, #333 0% 50%) 50% / 5px 5px' : undefined
                                                }}
                                              >
                                                {isTransparentColor(elColor) && (
                                                  <div className="absolute inset-0 border-t-2 border-red-500 transform rotate-45 scale-125" />
                                                )}
                                              </div>
                                              <span className="text-[10px] font-mono text-white/60 group-hover/chip:text-white font-bold uppercase">
                                                {isTransparentColor(elColor) ? 'TRANSPARENT' : elColor.toUpperCase()}
                                              </span>
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        </>
                        )}
                      </div>
                    )}

                    {/* Effect Parameters */}
                    {activeLayer.mappings.length > 0 && (
                      <div className="space-y-4">
                        <CollapseHead id="fx" label="Effect Settings" />
                        {belowPanel === 'fx' && activeLayer.mappings.map(m => {
                          const effectDef = ALL_EFFECTS.find(e => e.id === m.id);
                          if (!effectDef) return null;
                          return (
                            <div key={m.id} className="space-y-4">
                              <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50 pb-1">{effectDef.name}</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                                {sortParamsForDisplay(effectDef.parameters).map(p => renderKnob(p, m, activeLayer, 'effect'))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Image / Video Transform -- 3D layers use the grouped 3D
                        parameters (Position group) for object transform instead. */}
                    {activeLayer.type !== 'generative' && activeLayer.type !== '3d' && (activeLayer.src || activeLayer.isLive) && (
                      <div className="space-y-4 pt-6 mt-6 border-t border-white/10">
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2">
                           Parameters: Layer {layerIdx}
                        </h3>
                        {(() => {
                          const renderTransformKnob = (paramName: string, min: number, max: number, defaultVal: number, label: string) => {
                             const paramId = `transform-${paramName}`;
                             const isTriggerActive = !!activeLayer.transformTriggerActive?.[paramName];
                             const triggerAmount = activeLayer.transformTriggerAmount?.[paramName] ?? 0;
                             const currentVal = (activeLayer as any)[paramName] ?? defaultVal;

                             return (
                                <div key={paramName} className="flex flex-col gap-1 p-2 bg-transparent hover:bg-white/5 rounded transition-colors w-full">
                                  <div className="flex items-center justify-between w-full gap-2 px-2">
                                     {isTriggerActive ? (
                                       <TriggerAmountInput
                                         value={triggerAmount}
                                         onChange={(val) => {
                                            setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, transformTriggerAmount: { ...(l.transformTriggerAmount || {}), [paramName]: val } } : l));
                                         }}
                                       />
                                     ) : <div className="w-10" />}

                                     <button
                                       onClick={() => {
                                          const newState = !isTriggerActive;
                                          setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, transformTriggerActive: { ...(l.transformTriggerActive || {}), [paramName]: newState } } : l));
                                          setSelectedEffectId(paramId);
                                          setSelectedLayerForEffect(activeLayer.id);
                                          setSidebarTab('triggers');
                                       }}
                                       className={`p-1.5 rounded-full transition-all flex items-center justify-center ${isTriggerActive ? 'text-red-500 bg-red-500/20' : 'text-white/20 hover:text-white hover:bg-white/10'}`}
                                       title="Toggle Parameter Trigger & Open Settings"
                                     >
                                       <Zap size={10} />
                                     </button>
                                  </div>

                                  <div className="flex-1 flex justify-center mt-1">
                                    <Knob
                                       id={`layer-${activeLayer.id}-param-${paramName}`}
                                       value={currentVal}
                                       min={min}
                                       max={max}
                                       label={label}
                                       onChange={(val) => {
                                          setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, [paramName]: val } : l));
                                       }}
                                    />
                                  </div>
                                </div>
                             );
                          };

                          return (
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                              {renderTransformKnob('size', 0, 200, 100, 'Size')}
                              {renderTransformKnob('rotation', 0, 360, 0, 'Rotation')}
                              {renderTransformKnob('posX', -100, 100, 0, 'Position X')}
                              {renderTransformKnob('posY', -100, 100, 0, 'Position Y')}
                              {activeLayer.type === 'video' && !activeLayer.isLive && renderTransformKnob('speed', 0, 2, 1, 'Speed')}
                            </div>
                          );
                        })()}

                        {activeLayer.type === 'video' && activeLayer.src && (
                          <div className="space-y-6 pt-6 mt-6 border-t border-white/10">
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 pb-2 border-b border-white/5">Video Modes</h3>
                            {(() => {
                              const isLayerTriggerActive = !!activeLayer.midiMode || !!activeLayer.audioMapping?.enabled || !!activeLayer.rhythmMapping?.enabled;
                              return (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                   <div className="space-y-4">
                                     <RangeSlider
                                       label="Video Segment"
                                       min={0}
                                       max={videoRefs.current[activeLayer.id]?.duration || 10}
                                       start={activeLayer.videoStart || 0}
                                       end={activeLayer.videoEnd || videoRefs.current[activeLayer.id]?.duration || 10}
                                       onChange={(s, e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoStart: s, videoEnd: e } : l))}
                                     />
                                   </div>

                                   {(
                                     <div className="space-y-4">
                                       <label className="text-[10px] uppercase tracking-widest opacity-40">Trigger Mode</label>
                                       <CustomSelect
                                         value={activeLayer.videoTriggerMode || 'continuous'}
                                         onChange={(v) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoTriggerMode: v as any } : l))}
                                         buttonClassName="w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors"
                                         options={[
                                           { value: 'continuous', label: 'Continuous Playback' },
                                           { value: 'restart', label: 'Restart on Trigger' },
                                           { value: 'advance', label: 'Frame Advance' },
                                           { value: 'rewind', label: 'Boomerang' },
                                           { value: 'frame-accumulator', label: 'Frame Accumulator' },
                                         ]}
                                       />
                                       {!isLayerTriggerActive && (
                                         <p className="text-[8px] uppercase tracking-widest text-white/30 leading-relaxed">
                                           Restart / Advance / Boomerang / Accumulator react to a trigger — enable a MIDI, Audio or Rhythm trigger on this layer to drive them.
                                         </p>
                                       )}

                                       {activeLayer.videoTriggerMode === 'advance' && (
                                          <div className="space-y-3 p-3 bg-black/30 border border-white/5 rounded mt-2">
                                            <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Advance Settings</label>
                                            <div className="space-y-2">
                                              <label className="text-[8px] uppercase opacity-30">Unit</label>
                                              <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                                <button onClick={() => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoAdvanceUnit: 'frames' } : l))} className={`flex-1 py-1.5 text-[8px] uppercase transition-colors ${activeLayer.videoAdvanceUnit === 'frames' ? 'bg-white/20 text-white' : 'text-white/40 hover:bg-transparent'}`}>Frames</button>
                                                <button onClick={() => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoAdvanceUnit: 'seconds' } : l))} className={`flex-1 py-1.5 text-[8px] uppercase transition-colors ${activeLayer.videoAdvanceUnit === 'seconds' ? 'bg-white/20 text-white' : 'text-white/40 hover:bg-transparent'}`}>Seconds</button>
                                              </div>
                                            </div>
                                            <div className="space-y-2">
                                              <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Amount</span><span>{activeLayer.videoAdvanceAmount || 1}</span></div>
                                              <input type="range" min="1" max="60" step="1" value={activeLayer.videoAdvanceAmount || 1} onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoAdvanceAmount: parseFloat(e.target.value) } : l))} className="w-full accent-white h-1" />
                                            </div>
                                          </div>
                                       )}

                                       {activeLayer.videoTriggerMode === 'rewind' && (
                                          <div className="space-y-3 p-3 bg-black/30 border border-white/5 rounded mt-2">
                                            <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Boomerang Settings</label>
                                            <div className="space-y-2">
                                              <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Boomerang Speed</span><span>{activeLayer.videoRewindSpeed || 1}x</span></div>
                                              <input type="range" min="0.5" max="5" step="0.5" value={activeLayer.videoRewindSpeed || 1} onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoRewindSpeed: parseFloat(e.target.value) } : l))} className="w-full accent-white h-1" />
                                            </div>
                                          </div>
                                       )}

                                       {activeLayer.videoTriggerMode === 'frame-accumulator' && (() => {
                                          const setAcc = (patch: any) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, ...patch } : l));
                                          const iso = !!activeLayer.accumulateIsolateMotion;
                                          const stampNow = () => {
                                            const s = stutterStateRef.current[activeLayer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false };
                                            s.triggerStamp = true; stutterStateRef.current[activeLayer.id] = s;
                                          };
                                          return (
                                          <div className="space-y-3 p-3 bg-black/30 border border-white/5 rounded mt-2">
                                            <div className="flex items-center justify-between">
                                              <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Accumulator Settings</label>
                                              <button
                                                onClick={() => {
                                                  const s = stutterStateRef.current[activeLayer.id];
                                                  if (s) { s.clearBuffer = true; s.liveReady = false; }
                                                  const freeC = (c?: HTMLCanvasElement | null) => { if (c) { c.width = 0; c.height = 0; } };
                                                  (frameAccumulatorSnapshotsRef.current[activeLayer.id] || []).forEach(freeC);
                                                  (frameAccCutoutsRef.current[activeLayer.id] || []).forEach(freeC);
                                                  frameAccumulatorSnapshotsRef.current[activeLayer.id] = [];
                                                  frameAccCutoutsRef.current[activeLayer.id] = [];
                                                }}
                                                className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[8px] font-bold uppercase rounded transition-colors"
                                              >
                                                Clear Stamps
                                              </button>
                                            </div>

                                            <button
                                              onClick={() => setAcc({ accumulateIsolateMotion: !iso })}
                                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded border text-[9px] uppercase tracking-widest font-bold transition-colors ${iso ? 'bg-red-600 border-red-500 text-white' : 'bg-black/40 border-white/15 text-white/60 hover:text-white'}`}
                                            >
                                              <span>Isolate Motion</span>
                                              <span className="opacity-70">{iso ? 'ON' : 'OFF'}</span>
                                            </button>

                                            {iso ? (
                                              <>
                                                <p className="text-[8px] text-white/30 leading-relaxed">Keeps one clean background and stamps only the moving subject at each trigger. Set a background first (Auto works from moving footage — no empty shot needed).</p>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                  <button onClick={stampNow} className="px-2 py-1.5 rounded border border-white/15 hover:border-white/40 hover:text-white text-white/70 text-[8px] font-bold uppercase tracking-widest transition-colors">Stamp Now</button>
                                                  <button onClick={() => { const s = stutterStateRef.current[activeLayer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false }; s.setBg = true; stutterStateRef.current[activeLayer.id] = s; }} className="px-2 py-1.5 rounded border border-white/15 hover:border-white/40 hover:text-white text-white/70 text-[8px] font-bold uppercase tracking-widest transition-colors">Set BG (frame)</button>
                                                  <button onClick={() => { const s = stutterStateRef.current[activeLayer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false }; s.medianBg = { frames: [], need: 16 }; stutterStateRef.current[activeLayer.id] = s; }} className="col-span-2 px-2 py-1.5 rounded border border-white/15 hover:border-white/40 hover:text-white text-white/70 text-[8px] font-bold uppercase tracking-widest transition-colors">Set BG (auto · let the video play ~1s)</button>
                                                </div>
                                                <div className="space-y-2">
                                                  <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Sensitivity</span><span>{activeLayer.accumulateThreshold ?? 22}</span></div>
                                                  <input type="range" min="4" max="90" step="1" value={activeLayer.accumulateThreshold ?? 22} onChange={(e) => setAcc({ accumulateThreshold: parseInt(e.target.value) })} className="w-full accent-white h-1" />
                                                </div>
                                                <div className="space-y-2">
                                                  <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Edge Feather</span><span>{activeLayer.accumulateFeather ?? 3}px</span></div>
                                                  <input type="range" min="0" max="24" step="1" value={activeLayer.accumulateFeather ?? 3} onChange={(e) => setAcc({ accumulateFeather: parseInt(e.target.value) })} className="w-full accent-white h-1" />
                                                </div>
                                                <div className="space-y-2">
                                                  <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Stamp Strength</span><span>{Math.round((activeLayer.accumulateOpacity ?? 1) * 100)}%</span></div>
                                                  <input type="range" min="0.2" max="1" step="0.05" value={activeLayer.accumulateOpacity ?? 1} onChange={(e) => setAcc({ accumulateOpacity: parseFloat(e.target.value) })} className="w-full accent-white h-1" />
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                  {([['accumulateShowLive', 'Show Live'], ['accumulateSuppressShadows', 'Cut Shadows'], ['accumulateBgAdaptive', 'Adaptive BG']] as const).map(([key, lbl]) => (
                                                    <button key={key} onClick={() => setAcc({ [key]: !(activeLayer as any)[key] })} className={`px-2 py-1 rounded border text-[8px] uppercase tracking-widest transition-colors ${(activeLayer as any)[key] ? 'bg-red-600 border-red-500 text-white' : 'bg-black/40 border-white/15 text-white/50 hover:text-white'}`}>{lbl}</button>
                                                  ))}
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                <div className="space-y-2">
                                                  <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Stamp Opacity</span><span>{Math.round((activeLayer.accumulateOpacity ?? 0.6) * 100)}%</span></div>
                                                  <input type="range" min="0.1" max="1" step="0.05" value={activeLayer.accumulateOpacity ?? 0.6} onChange={(e) => setAcc({ accumulateOpacity: parseFloat(e.target.value) })} className="w-full accent-white h-1" />
                                                </div>
                                                <div className="space-y-2">
                                                  <label className="text-[8px] uppercase opacity-30 block">Blend Mode</label>
                                                  <CustomSelect
                                                    value={activeLayer.accumulateBlendMode || 'source-over'}
                                                    onChange={(v) => setAcc({ accumulateBlendMode: v as GlobalCompositeOperation })}
                                                    buttonClassName="w-full flex items-center justify-between gap-2 bg-black/60 border border-white/10 hover:border-white/25 rounded px-2 py-1 text-[9px] uppercase outline-none text-left text-white transition-colors"
                                                    options={[
                                                      { value: 'source-over', label: 'Normal (Source Over)' },
                                                      { value: 'screen', label: 'Screen (Lighten)' },
                                                      { value: 'lighten', label: 'Lighten' },
                                                      { value: 'overlay', label: 'Overlay' },
                                                      { value: 'difference', label: 'Difference' },
                                                      { value: 'color-dodge', label: 'Color Dodge' },
                                                    ]}
                                                  />
                                                </div>
                                              </>
                                            )}

                                            <div className="space-y-2">
                                              <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Max Stamps</span><span>{activeLayer.accumulateMaxFrames || 16}</span></div>
                                              <input type="range" min="2" max="32" step="1" value={activeLayer.accumulateMaxFrames || 16} onChange={(e) => setAcc({ accumulateMaxFrames: parseInt(e.target.value) })} className="w-full accent-white h-1" />
                                            </div>
                                          </div>
                                          );
                                       })()}
                                     </div>
                                   )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                );
             })()}
          </div>
        </div>
{/* Right Sidebar: Effect Config */}
        
        {/* Right panel re-open tab (when collapsed) */}
        {rightCollapsed && (
          <button
            onClick={() => setRightCollapsed(false)}
            className="hidden lg:flex items-center justify-center w-6 shrink-0 border-l border-white/5 bg-black/20 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
            title="Show Audio & Triggers panel"
          >
            <ChevronLeft size={14} />
          </button>
        )}
        {/* Right Sidebar (Audio + Triggers) */}
        <aside className={`border-l border-white/5 bg-black/20 hidden lg:flex flex-col shrink-0 transition-all duration-300 ${rightCollapsed ? 'lg:hidden' : 'w-72 xl:w-80'}`}>
           <div className="hidden lg:flex justify-start px-2 py-1.5 border-b border-white/5">
             <button onClick={() => setRightCollapsed(true)} className="p-1 text-white/30 hover:text-white transition-colors" title="Hide panel — more canvas">
               <PanelRightClose size={14} />
             </button>
           </div>
           <div className="flex-1 custom-scrollbar overflow-y-auto pb-20">

             <Section
               title="Audio"
               icon={<Activity size={16} />}
               isExpanded={rightSection === 'audio'}
               onToggle={() => setRightSection(rightSection === 'audio' ? null : 'audio')}
             >
               {audioSourcesPanel}
             </Section>

             <Section
               title="Triggers"
               icon={<Zap size={16} />}
               isExpanded={rightSection === 'triggers'}
               onToggle={() => setRightSection(rightSection === 'triggers' ? null : 'triggers')}
             >
             <div className="p-4 pt-2">
                {(() => {
                  if (selectedEffectId && selectedLayerForEffect) {
                    const layerTarget = layers.find(l => l.id === selectedLayerForEffect);
                    if (!layerTarget) return null;
                    const layerIdx = layers.findIndex(l => l.id === layerTarget.id) + 1;
                    
                    let isGenerativeParam = false;
                    let isThreeDParam = false;
                    let headerTitle = `Trigger: Layer ${layerIdx}`;
                    let mapping: any = layerTarget.mappings.find(m => m.id === selectedEffectId);

                    if (selectedEffectId.startsWith('transform-')) {
                       const rawName = selectedEffectId.replace('transform-', '');
                       const paramName = rawName === 'posX' ? 'Position X' : (rawName === 'posY' ? 'Position Y' : (rawName.charAt(0).toUpperCase() + rawName.slice(1)));
                       headerTitle = `Trigger: Layer ${layerIdx} - ${paramName}`;
                       mapping = {
                           id: selectedEffectId,
                           name: paramName,
                           active: true,
                           channels: Array.from({length: 16}, (_, i) => i),
                           noteStart: 0,
                           noteEnd: 127,
                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                           triggerBehavior: 'momentary'
                       };
                    } else if (selectedEffectId.startsWith('generative-')) {
                       const pName = selectedEffectId.replace('generative-', '');
                       const formattedName = pName.charAt(0).toUpperCase() + pName.slice(1);
                       headerTitle = `Trigger: Layer ${layerIdx} - ${formattedName}`;
                       mapping = layerTarget.generativeMappings?.find(m => m.id === pName) || {
                           id: pName,
                           name: formattedName,
                           active: true,
                           channels: Array.from({length: 16}, (_, i) => i),
                           noteStart: 0,
                           noteEnd: 127,
                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                           triggerBehavior: 'momentary'
                       };
                       isGenerativeParam = true;
                    } else if (selectedEffectId.startsWith('3d-')) {
                       const pName = selectedEffectId.replace('3d-', '');
                       const formattedName = (pName.charAt(0).toUpperCase() + pName.slice(1)).replace(/_/g, ' ');
                       headerTitle = `Trigger: Layer ${layerIdx} - ${formattedName}`;
                       mapping = layerTarget.threeDMappings?.find(m => m.id === pName) || {
                           id: pName,
                           name: formattedName,
                           active: true,
                           channels: Array.from({length: 16}, (_, i) => i),
                           noteStart: 0,
                           noteEnd: 127,
                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                           triggerBehavior: 'momentary'
                       };
                       isThreeDParam = true;
                    } else if (selectedEffectId.startsWith('effect-')) {
                       const parts = selectedEffectId.split('-');
                       const effectId = parts[1];
                       const pName = parts.slice(2).join('-');
                       const formattedName = pName.charAt(0).toUpperCase() + pName.slice(1);
                       headerTitle = `Trigger: Layer ${layerIdx} - ${formattedName}`;
                       mapping = layerTarget.mappings.find(m => m.id === effectId) || {
                           id: effectId,
                           name: formattedName,
                           active: true,
                           channels: Array.from({length: 16}, (_, i) => i),
                           noteStart: 0,
                           noteEnd: 127,
                           noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                           triggerBehavior: 'momentary'
                       };
                    } else if (!mapping && layerTarget.generativeMappings) {
                       mapping = layerTarget.generativeMappings.find(m => m.id === selectedEffectId);
                       if (mapping) isGenerativeParam = true;
                    }

                    if (!mapping) return null;

                    // Shared write path for the trigger config panel: routes to whichever
                    // family of mappings this parameter belongs to (generative / 3d / effect).
                    const patchMapping = (updater: (m: any) => any) => {
                      setLayers(prev => prev.map(l => {
                        if (l.id !== layerTarget.id) return l;
                        if (isGenerativeParam) return { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? updater(m) : m) };
                        if (isThreeDParam) return { ...l, threeDMappings: l.threeDMappings?.map(m => m.id === mapping.id ? updater(m) : m) };
                        return { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? updater(m) : m) };
                      }));
                    };
                    // Merge a partial patch into this mapping's audioMapping (generative/3d/effect param).
                    const patchAudio = (patch: Partial<AudioMapping>) => {
                      patchMapping((m: any) => ({ ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), ...patch } }));
                    };
                    const patchRhythm = (patch: any) => {
                      patchMapping((m: any) => ({ ...m, rhythmMapping: { ...(m.rhythmMapping || { enabled: true, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), ...patch } }));
                    };
                    const rm = mapping.rhythmMapping || { enabled: true, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false), noteSettings: DEFAULT_NOTE_SETTINGS };
                    const audioEngineType = mapping.audioMapping?.engine || 'level';

                    return (
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2 mb-2">{headerTitle}</h3>
                        <div className="space-y-6">
                          <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                            <button 
                              onClick={() => {
                                 patchMapping((m: any) => ({ ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } }));
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Audio
                            </button>
                            <button 
                              onClick={() => {
                                 patchMapping((m: any) => ({ ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } }));
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${!mapping.audioMapping?.enabled && !mapping.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              MIDI
                            </button>
                            <button 
                              onClick={() => {
                                 patchMapping((m: any) => ({ ...m, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: true }, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false } }));
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Rhythm
                            </button>
                            <button 
                              onClick={() => {
                                 // To turn off a parameter trigger, we just set its triggerActive to false
                                 if (isGenerativeParam) {
                                    setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerActive: { ...(l.generativeTriggerActive || {}), [mapping.id]: false } } : l));
                                 } else if (isThreeDParam) {
                                    setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, threeDTriggerActive: { ...(l.threeDTriggerActive || {}), [mapping.id]: false } } : l));
                                 } else {
                                    if (selectedEffectId?.startsWith('effect-') && selectedEffectId.split('-').length >= 3) {
                                       const paramName = selectedEffectId.split('-').slice(2).join('-');
                                       setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, triggerActive: { ...(m.triggerActive || {}), [paramName]: false } } : m) } : l));
                                    } else if (selectedEffectId?.startsWith('transform-')) {
                                       const paramName = selectedEffectId.split('-')[1];
                                       setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, transformTriggerActive: { ...(l.transformTriggerActive || {}), [paramName]: false } } : l));
                                    }
                                 }
                                 setSelectedEffectId(null);
                                 setSidebarTab('layers');
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest font-bold transition-colors text-white/40 hover:bg-red-500/10 hover:text-red-500`}
                              title="Turn Off Trigger"
                            >
                              OFF
                            </button>
                          </div>

                          {mapping.audioMapping?.enabled ? (
                            <div className="space-y-4 pt-2">
                               <label className="text-[10px] uppercase tracking-widest opacity-80 font-bold text-red-500">Audio Modulation</label>

                               <div className="space-y-1">
                                 <label className="text-[8px] uppercase tracking-widest opacity-40 block">Engine</label>
                                 <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                   <button
                                     onClick={() => patchAudio({ engine: 'level' })}
                                     className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${audioEngineType === 'level' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-white/5'}`}
                                     title="Follows how loud the chosen frequencies are"
                                   >Level</button>
                                   <button
                                     onClick={() => patchAudio({ engine: 'transient' })}
                                     className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${audioEngineType === 'transient' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-white/5'}`}
                                     title="Pops on every hit / beat in the chosen frequencies"
                                   >Hits</button>
                                 </div>
                               </div>

                               <div className="space-y-4 pt-2">
                                <div className={audioEngineType === 'level' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Target Stem</label>
                                    <CustomSelect
                                      value={mapping.audioMapping?.stemId || ''}
                                      onChange={(v) => patchAudio({ stemId: v })}
                                      options={[
                                        { value: '', label: 'Master Out' },
                                        ...audioStems.map(s => ({ value: s.id, label: s.name })),
                                        ...(mapping.audioMapping?.stemId === 'yt-audio' && !audioStems.some(s => s.id === 'yt-audio')
                                          ? [{ value: 'yt-audio', label: 'YouTube (connect in Audio panel)' }] : []),
                                      ]}
                                    />
                                  </div>
                                  {audioEngineType === 'level' && (
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Tracking Mode</label>
                                    <CustomSelect
                                      value={mapping.audioMapping?.mode || 'fast'}
                                      onChange={(v) => patchAudio({ mode: v as 'fast' | 'smooth' })}
                                      options={[
                                        { value: 'fast', label: 'Fast (Strobo)' },
                                        { value: 'smooth', label: 'Smooth (Blend)' },
                                      ]}
                                    />
                                  </div>
                                  )}
                                </div>

                                <AudioSpectrogram
                                  stemId={mapping.audioMapping?.stemId}
                                  freqRange={mapping.audioMapping?.freqRange || [20, 20000]}
                                  threshold={mapping.audioMapping?.threshold || 0.5}
                                  onRangeChange={(r) => patchAudio({ freqRange: r })}
                                  onThresholdChange={(t) => patchAudio({ threshold: t })}
                                />
                                <p className="text-[8px] opacity-30 -mt-2">Drag the red box to pick which frequencies to listen to{audioEngineType === 'level' ? '; the dashed line is the trigger level.' : ' (kick ≈ 40–120 Hz, snare ≈ 1.5–3 kHz).'}</p>

                                {audioEngineType === 'level' ? (
                                <>
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Smooth: {mapping.audioMapping?.smoothing?.toFixed(2) || '0.50'}</label>
                                    <input type="range" min="0" max="0.99" step="0.01" value={mapping.audioMapping?.smoothing || 0.5} onChange={e => patchAudio({ smoothing: parseFloat(e.target.value) })} className="w-full h-1"/>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Attack: {mapping.audioMapping?.attack || 10}</label>
                                    <input type="range" min="1" max="100" step="1" value={mapping.audioMapping?.attack || 10} onChange={e => patchAudio({ attack: parseInt(e.target.value) })} className="w-full h-1"/>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Release: {mapping.audioMapping?.release || 100}</label>
                                    <input type="range" min="10" max="1000" step="10" value={mapping.audioMapping?.release || 100} onChange={e => patchAudio({ release: parseInt(e.target.value) })} className="w-full h-1"/>
                                  </div>
                                </div>

                                <NoteSettingsConfigUI
                                  ns={mapping.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS}
                                  onUpdateNote={(field, val) => patchAudio({ noteSettings: { ...(mapping.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } })}
                                />
                                </>
                                ) : (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Sensitivity: {((mapping.audioMapping?.sensitivity ?? 0.6) * 100).toFixed(0)}%</label>
                                    <input type="range" min="0" max="1" step="0.01" value={mapping.audioMapping?.sensitivity ?? 0.6} onChange={e => patchAudio({ sensitivity: parseFloat(e.target.value) })} className="w-full h-1"/>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Decay: {mapping.audioMapping?.decayMs ?? 220}ms</label>
                                    <input type="range" min="40" max="1200" step="10" value={mapping.audioMapping?.decayMs ?? 220} onChange={e => patchAudio({ decayMs: parseInt(e.target.value) })} className="w-full h-1"/>
                                  </div>
                                </div>
                                )}
                               </div>
                            </div>
                          ) : mapping.rhythmMapping?.enabled ? (
                            <div className="space-y-4 pt-2">
                               <label className="text-[10px] uppercase tracking-widest opacity-80 font-bold text-red-500">Rhythm Trigger</label>
                               <div className="grid grid-cols-2 gap-4">
                                 <div className="flex flex-col gap-1">
                                   <label className="text-[8px] uppercase tracking-widest opacity-40">BPM</label>
                                   <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                     <button onClick={() => patchRhythm({ bpm: Math.max(20, (rm.bpm || 120) - 1) })} className="px-2 hover:bg-white/20 transition-colors">-</button>
                                     <input type="number" value={rm.bpm} onChange={e => patchRhythm({ bpm: parseInt(e.target.value) || 120 })} className="w-full bg-transparent p-1.5 text-[10px] text-center outline-none" min="20" max="300" />
                                     <button onClick={() => patchRhythm({ bpm: Math.min(300, (rm.bpm || 120) + 1) })} className="px-2 hover:bg-white/20 transition-colors">+</button>
                                   </div>
                                 </div>
                                 <div className="flex flex-col gap-1">
                                   <label className="text-[8px] uppercase tracking-widest opacity-40">Pattern</label>
                                   <CustomSelect value={rm.pattern} onChange={(v) => patchRhythm({ pattern: v })} options={RHYTHM_PATTERN_OPTIONS} />
                                 </div>
                               </div>
                               <StepSequencer
                                 bpm={rm.bpm}
                                 pattern={rm.pattern}
                                 customPattern={rm.customPattern}
                                 onCustomPatternChange={(newPattern: boolean[]) => patchRhythm({ customPattern: newPattern })}
                               />
                               <NoteSettingsConfigUI
                                 ns={rm.noteSettings || DEFAULT_NOTE_SETTINGS}
                                 onUpdateNote={(field, val) => patchRhythm({ noteSettings: { ...(rm.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } })}
                               />
                            </div>
                          ) : (
                            <MidiConfigUI
                              label={`${layerTarget.name}.${mapping.name}`}
                              mapping={mapping}
                              isLearnActive={midiLearnTarget?.layerId === layerTarget.id && midiLearnTarget?.effectId === mapping.id ? midiLearnTarget : false}
                              onToggleLearn={(field) => setMidiLearnTarget(prev => prev?.layerId === layerTarget.id && prev?.effectId === mapping.id && prev?.field === field ? null : { layerId: layerTarget.id, effectId: mapping.id, field })}
                              onUpdate={(field, val) => {
                                if (isGenerativeParam || isThreeDParam) {
                                  patchMapping((m: any) => ({ ...m, [field]: val }));
                                } else {
                                  updateMapping(layerTarget.id, mapping.id, field as keyof EffectMapping, val)
                                }
                              }}
                              onUpdateNote={(field, val) => {
                                if (isGenerativeParam || isThreeDParam) {
                                  patchMapping((m: any) => ({ ...m, noteSettings: { ...m.noteSettings, [field]: val } }));
                                } else {
                                  updateNoteSetting(layerTarget.id, mapping.id, field, val)
                                }
                              }}
                              onToggleChannel={(ch) => {
                                if (isGenerativeParam || isThreeDParam) {
                                  patchMapping((m: any) => ({ ...m, channels: m.channels.includes(ch) ? m.channels.filter((c: number) => c !== ch) : [...m.channels, ch] }));
                                } else {
                                  toggleChannel(layerTarget.id, mapping.id, ch)
                                }
                              }}
                              onSetAllChannels={() => {
                                if (isGenerativeParam || isThreeDParam) {
                                  patchMapping((m: any) => ({ ...m, channels: Array.from({length: 16}, (_, i) => i) }));
                                } else {
                                  setAllChannels(layerTarget.id, mapping.id)
                                }
                              }}
                              onSetNoChannels={() => {
                                if (isGenerativeParam || isThreeDParam) {
                                  patchMapping((m: any) => ({ ...m, channels: [] }));
                                } else {
                                  setNoChannels(layerTarget.id, mapping.id)
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  } else if (activeLayerId) {
                    const layerTarget = layers.find(l => l.id === activeLayerId);
                    if (!layerTarget) return null;
                    const patchLayerAudio = (patch: Partial<AudioMapping>) =>
                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), ...patch } } : l));
                    const layerAudioEngine = layerTarget.audioMapping?.engine || 'level';
                    return (
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2 mb-2">Layer Triggers</h3>
                        <div className="space-y-6">
                        <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                            <button 
                              onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, midiMode: true, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } } : l))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.midiMode && !layerTarget.audioMapping?.enabled && !layerTarget.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              MIDI
                            </button>
                            <button 
                              onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, midiMode: true, rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false }, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true } } : l))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.midiMode && layerTarget.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Audio
                            </button>
                            <button 
                              onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, midiMode: true, rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: true }, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false } } : l))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.midiMode && layerTarget.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Rhythm
                            </button>
                            <button 
                              onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, midiMode: false, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(l.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } } : l))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest font-bold transition-colors ${!layerTarget.midiMode ? 'text-red-500 bg-red-500/10' : 'text-white/40 hover:bg-transparent'}`}
                              title="Disable all triggers for this layer"
                            >
                              OFF
                            </button>
                          </div>

                          {!layerTarget.midiMode ? (
                              <div className="p-4 text-center mt-4">
                                <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">Layer triggers disabled</p>
                                <p className="text-[9px] opacity-20 mt-2">Activate MIDI, Audio, or Rhythm above to modulate layer visibility.</p>
                              </div>
                          ) : layerTarget.rhythmMapping?.enabled ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40">BPM</label>
                                    <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                      <button onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, bpm: Math.max(20, (l.rhythmMapping?.bpm || 120) - 1) } } : l))} className="px-2 hover:bg-white/20 transition-colors">-</button>
                                      <input type="number" value={layerTarget.rhythmMapping.bpm} onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, bpm: parseInt(e.target.value) || 120 } } : l))} className="w-full bg-transparent p-1.5 text-[10px] text-center outline-none" min="20" max="300" />
                                      <button onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, bpm: Math.min(300, (l.rhythmMapping?.bpm || 120) + 1) } } : l))} className="px-2 hover:bg-white/20 transition-colors">+</button>
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40">Pattern</label>
                                    <CustomSelect
                                      value={layerTarget.rhythmMapping.pattern}
                                      onChange={(v) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, pattern: v } } : l))}
                                      options={RHYTHM_PATTERN_OPTIONS}
                                    />
                                  </div>
                                </div>
                                <StepSequencer 
                                  bpm={layerTarget.rhythmMapping.bpm}
                                  pattern={layerTarget.rhythmMapping.pattern}
                                  customPattern={layerTarget.rhythmMapping.customPattern}
                                  onCustomPatternChange={(newPattern) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, customPattern: newPattern } } : l))}
                                />
                                <NoteSettingsConfigUI
                                  ns={layerTarget.rhythmMapping.noteSettings || DEFAULT_NOTE_SETTINGS}
                                  onUpdateNote={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, noteSettings: { ...(l.rhythmMapping!.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } } } : l))}
                                />
                            </div>
                          ) : layerTarget.audioMapping?.enabled ? (
                            <div className="space-y-4">
                               <label className="text-[10px] uppercase tracking-widest opacity-80 font-bold text-red-500">Audio Visibility Trigger</label>

                               <div className="space-y-1">
                                 <label className="text-[8px] uppercase tracking-widest opacity-40 block">Engine</label>
                                 <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                   <button
                                     onClick={() => patchLayerAudio({ engine: 'level' })}
                                     className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerAudioEngine === 'level' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-white/5'}`}
                                     title="Follows how loud the chosen frequencies are"
                                   >Level</button>
                                   <button
                                     onClick={() => patchLayerAudio({ engine: 'transient' })}
                                     className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerAudioEngine === 'transient' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-white/5'}`}
                                     title="Pops on every hit / beat in the chosen frequencies"
                                   >Hits</button>
                                 </div>
                               </div>

                               <div className={layerAudioEngine === 'level' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block mb-1">Target Stem</label>
                                  <CustomSelect
                                    value={layerTarget.audioMapping?.stemId || ''}
                                    onChange={(v) => patchLayerAudio({ stemId: v })}
                                    options={[
                                      { value: '', label: 'Master Out' },
                                      ...audioStems.map(s => ({ value: s.id, label: s.name })),
                                    ]}
                                  />
                                </div>
                                {layerAudioEngine === 'level' && (
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block mb-1">Tracking Mode</label>
                                  <CustomSelect
                                    value={layerTarget.audioMapping?.mode || 'fast'}
                                    onChange={(v) => patchLayerAudio({ mode: v as 'fast'|'smooth' })}
                                    options={[
                                      { value: 'fast', label: 'Fast (Strobo)' },
                                      { value: 'smooth', label: 'Smooth (Blend)' },
                                    ]}
                                  />
                                </div>
                                )}
                               </div>

                               <AudioSpectrogram
                                  stemId={layerTarget.audioMapping?.stemId}
                                  freqRange={layerTarget.audioMapping?.freqRange || [20, 20000]}
                                  threshold={layerTarget.audioMapping?.threshold || 0.5}
                                  onRangeChange={(r) => patchLayerAudio({ freqRange: r })}
                                  onThresholdChange={(t) => patchLayerAudio({ threshold: t })}
                               />
                               <p className="text-[8px] opacity-30 -mt-2">Drag the red box to pick which frequencies to listen to{layerAudioEngine === 'level' ? '; the dashed line is the trigger level.' : ' (kick ≈ 40–120 Hz, snare ≈ 1.5–3 kHz).'}</p>

                               {layerAudioEngine === 'level' ? (
                               <>
                               <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Smooth: {layerTarget.audioMapping?.smoothing?.toFixed(2) || '0.50'}</label>
                                  <input type="range" min="0" max="0.99" step="0.01" value={layerTarget.audioMapping?.smoothing || 0.5} onChange={e => patchLayerAudio({ smoothing: parseFloat(e.target.value) })} className="w-full h-1"/>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Attack (ms): {layerTarget.audioMapping?.attack || 10}</label>
                                  <input type="range" min="1" max="100" step="1" value={layerTarget.audioMapping?.attack || 10} onChange={e => patchLayerAudio({ attack: parseInt(e.target.value) })} className="w-full h-1"/>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Release (ms): {layerTarget.audioMapping?.release || 100}</label>
                                  <input type="range" min="10" max="1000" step="10" value={layerTarget.audioMapping?.release || 100} onChange={e => patchLayerAudio({ release: parseInt(e.target.value) })} className="w-full h-1"/>
                                </div>
                               </div>

                               <NoteSettingsConfigUI
                                  ns={layerTarget.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS}
                                  onUpdateNote={(field, val) => patchLayerAudio({ noteSettings: { ...(layerTarget.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } })}
                               />
                               </>
                               ) : (
                               <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Sensitivity: {((layerTarget.audioMapping?.sensitivity ?? 0.6) * 100).toFixed(0)}%</label>
                                  <input type="range" min="0" max="1" step="0.01" value={layerTarget.audioMapping?.sensitivity ?? 0.6} onChange={e => patchLayerAudio({ sensitivity: parseFloat(e.target.value) })} className="w-full h-1"/>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Decay: {layerTarget.audioMapping?.decayMs ?? 220}ms</label>
                                  <input type="range" min="40" max="1200" step="10" value={layerTarget.audioMapping?.decayMs ?? 220} onChange={e => patchLayerAudio({ decayMs: parseInt(e.target.value) })} className="w-full h-1"/>
                                </div>
                               </div>
                               )}
                            </div>
                          ) : (
                            <MidiConfigUI 
                              label="Layer Visibility Trigger"
                              mapping={layerTarget.triggerMapping || DEFAULT_TRIGGER_MAPPING}
                              isLearnActive={midiLearnTarget?.layerId === layerTarget.id && !midiLearnTarget?.effectId ? midiLearnTarget : false}
                              onToggleLearn={(field) => setMidiLearnTarget(prev => prev?.layerId === layerTarget.id && !prev?.effectId && prev?.field === field ? null : { layerId: layerTarget.id, field })}
                              onUpdate={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), [field]: val } } : l))}
                              onUpdateNote={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), noteSettings: { ...(l.triggerMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } } } : l))}
                              onToggleChannel={(ch) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), channels: (l.triggerMapping?.channels || []).includes(ch) ? (l.triggerMapping?.channels || []).filter(c => c !== ch) : [...(l.triggerMapping?.channels || []), ch] } } : l))}
                              onSetAllChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), channels: Array.from({ length: 16 }, (_, i) => i) } } : l))}
                              onSetNoChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...(l.triggerMapping || DEFAULT_TRIGGER_MAPPING), channels: [] } } : l))}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
             </div>
             </Section>

           </div>
        </aside>


      </div>

      {/* Footer Status Bar */}
      <footer className="p-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center px-4 sm:px-8 gap-4">
        <div className="flex flex-wrap gap-4 sm:gap-8 items-center justify-center">
          
          
        </div>
        <div className="text-[9px] uppercase tracking-[0.4em] opacity-20 text-center">
          Glitch Pulse // Version 1.2.25
        </div>
      </footer>



        {/* Asset Browser Modal */}
        <AnimatePresence>
          {showAssetBrowser && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAssetBrowser(false)}
                className="absolute inset-0 bg-black/80 "
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-5xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
              >
                <div className="p-6 border-b border-white/5 flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-light tracking-widest uppercase">Load Asset</h2>
                  </div>
                  <button onClick={() => setShowAssetBrowser(false)} className="p-2 hover:bg-transparent rounded-none transition-colors">
                    <X size={20} className="opacity-40 hover:opacity-100" />
                  </button>
                </div>
                
                <div className="p-6 space-y-6">
                   <div className="space-y-2">
                     <label className="text-[10px] uppercase tracking-widest opacity-40">Asset Type</label>
                     <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                        <button
                          onClick={() => {
                            if(assetBrowserLayerTarget) {
                               if (layers.find(l => l.id === assetBrowserLayerTarget)?.isLive) stopWebcam(assetBrowserLayerTarget);
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'video', isLive: false, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
                            }
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'video' && !layers.find(l => l.id === assetBrowserLayerTarget)?.isLive ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Video
                        </button>
                        <button
                          onClick={() => {
                            if(assetBrowserLayerTarget) {
                               if (layers.find(l => l.id === assetBrowserLayerTarget)?.isLive) stopWebcam(assetBrowserLayerTarget);
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'image', isLive: false, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
                            }
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'image' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Image
                        </button>
                        <button
                          onClick={() => {
                             setLayers(prev => prev.map(layer => {
                               if (layer.id !== assetBrowserLayerTarget) return layer;
                               const defaultGen = generativesRef.current.find(g => g.uuid === layer.generativeId) || generativesRef.current[0];
                               return {
                                 ...layer,
                                 type: 'generative',
                                 name: defaultGen ? defaultGen.description : 'Generative Script',
                                 src: null,
                                 missingMedia: false,
                                 generativeId: defaultGen?.uuid,
                                 mappings: [],
                                 generativeSettings: {},
                                 generativeMappings: [],
                                 generativeTriggerActive: {},
                                 generativeTriggerAmount: {}
                               };
                             }));
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'generative' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Generative
                        </button>
                        <button
                          onClick={() => {
                            if (assetBrowserLayerTarget) {
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'video', src: null, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
                               startWebcam(assetBrowserLayerTarget);
                            }
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.isLive ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Live Camera
                        </button>
                        <button
                          onClick={() => {
                            if (assetBrowserLayerTarget) {
                               const existing = layers.find(l => l.id === assetBrowserLayerTarget);
                               if (existing?.isLive) stopWebcam(assetBrowserLayerTarget);
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {
                                 ...layer, type: '3d', isLive: false, src: null,
                                 mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {},
                                 threeDSettings: layer.threeDSettings || {}, threeDMappings: layer.threeDMappings || [],
                                 threeDTriggerActive: layer.threeDTriggerActive || {}, threeDTriggerAmount: layer.threeDTriggerAmount || {},
                               } : layer));
                            }
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === '3d' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          3D Asset
                        </button>
                     </div>
                   </div>

                   {layers.find(l => l.id === assetBrowserLayerTarget)?.isLive && (
                       <div className="space-y-3 pt-4 border-t border-white/5">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Camera</label>
                          <CustomSelect
                             value={layers.find(l => l.id === assetBrowserLayerTarget)?.liveDeviceId || ''}
                             onChange={(v) => { if (assetBrowserLayerTarget) startWebcam(assetBrowserLayerTarget, v || undefined); }}
                             buttonClassName="w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 hover:border-white/25 rounded p-2 text-[10px] uppercase tracking-widest outline-none text-left text-white transition-colors"
                             options={[
                               { value: '', label: 'Default Camera' },
                               ...videoDevices.map(d => ({ value: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 5)}` })),
                             ]}
                          />
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-2 text-[10px] text-green-400 uppercase tracking-widest font-bold">
                              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Camera Live
                            </div>
                            <button
                              onClick={() => { if (assetBrowserLayerTarget) { stopWebcam(assetBrowserLayerTarget); setLayers(prev => prev.map(l => l.id === assetBrowserLayerTarget ? { ...l, isLive: false, name: 'Empty Layer' } : l)); } }}
                              className="px-3 py-1.5 rounded text-[9px] uppercase tracking-widest font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                            >
                              Stop Camera
                            </button>
                          </div>
                          {assetBrowserLayerTarget && webcamError[assetBrowserLayerTarget] && (
                            <p className="text-[9px] text-red-400 leading-relaxed">{webcamError[assetBrowserLayerTarget]}</p>
                          )}
                       </div>
                   )}
                   {layers.find(l => l.id === assetBrowserLayerTarget)?.type !== 'generative' && layers.find(l => l.id === assetBrowserLayerTarget)?.type !== '3d' && !layers.find(l => l.id === assetBrowserLayerTarget)?.isLive ? (
                       <div className="space-y-2 pt-4 border-t border-white/5">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Upload Media (Single or Multiple)</label>
                          <div className="relative group">
                            <input type="file" multiple accept="video/*,image/*" onChange={(e) => { if (e.target.files) importAssetFiles(Array.from(e.target.files), assetBrowserLayerTarget || undefined); setShowAssetBrowser(false); }} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                            <div className="border border-white/10 p-3 rounded-none bg-transparent group-hover:border border-white hover:bg-white hover:text-black transition-colors flex items-center justify-between">
                              <div className="flex items-center gap-3 min-w-0">
                                <Upload size={14} className="opacity-50" />
                                <span className="text-[10px] truncate">{layers.find(l => l.id === assetBrowserLayerTarget)?.src ? layers.find(l => l.id === assetBrowserLayerTarget)?.name : 'Click to Browse (Select one or multiple files)...'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="pt-3 border-t border-white/5">
                            <button
                              onClick={() => { if (assetBrowserLayerTarget) startWebcam(assetBrowserLayerTarget); }}
                              className="w-full flex items-center justify-center gap-2 p-2.5 border border-white/10 hover:border-white hover:bg-white hover:text-black transition-colors text-[10px] uppercase tracking-widest font-bold"
                            >
                              <Webcam size={14} />
                              Use Webcam Instead
                            </button>
                            {assetBrowserLayerTarget && webcamError[assetBrowserLayerTarget] && (
                              <p className="text-[9px] text-red-400 leading-relaxed mt-2">{webcamError[assetBrowserLayerTarget]}</p>
                            )}
                          </div>
                       </div>
                   ) : null}
                   {layers.find(l => l.id === assetBrowserLayerTarget)?.type === '3d' && (() => {
                       const target3d = layers.find(l => l.id === assetBrowserLayerTarget);
                       const isKinect = target3d?.threeDKind === 'kinect';
                       return (
                       <div className="space-y-4 pt-4 border-t border-white/5">
                          <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest opacity-40">Upload Mesh or Splat File</label>
                            <div className="relative group">
                              <input
                                type="file"
                                accept={THREE_D_ACCEPT}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file || !assetBrowserLayerTarget) return;
                                  const layerId = assetBrowserLayerTarget;
                                  const url = URL.createObjectURL(file);
                                  let kind = detectThreeDAssetKindByExt(file.name);
                                  const ext = (file.name.split('.').pop() || '').toLowerCase();
                                  if (kind === 'ply-ambiguous') kind = await detectPlyKind(file);
                                  if (kind === 'unsupported-sog') {
                                    setKinectError(prev => ({ ...prev, [layerId]: '.sog splat files are not supported yet — export as .splat or .ksplat instead.' }));
                                    return;
                                  }
                                  if (!kind) return;
                                  const splatFormat = kind === 'splat' ? (ext === 'ply' ? 'ply' : ext === 'ksplat' ? 'ksplat' : 'splat') : undefined;
                                  setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name: file.name, threeDKind: kind as any, threeDFormat: splatFormat as any, threeDSrc: url } : l));
                                  setShowAssetBrowser(false);
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                              />
                              <div className="border border-white/10 p-3 rounded-none bg-transparent group-hover:border border-white hover:bg-white hover:text-black transition-colors flex items-center justify-between">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Upload size={14} className="opacity-50" />
                                  <span className="text-[10px] truncate">{target3d?.threeDSrc && target3d.threeDKind !== 'kinect' ? target3d.name : 'Click to Browse (.glb, .gltf, .ply, .splat, .ksplat)...'}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2 pt-3 border-t border-white/5">
                            <label className="text-[10px] uppercase tracking-widest opacity-40">Kinect Point Cloud (Live)</label>
                            <input
                              type="text"
                              defaultValue={target3d?.threeDKinectUrl || 'ws://localhost:8787'}
                              onBlur={(e) => { if (assetBrowserLayerTarget) setLayers(prev => prev.map(l => l.id === assetBrowserLayerTarget ? { ...l, threeDKinectUrl: e.target.value } : l)); }}
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-[10px] font-mono outline-none focus:border-white/30"
                              placeholder="ws://localhost:8787"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (!assetBrowserLayerTarget) return;
                                  const layerId = assetBrowserLayerTarget;
                                  const url = target3d?.threeDKinectUrl || 'ws://localhost:8787';
                                  setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name: 'Kinect Point Cloud', threeDKind: 'kinect', threeDSrc: 'kinect', threeDKinectUrl: url } : l));
                                  threeDEngineRef.current?.connectKinect(layerId, url);
                                  setKinectError(prev => { const next = { ...prev }; delete next[layerId]; return next; });
                                }}
                                className="flex-1 py-2 rounded text-[9px] uppercase tracking-widest font-bold bg-black/40 border border-white/10 hover:border-white hover:bg-white hover:text-black transition-colors"
                              >
                                Connect
                              </button>
                              <button
                                onClick={() => {
                                  if (!assetBrowserLayerTarget) return;
                                  const layerId = assetBrowserLayerTarget;
                                  setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name: 'Kinect Point Cloud', threeDKind: 'kinect', threeDSrc: 'kinect' } : l));
                                  threeDEngineRef.current?.useSyntheticKinectDemo(layerId);
                                  setShowAssetBrowser(false);
                                }}
                                className="flex-1 py-2 rounded text-[9px] uppercase tracking-widest font-bold bg-black/40 border border-white/10 hover:border-white hover:bg-white hover:text-black transition-colors"
                              >
                                Use Synthetic Demo
                              </button>
                              {isKinect && (
                                <button
                                  onClick={() => { if (assetBrowserLayerTarget) threeDEngineRef.current?.disconnectKinect(assetBrowserLayerTarget); }}
                                  className="px-3 py-2 rounded text-[9px] uppercase tracking-widest font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                                >
                                  Disconnect
                                </button>
                              )}
                            </div>
                            {isKinect && (
                              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-bold">
                                <span className={`w-1.5 h-1.5 rounded-full ${threeDEngineRef.current?.isKinectLive(assetBrowserLayerTarget!) ? 'bg-green-500 animate-pulse' : 'bg-white/30'}`} />
                                <span className={threeDEngineRef.current?.isKinectLive(assetBrowserLayerTarget!) ? 'text-green-400' : 'text-white/40'}>
                                  {threeDEngineRef.current?.isKinectLive(assetBrowserLayerTarget!) ? 'Live' : 'Synthetic Demo'}
                                </span>
                              </div>
                            )}
                            {assetBrowserLayerTarget && (kinectError[assetBrowserLayerTarget] || threeDEngineRef.current?.getKinectError(assetBrowserLayerTarget)) && (
                              <p className="text-[9px] text-red-400 leading-relaxed">{kinectError[assetBrowserLayerTarget] || threeDEngineRef.current?.getKinectError(assetBrowserLayerTarget)}</p>
                            )}
                            <p className="text-[8px] uppercase tracking-widest text-white/30 leading-relaxed">
                              Run <code className="text-white/50">npm run kinect-demo-server</code> for a local test stream, or point this at your own Kinect bridge.
                            </p>
                          </div>
                       </div>
                       );
                   })()}
                   {layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'generative' && (
                       <div className="space-y-2 pt-4 border-t border-white/5">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Select Script</label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto max-h-[60vh] custom-scrollbar pb-10">
                             {generativesRef.current.map((g, gi, genArr) => {
                               const isActive = layers.find(l => l.id === assetBrowserLayerTarget)?.generativeId === g.uuid;
                               const getIconForGenerative = (uuid: string) => {
                                   if (uuid === 'dragon-text-mask-canvas-1') return '🐉';
                                   if (uuid === 'text-umbrella-canvas-1') return '☂️';
                                   if (uuid === 'text-water-drop-canvas-1') return '💧';
                                   if (uuid === 'text-boat-sea-canvas-1') return '⛵';
                                   if (uuid === 'brutalist-grid-1') return '🔲';
                                   if (uuid === 'ferrofluid-1') return '🪸';
                                   if (uuid === 'reaction-diffusion-canvas-1') return '🧫';
                                   if (uuid === 'stickiness-canvas-gen-1') return '🫧';
                                   if (uuid === 'vein-labyrinth-canvas-1') return '🌿';
                                   if (uuid === 'voronoi-cells-canvas-1') return '🕸️';
                                   if (uuid === 'contour-lines-canvas-1') return '🗺️';
                                   if (uuid === 'neon-labyrinth-canvas-1') return '👾';
                                   if (uuid === 'pixel-swarm-canvas-1') return '🛸';
                                   if (uuid === 'tetromino-cascade-canvas-1') return '🧱';
                                   if (uuid === 'hillscape-canvas-1') return '🍄';
                                   if (uuid === 'orbit-deflection-canvas-1') return '🎯';
                                   if (uuid === 'centipede-garden-canvas-1') return '🐛';
                                   if (uuid === 'orb-cluster-canvas-1') return '🍇';
                                   if (uuid === 'hatched-summit-canvas-1') return '🏔️';
                                   if (uuid === 'symbol-portrait-canvas-1') return '👤';
                                   if (uuid === 'ink-blot-canvas-1') return '🖋️';
                                   if (uuid === 'floating-gem-canvas-1') return '💎';
                                   if (uuid === 'confetti-scatter-canvas-1') return '🎊';
                                   if (uuid === 'woven-hex-blocks-1') return '⬡';
                                   if (uuid === 'circuit-routes-1') return '🔌';
                                   if (uuid === 'spiral-shells-1') return '🐚';
                                   if (uuid === 'polar-checker-1') return '🎯';
                                   if (uuid === 'truchet-arcs-1') return '🌀';
                                   if (uuid === 'voxel-cross-1') return '🧊';
                                   if (uuid === 'flow-strokes-1') return '💨';
                                   if (uuid === 'halftone-drift-1') return '⚫';
                                   if (uuid === 'delta-maze-1') return '🔺';
                                   if (uuid === 'thread-nest-1') return '🧶';
                                   if (uuid === 'iso-bar-wave-1') return '📊';
                                   if (uuid === 'bubble-spheres-1') return '🫧';
                                   if (uuid === 'dancing-cubes-canvas-1') return '🎲';
                                   return '✨';
                               };
                               const showCat = gi === 0 || genArr[gi - 1].category !== g.category;
                               return (
                                 <React.Fragment key={g.uuid}>
                                 {showCat && (
                                   <h4 className="col-span-full text-[10px] uppercase tracking-[0.3em] font-bold text-red-400/80 border-b border-white/10 pb-2 mt-2 first:mt-0">{g.category}</h4>
                                 )}
                                 <div
                                   className={`group p-4 rounded-none border transition-all flex flex-col justify-between ${isActive ? 'bg-red-600/5 border-red-500/20 opacity-50' : 'bg-transparent border-white/10 hover:border-white'}`}
                                 >
                                   <div>
                                     <div className="w-full aspect-square mb-4 border border-white/10 bg-black/60 flex flex-col items-center justify-center opacity-85 group-hover:opacity-100 transition-opacity relative overflow-hidden rounded-sm">
                                        <img
                                          src={`/previews/${g.uuid}.png`}
                                          alt={g.description}
                                          className="absolute inset-0 w-full h-full object-cover"
                                          onError={(e) => {
                                              e.currentTarget.style.display = 'none';
                                              if (e.currentTarget.nextElementSibling) {
                                                  (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'block';
                                              }
                                          }}
                                        />
                                        <span className="text-4xl mb-1 opacity-80 filter grayscale group-hover:grayscale-0 transition-all duration-500" style={{ display: 'none' }}>{getIconForGenerative(g.uuid)}</span>
                                     </div>
                                    <div className="flex items-center justify-between mb-2">
                                       <h3 className="text-xs font-bold uppercase tracking-widest">{g.description}</h3>
                                     </div>
                                     <p className="text-[10px] opacity-40 leading-relaxed mb-4">{g.parameters.length} Interactive Params</p>
                                   </div>
                                   <button 
                                     onClick={() => {
                                        const initColors: Record<string, string> = {};
                                        (g.elements || []).forEach(el => {
                                          initColors[el.id] = el.defaultColor;
                                        });
                                        const defaultPalId = g.defaultPaletteId || (
                                          (g.elements && g.elements.length <= 2)
                                            ? (g.color === 'white' ? 'monochrome_duo_white' : 'monochrome_duo')
                                            : 'acid_matrix'
                                        );

                                        setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? { 
                                          ...layer, 
                                          type: 'generative',
                                          name: g.description,
                                          src: null,
                                          missingMedia: false,
                                          generativeId: g.uuid, 
                                          mappings: [], 
                                          generativeSettings: {}, 
                                          generativeMappings: [
                                            {
                                              ...INITIAL_MAPPINGS[0],
                                              id: 'palette_cycle',
                                              name: 'Palette Cycle',
                                              description: 'Cycles colors across unlocked elements on each trigger hit.',
                                              active: true,
                                              manualActive: false,
                                              isMuted: false,
                                              isSoloed: false,
                                              channels: Array.from({length: 16}, (_, i) => i),
                                              noteStart: 0,
                                              noteEnd: 127,
                                              triggerBehavior: 'momentary' as any,
                                              noteSettings: { ...DEFAULT_NOTE_SETTINGS }
                                            }
                                          ], 
                                          generativeTriggerActive: { palette_cycle: false }, 
                                          generativeTriggerAmount: {},
                                          generativeColors: initColors,
                                          generativeLockedColors: {},
                                          generativeActivePaletteId: defaultPalId,
                                          generativeColorCycleIndex: 0
                                        } : layer));
                                        setShowAssetBrowser(false);
                                     }}
                                     className={`w-full py-2 rounded-none text-[10px] uppercase tracking-widest font-bold transition-all ${isActive ? 'bg-transparent text-red-500/50 cursor-not-allowed' : 'border border-white hover:bg-white hover:text-black hover:bg-red-600 hover:text-white'}`}
                                   >
                                     {isActive ? 'Active on Layer' : 'Load Script'}
                                   </button>
                                 </div>
                                 </React.Fragment>
                               );
                             })}
                          </div>
                       </div>
                   )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      {/* Effect Browser Modal */}
      <AnimatePresence>
        {showEffectBrowser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEffectBrowser(false)}
              className="absolute inset-0 bg-black/80 "
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-light tracking-widest uppercase">Visuals Library</h2>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">Select a module to add to your engine</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    
                    className="text-[9px] uppercase tracking-widest bg-transparent px-3 py-1.5 rounded hover:border border-white hover:bg-white hover:text-black transition-colors border border-white/5"
                  >
                    Add All
                  </button>
                  {/* Remove all */}
                  <button 
                    onClick={() => removeAllEffects(selectedLayerForEffect!)}
                    className="text-[9px] uppercase tracking-widest bg-red-500/10 text-red-500 px-3 py-1.5 rounded hover:bg-red-500/20 transition-colors border border-red-500/10"
                  >
                    Remove All
                  </button>
                  <button 
                    onClick={() => setShowEffectBrowser(false)}
                    className="p-2 hover:bg-transparent rounded-none transition-colors"
                  >
                    <X size={20} className="opacity-40 hover:opacity-100" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 custom-scrollbar">
                {ALL_EFFECTS.map(effect => {
                  const isAdded = layers.find(l => l.id === selectedLayerForEffect)?.mappings.find(m => m.id === effect.id);
                  const getIconForEffect = (id: string) => {
                    switch (id) {
                      case 'motion-symbols': return '🔣';
                      case 'invert': return '🌓';
                      case 'edges': return '⚡';
                      case 'pixelate': return '👾';
                      case 'rgb-shift': return '📺';
                      case 'hue-rotate': return '🌈';
                      case 'vhs': return '📼';
                      case 'dithering': return '🏁';
                      case 'ascii': return '📟';
                      case 'motion-detector': return '🎯';
                      case 'matrix': return '🟢';
                      case 'windows-98': return '🪟';
                      case 'glitch-box': return '🔲';
                      case 'long-exposure': return '💫';
                      default: return '✨';
                    }
                  };
                  return (
                    <div 
                      key={effect.id}
                      onClick={() => { if (!isAdded) addEffect(selectedLayerForEffect!, effect); }}
                      className={`group p-4 rounded-none border transition-all flex flex-col justify-between cursor-pointer ${isAdded ? 'bg-red-600/5 border-red-500/20 opacity-50 cursor-default' : 'bg-transparent border-white/10 hover:border-white hover:bg-white/5'}`}
                    >
                      <div>
                        <div className="w-full aspect-square mb-4 border border-white/10 bg-black/60 flex flex-col items-center justify-center opacity-85 group-hover:opacity-100 transition-opacity relative overflow-hidden rounded-sm">
                          <img 
                            src={`/effect-previews/${effect.id}.png`} 
                            alt={effect.name} 
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.nextElementSibling) {
                                    (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'block';
                                }
                            }}
                          />
                          <span className="text-4xl mb-1 opacity-80 filter grayscale group-hover:grayscale-0 transition-all duration-500" style={{ display: 'none' }}>{getIconForEffect(effect.id)}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold uppercase tracking-widest">{effect.name}</h3>
                          <HelpIcon text={effect.description} />
                        </div>
                        <p className="text-[10px] opacity-40 leading-relaxed line-clamp-2 mb-4">{effect.description}</p>
                      </div>
                      <button 
                        disabled={!!isAdded}
                        onClick={() => addEffect(selectedLayerForEffect!, effect)}
                        className={`w-full py-2 rounded-none text-[10px] uppercase tracking-widest font-bold transition-all ${isAdded ? 'bg-transparent text-red-500/50 cursor-not-allowed' : 'border border-white hover:bg-white hover:text-black hover:bg-red-600 hover:text-white'}`}
                      >
                        {isAdded ? 'Added to Engine' : 'Add Module'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    
      {/* Generative Browser Modal */}
      <AnimatePresence>
        {showGenerativeBrowser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowGenerativeBrowser(false)}
              className="absolute inset-0 bg-black/80 "
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-light tracking-widest uppercase">Generatives Library</h2>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">Select a code-driven visual</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShowGenerativeBrowser(false)}
                    className="p-2 hover:bg-transparent rounded-none transition-colors"
                  >
                    <X size={20} className="opacity-40 hover:opacity-100" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 custom-scrollbar">
                {generativesRef.current.map((g, gi, genArr) => {
                  const isActive = activeLayerId && layers.find(l => l.id === activeLayerId)?.generativeId === g.uuid;
                  const showCat = gi === 0 || genArr[gi - 1].category !== g.category;
                  return (
                    <React.Fragment key={g.uuid}>
                    {showCat && (
                      <h4 className="col-span-full text-[10px] uppercase tracking-[0.3em] font-bold text-red-400/80 border-b border-white/10 pb-2 mt-2 first:mt-0">{g.category}</h4>
                    )}
                    <div
                      className={`group p-4 rounded-none border transition-all flex flex-col justify-between ${isActive ? 'bg-red-600/5 border-red-500/20 opacity-50' : 'bg-transparent border-white/10 hover:border-white'}`}
                    >
                      <div>
                        <div className="w-full aspect-square mb-4 border border-white/5 bg-black/50 flex flex-col items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity relative overflow-hidden">
                            <img src={`/previews/${g.uuid}.png`} alt={g.description} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                            <span className="text-[10px] tracking-widest text-white/30 uppercase">Preview</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold uppercase tracking-widest">{g.description}</h3>
                        </div>
                        <p className="text-[10px] opacity-40 leading-relaxed mb-4">{g.parameters.length} Interactive Params</p>
                      </div>
                      <button 
                        disabled={!!isActive}
                        onClick={() => {
                          if (activeLayerId) {
                            const initColors: Record<string, string> = {};
                            (g.elements || []).forEach(el => {
                              initColors[el.id] = el.defaultColor;
                            });
                            const defaultPalId = g.defaultPaletteId || (
                              (g.elements && g.elements.length <= 2)
                                ? (g.color === 'white' ? 'monochrome_duo_white' : 'monochrome_duo')
                                : 'acid_matrix'
                            );

                            setLayers(prev => prev.map(l => {
                              if (l.id !== activeLayerId) return l;
                              const newBindings = l.ccBindings ? { ...l.ccBindings } : undefined;
                              if (newBindings) {
                                for (const key of Object.keys(newBindings)) {
                                  if (key.startsWith('generative-')) {
                                    delete newBindings[key];
                                  }
                                }
                              }
                              return { 
                                ...l, 
                                type: 'generative',
                                name: g.description,
                                src: null,
                                missingMedia: false,
                                generativeId: g.uuid, 
                                mappings: [], 
                                generativeSettings: {}, 
                                ccBindings: newBindings,
                                generativeMappings: [
                                  {
                                    ...INITIAL_MAPPINGS[0],
                                    id: 'palette_cycle',
                                    name: 'Palette Cycle',
                                    description: 'Cycles colors across unlocked elements on each trigger hit.',
                                    active: true,
                                    manualActive: false,
                                    isMuted: false,
                                    isSoloed: false,
                                    channels: Array.from({length: 16}, (_, i) => i),
                                    noteStart: 0,
                                    noteEnd: 127,
                                    triggerBehavior: 'momentary' as any,
                                    noteSettings: { ...DEFAULT_NOTE_SETTINGS }
                                  }
                                ], 
                                generativeTriggerActive: { palette_cycle: false }, 
                                generativeTriggerAmount: {},
                                generativeColors: initColors,
                                generativeLockedColors: {},
                                generativeActivePaletteId: defaultPalId,
                                generativeColorCycleIndex: 0
                              };
                            }));
                            setShowGenerativeBrowser(false);
                          }
                        }}
                        className={`w-full py-2 rounded-none text-[10px] uppercase tracking-widest font-bold transition-all ${isActive ? 'bg-transparent text-red-500/50 cursor-not-allowed' : 'border border-white hover:bg-white hover:text-black hover:bg-red-600 hover:text-white'}`}
                      >
                        {isActive ? 'Active on Layer' : 'Load Script'}
                      </button>
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Color Picker Popover */}
      <AnimatePresence>
        {activeColorPickerTarget && (() => {
          const currentActiveLayer = layers.find(l => l.id === activeLayerId);
          const activePalId = currentActiveLayer?.generativeActivePaletteId || 'acid_matrix';
          const activePal = BUILTIN_PALETTES.find(p => p.id === activePalId) || BUILTIN_PALETTES[0];

          return (
            <ColorPickerPopover
              color={activeColorPickerTarget.color}
              title={activeColorPickerTarget.elementName}
              anchorRect={activeColorPickerTarget.anchorRect}
              paletteColors={activePal?.colors || []}
              paletteName={activePal?.name}
              onChange={(newHex) => {
                setActiveColorPickerTarget(prev => prev ? { ...prev, color: newHex } : null);
                if (activeLayerId) {
                  setLayers(prev => prev.map(l => l.id === activeLayerId ? {
                    ...l,
                    generativeColors: { ...(l.generativeColors || {}), [activeColorPickerTarget.elementId]: newHex },
                    generativeLockedColors: { ...(l.generativeLockedColors || {}), [activeColorPickerTarget.elementId]: true }
                  } : l));
                }
              }}
              onClose={() => setActiveColorPickerTarget(null)}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, icon, children, isExpanded, onToggle }: { 
  title: string, 
  icon: React.ReactNode, 
  children: React.ReactNode, 
  isExpanded: boolean, 
  onToggle: () => void 
}) {
  return (
    <div className="border-b border-white/5">
      <button 
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-transparent transition-colors group"
      >
        <div className="flex items-center gap-3">
          <span className="opacity-40 group-hover:opacity-100 transition-opacity">{icon}</span>
          <span className="text-[11px] uppercase tracking-[0.2em] font-medium opacity-80">{title}</span>
        </div>
        <span className="opacity-20">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
