/**
 * Sharing: publish the current project at a link, and manage the projects
 * shared from this browser (edit their title and notes, update them with the
 * current project, or stop sharing them).
 */
import { useRef, useState } from 'react'
import { t, type MessageKey } from '../i18n'
import {
  ApiError,
  createShare,
  deleteShare,
  loadShares,
  shareUrl,
  updateShare,
  updateShareInfo,
  type ShareContent,
  type ShareRecord,
} from '../share/client'
import { useTurnstile } from '../share/turnstile'
import { showConfirm } from './dialogs'
import type { ProjectStore } from './store'

/** Width of the stage picture used for link previews. */
const THUMBNAIL_WIDTH = 640

const TITLE_MAX = 80
const NOTES_MAX = 2000

const ERROR_MESSAGES: Record<string, MessageKey> = {
  title_required: 'share.errorTitleRequired',
  too_long: 'share.errorTooLong',
  too_large: 'share.errorTooLarge',
  verification_failed: 'share.errorVerification',
  not_configured: 'share.errorUnavailable',
}

function errorText(err: unknown): string {
  if (err instanceof ApiError && ERROR_MESSAGES[err.code]) return t(ERROR_MESSAGES[err.code])
  return t('share.errorFailed', { reason: err instanceof ApiError ? err.code : String(err) })
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function LinkRow({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const url = shareUrl(id)
  return (
    <div className="share-link">
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('share.link')} />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true))
        }}
      >
        {copied ? t('share.copied') : t('share.copy')}
      </button>
      <a href={url} target="_blank" rel="noopener">
        {t('share.open')}
      </a>
    </div>
  )
}

/** The title and notes fields, for a new share and for editing one. */
function InfoFields(props: { title: string; notes: string; onTitle(title: string): void; onNotes(notes: string): void }) {
  return (
    <>
      <label>
        <span>{t('share.titleLabel')}</span>
        <input autoFocus maxLength={TITLE_MAX} value={props.title} onChange={(e) => props.onTitle(e.target.value)} />
      </label>
      <label>
        <span>{t('share.notesLabel')}</span>
        <textarea rows={4} maxLength={NOTES_MAX} value={props.notes} onChange={(e) => props.onNotes(e.target.value)} />
      </label>
    </>
  )
}

interface Props {
  store: ProjectStore
  /** Takes a picture of the stage (see Stage3D.snapshot), or null without a stage. */
  snapshot(width: number): Promise<Blob | null>
  onClose(): void
}

export function ShareDialog({ store, snapshot, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justShared, setJustShared] = useState<ShareRecord | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const [shares, setShares] = useState(loadShares)
  /** The share whose title and notes are being edited, with the edited values. */
  const [editing, setEditing] = useState<{ record: ShareRecord; title: string; notes: string } | null>(null)
  const checkRef = useRef<HTMLDivElement>(null)
  const check = useTurnstile(checkRef, !justShared && !editing)

  const content = async (title: string, notes: string): Promise<ShareContent> => {
    const picture = await snapshot(THUMBNAIL_WIDTH).catch(() => null)
    return {
      title,
      notes,
      project: JSON.parse(store.toJson()),
      // A link preview is a nicety: share without one if the picture failed.
      thumbnail: picture ? await dataUrl(picture) : undefined,
    }
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
      setShares(loadShares())
    }
  }

  const share = () =>
    run(async () => {
      if (!title.trim()) throw new ApiError(400, 'title_required')
      if (!check.token) throw new ApiError(403, 'verification_failed')
      try {
        setJustShared(await createShare(await content(title, notes), check.token))
      } finally {
        // A token works once.
        check.reset()
      }
    })

  const update = async (record: ShareRecord) => {
    if (!(await showConfirm(t('share.confirmUpdate', { title: record.title })))) return
    // Replaces the project only; the title and notes stay as shared.
    await run(async () => {
      await updateShare(record, await content(record.title, record.notes ?? ''))
      setUpdated(record.id)
    })
  }

  const saveInfo = () =>
    run(async () => {
      if (!editing) return
      if (!editing.title.trim()) throw new ApiError(400, 'title_required')
      await updateShareInfo(editing.record, editing.title, editing.notes)
      setUpdated(editing.record.id)
      setEditing(null)
    })

  const stop = async (record: ShareRecord) => {
    if (!(await showConfirm(t('share.confirmStop', { title: record.title })))) return
    await run(() => deleteShare(record))
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal share-dialog"
        role="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void (editing ? saveInfo() : share())
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header>{editing ? t('share.editHeading') : t('share.heading')}</header>
        <div className="share-body">
          {editing ? (
            <>
              <p className="share-privacy">{t('share.privacy')}</p>
              <InfoFields
                title={editing.title}
                notes={editing.notes}
                onTitle={(title) => {
                  setEditing({ ...editing, title })
                  setError('')
                }}
                onNotes={(notes) => setEditing({ ...editing, notes })}
              />
            </>
          ) : justShared ? (
            <section className="share-done">
              <p>{t('share.done')}</p>
              <LinkRow id={justShared.id} />
            </section>
          ) : (
            <>
              <p className="share-privacy">
                {t('share.privacy')}{' '}
                <a href={`${import.meta.env.BASE_URL}about.html#terms`} target="_blank" rel="noopener">
                  {t('share.termsLink')}
                </a>
              </p>
              <InfoFields
                title={title}
                notes={notes}
                onTitle={(title) => {
                  setTitle(title)
                  setError('')
                }}
                onNotes={setNotes}
              />
              <div className="share-check" ref={checkRef} />
              {check.unavailable && <p className="share-error">{t('share.errorUnavailable')}</p>}
            </>
          )}
          {error && <p className="share-error" role="alert">{error}</p>}
          {shares.length > 0 && !editing && (
            <section className="share-mine">
              <h3>{t('share.mine')}</h3>
              <ul>
                {shares.map((r) => (
                  <li key={r.id}>
                    <a href={shareUrl(r.id)} target="_blank" rel="noopener">
                      {r.title}
                    </a>
                    <span className="share-actions">
                      {updated === r.id && <span className="share-updated">{t('share.updated')}</span>}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setError('')
                          setEditing({ record: r, title: r.title, notes: r.notes ?? '' })
                        }}
                      >
                        {t('share.edit')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void update(r)}>
                        {t('share.update')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void stop(r)}>
                        {t('share.stop')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="share-note">{t('share.keyNote')}</p>
            </section>
          )}
        </div>
        <footer>
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(null)}>
                {t('share.back')}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {t('share.save')}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose}>
              {t('share.close')}
            </button>
          )}
          {!justShared && !editing && (
            <button type="submit" className="primary" disabled={busy || !check.token}>
              {busy ? t('share.sharing') : t('share.submit')}
            </button>
          )}
        </footer>
      </form>
    </div>
  )
}
