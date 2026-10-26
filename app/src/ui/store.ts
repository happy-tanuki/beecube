import { APP_ID } from '../brand'
import { defineExtensionBlocks } from '../blocks/extensions'
import { assetFileName, type AssetRef } from '../engine/assets'
import { availableBackdropName, FACES, plainBackdrop, type BackdropData, type FaceName } from '../engine/backdrop'
import { emptyProject, loadProject, parseProject, projectAssets, serializeProject, type ProjectFile } from '../engine/project'
import { findExtension } from '../extensions'
import { Runtime } from '../engine/runtime'
import type { Sprite } from '../engine/sprite'
import { STAGE_ID, type ShapeKind, type SpriteData } from '../engine/types'
import { t } from '../i18n'
import { SCENARIOS, scenarioProject, type ScenarioName } from '../bench/scenarios'
import { loadStoredAsset, pruneStoredAssets, storeAssets } from './assetStorage'
import { loadLibraryAsset, type LibraryRoom, type LibraryScenery } from './library'
import { facePicture, panoramaPicture, type Picture } from './pictures'
import { readProjectFile, writeProjectFile } from './projectFile'
import { sampleScript } from './sample'

export const SHAPES: ShapeKind[] = ['cube', 'sphere', 'cone', 'cylinder']

export const shapeName = (shape: ShapeKind): string => t(`shape.${shape}`)

const AUTOSAVE_KEY = `${APP_ID}.autosave`
const AUTOSAVE_MS = 3000

const PALETTE = ['#4c97ff', '#ff8c1a', '#59c059', '#9966ff', '#ff6680', '#ffbf00', '#5cb1d6']

function benchFromUrl(): ScenarioName | null {
  const name = new URLSearchParams(window.location.search).get('bench')?.toUpperCase()
  return SCENARIOS.find((s) => s === name) ?? null
}

let idCounter = 0
const newId = () => `sprite-${Date.now().toString(36)}-${idCounter++}`

/**
 * Project-level state shared by the UI: the runtime (which owns the sprites)
 * and which sprite is being edited. React subscribes via `subscribe`/`version`.
 */
export class ProjectStore {
  readonly rt = new Runtime()
  editingId = ''
  version = 0
  /** Changes whenever a whole project is replaced, so views can rebuild from scratch. */
  projectId = 0
  /** Changes when the editing sprite's blocks were changed outside the blocks editor, which then reloads them. */
  blocksRevision = 0
  private listeners = new Set<() => void>()

  /** A benchmark scenario opened with `?bench=A` (etc.); it is never autosaved over the user's project. */
  readonly bench: ScenarioName | null = benchFromUrl()

  constructor() {
    // Assets not in memory: the autosaved ones, then the library's.
    this.rt.assets.loader = async (ref) => (await loadStoredAsset(ref).catch(() => null)) ?? loadLibraryAsset(ref)
    if (this.bench) this.replace(scenarioProject(this.bench))
    else if (!this.restoreAutosave()) this.newProject()
    this.rt.start()
    if (this.bench) return
    setInterval(() => this.autosave(), AUTOSAVE_MS)
    window.addEventListener('pagehide', () => this.autosave())
  }

  // ---- whole-project operations -------------------------------------

  /** Replaces the project with the starter project (one cube with the sample script). */
  newProject(): void {
    const first = this.makeSprite('cube', [])
    first.blocks = sampleScript()
    this.replace({ ...emptyProject(), sprites: [first], backdrops: [plainBackdrop(t('backdrop.defaultName'))] })
  }

  /** Parses and opens project JSON. Throws ProjectFormatError (with the reason) if it isn't valid. */
  openProject(json: string): void {
    this.replace(parseProject(JSON.parse(json)))
  }

  /** Opens a project file (see projectFile.ts). Throws ProjectFormatError or SyntaxError if it isn't valid. */
  async openFile(bytes: Uint8Array): Promise<void> {
    const { project, assets } = await readProjectFile(bytes)
    for (const [ref, data] of assets) this.rt.assets.put(ref, data)
    this.replace(project)
  }

  toJson(): string {
    return JSON.stringify(serializeProject(this.rt))
  }

  /** The project file's contents, with the assets it uses (waiting for any still being loaded). */
  async toFile(): Promise<Uint8Array> {
    const project = serializeProject(this.rt)
    const assets = new Map<string, Uint8Array>()
    for (const ref of projectAssets(project)) {
      const data = await this.rt.assets.load(ref)
      if (data) assets.set(assetFileName(ref), data)
    }
    return writeProjectFile(project, assets)
  }

  /** Adds a built-in extension to the project. Extensions can't be removed (as in Scratch); start a new project instead. */
  addExtension(id: string): void {
    this.installExtension(id)
    this.notify()
  }

  get extensionIds(): string[] {
    return [...this.rt.extensions.keys()]
  }

  private installExtension(id: string): void {
    const ext = findExtension(id)
    if (!ext) {
      console.warn(`ProjectStore: unknown extension "${id}" is ignored`)
      return
    }
    defineExtensionBlocks(ext)
    this.rt.addExtension(ext)
  }

  private replace(project: ProjectFile): void {
    for (const id of this.extensionIds) if (!project.extensions.includes(id)) this.rt.removeExtension(id)
    for (const id of project.extensions) this.installExtension(id)
    loadProject(this.rt, project)
    // Files from before backdrops have none: the runtime's plain one gets a name in the user's language.
    if (project.backdrops.length === 0) this.rt.backdrops.list[0].name = t('backdrop.defaultName')
    this.editingId = this.rt.sprites[0].id
    this.projectId++
    this.notify()
  }

  /** Saves to browser storage now (also done every few seconds and on page hide). */
  autosave(): void {
    if (this.bench) return
    const project = serializeProject(this.rt)
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project))
    } catch (err) {
      console.warn('ProjectStore: autosave failed', err)
    }
    const assets = projectAssets(project).flatMap((ref) => {
      const data = this.rt.assets.get(ref)
      return data ? [[assetFileName(ref), data] as [string, Uint8Array]] : []
    })
    storeAssets(assets).catch((err) => console.warn('ProjectStore: saving pictures failed', err))
  }

  private restoreAutosave(): boolean {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(AUTOSAVE_KEY)
    } catch {
      return false
    }
    if (!saved) return false
    try {
      this.openProject(saved)
      const used = new Set(projectAssets(serializeProject(this.rt)).map(assetFileName))
      pruneStoredAssets(used).catch((err) => console.warn('ProjectStore: tidying saved pictures failed', err))
      return true
    } catch (err) {
      console.warn('ProjectStore: ignoring unreadable autosave', err)
      return false
    }
  }

  // ---- sprites ----------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  notify(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  /** The sprite being edited, or the stage (STAGE_ID). */
  get editing(): Sprite {
    if (this.editingId === STAGE_ID) return this.rt.stage
    const s = this.rt.getSprite(this.editingId)
    if (!s) throw new Error(`ProjectStore: editing sprite ${this.editingId} not found`)
    return s
  }

  select(id: string): void {
    if (id === this.editingId) return
    this.editingId = id
    this.notify()
  }

  addSprite(shape: ShapeKind): void {
    const data = this.makeSprite(shape)
    data.x = Math.round(Math.random() * 300 - 150)
    data.y = Math.round(Math.random() * 200 - 100)
    const sprite = this.rt.addSprite(data)
    this.editingId = sprite.id
    this.notify()
  }

  /**
   * Renames a sprite; blocks that refer to it follow. A taken name gets a
   * number; an empty or reserved one is ignored. Returns the sprite's name.
   */
  renameSprite(id: string, wanted: string): string {
    const sprite = this.rt.getSprite(id)
    if (!sprite) throw new Error(`ProjectStore: sprite ${id} not found`)
    const before = JSON.stringify(this.editing.blocks)
    if (this.rt.renameSprite(sprite, wanted) === null) return sprite.name
    if (JSON.stringify(this.editing.blocks) !== before) this.blocksRevision++
    this.notify()
    return sprite.name
  }

  removeSprite(id: string): void {
    const sprites = this.rt.sprites
    if (sprites.length <= 1) return
    const idx = sprites.findIndex((s) => s.id === id)
    if (idx < 0) return
    this.rt.removeSprite(id)
    if (this.editingId === id) this.editingId = this.rt.sprites[Math.max(0, idx - 1)].id
    this.notify()
  }

  // ---- backdrops --------------------------------------------------------

  get editingStage(): boolean {
    return this.editingId === STAGE_ID
  }

  /** Adds a plain backdrop and makes it the current one, as Scratch's "paint" does. */
  addBackdrop(): void {
    this.pushBackdrop(plainBackdrop(t('backdrop.defaultName')))
  }

  selectBackdrop(index: number): void {
    this.rt.backdrops.select(index)
    this.notify()
  }

  /** Changes a backdrop's look (not its name: see renameBackdrop). */
  updateBackdrop(index: number, change: (b: BackdropData) => void): void {
    change(this.rt.backdrops.list[index])
    this.rt.backdrops.changed()
    this.notify()
  }

  /** Renames a backdrop; blocks that refer to it follow. Returns its name. */
  renameBackdrop(index: number, wanted: string): string {
    const before = JSON.stringify(this.editing.blocks)
    this.rt.renameBackdrop(index, wanted)
    if (JSON.stringify(this.editing.blocks) !== before) this.blocksRevision++
    this.notify()
    return this.rt.backdrops.list[index].name
  }

  /** Adds a backdrop with a picture on its back wall, as Scratch's upload puts one on the stage. */
  async uploadBackdrop(file: File): Promise<void> {
    const picture = await this.storePicture(await facePicture(file, 'back'))
    const b = plainBackdrop(file.name.replace(/\.[^.]*$/, '') || t('backdrop.defaultName'))
    b.faces.back.picture = picture
    this.pushBackdrop(b)
  }

  /** Puts a picture on a face of a backdrop (null takes it off). */
  async setFacePicture(index: number, face: FaceName, file: File | null): Promise<void> {
    const picture = file ? await this.storePicture(await facePicture(file, face)) : null
    this.updateBackdrop(index, (b) => (b.faces[face].picture = picture))
  }

  /** Makes a 360° image a backdrop's scenery (null takes it off). */
  async setSceneryPicture(index: number, file: File | null): Promise<void> {
    const picture = file ? await this.storePicture(await panoramaPicture(file)) : null
    this.updateBackdrop(index, (b) => (b.sceneryPicture = picture))
  }

  /** Makes a 360° image from the library a backdrop's scenery. */
  setLibraryScenery(index: number, entry: LibraryScenery): void {
    this.updateBackdrop(index, (b) => {
      b.scenery = entry.scenery
      b.sceneryPicture = { ...entry.picture }
    })
  }

  /** Dresses a backdrop's six faces as a room from the library; its scenery and grid stay. */
  setLibraryRoom(index: number, entry: LibraryRoom): void {
    this.updateBackdrop(index, (b) => {
      for (const name of FACES) b.faces[name] = { color: entry.faces[name].color, picture: { ...entry.faces[name].picture! } }
    })
  }

  private storePicture(p: Picture): Promise<AssetRef> {
    return this.rt.assets.add(p.data, p.format)
  }

  private pushBackdrop(b: BackdropData): void {
    const backdrops = this.rt.backdrops
    b.name = availableBackdropName(b.name, backdrops.list.map((o) => o.name)) ?? b.name
    backdrops.list.push(b)
    backdrops.select(backdrops.list.length - 1)
    this.notify()
  }

  /** Removes a backdrop; there is always at least one. Blocks keep its name, as in Scratch. */
  removeBackdrop(index: number): void {
    const backdrops = this.rt.backdrops
    if (backdrops.list.length <= 1) return
    backdrops.list.splice(index, 1)
    backdrops.select(Math.min(backdrops.current > index ? backdrops.current - 1 : backdrops.current, backdrops.list.length - 1))
    this.notify()
  }

  private makeSprite(shape: ShapeKind, existing: { name: string }[] = this.rt.sprites): SpriteData {
    const base = shapeName(shape)
    let n = 1
    while (existing.some((s) => s.name === `${base}${n}`)) n++
    return {
      id: newId(),
      name: `${base}${n}`,
      x: 0,
      y: 0,
      z: 20,
      direction: 90,
      pitch: 0,
      roll: 0,
      size: 100,
      color: PALETTE[existing.length % PALETTE.length],
      shape,
      visible: true,
      pen: { down: false, color: '#0fbd8c' },
      blocks: null,
      variables: {},
      lists: {},
    }
  }
}

