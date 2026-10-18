/**
 * Logic benchmarks for scenarios A–E (src/bench/scenarios.ts). Run with
 * `npm run bench`. Prints milliseconds per tick and garbage collection
 * during the measured ticks; rendering is measured in the app (`?bench=A`).
 */
import { PerformanceObserver } from 'node:perf_hooks'
import { it } from 'vitest'
import { SCENARIO_ENTITIES, SCENARIOS, scenarioProject, type ScenarioName } from '../src/bench/scenarios'
import { loadProject } from '../src/engine/project'
import { Runtime } from '../src/engine/runtime'
import { findExtension } from '../src/extensions'
import { loadRapier } from '../src/extensions/physics'

const WARMUP_TICKS = Number(process.env.WARMUP ?? 120)
const MEASURED_TICKS = 300

const gc = (globalThis as { gc?: () => void }).gc

async function measure(name: ScenarioName) {
  const project = scenarioProject(name)
  const rt = new Runtime()
  for (const id of project.extensions) rt.addExtension(findExtension(id)!)
  if (project.extensions.includes('physics')) await loadRapier()
  loadProject(rt, project)
  rt.greenFlag()
  rt.step()
  // Physics commands wait for the world on their first use.
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < WARMUP_TICKS; i++) rt.step()

  gc?.()
  const pauses: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) pauses.push(e.duration)
  })
  observer.observe({ entryTypes: ['gc'] })
  const heapBefore = process.memoryUsage().heapUsed
  const times: number[] = []
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const t = performance.now()
    rt.step()
    times.push(performance.now() - t)
  }
  const heapAfter = process.memoryUsage().heapUsed
  await new Promise((r) => setTimeout(r, 0))
  observer.disconnect()
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  return {
    scenario: name,
    entities: rt.store.count,
    target: SCENARIO_ENTITIES[name],
    'mean ms/tick': +mean.toFixed(2),
    'p95 ms': +times[Math.floor(times.length * 0.95)].toFixed(2),
    'max ms': +times[times.length - 1].toFixed(2),
    'GCs': pauses.length,
    'max GC ms': +(pauses.length ? Math.max(...pauses) : 0).toFixed(2),
    'heap KB/tick': pauses.length ? '(gc ran)' : +((heapAfter - heapBefore) / 1024 / MEASURED_TICKS).toFixed(1),
  }
}

it('scenarios', async () => {
  const only = (process.env.SCENARIO ?? '').toUpperCase()
  const rows = []
  for (const name of SCENARIOS) {
    if (only && !only.includes(name)) continue
    rows.push(await measure(name))
  }
  console.table(rows)
}, 600_000)
