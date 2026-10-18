/**
 * Physics extension (Rapier). Sprites opt in with "physics mode"; each tick
 * the world steps after scripts have run, and simulated poses are written
 * back to the entity store. Moving a sprite with ordinary blocks teleports
 * its body.
 *
 * Rapier (~2 MB of wasm) is loaded only when the extension is added.
 * Commands used before it has loaded wait for it; reporters return 0.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import { Euler, Quaternion } from 'three'
import type { ExtensionSpec } from '../engine/extension'
import { wrapDirection, type Runtime } from '../engine/runtime'
import { F_PEN, F_VISIBLE, type EntityStore } from '../engine/store'
import { BASE_SIZE, STAGE_HEIGHT, STAGE_WIDTH } from '../engine/types'

type Rapier = typeof RAPIER_NS

export type PhysicsMode = 'dynamic' | 'fixed' | 'none'

/** Units per second², pointing down. Objects are 40 units across, so this is about 1 g at 1 object = 0.8 m. */
export const DEFAULT_GRAVITY = -500
const WALL_HEIGHT = 4000
const DEG = Math.PI / 180

const CUBE = 0
const SPHERE = 1
const CYLINDER = 3

interface BodyState {
  /** The entity's handle; when it no longer resolves, the body goes. */
  entity: number
  body: RAPIER_NS.RigidBody
  collider: RAPIER_NS.Collider
  mode: Exclude<PhysicsMode, 'none'>
  shape: number
  size: number
  /** The pose physics last wrote to the entity; a difference means a script moved it. */
  wx: number
  wy: number
  wz: number
  wdirection: number
  wpitch: number
  wroll: number
  restitution: number
  friction: number
  rotates: boolean
}

let rapierPromise: Promise<Rapier> | null = null

/** Loads and initializes Rapier once per page. */
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const R = (mod as { default?: Rapier }).default ?? (mod as unknown as Rapier)
    await R.init()
    return R
  })
  return rapierPromise
}

function remember(b: BodyState, E: EntityStore, i: number): void {
  b.wx = E.x[i]
  b.wy = E.y[i]
  b.wz = E.z[i]
  b.wdirection = E.direction[i]
  b.wpitch = E.pitch[i]
  b.wroll = E.roll[i]
}

function movedByScript(b: BodyState, E: EntityStore, i: number): boolean {
  return (
    Math.abs(E.x[i] - b.wx) > 1e-6 ||
    Math.abs(E.y[i] - b.wy) > 1e-6 ||
    Math.abs(E.z[i] - b.wz) > 1e-6 ||
    Math.abs(wrapDirection(E.direction[i] - b.wdirection)) > 1e-6 ||
    Math.abs(E.pitch[i] - b.wpitch) > 1e-6 ||
    Math.abs(E.roll[i] - b.wroll) > 1e-6
  )
}

const euler = new Euler()
const quat = new Quaternion()

/** Entity orientation (yaw from direction, then pitch, then roll) as a quaternion. */
function rotationOf(E: EntityStore, i: number): RAPIER_NS.Rotation {
  euler.set(E.roll[i] * DEG, -E.pitch[i] * DEG, (90 - E.direction[i]) * DEG, 'ZYX')
  quat.setFromEuler(euler)
  return { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
}

function applyRotation(E: EntityStore, i: number, r: RAPIER_NS.Rotation): void {
  quat.set(r.x, r.y, r.z, r.w)
  euler.setFromQuaternion(quat, 'ZYX')
  E.roll[i] = euler.x / DEG
  E.pitch[i] = -euler.y / DEG
  E.direction[i] = wrapDirection(90 - euler.z / DEG)
}

/** One simulation per runtime. Bodies are found by entity slot. */
export class PhysicsWorld {
  gravity = DEFAULT_GRAVITY
  /** Paused by the stop button; resumed by the green flag or any physics command. */
  paused = false
  private world: RAPIER_NS.World
  private events: RAPIER_NS.EventQueue
  /** By slot. */
  private bodies: (BodyState | undefined)[] = []
  /** Slots that have a body. */
  private slots: number[] = []
  /** Collider handle → entity handle, or the stage. */
  private colliderOwner = new Map<number, number | 'stage'>()
  private walls: RAPIER_NS.Collider[] = []

  constructor(
    private readonly R: Rapier,
    private readonly rt: Runtime,
  ) {
    this.world = new R.World({ x: 0, y: 0, z: this.gravity })
    this.world.lengthUnit = BASE_SIZE
    this.events = new R.EventQueue(true)
    const floor = this.world.createCollider(R.ColliderDesc.cuboid(5000, 5000, 50).setTranslation(0, 0, -50))
    this.colliderOwner.set(floor.handle, 'stage')
    this.setWalls(true)
  }

  dispose(): void {
    this.events.free()
    this.world.free()
    this.bodies = []
    this.slots = []
  }

  setGravity(g: number): void {
    this.gravity = g
    this.world.gravity = { x: 0, y: 0, z: g }
    for (const s of this.slots) this.bodies[s]!.body.wakeUp()
  }

  setWalls(on: boolean): void {
    for (const w of this.walls) {
      this.colliderOwner.delete(w.handle)
      this.world.removeCollider(w, true)
    }
    this.walls = []
    if (!on) return
    const t = 50
    const hw = STAGE_WIDTH / 2
    const hh = STAGE_HEIGHT / 2
    const z = WALL_HEIGHT / 2
    const descs = [
      this.R.ColliderDesc.cuboid(t, hh + 2 * t, z).setTranslation(-hw - t, 0, z),
      this.R.ColliderDesc.cuboid(t, hh + 2 * t, z).setTranslation(hw + t, 0, z),
      this.R.ColliderDesc.cuboid(hw + 2 * t, t, z).setTranslation(0, -hh - t, z),
      this.R.ColliderDesc.cuboid(hw + 2 * t, t, z).setTranslation(0, hh + t, z),
    ]
    for (const d of descs) {
      const c = this.world.createCollider(d)
      this.colliderOwner.set(c.handle, 'stage')
      this.walls.push(c)
    }
  }

  /** The body of a live entity. */
  private bodyOf(slot: number): BodyState | undefined {
    const b = this.bodies[slot]
    return b && this.rt.store.slotOf(b.entity) === slot ? b : undefined
  }

  modeOf(slot: number): PhysicsMode {
    return this.bodyOf(slot)?.mode ?? 'none'
  }

  setMode(slot: number, mode: PhysicsMode): void {
    const existing = this.bodyOf(slot)
    if (existing?.mode === mode) return
    const settings = existing ?? { restitution: 0.3, friction: 0.5, rotates: true }
    this.removeBody(slot)
    if (mode === 'none') return
    const E = this.rt.store
    const desc = (mode === 'dynamic' ? this.R.RigidBodyDesc.dynamic() : this.R.RigidBodyDesc.fixed())
      .setTranslation(E.x[slot], E.y[slot], E.z[slot])
      .setRotation(rotationOf(E, slot))
      .setCanSleep(true)
      .setCcdEnabled(mode === 'dynamic')
    const body = this.world.createRigidBody(desc)
    body.lockRotations(!settings.rotates, false)
    const state: BodyState = {
      entity: E.handle(slot),
      body,
      collider: this.createCollider(slot, body, settings.restitution, settings.friction),
      mode,
      shape: E.shape[slot],
      size: E.size[slot],
      wx: 0, wy: 0, wz: 0, wdirection: 0, wpitch: 0, wroll: 0,
      restitution: settings.restitution,
      friction: settings.friction,
      rotates: settings.rotates,
    }
    remember(state, E, slot)
    this.bodies[slot] = state
    this.slots.push(slot)
  }

  private createCollider(slot: number, body: RAPIER_NS.RigidBody, restitution: number, friction: number): RAPIER_NS.Collider {
    const R = this.R
    const E = this.rt.store
    const h = (BASE_SIZE / 2) * (E.size[slot] / 100)
    const shape = E.shape[slot]
    // Rapier's cylinders and cones run along local y; ours run along local z.
    const yToZ = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }
    const desc =
      shape === CUBE
        ? R.ColliderDesc.cuboid(h, h, h)
        : shape === SPHERE
          ? R.ColliderDesc.ball(h)
          : (shape === CYLINDER ? R.ColliderDesc.cylinder(h, h) : R.ColliderDesc.cone(h, h)).setRotation(yToZ)
    desc.setRestitution(restitution).setFriction(friction).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    const collider = this.world.createCollider(desc, body)
    this.colliderOwner.set(collider.handle, E.handle(slot))
    return collider
  }

  private removeBody(slot: number): void {
    const b = this.bodies[slot]
    if (!b) return
    this.colliderOwner.delete(b.collider.handle)
    this.world.removeRigidBody(b.body)
    this.bodies[slot] = undefined
    const at = this.slots.indexOf(slot)
    if (at >= 0) this.slots.splice(at, 1)
  }

  private dynamicBody(slot: number): BodyState | null {
    const b = this.bodyOf(slot)
    return b && b.mode === 'dynamic' ? b : null
  }

  setVelocity(slot: number, v: { x: number; y: number; z: number }): void {
    this.dynamicBody(slot)?.body.setLinvel(v, true)
  }

  changeVelocity(slot: number, dv: { x: number; y: number; z: number }): void {
    const b = this.dynamicBody(slot)
    if (!b) return
    const v = b.body.linvel()
    b.body.setLinvel({ x: v.x + dv.x, y: v.y + dv.y, z: v.z + dv.z }, true)
  }

  velocity(slot: number): { x: number; y: number; z: number } {
    const b = this.dynamicBody(slot)
    return b ? b.body.linvel() : { x: 0, y: 0, z: 0 }
  }

  setMaterial(slot: number, patch: { restitution?: number; friction?: number }): void {
    const b = this.bodyOf(slot)
    if (!b) return
    if (patch.restitution !== undefined) b.collider.setRestitution((b.restitution = patch.restitution))
    if (patch.friction !== undefined) b.collider.setFriction((b.friction = patch.friction))
  }

  setRotates(slot: number, rotates: boolean): void {
    const b = this.bodyOf(slot)
    if (!b) return
    b.rotates = rotates
    b.body.lockRotations(!rotates, true)
    if (!rotates) b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  /** Drops bodies whose entities are gone. */
  syncEntities(): void {
    for (const slot of [...this.slots]) if (!this.bodyOf(slot)) this.removeBody(slot)
  }

  /** Steps the simulation and writes every moving body's pose back to its entity. */
  step(dt: number): void {
    if (this.paused || this.slots.length === 0) return
    const E = this.rt.store
    this.syncEntities()
    for (const slot of this.slots) {
      const b = this.bodies[slot]!
      if (b.shape !== E.shape[slot] || b.size !== E.size[slot]) {
        this.colliderOwner.delete(b.collider.handle)
        this.world.removeCollider(b.collider, false)
        b.collider = this.createCollider(slot, b.body, b.restitution, b.friction)
        b.shape = E.shape[slot]
        b.size = E.size[slot]
        b.body.wakeUp()
      }
      if (movedByScript(b, E, slot)) {
        b.body.setTranslation({ x: E.x[slot], y: E.y[slot], z: E.z[slot] }, true)
        b.body.setRotation(rotationOf(E, slot), true)
      }
      const visible = (E.flags[slot] & F_VISIBLE) !== 0
      if (b.body.isEnabled() !== visible) b.body.setEnabled(visible)
    }

    this.world.timestep = dt
    this.world.step(this.events)

    let moved = false
    for (const slot of this.slots) {
      const b = this.bodies[slot]!
      if (b.mode !== 'dynamic' || !(E.flags[slot] & F_VISIBLE) || b.body.isSleeping()) continue
      const t = b.body.translation()
      applyRotation(E, slot, b.body.rotation())
      if (E.flags[slot] & F_PEN) this.rt.pen.addSegment(E.x[slot], E.y[slot], E.z[slot], t.x, t.y, t.z, E.penColor[slot])
      E.x[slot] = t.x
      E.y[slot] = t.y
      E.z[slot] = t.z
      remember(b, E, slot)
      moved = true
    }
    if (moved) this.rt.posesChanged()

    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return
      const a = this.colliderOwner.get(h1)
      const c = this.colliderOwner.get(h2)
      this.collided(a, c)
      this.collided(c, a)
    })
  }

  /** Collision hats start next tick. */
  private collided(who: number | 'stage' | undefined, other: number | 'stage' | undefined): void {
    if (who === undefined || who === 'stage' || other === undefined) return
    const kind = other === 'stage' ? 'stage' : 'sprite'
    for (const what of [kind, 'any']) this.rt.startHats('physics_whenCollide', { WHAT: what }, who)
  }
}

const worlds = new WeakMap<Runtime, PhysicsWorld>()
const loading = new WeakMap<Runtime, Promise<PhysicsWorld>>()

function ensureWorld(rt: Runtime): Promise<PhysicsWorld> {
  let p = loading.get(rt)
  if (!p) {
    p = loadRapier().then((R) => {
      const w = new PhysicsWorld(R, rt)
      worlds.set(rt, w)
      return w
    })
    loading.set(rt, p)
  }
  return p
}

/** The runtime's physics world, or null while Rapier is still loading. */
export function physicsOf(rt: Runtime): PhysicsWorld | null {
  return worlds.get(rt) ?? null
}

/**
 * Runs `fn` with the entity's slot now if physics is ready, otherwise
 * returns a Promise so the script waits for it. The entity is passed as a
 * handle since it may be gone by the time Rapier has loaded.
 */
function withWorld(rt: Runtime, entity: number, fn: (w: PhysicsWorld, slot: number) => void): void | Promise<void> {
  const run = (w: PhysicsWorld) => {
    w.paused = false
    const slot = rt.store.slotOf(entity)
    if (slot >= 0) fn(w, slot)
  }
  const w = worlds.get(rt)
  if (w) return run(w)
  return ensureWorld(rt).then(run)
}

const vec = (a: Record<string, unknown>) => ({ x: Number(a.X), y: Number(a.Y), z: Number(a.Z) })
const percent = (v: unknown) => Math.max(0, Math.min(100, Number(v))) / 100

export const physicsExtension: ExtensionSpec = {
  id: 'physics',
  name: { ja: '物理', en: 'Physics' },
  colours: ['#E0457B', '#CC3A6C', '#B8325F'],
  blocks: [
    {
      opcode: 'setMode',
      type: 'command',
      text: { ja: '物理の動きを [MODE] にする', en: 'set physics to [MODE]' },
      args: {
        MODE: {
          type: 'menu',
          options: [
            [{ ja: '動く', en: 'moving' }, 'dynamic'],
            [{ ja: '固定', en: 'fixed' }, 'fixed'],
            [{ ja: 'なし', en: 'off' }, 'none'],
          ],
          default: 'dynamic',
        },
      },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.setMode(slot, a.MODE as PhysicsMode)),
    },
    {
      opcode: 'setVelocity',
      type: 'command',
      text: { ja: '速度を x: [X] y: [Y] z: [Z] にする', en: 'set velocity to x: [X] y: [Y] z: [Z]' },
      args: { X: { type: 'number', default: 0 }, Y: { type: 'number', default: 0 }, Z: { type: 'number', default: 300 } },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.setVelocity(slot, vec(a))),
    },
    {
      opcode: 'changeVelocity',
      type: 'command',
      text: { ja: '速度を x: [X] y: [Y] z: [Z] ずつ変える', en: 'change velocity by x: [X] y: [Y] z: [Z]' },
      args: { X: { type: 'number', default: 100 }, Y: { type: 'number', default: 0 }, Z: { type: 'number', default: 0 } },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.changeVelocity(slot, vec(a))),
    },
    {
      opcode: 'velocity',
      type: 'reporter',
      text: { ja: '[AXIS] 方向の速度', en: '[AXIS] velocity' },
      args: { AXIS: { type: 'menu', options: [['x', 'x'], ['y', 'y'], ['z', 'z']], default: 'z' } },
      run: (a, { rt, slot }) => {
        const v = physicsOf(rt)?.velocity(slot)
        return v ? Math.round(v[a.AXIS as 'x' | 'y' | 'z'] * 100) / 100 : 0
      },
    },
    '---',
    {
      opcode: 'whenCollide',
      type: 'hat',
      text: { ja: '[WHAT] にぶつかったとき', en: 'when I hit [WHAT]' },
      args: {
        WHAT: {
          type: 'menu',
          options: [
            [{ ja: '何か', en: 'anything' }, 'any'],
            [{ ja: 'スプライト', en: 'a sprite' }, 'sprite'],
            [{ ja: '床か壁', en: 'the floor or a wall' }, 'stage'],
          ],
          default: 'any',
        },
      },
    },
    '---',
    {
      opcode: 'setBounce',
      type: 'command',
      text: { ja: '弾み具合を [N] %にする', en: 'set bounciness to [N] %' },
      args: { N: { type: 'number', default: 80 } },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.setMaterial(slot, { restitution: percent(a.N) })),
    },
    {
      opcode: 'setFriction',
      type: 'command',
      text: { ja: '摩擦を [N] %にする', en: 'set friction to [N] %' },
      args: { N: { type: 'number', default: 50 } },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.setMaterial(slot, { friction: percent(a.N) })),
    },
    {
      opcode: 'setRotates',
      type: 'command',
      text: { ja: '転がり回転を [ON] にする', en: 'set tumbling [ON]' },
      args: {
        ON: {
          type: 'menu',
          options: [
            [{ ja: 'する', en: 'on' }, 'on'],
            [{ ja: 'しない', en: 'off' }, 'off'],
          ],
          default: 'off',
        },
      },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w, slot) => w.setRotates(slot, a.ON === 'on')),
    },
    '---',
    {
      opcode: 'setGravity',
      type: 'command',
      text: { ja: '重力を [G] にする', en: 'set gravity to [G]' },
      args: { G: { type: 'number', default: DEFAULT_GRAVITY } },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w) => w.setGravity(Number(a.G))),
    },
    {
      opcode: 'setWalls',
      type: 'command',
      text: { ja: 'ステージの壁を [ON] にする', en: 'set stage walls [ON]' },
      args: {
        ON: {
          type: 'menu',
          options: [
            [{ ja: 'あり', en: 'on' }, 'on'],
            [{ ja: 'なし', en: 'off' }, 'off'],
          ],
          default: 'on',
        },
      },
      run: (a, { rt, entity }) => withWorld(rt, entity, (w) => w.setWalls(a.ON === 'on')),
    },
  ],
  install: (rt) => {
    void ensureWorld(rt)
  },
  afterScripts: (rt, dt) => physicsOf(rt)?.step(dt),
  greenFlag: (rt) => {
    const w = physicsOf(rt)
    if (w) w.paused = false
  },
  stopAll: (rt) => {
    const w = physicsOf(rt)
    if (w) w.paused = true
  },
  spritesChanged: (rt) => physicsOf(rt)?.syncEntities(),
  uninstall: (rt) => {
    physicsOf(rt)?.dispose()
    worlds.delete(rt)
    loading.delete(rt)
  },
}
