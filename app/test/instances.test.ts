import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EntityInstances, SHADOW_LIMIT, ShapeBatch, writeMatrix } from '../src/stage/instances'
import { EntityStore } from '../src/engine/store'
import { changeX, flag, forever, makeSprite, setup } from './helpers'

/** The matrix writeMatrix builds, as a three.js Matrix4. */
function matrixOf(E: EntityStore, i: number, alpha = 1): THREE.Matrix4 {
  const out = new Float32Array(16)
  writeMatrix(E, i, alpha, out, 0)
  return new THREE.Matrix4().fromArray(out)
}

function pose(direction: number, pitch: number, roll: number, size = 100) {
  const E = new EntityStore(1)
  const i = E.alloc()
  E.x[i] = 1
  E.y[i] = 2
  E.z[i] = 3
  E.direction[i] = direction
  E.pitch[i] = pitch
  E.roll[i] = roll
  E.size[i] = size
  E.snapPose(i)
  return { E, i }
}

/** Where the matrix sends a local direction (no translation). */
function axis(m: THREE.Matrix4, x: number, y: number, z: number): number[] {
  return new THREE.Vector3(x, y, z).transformDirection(m).toArray().map((v) => Math.round(v * 1e6) / 1e6 + 0)
}

describe('writeMatrix', () => {
  it('points the local x axis along direction and pitch, as the engine moves', () => {
    expect(axis(matrixOf(pose(90, 0, 0).E, 0), 1, 0, 0)).toEqual([1, 0, 0])
    expect(axis(matrixOf(pose(0, 0, 0).E, 0), 1, 0, 0)).toEqual([0, 1, 0])
    expect(axis(matrixOf(pose(180, 0, 0).E, 0), 1, 0, 0)).toEqual([0, -1, 0])
    expect(axis(matrixOf(pose(90, 90, 0).E, 0), 1, 0, 0)).toEqual([0, 0, 1])
  })

  it('rolls about the heading, keeping it', () => {
    const m = matrixOf(pose(90, 0, 90).E, 0)
    expect(axis(m, 1, 0, 0)).toEqual([1, 0, 0])
    expect(axis(m, 0, 1, 0)).toEqual([0, 0, 1])
    expect(axis(m, 0, 0, 1)).toEqual([0, -1, 0])
  })

  it('places and scales by position and size', () => {
    const m = matrixOf(pose(90, 0, 0, 250).E, 0)
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    m.decompose(p, q, s)
    expect(p.toArray()).toEqual([1, 2, 3])
    expect(s.x).toBeCloseTo(2.5)
    expect(s.y).toBeCloseTo(2.5)
    expect(s.z).toBeCloseTo(2.5)
  })

  it('interpolates from the previous pose, turning the short way', () => {
    const { E, i } = pose(350, 0, 0)
    E.x[i] = 11
    E.direction[i] = 10
    const m = matrixOf(E, i, 0.5)
    expect(m.elements[12]).toBeCloseTo(6)
    // Halfway from 350 to 10 is 0 (up the y axis), not 180.
    expect(axis(m, 1, 0, 0)).toEqual([0, 1, 0])
  })
})

/** A runtime with sprites and the instances for its store. */
function stage(sprites = [makeSprite('a', [])]) {
  const s = setup(sprites)
  const scene = new THREE.Scene()
  const inst = new EntityInstances(scene)
  const sync = (alpha = 1) => inst.sync(s.rt, alpha)
  return { ...s, scene, inst, sync }
}

/** The pose attributes written for a slot: [from, to] as x, y, z, size, direction, pitch, roll. */
function written(inst: EntityInstances, slot: number): [number[], number[]] {
  const b = inst.batches[inst.batchOf[slot]]
  const k = inst.instanceOf[slot]
  const read = (p: Float32Array, t: Float32Array) => [...p.subarray(k * 4, k * 4 + 4), ...t.subarray(k * 3, k * 3 + 3)]
  return [read(b.poseFrom, b.turnFrom), read(b.poseTo, b.turnTo)]
}

describe('EntityInstances', () => {
  it('adds one instance per visible entity to its shape batch', () => {
    const { rt, inst, sync, scene } = stage([
      makeSprite('a', [], { shape: 'cube' }),
      makeSprite('b', [], { shape: 'sphere' }),
      makeSprite('c', [], { shape: 'sphere', visible: false }),
    ])
    sync()
    expect(inst.batches.map((b) => b.mesh.count)).toEqual([1, 1, 0, 0])
    expect(inst.instanceOf[rt.getSprite('c')!.slot]).toBe(-1)
    for (const b of inst.batches) expect(scene.children).toContain(b.mesh)
  })

  it('writes the pose, and the start of the tick for an entity that moved', () => {
    const { rt, inst, sync, ticks, sprites: [s] } = stage([
      makeSprite('a', [flag(forever(changeX(10)))], { x: 5, y: 6, z: 7, direction: 30, pitch: 20, roll: 10, size: 150 }),
    ])
    sync()
    expect(written(inst, s.slot)).toEqual([
      [5, 6, 7, 150, 30, 20, 10],
      [5, 6, 7, 150, 30, 20, 10],
    ])
    rt.greenFlag()
    ticks(2)
    sync(0.5)
    expect(inst.poseAlpha.value).toBe(0.5)
    expect(written(inst, s.slot)).toEqual([
      [15, 6, 7, 150, 30, 20, 10],
      [25, 6, 7, 150, 30, 20, 10],
    ])
  })

  it('writes colors as linear values, and color changes at the next tick', () => {
    const { inst, sync, ticks, rt, sprites: [s] } = stage([makeSprite('a', [], { color: '#ff8000' })])
    sync()
    const c = inst.batches[0].mesh.instanceColor!.array
    const want = new THREE.Color('#ff8000')
    expect([c[0], c[1], c[2]]).toEqual([want.r, want.g, want.b].map(Math.fround))
    s.color = '#0000ff'
    sync()
    // The same tick: nothing is written until the next one.
    expect(c[2]).toBe(0)
    ticks(1)
    sync()
    expect([c[0], c[1], c[2]]).toEqual([0, 0, 1])
    // The store is only read.
    expect(rt.store.color[s.slot]).toBe(0x0000ff)
  })

  it('writes instances only on the first frame after a tick, and only what changed', () => {
    const { rt, sync, ticks } = stage([
      makeSprite('mover', [flag(forever(changeX(1)))]),
      makeSprite('still', []),
    ])
    rt.greenFlag()
    ticks(1)
    const write = vi.spyOn(ShapeBatch.prototype, 'writePose')
    sync(0.2)
    expect(write).toHaveBeenCalledTimes(2)
    sync(0.6)
    expect(write).toHaveBeenCalledTimes(2)
    ticks(1)
    sync(0.1)
    // Only the mover: the still sprite was already written at its pose.
    expect(write).toHaveBeenCalledTimes(3)
    write.mockRestore()
  })

  it('shows edits made between ticks (dragging, the sprite pane) at the next tick', () => {
    const { rt, inst, sync, ticks, sprites: [s] } = stage()
    ticks(1)
    sync()
    // A drag sets the pose and snaps the previous one to it: the entity is not "moving".
    s.x = 100
    s.size = 300
    rt.store.snapPose(s.slot)
    ticks(1)
    sync()
    expect(written(inst, s.slot)[1].slice(0, 4)).toEqual([100, 0, 0, 300])
    expect(written(inst, s.slot)[0].slice(0, 4)).toEqual([100, 0, 0, 300])
  })

  it('removes hidden and deleted entities, moving the last instance into the gap', () => {
    const { rt, inst, sync, ticks, sprites: [s] } = stage()
    for (let k = 0; k < 3; k++) rt.createClone(s.slot, -1)
    ticks(1)
    const clones = rt.clonesOf(s).map((c) => c.slot)
    clones.forEach((slot, k) => (rt.store.x[slot] = 10 * (k + 1)))
    ticks(1)
    sync()
    expect(inst.batches[0].count).toBe(4)
    const [c1, c2, c3] = clones
    const at = inst.instanceOf[c1]
    rt.deleteClone(c1)
    ticks(1)
    sync()
    expect(inst.batches[0].count).toBe(3)
    expect(inst.instanceOf[c1]).toBe(-1)
    // The last instance took the deleted one's place, with its pose and color.
    expect(inst.instanceOf[c3]).toBe(at)
    expect(inst.batches[0].slots[at]).toBe(c3)
    expect(written(inst, c3)[1][0]).toBe(30)
    rt.entity(c2)!.visible = false
    ticks(1)
    sync()
    expect(inst.batches[0].count).toBe(2)
    expect(inst.instanceOf[c2]).toBe(-1)
  })

  it('moves an entity whose shape changed to the other batch', () => {
    const { inst, sync, ticks, sprites: [s] } = stage()
    sync()
    s.shape = 'cone'
    ticks(1)
    sync()
    expect(inst.batches.map((b) => b.count)).toEqual([0, 0, 1, 0])
    expect(inst.batchOf[s.slot]).toBe(2)
  })

  it('replaces a full mesh with a larger one, keeping instances and sharing the shape buffers', () => {
    const { rt, inst, sync, ticks, scene, sprites: [s] } = stage()
    sync()
    const old = inst.batches[0].mesh
    s.color = '#00ff00'
    for (let k = 0; k < 100; k++) rt.createClone(s.slot, -1)
    ticks(1)
    rt.clonesOf(s).forEach((c, k) => (rt.store.x[c.slot] = k))
    ticks(1)
    sync()
    const mesh = inst.batches[0].mesh
    expect(mesh).not.toBe(old)
    expect(mesh.count).toBe(101)
    expect(scene.children).toContain(mesh)
    expect(scene.children).not.toContain(old)
    expect(mesh.geometry.getAttribute('position')).toBe(inst.geometries[0].getAttribute('position'))
    expect((mesh.geometry.getAttribute('poseTo') as THREE.BufferAttribute).count).toBeGreaterThanOrEqual(101)
    const last = rt.clonesOf(s).at(-1)!.slot
    expect(written(inst, last)[1][0]).toBe(99)
    expect(mesh.instanceColor!.array[inst.instanceOf[last] * 3 + 1]).toBe(1)
  })

  it('uploads only the instances in use', () => {
    const { inst, sync } = stage([makeSprite('a', []), makeSprite('b', [])])
    sync()
    const attr = inst.batches[0].mesh.geometry.getAttribute('poseFrom') as THREE.InstancedBufferAttribute
    expect(attr.updateRanges).toEqual([{ start: 0, count: 8 }])
    expect(attr.version).toBeGreaterThan(0)
  })

  it('stops casting shadows above the limit', () => {
    const { rt, inst, sync, ticks, sprites: [s] } = stage()
    rt.setCloneLimit(SHADOW_LIMIT + 10)
    sync()
    expect(inst.batches[0].mesh.castShadow).toBe(true)
    for (let k = 0; k < SHADOW_LIMIT; k++) rt.createClone(s.slot, -1)
    ticks(1)
    sync()
    expect(inst.batches[0].mesh.castShadow).toBe(false)
  })
})
