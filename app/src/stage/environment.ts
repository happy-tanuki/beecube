/**
 * What surrounds the sprites, drawn from the current backdrop
 * (engine/backdrop.ts): the scenery, the stage's box (floor, walls and
 * ceiling), the grid with the axes and border, and the lights (with shadows).
 */
import * as THREE from 'three'
import { FACES, WALL_HEIGHT, type BackdropData, type FaceName } from '../engine/backdrop'
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

export class Environment {
  private readonly faces: Record<FaceName, FaceMesh>
  private readonly minor: THREE.LineSegments
  private readonly major: THREE.LineSegments
  /** The grid, the axes and the border. */
  private readonly guides = new THREE.Group()

  constructor(private readonly scene: THREE.Scene) {
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

  apply(b: BackdropData): void {
    this.scene.background = new THREE.Color(b.scenery)
    for (const name of FACES) {
      const color = b.faces[name].color
      const mesh = this.faces[name]
      mesh.visible = color !== null
      if (color !== null) mesh.material.color.set(color)
    }
    // On a transparent floor, the grid is drawn as on the default floor.
    const [minor, major] = gridColors(b.faces.floor.color ?? '#dbe7f7')
    ;(this.minor.material as THREE.LineBasicMaterial).color.copy(minor)
    ;(this.major.material as THREE.LineBasicMaterial).color.copy(major)
    this.guides.visible = b.grid
  }
}
