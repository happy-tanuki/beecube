// Makes the costume library: draws each costume's picture (scripts/costumes.js)
// in a browser, and re-encodes it with the editor's own converter
// (src/ui/pictures.ts), as a picture a user uploads for a costume.
//
//   npm run dev   (in another terminal)
//   node scripts/make-costume-library.mjs http://localhost:5173
//
// The Earth and the Moon are NASA's maps (public domain), downloaded here.
// Writes each picture to public/library/<sha-256>.<jpg|png> and the list to
// src/ui/costumeLibrary.json (keys are the entries' i18n names).
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { COSTUMES, MAPS } from './costumes.js'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const [server] = process.argv.slice(2)
if (!server) {
  console.error('usage: node scripts/make-costume-library.mjs <dev server url>')
  process.exit(1)
}

const maps = {}
for (const [name, url] of Object.entries(MAPS)) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  maps[name] = Buffer.from(await res.arrayBuffer())
}

// The installed Chrome, as the browser tests use.
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.route('**/__map/*', (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop()
  route.fulfill({ body: maps[name], contentType: 'image/jpeg' })
})
await page.goto(server)
mkdirSync(join(app, 'public/library'), { recursive: true })

const library = []
for (const [key, { shape, layout }] of Object.entries(COSTUMES)) {
  const picture = await page.evaluate(
    async ({ key, names }) => {
      const { drawCostume } = await import('/scripts/costumes.js')
      const { costumePicture } = await import('/src/ui/pictures.ts')
      const images = {}
      for (const name of names) images[name] = await createImageBitmap(await (await fetch(`/__map/${name}`)).blob())
      const canvas = drawCostume(key, images)
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const p = await costumePicture(png)
      return { format: p.format, data: [...p.data] }
    },
    { key, names: Object.keys(MAPS) },
  )
  const bytes = Buffer.from(picture.data)
  const assetId = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(app, 'public/library', `${assetId}.${picture.format}`), bytes)
  library.push({ key, shape, picture: { assetId, dataFormat: picture.format }, layout })
  console.log(key, `${Math.round(bytes.length / 1024)} KB`)
}

writeFileSync(join(app, 'src/ui/costumeLibrary.json'), JSON.stringify(library, null, 2) + '\n')
await browser.close()
