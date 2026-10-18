import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import schema1 from '../migrations/0001_projects.sql?raw'
import schema2 from '../migrations/0002_thumbnails.sql?raw'
import sample from '../public/samples/pen-cube.json'
import { PROJECT_FORMAT } from '../src/engine/project'
import { handleApi, type Deps, type Env } from './api'

/** A valid project: the bundled sample's. */
const project = sample.project

let env: Env
let dispose: () => Promise<void>

beforeAll(async () => {
  const proxy = await getPlatformProxy<Env>({ persist: false })
  env = {
    ...proxy.env,
    ADMIN_TOKEN: 'admin-secret',
    REPORT_HIDE_THRESHOLD: '2',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET: 'secret',
  }
  dispose = proxy.dispose
  const statements = (schema1 + ';' + schema2)
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const sql of statements) await env.DB.prepare(sql).run()
}, 60_000)

afterAll(() => dispose?.())

/** Turnstile stand-in: the token "human" passes. */
const deps: Deps = { verifyTurnstile: async (secret, token) => secret === 'secret' && token === 'human' }

const call = (method: string, path: string, body?: unknown, token?: string) =>
  handleApi(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    deps,
  )

const share = (extra: Record<string, unknown> = {}) =>
  call('POST', 'projects', { title: 'My game', notes: 'Use the arrow keys.', project, turnstileToken: 'human', ...extra })

const report = (id: string, reason: string, turnstileToken = 'human') =>
  call('POST', `projects/${id}/reports`, { reason, turnstileToken })

describe('sharing API', () => {
  it('shares a project and serves it back', async () => {
    const res = await share()
    expect(res.status).toBe(201)
    const { id, editKey } = (await res.json()) as { id: string; editKey: string }
    expect(id).toMatch(/^[a-z2-9]{10}$/)
    expect(editKey.length).toBeGreaterThan(30)
    const got = await call('GET', `projects/${id}`)
    expect(got.status).toBe(200)
    const data = (await got.json()) as { title: string; notes: string; project: { format: string } }
    expect(data.title).toBe('My game')
    expect(data.notes).toBe('Use the arrow keys.')
    expect(data.project.format).toBe(PROJECT_FORMAT)
  })

  it('rejects invalid shares', async () => {
    expect((await share({ title: '  ' })).status).toBe(400)
    expect((await share({ title: 'x'.repeat(81) })).status).toBe(400)
    expect((await share({ project: { format: 'something else' } })).status).toBe(400)
    expect((await call('GET', 'projects/nope')).status).toBe(404)
    expect((await call('GET', 'projects/..%2Fsecret')).status).toBe(404)
  })

  it('cleans control characters but keeps line breaks in notes', async () => {
    const { id } = (await (await share({ title: 'A\u0007B', notes: 'one\r\ntwo\u0000' })).json()) as { id: string }
    const data = (await (await call('GET', `projects/${id}`)).json()) as { title: string; notes: string }
    expect(data.title).toBe('AB')
    expect(data.notes).toBe('one\ntwo')
  })

  it('updates and deletes only with the edit key', async () => {
    const { id, editKey } = (await (await share()).json()) as { id: string; editKey: string }
    const update = { title: 'Renamed', notes: '', project }
    expect((await call('PUT', `projects/${id}`, update)).status).toBe(404)
    expect((await call('PUT', `projects/${id}`, update, 'wrong')).status).toBe(404)
    expect((await call('PUT', `projects/${id}`, update, editKey)).status).toBe(200)
    expect(((await (await call('GET', `projects/${id}`)).json()) as { title: string }).title).toBe('Renamed')
    // Only the title and notes, keeping the project.
    expect((await call('PUT', `projects/${id}`, { title: 'Retitled', notes: 'New notes' }, editKey)).status).toBe(200)
    const info = (await (await call('GET', `projects/${id}`)).json()) as { title: string; notes: string; project: unknown }
    expect([info.title, info.notes]).toEqual(['Retitled', 'New notes'])
    expect((info.project as { sprites: unknown[] }).sprites.length).toBe(project.sprites.length)
    expect((await call('PUT', `projects/${id}`, { title: ' ', notes: '' }, editKey)).status).toBe(400)
    expect((await call('DELETE', `projects/${id}`, undefined, 'wrong')).status).toBe(404)
    expect((await call('DELETE', `projects/${id}`, undefined, editKey)).status).toBe(204)
    expect((await call('GET', `projects/${id}`)).status).toBe(404)
  })

  it('hides a project after enough reports, until a moderator restores it', async () => {
    const { id } = (await (await share()).json()) as { id: string }
    expect((await report(id, 'bogus')).status).toBe(400)
    expect((await report(id, 'mean')).status).toBe(204)
    expect((await call('GET', `projects/${id}`)).status).toBe(200)
    expect((await report(id, 'personal-info')).status).toBe(204)
    expect((await call('GET', `projects/${id}`)).status).toBe(404)

    expect((await call('GET', 'admin/projects')).status).toBe(403)
    expect((await call('GET', 'admin/projects', undefined, 'wrong')).status).toBe(403)
    const list = (await (await call('GET', 'admin/projects', undefined, 'admin-secret')).json()) as {
      projects: { id: string; status: string; reasons: Record<string, number> }[]
    }
    const entry = list.projects.find((p) => p.id === id)
    expect(entry).toMatchObject({ status: 'hidden', reasons: { mean: 1, 'personal-info': 1 } })

    // A moderator can read a hidden project.
    expect((await call('GET', `admin/projects/${id}`)).status).toBe(403)
    const review = (await (await call('GET', `admin/projects/${id}`, undefined, 'admin-secret')).json()) as {
      status: string
      project: { sprites: unknown[] }
    }
    expect(review.status).toBe('hidden')
    expect(review.project.sprites.length).toBe(project.sprites.length)

    expect((await call('POST', `admin/projects/${id}/restore`, undefined, 'admin-secret')).status).toBe(204)
    expect((await call('GET', `projects/${id}`)).status).toBe(200)
    expect((await call('POST', `admin/projects/${id}/hide`, undefined, 'admin-secret')).status).toBe(204)
    expect((await call('GET', `projects/${id}`)).status).toBe(404)
    expect((await call('DELETE', `admin/projects/${id}`, undefined, 'admin-secret')).status).toBe(204)
    expect((await call('POST', `admin/projects/${id}/restore`, undefined, 'admin-secret')).status).toBe(404)
  })

  it('keeps a JPEG thumbnail for link previews', async () => {
    // The smallest bytes that pass the check: a JPEG starts with FF D8 FF.
    const jpeg = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3))}`
    expect((await share({ thumbnail: 'data:image/png;base64,AAAA' })).status).toBe(400)
    expect((await share({ thumbnail: `data:image/jpeg;base64,${btoa('not a jpeg')}` })).status).toBe(400)
    const plain = (await (await share()).json()) as { id: string }
    expect((await call('GET', `projects/${plain.id}/thumbnail`)).status).toBe(404)
    const { id, editKey } = (await (await share({ thumbnail: jpeg })).json()) as { id: string; editKey: string }
    const res = await call('GET', `projects/${id}/thumbnail`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
    // Updating without a thumbnail keeps the old one.
    expect((await call('PUT', `projects/${id}`, { title: 'x', project }, editKey)).status).toBe(200)
    expect((await call('GET', `projects/${id}/thumbnail`)).status).toBe(200)
    expect((await call('DELETE', `projects/${id}`, undefined, editKey)).status).toBe(204)
    expect((await call('GET', `projects/${id}/thumbnail`)).status).toBe(404)
  })

  it('needs a Turnstile token to share or report', async () => {
    expect((await share({ turnstileToken: undefined })).status).toBe(403)
    expect((await share({ turnstileToken: 'robot' })).status).toBe(403)
    const { id } = (await (await share()).json()) as { id: string }
    expect((await report(id, 'mean', 'robot')).status).toBe(403)
    const unconfigured = await handleApi(
      new Request('http://localhost/api/projects', { method: 'POST', body: JSON.stringify({ title: 'x', project, turnstileToken: 'human' }) }),
      { ...env, TURNSTILE_SECRET: undefined },
      deps,
    )
    expect(unconfigured.status).toBe(503)
    const config = (await (await call('GET', 'config')).json()) as { turnstileSiteKey: string }
    expect(config.turnstileSiteKey).toBe('site-key')
  })

  it('closes the admin routes when no admin token is configured', async () => {
    const res = await handleApi(
      new Request('http://localhost/api/admin/projects', { headers: { authorization: 'Bearer ' } }),
      { ...env, ADMIN_TOKEN: undefined },
    )
    expect(res.status).toBe(403)
  })
})
