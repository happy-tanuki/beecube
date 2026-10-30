import { describe, expect, it } from 'vitest'
import { isAssetFile, isGlb, isJpeg, isPng, MAX_PICTURE_EXTRAS } from './files'
import { glbFile, jpegFile, pngFile } from './testFiles'

/** The library's files: read from disk, by Node's fs (typed loosely, as these sources have no Node types). */
const LIBRARY = new URL('../public/library/', import.meta.url)
const fs: { readdirSync(dir: URL): string[]; readFileSync(file: URL): Uint8Array } = await import('node:fs' as string)

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** What a zip file starts with. */
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

describe('uploaded files', () => {
  it('passes the library’s pictures and models', () => {
    const files = fs.readdirSync(LIBRARY).filter((name) => /\.(png|jpg|glb)$/.test(name))
    expect(files.length).toBeGreaterThan(20)
    for (const name of files) {
      const format = name.slice(-3) as 'png' | 'jpg' | 'glb'
      expect([name, isAssetFile(new Uint8Array(fs.readFileSync(new URL(name, LIBRARY))), format)]).toEqual([name, true])
    }
  })

  it('checks PNG files through', () => {
    expect(isPng(pngFile())).toBe(true)
    expect(isPng(concat(pngFile(), ZIP))).toBe(false)
    expect(isPng(pngFile().slice(0, -1))).toBe(false)
    expect(isPng(pngFile({ width: 9000 }))).toBe(false)
    expect(isPng(pngFile({ extra: MAX_PICTURE_EXTRAS }))).toBe(true)
    expect(isPng(pngFile({ extra: MAX_PICTURE_EXTRAS + 1 }))).toBe(false)
    expect(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).toBe(false)
  })

  it('checks JPEG files through', () => {
    expect(isJpeg(jpegFile())).toBe(true)
    expect(isJpeg(concat(jpegFile(), ZIP))).toBe(false)
    expect(isJpeg(jpegFile().slice(0, -2))).toBe(false)
    expect(isJpeg(jpegFile({ height: 9000 }))).toBe(false)
    expect(isJpeg(jpegFile({ extra: MAX_PICTURE_EXTRAS + 1 }))).toBe(false)
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBe(false)
  })

  it('checks binary glTF files through', () => {
    expect(isGlb(glbFile())).toBe(true)
    expect(isGlb(glbFile({ bin: 0 }))).toBe(true)
    expect(isGlb(concat(glbFile(), ZIP))).toBe(false)
    // The header's length must be the file's, and the BIN chunk the buffer's.
    expect(isGlb(glbFile({ binPadding: 8 }))).toBe(false)
    expect(isGlb(glbFile({ json: { asset: { version: '1.0' } } }))).toBe(false)
    expect(isGlb(glbFile({ json: { asset: { version: '2.0' }, images: [{ uri: 'https://example.com/a.png' }] } }))).toBe(false)
    expect(isGlb(glbFile({ json: { asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AAAA' }] } }))).toBe(true)
    expect(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]))).toBe(false)
  })
})
