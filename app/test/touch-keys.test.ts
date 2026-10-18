import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '../src/engine/project'
import { usedKeys } from '../src/ui/TouchKeys'

const hat = (key: string) => ({ type: 'event_whenkeypressed', id: `h-${key}`, fields: { KEY_OPTION: key } })
const project = (...blocks: unknown[]) =>
  ({ sprites: [{ blocks: { blocks: { languageVersion: 0, blocks } } }] }) as unknown as ProjectFile

describe('usedKeys', () => {
  it('lists the keys named by key blocks: arrows first, then space, then others', () => {
    const keyMenu = (key: string) => ({
      type: 'sensing_keypressed',
      id: `k-${key}`,
      inputs: { KEY_OPTION: { shadow: { type: 'sensing_keyoptions', id: `m-${key}`, fields: { KEY_OPTION: key } } } },
    })
    expect(usedKeys(project(hat('a'), hat('right arrow'), keyMenu('space'), keyMenu('left arrow')))).toEqual([
      'left arrow',
      'right arrow',
      'space',
      'a',
    ])
  })

  it('treats "any" as space, and a computed key as the arrows and space', () => {
    expect(usedKeys(project(hat('any')))).toEqual(['space'])
    const computed = {
      type: 'sensing_keypressed',
      id: 'k',
      inputs: { KEY_OPTION: { shadow: { type: 'sensing_keyoptions', id: 'm', fields: { KEY_OPTION: 'space' } }, block: { type: 'data_variable', id: 'v' } } },
    }
    expect(usedKeys(project(computed))).toEqual(['up arrow', 'left arrow', 'right arrow', 'down arrow', 'space'])
  })

  it('has no keys for a project without key blocks', () => {
    expect(usedKeys(project({ type: 'event_whenflagclicked', id: 'f' }))).toEqual([])
  })
})
