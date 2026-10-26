import { useEffect, useRef, useState } from 'react'
import * as ScratchBlocks from 'scratch-blocks'
import { defineExtensionBlocks, extensionStyle } from '../blocks/extensions'
import { createTheme, defineCustomBlocks, setBackdropNameSource, setCostumeNameSource, setSpriteNameSource, setSpriteVariableSource, setStageSource } from '../blocks/setup'
import { makeToolboxXml } from '../blocks/toolbox'
import { BUILTIN_EXTENSIONS } from '../extensions'
import type { BlockJson, WorkspaceJson } from '../engine/types'
import { t } from '../i18n'
import { monitorKeyOf } from './monitors'
import { installBlocklyDialogs, showAlert, showPrompt, showVariablePrompt } from './dialogs'
import { ProcedureEditor, type ProcedureRequest } from './ProcedureEditor'
import type { ProjectStore } from './store'

interface Props {
  store: ProjectStore
  editingId: string
  /** See ProjectStore.blocksRevision. */
  blocksRevision: number
  /** Installed extension ids, joined; the toolbox is rebuilt when it changes. */
  extensionKey: string
  /** The backdrops' names, joined; the palette's backdrop menus are redrawn when it changes. */
  backdropKey: string
  /** Whether the stage is being edited: its palette differs. */
  stage: boolean
}

const installedExtensions = (store: ProjectStore) => [...store.rt.extensions.values()]

const BROADCAST_TYPE = 'broadcast_msg'
const LIST_TYPE = 'list'

/** Whether to ignore workspace events while we load a sprite's blocks programmatically. */
let loading = false
/**
 * Whether the shown sprite's blocks failed to load. Its workspace then holds
 * no blocks and is not saved back, so the sprite keeps its scripts.
 */
let unloadable = false

/** scratch-blocks' variable model; `isLocal` marks "for this sprite only". It is not serialized. */
type ScratchVariable = ScratchBlocks.IVariableModel<ScratchBlocks.IVariableState> & { isLocal?: boolean }

function loadSprite(ws: ScratchBlocks.WorkspaceSvg, store: ProjectStore): void {
  const sprite = store.editing
  // A sprite's workspace has the project's variables, lists and messages plus the sprite's own variables and lists.
  const locals = [
    ...Object.entries(sprite.variables).map(([id, v]) => ({ id, name: v.name, type: '' })),
    ...Object.entries(sprite.lists).map(([id, l]) => ({ id, name: l.name, type: LIST_TYPE })),
  ]
  const json: WorkspaceJson = {
    ...(sprite.blocks ?? {}),
    variables: [
      ...store.rt.variableDefs.map((v) => ({ id: v.id, name: v.name, type: '' })),
      ...store.rt.listDefs.map((v) => ({ id: v.id, name: v.name, type: LIST_TYPE })),
      ...store.rt.broadcastDefs.map((v) => ({ id: v.id, name: v.name, type: BROADCAST_TYPE })),
      ...locals,
    ],
  }
  loading = true
  unloadable = false
  try {
    try {
      ScratchBlocks.serialization.workspaces.load(json, ws)
    } catch (e) {
      // e.g. a hand-written project file with fields in a shape Blockly cannot read.
      console.error(e)
      unloadable = true
      ScratchBlocks.serialization.workspaces.load({ variables: json.variables }, ws)
    }
    for (const { id } of locals) {
      const variable = ws.getVariableMap().getVariableById(id) as ScratchVariable | null
      if (variable) variable.isLocal = true
    }
  } finally {
    loading = false
  }
  if (unloadable) void showAlert(t('sprite.blocksUnloadable', { name: sprite.name }))
  ws.scrollCenter()
  // Sprite reporters' checkboxes refer to the sprite being edited.
  syncCheckboxes(ws, store)
  // Re-apply glows for this sprite's running scripts.
  for (const top of sprite.blocks?.blocks?.blocks ?? []) {
    if (store.rt.isScriptRunning(sprite, top.id)) glow(top.id, true)
  }
}

/** Rebuilds the palette (e.g. after variables or custom blocks change). */
function rerenderToolbox(ws: ScratchBlocks.WorkspaceSvg, store: ProjectStore): void {
  ;(ws.getToolbox() as unknown as { forceRerender(): void }).forceRerender()
  // Checkboxes take their initial state before a block's fields are set, so
  // variable checkboxes need setting again.
  syncCheckboxes(ws, store)
}

/** Sets the palette's monitor checkboxes from the runtime. */
function syncCheckboxes(ws: ScratchBlocks.WorkspaceSvg, store: ProjectStore): void {
  const flyout = ws.getFlyout() as unknown as ScratchBlocks.CheckableContinuousFlyout | null
  if (!flyout) return
  for (const block of flyout.getWorkspace().getTopBlocks(false)) {
    const key = monitorKeyOf(block, store.editingId)
    if (key && block.getIcon('checkbox')) flyout.setCheckboxState(block.id, store.rt.monitors.has(key))
  }
}

/** Identifies the set of custom block definitions (with their arguments and warp flags). */
function procedureSignature(ws: ScratchBlocks.WorkspaceSvg): string {
  return ws
    .getBlocksByType('procedures_prototype', false)
    .map((b) => (b.mutationToDom ? ScratchBlocks.Xml.domToText(b.mutationToDom()) : ''))
    .sort()
    .join('\n')
}

function glow(blockId: string, on: boolean): void {
  try {
    ScratchBlocks.glowStack(blockId, on)
  } catch {
    // The stack belongs to a sprite whose workspace is not shown.
  }
}

export function BlocksEditor({ store, editingId, blocksRevision, extensionKey, backdropKey, stage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<ScratchBlocks.WorkspaceSvg | null>(null)
  const [procedureRequest, setProcedureRequest] = useState<ProcedureRequest | null>(null)

  useEffect(() => {
    const container = containerRef.current!
    defineCustomBlocks()
    setSpriteNameSource(() => store.rt.sprites.filter((s) => s.id !== store.editingId).map((s) => s.name))
    setBackdropNameSource(() => store.rt.backdrops.list.map((b) => b.name))
    setCostumeNameSource(() => (store.editingStage ? [] : store.editing.costumes.map((c) => c.name)))
    setStageSource(() => store.editingStage)
    setSpriteVariableSource((name) => {
      const sprite = store.rt.sprites.find((s) => s.name === name)
      return sprite ? Object.values(sprite.variables).map((v) => v.name) : []
    })
    // Checkboxes created when the palette renders start in the runtime's state.
    ScratchBlocks.CheckboxBubble.prototype.isChecked = function (this: { sourceBlock: ScratchBlocks.Block }) {
      const key = monitorKeyOf(this.sourceBlock, store.editingId)
      return key !== null && store.rt.monitors.has(key)
    }
    ScratchBlocks.ScratchProcedures.externalProcedureDefCallback = (mutation, done) => setProcedureRequest({ mutation, done })
    installBlocklyDialogs()
    ScratchBlocks.ScratchVariables.setPromptHandler((message, defaultValue, callback, title, varType) => {
      // Global names must not clash with any sprite's own variables (scratch-blocks checks the ones in this workspace).
      const otherLocalNames = store.rt.sprites
        .filter((s) => s.id !== store.editingId)
        .flatMap((s) => Object.values(varType === LIST_TYPE ? s.lists : s.variables).map((v) => v.name))
      // An empty name means "cancelled" to scratch-blocks.
      const creating = title === ScratchBlocks.Msg.VARIABLE_MODAL_TITLE || title === ScratchBlocks.Msg.LIST_MODAL_TITLE
      // The stage's variables are for all sprites, so it doesn't ask.
      if (creating && !store.editingStage) {
        void showVariablePrompt(title, message).then((r) =>
          callback(r?.name ?? '', otherLocalNames, { scope: r?.local ? 'local' : 'global' }),
        )
      } else {
        void showPrompt(title ?? message, message, defaultValue).then((name) => callback(name ?? '', otherLocalNames))
      }
    })

    for (const ext of installedExtensions(store)) defineExtensionBlocks(ext)
    const ws = ScratchBlocks.inject(container, {
      toolbox: makeToolboxXml(installedExtensions(store), store.editingStage),
      media: `${import.meta.env.BASE_URL}blocks-media/`,
      theme: createTheme(Object.fromEntries(BUILTIN_EXTENSIONS.map((e) => [extensionStyle(e), e.colours]))),
      zoom: { controls: true, wheel: true, startScale: 0.675 },
      grid: { spacing: 40, length: 2, colour: '#ddd' },
      move: { scrollbars: true, drag: true, wheel: false },
      comments: true,
      sounds: false,
      trashcan: false,
    })
    wsRef.current = ws
    if (import.meta.env.DEV) Object.assign(window, { __beecubeWorkspace: ws, __ScratchBlocks: ScratchBlocks })
    // The toolbox first renders inside inject() with Blockly's own VARIABLE
    // callback; register Scratch's and render again.
    ws.registerToolboxCategoryCallback('VARIABLE', ScratchBlocks.ScratchVariables.getVariablesCategory)
    ws.registerToolboxCategoryCallback('PROCEDURE', ScratchBlocks.ScratchProcedures.getProceduresCategory)
    rerenderToolbox(ws, store)

    let toolboxTimer: ReturnType<typeof setTimeout> | undefined
    const refreshToolbox = () => {
      clearTimeout(toolboxTimer)
      toolboxTimer = setTimeout(() => rerenderToolbox(ws, store), 0)
    }

    const runClicked = (blockWs: ScratchBlocks.Workspace, blockId: string) => {
      const block = blockWs.getBlockById(blockId)
      if (!block) return
      const root = block.getRootBlock()
      const json = ScratchBlocks.serialization.blocks.save(root, { addCoordinates: false }) as BlockJson | null
      if (json) store.rt.toggleScript(store.editing, json)
    }

    const isVarEvent = (e: ScratchBlocks.Events.Abstract) =>
      e.type === ScratchBlocks.Events.VAR_CREATE ||
      e.type === ScratchBlocks.Events.VAR_RENAME ||
      e.type === ScratchBlocks.Events.VAR_DELETE
    // The flyout shares the main workspace's variables, so this reads both.
    const syncVariables = () => {
      const sprite = store.editing
      const all = ws.getVariableMap().getAllVariables() as ScratchVariable[]
      const of = (type: string, local: boolean) => all.filter((v) => v.getType() === type && !!v.isLocal === local)
      const defs = (type: string) => of(type, false).map((v) => ({ id: v.getId(), name: v.getName() }))
      const ownVariables = sprite.variables
      const ownLists = sprite.lists
      const known = new Set(
        [...store.rt.variableDefs, ...store.rt.listDefs].map((v) => v.id).concat(Object.keys(ownVariables), Object.keys(ownLists)),
      )
      store.rt.variableDefs = defs('')
      store.rt.listDefs = defs(LIST_TYPE)
      store.rt.broadcastDefs = defs(BROADCAST_TYPE)
      // The sprite's own variables keep their values (and lists their items) through renames.
      sprite.variables = Object.fromEntries(
        of('', true).map((v) => [v.getId(), { name: v.getName(), value: ownVariables[v.getId()]?.value ?? 0 }]),
      )
      sprite.lists = Object.fromEntries(
        of(LIST_TYPE, true).map((v) => [v.getId(), { name: v.getName(), items: ownLists[v.getId()]?.items ?? [] }]),
      )
      // As in Scratch, a new variable or list starts with its monitor shown.
      for (const v of all) {
        if (known.has(v.getId())) continue
        if (v.getType() === '') store.rt.setMonitor(`var:${v.getId()}`, true)
        if (v.getType() === LIST_TYPE) store.rt.setMonitor(`list:${v.getId()}`, true)
      }
      refreshToolbox()
    }

    let shownProcedures = procedureSignature(ws)
    ws.addChangeListener((e: ScratchBlocks.Events.Abstract) => {
      if (loading) return
      if (e.type === ScratchBlocks.Events.CLICK) {
        const click = e as ScratchBlocks.Events.Click
        if (click.targetType === 'block' && click.blockId) runClicked(ws, click.blockId)
        return
      }
      if (e.isUiEvent) return
      if (!unloadable) store.editing.blocks = ScratchBlocks.serialization.workspaces.save(ws) as WorkspaceJson
      if (isVarEvent(e)) syncVariables()
      // The "My Blocks" palette lists the custom blocks defined in the workspace.
      const procs = procedureSignature(ws)
      if (procs !== shownProcedures) {
        shownProcedures = procs
        refreshToolbox()
      }
    })

    ws.getFlyout()?.getWorkspace().addChangeListener((e: ScratchBlocks.Events.Abstract) => {
      // Creating a message from a palette block's dropdown fires its event here.
      if (isVarEvent(e)) {
        syncVariables()
        return
      }
      if (e.type === ScratchBlocks.Events.BLOCK_CHANGE) {
        const change = e as ScratchBlocks.Events.BlockChange
        const block = change.blockId ? ws.getFlyout()?.getWorkspace().getBlockById(change.blockId) : null
        const key = block && change.element === 'checkbox' ? monitorKeyOf(block, store.editingId) : null
        if (key) store.rt.setMonitor(key, change.newValue === true)
        return
      }
      // Clicking a block in the palette runs it too, as in Scratch.
      if (e.type !== ScratchBlocks.Events.CLICK) return
      const click = e as ScratchBlocks.Events.Click
      if (click.targetType === 'block' && click.blockId) runClicked(ws.getFlyout()!.getWorkspace(), click.blockId)
    })

    const offScripts = store.rt.onScriptChange((spriteId, topBlockId, running) => {
      if (spriteId === store.editingId) glow(topBlockId, running)
    })
    // "show variable" / "hide variable" blocks change monitors too.
    const offMonitors = store.rt.onMonitorChange(() => syncCheckboxes(ws, store))

    const resizeObserver = new ResizeObserver(() => ScratchBlocks.svgResize(ws))
    resizeObserver.observe(container)

    loadSprite(ws, store)

    return () => {
      clearTimeout(toolboxTimer)
      offScripts()
      offMonitors()
      resizeObserver.disconnect()
      ws.dispose()
      wsRef.current = null
    }
  }, [store])

  useEffect(() => {
    const ws = wsRef.current
    if (ws) loadSprite(ws, store)
  }, [store, editingId, blocksRevision])

  // Adding an extension adds its category, and the stage has its own palette; the first render already has the initial set.
  const shownToolbox = useRef(`${extensionKey}|${stage}`)
  useEffect(() => {
    const ws = wsRef.current
    const key = `${extensionKey}|${stage}`
    if (!ws || shownToolbox.current === key) return
    shownToolbox.current = key
    for (const ext of installedExtensions(store)) defineExtensionBlocks(ext)
    ws.updateToolbox(makeToolboxXml(installedExtensions(store), stage))
    // updateToolbox refreshes the category list but not the continuous flyout.
    rerenderToolbox(ws, store)
  }, [store, extensionKey, stage])

  const shownBackdrops = useRef(backdropKey)
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || shownBackdrops.current === backdropKey) return
    shownBackdrops.current = backdropKey
    rerenderToolbox(ws, store)
  }, [store, backdropKey])

  return (
    <>
      <div className="blocks-editor" ref={containerRef} />
      {procedureRequest && <ProcedureEditor request={procedureRequest} onClose={() => setProcedureRequest(null)} />}
    </>
  )
}
