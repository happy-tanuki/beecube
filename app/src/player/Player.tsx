/**
 * The share page: a project's stage, title and notes, for phones as well as
 * desktops. It runs projects without the blocks editor (scratch-blocks isn't
 * loaded), and its stage is play-only.
 */
import { useEffect, useRef, useState } from 'react'
import { APP_NAME, SOURCE_URL } from '../brand'
import { loadProject, parseProject, ProjectFormatError } from '../engine/project'
import { Runtime } from '../engine/runtime'
import { findExtension } from '../extensions'
import { t, type MessageKey } from '../i18n'
import { loadLibraryAsset } from '../ui/library'
import { listenKeys } from '../ui/keys'
import { StageView } from '../ui/StageView'
import { isTouchDevice, TouchKeys, usedKeys } from '../ui/TouchKeys'
import { fetchShared, fetchSharedAsset, NotFoundError, reportShare, type ReportReason } from '../share/client'
import { useTurnstile } from '../share/turnstile'
import { sourceFromLocation, type Source } from './source'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rt: Runtime; title: string; notes: string; keys: string[]; sharedId: string | null }

async function open(source: Source): Promise<{ rt: Runtime; title: string; notes: string; keys: string[] }> {
  const shared = await fetchShared(source.url)
  const project = parseProject(shared.project)
  const rt = new Runtime()
  // Library pictures ship with the app; a shared project's own are on the API.
  const { sharedId } = source
  rt.assets.loader = async (ref) => (await loadLibraryAsset(ref)) ?? (sharedId ? fetchSharedAsset(sharedId, ref) : null)
  for (const id of project.extensions) {
    const ext = findExtension(id)
    if (ext) rt.addExtension(ext)
    else console.warn(`Player: unknown extension "${id}" is ignored`)
  }
  loadProject(rt, project)
  return { rt, title: shared.title, notes: shared.notes, keys: isTouchDevice() ? usedKeys(project) : [] }
}

const REASONS: [ReportReason, MessageKey][] = [
  ['personal-info', 'player.reasonPersonalInfo'],
  ['mean', 'player.reasonMean'],
  ['scary', 'player.reasonScary'],
  ['other', 'player.reasonOther'],
]

/** "Report": choose a reason and send it. Nothing about the reporter is sent. */
function ReportPanel({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const checkRef = useRef<HTMLDivElement>(null)
  const check = useTurnstile(checkRef, open && status !== 'sent')
  if (status === 'sent') return <p className="player-report-done">{t('player.reportThanks')}</p>
  if (!open) {
    return (
      <button className="player-link-button" onClick={() => setOpen(true)}>
        {t('player.report')}
      </button>
    )
  }
  const send = async () => {
    if (!reason || !check.token) return
    setStatus('sending')
    try {
      await reportShare(id, reason, check.token)
      setStatus('sent')
    } catch (err) {
      console.warn('Player: report failed', err)
      setStatus('failed')
      // A token works once.
      check.reset()
    }
  }
  return (
    <form
      className="player-report"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <h2>{t('player.reportTitle')}</h2>
      {REASONS.map(([value, label]) => (
        <label key={value}>
          <input type="radio" name="reason" checked={reason === value} onChange={() => setReason(value)} />
          {t(label)}
        </label>
      ))}
      <div className="player-check" ref={checkRef} />
      {(status === 'failed' || check.unavailable) && <p role="alert">{t('player.reportFailed')}</p>}
      <div className="player-report-buttons">
        <button type="button" onClick={() => setOpen(false)}>
          {t('player.reportCancel')}
        </button>
        <button type="submit" className="primary" disabled={!reason || !check.token || status === 'sending'}>
          {t('player.reportSend')}
        </button>
      </div>
    </form>
  )
}

export function Player() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const source = sourceFromLocation(window.location)
    if (!source) {
      setState({ kind: 'error', message: t('player.notFound') })
      return
    }
    let cancelled = false
    let opened: Runtime | null = null
    open(source).then(
      (loaded) => {
        if (cancelled) return loaded.rt.dispose()
        opened = loaded.rt
        loaded.rt.start()
        if (import.meta.env.DEV) Object.assign(window, { __beecubePlayer: loaded.rt })
        setState({ kind: 'ready', ...loaded, sharedId: source.sharedId })
      },
      (err: unknown) => {
        if (cancelled) return
        console.warn('Player: could not open the project', err)
        const message =
          err instanceof NotFoundError
            ? t('player.notFound')
            : t('player.loadFailed', { reason: err instanceof ProjectFormatError ? err.message : String(err) })
        setState({ kind: 'error', message })
      },
    )
    return () => {
      cancelled = true
      opened?.dispose()
    }
  }, [])

  const rt = state.kind === 'ready' ? state.rt : null
  useEffect(() => (rt ? listenKeys(rt) : undefined), [rt])

  const title = state.kind === 'ready' ? state.title : ''
  useEffect(() => {
    document.title = title ? `${title} - ${APP_NAME}` : APP_NAME
  }, [title])

  return (
    <div className="player">
      <header className="player-bar">
        <a className="player-logo brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {APP_NAME}
        </a>
      </header>
      <main className="player-main">
        {state.kind === 'loading' && <p className="player-message">{t('player.loading')}</p>}
        {state.kind === 'error' && <p className="player-message">{state.message}</p>}
        {state.kind === 'ready' && (
          <>
            <StageView rt={state.rt} fit startOverlay>
              <TouchKeys rt={state.rt} keys={state.keys} />
            </StageView>
            {state.title && <h1 className="player-title">{state.title}</h1>}
            {state.notes && (
              <section className="player-notes">
                <h2>{t('player.notes')}</h2>
                <p>{state.notes}</p>
              </section>
            )}
            {state.sharedId && (
              <div className="player-actions">
                <a className="player-link-button" href={`${import.meta.env.BASE_URL}?open=${state.sharedId}`}>
                  {t('player.remix')}
                </a>
                <ReportPanel id={state.sharedId} />
              </div>
            )}
          </>
        )}
      </main>
      <footer className="player-footer">
        <a href={`${import.meta.env.BASE_URL}about.html`}>{t('about.about')}</a>
        <a href={`${import.meta.env.BASE_URL}about.html#privacy`}>{t('about.privacy')}</a>
        <a href={`${import.meta.env.BASE_URL}about.html#terms`}>{t('about.terms')}</a>
        <a href={`${import.meta.env.BASE_URL}licenses.txt`}>{t('footer.licenses')}</a>
        {SOURCE_URL && <a href={SOURCE_URL}>{t('footer.source')}</a>}
      </footer>
    </div>
  )
}
