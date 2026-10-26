import { describe, expect, it } from 'vitest'
import { costumeGuide, floodFill, hexToRgba, newCostumeSize, rgbToHex, type Pixels } from '../src/ui/paint'

/** A picture from rows of characters: '.' transparent, '#' black. */
function picture(rows: string[]): Pixels {
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * rows.length * 4)
  rows.forEach((row, y) => [...row].forEach((c, x) => c === '#' && data.set([0, 0, 0, 255], (y * width + x) * 4)))
  return { data, width, height: rows.length }
}

const filled = (p: Pixels) =>
  Array.from({ length: p.height }, (_, y) =>
    Array.from({ length: p.width }, (_, x) => (p.data[(y * p.width + x) * 4] === 255 ? 'r' : p.data[(y * p.width + x) * 4 + 3] ? '#' : '.')).join(''),
  )

describe('floodFill', () => {
  it('fills the area inside lines, round corners and into nooks, and nothing outside', () => {
    const p = picture([
      '#######',
      '#.....#',
      '#.###.#',
      '#.#.#.#',
      '#...#.#',
      '#######',
    ])
    expect(floodFill(p, 1, 1, [255, 0, 0, 255])).toBe(true)
    expect(filled(p)).toEqual([
      '#######',
      '#rrrrr#',
      '#r###r#',
      '#r#r#r#',
      '#rrr#r#',
      '#######',
    ])
  })

  it('does nothing outside the picture or where the color is already', () => {
    const p = picture(['#.', '..'])
    expect(floodFill(p, 5, 0, [255, 0, 0, 255])).toBe(false)
    expect(floodFill(p, 0, 0, [0, 0, 0, 255])).toBe(false)
  })
})

describe('colors', () => {
  it('converts between "#rrggbb" and RGBA', () => {
    expect(hexToRgba('#ff8000')).toEqual([255, 128, 0, 255])
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000')
  })
})

describe('costume guides', () => {
  it('show a net’s parts, a globe’s front, and nothing for the same picture on every side', () => {
    expect(costumeGuide('cube', 'net').map((p) => p.label)).toEqual([
      'costume.part.top', 'costume.part.right', 'costume.part.front', 'costume.part.left', 'costume.part.back', 'costume.part.bottom',
    ])
    expect(costumeGuide('cube', 'same')).toEqual([])
    expect(costumeGuide('sphere', 'net')[0]).toEqual({ kind: 'line', x: 0.5, label: 'costume.part.front' })
    expect(costumeGuide('cone', 'net').map((p) => p.kind)).toEqual(['rect', 'circle'])
    expect(newCostumeSize('cube', 'net')).toEqual([1024, 768])
    expect(newCostumeSize('sphere', 'same')).toEqual([1024, 512])
  })
})
