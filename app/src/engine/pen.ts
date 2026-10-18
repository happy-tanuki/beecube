export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Pen strokes as 3D line segments in growable typed arrays. Segments are only
 * appended, so the stage uploads the new ones; `clears` counts clears so it
 * knows when to start over.
 */
export class PenBuffer {
  /** x,y,z of the start then end of each segment. */
  positions = new Float32Array(6 * 256)
  /** r,g,b (0–1) for the start then end of each segment. */
  colors = new Float32Array(6 * 256)
  segmentCount = 0
  clears = 0

  addSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, rgb: number): void {
    if ((this.segmentCount + 1) * 6 > this.positions.length) this.grow()
    const o = this.segmentCount * 6
    const p = this.positions
    p[o] = ax
    p[o + 1] = ay
    p[o + 2] = az
    p[o + 3] = bx
    p[o + 4] = by
    p[o + 5] = bz
    const r = ((rgb >> 16) & 0xff) / 255
    const g = ((rgb >> 8) & 0xff) / 255
    const b = (rgb & 0xff) / 255
    const c = this.colors
    c[o] = c[o + 3] = r
    c[o + 1] = c[o + 4] = g
    c[o + 2] = c[o + 5] = b
    this.segmentCount++
  }

  /** Adds a closed polyline through `points`. */
  addLoop(points: Vec3[], rgb: number): void {
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      this.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, rgb)
    }
  }

  clear(): void {
    this.segmentCount = 0
    this.clears++
  }

  private grow(): void {
    const positions = new Float32Array(this.positions.length * 2)
    positions.set(this.positions)
    this.positions = positions
    const colors = new Float32Array(this.colors.length * 2)
    colors.set(this.colors)
    this.colors = colors
  }
}
