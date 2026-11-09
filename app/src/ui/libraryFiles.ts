/**
 * The file names of the library's pictures (see library.ts), which ship with
 * the app. The sharing API (server/api.ts) uses it too: shared projects
 * never upload these.
 */
import { assetFileName, type AssetRef } from '../engine/assets'
import costumes from './costumeLibrary.json'
import rooms from './roomLibrary.json'
import sceneries from './sceneryLibrary.json'

/**
 * Pictures the library has replaced, kept in public/library/ for the
 * projects (saved or shared) that still use them.
 */
const RETIRED = [
  // The bee before it was drawn as the app's icon.
  '70965acbe647fc29b78732f3ae965ebe0dc674df36e2d83d884afd57edd937e0.png',
]

export const LIBRARY_FILES: ReadonlySet<string> = new Set([
  ...sceneries.map((s) => assetFileName(s.picture as AssetRef)),
  ...rooms.flatMap((r) => Object.values(r.faces).map((f) => assetFileName(f.picture as AssetRef))),
  ...(costumes as { picture?: AssetRef; model?: { asset: AssetRef } }[]).flatMap((c) => [c.picture, c.model?.asset].filter((r) => r !== undefined).map(assetFileName)),
  ...RETIRED,
])
