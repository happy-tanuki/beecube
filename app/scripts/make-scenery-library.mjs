// Makes the scenery library from 360° images (equirectangular), with the
// editor's own converter (src/ui/pictures.ts) running in a browser.
//
//   npm run dev   (in another terminal)
//   node scripts/make-scenery-library.mjs http://localhost:5173 meadow=path/to/meadow.jpg ...
//
// Writes each image to public/library/<sha-256>.jpg and the list to
// src/ui/sceneryLibrary.json (keys are the entries' i18n names). The
// images in the library are CC0 from Poly Haven (see public/library/README.md).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

const library = []
for (const pair of pairs) {
  const [key, path] = pair.split('=')
  await page.route('**/__panorama.jpg', (route) => route.fulfill({ body: readFileSync(path), contentType: 'image/jpeg' }))
  const result = await page.evaluate(async () => {
    const { panoramaPicture } = await import('/src/ui/pictures.ts')
    const picture = await panoramaPicture(await (await fetch('/__panorama.jpg')).blob())
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
  })
  await page.unroute('**/__panorama.jpg')
  const bytes = Buffer.from(result.data)
  const assetId = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(app, 'public/library', `${assetId}.${result.format}`), bytes)
  library.push({ key, picture: { assetId, dataFormat: result.format }, scenery: result.scenery })
  console.log(key, result.scenery, `${Math.round(bytes.length / 1024)} KB`)
}

writeFileSync(join(app, 'src/ui/sceneryLibrary.json'), JSON.stringify(library, null, 2) + '\n')
await browser.close()
