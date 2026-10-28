/**
 * A sprite's Costumes tab, as Scratch's: the list (choosing one puts it on
 * the sprite), adding one (from the library, uploaded, painted, a 3D model,
 * or without a picture), and the chosen one's name, shape, width, depth and height, picture
 * and how the picture wraps the shape, or its model and the model's pose
 * (engine/costume.ts).
 */
import { useEffect, useRef, useState } from 'react'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import { COSTUME_LAYOUTS, costumeDimensions, type Costume, type CostumeLayout } from '../engine/costume'
import type { ShapeKind } from '../engine/types'
import { t, type MessageKey } from '../i18n'
import { assetUrl } from './assetUrls'
import { COSTUME_FILE_TYPES, Library, useImagePicker, useTicker } from './BackdropsTab'
import { AddMenu } from './AddMenu'
import { COSTUME_LIBRARY, libraryCostumeName } from './library'
import { costumeGuide, newCostumeSize } from './paint'
import { PaintEditor } from './PaintEditor'
import { costumeThumbnail, libraryThumbnail, loadModel, shapeThumbnail } from './costumeThumbnails'
import { modelBones, modelClips, type Model } from '../stage/models'
import { NumberField, SHAPE_ICONS } from './SpritePane'
import { SHAPES, shapeName, type ProjectStore } from './store'
import { boneLabel, clipLabel } from './modelNames'

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

/** A costume's model once it has been read; null until then, or if it can't be. */
function useModel(assets: Assets, ref: AssetRef): Model | null {
  const key = assetFileName(ref)
  const [read, setRead] = useState<{ key: string; model: Model | null } | null>(null)
  useEffect(() => {
    let live = true
    void loadModel(assets, ref).then((model) => live && setRead({ key, model }))
    return () => {
      live = false
    }
  }, [assets, key])
  return read?.key === key ? read.model : null
}

/** The sliders' labels: turning about the sprite's x (front), y (left) and z (up), as a pose has them. */
const TURNS: MessageKey[] = ['costume.turnSideways', 'costume.turnForward', 'costume.turnAround']

/** Turning a model's bones, one at a time; the costume changes as a slider is let go. */
function PoseEditor({ store, index, costume, bones }: { store: ProjectStore; index: number; costume: Costume; bones: string[] }) {
  const [chosen, setChosen] = useState(bones[0])
  const [draft, setDraft] = useState<[number, number, number] | null>(null)
  // Read when the slider is let go, which may be after this render (see onPointerDown).
  const latest = useRef(draft)
  latest.current = draft
  const pose = costume.model?.pose ?? {}
  const bone = bones.includes(chosen) ? chosen : bones[0]
  const angles = draft ?? pose[bone] ?? [0, 0, 0]
  const commit = () => {
    const turn = latest.current
    if (!turn) return
    const next = { ...pose }
    if (turn.every((a) => a === 0)) delete next[bone]
    else next[bone] = turn
    latest.current = null
    setDraft(null)
    store.setModelPose(index, next)
  }
  return (
    <>
      <div className="field costume-pose">
        <span>{t('costume.bone')}</span>
        <select value={bone} onChange={(e) => setChosen(e.target.value)}>
          {bones.map((b) => (
            <option key={b} value={b}>
              {boneLabel(b)}
            </option>
          ))}
        </select>
        <button disabled={Object.keys(pose).length === 0} onClick={() => store.setModelPose(index, {})}>
          {t('costume.resetPose')}
        </button>
      </div>
      {TURNS.map((label, k) => (
        <label key={label} className="field costume-turn">
          <span>{t(label)}</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={angles[k]}
            onChange={(e) => {
              const next = [...angles] as [number, number, number]
              next[k] = Number(e.target.value)
              setDraft(next)
            }}
            // Let go anywhere, not only over the slider.
            onPointerDown={() => window.addEventListener('pointerup', commit, { once: true })}
            onKeyUp={commit}
            onBlur={commit}
          />
          <output>{Math.round(angles[k])}°</output>
        </label>
      ))}
    </>
  )
}

const MIN_FRAMES = 2
const MAX_FRAMES = 16

/** Making costumes from moments of one of the model's animations. */
function ClipCostumes({ store, index, clips }: { store: ProjectStore; index: number; clips: string[] }) {
  // Walking first, if the model can.
  const [chosen, setChosen] = useState(clips.includes('walk') ? 'walk' : clips[0])
  const [frames, setFrames] = useState(8)
  const clip = clips.includes(chosen) ? chosen : clips[0]
  return (
    <div className="field costume-pose">
      <span>{t('costume.fromClip')}</span>
      <select value={clip} onChange={(e) => setChosen(e.target.value)}>
        {clips.map((c) => (
          <option key={c} value={c}>
            {clipLabel(c)}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={MIN_FRAMES}
        max={MAX_FRAMES}
        value={frames}
        onChange={(e) => setFrames(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(Number(e.target.value)) || MIN_FRAMES)))}
      />
      <span>{t('costume.frames')}</span>
      <button onClick={() => void store.addClipCostumes(index, clip, frames)}>{t('costume.makeFrames')}</button>
    </div>
  )
}

/** A costume's width, depth and height, in stage units (a cube's are 40). */
function DimensionFields({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const dimensions = costumeDimensions(costume)
  const labels: MessageKey[] = ['costume.width', 'costume.depth', 'costume.height']
  return (
    <div className="field costume-dimensions">
      {labels.map((label, axis) => (
        <NumberField key={label} label={t(label)} value={dimensions[axis]} onChange={(v) => store.setCostumeDimension(index, axis as 0 | 1 | 2, v)} />
      ))}
    </div>
  )
}

/** A model costume's form: the model, which can be taken off to leave the shape, and its pose if it has bones. */
function ModelForm({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const url = costumeThumbnail(store.rt.assets, costume, store.editing.color)
  const model = useModel(store.rt.assets, costume.model!.asset)
  const bones = model ? modelBones(model) : []
  const clips = model ? modelClips(model).map((c) => c.name) : []
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
      <DimensionFields store={store} index={index} costume={costume} />
      <p className="costume-note">{t('costume.modelNote')}</p>
      {bones.length > 0 && (
        <>
          <PoseEditor key={index} store={store} index={index} costume={costume} bones={bones} />
          {clips.length > 0 && <ClipCostumes store={store} index={index} clips={clips} />}
          <p className="costume-note">{t('costume.poseNote')}</p>
        </>
      )}
    </div>
  )
}

/** The sprite's color, which shows where a costume's shape has no picture (one for all its costumes). */
function ColorField({ store }: { store: ProjectStore }) {
  return (
    <label className="field">
      <span>{t('sprite.color')}</span>
      <input
        type="color"
        value={store.editing.color}
        onChange={(e) => {
          store.editing.color = e.target.value
          store.notify()
        }}
      />
    </label>
  )
}

/** A picture of how a picture wraps a shape: the same picture on every face, or a net (a cross of six faces). */
function LayoutIcon({ layout }: { layout: CostumeLayout }) {
  const square = (x: number, y: number, mark: boolean) => (
    <g key={`${x},${y}`}>
      <rect x={x} y={y} width={10} height={10} />
      {mark && <circle cx={x + 5} cy={y + 5} r={2.5} />}
    </g>
  )
  const squares =
    layout === 'same'
      ? [square(3, 11, true), square(15, 11, true), square(27, 11, true)]
      : [square(15, 1, false), square(3, 11, false), square(15, 11, true), square(27, 11, false), square(39, 11, false), square(15, 21, false)]
  return (
    <svg className="layout-icon" width={52} height={32} viewBox="0 0 52 32" aria-hidden>
      {squares}
    </svg>
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
      <div className="field" role="radiogroup" aria-label={t('costume.shape')}>
        <span>{t('costume.shape')}</span>
        {SHAPES.map((s) => {
          const thumb = shapeThumbnail(store.rt.assets, s, null, 'same', store.editing.color)
          return (
            <button
              key={s}
              className={`choice-button${shape === s ? ' chosen' : ''}`}
              role="radio"
              aria-checked={shape === s}
              title={shapeName(s)}
              onClick={() => store.updateCostume(index, { shape: s })}
            >
              {thumb ? <img src={thumb} alt="" /> : <span className="choice-glyph">{SHAPE_ICONS[s]}</span>}
            </button>
          )
        })}
      </div>
      <ColorField store={store} />
      <DimensionFields store={store} index={index} costume={costume} />
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
        <div className="field" role="radiogroup" aria-label={t('costume.layout')}>
          <span>{t('costume.layout')}</span>
          {COSTUME_LAYOUTS.map((layout) => {
            const label = t(layout === 'same' ? 'costume.layoutSame' : 'costume.layoutNet')
            return (
              <button
                key={layout}
                className={`choice-button layout${costume.layout === layout ? ' chosen' : ''}`}
                role="radio"
                aria-checked={costume.layout === layout}
                title={label}
                onClick={() => store.updateCostume(index, { layout })}
              >
                <LayoutIcon layout={layout} />
                <span>{label}</span>
              </button>
            )
          })}
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
  const [library, setLibrary] = useState(false)
  /** The costume whose picture is being painted (null for a new one), and the picture to start from. */
  const [painting, setPainting] = useState<{ index: number | null; source: Blob | null } | null>(null)
  const upload = useImagePicker((file) => store.uploadCostume(file), COSTUME_FILE_TYPES)
  const sprite = store.editing
  const current = sprite.costume
  const paint = async (index: number | null) => {
    const picture = index === null ? null : sprite.costumes[index].picture
    setPainting({ index, source: picture && (await store.pictureBlob(picture)) })
  }
  // A new costume is painted for the shape worn, with its whole picture on every side.
  const painted = painting && (painting.index === null ? { ...sprite.costumes[current], layout: 'same' as const } : sprite.costumes[painting.index])
  return (
    <div className="backdrops-tab costumes-tab">
      <div className="backdrop-column">
        <div className="backdrop-list">
          {sprite.costumes.map((c, i) => {
            const url = costumeThumbnail(store.rt.assets, c, sprite.color)
            return (
              <div key={i} className={`backdrop-tile${i === current ? ' selected' : ''}`} onClick={() => store.selectCostume(i)}>
                <span className="backdrop-number">{i + 1}</span>
                <span className="backdrop-thumb costume-thumb" style={url ? { backgroundImage: `url("${url}")` } : { color: sprite.color }}>
                  {!url && !c.model && SHAPE_ICONS[c.shape]}
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
        <AddMenu
          className="backdrop-add"
          title={t('costume.add')}
          options={[
            { icon: 'choose', label: t('costume.choose'), onChoose: () => setLibrary(true) },
            { icon: 'paint', label: t('costume.paintNew'), onChoose: () => void paint(null) },
            { icon: 'upload', label: t('costume.upload'), onChoose: upload.pick },
            { icon: 'new', label: t('costume.add'), onChoose: () => store.addCostume() },
          ]}
        >
          {upload.element}
        </AddMenu>
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
            picture: libraryThumbnail(store.rt.assets, entry),
            choose: () => store.addLibraryCostume(entry),
          }))}
          onClose={() => setLibrary(false)}
        />
      )}
    </div>
  )
}
