/**
 * Project files: the stage (its block workspace and backdrops), the sprites
 * (with their block workspaces), variables with their current values, lists with their items, broadcast
 * messages and settings, as plain JSON. Pictures are assets (see assets.ts):
 * the JSON only refers to them.
 */
import { APP_ID, APP_NAME } from '../brand'
import { assetFileName, isAssetId, PICTURE_FORMATS, type AssetFormat, type AssetRef } from './assets'
import { FACES, type BackdropData, type Face, type FaceName } from './backdrop'
import { COSTUME_LAYOUTS, plainCostume, type Costume, type CostumeLayout, type CostumeModel, type ModelPose } from './costume'
import { isColorString } from './ops'
import { savable } from './ref'
import type { Runtime } from './runtime'
import { DEFAULT_CLONE_LIMIT, type BlockJson, type ShapeKind, type SpriteData, type Value, type VariableDef, type WorkspaceJson } from './types'

export const PROJECT_FORMAT = `${APP_ID}-project`
/** 2: sprites have costumes (version 1 files have one shape each, and still open). */
export const PROJECT_VERSION = 2

export type SavedSprite = SpriteData

export interface ProjectSettings {
  /** Most clones alive at once. */
  cloneLimit: number
  /** Seed for random numbers on each green flag, so runs repeat; null for different runs. */
  randomSeed: number | null
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  /** The stage's scripts. */
  stage: { blocks: WorkspaceJson | null }
  sprites: SavedSprite[]
  /** Empty in older files: the runtime then has one plain backdrop. */
  backdrops: BackdropData[]
  /** Index of the current backdrop. */
  backdrop: number
  variables: (VariableDef & { value: Value })[]
  lists: (VariableDef & { items: Value[] })[]
  broadcasts: VariableDef[]
  /** Ids of the extensions the project uses. */
  extensions: string[]
  /** Monitor keys shown on the stage (see Runtime.monitors). */
  monitors: string[]
  settings: ProjectSettings
}

export function serializeProject(rt: Runtime): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    stage: { blocks: structuredClone(rt.stage.blocks) },
    sprites: rt.sprites.map((s) => s.toData()),
    backdrops: rt.backdrops.list.map((b) => structuredClone(b)),
    backdrop: rt.backdrops.current,
    variables: rt.variableDefs.map((v) => ({ ...v, value: savable(rt.getVariable(v.id)) })),
    lists: rt.listDefs.map((l) => ({ ...l, items: rt.getList(l.id).map(savable) })),
    broadcasts: rt.broadcastDefs.map((b) => ({ ...b })),
    extensions: [...rt.extensions.keys()],
    monitors: [...rt.monitors],
    settings: { cloneLimit: rt.settings.cloneLimit, randomSeed: rt.settings.randomSeed },
  }
}

/** The assets a project refers to, each once. */
export function projectAssets(project: ProjectFile): AssetRef[] {
  const found = new Map<string, AssetRef>()
  for (const s of project.sprites) {
    for (const c of s.costumes) {
      if (c.picture) found.set(assetFileName(c.picture), c.picture)
      if (c.model) found.set(assetFileName(c.model.asset), c.model.asset)
    }
  }
  for (const b of project.backdrops) {
    if (b.sceneryPicture) found.set(assetFileName(b.sceneryPicture), b.sceneryPicture)
    for (const name of FACES) {
      const picture = b.faces[name].picture
      if (picture) found.set(assetFileName(picture), picture)
    }
  }
  return [...found.values()]
}

/** A project with nothing in it (callers add at least one sprite before use). */
export function emptyProject(): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    stage: { blocks: null },
    sprites: [],
    backdrops: [],
    backdrop: 0,
    variables: [],
    lists: [],
    broadcasts: [],
    extensions: [],
    monitors: [],
    settings: { cloneLimit: DEFAULT_CLONE_LIMIT, randomSeed: null },
  }
}

export class ProjectFormatError extends Error {}

const SHAPES: ShapeKind[] = ['cube', 'sphere', 'cone', 'cylinder']

function fail(message: string): never {
  throw new ProjectFormatError(message)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (o: Record<string, unknown>, k: string, where: string): number =>
  typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : fail(`${where}.${k} must be a number`)
const str = (o: Record<string, unknown>, k: string, where: string): string =>
  typeof o[k] === 'string' ? (o[k] as string) : fail(`${where}.${k} must be a string`)

const isValue = (v: unknown): v is Value => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

function parseDef(v: unknown, where: string): VariableDef {
  if (!isObj(v)) fail(`${where} must be an object`)
  return { id: str(v, 'id', where), name: str(v, 'name', where) }
}

/** Parses an object of entries keyed by id; missing (older files) means empty. */
function parseRecord<T>(v: unknown, where: string, parse: (x: Record<string, unknown>, at: string) => T): Record<string, T> {
  if (v === undefined) return {}
  if (!isObj(v)) fail(`${where} must be an object`)
  return Object.fromEntries(
    Object.entries(v).map(([id, x]) => (isObj(x) ? [id, parse(x, `${where}.${id}`)] : fail(`${where}.${id} must be an object`))),
  )
}

/**
 * The round variable and list reporters' fields only load from XML text (see
 * `field` in ir.ts). Files written by hand or by other tools may give them
 * Blockly's `{ id }` shape instead, which the editor cannot load: convert it.
 */
const GETTER_FIELDS: Record<string, { name: string; type: string }> = {
  data_variable: { name: 'VARIABLE', type: '' },
  data_listcontents: { name: 'LIST', type: 'list' },
}

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' })[c]};`)

function normalizeBlock(b: BlockJson | undefined): void {
  if (!isObj(b)) return
  const getter = GETTER_FIELDS[b.type]
  const f = getter && b.fields?.[getter.name]
  if (isObj(f) && typeof f.id === 'string') {
    const name = typeof f.name === 'string' ? f.name : ''
    b.fields![getter.name] =
      `<field name="${getter.name}" id="${escapeXml(f.id)}" variabletype="${getter.type}">${escapeXml(name)}</field>`
  }
  for (const input of Object.values(b.inputs ?? {})) {
    normalizeBlock(input?.block)
    normalizeBlock(input?.shadow)
  }
  normalizeBlock(b.next?.block)
}

function parseShape(v: Record<string, unknown>, where: string): ShapeKind {
  const shape = str(v, 'shape', where) as ShapeKind
  return SHAPES.includes(shape) ? shape : fail(`${where}.shape "${shape}" is not one of ${SHAPES.join(', ')}`)
}

function parseCostume(v: unknown, where: string): Costume {
  if (!isObj(v)) fail(`${where} must be an object`)
  const layout = (v.layout ?? 'same') as CostumeLayout
  if (!COSTUME_LAYOUTS.includes(layout)) fail(`${where}.layout "${layout}" is not one of ${COSTUME_LAYOUTS.join(', ')}`)
  return { name: str(v, 'name', where), shape: parseShape(v, where), picture: parsePicture(v.picture, `${where}.picture`), layout, model: parseModel(v.model, `${where}.model`) }
}

/** Missing (older files) means none. */
function parseModel(v: unknown, where: string): CostumeModel | null {
  if (v === undefined || v === null) return null
  if (!isObj(v)) fail(`${where} must be an object or null`)
  const asset = parseAsset(v.asset, `${where}.asset`, ['glb']) ?? fail(`${where}.asset must be a model`)
  const size = v.size
  if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => typeof n === 'number' && n > 0 && n <= 1)) {
    fail(`${where}.size must be three fractions`)
  }
  const pose = parsePose(v.pose, `${where}.pose`)
  return { asset, size: size as [number, number, number], ...(pose && { pose }) }
}

/** The most bones a pose can name. */
const MAX_POSE_BONES = 256

/** Missing or empty means none. */
function parsePose(v: unknown, where: string): ModelPose | undefined {
  if (v === undefined || v === null) return undefined
  if (!isObj(v)) fail(`${where} must be an object`)
  const entries = Object.entries(v)
  if (entries.length > MAX_POSE_BONES) fail(`${where} names more than ${MAX_POSE_BONES} bones`)
  for (const [bone, turn] of entries) {
    if (!Array.isArray(turn) || turn.length !== 3 || !turn.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 360)) {
      fail(`${where}["${bone}"] must be three angles`)
    }
  }
  return entries.length > 0 ? (Object.fromEntries(entries) as ModelPose) : undefined
}

/** The costumes, or for older files one plain costume of the sprite's shape. */
function parseCostumes(v: Record<string, unknown>, where: string): { costumes: Costume[]; costume: number } {
  if (v.costumes === undefined) {
    const shape = parseShape(v, where)
    return { costumes: [plainCostume(shape, shape)], costume: 0 }
  }
  if (!Array.isArray(v.costumes) || v.costumes.length === 0) fail(`${where}.costumes must be a list of at least one costume`)
  const costumes = v.costumes.map((c, i) => parseCostume(c, `${where}.costumes[${i}]`))
  const costume = v.costume === undefined ? 0 : num(v, 'costume', where)
  if (!(Number.isInteger(costume) && costume >= 0 && costume < costumes.length)) fail(`${where}.costume must be the index of a costume`)
  return { costumes, costume }
}

function parseSprite(v: unknown, where: string): SavedSprite {
  if (!isObj(v)) fail(`${where} must be an object`)
  const pen = isObj(v.pen) ? v.pen : fail(`${where}.pen must be an object`)
  if (v.blocks !== null && !isObj(v.blocks)) fail(`${where}.blocks must be an object or null`)
  const tops = (v.blocks as WorkspaceJson | null)?.blocks?.blocks
  if (Array.isArray(tops)) for (const b of tops) normalizeBlock(b)
  return {
    id: str(v, 'id', where),
    name: str(v, 'name', where),
    x: num(v, 'x', where),
    y: num(v, 'y', where),
    z: num(v, 'z', where),
    direction: num(v, 'direction', where),
    pitch: num(v, 'pitch', where),
    roll: v.roll === undefined ? 0 : num(v, 'roll', where),
    size: num(v, 'size', where),
    ...(v.width === undefined ? {} : { width: num(v, 'width', where) }),
    ...(v.depth === undefined ? {} : { depth: num(v, 'depth', where) }),
    ...(v.height === undefined ? {} : { height: num(v, 'height', where) }),
    color: str(v, 'color', where),
    ...parseCostumes(v, where),
    visible: v.visible !== false,
    pen: {
      down: pen.down === true,
      color: str(pen, 'color', `${where}.pen`),
      ...(pen.transparency === undefined ? {} : { transparency: num(pen, 'transparency', `${where}.pen`) }),
      ...(pen.size === undefined ? {} : { size: num(pen, 'size', `${where}.pen`) }),
    },
    blocks: (v.blocks as WorkspaceJson | null) ?? null,
    variables: parseRecord(v.variables, `${where}.variables`, (x, at) => ({ name: str(x, 'name', at), value: isValue(x.value) ? x.value : 0 })),
    lists: parseRecord(v.lists, `${where}.lists`, (x, at) => {
      if (!Array.isArray(x.items)) fail(`${at}.items must be an array`)
      return { name: str(x, 'name', at), items: (x.items as unknown[]).map((i) => (isValue(i) ? i : '')) }
    }),
  }
}

const color = (o: Record<string, unknown>, k: string, where: string): string => {
  const c = str(o, k, where)
  return isColorString(c) ? c : fail(`${where}.${k} must be a color like #rrggbb`)
}

/** A reference to an asset of one of `formats`; missing (older files) means none. */
function parseAsset(v: unknown, where: string, formats: readonly AssetFormat[]): AssetRef | null {
  if (v === undefined || v === null) return null
  if (!isObj(v)) fail(`${where} must be an object or null`)
  const assetId = str(v, 'assetId', where)
  if (!isAssetId(assetId)) fail(`${where}.assetId must be a SHA-256 in hex`)
  const dataFormat = str(v, 'dataFormat', where) as AssetFormat
  if (!formats.includes(dataFormat)) fail(`${where}.dataFormat "${dataFormat}" is not one of ${formats.join(', ')}`)
  return { assetId, dataFormat }
}

const parsePicture = (v: unknown, where: string) => parseAsset(v, where, PICTURE_FORMATS)

function parseBackdrop(v: unknown, where: string): BackdropData {
  if (!isObj(v)) fail(`${where} must be an object`)
  const faces = isObj(v.faces) ? v.faces : fail(`${where}.faces must be an object`)
  const face = (name: FaceName): Face => {
    const at = `${where}.faces.${name}`
    const f = isObj(faces[name]) ? faces[name] : fail(`${at} must be an object`)
    return { color: f.color === null ? null : color(f, 'color', at), picture: parsePicture(f.picture, `${at}.picture`) }
  }
  return {
    id: str(v, 'id', where),
    name: str(v, 'name', where),
    scenery: color(v, 'scenery', where),
    sceneryPicture: parsePicture(v.sceneryPicture, `${where}.sceneryPicture`),
    faces: Object.fromEntries(FACES.map((f) => [f, face(f)])) as Record<FaceName, Face>,
    grid: v.grid !== false,
  }
}

/** The stage is optional (older files have none). */
function parseStage(v: unknown): ProjectFile['stage'] {
  if (v === undefined) return { blocks: null }
  if (!isObj(v)) fail('stage must be an object')
  if (v.blocks !== null && v.blocks !== undefined && !isObj(v.blocks)) fail('stage.blocks must be an object or null')
  return { blocks: (v.blocks as WorkspaceJson | undefined) ?? null }
}

/** Validates a parsed project file. Throws ProjectFormatError with the offending path. */
export function parseProject(data: unknown): ProjectFile {
  if (!isObj(data) || data.format !== PROJECT_FORMAT) fail(`not a ${APP_NAME} project file`)
  const version = num(data, 'version', 'project')
  if (version > PROJECT_VERSION) fail(`project version ${version} is newer than this editor supports (${PROJECT_VERSION})`)
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]) : fail(`project.${k} must be an array`))
  const sprites = list('sprites').map((s, i) => parseSprite(s, `sprites[${i}]`))
  if (sprites.length === 0) fail('project has no sprites')
  const variables = list('variables').map((v, i) => {
    const def = parseDef(v, `variables[${i}]`)
    const value = (v as Record<string, unknown>).value
    return { ...def, value: isValue(value) ? value : 0 }
  })
  const lists = (data.lists === undefined ? [] : list('lists')).map((l, i) => {
    const def = parseDef(l, `lists[${i}]`)
    const items = (l as Record<string, unknown>).items
    if (!Array.isArray(items)) fail(`lists[${i}].items must be an array`)
    return { ...def, items: items.map((v) => (isValue(v) ? v : '')) }
  })
  const backdrops = (data.backdrops === undefined ? [] : list('backdrops')).map((b, i) => parseBackdrop(b, `backdrops[${i}]`))
  const backdrop = data.backdrop === undefined ? 0 : num(data, 'backdrop', 'project')
  if (backdrops.length > 0 && !(Number.isInteger(backdrop) && backdrop >= 0 && backdrop < backdrops.length)) fail('project.backdrop must be the index of a backdrop')
  const broadcasts = list('broadcasts').map((b, i) => parseDef(b, `broadcasts[${i}]`))
  const extensions = data.extensions === undefined ? [] : list('extensions').map((e, i) => (typeof e === 'string' ? e : fail(`extensions[${i}] must be a string`)))
  const monitors = data.monitors === undefined ? [] : list('monitors').map((m, i) => (typeof m === 'string' ? m : fail(`monitors[${i}] must be a string`)))
  return { format: PROJECT_FORMAT, version, stage: parseStage(data.stage), sprites, backdrops, backdrop, variables, lists, broadcasts, extensions, monitors, settings: parseSettings(data.settings) }
}

/** Settings are optional (older files have none). */
function parseSettings(v: unknown): ProjectSettings {
  if (v === undefined) return { cloneLimit: DEFAULT_CLONE_LIMIT, randomSeed: null }
  if (!isObj(v)) fail('settings must be an object')
  const limit = v.cloneLimit === undefined ? DEFAULT_CLONE_LIMIT : num(v, 'cloneLimit', 'settings')
  if (limit < 0 || !Number.isInteger(limit)) fail('settings.cloneLimit must be a whole number')
  const seed = v.randomSeed === undefined || v.randomSeed === null ? null : num(v, 'randomSeed', 'settings')
  return { cloneLimit: limit, randomSeed: seed }
}

/**
 * Replaces the runtime's project. Stops everything and clears the pen first.
 * Extensions are not touched here: the caller installs `project.extensions`
 * (it knows where extensions come from) before or after.
 */
export function loadProject(rt: Runtime, project: ProjectFile): void {
  rt.stopAll()
  rt.pen.clear()
  rt.settings.randomSeed = project.settings.randomSeed
  rt.setCloneLimit(project.settings.cloneLimit)
  rt.setSprites(project.sprites)
  rt.stage.blocks = structuredClone(project.stage.blocks)
  rt.backdrops.set(project.backdrops.map((b) => structuredClone(b)), project.backdrop)
  rt.variableDefs = project.variables.map(({ id, name }) => ({ id, name }))
  for (const v of project.variables) rt.setVariable(v.id, v.value)
  rt.listDefs = project.lists.map(({ id, name }) => ({ id, name }))
  for (const l of project.lists) rt.setList(l.id, l.items)
  rt.broadcastDefs = project.broadcasts.map((b) => ({ ...b }))
  for (const key of [...rt.monitors]) rt.setMonitor(key, false)
  for (const key of project.monitors) rt.setMonitor(key, true)
  rt.resetTimer()
  rt.compileAll()
}
