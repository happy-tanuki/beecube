/**
 * 3D models (binary glTF) as costumes (engine/costume.ts): reading one, and
 * turning it into parts to draw, each a geometry and its material, in the
 * sprite's local space and size.
 *
 * glTF's up is +y and its front +z; a sprite's up is +z and its front +x
 * (its left +y). The model is turned so, centered on its box, and scaled so
 * the box's longest side is as long as a cube's (BASE_SIZE).
 *
 * A model with a skeleton moves (engine/costume.ts's motion). Standing
 * still, it is drawn in a pose: its bones turned, and its skinned meshes
 * shaped so once. Moving, its meshes keep their skins, and the bones'
 * matrices are sampled through the part that plays (MOTION_FPS), for the
 * vertex shader to skin them with (looks.ts). Only how bones turn is used.
 * The box is always the model's as the file has it.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { isClipMotion, keyframeInterval, MAX_KEYFRAME_SECONDS, MIN_KEYFRAME_SECONDS, motionSpeed, type ClipMotion, type KeyframeMotion, type ModelMotion, type ModelPose } from '../engine/costume'
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

/** Stands the model with its bones turned (from rest), each by a rotation in sprite space or none. */
function standTurned(root: THREE.Object3D, turnOf: (bone: string) => THREE.Quaternion | null): void {
  standAtRest(root)
  const turned: [THREE.Bone, THREE.Quaternion][] = []
  for (const [name, bones] of bonesByName(root)) {
    const turn = turnOf(name)
    if (!turn) continue
    for (const bone of bones) {
      // The turn is in sprite space, so turned there: into the parent's space, turned, and back.
      const parent = parentRotation(bone)
      turned.push([bone, parent.clone().invert().multiply(turn).multiply(parent).multiply(bone.quaternion)])
    }
  }
  for (const [bone, q] of turned) bone.quaternion.copy(q)
  root.updateMatrixWorld(true)
}

/** Stands the model in a pose (from rest). */
function standInPose(root: THREE.Object3D, pose: ModelPose): void {
  standTurned(root, (name) => (pose[name] ? turnRotation(pose[name]) : null))
}

const NO_TURN = new THREE.Quaternion()

/** Stands the model between two poses, `f` (0–1) of the way from one to the other, turning each bone smoothly. */
function standBetween(root: THREE.Object3D, a: ModelPose, b: ModelPose, f: number): void {
  standTurned(root, (name) => {
    if (!a[name] && !b[name]) return null
    const from = a[name] ? turnRotation(a[name]) : NO_TURN.clone()
    return b[name] ? from.slerp(turnRotation(b[name]), f) : from.slerp(NO_TURN, f)
  })
}

/** The animations that move bones. */
export function modelClips(model: Model): THREE.AnimationClip[] {
  const bones = bonesByName(model.root)
  return model.clips.filter(
    (clip) => clip.duration > 0 && clip.tracks.some((track) => bones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)),
  )
}

/** The animation of the model by name (one that moves bones), or null. */
export function findClip(model: Model, name: string): THREE.AnimationClip | null {
  return modelClips(model).find((c) => c.name === name) ?? null
}

const turningClips = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>()

/** The animation turning bones only: its other tracks (moving, scaling, other nodes) are left out. Made once. */
function turningOnly(model: Model, clip: THREE.AnimationClip): THREE.AnimationClip {
  let turning = turningClips.get(clip)
  if (!turning) {
    const bones = bonesByName(model.root)
    const tracks = clip.tracks.filter((track) => {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
      return bones.has(nodeName) && propertyName === 'quaternion'
    })
    turning = new THREE.AnimationClip(clip.name, clip.duration, tracks)
    turningClips.set(clip, turning)
  }
  return turning
}

/**
 * Plays an animation, turning bones only, for `use` to stand the model's
 * bones as they are at times (in seconds) in it; after, the model stands
 * at rest again (stopping the animation puts its bones back).
 */
function inClip<T>(model: Model, clip: THREE.AnimationClip, use: (standAt: (time: number) => void) => T): T {
  const { root } = model
  standAtRest(root)
  const mixer = new THREE.AnimationMixer(root)
  // Played once and held, so its end is its last pose, not its first again.
  const action = mixer.clipAction(turningOnly(model, clip))
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  try {
    return use((time) => {
      mixer.setTime(Math.min(Math.max(0, time), clip.duration))
      root.updateMatrixWorld(true)
    })
  } finally {
    mixer.stopAllAction()
    mixer.uncacheRoot(root)
    standAtRest(root)
  }
}

/** The pose the model's bones are in at a time (in seconds) in an animation; only how they turn is kept. */
export function clipPose(model: Model, clip: THREE.AnimationClip, time: number): ModelPose {
  const { root } = model
  standAtRest(root)
  const bones = [...bonesByName(root)].map(([name, [bone]]) => ({ name, bone, parent: parentRotation(bone), rest: bone.quaternion.clone() }))
  return inClip(model, clip, (standAt) => {
    standAt(time)
    const pose: ModelPose = {}
    for (const { name, bone, parent, rest } of bones) {
      // The turn standInPose undoes: in sprite space, from the parent standing at rest.
      const turn = parent.clone().multiply(bone.quaternion).multiply(rest.clone().invert()).multiply(parent.clone().invert())
      const e = new THREE.Euler().setFromQuaternion(turn, 'ZYX')
      // To a tenth of a degree (and never -0).
      const angles = [e.x, e.y, e.z].map((r) => Math.round((r / RADIANS) * 10) / 10 || 0) as [number, number, number]
      if (angles.some((a) => a !== 0)) pose[name] = angles
    }
    return pose
  })
}

/** The pose a motion starts in (all of a still one); at rest if its animation isn't in the file. */
export function motionPose(model: Model, motion: ModelMotion): ModelPose {
  if (!isClipMotion(motion)) return motion.keyframes[motion.from] ?? {}
  const clip = findClip(model, motion.clip)
  return clip ? clipPose(model, clip, motion.from) : {}
}

/** How many keyframes a second an animation is turned into. */
export const KEYFRAMES_PER_SECOND = 10

/**
 * An animation's motion as keyframes, sampled through all of it
 * (KEYFRAMES_PER_SECOND), playing the keyframes nearest its part; null if
 * the animation isn't in the file.
 */
export function clipKeyframes(model: Model, motion: ClipMotion, maxKeyframes: number): KeyframeMotion | null {
  const clip = findClip(model, motion.clip)
  if (!clip) return null
  const steps = Math.max(1, Math.min(maxKeyframes - 1, Math.round(clip.duration * KEYFRAMES_PER_SECOND)))
  const interval = clip.duration / steps
  const keyframes: ModelPose[] = []
  for (let i = 0; i <= steps; i++) keyframes.push(clipPose(model, clip, i * interval))
  const at = (seconds: number) => Math.min(steps, Math.max(0, Math.round(seconds / interval)))
  const seconds = Math.min(MAX_KEYFRAME_SECONDS, Math.max(MIN_KEYFRAME_SECONDS, clip.duration))
  return { keyframes, seconds, from: at(motion.from), to: at(motion.to), ...(motion.once && { once: true }), ...(motion.speed !== undefined && { speed: motion.speed }) }
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

/** The matrix that centers the model (standing at rest) and scales it to the shapes' size; null for an empty model. */
function fitMatrix(root: THREE.Object3D): THREE.Matrix4 | null {
  standAtRest(root)
  const b = box(root)
  const size = b.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  if (!(longest > 0)) return null
  const center = b.getCenter(new THREE.Vector3())
  return new THREE.Matrix4().makeScale(BASE_SIZE / longest, BASE_SIZE / longest, BASE_SIZE / longest).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
}

/**
 * The model's parts in sprite space, in a pose, centered and scaled to the
 * shapes' size as it stands at rest. Materials are copies of the model's.
 */
export function modelParts(model: Model, pose: ModelPose = {}): ModelPart[] {
  const { root } = model
  const fit = fitMatrix(root)
  if (!fit) return []
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

/** How many times a second a moving model's bones are sampled. */
export const MOTION_FPS = 30

/** The most samples of a motion (a minute's). */
const MAX_SAMPLES = MOTION_FPS * 60

/**
 * A part of a moving model: its geometry as the file has it, with which
 * bones move each vertex (`motionBones`, up to four) and how much
 * (`motionWeights`), and the bones' matrices at each sample, a row of the
 * texture each (four texels, the columns, per bone). A matrix takes a
 * vertex to sprite space, centered, scaled and stretched as a still model
 * is. A mesh without a skin moves with its node, as its only bone.
 */
export interface MovingPart extends ModelPart {
  matrices: THREE.DataTexture
}

export interface MovingModel {
  parts: MovingPart[]
  /** Samples, through the part that plays, its start and end included. */
  samples: number
  /** How long the part that plays takes, at its speed. */
  seconds: number
}

/** Stands the model as keyframes have it `t` seconds into the part that plays. */
function standInKeyframes(root: THREE.Object3D, motion: KeyframeMotion, t: number): void {
  const u = Math.min(motion.to, motion.from + t / keyframeInterval(motion))
  const a = Math.floor(u)
  const b = Math.min(a + 1, motion.to)
  standBetween(root, motion.keyframes[a] ?? {}, motion.keyframes[b] ?? {}, u - a)
}

/** A vertex attribute as floats (skin indices may be integers). */
function floatAttribute(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.Float32BufferAttribute {
  const out = new Float32Array(attr.count * size)
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k)
  return new THREE.Float32BufferAttribute(out, size)
}

/** A mesh's geometry for moving: as the file has it, with its skin (or its node as the one bone) as motion attributes. */
function movingGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = mesh.geometry.clone()
  const count = geometry.getAttribute('position').count
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh
  if (skinned && geometry.getAttribute('skinIndex') && geometry.getAttribute('skinWeight')) {
    geometry.setAttribute('motionBones', floatAttribute(geometry.getAttribute('skinIndex'), 4))
    geometry.setAttribute('motionWeights', floatAttribute(geometry.getAttribute('skinWeight'), 4))
  } else {
    geometry.setAttribute('motionBones', new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4))
    const weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) weights[i * 4] = 1
    geometry.setAttribute('motionWeights', new THREE.Float32BufferAttribute(weights, 4))
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  for (const name of Object.keys(geometry.attributes)) if (/^(skin|morph)/.test(name)) geometry.deleteAttribute(name)
  geometry.morphAttributes = {}
  return geometry
}

/**
 * The model's parts moving as its motion plays its part, stretched by
 * `stretch`; null for an empty model. A motion whose animation isn't in
 * the file stands at rest.
 */
export function movingModelParts(model: Model, motion: ModelMotion, stretch: [number, number, number] = [1, 1, 1]): MovingModel | null {
  const { root } = model
  const fit = fitMatrix(root)
  if (!fit) return null
  fit.premultiply(new THREE.Matrix4().makeScale(...stretch))
  const clip = isClipMotion(motion) ? findClip(model, motion.clip) : null
  // The part in the motion's own seconds, and how long it takes at its speed.
  const span = isClipMotion(motion) ? (clip ? Math.min(motion.to, clip.duration) - motion.from : 0) : (motion.to - motion.from) * keyframeInterval(motion)
  const seconds = span / motionSpeed(motion)
  const samples = seconds > 0 ? Math.min(MAX_SAMPLES, Math.ceil(seconds * MOTION_FPS) + 1) : 1
  const found = meshes(root).map(([mesh]) => mesh)
  const bonesOf = (mesh: THREE.Mesh) => ((mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh).skeleton.bones.length : 1)
  const data = found.map((mesh) => new Float32Array(bonesOf(mesh) * 4 * samples * 4))
  const m = new THREE.Matrix4()
  const sample = (k: number, standAt: (t: number) => void) => {
    standAt(samples > 1 ? (span * k) / (samples - 1) : 0)
    found.forEach((mesh, p) => {
      const base = fit.clone().multiply(GLTF_TO_SPRITE).multiply(mesh.matrixWorld)
      const row = bonesOf(mesh) * 16 * k
      if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        data[p].set(base.elements, row)
        return
      }
      const skinned = mesh as THREE.SkinnedMesh
      skinned.skeleton.bones.forEach((bone, j) => {
        // As SkinnedMesh.applyBoneTransform, then the mesh's place: base · bindMatrixInverse · bone · boneInverse · bindMatrix.
        m.copy(base).multiply(skinned.bindMatrixInverse).multiply(bone.matrixWorld).multiply(skinned.skeleton.boneInverses[j]).multiply(skinned.bindMatrix)
        data[p].set(m.elements, row + j * 16)
      })
    })
  }
  const from = motion.from
  if (isClipMotion(motion)) {
    if (clip) inClip(model, clip, (standAt) => {
      for (let k = 0; k < samples; k++) sample(k, (t) => standAt(from + t))
    })
    else {
      // Not in the file: at rest.
      for (let k = 0; k < samples; k++) sample(k, () => standAtRest(root))
    }
  } else {
    for (let k = 0; k < samples; k++) sample(k, (t) => standInKeyframes(root, motion, t))
  }
  standAtRest(root)
  const parts = found.map((mesh, p) => {
    const matrices = new THREE.DataTexture(data[p], bonesOf(mesh) * 4, samples, THREE.RGBAFormat, THREE.FloatType)
    matrices.needsUpdate = true
    const material = Array.isArray(mesh.material) ? mesh.material.map(copyMaterial) : copyMaterial(mesh.material)
    return { geometry: movingGeometry(mesh), material, matrices }
  })
  return { parts, samples, seconds }
}
