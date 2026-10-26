/**
 * The pen's stamps: copies of entities left on the stage, one InstancedMesh
 * per look. Stamps are only appended until the pen is cleared, so each frame
 * writes and uploads just the new ones.
 */
import * as THREE from 'three'
import { Assets } from '../engine/assets'
import type { Look } from '../engine/costume'
import { STAMP_POSE, type PenBuffer } from '../engine/pen'
import { SHAPES } from '../engine/types'
import { makeGeometry, poseMatrix, SHADOW_LIMIT } from './instances'
import { LookResources } from './looks'

const COLOR = new THREE.Color()

export class StampInstances {
  private readonly geometries = SHAPES.map(makeGeometry)
  private readonly material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
  private readonly resources: LookResources
  /** By look; made when first needed. */
  private readonly meshes: THREE.InstancedMesh[] = []
  /** Stamps of the pen already written. */
  private drawn = 0
  private clears = -1

  /** `assets` has the costumes' pictures. */
  constructor(
    private readonly scene: THREE.Scene,
    assets = new Assets(),
  ) {
    this.resources = new LookResources(assets, this.geometries, this.material, () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }))
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose()
    for (const g of this.geometries) g.dispose()
    this.resources.dispose()
    this.material.dispose()
  }

  /** The mesh of a look, made (with those before it) when first needed. */
  private mesh(look: number, looks: readonly Look[]): THREE.InstancedMesh {
    while (this.meshes.length <= look) {
      const l = looks[this.meshes.length] ?? looks[0]
      this.meshes.push(this.makeMesh(this.resources.geometry(l), this.resources.material(l), 16))
    }
    return this.meshes[look]
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.count = 0
    mesh.castShadow = true
    mesh.frustumCulled = false
    this.scene.add(mesh)
    return mesh
  }

  /** Called every frame, with the runtime's looks. */
  sync(pen: PenBuffer, looks: readonly Look[]): void {
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
      const look = pen.stampLooks[k]
      let mesh = this.mesh(look, looks)
      if (firstNew[look] === undefined) firstNew[look] = mesh.count
      if (mesh.count === mesh.instanceMatrix.count) mesh = this.grow(look)
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
    this.meshes.forEach((mesh, look) => {
      const from = firstNew[look]
      if (from === undefined || mesh.count === from) return
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

  /** Replaces a look's mesh with one of twice the capacity, keeping its stamps. */
  private grow(look: number): THREE.InstancedMesh {
    const old = this.meshes[look]
    const mesh = this.makeMesh(old.geometry, old.material as THREE.Material, old.instanceMatrix.count * 2)
    ;(mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array)
    ;(mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array)
    mesh.count = old.count
    this.scene.remove(old)
    old.dispose()
    this.meshes[look] = mesh
    return mesh
  }
}
