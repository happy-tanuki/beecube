/**
 * Assets: pictures a project uses, kept apart from the project's JSON as in
 * Scratch. The JSON refers to an asset by the hash of its contents and its
 * format; the contents live here while the project is open, and in the
 * browser's storage or the project file's zip when it is saved.
 */

export type AssetFormat = 'png' | 'jpg'

export interface AssetRef {
  /** The SHA-256 of the contents, in hex. */
  assetId: string
  dataFormat: AssetFormat
}

export const ASSET_FORMATS: AssetFormat[] = ['png', 'jpg']

export const ASSET_MIME: Record<AssetFormat, string> = { png: 'image/png', jpg: 'image/jpeg' }

/** The asset's file name in a project file's zip (and on a web server). */
export const assetFileName = (ref: AssetRef): string => `${ref.assetId}.${ref.dataFormat}`

export const isAssetId = (s: string): boolean => /^[0-9a-f]{64}$/.test(s)

export async function hashAsset(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Finds an asset that is not in memory (in the browser's storage, on the web); null if it is nowhere. */
export type AssetLoader = (ref: AssetRef) => Promise<Uint8Array | null>

export class Assets {
  private readonly data = new Map<string, Uint8Array>()
  private readonly loading = new Map<string, Promise<Uint8Array | null>>()
  /** Changes whenever an asset arrives, so the stage redraws. */
  revision = 0
  loader: AssetLoader | null = null

  get(ref: AssetRef): Uint8Array | undefined {
    return this.data.get(assetFileName(ref))
  }

  /** Stores contents under their hash. */
  async add(data: Uint8Array, dataFormat: AssetFormat): Promise<AssetRef> {
    const ref = { assetId: await hashAsset(data), dataFormat }
    this.put(ref, data)
    return ref
  }

  /** Stores contents already known to have this ref (from a project file). */
  put(ref: AssetRef, data: Uint8Array): void {
    this.data.set(assetFileName(ref), data)
    this.revision++
  }

  /** The contents, from memory or the loader; null if it can't be found. Asks the loader once per asset. */
  load(ref: AssetRef): Promise<Uint8Array | null> {
    const name = assetFileName(ref)
    const have = this.data.get(name)
    if (have) return Promise.resolve(have)
    let pending = this.loading.get(name)
    if (!pending) {
      pending = (this.loader ? this.loader(ref) : Promise.resolve(null)).catch((err) => {
        console.warn(`Assets: could not load ${name}`, err)
        return null
      })
      pending.then((data) => data && this.put(ref, data))
      this.loading.set(name, pending)
    }
    return pending
  }

  /** The assets in memory, by file name. */
  entries(): [string, Uint8Array][] {
    return [...this.data]
  }
}
