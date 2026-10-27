/**
 * Pictures of costumes for the page (costume and sprite lists, the
 * libraries, the moderation page): each drawn once in 3D, from the front
 * and a little to the side and above, as the home view sees a sprite
 * heading towards it, and kept as a data URL. A shape is drawn in a color
 * with its picture; a model in a pose. Each model is read once for all its
 * poses.
 */
import * as THREE from 'three'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { poseKey, type Costume, type CostumeLayout, type ModelPose } from '../engine/costume'
import { BASE_SIZE, SHAPES, type ShapeKind } from '../engine/types'
import { loadPictureTexture, texturedGeometry, usePictureOverColor } from '../stage/looks'
import { modelParts, readModel, type Model } from '../stage/models'
import type { LibraryCostume } from './library'

const WIDTH = 160
const HEIGHT = 120

const urls = new Map<string, string | null>()
const models = new Map<string, Promise<Model | null>>()
let renderer: THREE.WebGLRenderer | null = null

/** Draws meshes (disposing of them after) and returns the picture. */
function render(meshes: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[]): string {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(WIDTH, HEIGHT, false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a93a6', 2.2))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(60, -40, 100)
  scene.add(sun)
  for (const { geometry, material } of meshes) scene.add(new THREE.Mesh(geometry, material))
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

/** A picture of a model in a pose, or null until it has been made (it is asked for; show it on a later render) or if it can't be. */
export function modelThumbnail(assets: Assets, ref: AssetRef, pose?: ModelPose): string | null {
  return thumbnail(`${assetFileName(ref)}:${poseKey(pose)}`, async () => {
    const model = await loadModel(assets, ref)
    return model && render(modelParts(model, pose ?? {}))
  })
}

/** A picture of a shape in a color with a picture wrapped round it (or none), or null until it has been made. */
export function shapeThumbnail(assets: Assets, shape: ShapeKind, picture: AssetRef | null, layout: CostumeLayout, color: string): string | null {
  // A sphere's picture wraps one way only (as engine/costume.ts's Looks).
  const wrap = shape === 'sphere' ? 'same' : layout
  const key = `${shape}:${picture ? `${assetFileName(picture)}:${wrap}` : ''}:${color}`
  return thumbnail(key, async () => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    if (picture) {
      const texture = await loadPictureTexture(assets, picture)
      if (texture) {
        material.map = texture
        usePictureOverColor(material)
      }
    }
    const url = render([{ geometry: texturedGeometry(SHAPES.indexOf(shape), wrap), material }])
    material.map?.dispose()
    return url
  })
}

/** A picture of a costume as a sprite of this color wears it, or null until it has been made. */
export function costumeThumbnail(assets: Assets, c: Costume, color: string): string | null {
  if (c.model) return modelThumbnail(assets, c.model.asset, c.model.pose)
  return shapeThumbnail(assets, c.shape, c.picture, c.layout, color)
}

/** The color library costumes are shown in, under their pictures' transparent parts. */
const LIBRARY_COLOR = '#ffffff'

/** A picture of a library costume, or null until it has been made. */
export function libraryThumbnail(assets: Assets, entry: LibraryCostume): string | null {
  if (entry.model) return modelThumbnail(assets, entry.model.asset)
  return shapeThumbnail(assets, entry.shape, entry.picture ?? null, entry.layout, LIBRARY_COLOR)
}
