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
  Sun
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { parseGeneratives, WebGLGenerativeRenderer, GenerativeDefinition } from './lib/generatives';
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
  videoTriggerMode?: 'restart' | 'continuous' | 'advance' | 'rewind' | 'frame-accumulator';
  accumulateThreshold?: number;
  videoAdvanceUnit?: 'frames' | 'seconds';
  videoAdvanceAmount?: number;
  videoFrameRate?: number;
  videoRewindSpeed?: number;
  generativeId?: string;
  generativeSettings?: Record<string, number>;
  generativeTriggerActive?: Record<string, boolean>;
  generativeTriggerAmount?: Record<string, number>;
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

  const percentage = ((value - min) / (max - min)) * 100;
  const rotation = (percentage / 100) * 270 - 135;

  // Format value for display
  const range = max - min;
  const displayVal = range < 5 ? value.toFixed(2) : range < 20 ? value.toFixed(1) : Math.round(value).toString();

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
        <span className="text-[9px] font-mono opacity-60">{start.toFixed(1)}s - {end.toFixed(1)}s</span>
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
    ratio = 1.0 + t * (1.7777 - 1.0);
  }

  const label = ratio < 0.8 ? "Portrait" : ratio > 1.2 ? "Landscape" : "Square";
  const ratioLabel = ratio < 1 ? `${(9 * ratio/0.5625).toFixed(0)} : 16` : `16 : ${(9 / (ratio/1.7777)).toFixed(0)}`;
  // Simplified ratio label for display
  const displayRatio = ratio < 0.9 ? "9 : 16" : ratio > 1.1 ? "16 : 9" : "1 : 1";

  return (
    <div className="p-4 bg-black/40 border border-white/5 space-y-6">
      <div className="flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-widest opacity-40">Aspect Ratio</label>
        <span className="text-[10px] font-mono text-red-500">{displayRatio}</span>
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
            <span className="text-[8px] font-bold opacity-30">{displayRatio}</span>
          </motion.div>
        </div>

        <div className="flex-1 space-y-4">
           <div className="flex justify-between text-[8px] uppercase tracking-widest opacity-40">
              <button title="Click to set ratio" onClick={() => onChange(15)} className={value < 30 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Portrait</button>
              <button title="Click to set ratio" onClick={() => onChange(50)} className={value > 40 && value < 60 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Square</button>
              <button title="Click to set ratio" onClick={() => onChange(85)} className={value > 70 ? 'text-red-500 font-bold opacity-100 hover:text-white transition-colors' : 'hover:opacity-100 hover:text-white transition-colors'}>Landscape</button>
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
        <div className="p-3 rounded-md border bg-white/5 border-white/10">
          <div className="flex flex-col mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider">Envelope (ADSR)</span>
            <span className="text-[8px] opacity-40">Control attack, decay, sustain, release</span>
          </div>
          
          <div className="space-y-3">
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
  const ns = mapping.noteSettings;
  return (
    <div className="space-y-4 pt-6 border-t border-white/5">
      <div className="flex justify-between items-center">
        <label className="text-[10px] uppercase tracking-widest opacity-40">{label}</label>
        <div className="flex bg-black/40 border border-white/10 rounded p-0.5">
           <button 
             onClick={() => onUpdate('triggerBehavior', 'momentary')}
             className={`px-2 py-0.5 text-[8px] uppercase tracking-tighter rounded-sm transition-all ${mapping.triggerBehavior === 'momentary' ? 'bg-red-600 text-white' : 'opacity-40'}`}
           >
             Momentary
           </button>
           <button 
             onClick={() => onUpdate('triggerBehavior', 'toggle')}
             className={`px-2 py-0.5 text-[8px] uppercase tracking-tighter rounded-sm transition-all ${mapping.triggerBehavior === 'toggle' ? 'bg-red-600 text-white' : 'opacity-40'}`}
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
            const isSelected = mapping.channels.includes(i);
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
            <input type="number" min="0" max="127" value={mapping.noteStart} onChange={(e) => onUpdate('noteStart', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none pr-6" />
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
            <input type="number" min="0" max="127" value={mapping.noteEnd} onChange={(e) => onUpdate('noteEnd', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none pr-6" />
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

      <NoteSettingsConfigUI ns={mapping.noteSettings} onUpdateNote={onUpdateNote} />
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
        midiNote: null,
        midiVelocityThreshold: 1,
        activeDuration: 100,
        fixedVelocity: 127,
        adsr: { attack: 10, decay: 50, sustain: 1.0, release: 100 },
        mappings: [],
        generativeSettings: {},
        generativeMappings: [],
        generativeTriggerActive: {},
        generativeTriggerAmount: {}
      }
    ];
  });
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeMaskMenuLayerId, setActiveMaskMenuLayerId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
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
  const layersRef = useRef<Layer[]>([]);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  const audioTrackersRef = useRef<Record<string, { state: 'idle' | 'attack' | 'release', value: number, lastUpdate: number, lastTriggerTime: number }>>({});
  const parameterEasingRef = useRef<Record<string, number>>({});
  const wavesCanvasRef = useRef<Record<string, HTMLCanvasElement>>({}); 
  const wavesNoiseRef = useRef<any>(null);
  const terrainNoiseRef = useRef<any>(null);
  const topographyCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereParticlesRef = useRef<Record<string, { count: number, particles: SphereParticle[] }>>({});
  const stickinessCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const layerOutputCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
  
  // Accumulation Mode Refs
  const accumulateCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const referenceFrameRef = useRef<Record<string, HTMLCanvasElement>>({});
  const stutterStateRef = useRef<Record<string, { triggerStamp: boolean, clearBuffer: boolean }>>({});
  const stickinessCirclesRef = useRef<Record<string, { count: number, circles: any[] }>>({});
  const videoRewindStateRef = useRef<Record<string, { rewinding: boolean; visible: boolean; lastSeekTime?: number }>>({});
  const videoRestartTimeRef = useRef<Record<string, number>>({});
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
      { id: 'layer-1', name: 'Background', type: 'image', src: null, opacity: 1, blendMode: 'source-over', filterId: null, filterSettings: {}, isVisible: true, midiMode: false, triggerMapping: DEFAULT_TRIGGER_MAPPING, mappings: [], isMuted: false, isSoloed: false }
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

  useEffect(() => {
    requestMidiAccess();
  }, [requestMidiAccess]);

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
             return { ...l, mappings: l.mappings.map(m => m.id === midiLearnTarget.effectId ? { ...m, [midiLearnTarget.field]: note } : m) };
          }
          return { ...l, triggerMapping: { ...l.triggerMapping, [midiLearnTarget.field]: note } };
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
        if (!layer.triggerMapping) return;
        const tr = layer.triggerMapping;
        if (tr.channels.includes(channel) && note >= tr.noteStart && note <= tr.noteEnd) {
          const finalVelocity = tr.noteSettings.useFixedVelocity ? tr.noteSettings.fixedVelocity : velocity;
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
              const delta = unit === 'frames' ? amount / fps : amount;
              const start = layer.videoStart || 0;
              const end = layer.videoEnd || vid.duration || 0;
              let newTime = vid.currentTime + delta;
              if (newTime >= end) newTime = start + (newTime - end);
              vid.currentTime = Math.max(start, Math.min(end, newTime));
              vid.pause();
            }
          }

          // --- Rewind on Release Mode ---
          if (layer.videoTriggerMode === 'rewind' && layer.type === 'video') {
            const vid = videoRefs.current[layer.id];
            if (isDown) {
              videoRewindStateRef.current[layer.id] = { rewinding: false, visible: true };
              if (vid) {
                const end = layer.videoEnd || vid.duration || 0;
                vid.currentTime = Math.min(vid.currentTime + 0.05, end);
                vid.play().catch(() => {});
              }
            } else {
              videoRewindStateRef.current[layer.id] = { rewinding: true, visible: true };
              if (vid) vid.pause();
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
              }
            }
          } else {
            if (isDown) {
              state.isDown = true;
              state.velocity = finalVelocity;
              state.phase = 'attack';
              if (layer.videoTriggerMode === 'restart' && layer.type === 'video') {
                videoRestartTimeRef.current[layer.id] = performance.now();
              }
            } else {
              state.isDown = false;
              state.phase = 'release';
            }
          }

          if (tr.noteSettings.useFixedDuration && isDown) {
            const beatDuration = 60000 / tr.noteSettings.bpm;
            let duration = beatDuration;
            const sub = tr.noteSettings.subdivision;
            if (sub === '1/2') duration = beatDuration * 2;
            if (sub === '1') duration = beatDuration * 4;
            if (sub === '1/8') duration = beatDuration / 2;
            if (sub === '1/16') duration = beatDuration / 4;
            state.useFixedDuration = true;
            state.activeUntil = Date.now() + duration;
          } else {
            state.useFixedDuration = false;
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

              if (m.noteSettings.useFixedDuration) {
                const beatDuration = 60000 / m.noteSettings.bpm;
                let duration = beatDuration;
                const sub = m.noteSettings.subdivision;
                if (sub === '1/2') duration = beatDuration * 2;
                if (sub === '1') duration = beatDuration * 4;
                if (sub === '1/8') duration = beatDuration / 2;
                if (sub === '1/16') duration = beatDuration / 4;
                state.useFixedDuration = true;
                state.activeUntil = Date.now() + duration;
              } else {
                state.useFixedDuration = false;
              }
            } else {
              if (m.triggerBehavior !== 'toggle' && !m.noteSettings.useFixedDuration) {
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
      ratio = 1.0 + t * (1.7777 - 1.0);
    }

    // Stabilize base dimensions (maintaining a 1080p-ish area)
    const baseArea = 1920 * 1080;
    let baseW = Math.sqrt(baseArea * ratio);
    let baseH = baseW / ratio;

    const targetW = Math.floor(baseW * resolutionScale);
    const targetH = Math.floor(baseH * resolutionScale);

    if (mainCanvas.width !== targetW) {
      mainCanvas.width = targetW;
      mainCanvas.height = targetH;
    }

    // Setup Offscreen Canvas for per-layer processing
    if (!(window as any).offscreenCanvas) {
      (window as any).offscreenCanvas = document.createElement('canvas');
      (window as any).offscreenCtx = (window as any).offscreenCanvas.getContext('2d', { willReadFrequently: false });
    }
    const canvas = (window as any).offscreenCanvas as HTMLCanvasElement;
    const ctx = (window as any).offscreenCtx as CanvasRenderingContext2D;
    
    if (canvas.width !== targetW) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    if (!(window as any).rawOffscreenCanvas) {
      (window as any).rawOffscreenCanvas = document.createElement('canvas');
      (window as any).rawOffscreenCtx = (window as any).rawOffscreenCanvas.getContext('2d', { willReadFrequently: false });
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
      let midiVisualOpacity = layer.triggerMapping ? layer.triggerMapping.velocity / 127 : (layer.isActive ? 1.0 : 0.0);

      if (state && layer.triggerMapping) {
          const ns = layer.triggerMapping.noteSettings;
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
          
          if (state.useFixedDuration && state.activeUntil && Date.now() >= state.activeUntil && state.phase !== 'release' && state.phase !== 'idle') {
             state.phase = 'release';
             state.isDown = false;
          }
          
          midiVisualOpacity = state.currentEnvValue * (state.velocity / 127);
          midiIsActive = state.currentEnvValue > 0.001;
      }

      // --- HIGH SPEED AUDIO POLLING ---
      if (layer.audioMapping?.enabled && layer.audioMapping.stemId) {
          if (!audioTrackersRef.current[layer.id]) {
            audioTrackersRef.current[layer.id] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
          }
          const tracker = audioTrackersRef.current[layer.id];
          const dt = (now - tracker.lastUpdate) / 1000.0; // Seconds
          tracker.lastUpdate = now;

          const mode = layer.audioMapping.mode || 'smooth';
          const { intensity, flux } = engine.getBandIntensity(layer.audioMapping.stemId, layer.audioMapping.freqRange || [20, 20000]);
          
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
                      if (pMap?.audioMapping?.enabled && pMap.audioMapping.stemId) {
                          const trackerId = layer.id + '-' + pMap.id + '-audio';
                          if (!audioTrackersRef.current[trackerId]) {
                            audioTrackersRef.current[trackerId] = { state: 'idle', value: 0, lastUpdate: now, lastTriggerTime: 0 };
                          }
                          const tracker = audioTrackersRef.current[trackerId];
                          const dt = (now - tracker.lastUpdate) / 1000.0;
                          tracker.lastUpdate = now;

                          const mode = pMap.audioMapping.mode || 'smooth';
                          const { intensity } = engine.getBandIntensity(pMap.audioMapping.stemId, pMap.audioMapping.freqRange || [20, 20000]);
                          
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

                             if (state.useFixedDuration && state.activeUntil && Date.now() >= state.activeUntil && state.phase !== 'release' && state.phase !== 'idle') {
                                state.phase = 'release';
                                state.isDown = false;
                             }
                             activeMagnitude = state.currentEnvValue * (state.velocity / 127);
                          } else {
                             activeMagnitude = unifiedTriggerValue;
                          }
                      }
                  }
                  
                  let targetVal = baseVal;
                  if (isTriggerActive) {
                      const amount = layer.generativeTriggerAmount?.[p.name] ?? 0;
                      const range = p.max - p.min;
                      targetVal = Math.max(p.min, Math.min(p.max, baseVal + amount * range * activeMagnitude));
                  }
                  
                  let finalVal;
                  if (p.type === 'string' || p.type === 'boolean') {
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
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              ctx.strokeStyle = 'rgba(255,255,255,0.85)';
              
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
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                ctx.fillStyle = '#000';
                ctx.fill();
                
                ctx.beginPath();
                ctx.moveTo(pts[0].x, ys[0]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, ys[j]);
                ctx.strokeStyle = 'rgba(255,255,255,0.88)';
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
              
              // 1. Draw black background
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              
              const { speed, font_size, dragon_size, chaos, thickness, text_content } = modifiedSettings;
              const textStr = (typeof text_content === 'string' && text_content.trim() !== '') ? text_content : (def.parameters.find(p=>p.name==='text_content')?.default || 'Text') as string;
              
              const chars = Array.from(textStr);
              if (chars.length === 0) chars.push(' ');
              
              // 2. Draw white text
              ctx.fillStyle = '#FFF';
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
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              ctx.fillStyle = '#f5f4f2';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                  
                  // Combined ridged multi-peak structure
                  const rawStructure = (r1 * 1.0 + r2 * 0.60 + r3 * 0.32 + r4 * 0.15) / 2.07;
                  const sharpened = Math.pow(rawStructure, rugg);
                  
                  // Smooth base transition so flat ground stays flat
                  const smoothEnv = Math.pow(env, 0.85);
                  const h = smoothEnv * sharpened;
                  return Math.max(0.0, Math.min(1.0, h * 1.4));
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
              
              // Red on flat ground (h=0) to Deep Blue on highest peaks (h=1)
              const getColorForHeight = (hNorm: number) => {
                  const tVal = Math.max(0.0, Math.min(1.0, hNorm));
                  // Flat red: rgb(238, 48, 76), Peak blue: rgb(24, 68, 122)
                  const r = Math.round(238 + (24 - 238) * tVal);
                  const g = Math.round(48 + (68 - 48) * tVal);
                  const b = Math.round(76 + (122 - 76) * tVal);
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
              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                 
                 // Generate stipples along edges for pointillist grainy texture
                 const stipples: { x: number; y: number }[] = [];
                 const dotsCount = Math.floor(15 + profile * 25);
                 for (let d = 0; d < dotsCount; d++) {
                    const edgeIdx = d % 4;
                    const nextEdge = (edgeIdx + 1) % 4;
                    const alphaLerp = ((d * 7 + i * 13) % 100) / 100;
                    const pA = ptsOuter[edgeIdx];
                    const pB = ptsOuter[nextEdge];
                    const jitter = (Math.sin(d * 17.3 + i * 31.7) * 2.5);
                    stipples.push({
                       x: pA.x + (pB.x - pA.x) * alphaLerp + jitter,
                       y: pA.y + (pB.y - pA.y) * alphaLerp + jitter
                    });
                 }
                 
                 const depth = (axisX + axisY) * sinA - axisZ;
                 squares.push({
                    depth,
                    ptsOuter,
                    ptsInner,
                    hasInner,
                    alpha: 0.5 + 0.5 * profile,
                    stipples
                 });
              }
              
              // Sort back to front
              squares.sort((a, b) => a.depth - b.depth);
              
              for (const sq of squares) {
                 // 1. Draw outer stippled frame (bold and visible)
                 ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1.0, sq.alpha * 1.15)})`;
                 ctx.lineWidth = 2.4;
                 ctx.setLineDash([4, 2]); // distinct tech dashed frame
                 
                 ctx.beginPath();
                 ctx.moveTo(sq.ptsOuter[0].x, sq.ptsOuter[0].y);
                 for (let k = 1; k < 4; k++) ctx.lineTo(sq.ptsOuter[k].x, sq.ptsOuter[k].y);
                 ctx.closePath();
                 ctx.stroke();
                 
                 // 2. Draw inner nested frame if present
                 if (sq.hasInner && sq.ptsInner) {
                    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1.0, sq.alpha * 0.9)})`;
                    ctx.lineWidth = 1.6;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath();
                    ctx.moveTo(sq.ptsInner[0].x, sq.ptsInner[0].y);
                    for (let k = 1; k < 4; k++) ctx.lineTo(sq.ptsInner[k].x, sq.ptsInner[k].y);
                    ctx.closePath();
                    ctx.stroke();
                 }
                 
                 // 3. Draw edge stipple noise particles
                 ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1.0, sq.alpha * 0.95)})`;
                 for (const dot of sq.stipples) {
                    ctx.fillRect(dot.x - 1, dot.y - 1, 2, 2);
                 }
                 
                 // 4. Corner dot highlights
                 ctx.fillStyle = `rgba(255, 255, 255, 1.0)`;
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
              ctx.fillStyle = '#e6e5e2'; // Light warm paper background
              ctx.fillRect(0, 0, targetW, targetH);
              
              const { speed, nodes, grid_size, spread, movement, chaos } = modifiedSettings;
              const gs = grid_size ?? 45.0;
              const numNodes = Math.max(4, Math.min(60, Math.floor(nodes ?? 16)));
              const spr = spread ?? 0.4;
              const mov = movement ?? 15.0;
              const cha = chaos ?? 0.0;
              const spd = speed ?? 1.0;
              const t = nowSec * spd;
              
              // Draw subtle grid lines
              ctx.strokeStyle = '#d2d0cb';
              ctx.lineWidth = 1;
              const ox = (targetW / 2) % gs;
              const oy = (targetH / 2) % gs;
              for (let x = ox; x < targetW; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, targetH); ctx.stroke(); }
              for (let y = oy; y < targetH; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(targetW, y); ctx.stroke(); }
              
              const nodeColors = ['#ea5738', '#f3b2c1', '#72a3cf', '#fac528', '#202224', '#6da089'];
              
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
                 
                 pts.push({
                    gx: gxGrid,
                    gy: gyGrid,
                    x: finalX,
                    y: finalY,
                    parent: pIdx,
                    color: nodeColors[i % nodeColors.length],
                    num: i + 1
                 });
              }
              
              // Draw connecting lines
              ctx.strokeStyle = '#181a1b';
              ctx.lineWidth = 2.0;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              
              for (let i = 1; i < pts.length; i++) {
                 const node = pts[i];
                 const parent = pts[node.parent];
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
                 
                 ctx.fillStyle = '#222426';
                 ctx.fillText(p.num.toString(), p.x + radius + 4, p.y + radius * 0.7);
              }
              
              element = canvas; } else if (def.uuid === 'isometric-buildings-canvas-1') {
              if (!sphereCanvasRef.current[layer.id]) sphereCanvasRef.current[layer.id] = document.createElement('canvas');
              const canvas = sphereCanvasRef.current[layer.id];
              if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW; canvas.height = targetH;
              }
              const ctx = canvas.getContext('2d')!;
              ctx.clearRect(0, 0, targetW, targetH);
              ctx.fillStyle = '#fc6c70'; // Rich coral pink background
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                 gradLeft.addColorStop(0, '#506e88');
                 gradLeft.addColorStop(1, '#fc6c70');
                 ctx.fillStyle = gradLeft;
                 ctx.beginPath();
                 ctx.moveTo(pTop0.x, pTop0.y); ctx.lineTo(pTop3.x, pTop3.y);
                 ctx.lineTo(pBot3.x, pBot3.y); ctx.lineTo(pBot0.x, pBot0.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Draw right face
                 const gradRight = ctx.createLinearGradient(pTop2.x, pTop2.y, pBot2.x, pBot2.y);
                 gradRight.addColorStop(0, '#334e66');
                 gradRight.addColorStop(1, '#fc6c70');
                 ctx.fillStyle = gradRight;
                 ctx.beginPath();
                 ctx.moveTo(pTop3.x, pTop3.y); ctx.lineTo(pTop2.x, pTop2.y);
                 ctx.lineTo(pBot2.x, pBot2.y); ctx.lineTo(pBot3.x, pBot3.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Draw top face
                 ctx.fillStyle = '#ff8e91';
                 ctx.beginPath();
                 ctx.moveTo(pTop0.x, pTop0.y); ctx.lineTo(pTop1.x, pTop1.y);
                 ctx.lineTo(pTop2.x, pTop2.y); ctx.lineTo(pTop3.x, pTop3.y);
                 ctx.closePath();
                 ctx.fill();
                 
                 // Subtle top edge highlight
                 ctx.strokeStyle = '#ffa8ab';
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
                
                const { count, size, speed, duration, delay, transparency } = modifiedSettings;
                const numCircles = Math.max(1, Math.min(200, Math.floor(count ?? 25.0)));
                const maxSize = Math.max(10.0, Math.min(2400.0, size ?? 280.0));
                const spd = Math.max(0.05, speed ?? 1.0);
                const lifeDuration = Math.max(0.5, Math.min(60.0, duration ?? 6.0));
                const birthDelay = Math.max(0.0, Math.min(5.0, delay ?? 0.25));
                const transp = Math.max(0.0, Math.min(1.0, transparency ?? 0.0));
                
                // Continuous background transparency: 0.0 = solid warm-white, 1.0 = transparent
                if (transp < 0.999) {
                    const bgAlpha = 1.0 - transp;
                    ctx.fillStyle = `rgba(243, 242, 238, ${bgAlpha})`;
                    ctx.fillRect(0, 0, targetW, targetH);
                }
                
                // Growth phase time: how long to grow from 0 to full size
                const growthTime = 1.0 / spd;
                // Total cycle length for each circle slot (holds full size during the remaining duration)
                const totalLife = Math.max(growthTime + 0.1, lifeDuration);
                
                for (let i = 0; i < numCircles; i++) {
                    // Staggered birth delay between consecutive circles
                    const birthOffset = i * birthDelay;
                    const shiftedTime = nowSec + 5000.0 - birthOffset;
                    
                    if (shiftedTime < 0) continue;
                    
                    const cycleIdx = Math.floor(shiftedTime / totalLife);
                    const timeInCycle = shiftedTime % totalLife;
                    
                    // Deterministic pseudo-random position across entire canvas per (cycle, circle)
                    const posSeed = Math.abs((i * 9301 + cycleIdx * 49297 + 1337) % 233280);
                    const rand1 = ((posSeed * 9301 + 49297) % 233280) / 233280;
                    const rand2 = ((posSeed * 1337 + 1013904223) % 233280) / 233280;
                    
                    const cx = rand1 * targetW;
                    const cy = rand2 * targetH;
                    
                    // Current radius: grows smoothly from 0 to maxSize in growthTime, then stays at maxSize
                    let currentRadius = 0.0;
                    if (timeInCycle < growthTime) {
                        const growthProgress = timeInCycle / growthTime;
                        currentRadius = growthProgress * maxSize;
                    } else {
                        // Stays alive at full size, accumulating on screen!
                        currentRadius = maxSize;
                    }
                    
                    // Smooth 0.35s fade-out right before resetting to the next cycle
                    let alpha = 1.0;
                    const fadeWindow = 0.35;
                    if (timeInCycle > (totalLife - fadeWindow)) {
                        alpha = Math.max(0.0, (totalLife - timeInCycle) / fadeWindow);
                    }
                    
                    if (currentRadius > 0.5 && alpha > 0.01) {
                        ctx.fillStyle = `rgba(234, 56, 77, ${alpha})`;
                        ctx.beginPath();
                        ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
                        ctx.fill();
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
              
              // Clean white background matching user palette
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
              
              const redColor = { r: 250, g: 59, b: 92 };
              const blueColor = { r: 38, g: 68, b: 78 };
              
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
                          
                          const isRed = Math.sin(seed * 11.3) > 0;
                          const baseCol = isRed ? redColor : blueColor;
                          
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
                              const strokeColor = isRed ? `rgba(210, 30, 60, ${strokeAlpha})` : `rgba(25, 45, 55, ${strokeAlpha})`;
                              
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
              
              // 1. Clean warm-white background
              ctx.fillStyle = '#f5f5f3';
              ctx.fillRect(0, 0, targetW, targetH);
              
              const { growth, branch_chance, split_mode, segment_size, grid_mesh } = modifiedSettings;
              const currentStep = Math.max(0.0, growth ?? 25.0);
              const brChance = branch_chance ?? 0.45;
              const splitRatio = split_mode ?? 2.5;
              const segSize = Math.max(10.0, Math.min(45.0, segment_size ?? 20.0));
              const meshAlpha = grid_mesh ?? 0.35;
              
              const cx = targetW / 2;
              const cy = targetH / 2;
              
              // 2. Draw subtle background triangulation guide mesh across canvas
              if (meshAlpha > 0.01) {
                  ctx.strokeStyle = `rgba(0, 0, 0, ${0.065 * meshAlpha})`;
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
              
              // 3. Deterministic Self-Avoiding Dendritic Maze with Synchronous Generation Steps
              interface MazeSegment {
                  x1: number;
                  y1: number;
                  x2: number;
                  y2: number;
                  generation: number;
                  isFork: boolean;
              }
              
              const cacheKey = `vein_sync_norad_${targetW}_${targetH}_${brChance.toFixed(2)}_${splitRatio.toFixed(2)}_${segSize.toFixed(1)}`;
              const storage = (window as any)._veinCache = (window as any)._veinCache || {};
              
              let segments: MazeSegment[];
              let totalGenerations: number;
              
              if (storage.key === cacheKey && storage.segments) {
                  segments = storage.segments;
                  totalGenerations = storage.totalGenerations;
              } else {
                  segments = [];
                  
                  // Spatial Hash Grid for collision detection
                  const cellSize = segSize * 0.72;
                  const grid: Record<string, { x: number; y: number; id: number }[]> = {};
                  
                  const getCellKey = (x: number, y: number) => {
                      const gx = Math.floor(x / cellSize);
                      const gy = Math.floor(y / cellSize);
                      return `${gx},${gy}`;
                  };
                  
                  const insertPoint = (x: number, y: number, id: number) => {
                      const key = getCellKey(x, y);
                      if (!grid[key]) grid[key] = [];
                      grid[key].push({ x, y, id });
                  };
                  
                  let nodeIdCounter = 0;
                  insertPoint(cx, cy, nodeIdCounter++);
                  
                  const isTooClose = (x: number, y: number, parentId: number, minDist: number) => {
                      const gx = Math.floor(x / cellSize);
                      const gy = Math.floor(y / cellSize);
                      const minDistSq = minDist * minDist;
                      
                      for (let dx = -1; dx <= 1; dx++) {
                          for (let dy = -1; dy <= 1; dy++) {
                              const list = grid[`${gx + dx},${gy + dy}`];
                              if (!list) continue;
                              for (let i = 0; i < list.length; i++) {
                                  const p = list[i];
                                  if (p.id === parentId) continue;
                                  const distSq = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
                                  if (distSq < minDistSq) return true;
                              }
                          }
                      }
                      return false;
                  };
                  
                  // Deterministic pseudo-random generator
                  let rndSeed = 1337;
                  const random = () => {
                      rndSeed = (rndSeed * 16807) % 2147483647;
                      return (rndSeed - 1) / 2147483646;
                  };
                  
                  interface FrontierTip {
                      x: number;
                      y: number;
                      angle: number;
                      id: number;
                  }
                  
                  let currentFrontier: FrontierTip[] = [];
                  
                  // Generation 0: 8 primary radial trunk branches from center seed
                  const initialBranches = 8;
                  for (let b = 0; b < initialBranches; b++) {
                      const angle = (b / initialBranches) * Math.PI * 2 + (random() - 0.5) * 0.15;
                      const nextX = cx + Math.cos(angle) * segSize;
                      const nextY = cy + Math.sin(angle) * segSize;
                      const nid = nodeIdCounter++;
                      
                      insertPoint(nextX, nextY, nid);
                      
                      segments.push({
                          x1: cx, y1: cy,
                          x2: nextX, y2: nextY,
                          generation: 0,
                          isFork: false
                      });
                      
                      currentFrontier.push({
                          x: nextX, y: nextY,
                          angle: angle,
                          id: nid
                      });
                  }
                  
                  // Advance synchronously generation by generation (step by step)
                  const maxGenerations = 50;
                  const boundMargin = 30;
                  let gen = 1;
                  
                  for (; gen < maxGenerations; gen++) {
                      const nextFrontier: FrontierTip[] = [];
                      
                      for (let i = 0; i < currentFrontier.length; i++) {
                          const curr = currentFrontier[i];
                          
                          if (curr.x < -boundMargin || curr.x > targetW + boundMargin ||
                              curr.y < -boundMargin || curr.y > targetH + boundMargin) {
                              continue;
                          }
                          
                          // Decide branching count: 1 (grow straight) vs 2 or 3 (fork)
                          const doSplit = random() < brChance;
                          let branchAngles: number[] = [];
                          
                          if (!doSplit) {
                              // Continue straight with slight angular wandering
                              const angleOffset = (random() - 0.5) * 0.45;
                              branchAngles.push(curr.angle + angleOffset);
                          } else {
                              // Fork into 2 or 3 branches
                              const split3Chance = (splitRatio - 2.0);
                              const do3Split = random() < split3Chance;
                              
                              if (do3Split) {
                                  const spread = 0.55 + random() * 0.25;
                                  branchAngles.push(curr.angle - spread);
                                  branchAngles.push(curr.angle);
                                  branchAngles.push(curr.angle + spread);
                              } else {
                                  const spread = 0.50 + random() * 0.35;
                                  branchAngles.push(curr.angle - spread);
                                  branchAngles.push(curr.angle + spread);
                              }
                          }
                          
                          for (const branchAngle of branchAngles) {
                              const nextX = curr.x + Math.cos(branchAngle) * segSize;
                              const nextY = curr.y + Math.sin(branchAngle) * segSize;
                              
                              const minDist = segSize * 0.72;
                              if (!isTooClose(nextX, nextY, curr.id, minDist)) {
                                  const nid = nodeIdCounter++;
                                  insertPoint(nextX, nextY, nid);
                                  
                                  segments.push({
                                      x1: curr.x, y1: curr.y,
                                      x2: nextX, y2: nextY,
                                      generation: gen,
                                      isFork: branchAngles.length > 1
                                  });
                                  
                                  nextFrontier.push({
                                      x: nextX, y: nextY,
                                      angle: branchAngle,
                                      id: nid
                                  });
                              }
                          }
                      }
                      
                      currentFrontier = nextFrontier;
                      if (currentFrontier.length === 0) break;
                  }
                  
                  totalGenerations = gen;
                  storage.key = cacheKey;
                  storage.segments = segments;
                  storage.totalGenerations = totalGenerations;
              }
              
              // 4. Synchronous Step-by-Step Tree Growth Development:
              // currentStep = 0 is just the dark black center dot.
              // currentStep = 1 is generation 0 completed.
              // currentStep = 2 is generation 1 completed (showing initial bifurcations), etc.
              const completedGens = Math.floor(currentStep);
              const stepFraction = currentStep - completedGens;
              
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              
              for (let i = 0; i < segments.length; i++) {
                  const seg = segments[i];
                  
                  if (seg.generation < completedGens) {
                      // Fully grown segment
                      const normGen = seg.generation / (totalGenerations || 1);
                      const w = 3.6 * (1.0 - normGen * 0.62);
                      
                      ctx.strokeStyle = '#181a1b';
                      ctx.lineWidth = Math.max(1.1, w);
                      
                      ctx.beginPath();
                      ctx.moveTo(seg.x1, seg.y1);
                      ctx.lineTo(seg.x2, seg.y2);
                      ctx.stroke();
                  } else if (seg.generation === completedGens && stepFraction > 0.001) {
                      // Developing frontier step: extending length in unison
                      const drawX2 = seg.x1 + (seg.x2 - seg.x1) * stepFraction;
                      const drawY2 = seg.y1 + (seg.y2 - seg.y1) * stepFraction;
                      
                      const normGen = seg.generation / (totalGenerations || 1);
                      const w = 3.6 * (1.0 - normGen * 0.62);
                      
                      ctx.strokeStyle = '#181a1b';
                      ctx.lineWidth = Math.max(1.1, w);
                      
                      ctx.beginPath();
                      ctx.moveTo(seg.x1, seg.y1);
                      ctx.lineTo(drawX2, drawY2);
                      ctx.stroke();
                  }
              }
              
              // 5. Dark Black Starting Seed Point in the Center
              ctx.fillStyle = '#181a1b';
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
              
              // Clean white / off-white background matching the user palette
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
              const lLen = Math.hypot(lx, ly, lz);
              const lightNorm = { x: lx / lLen, y: ly / lLen, z: lz / lLen };
              
              // Palette:
              // Highlight (brighter color): Vibrant Red [250, 59, 92]
              // Shadow (darker color): Deep Dark Blue / Slate Teal [38, 68, 78]
              const redColor = { r: 250, g: 59, b: 92 };
              const blueColor = { r: 38, g: 68, b: 78 };
              
              interface FaceData {
                 indices: [number, number, number];
                 p0: { x: number; y: number; z: number };
                 p1: { x: number; y: number; z: number };
                 p2: { x: number; y: number; z: number };
                 isFront: boolean;
                 fillColor: string;
                 centerZ: number;
              }
              
              const faceList: FaceData[] = [];
              
              for (const face of faces) {
                 const p0 = projPts[face[0]];
                 const p1 = projPts[face[1]];
                 const p2 = projPts[face[2]];
                 
                 // Screen normal Z for winding
                 const normScreenZ = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
                 const isFront = normScreenZ >= 0;
                 
                 // 3D normal vector
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
                 
                 // Dot light
                 const dot = norm3D.x * lightNorm.x + norm3D.y * lightNorm.y + norm3D.z * lightNorm.z;
                 
                 // Shading calculation based on `shadows` parameter:
                 // When shd is low (0.0): one single uniform color with no highlights or shadows
                 // When shd > 0: highlights are brighter red, shadows are darker blue!
                 let fillColor: string;
                 if (shd <= 0.02) {
                    fillColor = isFront ? 'rgba(250, 59, 92, 0.35)' : 'rgba(250, 59, 92, 0.18)';
                 } else {
                    // Normalize dot from [-1, 1] to [0, 1] where 1 is facing light (Red Highlight), 0 is in shadow (Blue Shadow)
                    const lightFactor = Math.max(0, Math.min(1, 0.5 + dot * 0.5 * Math.min(2.0, shd)));
                    
                    const r = Math.round(blueColor.r + (redColor.r - blueColor.r) * lightFactor);
                    const g = Math.round(blueColor.g + (redColor.g - blueColor.g) * lightFactor);
                    const b = Math.round(blueColor.b + (redColor.b - blueColor.b) * lightFactor);
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
              ctx.strokeStyle = 'rgba(38, 68, 78, 0.3)';
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
              ctx.strokeStyle = '#26444e';
              ctx.lineWidth = 2.4;
              if (shd > 0.02) {
                 ctx.shadowColor = 'rgba(250, 59, 92, 0.5)';
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
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                 ctx.fillStyle = '#0a0a0a';
                 ctx.beginPath();
                 ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
                 ctx.fill();
                 
                 // tiny white sparkle cross
                 ctx.strokeStyle = 'rgba(255,255,255,0.8)';
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
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
                        // calculate simple lighting based on normal in 3d space (approx)
                        const tp0 = transformedPts[face[0]]; const tp1 = transformedPts[face[1]]; const tp2 = transformedPts[face[2]];
                        const nx = (tp1.y - tp0.y)*(tp2.z - tp0.z) - (tp1.z - tp0.z)*(tp2.y - tp0.y);
                        const ny = (tp1.z - tp0.z)*(tp2.x - tp0.x) - (tp1.x - tp0.x)*(tp2.z - tp0.z);
                        const nz = (tp1.x - tp0.x)*(tp2.y - tp0.y) - (tp1.y - tp0.y)*(tp2.x - tp0.x);
                        const len = Math.hypot(nx, ny, nz) || 1;
                        const lightDot = Math.max(0, (nx/len)*0.5 + (ny/len)*0.8 + (nz/len)*0.3);
                        
                        const shade = Math.floor(lightDot * 100 + s.baseColor * 50);
                        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
                        ctx.beginPath();
                        ctx.moveTo(p0.x, p0.y);
                        for(let i=1; i<face.length; i++) ctx.lineTo(projPts[face[i]].x, projPts[face[i]].y);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = '#000';
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
              ctx.fillStyle = '#e8e8e6';
              ctx.fillRect(0, 0, targetW, targetH);
              
              const { speed, density, scale: sclValue, movement, chaos } = modifiedSettings;
              const spd = speed ?? 1.0;
              const dens = Math.floor(density ?? 250);
              const scl = sclValue ?? 1.0;
              const mov = movement ?? 20.0;
              const cha = chaos ?? 1.0;
              const t = nowSec * spd;
              
              ctx.globalCompositeOperation = 'multiply';
              
              // Quasi-random R2 low-discrepancy sequence:
              // Guarantees completely even, homogeneous coverage across the entire canvas
              // with zero empty holes in the middle or anywhere!
              const a1 = 0.7548776662466927;
              const a2 = 0.5698402909980532;
              
              for (let i = 0; i < dens; i++) {
                 // Low-discrepancy 2D coordinates
                 const u = (0.5 + i * a1) % 1.0;
                 const v = (0.5 + i * a2) % 1.0;
                 
                 const baseX = u * targetW;
                 const baseY = v * targetH;
                 
                 // Dynamic organic floating drift
                 const driftX = Math.sin(t * 0.8 * cha + i * 2.13) * mov;
                 const driftY = Math.cos(t * 0.6 * cha + i * 3.17) * mov;
                 
                 const x = (baseX + driftX + targetW) % targetW;
                 const y = (baseY + driftY + targetH) % targetH;
                 
                 // Shape distribution
                 const typeHash = (i * 7 + 3) % 10;
                 let type = 0; // 0=circle, 1=triangle, 2=rect bar, 3=small dot, 4=sharp triangle
                 if (typeHash < 3) type = 1;
                 else if (typeHash < 6) type = 0;
                 else if (typeHash < 8) type = 2;
                 else if (typeHash < 9) type = 4;
                 else type = 3;
                 
                 const color = (i % 2 === 0 || (i % 5 === 0)) ? '#fa3b5c' : '#26444e';
                 
                 const sizeRand = ((i * 13 + 7) % 100) / 100;
                 const size = (12 + sizeRand * 55) * scl;
                 const rot = t * (Math.sin(i * 1.7) * 0.5) + i * 0.9;
                 
                 ctx.save();
                 ctx.translate(x, y);
                 ctx.rotate(rot);
                 ctx.fillStyle = color;
                 ctx.strokeStyle = color;
                 
                 if (type === 0) {
                     ctx.beginPath(); ctx.arc(0, 0, size * 0.48, 0, Math.PI * 2); ctx.fill();
                 } else if (type === 1) {
                     ctx.beginPath(); ctx.moveTo(0, -size * 0.55); ctx.lineTo(size * 0.5, size * 0.45); ctx.lineTo(-size * 0.5, size * 0.45); ctx.closePath(); ctx.fill();
                 } else if (type === 2) {
                     const barW = size * 1.3;
                     const barH = size * 0.26;
                     ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
                 } else if (type === 3) {
                     ctx.beginPath(); ctx.arc(0, 0, Math.max(2, size * 0.18), 0, Math.PI * 2); ctx.fill();
                 } else {
                     ctx.beginPath(); ctx.moveTo(0, -size * 0.7); ctx.lineTo(size * 0.35, size * 0.35); ctx.lineTo(-size * 0.35, size * 0.35); ctx.closePath(); ctx.fill();
                 }
                 ctx.restore();
              }
              ctx.globalCompositeOperation = 'source-over';
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
              
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
              
              ctx.fillStyle = '#FFF';
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
              ctx.strokeStyle = '#FFF';
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
              
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
              
              ctx.fillStyle = '#FFF';
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
              
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, targetW, targetH);
              
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
              
              ctx.fillStyle = '#FFF';
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
              
              ctx.fillStyle = '#FFF';
              ctx.strokeStyle = '#000';
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
              ctx.fillStyle = '#FFF';
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
              webglRendererRef.current.render(def, nowSec, modifiedSettings);
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

           // Frame Advance: keep video paused, don't auto-loop
           if (layer.videoTriggerMode === 'advance') {
             vid.pause();
           }
           // Rewind on Release: handle per-frame rewind animation
           else if (layer.videoTriggerMode === 'rewind') {
             const rState = videoRewindStateRef.current[layer.id];
             if (rState?.rewinding) {
               const nowTime = performance.now();
               if (!rState.lastSeekTime) rState.lastSeekTime = nowTime;
               const timeSinceLastSeek = nowTime - rState.lastSeekTime;
               
               // Throttle backward seeks to roughly 30fps (33ms) to allow the browser decoder to keep up
               if (timeSinceLastSeek >= 33) {
                 const rewindSpeed = layer.videoRewindSpeed || 1.0;
                 const dt = timeSinceLastSeek / 1000;
                 const rewindDelta = rewindSpeed * dt;
                 let newTime = vid.currentTime - rewindDelta;
                 
                 if (newTime <= start) {
                   newTime = start;
                   vid.currentTime = newTime;
                   // Fully rewound — stay visible and wait at start
                   videoRewindStateRef.current[layer.id] = { rewinding: false, visible: true, lastSeekTime: nowTime };
                 } else {
                   vid.currentTime = newTime;
                   rState.lastSeekTime = nowTime;
                 }
               }
             } else {
               // Normal forward play - Lock to master clock
               const targetTime = start + (masterTimeSec % segDur);
               if (Math.abs(vid.currentTime - targetTime) > 0.12 && !vid.seeking) {
                 if ((vid as any).fastSeek) {
                   try { (vid as any).fastSeek(targetTime); } catch(e) { vid.currentTime = targetTime; }
                 } else vid.currentTime = targetTime;
               }
             }
           }
           // Standard modes - Lock to master clock!
           else {
             const targetTime = start + (masterTimeSec % segDur);
             if (Math.abs(vid.currentTime - targetTime) > 0.12 && !vid.seeking) {
               if ((vid as any).fastSeek) {
                 try { (vid as any).fastSeek(targetTime); } catch(e) { vid.currentTime = targetTime; }
               } else vid.currentTime = targetTime;
             }
           }
         }
      } else {
         element = imageRefs.current[layer.id];
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

        rawCtx.clearRect(0, 0, targetW, targetH);
        if (isGrid) {
          rawCtx.save();
          rawCtx.beginPath();
          rawCtx.rect(slotX, slotY, slotW, slotH);
          rawCtx.clip();
        }
        rawCtx.drawImage(element, x, y, destW, destH);
        if (isGrid) rawCtx.restore();

        // --- Frame Accumulator Mode ---
        if (layer.videoTriggerMode === 'frame-accumulator') {
          // Capture reference frame (first frame of the video) on first encounter
          if (!referenceFrameRef.current[layer.id]) {
            const refCanvas = document.createElement('canvas');
            refCanvas.width = targetW;
            refCanvas.height = targetH;
            referenceFrameRef.current[layer.id] = refCanvas;
            const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!;
            refCtx.drawImage((window as any).rawOffscreenCanvas, 0, 0);
          }
          
          if (!accumulateCanvasRef.current[layer.id]) {
            const accCanvas = document.createElement('canvas');
            accCanvas.width = targetW;
            accCanvas.height = targetH;
            accumulateCanvasRef.current[layer.id] = accCanvas;
          }
          
          const refCanvas = referenceFrameRef.current[layer.id];
          const accCanvas = accumulateCanvasRef.current[layer.id];
          const accCtx = accCanvas.getContext('2d', { willReadFrequently: true })!;
          const stState = stutterStateRef.current[layer.id] || { triggerStamp: false, clearBuffer: false, wasActive: false };
          stutterStateRef.current[layer.id] = stState;
          
          // Edge detection for the stamp trigger — fires on the rising edge of the layer's trigger
          let isCurrentlyActive = false;
          if (layer.audioMapping?.enabled) {
              isCurrentlyActive = audioIsActive;
          } else if (layer.rhythmMapping?.enabled) {
              isCurrentlyActive = rhythmIsActive;
          } else if (layer.midiMode) {
              isCurrentlyActive = midiIsActive;
          }
          
          if (isCurrentlyActive && !stState.wasActive) {
              stState.triggerStamp = true;
          }
          stState.wasActive = isCurrentlyActive;
          
          // Handle clear
          if (stState.clearBuffer) {
            accCtx.clearRect(0, 0, targetW, targetH);
            stState.clearBuffer = false;
          }

          // When triggered, stamp the moving pixels onto the accumulation buffer
          if (stState.triggerStamp) {
            const currentData = rawCtx.getImageData(0, 0, targetW, targetH).data;
            const refCtx2 = refCanvas.getContext('2d', { willReadFrequently: true })!;
            const refData = refCtx2.getImageData(0, 0, targetW, targetH).data;
            
            if (!(window as any).diffCanvas) {
               (window as any).diffCanvas = document.createElement('canvas');
               (window as any).diffCtx = (window as any).diffCanvas.getContext('2d', { willReadFrequently: true });
            }
            const diffCanvas = (window as any).diffCanvas as HTMLCanvasElement;
            const diffCtx = (window as any).diffCtx as CanvasRenderingContext2D;
            if (diffCanvas.width !== targetW) { diffCanvas.width = targetW; diffCanvas.height = targetH; }
            
            const diffImgData = diffCtx.createImageData(targetW, targetH);
            const diffData = diffImgData.data;
            const thresh = layer.accumulateThreshold ?? 30;
            
            for (let i = 0; i < currentData.length; i += 4) {
               const rDiff = Math.abs(currentData[i] - refData[i]);
               const gDiff = Math.abs(currentData[i+1] - refData[i+1]);
               const bDiff = Math.abs(currentData[i+2] - refData[i+2]);
               
               const avgDiff = (rDiff + gDiff + bDiff) / 3;
               if (avgDiff > thresh) {
                 diffData[i] = currentData[i];
                 diffData[i+1] = currentData[i+1];
                 diffData[i+2] = currentData[i+2];
                 diffData[i+3] = 255;
               } else {
                 diffData[i+3] = 0;
               }
            }
            diffCtx.putImageData(diffImgData, 0, 0);
            accCtx.drawImage(diffCanvas, 0, 0);
            stState.triggerStamp = false;
          }

          // Output: Always show Background Reference Frame + Accumulated Stamps on top
          ctx.clearRect(0, 0, targetW, targetH);
          ctx.drawImage(refCanvas, 0, 0);
          ctx.drawImage(accCanvas, 0, 0);
          
          rawCtx.clearRect(0, 0, targetW, targetH);
          rawCtx.drawImage(refCanvas, 0, 0);
          rawCtx.drawImage(accCanvas, 0, 0);
        }

        // Process effects for this layer
        const activeMappings = layer.mappings.filter(m => {
           if (m.isMuted) return false;
           if (m.manualActive) return true;
           const state = triggerStatesRef.current[`effect-${layer.id}-${m.id}`];
           if (state) {
               // Update ADSR state for effect trigger
               const ns = m.noteSettings;
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

               if (state.useFixedDuration && state.activeUntil && Date.now() >= state.activeUntil && state.phase !== 'release' && state.phase !== 'idle') {
                  state.phase = 'release';
                  state.isDown = false;
               }

               return state.currentEnvValue > 0.001;
           }
           return m.active;
        });
        const soloedMappings = activeMappings.filter(m => m.isSoloed);
        const mappingsToProcess = soloedMappings.length > 0 ? soloedMappings : activeMappings;

        // Extract prevFrame matching this layer using current struct
        const _prevFrame = prevFrameRef.current[layer.id] || null;
        
        // Temporarily assign it to a local var that the original effects code expects
        const localPrevFrameRef = { current: _prevFrame };

        // Only perform GPU pixel readback if an active effect requires pixel array inspection
        const needsPixelData = mappingsToProcess.some(m => ['motion-symbols', 'invert', 'pixelate', 'glitch-slice'].includes(m.id));
        let imageData: ImageData | null = null;
        let data: Uint8ClampedArray | null = null;
        
        if (needsPixelData) {
           imageData = ctx.getImageData(0, 0, targetW, targetH);
           data = imageData.data;
           prevFrameRef.current[layer.id] = new Uint8ClampedArray(data);
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
                const baseVal = modSettings[p.name] !== undefined ? modSettings[p.name] : p.default;
                if (effect.triggerActive?.[p.name]) {
                   const triggerAmt = effect.triggerAmount?.[p.name] ?? 0;
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
                   modSettings[p.name] = Math.max(p.min, Math.min(p.max, calculatedVal));
                }
             }
          }
          const settings = modSettings;

      // --- 1. Symbols ---
      if (effect.id === 'motion-symbols') {
        const size = Math.floor(settings.size || 16);
        const spacing = Math.floor(settings.spacing || 4);
        const threshold = settings.sensitivity || 30;
        const step = size + spacing;
        
        ctx.save();
        // Solid white canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        
        if (localPrevFrameRef.current) {
          const prevData = localPrevFrameRef.current;
          ctx.font = `bold ${size}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000000'; // Solid black symbols
          
          for (let y = 0; y < targetH; y += step) {
            for (let x = 0; x < targetW; x += step) {
              const i = (y * targetW + x) * 4;
              const b1 = (data[i] + data[i+1] + data[i+2]) / 3;
              const b2 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
              
              if (Math.abs(b1 - b2) > threshold) {
                const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
                ctx.fillText(symbol, x, y);
              }
            }
          }
        }
        ctx.restore();
      }

      // --- 2. Invert Colors ---
      if (effect.id === 'invert') {
        const threshold = settings.threshold || 0;
        const channel = Math.floor(settings.colors || 0); // 0: All, 1: R, 2: G, 3: B
        const saturation = (settings.saturation || 100) / 100;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          const brightness = (r + g + b) / 3;
          
          if (brightness >= threshold) {
            let ir = 255 - r, ig = 255 - g, ib = 255 - b;
            
            // Saturation adjustment for inverted part
            if (saturation < 1) {
              const invGray = (ir + ig + ib) / 3;
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

      // --- 3. Edge Detection ---
      if (effect.id === 'edges') {
        const thickness = Math.floor(settings.thickness || 1);
        const glow = (settings.glow || 0) / 100;
        const sensitivity = settings.sensitivity || 20;
        
        const edgeData = new Uint8ClampedArray(data.length);
        for (let y = 0; y < targetH; y++) {
          for (let x = 0; x < targetW; x++) {
            const i = (y * targetW + x) * 4;
            const val = (data[i] + data[i+1] + data[i+2]) / 3;
            const right = (data[i + thickness * 4] + data[i + thickness * 4 + 1] + data[i + thickness * 4 + 2]) / 3 || val;
            const down = (data[i + targetW * 4 * thickness] + data[i + targetW * 4 * thickness + 1] + data[i + targetW * 4 * thickness + 2]) / 3 || val;
            const diff = Math.abs(val - right) + Math.abs(val - down);
            
            if (diff > sensitivity) {
              edgeData[i] = edgeData[i+1] = edgeData[i+2] = 255;
              if (glow > 0) {
                // Simple glow simulation
                edgeData[i+3] = 255;
              } else {
                edgeData[i+3] = 255;
              }
            } else {
              edgeData[i+3] = 0;
            }
          }
        }
        ctx.putImageData(new ImageData(edgeData, targetW, targetH), 0, 0);
      }

      // --- 4. Pixelate ---
      if (effect.id === 'pixelate') {
        const cellSize = Math.floor(settings.cellSize || 20);
        const movement = (settings.movement || 0) / 100;
        const sensitivity = settings.sensitivity || 30;
        
        if (localPrevFrameRef.current && movement > 0) {
          const prevData = localPrevFrameRef.current;
          for (let y = 0; y < targetH; y += cellSize) {
            for (let x = 0; x < targetW; x += cellSize) {
              const i = (Math.floor(y) * targetW + Math.floor(x)) * 4;
              const b1 = (data[i] + data[i+1] + data[i+2]) / 3;
              const b2 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
              
              // If movement is high, only pixelate if change > sensitivity
              // If movement is low, pixelate more
              const motionDiff = Math.abs(b1 - b2);
              const shouldPixelate = motionDiff > (sensitivity * movement);
              
              if (shouldPixelate) {
                const r = data[i], g = data[i+1], b = data[i+2];
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x, y, cellSize, cellSize);
              }
            }
          }
        } else {
          // Standard pixelate (affects all)
          for (let y = 0; y < targetH; y += cellSize) {
            for (let x = 0; x < targetW; x += cellSize) {
              const i = (Math.floor(y) * targetW + Math.floor(x)) * 4;
              if (i >= data.length) continue;
              const r = data[i], g = data[i+1], b = data[i+2];
              ctx.fillStyle = `rgb(${r},${g},${b})`;
              ctx.fillRect(x, y, cellSize, cellSize);
            }
          }
        }
      }

      // --- 5. RGB Shift (Glitch) ---
      if (effect.id === 'rgb-shift') {
        const distance = settings.distance || 10;
        const saturation = (settings.saturation || 100) / 100;
        const jitter = settings.jitter || 0;
        
        const shift = distance + (Math.random() - 0.5) * jitter;
        const offData = new Uint8ClampedArray(data.length);
        
        for (let i = 0; i < data.length; i += 4) {
          const x = (i / 4) % targetW;
          const y = Math.floor((i / 4) / targetW);
          
          // Red channel
          const rx = Math.min(targetW - 1, Math.max(0, x + shift));
          const ri = (y * targetW + Math.floor(rx)) * 4;
          let r = data[ri];
          
          // Green channel
          let g = data[i+1];
          
          // Blue channel
          const bx = Math.min(targetW - 1, Math.max(0, x - shift));
          const bi = (y * targetW + Math.floor(bx)) * 4;
          let b = data[bi];

          // Apply saturation to shifted colors
          if (saturation !== 1) {
            const gray = (r + g + b) / 3;
            r = gray + (r - gray) * saturation;
            g = gray + (g - gray) * saturation;
            b = gray + (b - gray) * saturation;
          }
          
          offData[i] = r;
          offData[i+1] = g;
          offData[i+2] = b;
          offData[i+3] = 255;
        }
        ctx.putImageData(new ImageData(offData, targetW, targetH), 0, 0);
      }

      // --- 7. Hue Rotate ---
      if (effect.id === 'hue-rotate') {
        const speed = settings.speed || 10;
        const saturation = (settings.saturation || 100);
        const range = settings.range || 360;
        
        const hue = (now * speed / 100) % range;
        ctx.save();
        ctx.filter = `hue-rotate(${hue}deg) saturate(${saturation}%)`;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
      }

      // --- 8. VHS ---
      if (effect.id === 'vhs') {
        const noise = settings.noise || 20;
        const tracking = settings.tracking || 10;
        const bleed = settings.bleed || 30;
        
        ctx.save();
        
        // 1. Color Bleed (Red Shift)
        if (bleed > 0 && bufferCanvasRef.current) {
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = bleed / 200;
          ctx.drawImage(bufferCanvasRef.current, bleed / 5, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        }

        // 2. Tracking Noise & Distortion
        if (tracking > 0) {
          const jump = (Math.sin(now / 500) * tracking);
          if (Math.random() < 0.05) {
            ctx.drawImage(canvas, 0, jump, targetW, targetH, 0, 0, targetW, targetH);
          }
          
          // Horizontal wavy distortion
          for (let i = 0; i < 10; i++) {
            const sy = Math.random() * targetH;
            const sh = 2 + Math.random() * 5;
            const sx = (Math.sin(now / 100 + sy) * tracking / 2);
            ctx.drawImage(canvas, 0, sy, targetW, sh, sx, sy, targetW, sh);
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
      if (effect.id === 'dithering') {
        const scale = Math.floor(settings.scale || 2);
        const contrast = (settings.contrast || 100) / 100;
        const hueShift = settings.hue || 0;
        
        const bayer = [
          [0, 8, 2, 10],
          [12, 4, 14, 6],
          [3, 11, 1, 9],
          [15, 7, 13, 5]
        ];

        const ditherData = ctx.createImageData(targetW, targetH);
        const dData = ditherData.data;

        for (let y = 0; y < targetH; y += scale) {
          const rowOffset = y * targetW;
          const bayerRow = bayer[(y / scale) % 4];
          for (let x = 0; x < targetW; x += scale) {
            const i = (rowOffset + x) * 4;
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114) * contrast;
            const threshold = (bayerRow[(x / scale) % 4] / 16) * 255;
            const val = brightness > threshold ? 255 : 0;
            
            // Fill the block in the image data
            for (let dy = 0; dy < scale && y + dy < targetH; dy++) {
              for (let dx = 0; dx < scale && x + dx < targetW; dx++) {
                const di = ((y + dy) * targetW + (x + dx)) * 4;
                dData[di] = dData[di+1] = dData[di+2] = val;
                dData[di+3] = 255;
              }
            }
          }
        }
        
        ctx.save();
        if (hueShift !== 0) ctx.filter = `hue-rotate(${hueShift}deg)`;
        ctx.putImageData(ditherData, 0, 0);
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
        
        ctx.restore();
      }

      // --- 9. Motion Detector ---
      if (effect.id === 'motion-detector' && localPrevFrameRef.current) {
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
          
          // Draw the object content from the original video
          ctx.drawImage(videoRef.current!, rx, ry, rw, rh, rx, ry, rw, rh);
          
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
      if (effect.id === 'windows-98' && localPrevFrameRef.current) {
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
      if (effect.id === 'glitch-box' && localPrevFrameRef.current) {
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

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, layerId: string) => {
    const file = e.target.files?.[0];
    if (file && layerId) {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const assetPath = (file as any).path;
      
      setLayers(prev => prev.map(l => l.id === layerId ? {
        ...l,
        assetPath,
        missingAsset: false,
        src: url,
        type: isVideo ? 'video' : 'image',
        name: file.name,
        mappings: [],
        generativeSettings: {},
        generativeMappings: [],
        generativeTriggerActive: {},
        generativeTriggerAmount: {}
      } : l));
      
      setIsPlaying(false);
      setStatus('READY');
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
        initialSettings[p.id] = p.min + (p.max - p.min) / 2;
        if (def.id === 'invert') {
          if (p.id === 'colors') initialSettings[p.id] = 0;
          if (p.id === 'saturation') initialSettings[p.id] = 100;
          if (p.id === 'threshold') initialSettings[p.id] = 0;
        }
        if (p.type === 'binary') initialSettings[p.id] = p.min;
      });

      const newMapping: EffectMapping = {
        id: def.id,
        name: def.name,
        description: def.description,
        channels: Array.from({length: 16}, (_, i) => i),
        noteStart: 0,
        noteEnd: 127,
        active: false,
        manualActive: false,
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
    
    // setSelectedEffectId(def.id);
    // setSelectedLayerForEffect(layerId);
    setExpandedSection(`effects-${layerId}`);
    // No longer closing the browser so multiple effects can be added
  };

  const removeAllEffects = (layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: [] } : l));
    if (selectedLayerForEffect === layerId) {
      setSelectedEffectId(null);
      setSelectedLayerForEffect(null);
    }
  };

  const removeEffect = (layerId: string, effectId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, mappings: l.mappings.filter(m => m.id !== effectId) } : l));
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

          <button 
            onClick={requestWakeLock}
            className={`flex items-center gap-1.5 pl-3 border-l border-white/10 transition-colors ${isWakeLockActive ? 'text-amber-400 opacity-90' : 'text-white/30 hover:text-white/60'}`}
            title={isWakeLockActive ? 'Tablet Screen Keep-Awake Active (Screen will not sleep during MIDI activity)' : 'Click to enable Screen Keep-Awake'}
          >
            <Sun size={11} className={isWakeLockActive ? 'animate-pulse' : ''} />
            <span className="text-[8px] font-mono tracking-widest uppercase">
              {isWakeLockActive ? 'AWAKE' : 'KEEP AWAKE'}
            </span>
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
            <div className="p-2 space-y-2">
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
                className="w-full p-2 rounded border border-dashed border-white/10 hover:border-white/30 hover:bg-transparent transition-all text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center justify-center gap-2"
              >
                <Plus size={12} />
                Add Layer
              </button>

              <Reorder.Group axis="y" values={layers} onReorder={setLayers} className="space-y-1">
                {layers.map(layer => (
                  <Reorder.Item 
                    key={layer.id}
                    value={layer}
                    onDragStart={() => { setActiveLayerId(layer.id); setSelectedEffectId(null); setSelectedLayerForEffect(null); }}
                    className={`p-2 rounded-none border transition-all cursor-pointer group ${activeLayerId === layer.id ? 'border-white bg-[#111]' : 'bg-transparent border-transparent hover:border-white/20'}`}
                  >
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
                            setSidebarTab('triggers');
                          }}
                          className={`p-1 rounded hover:text-white transition-colors ${layer.midiMode ? 'text-red-500' : 'text-white/20'}`}
                          title="Trigger settings"
                        >
                          <Zap size={12} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMaskMenuLayerId(prev => prev === layer.id ? null : layer.id);
                          }}
                          className={`p-1 rounded transition-colors ${layer.maskTargetId ? 'text-purple-400 bg-purple-500/20' : 'text-white/30 hover:text-white hover:bg-white/5'}`}
                          title={layer.maskTargetId ? `Masking Layer (Click to configure)` : `Track Matte / Mask settings`}
                        >
                          <Blend size={12} />
                        </button>
                        <span className="text-[11px] font-medium truncate opacity-80 ml-1" title={layer.name}>Layer {layers.findIndex(l => l.id === layer.id) + 1}: {layer.name.length > 20 ? layer.name.slice(0, 20) + '...' : layer.name}</span>
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
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
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
                                <span className="text-[10px] uppercase tracking-widest font-bold truncate max-w-[180px]">{layer.src ? (layer.name.length > 20 ? layer.name.slice(0, 20) + '...' : layer.name) : (layer.type === 'generative' ? 'Change Script' : 'Load Asset')}</span>
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

                      </motion.div>
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
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const files = Array.from(e.dataTransfer.files) as File[];
              
              const newLayers = files.map((file, idx) => {
                const isVideo = file.type.startsWith('video/');
                return {
                  id: `layer-${Date.now()}-${idx}`,
                  name: file.name,
                  type: isVideo ? 'video' : 'image',
                  src: URL.createObjectURL(file),
                  assetPath: (file as any).path,
                  missingAsset: false,
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
                  isMuted: false,
                  isSoloed: false
                };
              });

              setLayers(prev => {
                // If there is only one empty layer, replace it with the new ones.
                if (prev.length === 1 && !prev[0].src) return newLayers as any;
                return [...prev, ...newLayers as any];
              });
              
              setStatus('READY');
            }
          }}
        >
          <div className="relative w-full max-w-5xl aspect-video group">
            <div className="absolute inset-0 border border-white/10 rounded-2xl overflow-hidden shadow-2xl bg-black/40">
              {/* Hidden Layer Elements */}
              <div className="hidden">
                {layers.map(layer => (
                  layer.type === 'video' ? (
                    <video
                      key={layer.id}
                      ref={el => {
                        videoRefs.current[layer.id] = el;
                        if (el && el.paused && isPlaying) {
                          el.play().catch(() => {});
                        }
                      }}
                      src={layer.src || undefined}
                      loop
                      muted
                      playsInline
                      autoPlay
                      preload="auto"
                      onLoadedMetadata={() => setStatus('READY')}
                    />
                  ) : (
                    <img
                      key={layer.id}
                      ref={el => imageRefs.current[layer.id] = el}
                      src={layer.src || undefined}
                      alt={layer.name}
                    />
                  )
                ))}
              </div>

              {layers.every(l => (!l.src && l.type !== 'generative')) && <Waves className="absolute inset-0 z-0 pointer-events-none" />}
              <canvas ref={canvasRef} className={`w-full h-full object-contain relative ${layers.every(l => (!l.src && l.type !== 'generative')) ? 'opacity-0' : ''} z-10`} />

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
                             value={isGen ? (layerTarget.generativeSettings?.[p.name] ?? p.default) : m.settings?.[p.name]}
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
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: val } } : l));
                                } else {
                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map((map: any) => map.id === m.id ? { ...map, settings: { ...map.settings, [p.name]: val } } : map) } : l));
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
                            </div>
                          );
                        })()}

                        {activeLayer.type === 'video' && activeLayer.src && (
                          <div className="space-y-6 pt-6 mt-6 border-t border-white/10">
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 pb-2 border-b border-white/5">Video Modes</h3>
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
                                   <option value="rewind">Rewind on Release</option>
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
                                      <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Rewind Settings</label>
                                      <div className="space-y-2">
                                        <div className="flex justify-between text-[8px] uppercase opacity-40"><span>Rewind Speed</span><span>{activeLayer.videoRewindSpeed || 2}x</span></div>
                                        <input type="range" min="1" max="10" step="0.5" value={activeLayer.videoRewindSpeed || 2} onChange={(e) => setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, videoRewindSpeed: parseFloat(e.target.value) } : l))} className="w-full accent-white h-1" />
                                      </div>
                                    </div>
                                 )}
                               </div>
                            </div>
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
                  onClick={toggleAudioPlay}
                  className={`px-4 rounded-none flex items-center justify-center transition-colors ${audioPlaying ? 'bg-red-600 text-white' : 'border border-white hover:bg-white hover:text-black hover:bg-white/20'}`}
                >
                  {audioPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
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
                              onClick={() => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true } } : m) } : l)))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              Audio
                            </button>
                            <button 
                              onClick={() => (isGenerativeParam ? setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false } } : m) } : l)) : setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, mappings: l.mappings.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false } } : m) } : l)))}
                              className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${!mapping.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                            >
                              MIDI
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
                             setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? {...layer, type: 'generative', generativeId: layer.generativeId || generativesRef.current[0]?.uuid, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
                          }}
                          className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layers.find(l => l.id === assetBrowserLayerTarget)?.type === 'generative' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                        >
                          Generative
                        </button>
                     </div>
                   </div>

                   {layers.find(l => l.id === assetBrowserLayerTarget)?.type !== 'generative' ? (
                       <div className="space-y-2 pt-4 border-t border-white/5">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Upload Media</label>
                          <div className="relative group">
                            <input type="file" accept="video/*,image/*" onChange={(e) => { handleFileUpload(e, assetBrowserLayerTarget!); setShowAssetBrowser(false); }} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                            <div className="border border-white/10 p-3 rounded-none bg-transparent group-hover:border border-white hover:bg-white hover:text-black transition-colors flex items-center justify-between">
                              <div className="flex items-center gap-3 min-w-0">
                                <Upload size={14} className="opacity-50" />
                                <span className="text-[10px] truncate">{layers.find(l => l.id === assetBrowserLayerTarget)?.src ? layers.find(l => l.id === assetBrowserLayerTarget)?.name : 'Click to Browse...'}</span>
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
                                   if (uuid === 'shader-clouds-1') return '🌫️';
                                   if (uuid === 'bubble-spheres-1') return '🫧';
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
                                       setLayers(prev => prev.map(layer => layer.id === assetBrowserLayerTarget ? { ...layer, generativeId: g.uuid, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : layer));
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
                  return (
                    <div 
                      key={effect.id}
                      className={`group p-4 rounded-none border transition-all flex flex-col justify-between ${isAdded ? 'bg-red-600/5 border-red-500/20 opacity-50' : 'bg-transparent border-white/10 hover:border-white'}`}
                    >
                      <div>
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
                            setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, generativeId: g.uuid, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : l));
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
