/**
 * Pure operations behind blocks. Generated code calls these at run time and
 * the compiler calls the same functions to fold constants, so a value is the
 * same whether it was computed early or late.
 */
import { compare, toBoolean, toNumber, toText } from './cast'
import { TICKS_PER_SECOND, type Value } from './types'

export { compare, toBoolean, toNumber, toText }

const DEG = Math.PI / 180

/** Scratch's modulo: the result has the sign of the divisor. */
export function mod(n: number, m: number): number {
  const r = n % m
  return r !== 0 && r / m < 0 ? r + m : r
}

export function mathop(op: string, n: number): number {
  switch (op) {
    case 'abs': return Math.abs(n)
    case 'floor': return Math.floor(n)
    case 'ceiling': return Math.ceil(n)
    case 'sqrt': return Math.sqrt(n)
    case 'sin': return sin(n)
    case 'cos': return cos(n)
    case 'tan': return Math.tan(n * DEG)
    case 'asin': return Math.asin(n) / DEG
    case 'acos': return Math.acos(n) / DEG
    case 'atan': return Math.atan(n) / DEG
    case 'ln': return Math.log(n)
    case 'log': return Math.log10(n)
    case 'e ^': return Math.exp(n)
    case '10 ^': return Math.pow(10, n)
    default: return 0
  }
}

/** Sine of degrees, rounded as Scratch does so that sin(180) is 0. */
export function sin(deg: number): number {
  return Math.round(Math.sin(deg * DEG) * 1e10) / 1e10
}

export function cos(deg: number): number {
  return Math.round(Math.cos(deg * DEG) * 1e10) / 1e10
}

export function letterOf(index: number, s: string): string {
  const n = Math.floor(index)
  return n >= 1 && n <= s.length ? s[n - 1] : ''
}

export function contains(s: string, t: string): boolean {
  return s.toLowerCase().includes(t.toLowerCase())
}

/** Rounds reporter values to 6 decimals, hiding float noise (0.1 + 0.2). */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** Wraps to Scratch's direction range (-180, 180]. */
export function wrapDirection(d: number): number {
  if (d > -180 && d <= 180) return d
  const w = ((d % 360) + 360) % 360
  return w > 180 ? w - 360 : w
}

/** Seconds to wait → whole ticks, at least one. */
export function waitTicks(secs: number): number {
  const t = Math.ceil(secs * TICKS_PER_SECOND - 1e-9)
  return t >= 1 ? t : 1
}

export function clampPitch(p: number): number {
  return Math.max(-90, Math.min(90, p))
}

export function clampSize(s: number): number {
  return Math.max(5, Math.min(1000, s))
}

/** Width, depth and height run from 1% to 2000% of the shape's size. */
export function clampDimension(d: number): number {
  return Math.max(1, Math.min(2000, d))
}

export function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/** Pen sizes run from 1 to 1200, as in Scratch. */
export function clampPenSize(s: number): number {
  return Math.max(1, Math.min(1200, s))
}

/** Whether a "pick random" bound counts as a whole number (so the result is one too). */
export function isWholeBound(v: Value): boolean {
  return Number.isInteger(toNumber(v)) && !String(v).includes('.')
}

/**
 * Text that reads as a number and prints back the same (`10`, `-2.5`, not
 * `007` or `1.0`). Such text in an input is compiled as a number, which no
 * block can tell apart from the text.
 */
export function isCanonicalNumber(s: string): boolean {
  return s !== '' && String(Number(s)) === s
}

/** Parses `#rrggbb` to a 0xRRGGBB integer. */
export function colorToInt(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  return Number.isNaN(n) ? 0 : n
}

export function intToColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export function isColorString(v: Value): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

/** 0xRRGGBB to hue, saturation and brightness, each 0–100 (as the pen's color blocks use them). */
export function rgbToHsv(rgb: number): [number, number, number] {
  const r = ((rgb >> 16) & 0xff) / 255
  const g = ((rgb >> 8) & 0xff) / 255
  const b = (rgb & 0xff) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [(h / 6) * 100, max === 0 ? 0 : (d / max) * 100, max * 100]
}

/** Hue, saturation and brightness (0–100; hue wraps) to 0xRRGGBB. */
export function hsvToRgb(h: number, s: number, v: number): number {
  const hue = (mod(h, 100) / 100) * 6
  const sat = s / 100
  const val = v / 100
  const channel = (n: number) => {
    const k = (n + hue) % 6
    return Math.round((val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return (channel(5) << 16) | (channel(3) << 8) | channel(1)
}

// ---- lists ----------------------------------------------------------------

/** As in Scratch, a list stops growing at this many items. */
export const MAX_LIST_LENGTH = 200000

/**
 * Turns a block's index into a 1-based position in a list of `length` items,
 * or 0 if it points nowhere. Accepts "last" and "random" as Scratch does;
 * `extra` allows one past the end (for insert). `random` is in [0, 1).
 */
export function listIndex(v: Value, length: number, random: number, extra = 0): number {
  const limit = length + extra
  if (typeof v === 'string') {
    const word = v.trim().toLowerCase()
    if (word === 'last') return length > 0 ? limit : 0
    if (word === 'random' || word === 'any') return limit > 0 ? 1 + Math.floor(random * limit) : 0
  }
  const n = Math.floor(toNumber(v))
  return n >= 1 && n <= limit ? n : 0
}

export const sameItem = (a: Value, b: Value) => compare(a, b) === 0

/** What a list reporter shows: items joined by spaces, or run together if every item is one character. */
export function listText(items: readonly Value[]): string {
  const texts = items.map(toText)
  return texts.every((t) => t.length === 1) ? texts.join('') : texts.join(' ')
}
