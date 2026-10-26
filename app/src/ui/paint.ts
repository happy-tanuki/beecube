/**
 * The picture editor's drawing that doesn't need a canvas (see
 * PaintEditor.tsx): filling an area, and the guide that shows where each
 * part of a shape goes on a costume's picture (engine/costume.ts).
 */
import { NET_COLUMNS, NET_ROWS, type CostumeLayout } from '../engine/costume'
import type { ShapeKind } from '../engine/types'
import type { MessageKey } from '../i18n'

/** An image's pixels, as ImageData holds them (RGBA, row by row). */
export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type Rgba = [number, number, number, number]

/**
 * Fills the area around (x, y) of pixels like the one there, as a paint
 * bucket does: within `tolerance` in each of red, green, blue and alpha.
 * Returns whether anything changed.
 */
export function floodFill(p: Pixels, x: number, y: number, color: Rgba, tolerance = 32): boolean {
  const { data, width, height } = p
  x = Math.floor(x)
  y = Math.floor(y)
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  const start = (y * width + x) * 4
  const target: Rgba = [data[start], data[start + 1], data[start + 2], data[start + 3]]
  if (target.every((v, k) => v === color[k])) return false
  const like = (i: number) =>
    Math.abs(data[i] - target[0]) <= tolerance &&
    Math.abs(data[i + 1] - target[1]) <= tolerance &&
    Math.abs(data[i + 2] - target[2]) <= tolerance &&
    Math.abs(data[i + 3] - target[3]) <= tolerance
  const done = new Uint8Array(width * height)
  // Scanlines: fill a run of the row, then start runs above and below it where they begin.
  const stack = [x, y]
  /** Whether (sx, ny) is to be filled, starting a run there if the pixel before it wasn't. */
  const look = (sx: number, ny: number, before: boolean): boolean => {
    if (ny < 0 || ny >= height) return false
    const m = ny * width + sx
    const open = !done[m] && like(m * 4)
    if (open && !before) stack.push(sx, ny)
    return open
  }
  while (stack.length > 0) {
    const sy = stack.pop()!
    let sx = stack.pop()!
    while (sx > 0 && !done[sy * width + sx - 1] && like((sy * width + sx - 1) * 4)) sx--
    let above = false
    let below = false
    for (; sx < width; sx++) {
      const n = sy * width + sx
      if (done[n] || !like(n * 4)) break
      done[n] = 1
      data.set(color, n * 4)
      above = look(sx, sy - 1, above)
      below = look(sx, sy + 1, below)
    }
  }
  return true
}

/** "#rrggbb" ↔ RGBA. */
export function hexToRgba(hex: string): Rgba {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** A part of a guide, in fractions of the picture's width and height (y down), with its name. */
export type GuidePart =
  | { kind: 'rect' | 'circle'; x: number; y: number; w: number; h: number; label: MessageKey }
  | { kind: 'line'; x: number; label: MessageKey }

const cell = (column: number, row: number, label: MessageKey): GuidePart => ({
  kind: 'rect',
  x: column / NET_COLUMNS,
  y: row / NET_ROWS,
  w: 1 / NET_COLUMNS,
  h: 1 / NET_ROWS,
  label,
})

/** Where each part of a shape goes on a costume's picture: none when every side shows the whole picture. */
export function costumeGuide(shape: ShapeKind, layout: CostumeLayout): GuidePart[] {
  const end = (row: number, label: MessageKey): GuidePart => ({ kind: 'circle', x: 0.375, y: row / NET_ROWS, w: 0.25, h: 1 / NET_ROWS, label })
  if (shape === 'sphere') {
    // A globe: the front in the middle, the back at both edges.
    return [
      { kind: 'line', x: 0.5, label: 'costume.part.front' },
      { kind: 'line', x: 0, label: 'costume.part.back' },
    ]
  }
  if (layout === 'same') return []
  switch (shape) {
    case 'cube':
      return [
        cell(1, 0, 'costume.part.top'),
        cell(0, 1, 'costume.part.right'),
        cell(1, 1, 'costume.part.front'),
        cell(2, 1, 'costume.part.left'),
        cell(3, 1, 'costume.part.back'),
        cell(1, 2, 'costume.part.bottom'),
      ]
    case 'cylinder':
      return [end(0, 'costume.part.top'), { kind: 'rect', x: 0, y: 1 / 3, w: 1, h: 1 / 3, label: 'costume.part.side' }, end(2, 'costume.part.bottom')]
    case 'cone':
      return [{ kind: 'rect', x: 0, y: 0, w: 1, h: 2 / 3, label: 'costume.part.side' }, end(2, 'costume.part.base')]
  }
}

/** The size of a new costume picture: a net's grid of squares, a globe twice as wide as tall, or a square. */
export function newCostumeSize(shape: ShapeKind, layout: CostumeLayout): [number, number] {
  if (shape === 'sphere') return [1024, 512]
  return layout === 'net' ? [1024, 768] : [512, 512]
}
