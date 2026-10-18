import { defineConfig } from 'vitest/config'

/**
 * `npm run bench`: logic benchmarks for the performance scenarios (see bench/).
 * `SCENARIO=AB` runs only some; `PROFILE=<dir>` writes CPU profiles there and
 * `HEAP_PROFILE=<dir>` allocation profiles.
 */
const profile = [
  ...(process.env.PROFILE ? ['--cpu-prof', `--cpu-prof-dir=${process.env.PROFILE}`] : []),
  ...(process.env.HEAP_PROFILE ? ['--heap-prof', `--heap-prof-dir=${process.env.HEAP_PROFILE}`, '--heap-prof-interval=4096'] : []),
]

export default defineConfig({
  test: {
    include: ['bench/**/*.bench.test.ts'],
    pool: 'forks',
    execArgv: ['--expose-gc', ...profile],
    silent: false,
  },
})
