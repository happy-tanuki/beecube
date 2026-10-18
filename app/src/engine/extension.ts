/**
 * Extension API. An extension declares blocks as plain data plus a `run`
 * function per block; the engine compiles them like built-in blocks.
 *
 * Authors write ordinary (possibly async) functions: a command that returns
 * a Promise pauses its script until the Promise settles, while other scripts
 * keep running. Reporters must return synchronously.
 *
 * Opcodes are namespaced as `<extension id>_<block opcode>`.
 */
import type { Runtime } from './runtime'
import type { Value } from './types'

/** Text in several languages, keyed by locale; English is the fallback. */
export type Localized = string | { en: string; [locale: string]: string }

export type ArgType = 'number' | 'string' | 'angle' | 'color' | 'boolean'

export type ArgSpec =
  | { type: ArgType; default?: Value }
  /** A dropdown field; values are passed to `run` as strings. */
  | { type: 'menu'; options: [label: Localized, value: string][]; default?: string }

export type ArgValues = Record<string, Value>

/** What a block's `run` gets besides its arguments: the entity running it. */
export interface BlockUtil {
  rt: Runtime
  /** The entity's slot in `rt.store`; valid during this call only. */
  slot: number
  /** A handle to the entity (`rt.store.slotOf(handle)`), valid as long as it lives. */
  entity: number
}

interface BlockBase {
  opcode: string
  /** Block text; `[NAME]` marks where argument NAME goes, e.g. `set gravity to [G]`. */
  text: Localized
  args?: Record<string, ArgSpec>
}

export interface CommandBlock extends BlockBase {
  type: 'command'
  run(args: ArgValues, util: BlockUtil): void | Promise<unknown>
}

export interface ReporterBlock extends BlockBase {
  type: 'reporter' | 'boolean'
  run(args: ArgValues, util: BlockUtil): Value
}

/**
 * Hat blocks start scripts when the extension calls `rt.startHats`.
 * Only `menu` args are allowed on hats; they are matched against the values
 * passed there.
 */
export interface HatBlock extends BlockBase {
  type: 'hat'
}

export type ExtensionBlock = CommandBlock | ReporterBlock | HatBlock

export interface ExtensionSpec {
  id: string
  name: Localized
  /** [primary, secondary, tertiary] block colours. */
  colours: [string, string, string]
  blocks: (ExtensionBlock | '---')[]
  /** Called once when added to a runtime. */
  install?(rt: Runtime): void
  /** Called every tick after scripts have run (step 5 of the tick). `dt` is in seconds. */
  afterScripts?(rt: Runtime, dt: number): void
  /** Called when the green flag is clicked, before scripts start. */
  greenFlag?(rt: Runtime): void
  /** Called when everything is stopped (stop button, "stop all", project load). */
  stopAll?(rt: Runtime): void
  /** Called when original sprites are added or removed (including loading a project). */
  spritesChanged?(rt: Runtime): void
  /** Called when removed from a runtime. */
  uninstall?(rt: Runtime): void
}

export function opcodeOf(ext: ExtensionSpec, block: ExtensionBlock): string {
  return `${ext.id}_${block.opcode}`
}

export function localize(text: Localized, locale: string): string {
  if (typeof text === 'string') return text
  return text[locale] ?? text.en
}

/** Splits block text into literal parts and argument names: `a [X] b` → ['a ', {arg:'X'}, ' b']. */
export function parseBlockText(text: string): (string | { arg: string })[] {
  const parts: (string | { arg: string })[] = []
  const re = /\[([A-Za-z0-9_]+)\]/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ arg: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export const isBlock = (b: ExtensionBlock | '---'): b is ExtensionBlock => b !== '---'
