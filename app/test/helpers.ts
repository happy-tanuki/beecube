import { Runtime, type RuntimeSettings } from '../src/engine/runtime'
import type { Sprite } from '../src/engine/sprite'
import type { BlockJson, SpriteData } from '../src/engine/types'

let nextId = 0
export function blk(type: string, opts: Partial<BlockJson> = {}): BlockJson {
  return { type, id: `b${nextId++}`, ...opts }
}
export function num(n: number | string) {
  return { shadow: blk('math_number', { fields: { NUM: n } }) }
}
export function text(s: string) {
  return { shadow: blk('text', { fields: { TEXT: s } }) }
}
export function reporter(b: BlockJson) {
  return { block: b }
}
/** Chains statements via `next`. */
export function stack(...blocks: BlockJson[]): BlockJson {
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] }
  return blocks[0]
}
export function sub(...blocks: BlockJson[]) {
  return { block: stack(...blocks) }
}
export const flag = (...body: BlockJson[]) => stack(blk('event_whenflagclicked'), ...body)
export const forever = (...body: BlockJson[]) => blk('control_forever', { inputs: { SUBSTACK: sub(...body) } })
export const repeat = (times: number, ...body: BlockJson[]) =>
  blk('control_repeat', { inputs: { TIMES: num(times), SUBSTACK: sub(...body) } })
export const wait = (secs: number) => blk('control_wait', { inputs: { DURATION: num(secs) } })
export const changeX = (n: number) => blk('motion_changexby', { inputs: { DX: num(n) } })
export const changeY = (n: number) => blk('motion_changeyby', { inputs: { DY: num(n) } })
export const setX = (n: number) => blk('motion_setx', { inputs: { X: num(n) } })
export const cloneOf = (name = '_myself_') =>
  blk('control_create_clone_of', { inputs: { CLONE_OPTION: { shadow: blk('control_create_clone_of_menu', { fields: { CLONE_OPTION: name } }) } } })
export const startAsClone = (...body: BlockJson[]) => stack(blk('control_start_as_clone'), ...body)
export const setVar = (id: string, value: { shadow?: BlockJson; block?: BlockJson }) =>
  blk('data_setvariableto', { fields: { VARIABLE: { id } }, inputs: { VALUE: value } })
export const changeVar = (id: string, n: number) =>
  blk('data_changevariableby', { fields: { VARIABLE: { id } }, inputs: { VALUE: num(n) } })
export const getVar = (id: string) => blk('data_variable', { fields: { VARIABLE: { id } } })

export function makeSprite(name: string, scripts: BlockJson[], patch: Partial<SpriteData> = {}): SpriteData {
  return {
    id: name,
    name,
    x: 0,
    y: 0,
    z: 0,
    direction: 90,
    pitch: 0,
    roll: 0,
    size: 100,
    color: '#ffffff',
    shape: 'cube',
    visible: true,
    pen: { down: false, color: '#000000' },
    blocks: { blocks: { languageVersion: 0, blocks: scripts } },
    variables: {},
    lists: {},
    ...patch,
  }
}

/** A runtime with the sprites added; `ticks(n)` runs n ticks (60 per second). */
export function setup(sprites: SpriteData[], settings: Partial<RuntimeSettings> = {}) {
  const rt = new Runtime({ randomSeed: 1, ...settings })
  const added: Sprite[] = sprites.map((d) => rt.addSprite(d))
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) rt.step()
  }
  return { rt, sprites: added, ticks }
}
