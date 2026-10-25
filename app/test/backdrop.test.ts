import { describe, expect, it } from 'vitest'
import { plainBackdrop, type BackdropData } from '../src/engine/backdrop'
import { loadProject, parseProject, ProjectFormatError, serializeProject } from '../src/engine/project'
import type { Runtime } from '../src/engine/runtime'
import { F_VISIBLE } from '../src/engine/store'
import { blk, flag, getVar, makeSprite, num, reporter, setVar, setup, stack, text, wait } from './helpers'

const switchTo = (name: string) => blk('looks_switchbackdropto', { inputs: { BACKDROP: { shadow: blk('looks_backdrops', { fields: { BACKDROP: name } }) } } })
const switchToValue = (input: ReturnType<typeof num>) => blk('looks_switchbackdropto', { inputs: { BACKDROP: input } })
const whenSwitchesTo = (name: string, ...body: ReturnType<typeof blk>[]) =>
  stack(blk('event_whenbackdropswitchesto', { fields: { BACKDROP: name } }), ...body)
const backdropIs = (what: 'number' | 'name') => blk('looks_backdropnumbername', { fields: { NUMBER_NAME: what } })

function withBackdrops(rt: Runtime, ...names: string[]): BackdropData[] {
  const list = names.map((n) => plainBackdrop(n))
  rt.backdrops.set(list, 0)
  return list
}

describe('backdrops', () => {
  it('switches by name, next, previous and number (wrapping), and ignores what it does not know', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(
          switchTo('night'), wait(0.1),
          blk('looks_nextbackdrop'), wait(0.1),
          switchTo('previous backdrop'), switchTo('previous backdrop'), wait(0.1),
          switchToValue(num(5)), wait(0.1),
          switchToValue(text('nobody')), switchToValue(text(' ')),
        ),
      ]),
    ])
    withBackdrops(rt, 'day', 'night', 'space')
    rt.greenFlag()
    const seen: number[] = []
    for (let k = 0; k < 5; k++) {
      ticks(k === 0 ? 1 : 7)
      seen.push(rt.backdrops.current)
    }
    expect(seen).toEqual([1, 2, 0, 1, 1])
  })

  it('a backdrop named like a number is found by its name first', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(switchToValue(num(1)))])])
    withBackdrops(rt, 'day', '1')
    rt.greenFlag()
    ticks(1)
    expect(rt.backdrops.current).toBe(1)
  })

  it('a random backdrop is never the current one', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(blk('control_forever', { inputs: { SUBSTACK: { block: switchTo('random backdrop') } } }))])])
    withBackdrops(rt, 'a', 'b', 'c')
    rt.greenFlag()
    let last = rt.backdrops.current
    const used = new Set<number>()
    for (let k = 0; k < 30; k++) {
      ticks(1)
      expect(rt.backdrops.current).not.toBe(last)
      last = rt.backdrops.current
      used.add(last)
    }
    expect(used.size).toBe(3)
  })

  it('starts "when backdrop switches to" next tick, ignoring case, even when it already was the current one; names switch to only as written', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(switchTo('Night'), wait(0.1), switchTo('Night'), switchTo('night')),
        whenSwitchesTo('NIGHT', setVar('n', { block: blk('operator_add', { inputs: { NUM1: reporter(getVar('n')), NUM2: num(1) } }) })),
        whenSwitchesTo('day', setVar('d', num(1))),
      ]),
    ])
    rt.variableDefs = [{ id: 'n', name: 'n' }, { id: 'd', name: 'd' }]
    withBackdrops(rt, 'day', 'Night')
    rt.greenFlag()
    ticks(1)
    expect(rt.getVariable('n')).toBe(0)
    ticks(1)
    expect(rt.getVariable('n')).toBe(1)
    ticks(10)
    expect(rt.getVariable('n')).toBe(2)
    expect(rt.getVariable('d')).toBe(0)
  })

  it('reports the backdrop number and name', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(switchTo('space'), setVar('n', { block: backdropIs('number') }), setVar('m', { block: backdropIs('name') }))]),
    ])
    rt.variableDefs = [{ id: 'n', name: 'n' }, { id: 'm', name: 'm' }]
    withBackdrops(rt, 'day', 'space')
    rt.greenFlag()
    ticks(1)
    expect([rt.getVariable('n'), rt.getVariable('m')]).toEqual([2, 'space'])
  })

  it('renaming a backdrop renames it in menus and hats, and a taken name gets a number', () => {
    const { rt } = setup([makeSprite('a', [flag(switchTo('day')), whenSwitchesTo('day')]), makeSprite('b', [flag(switchTo('day'))])])
    withBackdrops(rt, 'day', 'sky')
    expect(rt.renameBackdrop(0, 'sky')).toBe('sky2')
    for (const s of rt.sprites) {
      const json = JSON.stringify(s.blocks)
      expect(json).not.toContain('"day"')
      expect(json).toContain('"sky2"')
    }
    expect(rt.renameBackdrop(0, '  ')).toBeNull()
  })

  it('saves the backdrops and the current one; stopping keeps it', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(switchTo('night'))])])
    const [, night] = withBackdrops(rt, 'day', 'night')
    night.scenery = '#102040'
    night.faces.floor.color = null
    night.faces.back.color = '#203040'
    night.grid = false
    rt.greenFlag()
    ticks(1)
    rt.stopAll()
    expect(rt.backdrops.current).toBe(1)
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    expect(file.backdrop).toBe(1)
    expect(file.backdrops[1]).toEqual(night)
    const { rt: other } = setup([])
    loadProject(other, file)
    expect(other.backdrops.backdrop).toEqual(night)
    expect(other.backdrops.list[1]).not.toBe(night)
  })

  it('opens files from before backdrops with one plain backdrop, and refuses bad ones', () => {
    const { rt } = setup([makeSprite('a', [])])
    const json = serializeProject(rt) as unknown as Record<string, unknown>
    delete json.backdrops
    delete json.backdrop
    const file = parseProject(json)
    loadProject(rt, file)
    expect(rt.backdrops.list).toHaveLength(1)
    expect(rt.backdrops.backdrop.grid).toBe(true)
    const bad = (patch: Record<string, unknown>) => () => parseProject({ ...serializeProject(rt), ...patch })
    expect(bad({ backdrop: 1 })).toThrow(ProjectFormatError)
    expect(bad({ backdrops: [{ ...plainBackdrop('x'), scenery: 'red' }] })).toThrow(/color/)
    const noWall = plainBackdrop('x') as unknown as { faces: Record<string, unknown> }
    delete noWall.faces.left
    expect(bad({ backdrops: [noWall] })).toThrow(/faces.left/)
  })
})

const onStage = (rt: Runtime, ...scripts: ReturnType<typeof blk>[]) => {
  rt.stage.blocks = { blocks: { languageVersion: 0, blocks: scripts } }
}
const cloneOfSprite = (name: string) =>
  blk('control_create_clone_of', { inputs: { CLONE_OPTION: { shadow: blk('control_create_clone_of_menu', { fields: { CLONE_OPTION: name } }) } } })

describe('the stage', () => {
  it('runs its own scripts: the green flag, messages and backdrops', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(blk('event_broadcast', { inputs: { BROADCAST_INPUT: text('go') } }))])])
    withBackdrops(rt, 'day', 'night')
    rt.variableDefs = [{ id: 'n', name: 'n' }]
    onStage(
      rt,
      flag(setVar('n', num(1))),
      stack(blk('event_whenbroadcastreceived', { fields: { BROADCAST_OPTION: 'go' } }), switchTo('night')),
    )
    rt.greenFlag()
    ticks(3)
    expect(rt.getVariable('n')).toBe(1)
    expect(rt.backdrops.current).toBe(1)
  })

  it('"when stage clicked" starts on a click on the stage', () => {
    const { rt, ticks } = setup([makeSprite('a', [])])
    rt.variableDefs = [{ id: 'n', name: 'n' }]
    onStage(rt, stack(blk('event_whenstageclicked'), setVar('n', num(5))))
    rt.stageClicked()
    ticks(1)
    expect(rt.getVariable('n')).toBe(5)
  })

  it('"switch backdrop to and wait" waits for the scripts it started', () => {
    const { rt, ticks } = setup([makeSprite('a', [whenSwitchesTo('night', wait(0.5))])])
    withBackdrops(rt, 'day', 'night')
    rt.variableDefs = [{ id: 'n', name: 'n' }]
    onStage(rt, flag(blk('looks_switchbackdroptoandwait', { inputs: { BACKDROP: { shadow: blk('looks_backdrops', { fields: { BACKDROP: 'night' } }) } } }), setVar('n', num(1))))
    rt.greenFlag()
    ticks(20)
    expect(rt.getVariable('n')).toBe(0)
    ticks(20)
    expect(rt.getVariable('n')).toBe(1)
  })

  it('leaves out what only sprites do, makes clones of sprites but not of itself, and is not a sprite', () => {
    const { rt, sprites: [a], ticks } = setup([makeSprite('a', [])])
    onStage(
      rt,
      flag(blk('motion_movesteps', { inputs: { STEPS: num(10) } }), blk('looks_show'), cloneOfSprite('_myself_'), cloneOfSprite('a')),
      stack(blk('control_start_as_clone'), blk('looks_show')),
    )
    rt.greenFlag()
    ticks(2)
    expect(rt.clonesOf(a)).toHaveLength(1)
    expect(rt.entities()).toHaveLength(2)
    expect(rt.store.flags[rt.stage.slot] & F_VISIBLE).toBe(0)
    expect(rt.sprites).toEqual([a])
    expect(rt.kindByName('')).toBe(-1)
  })

  it('renaming a sprite renames it in the stage\'s blocks, and the stage\'s blocks are saved', () => {
    const { rt } = setup([makeSprite('a', [])])
    onStage(rt, flag(cloneOfSprite('a')))
    rt.renameSprite(rt.sprites[0], 'b')
    expect(JSON.stringify(rt.stage.blocks)).toContain('"b"')
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    const { rt: other } = setup([])
    loadProject(other, file)
    expect(other.stage.blocks).toEqual(rt.stage.blocks)
  })
})
