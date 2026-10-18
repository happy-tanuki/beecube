/** Seedable pseudo-random numbers (mulberry32), so runs can be repeated exactly. */
export class Random {
  private state = 0

  constructor(seed = 0) {
    this.seed(seed)
  }

  seed(seed: number): void {
    this.state = seed >>> 0
  }

  /** A number in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
