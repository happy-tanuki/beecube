/**
 * Entities as instanced shapes: one InstancedMesh per shape, built from the
 * entity store's columns (docs/vm-design.md 8). Independent of the canvas,
 * so it can be tested without WebGL.
 *
 * An entity whose pose did not change in the last tick and that was already
 * drawn at that pose is skipped. Poses are interpolated between the start
 * and end of the last tick in the vertex shader.
 */
import * as THREE from 'three'
import { APP_ID } from '../brand'
import { wrapDirection } from '../engine/ops'
import { F_ALIVE, F_VISIBLE } from '../engine/store'
import { BASE_SIZE, SHAPES, type ShapeKind } from '../engine/types'

type Floats = Float64Array<ArrayBufferLike>

/** The store columns drawing reads: the engine's store, or a snapshot of it (worker/snapshot.ts). */
export interface RenderColumns {
  readonly capacity: number
  readonly highWater: number
  readonly flags: Uint8Array<ArrayBufferLike>
  readonly shape: Uint8Array<ArrayBufferLike>
  readonly color: Uint32Array<ArrayBufferLike>
  readonly x: Floats
  readonly y: Floats
  readonly z: Floats
  readonly direction: Floats
  readonly pitch: Floats
  readonly roll: Floats
  readonly size: Floats
  readonly px: Floats
  readonly py: Floats
  readonly pz: Floats
  readonly pdirection: Floats
  readonly ppitch: Floats
  readonly proll: Floats
  readonly psize: Floats
  readonly width: Floats
  readonly depth: Floats
  readonly height: Floats
}

/** Pose values EntityInstances remembers per slot: x, y, z, direction, pitch, roll, size, width, depth, height. */
const POSE_VALUES = 10

/** Above this many entities, shapes stop casting shadows. */
export const SHADOW_LIMIT = 2000
const COLOR = new THREE.Color()
const DEG = Math.PI / 180

export function makeGeometry(shape: ShapeKind): THREE.BufferGeometry {
  const s = BASE_SIZE
  switch (shape) {
    case 'cube':
      return new THREE.BoxGeometry(s, s, s)
    case 'sphere':
      return new THREE.SphereGeometry(s / 2, 20, 12)
    case 'cone':
      return new THREE.ConeGeometry(s / 2, s, 20).rotateX(Math.PI / 2)
    case 'cylinder':
      return new THREE.CylinderGeometry(s / 2, s / 2, s, 20).rotateX(Math.PI / 2)
  }
}

/** Writes an entity's (interpolated) world matrix, column-major, into `out` at `o`; `stretched` false leaves out width, depth and height. */
export function writeMatrix(E: RenderColumns, i: number, a: number, out: Float32Array, o: number, stretched = true): void {
  const b = 1 - a
  poseMatrix(
    E.px[i] * b + E.x[i] * a,
    E.py[i] * b + E.y[i] * a,
    E.pz[i] * b + E.z[i] * a,
    E.pdirection[i] + wrapDirection(E.direction[i] - E.pdirection[i]) * a,
    E.ppitch[i] + wrapDirection(E.pitch[i] - E.ppitch[i]) * a,
    E.proll[i] + wrapDirection(E.roll[i] - E.proll[i]) * a,
    E.psize[i] * b + E.size[i] * a,
    stretched ? E.width[i] : 100,
    stretched ? E.depth[i] : 100,
    stretched ? E.height[i] : 100,
    out,
    o,
  )
}

/** Writes the world matrix of a pose (size, width, depth and height in percent), column-major, into `out` at `o`. */
export function poseMatrix(
  x: number, y: number, z: number, dir: number, pitch: number, roll: number,
  size: number, width: number, depth: number, height: number, out: Float32Array, o: number,
): void {
  const s = size / 100
  const kx = (s * width) / 100
  const ky = (s * depth) / 100
  const kz = (s * height) / 100
  const yaw = (90 - dir) * DEG
  const p = pitch * DEG
  const r = roll * DEG
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cp = Math.cos(p), sp = Math.sin(p)
  const cr = Math.cos(r), sr = Math.sin(r)
  // Columns: the local x (heading), y and z axes, as Rz(yaw)·Ry(-pitch)·Rx(roll).
  const y0 = -sy, y1 = cy
  const z0 = -cy * sp, z1 = -sy * sp, z2 = cp
  out[o] = cy * cp * kx
  out[o + 1] = sy * cp * kx
  out[o + 2] = sp * kx
  out[o + 3] = 0
  out[o + 4] = (cr * y0 + sr * z0) * ky
  out[o + 5] = (cr * y1 + sr * z1) * ky
  out[o + 6] = sr * z2 * ky
  out[o + 7] = 0
  out[o + 8] = (cr * z0 - sr * y0) * kz
  out[o + 9] = (cr * z1 - sr * y1) * kz
  out[o + 10] = cr * z2 * kz
  out[o + 11] = 0
  out[o + 12] = x
  out[o + 13] = y
  out[o + 14] = z
  out[o + 15] = 1
}

/**
 * Instanced shapes take their pose at the start and end of the last tick
 * (position and size, then direction, pitch and roll) and build their matrix
 * in the vertex shader, interpolating by `poseAlpha`, and are stretched by
 * `stretch` (width, depth and height in percent, not interpolated). So the
 * CPU writes 17 numbers per moved entity per tick, and nothing on frames
 * between ticks.
 */
const POSE_DECLARATIONS = /* glsl */ `
#ifdef USE_INSTANCING
attribute vec4 poseFrom;
attribute vec4 poseTo;
attribute vec3 turnFrom;
attribute vec3 turnTo;
attribute vec3 stretch;
uniform float poseAlpha;
float shortestTurn(float d) { return d - 360.0 * floor((d + 180.0) / 360.0); }
mat4 entityMatrix() {
  float a = poseAlpha;
  vec4 p = mix(poseFrom, poseTo, a);
  float dir = turnFrom.x + shortestTurn(turnTo.x - turnFrom.x) * a;
  float pitch = turnFrom.y + shortestTurn(turnTo.y - turnFrom.y) * a;
  float roll = turnFrom.z + shortestTurn(turnTo.z - turnFrom.z) * a;
  float yaw = radians(90.0 - dir);
  float cy = cos(yaw), sy = sin(yaw);
  float cp = cos(radians(pitch)), sp = sin(radians(pitch));
  float cr = cos(radians(roll)), sr = sin(radians(roll));
  vec3 s = p.w * stretch / 10000.0;
  // As writeMatrix: the local x (heading), y and z axes, as Rz(yaw)·Ry(-pitch)·Rx(roll).
  float y0 = -sy, y1 = cy;
  float z0 = -cy * sp, z1 = -sy * sp, z2 = cp;
  return mat4(
    vec4(cy * cp * s.x, sy * cp * s.x, sp * s.x, 0.0),
    vec4((cr * y0 + sr * z0) * s.y, (cr * y1 + sr * z1) * s.y, sr * z2 * s.y, 0.0),
    vec4((cr * z0 - sr * y0) * s.z, (cr * z1 - sr * y1) * s.z, cr * z2 * s.z, 0.0),
    vec4(p.xyz, 1.0)
  );
}
#endif
`

/** Makes a material's instances use the pose attributes instead of instanceMatrix. */
export function usePoseAttributes(material: THREE.Material, alpha: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.poseAlpha = alpha
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_DECLARATIONS}`)
      .replace('void main() {', 'void main() {\n#ifdef USE_INSTANCING\nmat4 entityM = entityMatrix();\n#define instanceMatrix entityM\n#endif')
  }
  material.customProgramCacheKey = () => `${APP_ID}-pose`
}

const POSE_ATTRIBUTES = [
  ['poseFrom', 4],
  ['poseTo', 4],
  ['turnFrom', 3],
  ['turnTo', 3],
  ['stretch', 3],
] as const

/** One shape's instances, densely packed; entities are swapped with the last one when removed. */
export class ShapeBatch {
  mesh: THREE.InstancedMesh
  count = 0
  /** Instance → slot. */
  slots = new Int32Array(0)
  dirty = false
  /** Pose attributes (POSE_ATTRIBUTES), per instance. */
  poseFrom = new Float32Array(0)
  poseTo = new Float32Array(0)
  turnFrom = new Float32Array(0)
  turnTo = new Float32Array(0)
  stretch = new Float32Array(0)

  constructor(
    private readonly scene: THREE.Scene,
    private readonly shape: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly depthMaterial: THREE.Material,
  ) {
    this.mesh = this.makeMesh(64)
  }

  private makeMesh(capacity: number): THREE.InstancedMesh {
    // Each mesh gets its own geometry sharing the shape's buffers: three.js does not pick up
    // instanced attributes replaced on a geometry it has drawn.
    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(this.shape.index)
    for (const [name, attr] of Object.entries(this.shape.attributes)) geometry.setAttribute(name, attr)
    // The matrix comes from the pose attributes, so instanceMatrix is never uploaded.
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    for (const [name, size] of POSE_ATTRIBUTES) {
      const array = new Float32Array(capacity * size)
      array.set(this[name].subarray(0, Math.min(this[name].length, array.length)))
      this[name] = array
      const attr = new THREE.InstancedBufferAttribute(array, size)
      attr.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute(name, attr)
    }
    mesh.customDepthMaterial = this.depthMaterial
    mesh.count = 0
    mesh.castShadow = true
    mesh.frustumCulled = false
    const slots = new Int32Array(capacity)
    slots.set(this.slots.subarray(0, Math.min(this.slots.length, capacity)))
    this.slots = slots
    return mesh
  }

  /** Adds a slot and returns its instance index. */
  add(slot: number): number {
    if (this.count === this.slots.length) {
      const old = this.mesh
      const mesh = this.makeMesh(this.slots.length * 2)
      ;(mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array)
      mesh.castShadow = old.castShadow
      this.scene.remove(old)
      old.dispose()
      // Frees the old pose buffers but not the shape's, which the new geometry shares.
      for (const name of Object.keys(this.shape.attributes)) old.geometry.deleteAttribute(name)
      old.geometry.setIndex(null)
      old.geometry.dispose()
      this.scene.add(mesh)
      this.mesh = mesh
    }
    this.slots[this.count] = slot
    this.dirty = true
    return this.count++
  }

  /** Removes an instance; returns the slot that moved into its place, or -1. */
  remove(index: number): number {
    const last = --this.count
    this.dirty = true
    if (index === last) return -1
    for (const [name, size] of POSE_ATTRIBUTES) this[name].copyWithin(index * size, last * size, last * size + size)
    const c = this.mesh.instanceColor!.array as Float32Array
    c.copyWithin(index * 3, last * 3, last * 3 + 3)
    const moved = this.slots[last]
    this.slots[index] = moved
    return moved
  }

  upload(shadows: boolean): void {
    this.mesh.count = this.count
    this.mesh.castShadow = shadows
    if (!this.dirty) return
    // Only the instances in use are uploaded.
    for (const [name, size] of POSE_ATTRIBUTES) this.markUsed(this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute, size)
    this.markUsed(this.mesh.instanceColor!, 3)
    this.dirty = false
  }

  private markUsed(attr: THREE.InstancedBufferAttribute, size: number): void {
    if (this.count === 0) return
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, this.count * size)
    attr.needsUpdate = true
  }

  /** Writes an entity's pose at the start and end of the last tick (the same when it did not move). */
  writePose(index: number, E: RenderColumns, i: number, moving: boolean): void {
    const p = index * 4
    const t = index * 3
    const { poseFrom, poseTo, turnFrom, turnTo, stretch } = this
    poseTo[p] = E.x[i]
    poseTo[p + 1] = E.y[i]
    poseTo[p + 2] = E.z[i]
    poseTo[p + 3] = E.size[i]
    turnTo[t] = E.direction[i]
    turnTo[t + 1] = E.pitch[i]
    turnTo[t + 2] = E.roll[i]
    stretch[t] = E.width[i]
    stretch[t + 1] = E.depth[i]
    stretch[t + 2] = E.height[i]
    if (moving) {
      poseFrom[p] = E.px[i]
      poseFrom[p + 1] = E.py[i]
      poseFrom[p + 2] = E.pz[i]
      poseFrom[p + 3] = E.psize[i]
      turnFrom[t] = E.pdirection[i]
      turnFrom[t + 1] = E.ppitch[i]
      turnFrom[t + 2] = E.proll[i]
    } else {
      poseFrom[p] = poseTo[p]
      poseFrom[p + 1] = poseTo[p + 1]
      poseFrom[p + 2] = poseTo[p + 2]
      poseFrom[p + 3] = poseTo[p + 3]
      turnFrom[t] = turnTo[t]
      turnFrom[t + 1] = turnTo[t + 1]
      turnFrom[t + 2] = turnTo[t + 2]
    }
    this.dirty = true
  }
}

/** What EntityInstances reads: the columns and the tick their poses belong to. */
export interface PoseSource {
  readonly store: RenderColumns
  readonly tick: number
}

/** The instanced meshes for every shape, and which instance draws which slot. */
export class EntityInstances {
  readonly geometries: THREE.BufferGeometry[]
  readonly material: THREE.MeshStandardMaterial
  readonly depthMaterial: THREE.MeshDepthMaterial
  readonly batches: ShapeBatch[]
  /** Shared by the instanced materials. */
  readonly poseAlpha = { value: 1 }
  /** Per slot: instance index in its shape's batch (-1 if not drawn), and which batch. */
  instanceOf = new Int32Array(0)
  batchOf = new Uint8Array(0)
  /**
   * Per slot: the pose (POSE_VALUES) last written without interpolation, or NaN.
   * Compared with the store each tick, so edits made between ticks (dragging,
   * the sprite pane) are never missed.
   */
  private drawn = new Float64Array(0)
  /** Per slot: the color last written (the store's columns are only read, so they can be a snapshot). */
  private drawnColor = new Uint32Array(0)
  /** Slots below this may have instances. */
  private drawnHighWater = 0
  /** The tick the instances were last written for. */
  private syncedTick = -1
  private visibleCount = 0

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
    usePoseAttributes(this.material, this.poseAlpha)
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    usePoseAttributes(this.depthMaterial, this.poseAlpha)
    this.geometries = SHAPES.map(makeGeometry)
    this.batches = this.geometries.map((g) => new ShapeBatch(scene, g, this.material, this.depthMaterial))
    for (const b of this.batches) scene.add(b.mesh)
  }

  dispose(): void {
    for (const b of this.batches) b.mesh.dispose()
    for (const g of this.geometries) g.dispose()
    this.material.dispose()
    this.depthMaterial.dispose()
  }

  private ensureSlots(capacity: number): void {
    if (this.instanceOf.length >= capacity) return
    const inst = new Int32Array(capacity).fill(-1)
    inst.set(this.instanceOf)
    this.instanceOf = inst
    const batch = new Uint8Array(capacity)
    batch.set(this.batchOf)
    this.batchOf = batch
    const drawn = new Float64Array(capacity * POSE_VALUES).fill(NaN)
    drawn.set(this.drawn)
    this.drawn = drawn
    const color = new Uint32Array(capacity)
    color.set(this.drawnColor)
    this.drawnColor = color
  }

  private removeInstance(slot: number): void {
    const moved = this.batches[this.batchOf[slot]].remove(this.instanceOf[slot])
    if (moved >= 0) this.instanceOf[moved] = this.instanceOf[slot]
    this.instanceOf[slot] = -1
  }

  /** Called every frame: sets the interpolation and, on the first frame after a tick, writes the instances. */
  sync(source: PoseSource, alpha: number): void {
    this.poseAlpha.value = alpha
    // Poses only change in ticks; edits between ticks (dragging, the sprite pane) show at the next one.
    if (source.tick === this.syncedTick) {
      for (const b of this.batches) b.upload(this.visibleCount <= SHADOW_LIMIT)
      return
    }
    this.syncedTick = source.tick
    const E = source.store
    this.ensureSlots(E.capacity)
    const end = Math.max(E.highWater, this.drawnHighWater)
    const flags = E.flags
    const inst = this.instanceOf
    let visible = 0
    for (let i = 0; i < end; i++) {
      const shown = i < E.highWater && (flags[i] & (F_ALIVE | F_VISIBLE)) === (F_ALIVE | F_VISIBLE)
      if (!shown) {
        if (inst[i] >= 0) this.removeInstance(i)
        continue
      }
      visible++
      const shape = E.shape[i]
      let changed = E.color[i] !== this.drawnColor[i]
      if (inst[i] >= 0 && this.batchOf[i] !== shape) this.removeInstance(i)
      if (inst[i] < 0) {
        inst[i] = this.batches[shape].add(i)
        this.batchOf[i] = shape
        changed = true
      }
      const moving =
        E.x[i] !== E.px[i] || E.y[i] !== E.py[i] || E.z[i] !== E.pz[i] ||
        E.direction[i] !== E.pdirection[i] || E.pitch[i] !== E.ppitch[i] || E.roll[i] !== E.proll[i] || E.size[i] !== E.psize[i]
      const d = this.drawn
      const o = i * POSE_VALUES
      if (
        !moving && !changed &&
        d[o] === E.x[i] && d[o + 1] === E.y[i] && d[o + 2] === E.z[i] && d[o + 3] === E.direction[i] &&
        d[o + 4] === E.pitch[i] && d[o + 5] === E.roll[i] && d[o + 6] === E.size[i] &&
        d[o + 7] === E.width[i] && d[o + 8] === E.depth[i] && d[o + 9] === E.height[i]
      ) continue
      const batch = this.batches[shape]
      batch.writePose(inst[i], E, i, moving)
      if (changed) {
        // setHex converts the sprite's sRGB color to the linear values instance colors hold.
        COLOR.setHex(E.color[i])
        const colors = batch.mesh.instanceColor!.array as Float32Array
        colors[inst[i] * 3] = COLOR.r
        colors[inst[i] * 3 + 1] = COLOR.g
        colors[inst[i] * 3 + 2] = COLOR.b
        this.drawnColor[i] = E.color[i]
      }
      if (moving) d[o] = NaN
      else {
        d[o] = E.x[i]
        d[o + 1] = E.y[i]
        d[o + 2] = E.z[i]
        d[o + 3] = E.direction[i]
        d[o + 4] = E.pitch[i]
        d[o + 5] = E.roll[i]
        d[o + 6] = E.size[i]
        d[o + 7] = E.width[i]
        d[o + 8] = E.depth[i]
        d[o + 9] = E.height[i]
      }
      batch.dirty = true
    }
    this.drawnHighWater = E.highWater
    this.visibleCount = visible
    for (const b of this.batches) b.upload(visible <= SHADOW_LIMIT)
  }
}
