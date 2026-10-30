/**
 * Checks that an uploaded picture or 3D model is one, through and through:
 * its parts laid out as the format has them, ending where the file ends,
 * with little room besides the picture itself. So a file that starts as a
 * picture can't carry something else (a zip, a program) after it or in it,
 * and the API can't be used to keep and hand out other files.
 *
 * The pictures the editor uploads are its own, re-encoded by the browser
 * (src/ui/pictures.ts), so these checks can be strict.
 */
import type { AssetFormat } from '../src/engine/assets'

/** Pixels across and down, at most: 360° images are 4096 wide. */
export const MAX_PICTURE_SIDE = 8192

/** Bytes a picture may have besides its pixels (color profiles, the format's own notes). */
export const MAX_PICTURE_EXTRAS = 128 * 1024

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

const okSize = (width: number, height: number) => width > 0 && height > 0 && width <= MAX_PICTURE_SIDE && height <= MAX_PICTURE_SIDE

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const chunkType = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

/** PNG: the signature, then chunks (IHDR first, IEND last, right at the end), with few bytes outside the pixels. */
export function isPng(bytes: Uint8Array): boolean {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return false
  let pos = PNG_SIGNATURE.length
  let extras = 0
  for (let first = true; ; first = false) {
    // Each chunk: its length, its type, its data and a checksum.
    if (pos + 12 > bytes.length) return false
    const length = be32(bytes, pos)
    const type = chunkType(bytes, pos + 4)
    const end = pos + 12 + length
    if (end > bytes.length) return false
    if (first !== (type === 'IHDR')) return false
    if (type === 'IHDR' && (length !== 13 || !okSize(be32(bytes, pos + 8), be32(bytes, pos + 12)))) return false
    if (type === 'IEND') return length === 0 && end === bytes.length
    if (type !== 'IHDR' && type !== 'PLTE' && type !== 'IDAT' && (extras += length) > MAX_PICTURE_EXTRAS) return false
    pos = end
  }
}

/** JPEG: SOI, segments, scans and EOI right at the end, with few bytes in notes (APPn, COM). */
export function isJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let pos = 2
  let extras = 0
  let frame = false
  let scan = false
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return false
    // A marker may be preceded by fill bytes (FF).
    while (bytes[pos + 1] === 0xff) pos++
    const marker = bytes[pos + 1]
    if (marker === 0xd9) return frame && scan && pos + 2 === bytes.length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }
    if (pos + 4 > bytes.length) return false
    const length = be16(bytes, pos + 2)
    const end = pos + 2 + length
    if (length < 2 || end > bytes.length) return false
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      if ((extras += length) > MAX_PICTURE_EXTRAS) return false
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // A frame header: precision, then height and width.
      if (length < 8 || !okSize(be16(bytes, pos + 7), be16(bytes, pos + 5))) return false
      frame = true
    }
    pos = end
    if (marker === 0xda) {
      // The scan's coded data runs to the next marker; FF 00 is a coded FF, and FF D0 to FF D7 are restarts within it.
      scan = true
      for (;;) {
        pos = bytes.indexOf(0xff, pos)
        if (pos < 0 || pos + 1 >= bytes.length) return false
        const next = bytes[pos + 1]
        if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break
        pos += 2
      }
    }
  }
  return false
}

const GLB_MAGIC = 0x46546c67 // "glTF"
const JSON_CHUNK = 0x4e4f534a // "JSON"
const BIN_CHUNK = 0x004e4942 // "BIN\0"

interface Gltf {
  asset?: { version?: unknown }
  buffers?: { uri?: unknown; byteLength?: unknown }[]
  images?: { uri?: unknown }[]
}

/**
 * Binary glTF 2.0: the header, a JSON chunk that is glTF and, if its first
 * buffer is the file's own, a BIN chunk as long as it; nothing else. Files
 * it refers to must be inside it (data: URIs), so a model never fetches
 * anything.
 */
export function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || le32(bytes, 0) !== GLB_MAGIC || le32(bytes, 4) !== 2 || le32(bytes, 8) !== bytes.length) return false
  const jsonLength = le32(bytes, 12)
  const jsonEnd = 20 + jsonLength
  if (le32(bytes, 16) !== JSON_CHUNK || jsonLength % 4 !== 0 || jsonEnd > bytes.length) return false
  let gltf: Gltf
  try {
    gltf = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(20, jsonEnd)))
  } catch {
    return false
  }
  if (typeof gltf !== 'object' || gltf === null || Array.isArray(gltf)) return false
  if (typeof gltf.asset?.version !== 'string' || !gltf.asset.version.startsWith('2.')) return false
  const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].map((x) => x?.uri)
  if (uris.some((uri) => uri !== undefined && !(typeof uri === 'string' && uri.startsWith('data:')))) return false
  const own = gltf.buffers?.[0] && gltf.buffers[0].uri === undefined ? gltf.buffers[0] : null
  if (jsonEnd === bytes.length) return !own
  if (!own || typeof own.byteLength !== 'number' || jsonEnd + 8 > bytes.length) return false
  const binLength = le32(bytes, jsonEnd)
  // The BIN chunk is the buffer, padded to 4 bytes, and ends the file.
  return (
    le32(bytes, jsonEnd + 4) === BIN_CHUNK &&
    binLength % 4 === 0 &&
    jsonEnd + 8 + binLength === bytes.length &&
    binLength >= own.byteLength &&
    binLength - own.byteLength < 4
  )
}

/** Whether `bytes` are a file of `format` that passes the checks above. */
export const isAssetFile = (bytes: Uint8Array, format: AssetFormat): boolean =>
  format === 'png' ? isPng(bytes) : format === 'jpg' ? isJpeg(bytes) : isGlb(bytes)
