/**
 * Backdrops, as Scratch's. A 3D backdrop dresses the stage's box: the
 * workplane's walls (from the floor up to the height of Scratch's stage),
 * its floor and its ceiling, each a color or transparent with a picture on
 * it, and the scenery outside the box (a color or a 360° image). A project
 * has one or more, and one is the current backdrop; scripts switch between
 * them.
 */
import type { AssetRef } from './assets'
import { resolveSwitch } from './costume'
import type { Random } from './random'
import { availableName } from './rename'
import { STAGE_HEIGHT, STAGE_WIDTH, type Value } from './types'

/** The box's faces: back is +y (away from the home view), left is -x. */
export const FACES = ['floor', 'ceiling', 'back', 'front', 'left', 'right'] as const
export type FaceName = (typeof FACES)[number]

/** How high the walls are dressed (they stop sprites at any height). */
export const WALL_HEIGHT = 360

export interface Face {
  /** null for transparent. */
  color: string | null
  /** Covers the whole face, over its color; null for none. */
  picture: AssetRef | null
}

/** Each face's size: across, and up the walls or towards the back on the floor and the ceiling. */
export const FACE_SIZE: Record<FaceName, [number, number]> = {
  floor: [STAGE_WIDTH, STAGE_HEIGHT],
  ceiling: [STAGE_WIDTH, STAGE_HEIGHT],
  back: [STAGE_WIDTH, WALL_HEIGHT],
  front: [STAGE_WIDTH, WALL_HEIGHT],
  left: [STAGE_HEIGHT, WALL_HEIGHT],
  right: [STAGE_HEIGHT, WALL_HEIGHT],
}

export interface BackdropData {
  id: string
  name: string
  /** The color outside the box. */
  scenery: string
  /** A 360° image (equirectangular) all round, far away, in place of the color; its middle is ahead (+y). null for none. */
  sceneryPicture: AssetRef | null
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
  const faces = Object.fromEntries(FACES.map((f) => [f, { color: null, picture: null }])) as Record<FaceName, Face>
  faces.floor.color = '#dbe7f7'
  return { id: newBackdropId(), name, scenery: '#f4f7fb', sceneryPicture: null, faces, grid: true }
}

/** The name a backdrop gets when the user asks for `wanted` (see availableName). */
export const availableBackdropName = availableName

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

  /** The index "switch backdrop to (v)" picks, or -1 for none (see resolveSwitch). */
  resolve(v: Value, random: Random): number {
    return resolveSwitch(
      this.list.map((b) => b.name),
      this.current,
      v,
      random,
      { next: NEXT_BACKDROP, previous: PREVIOUS_BACKDROP, random: RANDOM_BACKDROP },
    )
  }
}
