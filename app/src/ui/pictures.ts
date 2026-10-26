/**
 * Turning image files into pictures: a picture for one face of a backdrop,
 * a 360° image for the scenery, or a costume's picture. Pictures are
 * re-encoded in the browser (which also drops a photo's location and other
 * metadata): JPEG, or PNG when they have transparent parts.
 */
import type { PictureFormat } from '../engine/assets'
import { FACE_SIZE, type FaceName } from '../engine/backdrop'

/** Pictures have twice as many pixels across as the face is long, as Scratch's bitmaps have twice the stage's. */
const RESOLUTION = 2

/** 360° images are scaled down to this width (a common size limit for textures). */
const PANORAMA_WIDTH = 4096
const PANORAMA_QUALITY = 0.7

/** Costumes' pictures are scaled down to fit this many pixels across and down (a sprite is small on the stage). */
const COSTUME_SIZE = 1024

export interface Picture {
  data: Uint8Array
  format: PictureFormat
}

export const pictureSize = (face: FaceName): [number, number] => [FACE_SIZE[face][0] * RESOLUTION, FACE_SIZE[face][1] * RESOLUTION]

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return [c, c.getContext('2d', { willReadFrequently: true })!]
}

async function encode(c: HTMLCanvasElement, g: CanvasRenderingContext2D, quality = 0.85): Promise<Picture> {
  const pixels = g.getImageData(0, 0, c.width, c.height).data
  let opaque = true
  for (let i = 3; i < pixels.length && opaque; i += 4) opaque = pixels[i] === 255
  const format: PictureFormat = opaque ? 'jpg' : 'png'
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, opaque ? 'image/jpeg' : 'image/png', quality))
  if (!blob) throw new Error('the picture could not be encoded')
  return { data: new Uint8Array(await blob.arrayBuffer()), format }
}

/** A picture for a face: the image scaled to cover the face, keeping its shape, cut off evenly where it is longer. */
export async function facePicture(file: Blob, face: FaceName): Promise<Picture> {
  const image = await createImageBitmap(file)
  const [width, height] = pictureSize(face)
  const scale = Math.max(width / image.width, height / image.height)
  const [c, g] = canvas(width, height)
  g.imageSmoothingQuality = 'high'
  g.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale)
  image.close()
  return encode(c, g)
}

/** A 360° image (equirectangular, twice as wide as tall) for the scenery, scaled down if it is wider than textures can be. */
export async function panoramaPicture(file: Blob): Promise<Picture> {
  const image = await createImageBitmap(file)
  const width = Math.min(image.width, PANORAMA_WIDTH)
  const height = Math.round((image.height * width) / image.width)
  const [c, g] = canvas(width, height)
  g.imageSmoothingQuality = 'high'
  g.drawImage(image, 0, 0, width, height)
  image.close()
  // A lower quality: 360° images are big, and show only a part at a time.
  return encode(c, g, PANORAMA_QUALITY)
}

/** A costume's picture: the image as it is, scaled down to fit COSTUME_SIZE. */
export async function costumePicture(file: Blob): Promise<Picture> {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, COSTUME_SIZE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const [c, g] = canvas(width, height)
  g.imageSmoothingQuality = 'high'
  g.drawImage(image, 0, 0, width, height)
  image.close()
  return encode(c, g)
}
