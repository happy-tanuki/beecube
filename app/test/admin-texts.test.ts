import { describe, expect, it } from 'vitest'
import { projectTexts } from '../src/admin/texts'

describe('projectTexts', () => {
  it('finds what people typed and skips machine data', () => {
    const project = {
      format: 'x-project',
      sprites: [
        {
          id: 'sprite-1',
          name: 'Robot',
          color: '#ff0000',
          shape: 'cube',
          variables: { v1: { name: 'secret word', value: 'banana' } },
          lists: {},
          blocks: {
            blocks: {
              languageVersion: 0,
              blocks: [
                {
                  type: 'looks_say',
                  id: 'b1',
                  inputs: { MESSAGE: { shadow: { type: 'text', id: 'b2', fields: { TEXT: 'Hello there' } } } },
                  next: { block: { type: 'motion_movesteps', id: 'b3', inputs: { STEPS: { shadow: { type: 'math_number', id: 'b4', fields: { NUM: '10' } } } } } },
                },
              ],
            },
          },
        },
      ],
      variables: [{ id: 'g1', name: 'score', value: 0 }],
      lists: [{ id: 'l1', name: 'names', items: ['Alice', 'Alice', 'Bob'] }],
      broadcasts: [{ id: 'm1', name: 'game over' }],
      extensions: ['physics'],
      monitors: ['var:g1'],
    }
    expect(projectTexts(project)).toEqual(['Robot', 'secret word', 'banana', 'Hello there', 'score', 'names', 'Alice', 'Bob', 'game over'])
  })
})
