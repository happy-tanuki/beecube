/**
 * The moderation page (admin.html): reported and hidden shared projects,
 * the text, pictures and 3D models in each, and buttons to hide, show again or delete them. It needs
 * the ADMIN_TOKEN secret, kept for the browser tab only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { APP_ID, APP_NAME } from '../brand'
import { t, type MessageKey } from '../i18n'
import { ApiError, shareUrl } from '../share/client'
import { assetFileName, Assets, parseAssetFileName, type AssetRef } from '../engine/assets'
import { modelThumbnail } from '../ui/costumeThumbnails'
import { AdminApi, type ReviewDetail, type ReviewItem } from './api'
import { projectTexts } from './texts'

const TOKEN_KEY = `${APP_ID}.adminToken`

const REASON_LABELS: Record<string, MessageKey> = {
  'personal-info': 'player.reasonPersonalInfo',
  mean: 'player.reasonMean',
  scary: 'player.reasonScary',
  other: 'player.reasonOther',
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Without storage the token lasts until the page reloads.
  }
}

const failure = (err: unknown) => t('admin.failed', { reason: err instanceof ApiError ? err.code : String(err) })

function SignIn({ onToken, rejected }: { onToken(token: string): void; rejected: boolean }) {
  const [token, setToken] = useState('')
  return (
    <form
      className="admin-signin"
      onSubmit={(e) => {
        e.preventDefault()
        if (token.trim()) onToken(token.trim())
      }}
    >
      <label>
        <span>{t('admin.token')}</span>
        <input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      {rejected && <p className="admin-error">{t('admin.badToken')}</p>}
      <button type="submit">{t('admin.signIn')}</button>
    </form>
  )
}

function Detail({ api, id, onChanged }: { api: AdminApi; id: string; onChanged(): void }) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [picture, setPicture] = useState<string | null>(null)
  const [assets, setAssets] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    const fetched = async (get: () => Promise<string>) => {
      const url = await get().catch(() => null)
      if (url) urls.push(url)
      return url
    }
    setDetail(null)
    setPicture(null)
    setAssets([])
    setModels([])
    setConfirmDelete(false)
    api.get(id).then(
      async (d) => {
        if (cancelled) return
        setDetail(d)
        if (d.hasThumbnail) {
          const url = await fetched(() => api.thumbnailUrl(id))
          if (!cancelled) setPicture(url)
        }
        const pictures = d.assets.filter((file) => !file.endsWith('.glb'))
        const found = await Promise.all(pictures.map((file) => fetched(() => api.assetUrl(id, file))))
        if (!cancelled) setAssets(found.filter((url) => url !== null))
        // Models are drawn, as the editor's costume lists draw them.
        const store = new Assets()
        store.loader = (ref) => api.assetBytes(id, assetFileName(ref))
        const refs = d.assets.map(parseAssetFileName).filter((ref) => ref?.dataFormat === 'glb') as AssetRef[]
        const draw = () => {
          if (cancelled) return
          const drawn = refs.map((ref) => modelThumbnail(store, ref))
          setModels(drawn.filter((url) => url !== null))
          if (drawn.includes(null)) setTimeout(draw, 300)
        }
        draw()
      },
      (err: unknown) => !cancelled && setError(failure(err)),
    )
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [api, id])

  const act = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(failure(err))
    }
  }

  if (error) return <p className="admin-error">{error}</p>
  if (!detail) return <p>{t('player.loading')}</p>
  const texts = projectTexts(detail.project)
  return (
    <article className="admin-detail">
      <h2>{detail.title}</h2>
      <p className={`admin-status ${detail.status}`}>
        {detail.status === 'hidden' ? t('admin.statusHidden') : t('admin.statusShared')}
      </p>
      {picture && <img className="admin-picture" src={picture} alt="" />}
      <h3>{t('admin.notes')}</h3>
      <p className="admin-text">{detail.notes || '—'}</p>
      <h3>{t('admin.texts')}</h3>
      {texts.length === 0 ? (
        <p>{t('admin.noTexts')}</p>
      ) : (
        <ul className="admin-texts">
          {texts.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
      <h3>{t('admin.pictures')}</h3>
      {detail.assets.length === 0 ? (
        <p>{t('admin.noPictures')}</p>
      ) : (
        <ul className="admin-assets">
          {assets.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener">
                <img src={url} alt="" />
              </a>
            </li>
          ))}
          {models.map((url) => (
            <li key={url}>
              <img src={url} alt="" title={t('costume.model')} />
            </li>
          ))}
        </ul>
      )}
      <div className="admin-actions">
        {detail.status === 'shared' && (
          <a href={shareUrl(detail.id)} target="_blank" rel="noopener">
            {t('admin.open')}
          </a>
        )}
        {detail.status === 'shared' ? (
          <button onClick={() => void act(() => api.hide(id))}>{t('admin.hide')}</button>
        ) : (
          <button onClick={() => void act(() => api.restore(id))}>{t('admin.restore')}</button>
        )}
        {confirmDelete ? (
          <button className="danger" onClick={() => void act(() => api.remove(id))}>
            {t('admin.confirmDelete')}
          </button>
        ) : (
          <button onClick={() => setConfirmDelete(true)}>{t('admin.delete')}</button>
        )}
      </div>
    </article>
  )
}

export function Admin() {
  const [token, setToken] = useState(readToken)
  const [rejected, setRejected] = useState(false)
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const api = useMemo(() => (token ? new AdminApi(token) : null), [token])

  const signOut = (wasRejected: boolean) => {
    writeToken('')
    setToken('')
    setItems(null)
    setSelected(null)
    setRejected(wasRejected)
  }

  const load = useCallback(async () => {
    if (!api) return
    setError('')
    try {
      const list = await api.list()
      setItems(list)
      setSelected((s) => (s && list.some((p) => p.id === s) ? s : null))
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) signOut(true)
      else setError(failure(err))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin">
      <header className="admin-bar">
        <span className="admin-logo brand">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {APP_NAME}
        </span>
        <span>{t('admin.title')}</span>
        {api && (
          <span className="admin-bar-buttons">
            <button onClick={() => void load()}>{t('admin.refresh')}</button>
            <button onClick={() => signOut(false)}>{t('admin.signOut')}</button>
          </span>
        )}
      </header>
      {!api ? (
        <SignIn
          rejected={rejected}
          onToken={(value) => {
            writeToken(value)
            setRejected(false)
            setToken(value)
          }}
        />
      ) : (
        <main className="admin-main">
          <section className="admin-list">
            {error && <p className="admin-error">{error}</p>}
            {items?.length === 0 && <p>{t('admin.empty')}</p>}
            <ul>
              {items?.map((p) => (
                <li key={p.id}>
                  <button className={selected === p.id ? 'selected' : ''} onClick={() => setSelected(p.id)}>
                    <span className="admin-item-title">{p.title}</span>
                    <span className={`admin-status ${p.status}`}>
                      {p.status === 'hidden' ? t('admin.statusHidden') : t('admin.statusShared')}
                    </span>
                    <span className="admin-reasons">
                      {t('admin.reports', { n: p.reports })}
                      {Object.entries(p.reasons).map(([reason, n]) => (
                        <span key={reason}>
                          {REASON_LABELS[reason] ? t(REASON_LABELS[reason]) : reason}: {n}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-pane">
            {selected && api && <Detail api={api} id={selected} onChanged={() => void load()} />}
          </section>
        </main>
      )}
    </div>
  )
}
