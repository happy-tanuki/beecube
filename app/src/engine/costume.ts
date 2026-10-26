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
 */
import { assetFileName, type AssetRef } from './assets'
import type { Random } from './random'
import { SHAPES, type ShapeKind, type Value } from './types'

export type CostumeLayout = 'same' | 'net'

export const COSTUME_LAYOUTS: readonly CostumeLayout[] = ['same', 'net']

export interface Costume {
  name: string
  shape: ShapeKind
  /** null for none: the shape shows the sprite's color. */
  picture: AssetRef | null
  layout: CostumeLayout
}

/** The grid a net is drawn on. */
export const NET_COLUMNS = 4
export const NET_ROWS = 3

/** Menu values of "switch costume to" besides the costumes' names (Scratch's VM takes these too). */
export const NEXT_COSTUME = 'next costume'
export const PREVIOUS_COSTUME = 'previous costume'
export const RANDOM_COSTUME = 'random costume'

export const plainCostume = (name: string, shape: ShapeKind): Costume => ({ name, shape, picture: null, layout: 'same' })

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

/** What the stage draws for an entity: a shape (index into SHAPES), and the picture on it. */
export interface Look {
  shape: number
  picture: AssetRef | null
  layout: CostumeLayout
}

/**
 * Every look in use, each once, so entities can name theirs by number (the
 * store's `look` column) and the stage can draw entities alike together.
 * Looks 0 to 3 are the plain shapes, in SHAPES order. The list only grows.
 */
export class Looks {
  readonly list: Look[] = SHAPES.map((_, shape) => ({ shape, picture: null, layout: 'same' }))
  private readonly index = new Map<string, number>(SHAPES.map((_, shape) => [String(shape), shape]))

  /** The number of a costume's look, added if it is new. */
  of(costume: Costume): number {
    const shape = Math.max(0, SHAPES.indexOf(costume.shape))
    if (!costume.picture) return shape
    // A sphere's picture wraps one way only.
    const layout: CostumeLayout = costume.shape === 'sphere' ? 'same' : costume.layout
    const key = `${shape}:${assetFileName(costume.picture)}:${layout}`
    let look = this.index.get(key)
    if (look === undefined) {
      look = this.list.length
      this.list.push({ shape, picture: { ...costume.picture }, layout })
      this.index.set(key, look)
    }
    return look
  }
}
