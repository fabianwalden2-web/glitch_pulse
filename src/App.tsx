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
  Menu
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
  channels: [0],
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
    channels: [0], 
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
  const [layers, setLayers] = useState<Layer[]>([
    {
      id: 'layer-1',
      name: 'Background',
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
      mappings: INITIAL_MAPPINGS,
      rhythmMapping: { 
        enabled: false, 
        pattern: '4-on-the-Floor', 
        bpm: 120, 
        customPattern: new Array(16).fill(false),
        noteSettings: {
          useFixedDuration: false,
          subdivision: '1/4',
          bpm: 120,
          useFixedVelocity: false,
          fixedVelocity: 127
        }
      },
      isMuted: false,
      isSoloed: false,
    }
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>('layer-1');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [midiLearnTarget, setMidiLearnTarget] = useState<{layerId: string, effectId?: string, field: 'noteStart' | 'noteEnd'} | null>(null);
  const [ccLearnTarget, setCcLearnTarget] = useState<{layerId: string, paramId: string, min: number, max: number} | null>(null);
  const [expandedParamTrigger, setExpandedParamTrigger] = useState<string | null>(null);
  const [midiLogs, setMidiLogs] = useState<MidiLogEntry[]>([]);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'visual' | 'midi' | 'effects'>('visual');
  const [expandedSection, setExpandedSection] = useState<string | null>('layers');
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [selectedLayerForEffect, setSelectedLayerForEffect] = useState<string | null>(null);
  const [showEffectBrowser, setShowEffectBrowser] = useState(false);
  const [showGenerativeBrowser, setShowGenerativeBrowser] = useState(false);
  const [status, setStatus] = useState('STANDBY');
  const [showRoutingGuide, setShowRoutingGuide] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [compositionLayout, setCompositionLayout] = useState<'stack' | 'split-vertical' | 'split-horizontal' | 'grid-2x2' | 'grid-3x3' | 'grid-4x4'>('stack');
  const [aspectRatioValue, setAspectRatioValue] = useState(60); // 0 = 9:16, 100 = 16:9, ~50 = 1:1
  const [resolutionScale, setResolutionScale] = useState(0.5); // Default to 50% for improved latency
  const [sidebarTab, setSidebarTab] = useState<'config' | 'triggers'>('config');
  const [isRecording, setIsRecording] = useState(false);
  const [isPanic, setIsPanic] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
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
  const topographyCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const sphereParticlesRef = useRef<Record<string, { count: number, particles: SphereParticle[] }>>({});
  const stickinessCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  
  // Accumulation Mode Refs
  const accumulateCanvasRef = useRef<Record<string, HTMLCanvasElement>>({});
  const referenceFrameRef = useRef<Record<string, HTMLCanvasElement>>({});
  const stutterStateRef = useRef<Record<string, { triggerStamp: boolean, clearBuffer: boolean }>>({});
  const stickinessCirclesRef = useRef<Record<string, { count: number, circles: any[] }>>({});
  const videoRewindStateRef = useRef<Record<string, { rewinding: boolean; visible: boolean; lastSeekTime?: number }>>({});
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
            }
          } else {
            if (isDown) {
              state.isDown = true;
              state.velocity = finalVelocity;
              state.phase = 'attack';
              if (layer.videoTriggerMode === 'restart' && layer.type === 'video' && videoRefs.current[layer.id]) {
                videoRefs.current[layer.id]!.currentTime = layer.videoStart || 0;
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
    const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
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
      (window as any).offscreenCtx = (window as any).offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    const canvas = (window as any).offscreenCanvas as HTMLCanvasElement;
    const ctx = (window as any).offscreenCtx as CanvasRenderingContext2D;
    
    if (canvas.width !== targetW) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    if (!(window as any).rawOffscreenCanvas) {
      (window as any).rawOffscreenCanvas = document.createElement('canvas');
      (window as any).rawOffscreenCtx = (window as any).rawOffscreenCanvas.getContext('2d', { willReadFrequently: true });
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
                  } else if (pMap?.active || pMap?.manualActive) {
                      activeMagnitude = pMap.active ? 1.0 : 0.0;
                  } else if (layer.generativeTriggerActive?.[p.name]) {
                      activeMagnitude = unifiedTriggerValue;
                  }
                  
                  let targetVal = baseVal;
                  if (activeMagnitude > 0) {
                      const amount = layer.generativeTriggerAmount?.[p.name] || 0;
                      targetVal = baseVal + amount * activeMagnitude * (p.max - p.min) * 0.5;
                  }
                  
                  const easeKey = `${layer.id}-${p.name}`;
                  const currentEased = parameterEasingRef.current[easeKey] !== undefined ? parameterEasingRef.current[easeKey] : baseVal;
                  const finalVal = currentEased + (targetVal - currentEased) * 0.15;
                  parameterEasingRef.current[easeKey] = finalVal;
                  
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
              ctx.lineWidth = 1;
              ctx.lineJoin = 'round';
              
              const { speed, freq, amp, lines } = modifiedSettings;
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
              
              const { speed, freq, amp, lines } = modifiedSettings;
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
                ctx.lineWidth = 0.9;
                ctx.stroke();
              }
              
              element = canvas;
          } else if (def.uuid === 'particles-sphere-canvas-1') {
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
              
              const { particles: pCount, wiggle, radius, ball_size, speed, light_x } = modifiedSettings;
              const count = Math.round(pCount);
              
              // Build/rebuild particle cache if count changed
              const cache = sphereParticlesRef.current[layer.id];
              if (!cache || cache.count !== count) {
                  sphereParticlesRef.current[layer.id] = { count, particles: buildSphereParticles(count) };
              }
              const sphereParticles = sphereParticlesRef.current[layer.id].particles;
              
              const CX = targetW / 2;
              const CY = targetH / 2;
              const R = radius;
              const t = nowSec * 1000;
              
              // Normalized light direction
              const ly = -0.6, lz = 0.7;
              const llen = Math.sqrt(light_x * light_x + ly * ly + lz * lz);
              const Lx = light_x / llen, Ly = ly / llen, Lz = lz / llen;
              
              // Collect projected particles
              const projected: { x: number, y: number, z: number, bright: number, ballR: number }[] = [];
              for (const sp of sphereParticles) {
                  const tt = t * speed * 0.001;
                  const wd = snoise3d(
                      sp.nx * 2.1 + tt * sp.freq + sp.phase,
                      sp.ny * 2.1 + tt * sp.freq * 0.7,
                      sp.nz * 2.1 + tt * sp.freq * 0.5
                  ) * 2 - 1;
                  const disp = 1 + wd * wiggle;
                  const x3 = sp.nx * R * disp;
                  const y3 = sp.ny * R * disp;
                  const z3 = sp.nz * R * disp;
                  
                  const dot = Math.max(0, sp.nx * Lx + sp.ny * Ly + sp.nz * Lz);
                  const ambient = 0.08;
                  const diffuse = dot * 0.65;
                  const dotProd = sp.nx * Lx + sp.ny * Ly + sp.nz * Lz;
                  const rz = sp.nz - 2 * dotProd * Lz;
                  const spec = Math.pow(Math.max(0, -rz), 8) * 0.5;
                  const bright = Math.min(1, ambient + diffuse + spec);
                  
                  const depthScale = 0.7 + 0.3 * ((z3 / R + 1) / 2);
                  const ballR = ball_size * depthScale * (0.9 + wd * wiggle * 0.1);
                  
                  projected.push({ x: CX + x3, y: CY + y3, z: z3, bright, ballR });
              }
              
              // Sort back to front
              projected.sort((a, b) => a.z - b.z);
              
              for (const pt of projected) {
                  const v = Math.floor(pt.bright * 255);
                  const alpha = 0.5 + pt.bright * 0.5;
                  const g = ctx.createRadialGradient(
                      pt.x - pt.ballR * 0.3, pt.y - pt.ballR * 0.3, pt.ballR * 0.05,
                      pt.x, pt.y, pt.ballR
                  );
                  g.addColorStop(0, `rgba(255,255,255,${(alpha).toFixed(2)})`);
                  g.addColorStop(0.4, `rgba(${v},${v},${v},${(alpha * 0.9).toFixed(2)})`);
                  g.addColorStop(1, `rgba(0,0,0,0)`);
                  ctx.beginPath();
                  ctx.arc(pt.x, pt.y, pt.ballR, 0, Math.PI * 2);
                  ctx.fillStyle = g;
                  ctx.fill();
              }
              
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
           const end = layer.videoEnd || vid.duration || 0;

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
               // Normal forward play — respect segment bounds
               if (vid.currentTime < start) vid.currentTime = start;
               if (vid.currentTime >= end) vid.currentTime = start;
             }
           }
           // Standard modes
           else {
             if (vid.currentTime < start) vid.currentTime = start;
             if (vid.currentTime >= end) vid.currentTime = start;
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
        
        ctx.drawImage(element, x, y, destW, destH);
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

        // Capture raw frame data for effects AND for next frame's motion detection
        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        const data = imageData.data;
        
        // Update layer's previous frame for motion calculation NEXT frame
        prevFrameRef.current[layer.id] = new Uint8ClampedArray(data);

        if (mappingsToProcess.length > 0) {
          const effect = mappingsToProcess[0];
          const settings = effect.settings;

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

      // Finally, composite this layer's fully processed canvas onto the main canvas
      mainCtx.save();
      if (isGrid) {
        mainCtx.beginPath();
        mainCtx.rect(slotX, slotY, slotW, slotH);
        mainCtx.clip();
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

      mainCtx.globalAlpha = layer.opacity * opacityMult;
      mainCtx.globalCompositeOperation = layer.blendMode;
      mainCtx.drawImage(canvas, 0, 0, targetW, targetH);
      mainCtx.restore();
      
      if (bufferCtxRef.current) {
        bufferCtxRef.current.save();
        if (isGrid) {
          bufferCtxRef.current.beginPath();
          bufferCtxRef.current.rect(slotX, slotY, slotW, slotH);
          bufferCtxRef.current.clip();
        }
        bufferCtxRef.current.globalAlpha = layer.opacity * opacityMult;
        bufferCtxRef.current.globalCompositeOperation = layer.blendMode;
        bufferCtxRef.current.drawImage(canvas, 0, 0, targetW, targetH);
        bufferCtxRef.current.restore();
      }
    } // End if (element)
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
      
      setLayers(prev => prev.map(l => l.id === layerId ? {
        ...l,
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
        channels: [0],
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

      {/* Main Header (Desktop) */}
      <header className="hidden lg:flex relative z-10 p-6 justify-between items-center border-b border-white/5">
        <div className="flex items-center">
          <div className="flex items-center gap-4">
            <div className={`w-2 h-2 rounded-none ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-[10px] font-mono tracking-widest opacity-40 uppercase">{status}</span>
          </div>
          
          <div className="flex items-center gap-2 ml-6 pl-6 border-l border-white/10" title={midiAccess ? 'MIDI Connected' : 'MIDI Offline'}>
            <Activity size={12} className={midiAccess ? 'text-emerald-500' : 'text-red-500 opacity-50'} />
            <span className="text-[10px] font-mono tracking-widest opacity-40 uppercase">MIDI IN</span>
          </div>
        </div>
        
        <h1 className="text-sm font-light tracking-[0.8em] uppercase opacity-80 absolute left-1/2 -translate-x-1/2">Glitch Pulse</h1>

        <div className="flex items-center gap-2">
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
            className="px-4 py-2 rounded border transition-all text-[10px] uppercase tracking-widest bg-transparent border-white/10 hover:border border-white hover:bg-white hover:text-black hover:border-white/20 text-white flex items-center gap-2 cursor-pointer"
          >
            <Download size={12} /> Save
          </button>
          <label className="px-4 py-2 rounded border transition-all text-[10px] uppercase tracking-widest bg-transparent border-white/10 hover:border border-white hover:bg-white hover:text-black hover:border-white/20 text-white flex items-center gap-2 cursor-pointer">
            <Upload size={12} /> Load
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
          className={`px-4 py-2 rounded border transition-all flex items-center gap-2 text-[10px] uppercase tracking-widest ${
            isPanic 
              ? 'bg-red-600 border-red-500 text-white scale-95' 
              : 'bg-red-600/10 border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-500'
          }`}
        >
          <Power size={12} />
          Stop All
        </button>
        </div>
      </header>

      <div className="flex-1 relative z-10 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar */}
        <aside className={`
          fixed inset-x-0 bottom-0 z-40 w-full bg-black/95  border-t border-white/10
          lg:relative lg:inset-auto lg:z-0 lg:w-96 lg:border-t-0 lg:border-r lg:bg-black/20 lg:
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
                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, triggerMapping: { ...l.triggerMapping, triggerBehavior: l.triggerMapping.triggerBehavior === 'toggle' ? 'momentary' : 'toggle' } } : l));
                            }}
                            className={`p-1 rounded hover:text-white transition-colors ${layer.triggerMapping.triggerBehavior === 'toggle' ? 'text-red-500 bg-red-500/10' : 'text-white/30'}`}
                            title={`Trigger Mode: ${layer.triggerMapping.triggerBehavior === 'toggle' ? 'Toggle (Retrigger)' : 'Momentary'}`}
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
                        <span className="text-[11px] font-medium truncate opacity-80">{layers.findIndex(l => l.id === layer.id) + 1}. {layer.name}</span>
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
                    {activeLayerId === layer.id && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-2 pt-2 border-t border-white/5 space-y-4"
                        onClick={e => e.stopPropagation()}
                      >
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
        <main 
          className="flex-1 relative flex flex-col items-center justify-center p-2 sm:p-4 lg:p-12 min-w-0 overflow-hidden"
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
                  opacity: 1,
                  blendMode: 'source-over',
                  filterId: null,
                  filterSettings: {},
                  isVisible: true,
                  isActive: false,
                  midiMode: false,
                  videoTriggerMode: 'continuous',
                  triggerMapping: { ...DEFAULT_TRIGGER_MAPPING, channels: [0], noteSettings: { ...DEFAULT_NOTE_SETTINGS } },
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
                      ref={el => videoRefs.current[layer.id] = el}
                      src={layer.src || undefined}
                      loop
                      muted
                      playsInline
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

              {!layers.every(l => !l.src && l.type !== 'generative') && !isPlaying && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-30 transition-all backdrop-blur-sm">
                  <button onClick={togglePlay} className="px-8 py-4 border border-white/20 hover:border-red-500 hover:text-red-500 rounded uppercase tracking-widest transition-all">Start Engine</button>
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

        {/* Right Sidebar: Effect Config */}
        <aside className="w-80 border-l border-white/5 bg-black/20  flex flex-col hidden lg:flex">
          <div className="flex border-b border-white/5 bg-black/40">
            <button 
              onClick={() => setSidebarTab('config')}
              className={`flex-1 py-3 text-[10px] uppercase tracking-widest transition-all ${sidebarTab === 'config' ? 'bg-red-600 text-white font-bold' : 'opacity-40 hover:opacity-100'}`}
            >
              Configuration
            </button>
            <button 
              onClick={() => setSidebarTab('triggers')}
              className={`flex-1 py-3 text-[10px] uppercase tracking-widest transition-all ${sidebarTab === 'triggers' ? 'bg-red-600 text-white font-bold' : 'opacity-40 hover:opacity-100'}`}
            >
              Triggers
            </button>
          </div>
          <div className="p-4 custom-scrollbar overflow-y-auto h-[calc(100vh-160px)]">
              {(() => {
                if (selectedEffectId && selectedLayerForEffect) {
                  const layerTarget = layers.find(l => l.id === selectedLayerForEffect);
                  let isGenerativeParam = false;
                  let mapping = layerTarget?.mappings.find(m => m.id === selectedEffectId);
                  if (!mapping && layerTarget?.generativeMappings) {
                     mapping = layerTarget.generativeMappings.find(m => m.id === selectedEffectId);
                     if (mapping) isGenerativeParam = true;
                  }
                  if (!mapping || !layerTarget) return <div className="p-4 text-center opacity-40 text-[10px] uppercase tracking-widest">Effect not found</div>;
                  
                  return (
                    <>
                      <div className="flex justify-between items-center bg-black/20 p-2 border-b border-white/5 -mx-4 -mt-4 mb-4">
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-400 pl-2">{mapping.name}</h3>
                        <button onClick={() => { setSelectedEffectId(null); setSelectedLayerForEffect(null); }} className="p-2 opacity-40 hover:opacity-100 transition-opacity">
                           <Trash2 size={12} />
                        </button>
                      </div>

                      {sidebarTab === 'config' ? (
                        <div className="space-y-8">
                          {/* Engine Parameters */}
                          <div className="space-y-4">
                            <label className="text-[10px] uppercase tracking-widest opacity-40">Engine Parameters</label>
                            <div className="grid grid-cols-3 gap-4">
                              {(() => {
                                if (isGenerativeParam) {
                                  const def = generativesRef.current.find(g => g.uuid === layerTarget.generativeId);
                                  const p = def?.parameters?.find(param => param.name === selectedEffectId);
                                  if (!p) return null;
                                  return (
                                    <div className="col-span-3 flex items-center justify-between gap-8 p-4 bg-black/40 border border-white/10 rounded">
                                      <div className="flex flex-col items-center flex-1 max-w-[100px]">
                                        <Knob 
                                          label={p.name} 
                                          min={p.min} max={p.max}
                                          value={layerTarget.generativeSettings?.[p.name] ?? p.default} 
                                          type="continuous"
                                          id={"config-knob-" + p.name}
                                          onChange={(val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: val } } : l))}
                                          onContextMenuAction={(action) => {
                                            if (action === 'learn') {
                                              setCcLearnTarget({layerId: layerTarget.id, paramId: `generative-${p.name}`, min: p.min, max: p.max});
                                            } else if (action === 'clear') {
                                              setLayers(prev => prev.map(l => {
                                                if (l.id !== layerTarget.id || !l.ccBindings) return l;
                                                const newBindings = { ...l.ccBindings };
                                                delete newBindings[`generative-${p.name}`];
                                                return { ...l, ccBindings: newBindings };
                                              }));
                                              if (ccLearnTarget?.paramId === `generative-${p.name}`) setCcLearnTarget(null);
                                            }
                                          }}
                                          ccLabel={layerTarget.ccBindings?.[`generative-${p.name}`] ? `CC ${layerTarget.ccBindings[`generative-${p.name}`].cc}` : undefined}
                                          isLearning={ccLearnTarget?.layerId === layerTarget.id && ccLearnTarget?.paramId === `generative-${p.name}`}
                                        />
                                      </div>
                                      <div className="flex-1 flex flex-col items-center">
                                          <label className="text-[10px] uppercase tracking-widest opacity-40 mb-3">Modulation Amount</label>
                                          <input 
                                            type="range" min="-1" max="1" step="0.01" 
                                            value={layerTarget.generativeTriggerAmount?.[p.name] || 0.1} 
                                            onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerAmount: { ...(l.generativeTriggerAmount || {}), [p.name]: parseFloat(e.target.value) } } : l))}
                                            className="w-full h-1 accent-red-600"
                                          />
                                          <span className="text-[10px] mt-3 opacity-60 font-bold">
                                            {((layerTarget.generativeTriggerAmount?.[p.name] || 0.1) * 100).toFixed(0)}%
                                          </span>
                                      </div>
                                    </div>
                                  );
                                }

                                const definition = ALL_EFFECTS.find(e => e.id === selectedEffectId);
                                if (!definition) return null;
                                return (
                                  <>
                                    {definition.parameters.filter(p => p.id !== 'clear').map(p => (
                                      <Knob 
                                        key={p.id} label={p.name} min={p.min} max={p.max}
                                        value={Number(mapping.settings[p.id])} type={p.type}
                                        onChange={(val) => updateSetting(layerTarget.id, mapping.id, p.id, val)}
                                        onContextMenuAction={(action) => {
                                          if (action === 'learn') {
                                            setCcLearnTarget({layerId: layerTarget.id, paramId: `effect-${mapping.id}-${p.id}`, min: p.min, max: p.max});
                                          } else if (action === 'clear') {
                                            setLayers(prev => prev.map(l => {
                                              if (l.id !== layerTarget.id || !l.ccBindings) return l;
                                              const newBindings = { ...l.ccBindings };
                                              delete newBindings[`effect-${mapping.id}-${p.id}`];
                                              return { ...l, ccBindings: newBindings };
                                            }));
                                            if (ccLearnTarget?.paramId === `effect-${mapping.id}-${p.id}`) setCcLearnTarget(null);
                                          }
                                        }}
                                        ccLabel={layerTarget.ccBindings?.[`effect-${mapping.id}-${p.id}`] ? `CC ${layerTarget.ccBindings[`effect-${mapping.id}-${p.id}`].cc}` : undefined}
                                        isLearning={ccLearnTarget?.layerId === layerTarget.id && ccLearnTarget?.paramId === `effect-${mapping.id}-${p.id}`}
                                      />
                                    ))}
                                    {selectedEffectId === 'long-exposure' && (
                                      <div className="col-span-2 pt-2">
                                        <button 
                                          onClick={() => {
                                            if (stutterStateRef.current[layerTarget.id]) {
                                              stutterStateRef.current[layerTarget.id].clearBuffer = true;
                                            } else {
                                              stutterStateRef.current[layerTarget.id] = { triggerStamp: false, clearBuffer: true, wasActive: false };
                                            }
                                          }}
                                          className="w-full py-1.5 bg-red-600/20 hover:bg-red-600 border border-red-600/50 rounded text-[9px] uppercase tracking-widest text-red-100 hover:text-white transition-colors"
                                        >
                                          Clear Accumulated Trails
                                        </button>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Effect Triggers Tab Content */
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
                      )}
                    </>
                  );
                } else if (activeLayerId) {
                  const layerTarget = layers.find(l => l.id === activeLayerId);
                  if (!layerTarget) return <div className="p-4 text-center opacity-40 text-[10px] uppercase tracking-widest">Layer not found</div>;
                  return (
                    <div className="space-y-8">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium text-white/80">{layerTarget.name}</h3>
                      </div>
                      
                      {sidebarTab === 'config' ? (
                        <div className="space-y-8">
                          {/* Visuals Selection */}
                          <div className="space-y-4">
                            <label className="text-[10px] uppercase tracking-widest opacity-80 font-bold text-red-500">Type</label>
                            <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                              <button 
                                onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? {...l, type: 'video', mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : l))}
                                className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.type === 'video' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                              >
                                Video
                              </button>
                              <button 
                                onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? {...l, type: 'image', mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : l))}
                                className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.type === 'image' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                              >
                                Image
                              </button>
                              <button 
                                onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? {...l, type: 'generative', generativeId: l.generativeId || generativesRef.current[0]?.uuid, mappings: [], generativeSettings: {}, generativeMappings: [], generativeTriggerActive: {}, generativeTriggerAmount: {} } : l))}
                                className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${layerTarget.type === 'generative' ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                              >
                                Generative
                              </button>
                            </div>
                          </div>

                          {layerTarget.type === 'generative' ? (
                            <div className="space-y-4 pt-4 border-t border-white/5">
                              <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest opacity-40">Generative Script</label>
                                <button 
                                  onClick={() => setShowGenerativeBrowser(true)}
                                  className="w-full flex items-center justify-between p-3 rounded-none border border-white/5 bg-transparent hover:border border-white hover:bg-white hover:text-black hover:border-white/20 transition-all text-left group"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-black/40 border border-white/10 flex items-center justify-center">
                                      <Sliders size={12} className="opacity-50" />
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest group-hover:text-red-400 transition-colors">
                                        {generativesRef.current.find(g => g.uuid === layerTarget.generativeId)?.description || "Select Script..."}
                                    </div>
                                  </div>
                                  <ChevronRight size={14} className="opacity-20 group-hover:opacity-100 transition-opacity group-hover:text-red-400" />
                                </button>
                              </div>

                              {/* Generative Parameters */}
                              {layerTarget.generativeId && generativesRef.current.find(g => g.uuid === layerTarget.generativeId)?.parameters.length > 0 && (
                                <div className="space-y-4 pt-4 border-t border-white/5">
                                  <label className="text-[10px] uppercase tracking-widest opacity-40">Visual Parameters</label>
                                  <div className="grid grid-cols-2 gap-4">
                                    {generativesRef.current.find(g => g.uuid === layerTarget.generativeId)?.parameters.map(p => {
                                      const isMapped = layerTarget.generativeMappings?.some(m => m.id === p.name);
                                      const isGloballyBound = layerTarget.generativeTriggerActive?.[p.name];
                                      return (
                                       <React.Fragment key={p.name}>
                                        <div className="flex flex-col gap-1">
                                           <div className="flex items-center justify-between px-1">
                                             <button 
                                                 onClick={() => {
                                                   if (!isMapped) {
                                                      const targetM: EffectMapping = { 
                                                        ...INITIAL_MAPPINGS[0], 
                                                        id: p.name, 
                                                        name: p.name, 
                                                        active: true, 
                                                        triggerBehavior: 'momentary',
                                                        noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                                        channels: Array.from({length: 16}, (_, i) => i)
                                                      };
                                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: [...(l.generativeMappings || []), targetM] } : l));
                                                   }
                                                   setExpandedParamTrigger(prev => prev === p.name ? null : p.name);
                                                 }}
                                                 className="text-[10px] uppercase opacity-60 hover:opacity-100 hover:text-red-400 font-bold transition-colors text-left"
                                               >
                                                 {p.name.replace(/([A-Z])/g, ' $1').trim()}
                                               </button>
                                             <div className="flex gap-1 items-center">
                                               <button 
                                                 onClick={() => {
                                                   setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerActive: { ...(l.generativeTriggerActive || {}), [p.name]: !isGloballyBound } } : l));
                                                 }}
                                                 className={`p-1 transition-colors rounded hover:bg-neutral-800 ${isGloballyBound ? 'text-red-500' : 'opacity-20 hover:text-white'}`}
                                                 title="Bind to Layer Tracking Env"
                                               >
                                                 L
                                               </button>
                                               <button 
                                                 onClick={() => {
                                                   if (!isMapped) {
                                                      const targetM: EffectMapping = { 
                                                        ...INITIAL_MAPPINGS[0], 
                                                        id: p.name, 
                                                        name: p.name, 
                                                        active: true, 
                                                        triggerBehavior: 'momentary',
                                                        noteSettings: { ...DEFAULT_NOTE_SETTINGS },
                                                        channels: Array.from({length: 16}, (_, i) => i)
                                                      };
                                                      setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: [...(l.generativeMappings || []), targetM] } : l));
                                                   }
                                                   setExpandedParamTrigger(prev => prev === p.name ? null : p.name);
                                                 }}
                                                 className={`p-1 transition-colors rounded hover:bg-neutral-800 ${isMapped ? 'text-blue-400' : 'opacity-20 hover:text-white'}`}
                                                 title="Parameter Trigger"
                                               >
                                                 <Zap size={10} />
                                               </button>
                                             </div>
                                           </div>
                                           <div className="flex items-center gap-2">
                                             <div className="flex-1">
                                               <Knob 
                                                 label="" 
                                                 min={p.min} max={p.max}
                                                 value={layerTarget.generativeSettings?.[p.name] ?? p.default} 
                                                 type="continuous"
                                                 id={p.name}
                                                 onChange={(val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeSettings: { ...(l.generativeSettings || {}), [p.name]: val } } : l))}
                                                 onContextMenuAction={(action) => {
                                                   if (action === 'learn') {
                                                     setCcLearnTarget({layerId: layerTarget.id, paramId: `generative-${p.name}`, min: p.min, max: p.max});
                                                   } else if (action === 'clear') {
                                                     setLayers(prev => prev.map(l => {
                                                       if (l.id !== layerTarget.id || !l.ccBindings) return l;
                                                       const newBindings = { ...l.ccBindings };
                                                       delete newBindings[`generative-${p.name}`];
                                                       return { ...l, ccBindings: newBindings };
                                                     }));
                                                     if (ccLearnTarget?.paramId === `generative-${p.name}`) setCcLearnTarget(null);
                                                   }
                                                 }}
                                                 ccLabel={layerTarget.ccBindings?.[`generative-${p.name}`] ? `CC ${layerTarget.ccBindings[`generative-${p.name}`].cc}` : undefined}
                                                 isLearning={ccLearnTarget?.layerId === layerTarget.id && ccLearnTarget?.paramId === `generative-${p.name}`}
                                               />
                                             </div>
                                             {(isMapped || isGloballyBound) && (
                                               <div className="flex flex-col items-center">
                                                 <input 
                                                   type="range" min="-1" max="1" step="0.01" 
                                                   value={layerTarget.generativeTriggerAmount?.[p.name] || 0.1} 
                                                   onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeTriggerAmount: { ...(l.generativeTriggerAmount || {}), [p.name]: parseFloat(e.target.value) } } : l))}
                                                   className="w-10 accent-red-600"
                                                 />
                                               </div>
                                             )}
                                           </div>
                                        </div>
                                        
                                        {/* Inline Parameter Trigger Panel */}
                                        {expandedParamTrigger === p.name && (() => {
                                           const mapping = layerTarget.generativeMappings?.find(m => m.id === p.name);
                                           if (!mapping) return null;
                                           return (
                                             <div className="col-span-2 bg-black/40 border border-white/10 rounded overflow-hidden mt-1 mb-2 animate-in fade-in slide-in-from-top-1 shadow-xl">
                                                <div className="flex justify-between items-center bg-black/60 p-2 border-b border-white/5">
                                                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 pl-1">{p.name.replace(/([A-Z])/g, ' $1').trim()} — Parameter Trigger</h3>
                                                  <div className="flex items-center gap-2">
                                                    <button onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.filter(m => m.id !== p.name) } : l))} className="p-1 opacity-40 hover:opacity-100 hover:text-red-400 transition-opacity" title="Remove Trigger">
                                                      <Trash2 size={12} />
                                                    </button>
                                                    <button onClick={() => setExpandedParamTrigger(null)} className="p-1 opacity-40 hover:opacity-100 hover:text-white transition-opacity" title="Close Panel">
                                                      <X size={12} />
                                                    </button>
                                                  </div>
                                                </div>
                                                
                                                <div className="p-3 space-y-4">
                                                  {/* Source Selector */}
                                                  <div className="flex bg-black/40 border border-white/5 rounded overflow-hidden">
                                                     <button 
                                                       onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, active: true, manualActive: false, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } } : m) } : l))}
                                                       className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.active && !mapping.audioMapping?.enabled && !mapping.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                                                     >MIDI</button>
                                                     <button 
                                                       onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, active: false, manualActive: false, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: true }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: false } } : m) } : l))}
                                                       className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.audioMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                                                     >AUDIO</button>
                                                     <button 
                                                       onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, active: false, manualActive: false, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), enabled: false }, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), enabled: true } } : m) } : l))}
                                                       className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors ${mapping.rhythmMapping?.enabled ? 'bg-red-600 text-white' : 'text-white/40 hover:bg-transparent'}`}
                                                     >RHYTHM</button>
                                                  </div>
                                                  
                                                  {/* Content */}
                                                  {mapping.active && !mapping.audioMapping?.enabled && !mapping.rhythmMapping?.enabled && (
                                                     <div className="grid grid-cols-2 gap-4">
                                                       <div className="grid grid-cols-2 gap-2">
                                                          <div className="space-y-1">
                                                             <label className="text-[8px] uppercase tracking-widest opacity-40">Start Note</label>
                                                             <button onClick={() => setMidiLearnTarget({layerId: layerTarget.id, effectId: mapping.id, field: 'noteStart'})} className={`w-full py-1 text-[9px] font-mono border rounded ${midiLearnTarget?.effectId === mapping.id && midiLearnTarget.field === 'noteStart' ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-white/10 opacity-60 bg-black/40 hover:bg-white/5 transition-colors'}`}>{mapping.noteStart}</button>
                                                          </div>
                                                          <div className="space-y-1">
                                                             <label className="text-[8px] uppercase tracking-widest opacity-40">End Note</label>
                                                             <button onClick={() => setMidiLearnTarget({layerId: layerTarget.id, effectId: mapping.id, field: 'noteEnd'})} className={`w-full py-1 text-[9px] font-mono border rounded ${midiLearnTarget?.effectId === mapping.id && midiLearnTarget.field === 'noteEnd' ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-white/10 opacity-60 bg-black/40 hover:bg-white/5 transition-colors'}`}>{mapping.noteEnd}</button>
                                                          </div>
                                                       </div>
                                                       <div className="space-y-1">
                                                         <label className="text-[8px] uppercase tracking-widest opacity-40">Behavior</label>
                                                         <select value={mapping.triggerBehavior} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, triggerBehavior: e.target.value as any } : m) } : l))} className="w-full bg-black/40 border border-white/10 rounded p-1 text-[9px] uppercase tracking-widest outline-none">
                                                           <option value="momentary">Momentary</option>
                                                           <option value="toggle">Toggle</option>
                                                         </select>
                                                       </div>
                                                     </div>
                                                  )}
                                                  
                                                  {mapping.audioMapping?.enabled && (
                                                     <div className="space-y-3">
                                                        <div className="space-y-1">
                                                          <label className="text-[8px] uppercase tracking-widest opacity-40">Stem ID</label>
                                                          <select value={mapping.audioMapping.stemId || ''} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), stemId: e.target.value } } : m) } : l))} className="w-full bg-black/40 border border-white/10 rounded p-1 text-[9px] uppercase tracking-widest outline-none">
                                                             <option value="">Master Mix</option>
                                                             <option value="kick">Kick</option>
                                                             <option value="snare">Snare</option>
                                                             <option value="hihat">Hi-Hat</option>
                                                             <option value="bass">Bass</option>
                                                             <option value="synth">Synth</option>
                                                          </select>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-4">
                                                          <div className="space-y-2 flex flex-col justify-end">
                                                            <label className="text-[8px] uppercase tracking-widest opacity-40">Threshold: {mapping.audioMapping.threshold?.toFixed(2) || '0.50'}</label>
                                                            <input type="range" min="0" max="1" step="0.01" value={mapping.audioMapping.threshold || 0.5} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), threshold: parseFloat(e.target.value) } } : m) } : l))} className="w-full h-1 accent-red-600" />
                                                          </div>
                                                          <div className="space-y-2 flex flex-col justify-end">
                                                            <label className="text-[8px] uppercase tracking-widest opacity-40">Smooth: {mapping.audioMapping.smoothing?.toFixed(2) || '0.50'}</label>
                                                            <input type="range" min="0" max="0.99" step="0.01" value={mapping.audioMapping.smoothing || 0.5} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, audioMapping: { ...(m.audioMapping || DEFAULT_AUDIO_MAPPING), smoothing: parseFloat(e.target.value) } } : m) } : l))} className="w-full h-1 accent-red-600" />
                                                          </div>
                                                        </div>
                                                     </div>
                                                  )}
                                                  
                                                  {mapping.rhythmMapping?.enabled && (
                                                     <div className="space-y-3">
                                                        <div className="space-y-1">
                                                          <label className="text-[8px] uppercase tracking-widest opacity-40">Pattern</label>
                                                          <select value={mapping.rhythmMapping.pattern} onChange={e => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, generativeMappings: l.generativeMappings?.map(m => m.id === mapping.id ? { ...m, rhythmMapping: { ...(m.rhythmMapping || { enabled: false, pattern: '4-on-the-Floor', bpm: 120, customPattern: new Array(16).fill(false) }), pattern: e.target.value } } : m) } : l))} className="w-full bg-black/40 border border-white/10 rounded p-1 text-[9px] uppercase tracking-widest outline-none">
                                                            <option value="4-on-the-Floor">4-on-the-Floor</option>
                                                            <option value="8-beat">8-beat</option>
                                                            <option value="16-beat">16-beat</option>
                                                            <option value="Off-beat">Off-beat</option>
                                                            <option value="Clave">Clave</option>
                                                            <option value="Custom">Custom</option>
                                                          </select>
                                                        </div>
                                                     </div>
                                                  )}
                                                  
                                                </div>
                                             </div>
                                           );
                                        })()}
                                       </React.Fragment>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                             /* Media Source for Non-Generative */
                             <div className="space-y-2 pt-4 border-t border-white/5">
                                <label className="text-[10px] uppercase tracking-widest opacity-40">Media Source</label>
                                <div className="relative group">
                                  <input type="file" multiple accept="video/*,image/*" onChange={(e) => handleFileUpload(e, layerTarget.id)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                  <div className="border border-white/10 p-3 rounded-none bg-transparent group-hover:border border-white hover:bg-white hover:text-black transition-colors flex items-center justify-between">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <Upload size={14} className="opacity-50" />
                                      <span className="text-[10px] truncate">{layerTarget.src ? layerTarget.name : 'Load Media File'}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                          )}

                          {layerTarget.type === 'video' && layerTarget.src && (
                            <div className="space-y-4 pt-4 border-t border-white/5">
                               <RangeSlider 
                                 label="Video Segment"
                                 min={0}
                                 max={videoRefs.current[layerTarget.id]?.duration || 10}
                                 start={layerTarget.videoStart || 0}
                                 end={layerTarget.videoEnd || videoRefs.current[layerTarget.id]?.duration || 10}
                                 onChange={(s, e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoStart: s, videoEnd: e } : l))}
                               />
                               <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest opacity-40">Trigger Mode</label>
                                <select 
                                  value={layerTarget.videoTriggerMode || 'continuous'}
                                  onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoTriggerMode: e.target.value as 'restart' | 'continuous' | 'advance' | 'rewind' | 'frame-accumulator' } : l))}
                                  className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[9px] uppercase tracking-widest outline-none"
                                >
                                  <option value="continuous">Continuous Playback</option>
                                  <option value="restart">Restart on Trigger</option>
                                  <option value="advance">Frame Advance</option>
                                  <option value="rewind">Rewind on Release</option>
                                  <option value="frame-accumulator">Frame Accumulator</option>
                                </select>
                              </div>

                              {/* Frame Advance Settings */}
                              {layerTarget.videoTriggerMode === 'advance' && (
                                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 p-3 bg-black/30 border border-white/5 rounded">
                                  <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Advance Settings</label>
                                  
                                  <div className="space-y-2">
                                    <label className="text-[8px] uppercase opacity-30">Unit</label>
                                    <div className="flex bg-black/40 border border-white/10 rounded overflow-hidden">
                                      <button 
                                        onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoAdvanceUnit: 'frames' } : l))}
                                        className={`flex-1 py-1.5 text-[8px] uppercase tracking-widest transition-colors ${(layerTarget.videoAdvanceUnit || 'frames') === 'frames' ? 'bg-red-600 text-white' : 'text-white/40'}`}
                                      >
                                        Frames
                                      </button>
                                      <button 
                                        onClick={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoAdvanceUnit: 'seconds' } : l))}
                                        className={`flex-1 py-1.5 text-[8px] uppercase tracking-widest transition-colors ${layerTarget.videoAdvanceUnit === 'seconds' ? 'bg-red-600 text-white' : 'text-white/40'}`}
                                      >
                                        Seconds
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex justify-between">
                                      <label className="text-[8px] uppercase opacity-30">Amount</label>
                                      <span className="text-[9px] font-mono opacity-60">
                                        {layerTarget.videoAdvanceAmount || 1} {(layerTarget.videoAdvanceUnit || 'frames') === 'frames' ? 'frame(s)' : 'sec'}
                                      </span>
                                    </div>
                                    <input 
                                      type="number" 
                                      min={((layerTarget.videoAdvanceUnit || 'frames') === 'frames') ? 1 : 0.01} 
                                      max={((layerTarget.videoAdvanceUnit || 'frames') === 'frames') ? 120 : 10} 
                                      step={((layerTarget.videoAdvanceUnit || 'frames') === 'frames') ? 1 : 0.01}
                                      value={layerTarget.videoAdvanceAmount || 1}
                                      onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoAdvanceAmount: parseFloat(e.target.value) || 1 } : l))}
                                      className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                    />
                                  </div>

                                  {(layerTarget.videoAdvanceUnit || 'frames') === 'frames' && (
                                    <div className="space-y-2">
                                      <div className="flex justify-between">
                                        <label className="text-[8px] uppercase opacity-30">Video Frame Rate</label>
                                        <span className="text-[9px] font-mono opacity-60">{layerTarget.videoFrameRate || 30} fps</span>
                                      </div>
                                      <input 
                                        type="number" min="1" max="120" step="1"
                                        value={layerTarget.videoFrameRate || 30}
                                        onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoFrameRate: parseInt(e.target.value) || 30 } : l))}
                                        className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                                      />
                                    </div>
                                  )}
                                </motion.div>
                              )}

                                {/* Rewind on Release Settings */}
                              {layerTarget.videoTriggerMode === 'rewind' && (
                                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 p-3 bg-black/30 border border-white/5 rounded">
                                  <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Rewind Settings</label>
                                  <div className="space-y-2">
                                    <div className="flex justify-between">
                                      <label className="text-[8px] uppercase opacity-30">Rewind Speed</label>
                                      <span className="text-[9px] font-mono opacity-60">{(layerTarget.videoRewindSpeed || 1.0).toFixed(1)}x</span>
                                    </div>
                                    <input 
                                      type="range" min="0.5" max="5" step="0.1"
                                      value={layerTarget.videoRewindSpeed || 1.0}
                                      onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, videoRewindSpeed: parseFloat(e.target.value) } : l))}
                                      className="w-full accent-red-600 h-1"
                                    />
                                  </div>
                                </motion.div>
                              )}

                              {/* Frame Accumulator Settings */}
                              {layerTarget.videoTriggerMode === 'frame-accumulator' && (
                                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 p-3 bg-black/30 border border-white/5 rounded">
                                  <label className="text-[8px] uppercase tracking-widest opacity-60 font-bold text-red-400">Frame Accumulator Settings</label>
                                  
                                  <div className="space-y-2">
                                    <div className="flex justify-between">
                                      <label className="text-[8px] uppercase opacity-30">Difference Threshold</label>
                                      <span className="text-[9px] font-mono opacity-60">{(layerTarget.accumulateThreshold ?? 30).toFixed(0)}</span>
                                    </div>
                                    <input 
                                      type="range" min="1" max="100" step="1"
                                      value={layerTarget.accumulateThreshold ?? 30}
                                      onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, accumulateThreshold: parseFloat(e.target.value) } : l))}
                                      className="w-full accent-red-600 h-1"
                                    />
                                  </div>

                                  <div className="pt-2">
                                    <button 
                                      onClick={() => {
                                        if (stutterStateRef.current[layerTarget.id]) {
                                          stutterStateRef.current[layerTarget.id].clearBuffer = true;
                                        } else {
                                          stutterStateRef.current[layerTarget.id] = { triggerStamp: false, clearBuffer: true, wasActive: false };
                                        }
                                      }}
                                      className="w-full py-1.5 bg-red-600/20 hover:bg-red-600 border border-red-600/50 rounded text-[9px] uppercase tracking-widest text-red-100 hover:text-white transition-colors"
                                    >
                                      Clear Accumulated Frames
                                    </button>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          )}

                          {/* Basic Config */}
                          <div className="space-y-4 pt-4 border-t border-white/5">
                            <label className="text-[10px] uppercase tracking-widest opacity-80 font-bold text-red-500">Blend</label>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <div className="flex justify-between text-[8px] uppercase opacity-40">
                                  <span>Opacity</span>
                                  <span>{Math.round(layerTarget.opacity * 100)}%</span>
                                </div>
                                <input 
                                  type="range" min="0" max="1" step="0.01"
                                  value={layerTarget.opacity}
                                  onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, opacity: parseFloat(e.target.value) } : l))}
                                  className="w-full accent-red-600 h-1"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[8px] uppercase opacity-40">Blend Mode</label>
                                <select 
                                  value={layerTarget.blendMode}
                                  onChange={(e) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, blendMode: e.target.value as GlobalCompositeOperation } : l))}
                                  className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[9px] outline-none"
                                >
                                  <option value="source-over">Normal</option>
                                  <option value="screen">Screen</option>
                                  <option value="multiply">Multiply</option>
                                  <option value="overlay">Overlay</option>
                                  <option value="lighten">Lighten</option>
                                  <option value="darken">Darken</option>
                                  <option value="color-dodge">Color Dodge</option>
                                  <option value="color-burn">Color Burn</option>
                                  <option value="hard-light">Hard Light</option>
                                  <option value="soft-light">Soft Light</option>
                                  <option value="difference">Difference</option>
                                  <option value="exclusion">Exclusion</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          
                          {/* Effects List in Config Tab */}
                          <div className="space-y-2 pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] uppercase tracking-widest opacity-40">Layer Effects</label>
                              <button onClick={() => { setSelectedLayerForEffect(layerTarget.id); setShowEffectBrowser(true); }} className="text-[9px] uppercase tracking-widest bg-transparent px-2 py-0.5 rounded hover:border border-white hover:bg-white hover:text-black transition-colors">Add Effect</button>
                            </div>
                            <div className="space-y-1">
                              {layerTarget.mappings.map(m => (
                                <div key={m.id} className="p-2 rounded border bg-transparent border-white/5 hover:border-white transition-all flex items-center justify-between group">
                                  <span className="text-[10px] opacity-70 group-hover:opacity-100">{m.name}</span>
                                  <div className="flex items-center gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); setActiveLayerId(layerTarget.id); setSelectedEffectId(m.id); setSelectedLayerForEffect(layerTarget.id); setSidebarTab('triggers'); }} className="p-1 opacity-20 hover:opacity-100 transition-opacity"><Zap size={10} /></button>
                                    <button onClick={(e) => { e.stopPropagation(); removeEffect(layerTarget.id, m.id); }} className="p-1 opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity"><Trash2 size={10} /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Layer Triggers Tab Content */
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
                              mapping={layerTarget.triggerMapping!}
                              isLearnActive={midiLearnTarget?.layerId === layerTarget.id && !midiLearnTarget?.effectId ? midiLearnTarget : false}
                              onToggleLearn={(field) => setMidiLearnTarget(prev => prev?.layerId === layerTarget.id && !prev?.effectId && prev?.field === field ? null : { layerId: layerTarget.id, field })}
                              onUpdate={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping!, [field]: val } } : l))}
                              onUpdateNote={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping!, noteSettings: { ...l.triggerMapping!.noteSettings, [field]: val } } } : l))}
                              onToggleChannel={(ch) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping!, channels: l.triggerMapping!.channels.includes(ch) ? l.triggerMapping!.channels.filter(c => c !== ch) : [...l.triggerMapping!.channels, ch] } } : l))}
                              onSetAllChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping!, channels: Array.from({ length: 16 }, (_, i) => i) } } : l))}
                              onSetNoChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping!, channels: [] } } : l))}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div className="h-64 flex flex-col items-center justify-center opacity-20 text-center">
                      <Sliders size={32} strokeWidth={1} />
                      <p className="text-[10px] uppercase tracking-widest mt-4">Select a layer or effect<br/>to configure</p>
                    </div>
                  );
                }
              })()}
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
