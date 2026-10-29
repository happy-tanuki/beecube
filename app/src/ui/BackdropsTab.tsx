import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FACES, type BackdropData, type FaceName } from '../engine/backdrop'
import { t } from '../i18n'
import { assetUrl } from './assetUrls'
import { libraryAssetUrl, libraryRoomName, librarySceneryName, ROOM_LIBRARY, SCENERY_LIBRARY } from './library'
import { showAlert } from './dialogs'
import { PaintEditor } from './PaintEditor'
import { pictureSize } from './pictures'
import { backdropPreview } from './StagePane'
import { ModelError, type ProjectStore } from './store'
import { AddMenu } from './AddMenu'

/** The color a face gets when it stops being transparent. */
const OPAQUE: Record<FaceName, string> = {
  floor: '#dbe7f7',
  ceiling: '#ffffff',
  back: '#ffffff',
  front: '#ffffff',
  left: '#ffffff',
  right: '#ffffff',
}

export const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'

/** What a costume (or a sprite) can be made from: a picture or a 3D model. */
export const COSTUME_FILE_TYPES = `${IMAGE_TYPES},.glb,model/gltf-binary`

/**
 * A hidden file input: `pick` opens the browser's file chooser, and
 * `onFile` gets the chosen file (an image, unless `accept` says otherwise).
 * If it can't be used, the child is told why.
 */
export function useImagePicker(onFile: (file: File) => Promise<void>, accept = IMAGE_TYPES) {
  const input = useRef<HTMLInputElement>(null)
  const element = (
    <input
      ref={input}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        onFile(file).catch((err: unknown) =>
          showAlert(
            err instanceof ModelError ? t(`costume.modelError.${err.reason}`, { name: file.name }) : t('backdrop.pictureFailed', { name: file.name }),
          ),
        )
      }}
    />
  )
  return { element, pick: () => input.current?.click() }
}

/** Applied on Enter or leaving the field, so blocks that refer to the backdrop follow once. */
function NameField({ store, index, backdrop }: { store: ProjectStore; index: number; backdrop: BackdropData }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) store.renameBackdrop(index, draft)
    setDraft(null)
  }
  return (
    <label className="field name">
      <span>{t('backdrop.name')}</span>
      <input
        value={draft ?? backdrop.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            setTimeout(() => (e.target as HTMLInputElement).blur())
          }
        }}
      />
    </label>
  )
}

function FaceRow({ store, index, backdrop, name, onPaint }: { store: ProjectStore; index: number; backdrop: BackdropData; name: FaceName; onPaint: () => void }) {
  const update = (change: (b: BackdropData) => void) => store.updateBackdrop(index, change)
  const { color, picture } = backdrop.faces[name]
  const picker = useImagePicker((file) => store.setFacePicture(index, name, file))
  const url = picture && assetUrl(store.rt.assets, picture)
  return (
    <tr>
      <th>{t(`backdrop.face.${name}`)}</th>
      <td>
        <input
          type="color"
          aria-label={t(`backdrop.face.${name}`)}
          className={color === null ? 'transparent' : ''}
          value={color ?? OPAQUE[name]}
          onChange={(e) => update((b) => (b.faces[name].color = e.target.value))}
        />
      </td>
      <td>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={color === null}
            onChange={(e) => update((b) => (b.faces[name].color = e.target.checked ? null : OPAQUE[name]))}
          />
          <span>{t('backdrop.transparent')}</span>
        </label>
      </td>
      <td className="face-picture">
        {picker.element}
        {picture ? (
          <>
            <span className="face-picture-thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
            <button className="face-picture-remove" title={t('backdrop.removePicture')} onClick={() => void store.setFacePicture(index, name, null)}>
              ×
            </button>
          </>
        ) : (
          <button onClick={picker.pick}>{t('backdrop.addPicture')}</button>
        )}
        <button onClick={onPaint}>{t('backdrop.paint')}</button>
      </td>
    </tr>
  )
}

/** How a face looks in a small picture: its picture, over its color (or nothing). */
const faceStyle = (store: ProjectStore, backdrop: BackdropData, name: FaceName): CSSProperties => {
  const { color, picture } = backdrop.faces[name]
  const url = picture && assetUrl(store.rt.assets, picture)
  return { backgroundColor: color ?? 'transparent', backgroundImage: url ? `url("${url}")` : undefined }
}

/** The scenery, as a big card: a color, and a 360° image over it (from the library or uploaded). */
function SceneryCard({ store, index, backdrop, onChoose }: { store: ProjectStore; index: number; backdrop: BackdropData; onChoose: () => void }) {
  const picker = useImagePicker((file) => store.setSceneryPicture(index, file))
  const picture = backdrop.sceneryPicture
  const url = picture && assetUrl(store.rt.assets, picture)
  return (
    <div className="backdrop-card">
      <span className="backdrop-card-title">{t('backdrop.scenery')}</span>
      <button className="backdrop-card-preview" style={{ backgroundColor: backdrop.scenery, backgroundImage: url ? `url("${url}")` : undefined }} onClick={onChoose} title={t('backdrop.sceneryLibrary')} />
      <div className="backdrop-card-actions">
        {picker.element}
        <button onClick={onChoose}>{t('backdrop.choose')}</button>
        <button onClick={picker.pick}>{t('backdrop.uploadScenery')}</button>
        <label className="field">
          <span>{t('backdrop.color')}</span>
          <input type="color" value={backdrop.scenery} onChange={(e) => store.updateBackdrop(index, (b) => (b.scenery = e.target.value))} />
        </label>
        {picture && (
          <button className="face-picture-remove" title={t('backdrop.removePicture')} onClick={() => void store.setSceneryPicture(index, null)}>
            ×
          </button>
        )}
      </div>
    </div>
  )
}

/** The room, as a big card: its back wall over its floor, and dressing all six faces from the library. */
function RoomCard({ store, backdrop, onChoose }: { store: ProjectStore; backdrop: BackdropData; onChoose: () => void }) {
  return (
    <div className="backdrop-card">
      <span className="backdrop-card-title">{t('backdrop.room')}</span>
      <button className="backdrop-card-preview room" onClick={onChoose} title={t('backdrop.roomLibrary')}>
        <span className="room-back" style={faceStyle(store, backdrop, 'back')} />
        <span className="room-floor" style={faceStyle(store, backdrop, 'floor')} />
      </button>
      <div className="backdrop-card-actions">
        <button onClick={onChoose}>{t('backdrop.choose')}</button>
      </div>
    </div>
  )
}

/**
 * A backdrop's form: its name, the scenery and the room as two big cards,
 * the grid, and each face's color and picture under "More".
 */
function BackdropForm(props: {
  store: ProjectStore
  index: number
  backdrop: BackdropData
  onChoose: (library: LibraryKind) => void
  onPaint: (face: FaceName) => void
}) {
  const { store, index, backdrop, onChoose, onPaint } = props
  const update = (change: (b: BackdropData) => void) => store.updateBackdrop(index, change)
  return (
    <div className="backdrop-form">
      <NameField key={backdrop.id} store={store} index={index} backdrop={backdrop} />
      <div className="backdrop-cards">
        <SceneryCard store={store} index={index} backdrop={backdrop} onChoose={() => onChoose('scenery')} />
        <RoomCard store={store} backdrop={backdrop} onChoose={() => onChoose('room')} />
      </div>
      <label className="field checkbox">
        <input type="checkbox" checked={backdrop.grid} onChange={(e) => update((b) => (b.grid = e.target.checked))} />
        <span>{t('backdrop.grid')}</span>
      </label>
      <details className="backdrop-details">
        <summary>{t('backdrop.details')}</summary>
        <table className="backdrop-faces">
          <tbody>
            {FACES.map((name) => (
              <FaceRow key={name} store={store} index={index} backdrop={backdrop} name={name} onPaint={() => onPaint(name)} />
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

type LibraryKind = 'scenery' | 'room'

export interface LibraryItem {
  key: string
  name: string
  /** null until it is ready (a model's is drawn first). */
  picture: string | null
  /** Shown in place of a picture. */
  icon?: ReactNode
  /** One of the library's categories' keys. */
  category?: string
  choose: () => void
}

/**
 * Choosing from a library (sprites, costumes, backdrops, a backdrop's
 * scenery or room), over the whole editor, laid out as Scratch's "Choose a
 * Backdrop". With categories, buttons along the top show one at a time (or
 * all). Escape closes it.
 */
export function Library({
  title,
  items,
  categories,
  onClose,
}: {
  title: string
  items: LibraryItem[]
  categories?: { key: string; label: string }[]
  onClose: () => void
}) {
  const [category, setCategory] = useState<string | null>(null)
  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])
  const shown = category === null ? items : items.filter((item) => item.category === category)
  return (
    <div className="library">
      <div className="library-header">
        <span>{title}</span>
        <button title={t('backdrop.closeLibrary')} onClick={onClose}>
          ×
        </button>
      </div>
      {categories && (
        <div className="library-categories">
          {[{ key: null, label: t('spriteCategory.all') }, ...categories].map((c) => (
            <button key={c.key ?? ''} className={c.key === category ? 'selected' : undefined} onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="library-items">
        {shown.map((item) => (
          <button
            key={item.key}
            className="library-item"
            onClick={() => {
              item.choose()
              onClose()
            }}
          >
            {item.picture ? (
              <img src={item.picture} alt="" loading="lazy" />
            ) : (
              <span className="library-item-blank">{item.icon}</span>
            )}
            <span>{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function BackdropLibrary({ store, index, kind, onClose }: { store: ProjectStore; index: number; kind: LibraryKind; onClose: () => void }) {
  const items: LibraryItem[] =
    kind === 'scenery'
      ? SCENERY_LIBRARY.map((entry) => ({
          key: entry.key,
          name: librarySceneryName(entry),
          picture: libraryAssetUrl(entry.picture),
          choose: () => store.setLibraryScenery(index, entry),
        }))
      : ROOM_LIBRARY.map((entry) => ({
          key: entry.key,
          name: libraryRoomName(entry),
          // The back wall, which the home view faces.
          picture: libraryAssetUrl(entry.faces.back.picture!),
          choose: () => store.setLibraryRoom(index, entry),
        }))
  return <Library title={t(kind === 'scenery' ? 'backdrop.sceneryLibrary' : 'backdrop.roomLibrary')} items={items} onClose={onClose} />
}

/** Re-renders periodically so a backdrop switched by a script shows up. */
export function useTicker(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Choosing a new backdrop: scenery or a room from the libraries. */
function NewBackdropLibrary({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const items: LibraryItem[] = [
    ...SCENERY_LIBRARY.map((entry) => ({
      key: `scenery:${entry.key}`,
      name: librarySceneryName(entry),
      picture: libraryAssetUrl(entry.picture),
      category: 'scenery',
      choose: () => store.addLibraryScenery(entry),
    })),
    ...ROOM_LIBRARY.map((entry) => ({
      key: `room:${entry.key}`,
      name: libraryRoomName(entry),
      picture: libraryAssetUrl(entry.faces.back.picture!),
      category: 'room',
      choose: () => store.addLibraryRoom(entry),
    })),
  ]
  const categories = [
    { key: 'scenery', label: t('backdropCategory.scenery') },
    { key: 'room', label: t('backdropCategory.room') },
  ]
  return <Library title={t('backdrop.chooseNew')} items={items} categories={categories} onClose={onClose} />
}

/** The stage's Backdrops tab: the list (choosing one makes it current, as in Scratch) and the chosen one's look. */
export function BackdropsTab({ store }: { store: ProjectStore }) {
  useTicker(250)
  const [library, setLibrary] = useState<LibraryKind | 'new' | null>(null)
  /** The face whose picture is being painted, and the picture to start from. */
  const [painting, setPainting] = useState<{ face: FaceName; source: Blob | null } | null>(null)
  const upload = useImagePicker((file) => store.uploadBackdrop(file))
  const { list, current, backdrop } = store.rt.backdrops
  const paint = async (face: FaceName) => {
    const picture = backdrop.faces[face].picture
    setPainting({ face, source: picture && (await store.pictureBlob(picture)) })
  }
  return (
    <div className="backdrops-tab">
      <div className="backdrop-column">
        <div className="backdrop-list">
          {list.map((b, i) => (
            <div key={b.id} className={`backdrop-tile${i === current ? ' selected' : ''}`} onClick={() => store.selectBackdrop(i)}>
              <span className="backdrop-number">{i + 1}</span>
              <span className="backdrop-thumb" style={{ background: backdropPreview(b, store.rt.assets) }} />
              <span className="backdrop-name">{b.name}</span>
              {i === current && list.length > 1 && (
                <button
                  className="sprite-delete"
                  title={t('backdrop.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    store.removeBackdrop(i)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <AddMenu
          className="backdrop-add"
          title={t('backdrop.add')}
          options={[
            { icon: 'choose', label: t('backdrop.chooseNew'), onChoose: () => setLibrary('new') },
            { icon: 'upload', label: t('backdrop.upload'), onChoose: upload.pick },
            { icon: 'new', label: t('backdrop.add'), onChoose: () => store.addBackdrop() },
          ]}
        >
          {upload.element}
        </AddMenu>
      </div>
      <BackdropForm key={backdrop.id} store={store} index={current} backdrop={backdrop} onChoose={setLibrary} onPaint={(face) => void paint(face)} />
      {painting && (
        <PaintEditor
          source={painting.source}
          size={pictureSize(painting.face)}
          guide={[]}
          covering={{
            title: `${backdrop.name}: ${t(`backdrop.face.${painting.face}`)}`,
            onSave: (picture) => store.setFacePicture(current, painting.face, picture),
            onClose: () => setPainting(null),
          }}
        />
      )}
      {library === 'new' && <NewBackdropLibrary store={store} onClose={() => setLibrary(null)} />}
      {library && library !== 'new' && <BackdropLibrary store={store} index={current} kind={library} onClose={() => setLibrary(null)} />}
    </div>
  )
}
