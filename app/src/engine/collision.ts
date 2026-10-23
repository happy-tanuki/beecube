/**
 * 3D shape queries on entities: exact convex intersection (GJK over each
 * shape's support function, after cheaper tests), extents, edge bouncing,
 * and a spatial grid for finding nearby entities of a kind.
 *
 * Shapes match what the stage draws: centered on the entity position,
 * BASE_SIZE across at 100% size, stretched along the local axes by width,
 * depth and height, rotated by yaw (direction), pitch, then roll. Cone and
 * cylinder axes are the local z axis; the cone's apex is at +z.
 *
 * Nothing here allocates: vectors live in preallocated scratch arrays.
 */
import type { EntityStore } from './store'
import { F_ALIVE, F_DYING, F_VISIBLE } from './store'
import { BASE_SIZE, STAGE_HEIGHT, STAGE_WIDTH } from './types'

const DEG = Math.PI / 180

const CUBE = 0
const SPHERE = 1
const CYLINDER = 3

/** Bounding-sphere radius per unit half-size, by shape index. */
export const BOUNDING = new Float64Array([Math.sqrt(3), 1, Math.SQRT2, Math.SQRT2])

const HALF_PER_PERCENT = BASE_SIZE / 200

/** Half the shape's size in world units. */
export function halfSize(E: EntityStore, slot: number): number {
  return E.size[slot] * HALF_PER_PERCENT
}

/** The largest of width, depth and height, as a factor. */
function maxStretch(E: EntityStore, slot: number): number {
  return Math.max(E.width[slot], E.depth[slot], E.height[slot]) / 100
}

export function boundingRadius(E: EntityStore, slot: number): number {
  return halfSize(E, slot) * BOUNDING[E.shape[slot]] * maxStretch(E, slot)
}

/** Whether the entity is a sphere with the same width, depth and height. */
function round(E: EntityStore, slot: number): boolean {
  return E.shape[slot] === SPHERE && E.width[slot] === E.depth[slot] && E.depth[slot] === E.height[slot]
}

// ---- shape descriptors ------------------------------------------------------

/**
 * [cx, cy, cz, h, shape, ax(3), ay(3), az(3), kx, ky, kz, ball]: center, half
 * size, shape, local axes in world space, the stretch along each local axis,
 * and 1 for a sphere that isn't stretched (whose axes are left unset).
 */
type Shape = Float64Array
const SHAPE_LEN = 18

/**
 * Pose to build a shape from: [x, y, z, size, shape, direction, pitch, roll,
 * width, depth, height]. Numbers are passed in arrays so they are never boxed.
 */
const POSE = new Float64Array(11)

function setShape(s: Shape, pose: Float64Array): void {
  s[0] = pose[0]
  s[1] = pose[1]
  s[2] = pose[2]
  s[3] = pose[3] * HALF_PER_PERCENT
  const shape = (s[4] = pose[4])
  const kx = (s[14] = pose[8] / 100)
  const ky = (s[15] = pose[9] / 100)
  const kz = (s[16] = pose[10] / 100)
  s[17] = shape === SPHERE && kx === ky && ky === kz ? 1 : 0
  if (s[17] === 1) {
    s[3] *= kx
    return
  }
  const yaw = (90 - pose[5]) * DEG
  const p = pose[6] * DEG
  const roll = pose[7]
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(p)
  const sp = Math.sin(p)
  const cr = Math.cos(roll * DEG)
  const sr = Math.sin(roll * DEG)
  // Rz(yaw) · Ry(-pitch) · Rx(roll); local +x is the heading.
  const y0 = -sy, y1 = cy, y2 = 0
  const z0 = -cy * sp, z1 = -sy * sp, z2 = cp
  s[5] = cy * cp
  s[6] = sy * cp
  s[7] = sp
  s[8] = cr * y0 + sr * z0
  s[9] = cr * y1 + sr * z1
  s[10] = cr * y2 + sr * z2
  s[11] = cr * z0 - sr * y0
  s[12] = cr * z1 - sr * y1
  s[13] = cr * z2 - sr * y2
}

function loadPose(E: EntityStore, slot: number): void {
  POSE[0] = E.x[slot]
  POSE[1] = E.y[slot]
  POSE[2] = E.z[slot]
  POSE[3] = E.size[slot]
  POSE[4] = E.shape[slot]
  POSE[5] = E.direction[slot]
  POSE[6] = E.pitch[slot]
  POSE[7] = E.roll[slot]
  POSE[8] = E.width[slot]
  POSE[9] = E.depth[slot]
  POSE[10] = E.height[slot]
}

function loadShape(s: Shape, E: EntityStore, slot: number): void {
  loadPose(E, slot)
  setShape(s, POSE)
}

/**
 * Writes the shape's farthest point in world direction `sign` × dir[d..d+2]
 * to out[o..o+2]. (Vectors go through arrays so no number is boxed.)
 */
function support(s: Shape, dir: Float64Array, d: number, sign: number, out: Float64Array, o: number): void {
  const dx = sign * dir[d]
  const dy = sign * dir[d + 1]
  const dz = sign * dir[d + 2]
  const h = s[3]
  if (s[17] === 1) {
    const len = Math.hypot(dx, dy, dz) || 1
    out[o] = s[0] + (dx / len) * h
    out[o + 1] = s[1] + (dy / len) * h
    out[o + 2] = s[2] + (dz / len) * h
    return
  }
  // A stretched shape S·U has the support S·u, where u is U's support in direction S·d.
  const kx = s[14], ky = s[15], kz = s[16]
  const l0 = (dx * s[5] + dy * s[6] + dz * s[7]) * kx
  const l1 = (dx * s[8] + dy * s[9] + dz * s[10]) * ky
  const l2 = (dx * s[11] + dy * s[12] + dz * s[13]) * kz
  let p0: number, p1: number, p2: number
  if (s[4] === SPHERE) {
    const len = Math.hypot(l0, l1, l2) || 1
    p0 = (l0 / len) * h
    p1 = (l1 / len) * h
    p2 = (l2 / len) * h
  } else if (s[4] === CUBE) {
    p0 = Math.sign(l0) * h
    p1 = Math.sign(l1) * h
    p2 = Math.sign(l2) * h
  } else {
    // Rim point of a disc of radius h in the local xy plane.
    const r = Math.hypot(l0, l1)
    const rim0 = r > 1e-12 ? (l0 / r) * h : 0
    const rim1 = r > 1e-12 ? (l1 / r) * h : 0
    if (s[4] === CYLINDER) {
      p0 = rim0
      p1 = rim1
      p2 = Math.sign(l2) * h
    } else {
      // Cone: the apex or a point on the base rim, whichever is farther.
      const apex = l2 * h
      const base = l0 * rim0 + l1 * rim1 - l2 * h
      if (apex >= base) {
        p0 = 0
        p1 = 0
        p2 = h
      } else {
        p0 = rim0
        p1 = rim1
        p2 = -h
      }
    }
  }
  p0 *= kx
  p1 *= ky
  p2 *= kz
  out[o] = s[0] + s[5] * p0 + s[8] * p1 + s[11] * p2
  out[o + 1] = s[1] + s[6] * p0 + s[9] * p1 + s[12] * p2
  out[o + 2] = s[2] + s[7] * p0 + s[10] * p1 + s[13] * p2
}

// ---- GJK ------------------------------------------------------------------------

const SA: Shape = new Float64Array(SHAPE_LEN)
const SB: Shape = new Float64Array(SHAPE_LEN)
/** Scratch vectors for GJK, at these offsets. */
const W = new Float64Array(64)
const A = 0, B = 3, C = 6, D = 9, DIR = 12, AO = 15, AB = 18, AC = 21, AD = 24, N = 27, T1 = 30, T2 = 33, ABC = 36, ACD = 39, ADB = 42, P = 45, Q = 48

const dot = (a: number, b: number) => W[a] * W[b] + W[a + 1] * W[b + 1] + W[a + 2] * W[b + 2]
const isZero = (a: number) => dot(a, a) < 1e-18

function copy(o: number, a: number): void {
  W[o] = W[a]
  W[o + 1] = W[a + 1]
  W[o + 2] = W[a + 2]
}

function sub(o: number, a: number, b: number): void {
  W[o] = W[a] - W[b]
  W[o + 1] = W[a + 1] - W[b + 1]
  W[o + 2] = W[a + 2] - W[b + 2]
}

function neg(o: number, a: number): void {
  W[o] = -W[a]
  W[o + 1] = -W[a + 1]
  W[o + 2] = -W[a + 2]
}

/** o = a × b; o must not be a or b. */
function cross(o: number, a: number, b: number): void {
  W[o] = W[a + 1] * W[b + 2] - W[a + 2] * W[b + 1]
  W[o + 1] = W[a + 2] * W[b] - W[a] * W[b + 2]
  W[o + 2] = W[a] * W[b + 1] - W[a + 1] * W[b]
}

/** o = (a × b) × a, via T1; o must not be a, b or T1. */
function tripleCross(o: number, a: number, b: number): void {
  cross(T1, a, b)
  cross(o, T1, a)
}

/** W[o] = support of the Minkowski difference A − B in direction W[d]. */
function minkowski(o: number, d: number): void {
  support(SA, W, d, 1, W, P)
  support(SB, W, d, -1, W, Q)
  sub(o, P, Q)
}

/** GJK on SA and SB: whether the solids overlap (touching counts). */
function gjk(): boolean {
  W[DIR] = SB[0] - SA[0]
  W[DIR + 1] = SB[1] - SA[1]
  W[DIR + 2] = SB[2] - SA[2]
  if (isZero(DIR)) return true
  minkowski(C, DIR)
  neg(DIR, C)
  minkowski(B, DIR)
  if (dot(B, DIR) < 0) return false
  // Search perpendicular to segment bc, towards the origin.
  sub(T2, C, B)
  neg(AO, B)
  tripleCross(DIR, T2, AO)
  if (isZero(DIR)) {
    // The origin lies on the line through b and c.
    W[AO] = 1
    W[AO + 1] = 0
    W[AO + 2] = 0
    cross(DIR, T2, AO)
    if (isZero(DIR)) {
      W[AO] = 0
      W[AO + 2] = -1
      cross(DIR, T2, AO)
    }
  }
  let dim = 2

  for (let iter = 0; iter < 64; iter++) {
    minkowski(A, DIR)
    if (dot(A, DIR) < 0) return false
    dim++
    neg(AO, A)
    if (dim === 3) {
      // Triangle a, b, c (a newest).
      sub(AB, B, A)
      sub(AC, C, A)
      cross(N, AB, AC)
      cross(T2, AB, N)
      if (dot(T2, AO) > 0) {
        copy(C, A)
        tripleCross(DIR, AB, AO)
        dim = 2
        continue
      }
      cross(T2, N, AC)
      if (dot(T2, AO) > 0) {
        copy(B, A)
        tripleCross(DIR, AC, AO)
        dim = 2
        continue
      }
      if (dot(N, AO) > 0) {
        copy(D, C)
        copy(C, B)
        copy(B, A)
        copy(DIR, N)
      } else {
        copy(D, B)
        copy(B, A)
        neg(DIR, N)
      }
      if (isZero(DIR)) return true
      continue
    }
    // Tetrahedron a, b, c, d: check the three faces that contain a.
    sub(AB, B, A)
    sub(AC, C, A)
    sub(AD, D, A)
    cross(ABC, AB, AC)
    cross(ACD, AC, AD)
    cross(ADB, AD, AB)
    dim = 3
    if (dot(ABC, AO) > 0) {
      copy(D, C)
      copy(C, B)
      copy(B, A)
      copy(DIR, ABC)
      continue
    }
    if (dot(ACD, AO) > 0) {
      copy(B, A)
      copy(DIR, ACD)
      continue
    }
    if (dot(ADB, AO) > 0) {
      copy(C, D)
      copy(D, B)
      copy(B, A)
      copy(DIR, ADB)
      continue
    }
    return true
  }
  // Didn't converge (degenerate, e.g. touching faces); count it as touching.
  return true
}

/** Whether a box is aligned with the world axes (yaw a multiple of 90°, no pitch or roll). */
function axisAligned(E: EntityStore, slot: number): boolean {
  return E.pitch[slot] === 0 && E.roll[slot] === 0 && E.direction[slot] % 90 === 0
}

/** Half extents along world x, y and z of an axis-aligned box, at these offsets. */
const HALF = new Float64Array(6)

function boxHalfExtents(E: EntityStore, slot: number, h: number, o: number): void {
  // Facing up or down the y axis (direction 0 or 180), the box's width runs along y.
  const across = E.direction[slot] % 180 === 0
  const w = (h * E.width[slot]) / 100
  const d = (h * E.depth[slot]) / 100
  HALF[o] = across ? d : w
  HALF[o + 1] = across ? w : d
  HALF[o + 2] = (h * E.height[slot]) / 100
}

/**
 * Whether a sphere of radius r touches the axis-aligned box with half extents
 * HALF[o..o+2], their centers (dx, dy, dz) apart: the box's closest point is within r.
 */
function sphereTouchesBox(dx: number, dy: number, dz: number, r: number, o: number): boolean {
  const ox = Math.max(0, Math.abs(dx) - HALF[o])
  const oy = Math.max(0, Math.abs(dy) - HALF[o + 1])
  const oz = Math.max(0, Math.abs(dz) - HALF[o + 2])
  return ox * ox + oy * oy + oz * oz <= r * r
}

/** Whether two entities' solid shapes overlap (touching counts). */
export function shapesIntersect(E: EntityStore, a: number, b: number): boolean {
  const dx = E.x[b] - E.x[a]
  const dy = E.y[b] - E.y[a]
  const dz = E.z[b] - E.z[a]
  const ha = E.size[a] * HALF_PER_PERCENT
  const hb = E.size[b] * HALF_PER_PERCENT
  const sa = E.shape[a]
  const sb = E.shape[b]
  const reach = ha * BOUNDING[sa] * maxStretch(E, a) + hb * BOUNDING[sb] * maxStretch(E, b)
  const d2 = dx * dx + dy * dy + dz * dz
  if (d2 > reach * reach) return false
  const ballA = round(E, a)
  const ballB = round(E, b)
  if (ballA && ballB) {
    const r = (ha * E.width[a] + hb * E.width[b]) / 100
    return d2 <= r * r
  }
  if (sa === CUBE && sb === CUBE && axisAligned(E, a) && axisAligned(E, b)) {
    boxHalfExtents(E, a, ha, 0)
    boxHalfExtents(E, b, hb, 3)
    return Math.abs(dx) <= HALF[0] + HALF[3] && Math.abs(dy) <= HALF[1] + HALF[4] && Math.abs(dz) <= HALF[2] + HALF[5]
  }
  if (ballA && sb === CUBE && axisAligned(E, b)) {
    boxHalfExtents(E, b, hb, 0)
    return sphereTouchesBox(dx, dy, dz, (ha * E.width[a]) / 100, 0)
  }
  if (sa === CUBE && ballB && axisAligned(E, a)) {
    boxHalfExtents(E, a, ha, 0)
    return sphereTouchesBox(dx, dy, dz, (hb * E.width[b]) / 100, 0)
  }
  return gjkIntersect(E, a, b)
}

/** The general test, without shortcuts (also for tests that check the shortcuts). */
export function gjkIntersect(E: EntityStore, a: number, b: number): boolean {
  loadShape(SA, E, a)
  loadShape(SB, E, b)
  return gjk()
}

// ---- extents and edges ---------------------------------------------------

const EXT = new Float64Array(3)
/** +x, +y, +z */
const AXES = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

/** Axis-aligned extents of a shape: [minX, maxX, minY, maxY, minZ, maxZ]. */
function extents(s: Shape, out: Float64Array): void {
  support(s, AXES, 0, -1, EXT, 0)
  out[0] = EXT[0]
  support(s, AXES, 0, 1, EXT, 0)
  out[1] = EXT[0]
  support(s, AXES, 3, -1, EXT, 0)
  out[2] = EXT[1]
  support(s, AXES, 3, 1, EXT, 0)
  out[3] = EXT[1]
  support(s, AXES, 6, -1, EXT, 0)
  out[4] = EXT[2]
  support(s, AXES, 6, 1, EXT, 0)
  out[5] = EXT[2]
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

const BOX = new Float64Array(6)

/** The entity's axis-aligned extents (allocates; for tests and tools). */
export function bounds(E: EntityStore, slot: number): Bounds {
  loadShape(SA, E, slot)
  extents(SA, BOX)
  return { minX: BOX[0], maxX: BOX[1], minY: BOX[2], maxY: BOX[3], minZ: BOX[4], maxZ: BOX[5] }
}

const HALF_W = STAGE_WIDTH / 2
const HALF_H = STAGE_HEIGHT / 2
const EPS = 1e-6

/** Whether the bounding sphere is well inside the walls and above the floor. */
function clearOfEdges(E: EntityStore, slot: number): boolean {
  const r = boundingRadius(E, slot) + EPS
  const x = E.x[slot]
  const y = E.y[slot]
  return x - r >= -HALF_W && x + r <= HALF_W && y - r >= -HALF_H && y + r <= HALF_H && E.z[slot] - r >= 0
}

/** Whether the entity pokes out through a wall of the workplane or below the floor. */
export function touchingEdge(E: EntityStore, slot: number): boolean {
  if (clearOfEdges(E, slot)) return false
  loadShape(SA, E, slot)
  extents(SA, BOX)
  return BOX[0] < -HALF_W - EPS || BOX[1] > HALF_W + EPS || BOX[2] < -HALF_H - EPS || BOX[3] > HALF_H + EPS || BOX[4] < -EPS
}

/** The pose bounceOffEdge computed. */
export const bounced = { x: 0, y: 0, z: 0, direction: 0, pitch: 0, roll: 0 }

/**
 * "If on edge, bounce" in 3D: reflects the heading off the nearest wall it
 * crossed (as Scratch does), off the floor too, and moves the entity back
 * inside. Returns false when nothing needs to change; otherwise the new pose
 * is in `bounced`.
 */
export function bounceOffEdge(E: EntityStore, slot: number): boolean {
  if (clearOfEdges(E, slot)) return false
  loadShape(SA, E, slot)
  extents(SA, BOX)
  const left = -HALF_W - BOX[0]
  const right = BOX[1] - HALF_W
  const bottom = -HALF_H - BOX[2]
  const top = BOX[3] - HALF_H
  // The wall crossed the most; ties prefer left, right, bottom, top.
  let wall = 0
  let most = left
  if (right > most) { wall = 1; most = right }
  if (bottom > most) { wall = 2; most = bottom }
  if (top > most) { wall = 3; most = top }
  const hitWall = most > EPS
  const hitFloor = BOX[4] < -EPS
  if (!hitWall && !hitFloor) return false

  let direction = E.direction[slot]
  let pitch = E.pitch[slot]
  let roll = E.roll[slot]
  // Past straight up or down, the heading runs against direction: read the
  // same orientation with pitch within ±90 first.
  if (pitch > 90 || pitch < -90) {
    direction += 180
    pitch = (pitch > 0 ? 180 : -180) - pitch
    roll += 180
  }
  if (hitWall) {
    const rad = direction * DEG
    let dx = Math.sin(rad)
    let dy = Math.cos(rad)
    if (wall === 0) dx = Math.max(0.2, Math.abs(dx))
    else if (wall === 1) dx = -Math.max(0.2, Math.abs(dx))
    else if (wall === 2) dy = Math.max(0.2, Math.abs(dy))
    else dy = -Math.max(0.2, Math.abs(dy))
    direction = Math.atan2(dx, dy) / DEG
  }
  if (hitFloor && pitch < 0) pitch = -pitch

  // Keep the shape, in its new orientation, inside the walls and above the floor.
  const x = E.x[slot]
  const y = E.y[slot]
  const z = E.z[slot]
  loadPose(E, slot)
  POSE[5] = direction
  POSE[6] = pitch
  POSE[7] = roll
  setShape(SA, POSE)
  extents(SA, BOX)
  const shiftX = BOX[0] < -HALF_W ? -HALF_W - BOX[0] : BOX[1] > HALF_W ? HALF_W - BOX[1] : 0
  const shiftY = BOX[2] < -HALF_H ? -HALF_H - BOX[2] : BOX[3] > HALF_H ? HALF_H - BOX[3] : 0
  const shiftZ = BOX[4] < 0 ? -BOX[4] : 0
  bounced.x = x + shiftX
  bounced.y = y + shiftY
  bounced.z = z + shiftZ
  bounced.direction = direction
  bounced.pitch = pitch
  bounced.roll = roll
  return true
}

// ---- spatial grid ------------------------------------------------------------

/** Below this many members, a kind is searched directly. */
const DIRECT_LIMIT = 16

/**
 * Finds entities of one kind near a point. Members are bucketed by the cell
 * of their center with a counting sort into typed arrays. The cells form a
 * dense box over the members when that box is small enough, and are hashed
 * otherwise. Members much larger than a cell are kept aside and always
 * checked; small kinds are searched directly.
 */
export class KindGrid {
  /** Set by the runtime when members may have moved; the grid rebuilds on the next query. */
  stale = true
  private mode: 'direct' | 'dense' | 'hashed' = 'direct'
  private cell = 1
  /** Dense: the first cell and the number of cells per axis. */
  private x0 = 0
  private y0 = 0
  private z0 = 0
  private nx = 1
  private ny = 1
  private nz = 1
  /** Hashed: table size − 1. */
  private mask = 0
  private buckets = 0
  private start = new Int32Array(1)
  private entries = new Int32Array(0)
  private large = new Int32Array(0)
  private largeCount = 0
  /** Largest bounding radius among bucketed members. */
  private maxR = 0
  /** Largest movement of a member this tick when built, and that tick. */
  private speed = 0
  private builtTick = -1
  /** Query results (replaced when it grows, so read it after querying). */
  found = new Int32Array(64)
  foundCount = 0

  build(E: EntityStore, members: Int32Array, n: number, tick: number): void {
    this.stale = false
    this.foundCount = 0
    this.builtTick = tick
    this.largeCount = 0
    if (this.large.length < n) this.large = new Int32Array(Math.max(n, this.large.length * 2))
    let speed = 0
    let sumR = 0
    let m = 0
    for (let k = 0; k < n; k++) {
      const s = members[k]
      const d = Math.abs(E.x[s] - E.px[s]) + Math.abs(E.y[s] - E.py[s]) + Math.abs(E.z[s] - E.pz[s])
      if (d > speed) speed = d
      if (!touchable(E, s)) continue
      sumR += boundingRadius(E, s)
      m++
    }
    this.speed = speed
    if (m <= DIRECT_LIMIT) {
      this.mode = 'direct'
      for (let k = 0; k < n; k++) if (touchable(E, members[k])) this.large[this.largeCount++] = members[k]
      return
    }
    const avgR = sumR / m
    const cell = (this.cell = Math.max(1, 3 * avgR))
    const limit = cell / 2
    // Bounds of the bucketed members' cells.
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    this.maxR = 0
    for (let k = 0; k < n; k++) {
      const s = members[k]
      if (!touchable(E, s)) continue
      const r = boundingRadius(E, s)
      if (r > limit) {
        this.large[this.largeCount++] = s
        continue
      }
      if (r > this.maxR) this.maxR = r
      const cx = Math.floor(E.x[s] / cell), cy = Math.floor(E.y[s] / cell), cz = Math.floor(E.z[s] / cell)
      if (cx < x0) x0 = cx
      if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy
      if (cy > y1) y1 = cy
      if (cz < z0) z0 = cz
      if (cz > z1) z1 = cz
    }
    const inGrid = m - this.largeCount
    const dense = inGrid > 0 ? (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) : 0
    if (dense <= Math.max(64, 4 * inGrid)) {
      this.mode = 'dense'
      this.x0 = x0
      this.y0 = y0
      this.z0 = z0
      this.nx = x1 - x0 + 1
      this.ny = y1 - y0 + 1
      this.nz = z1 - z0 + 1
      this.buckets = Math.max(0, dense)
    } else {
      this.mode = 'hashed'
      let size = 16
      while (size < 2 * inGrid) size *= 2
      this.mask = size - 1
      this.buckets = size
    }
    const b = this.buckets
    if (this.start.length < b + 1) this.start = new Int32Array(b + 1)
    else this.start.fill(0, 0, b + 1)
    if (this.entries.length < inGrid) this.entries = new Int32Array(Math.max(inGrid, this.entries.length * 2))
    const start = this.start
    // Count per bucket, then prefix sums, then place.
    for (let k = 0; k < n; k++) {
      const s = members[k]
      if (!touchable(E, s) || boundingRadius(E, s) > limit) continue
      start[this.bucketOf(E.x[s], E.y[s], E.z[s]) + 1]++
    }
    for (let i = 0; i < b; i++) start[i + 1] += start[i]
    for (let k = 0; k < n; k++) {
      const s = members[k]
      if (!touchable(E, s) || boundingRadius(E, s) > limit) continue
      // start[i] is advanced past each placed entry, then restored below.
      this.entries[start[this.bucketOf(E.x[s], E.y[s], E.z[s])]++] = s
    }
    for (let i = b; i > 0; i--) start[i] = start[i - 1]
    start[0] = 0
  }

  private bucketOf(x: number, y: number, z: number): number {
    const c = this.cell
    return this.bucket(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c))
  }

  private bucket(ix: number, iy: number, iz: number): number {
    if (this.mode === 'dense') return ix - this.x0 + this.nx * (iy - this.y0 + this.ny * (iz - this.z0))
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & this.mask
  }

  /**
   * Collects into `found` the members whose bounding spheres may reach the
   * bounding sphere of entity `slot` during `tick`. Members can appear more
   * than once.
   *
   * A grid built in an earlier tick is exact (it is marked stale whenever its
   * kind may have moved). One built in this tick, while its kind's scripts
   * are moving it, allows for members moving about as far as the fastest one
   * had so far.
   */
  query(E: EntityStore, slot: number, tick: number): void {
    this.foundCount = 0
    for (let k = 0; k < this.largeCount; k++) this.add(this.large[k])
    if (this.mode === 'direct' || this.buckets === 0) return
    const x = E.x[slot]
    const y = E.y[slot]
    const z = E.z[slot]
    const r = boundingRadius(E, slot)
    const margin = tick === this.builtTick ? 2 * this.speed + 1 : 1e-6
    const reach = r + this.maxR + margin
    const c = this.cell
    let x0 = Math.floor((x - reach) / c), x1 = Math.floor((x + reach) / c)
    let y0 = Math.floor((y - reach) / c), y1 = Math.floor((y + reach) / c)
    let z0 = Math.floor((z - reach) / c), z1 = Math.floor((z + reach) / c)
    const start = this.start
    if (this.mode === 'dense') {
      if (x0 < this.x0) x0 = this.x0
      if (y0 < this.y0) y0 = this.y0
      if (z0 < this.z0) z0 = this.z0
      if (x1 >= this.x0 + this.nx) x1 = this.x0 + this.nx - 1
      if (y1 >= this.y0 + this.ny) y1 = this.y0 + this.ny - 1
      if (z1 >= this.z0 + this.nz) z1 = this.z0 + this.nz - 1
    } else if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > this.buckets) {
      // A huge query box is no better than looking at every bucket once.
      for (let k = 0; k < start[this.buckets]; k++) this.add(this.entries[k])
      return
    }
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const b = this.bucket(ix, iy, iz)
          for (let k = start[b]; k < start[b + 1]; k++) this.add(this.entries[k])
        }
      }
    }
  }

  private add(slot: number): void {
    if (this.foundCount === this.found.length) {
      const g = new Int32Array(this.found.length * 2)
      g.set(this.found)
      this.found = g
    }
    this.found[this.foundCount++] = slot
  }
}

/** Visible, alive and not being deleted. */
export function touchable(E: EntityStore, slot: number): boolean {
  return (E.flags[slot] & (F_ALIVE | F_VISIBLE | F_DYING)) === (F_ALIVE | F_VISIBLE)
}
