/**
 * Object views of entities for the editor, tests and extensions. Their
 * properties read and write the entity store, so they always show the live
 * state. Hot paths never use these.
 */
import { clampPenSize, clampPercent, intToColor, colorToInt } from './ops'
import { savable } from './ref'
import type { Runtime } from './runtime'
import { F_CLONE, F_PEN, F_VISIBLE, type PoseColumn } from './store'
import { SHAPES, type LocalList, type LocalVariable, type PenState, type ShapeKind, type SpriteData, type WorkspaceJson } from './types'

export class EntityView {
  constructor(
    protected readonly rt: Runtime,
    readonly slot: number,
  ) {}

  get x(): number { return this.rt.store.x[this.slot] }
  set x(v: number) { this.setPose('x', v) }
  get y(): number { return this.rt.store.y[this.slot] }
  set y(v: number) { this.setPose('y', v) }
  get z(): number { return this.rt.store.z[this.slot] }
  set z(v: number) { this.setPose('z', v) }
  get direction(): number { return this.rt.store.direction[this.slot] }
  set direction(v: number) { this.setPose('direction', v) }
  get pitch(): number { return this.rt.store.pitch[this.slot] }
  set pitch(v: number) { this.setPose('pitch', v) }
  get roll(): number { return this.rt.store.roll[this.slot] }
  set roll(v: number) { this.setPose('roll', v) }
  get size(): number { return this.rt.store.size[this.slot] }
  set size(v: number) { this.setPose('size', v) }

  get color(): string {
    return intToColor(this.rt.store.color[this.slot])
  }

  set color(c: string) {
    this.rt.store.color[this.slot] = colorToInt(c)
  }

  get shape(): ShapeKind {
    return SHAPES[this.rt.store.shape[this.slot]]
  }

  set shape(s: ShapeKind) {
    this.rt.store.shape[this.slot] = Math.max(0, SHAPES.indexOf(s))
    this.rt.posesChanged(this.slot)
  }

  get visible(): boolean {
    return (this.rt.store.flags[this.slot] & F_VISIBLE) !== 0
  }

  set visible(v: boolean) {
    const f = this.rt.store.flags
    f[this.slot] = v ? f[this.slot] | F_VISIBLE : f[this.slot] & ~F_VISIBLE
    this.rt.posesChanged(this.slot)
  }

  get pen(): PenState {
    const E = this.rt.store
    return {
      down: (E.flags[this.slot] & F_PEN) !== 0,
      color: intToColor(E.penColor[this.slot]),
      transparency: E.penTransparency[this.slot],
      size: E.penSize[this.slot],
    }
  }

  set pen(p: PenState) {
    const E = this.rt.store
    const f = E.flags
    f[this.slot] = p.down ? f[this.slot] | F_PEN : f[this.slot] & ~F_PEN
    E.setPenRgb(this.slot, colorToInt(p.color))
    E.penTransparency[this.slot] = clampPercent(p.transparency ?? 0)
    E.penSize[this.slot] = clampPenSize(p.size ?? 1)
  }

  get saying(): string | null {
    return this.rt.store.saying[this.slot]
  }

  get isClone(): boolean {
    return (this.rt.store.flags[this.slot] & F_CLONE) !== 0
  }

  /** The original sprite whose scripts this entity runs. */
  get original(): Sprite {
    return this.rt.kinds[this.rt.store.kind[this.slot]].sprite
  }

  get name(): string {
    return this.original.name
  }

  set name(_: string) {
    throw new Error('EntityView: rename the original sprite with Runtime.renameSprite')
  }

  /** Handle that stays valid only while this entity lives. */
  get handle(): number {
    return this.rt.store.handle(this.slot)
  }

  /** Sets a pose value directly (no pen), as dragging on the stage does. */
  private setPose(col: PoseColumn, v: number): void {
    this.rt.store[col][this.slot] = v
    this.rt.posesChanged(this.slot)
  }
}

/** An original sprite: its definition (name, blocks, own variables) plus the live state of its entity. */
export class Sprite extends EntityView {
  private _name: string
  private _blocks: WorkspaceJson | null

  constructor(
    rt: Runtime,
    slot: number,
    readonly id: string,
    name: string,
    blocks: WorkspaceJson | null,
  ) {
    super(rt, slot)
    this._name = name
    this._blocks = blocks
  }

  override get name(): string {
    return this._name
  }

  /** Use Runtime.renameSprite, which also updates blocks that refer to the sprite. */
  override set name(name: string) {
    this._name = name
  }

  get blocks(): WorkspaceJson | null {
    return this._blocks
  }

  /** Setting the blocks recompiles this sprite's scripts before they next start. */
  set blocks(ws: WorkspaceJson | null) {
    this._blocks = ws
    this.rt.blocksChanged(this)
  }

  /** Own variables with this sprite's current values. A new object on every read. */
  get variables(): Record<string, LocalVariable> {
    return this.rt.localVariables(this)
  }

  /** Replaces the own variables (names and values); values of kept ids are taken from `vars`. */
  set variables(vars: Record<string, LocalVariable>) {
    this.rt.setLocalVariables(this, vars)
  }

  get lists(): Record<string, LocalList> {
    return this.rt.localLists(this)
  }

  set lists(lists: Record<string, LocalList>) {
    this.rt.setLocalLists(this, lists)
  }

  /** The sprite as plain data, with its current state. */
  toData(): SpriteData {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      z: this.z,
      direction: this.direction,
      pitch: this.pitch,
      roll: this.roll,
      size: this.size,
      color: this.color,
      shape: this.shape,
      visible: this.visible,
      pen: this.pen,
      blocks: structuredClone(this.blocks),
      variables: Object.fromEntries(Object.entries(this.variables).map(([id, v]) => [id, { ...v, value: savable(v.value) }])),
      lists: Object.fromEntries(Object.entries(this.lists).map(([id, l]) => [id, { ...l, items: l.items.map(savable) }])),
    }
  }
}

