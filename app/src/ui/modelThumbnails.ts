/**
 * Pictures of 3D models for the page (costume lists, the library, the
 * moderation page): each rendered once, from the front and a little to the
 * side and above, and kept as a data URL. Each model is read once for all
 * its poses.
 */
import * as THREE from 'three'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { poseKey, type ModelPose } from '../engine/costume'
import { modelParts, readModel, type Model } from '../stage/models'
import { BASE_SIZE } from '../engine/types'

const WIDTH = 160
const HEIGHT = 120

const urls = new Map<string, string | null>()
const models = new Map<string, Promise<Model | null>>()
let renderer: THREE.WebGLRenderer | null = null

function render(model: Model, pose: ModelPose): string {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(WIDTH, HEIGHT, false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a93a6', 2.2))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(60, -40, 100)
  scene.add(sun)
  const parts = modelParts(model, pose)
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

/** A picture of the model in a pose, or null until it has been made (it is asked for; show it on a later render) or if it can't be. */
export function modelThumbnail(assets: Assets, ref: AssetRef, pose?: ModelPose): string | null {
  const key = `${assetFileName(ref)}:${poseKey(pose)}`
  if (urls.has(key)) return urls.get(key)!
  urls.set(key, null)
  void loadModel(assets, ref).then((model) => {
    try {
      if (model) urls.set(key, render(model, pose ?? {}))
    } catch (err) {
      console.warn(`modelThumbnail: ${key} could not be drawn`, err)
    }
  })
  return null
}
