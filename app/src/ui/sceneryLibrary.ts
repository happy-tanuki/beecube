/**
 * The scenery library: 360° images that ship with the app, in
 * public/library/ (see its README). Like Scratch's library, an entry only
 * refers to its picture as an asset; it is fetched when shown.
 */
import { assetFileName, type AssetRef } from '../engine/assets'
import { t, type MessageKey } from '../i18n'
import entries from './sceneryLibrary.json'

export interface LibraryScenery {
  key: string
  /** The 360° image. */
  picture: AssetRef
  /** The sky's color in the image, for the scenery until the image has loaded. */
  scenery: string
}

export const SCENERY_LIBRARY = entries as LibraryScenery[]

export const librarySceneryName = (s: LibraryScenery): string => t(`sceneryLibrary.${s.key}` as MessageKey)

const LIBRARY_FILES = new Set(SCENERY_LIBRARY.map((s) => assetFileName(s.picture)))

export const libraryAssetUrl = (ref: AssetRef): string => `${import.meta.env.BASE_URL}library/${assetFileName(ref)}`

/** Fetches a library picture; null for any other asset. */
export async function loadLibraryAsset(ref: AssetRef): Promise<Uint8Array | null> {
  if (!LIBRARY_FILES.has(assetFileName(ref))) return null
  const res = await fetch(libraryAssetUrl(ref))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}
