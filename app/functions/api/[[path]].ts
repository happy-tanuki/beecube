import { handleApi, type Env } from '../../server/api'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleApi(request, env)
