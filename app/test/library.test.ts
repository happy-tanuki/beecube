import { describe, expect, it } from 'vitest'
import { assetFileName } from '../src/engine/assets'
import { FACES } from '../src/engine/backdrop'
import { COSTUME_LIBRARY, ROOM_LIBRARY, SCENERY_LIBRARY } from '../src/ui/library'

// The files in public/library (listed, not loaded).
const files = new Set(Object.keys(import.meta.glob('../public/library/*.{jpg,png}')).map((path) => path.split('/').pop()))
const shipped = (file: string) => files.has(file)

describe('the libraries', () => {
  it('ship every picture they refer to', () => {
    for (const s of SCENERY_LIBRARY) expect(shipped(assetFileName(s.picture)), s.key).toBe(true)
    for (const c of COSTUME_LIBRARY) expect(shipped(assetFileName(c.picture)), c.key).toBe(true)
    for (const r of ROOM_LIBRARY)
      for (const name of FACES) {
        const face = r.faces[name]
        expect(face.picture && shipped(assetFileName(face.picture)), `${r.key} ${name}`).toBe(true)
      }
  })

  it("leave rooms' walls with windows transparent, so the scenery shows through", () => {
    for (const r of ROOM_LIBRARY)
      for (const name of FACES) {
        const face = r.faces[name]
        if (face.color === null) expect(face.picture!.dataFormat, `${r.key} ${name}`).toBe('png')
      }
    expect(ROOM_LIBRARY.some((r) => FACES.some((name) => r.faces[name].color === null))).toBe(true)
  })
})
