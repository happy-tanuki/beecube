/**
 * The round variable and list reporters (`data_variable`, `data_listcontents`)
 * keep their variable in a scratch-blocks field that only reads XML text,
 * `<field name="VARIABLE" id="…" variabletype="">name</field>`, and the
 * editor saves them so. A project file written by hand or by another tool
 * may give them as `{ id, name }`, as other variable fields are; the
 * runtime reads both (engine/ir.ts, `field`), but the editor could not show
 * them. This turns such fields into the XML text the editor reads.
 */
import type { BlockJson, WorkspaceJson } from '../engine/types'

const GETTERS: Record<string, { field: string; variableType: string }> = {
  data_variable: { field: 'VARIABLE', variableType: '' },
  data_listcontents: { field: 'LIST', variableType: 'list' },
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function fixBlock(b: BlockJson): BlockJson {
  let out = b
  const getter = GETTERS[b.type]
  const f = getter && b.fields?.[getter.field]
  if (f && typeof f === 'object') {
    const { id, name } = f as { id?: unknown; name?: unknown }
    const xml = `<field name="${getter.field}" id="${escape(String(id ?? ''))}" variabletype="${getter.variableType}">${escape(String(name ?? ''))}</field>`
    out = { ...out, fields: { ...b.fields, [getter.field]: xml } }
  }
  if (b.inputs) {
    const inputs = Object.fromEntries(
      Object.entries(b.inputs).map(([k, v]) => [
        k,
        { ...v, ...(v.block && { block: fixBlock(v.block) }), ...(v.shadow && { shadow: fixBlock(v.shadow) }) },
      ]),
    )
    out = { ...out, inputs }
  }
  if (b.next?.block) out = { ...out, next: { ...b.next, block: fixBlock(b.next.block) } }
  return out
}

/** `json` with its round reporters' variables as XML text (see above). */
export function getterFieldsAsXml(json: WorkspaceJson): WorkspaceJson {
  if (!json.blocks) return json
  return { ...json, blocks: { ...json.blocks, blocks: json.blocks.blocks.map(fixBlock) } }
}
