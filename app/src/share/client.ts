/**
 * The browser side of the sharing API (server/api.ts), and the list of
 * projects shared from this browser. That list holds each share's edit key,
 * which is the only way to update or stop sharing it: there are no accounts.
 */
import { APP_ID } from '../brand'
import { ASSET_MIME, assetFileName, parseAssetFileName, type AssetLoader, type AssetRef } from '../engine/assets'

export type ReportReason = 'personal-info' | 'mean' | 'scary' | 'other'

export interface ShareRecord {
  id: string
  editKey: string
  title: string
  notes: string
  /** Milliseconds since the epoch, of the first share. */
  sharedAt: number
}

export interface ShareContent {
  title: string
  notes: string
  /** Project file JSON (as saved). */
  project: unknown
  /** A JPEG data URL: a picture of the stage for link previews. */
  thumbnail?: string
}

/** A shared project as the API (or a bundled sample) serves it. */
export interface SharedProject {
  title: string
  notes: string
  /** Project file JSON; validated by parseProject. */
  project: unknown
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's error code, such as "too_long" or "not_found". */
    readonly code: string,
  ) {
    super(`${status} ${code}`)
  }
}

const API = `${import.meta.env.BASE_URL}api/projects`
const STORAGE_KEY = `${APP_ID}.shares`

async function request(method: string, url: string, body?: unknown, editKey?: string, contentType = 'application/json'): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': contentType }),
      ...(editKey ? { authorization: `Bearer ${editKey}` } : {}),
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, data?.error ?? 'unknown')
  }
  return res
}

/** The page where a shared project plays. */
export const shareUrl = (id: string) => new URL(`${import.meta.env.BASE_URL}p/${id}`, location.href).href

/** Size of an embedded player: the stage, its buttons above and the bar below. Narrower, it keeps this aspect. */
const EMBED_SIZE = { width: 488, height: 446 }

/** HTML that shows a shared project in another page (the player in its embed mode, see player/Player.tsx). */
export function embedCode(id: string, title: string): string {
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<iframe src="${shareUrl(id)}?embed" width="${EMBED_SIZE.width}" height="${EMBED_SIZE.height}" title="${attr(title)}" style="width: 100%; max-width: ${EMBED_SIZE.width}px; height: auto; aspect-ratio: ${EMBED_SIZE.width} / ${EMBED_SIZE.height}; border: 0;"></iframe>`
}

/** The API URL of a shared project (what the player and the editor fetch). */
export const projectApiUrl = (id: string) => `${API}/${encodeURIComponent(id)}`

/** A picture of a shared project, on the API. */
const assetApiUrl = (id: string, ref: AssetRef) => `${projectApiUrl(id)}/assets/${assetFileName(ref)}`

/** The refs of the API's `missingAssets` (file names). */
function missingRefs(data: unknown): AssetRef[] {
  const names = (data as { missingAssets?: unknown }).missingAssets
  if (!Array.isArray(names)) return []
  return names.flatMap((name) => {
    const ref = typeof name === 'string' ? parseAssetFileName(name) : null
    return ref ? [ref] : []
  })
}

/** Some pictures could not be uploaded, after the project itself was shared (as `record`). */
export class AssetUploadError extends Error {
  constructor(
    readonly record: ShareRecord,
    readonly reason: unknown,
  ) {
    super(`pictures not uploaded: ${String(reason)}`)
  }
}

/** Uploads the pictures the share lacks, a few at a time. Throws AssetUploadError. */
async function uploadAssets(record: ShareRecord, missing: AssetRef[], load: AssetLoader): Promise<void> {
  const queue = [...missing]
  const worker = async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      const data = await load(ref)
      // A picture that is nowhere (not even in this browser) stays missing, as it does in the editor.
      if (!data) continue
      await request('PUT', assetApiUrl(record.id, ref), data, record.editKey, ASSET_MIME[ref.dataFormat])
    }
  }
  try {
    await Promise.all([worker(), worker(), worker()])
  } catch (err) {
    throw new AssetUploadError(record, err)
  }
}

/**
 * Shares a project; `turnstileToken` is from the Turnstile check (turnstile.ts).
 * Its pictures are uploaded after it, from `load`. If that fails (an
 * AssetUploadError), the share exists without some pictures: updating it
 * uploads them again.
 */
export async function createShare(content: ShareContent, turnstileToken: string, load: AssetLoader): Promise<ShareRecord> {
  const res = await request('POST', API, { ...content, turnstileToken })
  const data = (await res.json()) as { id: string; editKey: string }
  const record = { id: data.id, editKey: data.editKey, title: content.title, notes: content.notes, sharedAt: Date.now() }
  saveShares([record, ...loadShares()])
  await uploadAssets(record, missingRefs(data), load)
  return record
}

/** Updates a share with the project in `content`, as createShare shares it. */
export async function updateShare(record: ShareRecord, content: ShareContent, turnstileToken: string, load: AssetLoader): Promise<void> {
  const res = await request('PUT', projectApiUrl(record.id), { ...content, turnstileToken }, record.editKey)
  saveShares(loadShares().map((r) => (r.id === record.id ? { ...r, title: content.title, notes: content.notes } : r)))
  await uploadAssets(record, missingRefs(await res.json()), load)
}

/** Fetches a picture of a shared project; null if it isn't there. */
export async function fetchSharedAsset(id: string, ref: AssetRef): Promise<Uint8Array | null> {
  const res = await fetch(assetApiUrl(id, ref))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Changes a share's title and notes, keeping its project. */
export async function updateShareInfo(record: ShareRecord, title: string, notes: string, turnstileToken: string): Promise<void> {
  await request('PUT', projectApiUrl(record.id), { title, notes, turnstileToken }, record.editKey)
  saveShares(loadShares().map((r) => (r.id === record.id ? { ...r, title, notes } : r)))
}

/** Stops sharing. A share that is already gone is just forgotten. */
export async function deleteShare(record: ShareRecord): Promise<void> {
  try {
    await request('DELETE', projectApiUrl(record.id), undefined, record.editKey)
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err
  }
  saveShares(loadShares().filter((r) => r.id !== record.id))
}

export async function reportShare(id: string, reason: ReportReason, turnstileToken: string): Promise<void> {
  await request('POST', `${projectApiUrl(id)}/reports`, { reason, turnstileToken })
}

export function loadShares(): ShareRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(data) ? (data as ShareRecord[]).filter((r) => typeof r?.id === 'string' && typeof r.editKey === 'string') : []
  } catch {
    return []
  }
}

function saveShares(records: ShareRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch (err) {
    console.warn('shares: could not save the list of shared projects', err)
  }
}

export class NotFoundError extends Error {}

export async function fetchShared(url: string): Promise<SharedProject> {
  const res = await fetch(url)
  // Static hosts answer unknown paths with the app's HTML page rather than a 404.
  const isJson = res.headers.get('content-type')?.includes('json') ?? false
  if (res.status === 404 || (res.ok && !isJson)) throw new NotFoundError(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: unknown = await res.json()
  if (typeof data !== 'object' || data === null) throw new Error('not a shared project')
  const { title, notes, project } = data as Record<string, unknown>
  return {
    title: typeof title === 'string' ? title : '',
    notes: typeof notes === 'string' ? notes : '',
    project,
  }
}
