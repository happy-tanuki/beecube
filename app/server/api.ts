/**
 * The sharing API, served by Pages Functions (functions/api/[[path]].ts).
 *
 *   POST   /api/projects                 share: { title, notes, project, thumbnail? } → { id, editKey }
 *   GET    /api/projects/:id             → { id, title, notes, project, createdAt, updatedAt }
 *   GET    /api/projects/:id/thumbnail   the link-preview picture (JPEG)
 *   GET    /api/projects/:id/assets/:file   a picture the project uses (<sha-256>.<png|jpg>)
 *   PUT    /api/projects/:id/assets/:file   upload one (Authorization: Bearer <editKey>);
 *                                        the body is the file itself
 *   PUT    /api/projects/:id             update: { title, notes, project?, thumbnail? }
 *                                        (Authorization: Bearer <editKey>); without
 *                                        `project`, only the title and notes change
 *   DELETE /api/projects/:id             stop sharing (Authorization: Bearer <editKey>)
 *   POST   /api/projects/:id/reports     report: { reason }
 *   GET    /api/config                   { turnstileSiteKey } for the browser
 *
 * `thumbnail` is a JPEG data URL, a picture of the stage for link previews.
 *
 * Pictures are assets, as in the editor (src/engine/assets.ts): the project
 * refers to them by hash, and they are uploaded one by one after it. They are
 * kept per project, not shared between projects, so stopping sharing removes
 * them too. Sharing and updating answer with `missingAssets`, the files the
 * project uses that aren't uploaded yet (library pictures, which ship with
 * the app, never are). Only those files are accepted, and pictures the
 * project stops using are removed when it is updated.
 *
 * Sharing and reporting need a Turnstile token (`turnstileToken` in the body),
 * which shows a person, not a script, sent them.
 *
 * Moderation (Authorization: Bearer <ADMIN_TOKEN>):
 *   GET    /api/admin/projects           hidden or reported projects, with their reports
 *   GET    /api/admin/projects/:id       one project, hidden or not, with its project JSON
 *   GET    /api/admin/projects/:id/thumbnail
 *   GET    /api/admin/projects/:id/assets/:file
 *   POST   /api/admin/projects/:id/hide
 *   POST   /api/admin/projects/:id/restore   show again and clear its reports
 *   DELETE /api/admin/projects/:id
 *
 * The audience is children, so nothing about the people using it is stored:
 * there are no accounts, the sharer keeps an edit key (only its hash is kept
 * here), and reports record only a reason. A project with enough reports is
 * hidden until a moderator reviews it.
 */
import { ASSET_MIME, assetFileName, hashAsset, type AssetFormat } from '../src/engine/assets'
import { parseProject, projectAssets, ProjectFormatError, type ProjectFile } from '../src/engine/project'
import { LIBRARY_FILES } from '../src/ui/libraryFiles'

export interface Env {
  DB: D1Database
  PROJECTS: R2Bucket
  /** Reports that hide a project (a number, as text). */
  REPORT_HIDE_THRESHOLD?: string
  /** Moderators' token; the admin routes are closed without it. */
  ADMIN_TOKEN?: string
  /** Turnstile keys; sharing and reporting are refused until both are set. */
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET?: string
}

export interface Deps {
  /** Asks Turnstile whether a token is valid (replaced in tests). */
  verifyTurnstile(secret: string, token: string): Promise<boolean>
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const defaultDeps: Deps = {
  async verifyTurnstile(secret, token) {
    // The visitor's IP address is optional for siteverify and is not sent.
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  },
}

export const LIMITS = {
  /** Request body size for sharing a project, in bytes. */
  body: 2_000_000,
  title: 80,
  notes: 2000,
  /** Decoded size of a thumbnail, in bytes. */
  thumbnail: 300_000,
  /** One picture, in bytes: a 360° image 4096 pixels wide, or a face's picture, fits. */
  asset: 5_000_000,
  /** All of a project's pictures, in bytes. */
  assets: 20_000_000,
}

export const REPORT_REASONS = ['personal-info', 'mean', 'scary', 'other'] as const

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const ID_LENGTH = 10
const ID_PATTERN = /^[a-z0-9]{1,32}$/

interface ProjectRow {
  id: string
  title: string
  notes: string
  edit_key_hash: string
  status: 'shared' | 'hidden'
  reports: number
  size: number
  has_thumbnail: number
  created_at: number
  updated_at: number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

function bearer(request: Request): string | null {
  const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

/** Trims text, drops control characters (keeping line breaks where allowed) and checks its length. */
function cleanText(value: unknown, max: number, multiline: boolean): string {
  if (typeof value !== 'string') throw new HttpError(400, 'bad_request')
  const pattern = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g
  const text = value.replace(/\r\n?/g, '\n').replace(pattern, '').trim()
  if ([...text].length > max) throw new HttpError(400, 'too_long')
  return text
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > LIMITS.body) throw new HttpError(413, 'too_large')
  const text = await request.text()
  if (byteLength(text) > LIMITS.body) throw new HttpError(413, 'too_large')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_request')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'bad_request')
  return data as Record<string, unknown>
}

/** The file names of the pictures a project uses, except the library's (which are never uploaded). */
const uploadedAssets = (project: ProjectFile): Set<string> =>
  new Set(projectAssets(project).map(assetFileName).filter((name) => !LIBRARY_FILES.has(name)))

interface Share {
  title: string
  notes: string
  projectJson: string
  /** The file names of the pictures the project uses, except the library's. */
  assets: Set<string>
}

/** Title, notes and the project, validated; the project is re-serialized so only known fields are kept. */
function readShare(body: Record<string, unknown>): Share {
  const { title, notes } = readInfo(body)
  try {
    const project = parseProject(body.project)
    return { title, notes, projectJson: JSON.stringify(project), assets: uploadedAssets(project) }
  } catch (err) {
    if (err instanceof ProjectFormatError) throw new HttpError(400, 'invalid_project')
    throw err
  }
}

function readInfo(body: Record<string, unknown>): { title: string; notes: string } {
  const title = cleanText(body.title, LIMITS.title, false)
  if (!title) throw new HttpError(400, 'title_required')
  return { title, notes: cleanText(body.notes ?? '', LIMITS.notes, true) }
}

const objectKey = (id: string) => `projects/${id}.json`
const thumbnailKey = (id: string) => `thumbnails/${id}.jpg`

const JPEG_DATA_URL = 'data:image/jpeg;base64,'

/** The thumbnail's bytes if the body has one; it must be a JPEG within the size limit. */
function readThumbnail(body: Record<string, unknown>): Uint8Array | null {
  const value = body.thumbnail
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.startsWith(JPEG_DATA_URL)) throw new HttpError(400, 'bad_thumbnail')
  const base64 = value.slice(JPEG_DATA_URL.length)
  if (base64.length > Math.ceil(LIMITS.thumbnail / 3) * 4) throw new HttpError(400, 'bad_thumbnail')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  } catch {
    throw new HttpError(400, 'bad_thumbnail')
  }
  // JPEG files start with FF D8 FF.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, 'bad_thumbnail')
  return bytes
}

const assetPrefix = (id: string) => `assets/${id}/`
const ASSET_FILE = /^([0-9a-f]{64})\.(png|jpg)$/

/** The project's uploaded pictures: file name → size in bytes. */
async function storedAssets(env: Env, id: string): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  let cursor: string | undefined
  do {
    const page = await env.PROJECTS.list({ prefix: assetPrefix(id), cursor })
    for (const o of page.objects) found.set(o.key.slice(assetPrefix(id).length), o.size)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return found
}

/** Removes the pictures the project no longer uses, and answers with those it uses but lacks. */
async function syncAssets(env: Env, id: string, uses: Set<string>): Promise<string[]> {
  const stored = await storedAssets(env, id)
  const unused = [...stored.keys()].filter((name) => !uses.has(name))
  if (unused.length) await env.PROJECTS.delete(unused.map((name) => assetPrefix(id) + name))
  return [...uses].filter((name) => !stored.has(name))
}

/** The pictures the stored project uses, except the library's. */
async function usedAssets(env: Env, id: string): Promise<Set<string>> {
  const object = await env.PROJECTS.get(objectKey(id))
  return object ? uploadedAssets(parseProject(JSON.parse(await object.text()))) : new Set()
}

const MAGIC: Record<AssetFormat, number[]> = { png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg: [0xff, 0xd8, 0xff] }

async function putAsset(env: Env, request: Request, id: string, file: string): Promise<Response> {
  await ownedProject(env, request, id)
  const m = ASSET_FILE.exec(file)
  if (!m || !(await usedAssets(env, id)).has(file)) throw new HttpError(404, 'not_found')
  const format = m[2] as AssetFormat
  if (Number(request.headers.get('content-length') ?? 0) > LIMITS.asset) throw new HttpError(413, 'too_large')
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > LIMITS.asset) throw new HttpError(413, 'too_large')
  // The contents must be what the name says: a picture of that format, with that hash.
  if (!MAGIC[format].every((b, i) => bytes[i] === b) || (await hashAsset(bytes)) !== m[1]) throw new HttpError(400, 'bad_asset')
  const stored = await storedAssets(env, id)
  stored.delete(file)
  if ([...stored.values()].reduce((a, b) => a + b, bytes.length) > LIMITS.assets) throw new HttpError(413, 'too_large')
  await env.PROJECTS.put(assetPrefix(id) + file, bytes, { httpMetadata: { contentType: ASSET_MIME[format] } })
  return new Response(null, { status: 204 })
}

async function getAsset(env: Env, id: string, file: string, cache: string): Promise<Response> {
  const m = ASSET_FILE.exec(file)
  const object = m && (await env.PROJECTS.get(assetPrefix(id) + file))
  if (!object) throw new HttpError(404, 'not_found')
  return new Response(object.body, { headers: { 'content-type': ASSET_MIME[m[2] as AssetFormat], 'cache-control': cache } })
}

async function putThumbnail(env: Env, id: string, bytes: Uint8Array): Promise<void> {
  await env.PROJECTS.put(thumbnailKey(id), bytes, { httpMetadata: { contentType: 'image/jpeg' } })
}

async function findProject(env: Env, id: string): Promise<ProjectRow | null> {
  if (!ID_PATTERN.test(id)) return null
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>()
}

/** The project if the request carries its edit key; otherwise not found (so ids can't be probed). */
async function ownedProject(env: Env, request: Request, id: string): Promise<ProjectRow> {
  const row = await findProject(env, id)
  const key = bearer(request)
  if (!row || !key || (await sha256(key)) !== row.edit_key_hash) throw new HttpError(404, 'not_found')
  return row
}

async function requireHuman(env: Env, deps: Deps, body: Record<string, unknown>): Promise<void> {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) throw new HttpError(503, 'not_configured')
  const token = body.turnstileToken
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(403, 'verification_failed')
  if (!(await deps.verifyTurnstile(env.TURNSTILE_SECRET, token))) throw new HttpError(403, 'verification_failed')
}

// ---- public routes ------------------------------------------------------

async function createProject(env: Env, deps: Deps, request: Request): Promise<Response> {
  const body = await readBody(request)
  const { title, notes, projectJson, assets } = readShare(body)
  const thumbnail = readThumbnail(body)
  await requireHuman(env, deps, body)
  const editKey = randomKey()
  const now = Date.now()
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId()
    const inserted = await env.DB.prepare(
      `INSERT INTO projects (id, title, notes, edit_key_hash, size, has_thumbnail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
      .bind(id, title, notes, await sha256(editKey), byteLength(projectJson), thumbnail ? 1 : 0, now, now)
      .run()
    if (inserted.meta.changes === 0) continue
    await env.PROJECTS.put(objectKey(id), projectJson, { httpMetadata: { contentType: 'application/json' } })
    if (thumbnail) await putThumbnail(env, id, thumbnail)
    return json({ id, editKey, missingAssets: [...assets] }, 201)
  }
  throw new Error('could not find a free project id')
}

export interface SharedInfo {
  title: string
  notes: string
  /** Path of the link-preview picture (changing when it does), or null if there is none. */
  thumbnailPath: string | null
}

/** A shared project's metadata, or null if it doesn't exist or is hidden. */
export async function sharedProjectInfo(env: Env, id: string): Promise<SharedInfo | null> {
  const row = await findProject(env, id)
  if (!row || row.status !== 'shared') return null
  return {
    title: row.title,
    notes: row.notes,
    thumbnailPath: row.has_thumbnail ? `/api/projects/${id}/thumbnail?v=${row.updated_at}` : null,
  }
}

async function getThumbnail(env: Env, id: string): Promise<Response> {
  const row = await findProject(env, id)
  if (!row || row.status !== 'shared' || !row.has_thumbnail) throw new HttpError(404, 'not_found')
  const object = await env.PROJECTS.get(thumbnailKey(id))
  if (!object) throw new HttpError(404, 'not_found')
  return new Response(object.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=300' },
  })
}

async function getProject(env: Env, id: string): Promise<Response> {
  const row = await findProject(env, id)
  if (!row || row.status !== 'shared') throw new HttpError(404, 'not_found')
  const object = await env.PROJECTS.get(objectKey(id))
  if (!object) throw new HttpError(404, 'not_found')
  return json({
    id,
    title: row.title,
    notes: row.notes,
    project: JSON.parse(await object.text()),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

async function updateProject(env: Env, request: Request, id: string): Promise<Response> {
  await ownedProject(env, request, id)
  const body = await readBody(request)
  if (body.project === undefined) {
    const { title, notes } = readInfo(body)
    await env.DB.prepare('UPDATE projects SET title = ?, notes = ?, updated_at = ? WHERE id = ?')
      .bind(title, notes, Date.now(), id)
      .run()
    return json({ id })
  }
  const { title, notes, projectJson, assets } = readShare(body)
  // Without a new thumbnail the old one stays.
  const thumbnail = readThumbnail(body)
  await env.PROJECTS.put(objectKey(id), projectJson, { httpMetadata: { contentType: 'application/json' } })
  if (thumbnail) await putThumbnail(env, id, thumbnail)
  await env.DB.prepare(
    `UPDATE projects SET title = ?, notes = ?, size = ?, updated_at = ?,
       has_thumbnail = has_thumbnail OR ? WHERE id = ?`,
  )
    .bind(title, notes, byteLength(projectJson), Date.now(), thumbnail ? 1 : 0, id)
    .run()
  return json({ id, missingAssets: await syncAssets(env, id, assets) })
}

async function deleteProject(env: Env, id: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ])
  const assets = [...(await storedAssets(env, id)).keys()].map((name) => assetPrefix(id) + name)
  await env.PROJECTS.delete([objectKey(id), thumbnailKey(id), ...assets])
  return new Response(null, { status: 204 })
}

async function reportProject(env: Env, deps: Deps, request: Request, id: string): Promise<Response> {
  const body = await readBody(request)
  const { reason } = body
  if (!REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) throw new HttpError(400, 'bad_request')
  const row = await findProject(env, id)
  if (!row || row.status !== 'shared') throw new HttpError(404, 'not_found')
  await requireHuman(env, deps, body)
  const threshold = Number(env.REPORT_HIDE_THRESHOLD ?? 3) || 3
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reports (project_id, reason, created_at) VALUES (?, ?, ?)').bind(id, reason, Date.now()),
    env.DB.prepare(
      `UPDATE projects SET reports = reports + 1,
         status = CASE WHEN reports + 1 >= ? THEN 'hidden' ELSE status END
       WHERE id = ?`,
    ).bind(threshold, id),
  ])
  return new Response(null, { status: 204 })
}

// ---- moderation -------------------------------------------------------

function requireAdmin(env: Env, request: Request): void {
  const token = bearer(request)
  if (!env.ADMIN_TOKEN || !token || token !== env.ADMIN_TOKEN) throw new HttpError(403, 'forbidden')
}

async function listForReview(env: Env): Promise<Response> {
  const projects = await env.DB.prepare(
    `SELECT id, title, notes, status, reports, created_at, updated_at FROM projects
     WHERE status = 'hidden' OR reports > 0 ORDER BY reports DESC, updated_at DESC LIMIT 200`,
  ).all<Omit<ProjectRow, 'edit_key_hash' | 'size'>>()
  const reasons = await env.DB.prepare(
    `SELECT project_id, reason, COUNT(*) AS n FROM reports GROUP BY project_id, reason`,
  ).all<{ project_id: string; reason: string; n: number }>()
  return json({
    projects: projects.results.map((p) => ({
      ...p,
      reasons: Object.fromEntries(reasons.results.filter((r) => r.project_id === p.id).map((r) => [r.reason, r.n])),
    })),
  })
}

async function getForReview(env: Env, id: string): Promise<Response> {
  const row = await findProject(env, id)
  if (!row) throw new HttpError(404, 'not_found')
  const object = await env.PROJECTS.get(objectKey(id))
  return json({
    id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    reports: row.reports,
    hasThumbnail: !!row.has_thumbnail,
    project: object ? JSON.parse(await object.text()) : null,
    assets: [...(await storedAssets(env, id)).keys()],
  })
}

async function getThumbnailForReview(env: Env, id: string): Promise<Response> {
  const object = await env.PROJECTS.get(thumbnailKey(id))
  if (!object) throw new HttpError(404, 'not_found')
  return new Response(object.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
}

async function setStatus(env: Env, id: string, status: 'shared' | 'hidden'): Promise<Response> {
  if (!(await findProject(env, id))) throw new HttpError(404, 'not_found')
  if (status === 'shared') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reports WHERE project_id = ?').bind(id),
      env.DB.prepare(`UPDATE projects SET status = 'shared', reports = 0 WHERE id = ?`).bind(id),
    ])
  } else {
    await env.DB.prepare(`UPDATE projects SET status = 'hidden' WHERE id = ?`).bind(id).run()
  }
  return new Response(null, { status: 204 })
}

// ---- routing ----------------------------------------------------------

export async function handleApi(request: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '').split('/').slice(2) // after "/api"
  const method = request.method
  try {
    if (path.length === 1 && path[0] === 'config' && method === 'GET') {
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null })
    }
    if (path[0] === 'projects') {
      const id = path[1]
      if (path.length === 1 && method === 'POST') return await createProject(env, deps, request)
      if (path.length === 2 && method === 'GET') return await getProject(env, id)
      if (path.length === 2 && method === 'PUT') return await updateProject(env, request, id)
      if (path.length === 2 && method === 'DELETE') {
        await ownedProject(env, request, id)
        return await deleteProject(env, id)
      }
      if (path.length === 3 && path[2] === 'thumbnail' && method === 'GET') return await getThumbnail(env, id)
      if (path.length === 4 && path[2] === 'assets' && method === 'GET') {
        const row = await findProject(env, id)
        if (!row || row.status !== 'shared') throw new HttpError(404, 'not_found')
        return await getAsset(env, id, path[3], 'public, max-age=300')
      }
      if (path.length === 4 && path[2] === 'assets' && method === 'PUT') return await putAsset(env, request, id, path[3])
      if (path.length === 3 && path[2] === 'reports' && method === 'POST') return await reportProject(env, deps, request, id)
    }
    if (path[0] === 'admin' && path[1] === 'projects') {
      requireAdmin(env, request)
      const id = path[2]
      if (path.length === 2 && method === 'GET') return await listForReview(env)
      if (path.length === 3 && method === 'GET') return await getForReview(env, id)
      if (path.length === 4 && method === 'GET' && path[3] === 'thumbnail') return await getThumbnailForReview(env, id)
      if (path.length === 5 && method === 'GET' && path[3] === 'assets') {
        if (!(await findProject(env, id))) throw new HttpError(404, 'not_found')
        return await getAsset(env, id, path[4], 'no-store')
      }
      if (path.length === 4 && method === 'POST' && path[3] === 'hide') return await setStatus(env, id, 'hidden')
      if (path.length === 4 && method === 'POST' && path[3] === 'restore') return await setStatus(env, id, 'shared')
      if (path.length === 3 && method === 'DELETE') {
        if (!(await findProject(env, id))) throw new HttpError(404, 'not_found')
        return await deleteProject(env, id)
      }
    }
    throw new HttpError(404, 'not_found')
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status)
    console.error('api error', err)
    return json({ error: 'internal' }, 500)
  }
}
