/**
 * /p/<id>/thumbnail.jpg: the project's link-preview picture. It lives here
 * rather than only under /api/ because robots.txt keeps crawlers, link-preview
 * ones included, out of /api/.
 */
import { sharedThumbnail, type Env } from '../../../server/api'

export const onRequestGet: PagesFunction<Env> = ({ env, params }) => sharedThumbnail(env, String(params.id))
