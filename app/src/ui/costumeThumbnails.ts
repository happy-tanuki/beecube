/**
 * Pictures of costumes for the page (costume and sprite lists, the
 * libraries, the moderation page): each drawn once in 3D, from the front
 * and a little to the side and above, as the home view sees a sprite
 * heading towards it, and kept as a data URL. A shape is drawn in a color
 * with its picture; a model in a pose. A stretched costume keeps its
 * proportions, scaled to fit. Each model is read once for all its poses.
 */
import * as THREE from 'three'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { costumeStretch, poseKey, type Costume, type CostumeLayout, type ModelPose } from '../engine/costume'
import { BASE_SIZE, SHAPES, type ShapeKind } from '../engine/types'
import { loadPictureTexture, texturedGeometry, usePictureOverColor } from '../stage/looks'
import { modelParts, readModel, type Model } from '../stage/models'
import type { LibraryCostume } from './library'

const WIDTH = 160
const HEIGHT = 120

const urls = new Map<string, string | null>()
const models = new Map<string, Promise<Model | null>>()
let renderer: THREE.WebGLRenderer | null = null

/** How much a costume is stretched along each axis (see costumeStretch). */
type Stretch = [number, number, number]

const NO_STRETCH: Stretch = [1, 1, 1]

/** The scale along each axis that draws a stretch with its longest side as a cube's (unstretched, none). */
function fitStretch(stretch: Stretch): Stretch {
  const longest = Math.max(...stretch)
  return stretch.map((n) => n / longest) as Stretch
}

const stretchKey = (stretch: Stretch) => (stretch.every((n) => n === 1) ? '' : `:${stretch.join(',')}`)

/** Draws meshes (disposing of them after), stretched, and returns the picture. */
function render(meshes: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[], stretch: Stretch = NO_STRETCH, zoom = 1): string {
  const scale = fitStretch(stretch)
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(WIDTH * zoom, HEIGHT * zoom, false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a93a6', 2.2))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(60, -40, 100)
  scene.add(sun)
  for (const { geometry, material } of meshes) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(...scale)
    scene.add(mesh)
  }
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 1, 1000)
  camera.up.set(0, 0, 1)
  // In front (+x), a little to its left and above.
  camera.position.set(BASE_SIZE * 2.6, BASE_SIZE * 1.1, BASE_SIZE * 1.2)
  camera.lookAt(0, 0, 0)
  renderer.render(scene, camera)
  for (const { geometry, material } of meshes) {
    geometry.dispose()
    for (const m of Array.isArray(material) ? material : [material]) m.dispose()
  }
  return renderer.domElement.toDataURL('image/png')
}

/** The picture kept for a key, or null; `draw` makes it the first time it is asked for. */
function thumbnail(key: string, draw: () => Promise<string | null>): string | null {
  if (urls.has(key)) return urls.get(key)!
  urls.set(key, null)
  void draw()
    .then((url) => url && urls.set(key, url))
    .catch((err) => console.warn(`thumbnail: ${key} could not be drawn`, err))
  return null
}

/** The model, read once. */
export function loadModel(assets: Assets, ref: AssetRef): Promise<Model | null> {
  const key = assetFileName(ref)
  let model = models.get(key)
  if (!model) {
    model = assets
      .load(ref)
      .then((data) => data && readModel(data))
      .catch((err) => {
        console.warn(`loadModel: ${key} could not be read`, err)
        return null
      })
    models.set(key, model)
  }
  return model
}

/**
 * A picture of a model in a pose, or null until it has been made (it is
 * asked for; show it on a later render) or if it can't be. `zoom` draws it
 * that many times larger, to be shown large.
 */
export function modelThumbnail(assets: Assets, ref: AssetRef, pose?: ModelPose, stretch: Stretch = NO_STRETCH, zoom = 1): string | null {
  return thumbnail(`${assetFileName(ref)}:${poseKey(pose)}${stretchKey(stretch)}${zoom === 1 ? '' : `@${zoom}`}`, async () => {
    const model = await loadModel(assets, ref)
    return model && render(modelParts(model, pose ?? {}), stretch, zoom)
  })
}

/** A picture of a shape in a color with a picture wrapped round it (or none), or null until it has been made. */
export function shapeThumbnail(
  assets: Assets, shape: ShapeKind, picture: AssetRef | null, layout: CostumeLayout, color: string, stretch: Stretch = NO_STRETCH,
): string | null {
  // A sphere's picture wraps one way only (as engine/costume.ts's Looks).
  const wrap = shape === 'sphere' ? 'same' : layout
  const key = `${shape}:${picture ? `${assetFileName(picture)}:${wrap}` : ''}:${color}${stretchKey(stretch)}`
  return thumbnail(key, async () => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    if (picture) {
      const texture = await loadPictureTexture(assets, picture)
      if (texture) {
        material.map = texture
        usePictureOverColor(material)
      }
    }
    const url = render([{ geometry: texturedGeometry(SHAPES.indexOf(shape), wrap), material }], stretch)
    material.map?.dispose()
    return url
  })
}

/** A picture of a costume as a sprite of this color wears it, or null until it has been made; a model can be drawn `zoom` times larger. */
export function costumeThumbnail(assets: Assets, c: Costume, color: string, zoom = 1): string | null {
  const stretch = costumeStretch(c)
  if (c.model) return modelThumbnail(assets, c.model.asset, c.model.pose, stretch, zoom)
  return shapeThumbnail(assets, c.shape, c.picture, c.layout, color, stretch)
}

/** The color library costumes are shown in, under their pictures' transparent parts. */
const LIBRARY_COLOR = '#ffffff'

/** A picture of a library costume, or null until it has been made. */
export function libraryThumbnail(assets: Assets, entry: LibraryCostume): string | null {
  if (entry.model) return modelThumbnail(assets, entry.model.asset)
  return shapeThumbnail(assets, entry.shape, entry.picture ?? null, entry.layout, LIBRARY_COLOR)
}
