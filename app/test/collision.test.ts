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

describe('stretched shapes', () => {
  it('agree with GJK on axis-aligned cuboids and spheres', () => {
    const rnd = new Random(11)
    let touching = 0
    for (let n = 0; n < 3000; n++) {
      const E = new EntityStore(2)
      const a = entity(E, n % 2 ? 'sphere' : 'cube', 0, 0, 0, 20 + rnd.next() * 100, [0, 90, 180, -90][n % 4])
      const b = entity(E, 'cube', 0, 0, 0, 20 + rnd.next() * 100, [0, 90, 180, -90][(n >> 2) % 4])
      for (const i of [a, b]) {
        const k = n % 2 && i === a ? 50 + rnd.next() * 200 : 0
        E.width[i] = k || 20 + rnd.next() * 300
        E.depth[i] = k || 20 + rnd.next() * 300
        E.height[i] = k || 20 + rnd.next() * 300
      }
      const at = () => (rnd.next() * 2 - 1) * 90
      E.x[b] = at()
      E.y[b] = at()
      E.z[b] = at()
      const want = gjkIntersect(E, a, b)
      expect(shapesIntersect(E, a, b)).toBe(want)
      expect(shapesIntersect(E, b, a)).toBe(want)
      if (want) touching++
    }
    expect(touching).toBeGreaterThan(400)
    expect(touching).toBeLessThan(2600)
  })

  it('touch where the stretched shape reaches', () => {
    const E = new EntityStore(2)
    // A sphere 40 across, 3 times as wide along its heading: it reaches x = 60.
    const egg = entity(E, 'sphere', 0, 0, 0, 100)
    E.width[egg] = 300
    const dot = entity(E, 'sphere', 61, 0, 0, 5)
    expect(shapesIntersect(E, egg, dot)).toBe(true)
    E.x[dot] = 63
    expect(shapesIntersect(E, egg, dot)).toBe(false)
    // Across, it is still 20 from the center.
    E.x[dot] = 0
    E.y[dot] = 22
    expect(shapesIntersect(E, egg, dot)).toBe(false)
    // Turned to face up the y axis, it reaches there instead.
    E.direction[egg] = 0
    expect(shapesIntersect(E, egg, dot)).toBe(true)
  })
})

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

