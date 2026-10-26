import { describe, expect, it } from 'vitest'
import { bounced, bounceOffEdge, bounds, touchingEdge } from '../src/engine/collision'
import { STAMP_POSE } from '../src/engine/pen'
import { loadProject, parseProject, ProjectFormatError, serializeProject } from '../src/engine/project'
import { Runtime } from '../src/engine/runtime'
import type { BlockJson } from '../src/engine/types'
import {
  blk,
  changeVar,
  changeX,
  changeY,
  cloneOf,
  flag,
  forever,
  getVar,
  makeSprite,
  num,
  repeat,
  reporter,
  setup,
  setVar,
  setX,
  stack,
  startAsClone,
  sub,
  text,
  wait,
} from './helpers'

const dimension = (op: string, which: string, n: number) =>
  blk(op, { fields: { DIMENSION: which }, inputs: { VALUE: num(n) } })

describe('width, depth and height', () => {
  it('sets and changes each dimension, within 1–2000%', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [
        flag(
          dimension('looks_setdimensionto', 'width', 300),
          dimension('looks_changedimensionby', 'depth', -50),
          dimension('looks_setdimensionto', 'height', 0),
          setVar('w', reporter(blk('looks_width'))),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([a.width, a.depth, a.height]).toEqual([300, 50, 1])
    expect(rt.getVariable('w')).toBe(300)
    a.width = 5000
    expect(a.width).toBe(2000)
  })

  it('stretches the shape along its own axes', () => {
    const { rt, sprites: [a] } = setup([makeSprite('a', [], { width: 300, depth: 50, height: 25 })])
    // Size 100 is 40 units: 120 along the heading (x at direction 90), 20 across, 10 high.
    expect(bounds(rt.store, a.slot)).toMatchObject({ maxX: 60, maxY: 10, maxZ: 5 })
    a.direction = 0
    const b = bounds(rt.store, a.slot)
    expect(b.maxX).toBeCloseTo(10)
    expect(b.maxY).toBeCloseTo(60)
  })

  it('reaches clones, stamps, the "of" block and the project file', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(cloneOf(), blk('pen_stamp'))], { height: 40 }),
      makeSprite('b', [
        flag(
          setVar(
            'h',
            reporter(
              blk('sensing_of', {
                fields: { PROPERTY: 'height' },
                inputs: { OBJECT: { shadow: blk('sensing_of_object_menu', { fields: { OBJECT: 'a' } }) } },
              }),
            ),
          ),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.clonesOf(rt.getSprite('a')!)[0].height).toBe(40)
    expect(rt.pen.stampPoses[9]).toBe(40)
    expect(rt.getVariable('h')).toBe(40)
    const saved = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    expect(saved.sprites[0]).toMatchObject({ width: 100, depth: 100, height: 40 })
  })
})

describe('motion', () => {
  it('moves in 3D with set/change z and go to x y z', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          blk('motion_gotoxyz', { inputs: { X: num(10), Y: num(20), Z: num(30) } }),
          blk('motion_changezby', { inputs: { DZ: num(5) } }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([s.x, s.y, s.z]).toEqual([10, 20, 35])
  })

  it('move steps follows direction and pitch', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          blk('motion_pointindirection', { inputs: { DIRECTION: num(0) } }),
          blk('motion_setpitch', { inputs: { PITCH: num(90) } }),
          blk('motion_movesteps', { inputs: { STEPS: num(10) } }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(s.x).toBeCloseTo(0)
    expect(s.y).toBeCloseTo(0)
    expect(s.z).toBeCloseTo(10)
  })

  it('wraps direction into (-180, 180]', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(blk('motion_turnright', { inputs: { DEGREES: num(270) } }))])])
    rt.greenFlag()
    ticks(1)
    expect(s.direction).toBe(0)
  })

  it('glides over logical time', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(blk('motion_glidesecstoxy', { inputs: { SECS: num(1), X: num(60), Y: num(0) } }))]),
    ])
    rt.greenFlag()
    ticks(31)
    expect(s.x).toBeCloseTo(30)
    ticks(30)
    expect(s.x).toBe(60)
    expect(rt.isScriptRunning(s, s.blocks!.blocks!.blocks[0].id)).toBe(false)
  })
})

describe('scheduling', () => {
  it('runs one loop iteration per tick for loops with visible effects', () => {
    const { rt, sprites: [a, b], ticks } = setup([
      makeSprite('a', [flag(repeat(3, changeX(1)))]),
      makeSprite('b', [flag(forever(changeY(1)))]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([a.x, b.y]).toEqual([1, 1])
    ticks(2)
    expect([a.x, b.y]).toEqual([3, 3])
    ticks(5)
    expect(a.x).toBe(3)
    expect(b.y).toBe(8)
    const top = (s: typeof a) => s.blocks!.blocks!.blocks[0].id
    expect(rt.isScriptRunning(a, top(a))).toBe(false)
    expect(rt.isScriptRunning(b, top(b))).toBe(true)
  })

  it('runs computation-only loops within one tick', () => {
    const loop = () => flag(repeat(10, changeVar('v', 1), changeVar('v', 1)))
    const { rt, ticks } = setup([makeSprite('a', [loop()]), makeSprite('b', [loop()])])
    rt.greenFlag()
    ticks(1)
    expect(rt.getVariable('v')).toBe(40)
  })

  it('"repeat until" waits for conditions only something else can change', () => {
    const keyLoop = blk('control_repeat_until', {
      inputs: {
        CONDITION: reporter(blk('sensing_keypressed', { inputs: { KEY_OPTION: { shadow: blk('sensing_keyoptions', { fields: { KEY_OPTION: 'space' } }) } } })),
      },
    })
    const countLoop = blk('control_repeat_until', {
      inputs: {
        CONDITION: reporter(blk('operator_gt', { inputs: { OPERAND1: reporter(getVar('n')), OPERAND2: num(100) } })),
        SUBSTACK: sub(changeVar('n', 1)),
      },
    })
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(keyLoop, setX(1)), flag(countLoop)])])
    rt.greenFlag()
    ticks(1)
    // The counting loop changes its own condition, so it finishes at once.
    expect(rt.getVariable('n')).toBe(101)
    ticks(5)
    expect(s.x).toBe(0)
    rt.keyPressed('space')
    ticks(1)
    expect(s.x).toBe(1)
  })

  it('waits whole ticks of logical time', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(wait(1), setX(99))])])
    rt.greenFlag()
    ticks(60)
    expect(s.x).toBe(0)
    ticks(1)
    expect(s.x).toBe(99)
    expect(rt.timer).toBeCloseTo(1)
  })

  it('stop all ends every script', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(forever(changeX(1))), flag(wait(0.1), blk('control_stop', { fields: { STOP_OPTION: 'all' } }))]),
    ])
    rt.greenFlag()
    ticks(10)
    const x = s.x
    expect(x).toBe(7)
    ticks(5)
    expect(s.x).toBe(x)
  })

  it('green flag restarts scripts and key hats do not restart running ones', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [stack(blk('event_whenkeypressed', { fields: { KEY_OPTION: 'space' } }), repeat(5, changeX(1)))]),
    ])
    rt.keyPressed('space')
    ticks(2)
    rt.keyPressed('space')
    ticks(10)
    expect(s.x).toBe(5)
  })

  it('classifies scripts: per-frame "forever", state machines and immediate ones', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(setX(1), forever(changeX(1))), flag(forever(wait(1))), flag(setX(2))]),
    ])
    rt.greenFlag()
    ticks(1)
    const plans = rt.kinds[0].scripts.map((s) => s.plan)
    expect(plans.map((p) => p.perFrame)).toEqual([true, false, false])
  })

  it('"stop this script" inside a custom block returns from it', () => {
    const esc = (v: unknown) => JSON.stringify(v).replace(/"/g, '&quot;')
    const mutation = `<mutation proccode="early" argumentids="${esc([])}" argumentnames="${esc([])}" warp="false"></mutation>`
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        stack(
          blk('procedures_definition', { inputs: { custom_block: { shadow: blk('procedures_prototype', { extraState: mutation }) } } }),
          changeX(1),
          blk('control_stop', { fields: { STOP_OPTION: 'this script' } }),
          changeX(100),
        ),
        flag(blk('procedures_call', { extraState: mutation }), changeY(1)),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([s.x, s.y]).toEqual([1, 1])
  })

  it('repeats exactly with a random seed', () => {
    const script = () => [flag(repeat(5, blk('data_addtolist', { fields: { LIST: { id: 'l' } }, inputs: { ITEM: reporter(blk('operator_random', { inputs: { FROM: num(1), TO: num(1000) } })) } })))]
    const run = () => {
      const { rt, ticks } = setup([makeSprite('a', script())], { randomSeed: 42 })
      rt.listDefs = [{ id: 'l', name: 'l' }]
      rt.greenFlag()
      ticks(1)
      return [...rt.getList('l')]
    }
    const first = run()
    expect(first).toHaveLength(5)
    expect(first.every((v) => Number.isInteger(v))).toBe(true)
    expect(run()).toEqual(first)
  })

  it('keeps running unchanged scripts when the blocks are edited', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(forever(changeX(1)))])])
    rt.greenFlag()
    ticks(3)
    // A new variable changes the storage layout; the running script is unchanged.
    rt.variableDefs = [{ id: 'v', name: 'v' }]
    s.blocks = { blocks: { languageVersion: 0, blocks: [...s.blocks!.blocks!.blocks, flag(setVar('v', text('hello')))] } }
    ticks(2)
    expect(s.x).toBe(5)
  })

  /** A copy of the sprite's blocks with the number typed into a block's input changed. */
  const retyped = (blocks: { blocks?: { blocks: BlockJson[] } } | null, id: string, input: string, value: number) => {
    const copy = structuredClone(blocks)!
    const visit = (b: BlockJson | undefined): void => {
      if (!b) return
      if (b.id === id) b.inputs![input].shadow!.fields!.NUM = value
      for (const slot of Object.values(b.inputs ?? {})) {
        visit(slot.block)
        visit(slot.shadow)
      }
      visit(b.next?.block)
    }
    copy.blocks!.blocks.forEach(visit)
    return copy
  }

  it('applies edits to a running forever loop at once', () => {
    const step = changeX(1)
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(repeat(3, cloneOf())), stack(blk('control_start_as_clone'), forever(step))])])
    rt.greenFlag()
    ticks(4)
    const before = rt.clonesOf(s).map((c) => c.x)
    s.blocks = retyped(s.blocks, step.id, 'DX', 10)
    ticks(2)
    expect(rt.clonesOf(s).map((c) => c.x)).toEqual(before.map((x) => x + 20))
  })

  it('moves a waiting script to the edited code, keeping where it was', () => {
    const step = changeX(1)
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(repeat(3, wait(0.5), step))])])
    rt.greenFlag()
    ticks(40)
    expect(s.x).toBe(1)
    // A new variable also changes the storage layout.
    rt.variableDefs = [{ id: 'v', name: 'v' }]
    s.blocks = retyped(s.blocks, step.id, 'DX', 10)
    ticks(100)
    expect(s.x).toBe(21)
  })

  it('keeps a script on its old code when the block it waits in is removed', () => {
    const pause = wait(0.5)
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(pause, changeX(1))])])
    rt.greenFlag()
    ticks(5)
    s.blocks = { blocks: { languageVersion: 0, blocks: [flag(changeX(100))] } }
    ticks(60)
    expect(s.x).toBe(1)
  })
})

describe('pen', () => {
  it('records 3D segments while the pen is down', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(
          blk('pen_penDown'),
          blk('motion_gotoxyz', { inputs: { X: num(0), Y: num(0), Z: num(50) } }),
          blk('pen_penUp'),
          blk('motion_gotoxyz', { inputs: { X: num(10), Y: num(0), Z: num(50) } }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.pen.segmentCount).toBe(1)
    expect([...rt.pen.positions.subarray(0, 6)]).toEqual([0, 0, 0, 0, 0, 50])
  })

  it('draws a wireframe cube as 12 edges', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(blk('pen_drawCube', { inputs: { SIZE: num(20) } }))])])
    rt.greenFlag()
    ticks(1)
    expect(rt.pen.segmentCount).toBe(12)
  })

  const colorParam = (op: string, param: string, n: number) =>
    blk(op, { fields: { COLOR_PARAM: param }, inputs: { VALUE: num(n) } })
  const moveZ = (z: number) => blk('motion_gotoxyz', { inputs: { X: num(0), Y: num(0), Z: num(z) } })

  it('changes the pen color by hue, saturation and brightness, wrapping the hue', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(
          blk('pen_setPenColorToColor', { inputs: { COLOR: { shadow: blk('colour_picker', { fields: { COLOUR: '#ff0000' } }) } } }),
          colorParam('pen_changePenColorParamBy', 'color', 133.333),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    const a = rt.getSprite('a')!
    // Red (hue 0) plus a third of the way round is green.
    expect(a.pen.color).toBe('#00ff00')
    expect(rt.store.penHue[a.slot]).toBeCloseTo(33.333)

    rt.stopAll()
    a.blocks = { blocks: { languageVersion: 0, blocks: [flag(colorParam('pen_setPenColorParamTo', 'brightness', 50), colorParam('pen_changePenColorParamBy', 'saturation', -200))] } }
    rt.greenFlag()
    ticks(1)
    expect(a.pen.color).toBe('#808080')
    // Gray keeps its hue, so color changes carry on from it.
    expect(rt.store.penHue[a.slot]).toBeCloseTo(33.333)
  })

  it('draws segments with the pen size and transparency', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(
          blk('pen_setPenSizeTo', { inputs: { SIZE: num(4) } }),
          blk('pen_changePenSizeBy', { inputs: { SIZE: num(2000) } }),
          colorParam('pen_setPenColorParamTo', 'transparency', 25),
          blk('pen_penDown'),
          moveZ(10),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.pen.segmentCount).toBe(1)
    expect([...rt.pen.styles.subarray(0, 2)]).toEqual([1200, 0.75])
    expect(rt.getSprite('a')!.pen).toMatchObject({ size: 1200, transparency: 25 })
  })

  it('stamps the shape where it is, and erase all removes stamps', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(blk('pen_stamp'), moveZ(30), blk('pen_stamp'))], { shape: 'sphere', color: '#336699' }),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.pen.stampCount).toBe(2)
    expect(rt.pen.stampPoses[STAMP_POSE + 2]).toBe(30)
    expect(rt.pen.stampLooks[0]).toBe(1)
    expect(rt.pen.stampColors[0]).toBe(0x336699)
    rt.stopAll()
    rt.getSprite('a')!.blocks = { blocks: { languageVersion: 0, blocks: [flag(blk('pen_clear'))] } }
    rt.greenFlag()
    ticks(1)
    expect(rt.pen.stampCount).toBe(0)
  })

  it('gives clones the pen size and color parts', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(blk('pen_setPenSizeTo', { inputs: { SIZE: num(7) } }), colorParam('pen_setPenColorParamTo', 'transparency', 40), cloneOf()),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    const clone = rt.clonesOf(rt.getSprite('a')!)[0]
    expect(clone.pen).toMatchObject({ size: 7, transparency: 40 })
  })

  it('keeps the pen size and transparency in the project file', () => {
    const { rt } = setup([makeSprite('a', [], { pen: { down: false, color: '#000000', size: 3, transparency: 20 } })])
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    expect(file.sprites[0].pen).toEqual({ down: false, color: '#000000', size: 3, transparency: 20 })
  })
})

describe('operators and types', () => {
  it('compares numerically or as case-insensitive text', () => {
    const cases: [BlockJson, unknown][] = [
      [blk('operator_lt', { inputs: { OPERAND1: text('10'), OPERAND2: text('9') } }), false],
      [blk('operator_equals', { inputs: { OPERAND1: text('ABC'), OPERAND2: text('abc') } }), true],
      [blk('operator_add', { inputs: { NUM1: num('1.5'), NUM2: text('x') } }), 1.5],
      [blk('operator_mod', { inputs: { NUM1: num(-1), NUM2: num(3) } }), 2],
      [blk('operator_join', { inputs: { STRING1: text('a'), STRING2: num(1) } }), 'a1'],
      [blk('operator_equals', { inputs: { OPERAND1: text('10.0'), OPERAND2: num(10) } }), true],
    ]
    for (const [r, expected] of cases) {
      const { rt, ticks } = setup([makeSprite('a', [flag(setVar('out', reporter(r)))])])
      rt.greenFlag()
      ticks(1)
      expect(rt.getVariable('out')).toBe(expected)
    }
  })

  it('folds constants and keeps typed text that is not a canonical number', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(
          setVar('a', reporter(blk('operator_multiply', { inputs: { NUM1: reporter(blk('operator_add', { inputs: { NUM1: num(3), NUM2: num(4) } })), NUM2: num(2) } }))),
          setVar('b', text('007')),
          setVar('c', text('12')),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([rt.getVariable('a'), rt.getVariable('b'), rt.getVariable('c')]).toEqual([14, '007', 12])
  })

  it('stores a variable that receives several types as "any"', () => {
    const { rt, ticks } = setup([makeSprite('a', [flag(setVar('v', num(1)), wait(0.1), setVar('v', text('hi')), changeVar('w', 2))])])
    rt.variableDefs = [{ id: 'v', name: 'v' }, { id: 'w', name: 'w' }]
    rt.greenFlag()
    ticks(1)
    expect(rt.getVariable('v')).toBe(1)
    ticks(10)
    expect(rt.getVariable('v')).toBe('hi')
    expect(rt.getVariable('w')).toBe(2)
  })
})

describe('broadcast', () => {
  const msg = { id: 'm1', name: 'Go' }
  const menu = () => ({ shadow: blk('event_broadcast_menu', { fields: { BROADCAST_OPTION: { id: msg.id } } }) })
  const receive = (...body: BlockJson[]) =>
    stack(blk('event_whenbroadcastreceived', { fields: { BROADCAST_OPTION: { id: msg.id } } }), ...body)

  it('starts receivers in every sprite next tick, matching names case-insensitively', () => {
    const { rt, sprites: [, receiver], ticks } = setup([
      makeSprite('a', [flag(blk('event_broadcast', { inputs: { BROADCAST_INPUT: text('go') } }))]),
      makeSprite('b', [receive(setX(7))]),
    ])
    rt.broadcastDefs = [msg]
    rt.greenFlag()
    ticks(1)
    expect(receiver.x).toBe(0)
    ticks(1)
    expect(receiver.x).toBe(7)
  })

  it('broadcast and wait waits for the receivers to finish', () => {
    const { rt, sprites: [sender], ticks } = setup([
      makeSprite('a', [flag(blk('event_broadcastandwait', { inputs: { BROADCAST_INPUT: menu() } }), setX(1))]),
      makeSprite('b', [receive(wait(0.5))]),
    ])
    rt.broadcastDefs = [msg]
    rt.greenFlag()
    ticks(20)
    expect(sender.x).toBe(0)
    ticks(20)
    expect(sender.x).toBe(1)
  })

  it('a script broadcasting to its own hat restarts instead of continuing', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        receive(
          changeX(1),
          blk('control_if', {
            inputs: {
              CONDITION: reporter(blk('operator_lt', { inputs: { OPERAND1: reporter(blk('motion_xposition')), OPERAND2: num(3) } })),
              SUBSTACK: sub(blk('event_broadcast', { inputs: { BROADCAST_INPUT: menu() } }), wait(1)),
            },
          }),
          changeY(1),
        ),
      ]),
    ])
    rt.broadcastDefs = [msg]
    rt.broadcast('Go')
    ticks(10)
    expect(s.x).toBe(3)
    expect(s.y).toBe(1)
  })
})

describe('3D sensing', () => {
  const touching = (target: string) =>
    reporter(blk('sensing_touchingobject', { inputs: { TOUCHINGOBJECTMENU: { shadow: blk('sensing_touchingobjectmenu', { fields: { TOUCHINGOBJECTMENU: target } }) } } }))

  function touches(a: Parameters<typeof makeSprite>[2], b: Parameters<typeof makeSprite>[2]): boolean {
    const { rt, ticks } = setup([makeSprite('a', [flag(setVar('out', touching('b')))], a), makeSprite('b', [], b)])
    rt.greenFlag()
    ticks(1)
    return rt.getVariable('out') as boolean
  }

  it('uses the real shapes, not bounding boxes', () => {
    // Size 100 = 40 units across. Spheres 39 apart along x overlap; 41 apart don't.
    expect(touches({ shape: 'sphere' }, { shape: 'sphere', x: 39 })).toBe(true)
    expect(touches({ shape: 'sphere' }, { shape: 'sphere', x: 41 })).toBe(false)
    // Diagonal: boxes would overlap (|d| = 32 per axis < 40), spheres don't (distance 45 > 40).
    expect(touches({ shape: 'sphere' }, { shape: 'sphere', x: 32, y: 32 })).toBe(false)
    expect(touches({ shape: 'cube' }, { shape: 'cube', x: 32, y: 32 })).toBe(true)
    // Height matters.
    expect(touches({ shape: 'cube' }, { shape: 'cube', z: 41 })).toBe(false)
    // A cube rotated 45° reaches 20√2 ≈ 28.3 along x.
    expect(touches({ shape: 'cube', direction: 45 }, { shape: 'sphere', x: 47 })).toBe(true)
    expect(touches({ shape: 'cube' }, { shape: 'sphere', x: 47 })).toBe(false)
    // A cone is narrow near its apex.
    expect(touches({ shape: 'cone' }, { shape: 'sphere', x: 25, z: 18 })).toBe(false)
    expect(touches({ shape: 'cone' }, { shape: 'sphere', x: 25, z: -18 })).toBe(true)
  })

  it('hidden sprites do not touch', () => {
    expect(touches({ shape: 'cube' }, { shape: 'cube', x: 10, visible: false })).toBe(false)
  })

  it('finds touching clones among many with the grid', () => {
    // 500 small spheres in a row, 50 apart; the probe touches only the one it sits on.
    const at = (k: number) => -12000 + 50 * k
    const probeAt = (x: number) => {
      const { rt, ticks } = setup([
        makeSprite('dot', [flag(repeat(500, cloneOf(), changeX(50)))], { shape: 'sphere', size: 50, x: at(0) }),
        makeSprite('probe', [stack(blk('event_whenkeypressed', { fields: { KEY_OPTION: 'space' } }), setVar('hit', touching('dot')))], { shape: 'sphere', size: 10, x }),
      ])
      rt.greenFlag()
      // The loop moves the sprite, so it runs one iteration per tick.
      ticks(500)
      expect(rt.cloneCount).toBe(500)
      rt.keyPressed('space')
      ticks(1)
      return rt.getVariable('hit')
    }
    expect(probeAt(at(7) + 8)).toBe(true)
    expect(probeAt(at(7) + 25)).toBe(false)
    expect(probeAt(at(400) - 11)).toBe(true)
  })

  it('touching edge, distance to and bounce', () => {
    const distance = reporter(blk('sensing_distanceto', { inputs: { DISTANCETOMENU: { shadow: blk('sensing_distancetomenu', { fields: { DISTANCETOMENU: 'b' } }) } } }))
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(setVar('out', touching('_edge_')), setVar('d', distance))], { x: 230, z: 20 }),
      makeSprite('b', [], { x: 30, y: 40, z: 20 }),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.getVariable('out')).toBe(true)
    expect(rt.getVariable('d')).toBeCloseTo(Math.hypot(200, 40))

    const E = rt.store
    s.direction = 60
    expect(bounceOffEdge(E, s.slot)).toBe(true)
    expect(bounced.x).toBeCloseTo(240 - 20 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)))
    expect(bounced.direction).toBeCloseTo(-60)
    s.x = bounced.x
    s.direction = bounced.direction
    expect(touchingEdge(E, s.slot)).toBe(false)

    s.pitch = -30
    s.z = 5
    expect(bounceOffEdge(E, s.slot)).toBe(true)
    expect(bounced.pitch).toBe(30)
    // Tilted 30°, the cube reaches lower than its half size.
    expect(bounced.z).toBeCloseTo(20 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)))
  })
})

describe('project files', () => {
  it('round-trips sprites, scripts, variables, messages and settings through JSON', () => {
    const { rt } = setup([makeSprite('a', [flag(setX(5))], { z: 33 })], { cloneLimit: 1234 })
    rt.variableDefs = [{ id: 'v', name: 'score' }]
    rt.setVariable('v', 12)
    rt.broadcastDefs = [{ id: 'm', name: 'go' }]

    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    const rt2 = new Runtime()
    loadProject(rt2, file)
    expect(rt2.sprites[0]).toMatchObject({ name: 'a', z: 33, saying: null })
    expect(rt2.getVariable('v')).toBe(12)
    expect(rt2.broadcastDefs).toEqual([{ id: 'm', name: 'go' }])
    expect(rt2.settings.cloneLimit).toBe(1234)
    rt2.greenFlag()
    rt2.step()
    expect(rt2.sprites[0].x).toBe(5)
  })

  it('opens a project whose variables are laid out like the one before', () => {
    const project = (value: number) => {
      const { rt } = setup([makeSprite('a', [flag(changeVar('d', 1))], { variables: { d: { name: 'depth', value } } })])
      return parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    }
    const rt = new Runtime()
    loadProject(rt, project(1))
    expect(rt.sprites[0].variables).toEqual({ d: { name: 'depth', value: 1 } })
    loadProject(rt, project(5))
    expect(rt.sprites[0].variables).toEqual({ d: { name: 'depth', value: 5 } })
    rt.greenFlag()
    rt.step()
    expect(rt.sprites[0].variables.d.value).toBe(6)
  })

  it('gives variable and list reporters the XML fields the editor loads', () => {
    const listOf = (id: string) => blk('data_listcontents', { fields: { LIST: { id } } })
    const setXTo = (b: BlockJson) => blk('motion_setx', { inputs: { X: reporter(b) } })
    const { rt } = setup([makeSprite('a', [flag(setXTo(getVar('a&"b')), setXTo(listOf('l')))])])
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    const script = file.sprites[0].blocks!.blocks!.blocks[0].next!.block!
    expect(script.inputs!.X.block!.fields!.VARIABLE).toBe('<field name="VARIABLE" id="a&amp;&quot;b" variabletype=""></field>')
    expect(script.next!.block!.inputs!.X.block!.fields!.LIST).toBe('<field name="LIST" id="l" variabletype="list"></field>')
  })

  it('rejects malformed files with the offending path', () => {
    const { rt } = setup([makeSprite('a', [])])
    const good = serializeProject(rt)
    expect(() => parseProject({ hello: 1 })).toThrow(ProjectFormatError)
    const teapot = [{ ...good.sprites[0].costumes[0], shape: 'teapot' }]
    expect(() => parseProject({ ...good, sprites: [{ ...good.sprites[0], costumes: teapot }] })).toThrow(/sprites\[0\]\.costumes\[0\]\.shape/)
    expect(() => parseProject({ ...good, sprites: [{ ...good.sprites[0], costumes: [] }] })).toThrow(/sprites\[0\]\.costumes/)
    expect(() => parseProject({ ...good, sprites: [{ ...good.sprites[0], costume: 1 }] })).toThrow(/sprites\[0\]\.costume/)
    expect(() => parseProject({ ...good, sprites: [{ ...good.sprites[0], x: 'left' }] })).toThrow(/sprites\[0\]\.x/)
    expect(() => parseProject({ ...good, version: 99 })).toThrow(/newer/)
    expect(() => parseProject({ ...good, settings: { cloneLimit: -1 } })).toThrow(/cloneLimit/)
    const { settings: _settings, ...old } = good
    expect(parseProject(old).settings.cloneLimit).toBe(30000)
  })
})

describe('clones', () => {
  it('copies the sprite, runs "when I start as a clone" only in the clone, and shares other hats', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(setX(10), repeat(3, cloneOf())),
        startAsClone(changeY(5)),
        stack(blk('event_whenkeypressed', { fields: { KEY_OPTION: 'space' } }), blk('motion_changezby', { inputs: { DZ: num(1) } })),
      ]),
    ])
    rt.greenFlag()
    ticks(6)
    const clones = rt.clonesOf(s)
    expect(clones).toHaveLength(3)
    expect(clones.every((c) => c.x === 10 && c.y === 5 && c.name === 'a')).toBe(true)
    expect(s.y).toBe(0)
    rt.keyPressed('space')
    ticks(1)
    expect(rt.entities().map((c) => c.z)).toEqual([1, 1, 1, 1])
  })

  it('delete this clone removes only clones and stops their scripts', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(cloneOf(), blk('control_delete_this_clone'), setX(1)),
        startAsClone(wait(0.1), blk('control_delete_this_clone'), setX(99)),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.entities()).toHaveLength(2)
    expect(s.x).toBe(1)
    ticks(10)
    expect(rt.entities()).toEqual([s])
    expect(rt.kinds[0].runs.some((r) => r.active)).toBe(false)
  })

  it('stop all and the green flag remove clones; the limit holds; clones are not saved', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(forever(cloneOf()))])], { cloneLimit: 300 })
    rt.greenFlag()
    ticks(400)
    expect(rt.entities()).toHaveLength(301)
    expect(serializeProject(rt).sprites).toHaveLength(1)
    rt.stopAll()
    expect(rt.entities()).toEqual([s])
  })

  it("clones of another sprite run that sprite's scripts", () => {
    const { rt, sprites: [, b], ticks } = setup([
      makeSprite('a', [flag(cloneOf('b'))]),
      makeSprite('b', [startAsClone(blk('looks_say', { inputs: { MESSAGE: text('hi') } }))]),
    ])
    rt.greenFlag()
    ticks(2)
    expect(rt.clonesOf(b)[0]?.saying).toBe('hi')
    expect(b.saying).toBeNull()
  })

  it('handles 30,000 clones running a per-frame script', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(repeat(30000, cloneOf())),
        startAsClone(forever(blk('motion_movesteps', { inputs: { STEPS: num(2) } }), blk('motion_turnright', { inputs: { DEGREES: num(3) } }), blk('motion_ifonedgebounce'))),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(rt.cloneCount).toBe(30000)
    ticks(10)
    const clone = rt.clonesOf(s)[0]
    expect(clone.direction).toBeCloseTo(90 + 30)
    rt.stopAll()
    expect(rt.cloneCount).toBe(0)
  })
})

describe('custom blocks', () => {
  const esc = (v: unknown) => JSON.stringify(v).replace(/"/g, '&quot;')
  const mutation = (code: string, ids: string[], names?: string[], warp = false) =>
    `<mutation xmlns="http://www.w3.org/1999/xhtml" proccode="${code}" argumentids="${esc(ids)}"` +
    (names ? ` argumentnames="${esc(names)}" argumentdefaults="${esc(names.map(() => ''))}"` : '') +
    ` warp="${warp}"></mutation>`
  const define = (code: string, ids: string[], names: string[], warp: boolean, ...body: BlockJson[]) =>
    stack(
      blk('procedures_definition', {
        inputs: { custom_block: { shadow: blk('procedures_prototype', { extraState: mutation(code, ids, names, warp) }) } },
      }),
      ...body,
    )
  const call = (code: string, ids: string[], args: Record<string, ReturnType<typeof num>>) =>
    blk('procedures_call', { extraState: mutation(code, ids), inputs: args })
  const arg = (name: string) => reporter(blk('argument_reporter_string_number', { fields: { VALUE: name } }))

  it("passes arguments and runs the body in the caller's script", () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        define('move %s and %s', ['i1', 'i2'], ['dx', 'dz'], false,
          blk('motion_changexby', { inputs: { DX: arg('dx') } }),
          blk('motion_changezby', { inputs: { DZ: arg('dz') } })),
        flag(call('move %s and %s', ['i1', 'i2'], { i1: num(7), i2: num(3) }), call('move %s and %s', ['i1', 'i2'], { i1: num(1), i2: num(1) })),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([s.x, s.z]).toEqual([8, 4])
  })

  it('supports recursion', () => {
    // count n: if n > 0 then change x by 1, count (n - 1)
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        define('count %s', ['n'], ['n'], false,
          blk('control_if', {
            inputs: {
              CONDITION: reporter(blk('operator_gt', { inputs: { OPERAND1: arg('n'), OPERAND2: num(0) } })),
              SUBSTACK: sub(
                changeX(1),
                call('count %s', ['n'], { n: reporter(blk('operator_subtract', { inputs: { NUM1: arg('n'), NUM2: num(1) } })) as never }),
              ),
            },
          })),
        flag(call('count %s', ['n'], { n: num(25) })),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(s.x).toBe(25)
  })

  it('supports recursion through blocks that wait', () => {
    // countdown n: if n > 0 then change x by 1, wait 0.1, countdown (n - 1)
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        define('countdown %s', ['n'], ['n'], false,
          blk('control_if', {
            inputs: {
              CONDITION: reporter(blk('operator_gt', { inputs: { OPERAND1: arg('n'), OPERAND2: num(0) } })),
              SUBSTACK: sub(
                changeX(1),
                wait(0.1),
                call('countdown %s', ['n'], { n: reporter(blk('operator_subtract', { inputs: { NUM1: arg('n'), NUM2: num(1) } })) as never }),
              ),
            },
          })),
        flag(call('countdown %s', ['n'], { n: num(5) }), changeY(1)),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([s.x, s.y]).toEqual([1, 0])
    ticks(6)
    expect(s.x).toBe(2)
    ticks(40)
    expect([s.x, s.y]).toEqual([5, 1])
  })

  it('"run without screen refresh" finishes loops within one tick', () => {
    const loop = repeat(100, changeX(1))
    const { rt, sprites: [warped, normal], ticks } = setup([
      makeSprite('w', [define('go', [], [], true, loop), flag(call('go', [], {}))]),
      makeSprite('n', [define('go', [], [], false, structuredClone(loop)), flag(call('go', [], {}))]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(warped.x).toBe(100)
    expect(normal.x).toBe(1)
  })

  it('clicking a definition runs it; arguments outside a call are 0', () => {
    const def = define('show %s', ['a'], ['a'], false, blk('motion_setx', { inputs: { X: arg('a') } }))
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [def], { x: 5 })])
    rt.toggleScript(s, def)
    ticks(1)
    expect(s.x).toBe(0)
  })
})

describe('monitors', () => {
  it('show / hide variable blocks toggle monitors, which are saved with the project', () => {
    const v = { id: 'v1' }
    const { rt, ticks } = setup([
      makeSprite('a', [flag(blk('data_showvariable', { fields: { VARIABLE: v } }), wait(0.1), blk('data_hidevariable', { fields: { VARIABLE: v } }))]),
    ])
    let changes = 0
    rt.onMonitorChange(() => changes++)
    rt.greenFlag()
    ticks(1)
    expect([...rt.monitors]).toEqual(['var:v1'])
    rt.setMonitor('motion_xposition:a', true)
    const file = serializeProject(rt)
    expect(file.monitors).toEqual(['var:v1', 'motion_xposition:a'])
    ticks(10)
    expect([...rt.monitors]).toEqual(['motion_xposition:a'])
    expect(changes).toBe(3)

    const rt2 = new Runtime()
    loadProject(rt2, parseProject(JSON.parse(JSON.stringify(file))))
    expect([...rt2.monitors]).toEqual(['var:v1', 'motion_xposition:a'])
  })
})

describe('roll', () => {
  it('set / change roll wrap to (-180, 180] and leave the heading alone', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          blk('motion_setroll', { inputs: { ROLL: num(170) } }),
          blk('motion_changerollby', { inputs: { DEGREES: num(20) } }),
          blk('motion_movesteps', { inputs: { STEPS: num(10) } }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(s.roll).toBe(-170)
    expect(s.x).toBeCloseTo(10)
    expect(s.z).toBeCloseTo(0)
  })

  it('roll right / left change roll alone', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          blk('motion_rollright', { inputs: { DEGREES: num(50) } }),
          blk('motion_rollleft', { inputs: { DEGREES: num(20) } }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([s.direction, s.pitch, s.roll]).toEqual([90, 0, 30])
  })
})

describe('turning about the own axes', () => {
  const turn = (op: string, deg: number) => blk(op, { inputs: { DEGREES: num(deg) } })

  it('turn up carries pitch round, as turn right does direction', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(repeat(14, turn('motion_turnup', 15)))])])
    rt.greenFlag()
    ticks(20)
    expect([s.direction, s.pitch, s.roll]).toEqual([90, -150, 0])
  })

  it('set pitch is not limited to ±90', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(blk('motion_setpitch', { inputs: { PITCH: num(120) } }), blk('motion_movesteps', { inputs: { STEPS: num(10) } }))]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(s.pitch).toBe(120)
    expect(s.x).toBeCloseTo(-5)
    expect(s.z).toBeCloseTo(10 * Math.sin(Math.PI / 3))
  })

  it('turn up after a bank turns toward the own top', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(turn('motion_rollright', 90), turn('motion_turnup', 90), blk('motion_movesteps', { inputs: { STEPS: num(10) } }))]),
    ])
    rt.greenFlag()
    ticks(1)
    // Facing east and banked right, the top faces south.
    expect(s.direction).toBeCloseTo(180)
    expect(s.pitch).toBeCloseTo(0)
    expect([s.x, s.y, s.z].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, -10, 0])
  })

  it('turning right while pitched up draws a closed circle', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          blk('motion_setpitch', { inputs: { PITCH: num(30) } }),
          repeat(36, turn('motion_turnright', 10), blk('motion_movesteps', { inputs: { STEPS: num(10) } })),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(60)
    expect(s.x).toBeCloseTo(0, 6)
    expect(s.y).toBeCloseTo(0, 6)
    expect(s.z).toBeCloseTo(0, 6)
    expect([s.direction, s.pitch, s.roll].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([90, 30, 0])
  })
})

describe('variable reporters as saved by the editor', () => {
  it('reads the variable id from the XML text scratch-blocks saves for round variable reporters', () => {
    // Exact shapes Blockly produced in the editor: the set block saves { id },
    // the reporter saves its field as XML text (ids may contain XML-escaped characters).
    const id = '@ejp.VC}L@3LP;8&vqH61"'
    const xmlId = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          setVar(id, text('はなこ')),
          blk('looks_say', {
            inputs: {
              MESSAGE: {
                ...text('こんにちは!'),
                block: blk('data_variable', { fields: { VARIABLE: `<field name="VARIABLE" id="${xmlId}" variabletype="">田中</field>` } }),
              },
            },
          }),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(s.saying).toBe('はなこ')
  })
})

describe('lists', () => {
  const L = { LIST: { id: 'l' } }
  const add = (v: string | number) => blk('data_addtolist', { fields: L, inputs: { ITEM: text(String(v)) } })
  const say = (b: BlockJson) => blk('looks_say', { inputs: { MESSAGE: reporter(b) } })
  const item = (index: string) => blk('data_itemoflist', { fields: L, inputs: { INDEX: text(index) } })
  const run = (...body: BlockJson[]) => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(...body)])])
    rt.listDefs = [{ id: 'l', name: 'things' }]
    rt.greenFlag()
    ticks(1)
    return { rt, s, items: rt.getList('l') }
  }

  it('adds, inserts, replaces and deletes items', () => {
    const { items } = run(
      add('a'),
      add('b'),
      add('c'),
      blk('data_insertatlist', { fields: L, inputs: { ITEM: text('x'), INDEX: num(2) } }),
      blk('data_replaceitemoflist', { fields: L, inputs: { INDEX: text('last'), ITEM: text('z') } }),
      blk('data_deleteoflist', { fields: L, inputs: { INDEX: num(1) } }),
      // Out of range: ignored.
      blk('data_deleteoflist', { fields: L, inputs: { INDEX: num(9) } }),
      blk('data_insertatlist', { fields: L, inputs: { ITEM: text('end'), INDEX: num(4) } }),
    )
    expect(items).toEqual(['x', 'b', 'z', 'end'])
  })

  it('deletes everything with "all" or delete all', () => {
    expect(run(add(1), add(2), blk('data_deleteoflist', { fields: L, inputs: { INDEX: text('all') } })).items).toEqual([])
    expect(run(add(1), blk('data_deletealloflist', { fields: L })).items).toEqual([])
  })

  it('reports items, positions, length and membership', () => {
    const report = (b: BlockJson) => run(add('Apple'), add('banana'), add(10), say(b)).s.saying
    expect(report(item('2'))).toBe('banana')
    expect(report(item('last'))).toBe('10')
    // Out of range reports empty text, which says nothing.
    expect(report(item('7'))).toBe(null)
    expect(report(blk('data_itemnumoflist', { fields: L, inputs: { ITEM: text('apple') } }))).toBe('1')
    expect(report(blk('data_itemnumoflist', { fields: L, inputs: { ITEM: text('10.0') } }))).toBe('3')
    expect(report(blk('data_itemnumoflist', { fields: L, inputs: { ITEM: text('pear') } }))).toBe('0')
    expect(report(blk('data_lengthoflist', { fields: L }))).toBe('3')
    expect(report(blk('data_listcontainsitem', { fields: L, inputs: { ITEM: text('BANANA') } }))).toBe('true')
    expect(report(blk('data_listcontents', { fields: L }))).toBe('Apple banana 10')
  })

  it('keeps lists of numbers as numbers', () => {
    const { items, s } = run(add(3), add(1), add(2), say(blk('data_itemnumoflist', { fields: L, inputs: { ITEM: num(2) } })))
    expect(items).toEqual([3, 1, 2])
    expect(s.saying).toBe('3')
  })

  it('runs one-character items together in the list reporter', () => {
    expect(run(add('a'), add('b'), add(1), say(blk('data_listcontents', { fields: L }))).s.saying).toBe('ab1')
  })

  it('shows and hides the list monitor', () => {
    const { rt } = run(blk('data_showlist', { fields: L }))
    expect(rt.monitors.has('list:l')).toBe(true)
  })

  it('round-trips through project files, and older files without lists load', () => {
    const { rt } = run(add('a'), add(2))
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    const rt2 = new Runtime()
    loadProject(rt2, file)
    expect(rt2.listDefs).toEqual([{ id: 'l', name: 'things' }])
    expect(rt2.getList('l')).toEqual(['a', 2])
    const { lists: _lists, ...old } = serializeProject(rt)
    expect(parseProject(old).lists).toEqual([])
  })
})

describe('sprite-only variables and lists', () => {
  const V = { VARIABLE: { id: 'v' } }
  const L = { LIST: { id: 'l' } }
  const setV = (n: number) => blk('data_setvariableto', { fields: V, inputs: { VALUE: num(n) } })
  const changeV = (n: number) => blk('data_changevariableby', { fields: V, inputs: { VALUE: num(n) } })
  const of = (property: string, object: string) =>
    blk('sensing_of', { fields: { PROPERTY: property }, inputs: { OBJECT: { shadow: blk('sensing_of_object_menu', { fields: { OBJECT: object } }) } } })

  it('keeps a separate value per sprite, apart from globals with the same id', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [flag(setV(1))], { variables: { v: { name: 'speed', value: 0 } } }),
      makeSprite('b', [flag(setV(2))]),
    ])
    rt.greenFlag()
    ticks(1)
    expect(a.variables.v.value).toBe(1)
    // b has no own "v", so it set the global one.
    expect(rt.getVariable('v')).toBe(2)
  })

  it('gives each clone its own copy', () => {
    const { rt, sprites: [a], ticks } = setup([
      makeSprite('a', [
        flag(setV(10), blk('data_addtolist', { fields: L, inputs: { ITEM: text('x') } }), cloneOf('_myself_'), changeV(1)),
        startAsClone(changeV(100), blk('data_addtolist', { fields: L, inputs: { ITEM: text('y') } })),
      ], { variables: { v: { name: 'hp', value: 0 } }, lists: { l: { name: 'log', items: [] } } }),
    ])
    rt.greenFlag()
    ticks(2)
    const clone = rt.clonesOf(a)[0]
    expect(a.variables.v.value).toBe(11)
    expect(a.lists.l.items).toEqual(['x'])
    expect(rt.variableOf(clone, 'v')).toBe(110)
    expect(rt.listOf(clone, 'l')).toEqual(['x', 'y'])
  })

  it('reads another sprite\'s properties and own variables with "of"', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [], { z: 12.5, variables: { v: { name: 'hp', value: 7 } } }),
      makeSprite('b', [
        flag(setVar('g1', reporter(of('z position', 'a'))), setVar('g2', reporter(of('hp', 'a'))), setVar('g3', reporter(of('hp', 'nobody')))),
      ]),
    ])
    rt.greenFlag()
    ticks(1)
    expect([rt.getVariable('g1'), rt.getVariable('g2'), rt.getVariable('g3')]).toEqual([12.5, 7, 0])
  })

  it('round-trips through project files', () => {
    const variables = { v: { name: 'hp', value: 3 } }
    const lists = { l: { name: 'log', items: ['x', 1] } }
    const { rt } = setup([makeSprite('a', [], { variables, lists })])
    const file = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    expect(file.sprites[0]).toMatchObject({ variables, lists })
    const { variables: _v, lists: _l, ...old } = file.sprites[0]
    expect(parseProject({ ...file, sprites: [old] }).sprites[0]).toMatchObject({ variables: {}, lists: {} })
    expect(() => parseProject({ ...file, sprites: [{ ...old, lists: { l: { name: 'x' } } }] })).toThrow(/sprites\[0\]\.lists\.l\.items/)
  })
})

describe('renaming sprites', () => {
  const touching = (name: string) =>
    blk('sensing_touchingobject', { inputs: { TOUCHINGOBJECTMENU: { shadow: blk('sensing_touchingobjectmenu', { fields: { TOUCHINGOBJECTMENU: name } }) } } })
  const ifTouching = (name: string, ...body: BlockJson[]) =>
    blk('control_if', { inputs: { CONDITION: reporter(touching(name)), SUBSTACK: sub(...body) } })
  const menuValues = (blocks: unknown) => JSON.stringify(blocks).match(/"(TOUCHINGOBJECTMENU|CLONE_OPTION)":"[^"]*"/g)

  it('updates menus in every sprite that refer to the renamed sprite', () => {
    const { rt, sprites: [ball, , player], ticks } = setup([
      makeSprite('ball', []),
      makeSprite('other', []),
      makeSprite('player', [flag(ifTouching('ball', setX(99)), cloneOf('ball'), cloneOf('other'))]),
    ])
    expect(rt.renameSprite(ball, 'enemy')).toBe('enemy')
    expect(ball.name).toBe('enemy')
    expect(menuValues(player.blocks)).toEqual(['"TOUCHINGOBJECTMENU":"enemy"', '"CLONE_OPTION":"enemy"', '"CLONE_OPTION":"other"'])
    // The scripts use the new name.
    rt.greenFlag()
    ticks(1)
    expect(player.x).toBe(99)
    expect(rt.clonesOf(ball).map((s) => s.name)).toEqual(['enemy'])
  })

  it('renames clones too', () => {
    const { rt, sprites: [ball], ticks } = setup([makeSprite('ball', [flag(cloneOf('_myself_'))])])
    rt.greenFlag()
    ticks(1)
    rt.renameSprite(ball, 'enemy')
    expect(rt.entities().map((s) => s.name)).toEqual(['enemy', 'enemy'])
  })

  it('numbers a name that is taken, and refuses empty or reserved names', () => {
    const { rt, sprites: [a] } = setup([makeSprite('a', []), makeSprite('Ball1', []), makeSprite('Ball2', [])])
    expect(rt.renameSprite(a, 'Ball1')).toBe('Ball3')
    // "Ball2" is taken and its next free number gives the current name: no change.
    expect(rt.renameSprite(a, 'Ball2')).toBe(null)
    expect(rt.renameSprite(a, '  ')).toBe(null)
    expect(rt.renameSprite(a, '_edge_')).toBe(null)
    expect(a.name).toBe('Ball3')
  })
})

describe('state machines', () => {
  const lt = (a: ReturnType<typeof reporter>, b: number) => reporter(blk('operator_lt', { inputs: { OPERAND1: a, OPERAND2: num(b) } }))
  const xPos = () => reporter(blk('motion_xposition'))

  it('waits inside branches and nested loops', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(
          repeat(3, blk('control_if_else', { inputs: { CONDITION: lt(xPos(), 15), SUBSTACK: sub(wait(0.1), changeX(10)), SUBSTACK2: sub(changeY(1)) } })),
          repeat(2, repeat(2, wait(0.1)), blk('motion_changezby', { inputs: { DZ: num(1) } })),
        ),
      ]),
    ])
    rt.greenFlag()
    ticks(200)
    expect([s.x, s.y, s.z]).toEqual([20, 1, 2])
  })

  it('"wait until" resumes once another script makes the condition true', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        flag(blk('control_wait_until', { inputs: { CONDITION: reporter(blk('operator_gt', { inputs: { OPERAND1: reporter(getVar('n')), OPERAND2: num(2) } })) } }), setX(5)),
        flag(repeat(5, wait(0.1), changeVar('n', 1))),
      ]),
    ])
    rt.greenFlag()
    ticks(13)
    expect(s.x).toBe(0)
    ticks(10)
    expect(s.x).toBe(5)
  })

  it('"say for secs" clears the bubble afterwards', () => {
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(blk('looks_sayforsecs', { inputs: { MESSAGE: text('hi'), SECS: num(0.5) } }))])])
    rt.greenFlag()
    ticks(1)
    expect(s.saying).toBe('hi')
    ticks(30)
    expect(s.saying).toBeNull()
  })

  it('waits for extension blocks that return a Promise', async () => {
    let resolve = () => {}
    const ext = {
      id: 'demo',
      name: 'Demo',
      colours: ['#000000', '#000000', '#000000'] as [string, string, string],
      blocks: [
        { opcode: 'later', type: 'command' as const, text: 'later', run: () => new Promise<void>((r) => (resolve = r)) },
        { opcode: 'double', type: 'reporter' as const, text: 'double [N]', args: { N: { type: 'number' as const } }, run: (a: Record<string, unknown>) => Number(a.N) * 2 },
      ],
    }
    const { rt, sprites: [s], ticks } = setup([makeSprite('a', [flag(blk('demo_later'), blk('motion_setx', { inputs: { X: reporter(blk('demo_double', { inputs: { N: num(21) } })) } }))])])
    rt.addExtension(ext)
    rt.greenFlag()
    ticks(5)
    expect(s.x).toBe(0)
    resolve()
    await Promise.resolve()
    ticks(1)
    expect(s.x).toBe(42)
  })

  it('"stop other scripts in sprite" stops only that entity\'s other scripts', () => {
    const { rt, sprites: [s, other], ticks } = setup([
      makeSprite('a', [flag(forever(changeX(1))), flag(wait(0.1), blk('control_stop', { fields: { STOP_OPTION: 'other scripts in sprite' } }), forever(changeY(1)))]),
      makeSprite('b', [flag(forever(changeX(1)))]),
    ])
    rt.greenFlag()
    ticks(20)
    expect(s.x).toBe(7)
    expect(s.y).toBe(14)
    expect(other.x).toBe(20)
  })

  it('leaves the script when a custom block deletes the clone or stops everything', () => {
    const esc = (v: unknown) => JSON.stringify(v).replace(/"/g, '&quot;')
    const mutation = (code: string) => `<mutation proccode="${code}" argumentids="${esc([])}" argumentnames="${esc([])}" warp="false"></mutation>`
    const define = (code: string, ...body: BlockJson[]) =>
      stack(blk('procedures_definition', { inputs: { custom_block: { shadow: blk('procedures_prototype', { extraState: mutation(code) }) } } }), ...body)
    const call = (code: string) => blk('procedures_call', { extraState: mutation(code) })
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [
        define('vanish', blk('control_delete_this_clone')),
        define('halt', blk('control_stop', { fields: { STOP_OPTION: 'all' } })),
        flag(cloneOf(), wait(0.5), call('halt'), setX(99)),
        startAsClone(call('vanish'), changeVar('after', 1)),
      ]),
    ])
    rt.greenFlag()
    ticks(5)
    expect(rt.cloneCount).toBe(0)
    expect(rt.getVariable('after')).toBe(0)
    ticks(40)
    expect(s.x).toBe(0)
  })

  it('"when this sprite clicked" runs on the clicked clone only', () => {
    const { rt, sprites: [s], ticks } = setup([
      makeSprite('a', [flag(cloneOf()), stack(blk('event_whenthisspriteclicked'), changeY(10))]),
    ])
    rt.greenFlag()
    ticks(2)
    const clone = rt.clonesOf(s)[0]
    rt.entityClicked(clone.slot)
    ticks(1)
    expect([s.y, clone.y]).toEqual([0, 10])
  })

  it('reports scripts starting and stopping on the original for highlighting', () => {
    const top = flag(wait(0.1))
    const { rt, ticks } = setup([makeSprite('a', [top])])
    const events: string[] = []
    rt.onScriptChange((sprite, id, running) => events.push(`${sprite}:${id === top.id}:${running}`))
    rt.greenFlag()
    ticks(1)
    ticks(10)
    expect(events).toEqual(['a:true:true', 'a:true:false'])
  })
})

describe('"when I touch" and sprite references', () => {
  const whenTouch = (target: string, ...body: BlockJson[]) =>
    stack(
      blk('event_whentouchingobject', {
        inputs: { TOUCHINGOBJECTMENU: { shadow: blk('event_touchingobjectmenu', { fields: { TOUCHINGOBJECTMENU: target } }) } },
      }),
      ...body,
    )
  const touched = () => blk('sensing_touchedsprite')
  const addToList = (item: { block?: BlockJson; shadow?: BlockJson }) =>
    blk('data_addtolist', { fields: { LIST: { id: 'l' } }, inputs: { ITEM: item } })
  const xOf = (obj: BlockJson) => blk('sensing_of', { fields: { PROPERTY: 'x position' }, inputs: { OBJECT: reporter(obj) } })

  it('starts once when a touch begins, not on every tick of it', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(setX(-100), forever(changeX(4))), whenTouch('b', changeVar('hits', 1))]),
      makeSprite('b', []),
    ])
    rt.variableDefs = [{ id: 'hits', name: 'hits' }]
    rt.greenFlag()
    ticks(60)
    expect(rt.getVariable('hits')).toBe(1)
  })

  it('starts again for each clone touched, and reports which one', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(setX(0), forever(changeX(4))), whenTouch('b', addToList(reporter(xOf(touched()))))]),
      makeSprite('b', [flag(setX(0), repeat(3, changeX(60), cloneOf()), blk('looks_hide'))], { x: 500 }),
    ])
    rt.listDefs = [{ id: 'l', name: 'l' }]
    rt.greenFlag()
    ticks(60)
    expect(rt.getList('l')).toEqual([60, 120, 180])
  })

  it('starts when touching the edge and for clones of its own sprite', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [
        flag(setX(150), cloneOf(), forever(changeX(5))),
        whenTouch('_edge_', changeVar('edge', 1)),
        whenTouch('_myself_', changeVar('own', 1)),
      ], { z: 20 }),
    ])
    rt.variableDefs = [{ id: 'edge', name: 'edge' }, { id: 'own', name: 'own' }]
    rt.greenFlag()
    ticks(40)
    // The original walks away from its clone, which stays put; both start overlapping.
    // (Above the floor: a shape sunk into it touches the edge.)
    expect(rt.getVariable('edge')).toBe(1)
    expect(rt.getVariable('own')).toBe(2)
  })

  it('reports a reference that reads as the name and is saved as text', () => {
    const { rt, ticks } = setup([
      makeSprite('a', [flag(setX(-100), forever(changeX(4))), whenTouch('b', setVar('v', reporter(touched())))]),
      makeSprite('b', []),
    ])
    rt.variableDefs = [{ id: 'v', name: 'v' }]
    rt.greenFlag()
    ticks(60)
    const v = rt.getVariable('v')
    expect(String(v)).toBe('b')
    expect(serializeProject(rt).variables[0].value).toBe('b')
    expect(JSON.parse(JSON.stringify(serializeProject(rt))).variables[0].value).toBe('b')
  })

  it('"touching color" checks the shapes of entities of that color', () => {
    const colour = (c: string) => ({ shadow: blk('colour_picker', { fields: { COLOUR: c } }) })
    const touchingRed = blk('sensing_touchingcolor', { inputs: { COLOR: colour('#ff0000') } })
    const { rt, ticks } = setup([
      makeSprite('a', [flag(setX(0), forever(changeX(4), blk('control_if', { inputs: { CONDITION: reporter(touchingRed), SUBSTACK: sub(changeVar('red', 1)) } })))], { z: 20 }),
      // A red clone at x 100 and the original, blue, at x 200.
      makeSprite('b', [flag(setX(100), blk('looks_setcolorto', { inputs: { COLOR: colour('#ff0000') } }), cloneOf(), setX(200), blk('looks_setcolorto', { inputs: { COLOR: colour('#0000ff') } }))], { z: 20 }),
    ])
    rt.variableDefs = [{ id: 'red', name: 'red' }]
    rt.greenFlag()
    ticks(70)
    // Touching the red clone for x = 60, 64, ..., 140 (faces meeting counts); never the blue original.
    expect(rt.getVariable('red')).toBe(21)
  })
})
