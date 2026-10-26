/**
 * Renaming sprites, backdrops and costumes. Blocks refer to them by name (in their
 * menus), so a rename rewrites those references in every sprite's workspace.
 */
import { EDGE, MOUSE, MYSELF, RANDOM, type BlockJson, type WorkspaceJson } from './types'

/** Menu blocks whose field holds a sprite name, by block type → field name. */
export const SPRITE_MENUS: Record<string, string> = {
  sensing_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
  event_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
  sensing_distancetomenu: 'DISTANCETOMENU',
  sensing_of_object_menu: 'OBJECT',
  control_create_clone_of_menu: 'CLONE_OPTION',
  motion_goto_menu: 'TO',
  motion_glideto_menu: 'TO',
  motion_pointtowards_menu: 'TOWARDS',
}

/** Blocks whose field holds a backdrop name, by block type → field name. */
export const BACKDROP_MENUS: Record<string, string> = {
  looks_backdrops: 'BACKDROP',
  event_whenbackdropswitchesto: 'BACKDROP',
}

/** Blocks whose field holds a costume name, by block type → field name. */
export const COSTUME_MENUS: Record<string, string> = {
  looks_costume: 'COSTUME',
}

/**
 * The name a backdrop or a costume gets when the user asks for `wanted`:
 * null if empty, otherwise `wanted`, or, if another one has it, the same
 * name with the first free number.
 */
export function availableName(wanted: string, others: string[]): string | null {
  const name = wanted.trim()
  if (name === '') return null
  if (!others.includes(name)) return name
  const base = name.replace(/\d+$/, '')
  let n = 2
  while (others.includes(`${base}${n}`)) n++
  return `${base}${n}`
}

/** Menu values that are not sprite names, so no sprite may take them. */
const RESERVED = new Set([EDGE, MOUSE, MYSELF, RANDOM])

/**
 * The name a sprite gets when the user asks for `wanted`: null if it can't
 * be used at all (empty or reserved), otherwise `wanted`, or, if another
 * sprite has it, the same name with the first free number (`Ball` → `Ball2`).
 */
export function availableSpriteName(wanted: string, others: string[]): string | null {
  const name = wanted.trim()
  if (name === '' || RESERVED.has(name)) return null
  if (!others.includes(name)) return name
  const base = name.replace(/\d+$/, '')
  let n = 2
  while (others.includes(`${base}${n}`)) n++
  return `${base}${n}`
}

/** Rewrites references in `menus` (SPRITE_MENUS by default) from `from` to `to`. Returns whether anything changed. */
export function renameSpriteReferences(ws: WorkspaceJson | null, from: string, to: string, menus = SPRITE_MENUS): boolean {
  let changed = false
  const visit = (b: BlockJson | undefined): void => {
    if (!b) return
    const field = menus[b.type]
    if (field && b.fields?.[field] === from) {
      b.fields[field] = to
      changed = true
    }
    for (const slot of Object.values(b.inputs ?? {})) {
      visit(slot.block)
      visit(slot.shadow)
    }
    visit(b.next?.block)
  }
  for (const top of ws?.blocks?.blocks ?? []) visit(top)
  return changed
}
