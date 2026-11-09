/** A model made of pieces, without a skeleton, for the browser tests. */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * A toy 2 high (glTF y, the sprite's up) of three pieces, held by a group:
 * a leg 2 long hanging from its node at the top, a small body there, and a
 * patch at the foot standing where the group does (so it isn't a part);
 * and an animation that swings the leg by 90° about glTF x (the sprite's
 * y, its left) in a second.
 */
export async function pieces(): Promise<Uint8Array> {
  const material = new THREE.MeshStandardMaterial({ color: '#2060e0' })
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2).translate(0, -1, 0), material)
  leg.name = 'leg'
  leg.position.y = 2
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material)
  body.name = 'body'
  body.position.y = 1.9
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.1, 0), material)
  patch.name = 'patch'
  const toy = new THREE.Group()
  toy.name = 'toy'
  toy.add(body, leg, patch)
  const scene = new THREE.Scene()
  scene.add(toy)
  const swung = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  const swing = new THREE.AnimationClip('swing', 1, [new THREE.QuaternionKeyframeTrack('leg.quaternion', [0, 1], [0, 0, 0, 1, ...swung.toArray()])])
  return new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true, animations: [swing] })) as ArrayBuffer)
}
