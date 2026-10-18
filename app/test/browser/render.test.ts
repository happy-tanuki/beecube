/**
 * Rendering tests in a real browser (WebGL): the vertex shader that builds
 * instance matrices, and the stage drawing what the store holds.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Runtime } from '../../src/engine/runtime'
import { EntityStore, F_ALIVE, F_VISIBLE } from '../../src/engine/store'
import { SHAPES } from '../../src/engine/types'
import { EntityInstances, usePoseAttributes, writeMatrix } from '../../src/stage/instances'
import { Stage3D } from '../../src/stage/Stage3D'
import { makeSprite } from '../helpers'

const SIZE = 256

/** Renders and returns which pixels are lit (anything but the black background). */
function mask(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Uint8Array {
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const px = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const lit = new Uint8Array(SIZE * SIZE)
  for (let k = 0; k < lit.length; k++) lit[k] = px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2] > 0 ? 1 : 0
  return lit
}

/** Entities of every shape, each moving and turning (across 0° and ±180°) during the last tick. */
function movingEntities(): EntityStore {
  const E = new EntityStore(16)
  for (let k = 0; k < 12; k++) {
    const i = E.alloc()
    E.flags[i] = F_ALIVE | F_VISIBLE
    E.shape[i] = k % SHAPES.length
    E.color[i] = 0xffffff
    E.x[i] = -150 + 100 * (k % 4)
    E.y[i] = -100 + 100 * Math.floor(k / 4)
    E.z[i] = 40
    E.direction[i] = 20 + 25 * k
    E.pitch[i] = 45
    E.roll[i] = -160
    E.size[i] = 90
    E.px[i] = E.x[i] - 30
    E.py[i] = E.y[i] + 10
    E.pz[i] = 20
    E.pdirection[i] = 350 - 10 * k
    E.ppitch[i] = -30
    E.proll[i] = 170
    E.psize[i] = 60
  }
  return E
}

describe('instance pose shader', () => {
  it('draws each entity where writeMatrix puts it, interpolated', () => {
    const canvas = document.createElement('canvas')
    const renderer = new THREE.WebGLRenderer({ canvas })
    renderer.setSize(SIZE, SIZE, false)
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000)
    camera.up.set(0, 0, 1)
    camera.position.set(-120, -420, 330)
    camera.lookAt(0, 0, 0)
    const E = movingEntities()
    const alpha = 0.35

    // Instanced, with the matrix built on the GPU. Unlit, so only the silhouettes are compared.
    const instanced = new THREE.Scene()
    const inst = new EntityInstances(instanced)
    const basic = new THREE.MeshBasicMaterial()
    usePoseAttributes(basic, inst.poseAlpha)
    for (const b of inst.batches) b.mesh.material = basic
    inst.sync({ store: E, tick: 1 }, alpha)

    // One mesh per entity, with the matrix from writeMatrix.
    const reference = new THREE.Scene()
    const out = new Float32Array(16)
    for (let i = 0; i < E.highWater; i++) {
      const mesh = new THREE.Mesh(inst.geometries[E.shape[i]], new THREE.MeshBasicMaterial())
      writeMatrix(E, i, alpha, out, 0)
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(out)
      reference.add(mesh)
    }

    const got = mask(renderer, instanced, camera)
    const want = mask(renderer, reference, camera)
    let lit = 0
    let differ = 0
    for (let k = 0; k < got.length; k++) {
      lit += want[k]
      differ += got[k] ^ want[k]
    }
    expect(lit).toBeGreaterThan(SIZE * SIZE * 0.05)
    // Only edge pixels may round differently.
    expect(differ).toBeLessThan(lit * 0.005)

    // A pose drawn at the start of the tick differs: the comparison can fail.
    inst.poseAlpha.value = 0
    let moved = 0
    const before = mask(renderer, instanced, camera)
    for (let k = 0; k < got.length; k++) moved += before[k] ^ want[k]
    expect(moved).toBeGreaterThan(lit * 0.2)
    renderer.dispose()
  })
})

describe('Stage3D', () => {
  let stage: Stage3D | null = null
  let container: HTMLElement | null = null
  afterEach(() => {
    stage?.dispose()
    container?.remove()
    stage = null
  })

  function open(rt: Runtime) {
    container = document.createElement('div')
    container.style.cssText = 'position:absolute;left:0;top:0;width:480px;height:360px'
    document.body.appendChild(container)
    stage = new Stage3D(container, rt, { onEntityClicked() {}, onEntityGrabbed() {} })
    const canvas = container.querySelector('canvas')!
    const gl = canvas.getContext('webgl2')!
    /** Draws a frame now and returns the color at a world point. */
    const colorAt = (x: number, y: number, z: number): [number, number, number] => {
      ;(stage as unknown as { render(): void }).render()
      const p = stage!.toClient(x, y, z)
      const rect = canvas.getBoundingClientRect()
      const scale = canvas.width / rect.width
      const px = new Uint8Array(4)
      gl.readPixels(Math.round((p.x - rect.left) * scale), Math.round(canvas.height - (p.y - rect.top) * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return [px[0], px[1], px[2]]
    }
    return { canvas, colorAt }
  }

  const reddish = ([r, g, b]: number[]) => r > g + 60 && r > b + 60
  const bluish = ([r, g, b]: number[]) => b > r + 60 && b > g + 30
  const greenish = ([r, g, b]: number[]) => g > r + 60 && g > b + 30

  it('draws sprites in their color and shape, with lighting and shadows, without shader errors', () => {
    const errors = vi.spyOn(console, 'error')
    const rt = new Runtime({ randomSeed: 1 })
    rt.addSprite(makeSprite('red', [], { x: -100, z: 30, color: '#e02020' }))
    rt.addSprite(makeSprite('blue', [], { x: 100, z: 30, color: '#2040e0', shape: 'sphere' }))
    const { colorAt } = open(rt)
    expect(reddish(colorAt(-100, 0, 30))).toBe(true)
    expect(bluish(colorAt(100, 0, 30))).toBe(true)
    // Between them is the floor.
    const floor = colorAt(0, 0, 0)
    expect(reddish(floor) || bluish(floor)).toBe(false)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('interpolates between the start and end of the last tick', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const s = rt.addSprite(makeSprite('red', [], { color: '#e02020' }))
    const { colorAt } = open(rt)
    rt.step()
    const E = rt.store
    E.px[s.slot] = -100
    E.x[s.slot] = 100
    E.z[s.slot] = E.pz[s.slot] = 30
    rt.alpha = () => 0.5
    expect(reddish(colorAt(0, 0, 30))).toBe(true)
    expect(reddish(colorAt(100, 0, 30))).toBe(false)
    rt.alpha = () => 1
    expect(reddish(colorAt(100, 0, 30))).toBe(true)
    expect(reddish(colorAt(0, 0, 30))).toBe(false)
  })

  it('draws every clone when there are more than one mesh holds at first', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const s = rt.addSprite(makeSprite('green', [], { color: '#20c040', size: 30 }))
    const { colorAt } = open(rt)
    colorAt(0, 0, 0)
    for (let k = 0; k < 150; k++) rt.createClone(s.slot, -1)
    rt.step()
    const clones = rt.clonesOf(s)
    clones.forEach((c, k) => {
      c.x = -210 + 30 * (k % 15)
      c.y = -150 + 30 * Math.floor(k / 15)
      c.z = 15
      rt.store.snapPose(c.slot)
    })
    rt.step()
    for (const c of [clones[0], clones[63], clones[64], clones[149]]) expect(greenish(colorAt(c.x, c.y, c.z))).toBe(true)
  })

  it('moves a sprite dragged with the mouse', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const s = rt.addSprite(makeSprite('red', [], { z: 25, color: '#e02020' }))
    const { canvas, colorAt } = open(rt)
    colorAt(0, 0, 0)
    const pointer = (type: string, x: number, y: number) => {
      const p = stage!.toClient(x, y, 25)
      canvas.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true }))
    }
    // setPointerCapture needs a real active pointer; the drag does not depend on it here.
    canvas.setPointerCapture = () => {}
    canvas.hasPointerCapture = () => false
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 60, 40)
    pointer('pointermove', 120, 80)
    pointer('pointerup', 120, 80)
    expect([Math.round(s.x / 10), Math.round(s.y / 10)]).toEqual([12, 8])
    rt.step()
    expect(reddish(colorAt(s.x, s.y, 25))).toBe(true)
    expect(reddish(colorAt(0, 0, 25))).toBe(false)
  })
})
