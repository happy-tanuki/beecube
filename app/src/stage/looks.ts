/**
 * Drawing costumes' looks (engine/costume.ts): each shape's geometry with
 * texture coordinates for the ways a picture wraps it, materials that show
 * a picture over the sprite's color (its transparent parts show the color,
 * as a backdrop's faces do), and models (models.ts). Pictures and models
 * load from the runtime's assets; until a picture has, the shape shows its
 * color, and until a model has, nothing is drawn.
 *
 * Shapes are built in local space: x is the front (the heading), y the
 * left and z up. Seen from outside, a face's picture is upright; the top's
 * points away from the front, the bottom's towards it.
 */
import * as THREE from 'three'
import { APP_ID } from '../brand'
import { ASSET_MIME, assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { NET_COLUMNS, NET_ROWS, type CostumeLayout, type Look } from '../engine/costume'
import { BASE_SIZE, SHAPES } from '../engine/types'
import type { BatchPart } from './instances'
import { modelParts, readModel } from './models'

/** A part of the picture, in texture coordinates (v up): left, bottom, width, height. */
type Region = [number, number, number, number]

const WHOLE: Region = [0, 0, 1, 1]

/** A square of the net's grid, by column and row (counted from the top). */
const cell = (column: number, row: number): Region => [
  column / NET_COLUMNS,
  1 - (row + 1) / NET_ROWS,
  1 / NET_COLUMNS,
  1 / NET_ROWS,
]

/** A cube's faces: outward normal, the picture's right and up, and where it is on the net. */
const CUBE_FACES: [THREE.Vector3Tuple, THREE.Vector3Tuple, THREE.Vector3Tuple, Region][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1], cell(1, 1)], // front
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1], cell(2, 1)], // left side, right of the front on the net
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1], cell(3, 1)], // back
  [[0, -1, 0], [1, 0, 0], [0, 0, 1], cell(0, 1)], // right side
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0], cell(1, 0)], // top
  [[0, 0, -1], [0, 1, 0], [1, 0, 0], cell(1, 2)], // bottom
]

function cubeGeometry(layout: CostumeLayout): THREE.BufferGeometry {
  const h = BASE_SIZE / 2
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (const [n, r, u, net] of CUBE_FACES) {
    const [left, bottom, width, height] = layout === 'net' ? net : WHOLE
    const base = position.length / 3
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) position.push((n[k] + a * r[k] + b * u[k]) * h)
      normal.push(...n)
      uv.push(left + ((a + 1) / 2) * width, bottom + ((b + 1) / 2) * height)
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/** The parts of a cylinder's or a cone's net: its side, and its ends (null for the cone's tip). */
const ROUND_NETS: Record<'cylinder' | 'cone', { side: Region; top: Region | null; bottom: Region }> = {
  cylinder: { side: [0, 1 / 3, 1, 1 / 3], top: [0.375, 2 / 3, 0.25, 1 / 3], bottom: [0.375, 0, 0.25, 1 / 3] },
  cone: { side: [0, 1 / 3, 1, 2 / 3], top: null, bottom: [0.375, 0, 0.25, 1 / 3] },
}

/**
 * A cylinder or a cone, upright, with its texture coordinates set for the
 * layout: three.js wraps the side from behind, so turned to put the
 * picture's middle on the front; the ends are mapped from above and below.
 */
function roundGeometry(shape: 'cylinder' | 'cone', layout: CostumeLayout): THREE.BufferGeometry {
  const r = BASE_SIZE / 2
  const segments = 32
  const g =
    shape === 'cylinder'
      ? new THREE.CylinderGeometry(r, r, BASE_SIZE, segments)
      : new THREE.ConeGeometry(r, BASE_SIZE, segments)
  g.rotateX(Math.PI / 2).rotateZ(-Math.PI / 2)
  const net = ROUND_NETS[shape]
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  const index = g.getIndex()!
  const into = ([left, bottom, width, height]: Region, u: number, v: number) => [left + u * width, bottom + v * height]
  for (const group of g.groups) {
    // three.js makes the side first, then the top (the cylinder's only) and the bottom.
    const part = group.materialIndex === 0 ? 'side' : group.materialIndex === 1 && net.top ? 'top' : 'bottom'
    const seen = new Set<number>()
    for (let k = group.start; k < group.start + group.count; k++) {
      const i = index.getX(k)
      if (seen.has(i)) continue
      seen.add(i)
      let u: number, v: number
      if (part === 'side') {
        u = uv.getX(i)
        v = uv.getY(i)
      } else {
        // Seen from outside: right is +y, and up is away from the front on top, towards it below.
        u = 0.5 + pos.getY(i) / (2 * r)
        v = 0.5 + (part === 'top' ? -pos.getX(i) : pos.getX(i)) / (2 * r)
      }
      const [s, t] = layout === 'net' ? into(net[part]!, u, v) : [u, v]
      uv.setXY(i, s, t)
    }
  }
  return g
}

/** A sphere with its poles up and down, and the picture's middle on the front. */
function sphereGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(BASE_SIZE / 2, 48, 24).rotateX(Math.PI / 2)
}

/** The geometry of a shape (index into SHAPES) wrapped with a picture laid out so. */
export function texturedGeometry(shape: number, layout: CostumeLayout): THREE.BufferGeometry {
  const kind = SHAPES[shape]
  switch (kind) {
    case 'cube':
      return cubeGeometry(layout)
    case 'sphere':
      return sphereGeometry()
    case 'cylinder':
    case 'cone':
      return roundGeometry(kind, layout)
  }
}

/**
 * Makes a material with a map show the map over the instance color by its
 * alpha, instead of multiplying them; chained after `onBeforeCompile` if
 * the material has one (the pose attributes).
 */
export function usePictureOverColor(material: THREE.Material): void {
  const before = material.onBeforeCompile.bind(material)
  const key = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
#ifdef USE_MAP
vec4 pictureTexel = texture2D(map, vMapUv);
diffuseColor.rgb = mix(diffuseColor.rgb, pictureTexel.rgb, pictureTexel.a);
#endif`,
    )
  }
  material.customProgramCacheKey = () => `${key()}-${APP_ID}-picture`
}

/**
 * What to draw for each look (a batch's parts), made when first asked for
 * and kept: a plain shape, a shape with its picture, or a model's meshes.
 * `prepare` readies each material for how the caller draws (the pose
 * attributes).
 */
export class LookResources {
  private readonly plainMaterial: THREE.MeshStandardMaterial
  private readonly geometries = new Map<string, THREE.BufferGeometry>()
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly models = new Map<string, Promise<BatchPart[]>>()

  constructor(
    private readonly assets: Assets,
    private readonly plainGeometries: THREE.BufferGeometry[],
    private readonly prepare: (material: THREE.Material) => void,
  ) {
    this.plainMaterial = this.makeMaterial()
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
    this.prepare(m)
    return m
  }

  /** The material plain shapes are drawn with. */
  get material(): THREE.Material {
    return this.plainMaterial
  }

  /** A look's parts now; a model's are none until it has loaded, when `ready` gets them. */
  parts(look: Look, ready: (parts: BatchPart[]) => void): BatchPart[] {
    if (look.model) {
      void this.model(look.model).then(ready)
      return []
    }
    return [{ geometry: this.geometry(look), material: this.pictureMaterial(look), tinted: true }]
  }

  private geometry(look: Look): THREE.BufferGeometry {
    if (!look.picture) return this.plainGeometries[look.shape]
    const key = `${look.shape}:${look.layout}`
    let g = this.geometries.get(key)
    if (!g) this.geometries.set(key, (g = texturedGeometry(look.shape, look.layout)))
    return g
  }

  private pictureMaterial(look: Look): THREE.Material {
    if (!look.picture) return this.plainMaterial
    const key = assetFileName(look.picture)
    let m = this.materials.get(key)
    if (!m) {
      m = this.makeMaterial()
      usePictureOverColor(m)
      this.materials.set(key, m)
      const material = m
      void this.load(look.picture).then((texture) => {
        if (!texture) return
        material.map = texture
        material.needsUpdate = true
      })
    }
    return m
  }

  private model(ref: AssetRef): Promise<BatchPart[]> {
    const key = assetFileName(ref)
    let parts = this.models.get(key)
    if (!parts) {
      parts = (async () => {
        const data = await this.assets.load(ref)
        if (!data) return []
        return modelParts(await readModel(data)).map(({ geometry, material }) => {
          for (const m of Array.isArray(material) ? material : [material]) this.prepare(m)
          return { geometry, material, tinted: false }
        })
      })().catch((err) => {
        console.warn(`LookResources: the model ${key} could not be read`, err)
        return []
      })
      this.models.set(key, parts)
    }
    return parts
  }

  private async load(ref: AssetRef): Promise<THREE.Texture | null> {
    const key = assetFileName(ref)
    const have = this.textures.get(key)
    if (have) return have
    const data = await this.assets.load(ref)
    if (!data) return null
    const bitmap = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type: ASSET_MIME[ref.dataFormat] }))
    // Drawn onto a canvas, which three.js flips like an image (an ImageBitmap it can't).
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    this.textures.set(key, texture)
    return texture
  }

  dispose(): void {
    this.plainMaterial.dispose()
    for (const g of this.geometries.values()) g.dispose()
    for (const m of this.materials.values()) m.dispose()
    for (const t of this.textures.values()) t.dispose()
    for (const parts of this.models.values()) {
      void parts.then((ps) => {
        for (const p of ps) {
          p.geometry.dispose()
          for (const m of Array.isArray(p.material) ? p.material : [p.material]) m.dispose()
        }
      })
    }
  }
}
