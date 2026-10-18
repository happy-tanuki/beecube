/** Link-preview tags (Open Graph) for a shared project's page. */
import { APP_NAME } from '../src/brand'
import type { SharedInfo } from './api'

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** At most `max` characters, cut at a character boundary with an ellipsis. */
function shorten(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

export function pageMeta(info: SharedInfo, url: string): { title: string; tags: string } {
  const title = `${info.title} - ${APP_NAME}`
  const description = shorten(info.notes, 160)
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', APP_NAME],
    ['og:title', info.title],
    ['og:url', url],
    ...(description ? [['og:description', description]] : []),
    ...(info.thumbnailPath ? [['og:image', new URL(info.thumbnailPath, url).href]] : []),
  ]
    .map(([property, content]) => `<meta property="${property}" content="${escape(content)}" />`)
    .concat(`<meta name="twitter:card" content="${info.thumbnailPath ? 'summary_large_image' : 'summary'}" />`)
    .join('\n')
  return { title, tags }
}
