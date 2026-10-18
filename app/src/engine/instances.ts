/**
 * Run-time objects behind compiled code: kinds (an original sprite with its
 * clones), the instance columns of each compiled script, and frame pools for
 * custom blocks that can wait.
 */
import type { KindFacts } from './analyze'
import type { ScriptPlan } from './codegen'
import { KindGrid } from './collision'
import type { Hat, KindIR, ScriptIR } from './ir'
import type { Sprite } from './sprite'
import type { Value } from './types'

export type SystemFn = (list: Int32Array, n: number) => void

/** A suspended custom block call. */
export interface Frame {
  pc: number
  wake: number
  n: Float64Array
  o: unknown[]
}

/** Frames for one custom block, reused so calls don't produce garbage. */
export class FramePool {
  private readonly free: Frame[] = []

  constructor(
    readonly num: number,
    readonly obj: number,
  ) {}

  take(): Frame {
    const f = this.free.pop()
    if (f) {
      f.pc = 0
      f.wake = 0
      f.o.fill(null)
      return f
    }
    return { pc: 0, wake: 0, n: new Float64Array(this.num), o: new Array<unknown>(this.obj).fill(null) }
  }

  give(f: Frame): void {
    this.free.push(f)
  }
}

const NOT_RUNNING = -1
/** In the per-frame list. */
export const PER_FRAME = -2

/**
 * One compiled script and the state of its instances (at most one per
 * entity), in columns indexed by slot. Columns grow only between ticks, when
 * scripts are started.
 */
export class ScriptRun {
  sm: SystemFn = () => {}
  fv: SystemFn | null = null

  pc = new Int32Array(0)
  wake = new Float64Array(0)
  num: Float64Array[] = []
  obj: unknown[][] = []
  /** Counts starts per slot, so "broadcast and wait" can tell a restart from the run it waits for. */
  runId = new Int32Array(0)
  inSM = new Uint8Array(0)
  inF = new Uint8Array(0)
  /** Entities in the state machine part, in start order. */
  list = new Int32Array(0)
  n = 0
  /** Entities in the per-frame part. */
  flist = new Int32Array(0)
  fn = 0
  /** Set when an entity left the per-frame part, so the list needs compacting. */
  dirtyF = 0

  constructor(
    readonly kind: Kind,
    readonly plan: ScriptPlan,
  ) {}

  get topId(): string {
    return this.plan.ir.topId
  }

  get hat(): Hat | null {
    return this.plan.ir.hat
  }

  get active(): boolean {
    return this.n > 0 || this.fn > 0
  }

  isRunning(slot: number): boolean {
    return slot < this.pc.length && this.pc[slot] !== NOT_RUNNING
  }

  /** Makes room for `slot`. Only between ticks. */
  ensure(slot: number): void {
    if (slot < this.pc.length) return
    let size = Math.max(16, this.pc.length)
    while (size <= slot) size *= 2
    const grow = <T extends Int32Array | Float64Array | Uint8Array>(a: T, b: T, fill?: number): T => {
      b.set(a)
      if (fill !== undefined) b.fill(fill, a.length)
      return b
    }
    this.pc = grow(this.pc, new Int32Array(size), NOT_RUNNING)
    this.wake = grow(this.wake, new Float64Array(size))
    this.runId = grow(this.runId, new Int32Array(size))
    this.inSM = grow(this.inSM, new Uint8Array(size))
    this.inF = grow(this.inF, new Uint8Array(size))
    this.list = grow(this.list, new Int32Array(size))
    this.flist = grow(this.flist, new Int32Array(size))
    this.num = Array.from({ length: this.plan.numLocals }, (_, k) => grow(this.num[k] ?? new Float64Array(0), new Float64Array(size)))
    this.obj = Array.from({ length: this.plan.objLocals }, (_, k) => {
      const old = this.obj[k] ?? []
      const a = new Array<unknown>(size).fill(null)
      for (let i = 0; i < old.length; i++) a[i] = old[i]
      return a
    })
  }

  /** Starts (or restarts) the instance on `slot` from the top. Returns its run id. */
  start(slot: number): number {
    this.ensure(slot)
    if (this.pc[slot] === PER_FRAME) this.dirtyF = 1
    this.pc[slot] = 0
    this.wake[slot] = 0
    for (const o of this.obj) o[slot] = null
    if (!this.inSM[slot]) {
      this.inSM[slot] = 1
      this.list[this.n++] = slot
    }
    return ++this.runId[slot]
  }

  stop(slot: number): void {
    if (slot >= this.pc.length) return
    const pc = this.pc[slot]
    if (pc === NOT_RUNNING) return
    if (pc === PER_FRAME) this.dirtyF = 1
    this.pc[slot] = NOT_RUNNING
  }

  /** Drops entities that left the state machine part (stopped or moved to the per-frame part). */
  compact(): void {
    const { list, pc, inSM } = this
    let m = 0
    for (let k = 0; k < this.n; k++) {
      const s = list[k]
      if (pc[s] >= 0) list[m++] = s
      else inSM[s] = 0
    }
    this.n = m
  }

  compactPerFrame(): void {
    const { flist, pc, inF } = this
    let m = 0
    for (let k = 0; k < this.fn; k++) {
      const s = flist[k]
      if (pc[s] === PER_FRAME) flist[m++] = s
      else inF[s] = 0
    }
    this.fn = m
    this.dirtyF = 0
  }

  stopAll(): void {
    this.pc.fill(NOT_RUNNING)
    this.inSM.fill(0)
    this.inF.fill(0)
    this.n = 0
    this.fn = 0
    this.dirtyF = 0
    for (const o of this.obj) o.fill(null)
  }

  /** Takes over the instances of an older compile of the same script (same blocks and locals). */
  adopt(old: ScriptRun): void {
    this.pc = old.pc
    this.wake = old.wake
    this.num = old.num
    this.obj = old.obj
    this.runId = old.runId
    this.inSM = old.inSM
    this.inF = old.inF
    this.list = old.list
    this.n = old.n
    this.flist = old.flist
    this.fn = old.fn
    this.dirtyF = old.dirtyF
    old.n = 0
    old.fn = 0
    old.pc = new Int32Array(0)
  }

  /**
   * Moves the instances of an older compile of an edited script to this
   * code: each continues at the block it was waiting in, with the locals of
   * blocks that still exist. Instances waiting where this code has no
   * counterpart (the block was removed, or a custom block call is in
   * progress) stay with `old`. Returns whether any stayed. Only between ticks.
   */
  takeOver(old: ScriptRun): boolean {
    const resume = new Map<string, number>()
    this.plan.resume.forEach((key, pc) => key !== null && resume.set(key, pc))
    const target = (key: string | null): number => {
      if (key === null) return NOT_RUNNING
      if (key === this.plan.perFrameKey) return PER_FRAME
      return resume.get(key) ?? NOT_RUNNING
    }
    const owners = (from: (string | null)[], to: (string | null)[]) =>
      to.map((owner) => (owner === null ? -1 : from.indexOf(owner)))
    const numFrom = owners(old.plan.numOwners, this.plan.numOwners)
    const objFrom = owners(old.plan.objOwners, this.plan.objOwners)
    const perFrameKey = old.plan.perFrameKey
    let stayed = false
    const move = (slot: number): void => {
      const pc = old.pc[slot]
      const key = pc === PER_FRAME ? perFrameKey : old.plan.resume[pc] ?? null
      const to = target(key)
      if (to === NOT_RUNNING || this.isRunning(slot)) {
        stayed = true
        return
      }
      this.ensure(slot)
      this.pc[slot] = to
      this.wake[slot] = old.wake[slot]
      this.runId[slot] = old.runId[slot]
      numFrom.forEach((j, k) => (this.num[k][slot] = j >= 0 ? old.num[j][slot] : 0))
      objFrom.forEach((j, k) => (this.obj[k][slot] = j >= 0 ? old.obj[j][slot] : null))
      if (to === PER_FRAME) {
        if (!this.inF[slot]) {
          this.inF[slot] = 1
          this.flist[this.fn++] = slot
        }
      } else if (!this.inSM[slot]) {
        this.inSM[slot] = 1
        this.list[this.n++] = slot
      }
      old.stop(slot)
      for (const o of old.obj) o[slot] = null
    }
    for (let k = 0; k < old.n; k++) if (old.pc[old.list[k]] >= 0) move(old.list[k])
    for (let k = 0; k < old.fn; k++) if (old.pc[old.flist[k]] === PER_FRAME) move(old.flist[k])
    old.compact()
    old.compactPerFrame()
    return stayed
  }
}

/**
 * An original sprite and its clones: the unit that shares scripts and
 * "for this sprite only" variables (one column each).
 */
export class Kind {
  /** Entities of this kind (the original and its clones), densely packed. */
  members = new Int32Array(16)
  count = 0
  /** Own variables in columns indexed by slot, per the layout. */
  num: Float64Array[] = []
  ref: Value[][] = []
  lists: Value[][][] = []
  readonly grid = new KindGrid()

  /** Parsed blocks; null when the blocks changed since. */
  ir: KindIR | null = null
  facts: KindFacts | null = null
  /** Compiled scripts with hats, in workspace order. */
  scripts: ScriptRun[] = []
  /** Stacks run by clicking them, by top block id. */
  readonly adhoc = new Map<string, { ir: ScriptIR; run: ScriptRun | null }>()
  /** Older compiles still running their instances to the end. */
  retired: ScriptRun[] = []
  /** Everything above, in run order; rebuilt after compiling. */
  runs: ScriptRun[] = []
  /** Which scripts were running on the original at the last check, by top block id. */
  readonly glow = new Map<string, boolean>()

  constructor(
    public index: number,
    readonly sprite: Sprite,
  ) {}

  /** The original's slot. */
  get slot(): number {
    return this.sprite.slot
  }

  addMember(slot: number, pos: Int32Array): void {
    if (this.count === this.members.length) {
      const m = new Int32Array(this.members.length * 2)
      m.set(this.members)
      this.members = m
    }
    pos[slot] = this.count
    this.members[this.count++] = slot
  }

  /** Swaps the last member into the gap. */
  removeMember(slot: number, pos: Int32Array): void {
    const at = pos[slot]
    if (at < 0 || this.members[at] !== slot) return
    const last = this.members[--this.count]
    this.members[at] = last
    pos[last] = at
    pos[slot] = -1
  }

  rebuildRuns(): void {
    const adhoc = [...this.adhoc.values()].map((a) => a.run).filter((r): r is ScriptRun => r !== null)
    this.runs = [...this.scripts, ...adhoc, ...this.retired]
  }

  /** Every compiled script with this top block (current, clicked and retired). */
  runsFor(topId: string): ScriptRun[] {
    return this.runs.filter((r) => r.topId === topId)
  }
}
