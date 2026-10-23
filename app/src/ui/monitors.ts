/**
 * Monitor keys (see Runtime.monitors) ↔ palette blocks, and what each
 * monitor shows.
 */
import type * as ScratchBlocks from 'scratch-blocks'
import type { Runtime } from '../engine/runtime'
import type { Sprite } from '../engine/sprite'
import type { Value } from '../engine/types'
import { blockMessages } from '../i18n'

const round = (n: number) => Math.round(n * 100) / 100

/** A reporter's text, from this project's block messages so the player can show it without scratch-blocks. */
const label = (msg: string, fallback: string) => blockMessages()[msg] ?? fallback

/** Reporters about one sprite: monitor key `<opcode>:<sprite id>`. */
const SPRITE_REPORTERS: Record<string, { msg: string; value: (s: Sprite) => Value }> = {
  motion_xposition: { msg: 'MOTION_XPOSITION', value: (s) => round(s.x) },
  motion_yposition: { msg: 'MOTION_YPOSITION', value: (s) => round(s.y) },
  motion_zposition: { msg: 'MOTION_ZPOSITION', value: (s) => round(s.z) },
  motion_direction: { msg: 'MOTION_DIRECTION', value: (s) => round(s.direction) },
  motion_pitch: { msg: 'MOTION_PITCH', value: (s) => round(s.pitch) },
  motion_roll: { msg: 'MOTION_ROLL', value: (s) => round(s.roll) },
  looks_size: { msg: 'LOOKS_SIZE', value: (s) => Math.round(s.size) },
  looks_width: { msg: 'LOOKS_WIDTH', value: (s) => Math.round(s.width) },
  looks_depth: { msg: 'LOOKS_DEPTH', value: (s) => Math.round(s.depth) },
  looks_height: { msg: 'LOOKS_HEIGHT', value: (s) => Math.round(s.height) },
}

/** Reporters about the whole project: monitor key `<opcode>`. */
const GLOBAL_REPORTERS: Record<string, { msg: string; value: (rt: Runtime) => Value }> = {
  sensing_timer: { msg: 'SENSING_TIMER', value: (rt) => round(rt.timer) },
  sensing_mousex: { msg: 'SENSING_MOUSEX', value: (rt) => round(rt.mouse.x) },
  sensing_mousey: { msg: 'SENSING_MOUSEY', value: (rt) => round(rt.mouse.y) },
}

/** The monitor key for a checkbox block in the palette, while editing `spriteId`. */
export function monitorKeyOf(block: ScratchBlocks.Block, spriteId: string): string | null {
  if (block.type === 'data_variable') {
    const id = block.getFieldValue('VARIABLE') as string | null
    return id ? `var:${id}` : null
  }
  if (block.type === 'data_listcontents') {
    const id = block.getFieldValue('LIST') as string | null
    return id ? `list:${id}` : null
  }
  if (SPRITE_REPORTERS[block.type]) return `${block.type}:${spriteId}`
  if (GLOBAL_REPORTERS[block.type]) return block.type
  return null
}

export interface MonitorView {
  key: string
  label: string
  value: Value
  /** Set for list monitors, which show every item. */
  items?: readonly Value[]
  /** Variables and lists use the orange data colour; others use their category's. */
  category: 'data' | 'data_lists' | 'motion' | 'looks' | 'sensing'
}

const categoryOf = (opcode: string): MonitorView['category'] =>
  opcode.startsWith('motion_') ? 'motion' : opcode.startsWith('looks_') ? 'looks' : 'sensing'

/** What a monitor shows now, or null if what it refers to is gone. */
export function monitorView(rt: Runtime, key: string): MonitorView | null {
  if (key.startsWith('var:')) {
    const id = key.slice(4)
    const def = rt.variableDefs.find((v) => v.id === id)
    if (def) return { key, label: def.name, value: rt.getVariable(id), category: 'data' }
    // A sprite's own variable shows the original sprite's value, as in Scratch.
    for (const owner of rt.sprites) {
      const v = owner.variables[id]
      if (v) return { key, label: `${owner.name}: ${v.name}`, value: v.value, category: 'data' }
    }
    return null
  }
  if (key.startsWith('list:')) {
    const id = key.slice(5)
    const def = rt.listDefs.find((v) => v.id === id)
    if (def) {
      const items = rt.getList(id)
      return { key, label: def.name, value: items.length, items, category: 'data_lists' }
    }
    for (const owner of rt.sprites) {
      const l = owner.lists[id]
      if (l) return { key, label: `${owner.name}: ${l.name}`, value: l.items.length, items: l.items, category: 'data_lists' }
    }
    return null
  }
  const global = GLOBAL_REPORTERS[key]
  if (global) return { key, label: label(global.msg, key), value: global.value(rt), category: 'sensing' }
  const sep = key.indexOf(':')
  const opcode = key.slice(0, sep)
  const reporter = SPRITE_REPORTERS[opcode]
  const sprite = rt.getSprite(key.slice(sep + 1))
  if (!reporter || !sprite) return null
  return {
    key,
    label: `${sprite.name}: ${label(reporter.msg, opcode)}`,
    value: reporter.value(sprite),
    category: categoryOf(opcode),
  }
}
