import { describe, expect, it } from 'vitest'
import { field } from '../src/engine/ir'
import type { BlockJson } from '../src/engine/types'
import { getterFieldsAsXml } from '../src/blocks/getterFields'

describe('getterFieldsAsXml', () => {
  it('turns round reporters’ { id, name } variables into XML text, inside inputs and stacks', () => {
    const reporter: BlockJson = { type: 'data_variable', id: 'r', fields: { VARIABLE: { id: 'v"1', name: 'A & B' } } }
    const list: BlockJson = { type: 'data_listcontents', id: 'l', fields: { LIST: { id: 'list1', name: 'L' } } }
    const set: BlockJson = { type: 'data_setvariableto', id: 's', fields: { VARIABLE: { id: 'v2', name: 'C' } }, inputs: { VALUE: { block: reporter } } }
    const top: BlockJson = { type: 'event_whenflagclicked', id: 't', next: { block: set } }
    const out = getterFieldsAsXml({ blocks: { languageVersion: 0, blocks: [top, list] } })
    const [outTop, outList] = out.blocks!.blocks
    const outSet = outTop.next!.block!
    const outReporter = outSet.inputs!.VALUE.block!
    expect(outReporter.fields!.VARIABLE).toBe('<field name="VARIABLE" id="v&quot;1" variabletype="">A &amp; B</field>')
    expect(field(outReporter, 'VARIABLE')).toBe('v"1')
    expect(outList.fields!.LIST).toBe('<field name="LIST" id="list1" variabletype="list">L</field>')
    // Other variable fields read { id } and stay so.
    expect(outSet.fields!.VARIABLE).toEqual({ id: 'v2', name: 'C' })
  })

  it('leaves XML text as it is', () => {
    const xml = '<field name="VARIABLE" id="v" variabletype="">A</field>'
    const json = { blocks: { blocks: [{ type: 'data_variable', id: 'r', fields: { VARIABLE: xml } }] } }
    expect(getterFieldsAsXml(json)).toEqual(json)
  })
})
