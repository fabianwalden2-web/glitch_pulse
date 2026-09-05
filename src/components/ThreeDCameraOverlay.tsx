import React, { useCallback, useEffect, useRef } from 'react';

interface ThreeDCameraOverlayProps {
  active: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onOrbit: (dPitch: number, dYaw: number) => void;
  onPan: (dxNdc: number, dyNdc: number) => void;
  onZoom: (factor: number) => void;
  onDoubleClickNDC: (ndcX: number, ndcY: number) => void;
  onMoveAnchor: (dir: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward') => void;
  onDragEnd: () => void;
}

// The first pointer-interaction system in this app's preview canvas: mouse
// orbit/pan/zoom + double-click anchor placement + arrow-key anchor movement
// for 3D-asset layers. Scoped inert (pointer-events: none) unless `active`.
export function ThreeDCameraOverlay({
  active, canvasRef, onOrbit, onPan, onZoom, onDoubleClickNDC, onMoveAnchor, onDragEnd,
}: ThreeDCameraOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ mode: 'orbit' | 'pan'; lastX: number; lastY: number } | null>(null);

  const getLetterbox = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const targetW = canvas.width, targetH = canvas.height;
    if (rect.width === 0 || rect.height === 0 || targetW === 0 || targetH === 0) return null;
    const boxAspect = rect.width / rect.height;
    const contentAspect = targetW / targetH;
    let renderedW: number, renderedH: number, offsetX: number, offsetY: number;
    if (boxAspect > contentAspect) {
      renderedH = rect.height;
      renderedW = renderedH * contentAspect;
      offsetX = (rect.width - renderedW) / 2;
      offsetY = 0;
    } else {
      renderedW = rect.width;
      renderedH = renderedW / contentAspect;
      offsetX = 0;
      offsetY = (rect.height - renderedH) / 2;
    }
    return { rect, renderedW, renderedH, offsetX, offsetY };
  }, [canvasRef]);

  const clientToNdc = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const lb = getLetterbox();
    if (!lb) return null;
    const localX = clientX - lb.rect.left - lb.offsetX;
    const localY = clientY - lb.rect.top - lb.offsetY;
    if (localX < 0 || localY < 0 || localX > lb.renderedW || localY > lb.renderedH) return null;
    const ndcX = (localX / lb.renderedW) * 2 - 1;
    const ndcY = -(localY / lb.renderedH) * 2 + 1;
    return [ndcX, ndcY];
  }, [getLetterbox]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragState.current = { mode: e.button === 2 ? 'pan' : 'orbit', lastX: e.clientX, lastY: e.clientY };
  }, [active]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!active || !dragState.current) return;
    const dx = e.clientX - dragState.current.lastX;
    const dy = e.clientY - dragState.current.lastY;
    dragState.current.lastX = e.clientX;
    dragState.current.lastY = e.clientY;
    const lb = getLetterbox();
    const norm = lb ? Math.max(1, lb.renderedW) : 800;
    if (dragState.current.mode === 'orbit') {
      onOrbit(-dy * (180 / norm), -dx * (270 / norm));
    } else {
      onPan(dx / norm, dy / norm);
    }
  }, [active, getLetterbox, onOrbit, onPan]);

  const endDrag = useCallback(() => {
    if (dragState.current) { dragState.current = null; onDragEnd(); }
  }, [onDragEnd]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!active) return;
    e.preventDefault();
    onZoom(1 + e.deltaY * 0.0015);
    onDragEnd();
  }, [active, onZoom, onDragEnd]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!active) return;
    const ndc = clientToNdc(e.clientX, e.clientY);
    if (ndc) onDoubleClickNDC(ndc[0], ndc[1]);
  }, [active, clientToNdc, onDoubleClickNDC]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const map: Record<string, 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward'> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        PageUp: 'forward', PageDown: 'backward',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      onMoveAnchor(dir);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onMoveAnchor]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'grab' : 'default' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => { if (active) e.preventDefault(); }}
      title={active ? 'Drag to orbit, right-drag to pan, scroll to zoom, double-click to place anchor, arrow keys to move anchor' : undefined}
    />
  );
}
