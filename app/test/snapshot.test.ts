import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { EntityInstances } from '../src/stage/instances'
import { Snapshot, snapshotBytes, TripleBuffer } from '../src/worker/snapshot'
import { changeX, cloneOf, flag, forever, makeSprite, repeat, setup, startAsClone } from './helpers'

describe('Snapshot', () => {
  it('draws the same instances as the store it was written from', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(repeat(5, cloneOf())), startAsClone(forever(changeX(3)))], { color: '#ff8000', shape: 'cone' }),
      makeSprite('b', [], { shape: 'sphere', direction: 30, pitch: 10, roll: 5, size: 70 }),
    ])
    rt.greenFlag()
    ticks(8)
    const snap = new Snapshot(new SharedArrayBuffer(snapshotBytes(rt.store.capacity)), rt.store.capacity)
    snap.write(rt.store, rt.tick, 1234, 0.5)
    // Two sprites, five clones and the stage's entity.
    expect([snap.tick, snap.time, snap.highWater, snap.count, snap.logicMs]).toEqual([rt.tick, 1234, rt.store.highWater, 8, 0.5])

    const fromStore = new EntityInstances(new THREE.Scene())
    const fromSnapshot = new EntityInstances(new THREE.Scene())
    fromStore.sync(rt, 0.5)
    fromSnapshot.sync({ store: snap, tick: snap.tick }, 0.5)
    fromStore.batches.forEach((b, k) => {
      const c = fromSnapshot.batches[k]
      expect(c.count).toBe(b.count)
      expect(c.poseFrom.subarray(0, b.count * 4)).toEqual(b.poseFrom.subarray(0, b.count * 4))
      expect(c.poseTo.subarray(0, b.count * 4)).toEqual(b.poseTo.subarray(0, b.count * 4))
      expect(c.turnTo.subarray(0, b.count * 3)).toEqual(b.turnTo.subarray(0, b.count * 3))
      expect(c.mesh.instanceColor!.array.subarray(0, b.count * 3)).toEqual(b.mesh.instanceColor!.array.subarray(0, b.count * 3))
    })
    expect(fromStore.batches[2].count).toBe(6)
  })
})

describe('TripleBuffer', () => {
  function pair() {
    const control = new Int32Array(new SharedArrayBuffer(4))
    control[0] = 1
    const snaps = [0, 1, 2].map(() => new Snapshot(new SharedArrayBuffer(snapshotBytes(1)), 1))
    return { writer: new TripleBuffer(control, snaps, 'writer'), reader: new TripleBuffer(control, snaps, 'reader') }
  }
  const mark = (b: TripleBuffer, tick: number) => (b.current.header[0] = tick)

  it('hands the reader the newest snapshot, never the one being written', () => {
    const { writer, reader } = pair()
    expect(reader.take()).toBe(false)
    mark(writer, 1)
    writer.publish()
    mark(writer, 2)
    writer.publish()
    mark(writer, 3)
    // Two published since the reader looked: it gets the newer.
    expect(reader.take()).toBe(true)
    expect(reader.current.tick).toBe(2)
    expect(reader.take()).toBe(false)
    expect(reader.current.tick).toBe(2)
    expect(writer.current).not.toBe(reader.current)
    writer.publish()
    expect(reader.take()).toBe(true)
    expect(reader.current.tick).toBe(3)
  })

  it('keeps the three snapshots apart however the two sides interleave', () => {
    const { writer, reader } = pair()
    let tick = 0
    for (let step = 0; step < 200; step++) {
      if ((step * 7) % 3 === 0) {
        mark(writer, ++tick)
        writer.publish()
      }
      if ((step * 5) % 4 !== 0) reader.take()
      expect(writer.current).not.toBe(reader.current)
    }
    reader.take()
    expect(reader.current.tick).toBe(tick)
  })
})
