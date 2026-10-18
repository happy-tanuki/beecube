/**
 * Benchmark projects for the performance targets in docs/vm-design.md (1):
 *
 *   A. 30,000 clones: forever move, turn, bounce
 *   B. 10,000 clones as A, plus "touching (another sprite)?"
 *   C. 3,000 physics bodies
 *   D. 30,000 clones whose scripts wait
 *   E. 10,000 alive, 500 clones created and deleted per tick
 *
 * Used by `npm run bench` and by the app with `?bench=A` (etc.) in the URL.
 */
import { PROJECT_FORMAT, type ProjectFile } from '../engine/project'
import { DEFAULT_CLONE_LIMIT } from '../engine/runtime'
import type { BlockJson, ShapeKind, SpriteData } from '../engine/types'

export const SCENARIOS = ['A', 'B', 'C', 'D', 'E'] as const
export type ScenarioName = (typeof SCENARIOS)[number]

let n = 0
const id = () => `bench-${n++}`
type Slot = { shadow?: BlockJson; block?: BlockJson }

const blk = (type: string, inputs?: Record<string, Slot>, fields?: Record<string, unknown>): BlockJson => ({
  type,
  id: id(),
  ...(inputs && { inputs }),
  ...(fields && { fields }),
})
const num = (v: number): Slot => ({ shadow: { type: 'math_number', id: id(), fields: { NUM: v } } })
const r = (b: BlockJson): Slot => ({ block: b })
const random = (from: number, to: number) => r(blk('operator_random', { FROM: num(from), TO: num(to) }))
const menu = (type: string, field: string, value: string): Slot => ({ shadow: { type, id: id(), fields: { [field]: value } } })

function chain(...blocks: BlockJson[]): BlockJson {
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] }
  return blocks[0]
}
const sub = (...blocks: BlockJson[]): Slot => ({ block: chain(...blocks) })

const flag = (...body: BlockJson[]) => ({ ...chain(blk('event_whenflagclicked'), ...body), x: 40, y: 40 })
const asClone = (...body: BlockJson[]) => ({ ...chain(blk('control_start_as_clone'), ...body), x: 40, y: 240 })
const forever = (...body: BlockJson[]) => blk('control_forever', { SUBSTACK: sub(...body) })
const repeat = (times: number, ...body: BlockJson[]) => blk('control_repeat', { TIMES: num(times), SUBSTACK: sub(...body) })
const createClone = () => blk('control_create_clone_of', { CLONE_OPTION: menu('control_create_clone_of_menu', 'CLONE_OPTION', '_myself_') })
const move = (steps: number) => blk('motion_movesteps', { STEPS: num(steps) })
const turn = (deg: number) => blk('motion_turnright', { DEGREES: num(deg) })
const bounce = () => blk('motion_ifonedgebounce')
const scatter = (z: number) => blk('motion_gotoxyz', { X: random(-220, 220), Y: random(-160, 160), Z: num(z) })
const pointRandom = () => blk('motion_pointindirection', { DIRECTION: random(1, 360) })

function sprite(name: string, shape: ShapeKind, size: number, color: string, scripts: BlockJson[]): SpriteData {
  return {
    id: name,
    name,
    x: 0,
    y: 0,
    z: 20,
    direction: 90,
    pitch: 0,
    roll: 0,
    size,
    color,
    shape,
    visible: true,
    pen: { down: false, color: '#000000' },
    blocks: { blocks: { languageVersion: 0, blocks: scripts } },
    variables: {},
    lists: {},
  }
}

function project(sprites: SpriteData[], extensions: string[] = [], cloneLimit = DEFAULT_CLONE_LIMIT): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    sprites,
    variables: [],
    lists: [],
    broadcasts: [],
    extensions,
    monitors: [],
    settings: { cloneLimit, randomSeed: 1 },
  }
}

/** Entities each scenario is about (for reports). */
export const SCENARIO_ENTITIES: Record<ScenarioName, number> = { A: 30000, B: 10000, C: 3000, D: 30000, E: 10000 }

export function scenarioProject(name: ScenarioName): ProjectFile {
  switch (name) {
    case 'A':
      return project([
        sprite('ball', 'cube', 20, '#4c97ff', [
          flag(repeat(30000, createClone())),
          asClone(scatter(10), pointRandom(), forever(move(2), turn(1), bounce())),
        ]),
      ])
    case 'B':
      return project([
        sprite('wall', 'cube', 60, '#ff8c1a', [flag(repeat(40, createClone())), asClone(scatter(30))]),
        sprite('ball', 'sphere', 20, '#4c97ff', [
          flag(repeat(10000, createClone())),
          asClone(
            scatter(10),
            pointRandom(),
            forever(
              move(2),
              bounce(),
              blk('control_if', {
                CONDITION: r(blk('sensing_touchingobject', { TOUCHINGOBJECTMENU: menu('sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', 'wall') })),
                SUBSTACK: sub(turn(180), move(4)),
              }),
            ),
          ),
        ]),
      ])
    case 'C':
      return project(
        [
          sprite('ball', 'sphere', 30, '#59c059', [
            flag(repeat(3000, createClone())),
            asClone(
              blk('motion_gotoxyz', { X: random(-220, 220), Y: random(-160, 160), Z: random(20, 600) }),
              blk('physics_setMode', undefined, { MODE: 'dynamic' }),
            ),
          ]),
        ],
        ['physics'],
      )
    case 'D':
      return project([
        sprite('dot', 'cube', 15, '#9966ff', [
          flag(repeat(30000, createClone())),
          asClone(scatter(10), forever(blk('control_wait', { DURATION: r(blk('operator_random', { FROM: num(0.2), TO: num(1.0) })) }), turn(90), move(10))),
        ]),
      ])
    case 'E':
      return project(
        [
          sprite('bullet', 'sphere', 15, '#ff6680', [
            flag(forever(repeat(500, createClone()))),
            asClone(pointRandom(), repeat(20, move(5)), blk('control_delete_this_clone')),
          ]),
        ],
        [],
        12000,
      )
  }
}
