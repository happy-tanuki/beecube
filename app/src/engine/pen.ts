import type { EntityStore } from './store'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Values per stamp in `PenBuffer.stampPoses`. */
export const STAMP_POSE = 7

/**
 * Pen strokes as 3D line segments, and stamps, in growable typed arrays. Both
 * are only appended, so the stage uploads the new ones; `clears` counts
 * clears so it knows when to start over.
 */
export class PenBuffer {
  /** x,y,z of the start then end of each segment. */
  positions = new Float32Array(6 * 256)
  /** r,g,b (0–1) for the start then end of each segment. */
  colors = new Float32Array(6 * 256)
  /** Pen size and opacity (0–1) of each segment. */
  styles = new Float32Array(2 * 256)
  segmentCount = 0

  /** x, y, z, direction, pitch, roll and size of each stamp. */
  stampPoses = new Float32Array(STAMP_POSE * 64)
  /** Index into SHAPES. */
  stampShapes = new Uint8Array(64)
  /** 0xRRGGBB */
  stampColors = new Uint32Array(64)
  stampCount = 0

  clears = 0

  /** Adds a segment drawn with entity `i`'s pen. */
  addSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, E: EntityStore, i: number): void {
    if ((this.segmentCount + 1) * 6 > this.positions.length) this.grow()
    const o = this.segmentCount * 6
    const p = this.positions
    p[o] = ax
    p[o + 1] = ay
    p[o + 2] = az
    p[o + 3] = bx
    p[o + 4] = by
    p[o + 5] = bz
    const rgb = E.penColor[i]
    const r = ((rgb >> 16) & 0xff) / 255
    const g = ((rgb >> 8) & 0xff) / 255
    const b = (rgb & 0xff) / 255
    const c = this.colors
    c[o] = c[o + 3] = r
    c[o + 1] = c[o + 4] = g
    c[o + 2] = c[o + 5] = b
    this.styles[this.segmentCount * 2] = E.penSize[i]
    this.styles[this.segmentCount * 2 + 1] = 1 - E.penTransparency[i] / 100
    this.segmentCount++
  }

  /** Draws with entity `i`'s pen from where it is to (x, y, z). */
  lineFrom(E: EntityStore, i: number, x: number, y: number, z: number): void {
    this.addSegment(E.x[i], E.y[i], E.z[i], x, y, z, E, i)
  }

  /** Adds a closed polyline through `points`. */
  addLoop(points: Vec3[], E: EntityStore, i: number): void {
    for (let k = 0; k < points.length; k++) {
      const a = points[k]
      const b = points[(k + 1) % points.length]
      this.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, E, i)
    }
  }

  /** Leaves a copy of entity `i`'s shape where it is. */
  stamp(E: EntityStore, i: number): void {
    if (this.stampCount === this.stampShapes.length) this.growStamps()
    const n = this.stampCount++
    const p = this.stampPoses
    const o = n * STAMP_POSE
    p[o] = E.x[i]
    p[o + 1] = E.y[i]
    p[o + 2] = E.z[i]
    p[o + 3] = E.direction[i]
    p[o + 4] = E.pitch[i]
    p[o + 5] = E.roll[i]
    p[o + 6] = E.size[i]
    this.stampShapes[n] = E.shape[i]
    this.stampColors[n] = E.color[i]
  }

  clear(): void {
    this.segmentCount = 0
    this.stampCount = 0
    this.clears++
  }

  private grow(): void {
    const positions = new Float32Array(this.positions.length * 2)
    positions.set(this.positions)
    this.positions = positions
    const colors = new Float32Array(this.colors.length * 2)
    colors.set(this.colors)
    this.colors = colors
    const styles = new Float32Array(this.styles.length * 2)
    styles.set(this.styles)
    this.styles = styles
  }

  private growStamps(): void {
    const poses = new Float32Array(this.stampPoses.length * 2)
    poses.set(this.stampPoses)
    this.stampPoses = poses
    const shapes = new Uint8Array(this.stampShapes.length * 2)
    shapes.set(this.stampShapes)
    this.stampShapes = shapes
    const colors = new Uint32Array(this.stampColors.length * 2)
    colors.set(this.stampColors)
    this.stampColors = colors
  }
}
