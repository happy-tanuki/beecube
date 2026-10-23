/**
 * Turning about the entity's own axes. Orientation is kept as direction,
 * pitch and roll (R = Rz(90 - direction) · Ry(-pitch) · Rx(roll)); a relative
 * turn composes a rotation about a local axis and reads the angles back.
 *
 * Every orientation has two such readings, (d, p, r) and (d + 180, 180 - p,
 * r + 180). The one nearer the angles before the turn is kept, so turning up
 * carries pitch past 90 (to 180 and on round) as turning right carries
 * direction, instead of flipping direction and roll.
 */
import { wrapDirection } from './ops'
import type { EntityStore } from './store'

const DEG = Math.PI / 180

/** Local axes: x is the heading, y points left, z points up. */
export const ROLL_AXIS = 0
export const PITCH_AXIS = 1
export const YAW_AXIS = 2

/** Row-major rotation matrix. */
const M = new Float64Array(9)

function load(E: EntityStore, i: number): void {
  const a = (90 - E.direction[i]) * DEG
  const b = -E.pitch[i] * DEG
  const c = E.roll[i] * DEG
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cc = Math.cos(c), sc = Math.sin(c)
  M[0] = ca * cb; M[1] = ca * sb * sc - sa * cc; M[2] = ca * sb * cc + sa * sc
  M[3] = sa * cb; M[4] = sa * sb * sc + ca * cc; M[5] = sa * sb * cc - ca * sc
  M[6] = -sb; M[7] = cb * sc; M[8] = cb * cc
}

/** Drops rounding noise, so turning by whole degrees reads back whole degrees. */
function tidy(deg: number): number {
  return wrapDirection(Math.round(deg * 1e9) / 1e9)
}

/** Angle between two directions, in degrees, 0–180. */
function apart(a: number, b: number): number {
  return Math.abs(wrapDirection(a - b))
}

/** Reads M back into direction, pitch and roll, nearest the slot's current angles. */
function store(E: EntityStore, i: number): void {
  const d0 = E.direction[i], p0 = E.pitch[i], r0 = E.roll[i]
  const cb = Math.hypot(M[0], M[3])
  let d: number, p: number, r: number
  if (cb > 1e-9) {
    d = 90 - Math.atan2(M[3], M[0]) / DEG
    p = Math.atan2(M[6], cb) / DEG
    r = Math.atan2(M[7], M[8]) / DEG
    const far = apart(d, d0) + apart(p, p0) + apart(r, r0)
    const near = apart(d + 180, d0) + apart(180 - p, p0) + apart(r + 180, r0)
    if (near < far) {
      d += 180
      p = 180 - p
      r += 180
    }
  } else {
    // Straight up or down: only direction and roll together are known. Keep roll.
    p = M[6] > 0 ? 90 : -90
    r = r0
    const c = r * DEG
    const cc = Math.cos(c), sc = Math.sin(c)
    // Column y of R · Rx(-roll) is (-sin a, cos a, 0).
    d = 90 - Math.atan2(-(M[1] * cc - M[2] * sc), M[4] * cc - M[5] * sc) / DEG
  }
  E.direction[i] = tidy(d)
  E.pitch[i] = tidy(p)
  E.roll[i] = tidy(r)
}

/**
 * Turns an entity by `deg` about one of its own axes, right-handed: positive
 * roll banks right, positive pitch turns down, positive yaw turns left.
 */
export function turnBody(E: EntityStore, i: number, axis: number, deg: number): void {
  load(E, i)
  const t = deg * DEG
  const c = Math.cos(t), s = Math.sin(t)
  // Post-multiplying by a local rotation mixes two columns of R.
  const [u, v] = axis === ROLL_AXIS ? [1, 2] : axis === PITCH_AXIS ? [2, 0] : [0, 1]
  for (let row = 0; row < 9; row += 3) {
    const mu = M[row + u], mv = M[row + v]
    M[row + u] = mu * c + mv * s
    M[row + v] = mv * c - mu * s
  }
  store(E, i)
}

/** Sets an entity's orientation from a unit quaternion, nearest its current angles. */
export function setRotation(E: EntityStore, i: number, x: number, y: number, z: number, w: number): void {
  M[0] = 1 - 2 * (y * y + z * z); M[1] = 2 * (x * y - z * w); M[2] = 2 * (x * z + y * w)
  M[3] = 2 * (x * y + z * w); M[4] = 1 - 2 * (x * x + z * z); M[5] = 2 * (y * z - x * w)
  M[6] = 2 * (x * z - y * w); M[7] = 2 * (y * z + x * w); M[8] = 1 - 2 * (x * x + y * y)
  store(E, i)
}
