/**
 * /p/<id>: the player page, with the project's title and notes in the page
 * title and link-preview tags. The player itself fetches the project from
 * the API.
 */
import { sharedProjectInfo, type Env } from '../../server/api'
import { pageMeta } from '../../server/meta'

export const onRequestGet: PagesFunction<Env & { ASSETS: Fetcher }> = async ({ request, env, params }) => {
  const page = await env.ASSETS.fetch(new URL('/play', request.url))
  const info = await sharedProjectInfo(env, String(params.id))
  if (!info) return new Response(page.body, { status: 404, headers: page.headers })
  const meta = pageMeta(info, request.url)
  return new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('head', { element: (el) => void el.append(meta.tags, { html: true }) })
    .transform(page)
}
