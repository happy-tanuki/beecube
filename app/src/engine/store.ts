/**
 * Entity state as columns (structure of arrays), indexed by slot. Sprites and
 * clones are both entities; a slot never moves while its entity lives.
 *
 * Capacity is reserved up front (originals + clone limit), so columns are
 * only replaced between ticks and generated code may keep them in locals.
 */
import { clampPercent, hsvToRgb, mod, rgbToHsv } from './ops'

export const F_ALIVE = 1
export const F_VISIBLE = 2
export const F_PEN = 4
export const F_CLONE = 8
/** Deleted during this tick; removed at its end. */
export const F_DYING = 16

/** The pen color's parts that "change pen (color) by" adjusts, by menu value. */
export const PEN_PARAMS = ['color', 'saturation', 'brightness', 'transparency'] as const
export type PenParam = (typeof PEN_PARAMS)[number]

/**
 * A shape's own width, depth and height, in percent of its size, along its
 * local x (the heading), y and z axes. A cube stretched this way is a cuboid.
 */
export const DIMENSIONS = ['width', 'depth', 'height'] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** Handles pack a generation above the slot number. */
const SLOT_SPAN = 2 ** 22
export const NO_HANDLE = -1

export const POSE_COLUMNS = ['x', 'y', 'z', 'direction', 'pitch', 'roll', 'size'] as const
export type PoseColumn = (typeof POSE_COLUMNS)[number]

export class EntityStore {
  capacity = 0
  /** Slots below this have been used; iteration stops here. */
  highWater = 0
  /** Live entities. */
  count = 0

  x = new Float64Array(0)
  y = new Float64Array(0)
  z = new Float64Array(0)
  direction = new Float64Array(0)
  pitch = new Float64Array(0)
  roll = new Float64Array(0)
  size = new Float64Array(0)
  /** The pose at the start of the tick, for interpolation. */
  px = new Float64Array(0)
  py = new Float64Array(0)
  pz = new Float64Array(0)
  pdirection = new Float64Array(0)
  ppitch = new Float64Array(0)
  proll = new Float64Array(0)
  psize = new Float64Array(0)
  /** Percent of the size along each local axis (DIMENSIONS). Not interpolated. */
  width = new Float64Array(0)
  depth = new Float64Array(0)
  height = new Float64Array(0)

  /** 0xRRGGBB */
  color = new Uint32Array(0)
  /** 0xRRGGBB, kept in step with the pen's hue, saturation and brightness. */
  penColor = new Uint32Array(0)
  /** The pen color as Scratch's pen blocks see it, each 0–100. Hue is kept even where the color is gray. */
  penHue = new Float64Array(0)
  penSaturation = new Float64Array(0)
  penBrightness = new Float64Array(0)
  penTransparency = new Float64Array(0)
  penSize = new Float64Array(0)
  /** Index into SHAPES: the shape of the look (kept with it, for collisions). */
  shape = new Uint8Array(0)
  /** Index of the costume worn, in the kind's (the original sprite's) costumes. */
  costume = new Uint16Array(0)
  /** What the stage draws: index into the runtime's looks (costume.ts), set with the costume. */
  look = new Uint16Array(0)
  /**
   * The look's own extent along the local axes, as fractions: 1 for the
   * shapes, a model's box in a cube. Collisions and physics stretch the
   * shape by these as well as by width, depth and height.
   */
  extentX = new Float64Array(0)
  extentY = new Float64Array(0)
  extentZ = new Float64Array(0)
  flags = new Uint8Array(0)
  /** Index of the kind (original sprite) whose scripts the entity runs. */
  kind = new Uint16Array(0)
  generation = new Uint32Array(0)
  saying: (string | null)[] = []
  /** Slots whose `saying` is set. */
  readonly sayers = new Set<number>()

  /** Free slots below highWater; the lowest is popped first after a reset. */
  private free: number[] = []

  constructor(capacity: number) {
    this.resize(capacity)
  }

  /** Replaces every column with one of `capacity` slots, keeping the contents. Only between ticks. */
  resize(capacity: number): void {
    if (capacity > SLOT_SPAN) throw new Error(`EntityStore: capacity ${capacity} is over the limit of ${SLOT_SPAN}`)
    if (capacity < this.highWater) throw new Error(`EntityStore: capacity ${capacity} is below the slots in use (${this.highWater})`)
    const grow = <T extends Float64Array | Uint32Array | Uint16Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(capacity)
      b.set(a.subarray(0, Math.min(a.length, capacity)))
      return b
    }
    const f64 = (n: number) => new Float64Array(n)
    this.x = grow(this.x, f64)
    this.y = grow(this.y, f64)
    this.z = grow(this.z, f64)
    this.direction = grow(this.direction, f64)
    this.pitch = grow(this.pitch, f64)
    this.roll = grow(this.roll, f64)
    this.size = grow(this.size, f64)
    this.px = grow(this.px, f64)
    this.py = grow(this.py, f64)
    this.pz = grow(this.pz, f64)
    this.pdirection = grow(this.pdirection, f64)
    this.ppitch = grow(this.ppitch, f64)
    this.proll = grow(this.proll, f64)
    this.psize = grow(this.psize, f64)
    this.width = grow(this.width, f64)
    this.depth = grow(this.depth, f64)
    this.height = grow(this.height, f64)
    this.color = grow(this.color, (n) => new Uint32Array(n))
    this.penColor = grow(this.penColor, (n) => new Uint32Array(n))
    this.penHue = grow(this.penHue, f64)
    this.penSaturation = grow(this.penSaturation, f64)
    this.penBrightness = grow(this.penBrightness, f64)
    this.penTransparency = grow(this.penTransparency, f64)
    this.penSize = grow(this.penSize, f64)
    this.shape = grow(this.shape, (n) => new Uint8Array(n))
    this.costume = grow(this.costume, (n) => new Uint16Array(n))
    this.look = grow(this.look, (n) => new Uint16Array(n))
    this.extentX = grow(this.extentX, f64)
    this.extentY = grow(this.extentY, f64)
    this.extentZ = grow(this.extentZ, f64)
    this.flags = grow(this.flags, (n) => new Uint8Array(n))
    this.kind = grow(this.kind, (n) => new Uint16Array(n))
    this.generation = grow(this.generation, (n) => new Uint32Array(n))
    this.saying.length = capacity
    for (let i = this.capacity; i < capacity; i++) this.saying[i] = null
    this.capacity = capacity
  }

  /**
   * Takes a free slot, or returns -1 when full. Width, depth and height start
   * at 100% and the extents at 1; the slot's other columns are left as they were.
   */
  alloc(): number {
    let slot: number
    if (this.free.length > 0) slot = this.free.pop()!
    else if (this.highWater < this.capacity) slot = this.highWater++
    else return -1
    this.flags[slot] = F_ALIVE
    this.width[slot] = this.depth[slot] = this.height[slot] = 100
    this.extentX[slot] = this.extentY[slot] = this.extentZ[slot] = 1
    this.saying[slot] = null
    this.count++
    return slot
  }

  /** Frees a slot. Handles to it stop resolving. */
  release(slot: number): void {
    if (!(this.flags[slot] & F_ALIVE)) return
    this.flags[slot] = 0
    // Kept below 2^31 so handles stay exact doubles.
    this.generation[slot] = (this.generation[slot] + 1) & 0x7fffffff
    if (this.saying[slot] !== null) this.say(slot, null)
    this.count--
    this.free.push(slot)
  }

  /** Lowers highWater to just above the last live slot and orders the free list lowest-first. */
  compact(): void {
    let hw = this.highWater
    while (hw > 0 && !(this.flags[hw - 1] & F_ALIVE)) hw--
    this.highWater = hw
    this.free = []
    for (let i = hw - 1; i >= 0; i--) if (!(this.flags[i] & F_ALIVE)) this.free.push(i)
  }

  isAlive(slot: number): boolean {
    return slot >= 0 && slot < this.highWater && (this.flags[slot] & F_ALIVE) !== 0
  }

  handle(slot: number): number {
    return this.generation[slot] * SLOT_SPAN + slot
  }

  /** The slot a handle refers to, or -1 if that entity is gone. */
  slotOf(handle: number): number {
    if (handle < 0) return -1
    const slot = handle % SLOT_SPAN
    if (slot >= this.highWater || !(this.flags[slot] & F_ALIVE)) return -1
    return this.generation[slot] === Math.floor(handle / SLOT_SPAN) ? slot : -1
  }

  /** Copies pose and looks (not flags, kind or speech) from one slot to another. */
  copyState(from: number, to: number): void {
    this.x[to] = this.x[from]
    this.y[to] = this.y[from]
    this.z[to] = this.z[from]
    this.direction[to] = this.direction[from]
    this.pitch[to] = this.pitch[from]
    this.roll[to] = this.roll[from]
    this.size[to] = this.size[from]
    this.px[to] = this.x[from]
    this.py[to] = this.y[from]
    this.pz[to] = this.z[from]
    this.pdirection[to] = this.direction[from]
    this.ppitch[to] = this.pitch[from]
    this.proll[to] = this.roll[from]
    this.psize[to] = this.size[from]
    this.width[to] = this.width[from]
    this.depth[to] = this.depth[from]
    this.height[to] = this.height[from]
    this.color[to] = this.color[from]
    this.penColor[to] = this.penColor[from]
    this.penHue[to] = this.penHue[from]
    this.penSaturation[to] = this.penSaturation[from]
    this.penBrightness[to] = this.penBrightness[from]
    this.penTransparency[to] = this.penTransparency[from]
    this.penSize[to] = this.penSize[from]
    this.shape[to] = this.shape[from]
    this.costume[to] = this.costume[from]
    this.look[to] = this.look[from]
    this.extentX[to] = this.extentX[from]
    this.extentY[to] = this.extentY[from]
    this.extentZ[to] = this.extentZ[from]
  }

  /** Sets the pen color from 0xRRGGBB; as in Scratch, the pen becomes opaque. */
  setPenRgb(slot: number, rgb: number): void {
    const [h, s, v] = rgbToHsv(rgb)
    // A gray has no hue of its own: keep the old one, so "change pen color" carries on from it.
    if (s > 0 && v > 0) this.penHue[slot] = h
    this.penSaturation[slot] = s
    this.penBrightness[slot] = v
    this.penTransparency[slot] = 0
    this.penColor[slot] = rgb
  }

  /** Sets or changes one part of the pen color. Hue wraps; the others stay within 0–100. */
  setPenParam(slot: number, param: PenParam, value: number, change: boolean): void {
    const column =
      param === 'color' ? this.penHue
      : param === 'saturation' ? this.penSaturation
      : param === 'brightness' ? this.penBrightness
      : this.penTransparency
    const v = change ? column[slot] + value : value
    column[slot] = param === 'color' ? mod(v, 100) : clampPercent(v)
    this.penColor[slot] = hsvToRgb(this.penHue[slot], this.penSaturation[slot], this.penBrightness[slot])
  }

  say(slot: number, text: string | null): void {
    this.saying[slot] = text
    if (text === null) this.sayers.delete(slot)
    else this.sayers.add(slot)
  }

  /** Starts a tick: the current pose becomes the previous one. */
  savePose(): void {
    const n = this.highWater
    this.px.set(this.x.subarray(0, n))
    this.py.set(this.y.subarray(0, n))
    this.pz.set(this.z.subarray(0, n))
    this.pdirection.set(this.direction.subarray(0, n))
    this.ppitch.set(this.pitch.subarray(0, n))
    this.proll.set(this.roll.subarray(0, n))
    this.psize.set(this.size.subarray(0, n))
  }

  /** Makes a slot's previous pose equal its current one (no interpolation after a teleport). */
  snapPose(slot: number): void {
    this.px[slot] = this.x[slot]
    this.py[slot] = this.y[slot]
    this.pz[slot] = this.z[slot]
    this.pdirection[slot] = this.direction[slot]
    this.ppitch[slot] = this.pitch[slot]
    this.proll[slot] = this.roll[slot]
    this.psize[slot] = this.size[slot]
  }
}
