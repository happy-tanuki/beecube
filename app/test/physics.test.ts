import { beforeAll, describe, expect, it } from 'vitest'
import type { SpriteData } from '../src/engine/types'
import { loadRapier, physicsExtension, physicsOf } from '../src/extensions/physics'
import { blk, changeVar, flag, makeSprite, num, setup, stack } from './helpers'

const setMode = (mode: string) => blk('physics_setMode', { fields: { MODE: mode } })

function physicsSetup(...sprites: SpriteData[]) {
  const t = setup(sprites)
  t.rt.addExtension(physicsExtension)
  return t
}

/** Lets the first physics command, which waits for the world, finish. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeAll(async () => {
  await loadRapier()
})

describe('physics extension', () => {
  it('drops a sphere onto the floor', async () => {
    const { rt, sprites: [ball], ticks } = physicsSetup(makeSprite('ball', [flag(setMode('dynamic'))], { shape: 'sphere', z: 200 }))
    rt.greenFlag()
    ticks(1)
    await settle()
    ticks(180)
    expect(physicsOf(rt)).not.toBeNull()
    expect(ball.z).toBeCloseTo(20, 0)
  })

  it('stacks on a fixed sprite and fires the collision hat', async () => {
    const { rt, sprites: [, ball], ticks } = physicsSetup(
      makeSprite('box', [flag(setMode('fixed'))], { z: 20 }),
      makeSprite('ball', [
        flag(setMode('dynamic')),
        stack(blk('physics_whenCollide', { fields: { WHAT: 'sprite' } }), changeVar('hits', 1)),
      ], { shape: 'sphere', z: 150 }),
    )
    rt.greenFlag()
    ticks(1)
    await settle()
    ticks(180)
    // Resting on top of the 40-unit box: center at 40 + 20.
    expect(ball.z).toBeCloseTo(60, 0)
    // It may bounce a few times; each landing starts the hat once.
    expect(rt.getVariable('hits')).toBeGreaterThanOrEqual(1)
  })

  it('teleports bodies moved by scripts, and stop pauses the simulation', async () => {
    const { rt, sprites: [ball], ticks } = physicsSetup(makeSprite('ball', [flag(setMode('dynamic'))], { shape: 'sphere', z: 20 }))
    rt.greenFlag()
    ticks(1)
    await settle()
    ticks(10)
    rt.moveTo(ball, 100, 50, 300)
    ticks(1)
    expect(ball.x).toBeCloseTo(100)
    expect(ball.z).toBeLessThan(300)
    expect(ball.z).toBeGreaterThan(250)
    rt.stopAll()
    const z = ball.z
    ticks(10)
    expect(ball.z).toBe(z)
  })

  it('cube tumbles off an edge and its rotation reaches the sprite', async () => {
    // A cube placed half over the edge of a fixed box tips over.
    const { rt, sprites: [, cube], ticks } = physicsSetup(
      makeSprite('ledge', [flag(setMode('fixed'))], { z: 20 }),
      makeSprite('cube', [flag(setMode('dynamic'))], { x: 30, z: 61 }),
    )
    rt.greenFlag()
    ticks(1)
    await settle()
    ticks(120)
    const tilted = Math.abs(cube.pitch) > 5 || Math.abs(cube.roll) > 5 || Math.abs(cube.direction - 90) > 5
    expect(tilted).toBe(true)
  })

  it('gives clones their own bodies and drops them with the clones', async () => {
    const { rt, ticks } = physicsSetup(
      makeSprite('ball', [
        flag(blk('control_repeat', { inputs: { TIMES: { shadow: blk('math_number', { fields: { NUM: 20 } }) }, SUBSTACK: { block: blk('control_create_clone_of', { inputs: { CLONE_OPTION: { shadow: blk('control_create_clone_of_menu', { fields: { CLONE_OPTION: '_myself_' } }) } } }) } } })),
        stack(
          blk('control_start_as_clone'),
          blk('motion_gotoxy', { inputs: { X: { block: blk('operator_random', { inputs: { FROM: num(-200), TO: num(200) } }) }, Y: { block: blk('operator_random', { inputs: { FROM: num(-150), TO: num(150) } }) } } }),
          setMode('dynamic'),
        ),
      ], { shape: 'sphere', z: 100 }),
    )
    rt.greenFlag()
    ticks(2)
    await settle()
    ticks(120)
    // All 20 fell to the floor.
    const clones = rt.entities().filter((e) => e.isClone)
    expect(clones).toHaveLength(20)
    expect(clones.every((c) => c.z < 25)).toBe(true)
    expect(clones.every((c) => physicsOf(rt)!.modeOf(c.slot) === 'dynamic')).toBe(true)
    rt.stopAll()
    rt.greenFlag()
    ticks(1)
    expect(rt.cloneCount).toBe(20)
  })
})
