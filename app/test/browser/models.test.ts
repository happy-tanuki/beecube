/**
 * 3D models in a real browser (glTF is read and written with the page's
 * Blob and FileReader): poses of a model with a skeleton, set by hand and
 * taken from its animations, and its motion sampled for the GPU.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { clipKeyframes, clipPose, modelBones, modelClips, modelParts, modelSize, movingModelParts, readModel, type MovingModel } from '../../src/stage/models'
import type { ModelMotion, ModelPose } from '../../src/engine/costume'
import { stick } from './stick'

/** The box around the model's parts drawn in a pose, in sprite space. */
function partsBox(model: Awaited<ReturnType<typeof readModel>>, pose?: ModelPose): THREE.Box3 {
  const box = new THREE.Box3()
  for (const { geometry } of modelParts(model, pose)) {
    geometry.computeBoundingBox()
    box.union(geometry.boundingBox!)
  }
  return box
}

const rounded = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n))

describe('model poses', () => {
  it('turns bones about the sprite’s axes, and keeps the box the file has', async () => {
    const model = await readModel(await stick())
    expect(modelBones(model)).toEqual(['foot', 'middle'])
    // 2 high and 0.2 thick: scaled to 40 high, from z = -20 to 20, the middle bone at z = 0.
    expect(rounded(partsBox(model).max)).toEqual([2, 2, 20])
    // Leaning forward by 90° about the sprite's y: the top half points to the front (+x).
    const forward = partsBox(model, { middle: [0, 90, 0] })
    expect(rounded(forward.max)).toEqual([20, 2, 2])
    expect(rounded(forward.min)).toEqual([-2, -2, -20])
    // Turning about z then makes it point to the left (+y).
    expect(rounded(partsBox(model, { middle: [0, 90, 90] }).max)).toEqual([2, 20, 2])
    // The box stays as the file has it, and the model stands at rest again.
    expect(modelSize(model)!.map((n) => Math.round(n * 10) / 10)).toEqual([0.1, 0.1, 1])
    expect(rounded(partsBox(model).max)).toEqual([2, 2, 20])
  })

  it('takes poses from the file’s animations', async () => {
    const model = await readModel(await stick())
    expect(modelClips(model).map((c) => c.name)).toEqual(['bend'])
    const [bend] = modelClips(model)
    // Halfway, the top half leans forward by 45°; the foot doesn't move, so it isn't in the pose.
    const halfway = clipPose(model, bend, 0.5)
    expect(halfway).toEqual({ middle: [0, 45, 0] })
    expect(clipPose(model, bend, 0)).toEqual({})
    // Its top (20 up, 2 thick) is then at 20 · sin 45° + 2 · cos 45° to the front and as high.
    expect(rounded(partsBox(model, halfway).max)).toEqual([16, 2, 16])
  })
})

/** The box around a moving model's parts at a sample, skinned on the CPU as the shader does. */
function sampleBox(moving: MovingModel, k: number): THREE.Box3 {
  const box = new THREE.Box3()
  const m = new THREE.Matrix4()
  const sum = new THREE.Matrix4()
  const v = new THREE.Vector3()
  for (const { geometry, matrices } of moving.parts) {
    const data = matrices.image.data as Float32Array
    const row = matrices.image.width * 4 * k
    const position = geometry.getAttribute('position')
    const bones = geometry.getAttribute('motionBones')
    const weights = geometry.getAttribute('motionWeights')
    for (let i = 0; i < position.count; i++) {
      sum.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      for (let j = 0; j < 4; j++) {
        const w = weights.getComponent(i, j)
        if (w === 0) continue
        m.fromArray(data, row + bones.getComponent(i, j) * 16)
        for (let e = 0; e < 16; e++) sum.elements[e] += m.elements[e] * w
      }
      box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(sum))
    }
  }
  return box
}

describe('model motion', () => {
  it('samples keyframes, turning bones smoothly between them, stretched as asked', async () => {
    const model = await readModel(await stick())
    const nod: ModelMotion = { keyframes: [{}, { middle: [0, 90, 0] }], interval: 1, from: 0, to: 1 }
    const moving = movingModelParts(model, nod)!
    // Thirty times a second, both ends included.
    expect([moving.samples, moving.seconds]).toEqual([31, 1])
    expect(rounded(sampleBox(moving, 0).max)).toEqual([2, 2, 20])
    // Halfway, 45° (as the animation's pose there), and at the end, the top half points to the front.
    expect(rounded(sampleBox(moving, 15).max)).toEqual([16, 2, 16])
    expect(rounded(sampleBox(moving, 30).max)).toEqual([20, 2, 2])
    // Stretched twice as high.
    expect(rounded(sampleBox(movingModelParts(model, nod, [1, 1, 2])!, 0).max)).toEqual([2, 2, 40])
    // Only the part that plays is sampled.
    const second = movingModelParts(model, { ...nod, keyframes: [{}, {}, { middle: [0, 90, 0] }], from: 1, to: 2 })!
    expect(rounded(sampleBox(second, 0).max)).toEqual([2, 2, 20])
    expect(rounded(sampleBox(second, 30).max)).toEqual([20, 2, 2])
  })

  it('samples a part of an animation, and turns an animation into keyframes', async () => {
    const model = await readModel(await stick())
    const moving = movingModelParts(model, { clip: 'bend', from: 0.5, to: 1 })!
    expect([moving.samples, moving.seconds]).toEqual([16, 0.5])
    expect(rounded(sampleBox(moving, 0).max)).toEqual([16, 2, 16])
    expect(rounded(sampleBox(moving, 15).max)).toEqual([20, 2, 2])
    // An animation that isn't in the file stands at rest.
    expect(movingModelParts(model, { clip: 'jump', from: 0, to: 1 })!.seconds).toBe(0)
    // Ten keyframes a second, the part moved to the keyframes nearest it.
    const keys = clipKeyframes(model, { clip: 'bend', from: 0.5, to: 1, once: true }, 600)!
    expect(keys.keyframes).toHaveLength(11)
    expect(keys.interval).toBeCloseTo(0.1)
    expect([keys.from, keys.to, keys.once]).toEqual([5, 10, true])
    expect(keys.keyframes[5]).toEqual({ middle: [0, 45, 0] })
    expect(clipKeyframes(model, { clip: 'jump', from: 0, to: 1 }, 600)).toBeNull()
  })
})
