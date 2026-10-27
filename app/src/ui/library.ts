/**
 * The libraries of scenery (360° images), rooms (pictures for the six faces
 * of the stage's box) and costumes (pictures on shapes and 3D models, which
 * are also the sprite library's), which ship with the app, in public/library/
 * (see its README). Like Scratch's library, an entry only refers to its
 * pictures as assets; they are fetched when shown.
 */
import { assetFileName, type AssetRef } from '../engine/assets'
import type { Face, FaceName } from '../engine/backdrop'
import type { CostumeLayout, CostumeModel } from '../engine/costume'
import type { ShapeKind } from '../engine/types'
import { t, type MessageKey } from '../i18n'
import costumes from './costumeLibrary.json'
import { LIBRARY_FILES } from './libraryFiles'
import rooms from './roomLibrary.json'
import sceneries from './sceneryLibrary.json'

export interface LibraryScenery {
  key: string
  /** The 360° image. */
  picture: AssetRef
  /** The sky's color in the image, for the scenery until the image has loaded. */
  scenery: string
}

export interface LibraryRoom {
  key: string
  /** Each face's picture, over a color like it (null on walls with windows, so the scenery shows through). */
  faces: Record<FaceName, Face>
}

/** A picture on a shape, or a 3D model. */
export interface LibraryCostume {
  key: string
  shape: ShapeKind
  picture?: AssetRef
  layout: CostumeLayout
  model?: CostumeModel
}

export const SCENERY_LIBRARY = sceneries as LibraryScenery[]
export const ROOM_LIBRARY = rooms as LibraryRoom[]
export const COSTUME_LIBRARY = costumes as LibraryCostume[]

export const librarySceneryName = (s: LibraryScenery): string => t(`sceneryLibrary.${s.key}` as MessageKey)
export const libraryRoomName = (r: LibraryRoom): string => t(`roomLibrary.${r.key}` as MessageKey)
export const libraryCostumeName = (c: LibraryCostume): string => t(`costumeLibrary.${c.key}` as MessageKey)

/** How the sprite library groups its entries. */
export const SPRITE_CATEGORIES = ['animals', 'people', 'vehicles', 'space', 'nature', 'food', 'things', 'shapes'] as const
export type SpriteCategory = (typeof SPRITE_CATEGORIES)[number]

/** Each costume library entry's group, as a sprite (plain shapes are 'shapes'). */
export const COSTUME_CATEGORIES: Record<string, SpriteCategory> = {
  dice: 'things',
  bee: 'animals',
  present: 'things',
  crate: 'things',
  bricks: 'things',
  grass: 'nature',
  earth: 'space',
  moon: 'space',
  beachBall: 'things',
  watermelon: 'food',
  can: 'food',
  trafficCone: 'things',
  cat: 'animals',
  dog: 'animals',
  bunny: 'animals',
  panda: 'animals',
  penguin: 'animals',
  chick: 'animals',
  girl: 'people',
  boy: 'people',
  car: 'vehicles',
  police: 'vehicles',
  fireTruck: 'vehicles',
  raceCar: 'vehicles',
  spaceship: 'space',
  alien: 'space',
  astronaut: 'space',
  rover: 'space',
  tree: 'nature',
  pineTree: 'nature',
  flower: 'nature',
  apple: 'food',
  burger: 'food',
  cake: 'food',
  donut: 'food',
  pizza: 'food',
}

/** Library sprites that come with costumes of a move of their model: its animation, and how many moments of it. */
export const SPRITE_MOVES: Record<string, { clip: string; frames: number }> = {
  girl: { clip: 'walk', frames: 4 },
  boy: { clip: 'walk', frames: 4 },
}

export const libraryAssetUrl = (ref: AssetRef): string => `${import.meta.env.BASE_URL}library/${assetFileName(ref)}`

export const isLibraryAsset = (ref: AssetRef): boolean => LIBRARY_FILES.has(assetFileName(ref))

/** Fetches a library picture; null for any other asset. */
export async function loadLibraryAsset(ref: AssetRef): Promise<Uint8Array | null> {
  if (!isLibraryAsset(ref)) return null
  const res = await fetch(libraryAssetUrl(ref))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}
