/**
 * 3D models (binary glTF) as costumes (engine/costume.ts): reading one, and
 * turning it into parts to draw, each a geometry and its material, in the
 * sprite's local space and size.
 *
 * glTF's up is +y and its front +z; a sprite's up is +z and its front +x
 * (its left +y). The model is turned so, centered on its box, and scaled so
 * the box's longest side is as long as a cube's (BASE_SIZE).
 *
 * A model with a skeleton is drawn in a pose (engine/costume.ts): its bones
 * turned, and its skinned meshes shaped so once. Poses can be taken from
 * the file's animations, a moment of one at a time. The box is always the
 * model's as the file has it.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ModelPose } from '../engine/costume'
import { BASE_SIZE } from '../engine/types'

/** A model read from its file. */
export interface Model {
  root: THREE.Object3D
  /** The file's animations. */
  clips: THREE.AnimationClip[]
}

/** One mesh of a model, ready to be instanced. */
export interface ModelPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
}

/** glTF's axes to a sprite's: x ← glTF z (front), y ← glTF x (left), z ← glTF y (up). */
const GLTF_TO_SPRITE = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)

const SPRITE_ROTATION = new THREE.Quaternion().setFromRotationMatrix(GLTF_TO_SPRITE)

/** Reads a binary glTF file. Rejects if it isn't one. */
export async function readModel(data: Uint8Array): Promise<Model> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return { root: gltf.scene, clips: gltf.animations }
}

type Transform = [THREE.Vector3, THREE.Quaternion, THREE.Vector3]

/** Each node's position, rotation and scale as the file has them, kept when first asked for. */
const restStates = new WeakMap<THREE.Object3D, Map<THREE.Object3D, Transform>>()

/** Puts every node of the model back as the file has it. */
function standAtRest(root: THREE.Object3D): void {
  let rest = restStates.get(root)
  if (!rest) {
    rest = new Map()
    const kept = rest
    root.traverse((o) => kept.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]))
    restStates.set(root, rest)
  }
  for (const [o, [position, quaternion, scale]] of rest) {
    o.position.copy(position)
    o.quaternion.copy(quaternion)
    o.scale.copy(scale)
  }
  root.updateMatrixWorld(true)
}

/** The bones of the model's skeletons by name (one name can be on several, if meshes have skeletons of their own). */
function bonesByName(root: THREE.Object3D): Map<string, THREE.Bone[]> {
  const found = new Map<string, THREE.Bone[]>()
  root.traverse((o) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return
    for (const bone of (o as THREE.SkinnedMesh).skeleton.bones) {
      if (!bone.name) continue
      const list = found.get(bone.name) ?? []
      if (!list.includes(bone)) list.push(bone)
      found.set(bone.name, list)
    }
  })
  return found
}

/** The names of the model's bones, in its skeletons' order; none if it has no skeleton. */
export function modelBones(model: Model): string[] {
  return [...bonesByName(model.root).keys()]
}

/** How a bone's parent is turned in sprite space, standing at rest. */
function parentRotation(bone: THREE.Bone): THREE.Quaternion {
  const q = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
  return SPRITE_ROTATION.clone().multiply(q)
}

const RADIANS = Math.PI / 180

/** A pose's turn as a rotation in sprite space: about x, then y, then z. */
const turnRotation = ([x, y, z]: [number, number, number]) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x * RADIANS, y * RADIANS, z * RADIANS, 'ZYX'))

/** Stands the model in a pose (from rest). */
function standInPose(root: THREE.Object3D, pose: ModelPose): void {
  standAtRest(root)
  const turned: [THREE.Bone, THREE.Quaternion][] = []
  for (const [name, bones] of bonesByName(root)) {
    const turn = pose[name]
    if (!turn) continue
    for (const bone of bones) {
      // The turn is in sprite space, so turned there: into the parent's space, turned, and back.
      const parent = parentRotation(bone)
      turned.push([bone, parent.clone().invert().multiply(turnRotation(turn)).multiply(parent).multiply(bone.quaternion)])
    }
  }
  for (const [bone, q] of turned) bone.quaternion.copy(q)
  root.updateMatrixWorld(true)
}

/** The animations that move bones. */
export function modelClips(model: Model): THREE.AnimationClip[] {
  const bones = bonesByName(model.root)
  return model.clips.filter(
    (clip) => clip.duration > 0 && clip.tracks.some((track) => bones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)),
  )
}

/** The pose the model's bones are in at a time (in seconds) in an animation; only how they turn is kept. */
export function clipPose(model: Model, clip: THREE.AnimationClip, time: number): ModelPose {
  const { root } = model
  standAtRest(root)
  const bones = [...bonesByName(root)].map(([name, [bone]]) => ({ name, bone, parent: parentRotation(bone), rest: bone.quaternion.clone() }))
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(clip).play()
  mixer.setTime(time)
  const pose: ModelPose = {}
  for (const { name, bone, parent, rest } of bones) {
    // The turn standInPose undoes: in sprite space, from the parent standing at rest.
    const turn = parent.clone().multiply(bone.quaternion).multiply(rest.invert()).multiply(parent.clone().invert())
    const e = new THREE.Euler().setFromQuaternion(turn, 'ZYX')
    // To a tenth of a degree (and never -0).
    const angles = [e.x, e.y, e.z].map((r) => Math.round((r / RADIANS) * 10) / 10 || 0) as [number, number, number]
    if (angles.some((a) => a !== 0)) pose[name] = angles
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(root)
  standAtRest(root)
  return pose
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
export function modelSize(model: Model): [number, number, number] | null {
  standAtRest(model.root)
  const size = box(model.root).getSize(new THREE.Vector3())
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

/**
 * The model's parts in sprite space, in a pose, centered and scaled to the
 * shapes' size as it stands at rest. Materials are copies of the model's.
 */
export function modelParts(model: Model, pose: ModelPose = {}): ModelPart[] {
  const { root } = model
  standAtRest(root)
  const b = box(root)
  const size = b.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  if (!(longest > 0)) return []
  const center = b.getCenter(new THREE.Vector3())
  const fit = new THREE.Matrix4().makeScale(BASE_SIZE / longest, BASE_SIZE / longest, BASE_SIZE / longest).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
  standInPose(root, pose)
  const parts = meshes(root).map(([mesh, matrix]) => {
    const geometry = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? posed(mesh as THREE.SkinnedMesh) : mesh.geometry.clone()
    geometry.applyMatrix4(fit.clone().multiply(matrix))
    // Drawn as plain meshes: skins and morphs are left as they stand.
    for (const name of Object.keys(geometry.attributes)) if (/^(skin|morph)/.test(name)) geometry.deleteAttribute(name)
    geometry.morphAttributes = {}
    const material = Array.isArray(mesh.material) ? mesh.material.map(copyMaterial) : copyMaterial(mesh.material)
    return { geometry, material }
  })
  standAtRest(root)
  return parts
}
