/**
 * Analysis of the IR: what each custom block does (waits, visible effects,
 * variables written), and the types of variables, lists and custom block
 * parameters across the whole project, which fix where values are stored.
 */
import type { Expr, KindIR, ProcIR, ScriptIR, Stmt } from './ir'
import { EntityRef } from './ref'
import type { Value } from './types'

export type Ty = 'num' | 'str' | 'bool' | 'any'

export function join(a: Ty | undefined, b: Ty | undefined): Ty | undefined {
  if (a === undefined) return b
  if (b === undefined || a === b) return a
  return 'any'
}

export function typeOfValue(v: Value): Ty {
  if (v instanceof EntityRef) return 'any'
  return typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'str'
}

/** Blocks that make a script wait. */
const WAITING = new Set([
  'control_wait',
  'control_wait_until',
  'motion_glidesecstoxy',
  'motion_glidesecstoxyz',
  'motion_glideto',
  'looks_sayforsecs',
  'event_broadcastandwait',
])

/** Reporters whose value can change without the script doing anything. */
function isExternalReporter(e: Expr): boolean {
  return (
    e.ext !== undefined ||
    e.op.startsWith('sensing_') ||
    e.op.startsWith('motion_') ||
    e.op === 'looks_size'
  )
}

const isVisible = (s: Stmt) =>
  s.ext !== undefined || s.op.startsWith('motion_') || s.op.startsWith('looks_') || s.op.startsWith('pen_') || s.op.startsWith('camera_')

const VAR_WRITES = new Set(['data_setvariableto', 'data_changevariableby'])
const LIST_WRITES = new Set(['data_addtolist', 'data_deleteoflist', 'data_deletealloflist', 'data_insertatlist', 'data_replaceitemoflist'])

const EXTERNAL = '\u0000external'

/** What a custom block does, including the blocks it calls. */
interface ProcSummary {
  visible: boolean
  /** Variable ids (`v:`) and list ids (`l:`) written. */
  writes: Set<string>
  kills: boolean
  halts: boolean
  /** Whether a call can wait, by the caller's warp mode [normal, warp]. */
  yields: [boolean, boolean]
}

/** Per-kind facts about statements, used to classify scripts and split them into states. */
export class KindFacts {
  private readonly summaries = new Map<string, ProcSummary>()

  constructor(readonly ir: KindIR) {
    for (const p of ir.procs.keys()) {
      this.summaries.set(p, { visible: false, writes: new Set(), kills: false, halts: false, yields: [false, false] })
    }
    // Custom blocks can call each other (and themselves): iterate until nothing changes.
    for (let changed = true, rounds = 0; changed && rounds < 100; rounds++) {
      changed = false
      for (const [code, proc] of ir.procs) {
        const s = this.summaries.get(code)!
        const visible = this.visible(proc.body)
        const writes = new Set<string>()
        this.collectWrites(proc.body, writes)
        const kills = this.kills(proc.body)
        const halts = this.halts(proc.body)
        const yields: [boolean, boolean] = [this.suspends(proc.body, proc.warp), this.suspends(proc.body, true)]
        if (
          visible !== s.visible || kills !== s.kills || halts !== s.halts ||
          yields[0] !== s.yields[0] || yields[1] !== s.yields[1] || writes.size !== s.writes.size
        ) {
          changed = true
          this.summaries.set(code, { visible, writes, kills, halts, yields })
        }
      }
    }
  }

  proc(code: string): ProcIR | undefined {
    return this.ir.procs.get(code)
  }

  /** Whether calling the custom block can wait, given the caller's warp mode. */
  procYields(code: string, warp: boolean): boolean {
    const p = this.ir.procs.get(code)
    if (!p) return false
    return this.summaries.get(code)!.yields[warp || p.warp ? 1 : 0]
  }

  procKills(code: string): boolean {
    return this.summaries.get(code)?.kills ?? false
  }

  procHalts(code: string): boolean {
    return this.summaries.get(code)?.halts ?? false
  }

  visible(stmts: Stmt[] | undefined): boolean {
    for (const s of stmts ?? []) {
      if (isVisible(s)) return true
      if (s.call && this.summaries.get(s.call.proccode)?.visible) return true
      if (this.visible(s.body) || this.visible(s.body2)) return true
    }
    return false
  }

  collectWrites(stmts: Stmt[] | undefined, out: Set<string>): void {
    for (const s of stmts ?? []) {
      if (VAR_WRITES.has(s.op)) out.add(`v:${s.f.VARIABLE}`)
      if (LIST_WRITES.has(s.op)) out.add(`l:${s.f.LIST}`)
      if (s.call) for (const w of this.summaries.get(s.call.proccode)?.writes ?? []) out.add(w)
      this.collectWrites(s.body, out)
      this.collectWrites(s.body2, out)
    }
  }

  kills(stmts: Stmt[] | undefined): boolean {
    return (stmts ?? []).some(
      (s) => s.op === 'control_delete_this_clone' || (s.call && this.procKills(s.call.proccode)) || this.kills(s.body) || this.kills(s.body2),
    )
  }

  halts(stmts: Stmt[] | undefined): boolean {
    return (stmts ?? []).some(
      (s) =>
        (s.op === 'control_stop' && s.f.STOP_OPTION === 'all') ||
        (s.call && this.procHalts(s.call.proccode)) ||
        this.halts(s.body) ||
        this.halts(s.body2),
    )
  }

  /** Whether the statements can stop and resume in a later tick. */
  suspends(stmts: Stmt[] | undefined, warp: boolean): boolean {
    for (const s of stmts ?? []) {
      if (WAITING.has(s.op) || s.ext || s.op === 'control_forever') return true
      if (s.call && this.procYields(s.call.proccode, warp)) return true
      if (s.op === 'control_repeat' || s.op === 'control_repeat_until') {
        if (this.loopYields(s, warp) || this.suspends(s.body, warp)) return true
      }
      if (this.suspends(s.body, warp) || this.suspends(s.body2, warp)) return true
    }
    return false
  }

  /** Whether a loop ends each iteration by waiting for the next tick (4.3 of the design). */
  loopYields(loop: Stmt, warp: boolean): boolean {
    if (loop.op === 'control_forever') return true
    if (warp) return false
    if (this.visible(loop.body) || this.suspends(loop.body, warp)) return true
    if (loop.op === 'control_repeat_until') return this.conditionIsExternal(loop.in.CONDITION, loop.body)
    return false
  }

  /** Whether only something outside the loop body can change the condition. */
  private conditionIsExternal(cond: Expr, body: Stmt[] | undefined): boolean {
    const reads = new Set<string>()
    collectReads(cond, reads)
    if (reads.has(EXTERNAL)) return true
    if (reads.size === 0) return false
    const writes = new Set<string>()
    this.collectWrites(body, writes)
    for (const r of reads) if (!writes.has(r)) return true
    return false
  }
}

function collectReads(e: Expr, out: Set<string>): void {
  if (isExternalReporter(e)) out.add(EXTERNAL)
  if (e.op === 'data_variable') out.add(`v:${e.f.VARIABLE}`)
  if (e.f.LIST !== undefined) out.add(`l:${e.f.LIST}`)
  for (const x of Object.values(e.in)) collectReads(x, out)
}

// ---- types and storage layout ------------------------------------------------

/** Where a variable's value lives: a slot in the numeric or in the other array. */
export interface VarSlot {
  ty: Ty
  num: boolean
  index: number
}

export interface ListSlot {
  /** Type of the items. */
  elem: Ty
  index: number
}

export interface KindLayout {
  vars: Map<string, VarSlot>
  numCount: number
  refCount: number
  lists: Map<string, ListSlot>
}

export interface Layout {
  /** Changes whenever any storage or type changes. */
  signature: string
  globals: Map<string, VarSlot>
  numGlobals: number
  refGlobals: number
  lists: Map<string, ListSlot>
  kinds: KindLayout[]
  /** Custom block parameter types, by `kind:proccode:index`. */
  params: Map<string, Ty>
}

/** What the analysis needs to know about one kind. */
export interface KindInput {
  ir: KindIR
  facts: KindFacts
  /** Stacks being run by clicking them. */
  adhoc: ScriptIR[]
  /** Own variable ids → type of their current values (over all entities of the kind). */
  localVars: Map<string, Ty | undefined>
  /** Own variable names → ids, for the "of" block. */
  localVarNames: Map<string, string>
  localLists: Map<string, Ty | undefined>
}

export interface ProjectInput {
  kinds: KindInput[]
  /** Global variable ids → type of the current value. */
  globals: Map<string, Ty | undefined>
  lists: Map<string, Ty | undefined>
  /** Kind index by sprite name, for the "of" block. */
  kindByName(name: string): number
}

export const paramKey = (kind: number, proccode: string, index: number) => `${kind}:${proccode}:${index}`

/** Type environment during inference. */
class TypeEnv {
  readonly t = new Map<string, Ty | undefined>()
  changed = false

  get(key: string): Ty | undefined {
    return this.t.get(key)
  }

  widen(key: string, ty: Ty | undefined): void {
    const before = this.t.get(key)
    const after = join(before, ty)
    if (after !== before) {
      this.t.set(key, after)
      this.changed = true
    }
  }
}

const varKey = (p: ProjectInput, k: number, id: string) => (p.kinds[k].localVars.has(id) ? `lv:${k}:${id}` : `gv:${id}`)
const listKey = (p: ProjectInput, k: number, id: string) => (p.kinds[k].localLists.has(id) ? `ll:${k}:${id}` : `gl:${id}`)

/** The static type of an expression in kind k, inside `proc` (null at the top of a script). */
export function typeOfExpr(e: Expr, p: ProjectInput, k: number, proc: ProcIR | null, env: (key: string) => Ty | undefined): Ty | undefined {
  switch (e.op) {
    case 'const':
      return typeOfValue(e.v!)
    case 'data_variable':
      return env(varKey(p, k, e.f.VARIABLE))
    case 'argument_reporter_string_number': {
      const i = proc ? proc.params.indexOf(e.f.VALUE) : -1
      return i >= 0 ? env(`p:${paramKey(k, proc!.proccode, i)}`) : 'num'
    }
    case 'argument_reporter_boolean':
      return 'bool'
    case 'sensing_of': {
      const obj = e.in.OBJECT
      if (obj.op !== 'const') return 'any'
      if (BUILTIN_PROPERTIES.has(e.f.PROPERTY)) return 'num'
      const other = p.kindByName(String(obj.v))
      const id = other >= 0 ? p.kinds[other].localVarNames.get(e.f.PROPERTY) : undefined
      // A missing sprite or variable reads as 0.
      return id === undefined ? 'num' : env(`lv:${other}:${id}`)
    }
    case 'data_itemoflist': {
      const elem = env(listKey(p, k, e.f.LIST))
      // Out of range gives empty text.
      return elem === 'str' ? 'str' : 'any'
    }
    case 'sensing_touchedsprite':
      return 'any'
    case 'event_broadcast_menu':
    case 'operator_join':
    case 'operator_letter_of':
    case 'data_listcontents':
      return 'str'
    case 'operator_lt':
    case 'operator_gt':
    case 'operator_equals':
    case 'operator_and':
    case 'operator_or':
    case 'operator_not':
    case 'operator_contains':
    case 'sensing_touchingobject':
    case 'sensing_touchingcolor':
    case 'sensing_keypressed':
    case 'sensing_mousedown':
    case 'data_listcontainsitem':
      return 'bool'
    default:
      if (e.ext) return e.ext.type === 'boolean' ? 'bool' : 'any'
      return 'num'
  }
}

/** Menu values of the "of" block's built-in properties. */
export const SPRITE_PROPERTIES = ['x position', 'y position', 'z position', 'direction', 'pitch', 'roll', 'size', 'width', 'depth', 'height'] as const
export type SpriteProperty = (typeof SPRITE_PROPERTIES)[number]
export const BUILTIN_PROPERTIES = new Set<string>(SPRITE_PROPERTIES)

/** Infers every variable, list and parameter type and assigns storage. */
export function inferLayout(p: ProjectInput): Layout {
  const env = new TypeEnv()
  for (const [id, ty] of p.globals) env.widen(`gv:${id}`, ty ?? 'num')
  for (const [id, ty] of p.lists) env.widen(`gl:${id}`, ty)
  p.kinds.forEach((kind, k) => {
    for (const [id, ty] of kind.localVars) env.widen(`lv:${k}:${id}`, ty ?? 'num')
    for (const [id, ty] of kind.localLists) env.widen(`ll:${k}:${id}`, ty)
  })
  // Variables referred to by blocks but defined nowhere are globals starting at 0.
  const extraGlobals = new Set<string>()
  const extraLists = new Set<string>()

  const visit = (stmts: Stmt[] | undefined, k: number, proc: ProcIR | null): void => {
    const ty = (e: Expr) => typeOfExpr(e, p, k, proc, (key) => env.get(key))
    const noteVar = (id: string) => {
      const key = varKey(p, k, id)
      if (key.startsWith('gv:') && !p.globals.has(id) && !extraGlobals.has(id)) {
        extraGlobals.add(id)
        env.widen(key, 'num')
      }
      return key
    }
    const noteList = (id: string) => {
      const key = listKey(p, k, id)
      if (key.startsWith('gl:') && !p.lists.has(id)) extraLists.add(id)
      return key
    }
    const exprs = (e: Expr): void => {
      if (e.op === 'data_variable') noteVar(e.f.VARIABLE)
      if (e.f.LIST !== undefined) noteList(e.f.LIST)
      for (const x of Object.values(e.in)) exprs(x)
    }
    for (const s of stmts ?? []) {
      for (const x of Object.values(s.in)) exprs(x)
      switch (s.op) {
        case 'data_setvariableto':
          env.widen(noteVar(s.f.VARIABLE), ty(s.in.VALUE))
          break
        case 'data_changevariableby':
          env.widen(noteVar(s.f.VARIABLE), 'num')
          break
        case 'data_showvariable':
        case 'data_hidevariable':
          noteVar(s.f.VARIABLE)
          break
        case 'data_addtolist':
        case 'data_insertatlist':
        case 'data_replaceitemoflist':
          env.widen(noteList(s.f.LIST), ty(s.in.ITEM))
          break
        default:
          if (s.f.LIST !== undefined) noteList(s.f.LIST)
      }
      if (s.call) {
        const callee = p.kinds[k].ir.procs.get(s.call.proccode)
        if (callee) {
          callee.params.forEach((_, i) => {
            const arg = s.call!.args[i]
            env.widen(`p:${paramKey(k, callee.proccode, i)}`, arg ? ty(arg) : 'str')
          })
        }
        for (const a of s.call.args) exprs(a)
      }
      visit(s.body, k, proc)
      visit(s.body2, k, proc)
    }
  }

  for (let round = 0; round < 50; round++) {
    env.changed = false
    p.kinds.forEach((kind, k) => {
      for (const s of kind.ir.scripts) visit(s.body, k, null)
      for (const s of kind.adhoc) visit(s.body, k, null)
      for (const proc of kind.ir.procs.values()) visit(proc.body, k, proc)
    })
    if (!env.changed) break
  }

  const slotFor = (ty: Ty | undefined, counters: { num: number; ref: number }): VarSlot => {
    const t = ty ?? 'any'
    return t === 'num' ? { ty: t, num: true, index: counters.num++ } : { ty: t, num: false, index: counters.ref++ }
  }
  const sig: unknown[] = []
  const g = { num: 0, ref: 0 }
  const globals = new Map<string, VarSlot>()
  for (const id of [...p.globals.keys(), ...extraGlobals]) {
    const slot = slotFor(env.get(`gv:${id}`), g)
    globals.set(id, slot)
    sig.push(id, slot.ty)
  }
  const lists = new Map<string, ListSlot>()
  for (const id of [...p.lists.keys(), ...extraLists]) {
    if (lists.has(id)) continue
    const elem = env.get(`gl:${id}`) ?? 'any'
    lists.set(id, { elem, index: lists.size })
    sig.push(id, elem)
  }
  const kinds = p.kinds.map((kind, k): KindLayout => {
    const c = { num: 0, ref: 0 }
    const vars = new Map<string, VarSlot>()
    for (const id of kind.localVars.keys()) {
      const slot = slotFor(env.get(`lv:${k}:${id}`), c)
      vars.set(id, slot)
      sig.push(k, id, slot.ty)
    }
    const kl = new Map<string, ListSlot>()
    for (const id of kind.localLists.keys()) {
      const elem = env.get(`ll:${k}:${id}`) ?? 'any'
      kl.set(id, { elem, index: kl.size })
      sig.push(k, id, elem)
    }
    return { vars, numCount: c.num, refCount: c.ref, lists: kl }
  })
  const params = new Map<string, Ty>()
  for (const [key, ty] of env.t) {
    if (!key.startsWith('p:')) continue
    params.set(key.slice(2), ty ?? 'any')
    sig.push(key, ty)
  }
  return { signature: JSON.stringify(sig), globals, numGlobals: g.num, refGlobals: g.ref, lists, kinds, params }
}
