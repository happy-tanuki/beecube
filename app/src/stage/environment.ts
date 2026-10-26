/**
 * What surrounds the sprites, drawn from the current backdrop
 * (engine/backdrop.ts): the scenery (a color or a 360° image), the stage's
 * box (floor, walls and ceiling, with their pictures), the grid with the
 * axes and border, and the lights (with shadows).
 */
import * as THREE from 'three'
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js'
import { ASSET_MIME, assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { FACES, WALL_HEIGHT, type BackdropData, type Face, type FaceName } from '../engine/backdrop'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../engine/types'

function lines(pts: number[], color: string): THREE.LineSegments {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }))
}

/** Grid line colors that show on the floor: darker on a light floor, lighter on a dark one. */
function gridColors(floor: string): [THREE.Color, THREE.Color] {
  const base = new THREE.Color(floor)
  const light = base.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5
  const sign = light ? -1 : 1
  return [base.clone().offsetHSL(0, 0.1, sign * 0.07), base.clone().offsetHSL(0, 0.2, sign * 0.19)]
}

/**
 * A 360° image is shown on a ground-projected skybox: a sphere whose lower
 * half is flattened into a ground, laid on the stage's floor, so the image's
 * ground meets the floor instead of lying far below it. How high the camera
 * that took the image was, in stage units: this sets how big the image's
 * ground looks (a person's eye height, if a sprite is about a person).
 */
const SCENERY_EYE_HEIGHT = 150
/** Big enough to hold the cameras of the preset views; within the camera's far plane. */
const SCENERY_RADIUS = 3000

/**
 * The stage has z up and the image's middle ahead (+y); three.js's sphere
 * has y up and the middle towards +x. This takes three.js's axes to the
 * stage's: +x to +y, +y to +z (and +z to +x).
 */
const SCENERY_ROTATION = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)

type FaceMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>

/**
 * A face of the box, facing inwards. Faces are drawn on their front only, so
 * one seen from outside the box (the near walls, the ceiling from above)
 * disappears. The floor is lit and takes shadows; the walls and the ceiling
 * show their color as it is, like a picture.
 */
function makeFace(name: FaceName): FaceMesh {
  const w = STAGE_WIDTH / 2
  const h = STAGE_HEIGHT / 2
  const mid = WALL_HEIGHT / 2
  const across = name === 'left' || name === 'right' ? STAGE_HEIGHT : STAGE_WIDTH
  const tall = name === 'floor' || name === 'ceiling' ? STAGE_HEIGHT : WALL_HEIGHT
  const material = name === 'floor' ? new THREE.MeshStandardMaterial({ roughness: 1 }) : new THREE.MeshBasicMaterial()
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(across, tall), material)
  // A plane faces +z; turn each to face the inside of the box.
  switch (name) {
    case 'floor': mesh.position.set(0, 0, -0.05); break
    case 'ceiling': mesh.position.set(0, 0, WALL_HEIGHT); mesh.rotation.set(Math.PI, 0, 0); break
    case 'back': mesh.position.set(0, h, mid); mesh.rotation.set(Math.PI / 2, 0, 0); break
    case 'front': mesh.position.set(0, -h, mid); mesh.rotation.set(-Math.PI / 2, 0, Math.PI); break
    case 'left': mesh.position.set(-w, 0, mid); mesh.rotation.set(Math.PI / 2, Math.PI / 2, 0); break
    case 'right': mesh.position.set(w, 0, mid); mesh.rotation.set(Math.PI / 2, -Math.PI / 2, 0); break
  }
  mesh.receiveShadow = name === 'floor'
  return mesh
}

/** A face's picture is drawn over its color on a canvas, which becomes the face's texture. */
interface FacePicture {
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  /** What the canvas shows, so it is only drawn again when that changes. */
  drawn: string
}

export class Environment {
  private readonly faces: Record<FaceName, FaceMesh>
  private readonly pictures = {} as Record<FaceName, FacePicture>
  /** Decoded pictures by file name; null while decoding or if they can't be. */
  private readonly bitmaps = new Map<string, ImageBitmap | null>()
  /** Applied again when a picture has been decoded. */
  private last: { backdrop: BackdropData; assets: Assets } | null = null
  /** 360° scenery by file name. */
  private readonly panoramas = new Map<string, THREE.Texture>()
  private readonly skybox: GroundedSkybox
  /** Takes the shadows on the image's ground when the floor is transparent. */
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  private readonly minor: THREE.LineSegments
  private readonly major: THREE.LineSegments
  /** The grid, the axes and the border. */
  private readonly guides = new THREE.Group()

  constructor(private readonly scene: THREE.Scene) {
    // Its image is set when there is one.
    this.skybox = new GroundedSkybox(new THREE.Texture(), SCENERY_EYE_HEIGHT, SCENERY_RADIUS)
    ;(this.skybox.material as THREE.MeshBasicMaterial).map = null
    this.skybox.quaternion.setFromRotationMatrix(SCENERY_ROTATION)
    // Its ground just under the floor, which lies on it.
    this.skybox.position.set(0, 0, SCENERY_EYE_HEIGHT - 0.1)
    // Drawn first, behind everything.
    this.skybox.renderOrder = -1
    this.skybox.visible = false
    scene.add(this.skybox)
    // As large as the sun's shadows reach.
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.ShadowMaterial({ opacity: 0.3 }))
    this.shadowCatcher.position.z = -0.05
    this.shadowCatcher.receiveShadow = true
    scene.add(this.shadowCatcher)
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

    this.faces = Object.fromEntries(FACES.map((name) => [name, makeFace(name)])) as Environment['faces']
    for (const face of Object.values(this.faces)) scene.add(face)

    const w = STAGE_WIDTH / 2
    const h = STAGE_HEIGHT / 2
    const minor: number[] = []
    const major: number[] = []
    for (let x = -w; x <= w; x += 10) (x % 50 === 0 ? major : minor).push(x, -h, 0, x, h, 0)
    for (let y = -h; y <= h; y += 10) (y % 50 === 0 ? major : minor).push(-w, y, 0, w, y, 0)
    this.minor = lines(minor, '#bfd1ec')
    this.major = lines(major, '#8fb0de')
    this.guides.add(this.minor, this.major)
    this.guides.add(lines([-w, 0, 0.02, w, 0, 0.02], '#e0607a'))
    this.guides.add(lines([0, -h, 0.02, 0, h, 0.02], '#3fae6a'))
    this.guides.add(lines([-w, -h, 0, w, -h, 0, w, -h, 0, w, h, 0, w, h, 0, -w, h, 0, -w, h, 0, -w, -h, 0], '#5b84c4'))
    scene.add(this.guides)
  }

  apply(b: BackdropData, assets: Assets): void {
    this.last = { backdrop: b, assets }
    // The color shows until the image has been decoded.
    const panorama = b.sceneryPicture && this.panorama(b.sceneryPicture, assets)
    this.scene.background = new THREE.Color(b.scenery)
    const material = this.skybox.material as THREE.MeshBasicMaterial
    if (material.map !== panorama) {
      material.map = panorama
      material.needsUpdate = true
    }
    this.skybox.visible = !!panorama
    for (const name of FACES) this.applyFace(name, b.faces[name], assets)
    this.shadowCatcher.visible = this.skybox.visible && !this.faces.floor.visible
    // On a transparent floor, the grid is drawn as on the default floor.
    const [minor, major] = gridColors(b.faces.floor.color ?? '#dbe7f7')
    ;(this.minor.material as THREE.LineBasicMaterial).color.copy(minor)
    ;(this.major.material as THREE.LineBasicMaterial).color.copy(major)
    this.guides.visible = b.grid
  }

  private applyFace(name: FaceName, face: Face, assets: Assets): void {
    const mesh = this.faces[name]
    const material = mesh.material
    const bitmap = face.picture ? this.bitmap(face.picture, assets) : null
    mesh.visible = face.color !== null || bitmap !== null
    if (!bitmap) {
      material.map = null
      material.transparent = false
      if (face.color !== null) material.color.set(face.color)
    } else {
      const picture = (this.pictures[name] ??= this.makePicture())
      const drawn = `${assetFileName(face.picture!)}|${face.color}`
      if (picture.drawn !== drawn) {
        const { canvas } = picture
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const g = canvas.getContext('2d')!
        g.clearRect(0, 0, canvas.width, canvas.height)
        if (face.color !== null) {
          g.fillStyle = face.color
          g.fillRect(0, 0, canvas.width, canvas.height)
        }
        g.drawImage(bitmap, 0, 0)
        // A new texture: one that changes size can't be uploaded again.
        picture.texture.dispose()
        picture.texture = new THREE.CanvasTexture(canvas)
        picture.texture.colorSpace = THREE.SRGBColorSpace
        picture.drawn = drawn
      }
      material.map = picture.texture
      material.transparent = face.color === null
      material.color.set('#ffffff')
    }
    material.needsUpdate = true
  }

  private panorama(ref: AssetRef, assets: Assets): THREE.Texture | null {
    const file = assetFileName(ref)
    let texture = this.panoramas.get(file)
    if (!texture) {
      const bitmap = this.bitmap(ref, assets)
      if (!bitmap) return null
      // Through a canvas, which is turned the right way up when uploaded (an ImageBitmap isn't).
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      this.panoramas.set(file, texture)
    }
    return texture
  }

  private makePicture(): FacePicture {
    const canvas = document.createElement('canvas')
    return { canvas, texture: new THREE.CanvasTexture(canvas), drawn: '' }
  }

  /** The decoded picture, or null until it has been loaded and decoded (then the backdrop is applied again). */
  private bitmap(ref: AssetRef, assets: Assets): ImageBitmap | null {
    const file = assetFileName(ref)
    if (this.bitmaps.has(file)) return this.bitmaps.get(file)!
    this.bitmaps.set(file, null)
    void assets
      .load(ref)
      .then((data) => (data ? createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type: ASSET_MIME[ref.dataFormat] })) : null))
      .then(
        (bitmap) => {
          // Not found: asked again next time (the asset may be added later).
          if (!bitmap) return void this.bitmaps.delete(file)
          this.bitmaps.set(file, bitmap)
          if (this.last) this.apply(this.last.backdrop, this.last.assets)
        },
        (err) => console.warn(`Environment: could not decode ${file}`, err),
      )
    return null
  }
}
