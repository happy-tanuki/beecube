/**
 * Pictures of 3D models for the page (costume lists, the library, the
 * moderation page): each rendered once, from the front and a little to the
 * side and above, and kept as a data URL.
 */
import * as THREE from 'three'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { modelParts, readModel } from '../stage/models'
import { BASE_SIZE } from '../engine/types'

const WIDTH = 160
const HEIGHT = 120

const urls = new Map<string, string | null>()
let renderer: THREE.WebGLRenderer | null = null

function render(root: THREE.Object3D): string {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(WIDTH, HEIGHT, false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a93a6', 2.2))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(60, -40, 100)
  scene.add(sun)
  const parts = modelParts(root)
  for (const { geometry, material } of parts) scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 1, 1000)
  camera.up.set(0, 0, 1)
  // In front (+x), a little to its left and above, as the home view sees a sprite heading towards it.
  camera.position.set(BASE_SIZE * 2.6, BASE_SIZE * 1.1, BASE_SIZE * 1.2)
  camera.lookAt(0, 0, 0)
  renderer.render(scene, camera)
  for (const { geometry, material } of parts) {
    geometry.dispose()
    for (const m of Array.isArray(material) ? material : [material]) m.dispose()
  }
  return renderer.domElement.toDataURL('image/png')
}

/** A picture of the model, or null until it has been made (it is asked for; show it on a later render) or if it can't be. */
export function modelThumbnail(assets: Assets, ref: AssetRef): string | null {
  const key = assetFileName(ref)
  if (urls.has(key)) return urls.get(key)!
  urls.set(key, null)
  void assets
    .load(ref)
    .then(async (data) => {
      if (data) urls.set(key, render(await readModel(data)))
    })
    .catch((err) => console.warn(`modelThumbnail: ${key} could not be drawn`, err))
  return null
}
