/**
 * Helpers that generated code calls as `L.*`. Small ones get inlined by V8;
 * the rest are blocks too involved to inline (bounce, touching, clones).
 */
import { BUILTIN_PROPERTIES } from './analyze'
import {
  boundingRadius,
  bounced,
  bounceOffEdge,
  shapesIntersect,
  touchable,
  touchingEdge,
} from './collision'
import type { ExtensionBlock, ReporterBlock, CommandBlock } from './extension'
import type { Kind } from './instances'
import {
  clampDimension,
  clampPenSize,
  clampSize,
  colorToInt,
  compare,
  contains,
  cos,
  isColorString,
  isWholeBound,
  letterOf,
  listIndex,
  listText,
  mathop,
  MAX_LIST_LENGTH,
  mod,
  round6,
  sameItem,
  sin,
  toBoolean,
  toNumber,
  toText,
  waitTicks,
  wrapDirection,
} from './ops'
import { turnBody } from './orientation'
import type { Vec3 } from './pen'
import type { Runtime, WaitRecord } from './runtime'
import { EntityRef } from './ref'
import { F_ALIVE, F_DYING, F_PEN, F_VISIBLE, type PenParam } from './store'
import { MOUSE, MYSELF, RANDOM, STAGE_HEIGHT, STAGE_WIDTH, type Value } from './types'

const DEG = Math.PI / 180
const TOUCHABLE_MASK = F_ALIVE | F_VISIBLE | F_DYING
const TOUCHABLE = F_ALIVE | F_VISIBLE
/** Bits of 0xRRGGBB compared by "touching color", as Scratch does (5, 5 and 4 bits). */
const COLOR_MASK = 0xf8f8f0

export type Lib = ReturnType<typeof makeLib>

export function makeLib(rt: Runtime) {
  const E = () => rt.store

  /** Rotates a local offset by the entity's yaw so drawn shapes face its direction. */
  function yawed(i: number, dx: number, dy: number, dz: number): Vec3 {
    const s = E()
    const a = (90 - s.direction[i]) * DEG
    const c = Math.cos(a)
    const sn = Math.sin(a)
    return { x: s.x[i] + dx * c - dy * sn, y: s.y[i] + dx * sn + dy * c, z: s.z[i] + dz }
  }

  function touchingKind(i: number, kind: Kind): boolean {
    const s = rt.store
    const flags = s.flags
    if ((flags[i] & TOUCHABLE_MASK) !== TOUCHABLE) return false
    const grid = kind.grid
    if (grid.stale) grid.build(s, kind.members, kind.count, rt.tick)
    grid.query(s, i, rt.tick)
    const found = grid.found
    for (let k = 0; k < grid.foundCount; k++) {
      const o = found[k]
      if (o !== i && (flags[o] & TOUCHABLE_MASK) === TOUCHABLE && shapesIntersect(s, i, o)) return true
    }
    return false
  }

  /** "Touching color": whether the entity's shape touches an entity (of any sprite) of that color. */
  function touchingColor(i: number, color: number): boolean {
    const s = rt.store
    const flags = s.flags
    if ((flags[i] & TOUCHABLE_MASK) !== TOUCHABLE) return false
    const want = color & COLOR_MASK
    for (const kind of rt.kinds) {
      const grid = kind.grid
      if (grid.stale) grid.build(s, kind.members, kind.count, rt.tick)
      grid.query(s, i, rt.tick)
      const found = grid.found
      for (let k = 0; k < grid.foundCount; k++) {
        const o = found[k]
        if (o !== i && (s.color[o] & COLOR_MASK) === want && (flags[o] & TOUCHABLE_MASK) === TOUCHABLE && shapesIntersect(s, i, o)) return true
      }
    }
    return false
  }

  /** The entity a menu names, a sprite by name or reference; -1 if none. */
  function target(v: Value): number {
    if (v instanceof EntityRef) return E().slotOf(v.handle)
    const k = rt.kindByName(toText(v))
    return k >= 0 ? rt.kinds[k].slot : -1
  }

  function distanceToKind(i: number, kind: Kind): number {
    const s = E()
    const o = kind.slot
    if (o === i) return 10000
    return Math.hypot(s.x[i] - s.x[o], s.y[i] - s.y[o], s.z[i] - s.z[o])
  }

  function property(kind: Kind, prop: string): number {
    return propertyAt(kind.slot, prop)
  }

  function propertyAt(o: number, prop: string): number {
    const s = E()
    switch (prop) {
      case 'x position': return round6(s.x[o])
      case 'y position': return round6(s.y[o])
      case 'z position': return round6(s.z[o])
      case 'direction': return round6(s.direction[o])
      case 'pitch': return round6(s.pitch[o])
      case 'roll': return round6(s.roll[o])
      case 'size': return Math.round(s.size[o])
      case 'width': return Math.round(s.width[o])
      case 'depth': return Math.round(s.depth[o])
      case 'height': return Math.round(s.height[o])
      default: return 0
    }
  }

  function clone(i: number, kindIndex: number): void {
    rt.createClone(i, kindIndex)
  }

  function util(i: number) {
    return { rt, slot: i, entity: E().handle(i) }
  }

  /** Where "go to" and "glide to" go, written by `place`. */
  const dest = new Float64Array(3)
  /**
   * Puts in `dest` where (v) is: a random position or the mouse pointer
   * (keeping z), or a sprite, by name or reference. False if there is no such sprite.
   */
  function place(i: number, v: Value): boolean {
    const s = E()
    const name = v instanceof EntityRef ? '' : toText(v)
    dest[2] = s.z[i]
    if (name === MOUSE) {
      dest[0] = rt.mouse.x
      dest[1] = rt.mouse.y
    } else if (name === RANDOM) {
      dest[0] = Math.round(rt.random.next() * STAGE_WIDTH - STAGE_WIDTH / 2)
      dest[1] = Math.round(rt.random.next() * STAGE_HEIGHT - STAGE_HEIGHT / 2)
    } else {
      const o = target(v)
      if (o < 0) return false
      dest[0] = s.x[o]
      dest[1] = s.y[o]
      dest[2] = s.z[o]
    }
    return true
  }

  return {
    boundingRadius: (i: number): number => boundingRadius(E(), i),
    num: toNumber,
    str: toText,
    bool: toBoolean,
    compare,
    mod,
    sin,
    cos,
    mathop,
    letterOf,
    contains,
    round6,
    wrap: wrapDirection,
    turn: (i: number, axis: number, deg: number): void => turnBody(E(), i, axis, deg),
    clampSize,
    clampDimension,
    listText,

    rnd: (): number => rt.random.next(),
    /** "pick random" with bounds known only at run time. */
    random(a: Value, b: Value): number {
      let lo = toNumber(a)
      let hi = toNumber(b)
      if (lo > hi) [lo, hi] = [hi, lo]
      if (isWholeBound(a) && isWholeBound(b)) return lo + Math.floor(rt.random.next() * (hi - lo + 1))
      return lo + rt.random.next() * (hi - lo)
    },
    ticks: waitTicks,
    timer: (): number => rt.timer,
    resetTimer: (): void => rt.resetTimer(),

    pen(i: number, x: number, y: number, z: number): void {
      rt.pen.lineFrom(E(), i, x, y, z)
    },
    penClear: (): void => rt.pen.clear(),
    bounce(i: number): void {
      const s = rt.store
      if (!bounceOffEdge(s, i)) return
      const d = bounced.direction
      s.direction[i] = d > -180 && d <= 180 ? d : wrapDirection(d)
      s.pitch[i] = bounced.pitch
      s.roll[i] = wrapDirection(bounced.roll)
      if (s.flags[i] & 4) rt.pen.lineFrom(s, i, bounced.x, bounced.y, bounced.z)
      s.x[i] = bounced.x
      s.y[i] = bounced.y
      s.z[i] = bounced.z
    },
    say(i: number, text: string | null): void {
      E().say(i, text === '' ? null : text)
    },
    setColor(i: number, v: Value): void {
      if (!isColorString(v)) return
      E().color[i] = colorToInt(v)
    },
    setPenColor(i: number, v: Value): void {
      if (isColorString(v)) E().setPenRgb(i, colorToInt(v))
    },
    penRgb: (i: number, rgb: number): void => E().setPenRgb(i, rgb),
    penParam: (i: number, param: PenParam, v: number, change: boolean): void => E().setPenParam(i, param, v, change),
    clampPenSize,
    stamp: (i: number): void => rt.pen.stamp(E(), i),
    drawCube(i: number, size: number): void {
      const h = size / 2
      const corners = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      ].map(([x, y, z]) => yawed(i, x * h, y * h, z * h))
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
      for (const [a, b] of edges) {
        const p = corners[a]
        const q = corners[b]
        rt.pen.addSegment(p.x, p.y, p.z, q.x, q.y, q.z, E(), i)
      }
    },
    drawSphere(i: number, r: number): void {
      const SEG = 24
      const LONGITUDES = 8
      const LATITUDES = 5
      for (let a = 0; a < LONGITUDES; a++) {
        const lon = (a / LONGITUDES) * Math.PI
        const pts: Vec3[] = []
        for (let j = 0; j < SEG; j++) {
          const t = (j / SEG) * 2 * Math.PI
          pts.push(yawed(i, r * Math.cos(t) * Math.cos(lon), r * Math.cos(t) * Math.sin(lon), r * Math.sin(t)))
        }
        rt.pen.addLoop(pts, E(), i)
      }
      for (let b = 1; b <= LATITUDES; b++) {
        const lat = -Math.PI / 2 + (b / (LATITUDES + 1)) * Math.PI
        const pts: Vec3[] = []
        for (let j = 0; j < SEG; j++) {
          const t = (j / SEG) * 2 * Math.PI
          pts.push(yawed(i, r * Math.cos(lat) * Math.cos(t), r * Math.cos(lat) * Math.sin(t), r * Math.sin(lat)))
        }
        rt.pen.addLoop(pts, E(), i)
      }
    },

    cameraSprite(i: number): void {
      rt.camera.sprite = E().handle(i)
    },
    cameraZoom: (zoom: number, change: boolean): void => rt.camera.setZoom(change ? rt.camera.zoom + zoom : zoom),

    dest,
    place,
    /** "Go to (v)", drawing with the pen. */
    goTo(i: number, v: Value): void {
      if (!place(i, v)) return
      const s = E()
      const [x, y, z] = dest
      if (s.flags[i] & F_PEN) rt.pen.lineFrom(s, i, x, y, z)
      s.x[i] = x
      s.y[i] = y
      s.z[i] = z
    },
    /**
     * "Point towards (v)": a sprite in 3D (direction and pitch), or on the
     * workplane, the mouse pointer or a random direction (direction only).
     */
    pointTowards(i: number, v: Value): void {
      const s = E()
      const name = v instanceof EntityRef ? '' : toText(v)
      if (name === RANDOM) {
        s.direction[i] = wrapDirection(Math.round(rt.random.next() * 360 - 180))
        return
      }
      let dz = 0
      let dx: number, dy: number
      if (name === MOUSE) {
        dx = rt.mouse.x - s.x[i]
        dy = rt.mouse.y - s.y[i]
      } else {
        const o = target(v)
        if (o < 0) return
        dx = s.x[o] - s.x[i]
        dy = s.y[o] - s.y[i]
        dz = s.z[o] - s.z[i]
      }
      const h = Math.hypot(dx, dy)
      if (h > 0) s.direction[i] = wrapDirection(Math.atan2(dx, dy) / DEG)
      if (name !== MOUSE && (h > 0 || dz !== 0)) s.pitch[i] = Math.atan2(dz, h) / DEG
    },

    touchingEdge: (i: number): boolean => touchable(E(), i) && touchingEdge(E(), i),
    touchingKind,
    touchingNamed(i: number, name: string): boolean {
      if (name === '_edge_') return touchable(E(), i) && touchingEdge(E(), i)
      const k = rt.kindByName(name)
      return k >= 0 && touchingKind(i, rt.kinds[k])
    },
    distanceToMouse(i: number): number {
      const s = E()
      return Math.hypot(s.x[i] - rt.mouse.x, s.y[i] - rt.mouse.y, s.z[i])
    },
    distanceToKind,
    distanceNamed(i: number, name: string): number {
      if (name === MOUSE) return Math.hypot(E().x[i] - rt.mouse.x, E().y[i] - rt.mouse.y, E().z[i])
      const k = rt.kindByName(name)
      return k >= 0 ? distanceToKind(i, rt.kinds[k]) : 10000
    },
    /** "Touching (v)?" where v is a sprite reference or, otherwise, a name known only at run time. */
    touchingValue(i: number, v: Value): boolean {
      if (!(v instanceof EntityRef)) return this.touchingNamed(i, toText(v))
      const s = E()
      const o = s.slotOf(v.handle)
      return o >= 0 && o !== i && touchable(s, i) && touchable(s, o) && shapesIntersect(s, i, o)
    },
    distanceValue(i: number, v: Value): number {
      if (!(v instanceof EntityRef)) return this.distanceNamed(i, toText(v))
      const s = E()
      const o = s.slotOf(v.handle)
      return o < 0 || o === i ? 10000 : Math.hypot(s.x[i] - s.x[o], s.y[i] - s.y[o], s.z[i] - s.z[o])
    },
    touchingColor,
    touchingColorValue: (i: number, v: Value): boolean => isColorString(v) && touchingColor(i, colorToInt(v)),
    /** "Touched sprite": what last started a "when I touch" script on the entity. */
    touched: (i: number): Value => rt.touchedRef[i] ?? '',
    keyDown: (name: string): boolean => rt.isKeyDown(name),
    property,
    /** "(property) of (v)": of the entity a sprite reference names, or of the sprite named v. */
    ofValue(v: Value, prop: string): Value {
      if (!(v instanceof EntityRef)) return this.ofNamed(toText(v), prop)
      const o = E().slotOf(v.handle)
      if (o < 0) return 0
      if (BUILTIN_PROPERTIES.has(prop)) return propertyAt(o, prop)
      const kind = rt.kinds[E().kind[o]]
      const found = Object.entries(rt.localVariables(kind.sprite)).find(([, d]) => d.name === prop)
      const view = rt.entity(o)
      return found && view ? rt.variableOf(view, found[0]) : 0
    },
    /** "(property) of (sprite)" with a sprite name known only at run time. */
    ofNamed(name: string, prop: string): Value {
      const k = rt.kindByName(name)
      if (k < 0) return 0
      const kind = rt.kinds[k]
      if (BUILTIN_PROPERTIES.has(prop)) return property(kind, prop)
      const found = Object.values(rt.localVariables(kind.sprite)).find((v) => v.name === prop)
      return found ? found.value : 0
    },

    clone,
    cloneNamed(i: number, name: string): void {
      if (name === MYSELF) return clone(i, -1)
      const k = rt.kindByName(name)
      if (k >= 0) clone(i, k)
    },
    deleteClone: (i: number): boolean => rt.deleteClone(i),
    stopAll(): void {
      rt.halted = true
    },
    stopOthers(i: number): void {
      rt.stopOtherScripts(i, rt.currentScript)
    },
    broadcast(name: string): void {
      rt.broadcast(name)
    },
    broadcastWait: (name: string): WaitRecord => rt.broadcastAndWait(name),
    waitDone: (w: WaitRecord): boolean => rt.waitDone(w),
    monitor(key: string, shown: boolean): void {
      rt.setMonitor(key, shown)
    },

    // lists
    ladd(items: Value[], v: Value): void {
      if (items.length < MAX_LIST_LENGTH) items.push(v)
    },
    ldel(items: Value[], index: Value): void {
      if (typeof index === 'string' && index.trim().toLowerCase() === 'all') {
        items.length = 0
        return
      }
      const i = listIndex(index, items.length, rt.random.next())
      if (i > 0) items.splice(i - 1, 1)
    },
    lins(items: Value[], index: Value, v: Value): void {
      const i = listIndex(index, items.length, rt.random.next(), 1)
      if (i > 0 && items.length < MAX_LIST_LENGTH) items.splice(i - 1, 0, v)
    },
    lrep(items: Value[], index: Value, v: Value): void {
      const i = listIndex(index, items.length, rt.random.next())
      if (i > 0) items[i - 1] = v
    },
    item(items: Value[], index: Value): Value {
      const i = listIndex(index, items.length, rt.random.next())
      return i > 0 ? items[i - 1] : ''
    },
    itemNumber(items: Value[], v: Value): number {
      for (let k = 0; k < items.length; k++) if (sameItem(items[k], v)) return k + 1
      return 0
    },
    listContains(items: Value[], v: Value): boolean {
      for (let k = 0; k < items.length; k++) if (sameItem(items[k], v)) return true
      return false
    },

    // extensions
    command(block: ExtensionBlock, i: number, args: Record<string, Value>): unknown {
      try {
        return (block as CommandBlock).run(args, util(i))
      } catch (err) {
        console.error(`Runtime: extension block "${block.opcode}" failed`, err)
        return undefined
      }
    },
    reporter(block: ExtensionBlock, i: number, args: Record<string, Value>): Value {
      try {
        const v = (block as ReporterBlock).run(args, util(i))
        return v ?? ''
      } catch (err) {
        console.error(`Runtime: extension block "${block.opcode}" failed`, err)
        return ''
      }
    },
    isPromise: (r: unknown): r is Promise<unknown> =>
      r !== null && typeof r === 'object' && typeof (r as { then?: unknown }).then === 'function',
    track(p: Promise<unknown>): { done: boolean } {
      const t = { done: false }
      p.then(
        () => (t.done = true),
        (err: unknown) => {
          console.error('Runtime: awaited promise rejected', err)
          t.done = true
        },
      )
      return t
    },
  }
}
