/**
 * Blockly JSON → IR: a tree of statements and expressions with fields read
 * (variable ids, menu values), inputs resolved (a block over a shadow wins)
 * and typed-in values turned into constants.
 */
import { isBlock, opcodeOf, type CommandBlock, type ExtensionBlock, type ExtensionSpec, type HatBlock, type ReporterBlock } from './extension'
import { isCanonicalNumber } from './ops'
import type { BlockJson, Value, WorkspaceJson } from './types'

export interface Expr {
  /** Block type, or 'const'. */
  op: string
  id: string
  /** The value of a constant. */
  v?: Value
  in: Record<string, Expr>
  f: Record<string, string>
  /** Set on extension reporters. */
  ext?: ReporterBlock
}

export interface Stmt {
  op: string
  id: string
  in: Record<string, Expr>
  f: Record<string, string>
  body?: Stmt[]
  body2?: Stmt[]
  /** procedures_call: the custom block and its arguments in parameter order. */
  call?: { proccode: string; args: Expr[] }
  /** Set on extension commands. */
  ext?: CommandBlock
}

export type Hat =
  | { kind: 'flag' }
  | { kind: 'key'; key: string }
  | { kind: 'click' }
  | { kind: 'message'; id: string }
  | { kind: 'clone' }
  /** Starts when the entity begins touching an entity of `target` (a sprite name, MYSELF for its own kind, or EDGE). */
  | { kind: 'touch'; target: string }
  /** A hat from an extension; `fields` holds its menu values. */
  | { kind: 'extension'; opcode: string; fields: Record<string, string> }

export interface ScriptIR {
  topId: string
  /** null for stacks run by clicking them. */
  hat: Hat | null
  body: Stmt[]
  /** The stack's JSON, to tell whether it changed. */
  source: string
}

export interface ProcIR {
  proccode: string
  /** Parameter names, in order. */
  params: string[]
  warp: boolean
  body: Stmt[]
  source: string
}

export interface KindIR {
  scripts: ScriptIR[]
  procs: Map<string, ProcIR>
}

// ---- extension blocks ----------------------------------------------------

const extensionBlocks = new Map<string, ExtensionBlock>()

/** Makes an extension's blocks compilable. Opcodes are namespaced, so registering twice is harmless. */
export function registerExtensionBlocks(ext: ExtensionSpec): void {
  for (const block of ext.blocks.filter(isBlock)) extensionBlocks.set(opcodeOf(ext, block), block)
}

function extensionHat(type: string): HatBlock | null {
  const b = extensionBlocks.get(type)
  return b?.type === 'hat' ? b : null
}

// ---- block JSON helpers -------------------------------------------------

const XML_ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }

/** Reads an XML attribute from serialized XML text, without a DOM. */
export function xmlAttr(xml: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml)
  return m ? m[1].replace(/&(quot|apos|lt|gt|amp);/g, (_, e: string) => XML_ENTITIES[e]) : null
}

/**
 * A field's value; for variable fields, the variable id. Variable fields come
 * in two shapes: `{ id }` from Blockly's JSON serializer, and XML text such as
 * `<field name="VARIABLE" id="…">name</field>` from scratch-blocks fields that
 * only implement XML serialization (e.g. the round variable reporter).
 */
export function field(b: BlockJson, name: string): string {
  const f = b.fields?.[name]
  if (f === undefined || f === null) return ''
  if (typeof f === 'object') {
    const o = f as { id?: unknown; name?: unknown }
    return String(o.id ?? o.name ?? '')
  }
  if (typeof f === 'string' && f.startsWith('<field')) return xmlAttr(f, 'id') ?? ''
  return String(f)
}

interface Mutation {
  proccode: string
  argumentids: string[]
  argumentnames: string[]
  warp: boolean
}

/**
 * Reads a procedure mutation. Blockly's JSON keeps it as the XML string from
 * scratch-blocks' mutationToDom; this parses the attributes without a DOM.
 */
function parseMutation(extraState: unknown): Mutation | null {
  if (typeof extraState !== 'string') return null
  const attr = (name: string): string | null => xmlAttr(extraState, name)
  const list = (name: string): string[] => {
    try {
      const v: unknown = JSON.parse(attr(name) ?? '[]')
      return Array.isArray(v) ? v.map(String) : []
    } catch {
      return []
    }
  }
  const proccode = attr('proccode')
  if (proccode === null) return null
  return { proccode, argumentids: list('argumentids'), argumentnames: list('argumentnames'), warp: attr('warp') === 'true' }
}

function prototypeOf(definition: BlockJson): BlockJson | undefined {
  const slot = definition.inputs?.custom_block
  return slot?.block ?? slot?.shadow
}

const warned = new Set<string>()
function warnUnknown(kind: string, opcode: string): void {
  if (warned.has(opcode)) return
  warned.add(opcode)
  console.warn(`compiler: unknown ${kind} block "${opcode}" is ignored`)
}

// ---- block tables ----------------------------------------------------------

/** Statement blocks: input names and substacks. */
const STATEMENTS: Record<string, { inputs?: string[]; fields?: string[]; substacks?: number }> = {
  control_forever: { substacks: 1 },
  control_repeat: { inputs: ['TIMES'], substacks: 1 },
  control_repeat_until: { inputs: ['CONDITION'], substacks: 1 },
  control_wait_until: { inputs: ['CONDITION'] },
  control_if: { inputs: ['CONDITION'], substacks: 1 },
  control_if_else: { inputs: ['CONDITION'], substacks: 2 },
  control_wait: { inputs: ['DURATION'] },
  control_stop: { fields: ['STOP_OPTION'] },
  control_create_clone_of: { inputs: ['CLONE_OPTION'] },
  control_delete_this_clone: {},
  event_broadcast: { inputs: ['BROADCAST_INPUT'] },
  event_broadcastandwait: { inputs: ['BROADCAST_INPUT'] },
  motion_ifonedgebounce: {},
  motion_movesteps: { inputs: ['STEPS'] },
  motion_turnright: { inputs: ['DEGREES'] },
  motion_turnleft: { inputs: ['DEGREES'] },
  motion_pointindirection: { inputs: ['DIRECTION'] },
  motion_pointtowards: { inputs: ['TOWARDS'] },
  motion_goto: { inputs: ['TO'] },
  motion_gotoxy: { inputs: ['X', 'Y'] },
  motion_gotoxyz: { inputs: ['X', 'Y', 'Z'] },
  motion_glidesecstoxy: { inputs: ['SECS', 'X', 'Y'] },
  motion_glidesecstoxyz: { inputs: ['SECS', 'X', 'Y', 'Z'] },
  motion_glideto: { inputs: ['SECS', 'TO'] },
  motion_setx: { inputs: ['X'] },
  motion_sety: { inputs: ['Y'] },
  motion_setz: { inputs: ['Z'] },
  motion_changexby: { inputs: ['DX'] },
  motion_changeyby: { inputs: ['DY'] },
  motion_changezby: { inputs: ['DZ'] },
  motion_setpitch: { inputs: ['PITCH'] },
  motion_turnup: { inputs: ['DEGREES'] },
  motion_turndown: { inputs: ['DEGREES'] },
  motion_setroll: { inputs: ['ROLL'] },
  motion_changerollby: { inputs: ['DEGREES'] },
  motion_rollright: { inputs: ['DEGREES'] },
  motion_rollleft: { inputs: ['DEGREES'] },
  looks_show: {},
  looks_hide: {},
  looks_say: { inputs: ['MESSAGE'] },
  looks_sayforsecs: { inputs: ['MESSAGE', 'SECS'] },
  looks_setsizeto: { inputs: ['SIZE'] },
  looks_changesizeby: { inputs: ['CHANGE'] },
  looks_setdimensionto: { inputs: ['VALUE'], fields: ['DIMENSION'] },
  looks_changedimensionby: { inputs: ['VALUE'], fields: ['DIMENSION'] },
  looks_setcolorto: { inputs: ['COLOR'] },
  sensing_resettimer: {},
  data_setvariableto: { inputs: ['VALUE'], fields: ['VARIABLE'] },
  data_changevariableby: { inputs: ['VALUE'], fields: ['VARIABLE'] },
  data_showvariable: { fields: ['VARIABLE'] },
  data_hidevariable: { fields: ['VARIABLE'] },
  data_addtolist: { inputs: ['ITEM'], fields: ['LIST'] },
  data_deleteoflist: { inputs: ['INDEX'], fields: ['LIST'] },
  data_deletealloflist: { fields: ['LIST'] },
  data_insertatlist: { inputs: ['ITEM', 'INDEX'], fields: ['LIST'] },
  data_replaceitemoflist: { inputs: ['INDEX', 'ITEM'], fields: ['LIST'] },
  data_showlist: { fields: ['LIST'] },
  data_hidelist: { fields: ['LIST'] },
  pen_clear: {},
  pen_penDown: {},
  pen_penUp: {},
  pen_setPenColorToColor: { inputs: ['COLOR'] },
  pen_changePenColorParamBy: { inputs: ['VALUE'], fields: ['COLOR_PARAM'] },
  pen_setPenColorParamTo: { inputs: ['VALUE'], fields: ['COLOR_PARAM'] },
  pen_changePenSizeBy: { inputs: ['SIZE'] },
  pen_setPenSizeTo: { inputs: ['SIZE'] },
  pen_stamp: {},
  pen_drawCube: { inputs: ['SIZE'] },
  pen_drawSphere: { inputs: ['RADIUS'] },
  camera_setsprite: {},
  camera_setview: { fields: ['VIEW'] },
  camera_setzoomto: { inputs: ['ZOOM'] },
  camera_changezoomby: { inputs: ['ZOOM'] },
}

/** Reporter blocks: input and field names. */
const REPORTERS: Record<string, { inputs?: string[]; fields?: string[] }> = {
  motion_xposition: {},
  motion_yposition: {},
  motion_zposition: {},
  motion_direction: {},
  motion_pitch: {},
  motion_roll: {},
  looks_size: {},
  looks_width: {},
  looks_depth: {},
  looks_height: {},
  event_broadcast_menu: { fields: ['BROADCAST_OPTION'] },
  sensing_touchingobject: { inputs: ['TOUCHINGOBJECTMENU'] },
  sensing_distanceto: { inputs: ['DISTANCETOMENU'] },
  sensing_keypressed: { inputs: ['KEY_OPTION'] },
  sensing_mousedown: {},
  sensing_mousex: {},
  sensing_mousey: {},
  sensing_timer: {},
  sensing_of: { inputs: ['OBJECT'], fields: ['PROPERTY'] },
  sensing_touchedsprite: {},
  sensing_touchingcolor: { inputs: ['COLOR'] },
  operator_add: { inputs: ['NUM1', 'NUM2'] },
  operator_subtract: { inputs: ['NUM1', 'NUM2'] },
  operator_multiply: { inputs: ['NUM1', 'NUM2'] },
  operator_divide: { inputs: ['NUM1', 'NUM2'] },
  operator_mod: { inputs: ['NUM1', 'NUM2'] },
  operator_round: { inputs: ['NUM'] },
  operator_mathop: { inputs: ['NUM'], fields: ['OPERATOR'] },
  operator_random: { inputs: ['FROM', 'TO'] },
  operator_lt: { inputs: ['OPERAND1', 'OPERAND2'] },
  operator_gt: { inputs: ['OPERAND1', 'OPERAND2'] },
  operator_equals: { inputs: ['OPERAND1', 'OPERAND2'] },
  operator_and: { inputs: ['OPERAND1', 'OPERAND2'] },
  operator_or: { inputs: ['OPERAND1', 'OPERAND2'] },
  operator_not: { inputs: ['OPERAND'] },
  operator_join: { inputs: ['STRING1', 'STRING2'] },
  operator_letter_of: { inputs: ['LETTER', 'STRING'] },
  operator_length: { inputs: ['STRING'] },
  operator_contains: { inputs: ['STRING1', 'STRING2'] },
  argument_reporter_string_number: { fields: ['VALUE'] },
  argument_reporter_boolean: { fields: ['VALUE'] },
  data_variable: { fields: ['VARIABLE'] },
  data_listcontents: { fields: ['LIST'] },
  data_itemoflist: { inputs: ['INDEX'], fields: ['LIST'] },
  data_itemnumoflist: { inputs: ['ITEM'], fields: ['LIST'] },
  data_lengthoflist: { fields: ['LIST'] },
  data_listcontainsitem: { inputs: ['ITEM'], fields: ['LIST'] },
}

const HAT_TYPES = new Set([
  'event_whenflagclicked',
  'event_whenkeypressed',
  'event_whenthisspriteclicked',
  'event_whenbroadcastreceived',
  'control_start_as_clone',
  'event_whentouchingobject',
])

export function isHatType(type: string): boolean {
  return HAT_TYPES.has(type) || extensionHat(type) !== null || type === 'procedures_definition'
}

export function isStatementType(type: string): boolean {
  return type in STATEMENTS || type === 'procedures_call' || extensionBlocks.get(type)?.type === 'command'
}

// ---- parsing ----------------------------------------------------------------

export function constant(v: Value, id = ''): Expr {
  return { op: 'const', id, v, in: {}, f: {} }
}

/** A typed-in value: canonical numbers become numbers. */
function literal(raw: unknown): Value {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'boolean') return raw
  const s = raw === undefined || raw === null ? '' : String(raw)
  return isCanonicalNumber(s) ? Number(s) : s
}

function parseInput(b: BlockJson, name: string): Expr {
  const slot = b.inputs?.[name]
  const target = slot?.block ?? slot?.shadow
  return target ? parseExpr(target) : constant('')
}

function readFields(b: BlockJson, names: string[] | undefined): Record<string, string> {
  const f: Record<string, string> = {}
  for (const n of names ?? []) f[n] = field(b, n)
  return f
}

export function parseExpr(b: BlockJson): Expr {
  const spec = REPORTERS[b.type]
  if (spec) {
    const ins: Record<string, Expr> = {}
    for (const n of spec.inputs ?? []) ins[n] = parseInput(b, n)
    return { op: b.type, id: b.id, in: ins, f: readFields(b, spec.fields) }
  }
  const ext = extensionBlocks.get(b.type)
  if (ext && (ext.type === 'reporter' || ext.type === 'boolean')) {
    const { ins, f } = extensionArgs(b, ext)
    return { op: b.type, id: b.id, in: ins, f, ext }
  }
  // Shadow menus and literals (math_number, text, *_menu, ...) carry a single field.
  const names = Object.keys(b.fields ?? {})
  if (names.length === 1 && !b.inputs) {
    const raw = b.fields![names[0]]
    return constant(typeof raw === 'object' && raw !== null ? field(b, names[0]) : literal(raw), b.id)
  }
  warnUnknown('reporter', b.type)
  return constant('', b.id)
}

/** Menus are fields on the block; every other argument is an input. */
function extensionArgs(b: BlockJson, block: ExtensionBlock): { ins: Record<string, Expr>; f: Record<string, string> } {
  const ins: Record<string, Expr> = {}
  const f: Record<string, string> = {}
  for (const [name, spec] of Object.entries(block.args ?? {})) {
    if (spec.type === 'menu') f[name] = field(b, name)
    else ins[name] = parseInput(b, name)
  }
  return { ins, f }
}

function parseStatement(b: BlockJson): Stmt | null {
  const spec = STATEMENTS[b.type]
  if (spec) {
    const ins: Record<string, Expr> = {}
    for (const n of spec.inputs ?? []) ins[n] = parseInput(b, n)
    const s: Stmt = { op: b.type, id: b.id, in: ins, f: readFields(b, spec.fields) }
    if (spec.substacks) s.body = parseStack(b.inputs?.SUBSTACK?.block)
    if (spec.substacks === 2) s.body2 = parseStack(b.inputs?.SUBSTACK2?.block)
    return s
  }
  if (b.type === 'procedures_call') {
    const m = parseMutation(b.extraState)
    if (!m) return null
    // Caller inputs are named by argument id, in the same order as the parameters.
    return { op: b.type, id: b.id, in: {}, f: {}, call: { proccode: m.proccode, args: m.argumentids.map((id) => parseInput(b, id)) } }
  }
  const ext = extensionBlocks.get(b.type)
  if (ext?.type === 'command') {
    const { ins, f } = extensionArgs(b, ext)
    return { op: b.type, id: b.id, in: ins, f, ext }
  }
  warnUnknown('statement', b.type)
  return null
}

export function parseStack(first: BlockJson | undefined): Stmt[] {
  const out: Stmt[] = []
  for (let b = first; b; b = b.next?.block) {
    const s = parseStatement(b)
    if (s) out.push(s)
  }
  return out
}

function hatOf(b: BlockJson): Hat | null {
  const ext = extensionHat(b.type)
  if (ext) {
    const fields: Record<string, string> = {}
    for (const [n, spec] of Object.entries(ext.args ?? {})) if (spec.type === 'menu') fields[n] = field(b, n)
    return { kind: 'extension', opcode: b.type, fields }
  }
  switch (b.type) {
    case 'event_whenflagclicked':
      return { kind: 'flag' }
    case 'event_whenkeypressed':
      return { kind: 'key', key: field(b, 'KEY_OPTION') }
    case 'event_whenthisspriteclicked':
      return { kind: 'click' }
    case 'event_whenbroadcastreceived':
      return { kind: 'message', id: field(b, 'BROADCAST_OPTION') }
    case 'control_start_as_clone':
      return { kind: 'clone' }
    case 'event_whentouchingobject': {
      // The menu's value; a reporter dropped on the input is ignored (hats can't evaluate one).
      const menu = b.inputs?.TOUCHINGOBJECTMENU?.shadow
      return { kind: 'touch', target: menu ? field(menu, 'TOUCHINGOBJECTMENU') : '' }
    }
    default:
      return null
  }
}

/** The stack's JSON without its position, to compare versions of a script. */
export function sourceOf(top: BlockJson): string {
  const { x: _x, y: _y, ...rest } = top
  return JSON.stringify(rest)
}

/** Parses a stack run by clicking it: a hat's body, a definition's body or a loose stack. Null if nothing to run. */
export function parseClicked(top: BlockJson): ScriptIR | null {
  if (isHatType(top.type)) {
    return top.next?.block ? { topId: top.id, hat: null, body: parseStack(top.next.block), source: sourceOf(top) } : null
  }
  if (!isStatementType(top.type)) return null
  return { topId: top.id, hat: null, body: parseStack(top), source: sourceOf(top) }
}

export function parseWorkspace(ws: WorkspaceJson | null): KindIR {
  const scripts: ScriptIR[] = []
  const procs = new Map<string, ProcIR>()
  for (const top of ws?.blocks?.blocks ?? []) {
    if (top.type === 'procedures_definition') {
      const m = parseMutation(prototypeOf(top)?.extraState)
      if (m && !procs.has(m.proccode)) {
        procs.set(m.proccode, { proccode: m.proccode, params: m.argumentnames, warp: m.warp, body: parseStack(top.next?.block), source: sourceOf(top) })
      }
      continue
    }
    const hat = hatOf(top)
    if (hat) scripts.push({ topId: top.id, hat, body: parseStack(top.next?.block), source: sourceOf(top) })
  }
  return { scripts, procs }
}
