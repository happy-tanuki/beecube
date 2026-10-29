import { APP_ID } from '../brand'
import { defineExtensionBlocks } from '../blocks/extensions'
import { ASSET_MIME, assetFileName, type AssetLoader, type AssetRef } from '../engine/assets'
import { clampCostumeDimension, costumeDimensions, naturalDimensions, plainCostume, sameDimensions, type Costume, type CostumeDimensions, type CostumeModel, type ModelPose } from '../engine/costume'
import { availableName, availableSpriteName } from '../engine/rename'
import { availableBackdropName, FACES, plainBackdrop, type BackdropData, type FaceName } from '../engine/backdrop'
import { emptyProject, loadProject, parseProject, projectAssets, serializeProject, type ProjectFile } from '../engine/project'
import { findExtension } from '../extensions'
import { Runtime } from '../engine/runtime'
import type { Sprite } from '../engine/sprite'
import { BASE_SIZE, STAGE_ID, type ShapeKind, type SpriteData } from '../engine/types'
import { t } from '../i18n'
import { SCENARIOS, scenarioProject, type ScenarioName } from '../bench/scenarios'
import { loadStoredAsset, pruneStoredAssets, storeAssets } from './assetStorage'
import { isLibraryAsset, libraryCostumeName, libraryRoomName, librarySceneryName, loadLibraryAsset, SPRITE_MOVES, type LibraryCostume, type LibraryRoom, type LibraryScenery } from './library'
import { clipLabel } from './modelNames'
import { clipPose, modelClips, modelSize, readModel } from '../stage/models'
import { loadModel } from './costumeThumbnails'
import { costumePicture, facePicture, panoramaPicture, type Picture } from './pictures'
import { readProjectFile, writeProjectFile } from './projectFile'
import { sampleScript } from './sample'

/** The largest 3D model file accepted (the sharing API's limit for one asset). */
export const MODEL_MAX_BYTES = 5_000_000

/** Why a 3D model file can't be used, as a message key's last part (costume.modelError.*). */
export class ModelError extends Error {
  constructor(readonly reason: 'tooLarge' | 'notGlb' | 'unreadable' | 'empty') {
    super(`model: ${reason}`)
  }
}

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
/** Binary glTF starts with "glTF". */
const isGlb = (data: Uint8Array) => data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46

/** A costume from the library. */
function libraryCostume(entry: LibraryCostume): Costume {
  const c: Costume = { ...plainCostume(libraryCostumeName(entry), entry.shape), layout: entry.layout }
  if (entry.picture) c.picture = { ...entry.picture }
  if (entry.model) c.model = { asset: { ...entry.model.asset }, size: [...entry.model.size] }
  return c
}

/** The model in a pose; an empty pose is left out, as the file has it. */
function withPose({ asset, size }: CostumeModel, pose: ModelPose): CostumeModel {
  return Object.keys(pose).length > 0 ? { asset, size, pose } : { asset, size }
}

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

  /**
   * Opens a shared project (its JSON), with its pictures from `fetch`; they
   * are kept with the autosave, so the project doesn't depend on the share.
   * Throws ProjectFormatError if it isn't valid.
   */
  async openShared(json: unknown, fetch: AssetLoader): Promise<void> {
    const project = parseProject(json)
    const pictures = projectAssets(project).filter((ref) => !isLibraryAsset(ref))
    for (const [i, data] of (await Promise.all(pictures.map((ref) => fetch(ref).catch(() => null)))).entries()) {
      if (data) this.rt.assets.put(pictures[i], data)
    }
    this.replace(project)
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

  /** Adds a sprite of a plain shape and selects it. */
  addSprite(shape: ShapeKind): void {
    this.pushSprite(this.makeSprite(shape))
  }

  /**
   * Adds a sprite from the library, named after it, wearing its costume and
   * the moves it comes with (SPRITE_MOVES), and selects it.
   */
  async addLibrarySprite(entry: LibraryCostume): Promise<void> {
    const costume = libraryCostume(entry)
    const moves = SPRITE_MOVES[entry.key]
    const more = moves && costume.model ? await this.clipCostumes(costume.model, moves.clip, moves.frames, [costume.name]) : []
    this.pushSprite(this.spriteWearing([costume, ...more]))
  }

  /** Adds a sprite wearing a costume from a file (see uploadCostume), named after it, and selects it. */
  async uploadSprite(file: File): Promise<void> {
    this.pushSprite(this.spriteWearing([await this.costumeFromFile(file, 'cube')]))
  }

  /** A new sprite wearing the first of these costumes, named after it, standing on the floor. */
  private spriteWearing(costumes: Costume[]): SpriteData {
    const data = this.makeSprite(costumes[0].shape)
    data.name = availableSpriteName(costumes[0].name, this.rt.sprites.map((s) => s.name)) ?? data.name
    data.costumes = costumes
    // A model's box can be lower than a cube.
    data.z = (BASE_SIZE / 2) * (costumes[0].model?.size[2] ?? 1)
    return data
  }

  /** Adds a sprite somewhere near the middle, and selects it. */
  private pushSprite(data: SpriteData): void {
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
  async setFacePicture(index: number, face: FaceName, file: Blob | null): Promise<void> {
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

  /** Adds a backdrop with scenery from the library, named after it, and makes it current. */
  addLibraryScenery(entry: LibraryScenery): void {
    this.pushBackdrop(plainBackdrop(librarySceneryName(entry)))
    this.setLibraryScenery(this.rt.backdrops.current, entry)
  }

  /** Adds a backdrop that is a room from the library, named after it, and makes it current. */
  addLibraryRoom(entry: LibraryRoom): void {
    this.pushBackdrop(plainBackdrop(libraryRoomName(entry)))
    this.setLibraryRoom(this.rt.backdrops.current, entry)
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

  // ---- costumes ---------------------------------------------------------

  /** Puts a costume on the editing sprite, as clicking it in Scratch's list does. */
  selectCostume(index: number): void {
    this.editing.costume = index
    this.notify()
  }

  /** Changes one of the editing sprite's costumes (not its name: see renameCostume). */
  updateCostume(index: number, change: Partial<Omit<Costume, 'name'>>): void {
    const sprite = this.editing
    sprite.costumes = sprite.costumes.map((c, i) => (i === index ? { ...c, ...change } : c))
    this.notify()
  }

  /** Renames a costume of the editing sprite; its blocks that refer to it follow. Returns its name. */
  renameCostume(index: number, wanted: string): string {
    const sprite = this.editing
    if (this.rt.renameCostume(sprite, index, wanted) !== null) this.blocksRevision++
    this.notify()
    return sprite.costumes[index].name
  }

  /** Adds a costume without a picture, of the shape of the one worn, and wears it. */
  addCostume(): void {
    this.pushCostume(plainCostume(shapeName(this.editing.shape), this.editing.shape))
  }

  /**
   * Adds a costume from a file and wears it: a picture, on the shape of the
   * one worn, or a 3D model (a binary glTF file). Throws ModelError if a
   * model can't be used.
   */
  async uploadCostume(file: File): Promise<void> {
    this.pushCostume(await this.costumeFromFile(file, this.editing.shape))
  }

  /** Adds a costume from the library and wears it. */
  addLibraryCostume(entry: LibraryCostume): void {
    this.pushCostume(libraryCostume(entry))
  }

  /** A costume from a file, named after it: a 3D model, or a picture on a shape. */
  private async costumeFromFile(file: File, shape: ShapeKind): Promise<Costume> {
    const name = file.name.replace(/\.[^.]*$/, '')
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (isGlb(head) || /\.glb$/i.test(file.name)) return this.modelCostume(file, name || t('costume.model'))
    const picture = await this.storePicture(await costumePicture(file))
    return { ...plainCostume(name || shapeName(shape), shape), picture }
  }

  /** A costume that is a 3D model. Throws ModelError if the file can't be used. */
  private async modelCostume(file: File, name: string): Promise<Costume> {
    if (file.size > MODEL_MAX_BYTES) throw new ModelError('tooLarge')
    const data = new Uint8Array(await file.arrayBuffer())
    if (!isGlb(data)) throw new ModelError('notGlb')
    const size = modelSize(await readModel(data).catch(() => Promise.reject(new ModelError('unreadable'))))
    if (!size) throw new ModelError('empty')
    const asset = await this.rt.assets.add(data, 'glb')
    return { ...plainCostume(name, 'cube'), model: { asset, size } }
  }

  /** Sets a costume's width, depth or height (axis 0, 1 or 2) in stage units. */
  setCostumeDimension(index: number, axis: 0 | 1 | 2, value: number): void {
    const costume = this.editing.costumes[index]
    if (!costume) return
    const dimensions = [...costumeDimensions(costume)] as CostumeDimensions
    dimensions[axis] = clampCostumeDimension(value)
    this.updateCostume(index, { dimensions: sameDimensions(dimensions, naturalDimensions(costume)) ? undefined : dimensions })
  }

  /** Stands a model costume in a pose (empty for as the file has it). */
  setModelPose(index: number, pose: ModelPose): void {
    const model = this.editing.costumes[index]?.model
    if (!model) return
    this.updateCostume(index, { model: withPose(model, pose) })
  }

  /**
   * Adds costumes of a model costume's model in the poses of moments of one
   * of its animations, evenly through it, and wears the first: switched one
   * after another, they move as it does. Does nothing if the animation
   * isn't found.
   */
  async addClipCostumes(index: number, clipName: string, frames: number): Promise<void> {
    const sprite = this.editing
    const model = sprite.costumes[index]?.model
    const dimensions = sprite.costumes[index]?.dimensions
    const added = (model ? await this.clipCostumes(model, clipName, frames, sprite.costumes.map((o) => o.name)) : []).map((c) => ({ ...c, ...(dimensions && { dimensions }) }))
    if (added.length === 0) return
    sprite.costume = sprite.costumes.length
    sprite.costumes = [...sprite.costumes, ...added]
    this.notify()
  }

  /** Costumes of a model in moments of an animation (see addClipCostumes), named after it and unlike the names taken. */
  private async clipCostumes(model: CostumeModel, clipName: string, frames: number, taken: string[]): Promise<Costume[]> {
    const read = await loadModel(this.rt.assets, model.asset)
    const clip = read && modelClips(read).find((c) => c.name === clipName)
    if (!read || !clip) return []
    const names = [...taken]
    const costumes: Costume[] = []
    for (let i = 0; i < frames; i++) {
      const name = availableName(`${clipLabel(clip.name)}${i + 1}`, names) ?? clip.name
      names.push(name)
      costumes.push({ ...plainCostume(name, 'cube'), model: withPose(model, clipPose(read, clip, (clip.duration * i) / frames)) })
    }
    return costumes
  }

  /** Takes the model off a costume: it is its shape again. */
  removeModel(index: number): void {
    this.updateCostume(index, { model: null })
  }

  /**
   * Puts a painted picture on a costume of a sprite (the one painted, which
   * may no longer be the one edited by the time it is stored). Returns the
   * picture.
   */
  async paintCostume(sprite: Sprite, index: number, painted: Blob): Promise<AssetRef> {
    const picture = await this.storePicture(await costumePicture(painted))
    if (sprite.costumes[index]) {
      sprite.costumes = sprite.costumes.map((c, i) => (i === index ? { ...c, picture } : c))
      this.notify()
    }
    return picture
  }

  /** The contents of a picture, to edit it; null if it can't be found. */
  async pictureBlob(ref: AssetRef): Promise<Blob | null> {
    const data = await this.rt.assets.load(ref)
    return data && new Blob([data as Uint8Array<ArrayBuffer>], { type: ASSET_MIME[ref.dataFormat] })
  }

  /** Removes a costume; there is always at least one. Blocks keep its name, as in Scratch. */
  removeCostume(index: number): void {
    const sprite = this.editing
    if (sprite.costumes.length <= 1) return
    const worn = sprite.costume
    sprite.costumes = sprite.costumes.filter((_, i) => i !== index)
    sprite.costume = worn > index ? worn - 1 : Math.min(worn, sprite.costumes.length - 1)
    this.notify()
  }

  private pushCostume(c: Costume): void {
    const sprite = this.editing
    const name = availableName(c.name, sprite.costumes.map((o) => o.name)) ?? c.name
    sprite.costumes = [...sprite.costumes, { ...c, name }]
    sprite.costume = sprite.costumes.length - 1
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
      costumes: [plainCostume(base, shape)],
      costume: 0,
      visible: true,
      pen: { down: false, color: '#0fbd8c' },
      blocks: null,
      variables: {},
      lists: {},
    }
  }
}

