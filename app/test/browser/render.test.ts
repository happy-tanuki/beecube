/**
 * Rendering tests in a real browser (WebGL): the vertex shader that builds
 * instance matrices, and the stage drawing what the store holds.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plainBackdrop } from '../../src/engine/backdrop'
import { Runtime } from '../../src/engine/runtime'
import { EntityStore, F_ALIVE, F_VISIBLE } from '../../src/engine/store'
import { SHAPES } from '../../src/engine/types'
import { EntityInstances, usePoseAttributes, writeMatrix } from '../../src/stage/instances'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { plainCostume } from '../../src/engine/costume'
import { modelSize, readModel } from '../../src/stage/models'
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
    // A plain shape's look is numbered as the shape.
    E.shape[i] = E.look[i] = k % SHAPES.length
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

  it("draws a costume's picture, with the sprite's color showing through its transparent parts", async () => {
    // Green, with a transparent hole in the middle.
    const picture = document.createElement('canvas')
    picture.width = picture.height = 64
    const g = picture.getContext('2d')!
    g.fillStyle = '#20c020'
    g.fillRect(0, 0, 64, 64)
    g.clearRect(16, 16, 32, 32)
    const png = new Uint8Array(await (await new Promise<Blob>((resolve) => picture.toBlob((b) => resolve(b!), 'image/png'))).arrayBuffer())
    const rt = new Runtime({ randomSeed: 1 })
    const ref = await rt.assets.add(png, 'png')
    const costume = { name: 'hole', shape: 'cube' as const, picture: ref, layout: 'same' as const, model: null }
    rt.addSprite(makeSprite('red', [], { z: 40, size: 200, color: '#e02020', costumes: [costume] }))
    const { colorAt } = open(rt)
    // The top face, 80 up: its middle shows the sprite's color, its corners the picture.
    await vi.waitFor(() => expect(greenish(colorAt(30, 30, 80))).toBe(true))
    expect(reddish(colorAt(0, 0, 80))).toBe(true)
  })

  it("draws a 3D model in its own colors, turned from glTF's axes to the sprite's", async () => {
    // A red box 2 wide (glTF x, the model's left), 1 high (y) and 4 long (z, its front), with a green nose in front.
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial({ color: '#e02020' }))
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: '#20c020' }))
    nose.position.set(0, 0, 2.2)
    const scene = new THREE.Scene()
    scene.add(box, nose)
    const glb = new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer)
    const size = modelSize(await readModel(glb))!
    // Along the sprite's x (front), y (left) and z (up), as fractions of the longest (4.45, with the nose).
    expect(size.map((n) => Math.round(n * 100) / 100)).toEqual([1, 0.45, 0.22])
    const rt = new Runtime({ randomSeed: 1 })
    const asset = await rt.assets.add(glb, 'glb')
    const car = { ...plainCostume('car', 'cube'), model: { asset, size } }
    // Heading +x, as a cube of 200: the model is 80 long, its front (the nose) at x = +40.
    rt.addSprite(makeSprite('car', [], { z: 20, size: 200, color: '#2040e0', costumes: [car] }))
    const { colorAt } = open(rt)
    await vi.waitFor(() => expect(reddish(colorAt(0, 0, 20 + 9))).toBe(true))
    expect(greenish(colorAt(41, 0, 20))).toBe(true)
    // The sprite's color doesn't show, and beside it (y = 30) is the floor.
    expect(bluish(colorAt(0, 30, 20))).toBe(false)
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

  const viewCamera = () => (stage as unknown as { camera: THREE.PerspectiveCamera }).camera
  const selectionShown = () => (stage as unknown as { selection: THREE.Group }).selection.visible

  it('sees from the sprite that is the camera without drawing it, and goes back to the viewer\'s camera', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const red = rt.addSprite(makeSprite('red', [], { x: -100, z: 30, color: '#e02020' }))
    rt.addSprite(makeSprite('blue', [], { x: 100, z: 30, color: '#2040e0', size: 200 }))
    const { colorAt } = open(rt)
    stage!.setView('front')
    stage!.setSelected(red.id)
    const before = viewCamera().position.clone()
    rt.camera.sprite = rt.store.handle(red.slot)
    rt.camera.setZoom(200)
    rt.step()
    // Nor is its selection drawn.
    expect(selectionShown()).toBe(false)
    // Facing +x (direction 90), the blue sprite fills the middle of the view.
    expect(bluish(colorAt(100, 0, 30))).toBe(true)
    expect(viewCamera().position.toArray()).toEqual([-100, 0, 30])
    expect(viewCamera().fov).toBeCloseTo(2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) / 2) * (180 / Math.PI))
    // Turning the sprite turns the camera.
    red.direction = 0
    rt.store.snapPose(red.slot)
    rt.step()
    expect(bluish(colorAt(100, 0, 30))).toBe(false)
    rt.stopAll()
    rt.step()
    expect(reddish(colorAt(-100, 0, 30))).toBe(true)
    expect(viewCamera().position.distanceTo(before)).toBeLessThan(1e-6)
    expect(viewCamera().fov).toBeCloseTo(45)
    expect(selectionShown()).toBe(true)
  })

  it('goes to a view a script asks for, and the view buttons stop a sprite being the camera', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const red = rt.addSprite(makeSprite('red', [], { z: 30, color: '#e02020' }))
    const { colorAt } = open(rt)
    rt.camera.setView('top')
    colorAt(0, 0, 0)
    expect(viewCamera().position.toArray().map(Math.round)).toEqual([0, -1, 520])
    rt.camera.sprite = rt.store.handle(red.slot)
    rt.step()
    colorAt(0, 0, 0)
    stage!.setView('side')
    colorAt(0, 0, 0)
    expect(rt.camera.sprite).toBeNull()
    expect(viewCamera().position.toArray().map((v) => Math.round(v) + 0)).toEqual([500, 0, 70])
    expect(reddish(colorAt(0, 0, 30))).toBe(true)
  })

  it('draws the backdrop: the scenery, the box\'s faces seen from inside only, and the grid', () => {
    const rt = new Runtime({ randomSeed: 1 })
    const eye = rt.addSprite(makeSprite('eye', [], { z: 30, direction: -90, visible: false }))
    const b = plainBackdrop('test')
    b.scenery = '#2040e0'
    b.faces.floor.color = '#20c040'
    b.faces.back.color = '#e02020'
    b.faces.front.color = '#e02020'
    b.grid = false
    rt.backdrops.set([b], 0)
    const { colorAt } = open(rt)
    expect(greenish(colorAt(100, 50, 0))).toBe(true)
    // From the home view (in front of the box, above it): the back wall, but not the front one.
    expect(reddish(colorAt(0, 180, 20))).toBe(true)
    expect(reddish(colorAt(0, -180, 20))).toBe(false)
    // The left wall is transparent: the scenery shows through.
    expect(bluish(colorAt(-240, 100, 20))).toBe(true)
    // From inside, looking at the front wall.
    rt.camera.sprite = rt.store.handle(eye.slot)
    eye.direction = 180
    rt.store.snapPose(eye.slot)
    rt.step()
    expect(reddish(colorAt(0, -180, 30))).toBe(true)
    rt.camera.release()
    // A change shows on the next frame.
    b.faces.back.color = null
    rt.backdrops.changed()
    expect(reddish(colorAt(0, 180, 20))).toBe(false)
  })

  it('draws a face\'s picture once it is decoded, and the scenery through its transparent parts', async () => {
    const rt = new Runtime({ randomSeed: 1 })
    rt.addSprite(makeSprite('a', [], { visible: false }))
    // The left half green, the right half transparent.
    const canvas = new OffscreenCanvas(960, 720)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#20c040'
    g.fillRect(0, 0, 480, 720)
    const picture = await rt.assets.add(new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()), 'png')
    const b = plainBackdrop('test')
    b.scenery = '#2040e0'
    b.faces.back.picture = picture
    b.grid = false
    rt.backdrops.set([b], 0)
    const { colorAt } = open(rt)
    await vi.waitFor(() => expect(greenish(colorAt(-100, 180, 40))).toBe(true))
    expect(bluish(colorAt(100, 180, 40))).toBe(true)
    // Over a color, the transparent parts show the color.
    b.faces.back.color = '#e02020'
    rt.backdrops.changed()
    expect(reddish(colorAt(100, 180, 40))).toBe(true)
    expect(greenish(colorAt(-100, 180, 40))).toBe(true)
  })

  it('shows a 360° scenery image all round, its ground on the floor: its middle ahead, its right to the right, its top above', async () => {
    const rt = new Runtime({ randomSeed: 1 })
    const eye = rt.addSprite(makeSprite('eye', [], { z: 30, direction: 0, visible: false }))
    // Ahead red, to the right green, to the left blue, the sky white, the ground black.
    const canvas = new OffscreenCanvas(512, 256)
    const g = canvas.getContext('2d')!
    const band = (color: string, u0: number, u1: number, v0 = 0, v1 = 1) => {
      g.fillStyle = color
      g.fillRect(u0 * 512, v0 * 256, (u1 - u0) * 512, (v1 - v0) * 256)
    }
    band('#808080', 0, 1)
    band('#e02020', 0.4, 0.6)
    band('#20c040', 0.65, 0.85)
    band('#2040e0', 0.15, 0.35)
    band('#ffffff', 0, 1, 0, 0.15)
    band('#000000', 0, 1, 0.85, 1)
    const picture = await rt.assets.add(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 })).arrayBuffer()), 'jpg')
    const b = plainBackdrop('test')
    b.faces.floor.color = null
    b.sceneryPicture = picture
    b.grid = false
    rt.backdrops.set([b], 0)
    const { colorAt } = open(rt)
    // The image's ground lies on the floor: from the home view, through the
    // transparent floor, the middle of the stage shows what is straight down.
    await vi.waitFor(() => expect(Math.max(...colorAt(0, 0, 0))).toBeLessThan(50))
    rt.camera.sprite = rt.store.handle(eye.slot)
    const look = (direction: number, pitch: number) => {
      eye.direction = direction
      eye.pitch = pitch
      rt.store.snapPose(eye.slot)
      rt.step()
      const rad = (d: number) => (d * Math.PI) / 180
      const far = 1000
      return colorAt(far * Math.sin(rad(direction)) * Math.cos(rad(pitch)), far * Math.cos(rad(direction)) * Math.cos(rad(pitch)), 30 + far * Math.sin(rad(pitch)))
    }
    await vi.waitFor(() => expect(reddish(look(0, 0))).toBe(true))
    expect(greenish(look(90, 0))).toBe(true)
    expect(bluish(look(-90, 0))).toBe(true)
    expect(Math.min(...look(0, 80))).toBeGreaterThan(200)
    expect(Math.max(...look(0, -80))).toBeLessThan(50)
  })
})
