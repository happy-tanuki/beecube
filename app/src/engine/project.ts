/**
 * Project files: the sprites (with their block workspaces), variables with
 * their current values, lists with their items, broadcast messages and
 * settings, as plain JSON.
 */
import { APP_ID, APP_NAME } from '../brand'
import { savable } from './ref'
import type { Runtime } from './runtime'
import { DEFAULT_CLONE_LIMIT, type ShapeKind, type SpriteData, type Value, type VariableDef, type WorkspaceJson } from './types'

export const PROJECT_FORMAT = `${APP_ID}-project`
export const PROJECT_VERSION = 1

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
  sprites: SavedSprite[]
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
    sprites: rt.sprites.map((s) => s.toData()),
    variables: rt.variableDefs.map((v) => ({ ...v, value: savable(rt.getVariable(v.id)) })),
    lists: rt.listDefs.map((l) => ({ ...l, items: rt.getList(l.id).map(savable) })),
    broadcasts: rt.broadcastDefs.map((b) => ({ ...b })),
    extensions: [...rt.extensions.keys()],
    monitors: [...rt.monitors],
    settings: { cloneLimit: rt.settings.cloneLimit, randomSeed: rt.settings.randomSeed },
  }
}

/** A project with nothing in it (callers add at least one sprite before use). */
export function emptyProject(): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    sprites: [],
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

function parseSprite(v: unknown, where: string): SavedSprite {
  if (!isObj(v)) fail(`${where} must be an object`)
  const shape = str(v, 'shape', where) as ShapeKind
  if (!SHAPES.includes(shape)) fail(`${where}.shape "${shape}" is not one of ${SHAPES.join(', ')}`)
  const pen = isObj(v.pen) ? v.pen : fail(`${where}.pen must be an object`)
  if (v.blocks !== null && !isObj(v.blocks)) fail(`${where}.blocks must be an object or null`)
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
    color: str(v, 'color', where),
    shape,
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
  const broadcasts = list('broadcasts').map((b, i) => parseDef(b, `broadcasts[${i}]`))
  const extensions = data.extensions === undefined ? [] : list('extensions').map((e, i) => (typeof e === 'string' ? e : fail(`extensions[${i}] must be a string`)))
  const monitors = data.monitors === undefined ? [] : list('monitors').map((m, i) => (typeof m === 'string' ? m : fail(`monitors[${i}] must be a string`)))
  return { format: PROJECT_FORMAT, version, sprites, variables, lists, broadcasts, extensions, monitors, settings: parseSettings(data.settings) }
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
