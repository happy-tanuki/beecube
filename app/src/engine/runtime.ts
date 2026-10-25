/**
 * The runtime: entities in an EntityStore, scripts compiled per kind (an
 * original sprite and its clones), and a fixed 60 Hz tick:
 *
 *   1. save the pose (for interpolation)
 *   2. start "when I start as a clone" for clones created last tick
 *   3. process events (green flag, keys, messages, clicks → start scripts)
 *   4. run scripts: kind order → script order → entity order
 *   5. extensions step (physics); their events start scripts next tick
 *   6. remove clones deleted during the tick
 *
 * See docs/vm-design.md.
 */
import { inferLayout, KindFacts, join, typeOfValue, type KindLayout, type Layout, type ProjectInput, type Ty } from './analyze'
import { availableBackdropName, Backdrops } from './backdrop'
import { Camera } from './camera'
import { generateKind, type ModulePlan } from './codegen'
import type { ExtensionSpec } from './extension'
import { FramePool, Kind, ScriptRun, type SystemFn } from './instances'
import { parseClicked, parseWorkspace, registerExtensionBlocks, type ScriptIR } from './ir'
import { makeLib, type Lib } from './lib'
import { clampDimension, clampPenSize, clampPercent, colorToInt, toNumber, wrapDirection } from './ops'
import { PenBuffer } from './pen'
import { Random } from './random'
import { EntityRef } from './ref'
import { availableSpriteName, BACKDROP_MENUS, renameSpriteReferences } from './rename'
import { EntityView, Sprite } from './sprite'
import { EntityStore, F_ALIVE, F_CLONE, F_DYING, F_PEN, F_VISIBLE } from './store'
import { TouchWatcher } from './touch'
import { DEFAULT_CLONE_LIMIT, EDGE, MYSELF, SHAPES, STAGE_ID, TICKS_PER_SECOND, type BlockJson, type LocalList, type LocalVariable, type SpriteData, type Value, type VariableDef } from './types'

export { DEFAULT_CLONE_LIMIT, EDGE, MOUSE, MYSELF } from './types'
export { wrapDirection }

export const TICK_MS = 1000 / TICKS_PER_SECOND
/** Ticks run at most per animation frame, so a slow frame doesn't snowball. */
const MAX_CATCH_UP = 4

export interface RuntimeSettings {
  /** Most clones alive at once. */
  cloneLimit: number
  /** Seed for "pick random" on each green flag; null for a different run each time. */
  randomSeed: number | null
}

/** "Broadcast and wait": the receivers it started, as (script, slot, run id) triples. */
export interface WaitRecord {
  started: boolean
  runs: ScriptRun[]
  slots: number[]
  ids: number[]
}

type QueuedEvent =
  | { t: 'flag' }
  | { t: 'hats'; key: string; restart: boolean; slot: number; fields?: Record<string, string>; wait?: WaitRecord }
  | { t: 'run'; kind: Kind; top: BlockJson }
  /** A "when I touch" script to start on the entity `handle`, which touched `other`. */
  | { t: 'touch'; run: ScriptRun; handle: number; other: EntityRef | null }

type ScriptListener = (spriteId: string, topBlockId: string, running: boolean) => void

export class Runtime {
  readonly store = new EntityStore(0)
  /** The sprites' kinds, then the stage's, always last. */
  kinds: Kind[] = []
  /** The stage: scripts run on one entity that is never drawn and never touches anything. */
  private stageKind!: Kind
  /** Each slot's position in its kind's member list. */
  private memberPos = new Int32Array(0)

  private _variableDefs: VariableDef[] = []
  private _listDefs: VariableDef[] = []
  /** Broadcast messages, as Blockly variables of type `broadcast_msg`. */
  private _broadcastDefs: VariableDef[] = []

  /** Global variables: numbers, and everything else. Replaced when the layout changes. */
  G = new Float64Array(0)
  R: Value[] = []
  /** Global lists. */
  LS: Value[][] = []
  private layout: Layout | null = null
  /** The kinds, in the order `layout` was made for. */
  private laidOut: Kind[] = []
  /** Values set for globals the layout doesn't have yet. */
  private pending = new Map<string, Value>()
  private pendingLists = new Map<string, Value[]>()
  private compileNeeded = true

  /** The current tick; logical time is tick / 60 seconds. */
  tick = 0
  private timerStart = 0
  readonly random = new Random(1)
  readonly settings: RuntimeSettings = { cloneLimit: DEFAULT_CLONE_LIMIT, randomSeed: null }

  readonly pen = new PenBuffer()
  readonly camera = new Camera()
  readonly backdrops = new Backdrops()
  readonly keysDown = new Set<string>()
  /** Mouse position projected onto the workplane (z = 0). */
  readonly mouse = { x: 0, y: 0, down: false }
  readonly extensions = new Map<string, ExtensionSpec>()
  /**
   * Values shown on the stage. Keys: `var:<variable id>`, `list:<list id>`, `<opcode>:<sprite id>`
   * for a sprite's reporter (e.g. `motion_xposition:sprite-1`), or `<opcode>`
   * for global reporters (e.g. `sensing_timer`).
   */
  readonly monitors = new Set<string>()
  private monitorListeners = new Set<() => void>()
  private scriptListeners = new Set<ScriptListener>()
  private readonly glowScratch = new Set<string>()

  /** Set by "stop all"; the tick stops running scripts and everything is stopped after. */
  halted = false
  /** The script whose code is running (for "stop other scripts in sprite"). */
  currentScript: ScriptRun | null = null
  private inTick = false
  /** Milliseconds per tick, smoothed (for the performance display). */
  tickMs = 0

  private queue: QueuedEvent[] = []
  private spareQueue: QueuedEvent[] = []
  /** Clones created this tick, whose "when I start as a clone" runs next tick. */
  private cloneStarts = new Int32Array(64)
  private cloneStartCount = 0
  private dying = new Int32Array(64)
  private dyingCount = 0
  cloneCount = 0

  private hatIndex = new Map<string, { run: ScriptRun; fields?: Record<string, string> }[]>()
  private readonly touches = new TouchWatcher()
  /** Per slot: what the entity last touched to start a "when I touch" script ("touched sprite"). */
  touchedRef: (EntityRef | null)[] = []
  /** Per slot: the reference handed out for the entity, reused while it lives under the same name. */
  private refs: (EntityRef | null)[] = []
  private readonly lib: Lib
  private frameId: number | null = null
  private intervalId: ReturnType<typeof setInterval> | null = null
  /** Wall-clock time (ms) the ticks run so far correspond to. */
  private clock: number | null = null

  constructor(settings: Partial<RuntimeSettings> = {}) {
    Object.assign(this.settings, settings)
    this.lib = makeLib(this)
    this.reserve(1)
    this.addStage()
  }

  // ---- lifecycle -------------------------------------------------------

  /** Runs ticks in real time (animation frames in a browser). */
  start(): void {
    if (this.frameId !== null || this.intervalId !== null) return
    if (typeof requestAnimationFrame === 'function') {
      const loop = (now: number) => {
        this.frameId = requestAnimationFrame(loop)
        this.advance(now)
      }
      this.frameId = requestAnimationFrame(loop)
    } else {
      this.intervalId = setInterval(() => this.advance(performance.now()), TICK_MS)
    }
  }

  dispose(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    if (this.intervalId !== null) clearInterval(this.intervalId)
    this.frameId = null
    this.intervalId = null
  }

  /** Runs the ticks due by wall-clock time `now` (ms). */
  advance(now: number): void {
    if (this.clock === null) this.clock = now - TICK_MS
    let n = Math.floor((now - this.clock) / TICK_MS)
    if (n > MAX_CATCH_UP) {
      // Too far behind (a slow frame or a hidden tab): drop the backlog.
      this.clock = now - MAX_CATCH_UP * TICK_MS
      n = MAX_CATCH_UP
    }
    for (let i = 0; i < n; i++) {
      this.step()
      this.clock += TICK_MS
    }
  }

  /** How far (0–1) wall-clock time `now` is past the last tick, for interpolating poses. */
  alpha(now: number): number {
    if (this.clock === null) return 1
    return Math.max(0, Math.min(1, (now - this.clock) / TICK_MS))
  }

  // ---- extensions ------------------------------------------------------

  addExtension(ext: ExtensionSpec): void {
    if (this.extensions.has(ext.id)) return
    registerExtensionBlocks(ext)
    this.extensions.set(ext.id, ext)
    this.everythingChanged()
    ext.install?.(this)
  }

  removeExtension(id: string): void {
    const ext = this.extensions.get(id)
    if (!ext) return
    this.extensions.delete(id)
    ext.uninstall?.(this)
  }

  // ---- sprites ----------------------------------------------------------

  /** The original sprites, in order (not the stage). */
  get sprites(): Sprite[] {
    return this.kinds.slice(0, -1).map((k) => k.sprite)
  }

  get stage(): Sprite {
    return this.stageKind.sprite
  }

  isStage(kind: Kind): boolean {
    return kind === this.stageKind
  }

  getSprite(id: string): Sprite | undefined {
    return this.sprites.find((s) => s.id === id)
  }

  /** A sprite's kind index by name; -1 for none (the stage has no name). */
  kindByName(name: string): number {
    return this.kinds.findIndex((k) => k !== this.stageKind && k.sprite.name === name)
  }

  private addStage(): void {
    const s = this.store
    const slot = s.alloc()
    s.size[slot] = s.width[slot] = s.depth[slot] = s.height[slot] = 100
    s.snapPose(slot)
    s.flags[slot] = F_ALIVE
    const kind = new Kind(this.kinds.length, new Sprite(this, slot, STAGE_ID, '', null))
    s.kind[slot] = kind.index
    kind.addMember(slot, this.memberPos)
    this.kinds.push(kind)
    this.localDefs.set(kind, { vars: new Map(), lists: new Map() })
    this.stageKind = kind
  }

  /** Adds an original sprite (before the stage's kind). Between ticks only (from the editor). */
  addSprite(data: SpriteData): Sprite {
    this.reserve(this.kinds.length + 1)
    const s = this.store
    const slot = s.alloc()
    s.x[slot] = data.x
    s.y[slot] = data.y
    s.z[slot] = data.z
    s.direction[slot] = data.direction
    s.pitch[slot] = data.pitch
    s.roll[slot] = data.roll
    s.size[slot] = data.size
    s.width[slot] = clampDimension(data.width ?? 100)
    s.depth[slot] = clampDimension(data.depth ?? 100)
    s.height[slot] = clampDimension(data.height ?? 100)
    s.snapPose(slot)
    s.color[slot] = colorToInt(data.color)
    s.penHue[slot] = 0
    s.setPenRgb(slot, colorToInt(data.pen.color))
    s.penTransparency[slot] = clampPercent(data.pen.transparency ?? 0)
    s.penSize[slot] = clampPenSize(data.pen.size ?? 1)
    s.shape[slot] = Math.max(0, SHAPES.indexOf(data.shape))
    s.flags[slot] = F_ALIVE | (data.visible ? F_VISIBLE : 0) | (data.pen.down ? F_PEN : 0)
    const sprite = new Sprite(this, slot, data.id, data.name, structuredClone(data.blocks))
    const kind = new Kind(this.kinds.length - 1, sprite)
    s.kind[slot] = kind.index
    kind.addMember(slot, this.memberPos)
    this.kinds.splice(kind.index, 0, kind)
    this.reindexKinds()
    this.localDefs.set(kind, {
      vars: new Map(Object.entries(data.variables).map(([id, v]) => [id, { name: v.name, value: v.value }])),
      lists: new Map(Object.entries(data.lists).map(([id, l]) => [id, { name: l.name, items: [...l.items] }])),
    })
    this.everythingChanged()
    this.notifyExtensions()
    return sprite
  }

  /** Removes an original sprite with its clones and scripts. */
  removeSprite(id: string): void {
    const index = this.kinds.findIndex((k) => k !== this.stageKind && k.sprite.id === id)
    if (index < 0) return
    const kind = this.kinds[index]
    for (const run of kind.runs) run.stopAll()
    const s = this.store
    for (let k = kind.count - 1; k >= 0; k--) {
      const slot = kind.members[k]
      if (s.flags[slot] & F_CLONE) this.cloneCount--
      s.release(slot)
    }
    this.kinds.splice(index, 1)
    this.localDefs.delete(kind)
    this.reindexKinds()
    s.compact()
    this.everythingChanged()
    this.emitScriptChanges()
    this.notifyExtensions()
  }

  private reindexKinds(): void {
    const s = this.store
    this.kinds.forEach((k, i) => {
      k.index = i
      for (let m = 0; m < k.count; m++) s.kind[k.members[m]] = i
    })
  }

  /** Replaces every sprite and empties the stage's scripts (loading a project). Stops everything first. */
  setSprites(sprites: SpriteData[]): void {
    this.stopAll()
    this.kinds = []
    this.localDefs.clear()
    this.hatIndex.clear()
    const s = this.store
    for (let slot = 0; slot < s.highWater; slot++) s.release(slot)
    s.compact()
    this.cloneCount = 0
    this.addStage()
    for (const d of sprites) this.addSprite(d)
    this.everythingChanged()
  }

  /** Sprite names, message names and kind indices are compiled into code: parse and compile everything again. */
  private everythingChanged(): void {
    for (const k of this.kinds) k.ir = null
    this.compileNeeded = true
  }

  /**
   * Renames an original sprite (and its clones) and updates the blocks that
   * refer to it. Returns the name it got (see availableSpriteName), or null
   * if `wanted` can't be used and nothing changed.
   */
  renameSprite(sprite: Sprite, wanted: string): string | null {
    const from = sprite.name
    const name = availableSpriteName(wanted, this.sprites.filter((s) => s !== sprite).map((s) => s.name))
    if (name === null || name === from) return null
    sprite.name = name
    for (const s of [...this.sprites, this.stage]) {
      if (renameSpriteReferences(s.blocks, from, name)) s.blocks = s.blocks
    }
    this.everythingChanged()
    return name
  }

  /**
   * Renames a backdrop and updates the blocks that refer to it. Returns the
   * name it got (see availableBackdropName), or null if nothing changed.
   */
  renameBackdrop(index: number, wanted: string): string | null {
    const backdrop = this.backdrops.list[index]
    const from = backdrop.name
    const name = availableBackdropName(wanted, this.backdrops.list.filter((b) => b !== backdrop).map((b) => b.name))
    if (name === null || name === from) return null
    backdrop.name = name
    for (const s of [...this.sprites, this.stage]) {
      if (renameSpriteReferences(s.blocks, from, name, BACKDROP_MENUS)) s.blocks = s.blocks
    }
    this.backdrops.changed()
    this.everythingChanged()
    return name
  }

  /** Every live entity (originals and clones, not the stage), in slot order. Allocates; for tools and tests. */
  entities(): EntityView[] {
    const out: EntityView[] = []
    const s = this.store
    for (let slot = 0; slot < s.highWater; slot++) {
      if (!(s.flags[slot] & F_ALIVE)) continue
      const kind = this.kinds[s.kind[slot]]
      if (kind === this.stageKind) continue
      out.push(kind && kind.slot === slot ? kind.sprite : new EntityView(this, slot))
    }
    return out
  }

  clonesOf(sprite: Sprite): EntityView[] {
    return this.entities().filter((e) => e.isClone && e.original === sprite)
  }

  /** The entity at `slot`, or null. */
  entity(slot: number): EntityView | null {
    if (!this.store.isAlive(slot)) return null
    const kind = this.kinds[this.store.kind[slot]]
    return kind.slot === slot ? kind.sprite : new EntityView(this, slot)
  }

  /** Called when an entity was moved or reshaped outside scripts. */
  posesChanged(slot = -1): void {
    if (slot >= 0) {
      const k = this.kinds[this.store.kind[slot]]
      if (k) k.grid.stale = true
      return
    }
    for (const k of this.kinds) k.grid.stale = true
  }

  /** Moves an entity, drawing with its pen (for extensions and tests). */
  moveTo(e: EntityView | number, x: number, y: number, z: number): void {
    const i = typeof e === 'number' ? e : e.slot
    const s = this.store
    if (s.flags[i] & F_PEN) this.pen.lineFrom(s, i, x, y, z)
    s.x[i] = x
    s.y[i] = y
    s.z[i] = z
    this.posesChanged(i)
  }

  /** Keeps capacity for the originals plus the clone limit. Between ticks only. */
  private reserve(originals: number): void {
    const want = originals + this.settings.cloneLimit + 1
    if (this.store.capacity >= want) return
    const capacity = Math.max(want, Math.ceil(this.store.capacity * 1.5))
    this.store.resize(capacity)
    const pos = new Int32Array(capacity).fill(-1)
    pos.set(this.memberPos)
    this.memberPos = pos
    if (this.layout) this.allocateKindStorage(this.layout, this.laidOut)
    const grow = (a: Int32Array) => {
      const b = new Int32Array(capacity)
      b.set(a.subarray(0, Math.min(a.length, capacity)))
      return b
    }
    this.cloneStarts = grow(this.cloneStarts)
    this.dying = grow(this.dying)
    for (const a of [this.touchedRef, this.refs]) {
      const n = a.length
      a.length = capacity
      a.fill(null, n)
    }
  }

  /** A sprite reference to the entity at `slot`. */
  refOf(slot: number): EntityRef {
    const handle = this.store.handle(slot)
    const name = this.kinds[this.store.kind[slot]].sprite.name
    const cached = this.refs[slot]
    if (cached && cached.handle === handle && cached.name === name) return cached
    return (this.refs[slot] = new EntityRef(handle, name))
  }

  /** Changes the clone limit. Between ticks only. */
  setCloneLimit(limit: number): void {
    this.settings.cloneLimit = Math.max(0, Math.floor(limit))
    this.reserve(this.kinds.length)
  }

  // ---- variables -------------------------------------------------------

  /** Own variable and list definitions per kind (values live in the kind's columns once laid out). */
  private localDefs = new Map<Kind, { vars: Map<string, { name: string; value: Value }>; lists: Map<string, { name: string; items: Value[] }> }>()

  get variableDefs(): VariableDef[] {
    return this._variableDefs
  }

  set variableDefs(defs: VariableDef[]) {
    this._variableDefs = defs
    this.relayoutNeeded()
  }

  get listDefs(): VariableDef[] {
    return this._listDefs
  }

  set listDefs(defs: VariableDef[]) {
    this._listDefs = defs
    this.relayoutNeeded()
  }

  get broadcastDefs(): VariableDef[] {
    return this._broadcastDefs
  }

  set broadcastDefs(defs: VariableDef[]) {
    this._broadcastDefs = defs
    this.everythingChanged()
  }

  /** The message name for a broadcast variable id; unknown ids are treated as names. */
  broadcastName(id: string): string {
    return this._broadcastDefs.find((d) => d.id === id)?.name ?? id
  }

  private relayoutNeeded(): void {
    this.compileNeeded = true
  }

  /** Lays out storage now if needed and possible (never in the middle of a tick). */
  private ensureLayout(): void {
    if (!this.inTick && this.compileNeeded) this.compile()
  }

  getVariable(id: string): Value {
    this.ensureLayout()
    const slot = this.layout?.globals.get(id)
    if (!slot) return this.pending.get(id) ?? 0
    return slot.num ? this.G[slot.index] : this.R[slot.index]
  }

  setVariable(id: string, value: Value): void {
    const slot = this.layout?.globals.get(id)
    if (!slot || this.pending.has(id) || (slot.num ? typeof value !== 'number' : slot.ty !== 'any' && slot.ty !== typeOfValue(value))) {
      // Not laid out yet, or the value doesn't fit the type: keep it until the next layout.
      this.pending.set(id, value)
      this.compileNeeded = true
      return
    }
    if (slot.num) this.G[slot.index] = value as number
    else this.R[slot.index] = value
  }

  /** The list's items, which callers may change in place. */
  getList(id: string): Value[] {
    this.ensureLayout()
    const slot = this.layout?.lists.get(id)
    if (slot) return this.LS[slot.index]
    let items = this.pendingLists.get(id)
    if (!items) {
      items = []
      this.pendingLists.set(id, items)
      this.compileNeeded = true
    }
    return items
  }

  /** Replaces a list's items. */
  setList(id: string, items: Value[]): void {
    const list = this.getList(id)
    list.length = 0
    list.push(...items)
    // Item types may have changed.
    this.compileNeeded = true
  }

  localVariables(sprite: Sprite): Record<string, LocalVariable> {
    const kind = this.kindOf(sprite)
    const defs = this.localDefs.get(kind)
    if (!defs) return {}
    this.ensureLayout()
    const out: Record<string, LocalVariable> = {}
    const kl = this.layout?.kinds[kind.index]
    for (const [id, d] of defs.vars) {
      const slot = kl?.vars.get(id)
      const value = slot ? (slot.num ? kind.num[slot.index][kind.slot] : kind.ref[slot.index][kind.slot]) : d.value
      out[id] = { name: d.name, value }
    }
    return out
  }

  setLocalVariables(sprite: Sprite, vars: Record<string, LocalVariable>): void {
    const defs = this.localDefs.get(this.kindOf(sprite))!
    // Variables that already exist keep their values; new ones start with the given value.
    defs.vars = new Map(Object.entries(vars).map(([id, v]) => [id, { name: v.name, value: v.value }]))
    this.relayoutNeeded()
  }

  localLists(sprite: Sprite): Record<string, LocalList> {
    const kind = this.kindOf(sprite)
    const defs = this.localDefs.get(kind)
    if (!defs) return {}
    this.ensureLayout()
    const out: Record<string, LocalList> = {}
    const kl = this.layout?.kinds[kind.index]
    for (const [id, d] of defs.lists) {
      const slot = kl?.lists.get(id)
      out[id] = { name: d.name, items: slot ? kind.lists[slot.index][kind.slot] : d.items }
    }
    return out
  }

  setLocalLists(sprite: Sprite, lists: Record<string, LocalList>): void {
    const defs = this.localDefs.get(this.kindOf(sprite))!
    // Lists that already exist keep their items; new ones start with the given items.
    defs.lists = new Map(Object.entries(lists).map(([id, l]) => [id, { name: l.name, items: [...l.items] }]))
    this.relayoutNeeded()
  }

  /** An entity's own variable (for tools and tests). */
  variableOf(e: EntityView, id: string): Value {
    this.ensureLayout()
    const kind = this.kinds[this.store.kind[e.slot]]
    const slot = this.layout?.kinds[kind.index].vars.get(id)
    if (!slot) return 0
    return slot.num ? kind.num[slot.index][e.slot] : kind.ref[slot.index][e.slot]
  }

  /** An entity's own list (for tools and tests). */
  listOf(e: EntityView, id: string): Value[] {
    this.ensureLayout()
    const kind = this.kinds[this.store.kind[e.slot]]
    const slot = this.layout?.kinds[kind.index].lists.get(id)
    return slot ? kind.lists[slot.index][e.slot] : []
  }

  private kindOf(sprite: Sprite): Kind {
    const kind = this.kinds[this.store.kind[sprite.slot]]
    if (!kind || kind.sprite !== sprite) throw new Error(`Runtime: sprite ${sprite.id} is not in this runtime`)
    return kind
  }

  // ---- compiling --------------------------------------------------------

  /** Marks a sprite's scripts for compiling before scripts next start. */
  blocksChanged(sprite: Sprite): void {
    const kind = this.kinds.find((k) => k.sprite === sprite)
    if (!kind) return
    kind.ir = null
    this.compileNeeded = true
  }

  /** Compiles now if anything changed (normally done at the start of a tick). */
  compileAll(): void {
    if (!this.inTick) this.compile()
  }

  /**
   * Parses changed kinds, infers types, lays out storage (moving values if
   * it changed) and generates code. Running instances move to the new code
   * when their script did not change.
   */
  private compile(): void {
    this.compileNeeded = false
    const changed = new Set<Kind>()
    for (const kind of this.kinds) {
      if (kind.ir) continue
      kind.ir = parseWorkspace(kind.sprite.blocks, kind === this.stageKind)
      kind.facts = new KindFacts(kind.ir)
      changed.add(kind)
    }
    // Clicked stacks that finished no longer count.
    for (const kind of this.kinds) {
      for (const [top, a] of kind.adhoc) if (a.run && !a.run.active) kind.adhoc.delete(top)
    }
    const input = this.projectInput()
    const layout = inferLayout(input)
    // New sprites (another project opened) have no columns yet, even when the signature matches.
    const sameKinds = this.laidOut.length === this.kinds.length && this.laidOut.every((k, i) => k === this.kinds[i])
    const relayout = !this.layout || this.layout.signature !== layout.signature || !sameKinds
    if (relayout) {
      this.migrate(layout)
      this.layout = layout
      this.laidOut = [...this.kinds]
    }
    const kinds = relayout ? this.kinds : [...changed]
    for (const kind of kinds) this.generate(kind, input, layout, relayout)
    if (!relayout && changed.size === 0) {
      // Only clicked stacks may need code.
      for (const kind of this.kinds) if ([...kind.adhoc.values()].some((a) => !a.run)) this.generate(kind, input, layout, false)
    }
    this.buildHatIndex()
  }

  private projectInput(): ProjectInput {
    const globals = new Map<string, Ty | undefined>()
    for (const d of this._variableDefs) globals.set(d.id, typeOfValue(this.readGlobal(d.id)))
    const lists = new Map<string, Ty | undefined>()
    for (const d of this._listDefs) lists.set(d.id, itemsType(this.readList(d.id)))
    return {
      globals,
      lists,
      kindByName: (name) => this.kindByName(name),
      kinds: this.kinds.map((kind) => {
        const defs = this.localDefs.get(kind)!
        const localVars = new Map<string, Ty | undefined>()
        const localVarNames = new Map<string, string>()
        for (const [id, d] of defs.vars) {
          let ty: Ty | undefined = typeOfValue(d.value)
          const slot = this.oldKindLayout(kind)?.vars.get(id)
          if (slot) {
            ty = undefined
            for (let k = 0; k < kind.count; k++) {
              const e = kind.members[k]
              ty = join(ty, typeOfValue(slot.num ? kind.num[slot.index][e] : kind.ref[slot.index][e]))
            }
          }
          localVars.set(id, ty)
          if (!localVarNames.has(d.name)) localVarNames.set(d.name, id)
        }
        const localLists = new Map<string, Ty | undefined>()
        for (const [id, d] of defs.lists) {
          let ty = itemsType(d.items)
          const slot = this.oldKindLayout(kind)?.lists.get(id)
          if (slot) {
            ty = undefined
            for (let k = 0; k < kind.count; k++) ty = join(ty, itemsType(kind.lists[slot.index][kind.members[k]] ?? []))
          }
          localLists.set(id, ty)
        }
        return { ir: kind.ir!, facts: kind.facts!, adhoc: [...kind.adhoc.values()].map((a) => a.ir), localVars, localVarNames, localLists }
      }),
    }
  }

  /** The layout a kind's columns were last laid out with. */
  private oldKindLayout(kind: Kind): KindLayout | undefined {
    const i = this.laidOut.indexOf(kind)
    return i >= 0 ? this.layout?.kinds[i] : undefined
  }

  private readGlobal(id: string): Value {
    const p = this.pending.get(id)
    if (p !== undefined) return p
    const slot = this.layout?.globals.get(id)
    if (slot) return slot.num ? this.G[slot.index] : this.R[slot.index]
    return 0
  }

  private readList(id: string): Value[] {
    const p = this.pendingLists.get(id)
    if (p) return p
    const slot = this.layout?.lists.get(id)
    return slot ? this.LS[slot.index] : []
  }

  /** Moves every value from the old layout's storage into the new one's. */
  private migrate(layout: Layout): void {
    const G = new Float64Array(layout.numGlobals)
    const R = new Array<Value>(layout.refGlobals).fill(0)
    for (const [id, slot] of layout.globals) {
      const v = this.readGlobal(id)
      if (slot.num) G[slot.index] = typeof v === 'number' ? v : toNumber(v)
      else R[slot.index] = v
    }
    const LS: Value[][] = []
    for (const [id, slot] of layout.lists) LS[slot.index] = this.readList(id)
    this.G = G
    this.R = R
    this.LS = LS
    this.pending.clear()
    this.pendingLists.clear()
    this.allocateKindStorage(layout, this.kinds)
  }

  /** (Re)creates every kind's own-variable columns at store capacity, keeping values. */
  private allocateKindStorage(layout: Layout, kinds: Kind[]): void {
    const cap = this.store.capacity
    kinds.forEach((kind, k) => {
      const kl = layout.kinds[k]
      const ol = this.oldKindLayout(kind)
      const defs = this.localDefs.get(kind)!
      const num = Array.from({ length: kl.numCount }, () => new Float64Array(cap))
      const ref = Array.from({ length: kl.refCount }, () => new Array<Value>(cap).fill(0))
      const lists = Array.from({ length: kl.lists.size }, () => new Array<Value[]>(cap))
      for (const [id, slot] of kl.vars) {
        const prev = ol?.vars.get(id)
        for (let m = 0; m < kind.count; m++) {
          const e = kind.members[m]
          let v: Value = defs.vars.get(id)?.value ?? 0
          if (prev) v = prev.num ? kind.num[prev.index][e] : kind.ref[prev.index][e]
          if (slot.num) num[slot.index][e] = typeof v === 'number' ? v : toNumber(v)
          else ref[slot.index][e] = v
        }
      }
      for (const [id, slot] of kl.lists) {
        const prev = ol?.lists.get(id)
        for (let m = 0; m < kind.count; m++) {
          const e = kind.members[m]
          lists[slot.index][e] = prev ? kind.lists[prev.index][e] : e === kind.slot ? [...(defs.lists.get(id)?.items ?? [])] : []
        }
      }
      kind.num = num
      kind.ref = ref
      kind.lists = lists
    })
  }

  private generate(kind: Kind, input: ProjectInput, layout: Layout, relayout: boolean): void {
    for (const a of kind.adhoc.values()) a.run = null
    const scripts: ScriptIR[] = [...kind.ir!.scripts, ...[...kind.adhoc.values()].map((a) => a.ir)]
    let plan: ModulePlan
    try {
      plan = generateKind(
        { project: input, layout, kind: kind.index, facts: kind.facts!, messageName: (id) => this.broadcastName(id) },
        scripts,
      )
    } catch (err) {
      console.error(`Runtime: compiling sprite "${kind.sprite.name}" failed`, err)
      plan = { source: 'return { sm: [], fv: [] };', consts: [], scripts: [] }
    }
    const runs = plan.scripts.map((p) => new ScriptRun(kind, p))
    const consts = plan.consts.map((c) => {
      switch (c.t) {
        case 'script': return runs[c.index]
        case 'kind': return this.kinds[c.index]
        case 'block': return c.block
        case 'pool': return new FramePool(c.num, c.obj)
      }
    })
    let fns: { sm: SystemFn[]; fv: (SystemFn | null)[] }
    try {
      fns = new Function('E', 'rt', 'L', 'C', plan.source)(this.store, this, this.lib, consts) as typeof fns
    } catch (err) {
      console.error(`Runtime: generated code for sprite "${kind.sprite.name}" does not load`, err)
      fns = { sm: [], fv: [] }
    }
    runs.forEach((r, i) => {
      r.sm = fns.sm[i] ?? (() => {})
      r.fv = fns.fv[i] ?? null
    })

    // Running instances: move to identical new scripts, or to the same blocks in the edited
    // script (4.6). Those that cannot move keep running the old code to the end, unless
    // storage moved under it.
    const previous = kind.runs.filter((r) => r.active)
    const edited: ScriptRun[] = []
    for (const old of previous) {
      const same = runs.find((r) => r.topId === old.topId && r.plan.structure === old.plan.structure && !r.active)
      if (same) same.adopt(old)
      else edited.push(old)
    }
    const retired: ScriptRun[] = []
    for (const old of edited) {
      const next = runs.find((r) => r.topId === old.topId && (r.hat === null) === (old.hat === null))
      if (next && !next.takeOver(old)) continue
      if (relayout) old.stopAll()
      else retired.push(old)
    }
    const hatCount = kind.ir!.scripts.length
    kind.scripts = runs.slice(0, hatCount)
    const adhoc = [...kind.adhoc.values()]
    adhoc.forEach((a, i) => (a.run = runs[hatCount + i]))
    kind.retired = retired
    kind.rebuildRuns()
  }

  private buildHatIndex(): void {
    const index = new Map<string, { run: ScriptRun; fields?: Record<string, string> }[]>()
    const add = (key: string, run: ScriptRun, fields?: Record<string, string>) => {
      let list = index.get(key)
      if (!list) index.set(key, (list = []))
      list.push({ run, fields })
    }
    const touches: { run: ScriptRun; target: Kind | 'edge' }[] = []
    for (const kind of this.kinds) {
      for (const run of kind.scripts) {
        const hat = run.hat
        if (!hat) continue
        switch (hat.kind) {
          case 'touch': {
            const k = hat.target === MYSELF ? kind.index : this.kindByName(hat.target)
            if (hat.target === EDGE) touches.push({ run, target: 'edge' })
            else if (k >= 0) touches.push({ run, target: this.kinds[k] })
            break
          }
          case 'flag': add('flag', run); break
          case 'key': add(`key:${hat.key}`, run); break
          case 'click': add('click', run); break
          case 'message': add(`msg:${this.broadcastName(hat.id).toLowerCase()}`, run); break
          case 'clone': add('clone', run); break
          case 'backdrop': add('backdrop', run, { BACKDROP: hat.name }); break
          case 'stageclick': add('stageclick', run); break
          case 'extension': add(`ext:${hat.opcode}`, run, hat.fields); break
        }
      }
    }
    this.hatIndex = index
    this.touches.setWatches(touches)
  }

  // ---- events ------------------------------------------------------------

  greenFlag(): void {
    this.queue.push({ t: 'flag' })
  }

  keyPressed(key: string): void {
    this.keysDown.add(key)
    this.queue.push({ t: 'hats', key: `key:${key}`, restart: false, slot: -1 })
    this.queue.push({ t: 'hats', key: 'key:any', restart: false, slot: -1 })
  }

  keyReleased(key: string): void {
    this.keysDown.delete(key)
  }

  isKeyDown(key: string): boolean {
    if (key === 'any') return this.keysDown.size > 0
    return this.keysDown.has(key)
  }

  /** Starts every "when I receive" script for the message next tick (names match ignoring case). */
  broadcast(message: string): void {
    this.queue.push({ t: 'hats', key: `msg:${message.toLowerCase()}`, restart: true, slot: -1 })
  }

  broadcastAndWait(message: string): WaitRecord {
    const wait: WaitRecord = { started: false, runs: [], slots: [], ids: [] }
    this.queue.push({ t: 'hats', key: `msg:${message.toLowerCase()}`, restart: true, slot: -1, wait })
    return wait
  }

  /** Whether every script started for a "broadcast and wait" has finished (or restarted). */
  waitDone(w: WaitRecord): boolean {
    if (!w.started) return false
    for (let k = 0; k < w.runs.length; k++) {
      const run = w.runs[k]
      const slot = w.slots[k]
      if (run.isRunning(slot) && run.runId[slot] === w.ids[k]) return false
    }
    return true
  }

  /**
   * "Switch backdrop to (v)" (see Backdrops.resolve). Starts the "when
   * backdrop switches to" scripts next tick, even if it was already the
   * current one, as in Scratch.
   */
  switchBackdrop(v: Value, wait?: WaitRecord): void {
    const index = this.backdrops.resolve(v, this.random)
    if (index < 0) {
      if (wait) wait.started = true
      return
    }
    this.backdrops.select(index)
    this.queue.push({ t: 'hats', key: 'backdrop', restart: false, slot: -1, fields: { BACKDROP: this.backdrops.backdrop.name }, wait })
  }

  /** "Switch backdrop to (v) and wait": until the scripts it starts have finished. */
  switchBackdropAndWait(v: Value): WaitRecord {
    const wait: WaitRecord = { started: false, runs: [], slots: [], ids: [] }
    this.switchBackdrop(v, wait)
    return wait
  }

  /** The stage was clicked where there is no sprite. */
  stageClicked(): void {
    this.queue.push({ t: 'hats', key: 'stageclick', restart: true, slot: -1 })
  }

  /** The entity at `slot` was clicked on the stage. */
  entityClicked(slot: number): void {
    this.queue.push({ t: 'hats', key: 'click', restart: true, slot })
  }

  /**
   * Starts extension hat scripts of `opcode` whose menu values all equal
   * `fields` (fields not given match anything), next tick. With `entity` (a
   * handle), only on that entity.
   */
  startHats(opcode: string, fields: Record<string, string> = {}, entity?: number): void {
    const slot = entity === undefined ? -1 : this.store.slotOf(entity)
    if (entity !== undefined && slot < 0) return
    this.queue.push({ t: 'hats', key: `ext:${opcode}`, restart: false, slot, fields })
  }

  /**
   * Runs the stack starting at `top` on the sprite (clicking a script in the
   * editor), or stops it if it is already running there.
   */
  toggleScript(sprite: Sprite, top: BlockJson): void {
    const kind = this.kindOf(sprite)
    const running = kind.runsFor(top.id).filter((r) => r.isRunning(kind.slot))
    if (running.length > 0) {
      for (const r of running) r.stop(kind.slot)
      this.emitScriptChanges()
      return
    }
    this.queue.push({ t: 'run', kind, top })
  }

  private processEvents(): void {
    if (this.compileNeeded) this.compile()
    const starts = this.cloneStarts
    const n = this.cloneStartCount
    this.cloneStartCount = 0
    for (let k = 0; k < n; k++) {
      const slot = starts[k]
      if ((this.store.flags[slot] & (F_ALIVE | F_DYING)) === F_ALIVE) this.startHatsOn('clone', slot, false)
    }
    const q = this.queue
    this.queue = this.spareQueue
    this.spareQueue = q
    for (const ev of q) {
      if (ev.t === 'flag') this.flag()
      else if (ev.t === 'run') this.runClicked(ev.kind, ev.top)
      else if (ev.t === 'touch') this.startTouched(ev.run, ev.handle, ev.other)
      else this.startHatsOn(ev.key, ev.slot, ev.restart, ev.fields, ev.wait)
    }
    q.length = 0
  }

  private flag(): void {
    this.stopAll()
    if (this.compileNeeded) this.compile()
    this.resetTimer()
    this.random.seed(this.settings.randomSeed ?? Math.floor(Math.random() * 2 ** 32))
    for (const ext of this.extensions.values()) ext.greenFlag?.(this)
    this.startHatsOn('flag', -1, true)
  }

  private runClicked(kind: Kind, top: BlockJson): void {
    if (!this.kinds.includes(kind)) return
    const ir = parseClicked(top, kind === this.stageKind)
    if (!ir) return
    const existing = kind.scripts.find((r) => r.topId === ir.topId && r.plan.ir.source === ir.source)
    let run = existing ?? null
    if (!run) {
      kind.adhoc.set(ir.topId, { ir, run: null })
      this.compileNeeded = true
      this.compile()
      run = kind.adhoc.get(ir.topId)?.run ?? null
    }
    if (run) this.startRun(run, kind.slot, true)
  }

  private startHatsOn(key: string, slot: number, restart: boolean, fields?: Record<string, string>, wait?: WaitRecord): void {
    if (wait) wait.started = true
    const entries = this.hatIndex.get(key)
    if (!entries) return
    const s = this.store
    for (const { run, fields: hatFields } of entries) {
      if (fields && hatFields) {
        const ok = Object.entries(fields).every(([k, v]) => hatFields[k] === undefined || hatFields[k].toLowerCase() === v.toLowerCase())
        if (!ok) continue
      }
      const kind = run.kind
      if (slot >= 0) {
        if (s.kind[slot] === kind.index && (s.flags[slot] & (F_ALIVE | F_DYING)) === F_ALIVE) this.startRun(run, slot, restart, wait)
        continue
      }
      for (let m = 0; m < kind.count; m++) {
        const e = kind.members[m]
        if (!(s.flags[e] & F_DYING)) this.startRun(run, e, restart, wait)
      }
    }
  }

  private startTouched(run: ScriptRun, handle: number, other: EntityRef | null): void {
    const slot = this.store.slotOf(handle)
    if (slot < 0 || this.store.flags[slot] & F_DYING) return
    // The script may have been recompiled since.
    const current = run.kind.scripts.find((r) => r.topId === run.topId && r.hat?.kind === 'touch')
    if (!current || !this.kinds.includes(run.kind)) return
    this.touchedRef[slot] = other
    this.startRun(current, slot, false)
  }

  private startRun(run: ScriptRun, slot: number, restart: boolean, wait?: WaitRecord): void {
    if (run.isRunning(slot) && !restart) return
    // The same script never runs twice on one entity, even across recompiles.
    for (const other of run.kind.runs) if (other !== run && other.topId === run.topId) other.stop(slot)
    const id = run.start(slot)
    if (wait) {
      wait.runs.push(run)
      wait.slots.push(slot)
      wait.ids.push(id)
    }
  }

  // ---- running -------------------------------------------------------------

  /** Runs one tick. */
  step(): void {
    const started = performance.now()
    this.tick++
    this.inTick = true
    try {
      this.store.savePose()
      this.camera.savePose()
      this.processEvents()
      this.runScripts()
      if (this.halted) this.stopAll()
      else for (const ext of this.extensions.values()) ext.afterScripts?.(this, 1 / TICKS_PER_SECOND)
      this.removeDying()
      if (this.touches.active) {
        this.touches.detect(this.store, this.tick, (run, slot, other) => {
          this.queue.push({ t: 'touch', run, handle: this.store.handle(slot), other: other >= 0 ? this.refOf(other) : null })
        })
      }
      for (const kind of this.kinds) {
        if (kind.retired.length > 0 && kind.retired.some((r) => !r.active)) {
          kind.retired = kind.retired.filter((r) => r.active)
          kind.rebuildRuns()
        }
      }
    } finally {
      this.inTick = false
      this.currentScript = null
    }
    this.emitScriptChanges()
    this.tickMs = this.tickMs * 0.9 + (performance.now() - started) * 0.1
  }

  private runScripts(): void {
    for (const kind of this.kinds) {
      for (const run of kind.runs) {
        if (run.n === 0 && run.fn === 0) continue
        this.currentScript = run
        try {
          if (run.n > 0) {
            run.sm(run.list, run.n)
            run.compact()
          }
          if (!this.halted && run.fn > 0 && run.fv) {
            run.fv(run.flist, run.fn)
            if (run.dirtyF) run.compactPerFrame()
          }
        } catch (err) {
          console.error(`Runtime: a script of sprite "${kind.sprite.name}" crashed and was stopped`, err)
          run.stopAll()
        }
        if (run.plan.moves) kind.grid.stale = true
        if (this.halted) return
      }
    }
  }

  /** Creates a clone of the entity `source` (kind -1) or of the original of `kindIndex`. */
  createClone(source: number, kindIndex: number): void {
    if (this.cloneCount >= this.settings.cloneLimit) return
    const s = this.store
    const kind = kindIndex < 0 ? this.kinds[s.kind[source]] : this.kinds[kindIndex]
    if (!kind || kind === this.stageKind) return
    const from = kindIndex < 0 ? source : kind.slot
    const slot = s.alloc()
    if (slot < 0) return
    s.copyState(from, slot)
    s.flags[slot] = F_ALIVE | F_CLONE | (s.flags[from] & (F_VISIBLE | F_PEN))
    s.kind[slot] = kind.index
    for (const col of kind.num) col[slot] = col[from]
    for (const col of kind.ref) col[slot] = col[from]
    for (const col of kind.lists) col[slot] = (col[from] ?? []).slice()
    kind.addMember(slot, this.memberPos)
    kind.grid.stale = true
    this.touchedRef[slot] = null
    this.cloneCount++
    this.cloneStarts[this.cloneStartCount++] = slot
  }

  /** "Delete this clone": stops its scripts now and removes it at the end of the tick. Returns false for originals. */
  deleteClone(slot: number): boolean {
    const s = this.store
    if (!(s.flags[slot] & F_CLONE)) return false
    if (s.flags[slot] & F_DYING) return true
    s.flags[slot] |= F_DYING
    const kind = this.kinds[s.kind[slot]]
    for (const run of kind.runs) run.stop(slot)
    kind.grid.stale = true
    this.dying[this.dyingCount++] = slot
    if (!this.inTick) this.removeDying()
    return true
  }

  private removeDying(): void {
    const s = this.store
    for (let k = 0; k < this.dyingCount; k++) {
      const slot = this.dying[k]
      if (!(s.flags[slot] & F_ALIVE)) continue
      const kind = this.kinds[s.kind[slot]]
      kind.removeMember(slot, this.memberPos)
      for (const col of kind.lists) col[slot] = []
      s.release(slot)
      this.cloneCount--
    }
    this.dyingCount = 0
  }

  stopAll(): void {
    this.halted = false
    this.queue.length = 0
    for (const kind of this.kinds) {
      for (const run of kind.runs) run.stopAll()
      kind.retired = []
      kind.rebuildRuns()
    }
    const s = this.store
    for (let slot = 0; slot < s.highWater; slot++) {
      if ((s.flags[slot] & (F_ALIVE | F_CLONE)) !== (F_ALIVE | F_CLONE)) continue
      const kind = this.kinds[s.kind[slot]]
      kind.removeMember(slot, this.memberPos)
      for (const col of kind.lists) col[slot] = []
      s.release(slot)
    }
    this.cloneCount = 0
    this.cloneStartCount = 0
    this.dyingCount = 0
    s.compact()
    for (const slot of [...s.sayers]) s.say(slot, null)
    this.posesChanged()
    this.camera.release()
    for (const ext of this.extensions.values()) ext.stopAll?.(this)
    if (!this.inTick) this.emitScriptChanges()
  }

  /** "Stop other scripts in sprite": every script on the entity except `except`. */
  stopOtherScripts(slot: number, except: ScriptRun | null): void {
    const kind = this.kinds[this.store.kind[slot]]
    for (const run of kind.runs) if (run !== except) run.stop(slot)
  }

  // ---- editor display --------------------------------------------------------

  /** Whether the script with this top block runs on the sprite (the original, not its clones). */
  isScriptRunning(sprite: Sprite, topBlockId: string): boolean {
    const kind = this.kinds.find((k) => k.sprite === sprite)
    return !!kind && kind.runsFor(topBlockId).some((r) => r.isRunning(kind.slot))
  }

  /** Listens for scripts starting and stopping on original sprites (for highlighting them). */
  onScriptChange(listener: ScriptListener): () => void {
    this.scriptListeners.add(listener)
    return () => this.scriptListeners.delete(listener)
  }

  private emitScriptChanges(): void {
    if (this.scriptListeners.size === 0) return
    const now = this.glowScratch
    for (const kind of this.kinds) {
      now.clear()
      for (const run of kind.runs) if (run.isRunning(kind.slot)) now.add(run.topId)
      for (const top of kind.glow.keys()) {
        if (now.has(top)) continue
        kind.glow.delete(top)
        for (const l of this.scriptListeners) l(kind.sprite.id, top, false)
      }
      for (const top of now) {
        if (kind.glow.has(top)) continue
        kind.glow.set(top, true)
        for (const l of this.scriptListeners) l(kind.sprite.id, top, true)
      }
    }
  }

  setMonitor(key: string, shown: boolean): void {
    if (this.monitors.has(key) === shown) return
    if (shown) this.monitors.add(key)
    else this.monitors.delete(key)
    for (const l of this.monitorListeners) l()
  }

  onMonitorChange(listener: () => void): () => void {
    this.monitorListeners.add(listener)
    return () => this.monitorListeners.delete(listener)
  }

  get timer(): number {
    return (this.tick - this.timerStart) / TICKS_PER_SECOND
  }

  resetTimer(): void {
    this.timerStart = this.tick
  }

  private notifyExtensions(): void {
    for (const ext of this.extensions.values()) ext.spritesChanged?.(this)
  }
}

function itemsType(items: readonly Value[]): Ty | undefined {
  let t: Ty | undefined
  for (const v of items) {
    t = join(t, typeOfValue(v))
    if (t === 'any') break
  }
  return t
}
