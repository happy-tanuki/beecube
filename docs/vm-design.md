# VM design

Settled on 2026-10-16. This document records the decisions for the runtime
("VM") that runs block scripts. The discussion that led to them is kept in
local working notes and is not part of the repository.

## 1. Scope

**Scratch on the outside, a game engine on the inside: an easy-to-use 3D game engine.**

- The blocks, how they are put together, and ideas such as the green flag,
  "forever" and clones stay as in Scratch.
- The execution model does not imitate Scratch's VM. Like a game engine, it
  advances in fixed time steps and updates all entities together.
- Compatibility with Scratch (.sb3 files, exact timing of execution) is not a goal.

### Performance targets

The clone limit goes from **300** to **3,000–30,000**. The range is wide
because the work per clone depends on its scripts, so the targets are set per
scenario:

| Scenario | Clones | Target |
|---|---|---|
| A. Simple movement ("forever: move, turn, if on edge bounce") | 30,000 | 60 fps. Logic ≤ 4 ms/tick, rendering ≤ 8 ms/frame |
| B. A plus "touching (another sprite)?" checks | 10,000 | 60 fps. Logic ≤ 6 ms/tick |
| C. Physics (Rapier dynamic bodies) | 3,000 | 60 fps |
| D. Scripts with waiting blocks ("wait 1 seconds", "wait until") | 30,000 | Logic ≤ 4 ms/tick |
| E. Creating and deleting every tick (bullet patterns) | 10,000 alive, 500 created and 500 deleted per tick | No GC hitches |

- Reference machine: Chrome on a mid-range 2021 laptop (about an M1 MacBook Air).
- The clone limit is a project setting, 30,000 by default. It remains a
  safety net against runaway clone loops.

## 2. Principles

1. **Per-frame model**: a script is mostly a function that runs to the end
   within one tick. Only code that spans time becomes a state machine.
2. **Data-oriented (ECS)**: entity state (sprites and clones) is kept in
   columns of typed arrays (SoA). A script compiles to a loop over all
   entities that are running it.
3. **Static types**: values have types; where a type is known, no conversion
   code is generated.
4. **Generated JS source**: blocks compile to JavaScript source text run with
   `new Function`. No closure composition, no generators.
5. **Thread state is data**: where a script is (program counter, wake-up
   time, loop counters) lives in arrays, not on the JS stack.
6. **Deterministic execution**: logic advances in fixed 60 Hz steps and
   random numbers come from a seedable generator.
7. **No allocation on hot paths**: no objects, closures or string lookups per
   entity per tick.

5 and 6 are the hardest to add later, so they are in from the start.

## 3. Data model

### 3.1 Entity store

Entities are stored as columns indexed by **slot**:

```ts
class EntityStore {
  capacity: number
  highWater: number        // slots 0..highWater-1 have been used
  // pose (Float64: logic precision; the renderer copies it to Float32 attributes)
  x, y, z, direction, pitch, roll, size: Float64Array
  // the pose at the start of the tick, for interpolation
  px, py, pz, pdirection, ppitch, proll, psize: Float64Array
  // looks
  color: Uint32Array       // 0xRRGGBB
  penColor: Uint32Array
  // the pen color's parts (0–100) and the pen size
  penHue, penSaturation, penBrightness, penTransparency, penSize: Float64Array
  shape: Uint8Array        // ShapeKind index
  flags: Uint8Array        // alive, visible, pen down, clone, dying
  kind: Uint16Array        // the original sprite whose scripts the entity runs
  generation: Uint32Array
  saying: (string | null)[]
}
```

- A slot never moves while its entity lives. Deleted slots go on a free list
  and are reused. Iteration (scripts, collision, rendering) is in slot order
  or in per-kind member lists, so it is deterministic.
- Capacity is reserved up front for the original sprites plus the clone limit
  (about 140 bytes per entity: 4 MB at 30,000). Columns therefore never move
  while scripts run, so generated code can load them into local variables.
  The store is only reallocated between ticks (when sprites are added or the
  limit changes).
- References kept across time ("the clone just created", "the sprite I hit",
  a sprite stored in a variable) are **handles**: slot plus generation. A
  handle whose generation no longer matches refers to nobody.
- The renderer keeps its own dense, per-shape instance lists (see 8), so
  holes in the slot range cost nothing there.

### 3.2 Boundary with the editor

- The editor (React) deals with original sprites only.
- An original sprite is a `Sprite` object holding its definition (id, name,
  blocks, variable definitions) and the slot of its entity. Its pose and
  looks properties read and write that slot, so the editor always shows and
  edits the live state.
- As in Scratch, the state stays where the scripts left it when they stop;
  the project file saves the current state.

### 3.3 Variables

| Kind | Storage |
|---|---|
| For all sprites | `globals: Float64Array` (numbers) and `globalRefs: Value[]` (everything else). Positions are assigned at compile time |
| For this sprite only | Per kind, one column per variable: `Float64Array(capacity)` for numbers, `Array(capacity)` otherwise |
| Custom block arguments, temporaries | Local variables of the generated JS. Values that must survive a wait live in the script's instance columns (4.4) |

Variables are never looked up by name at run time.

## 4. Execution model

### 4.1 One tick

Logic runs at a fixed 60 Hz. Rendering happens once per browser frame and
interpolates between the poses at the start and end of the last tick.

```
1. Copy the pose columns to the "previous pose" columns (for interpolation)
2. Confirm the clones created during the previous tick (their "when I start as a clone" is queued)
3. Process events (green flag, keys, messages, clicks, collision events → start scripts)
4. Run scripts (kind order → script order → entity order)
5. Step physics (Rapier); collision events are queued for the next tick's step 3
6. Remove the clones deleted during this tick
```

- The order is fixed: the same inputs give the same results.
- Clones are created immediately (their state is copied at the "create
  clone" block) but their scripts start in the next tick, and deleted clones
  are removed at the end of the tick. Lists being iterated never change.
- "Broadcast" is queued; receivers start in the next tick's step 3.
- Logical time is the tick count / 60. "Wait", "glide", the timer and every
  other time-based block use it, never the wall clock.

### 4.2 Script classes

The compiler puts each script into one of three classes. Users never see this.

| Class | Condition | How it runs |
|---|---|---|
| **Immediate** | Nothing that can wait or span ticks | A plain loop over the entities that started it; they all finish in that tick |
| **Per frame** | Ends with "forever" whose body never waits or yields | The part before "forever" runs as immediate or state machine code; on reaching "forever" the entity joins the script's per-frame list |
| **State machine** | Anything else | A function that advances each entity's state (4.4) |

The per-frame part compiles to one loop over all entities in the list:

```js
// "forever: move 10 steps, if on edge bounce", roughly
function forever(rt, list, n) {
  const X = E.x, Y = E.y, D = E.direction
  for (let k = 0; k < n; k++) {
    const i = list[k]
    const r = D[i] * DEG
    X[i] += 10 * Math.sin(r)
    Y[i] += 10 * Math.cos(r)
    L.bounce(i)
  }
}
```

The performance targets (scenarios A and D) assume this form.

### 4.3 Loops and waiting

The aim is that scripts behave as they look, and that common Scratch
patterns give the same results.

- **One loop iteration = one tick**: "repeat 10: move 10 steps" moves over
  10 ticks (an animation), as in Scratch.
- **Pure computation runs at once**: a loop whose body has no waiting block
  and nothing visible runs to the end within the tick. Scratch also keeps
  looping until something needs a redraw, so the results are nearly the same.
  - Visible effects are motion, looks and pen blocks, extension commands, and
    custom blocks that contain any of these.
  - A "repeat until" also yields once per iteration when its condition can
    only be changed from outside: when it reads sensing values (touching,
    keys, mouse, timer, "of"), its own position, extension reporters, or a
    variable or list that the loop body does not change. So "repeat until
    (key pressed)" waits for the key instead of hanging.
  - There is no cap on iterations per tick. A loop that never ends does not
    end. While logic runs on the main thread such a loop freezes the page
    (the stop button cannot run); once logic moves to a Web Worker (10) the
    worker can be terminated and restarted.
- **"Run without screen refresh" custom blocks**: every loop inside runs at
  once (waiting blocks still wait).
- **"Forever"**: one iteration per tick, whatever its body, even inside
  "run without screen refresh". (Scratch can run a computation-only
  "forever" until 75% of the frame is used; this is not imitated.)
- **Waiting blocks**: "wait (n) seconds", "wait until", "broadcast and
  wait", "say for (n) seconds", "glide", extension commands that return a
  Promise, and calls to custom blocks that contain any of these.
- "Wait (n) seconds" waits a whole number of ticks, at least one.

### 4.4 State machines and instance state

A state-machine script is cut at the points where it can stop, and compiles
to a `switch (pc)`.

- Each script has at most one **instance** per entity (as in Scratch, the
  same script does not run twice on one entity; restarting starts over).
- Instance state is per script, in columns indexed by slot:

```ts
interface ScriptInstances {
  pc: Int32Array        // -1 = not running, -2 = in the per-frame list
  wake: Float64Array    // tick at which to resume
  num: Float64Array[]   // numeric locals that survive a wait (loop counters, glide start, ...)
  obj: unknown[][]      // other locals (custom block frames, pending broadcasts, Promises)
  list: Int32Array      // running entities, densely packed, in start order
  flist: Int32Array     // entities in the per-frame part
}
```

- The columns grow only between ticks (scripts start only in step 3), so
  code running in step 4 can keep them in locals.

- An instance that is not due yet is skipped with one comparison.
- Custom blocks without waiting blocks compile to plain JS functions
  (recursion uses the JS stack). Custom blocks that can wait compile to state
  machines of their own; each call takes a frame (pc, locals, arguments)
  from a per-block pool, so recursion works and no garbage is produced.
- "Stop this script" inside a custom block returns from that block, as in Scratch.
- States are cut at block boundaries, so a program counter can be mapped
  back to a block (the map is not recorded yet). This is the basis for a
  rewinding debugger, finer live editing and saving running state.

### 4.5 Event index

Hat blocks are indexed at compile time as "event → (kind, script) list".
Starting scripts for a message or key never scans all scripts.

### 4.6 Compiling and editing while running

- Blocks are parsed per kind and only changed kinds are parsed again.
- Types (5) are inferred over the whole project. If the storage layout
  (which variables are numeric) does not change, only changed kinds are
  recompiled; otherwise everything is.
- Running instances of a script whose blocks did not change move to the new
  code.
- Running instances of an edited script also move to the new code, so edits
  take effect at once (as in Scratch): each continues at the block it was
  waiting in (a wait, a loop that yields, a "forever", a glide and so on),
  found by block id, and keeps the locals of blocks that still exist (such
  as a repeat's count).
- Instances that cannot move (the block they wait in was removed, or a
  custom block that waits is in progress) keep running their old code to the
  end, unless the storage layout changed, in which case they are stopped
  (their code would read the wrong storage).

## 5. Types

### 5.1 Value types

| Type | JS representation | Notes |
|---|---|---|
| Number | `number` | |
| Text | `string` | |
| Boolean | `boolean` | |
| Vector | Three numbers in locals, or three elements of a `Float64Array` | Position, velocity and so on as one value (later) |
| Sprite reference | `EntityRef`: a small immutable object holding the handle and the sprite's name, one per entity, reused | Reads as the sprite's name, and as 0 for numbers; two are equal when they name the same entity; saved as the name |
| List | A JS array. A list that only ever holds numbers stays an array of doubles, which V8 stores unboxed | See 5.2 for how the item type is decided |

- Numbers, text and booleans convert into each other. The compiler adds a
  conversion only where the type changes: putting an "answer" (text) into
  "+" adds `toNumber` there and nowhere else.
- Text typed into an input that reads as a number in canonical form (`10`,
  `-2.5`, but not `007` or `1.0`) is a number constant.
- Vectors and lists will be kept out of inputs that do not accept them by
  Blockly connection checks. Sprite references may go wherever a value can,
  since they read as the sprite's name.
- **Vector blocks look like list blocks**: the Variables category gets a
  "Make a Vector" button, and each vector gets its own colored blocks ("set
  (v) to (x, y, z)", "x of (v)", ...). Stage monitors work like list monitors.

### 5.2 Variable types

- A variable's type is inferred from the values assigned to it and from its
  current value. Users do not declare types (keeping Scratch's ease of use).
- A variable that receives several types becomes "any". Only the places
  that use it convert dynamically, as today (slower, but correct).
- The editor will show variable types (for example by color), and show an
  "any" variable as a reason a project is slow (later).
- **Lists follow the same rule**: a list is "any" by default, and its item
  type is inferred from the values added, inserted or put into it. If all of
  them are numbers it compiles as a list of numbers; if they are mixed it
  stays an "any" list and is handled dynamically.

## 6. Compiler

```
Blockly JSON → IR (typed tree) → analysis (types, classes, waiting) → JS source → new Function
```

- **IR**: a tree with the meaning of each block. Values typed into inputs
  become constants here.
- **Generated JS**: monomorphic per type. Store columns are loaded into
  local variables outside loops. Blocks do not become one function call each.
- **Incremental**: only changed kinds are compiled again (4.6). The green
  flag does not recompile everything.
- **Safety**: projects may be shared, so block contents are untrusted input.
  Strings and names are embedded only through `JSON.stringify`, identifiers
  are generated numbers only, and objects (kinds, extension blocks) are
  passed in a constants array. Text from blocks is never concatenated into
  source directly.
- **Extension blocks**: extensions register blocks as plain functions, as
  before (slower but simple). A batch form that receives a range of entities,
  for extensions that need speed, is planned (later).

### 6.1 Division of optimizations

Optimizations that need to know what blocks mean are done by the compiler;
mechanical ones are left to the JS engine (V8).

**Done by the compiler**

1. **Inline block implementations**: "move 10 steps" becomes an expression
   such as `X[i] += 10 * Math.sin(r)`, not a call like
   `blocks.motion_move(ctx, 10)`. This matters most: if every block stays a
   call, V8's inlining budget is used up by them alone.
2. **Constant folding**: `"10"` in an input is embedded as the number `10`.
   Operations on constants (`(3 + 4) * 2`, `sin(30)`) are computed at compile
   time. V8 cannot see through our conversion functions (`toNumber` and so
   on) to find that the result is constant.
3. **Type specialization**: no `toNumber` or `compare` where types are known (5).
4. **Hoisting**: store columns (`E.x`, ...) are loaded into locals before
   loops. V8 cannot prove that functions called inside the loop leave `E.x`
   alone, so it may reload it every time.
5. **Common values**: for example, `sin`/`cos` of the direction computed once
   when several blocks use them, only where block semantics guarantee the
   value has not changed.

**Left to V8**

- Inlining small helpers (`L.bounce` and the like)
- Register allocation, eliminating bounds checks
- Escape analysis (removing temporary objects)
- Fine-grained constant folding and common subexpression elimination in
  ordinary arithmetic in the generated code

**Cautions**

- **Do not over-inline**: V8 does not optimize very large functions. Custom
  blocks are generated as separate JS functions and left to V8's inlining.
  Whether to inline them ourselves is decided after measuring.
- **Compile-time results must equal run-time results**: folding uses the
  same functions as run time (including rounding). Otherwise results would
  depend on whether a value is constant, breaking determinism (2.6).
- **Keep types stable**: mixing numbers and strings in one place makes V8
  deoptimize. Type inference (5) also prevents this.
- **How to check**: effects are measured with the scenario benchmarks
  (stage 0). Deoptimizations can be checked with `node --trace-deopt`.

### 6.2 Implementation language of the compiler

The compiler is written in TypeScript. It is not written in Rust or another
language compiled to wasm.

Native compilers pay off (the Go port of the TypeScript compiler, SWC and
Oxc in Rust) when the input is hundreds of thousands to millions of lines and
the compiler itself is the bottleneck. This compiler's input is hundreds to
thousands of blocks per project, and only changed kinds are recompiled, so a
few milliseconds in JS are expected.

Reasons not to use wasm:

1. **It does not affect run-time speed**: the targets (1) depend on the
   quality of the generated JS (6.1). The language the compiler is written in
   does not change the speed of the code it generates.
2. **Crossing the boundary would cost more**: the input is Blockly's JS
   objects and the output is JS source for `new Function`; both ends are JS.
   With wasm, converting and passing data would add work that is large
   relative to the small compile itself.
3. **Extensions**: extensions register blocks in JS at run time. Calling them
   from wasm would need another mechanism.
4. **Cost of development and distribution**: two toolchains (Rust and TS),
   split debugging, and a wasm module to download and start.

When to reconsider:

- **Compiling becomes noticeably slow**: recompiling one kind while editing
  a running project takes longer than a frame (about 16 ms) and stutters.
  Even then, moving compilation to a Worker comes first.
- **Compiling to wasm**: if stage 8 decides to compile blocks to wasm. Even
  then wasm binaries can be produced from JS (binaryen.js and the like), so
  the compiler need not be in Rust.

Whether to use wasm is a question for the heavy run-time parts (physics, CSG,
collision, determinism in stage 8), not for the compiler.

## 7. Collision

- **Broad phase**: a uniform spatial grid per kind (cells three times the
  kind's average bounding radius), built with a counting sort into typed
  arrays without allocation. The cells form a dense box over the kind when
  that box is small, and are hashed otherwise; kinds of up to 16 entities are
  searched directly. A kind's grid is rebuilt lazily, the first time it is
  queried after anything that can move that kind (a script with motion or
  looks blocks, physics, clones created or deleted, the editor). A grid built
  during the tick in which its kind's own script is still moving it allows
  for members moving as far as the fastest one had moved at the build.
- **Narrow phase**: shortcuts per shape pair (bounding spheres first,
  sphere–sphere, axis-aligned cubes, a sphere against an axis-aligned cube),
  GJK for the general case. GJK works on
  scalars and a preallocated scratch array, without allocation.
- **"Touching (sprite)?"**: the target is a kind (the original and all its
  clones), so only nearby grid cells are checked.
- **"When I touch (target)" hat**: the target is a sprite (its original and
  clones), the entity's own clones, or the edge. After each tick (after
  physics), contacts that began in it start the script on that entity in the
  next tick; a script already running there is not restarted. Contacts are
  tracked per pair, so touching a second clone while still touching the
  first starts it again. Only kinds with such hats pay for the check, which
  uses the grids above. "Touched sprite" reports what the entity touched (a
  sprite reference, 5.1), and "touching", "distance to" and "(property) of"
  accept a reference in place of a sprite name; "of" then reads that entity,
  clone or not, including its own variables.
- **"Touching (color)?"**: unlike Scratch, which compares rendered pixels,
  it is true when the entity's shape touches an entity of any sprite whose
  color matches (5, 5 and 4 bits of red, green and blue, as Scratch
  compares). Pixels would depend on lighting and on the camera, and reading
  them back from the GPU does not scale to many clones. Pen lines do not
  count.
- **Kinds using physics**: Rapier's broad phase and collision events are
  used; the mechanism above does not run twice.

## 8. Rendering

- **Instanced rendering**: one `InstancedMesh` per shape. 30,000 entities
  take as many draw calls as there are shapes. Instances do not use matrices
  built on the CPU: each has its pose at the start and end of the last tick
  (position and size, then direction, pitch and roll; 14 floats) and the
  vertex shader builds the matrix, interpolating by a uniform. Each mesh keeps a dense list of its instances;
  entities are added and removed by swapping with the last instance.
- **Shadows**: shapes stop casting shadows above 2,000 visible entities.
- **Only what changed, once per tick**: instances are written only on the
  first frame after a tick; other frames only update the interpolation
  uniform. An entity whose pose did not change in the last tick and was
  already written at that pose is skipped. The renderer only reads the
  store: it notices changed colors and shapes by comparing them with what it
  last wrote, so it can draw from a snapshot as well (10). Edits between
  ticks (dragging, the sprite pane) show at the next tick.
- **Selection outline and direction marker**: only on the selected sprite.
  (They used to be three meshes per sprite.)
- **Speech bubbles**: DOM (CSS2D) bubbles are pooled; at most 64 are shown,
  nearest to the camera first. Drawing text into textures for more is
  considered later.
- **Pen**: segments (with their size and opacity) and stamps are appended
  to typed arrays and the drawn range grows; line geometry is not rebuilt.
  Stamps are instanced shapes, one InstancedMesh per shape.
- **Interpolation**: each frame draws the pose interpolated between the
  start and end of the last tick (on the GPU, see above).
- **Picking**: a ray against bounding spheres from the store, then an exact
  test against the few candidates.
- **Tests**: `test/instances.test.ts` checks, without WebGL, which instances
  are written and when (poses, colors, removal, shape changes, growing the
  meshes, shadows). `npm run test:browser` runs `test/browser/` in headless
  Chrome: the vertex shader against `writeMatrix` pixel by pixel, and the
  stage drawing sprites, interpolating, drawing more than one mesh's first
  capacity of clones, and moving a dragged sprite.

## 9. Physics

- Rapier is used as is. Bodies are found by entity slot (an array), not by
  `Map<string, BodyState>`.
- Physics steps after scripts every tick, and all bodies' poses are written
  back to the store columns together.
- The target is 3,000 bodies (scenario C). Making all 30,000 entities
  bodies is not a goal.
- If deterministic execution becomes necessary (synchronous multiplayer),
  Rapier's enhanced-determinism build will be considered.

## 10. Web Worker (trial done; not adopted for now)

- The intended end state runs logic in a Worker and has the renderer only
  read a snapshot in a `SharedArrayBuffer`.
- So the engine does not depend on the DOM or Three.js (as now; keep it so).
- `SharedArrayBuffer` needs COOP/COEP headers. The dev and preview servers
  send them (the editor works under them); hosting must send them too.
- **Trial** (`?bench=A&logic=main|worker|post`, `src/bench/logicTrial.ts`):
  a page that draws a benchmark scenario alone, with its logic on the main
  thread or in `src/worker/logic.worker.ts`. After each tick the worker
  copies the columns drawing reads (pose, previous pose, color, shape,
  flags; 118 bytes per slot) into a snapshot (`src/worker/snapshot.ts`).
  - `worker`: three shared snapshots (triple buffering with one atomic
    exchange per hand-over): the worker writes one, the page reads one, and
    the third holds the newest finished one.
  - `post`: three ordinary buffers transferred by `postMessage` and handed
    back when the page has a newer one; while the page holds all of them the
    worker skips writing.
  - Results are in 14.2.
- **Not in the trial**: the editor. Adopting the worker means moving every
  editor–runtime exchange (3.2) to messages: compiling and live edits, the
  sprite pane and dragging, monitors, running-script highlights, speech
  bubbles, pen strokes, keys and the mouse, extensions that use the page.
  The stop button could then terminate a worker stuck in an endless loop
  (4.3).

## 11. What is dropped or changed

| Scratch / previous implementation | New design |
|---|---|
| Reading and writing .sb3 | Not supported |
| 30 fps; the scheduler ends a frame when something requests a redraw | Fixed 60 Hz. One loop iteration = one tick |
| A computation-only "forever" runs many times per frame | "Forever" always runs once per tick |
| Thread order (start order; a broadcast starts receivers at once) | The fixed order of 4.1; messages arrive in the next tick |
| Every value converted at run time | Conversions only where types change |
| Literal text such as `10` stays text | Canonical numbers become numbers (5.1) |
| Clone limit 300 | 30,000 by default (project setting) |
| Speech bubbles on every clone | At most 64 shown at once |
| Generators and composed closures | Generated JS and execution state as data |
| Wall-clock timer and waits | Logical time (ticks) |
| "Stop this script" in a custom block ends the whole script | Returns from the custom block, as in Scratch |

## 12. Plan

Each stage is checked against the scenario benchmarks (A–E in 1); whether to
continue is decided by whether the target numbers are met.

| Stage | Content | Main scenarios | Status |
|---|---|---|---|
| 0 | Measurement: scenario projects A–E, logic and render times, allocation per tick | All (baseline) | Done (`npm run bench`, `?bench=A` in the app) |
| 1 | Rendering: InstancedMesh, change tracking, bubble cap, appended pen | A, E | Done |
| 2 | Data model: entity store, handles, variables in arrays, editor boundary (3.2) | A, D, E | Done |
| 3 | Compiler: IR, type inference, JS source generation, classes, per-frame code, state machines | A, D | Done |
| 4 | Collision: spatial grid, per-shape shortcuts, the "when I touch" hat with sprite references | B | Done |
| 5 | Physics: bodies by slot, bulk write-back, collision events | C | Done; target C not met yet (14) |
| 6 | Fixed step and interpolation, seeded random numbers | (determinism) | Done |
| 7 | Web Worker (when needed) | Overlap with rendering, stopping endless loops | Trial measured (14.2); not adopted for now |
| 8 | wasm: after stage 4, measure and consider every item (physics, CSG, collision for many clones, deterministic execution) | B, C, features | Collision: measured, not adopted (14.3); the rest later |

When needed: vector blocks (5.1), showing variable types in the editor
(5.2), and the batch form for extension blocks (6).

## 13. Decisions (2026-10-16)

Points that were open in the first draft:

- **How vector blocks look**: like lists (5.1).
- **List types**: the same rule as variables. Lists are "any" by default and
  their item type follows their contents (5.2).
- **Iteration cap for endless loops**: none (4.3).
- **Editor display with many clones**: unchanged (running scripts of the
  original sprite are highlighted).
- **wasm**: measured after stage 4, considering every item in stage 8.

## 14. Measurements (2026-10-16)

Logic per tick from `npm run bench` (300 ticks after 120 of warm-up; ranges
over two runs), on a
2020 13-inch MacBook Pro (Intel Core i7-1068NG7), Node 24. This machine is
slower than the reference machine in 1.

| Scenario | Entities | Mean | p95 | GC during 300 ticks | Target |
|---|---|---|---|---|---|
| A | 30,001 | 2.6 ms | 2.9 ms | none | ≤ 4 ms ✓ |
| B | 10,042 | 4.7 ms | 4.9 ms | 16 minor, ≤ 0.3 ms | ≤ 6 ms ✓ |
| C | 3,001 | 30 ms | 32–41 ms | 52 minor, ≤ 0.6 ms | 60 fps ✗ |
| D | 30,001 | 0.5 ms | 0.6 ms | none | ≤ 4 ms ✓ |
| E | 10,501 | 1.0 ms | 1.1 ms | 1 minor, 0.2 ms | no hitches ✓ |

- In Chrome (the app with `?bench=…`) logic times are similar: A 2.4 ms,
  B 4.3 ms, C 22 ms, D 0.6 ms, E 0.8 ms.
- C: about 90% of the time is inside Rapier (its broad and narrow phase on a
  dense pile of 3,000 spheres); one solver iteration instead of four still
  takes 18 ms. This is for stage 8.

### 14.1 Scenario A in desktop browsers (2026-10-17)

Same machine, with the GPU (Intel Iris Plus), from the app's performance
display (`?bench=A&perf`). "Prepare" is updating instances, bubbles and pen;
"submit" is three.js uploading and issuing draw calls (CPU time only).

| Browser | fps | Logic | Drawing | Prepare | Submit |
|---|---|---|---|---|---|
| Chrome, before GPU interpolation | 49 | 7.0 ms | 10.9 ms | 9.7 ms | 1.1 ms |
| Chrome | 57 | 6.5 ms | 4.5 ms | 3.1 ms | 1.3 ms |
| Firefox | 61 | 4.1 ms | 5.6 ms | 2.8 ms | 2.8 ms |

- Moving pose interpolation and matrix building into the vertex shader (8)
  cut preparing a frame from 9.7 ms to 3.1 ms. Drawing is within its target
  (≤ 8 ms) in both browsers, and A runs at about 60 fps.
- Logic in desktop Chrome (6.5 ms) is about 2.5 times that in Node and
  headless Chrome (2.4–3.2 ms) with the same V8, and Firefox takes 4.1 ms.
  This is taken to be the browser environment (extensions, DevTools, power
  settings), not the engine.

### 14.2 Logic in a Web Worker (2026-10-17)

The trial page (10) in headless Chrome on the same machine (drawing on its
GPU through ANGLE and Metal), at 1280×800. Each row is the median over 600
frames after 120 frames of warm-up. The machine was also busy with other
work, so absolute numbers are rough; a second run gave the same picture,
and the table is that run. "Main thread" is the work per frame on the
page's thread (logic when it runs there, updating instances, three.js),
"logic" is ms per tick wherever it runs, and "copy" is writing a snapshot
in the worker.

| Scenario | Logic on | fps | Main thread (median / 95%) | Logic | Copy |
|---|---|---|---|---|---|
| A | main thread | 59 | 7.0 / 10.2 ms | 4.5 ms | — |
| A | worker, shared | 60 | 2.8 / 4.0 ms | 5.2 ms | 0.8 ms |
| A | worker, transferred | 60 | 3.3 / 4.7 ms | 6.0 ms | 0.6 ms |
| B | main thread | 60 | 6.3 / 9.3 ms | 5.6 ms | — |
| B | worker, shared | 60 | 1.1 / 1.7 ms | 6.5 ms | 0.2 ms |
| B | worker, transferred | 60 | 1.2 / 1.9 ms | 6.6 ms | 0.2 ms |
| C | main thread | 8 | 124 / 137 ms | 31 ms | — |
| C | worker, shared | 60 | 0.2 / 0.6 ms | 39 ms | 0.1 ms |
| C | worker, transferred | 60 | 0.3 / 0.6 ms | 39 ms | 0.1 ms |
| D | main thread | 60 | 3.5 / 5.7 ms | 1.0 ms | — |
| D | worker, shared | 60 | 2.5 / 4.0 ms | 1.6 ms | 1.3 ms |
| D | worker, transferred | 60 | 3.0 / 4.7 ms | 1.5 ms | 0.7 ms |
| E | main thread | 60 | 3.8 / 5.7 ms | 2.2 ms | — |
| E | worker, shared | 60 | 2.0 / 3.2 ms | 2.1 ms | 0.2 ms |
| E | worker, transferred | 60 | 2.4 / 3.7 ms | 2.9 ms | 0.2 ms |

- The main thread saves about the logic time. Drawing from a snapshot
  costs the same as drawing from the store.
- C changes most: on the main thread, physics (over 16 ms per tick) and the
  catch-up ticks hold the page at 8 fps. In the worker the page draws at
  60 fps while the simulation runs slower than real time.
- Logic runs up to 60% slower in the worker (D; 15–25% in A to C), and
  copying a snapshot costs up to 1.3 ms per tick at 30,000 entities. Both are in the worker, off the page's
  thread.
- Shared and transferred snapshots differ little here. Writing into shared
  memory is slower than into an ordinary buffer (D: 1.3 against 0.7 ms),
  and transferring needs no COOP/COEP headers.
- Conclusion: the worker pays off for heavy logic (B, C) and keeps the page
  responsive, and it is the way to stop endless loops. The costs it adds
  are already in these numbers; what remains is editor work (10), not a
  risk to the gain. Not measured: input delay, estimated at one more tick
  (about 17 ms) between an input and what is drawn.
- Scenarios A, B, D and E already reach 60 fps with logic on the main
  thread, so the worker is not adopted for now (decided 2026-10-17).
  Rapier itself neither recommends nor requires a worker: its JS guide
  steps the world in an ordinary loop, and the common three.js wrapper
  (react-three-rapier) runs on the main thread. A worker would not make C
  meet its target either, only keep the page responsive while the
  simulation falls behind. The worker is reconsidered when a frozen page
  becomes a real problem: an endless loop that cannot be stopped, or logic
  too heavy for the main thread.

### 14.3 "Touching" in wasm (2026-10-17)

Scenario B spends most of its logic in "touching (sprite)?" (the walls'
grid query and GJK for 10,000 spheres against 41 cubes). The trial ports
that test (`KindGrid`, `shapesIntersect`, GJK) to Rust compiled to wasm
(`app/wasm/collision`, 39 KB, no dependencies) and runs both on the same
entities each tick (`src/bench/touchingTrial.ts`; `npm run bench -- wasm`
in Node). Results matched JS for every entity in every tick.

| | Node 24 | Chrome (headless) |
|---|---|---|
| Whole tick in JS (for scale) | 5.2 ms | 4.6 ms |
| Touching, JS (the engine's `L.touchingKind`) | 4.1 ms | 3.4 ms |
| Touching, wasm, one call per entity | 2.2 ms | 2.1 ms |
| Touching, wasm, one call per tick | 2.1 ms | 1.9 ms |
| Copying the columns into wasm memory | 0.09 ms | 0.08 ms |

- wasm takes 1.6–1.9 times less time. Calls cost little: one call per
  entity, as generated code would make, is within 10% of one per tick.
- The copy is only a measuring aid: entities move during a tick, so the test
  must read the live columns.

Two questions remained: whether a cheaper JS test closes the gap, and what
wasm gains inside the engine, with the store's columns in wasm memory.

**A JS shortcut.** B's pairs are spheres against axis-aligned cubes, which
went through GJK. `shapesIntersect` now tests them by the cube's closest
point (checked against GJK in `test/collision.test.ts`); the Rust port has
the same shortcut. In Node, touching takes 2.8–2.9 ms in JS and 2.3 ms in
wasm with one call per entity, and B's whole tick drops from 4.9 ms to
3.5 ms.

**wasm in the engine.** The runtime was given the wasm module as an
accelerator: the store kept x, y, z, px, py, pz, size, direction, pitch,
roll, shape and flags as views on the module's memory, and "touching
(sprite)?" called the module once per entity. The module allocated spare memory whenever the store was
resized, because memory must not grow during a tick: that would detach
the views that generated code holds. B ran exactly as in JS. Three runs
of the scenario benchmarks alternating with JS, in Node:

| Scenario | JS | wasm |
|---|---|---|
| A (no touching; columns in wasm memory) | 2.69–2.79 ms | 2.70–2.92 ms |
| B | 3.48–3.54 ms | 3.23–3.38 ms |

D and E were also unchanged.

- Columns in wasm memory do not slow the JS engine down beyond noise.
- Inside the engine wasm saves about 0.2 ms per tick in B (6%), less than
  the separate measurement suggests, because the engine's own JS (inlined
  into generated code) is faster than the call from the benchmark.
- **Conclusion: not worth adopting for collision now.** The JS shortcut
  gained more (1.4 ms) than wasm adds on top, and wasm brings a second
  toolchain, the rule that memory must not grow during a tick, and the
  store split between two memories. The engine hooks were removed
  again (they are in commit b0b815c); wasm is reconsidered if collision
  of many clones becomes the bottleneck again (for example rotated cubes,
  cones and cylinders, which still go through GJK).
- Not tried: physics (C is already Rapier's wasm), CSG, deterministic
  execution.
