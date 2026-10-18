/**
 * Trial (docs/vm-design.md 10): what the logic worker hands the renderer
 * after each tick. A snapshot holds the columns drawing reads, in one buffer
 * (shared or transferred), and reads as RenderColumns.
 */
import type { EntityStore } from '../engine/store'
import type { RenderColumns } from '../stage/instances'

const FLOATS = [
  'x', 'y', 'z', 'direction', 'pitch', 'roll', 'size',
  'px', 'py', 'pz', 'pdirection', 'ppitch', 'proll', 'psize',
] as const

/** Header (float64): tick, time of the tick (ms since the epoch), highWater, count, logic ms/tick, write ms. */
const HEADER = 8
const TICK = 0, TIME = 1, HIGH_WATER = 2, COUNT = 3, LOGIC_MS = 4, WRITE_MS = 5

export function snapshotBytes(capacity: number): number {
  const bytes = HEADER * 8 + FLOATS.length * 8 * capacity + 4 * capacity + 2 * capacity
  return Math.ceil(bytes / 8) * 8
}

export class Snapshot implements RenderColumns {
  readonly header: Float64Array
  x!: Float64Array
  y!: Float64Array
  z!: Float64Array
  direction!: Float64Array
  pitch!: Float64Array
  roll!: Float64Array
  size!: Float64Array
  px!: Float64Array
  py!: Float64Array
  pz!: Float64Array
  pdirection!: Float64Array
  ppitch!: Float64Array
  proll!: Float64Array
  psize!: Float64Array
  readonly color: Uint32Array
  readonly shape: Uint8Array
  readonly flags: Uint8Array

  constructor(
    readonly buffer: ArrayBuffer | SharedArrayBuffer,
    readonly capacity: number,
  ) {
    this.header = new Float64Array(buffer, 0, HEADER)
    let at = HEADER * 8
    for (const name of FLOATS) {
      this[name] = new Float64Array(buffer, at, capacity)
      at += 8 * capacity
    }
    this.color = new Uint32Array(buffer, at, capacity)
    at += 4 * capacity
    this.shape = new Uint8Array(buffer, at, capacity)
    this.flags = new Uint8Array(buffer, at + capacity, capacity)
  }

  get tick(): number { return this.header[TICK] }
  get time(): number { return this.header[TIME] }
  get highWater(): number { return this.header[HIGH_WATER] }
  get count(): number { return this.header[COUNT] }
  get logicMs(): number { return this.header[LOGIC_MS] }
  get writeMs(): number { return this.header[WRITE_MS] }

  /** Copies the store (slots in use) and the tick's facts. */
  write(E: EntityStore, tick: number, time: number, logicMs: number): void {
    const start = performance.now()
    const n = E.highWater
    for (const name of FLOATS) this[name].set(E[name].subarray(0, n))
    this.color.set(E.color.subarray(0, n))
    this.shape.set(E.shape.subarray(0, n))
    this.flags.set(E.flags.subarray(0, n))
    const h = this.header
    h[TICK] = tick
    h[TIME] = time
    h[HIGH_WATER] = n
    h[COUNT] = E.count
    h[LOGIC_MS] = logicMs
    h[WRITE_MS] = performance.now() - start
  }
}

/**
 * Three shared snapshots: the worker writes one, the renderer reads another,
 * and the third holds the newest finished one. `control[0]` is the index of
 * that third one, plus FRESH when the renderer has not taken it yet.
 */
const FRESH = 4

export class TripleBuffer {
  private own: number

  constructor(
    readonly control: Int32Array,
    readonly snapshots: Snapshot[],
    side: 'writer' | 'reader',
  ) {
    // control[0] starts at 1: the writer owns 0 and the reader 2.
    this.own = side === 'writer' ? 0 : 2
  }

  get current(): Snapshot {
    return this.snapshots[this.own]
  }

  /** Writer: hands over the snapshot just written and takes another to write. */
  publish(): void {
    this.own = Atomics.exchange(this.control, 0, this.own | FRESH) & 3
  }

  /** Reader: takes the newest snapshot if there is one; returns whether it changed. */
  take(): boolean {
    if (!(Atomics.load(this.control, 0) & FRESH)) return false
    this.own = Atomics.exchange(this.control, 0, this.own) & 3
    return true
  }
}
