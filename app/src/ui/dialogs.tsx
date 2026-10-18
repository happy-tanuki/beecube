/**
 * In-page alert / confirm / name prompt. Native `window.alert`, `confirm`
 * and `prompt` are avoided: embedded browsers (and pages whose dialogs the
 * user blocked) skip them silently, returning as if cancelled.
 *
 * Call the functions from anywhere; <DialogHost /> (mounted once) shows them.
 */
import { useEffect, useState } from 'react'
import * as ScratchBlocks from 'scratch-blocks'
import { APP_NAME } from '../brand'
import { t } from '../i18n'

type Request =
  | { kind: 'alert'; message: string; done: () => void }
  | { kind: 'confirm'; message: string; done: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; message: string; defaultValue: string; done: (name: string | null) => void }
  | { kind: 'variable'; title: string; message: string; done: (result: VariablePromptResult | null) => void }

export interface VariablePromptResult {
  name: string
  /** "For this sprite only" was chosen. */
  local: boolean
}

const queue: Request[] = []
let notify: (() => void) | null = null

function enqueue(r: Request): void {
  queue.push(r)
  notify?.()
}

export const showAlert = (message: string): Promise<void> =>
  new Promise((done) => enqueue({ kind: 'alert', message, done }))

export const showConfirm = (message: string): Promise<boolean> =>
  new Promise((done) => enqueue({ kind: 'confirm', message, done }))

/** Resolves with the entered text, or null when cancelled. */
export const showPrompt = (title: string, message: string, defaultValue = ''): Promise<string | null> =>
  new Promise((done) => enqueue({ kind: 'prompt', title, message, defaultValue, done }))

/** Asks for a new variable's or list's name and whether it is for all sprites. Null when cancelled. */
export const showVariablePrompt = (title: string, message: string): Promise<VariablePromptResult | null> =>
  new Promise((done) => enqueue({ kind: 'variable', title, message, done }))

/** Routes Blockly's own dialogs (e.g. "delete N uses of this variable?") here. */
export function installBlocklyDialogs(): void {
  ScratchBlocks.dialog.setAlert((message, callback) => void showAlert(message).then(() => callback?.()))
  ScratchBlocks.dialog.setConfirm((message, callback) => void showConfirm(message).then(callback))
  ScratchBlocks.dialog.setPrompt((message, defaultValue, callback) => void showPrompt(message, message, defaultValue).then(callback))
}

export function DialogHost() {
  const [, setVersion] = useState(0)
  useEffect(() => {
    notify = () => setVersion((v) => v + 1)
    return () => {
      notify = null
    }
  }, [])
  const current = queue[0]
  if (!current) return null
  const close = () => {
    queue.shift()
    setVersion((v) => v + 1)
  }
  return <Dialog key={queue.length + current.message} request={current} close={close} />
}

function Dialog({ request, close }: { request: Request; close: () => void }) {
  const [text, setText] = useState(request.kind === 'prompt' ? request.defaultValue : '')
  const [local, setLocal] = useState(false)
  const finish = (ok: boolean) => {
    close()
    if (request.kind === 'alert') request.done()
    else if (request.kind === 'confirm') request.done(ok)
    else if (request.kind === 'prompt') request.done(ok ? text : null)
    else request.done(ok ? { name: text, local } : null)
  }
  const asksName = request.kind === 'prompt' || request.kind === 'variable'
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <form
        className="modal small-dialog"
        role={request.kind === 'alert' ? 'alertdialog' : 'dialog'}
        onSubmit={(e) => {
          e.preventDefault()
          finish(true)
        }}
        onKeyDown={(e) => e.key === 'Escape' && finish(false)}
      >
        <header>{asksName ? request.title : APP_NAME}</header>
        {asksName ? (
          <label className="small-dialog-body">
            <span>{request.message}</span>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        ) : (
          <p className="small-dialog-body">{request.message}</p>
        )}
        {request.kind === 'variable' && (
          <div className="small-dialog-scope" role="radiogroup">
            <label>
              <input type="radio" name="scope" checked={!local} onChange={() => setLocal(false)} />
              {t('variable.forAllSprites')}
            </label>
            <label>
              <input type="radio" name="scope" checked={local} onChange={() => setLocal(true)} />
              {t('variable.forThisSpriteOnly')}
            </label>
          </div>
        )}
        <footer>
          {request.kind !== 'alert' && (
            <button type="button" onClick={() => finish(false)}>
              {t('dialog.cancel')}
            </button>
          )}
          {/* autoFocus so Enter / Escape work without clicking first. */}
          <button type="submit" className="primary" autoFocus={!asksName}>
            {t('dialog.ok')}
          </button>
        </footer>
      </form>
    </div>
  )
}
