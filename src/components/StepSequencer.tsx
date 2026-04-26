import React, { useEffect, useRef, useState } from 'react';

interface StepSequencerProps {
  bpm: number;
  pattern: string;
  customPattern?: boolean[];
  onCustomPatternChange?: (newPattern: boolean[]) => void;
}

export function StepSequencer({ bpm, pattern, customPattern, onCustomPatternChange }: StepSequencerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(0);

  // Map pre-programmed patterns to 16-step visual arrays
  const getVisualPattern = (pat: string, custom: boolean[] | undefined): boolean[] => {
    if (pat === 'Custom') return custom || new Array(16).fill(false);
    
    let arr = new Array(16).fill(false);
    switch (pat) {
      case '4-on-the-Floor':
        arr[0] = arr[4] = arr[8] = arr[12] = true;
        break;
      case 'Backbeat':
        arr[4] = arr[12] = true;
        break;
      case 'Off-Beat':
        arr[2] = arr[6] = arr[10] = arr[14] = true;
        break;
      case 'Straight Eighths':
        for (let i = 0; i < 16; i += 2) arr[i] = true;
        break;
      case 'Straight Sixteenths':
        arr.fill(true);
        break;
      case 'The "One"':
        arr[0] = true;
        break;
      case 'Eighth-Note Triplets':
      case 'Quarter-Note Triplets':
        // Mathematically complex to represent cleanly on 16 grid so we return empty/dimmed
        return arr;
    }
    return arr;
  };

  const activePattern = getVisualPattern(pattern, customPattern);
  const isCustom = pattern === 'Custom';

  useEffect(() => {
    let animationId: number;
    let isActive = true;

    const tick = () => {
      if (!isActive) return;
      const now = performance.now() / 1000.0;
      const beatTime = now * (bpm / 60.0);
      // 4 beats per bar, 4 sixteenths per beat = 16 steps total
      const sixteenths = Math.floor(beatTime * 4);
      const step = sixteenths % 16;

      if (step !== currentStep) {
        setCurrentStep(step);
      }
      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);
    return () => {
      isActive = false;
      cancelAnimationFrame(animationId);
    };
  }, [bpm, currentStep]);

  const handleSquareClick = (index: number) => {
    if (!isCustom || !onCustomPatternChange) return;
    const newPat = customPattern ? [...customPattern] : new Array(16).fill(false);
    newPat[index] = !newPat[index];
    onCustomPatternChange(newPat);
  };

  return (
    <div className="w-full flex flex-col select-none mt-2">
      <div className="grid grid-cols-4 gap-2 w-full">
        {[0, 1, 2, 3].map(beat => (
          <div key={beat} className="flex flex-col gap-1">
            <span className="text-[8px] font-bold opacity-40 uppercase tracking-[widest] px-0.5">{beat + 1}</span>
            <div className="grid grid-cols-4 gap-[2px] bg-black/40 p-1 border border-white/10 rounded">
              {[0, 1, 2, 3].map(sub => {
                const i = beat * 4 + sub;
                const isActive = activePattern[i];
                const isPlayhead = currentStep === i;
                
                return (
                  <div
                    key={i}
                    onClick={() => handleSquareClick(i)}
                    className={`
                      aspect-square rounded-[2px] transition-all duration-75 cursor-pointer flex
                      ${isCustom ? 'hover:border hover:border-white/40' : ''}
                      ${isPlayhead 
                        ? 'bg-white/60 shadow-[0_0_8px_rgba(255,255,255,0.4)] scale-110 z-10' 
                        : isActive 
                          ? 'bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.4)]' 
                          : 'bg-white/5'
                      }
                    `}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
