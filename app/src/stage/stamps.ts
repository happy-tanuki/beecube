/**
 * The pen's stamps: copies of shapes left on the stage, one InstancedMesh per
 * shape. Stamps are only appended until the pen is cleared, so each frame
 * writes and uploads just the new ones.
 */
import * as THREE from 'three'
import { STAMP_POSE, type PenBuffer } from '../engine/pen'
import { SHAPES } from '../engine/types'
import { makeGeometry, poseMatrix, SHADOW_LIMIT } from './instances'

const COLOR = new THREE.Color()

export class StampInstances {
  private readonly geometries = SHAPES.map(makeGeometry)
  private readonly material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
  private readonly meshes: THREE.InstancedMesh[]
  /** Stamps of the pen already written. */
  private drawn = 0
  private clears = -1

  constructor(private readonly scene: THREE.Scene) {
    this.meshes = this.geometries.map((g) => this.makeMesh(g, 16))
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose()
    for (const g of this.geometries) g.dispose()
    this.material.dispose()
  }

  private makeMesh(geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.count = 0
    mesh.castShadow = true
    mesh.frustumCulled = false
    this.scene.add(mesh)
    return mesh
  }

  /** Called every frame. */
  sync(pen: PenBuffer): void {
    if (pen.clears !== this.clears) {
      this.clears = pen.clears
      this.drawn = 0
      for (const m of this.meshes) m.count = 0
    }
    const n = pen.stampCount
    if (n === this.drawn) return
    const firstNew = this.meshes.map((m) => m.count)
    const p = pen.stampPoses
    for (let k = this.drawn; k < n; k++) {
      const shape = pen.stampShapes[k]
      let mesh = this.meshes[shape]
      if (mesh.count === mesh.instanceMatrix.count) mesh = this.grow(shape)
      const o = k * STAMP_POSE
      const index = mesh.count++
      poseMatrix(
        p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8], p[o + 9],
        mesh.instanceMatrix.array as Float32Array, index * 16,
      )
      // setHex converts the sRGB color to the linear values instance colors hold.
      COLOR.setHex(pen.stampColors[k])
      mesh.setColorAt(index, COLOR)
    }
    this.drawn = n
    this.meshes.forEach((mesh, shape) => {
      const from = firstNew[shape]
      if (mesh.count === from) return
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(from * 16, (mesh.count - from) * 16)
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.clearUpdateRanges()
      mesh.instanceColor!.addUpdateRange(from * 3, (mesh.count - from) * 3)
      mesh.instanceColor!.needsUpdate = true
    })
    const total = this.meshes.reduce((sum, m) => sum + m.count, 0)
    for (const m of this.meshes) m.castShadow = total <= SHADOW_LIMIT
  }

  /** Replaces a shape's mesh with one of twice the capacity, keeping its stamps. */
  private grow(shape: number): THREE.InstancedMesh {
    const old = this.meshes[shape]
    const mesh = this.makeMesh(this.geometries[shape], old.instanceMatrix.count * 2)
    ;(mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array)
    ;(mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array)
    mesh.count = old.count
    this.scene.remove(old)
    old.dispose()
    this.meshes[shape] = mesh
    return mesh
  }
}
