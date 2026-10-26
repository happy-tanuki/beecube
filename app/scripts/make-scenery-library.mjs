// Makes entries of the scenery library from 360° images (equirectangular),
// with the editor's own converter (src/ui/pictures.ts) running in a browser.
//
//   npm run dev   (in another terminal)
//   node scripts/make-scenery-library.mjs http://localhost:5173 meadow=path/to/meadow.jpg moon=scripts/moon.js ...
//
// An image is a file, or a module in this app (a .js path from app/) whose
// default export draws one on a canvas in the browser (as scripts/moon.js). Writes each image to
// public/library/<sha-256>.jpg, and adds the entries to
// src/ui/sceneryLibrary.json, in place of those with the same key (keys
// are the entries' i18n names). The photographs in the library are CC0
// from Poly Haven (see public/library/README.md).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const [server, ...pairs] = process.argv.slice(2)
if (!server || pairs.length === 0) {
  console.error('usage: node scripts/make-scenery-library.mjs <dev server url> <key>=<image> ...')
  process.exit(1)
}

// The installed Chrome, as the browser tests use.
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(server)
mkdirSync(join(app, 'public/library'), { recursive: true })

const listFile = join(app, 'src/ui/sceneryLibrary.json')
const library = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : []
for (const pair of pairs) {
  const [key, path] = pair.split('=')
  const drawn = path.endsWith('.js')
  if (!drawn) await page.route('**/__panorama.jpg', (route) => route.fulfill({ body: readFileSync(path), contentType: 'image/jpeg' }))
  const result = await page.evaluate(async (module) => {
    const { panoramaPicture } = await import('/src/ui/pictures.ts')
    let file
    if (module) {
      const canvas = (await import(`/${module}`)).default()
      file = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    } else {
      file = await (await fetch('/__panorama.jpg')).blob()
    }
    const picture = await panoramaPicture(file)
    const image = await createImageBitmap(new Blob([picture.data]))
    // The average color of a band of the image, from top to bottom (0 to 1).
    const average = (top, bottom) => {
      const c = new OffscreenCanvas(1, 1)
      const g = c.getContext('2d')
      const sy = image.height * top
      g.drawImage(image, 0, sy, image.width, image.height * bottom - sy, 0, 0, 1, 1)
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
      return '#' + [r, gr, b].map((n) => n.toString(16).padStart(2, '0')).join('')
    }
    return { format: picture.format, data: [...picture.data], scenery: average(0, 0.25) }
  }, drawn ? path : null)
  if (!drawn) await page.unroute('**/__panorama.jpg')
  const bytes = Buffer.from(result.data)
  const assetId = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(app, 'public/library', `${assetId}.${result.format}`), bytes)
  const entry = { key, picture: { assetId, dataFormat: result.format }, scenery: result.scenery }
  const at = library.findIndex((e) => e.key === key)
  if (at >= 0) library[at] = entry
  else library.push(entry)
  console.log(key, result.scenery, `${Math.round(bytes.length / 1024)} KB`)
}

writeFileSync(listFile, JSON.stringify(library, null, 2) + '\n')
await browser.close()
