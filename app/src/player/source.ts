/**
 * Where the player gets its project. A shared project is `{ title, notes,
 * project }`:
 *   - /p/<id> loads it from the sharing API;
 *   - play.html?sample=<id> loads a bundled sample, samples/<id>.json.
 *
 * Only ids are accepted, never URLs, so the page can't be made to show
 * content from elsewhere under this site's name.
 */
import { projectApiUrl } from '../share/client'

export interface Source {
  url: string
  /** Set for projects from the sharing API: they can be reported and opened in the editor. */
  sharedId: string | null
}

const ID = /^[a-z0-9-]{1,64}$/

/** The shared project named by the page's URL, or null if none (or not a valid id). */
export function sourceFromLocation(location: { pathname: string; search: string }): Source | null {
  const shared = /\/p\/([a-z0-9]{1,32})\/?$/.exec(location.pathname)
  if (shared) return { url: projectApiUrl(shared[1]), sharedId: shared[1] }
  const sample = new URLSearchParams(location.search).get('sample')
  if (sample && ID.test(sample)) return { url: `${import.meta.env.BASE_URL}samples/${sample}.json`, sharedId: null }
  return null
}
