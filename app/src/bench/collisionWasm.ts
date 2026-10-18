/**
 * Trial: the touching test compiled to wasm (wasm/collision), wrapped for
 * measuring against the JS version (docs/vm-design.md 14.3). Not used by the
 * engine.
 */
import type { EntityStore } from '../engine/store'

interface Exports {
  memory: WebAssembly.Memory
  reserve(capacity: number, grids: number): void
  column(k: number): number
  grid_build(id: number, n: number, tick: number): void
  touching(id: number, slot: number, tick: number): number
  touching_batch(id: number, n: number, tick: number): void
}

/** Store columns in the order wasm numbers them. */
const FLOATS = ['x', 'y', 'z', 'px', 'py', 'pz', 'size', 'direction', 'pitch', 'roll'] as const

export class CollisionWasm {
  private readonly w: Exports
  private capacity = 0
  private floats: Float64Array[] = []
  private shape = new Uint8Array(0)
  private flags = new Uint8Array(0)
  private slots = new Int32Array(0)
  private out = new Uint8Array(0)

  private constructor(instance: WebAssembly.Instance) {
    this.w = instance.exports as unknown as Exports
  }

  static async load(bytes: BufferSource): Promise<CollisionWasm> {
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new CollisionWasm(instance)
  }

  /** Makes room for `capacity` slots and `grids` grids. */
  reserve(capacity: number, grids: number): void {
    this.capacity = capacity
    this.w.reserve(capacity, grids)
    const buffer = this.w.memory.buffer
    this.floats = FLOATS.map((_, k) => new Float64Array(buffer, this.w.column(k), capacity))
    this.shape = new Uint8Array(buffer, this.w.column(10), capacity)
    this.flags = new Uint8Array(buffer, this.w.column(11), capacity)
    this.slots = new Int32Array(buffer, this.w.column(12), capacity)
    this.out = new Uint8Array(buffer, this.w.column(13), capacity)
  }

  /** Copies the columns the test reads (slots below highWater). */
  upload(E: EntityStore): void {
    if (this.capacity < E.capacity) this.reserve(E.capacity, 1)
    const n = E.highWater
    FLOATS.forEach((name, k) => this.floats[k].set(E[name].subarray(0, n)))
    this.shape.set(E.shape.subarray(0, n))
    this.flags.set(E.flags.subarray(0, n))
  }

  build(grid: number, members: Int32Array, n: number, tick: number): void {
    this.slots.set(members.subarray(0, n))
    this.w.grid_build(grid, n, tick)
  }

  touching(grid: number, slot: number, tick: number): boolean {
    return this.w.touching(grid, slot, tick) !== 0
  }

  /** Results go to `out` (1 = touching). */
  touchingBatch(grid: number, slots: Int32Array, n: number, tick: number, out: Uint8Array): void {
    this.slots.set(slots.subarray(0, n))
    this.w.touching_batch(grid, n, tick)
    out.set(this.out.subarray(0, n))
  }
}
