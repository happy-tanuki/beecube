/**
 * The file names of the library's pictures (see library.ts), which ship with
 * the app. The sharing API (server/api.ts) uses it too: shared projects
 * never upload these.
 */
import { assetFileName, type AssetRef } from '../engine/assets'
import rooms from './roomLibrary.json'
import sceneries from './sceneryLibrary.json'

export const LIBRARY_FILES: ReadonlySet<string> = new Set([
  ...sceneries.map((s) => assetFileName(s.picture as AssetRef)),
  ...rooms.flatMap((r) => Object.values(r.faces).map((f) => assetFileName(f.picture as AssetRef))),
])
