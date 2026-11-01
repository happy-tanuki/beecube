/** A model with a skeleton for the browser tests. */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * A stick 2 high (glTF y, the sprite's up) with a bone at its foot and one
 * halfway up, which moves its top half; and an animation that bends the
 * top half by 90° about glTF x (the sprite's y, its left) in a second.
 */
export async function stick(): Promise<Uint8Array> {
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
