import { Euler, Quaternion } from 'three'
import { describe, expect, it } from 'vitest'
import { PITCH_AXIS, ROLL_AXIS, setRotation, turnBody, YAW_AXIS } from '../src/engine/orientation'
import { EntityStore } from '../src/engine/store'

const DEG = Math.PI / 180

function entity(direction: number, pitch: number, roll: number): [EntityStore, number] {
  const E = new EntityStore(1)
  const i = E.alloc()
  E.direction[i] = direction
  E.pitch[i] = pitch
  E.roll[i] = roll
  return [E, i]
}

/** The heading (local x) in world coordinates. */
function heading(E: EntityStore, i: number): number[] {
  const d = E.direction[i] * DEG, p = E.pitch[i] * DEG
  return [Math.cos(p) * Math.sin(d), Math.cos(p) * Math.cos(d), Math.sin(p)].map((v) => Math.round(v * 1e9) / 1e9 + 0)
}

describe('turnBody', () => {
  it('matches the plain column updates where they are exact', () => {
    const [E, i] = entity(30, 0, 0)
    turnBody(E, i, YAW_AXIS, -20)
    expect([E.direction[i], E.pitch[i], E.roll[i]]).toEqual([50, 0, 0])
    turnBody(E, i, PITCH_AXIS, -100)
    expect([E.direction[i], E.pitch[i], E.roll[i]]).toEqual([50, 100, 0])
    turnBody(E, i, ROLL_AXIS, 40)
    expect([E.direction[i], E.pitch[i], E.roll[i]]).toEqual([50, 100, 40])
  })

  it('keeps roll straight up, where only direction and roll together are known', () => {
    const [E, i] = entity(90, 90, 30)
    turnBody(E, i, ROLL_AXIS, 0)
    expect([E.direction[i], E.pitch[i], E.roll[i]]).toEqual([90, 90, 30])
  })

  it('turns about the own axis after a bank', () => {
    // Facing north, banked right 90: turning right (about the own top) now turns down.
    const [E, i] = entity(0, 0, 90)
    turnBody(E, i, YAW_AXIS, -90)
    expect(heading(E, i)).toEqual([0, 0, -1])
  })
})

describe('setRotation', () => {
  it('reads pitch past 90 back when the entity was already there', () => {
    const q = new Quaternion().setFromEuler(new Euler(10 * DEG, -120 * DEG, (90 - 40) * DEG, 'ZYX'))
    const [E, i] = entity(40, 115, 10)
    setRotation(E, i, q.x, q.y, q.z, q.w)
    expect(E.direction[i]).toBeCloseTo(40)
    expect(E.pitch[i]).toBeCloseTo(120)
    expect(E.roll[i]).toBeCloseTo(10)
    // The same rotation, read from near the other reading.
    const [F, j] = entity(-140, 60, -170)
    setRotation(F, j, q.x, q.y, q.z, q.w)
    expect(F.direction[j]).toBeCloseTo(-140)
    expect(F.pitch[j]).toBeCloseTo(60)
    expect(F.roll[j]).toBeCloseTo(-170)
  })
})
