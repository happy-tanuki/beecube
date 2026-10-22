/**
 * IR → JavaScript source for one kind (an original sprite and its clones).
 *
 * Each script becomes a function over the entities running it. Code that can
 * wait is split into states of a `switch (pc)` whose program counters,
 * wake-up ticks and surviving locals live in the script's instance columns.
 * A script ending in a "forever" that never waits gets a second, per-frame
 * function with the loop body inlined. Custom blocks become plain functions,
 * or state machines over pooled frames when they can wait.
 *
 * Generated source only contains generated identifiers, numbers, and strings
 * embedded with JSON.stringify; objects are passed in the constants array C.
 */
import { BUILTIN_PROPERTIES, paramKey, type KindFacts, type Layout, type ProjectInput, type Ty, typeOfValue } from './analyze'
import type { CommandBlock, ExtensionBlock } from './extension'
import type { Expr, ProcIR, ScriptIR, Stmt } from './ir'
import { colorToInt, compare, contains, isColorString, isWholeBound, letterOf, mathop, mod, toBoolean, toNumber, toText, waitTicks } from './ops'
import { PEN_PARAMS } from './store'
import { BASE_SIZE, EDGE, MOUSE, MYSELF, STAGE_HEIGHT, STAGE_WIDTH, type Value } from './types'

export interface CodegenEnv {
  project: ProjectInput
  layout: Layout
  kind: number
  facts: KindFacts
  /** A broadcast message's name from its id. */
  messageName(id: string): string
}

/** Objects generated code refers to, resolved by the runtime when it instantiates the module. */
export type ConstRef =
  | { t: 'script'; index: number }
  | { t: 'kind'; index: number }
  | { t: 'block'; block: ExtensionBlock }
  | { t: 'pool'; num: number; obj: number }

export interface ScriptPlan {
  ir: ScriptIR
  /** Locals of the script's instances that survive waits. */
  numLocals: number
  objLocals: number
  /** Whether the script ends in a per-frame "forever". */
  perFrame: boolean
  /**
   * Where an instance can be suspended, by state: a key naming the block it
   * waits in (null where it cannot be moved to new code). Used to move running
   * instances to the code of an edited script (4.6).
   */
  resume: (string | null)[]
  /** The resume key of the per-frame "forever", if any. */
  perFrameKey: string | null
  /** What each surviving local holds, by the block that owns it (null: not movable). */
  numOwners: (string | null)[]
  objOwners: (string | null)[]
  /** Whether running it can move or change the looks of its entities. */
  moves: boolean
  /** The script and every custom block it reaches, with parameter types: equal means running instances can switch to the new code. */
  structure: string
}

export interface ModulePlan {
  /** Body of `function (E, rt, L, C)`, returning `{ sm: Function[], fv: (Function | null)[] }`. */
  source: string
  consts: ConstRef[]
  scripts: ScriptPlan[]
}

// ---- small helpers ---------------------------------------------------------

/** A JS expression with its type, and its value when constant. */
interface V {
  c: string
  t: Ty
  k?: Value
}

function lit(v: Value): string {
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return '-0'
    if (Number.isNaN(v)) return 'NaN'
    if (v === Infinity) return 'Infinity'
    if (v === -Infinity) return '(-Infinity)'
    return v < 0 ? `(${v})` : String(v)
  }
  if (typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

const k = (v: Value): V => ({ c: lit(v), t: typeOfValue(v), k: v })

function asNum(v: V): string {
  if (v.t === 'num') return v.c
  if (v.k !== undefined) return lit(toNumber(v.k))
  if (v.t === 'bool') return `(${v.c} ? 1 : 0)`
  return `L.num(${v.c})`
}

function asStr(v: V): string {
  if (v.t === 'str') return v.c
  if (v.k !== undefined) return lit(toText(v.k))
  if (v.t === 'num') return `("" + ${v.c})`
  if (v.t === 'bool') return `(${v.c} ? "true" : "false")`
  return `L.str(${v.c})`
}

function asBool(v: V): string {
  if (v.t === 'bool') return v.c
  if (v.k !== undefined) return lit(toBoolean(v.k))
  return `L.bool(${v.c})`
}

function asType(v: V, t: Ty): string {
  switch (t) {
    case 'num': return asNum(v)
    case 'str': return asStr(v)
    case 'bool': return asBool(v)
    default: return v.c
  }
}

const num = (v: V) => (v.k !== undefined ? toNumber(v.k) : undefined)

/** Column names in generated code. */
const COLUMNS: Record<string, string> = {
  x: 'X', y: 'Y', z: 'Z', direction: 'D', pitch: 'PT', roll: 'RL', size: 'SZ',
  color: 'CO', penSize: 'PSZ', flags: 'FL',
}

/** Flag bits, as in store.ts. */
const F_VISIBLE = 2
const F_PEN = 4
const F_DYING = 16

// ---- functions and state machines ------------------------------------------

class FnGen {
  readonly hoists = new Map<string, string>()
  private n = 0

  hoist(name: string, init: string): string {
    if (!this.hoists.has(name)) this.hoists.set(name, init)
    return name
  }

  col(name: keyof typeof COLUMNS): string {
    return this.hoist(COLUMNS[name], `E.${name}`)
  }

  tmp(): string {
    return `t${this.n++}`
  }

  header(): string {
    return [...this.hoists].map(([n, init]) => `const ${n} = ${init};`).join('\n')
  }
}

class State {
  id = -1
  readonly lines: string[] = []
  constructor(
    readonly serial: number,
    /** Resume key, for states an instance can be suspended in. */
    readonly key: string | null,
  ) {}
}

class StateMachine {
  readonly order: State[] = []
  cur: State
  private serial = 0

  /** `pc` and `wake` are lvalues; `exit` leaves the entity for this tick. */
  constructor(
    readonly pc: string,
    readonly wake: string,
    readonly exit: string,
  ) {
    this.cur = this.newState('start')
    this.place(this.cur)
  }

  newState(key: string | null = null): State {
    return new State(this.serial++, key)
  }

  /** Continues in `s`; the current state falls through into it. */
  place(s: State): void {
    s.id = this.order.length
    this.order.push(s)
    this.cur = s
  }

  ref(s: State): string {
    return `@S${s.serial}@`
  }

  jump(s: State): string {
    return `${this.pc} = ${this.ref(s)}; continue run;`
  }

  yieldTo(s: State, wake: string): string {
    return `${this.pc} = ${this.ref(s)}; ${this.wake} = ${wake}; ${this.exit}`
  }

  /** The `switch` cases, with state references resolved. `end` runs after the last state. */
  cases(end: string): string {
    const ids = new Map<number, number>()
    for (const s of this.order) ids.set(s.serial, s.id)
    const body = this.order.map((s) => `case ${s.id}: {\n${s.lines.join('\n')}\n}`).join('\n')
    return `${body}\n${end}`.replace(/@S(\d+)@/g, (_, serial: string) => {
      const id = ids.get(Number(serial))
      if (id === undefined) throw new Error('codegen: jump to a state that was never placed')
      return String(id)
    })
  }
}

interface Param {
  code: string
  ty: Ty
}

interface Ctx {
  fn: FnGen
  /** Null in code that never waits (custom block functions, per-frame bodies). */
  sm: StateMachine | null
  lines: string[]
  proc: ProcIR | null
  params: Param[]
  warp: boolean
  /** Ends this script (or returns from the custom block). */
  stop: string
  /** Leaves after "stop all". */
  halt: string
  /** A local that survives waits; `owner` names what it holds (see ScriptPlan.numOwners). */
  numLocal(owner: string | null): string
  objLocal(owner: string | null): string
}

function emit(ctx: Ctx, line: string): void {
  if (ctx.sm) ctx.sm.cur.lines.push(line)
  else ctx.lines.push(line)
}

interface ProcFn {
  name: string
  /** Whether it is a state machine over frames. */
  sm: boolean
  pool: string
  /** Where each parameter goes: the frame's numeric or other locals. */
  slots: { num: boolean; index: number; ty: Ty }[]
  types: Ty[]
}

// ---- module ---------------------------------------------------------------

class ModuleGen {
  readonly consts: ConstRef[] = []
  private readonly constKeys = new Map<unknown, number>()
  readonly fns: string[] = []
  private readonly procs = new Map<string, ProcFn>()
  private nextFn = 0

  constructor(readonly env: CodegenEnv) {}

  get facts(): KindFacts {
    return this.env.facts
  }

  const(key: unknown, ref: ConstRef): string {
    let i = this.constKeys.get(key)
    if (i === undefined) {
      i = this.consts.length
      this.consts.push(ref)
      this.constKeys.set(key, i)
    }
    return `C[${i}]`
  }

  kindConst(index: number): string {
    return this.const(`kind:${index}`, { t: 'kind', index })
  }

  /** The function for a custom block run in `warp` mode (already including the block's own flag). */
  proc(p: ProcIR, warp: boolean): ProcFn {
    const key = `${warp ? 1 : 0}:${p.proccode}`
    const done = this.procs.get(key)
    if (done) return done
    const sm = this.facts.procYields(p.proccode, warp)
    const types = p.params.map((_, i) => this.env.layout.params.get(paramKey(this.env.kind, p.proccode, i)) ?? 'any')
    let nNum = 0
    let nObj = 0
    const slots = types.map((ty) => (ty === 'num' ? { num: true, index: nNum++, ty } : { num: false, index: nObj++, ty }))
    const name = `${sm ? 'q' : 'p'}${this.nextFn++}`
    const fn: ProcFn = { name, sm, pool: '', slots, types }
    // Registered before generating the body, so recursive calls find it.
    this.procs.set(key, fn)
    if (sm) this.genSmProc(p, warp, fn, nNum, nObj)
    else this.genSyncProc(p, warp, fn)
    return fn
  }

  private genSyncProc(p: ProcIR, warp: boolean, fn: ProcFn): void {
    const f = new FnGen()
    const args = fn.types.map((_, i) => `a${i}`)
    const ctx: Ctx = {
      fn: f,
      sm: null,
      lines: [],
      proc: p,
      params: fn.types.map((ty, i) => ({ code: args[i], ty })),
      warp,
      stop: 'return;',
      halt: 'return;',
      numLocal: () => { throw new Error('codegen: no locals in a function that cannot wait') },
      objLocal: () => { throw new Error('codegen: no locals in a function that cannot wait') },
    }
    stmts(p.body, ctx, this)
    this.fns.push(`function ${fn.name}(${['i', ...args].join(', ')}) {\n${f.header()}\n${ctx.lines.join('\n')}\n}`)
  }

  private genSmProc(p: ProcIR, warp: boolean, fn: ProcFn, nNum: number, nObj: number): void {
    const f = new FnGen()
    const sm = new StateMachine('fr.pc', 'fr.wake', 'return fr.wake;')
    const locals = { num: nNum, obj: nObj }
    const ctx: Ctx = {
      fn: f,
      sm,
      lines: [],
      proc: p,
      params: fn.slots.map((s) => ({ code: s.num ? `fr.n[${s.index}]` : `fr.o[${s.index}]`, ty: s.ty })),
      warp,
      stop: 'return -1;',
      halt: 'return -1;',
      numLocal: () => `fr.n[${locals.num++}]`,
      objLocal: () => `fr.o[${locals.obj++}]`,
    }
    // The pool is needed by recursive calls in the body, and sized once the body has taken its locals.
    const pool = { t: 'pool' as const, num: 0, obj: 0 }
    fn.pool = this.const(`pool:${fn.name}`, pool)
    stmts(p.body, ctx, this)
    pool.num = locals.num
    pool.obj = locals.obj
    this.fns.push(
      `function ${fn.name}(i, fr) {\n${f.header()}\nconst T = rt.tick;\nif (fr.wake > T) return fr.wake;\n` +
        `run: for (;;) {\nswitch (fr.pc) {\n${sm.cases('')}\n}\nreturn -1;\n}\n}`,
    )
  }

  script(ir: ScriptIR, index: number): { plan: Omit<ScriptPlan, 'structure'>; sm: string; fv: string | null } {
    const S = this.const(`script:${index}`, { t: 'script', index })
    const last = ir.body[ir.body.length - 1]
    const perFrame = last?.op === 'control_forever' && !this.facts.suspends(last.body, false)
    const prelude = perFrame ? ir.body.slice(0, -1) : ir.body

    const f = new FnGen()
    f.hoist('S', S)
    const PC = f.hoist('PC', 'S.pc')
    const WK = f.hoist('WK', 'S.wake')
    const sm = new StateMachine(`${PC}[i]`, `${WK}[i]`, 'continue ent;')
    const locals = { num: 0, obj: 0 }
    const numOwners: (string | null)[] = []
    const objOwners: (string | null)[] = []
    const ctx: Ctx = {
      fn: f,
      sm,
      lines: [],
      proc: null,
      params: [],
      warp: false,
      stop: `${PC}[i] = -1; continue ent;`,
      halt: 'return;',
      numLocal: (owner) => {
        numOwners.push(owner)
        const n = locals.num++
        return `${f.hoist(`N${n}`, `S.num[${n}]`)}[i]`
      },
      objLocal: (owner) => {
        objOwners.push(owner)
        const n = locals.obj++
        return `${f.hoist(`O${n}`, `S.obj[${n}]`)}[i]`
      },
    }
    stmts(prelude, ctx, this)
    if (perFrame) {
      const INF = f.hoist('INF', 'S.inF')
      emit(ctx, `${PC}[i] = -2; if (${INF}[i] === 0) { ${INF}[i] = 1; S.flist[S.fn++] = i; } continue ent;`)
    }
    const smName = `sm${index}`
    let smSrc: string
    if (sm.order.length === 1) {
      // Immediate: no waits, so no dispatch.
      smSrc =
        `function ${smName}(list, n) {\n${f.header()}\n` +
        `ent: for (let k = 0; k < n; k++) {\nconst i = list[k];\nif (${PC}[i] < 0) continue;\n` +
        `{\n${sm.order[0].lines.join('\n')}\n}\n${PC}[i] = -1;\n}\n}`
    } else {
      smSrc =
        `function ${smName}(list, n) {\n${f.header()}\nconst T = rt.tick;\n` +
        `ent: for (let k = 0; k < n; k++) {\nconst i = list[k];\nif (${PC}[i] < 0 || ${WK}[i] > T) continue;\n` +
        `run: for (;;) {\nswitch (${PC}[i]) {\n${sm.cases('')}\n}\n${PC}[i] = -1; continue ent;\n}\n}\n}`
    }
    this.fns.push(smSrc)

    let fvName: string | null = null
    if (perFrame) {
      const g = new FnGen()
      g.hoist('S', S)
      const PC2 = g.hoist('PC', 'S.pc')
      const body: Ctx = {
        fn: g,
        sm: null,
        lines: [],
        proc: null,
        params: [],
        warp: false,
        stop: `${PC2}[i] = -1; S.dirtyF = 1; continue ent;`,
        halt: 'return;',
        numLocal: () => { throw new Error('codegen: no locals in a per-frame body') },
        objLocal: () => { throw new Error('codegen: no locals in a per-frame body') },
      }
      stmts(last.body, body, this)
      fvName = `fv${index}`
      this.fns.push(
        `function ${fvName}(list, n) {\n${g.header()}\n` +
          `ent: for (let k = 0; k < n; k++) {\nconst i = list[k];\nif (${PC2}[i] !== -2) continue;\n{\n${body.lines.join('\n')}\n}\n}\n}`,
      )
    }
    return {
      plan: {
        ir,
        numLocals: locals.num,
        objLocals: locals.obj,
        perFrame,
        moves: this.facts.visible(ir.body),
        resume: sm.order.map((st) => st.key),
        perFrameKey: perFrame ? foreverKey(last) : null,
        numOwners,
        objOwners,
      },
      sm: smName,
      fv: fvName,
    }
  }
}

/** Generates the module for one kind's scripts. */
export function generateKind(env: CodegenEnv, scripts: ScriptIR[]): ModulePlan {
  const m = new ModuleGen(env)
  const sms: string[] = []
  const fvs: string[] = []
  const plans: ScriptPlan[] = []
  scripts.forEach((ir, index) => {
    const r = m.script(ir, index)
    sms.push(r.sm)
    fvs.push(r.fv ?? 'null')
    plans.push({ ...r.plan, structure: structureOf(env, ir) })
  })
  const source =
    `"use strict";\nconst DEG = Math.PI / 180;\n` +
    `${m.fns.join('\n\n')}\nreturn { sm: [${sms.join(', ')}], fv: [${fvs.join(', ')}] };`
  return { source, consts: m.consts, scripts: plans }
}

/** The script plus every custom block it reaches (with parameter types). */
function structureOf(env: CodegenEnv, ir: ScriptIR): string {
  const seen = new Set<string>()
  const visit = (stmts: Stmt[] | undefined): void => {
    for (const s of stmts ?? []) {
      if (s.call && !seen.has(s.call.proccode)) {
        seen.add(s.call.proccode)
        visit(env.facts.proc(s.call.proccode)?.body)
      }
      visit(s.body)
      visit(s.body2)
    }
  }
  visit(ir.body)
  const parts = [ir.source]
  for (const code of [...seen].sort()) {
    const p = env.facts.proc(code)
    if (!p) continue
    parts.push(p.source, JSON.stringify(p.params.map((_, i) => env.layout.params.get(paramKey(env.kind, code, i)))))
  }
  return parts.join('\n')
}

// ---- statements -------------------------------------------------------------

function stmts(list: Stmt[] | undefined, ctx: Ctx, m: ModuleGen): void {
  for (const s of list ?? []) stmt(s, ctx, m)
}

function stmt(s: Stmt, ctx: Ctx, m: ModuleGen): void {
  if (m.facts.suspends([s], ctx.warp)) {
    if (!ctx.sm) throw new Error(`codegen: "${s.op}" can wait in code that cannot`)
    waitingStmt(s, ctx, m)
    return
  }
  plainStmt(s, ctx, m)
}

/** Assigns the entity position; axes left undefined keep their value. Draws with the pen. */
function setPos(ctx: Ctx, x?: string, y?: string, z?: string): void {
  const f = ctx.fn
  const [X, Y, Z, FL] = [f.col('x'), f.col('y'), f.col('z'), f.col('flags')]
  emit(ctx, `if (${FL}[i] & ${F_PEN}) L.pen(i, ${x ?? `${X}[i]`}, ${y ?? `${Y}[i]`}, ${z ?? `${Z}[i]`});`)
  if (x !== undefined) emit(ctx, `${X}[i] = ${x};`)
  if (y !== undefined) emit(ctx, `${Y}[i] = ${y};`)
  if (z !== undefined) emit(ctx, `${Z}[i] = ${z};`)
}

/** An angle wrapped to (-180, 180], with the common in-range case inline (no call, no boxed number). */
function wrap(ctx: Ctx, code: string): string {
  const d = bind(ctx, code)
  return `(${d} > -180 && ${d} <= 180 ? ${d} : L.wrap(${d}))`
}

/** Evaluates an expression once into a const temp, returning its name. */
function bind(ctx: Ctx, code: string): string {
  const t = ctx.fn.tmp()
  emit(ctx, `const ${t} = ${code};`)
  return t
}

function plainStmt(s: Stmt, ctx: Ctx, m: ModuleGen): void {
  const f = ctx.fn
  const e = (name: string) => expr(s.in[name], ctx, m)
  const n = (name: string) => asNum(e(name))
  emit(ctx, '{')
  switch (s.op) {
    // motion
    case 'motion_movesteps': {
      const [D, PT, X, Y, Z] = [f.col('direction'), f.col('pitch'), f.col('x'), f.col('y'), f.col('z')]
      const st = bind(ctx, n('STEPS'))
      const r = bind(ctx, `${D}[i] * DEG`)
      // Pitch is usually 0: skip its sine and cosine then.
      const p = bind(ctx, `${PT}[i]`)
      const h = bind(ctx, `${p} === 0 ? ${st} : Math.cos(${p} * DEG) * ${st}`)
      const nx = bind(ctx, `${X}[i] + ${h} * Math.sin(${r})`)
      const ny = bind(ctx, `${Y}[i] + ${h} * Math.cos(${r})`)
      const nz = bind(ctx, `${p} === 0 ? ${Z}[i] : ${Z}[i] + Math.sin(${p} * DEG) * ${st}`)
      setPos(ctx, nx, ny, nz)
      break
    }
    case 'motion_turnright':
    case 'motion_turnleft': {
      const D = f.col('direction')
      emit(ctx, `${D}[i] = ${wrap(ctx, `${D}[i] ${s.op === 'motion_turnright' ? '+' : '-'} ${n('DEGREES')}`)};`)
      break
    }
    case 'motion_pointindirection':
      emit(ctx, `${f.col('direction')}[i] = ${wrap(ctx, n('DIRECTION'))};`)
      break
    case 'motion_gotoxy':
      setPos(ctx, bind(ctx, n('X')), bind(ctx, n('Y')))
      break
    case 'motion_gotoxyz':
      setPos(ctx, bind(ctx, n('X')), bind(ctx, n('Y')), bind(ctx, n('Z')))
      break
    case 'motion_setx':
      setPos(ctx, bind(ctx, n('X')))
      break
    case 'motion_sety':
      setPos(ctx, undefined, bind(ctx, n('Y')))
      break
    case 'motion_setz':
      setPos(ctx, undefined, undefined, bind(ctx, n('Z')))
      break
    case 'motion_changexby':
      setPos(ctx, bind(ctx, `${f.col('x')}[i] + ${n('DX')}`))
      break
    case 'motion_changeyby':
      setPos(ctx, undefined, bind(ctx, `${f.col('y')}[i] + ${n('DY')}`))
      break
    case 'motion_changezby':
      setPos(ctx, undefined, undefined, bind(ctx, `${f.col('z')}[i] + ${n('DZ')}`))
      break
    case 'motion_setpitch':
      emit(ctx, `${f.col('pitch')}[i] = L.clampPitch(${n('PITCH')});`)
      break
    case 'motion_turnup':
    case 'motion_turndown': {
      const PT = f.col('pitch')
      emit(ctx, `${PT}[i] = L.clampPitch(${PT}[i] ${s.op === 'motion_turnup' ? '+' : '-'} ${n('DEGREES')});`)
      break
    }
    case 'motion_setroll':
      emit(ctx, `${f.col('roll')}[i] = ${wrap(ctx, n('ROLL'))};`)
      break
    case 'motion_changerollby': {
      const RL = f.col('roll')
      emit(ctx, `${RL}[i] = ${wrap(ctx, `${RL}[i] + ${n('DEGREES')}`)};`)
      break
    }
    case 'motion_ifonedgebounce': {
      // Only an entity whose bounding sphere reaches a wall or the floor can bounce.
      const [X, Y, Z, SZ] = [f.col('x'), f.col('y'), f.col('z'), f.col('size')]
      const SH = f.hoist('SH', 'E.shape')
      const BR = f.hoist('BR', 'L.BOUNDING')
      const r = bind(ctx, `${SZ}[i] * ${BASE_SIZE / 200} * ${BR}[${SH}[i]] + 1e-6`)
      emit(ctx, `if (${X}[i] - ${r} < ${-STAGE_WIDTH / 2} || ${X}[i] + ${r} > ${STAGE_WIDTH / 2} || ${Y}[i] - ${r} < ${-STAGE_HEIGHT / 2} || ${Y}[i] + ${r} > ${STAGE_HEIGHT / 2} || ${Z}[i] - ${r} < 0) L.bounce(i);`)
      break
    }

    // looks
    case 'looks_show': {
      const FL = f.col('flags')
      emit(ctx, `${FL}[i] |= ${F_VISIBLE};`)
      break
    }
    case 'looks_hide': {
      const FL = f.col('flags')
      emit(ctx, `${FL}[i] &= ${~F_VISIBLE & 0xff};`)
      break
    }
    case 'looks_say':
      emit(ctx, `L.say(i, ${asStr(e('MESSAGE'))});`)
      break
    case 'looks_setsizeto':
      emit(ctx, `${f.col('size')}[i] = L.clampSize(${n('SIZE')});`)
      break
    case 'looks_changesizeby': {
      const SZ = f.col('size')
      emit(ctx, `${SZ}[i] = L.clampSize(${SZ}[i] + ${n('CHANGE')});`)
      break
    }
    case 'looks_setcolorto': {
      const v = e('COLOR')
      if (v.k !== undefined) {
        if (isColorString(v.k)) emit(ctx, `${f.col('color')}[i] = ${colorToInt(v.k)};`)
      } else {
        emit(ctx, `L.setColor(i, ${v.c});`)
      }
      break
    }

    // sensing
    case 'sensing_resettimer':
      emit(ctx, 'L.resetTimer();')
      break

    // variables and lists
    case 'data_setvariableto': {
      const ref = varRef(s.f.VARIABLE, ctx, m)
      emit(ctx, `${ref.c} = ${asType(e('VALUE'), ref.t)};`)
      break
    }
    case 'data_changevariableby': {
      const ref = varRef(s.f.VARIABLE, ctx, m)
      if (ref.t === 'num') emit(ctx, `${ref.c} += ${n('VALUE')};`)
      else emit(ctx, `${ref.c} = L.num(${ref.c}) + ${n('VALUE')};`)
      break
    }
    case 'data_showvariable':
    case 'data_hidevariable':
      emit(ctx, `L.monitor(${lit(`var:${s.f.VARIABLE}`)}, ${s.op === 'data_showvariable'});`)
      break
    case 'data_showlist':
    case 'data_hidelist':
      emit(ctx, `L.monitor(${lit(`list:${s.f.LIST}`)}, ${s.op === 'data_showlist'});`)
      break
    case 'data_addtolist': {
      const l = listRef(s.f.LIST, ctx, m)
      emit(ctx, `L.ladd(${l.c}, ${asType(e('ITEM'), l.elem)});`)
      break
    }
    case 'data_deleteoflist':
      emit(ctx, `L.ldel(${listRef(s.f.LIST, ctx, m).c}, ${e('INDEX').c});`)
      break
    case 'data_deletealloflist':
      emit(ctx, `${listRef(s.f.LIST, ctx, m).c}.length = 0;`)
      break
    case 'data_insertatlist': {
      const l = listRef(s.f.LIST, ctx, m)
      emit(ctx, `L.lins(${l.c}, ${e('INDEX').c}, ${asType(e('ITEM'), l.elem)});`)
      break
    }
    case 'data_replaceitemoflist': {
      const l = listRef(s.f.LIST, ctx, m)
      emit(ctx, `L.lrep(${l.c}, ${e('INDEX').c}, ${asType(e('ITEM'), l.elem)});`)
      break
    }

    // pen
    case 'pen_clear':
      emit(ctx, 'L.penClear();')
      break
    case 'pen_penDown':
      emit(ctx, `${f.col('flags')}[i] |= ${F_PEN};`)
      break
    case 'pen_penUp':
      emit(ctx, `${f.col('flags')}[i] &= ${~F_PEN & 0xff};`)
      break
    case 'pen_setPenColorToColor': {
      const v = e('COLOR')
      if (v.k !== undefined) {
        if (isColorString(v.k)) emit(ctx, `L.penRgb(i, ${colorToInt(v.k)});`)
      } else {
        emit(ctx, `L.setPenColor(i, ${v.c});`)
      }
      break
    }
    case 'pen_changePenColorParamBy':
    case 'pen_setPenColorParamTo':
      if ((PEN_PARAMS as readonly string[]).includes(s.f.COLOR_PARAM)) {
        emit(ctx, `L.penParam(i, ${lit(s.f.COLOR_PARAM)}, ${n('VALUE')}, ${s.op === 'pen_changePenColorParamBy'});`)
      }
      break
    case 'pen_setPenSizeTo':
      emit(ctx, `${f.col('penSize')}[i] = L.clampPenSize(${n('SIZE')});`)
      break
    case 'pen_changePenSizeBy': {
      const PSZ = f.col('penSize')
      emit(ctx, `${PSZ}[i] = L.clampPenSize(${PSZ}[i] + ${n('SIZE')});`)
      break
    }
    case 'pen_stamp':
      emit(ctx, 'L.stamp(i);')
      break
    case 'pen_drawCube':
      emit(ctx, `L.drawCube(i, ${n('SIZE')});`)
      break
    case 'pen_drawSphere':
      emit(ctx, `L.drawSphere(i, ${n('RADIUS')});`)
      break

    // control
    case 'control_if':
    case 'control_if_else': {
      const c = e('CONDITION')
      if (c.k !== undefined) {
        stmts(toBoolean(c.k) ? s.body : s.body2, ctx, m)
        break
      }
      emit(ctx, `if (${asBool(c)}) {`)
      stmts(s.body, ctx, m)
      if (s.body2?.length) {
        emit(ctx, '} else {')
        stmts(s.body2, ctx, m)
      }
      emit(ctx, '}')
      break
    }
    case 'control_repeat': {
      const t = ctx.fn.tmp()
      emit(ctx, `for (let ${t} = Math.round(${n('TIMES')}); ${t} > 0; ${t}--) {`)
      stmts(s.body, ctx, m)
      emit(ctx, '}')
      break
    }
    case 'control_repeat_until':
      emit(ctx, `while (!${asBool(e('CONDITION'))}) {`)
      stmts(s.body, ctx, m)
      emit(ctx, '}')
      break
    case 'control_stop':
      if (s.f.STOP_OPTION === 'all') emit(ctx, `L.stopAll(); ${ctx.halt}`)
      else if (s.f.STOP_OPTION === 'other scripts in sprite') emit(ctx, 'L.stopOthers(i);')
      else emit(ctx, ctx.stop)
      break
    case 'control_create_clone_of': {
      const v = e('CLONE_OPTION')
      if (v.k === undefined) emit(ctx, `L.cloneNamed(i, ${asStr(v)});`)
      else if (v.k === MYSELF) emit(ctx, 'L.clone(i, -1);')
      else {
        const other = m.env.project.kindByName(String(v.k))
        if (other >= 0) emit(ctx, `L.clone(i, ${other});`)
      }
      break
    }
    case 'control_delete_this_clone':
      emit(ctx, `if (L.deleteClone(i)) { ${ctx.stop} }`)
      break

    // events
    case 'event_broadcast':
      emit(ctx, `L.broadcast(${asStr(e('BROADCAST_INPUT'))});`)
      break

    // custom blocks
    case 'procedures_call': {
      const p = m.facts.proc(s.call!.proccode)
      if (!p) {
        warnOnce(`compiler: custom block "${s.call!.proccode}" has no definition; the call is ignored`)
        break
      }
      const fn = m.proc(p, ctx.warp || p.warp)
      const args = fn.types.map((ty, i) => {
        const a = s.call!.args[i]
        return asType(a ? expr(a, ctx, m) : k(''), ty)
      })
      emit(ctx, `${fn.name}(${['i', ...args].join(', ')});`)
      afterCall(p.proccode, ctx, m)
      break
    }
    default:
      warnOnce(`compiler: statement "${s.op}" is not supported here`)
  }
  emit(ctx, '}')
}

/** After a custom block returns: leave if it stopped everything or deleted this clone. */
function afterCall(proccode: string, ctx: Ctx, m: ModuleGen): void {
  if (m.facts.procHalts(proccode)) emit(ctx, `if (rt.halted) { ${ctx.halt} }`)
  if (m.facts.procKills(proccode)) emit(ctx, `if (${ctx.fn.col('flags')}[i] & ${F_DYING}) { ${ctx.stop} }`)
}

/** Resume key of a "forever" loop, whether it is a state or per-frame. */
const foreverKey = (s: Stmt) => `${s.id}:forever`

/** Ticks to wait for a number of seconds, computed now when constant. */
function ticks(secs: V): string {
  const c = num(secs)
  return c !== undefined ? lit(waitTicks(c)) : `L.ticks(${asNum(secs)})`
}

/** Statements that can wait, split into states. */
function waitingStmt(s: Stmt, ctx: Ctx, m: ModuleGen): void {
  const sm = ctx.sm!
  const f = ctx.fn
  const e = (name: string) => expr(s.in[name], ctx, m)
  const n = (name: string) => asNum(e(name))
  const next1 = 'T + 1'
  switch (s.op) {
    case 'control_wait': {
      const next = sm.newState(`${s.id}:wait`)
      emit(ctx, sm.yieldTo(next, `T + ${ticks(e('DURATION'))}`))
      sm.place(next)
      return
    }
    case 'control_wait_until': {
      const head = sm.newState(`${s.id}:until`)
      sm.place(head)
      emit(ctx, `if (!${asBool(e('CONDITION'))}) { ${sm.yieldTo(head, next1)} }`)
      return
    }
    case 'motion_glidesecstoxy':
    case 'motion_glidesecstoxyz': {
      const [x0, y0, z0, x1, y1, z1, t0, dur] = Array.from({ length: 8 }, (_, j) => ctx.numLocal(`${s.id}:glide${j}`))
      const [X, Y, Z] = [f.col('x'), f.col('y'), f.col('z')]
      const step = sm.newState(`${s.id}:glide`)
      const after = sm.newState()
      emit(ctx, '{')
      const d = bind(ctx, `${n('SECS')} * 60`)
      emit(ctx, `${x1} = ${n('X')}; ${y1} = ${n('Y')}; ${z1} = ${s.op === 'motion_glidesecstoxyz' ? n('Z') : `${Z}[i]`};`)
      emit(ctx, `if (${d} <= 0) {`)
      setPos(ctx, x1, y1, z1)
      emit(ctx, sm.jump(after))
      emit(ctx, '}')
      emit(ctx, `${x0} = ${X}[i]; ${y0} = ${Y}[i]; ${z0} = ${Z}[i]; ${t0} = T; ${dur} = ${d};`)
      emit(ctx, sm.yieldTo(step, next1))
      emit(ctx, '}')
      sm.place(step)
      emit(ctx, '{')
      const fr = bind(ctx, `Math.min(1, (T - ${t0}) / ${dur})`)
      setPos(
        ctx,
        bind(ctx, `${x0} + (${x1} - ${x0}) * ${fr}`),
        bind(ctx, `${y0} + (${y1} - ${y0}) * ${fr}`),
        bind(ctx, `${z0} + (${z1} - ${z0}) * ${fr}`),
      )
      emit(ctx, `if (${fr} < 1) { ${sm.yieldTo(step, next1)} }`)
      emit(ctx, '}')
      sm.place(after)
      return
    }
    case 'looks_sayforsecs': {
      emit(ctx, `L.say(i, ${asStr(e('MESSAGE'))});`)
      const next = sm.newState(`${s.id}:say`)
      emit(ctx, sm.yieldTo(next, `T + ${ticks(e('SECS'))}`))
      sm.place(next)
      emit(ctx, 'L.say(i, null);')
      return
    }
    case 'event_broadcastandwait': {
      const o = ctx.objLocal(`${s.id}:wait`)
      emit(ctx, `${o} = L.broadcastWait(${asStr(e('BROADCAST_INPUT'))});`)
      const next = sm.newState(`${s.id}:broadcast`)
      emit(ctx, sm.yieldTo(next, next1))
      sm.place(next)
      emit(ctx, `if (!L.waitDone(${o})) { ${sm.yieldTo(next, next1)} }`)
      emit(ctx, `${o} = null;`)
      return
    }
    case 'control_forever': {
      const head = sm.newState(foreverKey(s))
      sm.place(head)
      stmts(s.body, ctx, m)
      emit(ctx, sm.yieldTo(head, next1))
      // Nothing after a forever runs.
      sm.place(sm.newState())
      return
    }
    case 'control_repeat':
    case 'control_repeat_until': {
      const head = sm.newState(`${s.id}:loop`)
      const after = sm.newState()
      if (s.op === 'control_repeat') {
        const c = ctx.numLocal(`${s.id}:count`)
        emit(ctx, `${c} = Math.round(${n('TIMES')});`)
        sm.place(head)
        emit(ctx, `if (${c} <= 0) { ${sm.jump(after)} }`)
        emit(ctx, `${c}--;`)
      } else {
        sm.place(head)
        emit(ctx, `if (${asBool(e('CONDITION'))}) { ${sm.jump(after)} }`)
      }
      stmts(s.body, ctx, m)
      emit(ctx, m.facts.loopYields(s, ctx.warp) ? sm.yieldTo(head, next1) : sm.jump(head))
      sm.place(after)
      return
    }
    case 'control_if':
    case 'control_if_else': {
      const c = e('CONDITION')
      if (c.k !== undefined) {
        stmts(toBoolean(c.k) ? s.body : s.body2, ctx, m)
        return
      }
      const yes = sm.newState()
      const no = sm.newState()
      const after = sm.newState()
      const hasElse = !!s.body2?.length
      emit(ctx, `if (!${asBool(c)}) { ${sm.jump(hasElse ? no : after)} }`)
      sm.place(yes)
      stmts(s.body, ctx, m)
      if (hasElse) {
        emit(ctx, sm.jump(after))
        sm.place(no)
        stmts(s.body2, ctx, m)
      }
      sm.place(after)
      return
    }
    case 'procedures_call': {
      const p = m.facts.proc(s.call!.proccode)!
      const fn = m.proc(p, ctx.warp || p.warp)
      // The frame belongs to this compile's pool, so a call in progress stays on its code.
      const o = ctx.objLocal(null)
      emit(ctx, '{')
      const fr = bind(ctx, `${fn.pool}.take()`)
      fn.slots.forEach((slot, i) => {
        const a = s.call!.args[i]
        const v = asType(a ? expr(a, ctx, m) : k(''), slot.ty)
        emit(ctx, `${fr}.${slot.num ? 'n' : 'o'}[${slot.index}] = ${v};`)
      })
      emit(ctx, `${o} = ${fr};`)
      emit(ctx, '}')
      const call = sm.newState()
      sm.place(call)
      emit(ctx, `{ const r = ${fn.name}(i, ${o}); if (r >= 0) { ${sm.yieldTo(call, 'r')} } ${fn.pool}.give(${o}); ${o} = null; }`)
      afterCall(p.proccode, ctx, m)
      return
    }
    default: {
      if (!s.ext) throw new Error(`codegen: "${s.op}" is not a waiting block`)
      const o = ctx.objLocal(`${s.id}:promise`)
      const next = sm.newState(`${s.id}:ext`)
      const B = m.const(s.ext, { t: 'block', block: s.ext })
      emit(ctx, `{ const r = L.command(${B}, i, ${extArgs(s.ext, s, ctx, m)}); if (L.isPromise(r)) { ${o} = L.track(r); ${sm.yieldTo(next, next1)} } }`)
      sm.place(next)
      emit(ctx, `if (${o} !== null) { if (!${o}.done) { ${sm.yieldTo(next, next1)} } ${o} = null; }`)
      return
    }
  }
}

/** The argument object for an extension block: inputs cast to their declared types, menus as text. */
function extArgs(block: CommandBlock | ExtensionBlock, s: { in: Record<string, Expr>; f: Record<string, string> }, ctx: Ctx, m: ModuleGen): string {
  const parts: string[] = []
  for (const [name, spec] of Object.entries(block.args ?? {})) {
    const key = JSON.stringify(name)
    if (spec.type === 'menu') {
      parts.push(`${key}: ${lit(s.f[name] ?? '')}`)
      continue
    }
    const v = expr(s.in[name], ctx, m)
    const cast = spec.type === 'number' || spec.type === 'angle' ? asNum(v) : spec.type === 'boolean' ? asBool(v) : asStr(v)
    parts.push(`${key}: ${cast}`)
  }
  return `{ ${parts.join(', ')} }`
}

const warned = new Set<string>()
function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

// ---- variables and lists -----------------------------------------------------

function varRef(id: string, ctx: Ctx, m: ModuleGen): { c: string; t: Ty } {
  const { layout, kind } = m.env
  const local = layout.kinds[kind].vars.get(id)
  if (local) {
    const K = ctx.fn.hoist('KS', m.kindConst(kind))
    const col = local.num ? ctx.fn.hoist(`VN${local.index}`, `${K}.num[${local.index}]`) : ctx.fn.hoist(`VR${local.index}`, `${K}.ref[${local.index}]`)
    return { c: `${col}[i]`, t: local.ty }
  }
  const g = layout.globals.get(id)
  if (!g) return { c: '0', t: 'num' }
  const arr = g.num ? ctx.fn.hoist('G', 'rt.G') : ctx.fn.hoist('R', 'rt.R')
  return { c: `${arr}[${g.index}]`, t: g.ty }
}

function listRef(id: string, ctx: Ctx, m: ModuleGen): { c: string; elem: Ty } {
  const { layout, kind } = m.env
  const local = layout.kinds[kind].lists.get(id)
  if (local) {
    const K = ctx.fn.hoist('KS', m.kindConst(kind))
    return { c: `${ctx.fn.hoist(`VL${local.index}`, `${K}.lists[${local.index}]`)}[i]`, elem: local.elem }
  }
  const g = layout.lists.get(id)
  if (!g) return { c: '[]', elem: 'any' }
  return { c: `${ctx.fn.hoist('LS', 'rt.LS')}[${g.index}]`, elem: g.elem }
}

// ---- expressions ---------------------------------------------------------------

function fold(vs: V[], f: (...ks: Value[]) => Value): V | null {
  if (vs.some((v) => v.k === undefined)) return null
  return k(f(...vs.map((v) => v.k!)))
}

function expr(e: Expr, ctx: Ctx, m: ModuleGen): V {
  const f = ctx.fn
  const e2 = (name: string) => expr(e.in[name], ctx, m)
  const pair = (a: string, b: string): [V, V] => [e2(a), e2(b)]
  switch (e.op) {
    case 'const':
      return k(e.v!)

    // motion and looks
    case 'motion_xposition':
      return { c: `L.round6(${f.col('x')}[i])`, t: 'num' }
    case 'motion_yposition':
      return { c: `L.round6(${f.col('y')}[i])`, t: 'num' }
    case 'motion_zposition':
      return { c: `L.round6(${f.col('z')}[i])`, t: 'num' }
    case 'motion_direction':
      return { c: `${f.col('direction')}[i]`, t: 'num' }
    case 'motion_pitch':
      return { c: `${f.col('pitch')}[i]`, t: 'num' }
    case 'motion_roll':
      return { c: `L.round6(${f.col('roll')}[i])`, t: 'num' }
    case 'looks_size':
      return { c: `Math.round(${f.col('size')}[i])`, t: 'num' }

    // events
    case 'event_broadcast_menu':
      return k(m.env.messageName(e.f.BROADCAST_OPTION))

    // sensing
    case 'sensing_touchingobject': {
      const v = e2('TOUCHINGOBJECTMENU')
      if (v.k === undefined) return { c: `L.touchingValue(i, ${v.c})`, t: 'bool' }
      if (v.k === EDGE) return { c: 'L.touchingEdge(i)', t: 'bool' }
      const other = m.env.project.kindByName(String(v.k))
      return other >= 0 ? { c: `L.touchingKind(i, ${m.kindConst(other)})`, t: 'bool' } : k(false)
    }
    case 'sensing_distanceto': {
      const v = e2('DISTANCETOMENU')
      if (v.k === undefined) return { c: `L.round6(L.distanceValue(i, ${v.c}))`, t: 'num' }
      if (v.k === MOUSE) return { c: 'L.round6(L.distanceToMouse(i))', t: 'num' }
      const other = m.env.project.kindByName(String(v.k))
      return other >= 0 ? { c: `L.round6(L.distanceToKind(i, ${m.kindConst(other)}))`, t: 'num' } : k(10000)
    }
    case 'sensing_touchedsprite':
      return { c: 'L.touched(i)', t: 'any' }
    case 'sensing_touchingcolor': {
      const v = e2('COLOR')
      if (v.k === undefined) return { c: `L.touchingColorValue(i, ${v.c})`, t: 'bool' }
      return isColorString(v.k) ? { c: `L.touchingColor(i, ${colorToInt(v.k)})`, t: 'bool' } : k(false)
    }
    case 'sensing_keypressed':
      return { c: `L.keyDown(${asStr(e2('KEY_OPTION'))})`, t: 'bool' }
    case 'sensing_mousedown':
      return { c: 'rt.mouse.down', t: 'bool' }
    case 'sensing_mousex':
      return { c: 'L.round6(rt.mouse.x)', t: 'num' }
    case 'sensing_mousey':
      return { c: 'L.round6(rt.mouse.y)', t: 'num' }
    case 'sensing_timer':
      return { c: 'L.timer()', t: 'num' }
    case 'sensing_of': {
      const obj = e2('OBJECT')
      const prop = e.f.PROPERTY
      if (obj.k === undefined) return { c: `L.ofValue(${obj.c}, ${lit(prop)})`, t: 'any' }
      const other = m.env.project.kindByName(String(obj.k))
      if (other < 0) return k(0)
      const K = m.kindConst(other)
      if (BUILTIN_PROPERTIES.has(prop)) return { c: `L.property(${K}, ${lit(prop)})`, t: 'num' }
      const id = m.env.project.kinds[other].localVarNames.get(prop)
      const slot = id === undefined ? undefined : m.env.layout.kinds[other].vars.get(id)
      if (!slot) return k(0)
      // As in Scratch, the original sprite's value, not a clone's.
      return { c: `${K}.${slot.num ? 'num' : 'ref'}[${slot.index}][${K}.slot]`, t: slot.ty }
    }

    // operators
    case 'operator_add':
    case 'operator_subtract':
    case 'operator_multiply':
    case 'operator_divide': {
      const [a, b] = pair('NUM1', 'NUM2')
      const sym = { operator_add: '+', operator_subtract: '-', operator_multiply: '*', operator_divide: '/' }[e.op]
      const folded = fold([a, b], (x, y) => {
        const p = toNumber(x)
        const q = toNumber(y)
        return sym === '+' ? p + q : sym === '-' ? p - q : sym === '*' ? p * q : p / q
      })
      return folded ?? { c: `(${asNum(a)} ${sym} ${asNum(b)})`, t: 'num' }
    }
    case 'operator_mod': {
      const [a, b] = pair('NUM1', 'NUM2')
      return fold([a, b], (x, y) => mod(toNumber(x), toNumber(y))) ?? { c: `L.mod(${asNum(a)}, ${asNum(b)})`, t: 'num' }
    }
    case 'operator_round': {
      const a = e2('NUM')
      return fold([a], (x) => Math.round(toNumber(x))) ?? { c: `Math.round(${asNum(a)})`, t: 'num' }
    }
    case 'operator_mathop': {
      const a = e2('NUM')
      const op = e.f.OPERATOR
      const folded = fold([a], (x) => mathop(op, toNumber(x)))
      if (folded) return folded
      const direct: Record<string, string> = { abs: 'Math.abs', floor: 'Math.floor', ceiling: 'Math.ceil', sqrt: 'Math.sqrt', sin: 'L.sin', cos: 'L.cos' }
      return { c: direct[op] ? `${direct[op]}(${asNum(a)})` : `L.mathop(${lit(op)}, ${asNum(a)})`, t: 'num' }
    }
    case 'operator_random': {
      const [a, b] = pair('FROM', 'TO')
      const lo = num(a)
      const hi = num(b)
      if (lo !== undefined && hi !== undefined) {
        const [min, max] = lo <= hi ? [lo, hi] : [hi, lo]
        if (isWholeBound(a.k!) && isWholeBound(b.k!)) return { c: `(${lit(min)} + Math.floor(L.rnd() * ${lit(max - min + 1)}))`, t: 'num' }
        return { c: `(${lit(min)} + L.rnd() * ${lit(max - min)})`, t: 'num' }
      }
      return { c: `L.random(${a.c}, ${b.c})`, t: 'num' }
    }
    case 'operator_lt':
    case 'operator_gt':
    case 'operator_equals': {
      const [a, b] = pair('OPERAND1', 'OPERAND2')
      const sym = e.op === 'operator_lt' ? '<' : e.op === 'operator_gt' ? '>' : '==='
      const test = (c: number) => (sym === '<' ? c < 0 : sym === '>' ? c > 0 : c === 0)
      const folded = fold([a, b], (x, y) => test(compare(x, y)))
      if (folded) return folded
      if (a.t === 'num' && b.t === 'num') return { c: `(${a.c} ${sym} ${b.c})`, t: 'bool' }
      return { c: `(L.compare(${a.c}, ${b.c}) ${sym} 0)`, t: 'bool' }
    }
    case 'operator_and':
    case 'operator_or': {
      const [a, b] = pair('OPERAND1', 'OPERAND2')
      const and = e.op === 'operator_and'
      const folded = fold([a, b], (x, y) => (and ? toBoolean(x) && toBoolean(y) : toBoolean(x) || toBoolean(y)))
      return folded ?? { c: `(${asBool(a)} ${and ? '&&' : '||'} ${asBool(b)})`, t: 'bool' }
    }
    case 'operator_not': {
      const a = e2('OPERAND')
      return fold([a], (x) => !toBoolean(x)) ?? { c: `!${asBool(a)}`, t: 'bool' }
    }
    case 'operator_join': {
      const [a, b] = pair('STRING1', 'STRING2')
      return fold([a, b], (x, y) => toText(x) + toText(y)) ?? { c: `(${asStr(a)} + ${asStr(b)})`, t: 'str' }
    }
    case 'operator_letter_of': {
      const [a, b] = pair('LETTER', 'STRING')
      return fold([a, b], (x, y) => letterOf(toNumber(x), toText(y))) ?? { c: `L.letterOf(${asNum(a)}, ${asStr(b)})`, t: 'str' }
    }
    case 'operator_length': {
      const a = e2('STRING')
      return fold([a], (x) => toText(x).length) ?? { c: `${asStr(a)}.length`, t: 'num' }
    }
    case 'operator_contains': {
      const [a, b] = pair('STRING1', 'STRING2')
      return fold([a, b], (x, y) => contains(toText(x), toText(y))) ?? { c: `L.contains(${asStr(a)}, ${asStr(b)})`, t: 'bool' }
    }

    // custom block arguments: 0 / false outside a call
    case 'argument_reporter_string_number':
    case 'argument_reporter_boolean': {
      const i = ctx.proc ? ctx.proc.params.indexOf(e.f.VALUE) : -1
      const bool = e.op === 'argument_reporter_boolean'
      if (i < 0 || !ctx.params[i]) return k(bool ? false : 0)
      const p: V = { c: ctx.params[i].code, t: ctx.params[i].ty }
      return bool ? { c: asBool(p), t: 'bool' } : p
    }

    // variables and lists
    case 'data_variable':
      return varRef(e.f.VARIABLE, ctx, m)
    case 'data_listcontents':
      return { c: `L.listText(${listRef(e.f.LIST, ctx, m).c})`, t: 'str' }
    case 'data_itemoflist': {
      const l = listRef(e.f.LIST, ctx, m)
      return { c: `L.item(${l.c}, ${e2('INDEX').c})`, t: l.elem === 'str' ? 'str' : 'any' }
    }
    case 'data_itemnumoflist': {
      const l = listRef(e.f.LIST, ctx, m)
      const v = e2('ITEM')
      if (l.elem === 'num' && v.t === 'num') return { c: `(${l.c}.indexOf(${v.c}) + 1)`, t: 'num' }
      return { c: `L.itemNumber(${l.c}, ${v.c})`, t: 'num' }
    }
    case 'data_lengthoflist':
      return { c: `${listRef(e.f.LIST, ctx, m).c}.length`, t: 'num' }
    case 'data_listcontainsitem': {
      const l = listRef(e.f.LIST, ctx, m)
      const v = e2('ITEM')
      if (l.elem === 'num' && v.t === 'num') return { c: `${l.c}.includes(${v.c})`, t: 'bool' }
      return { c: `L.listContains(${l.c}, ${v.c})`, t: 'bool' }
    }
    default: {
      if (e.ext) {
        const B = m.const(e.ext, { t: 'block', block: e.ext })
        const call = `L.reporter(${B}, i, ${extArgs(e.ext, e, ctx, m)})`
        return e.ext.type === 'boolean' ? { c: `L.bool(${call})`, t: 'bool' } : { c: call, t: 'any' }
      }
      return k('')
    }
  }
}
