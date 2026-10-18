import type { BlockJson, WorkspaceJson } from '../engine/types'
import { t } from '../i18n'

type Slot = { shadow?: BlockJson; block?: BlockJson }

let n = 0
const id = () => `sample-${n++}`

const blk = (type: string, inputs?: Record<string, Slot>): BlockJson => ({ type, id: id(), ...(inputs && { inputs }) })
const num = (v: number, type = 'math_number'): Slot => ({ shadow: { type, id: id(), fields: { NUM: v } } })
const text = (v: string): Slot => ({ shadow: { type: 'text', id: id(), fields: { TEXT: v } } })
const colour = (c: string): Slot => ({ shadow: { type: 'colour_picker', id: id(), fields: { COLOUR: c } } })

function chain(...blocks: BlockJson[]): BlockJson {
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] }
  return blocks[0]
}

/** Starter script: draws a rising spiral with the pen, then a wireframe cube. */
export function sampleScript(): WorkspaceJson {
  const spiral = blk('control_repeat', {
    TIMES: num(72, 'math_whole_number'),
    SUBSTACK: {
      block: chain(
        blk('motion_movesteps', { STEPS: num(12) }),
        blk('motion_turnright', { DEGREES: num(15) }),
        blk('motion_changezby', { DZ: num(1.5) }),
      ),
    },
  })

  const script = chain(
    blk('event_whenflagclicked'),
    blk('pen_clear'),
    blk('motion_gotoxyz', { X: num(0), Y: num(-50), Z: num(20) }),
    blk('motion_pointindirection', { DIRECTION: num(90, 'math_angle') }),
    blk('pen_setPenColorToColor', { COLOR: colour('#0fbd8c') }),
    blk('pen_penDown'),
    spiral,
    blk('pen_penUp'),
    blk('pen_setPenColorToColor', { COLOR: colour('#ff6680') }),
    blk('pen_drawCube', { SIZE: num(60) }),
    blk('looks_sayforsecs', { MESSAGE: text(t('default.done')), SECS: num(2) }),
  )
  script.x = 40
  script.y = 40
  return { blocks: { languageVersion: 0, blocks: [script] } }
}
