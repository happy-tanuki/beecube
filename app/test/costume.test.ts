import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { AssetRef } from '../src/engine/assets'
import { Looks, plainCostume, type Costume } from '../src/engine/costume'
import { boundingRadius, shapesIntersect } from '../src/engine/collision'
import { parseProject, projectAssets, serializeProject } from '../src/engine/project'
import { SHAPES } from '../src/engine/types'
import { EntityInstances } from '../src/stage/instances'
import { blk, cloneOf, flag, makeSprite, num, reporter, setVar, setup, startAsClone, text, wait } from './helpers'

const switchTo = (name: string) => blk('looks_switchcostumeto', { inputs: { COSTUME: { shadow: blk('looks_costume', { fields: { COSTUME: name } }) } } })
const switchToValue = (input: ReturnType<typeof num>) => blk('looks_switchcostumeto', { inputs: { COSTUME: input } })
const costumeIs = (what: 'number' | 'name') => blk('looks_costumenumbername', { fields: { NUMBER_NAME: what } })

const picture = (n: number): AssetRef => ({ assetId: String(n).repeat(64).slice(0, 64), dataFormat: 'png' })
const ball: Costume = { name: 'ball', shape: 'sphere', picture: picture(1), layout: 'same', model: null }
const dice: Costume = { name: 'dice', shape: 'cube', picture: picture(2), layout: 'net', model: null }
const costumes = [plainCostume('box', 'cube'), ball, dice]

describe('costumes', () => {
  it('switches by name, next, previous and number (wrapping), and ignores what it does not know', () => {
    const { rt, ticks, sprites: [s] } = setup([
      makeSprite('a', [
        flag(
          switchTo('dice'), wait(0.1),
          blk('looks_nextcostume'), wait(0.1),
          switchTo('previous costume'), switchTo('previous costume'), wait(0.1),
          switchToValue(num(5)), wait(0.1),
          switchToValue(text('nobody')), switchToValue(text(' ')),
        ),
      ], { costumes }),
    ])
    rt.greenFlag()
    const seen: number[] = []
    for (let k = 0; k < 5; k++) {
      ticks(k === 0 ? 1 : 7)
      seen.push(s.costume)
    }
    expect(seen).toEqual([2, 0, 1, 1, 1])
  })

  it('wears the costume’s shape and look: collisions follow the shape', () => {
    const { rt, ticks, sprites: [s] } = setup([makeSprite('a', [flag(switchTo('ball'))], { costumes })])
    expect([s.shape, rt.store.look[s.slot]]).toEqual(['cube', 0])
    rt.greenFlag()
    ticks(1)
    expect(s.shape).toBe('sphere')
    const look = rt.looks.list[rt.store.look[s.slot]]
    expect(look).toEqual({ shape: SHAPES.indexOf('sphere'), picture: ball.picture, layout: 'same', model: null, pose: {}, stretch: [1, 1, 1], extent: [1, 1, 1] })
    // The same costume again is the same look.
    expect(rt.looks.of(ball)).toBe(rt.store.look[s.slot])
  })

  it('reports the costume’s number and name', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(switchTo('ball'), setVar('n', reporter(costumeIs('number'))), setVar('name', reporter(costumeIs('name'))))], { costumes }),
    ])
    rt.variableDefs = [{ id: 'n', name: 'n' }, { id: 'name', name: 'name' }]
    rt.greenFlag()
    ticks(1)
    expect([rt.getVariable('n'), rt.getVariable('name')]).toEqual([2, 'ball'])
  })

  it('clones start in their parent’s costume and change theirs on their own', () => {
    const { rt, ticks, sprites: [s] } = setup([
      makeSprite('a', [flag(switchTo('ball'), cloneOf(), switchTo('box')), startAsClone(switchTo('dice'))], { costumes }),
    ])
    rt.greenFlag()
    ticks(1)
    const [clone] = rt.clonesOf(s)
    expect([s.costume, clone.costume]).toEqual([0, 1])
    ticks(1)
    expect([s.costume, clone.costume]).toEqual([0, 2])
    expect(clone.shape).toBe('cube')
  })

  it('setting the shape changes the costume worn, and removing costumes dresses entities again', () => {
    const { sprites: [s] } = setup([makeSprite('a', [], { costumes, costume: 2 })])
    s.shape = 'cylinder'
    expect(s.costumes[2].shape).toBe('cylinder')
    expect(s.costumes[0].shape).toBe('cube')
    s.costumes = s.costumes.slice(0, 2)
    expect([s.costume, s.shape]).toEqual([1, 'sphere'])
  })

  it('renaming a costume updates the sprite’s blocks', () => {
    const { rt, sprites: [s] } = setup([makeSprite('a', [flag(switchTo('ball'))], { costumes })])
    expect(rt.renameCostume(s, 1, 'box')).toBe('box2')
    expect(s.costumes[1].name).toBe('box2')
    expect(JSON.stringify(s.blocks)).toContain('"COSTUME":"box2"')
    expect(rt.renameCostume(s, 1, ' ')).toBeNull()
  })

  it('saves costumes, and opens older files with one costume of their shape', () => {
    const { rt } = setup([makeSprite('a', [], { costumes, costume: 1 })])
    const saved = serializeProject(rt)
    expect(saved.sprites[0].costumes).toEqual(costumes)
    expect(saved.sprites[0].costume).toBe(1)
    expect(projectAssets(saved)).toEqual([ball.picture, dice.picture])
    const { costumes: _c, costume: _i, ...old } = saved.sprites[0]
    const opened = parseProject({ ...saved, version: 1, sprites: [{ ...old, shape: 'cone' }] })
    expect(opened.sprites[0].costumes).toEqual([plainCostume('cone', 'cone')])
    expect(() => parseProject({ ...saved, sprites: [{ ...saved.sprites[0], costumes: [{ ...ball, layout: 'spiral' }] }] })).toThrow(/layout/)
  })

  it('draws entities by look: textured costumes in batches of their own', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(switchTo('dice'))], { costumes }),
      makeSprite('b', [], { costumes, costume: 1 }),
      makeSprite('c', [], { shape: 'sphere' }),
    ])
    const inst = new EntityInstances(new THREE.Scene())
    inst.sync(rt, 1)
    const counts = () => inst.batches.map((b) => b.count)
    const ballLook = rt.looks.of(ball)
    expect(counts()[0]).toBe(1)
    expect(counts()[1]).toBe(1)
    expect(counts()[ballLook]).toBe(1)
    rt.greenFlag()
    ticks(1)
    inst.sync(rt, 1)
    expect(counts()[0]).toBe(0)
    expect(counts()[rt.looks.of(dice)]).toBe(1)
    // A textured cube has texture coordinates: the net's front is its second column, middle row.
    const g = inst.batches[rt.looks.of(dice)].mesh.geometry
    expect(g.getAttribute('uv').getX(0)).toBeCloseTo(0.25)
  })

  it('a model touches things as its box: the shapes stretched by its extent', () => {
    const car: Costume = { ...plainCostume('car', 'sphere'), model: { asset: { assetId: 'a'.repeat(64), dataFormat: 'glb' }, size: [1, 0.5, 0.25] } }
    const { rt, sprites: [a, b] } = setup([
      makeSprite('a', [], { costumes: [car], x: 0 }),
      makeSprite('b', [], { x: 0, y: 31 }),
    ])
    const E = rt.store
    // A model is a box (a cube's collisions), whatever the costume's shape says.
    expect(a.shape).toBe('cube')
    expect([E.extentX[a.slot], E.extentY[a.slot], E.extentZ[a.slot]]).toEqual([1, 0.5, 0.25])
    // Half as wide (across y) as a cube: it reaches 10 from its middle, and b (a cube of 40) from 11.
    expect(shapesIntersect(E, a.slot, b.slot)).toBe(false)
    b.y = 29
    expect(shapesIntersect(E, a.slot, b.slot)).toBe(true)
    expect(boundingRadius(E, a.slot)).toBeCloseTo(20 * Math.sqrt(3))
    // Back in a plain costume, the extents are 1 again.
    a.costumes = [plainCostume('box', 'cube')]
    expect([E.extentX[a.slot], E.extentY[a.slot], E.extentZ[a.slot]]).toEqual([1, 1, 1])
    // Clones copy the extents.
    a.costumes = [car]
    rt.createClone(a.slot, -1)
    const [clone] = rt.clonesOf(a)
    expect(E.extentZ[clone.slot]).toBe(0.25)
  })

  it('makes a look for each pose of a model, the same for the same pose', () => {
    const asset = { assetId: 'c'.repeat(64), dataFormat: 'glb' as const }
    const model = (pose?: Record<string, [number, number, number]>): Costume => ({ ...plainCostume('m', 'cube'), model: { asset, size: [1, 1, 1], pose } })
    const looks = new Looks()
    const still = looks.of(model())
    const nod = looks.of(model({ head: [0, 20, 0], arm: [10, 0, 0] }))
    expect(nod).not.toBe(still)
    expect(looks.of(model({ arm: [10, 0, 0], head: [0, 20, 0] }))).toBe(nod)
    expect(looks.of(model({}))).toBe(still)
    expect(looks.list[nod].pose).toEqual({ head: [0, 20, 0], arm: [10, 0, 0] })
  })

  it('saves models, and rejects ones that are not binary glTF or have no size', () => {
    const model = { asset: { assetId: 'b'.repeat(64), dataFormat: 'glb' as const }, size: [1, 0.5, 0.25] as [number, number, number] }
    const { rt } = setup([makeSprite('a', [], { costumes: [{ ...plainCostume('m', 'cube'), model }] })])
    const saved = serializeProject(rt)
    expect(parseProject(saved).sprites[0].costumes[0].model).toEqual(model)
    expect(projectAssets(saved)).toEqual([model.asset])
    const withModel = (m: unknown) => ({ ...saved, sprites: [{ ...saved.sprites[0], costumes: [{ ...saved.sprites[0].costumes[0], model: m }] }] })
    expect(() => parseProject(withModel({ ...model, asset: { ...model.asset, dataFormat: 'png' } }))).toThrow(/model\.asset\.dataFormat/)
    expect(() => parseProject(withModel({ ...model, size: [1, 0, 1] }))).toThrow(/model\.size/)
    // A pose is saved, and is three angles for each bone.
    const posed = { ...model, pose: { head: [0, 30, -10] as [number, number, number] } }
    expect(parseProject(withModel(posed)).sprites[0].costumes[0].model).toEqual(posed)
    expect(parseProject(withModel({ ...model, pose: {} })).sprites[0].costumes[0].model).toEqual(model)
    expect(() => parseProject(withModel({ ...model, pose: { head: [0, 30] } }))).toThrow(/pose\["head"\]/)
    expect(() => parseProject(withModel({ ...model, pose: { head: [0, 'x', 0] } }))).toThrow(/pose\["head"\]/)
    // A picture can't be a model either.
    const picture = { ...saved.sprites[0].costumes[0], model: null, picture: model.asset }
    expect(() => parseProject({ ...saved, sprites: [{ ...saved.sprites[0], costumes: [picture] }] })).toThrow(/picture\.dataFormat/)
  })

  it('gives a costume its own width, depth and height: drawn and touching things so, and scaled by the sprite’s', () => {
    const board: Costume = { ...plainCostume('board', 'cube'), dimensions: [40, 20, 4] }
    const { rt, sprites: [a, b] } = setup([
      makeSprite('a', [], { costumes: [board, plainCostume('box', 'cube')] }),
      makeSprite('b', [], { x: 0, y: 31 }),
    ])
    const E = rt.store
    const look = rt.looks.of(board)
    expect(look).toBeGreaterThanOrEqual(SHAPES.length)
    expect(rt.looks.list[look].stretch).toEqual([1, 0.5, 0.1])
    expect([E.extentX[a.slot], E.extentY[a.slot], E.extentZ[a.slot]]).toEqual([1, 0.5, 0.1])
    // 20 deep: it reaches 10 from its middle across y, b from 11.
    expect(shapesIntersect(E, a.slot, b.slot)).toBe(false)
    // The sprite's own depth scales it: 30 from its middle.
    a.depth = 300
    expect(shapesIntersect(E, a.slot, b.slot)).toBe(true)
    a.depth = 100
    // The same dimensions are the same look; a cube's own are the plain cube's.
    expect(rt.looks.of({ ...board, name: 'other' })).toBe(look)
    expect(rt.looks.of({ ...board, dimensions: [40, 40, 40] })).toBe(0)
    // A model's own are its box's, as drawn (its longest side a cube's): half as wide is 10.
    const asset = { assetId: 'd'.repeat(64), dataFormat: 'glb' as const }
    const thin = rt.looks.of({ ...plainCostume('m', 'cube'), model: { asset, size: [0.5, 0.5, 1] }, dimensions: [10, 20, 40] })
    expect(rt.looks.list[thin].stretch).toEqual([0.5, 1, 1])
    expect(rt.looks.list[thin].extent).toEqual([0.25, 0.5, 1])
    // Drawn so.
    const inst = new EntityInstances(new THREE.Scene())
    inst.sync(rt, 1)
    const g = inst.batches[look].mesh.geometry
    g.computeBoundingBox()
    expect(g.boundingBox!.max.toArray()).toEqual([20, 10, 2])
  })

  it('saves a costume’s width, depth and height, kept to what a cube can be stretched to', () => {
    const { rt } = setup([makeSprite('a', [], { costumes: [{ ...plainCostume('board', 'cube'), dimensions: [40, 20, 4] }], width: 80 })])
    const saved = serializeProject(rt)
    const opened = parseProject(saved).sprites[0]
    expect(opened.costumes[0].dimensions).toEqual([40, 20, 4])
    // The sprite keeps its own width.
    expect(opened.width).toBe(80)
    const withDimensions = (dimensions: unknown) =>
      parseProject({ ...saved, sprites: [{ ...saved.sprites[0], costumes: [{ ...saved.sprites[0].costumes[0], dimensions }] }] }).sprites[0].costumes[0]
    expect(withDimensions([40, 40, 40]).dimensions).toBeUndefined()
    expect(withDimensions([0, 5000, 40]).dimensions).toEqual([0.4, 800, 40])
    expect(() => withDimensions([40, 40])).toThrow(/dimensions/)
    // Older files have none.
    expect(parseProject({ ...saved, version: 2, sprites: [{ ...saved.sprites[0], costumes: [plainCostume('box', 'cube')] }] }).sprites[0].costumes[0].dimensions).toBeUndefined()
  })
})
