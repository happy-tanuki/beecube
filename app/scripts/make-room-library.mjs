// Makes the room library: draws each room's six faces (scripts/rooms.js)
// in a browser, and re-encodes them with the editor's own converter
// (src/ui/pictures.ts), as pictures a user puts on the faces.
//
//   npm run dev   (in another terminal)
//   node scripts/make-room-library.mjs http://localhost:5173
//
// The rooms are drawn over textures from Poly Haven (CC0), downloaded here.
// Writes each face to public/library/<sha-256>.<jpg|png> and the list to
// src/ui/roomLibrary.json (keys are the entries' i18n names).
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { ROOMS, TEXTURES } from './rooms.js'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const [server] = process.argv.slice(2)
if (!server) {
  console.error('usage: node scripts/make-room-library.mjs <dev server url>')
  process.exit(1)
}

const textures = {}
for (const id of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json()
  const res = await fetch(files.Diffuse['1k'].jpg.url)
  if (!res.ok) throw new Error(`${id}: ${res.status}`)
  textures[id] = Buffer.from(await res.arrayBuffer())
}

// The installed Chrome, as the browser tests use.
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.route('**/__texture/*', (route) => {
  const id = new URL(route.request().url()).pathname.split('/').pop()
  route.fulfill({ body: textures[id], contentType: 'image/jpeg' })
})
await page.goto(server)
mkdirSync(join(app, 'public/library'), { recursive: true })

const library = []
for (const key of Object.keys(ROOMS)) {
  const faces = await page.evaluate(
    async ({ key, ids }) => {
      const { drawRoom } = await import('/scripts/rooms.js')
      const { facePicture } = await import('/src/ui/pictures.ts')
      const textures = {}
      for (const id of ids) textures[id] = await createImageBitmap(await (await fetch(`/__texture/${id}`)).blob())
      const result = {}
      for (const [name, { canvas, color }] of Object.entries(drawRoom(key, textures))) {
        const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const picture = await facePicture(png, name)
        result[name] = { color, format: picture.format, data: [...picture.data] }
      }
      return result
    },
    { key, ids: TEXTURES },
  )
  const entry = { key, faces: {} }
  let size = 0
  for (const [name, face] of Object.entries(faces)) {
    const bytes = Buffer.from(face.data)
    const assetId = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(app, 'public/library', `${assetId}.${face.format}`), bytes)
    entry.faces[name] = { color: face.color, picture: { assetId, dataFormat: face.format } }
    size += bytes.length
  }
  library.push(entry)
  console.log(key, `${Math.round(size / 1024)} KB`)
}

writeFileSync(join(app, 'src/ui/roomLibrary.json'), JSON.stringify(library, null, 2) + '\n')
await browser.close()
