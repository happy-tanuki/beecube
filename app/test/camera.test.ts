import { describe, expect, it } from 'vitest'
import { fovOf } from '../src/engine/camera'
import { loadProject, parseProject, serializeProject } from '../src/engine/project'
import { blk, cloneOf, flag, forever, makeSprite, num, setup, startAsClone, wait } from './helpers'

const zoom = (op: string, n: number) => blk(op, { inputs: { ZOOM: num(n) } })
const view = (name: string) => blk('camera_setview', { fields: { VIEW: name } })

describe('camera blocks', () => {
  it('makes the running sprite the camera, until a view is set', () => {
    const { rt, sprites: [a], ticks } = setup([makeSprite('a', [flag(blk('camera_setsprite'), wait(0.1), view('top'))])])
    rt.greenFlag()
    ticks(1)
    expect(rt.camera.sprite).toBe(rt.store.handle(a.slot))
    const requests = rt.camera.viewRequests
    ticks(10)
    expect(rt.camera.sprite).toBeNull()
    expect(rt.camera.view).toBe('top')
    expect(rt.camera.viewRequests).toBe(requests + 1)
  })

  it('makes a clone the camera by its own handle, which goes stale when the clone is deleted', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [flag(cloneOf()), startAsClone(blk('camera_setsprite'), wait(0.1), blk('control_delete_this_clone'))]),
    ])
    rt.greenFlag()
    ticks(2)
    const slot = rt.store.slotOf(rt.camera.sprite!)
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(slot).not.toBe(a.slot)
    ticks(10)
    // The stage then goes back to the viewer's camera.
    expect(rt.store.slotOf(rt.camera.sprite!)).toBe(-1)
  })

  it('ignores a view it does not know', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(blk('camera_setsprite'), view('below'))])])
    rt.greenFlag()
    ticks(1)
    expect(rt.camera.sprite).not.toBeNull()
    expect(rt.camera.viewRequests).toBe(0)
  })

  it('keeps zoom within 10–1000%, and 100% is a 45° view', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(zoom('camera_setzoomto', 5000), wait(0.1), zoom('camera_setzoomto', 0), wait(0.1), zoom('camera_changezoomby', 40))]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.camera.zoom).toBe(1000)
    // The zoom before the tick is kept for interpolation.
    expect(rt.camera.prevZoom).toBe(100)
    ticks(10)
    expect(rt.camera.zoom).toBe(10)
    ticks(10)
    expect(rt.camera.zoom).toBe(50)
    expect(fovOf(100)).toBeCloseTo(45)
    // Twice the zoom, half the view's height on screen.
    expect(Math.tan((fovOf(200) * Math.PI) / 360)).toBeCloseTo(Math.tan((45 * Math.PI) / 360) / 2)
  })

  it('setting a view resets the zoom', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(zoom('camera_setzoomto', 300), view('front'))])])
    rt.greenFlag()
    ticks(1)
    expect(rt.camera.zoom).toBe(100)
  })

  it('stopping, the green flag and opening a project give the camera back to the viewer at zoom 100%', () => {
    const script = flag(blk('camera_setsprite'), zoom('camera_setzoomto', 300))
    const { rt, ticks } = setup([makeSprite('a', [script])])
    const run = () => {
      rt.greenFlag()
      ticks(1)
      expect(rt.camera.sprite).not.toBeNull()
      expect(rt.camera.zoom).toBe(300)
    }
    run()
    rt.stopAll()
    expect([rt.camera.sprite, rt.camera.zoom, rt.camera.prevZoom]).toEqual([null, 100, 100])
    run()
    loadProject(rt, parseProject(serializeProject(rt)))
    expect([rt.camera.sprite, rt.camera.zoom]).toEqual([null, 100])
  })
})

const goTo = (to: string) => blk('motion_goto', { inputs: { TO: { shadow: blk('motion_goto_menu', { fields: { TO: to } }) } } })
const glideTo = (secs: number, to: string) =>
  blk('motion_glideto', { inputs: { SECS: num(secs), TO: { shadow: blk('motion_glideto_menu', { fields: { TO: to } }) } } })
const pointTowards = (to: string) =>
  blk('motion_pointtowards', { inputs: { TOWARDS: { shadow: blk('motion_pointtowards_menu', { fields: { TOWARDS: to } }) } } })

describe('go to, glide to and point towards', () => {
  it('goes to another sprite in 3D, drawing with the pen', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [flag(blk('pen_penDown'), goTo('b'), goTo('nobody'))]),
      makeSprite('b', [], { x: 30, y: -40, z: 50 }),
    ])
    rt.greenFlag()
    ticks(1)
    expect([a.x, a.y, a.z]).toEqual([30, -40, 50])
    expect(rt.pen.segmentCount).toBe(1)
  })

  it('goes to the mouse pointer or a random position on the stage, keeping its height', () => {
    const { rt, sprites: [a], ticks } = setup([makeSprite('a', [flag(goTo('_mouse_'), wait(0.1), goTo('_random_'))], { z: 25 })])
    rt.mouse.x = 70
    rt.mouse.y = 80
    rt.greenFlag()
    ticks(1)
    expect([a.x, a.y, a.z]).toEqual([70, 80, 25])
    ticks(10)
    expect(Math.abs(a.x)).toBeLessThanOrEqual(240)
    expect(Math.abs(a.y)).toBeLessThanOrEqual(180)
    expect([Number.isInteger(a.x), Number.isInteger(a.y), a.z]).toEqual([true, true, 25])
  })

  it('glides to where another sprite was when it started, in 3D', () => {
    const { rt, sprites: [a, b], ticks } = setup([
      makeSprite('a', [flag(glideTo(1, 'b'))]),
      makeSprite('b', [], { x: 60, y: -120, z: 90 }),
    ])
    rt.greenFlag()
    ticks(1)
    b.x = 0
    ticks(30)
    expect([a.x, a.y, a.z].map(Math.round)).toEqual([30, -60, 45])
    ticks(30)
    expect([a.x, a.y, a.z]).toEqual([60, -120, 90])
  })

  it('glides to the mouse pointer keeping its height, and not at all to a sprite that is not there', () => {
    const { rt, sprites: [a], ticks } = setup([makeSprite('a', [flag(glideTo(0.5, 'nobody'), glideTo(0.5, '_mouse_'))], { z: 25 })])
    rt.mouse.x = 70
    rt.mouse.y = 80
    rt.greenFlag()
    ticks(16)
    expect([a.x, a.y, a.z].map(Math.round)).toEqual([35, 40, 25])
    ticks(20)
    expect([a.x, a.y, a.z]).toEqual([70, 80, 25])
  })

  it('points towards another sprite in 3D: direction and pitch', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [flag(pointTowards('b'))], { roll: 20 }),
      makeSprite('b', [], { x: 100, y: 100, z: 100 * Math.SQRT2 }),
    ])
    rt.greenFlag()
    ticks(1)
    expect(a.direction).toBeCloseTo(45)
    expect(a.pitch).toBeCloseTo(45)
    expect(a.roll).toBe(20)
  })

  it('points straight up at a sprite above, keeping its direction', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [flag(pointTowards('b'))], { direction: 30 }),
      makeSprite('b', [], { z: 100 }),
    ])
    rt.greenFlag()
    ticks(1)
    expect([a.direction, a.pitch]).toEqual([30, 90])
  })

  it('points towards the mouse pointer on the workplane, keeping its pitch, or in a random direction', () => {
    const { rt, sprites: [a], ticks } = setup([makeSprite('a', [flag(pointTowards('_mouse_'), wait(0.1), pointTowards('_random_'))], { pitch: 10 })])
    rt.mouse.x = -50
    rt.mouse.y = 0
    rt.greenFlag()
    ticks(1)
    expect([a.direction, a.pitch]).toEqual([-90, 10])
    ticks(10)
    expect(Number.isInteger(a.direction)).toBe(true)
    expect(a.direction).toBeGreaterThan(-180)
    expect(a.direction).toBeLessThanOrEqual(180)
    expect(a.pitch).toBe(10)
  })

  it('a camera sprite chasing another: the third-person view', () => {
    // Each tick: point towards the player and move 5 steps.
    const chase = flag(blk('camera_setsprite'), forever(pointTowards('player'), blk('motion_movesteps', { inputs: { STEPS: num(5) } })))
    const { rt, sprites: [cam], ticks } = setup([
      makeSprite('cam', [chase], { x: -200, z: 100 }),
      makeSprite('player', [], { x: 100, z: 20 }),
    ])
    rt.greenFlag()
    ticks(20)
    expect(rt.camera.sprite).toBe(rt.store.handle(cam.slot))
    expect(cam.x).toBeGreaterThan(-200)
    expect(cam.direction).toBeCloseTo(90)
    expect(cam.pitch).toBeLessThan(0)
  })

  it('renames sprites in their menus', () => {
    const { rt } = setup([makeSprite('a', [flag(goTo('b'), glideTo(1, 'b'), pointTowards('b'))]), makeSprite('b', [])])
    rt.renameSprite(rt.getSprite('b')!, 'c')
    const text = JSON.stringify(rt.getSprite('a')!.blocks)
    expect(text).not.toContain('"b"')
    expect(text.match(/"c"/g)).toHaveLength(3)
  })
})
