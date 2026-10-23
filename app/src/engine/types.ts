/**
 * Shared types and constants.
 *
 * Coordinates: x/y span the workplane (the Scratch stage, 480×360 units),
 * z is height. `direction` follows Scratch (0 = +y, 90 = +x, clockwise seen
 * from above); `pitch` is elevation in degrees (+90 = straight up); `roll`
 * turns the sprite about its heading. Orientation = yaw, then pitch, then roll.
 */

import type { EntityRef } from './ref'

export type ShapeKind = 'cube' | 'sphere' | 'cone' | 'cylinder'

/** Shapes by their index in the store's `shape` column. */
export const SHAPES: readonly ShapeKind[] = ['cube', 'sphere', 'cone', 'cylinder']

/** Values of variables, lists and reporters. EntityRef is a sprite reference (ref.ts). */
export type Value = string | number | boolean | EntityRef

export interface PenState {
  down: boolean
  /** `#rrggbb` */
  color: string
  /** 0–100; 0 when absent. */
  transparency?: number
  /** 1–1200; 1 when absent. */
  size?: number
}

/** A Blockly workspace serialized with `Blockly.serialization.workspaces.save`. */
export interface WorkspaceJson {
  blocks?: { languageVersion?: number; blocks: BlockJson[] }
  variables?: { id: string; name: string; type?: string }[]
  [key: string]: unknown
}

/** One block in Blockly's JSON serialization format. */
export interface BlockJson {
  type: string
  id: string
  x?: number
  y?: number
  fields?: Record<string, unknown>
  inputs?: Record<string, { shadow?: BlockJson; block?: BlockJson }>
  next?: { block?: BlockJson; shadow?: BlockJson }
  [key: string]: unknown
}

/**
 * An original sprite as plain data: what project files hold and what
 * `Runtime.addSprite` takes. At run time the pose and looks live in the
 * entity store (see Sprite).
 */
export interface SpriteData {
  id: string
  name: string
  x: number
  y: number
  z: number
  direction: number
  pitch: number
  /** Degrees about the heading axis. Scripts rarely set it; physics does. */
  roll: number
  /** Percent; 100 = the shape's base size (40 units). */
  size: number
  /** Percent of the size along the local x (heading), y and z axes; 100 when absent. */
  width?: number
  depth?: number
  height?: number
  /** `#rrggbb` */
  color: string
  shape: ShapeKind
  visible: boolean
  pen: PenState
  blocks: WorkspaceJson | null
  /** "For this sprite only" variables, by id. Clones get their own copies. */
  variables: Record<string, LocalVariable>
  /** "For this sprite only" lists, by id. Clones get their own copies. */
  lists: Record<string, LocalList>
}

export interface LocalVariable {
  name: string
  value: Value
}

export interface LocalList {
  name: string
  items: Value[]
}

export interface VariableDef {
  id: string
  name: string
}

/** Menu values for the touching / distance blocks that aren't sprite names. */
export const EDGE = '_edge_'
export const MOUSE = '_mouse_'
/** "create clone of" menu value for the running sprite itself. */
export const MYSELF = '_myself_'

/** Clones allowed at once unless the project's settings say otherwise. */
export const DEFAULT_CLONE_LIMIT = 30000

/** Unit size of a shape at 100% size. */
export const BASE_SIZE = 40

export const STAGE_WIDTH = 480
export const STAGE_HEIGHT = 360

/** Logic steps per second. */
export const TICKS_PER_SECOND = 60
