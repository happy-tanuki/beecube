/**
 * Trial: "touching (sprite)?" in JS and in wasm (src/bench/touchingTrial.ts).
 * Run with `npm run bench -- wasm`.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { measureTouching } from '../src/bench/touchingTrial'

it('touching: JS and wasm', async () => {
  const r = await measureTouching(readFileSync(new URL('../wasm/collision/collision.wasm', import.meta.url)))
  const ms = (v: number) => +v.toFixed(3)
  console.table([
    { what: 'whole tick (JS engine)', 'ms/tick': ms(r.tick) },
    { what: 'touching, JS', 'ms/tick': ms(r.js) },
    { what: 'copy columns to wasm', 'ms/tick': ms(r.upload) },
    { what: 'touching, wasm, one call per entity', 'ms/tick': ms(r.wasmEach) },
    { what: 'touching, wasm, one call per tick', 'ms/tick': ms(r.wasmBatch) },
  ])
  console.log(`${r.balls} balls, ${r.walls} walls`)
  expect(r.mismatches).toBe(0)
}, 600_000)
