/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
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

// --- Types ---

interface LayerTriggerMapping {
  channels: number[];
  noteStart: number;
  noteEnd: number;
  noteSettings: NoteSettings;
  activeUntil: number | null;
  velocity: number;
}

interface Layer {
  id: string;
  name: string;
  type: 'video' | 'image';
  src: string | null;
  opacity: number;
  blendMode: GlobalCompositeOperation;
  filterId: string | null;
  filterSettings: Record<string, any>;
  isVisible: boolean;
  isActive?: boolean;
  midiMode: boolean; // True = MIDI triggered only, False = Visible by default
  midiCC?: number; // CC to control opacity
  triggerMapping: LayerTriggerMapping;
  mappings: EffectMapping[]; // Per-layer effects
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
  }
];

const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  useFixedDuration: false,
  subdivision: '1/4',
  bpm: 120,
  useFixedVelocity: false,
  fixedVelocity: 100
};

const DEFAULT_TRIGGER_MAPPING: LayerTriggerMapping = {
  channels: [0],
  noteStart: 0,
  noteEnd: 127,
  noteSettings: { ...DEFAULT_NOTE_SETTINGS },
  activeUntil: null,
  velocity: 0
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
    velocity: 0
  },
];

// --- Components ---

function Knob({ value, min, max, onChange, label, type = 'continuous' }: {
  value: number,
  min: number,
  max: number,
  onChange: (val: number) => void,
  label: string,
  type?: 'continuous' | 'binary',
  key?: any
}) {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const startVal = useRef(0);

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
    const sensitivity = 200; // Pixels for full range
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

  return (
    <div className="flex flex-col items-center gap-2 group select-none">
      <div 
        className={`relative w-12 h-12 cursor-pointer touch-none transition-transform ${isDragging ? 'scale-110' : ''}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <circle 
            cx="50" cy="50" r="40" 
            fill="none" stroke="currentColor" strokeWidth="2" 
            className="text-white/10"
          />
          <circle 
            cx="50" cy="50" r="40" 
            fill="none" stroke="currentColor" strokeWidth="4" 
            strokeDasharray="251.2"
            strokeDashoffset={251.2 - (percentage / 100) * 188.4} // 3/4 circle
            transform="rotate(135 50 50)"
            className="text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
          />
          <line 
            x1="50" y1="50" x2="50" y2="20" 
            stroke="currentColor" strokeWidth="4" strokeLinecap="round"
            transform={`rotate(${rotation} 50 50)`}
            className="text-white"
          />
        </svg>
      </div>
      <span className="text-[8px] uppercase tracking-widest font-bold opacity-40 group-hover:opacity-100 transition-opacity whitespace-nowrap">{label}</span>
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

function MidiConfigUI({ label, mapping, onUpdate, onUpdateNote, onToggleChannel, onSetAllChannels, onSetNoChannels }: {
  label: string,
  mapping: LayerTriggerMapping | EffectMapping,
  onUpdate: (field: string, val: any) => void,
  onUpdateNote: (field: string, val: any) => void,
  onToggleChannel: (ch: number) => void,
  onSetAllChannels: () => void,
  onSetNoChannels: () => void,
}) {
  const ns = mapping.noteSettings;
  return (
    <div className="space-y-4 pt-6 border-t border-white/5">
      <label className="text-[10px] uppercase tracking-widest opacity-40">{label}</label>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-[8px] uppercase opacity-30">Channels</label>
          <div className="flex gap-2">
            <button onClick={onSetAllChannels} className="text-[8px] uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition-colors">All</button>
            <button onClick={onSetNoChannels} className="text-[8px] uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition-colors">None</button>
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
          <input type="number" min="0" max="127" value={mapping.noteStart} onChange={(e) => onUpdate('noteStart', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none" />
          <span className="opacity-30">-</span>
          <input type="number" min="0" max="127" value={mapping.noteEnd} onChange={(e) => onUpdate('noteEnd', parseInt(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none" />
        </div>
      </div>

      {/* Notes Settings */}
      <div className="space-y-4 pt-6 border-t border-white/5">
        <label className="text-[10px] uppercase tracking-widest opacity-40">Notes Settings</label>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[8px] uppercase opacity-30">Fixed Duration</label>
            <button onClick={() => onUpdateNote('useFixedDuration', !ns.useFixedDuration)} className={`p-1 rounded ${ns.useFixedDuration ? 'text-red-500' : 'opacity-20'}`}>
              <Power size={12} />
            </button>
          </div>
          {ns.useFixedDuration && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
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
            </motion.div>
          )}
        </div>
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <label className="text-[8px] uppercase opacity-30">Fixed Velocity</label>
            <button onClick={() => onUpdateNote('useFixedVelocity', !ns.useFixedVelocity)} className={`p-1 rounded ${ns.useFixedVelocity ? 'text-red-500' : 'opacity-20'}`}>
              <Power size={12} />
            </button>
          </div>
          {ns.useFixedVelocity && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
              <input type="range" min="0" max="127" value={ns.fixedVelocity} onChange={(e) => onUpdateNote('fixedVelocity', parseInt(e.target.value))} className="flex-1 accent-red-500" />
              <span className="text-[10px] font-mono w-6">{ns.fixedVelocity}</span>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
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
    }
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>('layer-1');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [midiLogs, setMidiLogs] = useState<MidiLogEntry[]>([]);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'visual' | 'midi' | 'effects'>('visual');
  const [expandedSection, setExpandedSection] = useState<string | null>('layers');
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [selectedLayerForEffect, setSelectedLayerForEffect] = useState<string | null>(null);
  const [showEffectBrowser, setShowEffectBrowser] = useState(false);
  const [status, setStatus] = useState('STANDBY');
  const [showRoutingGuide, setShowRoutingGuide] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [resolutionScale, setResolutionScale] = useState(0.5); // Default to 50% for improved latency
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
          if (devices.length > 0 && !selectedDeviceId) setSelectedDeviceId(devices[0].id);
        };
        updateDevices();
        access.onstatechange = updateDevices;
      }).catch(err => {
        console.error("MIDI Access Error:", err);
      });
    } else {
      console.warn("Web MIDI API not supported in this browser.");
    }
  }, [selectedDeviceId]);

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
      setLayers(prev => prev.map(layer => {
        if (!layer.triggerMapping) return layer;
        const tr = layer.triggerMapping;
        if (tr.channels.includes(channel) && note >= tr.noteStart && note <= tr.noteEnd) {
          let activeUntil = null;
          const finalVelocity = tr.noteSettings.useFixedVelocity ? tr.noteSettings.fixedVelocity : velocity;
          
          if (tr.noteSettings.useFixedDuration) {
            const bpm = tr.noteSettings.bpm;
            const subdivision = tr.noteSettings.subdivision;
            const beatDuration = 60000 / bpm;
            let duration = beatDuration;
            if (subdivision === '1/2') duration = beatDuration * 2;
            if (subdivision === '1') duration = beatDuration * 4;
            if (subdivision === '1/4') duration = beatDuration;
            if (subdivision === '1/8') duration = beatDuration / 2;
            if (subdivision === '1/16') duration = beatDuration / 4;
            
            activeUntil = Date.now() + duration;
          }
          if (!tr.noteSettings.useFixedDuration && !isDown) {
            return { ...layer, isActive: false, triggerMapping: { ...tr, activeUntil: null, velocity: 0 } };
          }
          if (isDown) {
            return { ...layer, isActive: true, triggerMapping: { ...tr, activeUntil, velocity: finalVelocity } };
          }
          if (!isDown && tr.noteSettings.useFixedDuration) {
            return layer;
          }
        }
        return layer;
      }));

      // 3. Check Effect Mappings
      setLayers(prevLayers => prevLayers.map(layer => {
        let changed = false;
        const newMappings = layer.mappings.map(m => {
          if (m.channels.includes(channel) && note >= m.noteStart && note <= m.noteEnd) {
            changed = true;
            if (isDown) {
              let activeUntil = null;
              const finalVelocity = m.noteSettings.useFixedVelocity ? m.noteSettings.fixedVelocity : velocity;
              
              if (m.noteSettings.useFixedDuration) {
                const bpm = m.noteSettings.bpm;
                const subdivision = m.noteSettings.subdivision;
                const beatDuration = 60000 / bpm;
                let duration = beatDuration;
                if (subdivision === '1/2') duration = beatDuration * 2;
                if (subdivision === '1') duration = beatDuration * 4;
                if (subdivision === '1/4') duration = beatDuration;
                if (subdivision === '1/8') duration = beatDuration / 2;
                if (subdivision === '1/16') duration = beatDuration / 4;
                
                activeUntil = Date.now() + duration;
              }
              return { ...m, active: true, activeUntil, velocity: finalVelocity };
            } else {
              if (m.noteSettings.useFixedDuration) return m;
              return { ...m, active: false, activeUntil: null, velocity: 0 };
            }
          }
          return m;
        });
        return changed ? { ...layer, mappings: newMappings } : layer;
      }));
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

      // Check Layer Opacity Triggers
      setLayers(prev => prev.map(l => {
        if (l.midiCC === note) {
          return { ...l, opacity: velocity / 127 };
        }
        return l;
      }));
    }
  }, [layers, scenes]);

  useEffect(() => {
    if (!midiAccess || !selectedDeviceId) return;
    const input = midiAccess.inputs.get(selectedDeviceId);
    if (input) {
      input.onmidimessage = handleMidiMessage;
      return () => { input.onmidimessage = null; };
    }
  }, [midiAccess, selectedDeviceId, handleMidiMessage]);

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
        }
        
        if (!anyNeedsUpdate) return prevLayers;
        
        return prevLayers.map(layer => {
          let layerNeedsUpdate = layer.mappings.some(m => m.activeUntil && now >= m.activeUntil) || 
                                 (layer.triggerMapping?.activeUntil && now >= layer.triggerMapping.activeUntil);
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

    // Fixed composition dimensions so moving layers doesn't randomly resize the canvas
    const targetW = Math.floor(1920 * resolutionScale);
    const targetH = Math.floor(1080 * resolutionScale);

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

    const now = Date.now();
    const deltaTime = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    // Draw layers from bottom to top (reversed array so index 0 renders last/on top if we sort later, 
    // but the user asked drag and drop to make top cover bottom.
    // If Reorder.Group puts index 0 at top visually, then rendering index N then index 0 is what we want.
    // So we will reverse the `layers` array to render bottom visuals first.)
    const layersToDraw = [...layers].reverse();

    layersToDraw.forEach(layer => {
      const hasActiveEffect = layer.mappings.some(m => (m.active || m.manualActive) && !m.isMuted);
      const isVisibleNormally = layer.midiMode ? layer.isActive : layer.isVisible;
      
      if (!(isVisibleNormally || hasActiveEffect) || !layer.src) return;

      const element = layer.type === 'video' 
        ? videoRefs.current[layer.id] 
        : imageRefs.current[layer.id];

      if (element) {
        // Clear offscreen intermediate canvas for this layer
        ctx.clearRect(0, 0, targetW, targetH);
        
        const elW = (element as any).videoWidth || (element as HTMLImageElement).naturalWidth || targetW;
        const elH = (element as any).videoHeight || (element as HTMLImageElement).naturalHeight || targetH;
        
        // "object-fit: contain" without cropping
        const scale = Math.min(targetW / elW, targetH / elH);
        const destW = elW * scale;
        const destH = elH * scale;

        const x = (targetW - destW) / 2;
        const y = (targetH - destH) / 2;
        
        // Draw raw media to offscreen canvas without stretching, centered
        ctx.drawImage(element, x, y, destW, destH);

        // Store pure raw drawing unaffected by any effect logic loop overriding
        rawCtx.clearRect(0, 0, targetW, targetH);
        rawCtx.drawImage(element, x, y, destW, destH);

        // Process effects for this layer
        const activeMappings = layer.mappings.filter(m => (m.active || m.manualActive) && !m.isMuted);
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
    } // <-- Added closing bracket for if (mappingsToProcess.length > 0)

      // Finally, composite this layer's fully processed canvas onto the main canvas
      mainCtx.save();
      mainCtx.globalAlpha = layer.opacity;
      mainCtx.globalCompositeOperation = layer.blendMode;
      mainCtx.drawImage(canvas, 0, 0, targetW, targetH);
      mainCtx.restore();
      
      if (bufferCtxRef.current) {
        bufferCtxRef.current.save();
        bufferCtxRef.current.globalAlpha = layer.opacity;
        bufferCtxRef.current.globalCompositeOperation = layer.blendMode;
        bufferCtxRef.current.drawImage(canvas, 0, 0, targetW, targetH);
        bufferCtxRef.current.restore();
      }
    } // End if (element)
    });

    requestRef.current = requestAnimationFrame(processFrame);
  }, [layers, resolutionScale]);

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
        name: file.name
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
        velocity: 0
      };

      return { ...l, mappings: [...l.mappings, newMapping] };
    }));
    
    setSelectedEffectId(def.id);
    setSelectedLayerForEffect(layerId);
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
      {/* Background Atmosphere */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-red-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-1/2 h-1/2 bg-red-900/5 blur-[120px] rounded-full" />
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden relative z-50 p-4 flex justify-between items-center border-b border-white/5 bg-black/40 backdrop-blur-md">
        <button 
          onClick={() => setShowSidebar(!showSidebar)}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors"
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
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-[10px] font-mono tracking-widest opacity-40 uppercase">{status}</span>
          </div>
          
          <div className="flex items-center gap-2 ml-6 pl-6 border-l border-white/10" title={midiAccess ? 'MIDI Connected' : 'MIDI Offline'}>
            <Activity size={12} className={midiAccess ? 'text-emerald-500' : 'text-red-500 opacity-50'} />
            <span className="text-[10px] font-mono tracking-widest opacity-40 uppercase">MIDI IN</span>
          </div>
        </div>
        
        <h1 className="text-sm font-light tracking-[0.8em] uppercase opacity-80 absolute left-1/2 -translate-x-1/2">Glitch Pulse</h1>

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
      </header>

      <div className="flex-1 relative z-10 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar */}
        <aside className={`
          fixed inset-x-0 bottom-0 z-40 w-full bg-black/95 backdrop-blur-2xl border-t border-white/10
          lg:relative lg:inset-auto lg:z-0 lg:w-96 lg:border-t-0 lg:border-r lg:bg-black/20 lg:backdrop-blur-xl
          flex flex-col transition-all duration-500 ease-in-out
          ${showSidebar ? 'h-[70vh] lg:h-full translate-y-0' : 'h-0 lg:h-full translate-y-full lg:translate-y-0'}
        `}>
          <div className="flex-1 overflow-y-auto custom-scrollbar pb-20 lg:pb-0">
            <div className="lg:hidden p-4 flex justify-between items-center border-b border-white/5 sticky top-0 bg-black/80 backdrop-blur-md z-10">
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Settings</span>
              <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-white/5 rounded-full">
                <ChevronDown size={20} />
              </button>
            </div>

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
                    className="p-1 hover:bg-white/10 rounded transition-colors opacity-40 hover:opacity-100"
                    title="Refresh MIDI Devices"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <select 
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-red-500/50 transition-colors appearance-none"
                >
                  {midiDevices.map(d => <option key={d.id} value={d.id} className="bg-neutral-900">{d.name}</option>)}
                  {midiDevices.length === 0 && <option className="bg-neutral-900">No Devices Found</option>}
                </select>
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
                    className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-200/80 font-mono leading-relaxed space-y-2 overflow-hidden"
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

                <div className="bg-black/40 border border-white/5 rounded-lg p-3 h-32 overflow-y-auto font-mono text-[9px] space-y-1 custom-scrollbar">
                  {midiLogs.length === 0 && <div className="opacity-20 italic">Awaiting MIDI signal...</div>}
                  {midiLogs.map(log => (
                    <div key={log.id} className="flex justify-between items-center border-b border-white/5 pb-1">
                      <span className={log.type === 'ON' ? 'text-emerald-400' : 'opacity-40'}>CH {log.channel}</span>
                      <span className={log.type === 'ON' ? 'text-red-400' : 'opacity-40'}>NOTE {log.note}</span>
                      <span className="opacity-40">{log.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section 
            title="Layers Configuration" 
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
                    mappings: []
                  }]);
                  setActiveLayerId(newId);
                  setSelectedEffectId(null);
                  setSelectedLayerForEffect(null);
                }}
                className="w-full p-2 rounded border border-dashed border-white/10 hover:border-white/30 hover:bg-white/5 transition-all text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center justify-center gap-2"
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
                    className={`p-2 rounded-lg border transition-all cursor-pointer group ${activeLayerId === layer.id ? 'bg-white/10 border-white/20' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                  >
                    <div className="flex items-center justify-between" onClick={() => { setActiveLayerId(layer.id); setSelectedEffectId(null); setSelectedLayerForEffect(null); }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical size={14} className="opacity-20 cursor-grab active:cursor-grabbing hover:opacity-100 transition-opacity" />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, isVisible: !l.isVisible } : l));
                          }}
                          className={`p-1 rounded hover:bg-white/10 transition-colors ${layer.isVisible ? 'text-white' : 'text-white/20'} ${layer.midiMode ? 'opacity-30 cursor-not-allowed' : ''}`}
                          disabled={layer.midiMode}
                          title={layer.midiMode ? 'MIDI Mode Overrides Visibility' : 'Toggle Visibility'}
                        >
                          {layer.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, midiMode: !l.midiMode } : l));
                          }}
                          className={`p-1 rounded hover:bg-white/10 transition-colors ${layer.midiMode ? 'text-red-500' : 'text-white/20'}`}
                          title="MIDI Trigger Mode"
                        >
                          <Zap size={12} />
                        </button>
                        <span className="text-[11px] font-medium truncate opacity-80">{layer.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                              className="text-[9px] uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
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
                                className={`p-2 rounded border transition-all cursor-pointer ${m.active || m.manualActive ? 'bg-red-600/20 border-red-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'} ${selectedEffectId === m.id && selectedLayerForEffect === layer.id ? 'border-red-500' : ''}`}
                                onClick={() => {
                                  setSelectedEffectId(m.id);
                                  setSelectedLayerForEffect(layer.id);
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-[10px] font-medium ${m.active || m.manualActive ? 'text-red-400' : 'opacity-70'}`}>{m.name}</span>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); toggleManual(layer.id, m.id); }}
                                      className={`p-1 rounded transition-colors ${m.manualActive ? 'text-red-500' : 'opacity-20 hover:opacity-100'}`}
                                      title="Power"
                                    >
                                      <Power size={10} />
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); toggleSolo(layer.id, m.id); }}
                                      className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${m.isSoloed ? 'text-yellow-400 bg-yellow-400/10' : 'opacity-20 hover:opacity-100'}`}
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
                    className="w-full accent-red-500 opacity-60 hover:opacity-100 transition-opacity"
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
              className="lg:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            />
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 relative flex flex-col items-center justify-center p-2 sm:p-4 lg:p-12 min-w-0 overflow-hidden">
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

              <canvas ref={canvasRef} className="w-full h-full object-contain" />
              
              {layers.every(l => !l.src) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
                  <Maximize2 size={48} strokeWidth={1} />
                  <p className="text-xs uppercase tracking-[0.4em] mt-6">Awaiting Signal</p>
                </div>
              )}
            </div>

            {/* Playback Trigger */}
            <AnimatePresence>
              {!isPlaying && layers.some(l => l.src) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <button 
                    onClick={togglePlay}
                    className="pointer-events-auto w-24 h-24 rounded-full border border-white/20 bg-white/5 backdrop-blur-md flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-all group"
                  >
                    <Play size={24} className="ml-1 group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] uppercase tracking-widest font-bold">Start Engine</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Controls */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              <button onClick={togglePlay} className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-colors">
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <button 
                onClick={isRecording ? stopRecording : startRecording} 
                className={`p-3 rounded-full backdrop-blur-md border transition-all ${
                  isRecording ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'bg-white/10 border-white/10 hover:bg-white/20'
                }`}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
              >
                {isRecording ? <Square size={18} fill="currentColor" /> : <Circle size={18} fill="currentColor" className="text-red-500" />}
              </button>
              <button onClick={toggleFullScreen} className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-colors">
                <Maximize size={18} />
              </button>
            </div>
          </div>
        </main>

        {/* Right Sidebar: Effect Config */}
        <aside className="w-80 border-l border-white/5 bg-black/20 backdrop-blur-xl flex flex-col hidden lg:flex">
          <Section 
            title={selectedEffectId ? "Effect Configuration" : "Layer Configuration"} 
            icon={<Sliders size={16} />} 
            isExpanded={true} 
            onToggle={() => {}}
          >
            <div className="p-4 custom-scrollbar overflow-y-auto h-[calc(100vh-120px)]">
              {(() => {
                if (selectedEffectId && selectedLayerForEffect) {
                  const layerTarget = layers.find(l => l.id === selectedLayerForEffect);
                  const mapping = layerTarget?.mappings.find(m => m.id === selectedEffectId);
                  if (!mapping || !layerTarget) return <div className="p-4 text-center opacity-40 text-[10px] uppercase tracking-widest">Effect not found</div>;
                  
                  return (
                    <div className="space-y-8">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium text-red-400">{mapping.name}</h3>
                        <button onClick={() => { setSelectedEffectId(null); setSelectedLayerForEffect(null); }} className="text-[9px] uppercase opacity-40 hover:opacity-100">Close</button>
                      </div>

                      <div className="space-y-8">
                        {/* Engine Parameters */}
                        <div className="space-y-4">
                          <label className="text-[10px] uppercase tracking-widest opacity-40">Engine Parameters</label>
                          <div className="grid grid-cols-3 gap-4">
                            {(() => {
                              const definition = ALL_EFFECTS.find(e => e.id === selectedEffectId);
                              if (!definition) return null;
                              return definition.parameters.map(p => (
                                <Knob 
                                  key={p.id} label={p.name} min={p.min} max={p.max}
                                  value={Number(mapping.settings[p.id])} type={p.type}
                                  onChange={(val) => updateSetting(layerTarget.id, mapping.id, p.id, val)}
                                />
                              ));
                            })()}
                          </div>
                        </div>

                        <MidiConfigUI 
                          label="Effect MIDI Trigger"
                          mapping={mapping}
                          onUpdate={(field, val) => updateMapping(layerTarget.id, mapping.id, field as keyof EffectMapping, val)}
                          onUpdateNote={(field, val) => updateNoteSetting(layerTarget.id, mapping.id, field, val)}
                          onToggleChannel={(ch) => toggleChannel(layerTarget.id, mapping.id, ch)}
                          onSetAllChannels={() => setAllChannels(layerTarget.id, mapping.id)}
                          onSetNoChannels={() => setNoChannels(layerTarget.id, mapping.id)}
                        />
                      </div>
                    </div>
                  );
                } else if (activeLayerId) {
                  const layerTarget = layers.find(l => l.id === activeLayerId);
                  if (!layerTarget) return <div className="p-4 text-center opacity-40 text-[10px] uppercase tracking-widest">Layer not found</div>;
                  
                  return (
                    <div className="space-y-8">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium text-white/80">{layerTarget.name}</h3>
                      </div>
                      
                      {/* Media Source */}
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest opacity-40">Media Source</label>
                        <div className="relative group">
                          <input type="file" accept="video/*,image/*" onChange={(e) => handleFileUpload(e, layerTarget.id)} className="absolute inset-0 opacity-0 cursor-pointer" />
                          <div className="border border-white/10 p-3 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors flex items-center gap-3">
                            <Upload size={14} className="opacity-50" />
                            <span className="text-[10px] truncate">{layerTarget.src ? layerTarget.name : 'Load Media File'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Basic Config */}
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
                            className="w-full accent-red-500 h-1"
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

                      <div className="space-y-2">
                        <label className="text-[8px] uppercase opacity-40">Opacity MIDI CC (Optional)</label>
                        <input 
                          type="number" min="0" max="127" placeholder="N/A"
                          value={layerTarget.midiCC !== undefined ? layerTarget.midiCC : ''}
                          onChange={(e) => toggleLayerMidiCC(layerTarget.id, e.target.value ? parseInt(e.target.value) : undefined)}
                          className="w-full bg-black/40 border border-white/10 rounded p-1.5 text-[10px] outline-none"
                        />
                      </div>

                      <MidiConfigUI 
                        label="Layer MIDI Trigger"
                        mapping={layerTarget.triggerMapping}
                        onUpdate={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping, [field]: val } } : l))}
                        onUpdateNote={(field, val) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping, noteSettings: { ...l.triggerMapping.noteSettings, [field]: val } } } : l))}
                        onToggleChannel={(ch) => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping, channels: l.triggerMapping.channels.includes(ch) ? l.triggerMapping.channels.filter(c => c !== ch) : [...l.triggerMapping.channels, ch] } } : l))}
                        onSetAllChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping, channels: Array.from({length: 16}, (_, i) => i) } } : l))}
                        onSetNoChannels={() => setLayers(prev => prev.map(l => l.id === layerTarget.id ? { ...l, triggerMapping: { ...l.triggerMapping, channels: [] } } : l))}
                      />
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
          </Section>
        </aside>

      </div>

      {/* Footer Status Bar */}
      <footer className="p-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center px-4 sm:px-8 gap-4">
        <div className="flex flex-wrap gap-4 sm:gap-8 items-center justify-center">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${midiAccess ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-[9px] uppercase tracking-widest opacity-40">MIDI Status: {midiAccess ? 'Active' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${layers.some(l => l.src) ? 'bg-emerald-500' : 'bg-white/10'}`} />
            <span className="text-[9px] uppercase tracking-widest opacity-40">Engine: {status}</span>
          </div>
        </div>
        <div className="text-[9px] uppercase tracking-[0.4em] opacity-20 text-center">
          Glitch Pulse // Version 1.2.25
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>

      {/* Effect Browser Modal */}
      <AnimatePresence>
        {showEffectBrowser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEffectBrowser(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
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
                    
                    className="text-[9px] uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded hover:bg-white/10 transition-colors border border-white/5"
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
                    className="p-2 hover:bg-white/5 rounded-full transition-colors"
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
                      className={`group p-4 rounded-xl border transition-all flex flex-col justify-between ${isAdded ? 'bg-red-600/5 border-red-500/20 opacity-50' : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'}`}
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
                        className={`w-full py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${isAdded ? 'bg-transparent text-red-500/50 cursor-not-allowed' : 'bg-white/10 hover:bg-red-600 hover:text-white'}`}
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
        className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors group"
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
