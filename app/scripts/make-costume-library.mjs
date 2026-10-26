// Makes the costume library: draws each costume's picture (scripts/costumes.js)
// in a browser, and re-encodes it with the editor's own converter
// (src/ui/pictures.ts), as a picture a user uploads for a costume; then
// adds the 3D models from Kenney's kits (CC0), each re-exported as one
// binary glTF file with its textures inside (the kits' files refer to
// textures beside them). Models with skeletons keep their animations, to
// make poses from.
//
//   npm run dev   (in another terminal)
//   node scripts/make-costume-library.mjs http://localhost:5173
//
// The Earth and the Moon are NASA's maps (public domain), and the kits are
// Kenney's, downloaded here.
// Writes each picture and model to public/library/<sha-256>.<jpg|png|glb> and the list to
// src/ui/costumeLibrary.json (keys are the entries' i18n names).
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { COSTUMES, KITS, MAPS, MODELS } from './costumes.js'

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

/** The kits' files, by kit and path. */
const kits = {}
for (const kit of new Set(Object.values(MODELS).map(([kit]) => kit))) {
  const res = await fetch(KITS[kit])
  if (!res.ok) throw new Error(`${kit}: ${res.status}`)
  kits[kit] = unzipSync(new Uint8Array(await res.arrayBuffer()))
}

// The installed Chrome, as the browser tests use.
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.route('**/__map/*', (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop()
  route.fulfill({ body: maps[name], contentType: 'image/jpeg' })
})
await page.route('**/__kit/**', (route) => {
  const [kit, ...path] = decodeURIComponent(new URL(route.request().url()).pathname).split('/__kit/')[1].split('/')
  const body = kits[kit]?.[path.join('/')]
  if (!body) return route.fulfill({ status: 404 })
  route.fulfill({ body: Buffer.from(body), contentType: path.at(-1).endsWith('.png') ? 'image/png' : 'model/gltf-binary' })
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

for (const [key, [kit, file, facing]] of Object.entries(MODELS)) {
  const model = await page.evaluate(
    async ({ url, backwards }) => {
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
      const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
      const { modelSize, readModel } = await import('/src/stage/models.ts')
      const gltf = await new GLTFLoader().loadAsync(url)
      // Turned about glTF's up (y), so it faces +z as the others do.
      if (backwards) gltf.scene.rotation.y += Math.PI
      let skinned = false
      gltf.scene.traverse((o) => (skinned ||= o.isSkinnedMesh))
      const animations = skinned ? gltf.animations : []
      const glb = new Uint8Array(await new GLTFExporter().parseAsync(gltf.scene, { binary: true, animations }))
      return { data: [...glb], size: modelSize(await readModel(glb)) }
    },
    { url: `/__kit/${kit}/${encodeURIComponent(file).replace(/%2F/g, '/')}`, backwards: facing === 'backwards' },
  )
  const bytes = Buffer.from(model.data)
  const assetId = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(app, 'public/library', `${assetId}.glb`), bytes)
  const size = model.size.map((n) => Math.round(n * 1000) / 1000)
  library.push({ key, shape: 'cube', layout: 'same', model: { asset: { assetId, dataFormat: 'glb' }, size } })
  console.log(key, `${Math.round(bytes.length / 1024)} KB`, size.join(' × '))
}

writeFileSync(join(app, 'src/ui/costumeLibrary.json'), JSON.stringify(library, null, 2) + '\n')
await browser.close()
