/**
 * Costumes, as Scratch's: a sprite's looks, one of which each of its
 * entities (the original and each clone) wears. A costume is one of the
 * shapes with a picture wrapped around it, or none; the picture's
 * transparent parts show the sprite's color.
 *
 * How a picture wraps a shape (its layout):
 *   - 'same': every face of a cube shows the whole picture; a cylinder's or
 *     a cone's side is wrapped once round with it, and its ends show it
 *     cut round.
 *   - 'net': the picture is a net on a grid of 4 × 3 squares (NET_COLUMNS,
 *     NET_ROWS). A cube's is a cross: the middle row is its right side, its
 *     front, its left side and its back, with the top above the front and
 *     the bottom below. A cylinder's middle row is its side, with its ends
 *     in the middle of the rows above and below; a cone's side takes the
 *     top two rows (its tip along the top edge) and its base the bottom
 *     row's middle.
 * A sphere is always wrapped like a globe: the picture is equirectangular,
 * as 360° images are. The middle of a picture is on the front, the side
 * the sprite is heading to.
 *
 * A costume can be a 3D model instead (binary glTF), drawn with its own
 * colors and scaled to fit the shapes' size: its longest side is as long as
 * a cube's. Its front is glTF's (+z) and its up glTF's (+y). It touches
 * things as a box around it (`size`), and the sprite's color doesn't show.
 *
 * A model with a skeleton can stand in a pose: its bones turned from how
 * the file has them. Costumes of one model in different poses make it move
 * as they are switched, as a flip book does; its box stays as the file has
 * it, so switching doesn't change what it touches.
 *
 * A costume has a width, depth and height in stage units, which can differ
 * from its shape's (a cube is BASE_SIZE each way) or its model's box: a
 * flat board from a cube, a thin boy. The sprite's size, width, depth and
 * height (percents) scale it in turn.
 */
import { assetFileName, type AssetRef } from './assets'
import type { Random } from './random'
import { BASE_SIZE, SHAPES, type ShapeKind, type Value } from './types'

export type CostumeLayout = 'same' | 'net'

export const COSTUME_LAYOUTS: readonly CostumeLayout[] = ['same', 'net']

export interface CostumeModel {
  /** A binary glTF file. */
  asset: AssetRef
  /** The box around it along the sprite's x (front), y (left) and z (up), as fractions of the longest. */
  size: [number, number, number]
  /** Its bones turned from how the file has them; missing or empty for none. */
  pose?: ModelPose
}

/**
 * Bones by name, each turned by angles in degrees about the sprite's x
 * (front), y (left) and z (up) axes, in that order (as seen with its parent
 * bone as the file has it). A bone not named stays as it is.
 */
export type ModelPose = Record<string, [number, number, number]>

/** A pose as text, the same for the same pose (bones in name order). */
export function poseKey(pose: ModelPose | undefined): string {
  if (!pose) return ''
  return Object.keys(pose)
    .sort()
    .map((bone) => `${bone}:${pose[bone].join(',')}`)
    .join(';')
}

export interface Costume {
  name: string
  shape: ShapeKind
  /** null for none: the shape shows the sprite's color. */
  picture: AssetRef | null
  layout: CostumeLayout
  /** Drawn in place of the shape and its picture; null for none. */
  model: CostumeModel | null
  /** Its width, depth and height in stage units; missing for its shape's or model's own (naturalDimensions). */
  dimensions?: CostumeDimensions
}

/** Width, depth and height in stage units, along the sprite's x (front), y (left) and z (up). */
export type CostumeDimensions = [number, number, number]

/** The smallest and largest a costume's width, depth or height can be (1% and 2000% of a cube's, as "set width to"). */
export const MIN_DIMENSION = BASE_SIZE / 100
export const MAX_DIMENSION = BASE_SIZE * 20

export const clampCostumeDimension = (n: number): number => Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, n))

/** A costume's width, depth and height as its shape or model has them: a cube's, or the model's box scaled as it is drawn. */
export const naturalDimensions = (c: Costume): CostumeDimensions =>
  c.model ? (c.model.size.map((n) => n * BASE_SIZE) as CostumeDimensions) : [BASE_SIZE, BASE_SIZE, BASE_SIZE]

/** A costume's width, depth and height. */
export const costumeDimensions = (c: Costume): CostumeDimensions => c.dimensions ?? naturalDimensions(c)

/** How much a costume is stretched from its shape or model along each axis (1 for not). */
export function costumeStretch(c: Costume): [number, number, number] {
  const natural = naturalDimensions(c)
  return costumeDimensions(c).map((n, i) => n / natural[i]) as [number, number, number]
}

/** Whether these dimensions are the costume's own (so it needn't keep them). */
export const sameDimensions = (a: CostumeDimensions, b: CostumeDimensions): boolean => a.every((n, i) => Math.abs(n - b[i]) < 1e-9)

/** The grid a net is drawn on. */
export const NET_COLUMNS = 4
export const NET_ROWS = 3

/** Menu values of "switch costume to" besides the costumes' names (Scratch's VM takes these too). */
export const NEXT_COSTUME = 'next costume'
export const PREVIOUS_COSTUME = 'previous costume'
export const RANDOM_COSTUME = 'random costume'

export const plainCostume = (name: string, shape: ShapeKind): Costume => ({ name, shape, picture: null, layout: 'same', model: null })

/**
 * The index "switch to (v)" picks in a list of names, or -1 for none: a name
 * first, then next / previous / random (another one than the current), then
 * a number (1 is the first; numbers wrap around). Costumes and backdrops
 * are switched alike.
 */
export function resolveSwitch(
  names: readonly string[],
  current: number,
  v: Value,
  random: Random,
  menu: { next: string; previous: string; random: string },
): number {
  const n = names.length
  if (n === 0) return -1
  const text = String(v)
  const named = names.indexOf(text)
  if (named >= 0) return named
  if (text === menu.next) return (current + 1) % n
  if (text === menu.previous) return (current + n - 1) % n
  if (text === menu.random) {
    if (n < 2) return current
    const pick = Math.floor(random.next() * (n - 1))
    return pick >= current ? pick + 1 : pick
  }
  if (typeof v === 'boolean' || text.trim() === '') return -1
  const num = Number(text)
  if (!Number.isFinite(num)) return -1
  return (((Math.round(num) - 1) % n) + n) % n
}

export const COSTUME_MENU = { next: NEXT_COSTUME, previous: PREVIOUS_COSTUME, random: RANDOM_COSTUME }

/**
 * What the stage draws for an entity: a shape (index into SHAPES) and the
 * picture on it, or a model, stretched by `stretch` (fractions along its
 * axes). `extent` is what it touches things with: the shape stretched by
 * these fractions along its axes (a model's box in a cube, stretched).
 */
export interface Look {
  shape: number
  picture: AssetRef | null
  layout: CostumeLayout
  model: AssetRef | null
  /** The model's pose. */
  pose: ModelPose
  stretch: [number, number, number]
  extent: [number, number, number]
}

export const plainLook = (shape: number): Look => ({ shape, picture: null, layout: 'same', model: null, pose: {}, stretch: [1, 1, 1], extent: [1, 1, 1] })

/**
 * Every look in use, each once, so entities can name theirs by number (the
 * store's `look` column) and the stage can draw entities alike together.
 * Looks 0 to 3 are the plain shapes, in SHAPES order. The list only grows.
 */
export class Looks {
  readonly list: Look[] = SHAPES.map((_, shape) => plainLook(shape))
  private readonly index = new Map<string, number>(SHAPES.map((_, shape) => [String(shape), shape]))

  /** The number of a costume's look, added if it is new. */
  of(costume: Costume): number {
    const stretch = costumeStretch(costume)
    const stretchKey = stretch.every((n) => Math.abs(n - 1) < 1e-9) ? '' : `:${stretch.join(',')}`
    const model = costume.model
    if (model) return this.intern(`model:${assetFileName(model.asset)}:${poseKey(model.pose)}${stretchKey}`, () => ({
      ...plainLook(0),
      model: { ...model.asset },
      pose: structuredClone(model.pose ?? {}),
      stretch,
      extent: [model.size[0] * stretch[0], model.size[1] * stretch[1], model.size[2] * stretch[2]],
    }))
    const shape = Math.max(0, SHAPES.indexOf(costume.shape))
    if (!costume.picture && !stretchKey) return shape
    // A sphere's picture wraps one way only.
    const layout: CostumeLayout = costume.shape === 'sphere' ? 'same' : costume.layout
    const picture = costume.picture
    return this.intern(`${shape}:${picture ? assetFileName(picture) : ''}:${picture ? layout : ''}${stretchKey}`, () => ({
      ...plainLook(shape),
      picture: picture && { ...picture },
      layout: picture ? layout : 'same',
      stretch,
      extent: [...stretch],
    }))
  }

  private intern(key: string, make: () => Look): number {
    let look = this.index.get(key)
    if (look === undefined) {
      look = this.list.length
      this.list.push(make())
      this.index.set(key, look)
    }
    return look
  }
}
