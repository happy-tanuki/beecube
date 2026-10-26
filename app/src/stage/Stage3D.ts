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
 * The camera blocks act through the runtime's Camera (engine/camera.ts).
 * While a sprite is the camera, the view is from it and the viewer can't
 * orbit; when it stops being the camera, the view goes back to where the
 * viewer had it.
 *
 * Coordinates are Z-up and match the engine's (see engine/types.ts).
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { APP_ID } from '../brand'
import { fovOf, type ViewName } from '../engine/camera'
import { boundingRadius } from '../engine/collision'
import type { Runtime } from '../engine/runtime'
import type { EntityView } from '../engine/sprite'
import { F_ALIVE, F_VISIBLE, type EntityStore } from '../engine/store'
import { BASE_SIZE } from '../engine/types'
import { Environment } from './environment'
import { EntityInstances, writeMatrix } from './instances'
import { StampInstances } from './stamps'

export type { ViewName }

export interface StageCallbacks {
  /** An entity was clicked (pressed and released without dragging). */
  onEntityClicked(entity: EntityView): void
  /** An entity was grabbed for dragging. */
  onEntityGrabbed(entity: EntityView): void
}

const DEG = Math.PI / 180
/** Camera positions of the preset views; each looks at the origin. */
const VIEW_POSITIONS: Record<ViewName, [number, number, number]> = {
  home: [-190, -360, 290],
  top: [0, -1, 520],
  front: [0, -500, 70],
  side: [500, 0, 70],
}

/** How far the top of an upright shape is above its center. */
const topOf = (E: EntityStore, slot: number) => (BASE_SIZE / 2) * (E.size[slot] / 100) * (E.height[slot] / 100)
const DRAG_THRESHOLD_PX = 3
/** Speech bubbles shown at once; the ones nearest the camera win. */
const MAX_BUBBLES = 64
/** Pen lines are at least this many CSS pixels wide, however far away, so thin ones don't vanish. */
const PEN_MIN_PIXELS = 1.5

/**
 * Gives pen lines their own width and opacity, from the per-segment
 * `instanceStyle` attribute (pen size, opacity), in place of the material's.
 * The width is in stage units (pen size 1 is 1 unit, as a pixel of Scratch's
 * stage), so lines look thinner further away, like the shapes around them.
 */
function usePenStyles(material: LineMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'uniform float linewidth;',
        'attribute vec2 instanceStyle;\nvarying float vPenOpacity;\nvarying float vPenWidth;\nfloat penWidth;\n#define linewidth penWidth',
      )
      .replace(
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        `vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );
        // Stage units per CSS pixel at the segment's middle.
        float unitsPerPixel = 2.0 * max( - 0.5 * ( start.z + end.z ), 0.0 ) / ( projectionMatrix[ 1 ][ 1 ] * resolution.y );
        penWidth = max( instanceStyle.x, ${PEN_MIN_PIXELS.toFixed(1)} * unitsPerPixel );
        vPenWidth = penWidth;
        vPenOpacity = instanceStyle.y;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float linewidth;', 'varying float vPenOpacity;\nvarying float vPenWidth;\n#define linewidth vPenWidth')
      .replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );', 'gl_FragColor = vec4( diffuseColor.rgb, alpha * vPenOpacity );')
  }
  material.customProgramCacheKey = () => `${APP_ID}-pen`
}

export class Stage3D {
  private readonly renderer: THREE.WebGLRenderer
  private readonly labels: CSS2DRenderer
  private readonly scene = new THREE.Scene()
  private readonly environment: Environment
  /** The runtime's backdrop revision drawn. */
  private backdropRevision = -1
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
  private readonly stamps: StampInstances
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
  /** The viewer's camera (position, target) while a sprite is the camera, to go back to; null otherwise. */
  private viewerCamera: [THREE.Vector3, THREE.Vector3] | null = null
  /** The runtime's view requests already applied. */
  private viewRequests = 0

  /** A press on empty space, which is a click on the stage unless it moves (orbiting). */
  private emptyPress: { pointerId: number; x: number; y: number } | null = null

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
    this.viewRequests = rt.camera.viewRequests
    this.placeView('home')

    this.environment = new Environment(this.scene)

    this.instances = new EntityInstances(this.scene, this.rt.assets)
    this.pickMesh = new THREE.Mesh(this.instances.geometries[0], this.instances.material)
    this.pickMesh.matrixAutoUpdate = false

    this.penMaterial = new LineMaterial({ vertexColors: true, worldUnits: true, transparent: true })
    usePenStyles(this.penMaterial)
    this.penLines = new LineSegments2(new LineSegmentsGeometry(), this.penMaterial)
    this.penLines.frustumCulled = false
    this.penLines.visible = false
    this.scene.add(this.penLines)
    this.stamps = new StampInstances(this.scene, this.rt.assets)

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
    this.stamps.dispose()
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

  /** Puts the camera at a preset view at zoom 100% (no sprite is the camera then). */
  setView(view: ViewName): void {
    this.rt.camera.release()
    this.viewerCamera = null
    this.placeView(view)
  }

  private placeView(view: ViewName): void {
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(...VIEW_POSITIONS[view])
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  /** Outline and direction marker, placed on the selected sprite each frame. */
  private buildSelection(): THREE.Group {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.visible = false
    // Sized to the sprite in syncSelection; the group carries only its pose and size.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
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
    const dt = this.lastFrameAt > 0 ? start - this.lastFrameAt : 0
    if (dt > 0) this.fps = this.fps === 0 ? 1000 / dt : this.fps * 0.9 + (1000 / dt) * 0.1
    this.lastFrameAt = start
    const alpha = this.rt.alpha(start)
    if (this.rt.backdrops.revision !== this.backdropRevision) {
      this.backdropRevision = this.rt.backdrops.revision
      this.environment.apply(this.rt.backdrops.backdrop, this.rt.assets)
    }
    const eyes = this.syncCamera(alpha)
    this.instances.sync(this.rt, alpha, eyes)
    this.syncSelection(alpha)
    this.syncBubbles(alpha, eyes)
    this.syncPen()
    this.stamps.sync(this.rt.pen, this.rt.looks.list)
    const prepared = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
    const end = performance.now()
    this.renderMs = this.renderMs * 0.9 + (end - start) * 0.1
    this.prepareMs = this.prepareMs * 0.9 + (prepared - start) * 0.1
    this.submitMs = this.submitMs * 0.9 + (end - prepared) * 0.1
  }

  /**
   * Sets the zoom and places the camera: at a view a script asked for, at
   * the sprite that is the camera, or where the viewer orbits it. Returns
   * the slot of the sprite that is the camera (not drawn), or -1.
   */
  private syncCamera(alpha: number): number {
    const cam = this.rt.camera
    const fov = fovOf(cam.prevZoom + (cam.zoom - cam.prevZoom) * alpha)
    if (fov !== this.camera.fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    const E = this.rt.store
    const slot = cam.sprite === null ? -1 : E.slotOf(cam.sprite)
    // A deleted clone stops being the camera.
    if (slot < 0) cam.sprite = null
    if (slot < 0 && this.viewerCamera) {
      const [position, target] = this.viewerCamera
      this.viewerCamera = null
      this.camera.up.set(0, 0, 1)
      this.camera.position.copy(position)
      this.controls.target.copy(target)
    }
    if (cam.viewRequests !== this.viewRequests) {
      this.viewRequests = cam.viewRequests
      this.placeView(cam.view)
    }
    this.controls.enabled = slot < 0 && this.drag === null
    if (slot < 0) {
      this.controls.update()
      return -1
    }
    this.viewerCamera ??= [this.camera.position.clone(), this.controls.target.clone()]
    // From the sprite's center along its forward axis, rolled with it.
    writeMatrix(E, slot, alpha, this.scratchMatrix, 0, false)
    const m = this.scratchMatrix
    const s = Math.hypot(m[0], m[1], m[2]) || 1
    this.camera.position.set(m[12], m[13], m[14])
    this.camera.up.set(m[8], m[9], m[10]).normalize()
    this.camera.lookAt(m[12] + m[0] / s, m[13] + m[1] / s, m[14] + m[2] / s)
    return slot
  }

  private selectedSlot(): number {
    if (!this.editable || this.selectedId === null) return -1
    const s = this.rt.getSprite(this.selectedId)
    if (!s || !s.visible) return -1
    // The camera sprite isn't drawn, so neither is its selection.
    const cam = this.rt.camera.sprite
    return cam !== null && this.rt.store.slotOf(cam) === s.slot ? -1 : s.slot
  }

  private syncSelection(alpha: number): void {
    const slot = this.selectedSlot()
    this.selection.visible = slot >= 0
    this.heightHandle.visible = slot >= 0
    if (slot < 0) return
    const E = this.rt.store
    // The outline is stretched to the shape; the nose isn't.
    writeMatrix(E, slot, alpha, this.scratchMatrix, 0, false)
    this.selection.matrix.fromArray(this.scratchMatrix)
    this.selection.matrixWorldNeedsUpdate = true
    const [outline, nose] = this.selection.children
    const margin = 6 / (E.size[slot] / 100)
    outline.scale.set(
      (BASE_SIZE * E.width[slot]) / 100 + margin,
      (BASE_SIZE * E.depth[slot]) / 100 + margin,
      (BASE_SIZE * E.height[slot]) / 100 + margin,
    )
    nose.position.x = (BASE_SIZE / 2) * (E.width[slot] / 100) + 5
    const m = this.scratchMatrix
    this.heightHandle.position.set(m[12], m[13], m[14] + topOf(E, slot) + 18)
  }

  private syncBubbles(alpha: number, hidden: number): void {
    const E = this.rt.store
    const shown: number[] = []
    for (const slot of E.sayers) if (E.flags[slot] & F_VISIBLE && slot !== hidden) shown.push(slot)
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
      const top = topOf(E, slot) + 6
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
      const geometry = new LineSegmentsGeometry().setPositions(pen.positions).setColors(pen.colors)
      geometry.setAttribute('instanceStyle', new THREE.InstancedBufferAttribute(pen.styles, 2))
      this.penLines.geometry = geometry
      this.penDrawn = 0
    }
    const geometry = this.penLines.geometry
    const n = pen.segmentCount
    if (n > this.penDrawn) {
      const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
      const colors = (geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data
      const styles = geometry.attributes.instanceStyle as THREE.InstancedBufferAttribute
      positions.addUpdateRange(this.penDrawn * 6, (n - this.penDrawn) * 6)
      colors.addUpdateRange(this.penDrawn * 6, (n - this.penDrawn) * 6)
      styles.addUpdateRange(this.penDrawn * 2, (n - this.penDrawn) * 2)
      positions.needsUpdate = true
      colors.needsUpdate = true
      styles.needsUpdate = true
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
      const r = boundingRadius(E, i)
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
    if (!entity) {
      this.emptyPress = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
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
    // A click where there is no sprite (not an orbit) clicks the stage.
    const press = this.emptyPress
    this.emptyPress = null
    if (press && press.pointerId === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) {
      this.rt.stageClicked()
    }
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
