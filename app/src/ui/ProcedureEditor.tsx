import { useEffect, useRef, useState } from 'react'
import * as ScratchBlocks from 'scratch-blocks'
import { createTheme } from '../blocks/setup'
import { t } from '../i18n'

/** The scratch-blocks API of the root block in the "Make a Block" editor. */
interface DeclarationBlock extends ScratchBlocks.BlockSvg {
  onChangeFn(): void
  getWarp(): boolean
  setWarp(warp: boolean): void
  addLabelExternal(): void
  addBooleanExternal(): void
  addStringNumberExternal(): void
  focusLastEditor_(): void
}

export interface ProcedureRequest {
  mutation: Element
  done(mutation?: Element): void
}

/**
 * The "Make a Block" dialog: a small workspace holding a procedures_declaration
 * block whose labels and inputs the user edits, plus the warp checkbox.
 */
export function ProcedureEditor({ request, onClose }: { request: ProcedureRequest; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<DeclarationBlock | null>(null)
  const [warp, setWarp] = useState(request.mutation.getAttribute('warp') === 'true')

  useEffect(() => {
    const ws = ScratchBlocks.inject(containerRef.current!, {
      media: `${import.meta.env.BASE_URL}blocks-media/`,
      theme: createTheme(),
      zoom: { startScale: 0.85 },
      move: { scrollbars: true, drag: false, wheel: false },
      comments: false,
      sounds: false,
      trashcan: false,
    })
    const root = ws.newBlock('procedures_declaration') as DeclarationBlock
    root.domToMutation?.(request.mutation)
    root.initSvg()
    root.render()
    root.setMovable(false)
    root.setDeletable(false)
    rootRef.current = root
    const recenter = () => {
      root.onChangeFn()
      // Scrolling closes an open label/argument name editor, so leave the view alone while typing.
      if (!ScratchBlocks.WidgetDiv.isVisible()) ws.scrollCenter()
    }
    ws.addChangeListener(recenter)
    recenter()
    return () => {
      rootRef.current = null
      ws.dispose()
    }
  }, [request])

  const finish = (ok: boolean) => {
    const root = rootRef.current
    if (ok && root) {
      root.onChangeFn()
      root.setWarp(warp)
      request.done(root.mutationToDom!(true))
    } else {
      request.done(undefined)
    }
    onClose()
  }

  const add = (kind: 'addStringNumberExternal' | 'addBooleanExternal' | 'addLabelExternal') => {
    const root = rootRef.current
    if (!root) return
    root[kind]()
    // The add methods try to open the new name editor right away, but Blockly
    // renders (and recenters, via the change listener) later, so open it once
    // the new input is on screen.
    void ScratchBlocks.renderManagement.finishQueuedRenders().then(() => {
      if (rootRef.current === root) root.focusLastEditor_()
    })
  }

  // The add buttons must not take focus: the new name editor gets it, and a
  // focused button would turn the Enter that ends typing into another click.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <div className="modal procedure-editor" role="dialog" aria-label={t('procedure.title')}>
        <header>{t('procedure.title')}</header>
        <div className="procedure-workspace" ref={containerRef} />
        <div className="procedure-add">
          <button onMouseDown={keepFocus} onClick={() => add('addStringNumberExternal')}>
            <span className="arg-shape round" />
            {t('procedure.addInput')}
            <small>{t('procedure.numberOrText')}</small>
          </button>
          <button onMouseDown={keepFocus} onClick={() => add('addBooleanExternal')}>
            <span className="arg-shape hex" />
            {t('procedure.addInput')}
            <small>{t('procedure.boolean')}</small>
          </button>
          <button onMouseDown={keepFocus} onClick={() => add('addLabelExternal')}>
            <span className="arg-shape label">{t('procedure.labelSample')}</span>
            {t('procedure.addLabel')}
          </button>
        </div>
        <label className="procedure-warp">
          <input type="checkbox" checked={warp} onChange={(e) => setWarp(e.target.checked)} />
          {t('procedure.warp')}
        </label>
        <footer>
          <button onClick={() => finish(false)}>{t('dialog.cancel')}</button>
          <button className="primary" onClick={() => finish(true)}>
            {t('dialog.ok')}
          </button>
        </footer>
      </div>
    </div>
  )
}
