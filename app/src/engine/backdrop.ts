/**
 * Backdrops, as Scratch's. A 3D backdrop dresses the stage's box: the
 * workplane's walls (from the floor up to the height of Scratch's stage),
 * its floor and its ceiling, each a color or transparent, and the scenery
 * outside the box. A project has one or more, and one is the current
 * backdrop; scripts switch between them.
 */
import type { Random } from './random'
import type { Value } from './types'

/** The box's faces: back is +y (away from the home view), left is -x. */
export const FACES = ['floor', 'ceiling', 'back', 'front', 'left', 'right'] as const
export type FaceName = (typeof FACES)[number]

/** How high the walls are dressed (they stop sprites at any height). */
export const WALL_HEIGHT = 360

export interface Face {
  /** null for transparent. */
  color: string | null
}

export interface BackdropData {
  id: string
  name: string
  /** The color outside the box. */
  scenery: string
  faces: Record<FaceName, Face>
  /** The grid, the axes and the workplane's border. */
  grid: boolean
}

/** Menu values of "switch backdrop to" besides the backdrops' names (as in Scratch). */
export const NEXT_BACKDROP = 'next backdrop'
export const PREVIOUS_BACKDROP = 'previous backdrop'
export const RANDOM_BACKDROP = 'random backdrop'

let idCounter = 0
export const newBackdropId = (): string => `backdrop-${Date.now().toString(36)}-${idCounter++}`

/** The look of the stage before backdrops: a pale floor with the grid, and transparent walls. */
export function plainBackdrop(name: string): BackdropData {
  const faces = Object.fromEntries(FACES.map((f) => [f, { color: null }])) as Record<FaceName, Face>
  faces.floor.color = '#dbe7f7'
  return { id: newBackdropId(), name, scenery: '#f4f7fb', faces, grid: true }
}

/**
 * The name a backdrop gets when the user asks for `wanted`: null if empty,
 * otherwise `wanted`, or, if another backdrop has it, the same name with the
 * first free number.
 */
export function availableBackdropName(wanted: string, others: string[]): string | null {
  const name = wanted.trim()
  if (name === '') return null
  if (!others.includes(name)) return name
  const base = name.replace(/\d+$/, '')
  let n = 2
  while (others.includes(`${base}${n}`)) n++
  return `${base}${n}`
}

export class Backdrops {
  list: BackdropData[]
  /** Index of the current backdrop. */
  current = 0
  /** Changes whenever a backdrop or the current one changes, so the stage redraws. */
  revision = 0

  constructor(list: BackdropData[] = [plainBackdrop('backdrop1')]) {
    this.list = list
  }

  get backdrop(): BackdropData {
    return this.list[this.current]
  }

  set(list: BackdropData[], current: number): void {
    this.list = list.length > 0 ? list : [plainBackdrop('backdrop1')]
    this.current = Math.min(Math.max(0, Math.floor(current) || 0), this.list.length - 1)
    this.changed()
  }

  changed(): void {
    this.revision++
  }

  select(index: number): void {
    this.current = index
    this.changed()
  }

  /**
   * The index "switch backdrop to (v)" picks, or -1 for none: a backdrop's
   * name first, then next / previous / random, then a number (1 is the
   * first; numbers wrap around).
   */
  resolve(v: Value, random: Random): number {
    const n = this.list.length
    const text = String(v)
    const named = this.list.findIndex((b) => b.name === text)
    if (named >= 0) return named
    if (text === NEXT_BACKDROP) return (this.current + 1) % n
    if (text === PREVIOUS_BACKDROP) return (this.current + n - 1) % n
    if (text === RANDOM_BACKDROP) {
      if (n < 2) return this.current
      // Another one than the current.
      const pick = Math.floor(random.next() * (n - 1))
      return pick >= this.current ? pick + 1 : pick
    }
    if (typeof v === 'boolean' || text.trim() === '') return -1
    const num = Number(text)
    if (!Number.isFinite(num)) return -1
    return (((Math.round(num) - 1) % n) + n) % n
  }
}
