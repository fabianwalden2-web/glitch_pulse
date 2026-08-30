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
  Activity, 
  Layers, 
  ChevronDown, 
  ChevronRight,
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
  Mic
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { parseGeneratives, WebGLGenerativeRenderer, GenerativeDefinition, BUILTIN_PALETTES, GenerativeElement, ColorPalettePreset } from './lib/generatives';
import { engine, AudioStemNode } from './lib/audioEngine';
import { AudioSpectrogram } from './components/AudioSpectrogram';
import { Waves } from './components/Waves';
import { createNoise2D } from 'simplex-noise';
import { StepSequencer } from './components/StepSequencer';

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
}

interface Layer {
  id: string;
  name: string;
  type: 'video' | 'image' | 'generative';
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
  videoAdvanceUnit?: 'frames' | 'seconds';
  videoAdvanceAmount?: number;
  videoFrameRate?: number;
  videoRewindSpeed?: number;
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
  smoothing: 0.1,
  cooldownMs: 50,
  target: 'trigger'
};

const DEFAULT_TRIGGER_MAPPING: LayerTriggerMapping = {
  channels: Array.from({length: 16}, (_, i) => i),
  noteStart: 0,
  noteEnd: 127,
  noteSettings: { ...DEFAULT_NOTE_SETTINGS },
  activeUntil: null,
  velocity: 0,
  triggerBehavior: DEFAULT_TRIGGER_TYPE
};

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
        name: 'Background',
        type: forceGen ? 'generative' : 'video',
        generativeId: forceGen || undefined,
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
          }
        ],
        generativeTriggerActive: {
          palette_cycle: false
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
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [midiLearnTarget, setMidiLearnTarget] = useState<{layerId: string, effectId?: string, field: 'noteStart' | 'noteEnd'} | null>(null);
  const [isMidiLearnMode, setIsMidiLearnMode] = useState(false);
  const [ccLearnTarget, setCcLearnTarget] = useState<{layerId: string, paramId: string, min: number, max: number} | null>(null);
  const [expandedParamTrigger, setExpandedParamTrigger] = useState<string | null>(null);
  const [midiLogs, setMidiLogs] = useState<MidiLogEntry[]>([]);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'visual' | 'midi' | 'effects'>('visual');
  const [expandedSection, setExpandedSection] = useState<string | null>('layers');
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [selectedLayerForEffect, setSelectedLayerForEffect] = useState<string | null>(null);
  const [showEffectBrowser, setShowEffectBrowser] = useState(false);
  const [showAssetBrowser, setShowAssetBrowser] = useState(false);
  const [assetBrowserLayerTarget, setAssetBrowserLayerTarget] = useState<string | null>(null);
  const [showGenerativeBrowser, setShowGenerativeBrowser] = useState(false);
  const [status, setStatus] = useState('STANDBY');
  const [currentProjectFile, setCurrentProjectFile] = useState<string | null>(null);
  const [showRoutingGuide, setShowRoutingGuide] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [compositionLayout, setCompositionLayout] = useState<'stack' | 'split-vertical' | 'split-horizontal' | 'grid-2x2' | 'grid-3x3' | 'grid-4x4'>('stack');
  const [aspectRatioValue, setAspectRatioValue] = useState<number>(() => { const p = new URLSearchParams(window.location.search); return p.get('gen') ? 50 : 60; });
  const [resolutionScale, setResolutionScale] = useState(1.0); // Default to 100% Quality
  const [sidebarTab, setSidebarTab] = useState<'config' | 'triggers'>('config');
  const [isRecording, setIsRecording] = useState(false);
  const [isPanic, setIsPanic] = useState(false);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [isDraggingOverVisuals, setIsDraggingOverVisuals] = useState(false);
  const [isDraggingOverCanvas, setIsDraggingOverCanvas] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const masterPlaybackStartTimeRef = useRef<number>(performance.now());

  const resyncAllVideos = useCallback(() => {
    const nowTime = performance.now();
    masterPlaybackStartTimeRef.current = nowTime;
    layersRef.current.forEach(layer => {
      if (layer.type === 'video') {
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
  const generativesRef = useRef<GenerativeDefinition[]>(parseGeneratives());
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
  
  // Accumulation Mode Refs
  const accumulateCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const referenceFrameRef = useRef<Record<string, HTMLCanvasElement>>({});
  const frameAccumulatorSnapshotsRef = useRef<Record<string, HTMLCanvasElement[]>>({});
  const stutterStateRef = useRef<Record<string, { triggerStamp: boolean; clearBuffer: boolean; wasActive?: boolean; lastCaptureTime?: number }>>({});
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
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  useEffect(() => {
    if (!audioPlaying) return;
    const interval = setInterval(() => {
      setAudioTime(engine.getCurrentTime());
      setAudioDuration(engine.getMaxDuration());
    }, 100);
    return () => clearInterval(interval);
  }, [audioPlaying]);

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
    if (audioPlaying) { engine.stopAll(); setAudioPlaying(false); }
    else { engine.playAll(); setAudioPlaying(true); }
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

  useEffect(() => {
    requestMidiAccess();
    requestAudioDevices();
    navigator.mediaDevices?.addEventListener('devicechange', requestAudioDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', requestAudioDevices);
  }, [requestMidiAccess, requestAudioDevices]);

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
            const hasEffect = l.mappings?.some(m => m.id === midiLearnTarget.effectId);
            if (hasEffect) {
              return {
                ...l,
                mappings: l.mappings.map(m => m.id === midiLearnTarget.effectId ? {
                  ...m,
                  channels: m.channels || Array.from({length: 16}, (_, i) => i),
                  noteSettings: m.noteSettings || { ...DEFAULT_NOTE_SETTINGS },
                  [midiLearnTarget.field]: note
                } : m)
              };
            }
            return {
              ...l,
              generativeMappings: (l.generativeMappings || []).map(m => m.id === midiLearnTarget.effectId ? {
                ...m,
                channels: m.channels || Array.from({length: 16}, (_, i) => i),
                noteSettings: m.noteSettings || { ...DEFAULT_NOTE_SETTINGS },
                [midiLearnTarget.field]: note
              } : m)
            };
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
          const { intensity, flux } = engine.getBandIntensity(layer.audioMapping.stemId || '', layer.audioMapping.freqRange || [20, 20000]);
          
          if (mode === 'smooth') {
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
          const bpm = layer.rhythmMapping.bpm || 120;
          const beatTime = (now / 1000.0) * (bpm / 60.0);
          const pattern = layer.rhythmMapping.pattern;
          
          let isTriplet = pattern === 'Eighth-Note Triplets' || pattern === 'Quarter-Note Triplets';
          
          if (isTriplet) {
              let fraction = 0;
              if (pattern === 'Eighth-Note Triplets') fraction = (beatTime * 3.0) % 1.0;
              else fraction = (beatTime * 1.5) % 1.0;
              
              fraction = ((fraction % 1.0) + 1.0) % 1.0;
              
              const ns = layer.rhythmMapping.noteSettings;
              const fixedVel = ns?.useFixedVelocity ? (ns.fixedVelocity / 127) : 1.0;
              
              if (ns?.useFixedDuration) {
                  let holdBeats = 1.0;
                  if (ns.subdivision === '1/2') holdBeats = 2.0;
                  if (ns.subdivision === '1') holdBeats = 4.0;
                  if (ns.subdivision === '1/8') holdBeats = 0.5;
                  if (ns.subdivision === '1/16') holdBeats = 0.25;
                  
                  const tripletStepLen = pattern === 'Eighth-Note Triplets' ? (1/3) : (2/3);
                  const beatsElapsed = fraction * tripletStepLen;
                  rhythmTrackerValue = beatsElapsed < holdBeats ? fixedVel : 0.0;
              } else {
                  rhythmTrackerValue = Math.exp(-20.0 * fraction) * fixedVel;
              }
          } else {
              let activePattern = new Array(16).fill(false);
              if (pattern === 'Custom') {
                  activePattern = layer.rhythmMapping.customPattern || activePattern;
              } else {
                  switch (pattern) {
                      case '4-on-the-Floor':
                          activePattern[0] = activePattern[4] = activePattern[8] = activePattern[12] = true;
                          break;
                      case 'Backbeat':
                          activePattern[4] = activePattern[12] = true;
                          break;
                      case 'Off-Beat':
                          activePattern[2] = activePattern[6] = activePattern[10] = activePattern[14] = true;
                          break;
                      case 'Straight Eighths':
                          for (let i = 0; i < 16; i += 2) activePattern[i] = true;
                          break;
                      case 'Straight Sixteenths':
                          activePattern.fill(true);
                          break;
                      case 'The "One"':
                          activePattern[0] = true;
                          break;
                  }
              }

              const stepsElapsed = beatTime * 4;
              let currentStepIdx = Math.floor(stepsElapsed);
              let lastHitStepIdx = -1;
              
              for (let i = 0; i < 16; i++) {
                  const checkIdx = currentStepIdx - i;
                  if (checkIdx < 0) continue;
                  const patternIdx = checkIdx % 16;
                  if (activePattern[patternIdx]) {
                      lastHitStepIdx = checkIdx;
                      break;
                  }
              }

              if (lastHitStepIdx !== -1) {
                  const stepsSinceHit = stepsElapsed - lastHitStepIdx;
                  const beatsSinceHit = stepsSinceHit * 0.25;

                  const ns = layer.rhythmMapping.noteSettings;
                  const fixedVel = ns?.useFixedVelocity ? (ns.fixedVelocity / 127) : 1.0;
                  
                  if (ns?.useFixedDuration) {
                      let holdBeats = 1.0;
                      if (ns.subdivision === '1/2') holdBeats = 2.0;
                      if (ns.subdivision === '1') holdBeats = 4.0;
                      if (ns.subdivision === '1/8') holdBeats = 0.5;
                      if (ns.subdivision === '1/16') holdBeats = 0.25;
                      
                      rhythmTrackerValue = beatsSinceHit < holdBeats ? fixedVel : 0.0;
                  } else {
                      rhythmTrackerValue = Math.exp(-20.0 * beatsSinceHit) * fixedVel;
                  }
              } else {
                  rhythmTrackerValue = 0.0;
              }
          }

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
      if (layer.type !== 'generative' && !layer.src) return;

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
                          const { intensity } = engine.getBandIntensity(pMap.audioMapping.stemId || '', pMap.audioMapping.freqRange || [20, 20000]);
                          
                          if (mode === 'smooth') {
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
                  } else if (p.type === 'string' || p.type === 'boolean') {
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
                  const { intensity } = engine.getBandIntensity(palMapping.audioMapping.stemId || '', palMapping.audioMapping.freqRange || [20, 20000]);
                  if (intensity >= palMapping.audioMapping.threshold && (now - tracker.lastTriggerTime > 120)) {
                      tracker.value = 1.0;
                      tracker.lastTriggerTime = now;
                  }
                  tracker.value *= (palMapping.audioMapping.smoothing ?? 0.5);
                  palMagnitude = tracker.value;
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
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              
              // 1. Draw background
              const dragonBg = resolvedGenerativeColors['background'] || '#000000';
              if (!isTransparentColor(dragonBg)) {
                  ctx.fillStyle = dragonBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, font_size, dragon_size, chaos, thickness, text_content } = modifiedSettings;
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : (def.parameters.find(p=>p.name==='text_content')?.default || 'Text') as string;
              
              const chars = Array.from(textStr);
              if (chars.length === 0) chars.push(' ');
              
              // 2. Draw typography text
              ctx.fillStyle = resolvedGenerativeColors['dragon'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              ctx.font = `bold ${font_size}px sans-serif`;
              ctx.textBaseline = 'middle';
              
              const t = nowSec * speed;
              const scrollY = (nowSec * speed * 20) % (font_size * 1.5);
              
              const cx = targetW / 2;
              const cy = targetH / 2;
              const scale = Math.min(targetW, targetH) * 0.4 * (dragon_size || 1.0);
              const cVal = chaos ?? 1.0;
              const thVal = thickness ?? 1.0;
              
              // Cache character widths
              const charWidths = new Map<string, number>();
              const getCharWidth = (c: string) => {
                  if (!charWidths.has(c)) charWidths.set(c, ctx.measureText(c).width);
                  return charWidths.get(c)!;
              };
              
              // Helper to find closest point on dragon curve and push vector
              const { dir_x, dir_y, displacement } = modifiedSettings;
              const dxVal = dir_x ?? 0.0;
              const dyVal = dir_y ?? 1.0;
              const dispVal = displacement ?? 50.0;
              
              const getDragonDisplacement = (px: number, py: number) => {
                  let minDist = 999999;
                  let pushX = 0;
                  let pushY = 0;
                  
                  for(let i=0; i<=40; i+=2) {
                      const t_curr = t - i * 0.05;
                      const bx = cx + Math.sin(t_curr) * scale * 0.8 + Math.sin(t_curr*3.0)*scale*0.1 * cVal;
                      const by = cy + Math.cos(t_curr*0.8) * scale * 0.8 + Math.cos(t_curr*2.5)*scale*0.1 * cVal;
                      const r = Math.max(0.1, scale * 0.2 * (1.0 - i/40) * thVal + scale * 0.02 * Math.sin(i + t*5.0) * thVal);
                      
                      const dx = px - bx;
                      const dy = py - by;
                      const dist = Math.hypot(dx, dy) - r;
                      
                      if (dist < minDist) {
                          minDist = dist;
                          if (dist < dispVal) { // area of effect
                             const len = Math.hypot(dx, dy);
                             if (len > 0.001) {
                                 const pushStrength = dist < 0 ? (-dist + font_size * 0.5) : Math.max(0, (dispVal - dist) * (font_size / dispVal));
                                 pushX = (dx / len) * pushStrength;
                                 pushY = (dy / len) * pushStrength;
                             }
                          } else {
                             pushX = 0;
                             pushY = 0;
                          }
                      }
                  }
                  return { pushX, pushY };
              };
              
              const lineSpacing = font_size * 1.5;
              
              // Infinite smooth wrapping offsets
              let yShift = (t * dyVal * 20) % lineSpacing;
              if (yShift < 0) yShift += lineSpacing;
              let lineOffset = Math.floor((t * dyVal * 20) / lineSpacing);
              
              let xShift = (t * dxVal * 20) % font_size; // assumes monospace roughly
              if (xShift < 0) xShift += font_size;
              let xCharOffset = Math.floor((t * dxVal * 20) / font_size);
              
              let y = -font_size * 2 + yShift;
              let lineIdx = -lineOffset;
              
              // Force monospace for seamless horizontal wrapping
              ctx.font = `bold ${font_size}px monospace`;
              
              while (y < targetH + font_size * 2) {
                  let x = -font_size * 2 + xShift;
                  // Make sure base textIndex is positive for modulo
                  let baseTextIndex = lineIdx * 137 - xCharOffset;
                  while (baseTextIndex < 0) baseTextIndex += chars.length * 1000;
                  let textIndex = baseTextIndex;
                  
                  while (x < targetW + font_size * 2) {
                      const char = chars[textIndex % chars.length];
                      const cw = getCharWidth(char);
                      
                      const { pushX, pushY } = getDragonDisplacement(x + cw/2, y);
                      
                      ctx.fillText(char, x + pushX, y + pushY);
                      x += cw;
                      textIndex++;
                  }
                  y += lineSpacing;
                  lineIdx++;
              }
              
              ctx.globalCompositeOperation = 'difference';
              
              ctx.fillStyle = '#FFF';
              
              ctx.beginPath();
              for(let i=0; i<=40; i++) {
                  const fi = i;
                  const t_curr = t - fi * 0.05;
                  const bx = cx + Math.sin(t_curr) * scale * 0.8 + Math.sin(t_curr*3.0)*scale*0.1 * cVal;
                  const by = cy + Math.cos(t_curr*0.8) * scale * 0.8 + Math.cos(t_curr*2.5)*scale*0.1 * cVal;
                  const r = Math.max(0.1, scale * 0.2 * (1.0 - i/40) + scale * 0.02 * Math.sin(fi + t*5.0));
                  
                  if (i === 0) {
                      ctx.arc(bx, by, r, 0, Math.PI*2);
                  } else {
                      ctx.moveTo(bx + r, by);
                      ctx.arc(bx, by, r, 0, Math.PI*2);
                  }
              }
              ctx.fill();
              
              ctx.globalCompositeOperation = 'source-over';
              
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
              
              const iso = (x: number, y: number, z: number) => {
                  const angle = Math.PI / 6;
                  const cosA = Math.cos(angle);
                  const sinA = Math.sin(angle);
                  return {
                      x: targetW / 2 + (x - y) * cosA,
                      y: targetH / 2 + 70 + (x + y) * sinA * 0.65 - z
                  };
              };
              
              const getColorForHeight = (hNorm: number) => {
                  const tVal = Math.max(0.15, Math.min(1.0, hNorm));
                  const r = Math.round(bgRgb.r + (fgRgb.r - bgRgb.r) * tVal);
                  const g = Math.round(bgRgb.g + (fgRgb.g - bgRgb.g) * tVal);
                  const b = Math.round(bgRgb.b + (fgRgb.b - bgRgb.b) * tVal);
                  return `rgb(${r}, ${g}, ${b})`;
              };
              
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
              const sz = size ?? 130.0;
              const spc = spacing ?? 32.0;
              const mov = movement ?? 15.0;
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
              const gs = grid_size ?? 45.0;
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
              const gridSpan = Math.max(2, Math.floor(2 + mov * 0.08));
              
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
              
              // Draw connecting lines
              ctx.lineWidth = 2.0;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              
              for (let i = 1; i < pts.length; i++) {
                 const node = pts[i];
                 const parent = pts[node.parent];
                 ctx.strokeStyle = node.color;
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
              
              // Draw nodes and numbers
              const radius = gs * 0.36;
              ctx.font = 'bold 11px monospace';
              
              for (const p of pts) {
                 ctx.fillStyle = p.color;
                 ctx.beginPath();
                 ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
                 ctx.fill();
                 
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
                if (!dropsGlobal[layer.id]) {
                    dropsGlobal[layer.id] = { lastDropAction: 0, activeDrops: [], lastAutoSpawn: 0 };
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
                        const margin = 0.15;
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
                
                // Draw all drops
                for (const d of state.activeDrops) {
                    const age = nowSec - d.birthTime;
                    
                    let currentRadius = 0.0;
                    if (age < growthTime) {
                        const growthProgress = age / growthTime;
                        currentRadius = growthProgress * maxSize;
                    } else {
                        currentRadius = maxSize;
                    }
                    
                    let alpha = 1.0;
                    const fadeWindow = 0.35;
                    if (age > (totalLife - fadeWindow)) {
                        alpha = Math.max(0.0, (totalLife - age) / fadeWindow);
                    }
                    
                    if (currentRadius > 0.5 && alpha > 0.01) {
                        ctx.fillStyle = `rgba(${gcRgb.r}, ${gcRgb.g}, ${gcRgb.b}, ${alpha})`;
                        ctx.beginPath();
                        ctx.arc(d.x, d.y, currentRadius, 0, Math.PI * 2);
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

                // Sort back to front
                cubes.sort((a, b) => a.sortKey - b.sortKey);

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

                // Palette definitions with dynamic monochromatic lighting:
                // Left side in LIGHT (brightest), Top in SHADOW (medium-dark shadow), Right in SHADOW (deep dark shadow)
                const palettes = {
                    crimson: {
                        left: adjustHexBrightness(primaryHex, 0.08),   // IN LIGHT (Brightest highlight)
                        top: adjustHexBrightness(primaryHex, -0.40),    // IN SHADOW (Medium-dark shadow)
                        right: adjustHexBrightness(primaryHex, -0.62),  // IN SHADOW (Deep dark shadow)
                        border: adjustHexBrightness(primaryHex, 0.35)  // Crisp light pastel border
                    },
                    slate: {
                        left: adjustHexBrightness(secondaryHex, 0.08),   // IN LIGHT (Brightest highlight)
                        top: adjustHexBrightness(secondaryHex, -0.40),    // IN SHADOW (Medium-dark shadow)
                        right: adjustHexBrightness(secondaryHex, -0.62),  // IN SHADOW (Deep dark shadow)
                        border: adjustHexBrightness(secondaryHex, 0.35)  // Crisp light pastel border
                    }
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

                            // Relative horizontal offset from cube centroid on screen
                            const relX = item.faceCenterX - cubeCenterX;

                            // Lighting classification:
                            // Upper face (rnz > 0.4) -> IN SHADOW (Medium-dark shadow)
                            // Left face (relX < -0.5) -> IN LIGHT (Brightest highlight)
                            // Right face (relX >= -0.5) -> IN SHADOW (Deep dark shadow)
                            let faceColor = pal.top;
                            if (rnz > 0.4) {
                                faceColor = pal.top;
                            } else if (relX < -0.5) {
                                faceColor = pal.left;
                            } else {
                                faceColor = pal.right;
                            }

                            ctx.fillStyle = faceColor;
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

                element = canvas;
            } else if (def.uuid === 'cubes-matrix-3d-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const cmBg = resolvedGenerativeColors['background'] || '#ffffff';
              const cmFg = resolvedGenerativeColors['cubes'] || resolvedGenerativeColors['foreground'] || '#eb556b';
              const cmRgb = hexToRgb(cmFg);
              if (!isTransparentColor(cmBg)) {
                  ctx.fillStyle = cmBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, rotation, count, cube_size, spacing, size_randomization, dispersion, opacity } = modifiedSettings;
              const spd = speed ?? 1.0;
              const rotVal = rotation ?? 0.0;
              const n = Math.max(1, Math.min(6, Math.round(count ?? 3)));
              const baseSz = cube_size ?? 64.0;
              const spc = spacing ?? 55.0;
              const sizeRand = size_randomization ?? 0.5;
              const disp = dispersion ?? 90.0;
              const alpha = opacity ?? 0.70;
              const t = nowSec * spd;
              
              // Standard Isometric angles (35.264 deg pitch, 45 deg yaw)
              // Rotation parameter rotates around the vertical Y axis (default 0 = static isometric view)
              const rotX = 0.61548; // Math.atan(1 / Math.SQRT2)
              const rotY = (Math.PI / 4) + t * rotVal * 0.6;
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
              
              const baseCol = cmRgb;
              
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
                          
                          const stepDist = baseSz + spc;
                          const bx = (ix - half) * stepDist;
                          const by = (iy - half) * stepDist;
                          const bz = (iz - half) * stepDist;
                          
                          const sizeJitter = Math.sin(seed * 7.1) * 0.5 + 0.5;
                          const curRadius = (baseSz / 2) * (1.0 - sizeRand * 0.55 + sizeRand * sizeJitter * 1.1);
                          
                          // Dispersion: random axis direction (+X, -X, +Y, -Y, +Z, -Z)
                          const dirChoice = Math.floor((Math.sin(seed * 13.3) * 0.5 + 0.5) * 6);
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
                              
                              const r = Math.round(baseCol.r * lightFactor);
                              const g = Math.round(baseCol.g * lightFactor);
                              const b = Math.round(baseCol.b * lightFactor);
                              
                              const faceAlpha = isFront ? (alpha * 0.85) : (alpha * 0.35);
                              const strokeAlpha = isFront ? Math.min(1.0, alpha * 1.1) : (alpha * 0.4);
                              
                              const fillColor = `rgba(${r}, ${g}, ${b}, ${faceAlpha})`;
                              const strokeColor = `rgba(${cmRgb.r}, ${cmRgb.g}, ${cmRgb.b}, ${strokeAlpha})`;
                              
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
              const currentStep = Math.max(0.0, growth ?? 25.0);
              const brChance = branch_chance ?? 0.45;
              const splitRatio = split_mode ?? 2.5;
              const segSize = Math.max(10.0, Math.min(45.0, segment_size ?? 20.0));
              const meshAlpha = grid_mesh ?? 0.35;
              
              const cx = targetW / 2;
              const cy = targetH / 2;
              
              if (meshAlpha > 0.01) {
                  ctx.strokeStyle = isColorDark(veinBg) ? `rgba(255, 255, 255, ${0.065 * meshAlpha})` : `rgba(0, 0, 0, ${0.08 * meshAlpha})`;
                  ctx.lineWidth = 0.75;
                  const gridStep = segSize * 2.2;
                  const cols = Math.ceil(targetW / gridStep) + 2;
                  const rows = Math.ceil(targetH / gridStep) + 2;
                  
                  ctx.beginPath();
                  for (let r = 0; r <= rows; r++) {
                      for (let c = 0; c <= cols; c++) {
                          const px = (c - 1) * gridStep + ((r % 2) * (gridStep * 0.5));
                          const py = (r - 1) * (gridStep * 0.866);
                          
                          const pRight = px + gridStep;
                          const pDownLeft = px - gridStep * 0.5;
                          const pDownRight = px + gridStep * 0.5;
                          const pDownY = py + gridStep * 0.866;
                          
                          ctx.moveTo(px, py); ctx.lineTo(pRight, py);
                          ctx.moveTo(px, py); ctx.lineTo(pDownLeft, pDownY);
                          ctx.moveTo(px, py); ctx.lineTo(pDownRight, pDownY);
                      }
                  }
                  ctx.stroke();
              }
              
              interface MazeSegment {
                  x1: number;
                  y1: number;
                  x2: number;
                  y2: number;
                  generation: number;
                  isFork: boolean;
              }
              
              const segments: MazeSegment[] = [];
              const occupiedNodes = new Set<string>();
              const toNodeKey = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
              
              occupiedNodes.add(toNodeKey(cx, cy));
              
              interface FrontierTip {
                  x: number;
                  y: number;
                  angle: number;
                  generation: number;
                  straightStreak: number;
              }
              
              let currentTips: FrontierTip[] = [];
              
              // Root node: 3 seed branches outward from center (120 degrees apart)
              const rootDirections = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
              for (const a of rootDirections) {
                  const x2 = cx + Math.cos(a) * segSize;
                  const y2 = cy + Math.sin(a) * segSize;
                  segments.push({ x1: cx, y1: cy, x2, y2, generation: 0, isFork: false });
                  occupiedNodes.add(toNodeKey(x2, y2));
                  currentTips.push({ x: x2, y: y2, angle: a, generation: 1, straightStreak: 0 });
              }
              
              // 4. Synchronous Generative Expansion Loop
              const totalGenerations = 45;
              // Candidate relative turns on hexagonal grid (favoring 60-deg and 120-deg turns)
              const angleTurns = [-Math.PI / 3, Math.PI / 3, -(Math.PI * 2) / 3, (Math.PI * 2) / 3, 0];
              
              interface TurnOption {
                  angle: number;
                  relAngle: number;
                  candX: number;
                  candY: number;
              }

              for (let gen = 1; gen <= totalGenerations; gen++) {
                  const nextTips: FrontierTip[] = [];
                  
                  for (let i = 0; i < currentTips.length; i++) {
                      const tip = currentTips[i];
                      
                      // Deterministic hash based on tip coordinates and generation
                      const hashSeed = Math.sin(tip.x * 12.9898 + tip.y * 78.233 + gen * 37.719) * 43758.5453;
                      const randVal = hashSeed - Math.floor(hashSeed);
                      
                      // Check if this tip will fork into 2 branches
                      const shouldFork = randVal < (brChance * (splitRatio / 2.0));
                      
                      const validTurns: TurnOption[] = [];
                      for (const tAngle of angleTurns) {
                          const candidateAngle = tip.angle + tAngle;
                          const candX = tip.x + Math.cos(candidateAngle) * segSize;
                          const candY = tip.y + Math.sin(candidateAngle) * segSize;
                          
                          // Canvas boundary check
                          if (candX < 20 || candX > targetW - 20 || candY < 20 || candY > targetH - 20) continue;
                          
                          // Self-avoidance check
                          if (!occupiedNodes.has(toNodeKey(candX, candY))) {
                              validTurns.push({ angle: candidateAngle, relAngle: tAngle, candX, candY });
                          }
                      }
                      
                      if (validTurns.length === 0) continue; // Terminate growth at this tip
                      
                      if (shouldFork && validTurns.length >= 2) {
                          // Branching: choose two distinct turns that branch outward
                          const bending = validTurns.filter(t => Math.abs(t.relAngle) > 0.01);
                          const chosenA = (bending.length >= 2) ? bending[0] : validTurns[0];
                          const chosenB = (bending.length >= 2) ? bending[bending.length - 1] : validTurns[validTurns.length - 1];
                          
                          occupiedNodes.add(toNodeKey(chosenA.candX, chosenA.candY));
                          occupiedNodes.add(toNodeKey(chosenB.candX, chosenB.candY));
                          
                          segments.push({ x1: tip.x, y1: tip.y, x2: chosenA.candX, y2: chosenA.candY, generation: gen, isFork: true });
                          segments.push({ x1: tip.x, y1: tip.y, x2: chosenB.candX, y2: chosenB.candY, generation: gen, isFork: true });
                          
                          nextTips.push({ x: chosenA.candX, y: chosenA.candY, angle: chosenA.angle, generation: gen + 1, straightStreak: 0 });
                          nextTips.push({ x: chosenB.candX, y: chosenB.candY, angle: chosenB.angle, generation: gen + 1, straightStreak: 0 });
                      } else {
                          // Single elongation: strongly favor bending turns to eliminate long straight lines
                          const bending = validTurns.filter(t => Math.abs(t.relAngle) > 0.01);
                          let chosen: TurnOption;
                          if (bending.length > 0 && (tip.straightStreak >= 1 || randVal > 0.10)) {
                              const pickIdx = Math.floor(randVal * bending.length) % bending.length;
                              chosen = bending[pickIdx];
                          } else {
                              const pickIdx = Math.floor(randVal * validTurns.length) % validTurns.length;
                              chosen = validTurns[pickIdx];
                          }
                          
                          occupiedNodes.add(toNodeKey(chosen.candX, chosen.candY));
                          segments.push({ x1: tip.x, y1: tip.y, x2: chosen.candX, y2: chosen.candY, generation: gen, isFork: false });
                          
                          const isStraight = Math.abs(chosen.relAngle) < 0.01;
                          nextTips.push({
                              x: chosen.candX,
                              y: chosen.candY,
                              angle: chosen.angle,
                              generation: gen + 1,
                              straightStreak: isStraight ? (tip.straightStreak + 1) : 0
                          });
                      }
                  }
                  
                  currentTips = nextTips;
                  if (currentTips.length === 0) break;
              }
              
              const completedGens = Math.floor(currentStep);
              const stepFraction = currentStep - completedGens;
              
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              
              for (let i = 0; i < segments.length; i++) {
                  const seg = segments[i];
                  
                  if (seg.generation < completedGens) {
                      const normGen = seg.generation / (totalGenerations || 1);
                      const w = 3.6 * (1.0 - normGen * 0.62);
                      
                      ctx.strokeStyle = veinFg;
                      ctx.lineWidth = Math.max(1.1, w);
                      
                      ctx.beginPath();
                      ctx.moveTo(seg.x1, seg.y1);
                      ctx.lineTo(seg.x2, seg.y2);
                      ctx.stroke();
                  } else if (seg.generation === completedGens && stepFraction > 0.001) {
                      const drawX2 = seg.x1 + (seg.x2 - seg.x1) * stepFraction;
                      const drawY2 = seg.y1 + (seg.y2 - seg.y1) * stepFraction;
                      
                      const normGen = seg.generation / (totalGenerations || 1);
                      const w = 3.6 * (1.0 - normGen * 0.62);
                      
                      ctx.strokeStyle = veinFg;
                      ctx.lineWidth = Math.max(1.1, w);
                      
                      ctx.beginPath();
                      ctx.moveTo(seg.x1, seg.y1);
                      ctx.lineTo(drawX2, drawY2);
                      ctx.stroke();
                  }
              }
              
              // 5. Center Starting Seed Point
              ctx.fillStyle = veinFg;
              ctx.beginPath();
              ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
              ctx.fill();
              
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
              
              const scale = Math.min(targetW, targetH) * 0.28 * sz;
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
                 const f = 450 / (450 + p.z * scale);
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
              
              // Draw front wireframe edges
              ctx.strokeStyle = polyWire;
              ctx.lineWidth = 2.4;
              if (shd > 0.02) {
                 ctx.shadowColor = polyGlow;
                 ctx.shadowBlur = shd * 10;
              } else {
                 ctx.shadowBlur = 0;
              }
              
              for (const edge of edges) {
                 ctx.beginPath();
                 ctx.moveTo(projPts[edge[0]].x, projPts[edge[0]].y);
                 ctx.lineTo(projPts[edge[1]].x, projPts[edge[1]].y);
                 ctx.stroke();
              }
              ctx.shadowBlur = 0;
              
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
              const num = Math.floor(count ?? 40);
              const maxS = max_size ?? 100;
              const spd = speed ?? 1.0;
              const mov = movement ?? 30.0;
              const cha = chaos ?? 1.0;
              
              const t = nowSec * spd;
              
              const balls = [];
              for(let i=0; i<num; i++) {
                 const seed = i * 13.37;
                 const size = maxS * (0.2 + 0.8 * (Math.sin(seed*91.1)*0.5+0.5));
                 const baseOx = (Math.sin(seed*11.2) * 0.4) * targetW;
                 const baseOy = (Math.cos(seed*31.4) * 0.4) * targetH;
                 
                 // drift
                 const ox = baseOx + Math.sin(t*cha + seed) * mov;
                 const oy = baseOy + Math.cos(t*0.8*cha + seed) * mov;
                 
                 balls.push({ x: targetW/2 + ox, y: targetH/2 + oy, r: size, z: Math.sin(seed*44.4) });
              }
              
              balls.sort((a,b) => a.z - b.z);
              
              for(const b of balls) {
                 ctx.fillStyle = sbShade;
                 ctx.beginPath();
                 ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
                 ctx.fill();
                 
                 // sparkle cross
                 ctx.strokeStyle = sbSparkle;
                 ctx.lineWidth = 1.5;
                 const sx = b.x + b.r * 0.3;
                 const sy = b.y - b.r * 0.4;
                 ctx.beginPath();
                 ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
                 ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
                 ctx.stroke();
              }
              element = canvas;
          } else if (def.uuid === '3d-debris-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const debBg = resolvedGenerativeColors['background'] || '#000000';
              const debFg = resolvedGenerativeColors['debris'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              const debFgRgb = hexToRgb(debFg);
              if (!isTransparentColor(debBg)) {
                  ctx.fillStyle = debBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { count, scatter, speed, size } = modifiedSettings;
              const num = Math.floor(count ?? 80);
              const scat = scatter ?? 400;
              const spd = speed ?? 1.0;
              const sz = size ?? 1.0;
              const t = nowSec * spd;
              
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
                 const cy = yPos + Math.sin(t + seed)*50;
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
                        const r = Math.round(debFgRgb.r * factor);
                        const g = Math.round(debFgRgb.g * factor);
                        const b = Math.round(debFgRgb.b * factor);
                        ctx.fillStyle = `rgb(${r},${g},${b})`;
                        ctx.beginPath();
                        ctx.moveTo(p0.x, p0.y);
                        for(let i=1; i<face.length; i++) ctx.lineTo(projPts[face[i]].x, projPts[face[i]].y);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = debBg;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
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
                  canvas.width = targetW;
                  canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              const umbBg = resolvedGenerativeColors['background'] || '#000000';
              const umbFg = resolvedGenerativeColors['umbrella'] || resolvedGenerativeColors['foreground'] || '#ffffff';
              if (!isTransparentColor(umbBg)) {
                  ctx.fillStyle = umbBg;
                  ctx.fillRect(0, 0, targetW, targetH);
              }
              
              const { speed, font_size, rain_density, text_content, umbrella_size, umbrella_x, umbrella_y } = modifiedSettings;
              const fSize = font_size || 16.0;
              const spd = speed || 1.0;
              const dens = rain_density || 1.0;
              const uSize = umbrella_size || 1.0;
              const uX = umbrella_x ?? 0.0;
              const uY = umbrella_y ?? 0.0;
              
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : '01';
              const chars = Array.from(textStr);
              if (chars.length === 0) chars.push(' ');
              
              const cx = (targetW / 2) + (uX / 100.0) * (targetW / 2);
              const cy = (targetH / 2) + (uY / 100.0) * (targetH / 2);
              const r = Math.min(targetW, targetH) * 0.2 * uSize; // umbrella radius
              
              ctx.fillStyle = umbFg;
              ctx.font = `bold ${fSize}px monospace`;
              ctx.textBaseline = 'middle';
              
              const t = nowSec * spd;
              const lineSpacing = fSize * (3.0 - Math.min(2.9, dens));
              
              let x = 0;
              let colIdx = 0;
              
              while (x < targetW + lineSpacing) {
                  // offset column phase based on column index
                  const phase = Math.sin(colIdx * 13.37) * 1000;
                  const speedMultiplier = 1.0 + Math.abs(Math.sin(colIdx * 9.1)) * 1.5;
                  
                  const colSpeed = 50.0 * speedMultiplier;
                  let colYShift = (t * colSpeed + phase) % fSize;
                  if (colYShift < 0) colYShift += fSize;
                  let colYCharOffset = Math.floor((t * colSpeed + phase) / fSize);
                  
                  let startY = -fSize * 2 + colYShift;
                  let rowIdx = -colYCharOffset;
                  
                  let py = startY;
                  while (py < targetH + fSize * 2) {
                      const px = x;
                      
                      const dx = px - cx;
                      const dy = py - cy;
                      const dist = Math.hypot(dx, dy);
                      
                      let drawX = px;
                      let drawY = py;
                      let skip = false;
                      
                      // Canopy collision (top half bouncing)
                      if (dy < 0 && dist < r + fSize) {
                           const pushStrength = (r + fSize) - dist;
                           // push outward along normal
                           const nx = dx / dist;
                           const ny = dy / dist;
                           drawX = px + nx * pushStrength;
                           drawY = py + ny * pushStrength;
                      }
                      
                      // Dry zone shadow (under umbrella)
                      if (drawY >= cy) {
                          // if it is directly under the umbrella
                          if (Math.abs(drawX - cx) < r - fSize*0.5 && py > cy - r) {
                              skip = true;
                          }
                      }
                      
                      if (!skip) {
                          let baseTextIndex = colIdx * 137 + rowIdx;
                          while (baseTextIndex < 0) baseTextIndex += chars.length * 10000;
                          const char = chars[baseTextIndex % chars.length];
                          ctx.fillText(char, drawX, drawY);
                      }
                      
                      py += fSize;
                      rowIdx++;
                  }
                  x += lineSpacing;
                  colIdx++;
              }
              
              // Draw Umbrella
              ctx.strokeStyle = umbFg;
              ctx.lineWidth = 4 * uSize;
              ctx.beginPath();
              ctx.arc(cx, cy, r, Math.PI, 0); // canopy
              ctx.moveTo(cx - r, cy);
              ctx.lineTo(cx + r, cy); // canopy bottom
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx, cy + r * 1.2); // handle stick
              ctx.arc(cx - r*0.15, cy + r * 1.2, r*0.15, 0, Math.PI); // handle hook
              ctx.stroke();
              
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
          } else {
              if (webglRendererRef.current.canvas.width !== targetW || webglRendererRef.current.canvas.height !== targetH) {
                  webglRendererRef.current.resize(targetW, targetH);
              }
              webglRendererRef.current.render(def, nowSec, modifiedSettings, resolvedGenerativeColors);
              element = webglRendererRef.current.canvas;
          }
        }
      } else if (layer.type === 'video') {
         element = videoRefs.current[layer.id];
         if (element && isPlaying) {
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
                return base + amt * 100 * paramEnv;
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

          // Clear Canvas if requested
          if (stState.clearBuffer) {
            snapshots.length = 0;
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

          if (isTriggerDown && !stState.wasActive) {
            stState.triggerStamp = true;
          }
          stState.wasActive = isTriggerDown;

          // 2. On trigger stamp (rising edge of hit):
          if (stState.triggerStamp) {
            stState.triggerStamp = false;

            const snapCanvas = document.createElement('canvas');
            snapCanvas.width = targetW;
            snapCanvas.height = targetH;
            const snapCtx = snapCanvas.getContext('2d')!;
            snapCtx.drawImage(element, x, y, destW, destH);

            snapshots.push(snapCanvas);
            const maxSnapshots = Math.max(2, Math.min(32, layer.accumulateMaxFrames || 16));
            while (snapshots.length > maxSnapshots) {
              snapshots.shift();
            }
          }

          // 3. Render:
          ctx.clearRect(0, 0, targetW, targetH);

          // Draw the current live video frame as base
          ctx.drawImage(element, x, y, destW, destH);

          // Overlay accumulated past frames on top with transparency & blend mode
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

          if (effectDef?.parameters) {
             for (const p of effectDef.parameters) {
                const baseVal = modSettings[p.name] !== undefined ? modSettings[p.name] : (modSettings[p.id] !== undefined ? modSettings[p.id] : p.default);
                if (effect.triggerActive?.[p.name] || effect.triggerActive?.[p.id]) {
                   const triggerAmt = effect.triggerAmount?.[p.name] ?? effect.triggerAmount?.[p.id] ?? 0;
                   const range = (p.max - p.min);
                   let paramEnv = unifiedEnv;
                   
                   const paramKey = `effect-${layer.id}-${effect.id}-${p.name}`;
                   const state = triggerStatesRef.current[paramKey] || triggerStatesRef.current[`effect-${layer.id}-${effect.id}`];
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
          type: firstIsVideo ? 'video' : 'image',
          name: firstFile.name,
          videoTriggerMode: 'continuous' as const,
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
        <div className="w-8" /> {/* Spacer */}
      </header>

      {/* Main Header (Desktop/Tablet) */}
      <header className="hidden lg:flex relative z-10 px-4 py-3 justify-between items-center border-b border-white/5 gap-2">
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 min-w-0">
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

      <div className="flex-1 relative z-10 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar */}
        <aside className={`
          fixed inset-x-0 bottom-0 z-40 w-full bg-black/95  border-t border-white/10
          lg:relative lg:inset-auto lg:z-0 lg:w-72 xl:w-80 lg:border-t-0 lg:border-r lg:bg-black/20 lg:
          flex flex-col transition-all duration-500 ease-in-out
          ${showSidebar ? 'h-[70vh] lg:h-full translate-y-0' : 'h-0 lg:h-full translate-y-full lg:translate-y-0'}
        `}>
          <div className="flex-1 overflow-y-auto custom-scrollbar pb-20 lg:pb-0">
            <div className="lg:hidden p-4 flex justify-between items-center border-b border-white/5 sticky top-0 bg-black/80  z-10">
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Settings</span>
              <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-transparent rounded-none">
                <ChevronDown size={20} />
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
                            if (layers.length > 1) {
                              setLayers(prev => prev.filter(l => l.id !== layer.id));
                              if (activeLayerId === layer.id) setActiveLayerId(layers[0].id);
                            } else {
                              setLayers(prev => prev.map(l => l.id === layer.id ? { 
                                ...l, 
                                name: 'Empty Layer',
                                src: null, 
                                type: 'video', 
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
                          <select
                            value={layer.maskTargetId || ''}
                            onChange={(e) => {
                              const targetId = e.target.value || null;
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, maskTargetId: targetId } : l));
                            }}
                            className="w-full bg-black/70 border border-white/20 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-purple-500"
                          >
                            <option value="">None (Standard Layer)</option>
                            {layers.filter(l => l.id !== layer.id).map(other => {
                              const otherIdx = layers.findIndex(l => l.id === other.id) + 1;
                              return (
                                <option key={other.id} value={other.id}>
                                  Layer {otherIdx}: {other.name} ({other.type})
                                </option>
                              );
                            })}
                          </select>
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
                                    : (layer.src ? (layer.name.length > 20 ? layer.name.slice(0, 20) + '...' : layer.name) : 'Load Asset')}
                                </span>
                             </button>
                         </div>

                         {/* Blend Mode */}
                         <div className="space-y-1 border-b border-white/5 pb-4 mb-2">
                           <label className="text-[8px] uppercase tracking-widest opacity-40">Blend Mode</label>
                           <select 
                              value={layer.blendMode}
                              onChange={(e) => setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, blendMode: e.target.value as GlobalCompositeOperation } : l))}
                              className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[9px] uppercase tracking-widest outline-none"
                            >
                              <option value="source-over">Normal</option>
                              <option value="screen">Screen</option>
                              <option value="multiply">Multiply</option>
                              <option value="overlay">Overlay</option>
                              <option value="color-dodge">Color Dodge</option>
                              <option value="difference">Difference</option>
                              <option value="exclusion">Exclusion</option>
                              <option value="hard-light">Hard Light</option>
                              <option value="soft-light">Soft Light</option>
                           </select>
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
            title="Canvas Configuration" 
            icon={<Sliders size={16} />}
            isExpanded={expandedSection === 'composition'} 
            onToggle={() => setExpandedSection(expandedSection === 'composition' ? null : 'composition')}
          >
            <div className="space-y-4 pt-4 px-4 pb-4">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest opacity-40">Layout Mode</label>
                <div className="grid grid-cols-3 gap-1">
                  {['stack', 'split-vertical', 'split-horizontal', 'grid-2x2', 'grid-3x3', 'grid-4x4'].map((format: any) => (
                    <button
                      key={format}
                      onClick={() => setCompositionLayout(format)}
                      className={`p-2 text-[9px] uppercase tracking-wider rounded border transition-all truncate ${
                        compositionLayout === format 
                          ? 'bg-red-600 border-red-500 text-white' 
                          : 'bg-transparent border-white/5 text-white/40 hover:border border-white hover:bg-white hover:text-black'
                      }`}
                      title={format.replace('-', ' ')}
                    >
                      {format.replace('split-', '').replace('grid-', '')}
                    </button>
                  ))}
                </div>
              </div>
              
              <AspectRatioControl value={aspectRatioValue} onChange={setAspectRatioValue} />
            </div>
          </Section>

          <Section 
            title="Diagnostics & Performance" 
            icon={<Terminal size={16} />} 
            isExpanded={expandedSection === 'diagnostics'} 
            onToggle={() => setExpandedSection(expandedSection === 'diagnostics' ? null : 'diagnostics')}
          >
            <div className="p-4 space-y-6">
              {/* Performance Control */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">Performance</label>
                  <span className="text-[10px] font-mono text-red-500">{Math.round(resolutionScale * 100)}% Res</span>
                </div>
                <div className="space-y-1">
                  <input 
                    type="range" min="0.2" max="1.0" step="0.1" 
                    value={resolutionScale}
                    onChange={(e) => setResolutionScale(parseFloat(e.target.value))}
                    className="w-full accent-red-600 opacity-60 hover:opacity-100 transition-opacity"
                  />
                  <div className="flex justify-between text-[8px] uppercase opacity-30">
                    <span>Performance</span>
                    <span>Quality</span>
                  </div>
                </div>
              </div>
            </div>
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
                      }}
                      src={layer.src || undefined}
                      loop
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

              {layers.every(l => (!l.src && l.type !== 'generative')) && <Waves className="absolute inset-0 z-0 pointer-events-none" />}
              <canvas id="main-render-canvas" ref={canvasRef} className={`w-full h-full object-contain relative ${layers.every(l => (!l.src && l.type !== 'generative')) ? 'opacity-0' : ''} z-10`} />

              {!isPlaying && !layers.every(l => (!l.src && l.type !== 'generative')) && (
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
            </div>
          </div>
        </main>
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

                if (!activeLayer.src && !activeLayer.missingAsset && activeLayer.type !== 'generative') {
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

                const renderKnob = (p: any, m: any, layerTarget: any, isGen: boolean) => {
                   const paramId = isGen ? `generative-${p.name}` : `effect-${m.id}-${p.name}`;
                   
                   // Determine active state for triggers
                   const isTriggerActive = isGen ? 
                      !!layerTarget.generativeTriggerActive?.[p.name] : 
                      !!m.triggerActive?.[p.name];
                      
                   const triggerAmount = isGen ? 
                      (layerTarget.generativeTriggerAmount?.[p.name] ?? 0) : 
                      (m.triggerAmount?.[p.name] ?? 0);

                   
                   if (p.type === 'boolean') {
                      const currentVal = isGen ? 
                        (layerTarget.generativeSettings?.[p.name] ?? p.default) : 
                        (m.settings?.[p.name] ?? p.default);
                      const boolVal = Number(currentVal) > 0.5;
                      return (
                        <div key={p.name} className="flex flex-col items-center justify-center p-2 bg-transparent hover:bg-white/5 rounded transition-colors col-span-1 sm:col-span-2 relative h-[70px]">
                           <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider font-mono absolute top-2">{p.name.replace(/_/g, ' ')}</span>
                           <button 
                             onClick={() => {
                                 const newVal = boolVal ? 0.0 : 1.0;
                                 if (isGen) {
                                    setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: newVal } } : l));
                                 } else {
                                    setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, filterSettings: { ...(l.filterSettings || {}), [p.name]: newVal } } : l));
                                 }
                             }}
                             className={`mt-4 w-10 h-5 rounded-full relative transition-colors border border-white/20 ${boolVal ? 'bg-red-600' : 'bg-black/50'}`}
                           >
                              <div className={`absolute top-[1px] w-4 h-4 rounded-full bg-white transition-all ${boolVal ? 'left-[22px]' : 'left-[1px]'}`} />
                           </button>
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
                             <input 
                               type="number"
                               min="-100" max="100"
                               value={Math.round(triggerAmount * 100)}
                               onChange={(e) => {
                                  const val = Math.max(-100, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                                  if (isGen) {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerAmount: { ...(l.generativeTriggerAmount || {}), [p.name]: val } } : l));
                                  } else {
                                     setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(map => map.id === m.id ? { ...map, triggerAmount: { ...(map.triggerAmount || {}), [p.name]: val } } : map) } : l));
                                  }
                               }}
                               className="w-10 bg-transparent text-[10px] text-left outline-none text-red-400 font-bold cursor-ns-resize"
                               title="Modulation Amount (-100 to 100)"
                             />
                           ) : <div className="w-10" />}

                           {/* Right: Lightning Button */}
                           <button
                             onClick={() => {
                                const newState = !isTriggerActive;
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
                             value={isGen ? (layerTarget.generativeSettings?.[p.name] ?? (p.id ? layerTarget.generativeSettings?.[p.id] : undefined) ?? p.default) : ((p.id ? m.settings?.[p.id] : undefined) ?? m.settings?.[p.name] ?? p.default ?? p.min)}
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
                                if (isGen) {
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

                return (
                  <div className="space-y-6 pb-20">
                    {/* Generative Parameters */}
                    {activeLayer.type === 'generative' && activeLayer.generativeId && generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.parameters.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2">
                           Parameters: Layer {layerIdx} - {generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.description || 'Script'}
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                          {generativesRef.current.find(g => g.uuid === activeLayer.generativeId)?.parameters.map(p => {
                            const mapping = activeLayer.generativeMappings?.find(m => m.id === p.name) || { id: p.name, name: p.name, active: false };
                            return renderKnob(p, mapping, activeLayer, true);
                          })}
                        </div>

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
                      </div>
                    )}

                    {/* Effect Parameters */}
                    {activeLayer.mappings.map(m => {
                      const effectDef = ALL_EFFECTS.find(e => e.id === m.id);
                      if (!effectDef) return null;
                      return (
                        <div key={m.id} className="space-y-4">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2">
                             Parameters: Layer {layerIdx} - {effectDef.name}
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                             {effectDef.parameters.map(p => renderKnob(p, m, activeLayer, false))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Image / Video Transform */}
                    {activeLayer.type !== 'generative' && activeLayer.src && (
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
                                       <input 
                                         type="number"
                                         min="-100" max="100"
                                         value={Math.round(triggerAmount * 100)}
                                         onChange={(e) => {
                                            const val = Math.max(-100, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                                            setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, transformTriggerAmount: { ...(l.transformTriggerAmount || {}), [paramName]: val } } : l));
                                         }}
                                         className="w-10 bg-transparent text-[10px] text-left outline-none text-red-400 font-bold cursor-ns-resize"
                                         title="Modulation Amount (-100 to 100)"
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
                              {activeLayer.type === 'video' && renderTransformKnob('speed', 0, 2, 1, 'Speed')}
                            </div>
                          );
                        })()}

                        {activeLayer.type === 'video' && activeLayer.src && (
                          <div className="space-y-6 pt-6 mt-6 border-t border-white/10">
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 pb-2 border-b border-white/5">Video Modes</h3>
                            {(() => {
                              const isLayerTriggerActive = !!activeLayer.midiMode || !!activeLayer.audioMapping?.enabled || !!activeLayer.rhythmMapping?.enabled;
                              return (
                                <div className={`grid grid-cols-1 ${isLayerTriggerActive ? 'lg:grid-cols-2' : ''} gap-8`}>
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

                                   {isLayerTriggerActive && (
                                     <div className="space-y-4">
                                       <label className="text-[10px] uppercase tracking-widest opacity-40">Trigger Mode</label>
                                       <select 
                                         value={activeLayer.videoTriggerMode || 'continuous'}
                                         onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoTriggerMode: e.target.value as any } : l))}
                                         className="w-full bg-black/40 border border-white/10 rounded p-2 text-[10px] uppercase tracking-widest outline-none"
                                       >
                                         <option value="continuous">Continuous Playback</option>
                                         <option value="restart">Restart on Trigger</option>
                                         <option value="advance">Frame Advance</option>
                                         <option value="rewind">Boomerang</option>
                                         <option value="frame-accumulator">Frame Accumulator</option>
                                       </select>

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

                                       {activeLayer.videoTriggerMode === 'frame-accumulator' && (
                                          <div className="space-y-3 p-3 bg-black/30 border border-white/5 rounded mt-2">
                                            <div className="flex items-center justify-between">
                                              <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Accumulator Settings</label>
                                              <button 
                                                onClick={() => {
                                                  if (stutterStateRef.current[activeLayer.id]) {
                                                    stutterStateRef.current[activeLayer.id].clearBuffer = true;
                                                  }
                                                  if (frameAccumulatorSnapshotsRef.current[activeLayer.id]) {
                                                    frameAccumulatorSnapshotsRef.current[activeLayer.id] = [];
                                                  }
                                                }}
                                                className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[8px] font-bold uppercase rounded transition-colors"
                                              >
                                                Clear Canvas
                                              </button>
                                            </div>
                                            <div className="space-y-2">
                                              <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Stamp Opacity</span><span>{Math.round((activeLayer.accumulateOpacity ?? 0.6) * 100)}%</span></div>
                                              <input type="range" min="0.1" max="1" step="0.05" value={activeLayer.accumulateOpacity ?? 0.6} onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, accumulateOpacity: parseFloat(e.target.value) } : l))} className="w-full accent-white h-1" />
                                            </div>
                                            <div className="space-y-2">
                                              <label className="text-[8px] uppercase opacity-30 block">Blend Mode</label>
                                              <select
                                                value={activeLayer.accumulateBlendMode || 'source-over'}
                                                onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, accumulateBlendMode: e.target.value as GlobalCompositeOperation } : l))}
                                                className="w-full bg-black/60 border border-white/10 rounded px-2 py-1 text-[9px] uppercase text-white outline-none"
                                              >
                                                <option value="source-over">Normal (Source Over)</option>
                                                <option value="screen">Screen (Lighten)</option>
                                                <option value="lighten">Lighten</option>
                                                <option value="overlay">Overlay</option>
                                                <option value="difference">Difference</option>
                                                <option value="color-dodge">Color Dodge</option>
                                              </select>
                                            </div>
                                            <div className="space-y-2">
                                              <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Max Stamped Frames</span><span>{activeLayer.accumulateMaxFrames || 16}</span></div>
                                              <input type="range" min="2" max="32" step="1" value={activeLayer.accumulateMaxFrames || 16} onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, accumulateMaxFrames: parseInt(e.target.value) } : l))} className="w-full accent-white h-1" />
                                            </div>
                                          </div>
                                       )}
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
        
        {/* Right Sidebar (Triggers & Inputs) */}
        <aside className="w-72 lg:w-72 xl:w-80 border-l border-white/5 bg-black/20 hidden lg:flex flex-col shrink-0">
           <div className="p-4 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-widest font-bold opacity-80 shrink-0">
             Triggers & Routing
           </div>
           <div className="flex-1 custom-scrollbar overflow-y-auto pb-20">
             <Section 
            title="Audio Input" 
            icon={<Activity size={16} />} 
            isExpanded={expandedSection === 'audio-input'} 
            onToggle={() => setExpandedSection(expandedSection === 'audio-input' ? null : 'audio-input')}
          >
            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <label className="flex-1 border border-white/10 p-3 rounded-none bg-transparent hover:border border-white hover:bg-white hover:text-black transition-colors flex items-center justify-center gap-2 cursor-pointer">
                  <Upload size={14} className="opacity-50" />
                  <span className="text-[10px] uppercase tracking-widest font-bold">Load Stems</span>
                  <input type="file" multiple accept="audio/*" onChange={handleAddAudioStem} className="hidden" />
                </label>
                <button 
                  onClick={async () => {
                    const id = 'live-mic';
                    await engine.addLiveInput(id, 'Live Mic/Line', selectedAudioDevice || undefined);
                    setAudioStems(prev => {
                      const filtered = prev.filter(s => s.id !== id);
                      return [...filtered, { id, name: 'Live Mic/Line', fileUrl: 'live', isMuted: false, isSoloed: false }];
                    });
                  }}
                  className="px-4 border border-white/10 rounded-none bg-transparent hover:border-white hover:bg-white hover:text-black transition-colors flex items-center justify-center"
                  title="Use Live Microphone / Audio Interface"
                >
                  <Mic size={14} />
                </button>
                <button 
                  onClick={toggleAudioPlay}
                  className={`px-4 rounded-none flex items-center justify-center transition-colors ${audioPlaying ? 'bg-red-600 text-white' : 'border border-white hover:bg-white hover:text-black hover:bg-white/20'}`}
                >
                  {audioPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </div>

              <div className="space-y-1 mb-2">
                <div className="flex justify-between items-center">
                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Live Input Device</label>
                </div>
                <select 
                  className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[9px] outline-none font-mono"
                  value={selectedAudioDevice}
                  onChange={(e) => setSelectedAudioDevice(e.target.value)}
                >
                  <option value="">Default Microphone</option>
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,5)}`}</option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                {audioDuration > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-mono opacity-50">{formatTime(audioTime)}</span>
                    <input 
                      type="range" 
                      min="0" 
                      max={audioDuration} 
                      step="0.1" 
                      value={audioTime} 
                      onChange={handleSeek}
                      className="flex-1 accent-red-600 h-1 border border-white hover:bg-white hover:text-black rounded-none appearance-none cursor-pointer" 
                    />
                    <span className="text-[9px] font-mono opacity-50">{formatTime(audioDuration)}</span>
                  </div>
                )}
                {audioStems.length === 0 ? (
                   <div className="text-[9px] text-center opacity-40 uppercase tracking-widest py-4 border border-white/5 border-dashed rounded">No AUDIO STEMS</div>
                ) : audioStems.map(stem => (
                  <div key={stem.id} className="flex items-center justify-between p-2 rounded bg-transparent border border-white/5 text-[10px]">
                     <span className="truncate w-16 font-mono uppercase text-[9px] opacity-80">{stem.name}</span>
                     <div className="flex items-center gap-1">
                        <button 
                          onClick={() => toggleStemMute(stem.id)}
                          className={`px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider transition-colors ${stem.isMuted ? 'bg-red-500/20 text-red-500 font-bold' : 'bg-transparent opacity-40 hover:opacity-100'}`}
                        >M</button>
                        <button 
                          onClick={() => toggleStemSolo(stem.id)}
                          className={`px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider transition-colors ${stem.isSoloed ? 'bg-white/20 text-white font-bold' : 'bg-transparent opacity-40 hover:opacity-100'}`}
                        >S</button>
                        <button onClick={() => removeAudioStem(stem.id)} className="opacity-40 hover:opacity-100 hover:text-red-400 p-1 ml-1"><X size={10}/></button>
                     </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

            <Section 
            title="MIDI Input" 
            icon={<Music size={16} />} 
            isExpanded={expandedSection === 'midi-input'} 
            onToggle={() => setExpandedSection(expandedSection === 'midi-input' ? null : 'midi-input')}
          >
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">MIDI Device</label>
                  <button 
                    onClick={requestMidiAccess}
                    className="p-1 hover:border border-white hover:bg-white hover:text-black rounded transition-colors opacity-40 hover:opacity-100"
                    title="Refresh MIDI Devices"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedDeviceIds(midiDevices.map(d => d.id))} className="flex-1 text-[8px] uppercase tracking-widest bg-transparent py-1 rounded hover:border border-white hover:bg-white hover:text-black transition-colors">Select All</button>
                    <button onClick={() => setSelectedDeviceIds([])} className="flex-1 text-[8px] uppercase tracking-widest bg-transparent py-1 rounded hover:border border-white hover:bg-white hover:text-black transition-colors">None</button>
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {midiDevices.map(d => (
                      <label key={d.id} className="flex items-center gap-2 text-xs opacity-80 cursor-pointer p-1 hover:bg-transparent rounded">
                        <input 
                          type="checkbox" 
                          checked={selectedDeviceIds.includes(d.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDeviceIds(prev => [...prev, d.id]);
                            else setSelectedDeviceIds(prev => prev.filter(id => id !== d.id));
                          }}
                          className="accent-red-600"
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                  {midiDevices.length === 0 && <div className="text-xs opacity-40 italic py-2">No Devices Found</div>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] uppercase tracking-widest opacity-40">MIDI Logs</label>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowRoutingGuide(!showRoutingGuide)}
                      className="text-[8px] uppercase tracking-widest text-red-500 hover:underline"
                    >
                      {showRoutingGuide ? 'Close Guide' : 'Routing Help'}
                    </button>
                  </div>
                </div>

                {showRoutingGuide && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="p-3 bg-red-500/10 border border-red-500/20 rounded-none text-[10px] text-red-200/80 font-mono leading-relaxed space-y-2 overflow-hidden"
                  >
                    <p className="font-bold text-red-400">Maschine Software Routing:</p>
                    <ol className="list-decimal list-inside space-y-1 opacity-90">
                      <li>Enable <span className="text-white">IAC Driver</span> (Mac) or <span className="text-white">loopMIDI</span> (Win).</li>
                      <li>In Maschine: <span className="text-white">Channel &gt; Output &gt; MIDI</span>.</li>
                      <li>Set <span className="text-white">Dest</span> to your Virtual Port.</li>
                      <li>Click the <span className="text-white">Refresh</span> icon above.</li>
                    </ol>
                  </motion.div>
                )}

                <div className="bg-black/40 border border-white/5 rounded-none p-3 h-32 overflow-y-auto font-mono text-[9px] space-y-1 custom-scrollbar">
                  {midiLogs.length === 0 && <div className="opacity-20 italic">Awaiting MIDI signal...</div>}
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
             <div className="p-4 pt-4 border-t border-white/5">
                {(() => {
                  if (selectedEffectId && selectedLayerForEffect) {
                    const layerTarget = layers.find(l => l.id === selectedLayerForEffect);
                    if (!layerTarget) return null;
                    const layerIdx = layers.findIndex(l => l.id === layerTarget.id) + 1;
                    
                    let isGenerativeParam = false;
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

                    return (
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 border-b border-white/5 pb-2 mb-2">{headerTitle}</h3>
                        <div className="space-y-6">
                          <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                            <button 
                              onClick={() => {
                                 const updater = (m: any) => ({ ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } });
                                 if (isGenerativeParam) setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? updater(m) : m) } : l));
                                 else setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? updater(m) : m) } : l));
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Audio
                            </button>
                            <button 
                              onClick={() => {
                                 const updater = (m: any) => ({ ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } });
                                 if (isGenerativeParam) setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? updater(m) : m) } : l));
                                 else setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? updater(m) : m) } : l));
                              }}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${!mapping.audioMapping?.enabled && !mapping.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              MIDI
                            </button>
                            <button 
                              onClick={() => {
                                 const updater = (m: any) => ({ ...m, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: true }, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false } });
                                 if (isGenerativeParam) setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? updater(m) : m) } : l));
                                 else setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? updater(m) : m) } : l));
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
                               <div className="space-y-4 pt-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Target Stem</label>
                                    <select 
                                      value={mapping.audioMapping?.stemId || ''}
                                      onChange={e => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), stemId: e.target.value } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), stemId: e.target.value } } : m) } : l)))}
                                      className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                    >
                                      <option value="">Master Out</option>
                                      {audioStems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Tracking Mode</label>
                                    <select 
                                      value={mapping.audioMapping?.mode || 'fast'}
                                      onChange={e => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), mode: e.target.value as 'fast' | 'smooth' } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), mode: e.target.value as 'fast' | 'smooth' } } : m) } : l)))}
                                      className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                    >
                                      <option value="fast">Fast (Strobo)</option>
                                      <option value="smooth">Smooth (Blend)</option>
                                    </select>
                                  </div>
                                </div>

                                <AudioSpectrogram 
                                  stemId={mapping.audioMapping?.stemId}
                                  freqRange={mapping.audioMapping?.freqRange || [20, 20000]}
                                  threshold={mapping.audioMapping?.threshold || 0.5}
                                  onRangeChange={(r) => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), freqRange: r } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), freqRange: r } } : m) } : l)))}
                                  onThresholdChange={(t) => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), threshold: t } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), threshold: t } } : m) } : l)))}
                                />

                                <div className="grid grid-cols-3 gap-2">
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Smooth: {mapping.audioMapping?.smoothing?.toFixed(2) || '0.50'}</label>
                                    <input type="range" min="0" max="0.99" step="0.01" value={mapping.audioMapping?.smoothing || 0.5} onChange={e => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), smoothing: parseFloat(e.target.value) } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), smoothing: parseFloat(e.target.value) } } : m) } : l)))} className="w-full h-1"/>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Attack: {mapping.audioMapping?.attack || 10}</label>
                                    <input type="range" min="1" max="100" step="1" value={mapping.audioMapping?.attack || 10} onChange={e => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), attack: parseInt(e.target.value) } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), attack: parseInt(e.target.value) } } : m) } : l)))} className="w-full h-1"/>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] uppercase tracking-widest opacity-40 block">Release: {mapping.audioMapping?.release || 100}</label>
                                    <input type="range" min="10" max="1000" step="10" value={mapping.audioMapping?.release || 100} onChange={e => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), release: parseInt(e.target.value) } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), release: parseInt(e.target.value) } } : m) } : l)))} className="w-full h-1"/>
                                  </div>
                                </div>

                                <NoteSettingsConfigUI
                                  ns={mapping.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS}
                                  onUpdateNote={(field, val) => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), noteSettings: { ...(mapping.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), noteSettings: { ...(mapping.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } } } : m) } : l)))}
                                />
                               </div>
                            </div>
                          ) : (
                            <MidiConfigUI 
                              label={`${layerTarget.name}.${mapping.name}`}
                              mapping={mapping}
                              isLearnActive={midiLearnTarget?.layerId === layerTarget.id && midiLearnTarget?.effectId === mapping.id ? midiLearnTarget : false}
                              onToggleLearn={(field) => setMidiLearnTarget(prev => prev?.layerId === layerTarget.id && prev?.effectId === mapping.id && prev?.field === field ? null : { layerId: layerTarget.id, effectId: mapping.id, field })}
                              onUpdate={(field, val) => {
                                if (isGenerativeParam) {
                                  setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, [field]: val } : m) } : l));
                                } else {
                                  updateMapping(layerTarget.id, mapping.id, field as keyof EffectMapping, val)
                                }
                              }}
                              onUpdateNote={(field, val) => {
                                if (isGenerativeParam) {
                                  setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, noteSettings: { ...m.noteSettings, [field]: val } } : m) } : l));
                                } else {
                                  updateNoteSetting(layerTarget.id, mapping.id, field, val)
                                }
                              }}
                              onToggleChannel={(ch) => {
                                if (isGenerativeParam) {
                                  setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, channels: m.channels.includes(ch) ? m.channels.filter(c => c !== ch) : [...m.channels, ch] } : m) } : l));
                                } else {
                                  toggleChannel(layerTarget.id, mapping.id, ch)
                                }
                              }}
                              onSetAllChannels={() => {
                                if (isGenerativeParam) {
                                  setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, channels: Array.from({length: 16}, (_, i) => i) } : m) } : l));
                                } else {
                                  setAllChannels(layerTarget.id, mapping.id)
                                }
                              }}
                              onSetNoChannels={() => {
                                if (isGenerativeParam) {
                                  setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, channels: [] } : m) } : l));
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
                                    <select 
                                      value={layerTarget.rhythmMapping.pattern}
                                      onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, rhythmMapping: { ...l.rhythmMapping!, pattern: e.target.value } } : l))}
                                      className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                    >
                                      <option value="4-on-the-Floor">4-on-the-Floor</option>
                                      <option value="Backbeat">Backbeat</option>
                                      <option value="Off-Beat">Off-Beat</option>
                                      <option value="Straight Eighths">Straight Eighths</option>
                                      <option value="Straight Sixteenths">Straight Sixteenths</option>
                                      <option value="The &quot;One&quot;">The "One"</option>
                                      <option value="Custom">Custom</option>
                                    </select>
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
                               <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block mb-1">Target Stem</label>
                                  <select 
                                    value={layerTarget.audioMapping?.stemId || ''}
                                    onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), stemId: e.target.value } } : l))}
                                    className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                  >
                                    <option value="">Master Out</option>
                                    {audioStems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block mb-1">Tracking Mode</label>
                                  <select 
                                    value={layerTarget.audioMapping?.mode || 'fast'}
                                    onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...l.audioMapping!, mode: e.target.value as 'fast'|'smooth' } } : l))}
                                    className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                  >
                                    <option value="fast">Fast (Strobo)</option>
                                    <option value="smooth">Smooth (Blend)</option>
                                  </select>
                                </div>
                               </div>

                               <AudioSpectrogram 
                                  stemId={layerTarget.audioMapping?.stemId}
                                  freqRange={layerTarget.audioMapping?.freqRange || [20, 20000]}
                                  threshold={layerTarget.audioMapping?.threshold || 0.5}
                                  onRangeChange={(r) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), freqRange: r } } : l))}
                                  onThresholdChange={(t) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), threshold: t } } : l))}
                               />

                               <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Smooth: {layerTarget.audioMapping?.smoothing?.toFixed(2) || '0.50'}</label>
                                  <input type="range" min="0" max="0.99" step="0.01" value={layerTarget.audioMapping?.smoothing || 0.5} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), smoothing: parseFloat(e.target.value) } } : l))} className="w-full h-1"/>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Attack (ms): {layerTarget.audioMapping?.attack || 10}</label>
                                  <input type="range" min="1" max="100" step="1" value={layerTarget.audioMapping?.attack || 10} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), attack: parseInt(e.target.value) } } : l))} className="w-full h-1"/>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[8px] uppercase tracking-widest opacity-40 block">Release (ms): {layerTarget.audioMapping?.release || 100}</label>
                                  <input type="range" min="10" max="1000" step="10" value={layerTarget.audioMapping?.release || 100} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), release: parseInt(e.target.value) } } : l))} className="w-full h-1"/>
                                </div>
                               </div>

                               <NoteSettingsConfigUI
                                  ns={layerTarget.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS}
                                  onUpdateNote={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, audioMapping: { ...(l.audioMapping || DEFAULT_AUDIO_MAPPING), noteSettings: { ...(l.audioMapping?.noteSettings || DEFAULT_NOTE_SETTINGS), [field]: val } } } : l))}
                               />
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
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'video', mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
                            }
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'video' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Video
                        </button>
                        <button 
                          onClick={() => {
                            if(assetBrowserLayerTarget) {
                               setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'image', mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
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
                     </div>
                   </div>

                   {layers.find(l => l.id === assetBrowserLayerTarget)?.type !== 'generative' ? (
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
                       </div>
                   ) : (
                       <div className="space-y-2 pt-4 border-t border-white/5">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Select Script</label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto max-h-[60vh] custom-scrollbar pb-10">
                             {generativesRef.current.map(g => {
                               const isActive = layers.find(l => l.id === assetBrowserLayerTarget)?.generativeId === g.uuid;
                               const getIconForGenerative = (uuid: string) => {
                                   if (uuid === 'dragon-text-mask-canvas-1') return '🐉';
                                   if (uuid === 'text-umbrella-canvas-1') return '☂️';
                                   if (uuid === 'text-water-drop-canvas-1') return '💧';
                                   if (uuid === 'text-boat-sea-canvas-1') return '⛵';
                                   if (uuid === 'brutalist-grid-1') return '🔲';
                                   if (uuid === 'ferrofluid-1') return '🌑';
                                   if (uuid === 'bubble-spheres-1') return '🫧';
                                   if (uuid === 'dancing-cubes-canvas-1') return '🎲';
                                   return '✨';
                               };
                               return (
                                 <div 
                                   key={g.uuid}
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
                {generativesRef.current.map(g => {
                  const isActive = activeLayerId && layers.find(l => l.id === activeLayerId)?.generativeId === g.uuid;
                  return (
                    <div 
                      key={g.uuid}
                      className={`group p-4 rounded-none border transition-all flex flex-col justify-between ${isActive ? 'bg-red-600/5 border-red-500/20 opacity-50' : 'bg-transparent border-white/10 hover:border-white'}`}
                    >
                      <div>
                        <div className="w-full h-24 mb-4 border border-white/5 bg-black/50 flex flex-col items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity">
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
