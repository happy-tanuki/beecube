/**
 * The pen's stamps: copies of entities left on the stage, one batch per
 * look (as entities are drawn, with poses that don't move). Stamps are only
 * appended until the pen is cleared, so each frame writes and uploads just
 * the new ones.
 */
import * as THREE from 'three'
import { Assets } from '../engine/assets'
import type { Look } from '../engine/costume'
import type { PenBuffer } from '../engine/pen'
import { STAMP_POSE } from '../engine/pen'
import { SHAPES } from '../engine/types'
import { makeGeometry, SHADOW_LIMIT, ShapeBatch, usePoseAttributes } from './instances'
import { LookResources } from './looks'

export class StampInstances {
  private readonly geometries = SHAPES.map(makeGeometry)
  /** Stamps don't move: from and to are the same, so the interpolation doesn't matter. */
  private readonly poseAlpha = { value: 1 }
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  private readonly resources: LookResources
  /** By look; made when first needed. */
  private readonly batches: ShapeBatch[] = []
  /** Stamps of the pen already written. */
  private drawn = 0
  private clears = -1

  /** `assets` has the costumes' pictures and models. */
  constructor(
    private readonly scene: THREE.Scene,
    assets = new Assets(),
  ) {
    usePoseAttributes(this.depthMaterial, this.poseAlpha)
    this.resources = new LookResources(assets, this.geometries, (m) => usePoseAttributes(m, this.poseAlpha))
  }

  dispose(): void {
    for (const b of this.batches) b.dispose()
    for (const g of this.geometries) g.dispose()
    this.resources.dispose()
    this.depthMaterial.dispose()
  }

  /** The batch of a look, made (with those before it) when first needed. */
  private batch(look: number, looks: readonly Look[]): ShapeBatch {
    while (this.batches.length <= look) {
      const l = looks[this.batches.length] ?? looks[0]
      const b: ShapeBatch = new ShapeBatch(this.scene, this.resources.parts(l, (parts) => b.setParts(parts)), this.depthMaterial)
      this.batches.push(b)
    }
    return this.batches[look]
  }

  /** Called every frame, with the runtime's looks. */
  sync(pen: PenBuffer, looks: readonly Look[]): void {
    if (pen.clears !== this.clears) {
      this.clears = pen.clears
      this.drawn = 0
      for (const b of this.batches) {
        b.count = 0
        b.dirty = true
      }
    }
    const n = pen.stampCount
    if (n !== this.drawn) {
      for (let k = this.drawn; k < n; k++) {
        const batch = this.batch(pen.stampLooks[k], looks)
        const index = batch.add(-1)
        batch.writeStill(index, pen.stampPoses, k * STAMP_POSE)
        batch.writeColor(index, pen.stampColors[k])
      }
      this.drawn = n
    }
    const total = this.batches.reduce((sum, b) => sum + b.count, 0)
    for (const b of this.batches) b.upload(total <= SHADOW_LIMIT)
  }
}
