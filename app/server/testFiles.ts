/** Small files laid out as PNG, JPEG and binary glTF are (see files.ts), for tests. Their pixels are not real. */

const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => [...p]))
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** The checksum is not checked, so it is left 0. */
const chunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]

/** A PNG; `extra` bytes of text in a tEXt chunk. */
export function pngFile({ width = 2, height = 2, extra = 0, seed = 0 } = {}): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    extra ? chunk('tEXt', new Array<number>(extra).fill(0x61)) : [],
    chunk('IDAT', [0x78, 0x9c, seed, 0xff, 0x00]),
    chunk('IEND', []),
  )
}

/** A JPEG; `extra` bytes in its APP0 segment, counting the segment's length. */
export function jpegFile({ width = 2, height = 2, extra = 16 } = {}): Uint8Array {
  const segment = (marker: number, data: number[]) => [0xff, marker, ...be16(data.length + 2), ...data]
  return bytes(
    [0xff, 0xd8],
    segment(0xe0, new Array<number>(Math.max(extra - 2, 0)).fill(0)),
    segment(0xc0, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    // Coded data, with a coded FF and a restart.
    [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56],
    [0xff, 0xd9],
  )
}

/** A binary glTF with a buffer of `bin` bytes (none if 0), its chunk padded by `binPadding`. */
export function glbFile({ json = { asset: { version: '2.0' } } as Record<string, unknown>, bin = 6, binPadding = 2 } = {}): Uint8Array {
  const gltf = bin ? { ...json, buffers: [{ byteLength: bin }] } : json
  const text = ascii(JSON.stringify(gltf))
  while (text.length % 4) text.push(0x20)
  const body = [...le32(text.length), ...ascii('JSON'), ...text]
  if (bin) body.push(...le32(bin + binPadding), ...ascii('BIN'), 0, ...new Array<number>(bin + binPadding).fill(7))
  return bytes(ascii('glTF'), le32(2), le32(12 + body.length), body)
}
