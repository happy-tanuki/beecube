/**
 * The 3D stage. Draws the runtime's entities and pen strokes every frame and
 * provides Tinkercad-style manipulation:
 *   - drag a sprite: move it on its current height plane
 *   - drag the cone above the selected sprite: change its height (z)
 *   - left/right drag on empty space: orbit; shift+drag or middle drag: pan; wheel: zoom
 *
 * Entities are drawn as instanced shapes (instances.ts).
 *
 * When not editable (full screen, the player), sprites can only be clicked:
 * nothing is selected or moved, but the camera still orbits.
 *
 * Coordinates are Z-up and match the engine's (see engine/types.ts).
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Runtime } from '../engine/runtime'
import type { EntityView } from '../engine/sprite'
import { F_ALIVE, F_VISIBLE } from '../engine/store'
import { BASE_SIZE, STAGE_HEIGHT, STAGE_WIDTH } from '../engine/types'
import { EntityInstances, writeMatrix } from './instances'

export type ViewName = 'home' | 'top' | 'front' | 'side'

export interface StageCallbacks {
  /** An entity was clicked (pressed and released without dragging). */
  onEntityClicked(entity: EntityView): void
  /** An entity was grabbed for dragging. */
  onEntityGrabbed(entity: EntityView): void
}

const DEG = Math.PI / 180
const DRAG_THRESHOLD_PX = 3
/** Speech bubbles shown at once; the ones nearest the camera win. */
const MAX_BUBBLES = 64
/** Bounding-sphere radius per unit half-size, by shape index (as in collision.ts). */
const BOUNDING = [Math.sqrt(3), 1, Math.SQRT2, Math.SQRT2]

/** Lights (with shadows) and the workplane: floor, grid, axes and border. */
export function addEnvironment(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4d6', 1.6))
  const sun = new THREE.DirectionalLight('#ffffff', 1.8)
  sun.position.set(-200, -300, 600)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -400
  sc.right = 400
  sc.top = 400
  sc.bottom = -400
  sc.near = 10
  sc.far = 1500
  scene.add(sun)

  const w = STAGE_WIDTH / 2
  const h = STAGE_HEIGHT / 2
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_HEIGHT),
    new THREE.MeshStandardMaterial({ color: '#dbe7f7', roughness: 1 }),
  )
  plane.position.z = -0.05
  plane.receiveShadow = true
  scene.add(plane)

  const minor: number[] = []
  const major: number[] = []
  for (let x = -w; x <= w; x += 10) (x % 50 === 0 ? major : minor).push(x, -h, 0, x, h, 0)
  for (let y = -h; y <= h; y += 10) (y % 50 === 0 ? major : minor).push(-w, y, 0, w, y, 0)
  const lines = (pts: number[], color: string) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }))
  }
  scene.add(lines(minor, '#bfd1ec'))
  scene.add(lines(major, '#8fb0de'))
  scene.add(lines([-w, 0, 0.02, w, 0, 0.02], '#e0607a'))
  scene.add(lines([0, -h, 0.02, 0, h, 0.02], '#3fae6a'))
  scene.add(lines([-w, -h, 0, w, -h, 0, w, -h, 0, w, h, 0, w, h, 0, -w, h, 0, -w, h, 0, -w, -h, 0], '#5b84c4'))
}

export class Stage3D {
  private readonly renderer: THREE.WebGLRenderer
  private readonly labels: CSS2DRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly instances: EntityInstances
  private readonly pickMesh: THREE.Mesh
  private readonly bubbles: CSS2DObject[] = []
  private readonly penLines: LineSegments2
  private readonly penMaterial: LineMaterial
  private penArray: Float32Array | null = null
  private penDrawn = 0
  private penClears = -1
  private readonly selection: THREE.Group
  private readonly heightHandle: THREE.Mesh
  private readonly raycaster = new THREE.Raycaster()
  private readonly resizeObserver: ResizeObserver
  private frame = 0
  private selectedId: string | null = null
  private editable = true
  private readonly scratchMatrix = new Float32Array(16)
  /** Milliseconds per frame to prepare and draw, smoothed (for the performance display). */
  renderMs = 0
  /** Of renderMs: updating instances, bubbles and pen (prepare), and three.js uploading and issuing draw calls (submit). */
  prepareMs = 0
  submitMs = 0
  /** Frames per second actually shown, smoothed. */
  fps = 0
  private lastFrameAt = 0

  private drag: {
    mode: 'move' | 'height'
    entity: EntityView
    pointerId: number
    startX: number
    startY: number
    moved: boolean
    /** move: entity position minus the grab point on `plane`. */
    offset: THREE.Vector2
    plane: THREE.Plane
    /** height: z when grabbed and world units per screen pixel at the entity. */
    startZ: number
    unitsPerPixel: number
  } | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly rt: Runtime,
    private readonly callbacks: StageCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.domElement.className = 'stage-labels'
    container.appendChild(this.labels.domElement)

    this.scene.background = new THREE.Color('#f4f7fb')

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
    this.camera.up.set(0, 0, 1)

    // Registered before OrbitControls so a press on a sprite can disable orbiting first.
    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.zoomToCursor = true
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.setView('home')

    addEnvironment(this.scene)

    this.instances = new EntityInstances(this.scene)
    this.pickMesh = new THREE.Mesh(this.instances.geometries[0], this.instances.material)
    this.pickMesh.matrixAutoUpdate = false

    this.penMaterial = new LineMaterial({ linewidth: 2.5, vertexColors: true, worldUnits: false })
    this.penLines = new LineSegments2(new LineSegmentsGeometry(), this.penMaterial)
    this.penLines.frustumCulled = false
    this.penLines.visible = false
    this.scene.add(this.penLines)

    this.selection = this.buildSelection()
    this.scene.add(this.selection)

    this.heightHandle = new THREE.Mesh(
      new THREE.ConeGeometry(7, 16, 24).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#222831' }),
    )
    this.heightHandle.visible = false
    this.scene.add(this.heightHandle)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    const loop = () => {
      this.frame = requestAnimationFrame(loop)
      this.render()
    }
    loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.instances.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }

  /** Projects a world point to client (CSS pixel) coordinates. Used by browser tests. */
  toClient(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
  }

  /** Selects an original sprite by id (its outline, direction marker and height handle show). */
  setSelected(id: string | null): void {
    this.selectedId = id
  }

  /**
   * A JPEG picture of the stage as it looks now, without the selection
   * outline or speech bubbles, `width` pixels wide (for link previews).
   */
  snapshot(width: number, quality = 0.85): Promise<Blob | null> {
    const editable = this.editable
    this.editable = false
    this.render()
    this.editable = editable
    // Read right after drawing, while the drawing buffer still holds the frame.
    const source = this.renderer.domElement
    const out = document.createElement('canvas')
    out.width = width
    out.height = Math.round((width * source.height) / source.width)
    out.getContext('2d')!.drawImage(source, 0, 0, out.width, out.height)
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', quality))
  }

  /** Whether sprites can be selected and moved (see the file comment). */
  setEditable(editable: boolean): void {
    this.editable = editable
  }

  setView(view: ViewName): void {
    const positions: Record<ViewName, [number, number, number]> = {
      home: [-190, -360, 290],
      top: [0, -1, 520],
      front: [0, -500, 70],
      side: [500, 0, 70],
    }
    this.camera.position.set(...positions[view])
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  /** Outline and direction marker, placed on the selected sprite each frame. */
  private buildSelection(): THREE.Group {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.visible = false
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(BASE_SIZE + 6, BASE_SIZE + 6, BASE_SIZE + 6)),
      new THREE.LineBasicMaterial({ color: '#ff8c1a' }),
    )
    group.add(outline)
    // A small nose marks the forward direction.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(4, 10, 16).rotateZ(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#333a45' }),
    )
    nose.position.x = BASE_SIZE / 2 + 5
    group.add(nose)
    return group
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.penMaterial.resolution.set(w, h)
  }

  // ---- per-frame sync --------------------------------------------------

  private render(): void {
    const start = performance.now()
    if (this.lastFrameAt > 0) {
      const dt = start - this.lastFrameAt
      if (dt > 0) this.fps = this.fps === 0 ? 1000 / dt : this.fps * 0.9 + (1000 / dt) * 0.1
    }
    this.lastFrameAt = start
    const alpha = this.rt.alpha(start)
    this.instances.sync(this.rt, alpha)
    this.syncSelection(alpha)
    this.syncBubbles(alpha)
    this.syncPen()
    this.controls.update()
    const prepared = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
    const end = performance.now()
    this.renderMs = this.renderMs * 0.9 + (end - start) * 0.1
    this.prepareMs = this.prepareMs * 0.9 + (prepared - start) * 0.1
    this.submitMs = this.submitMs * 0.9 + (end - prepared) * 0.1
  }

  private selectedSlot(): number {
    if (!this.editable || this.selectedId === null) return -1
    const s = this.rt.getSprite(this.selectedId)
    return s && s.visible ? s.slot : -1
  }

  private syncSelection(alpha: number): void {
    const slot = this.selectedSlot()
    this.selection.visible = slot >= 0
    this.heightHandle.visible = slot >= 0
    if (slot < 0) return
    const E = this.rt.store
    writeMatrix(E, slot, alpha, this.scratchMatrix, 0)
    this.selection.matrix.fromArray(this.scratchMatrix)
    this.selection.matrixWorldNeedsUpdate = true
    const m = this.scratchMatrix
    this.heightHandle.position.set(m[12], m[13], m[14] + (BASE_SIZE / 2) * (E.size[slot] / 100) + 18)
  }

  private syncBubbles(alpha: number): void {
    const E = this.rt.store
    const shown: number[] = []
    for (const slot of E.sayers) if (E.flags[slot] & F_VISIBLE) shown.push(slot)
    if (shown.length > MAX_BUBBLES) {
      const cam = this.camera.position
      const d = (i: number) => (E.x[i] - cam.x) ** 2 + (E.y[i] - cam.y) ** 2 + (E.z[i] - cam.z) ** 2
      shown.sort((a, b) => d(a) - d(b))
      shown.length = MAX_BUBBLES
    }
    while (this.bubbles.length < shown.length) {
      // CSS2DRenderer positions the outer element; the inner one can then be zoomed with the stage.
      const el = document.createElement('div')
      el.appendChild(document.createElement('div')).className = 'speech-bubble'
      const bubble = new CSS2DObject(el)
      bubble.center.set(0, 1)
      this.scene.add(bubble)
      this.bubbles.push(bubble)
    }
    const b = 1 - alpha
    this.bubbles.forEach((bubble, k) => {
      const slot = shown[k]
      bubble.visible = slot !== undefined
      if (slot === undefined) return
      const text = E.saying[slot] ?? ''
      const box = bubble.element.firstElementChild!
      if (box.textContent !== text) box.textContent = text
      const top = (BASE_SIZE / 2) * (E.size[slot] / 100) + 6
      bubble.position.set(E.px[slot] * b + E.x[slot] * alpha, E.py[slot] * b + E.y[slot] * alpha, E.pz[slot] * b + E.z[slot] * alpha + top)
    })
  }

  /** Uploads only the segments added since the last frame. */
  private syncPen(): void {
    const pen = this.rt.pen
    if (pen.clears !== this.penClears) {
      this.penClears = pen.clears
      this.penDrawn = 0
    }
    if (pen.positions !== this.penArray) {
      // The pen's arrays grew: build a geometry on the new ones. Reusing the old
      // geometry would keep three.js's instance limit at the old capacity.
      this.penArray = pen.positions
      this.penLines.geometry.dispose()
      this.penLines.geometry = new LineSegmentsGeometry().setPositions(pen.positions).setColors(pen.colors)
      this.penDrawn = 0
    }
    const geometry = this.penLines.geometry
    const n = pen.segmentCount
    if (n > this.penDrawn) {
      const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
      const colors = (geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data
      positions.addUpdateRange(this.penDrawn * 6, (n - this.penDrawn) * 6)
      colors.addUpdateRange(this.penDrawn * 6, (n - this.penDrawn) * 6)
      positions.needsUpdate = true
      colors.needsUpdate = true
    }
    this.penDrawn = n
    geometry.instanceCount = n
    this.penLines.visible = n > 0
  }

  // ---- pointer handling ------------------------------------------------

  private setRay(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
  }

  /** The nearest entity under the ray: bounding spheres first, then the exact shape of the candidates. */
  private pickEntity(): EntityView | null {
    const E = this.rt.store
    const { origin, direction } = this.raycaster.ray
    const hits: { slot: number; t: number }[] = []
    for (let i = 0; i < E.highWater; i++) {
      if ((E.flags[i] & (F_ALIVE | F_VISIBLE)) !== (F_ALIVE | F_VISIBLE)) continue
      const r = (BASE_SIZE / 2) * (E.size[i] / 100) * BOUNDING[E.shape[i]]
      const ox = E.x[i] - origin.x
      const oy = E.y[i] - origin.y
      const oz = E.z[i] - origin.z
      const along = ox * direction.x + oy * direction.y + oz * direction.z
      const d2 = ox * ox + oy * oy + oz * oz - along * along
      if (d2 > r * r) continue
      hits.push({ slot: i, t: along - Math.sqrt(r * r - d2) })
    }
    hits.sort((a, b) => a.t - b.t)
    let best: { slot: number; distance: number } | null = null
    for (const { slot, t } of hits) {
      if (best && t > best.distance) break
      this.pickMesh.geometry = this.instances.geometries[E.shape[slot]]
      writeMatrix(E, slot, 1, this.scratchMatrix, 0)
      this.pickMesh.matrixWorld.fromArray(this.scratchMatrix)
      const hit = this.raycaster.intersectObject(this.pickMesh, false)[0]
      if (hit && (!best || hit.distance < best.distance)) best = { slot, distance: hit.distance }
    }
    return best ? this.rt.entity(best.slot) : null
  }

  private rayOnPlane(plane: THREE.Plane): THREE.Vector3 | null {
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.rt.mouse.down = true
    if (e.button !== 0 || e.shiftKey) return
    this.setRay(e)

    const selected = this.selectedSlot()
    if (selected >= 0 && this.heightHandle.visible && this.raycaster.intersectObject(this.heightHandle).length > 0) {
      this.beginDrag(e, 'height', this.rt.entity(selected)!, new THREE.Plane(), new THREE.Vector2())
      return
    }

    const entity = this.pickEntity()
    if (!entity) return
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -entity.z)
    const hit = this.rayOnPlane(plane)
    const offset = hit ? new THREE.Vector2(entity.x - hit.x, entity.y - hit.y) : new THREE.Vector2()
    this.beginDrag(e, 'move', entity, plane, offset)
  }

  private beginDrag(
    e: PointerEvent,
    mode: 'move' | 'height',
    entity: EntityView,
    plane: THREE.Plane,
    offset: THREE.Vector2,
  ): void {
    this.controls.enabled = false
    this.renderer.domElement.setPointerCapture(e.pointerId)
    // Height follows vertical mouse movement in screen space, which works from any view angle.
    const distance = this.camera.position.distanceTo(new THREE.Vector3(entity.x, entity.y, entity.z))
    const viewHeight = 2 * distance * Math.tan((this.camera.fov * DEG) / 2)
    this.drag = {
      mode,
      entity,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      offset,
      plane,
      startZ: entity.z,
      unitsPerPixel: viewHeight / this.renderer.domElement.clientHeight,
    }
    if (this.editable) this.callbacks.onEntityGrabbed(entity)
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setRay(e)
    const ground = this.rayOnPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
    if (ground) {
      this.rt.mouse.x = ground.x
      this.rt.mouse.y = ground.y
    }

    const drag = this.drag
    if (!drag || drag.pointerId !== e.pointerId) {
      if (!drag) this.renderer.domElement.style.cursor = this.hoverCursor()
      return
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    if (!this.editable) return
    // The entity may have been deleted while dragging.
    if (!this.rt.store.isAlive(drag.entity.slot)) return
    // Direct manipulation moves the entity without drawing with its pen, and without interpolation.
    if (drag.mode === 'height') {
      drag.entity.z = Math.round(drag.startZ - (e.clientY - drag.startY) * drag.unitsPerPixel)
    } else {
      const hit = this.rayOnPlane(drag.plane)
      if (!hit) return
      drag.entity.x = Math.round(hit.x + drag.offset.x)
      drag.entity.y = Math.round(hit.y + drag.offset.y)
    }
    this.rt.store.snapPose(drag.entity.slot)
  }

  private hoverCursor(): string {
    if (this.heightHandle.visible && this.raycaster.intersectObject(this.heightHandle).length > 0) return 'ns-resize'
    if (!this.pickEntity()) return 'default'
    return this.editable ? 'grab' : 'pointer'
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.rt.mouse.down = false
    const drag = this.drag
    if (!drag || drag.pointerId !== e.pointerId) return
    this.drag = null
    this.controls.enabled = true
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId)
    }
    if (!drag.moved && drag.mode === 'move') this.callbacks.onEntityClicked(drag.entity)
  }
}
