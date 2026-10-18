import { describe, expect, it } from 'vitest'
import { gjkIntersect, shapesIntersect } from '../src/engine/collision'
import { Random } from '../src/engine/random'
import { EntityStore, F_ALIVE, F_VISIBLE } from '../src/engine/store'
import { SHAPES } from '../src/engine/types'

function entity(E: EntityStore, shape: string, x: number, y: number, z: number, size: number, direction = 90): number {
  const i = E.alloc()
  E.flags[i] = F_ALIVE | F_VISIBLE
  E.shape[i] = SHAPES.indexOf(shape as (typeof SHAPES)[number])
  E.x[i] = x
  E.y[i] = y
  E.z[i] = z
  E.size[i] = size
  E.direction[i] = direction
  return i
}

describe('sphere against an axis-aligned cube', () => {
  it('agrees with GJK, away from exact contact', () => {
    const rnd = new Random(7)
    let touching = 0
    let checked = 0
    for (let n = 0; n < 5000; n++) {
      const E = new EntityStore(2)
      const sphereSize = 10 + rnd.next() * 100
      const cubeSize = 10 + rnd.next() * 100
      const reach = ((sphereSize + cubeSize) / 200) * 40 * 1.8
      const at = () => (rnd.next() * 2 - 1) * reach
      const s = entity(E, 'sphere', at(), at(), at(), sphereSize)
      const c = entity(E, 'cube', 0, 0, 0, cubeSize, [0, 90, 180, 270][n % 4])
      // Distance from the sphere's center to the cube, against the radius.
      const h = (cubeSize / 200) * 40
      const out = Math.hypot(...[E.x[s], E.y[s], E.z[s]].map((v) => Math.max(0, Math.abs(v) - h)))
      if (Math.abs(out - (sphereSize / 200) * 40) < 1e-3) continue
      checked++
      const want = gjkIntersect(E, s, c)
      expect(shapesIntersect(E, s, c)).toBe(want)
      expect(shapesIntersect(E, c, s)).toBe(want)
      if (want) touching++
    }
    // Both outcomes were exercised.
    expect(checked).toBeGreaterThan(4900)
    expect(touching).toBeGreaterThan(500)
    expect(checked - touching).toBeGreaterThan(500)
  })

  it('counts a face just meeting the sphere as touching', () => {
    const E = new EntityStore(2)
    // Cube half size 20, sphere radius 10: centers 30 apart along x.
    const s = entity(E, 'sphere', 30, 0, 0, 50)
    const c = entity(E, 'cube', 0, 0, 0, 100)
    expect(shapesIntersect(E, s, c)).toBe(true)
    E.x[s] = 30.001
    expect(shapesIntersect(E, s, c)).toBe(false)
  })
})

