/**
 * Trial (docs/vm-design.md 10): runs a benchmark scenario's logic in a Web
 * Worker and hands each tick's entity columns to the page, either through
 * shared snapshots (TripleBuffer) or by transferring buffers.
 */
import { scenarioProject, type ScenarioName } from '../bench/scenarios'
import { loadProject } from '../engine/project'
import { Runtime, TICK_MS } from '../engine/runtime'
import { findExtension } from '../extensions'
import { loadRapier } from '../extensions/physics'
import { Snapshot, snapshotBytes, TripleBuffer } from './snapshot'

export type Transport = 'shared' | 'post'

export type ToWorker =
  | { type: 'start'; scenario: ScenarioName; transport: Transport }
  /** Post transport: a snapshot buffer the page is done with. */
  | { type: 'return'; buffer: ArrayBuffer }

export type FromWorker =
  | { type: 'shared'; capacity: number; buffers: SharedArrayBuffer[]; control: SharedArrayBuffer }
  | { type: 'frame'; capacity: number; buffer: ArrayBuffer }

/** The worker's global scope (the DOM typings describe a window's). */
const scope = self as unknown as {
  onmessage: (e: MessageEvent<ToWorker>) => void
  postMessage(message: FromWorker, transfer?: Transferable[]): void
}
/** Post transport: buffers free to write. */
const free: ArrayBuffer[] = []

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'return') {
    free.push(msg.buffer)
    return
  }
  const rt = new Runtime()
  const project = scenarioProject(msg.scenario)
  for (const id of project.extensions) rt.addExtension(findExtension(id)!)
  if (project.extensions.includes('physics')) await loadRapier()
  loadProject(rt, project)
  rt.greenFlag()

  const capacity = rt.store.capacity
  const bytes = snapshotBytes(capacity)
  let publish: (logicMs: number, time: number) => void
  if (msg.transport === 'shared') {
    const buffers = [0, 1, 2].map(() => new SharedArrayBuffer(bytes))
    const control = new SharedArrayBuffer(4)
    new Int32Array(control)[0] = 1
    const triple = new TripleBuffer(new Int32Array(control), buffers.map((b) => new Snapshot(b, capacity)), 'writer')
    publish = (logicMs, time) => {
      triple.current.write(rt.store, rt.tick, time, logicMs)
      triple.publish()
    }
    scope.postMessage({ type: 'shared', capacity, buffers, control } satisfies FromWorker)
  } else {
    for (let k = 0; k < 3; k++) free.push(new ArrayBuffer(bytes))
    publish = (logicMs, time) => {
      // Skipped while the page holds every buffer: it draws an older tick.
      const buffer = free.pop()
      if (!buffer) return
      new Snapshot(buffer, capacity).write(rt.store, rt.tick, time, logicMs)
      scope.postMessage({ type: 'frame', capacity, buffer } satisfies FromWorker, [buffer])
    }
  }

  let logicMs = 0
  const loop = () => {
    const now = performance.now()
    const before = rt.tick
    rt.advance(now)
    const ticks = rt.tick - before
    if (ticks > 0) {
      const ms = (performance.now() - now) / ticks
      logicMs = logicMs === 0 ? ms : logicMs * 0.9 + ms * 0.1
      // The time the last tick stands for, comparable with the page's clock.
      publish(logicMs, performance.timeOrigin + now - rt.alpha(now) * TICK_MS)
    }
    const wait = TICK_MS - rt.alpha(performance.now()) * TICK_MS
    setTimeout(loop, Math.max(0, wait))
  }
  loop()
}
