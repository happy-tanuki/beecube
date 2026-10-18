/**
 * Trial (docs/vm-design.md 14.3): "touching (sprite)?" in JS against the same
 * test compiled to wasm (wasm/collision), on scenario B's entities. Runs in
 * Node (`npm run bench -- wasm`) and in a browser.
 */
import type { Lib } from '../engine/lib'
import { loadProject } from '../engine/project'
import { Runtime } from '../engine/runtime'
import { CollisionWasm } from './collisionWasm'
import { scenarioProject } from './scenarios'

export interface TouchingTrialResult {
  /** Milliseconds per tick. */
  tick: number
  js: number
  upload: number
  wasmEach: number
  wasmBatch: number
  balls: number
  walls: number
  /** Entities whose result differed from JS, over all ticks (should be 0). */
  mismatches: number
}

export async function measureTouching(wasmBytes: BufferSource, warmup = 120, measured = 300): Promise<TouchingTrialResult> {
  const wasm = await CollisionWasm.load(wasmBytes)
  const rt = new Runtime()
  loadProject(rt, scenarioProject('B'))
  rt.greenFlag()
  for (let t = 0; t < warmup; t++) rt.step()
  const E = rt.store
  const [walls, balls] = rt.kinds
  // The engine's own "touching", which uses the walls' grid (built in an earlier tick).
  const L = (rt as unknown as { lib: Lib }).lib
  wasm.reserve(E.capacity, 1)
  const js = new Uint8Array(balls.count)
  const batch = new Uint8Array(balls.count)
  const single = new Uint8Array(balls.count)
  const time = { tick: 0, js: 0, upload: 0, wasmEach: 0, wasmBatch: 0 }
  let mismatches = 0

  for (let t = 0; t < warmup + measured; t++) {
    const counted = t >= warmup
    const lap = (key: keyof typeof time, since: number) => {
      if (counted) time[key] += performance.now() - since
    }
    let t0 = performance.now()
    rt.step()
    lap('tick', t0)
    // Built in an earlier tick, as the walls' grid is in the scenario.
    const built = rt.tick - 1
    const tick = rt.tick
    const n = balls.count
    const members = balls.members

    t0 = performance.now()
    for (let k = 0; k < n; k++) js[k] = L.touchingKind(members[k], walls) ? 1 : 0
    lap('js', t0)

    t0 = performance.now()
    wasm.upload(E)
    lap('upload', t0)

    t0 = performance.now()
    wasm.build(0, walls.members, walls.count, built)
    for (let k = 0; k < n; k++) single[k] = wasm.touching(0, members[k], tick) ? 1 : 0
    lap('wasmEach', t0)

    t0 = performance.now()
    wasm.build(0, walls.members, walls.count, built)
    wasm.touchingBatch(0, members, n, tick, batch)
    lap('wasmBatch', t0)

    for (let k = 0; k < n; k++) if (single[k] !== js[k] || batch[k] !== js[k]) mismatches++
  }
  const per = (ms: number) => ms / measured
  return {
    tick: per(time.tick),
    js: per(time.js),
    upload: per(time.upload),
    wasmEach: per(time.wasmEach),
    wasmBatch: per(time.wasmBatch),
    balls: balls.count,
    walls: walls.count,
    mismatches,
  }
}
