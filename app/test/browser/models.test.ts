/**
 * 3D models in a real browser (glTF is read and written with the page's
 * Blob and FileReader): poses of a model with a skeleton, set by hand and
 * taken from its animations.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clipPose, modelBones, modelClips, modelParts, modelSize, readModel } from '../../src/stage/models'
import type { ModelPose } from '../../src/engine/costume'

/**
 * A stick 2 high (glTF y, the sprite's up) with a bone at its foot and one
 * halfway up, which moves its top half; and an animation that bends the
 * top half by 90° about glTF x (the sprite's y, its left) in a second.
 */
async function stick(): Promise<Uint8Array> {
  const geometry = new THREE.BoxGeometry(0.2, 2, 0.2, 1, 4, 1).translate(0, 1, 0)
  const position = geometry.getAttribute('position')
  const skinIndex: number[] = []
  const skinWeight: number[] = []
  for (let i = 0; i < position.count; i++) {
    skinIndex.push(position.getY(i) > 1.001 ? 1 : 0, 0, 0, 0)
    skinWeight.push(1, 0, 0, 0)
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  const foot = new THREE.Bone()
  foot.name = 'foot'
  const middle = new THREE.Bone()
  middle.name = 'middle'
  middle.position.y = 1
  foot.add(middle)
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: '#e02020' }))
  mesh.add(foot)
  mesh.bind(new THREE.Skeleton([foot, middle]))
  const scene = new THREE.Scene()
  scene.add(mesh)
  const bent = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  const bend = new THREE.AnimationClip('bend', 1, [new THREE.QuaternionKeyframeTrack('middle.quaternion', [0, 1], [0, 0, 0, 1, ...bent.toArray()])])
  return new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true, animations: [bend] })) as ArrayBuffer)
}

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
