import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { APP_NAME, PROJECT_FILE_EXTENSION } from '../brand'
import { localize } from '../engine/extension'
import { ProjectFormatError } from '../engine/project'
import { BUILTIN_EXTENSIONS } from '../extensions'
import { changeLocale, getLocale, LOCALES, t, type Locale } from '../i18n'
import { fetchShared, projectApiUrl } from '../share/client'
import type { Stage3D } from '../stage/Stage3D'
import { DialogHost, showAlert, showConfirm } from './dialogs'
import { listenKeys } from './keys'
import { BlocksEditor } from './BlocksEditor'
import { SpritePane } from './SpritePane'
import { StagePanel } from './StagePanel'
import { ShareDialog } from './ShareDialog'
import { ProjectStore } from './store'

/** One project per page; created outside React so StrictMode's double render doesn't make two runtimes. */
const store = new ProjectStore()

function FileMenu() {
  const fileInput = useRef<HTMLInputElement>(null)

  const save = () => {
    const url = URL.createObjectURL(new Blob([store.toJson()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `project${PROJECT_FILE_EXTENSION}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const open = async (file: File) => {
    try {
      store.openProject(await file.text())
    } catch (err) {
      const reason = err instanceof ProjectFormatError || err instanceof SyntaxError ? err.message : String(err)
      await showAlert(t('menu.openFailed', { name: file.name, reason }))
    }
  }

  return (
    <div className="file-menu">
      <button
        onClick={async () => {
          if (await showConfirm(t('menu.confirmNew'))) store.newProject()
        }}
      >
        {t('menu.new')}
      </button>
      <button onClick={() => fileInput.current?.click()}>{t('menu.open')}</button>
      <button onClick={save}>{t('menu.save')}</button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void open(file)
        }}
      />
    </div>
  )
}

function ExtensionMenu() {
  const [open, setOpen] = useState(false)
  const installed = store.extensionIds
  return (
    <div className="extension-menu">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {t('menu.extensions')}
      </button>
      {open && (
        <ul className="extension-list">
          {BUILTIN_EXTENSIONS.map((ext) => {
            const added = installed.includes(ext.id)
            return (
              <li key={ext.id}>
                <span className="extension-swatch" style={{ background: ext.colours[0] }} />
                <span className="extension-name">{localize(ext.name, getLocale())}</span>
                <button
                  disabled={added}
                  onClick={() => {
                    store.addExtension(ext.id)
                    setOpen(false)
                  }}
                >
                  {added ? t('extension.added') : t('extension.add')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function LanguageMenu() {
  return (
    <select
      className="language-menu"
      aria-label={t('menu.language')}
      value={getLocale()}
      // The project is kept across the reload by the autosave.
      onChange={(e) => changeLocale(e.target.value as Locale, () => store.autosave())}
    >
      {Object.entries(LOCALES).map(([id, { name }]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  )
}

/** `?open=<id>` (the player's "see inside"): asks, then replaces the project with that shared project. */
async function openSharedFromUrl(): Promise<void> {
  const url = new URL(location.href)
  const id = url.searchParams.get('open')
  if (!id) return
  url.searchParams.delete('open')
  history.replaceState(null, '', url)
  if (!/^[a-z0-9]{1,32}$/.test(id)) return
  try {
    const shared = await fetchShared(projectApiUrl(id))
    if (!(await showConfirm(t('menu.confirmOpenShared', { title: shared.title })))) return
    store.openProject(JSON.stringify(shared.project))
  } catch (err) {
    console.warn('could not open the shared project', err)
    await showAlert(t('menu.openSharedFailed'))
  }
}

export function App() {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const [sharing, setSharing] = useState(false)
  const stageRef = useRef<Stage3D | null>(null)

  useEffect(() => listenKeys(store.rt), [])
  useEffect(() => void openSharedFromUrl(), [])

  return (
    <div className="app">
      <header className="menu-bar">
        <span className="logo brand">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {APP_NAME}
        </span>
        <FileMenu />
        <ExtensionMenu />
        <button className="share-button" onClick={() => setSharing(true)}>
          {t('menu.share')}
        </button>
        <a className="about-link" href={`${import.meta.env.BASE_URL}about.html`} target="_blank" rel="noopener">
          {t('about.about')}
        </a>
        <LanguageMenu />
      </header>
      <main className="workspace-area">
        <section className="code-area">
          <BlocksEditor
            key={store.projectId}
            store={store}
            editingId={store.editingId}
            blocksRevision={store.blocksRevision}
            extensionKey={store.extensionIds.join(',')}
          />
        </section>
        <aside className="right-column">
          <StagePanel store={store} editingId={store.editingId} onStage={(stage) => (stageRef.current = stage)} />
          <SpritePane store={store} editingId={store.editingId} />
        </aside>
      </main>
      {sharing && (
        <ShareDialog
          store={store}
          snapshot={async (width) => (stageRef.current ? stageRef.current.snapshot(width) : null)}
          onClose={() => setSharing(false)}
        />
      )}
      <DialogHost />
    </div>
  )
}
