/**
 * 3D models (binary glTF) as costumes (engine/costume.ts): reading one, and
 * turning it into parts to draw, each a geometry and its material, in the
 * sprite's local space and size.
 *
 * glTF's up is +y and its front +z; a sprite's up is +z and its front +x
 * (its left +y). The model is turned so, centered on its box, and scaled so
 * the box's longest side is as long as a cube's (BASE_SIZE).
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BASE_SIZE } from '../engine/types'

/** One mesh of a model, ready to be instanced. */
export interface ModelPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
}

/** glTF's axes to a sprite's: x ← glTF z (front), y ← glTF x (left), z ← glTF y (up). */
const GLTF_TO_SPRITE = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)

/** Reads a binary glTF file. Rejects if it isn't one. */
export async function readModel(data: Uint8Array): Promise<THREE.Object3D> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return gltf.scene
}

/** The model's meshes, each with the matrix that puts it in sprite space (before centering and scaling). */
function meshes(root: THREE.Object3D): [THREE.Mesh, THREE.Matrix4][] {
  root.updateMatrixWorld(true)
  const found: [THREE.Mesh, THREE.Matrix4][] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) found.push([o as THREE.Mesh, GLTF_TO_SPRITE.clone().multiply(o.matrixWorld)])
  })
  return found
}

/** A skinned mesh's geometry as its skeleton stands (in the mesh's space), as a plain one. */
function posed(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  mesh.skeleton.update()
  const geometry = mesh.geometry.clone()
  const position = geometry.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    mesh.applyBoneTransform(i, v.fromBufferAttribute(position, i))
    position.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** The model's box in sprite space. */
function box(root: THREE.Object3D): THREE.Box3 {
  const b = new THREE.Box3()
  for (const [mesh, matrix] of meshes(root)) {
    const geometry = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? posed(mesh as THREE.SkinnedMesh) : mesh.geometry
    geometry.computeBoundingBox()
    b.union(geometry.boundingBox!.clone().applyMatrix4(matrix))
  }
  return b
}

/** The box around the model along a sprite's x, y and z, as fractions of the longest side. Null for an empty model. */
export function modelSize(root: THREE.Object3D): [number, number, number] | null {
  const size = box(root).getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  if (!(longest > 0)) return null
  // Never 0, so a flat model still has something to touch with.
  return [size.x, size.y, size.z].map((n) => Math.min(1, Math.max(0.01, n / longest))) as [number, number, number]
}

/** Most metal there can be. The stage has nothing around it to reflect, so metal looks black. */
const MAX_METALNESS = 0.2

function copyMaterial(m: THREE.Material): THREE.Material {
  const copy = m.clone()
  if (copy instanceof THREE.MeshStandardMaterial && !copy.metalnessMap) copy.metalness = Math.min(copy.metalness, MAX_METALNESS)
  return copy
}

/** The model's parts in sprite space, centered and scaled to the shapes' size. Materials are copies of the model's. */
export function modelParts(root: THREE.Object3D): ModelPart[] {
  const b = box(root)
  const size = b.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  if (!(longest > 0)) return []
  const center = b.getCenter(new THREE.Vector3())
  const fit = new THREE.Matrix4().makeScale(BASE_SIZE / longest, BASE_SIZE / longest, BASE_SIZE / longest).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
  return meshes(root).map(([mesh, matrix]) => {
    const geometry = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? posed(mesh as THREE.SkinnedMesh) : mesh.geometry.clone()
    geometry.applyMatrix4(fit.clone().multiply(matrix))
    // Drawn as plain meshes: skins and morphs are left as they stand.
    for (const name of Object.keys(geometry.attributes)) if (/^(skin|morph)/.test(name)) geometry.deleteAttribute(name)
    geometry.morphAttributes = {}
    const material = Array.isArray(mesh.material) ? mesh.material.map(copyMaterial) : copyMaterial(mesh.material)
    return { geometry, material }
  })
}
