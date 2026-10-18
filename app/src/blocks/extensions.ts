/**
 * Turns extension specs into scratch-blocks block definitions and toolbox
 * categories. Each extension gets a block style named `ext_<id>`.
 */
import * as ScratchBlocks from 'scratch-blocks'
import { isBlock, localize, opcodeOf, parseBlockText, type ArgSpec, type ExtensionBlock, type ExtensionSpec } from '../engine/extension'
import { getLocale } from '../i18n'

export const extensionStyle = (ext: ExtensionSpec) => `ext_${ext.id}`

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SHAPE_EXTENSION: Record<ExtensionBlock['type'], string> = {
  command: 'shape_statement',
  reporter: 'output_number',
  boolean: 'output_boolean',
  hat: 'shape_hat',
}

function argJson(name: string, spec: ArgSpec, locale: string): object {
  if (spec.type === 'menu') {
    return { type: 'field_dropdown', name, options: spec.options.map(([label, value]) => [localize(label, locale), value]) }
  }
  if (spec.type === 'boolean') return { type: 'input_value', name, check: 'Boolean' }
  return { type: 'input_value', name }
}

const defined = new Set<string>()

/** Registers the extension's blocks with scratch-blocks (once per extension). */
export function defineExtensionBlocks(ext: ExtensionSpec): void {
  if (defined.has(ext.id)) return
  defined.add(ext.id)
  for (const block of ext.blocks.filter(isBlock)) {
    ScratchBlocks.Blocks[opcodeOf(ext, block)] = {
      init(this: ScratchBlocks.Block) {
        const locale = getLocale()
        const args: object[] = []
        let message = ''
        for (const part of parseBlockText(localize(block.text, locale))) {
          if (typeof part === 'string') {
            message += part.replace(/%/g, '%%')
            continue
          }
          const spec = block.args?.[part.arg]
          if (!spec) throw new Error(`extension ${ext.id}: block ${block.opcode} text uses unknown arg [${part.arg}]`)
          args.push(argJson(part.arg, spec, locale))
          message += `%${args.length}`
        }
        this.jsonInit({
          message0: message,
          args0: args,
          style: extensionStyle(ext),
          checkboxInFlyout: false,
          extensions: [SHAPE_EXTENSION[block.type]],
        })
      },
    }
  }
}

function shadowXml(name: string, spec: ArgSpec): string {
  const d = spec.default
  switch (spec.type) {
    case 'number':
      return `<value name="${name}"><shadow type="math_number"><field name="NUM">${escapeXml(String(d ?? 0))}</field></shadow></value>`
    case 'angle':
      return `<value name="${name}"><shadow type="math_angle"><field name="NUM">${escapeXml(String(d ?? 90))}</field></shadow></value>`
    case 'string':
      return `<value name="${name}"><shadow type="text"><field name="TEXT">${escapeXml(String(d ?? ''))}</field></shadow></value>`
    case 'color':
      return `<value name="${name}"><shadow type="colour_picker"><field name="COLOUR">${escapeXml(String(d ?? '#ff0000'))}</field></shadow></value>`
    case 'menu':
      return d === undefined ? '' : `<field name="${name}">${escapeXml(String(d))}</field>`
    case 'boolean':
      return ''
  }
}

/** The extension's toolbox category. Call after defineExtensionBlocks. */
export function extensionCategoryXml(ext: ExtensionSpec): string {
  const contents = ext.blocks
    .map((b) => {
      if (!isBlock(b)) return '<sep gap="36"/>'
      const inner = Object.entries(b.args ?? {})
        .map(([n, s]) => shadowXml(n, s))
        .join('')
      return `<block type="${opcodeOf(ext, b)}">${inner}</block>`
    })
    .join('')
  const [primary, secondary] = ext.colours
  return `<category name="${escapeXml(localize(ext.name, getLocale()))}" id="${ext.id}" colour="${primary}" secondaryColour="${secondary}">${contents}</category>`
}
