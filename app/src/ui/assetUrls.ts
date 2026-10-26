/** Object URLs for showing assets in the page (thumbnails); made once per asset and kept. */
import { ASSET_MIME, assetFileName, type AssetRef, type Assets } from '../engine/assets'

const urls = new Map<string, string>()

/** The asset's URL, or null until it is loaded (it is asked for; show it on a later render). */
export function assetUrl(assets: Assets, ref: AssetRef): string | null {
  const name = assetFileName(ref)
  const have = urls.get(name)
  if (have) return have
  const data = assets.get(ref)
  if (!data) {
    void assets.load(ref)
    return null
  }
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: ASSET_MIME[ref.dataFormat] }))
  urls.set(name, url)
  return url
}
