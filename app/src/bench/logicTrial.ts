/**
 * Trial (docs/vm-design.md 10, 14.2): a benchmark scenario drawn full-page,
 * with its logic on the main thread or in a Web Worker, to compare how much
 * of each frame the main thread is busy. Opened with `?bench=A&logic=main`,
 * `logic=worker` (shared snapshots; needs cross-origin isolation) or
 * `logic=post` (snapshots transferred by postMessage).
 */
import * as THREE from 'three'
import { loadProject } from '../engine/project'
import { Runtime, TICK_MS } from '../engine/runtime'
import { findExtension } from '../extensions'
import { loadRapier } from '../extensions/physics'
import { t } from '../i18n'
import { EntityInstances, type PoseSource } from '../stage/instances'
import { addEnvironment } from '../stage/Stage3D'
import type { FromWorker, ToWorker } from '../worker/logic.worker'
import { Snapshot, TripleBuffer } from '../worker/snapshot'
import { scenarioProject, type ScenarioName } from './scenarios'

export type LogicPlace = 'main' | 'worker' | 'post'

/** Frames before measuring, and frames measured. */
const WARMUP_FRAMES = 120
const MEASURED_FRAMES = 600

/** Set on `window.logicTrialResult` once the measured frames are done (for scripts). */
export interface LogicTrialResult {
  fps: number
  /** Main thread ms per frame: median and 95th percentile. */
  mainMedian: number
  mainP95: number
  /** Logic ms per tick and snapshot copy ms per tick, medians. */
  logic: number
  snapshot: number
}

const median = (a: number[]) => percentile(a, 0.5)
function percentile(a: number[], p: number): number {
  const sorted = [...a].sort((x, y) => x - y)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

export function logicPlaceFromUrl(): LogicPlace | null {
  const v = new URLSearchParams(window.location.search).get('logic')
  return v === 'main' || v === 'worker' || v === 'post' ? v : null
}

/** What a frame draws from: the runtime's store, or the newest snapshot from the worker. */
interface FrameSource {
  /** Called at the start of each frame; null until there is something to draw. */
  next(now: number): { source: PoseSource; alpha: number } | null
  logicMs(): number
  /** Copying a snapshot in the worker, ms per tick (0 on the main thread). */
  writeMs(): number
  entities(): number
}

async function mainThread(scenario: ScenarioName): Promise<FrameSource> {
  const rt = new Runtime()
  const project = scenarioProject(scenario)
  for (const id of project.extensions) rt.addExtension(findExtension(id)!)
  if (project.extensions.includes('physics')) await loadRapier()
  loadProject(rt, project)
  rt.greenFlag()
  return {
    next(now) {
      rt.advance(now)
      return { source: rt, alpha: rt.alpha(now) }
    },
    logicMs: () => rt.tickMs,
    writeMs: () => 0,
    entities: () => rt.store.count,
  }
}

function worker(scenario: ScenarioName, transport: 'shared' | 'post'): FrameSource {
  const w = new Worker(new URL('../worker/logic.worker.ts', import.meta.url), { type: 'module' })
  let triple: TripleBuffer | null = null
  let latest: Snapshot | null = null
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'shared') {
      triple = new TripleBuffer(new Int32Array(msg.control), msg.buffers.map((b) => new Snapshot(b, msg.capacity)), 'reader')
    } else {
      if (latest) w.postMessage({ type: 'return', buffer: latest.buffer as ArrayBuffer } satisfies ToWorker, [latest.buffer as ArrayBuffer])
      latest = new Snapshot(msg.buffer, msg.capacity)
    }
  }
  w.postMessage({ type: 'start', scenario, transport } satisfies ToWorker)
  const current = (): Snapshot | null => (triple ? triple.current : latest)
  return {
    next(now) {
      triple?.take()
      const s = current()
      if (!s || s.highWater === 0) return null
      const alpha = Math.max(0, Math.min(1, (performance.timeOrigin + now - s.time) / TICK_MS))
      return { source: { store: s, tick: s.tick }, alpha }
    },
    logicMs: () => current()?.logicMs ?? 0,
    writeMs: () => current()?.writeMs ?? 0,
    entities: () => current()?.count ?? 0,
  }
}

export async function runLogicTrial(root: HTMLElement, scenario: ScenarioName, place: LogicPlace): Promise<void> {
  root.className = 'logic-trial'
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  root.appendChild(renderer.domElement)
  const overlay = document.createElement('div')
  overlay.className = 'perf-overlay'
  root.appendChild(overlay)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#f4f7fb')
  addEnvironment(scene)
  const instances = new EntityInstances(scene)
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
  camera.up.set(0, 0, 1)
  camera.position.set(-190, -360, 290)
  camera.lookAt(0, 0, 0)
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  const lines = [t(`perf.logicPlace.${place}`)]
  if (place === 'worker' && !crossOriginIsolated) {
    overlay.textContent = t('perf.notIsolated')
    return
  }
  const frames = place === 'main' ? await mainThread(scenario) : worker(scenario, place === 'worker' ? 'shared' : 'post')

  let fps = 0
  let busy = 0
  let last = 0
  let shownAt = 0
  let frameCount = 0
  let measureStart = 0
  const samples = { main: [] as number[], logic: [] as number[], snapshot: [] as number[] }
  let result: LogicTrialResult | null = null
  const ms = (v: number) => v.toFixed(2)
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    const start = performance.now()
    if (last > 0) fps = fps === 0 ? 1000 / (now - last) : fps * 0.95 + (1000 / (now - last)) * 0.05
    last = now
    const frame = frames.next(start)
    if (frame) {
      instances.sync(frame.source, frame.alpha)
      renderer.render(scene, camera)
    }
    const spent = performance.now() - start
    busy = busy === 0 ? spent : busy * 0.95 + spent * 0.05
    frameCount++
    if (frameCount === WARMUP_FRAMES) measureStart = now
    if (frameCount > WARMUP_FRAMES && !result) {
      samples.main.push(spent)
      samples.logic.push(frames.logicMs())
      samples.snapshot.push(frames.writeMs())
      if (samples.main.length === MEASURED_FRAMES) {
        result = {
          fps: (MEASURED_FRAMES * 1000) / (now - measureStart),
          mainMedian: median(samples.main),
          mainP95: percentile(samples.main, 0.95),
          logic: median(samples.logic),
          snapshot: median(samples.snapshot),
        }
        ;(window as unknown as { logicTrialResult: LogicTrialResult }).logicTrialResult = result
      }
    }
    if (now - shownAt > 250) {
      shownAt = now
      overlay.replaceChildren(
        ...[
          ...lines,
          t('perf.fps', { fps: fps.toFixed(0) }),
          t('perf.mainThread', { ms: ms(busy) }),
          t('perf.logic', { ms: ms(frames.logicMs()) }),
          ...(place === 'main' ? [] : [t('perf.snapshot', { ms: ms(frames.writeMs()) })]),
          t('perf.entities', { n: frames.entities() }),
          ...(result
            ? [t('perf.trialResult', { fps: result.fps.toFixed(0), median: ms(result.mainMedian), p95: ms(result.mainP95), logic: ms(result.logic) })]
            : []),
        ].map((text) => {
          const div = document.createElement('div')
          div.textContent = text
          return div
        }),
      )
    }
  }
  requestAnimationFrame(loop)
}
