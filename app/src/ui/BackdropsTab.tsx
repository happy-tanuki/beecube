import { useEffect, useRef, useState } from 'react'
import { FACES, type BackdropData, type FaceName } from '../engine/backdrop'
import { t } from '../i18n'
import { assetUrl } from './assetUrls'
import { libraryAssetUrl, libraryRoomName, librarySceneryName, ROOM_LIBRARY, SCENERY_LIBRARY } from './library'
import { showAlert } from './dialogs'
import { PaintEditor } from './PaintEditor'
import { pictureSize } from './pictures'
import { backdropPreview } from './StagePane'
import type { ProjectStore } from './store'

/** The color a face gets when it stops being transparent. */
const OPAQUE: Record<FaceName, string> = {
  floor: '#dbe7f7',
  ceiling: '#ffffff',
  back: '#ffffff',
  front: '#ffffff',
  left: '#ffffff',
  right: '#ffffff',
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'

/** A hidden file input: `pick` opens the browser's file chooser, and `onFile` gets the chosen image. */
export function useImagePicker(onFile: (file: File) => Promise<void>) {
  const input = useRef<HTMLInputElement>(null)
  const element = (
    <input
      ref={input}
      type="file"
      accept={IMAGE_TYPES}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) onFile(file).catch(() => showAlert(t('backdrop.pictureFailed', { name: file.name })))
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

/** The scenery: a color, and a 360° image over it (from the library or uploaded). Laid out as the faces' rows, above which it is listed. */
function SceneryRow({ store, index, backdrop, onChoose }: { store: ProjectStore; index: number; backdrop: BackdropData; onChoose: () => void }) {
  const picker = useImagePicker((file) => store.setSceneryPicture(index, file))
  const picture = backdrop.sceneryPicture
  const url = picture && assetUrl(store.rt.assets, picture)
  return (
    <tr>
      <th>{t('backdrop.scenery')}</th>
      <td>
        <input
          type="color"
          aria-label={t('backdrop.scenery')}
          value={backdrop.scenery}
          onChange={(e) => store.updateBackdrop(index, (b) => (b.scenery = e.target.value))}
        />
      </td>
      <td />
      <td className="face-picture">
        {picker.element}
        {picture ? (
          <>
            <span className="face-picture-thumb panorama" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
            <button className="face-picture-remove" title={t('backdrop.removePicture')} onClick={() => void store.setSceneryPicture(index, null)}>
              ×
            </button>
          </>
        ) : (
          <>
            <button onClick={onChoose}>{t('backdrop.choose')}</button>
            <button onClick={picker.pick}>{t('backdrop.uploadScenery')}</button>
          </>
        )}
      </td>
    </tr>
  )
}

/** Dressing the six faces as a room from the library. */
function RoomRow({ onChoose }: { onChoose: () => void }) {
  return (
    <tr>
      <th>{t('backdrop.room')}</th>
      <td colSpan={2} />
      <td className="face-picture">
        <button onClick={onChoose}>{t('backdrop.choose')}</button>
      </td>
    </tr>
  )
}

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
      <table className="backdrop-faces">
        <tbody>
          <SceneryRow store={store} index={index} backdrop={backdrop} onChoose={() => onChoose('scenery')} />
          <RoomRow onChoose={() => onChoose('room')} />
          {FACES.map((name) => (
            <FaceRow key={name} store={store} index={index} backdrop={backdrop} name={name} onPaint={() => onPaint(name)} />
          ))}
        </tbody>
      </table>
      <label className="field checkbox">
        <input type="checkbox" checked={backdrop.grid} onChange={(e) => update((b) => (b.grid = e.target.checked))} />
        <span>{t('backdrop.grid')}</span>
      </label>
    </div>
  )
}

type LibraryKind = 'scenery' | 'room'

export interface LibraryItem {
  key: string
  name: string
  /** null until it is ready (a model's is drawn first). */
  picture: string | null
  choose: () => void
}

/** Choosing from a library (a backdrop's scenery or room, a costume), laid out as Scratch's "Choose a Backdrop". */
export function Library({ title, items, onClose }: { title: string; items: LibraryItem[]; onClose: () => void }) {
  return (
    <div className="library">
      <div className="library-header">
        <span>{title}</span>
        <button title={t('backdrop.closeLibrary')} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="library-items">
        {items.map((item) => (
          <button
            key={item.key}
            className="library-item"
            onClick={() => {
              item.choose()
              onClose()
            }}
          >
            {item.picture ? <img src={item.picture} alt="" loading="lazy" /> : <span className="library-item-blank" />}
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

/** The stage's Backdrops tab: the list (choosing one makes it current, as in Scratch) and the chosen one's look. */
export function BackdropsTab({ store }: { store: ProjectStore }) {
  useTicker(250)
  const [menuOpen, setMenuOpen] = useState(false)
  const [library, setLibrary] = useState<LibraryKind | null>(null)
  /** The face whose picture is being painted, and the picture to start from. */
  const [painting, setPainting] = useState<{ face: FaceName; source: Blob | null } | null>(null)
  const upload = useImagePicker((file) => store.uploadBackdrop(file))
  const { list, current, backdrop } = store.rt.backdrops
  const paint = async (face: FaceName) => {
    const picture = backdrop.faces[face].picture
    setPainting({ face, source: picture && (await store.pictureBlob(picture)) })
  }
  const choose = (open: () => void) => () => {
    setMenuOpen(false)
    open()
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
        <div className="backdrop-add">
          {upload.element}
          <button className="add-sprite-button" title={t('backdrop.add')} onClick={() => setMenuOpen(!menuOpen)}>
            +
          </button>
          {menuOpen && (
            <div className="add-sprite-menu backdrop-add-menu">
              <button onClick={choose(upload.pick)}>{t('backdrop.upload')}</button>
              <button onClick={choose(() => store.addBackdrop())}>{t('backdrop.add')}</button>
            </div>
          )}
        </div>
      </div>
      <BackdropForm key={backdrop.id} store={store} index={current} backdrop={backdrop} onChoose={setLibrary} onPaint={(face) => void paint(face)} />
      {painting && (
        <PaintEditor
          title={`${backdrop.name}: ${t(`backdrop.face.${painting.face}`)}`}
          source={painting.source}
          size={pictureSize(painting.face)}
          guide={[]}
          onSave={(picture) => store.setFacePicture(current, painting.face, picture)}
          onClose={() => setPainting(null)}
        />
      )}
      {library && <BackdropLibrary store={store} index={current} kind={library} onClose={() => setLibrary(null)} />}
    </div>
  )
}
