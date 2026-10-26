# The app

A Scratch-like block editor where sprites are 3D objects on a 3D stage.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (vitest, Node)
npm run test:browser   # rendering tests in headless Chrome (needs Google Chrome)
npm run bench    # logic benchmarks for the performance scenarios
npm run bench -- wasm  # trial: "touching" in JS and in wasm
npm run build
```

## Layout

| Path | Role |
|---|---|
| `src/engine/` | Runtime, independent of the DOM; see [docs/vm-design.md](../docs/vm-design.md). `store.ts` keeps every entity (sprite or clone) in typed-array columns; `ir.ts` → `analyze.ts` → `codegen.ts` compile Blockly JSON to JavaScript source; `runtime.ts` runs fixed 60 Hz ticks. |
| `src/stage/` | Three.js view of the entity store. `instances.ts` draws entities (one `InstancedMesh` per shape, matrices built in the vertex shader) and only reads the store's columns; `environment.ts` draws the current backdrop (the scenery, a color or a 360° image; the stage's box with its pictures; and the grid) and the lights; `Stage3D.ts` adds the scene, pen, bubbles and Tinkercad-style manipulation. Blocks never call into it. |
| `src/bench/` | Benchmark projects for the performance scenarios A–E, and trials: `?bench=A&logic=main\|worker\|post` draws a scenario with its logic on the main thread or in a Web Worker (`src/worker/`); `touchingTrial.ts` compares "touching" in JS and wasm. |
| `wasm/collision/` | Trial: "touching" in Rust compiled to wasm. `collision.wasm` is committed; `build.sh` rebuilds it (Rust with the `wasm32-unknown-unknown` target). |
| `src/blocks/` | scratch-blocks setup: theme, locale, the added 3D blocks, toolbox. |
| `src/ui/` | React UI (editor, stage panel, sprite pane). `StageView.tsx` is the stage with its buttons, shared with the player. `pictures.ts` turns image files into backdrop pictures and 360° scenery; `projectFile.ts` reads and writes `.beecube` files; `assetStorage.ts` keeps the autosaved project's pictures in IndexedDB. |
| `public/library/` | The scenery library's 360° images (CC0, and the moon drawn by `scripts/moon.js`), re-encoded by `scripts/make-scenery-library.mjs`, and the room library's pictures, drawn by `scripts/make-room-library.mjs` (see its README). |
| `src/admin/` | The moderation page (`admin.html`) for reported and hidden shared projects. |
| `src/player/` | The share page (`play.html`): a project's stage, title and notes, for phones too, without loading scratch-blocks. `play.html?sample=<id>` opens `public/samples/<id>.json`. |
| `src/i18n/` | UI languages. `en.ts` defines the message keys; each other locale (`ja.ts`, ...) must translate all of them. The language follows the browser and can be changed from the menu bar. |
| `test/` | Engine and renderer tests in Node; they run ticks directly. `test/browser/` runs in headless Chrome (WebGL). |
| `bench/` | `npm run bench` (logic times per scenario). |

## Coordinates

x/y span the workplane (480×360, as the Scratch stage), z is height.
`direction` follows Scratch (90 = +x); `pitch` is elevation (+90 = up);
`roll` turns a sprite about its heading. `move steps` follows direction and
pitch.

## Scratch features

Besides the usual motion/looks/events/control/sensing/operators/variables/pen
blocks: messages, lists, sprite-only variables and lists, clones (30,000 by
default, a project setting; removed on stop), custom blocks with "run without
screen refresh", and monitors (palette checkboxes for variables and
sprite/sensing reporters). Not yet: sounds, costumes.

## Engine

Blocks look and combine as in Scratch, but the runtime works like a game
engine (details in [docs/vm-design.md](../docs/vm-design.md)):

- Logic runs in fixed 60 Hz ticks; drawing interpolates between ticks. Time
  (waits, glides, the timer) is logical time, so runs repeat exactly with a
  random seed (`settings.randomSeed` in the project file).
- A loop iteration takes one tick when its body waits or changes something
  visible; loops that only compute finish at once. "Forever" always takes one
  tick per iteration. A loop that never ends freezes the page.
- Broadcasts and "when I start as a clone" start scripts in the next tick.
- Typed-in text that reads as a number (`10`, not `007`) is a number.
- Entities are columns in `rt.store`, indexed by slot. Original sprites are
  `Sprite` objects (`rt.sprites`) whose properties read and write their slot;
  `rt.entities()` lists clones too.

## 3D sensing

`touching` tests the actual shapes (cube, sphere, cone, cylinder, with size
and rotation) using GJK in `src/engine/collision.ts`, after a per-sprite
spatial grid has narrowed down the clones nearby. The "edge" is the
workplane's four walls plus the floor (z = 0); `if on edge, bounce` reflects
off both. `distance to` measures between centers in 3D.

## Projects

File > Save downloads `project.beecube.json` (format in `src/engine/project.ts`:
sprites with their Blockly workspace JSON, variables with values, broadcast
messages, settings such as the clone limit). The current project is also autosaved to `localStorage` every few
seconds and restored on reload; File > New resets it.

## Sharing

Sharing runs on Cloudflare Pages: the built app plus Pages Functions
(`functions/`), which call the API in `server/api.ts` (routes are listed at its
top). Shared projects' metadata is in D1 (`migrations/`), their JSON in R2.
The design and the safety measures for a young audience are in
[docs/sharing.md](../docs/sharing.md).

Locally:

```sh
npm run db:migrate:local      # once: create the local D1 tables
# secrets for local use, and Turnstile's test keys (they always pass)
printf 'ADMIN_TOKEN=some-local-token\nTURNSTILE_SECRET=1x0000000000000000000000000000000AA\nTURNSTILE_SITE_KEY=1x00000000000000000000AA\n' > .dev.vars
npm run build && npm run pages:dev   # app + API on http://localhost:8788
npm run dev                   # optional: the Vite dev server proxies /api to 8788
```

`npm test` includes the API tests (`server/api.test.ts`), which run against
local D1 and R2 through wrangler.

## Extensions

An extension is data plus functions (`src/engine/extension.ts`):

```ts
export const myExtension: ExtensionSpec = {
  id: 'demo',
  name: { ja: 'デモ', en: 'Demo' },
  colours: ['#E0457B', '#CC3A6C', '#B8325F'],
  blocks: [
    {
      opcode: 'jump',
      type: 'command',
      text: { ja: '[H] の高さにジャンプ', en: 'jump [H] high' },
      args: { H: { type: 'number', default: 50 } },
      // Return a Promise to make the script wait; other scripts keep running.
      // `slot` indexes rt.store during this call; keep `entity` (a handle) across awaits.
      run: async ({ H }, { rt, slot, entity }) => { /* ... */ },
    },
  ],
  afterScripts: (rt, dt) => { /* runs every tick after scripts */ },
}
```

Blocks get the opcode `<id>_<opcode>`. Hats are started (next tick) with
`rt.startHats(opcode, menuValues, entity)`. Built-in extensions are listed in
`src/extensions/index.ts` and added from the Extensions menu; a project file
records which ones it uses.

### Physics (`src/extensions/physics.ts`)

Rapier 3D (Apache-2.0), loaded on demand. Sprites and clones opt in with
"set physics to moving / fixed / off". Each tick the world steps after
scripts have run and writes poses back to the store (including `roll`, so
things can tumble); moving a sprite with ordinary blocks teleports its body. Floor at z = 0,
walls at the stage edges (can be turned off). The stop button pauses the
simulation.

## Licensing notes

- The project is MIT-licensed (see the repository's LICENSE).
- scratch-blocks and Rapier are Apache-2.0; keep their notices when distributing (the build writes them into `licenses.txt`). Block translations come from scratch-l10n 4.0.46, its last BSD-3-Clause release (later ones are AGPL-3.0, so don't upgrade it); scratch-blocks is built from its source so that only those translations, for the app's languages, are included (`src/blocks/l10n.ts`).
- No code is copied from the scratch-editor monorepo; it is referenced for behavior only.
- "Scratch" is a trademark of the Scratch Foundation. BeeCube is not affiliated with it; don't use Scratch's name or marks for the product.

## Performance

`npm run bench` runs the scenario projects of docs/vm-design.md (1) without
rendering and prints milliseconds per tick and garbage collections
(`SCENARIO=AB` for some, `PROFILE=<dir>` / `HEAP_PROFILE=<dir>` for V8
profiles). In the app, `?bench=A` (… `E`) opens a scenario instead of your
project (it is not autosaved) and `?perf` shows logic and drawing times.
