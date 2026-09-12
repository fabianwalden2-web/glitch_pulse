/**
 * The mark library: the small vector shapes that Mosaic-style generatives stamp
 * in place of pixels.
 *
 * A "mark" is just an SVG (or raster image) held as a data URL, so a set of them
 * travels inside a saved project with no external files to lose. Marks are
 * rasterised once into a square stamp and then blitted per cell; nothing here
 * re-parses SVG per frame.
 *
 * Stamps come in three flavours and the cache is keyed on which:
 *   - the mark's own colours, for artwork uploaded ready-coloured;
 *   - a flat tint, for the palette-driven look;
 *   - a white silhouette, used as a matte so a whole grid of marks can be
 *     filled from the source image in one `source-in` composite rather than one
 *     tint per cell.
 */

export interface MarkSlot {
  /** Stable id, used as the cache key so long data URLs never get hashed. */
  id: string;
  name: string;
  /** Data URL — `image/svg+xml`, PNG or JPEG. */
  src: string;
}

const svg = (body: string) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`
  );

/**
 * The fallback set, ordered densest first, so a straight tone ramp across the
 * slots already reads as a halftone before anything has been uploaded.
 */
export const BUILTIN_MARKS: MarkSlot[] = [
  { id: 'b:square',   name: 'Square',   src: svg('<rect x="4" y="4" width="56" height="56" fill="#000"/>') },
  { id: 'b:circle',   name: 'Circle',   src: svg('<circle cx="32" cy="32" r="28" fill="#000"/>') },
  { id: 'b:diamond',  name: 'Diamond',  src: svg('<path d="M32 2 62 32 32 62 2 32Z" fill="#000"/>') },
  { id: 'b:triangle', name: 'Triangle', src: svg('<path d="M32 4 60 58H4Z" fill="#000"/>') },
  { id: 'b:ring',     name: 'Ring',     src: svg('<circle cx="32" cy="32" r="23" fill="none" stroke="#000" stroke-width="13"/>') },
  { id: 'b:cross',    name: 'Cross',    src: svg('<path d="M25 4h14v21h21v14H39v21H25V39H4V25h21Z" fill="#000"/>') },
];

/** Everything an uploaded file has to clear before it becomes a mark. */
export const MARK_ACCEPT = 'image/svg+xml,image/png,image/jpeg,.svg,.png,.jpg,.jpeg';
export const MARK_MAX_BYTES = 512 * 1024;

/**
 * Read a dropped or chosen file into a slot. Rejects anything too big to sit
 * comfortably inside a saved project, and anything that is not an image.
 */
export function readMarkFile(file: File): Promise<MarkSlot> {
  return new Promise((resolve, reject) => {
    const ok = /^image\/(svg\+xml|png|jpeg)$/.test(file.type) || /\.(svg|png|jpe?g)$/i.test(file.name);
    if (!ok) return reject(new Error('Marks must be an SVG, PNG or JPEG.'));
    if (file.size > MARK_MAX_BYTES) return reject(new Error('Marks must be under 512 KB.'));
    const fr = new FileReader();
    fr.onload = () => resolve({
      id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: file.name.replace(/\.[^.]+$/, ''),
      src: String(fr.result),
    });
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
}

const images = new Map<string, HTMLImageElement>();
const loading = new Set<string>();
const failed = new Set<string>();

/**
 * The decoded image for a mark, or null while it is still loading — callers
 * draw what they have and pick the rest up on a later frame rather than
 * blocking the render loop.
 */
function markImage(src: string): HTMLImageElement | null {
  const hit = images.get(src);
  if (hit) return hit;
  if (loading.has(src) || failed.has(src)) return null;
  loading.add(src);
  const img = new Image();
  img.onload = () => { images.set(src, img); loading.delete(src); };
  img.onerror = () => { loading.delete(src); failed.add(src); };
  img.src = src;
  return null;
}

const STAMP_PX = 128;
const stamps = new Map<string, HTMLCanvasElement>();

/**
 * A square stamp for one mark, rasterised at a fixed size and scaled down per
 * cell. `tint` null keeps the mark's own colours; any colour replaces them,
 * keeping only the silhouette.
 */
export function markStamp(slot: MarkSlot, tint: string | null): HTMLCanvasElement | null {
  const key = slot.id + '|' + (tint || '-');
  const hit = stamps.get(key);
  if (hit) return hit;
  const img = markImage(slot.src);
  if (!img) return null;

  const c = document.createElement('canvas');
  c.width = c.height = STAMP_PX;
  const g = c.getContext('2d')!;
  // SVGs without intrinsic dimensions report 0 in some engines; a square box is
  // the only sane assumption left at that point.
  const iw = img.naturalWidth || STAMP_PX, ih = img.naturalHeight || STAMP_PX;
  const s = Math.min(STAMP_PX / iw, STAMP_PX / ih);
  g.drawImage(img, (STAMP_PX - iw * s) / 2, (STAMP_PX - ih * s) / 2, iw * s, ih * s);
  if (tint) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = tint;
    g.fillRect(0, 0, STAMP_PX, STAMP_PX);
  }
  stamps.set(key, c);
  // Slots turn over as the operator swaps artwork; a handful of tints per slot
  // keeps this tiny, but do not let a long session grow it without bound.
  if (stamps.size > 96) stamps.delete(stamps.keys().next().value as string);
  return c;
}

/** The slots a layer actually draws with, falling back to the built-in set. */
export function resolveMarkSlots(slots: MarkSlot[] | undefined | null): MarkSlot[] {
  const used = (slots || []).filter(s => s && s.src);
  return used.length ? used : BUILTIN_MARKS;
}
