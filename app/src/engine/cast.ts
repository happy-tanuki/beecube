import { EntityRef } from './ref'
import type { Value } from './types'

/** Scratch-style number conversion: anything non-numeric becomes 0. */
export function toNumber(v: Value | undefined): number {
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined || v instanceof EntityRef) return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

export function toBoolean(v: Value | undefined): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (v === undefined) return false
  if (v instanceof EntityRef) return true
  const s = v.toLowerCase()
  return s !== '' && s !== '0' && s !== 'false'
}

export function toText(v: Value | undefined): string {
  if (v === undefined) return ''
  return String(v)
}

function isWhitespace(s: string): boolean {
  return s.trim().length === 0
}

/** Parses a value as a number for comparison, or returns null if it is not numeric. */
function numericOrNull(v: Value): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'boolean' || v instanceof EntityRef) return null
  if (isWhitespace(v)) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * Scratch comparison: numeric when both sides look like numbers, otherwise a
 * case-insensitive string comparison.
 */
export function compare(a: Value, b: Value): number {
  // Two references are equal when they name the same entity.
  if (a instanceof EntityRef && b instanceof EntityRef) return a.handle - b.handle
  const na = numericOrNull(a)
  const nb = numericOrNull(b)
  if (na !== null && nb !== null) return na - nb
  const sa = String(a).toLowerCase()
  const sb = String(b).toLowerCase()
  if (sa < sb) return -1
  if (sa > sb) return 1
  return 0
}
