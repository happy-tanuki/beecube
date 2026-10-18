// Copies scratch-blocks' media (icons, sounds, cursors) into public/ so the
// block editor can load them via `pathToMedia`.
import { cpSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/scratch-blocks/media')
const dest = resolve(root, 'public/blocks-media')

if (!existsSync(src)) {
  console.error(`copy-media: ${src} not found; run npm install first`)
  process.exit(1)
}
cpSync(src, dest, { recursive: true })
