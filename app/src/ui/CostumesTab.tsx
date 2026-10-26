/**
 * A sprite's Costumes tab, as Scratch's: the list (choosing one puts it on
 * the sprite), adding one (from the library, uploaded, painted, a 3D model,
 * or without a picture), and the chosen one's name, shape, picture and how
 * the picture wraps the shape, or its model (engine/costume.ts).
 */
import { useRef, useState } from 'react'
import type { Assets } from '../engine/assets'
import { COSTUME_LAYOUTS, type Costume } from '../engine/costume'
import type { ShapeKind } from '../engine/types'
import { t, type MessageKey } from '../i18n'
import { assetUrl } from './assetUrls'
import { Library, useImagePicker, useTicker } from './BackdropsTab'
import { COSTUME_LIBRARY, libraryAssetUrl, libraryCostumeName } from './library'
import { costumeGuide, newCostumeSize } from './paint'
import { PaintEditor } from './PaintEditor'
import { showAlert } from './dialogs'
import { modelThumbnail } from './modelThumbnails'
import { SHAPE_ICONS } from './SpritePane'
import { ModelError, SHAPES, shapeName, type ProjectStore } from './store'

/** A costume's picture for the page: its model drawn, or its picture; null if it has neither (or it isn't ready). */
export function costumeThumbnail(assets: Assets, c: Costume): string | null {
  if (c.model) return modelThumbnail(assets, c.model.asset)
  return c.picture && assetUrl(assets, c.picture)
}

/** Applied on Enter or leaving the field, so blocks that refer to the costume follow once. */
function NameField({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) store.renameCostume(index, draft)
    setDraft(null)
  }
  return (
    <label className="field name">
      <span>{t('costume.name')}</span>
      <input
        value={draft ?? costume.name}
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

/** Where each part of a shape goes on its net (the grid of 4 × 3 in engine/costume.ts), row by row; null for an empty square. */
const NETS: Record<Exclude<ShapeKind, 'sphere'>, ([MessageKey, number] | null)[][]> = {
  cube: [
    [null, ['costume.part.top', 1], null, null],
    [['costume.part.right', 1], ['costume.part.front', 1], ['costume.part.left', 1], ['costume.part.back', 1]],
    [null, ['costume.part.bottom', 1], null, null],
  ],
  cylinder: [
    [null, ['costume.part.top', 2], null],
    [['costume.part.side', 4]],
    [null, ['costume.part.bottom', 2], null],
  ],
  cone: [
    [['costume.part.side', 4]],
    [null, ['costume.part.base', 2], null],
  ],
}

/** A picture of the net's grid with the parts named, so a picture can be drawn to fit. */
function NetGuide({ shape }: { shape: Exclude<ShapeKind, 'sphere'> }) {
  return (
    <div className={`costume-net ${shape}`} aria-hidden>
      {NETS[shape].map((row, r) => (
        <div key={r} className="costume-net-row">
          {row.map((part, k) =>
            part ? (
              <span key={k} className="costume-net-part" style={{ flexGrow: part[1] }}>
                {t(part[0])}
              </span>
            ) : (
              <span key={k} className="costume-net-empty" style={{ flexGrow: 1 }} />
            ),
          )}
        </div>
      ))}
    </div>
  )
}

/** A model costume's form: the model, which can be taken off to leave the shape. */
function ModelForm({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const url = costumeThumbnail(store.rt.assets, costume)
  return (
    <div className="backdrop-form costume-form">
      <NameField store={store} index={index} costume={costume} />
      <div className="field costume-picture">
        <span>{t('costume.model')}</span>
        <span className="face-picture-thumb costume-model-thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
        <button className="face-picture-remove" title={t('costume.removeModel')} onClick={() => store.removeModel(index)}>
          ×
        </button>
      </div>
      <p className="costume-note">{t('costume.modelNote')}</p>
    </div>
  )
}

function CostumeForm({ store, index, costume, onPaint }: { store: ProjectStore; index: number; costume: Costume; onPaint: () => void }) {
  const picker = useImagePicker((file) => store.setCostumePicture(index, file))
  const url = costume.picture && assetUrl(store.rt.assets, costume.picture)
  const { shape } = costume
  if (costume.model) return <ModelForm store={store} index={index} costume={costume} />
  return (
    <div className="backdrop-form costume-form">
      <NameField store={store} index={index} costume={costume} />
      <label className="field">
        <span>{t('costume.shape')}</span>
        <select value={shape} onChange={(e) => store.updateCostume(index, { shape: e.target.value as ShapeKind })}>
          {SHAPES.map((s) => (
            <option key={s} value={s}>
              {shapeName(s)}
            </option>
          ))}
        </select>
      </label>
      <div className="field costume-picture">
        <span>{t('costume.picture')}</span>
        {picker.element}
        {costume.picture ? (
          <>
            <span className="face-picture-thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
            <button className="face-picture-remove" title={t('costume.removePicture')} onClick={() => void store.setCostumePicture(index, null)}>
              ×
            </button>
          </>
        ) : null}
        <button onClick={picker.pick}>{t('costume.uploadPicture')}</button>
        <button onClick={onPaint}>{t('costume.paint')}</button>
      </div>
      {shape === 'sphere' ? (
        <p className="costume-note">{t('costume.sphereNote')}</p>
      ) : (
        <div className="field costume-layout" role="radiogroup" aria-label={t('costume.layout')}>
          <span>{t('costume.layout')}</span>
          {COSTUME_LAYOUTS.map((layout) => (
            <label key={layout} className="field checkbox">
              <input type="radio" name="costume-layout" checked={costume.layout === layout} onChange={() => store.updateCostume(index, { layout })} />
              <span>{t(layout === 'same' ? 'costume.layoutSame' : 'costume.layoutNet')}</span>
            </label>
          ))}
        </div>
      )}
      {shape !== 'sphere' && costume.layout === 'net' && (
        <>
          <p className="costume-note">{t('costume.netNote')}</p>
          <NetGuide shape={shape} />
        </>
      )}
    </div>
  )
}

export function CostumesTab({ store }: { store: ProjectStore }) {
  useTicker(250)
  const [menuOpen, setMenuOpen] = useState(false)
  const [library, setLibrary] = useState(false)
  /** The costume whose picture is being painted (null for a new one), and the picture to start from. */
  const [painting, setPainting] = useState<{ index: number | null; source: Blob | null } | null>(null)
  const upload = useImagePicker((file) => store.uploadCostume(file))
  const modelInput = useRef<HTMLInputElement>(null)
  const sprite = store.editing
  const current = sprite.costume
  const paint = async (index: number | null) => {
    const picture = index === null ? null : sprite.costumes[index].picture
    setPainting({ index, source: picture && (await store.pictureBlob(picture)) })
  }
  // A new costume is painted for the shape worn, with its whole picture on every side.
  const painted = painting && (painting.index === null ? { ...sprite.costumes[current], layout: 'same' as const } : sprite.costumes[painting.index])
  const choose = (open: () => void) => () => {
    setMenuOpen(false)
    open()
  }
  return (
    <div className="backdrops-tab costumes-tab">
      <div className="backdrop-column">
        <div className="backdrop-list">
          {sprite.costumes.map((c, i) => {
            const url = costumeThumbnail(store.rt.assets, c)
            return (
              <div key={i} className={`backdrop-tile${i === current ? ' selected' : ''}`} onClick={() => store.selectCostume(i)}>
                <span className="backdrop-number">{i + 1}</span>
                <span className="backdrop-thumb costume-thumb" style={url ? { backgroundImage: `url("${url}")` } : { color: sprite.color }}>
                  {!c.picture && !c.model && SHAPE_ICONS[c.shape]}
                </span>
                <span className="backdrop-name">{c.name}</span>
                {i === current && sprite.costumes.length > 1 && (
                  <button
                    className="sprite-delete"
                    title={t('costume.delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      store.removeCostume(i)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="backdrop-add">
          {upload.element}
          <input
            ref={modelInput}
            type="file"
            accept=".glb,model/gltf-binary"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              store.uploadModel(file).catch((err: unknown) => {
                const reason = err instanceof ModelError ? err.reason : 'unreadable'
                void showAlert(t(`costume.modelError.${reason}`, { name: file.name }))
              })
            }}
          />
          <button className="add-sprite-button" title={t('costume.add')} onClick={() => setMenuOpen(!menuOpen)}>
            +
          </button>
          {menuOpen && (
            <div className="add-sprite-menu backdrop-add-menu">
              <button onClick={choose(() => setLibrary(true))}>{t('costume.choose')}</button>
              <button onClick={choose(upload.pick)}>{t('costume.upload')}</button>
              <button onClick={choose(() => modelInput.current?.click())}>{t('costume.uploadModel')}</button>
              <button onClick={choose(() => void paint(null))}>{t('costume.paintNew')}</button>
              <button onClick={choose(() => store.addCostume())}>{t('costume.add')}</button>
            </div>
          )}
        </div>
      </div>
      <CostumeForm key={`${sprite.id}:${current}`} store={store} index={current} costume={sprite.costumes[current]} onPaint={() => void paint(current)} />
      {painting && painted && (
        <PaintEditor
          title={painting.index === null ? t('costume.paintNew') : painted.name}
          source={painting.source}
          size={newCostumeSize(painted.shape, painted.layout)}
          guide={costumeGuide(painted.shape, painted.layout)}
          onSave={(picture) => store.paintCostume(painting.index, picture)}
          onClose={() => setPainting(null)}
        />
      )}
      {library && (
        <Library
          title={t('costume.choose')}
          items={COSTUME_LIBRARY.map((entry) => ({
            key: entry.key,
            name: libraryCostumeName(entry),
            picture: entry.model ? modelThumbnail(store.rt.assets, entry.model.asset) : libraryAssetUrl(entry.picture!),
            choose: () => store.addLibraryCostume(entry),
          }))}
          onClose={() => setLibrary(false)}
        />
      )}
    </div>
  )
}
