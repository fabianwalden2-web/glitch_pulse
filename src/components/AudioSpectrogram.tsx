import React, { useRef, useEffect, useState } from 'react';
import { engine } from '../lib/audioEngine';

interface AudioSpectrogramProps {
  stemId: string;
  freqRange: [number, number];   // Current chosen freq limits e.g. [20, 200]
  threshold: number;             // Amplitude threshold 0.0 - 1.0
  onRangeChange: (newRange: [number, number]) => void;
  onThresholdChange: (newThreshold: number) => void;
}

export function AudioSpectrogram({ stemId, freqRange, threshold, onRangeChange, onThresholdChange }: AudioSpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Interaction State
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [dragType, setDragType] = useState<'left' | 'right' | 'center' | 'threshold' | null>(null);

  // Constants for rendering & logic
  const minHz = 20;
  const maxHz = 20000;
  
  // Convert Hz to log-scale X coordinate (0.0 to 1.0)
  const hzToX = (hz: number) => {
    const minL = Math.log10(minHz);
    const maxL = Math.log10(maxHz);
    const valL = Math.log10(Math.max(minHz, Math.min(hz, maxHz)));
    return (valL - minL) / (maxL - minL);
  };

  // Convert X coordinate (0.0 to 1.0) to Hz
  const xToHz = (x: number) => {
    const minL = Math.log10(minHz);
    const maxL = Math.log10(maxHz);
    return Math.pow(10, minL + x * (maxL - minL));
  };

  // Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Draw background grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      
      // Draw standard logarithmic Hz lines
      const gridHz = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ctx.beginPath();
      gridHz.forEach(hz => {
        const x = hzToX(hz) * width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      });
      ctx.stroke();

      // Pull current Live FFT data
      const data = engine.getRawFrequencyData(stemId);
      if (data) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        // data is 1024 bins representing 0 -> 22050Hz (Nyquist)
        // hzPerBin is approx 5.3 hz
        const hzPerBin = 44100 / 8192; 
        
        let first = true;
        for (let i = 0; i < data.length; i++) {
          const hz = Math.max(minHz, i * hzPerBin);
          if (hz > maxHz) break;
          
          const x = hzToX(hz) * width;
          const amplitude = data[i] / 255.0; // 0.0 -> 1.0
          const y = height - (amplitude * height);
          
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        // Fill area under graph softly
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.fillStyle = 'rgba(255, 255, 100, 0.1)';
        ctx.fill();
      }

      // Draw Selection Box (Frequency Range)
      const xStart = hzToX(freqRange[0]) * width;
      const xEnd = hzToX(freqRange[1]) * width;
      const yThresh = height - (threshold * height);

      ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
      ctx.fillRect(xStart, 0, xEnd - xStart, height);
      
      // Draw Bounding box left/right handles
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xStart, 0); ctx.lineTo(xStart, height);
      ctx.moveTo(xEnd, 0); ctx.lineTo(xEnd, height);
      ctx.stroke();

      // Draw Threshold horizontal line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yThresh);
      ctx.lineTo(width, yThresh);
      ctx.stroke();
      ctx.setLineDash([]);

      rafRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stemId, freqRange, threshold]);

  // Mouse Interaction Logic
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xFn = (e.clientX - rect.left) / rect.width;
    const yFn = (e.clientY - rect.top) / rect.height; // 0.0 top, 1.0 bottom

    // Check interaction zones
    const xStart = hzToX(freqRange[0]);
    const xEnd = hzToX(freqRange[1]);
    const yThresh = 1.0 - threshold;

    const HANDLE_W = 0.05; // 5% width tolerance

    if (Math.abs(yFn - yThresh) < 0.1) {
       setDragType('threshold');
    } else if (Math.abs(xFn - xStart) < HANDLE_W) {
       setDragType('left');
    } else if (Math.abs(xFn - xEnd) < HANDLE_W) {
       setDragType('right');
    } else if (xFn > xStart && xFn < xEnd) {
       setDragType('center');
    } else {
       // Clicking outside naturally starts a new box
       setDragType('right');
       const newHz = xToHz(xFn);
       onRangeChange([newHz, newHz * 1.5]); // Start a small box
    }
    
    setIsDraggingBox(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xFn = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yFn = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (!isDraggingBox) {
      const xStart = hzToX(freqRange[0]);
      const xEnd = hzToX(freqRange[1]);
      const yThresh = 1.0 - threshold;
      const HANDLE_W = 0.05;

      if (Math.abs(yFn - yThresh) < 0.1) {
        containerRef.current.style.cursor = 'ns-resize';
      } else if (Math.abs(xFn - xStart) < HANDLE_W || Math.abs(xFn - xEnd) < HANDLE_W || (xFn > xStart && xFn < xEnd)) {
        containerRef.current.style.cursor = 'ew-resize';
      } else {
        containerRef.current.style.cursor = 'crosshair';
      }
      return;
    }

    if (!dragType) return;

    if (dragType === 'threshold') {
       onThresholdChange(1.0 - yFn);
       return;
    }

    const currentHz = xToHz(xFn);

    if (dragType === 'left') {
       if (currentHz < freqRange[1]) onRangeChange([currentHz, freqRange[1]]);
    } else if (dragType === 'right') {
       if (currentHz > freqRange[0]) onRangeChange([freqRange[0], currentHz]);
    } else if (dragType === 'center') {
       // Move both by the delta... for simplicity right now we can just snap center to mouse
       // A proper implementation tracks the startX but this is fine for rough tuning.
       const span = (hzToX(freqRange[1]) - hzToX(freqRange[0]));
       const newLeftX = Math.max(0, xFn - span / 2);
       const newRightX = Math.min(1.0, newLeftX + span);
       onRangeChange([xToHz(newLeftX), xToHz(newRightX)]);
    }
  };

  const handlePointerUp = () => {
    setIsDraggingBox(false);
    setDragType(null);
  };

  return (
    <div className="space-y-1">
      <div 
        ref={containerRef}
        className="w-full h-32 bg-black/60 border border-white/10 rounded overflow-hidden relative touch-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <canvas ref={canvasRef} width={400} height={128} className="w-full h-full" />
        
        {/* Helper Labels overlay */}
        <div className="absolute bottom-1 left-1 text-[8px] text-white/40 pointer-events-none">20Hz</div>
        <div className="absolute bottom-1 right-1 text-[8px] text-white/40 pointer-events-none">20kHz</div>
        <div className="absolute top-1 right-1 text-[8px] text-white/40 pointer-events-none flex items-center gap-1">
          <span className="w-2 h-0.5 bg-red-500 block"></span> Range
        </div>
      </div>
      <div className="flex justify-between items-center text-[9px] opacity-60 font-mono">
        <span>{Math.round(freqRange[0])} Hz</span>
        <span>-</span>
        <span>{Math.round(freqRange[1])} Hz</span>
      </div>
    </div>
  );
}
