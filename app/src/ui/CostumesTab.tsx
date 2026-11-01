/**
 * A sprite's Costumes tab, as Scratch's: the list (choosing one puts it on
 * the sprite), adding one (from the library, uploaded, painted, a 3D model,
 * or without a picture), and the chosen one's name, shape, width, depth and height, picture
 * and how the picture wraps the shape, or its model and how the model's
 * bones move (engine/costume.ts).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { assetFileName, type AssetRef, type Assets } from '../engine/assets'
import {
  COSTUME_LAYOUTS,
  costumeDimensions,
  costumeStretch,
  isClipMotion,
  MAX_KEYFRAME_INTERVAL,
  MAX_KEYFRAMES,
  MIN_KEYFRAME_INTERVAL,
  modelMotion,
  type Costume,
  type CostumeLayout,
  type KeyframeMotion,
  type ModelMotion,
  type ModelPose,
} from '../engine/costume'
import { t, type MessageKey } from '../i18n'
import { COSTUME_FILE_TYPES, Library, useImagePicker, useTicker } from './BackdropsTab'
import { AddMenu } from './AddMenu'
import { COSTUME_LIBRARY, libraryCostumeName } from './library'
import { costumeGuide, newCostumeSize } from './paint'
import { PaintEditor } from './PaintEditor'
import { costumeThumbnail, libraryThumbnail, loadModel, modelThumbnail, shapeThumbnail } from './costumeThumbnails'
import { findClip, modelBones, modelClips, type Model } from '../stage/models'
import { NumberField } from './fields'
import { SHAPE_ICONS } from './SpritePane'
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

/**
 * Calls `commit` once a slider is let go: anywhere, not only over it (a
 * pointer), or as a key is released or focus leaves it.
 */
function commitOnRelease(commit: () => void) {
  return {
    onPointerDown: () => window.addEventListener('pointerup', commit, { once: true }),
    onKeyUp: commit,
    onBlur: commit,
  }
}

/** Turning a model's bones in a pose, one at a time; `onChange` gets the pose as a slider is let go. */
function PoseEditor({ pose, bones, onChange }: { pose: ModelPose; bones: string[]; onChange: (pose: ModelPose) => void }) {
  const [chosen, setChosen] = useState(bones[0])
  const [draft, setDraft] = useState<[number, number, number] | null>(null)
  // Read when the slider is let go, which may be after this render (see commitOnRelease).
  const latest = useRef(draft)
  latest.current = draft
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
    onChange(next)
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
        <button disabled={Object.keys(pose).length === 0} onClick={() => onChange({})}>
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
            {...commitOnRelease(commit)}
          />
          <output>{Math.round(angles[k])}°</output>
        </label>
      ))}
    </>
  )
}

/**
 * The part of a motion that plays, as two handles on its timeline (its
 * keyframes, or its animation's seconds). `onMove` gets the value of the
 * handle being moved, to show the pose there, and null when let go;
 * `onChange` gets the part then.
 */
function PartSlider({ max, step, from, to, format, onMove, onChange }: {
  max: number
  step: number
  from: number
  to: number
  format: (v: number) => string
  onMove: (v: number | null) => void
  onChange: (from: number, to: number) => void
}) {
  const [draft, setDraft] = useState<[number, number] | null>(null)
  const latest = useRef(draft)
  latest.current = draft
  const [a, b] = draft ?? [from, to]
  const commit = () => {
    const part = latest.current
    latest.current = null
    setDraft(null)
    onMove(null)
    if (part) onChange(part[0], part[1])
  }
  const handle = (which: 0 | 1, value: number) => (
    <input
      type="range"
      min={0}
      max={max}
      step={step}
      value={value}
      aria-label={t(which === 0 ? 'costume.partStart' : 'costume.partEnd')}
      onChange={(e) => {
        const v = Number(e.target.value)
        // A handle stops at the other.
        const next: [number, number] = which === 0 ? [Math.min(v, b), b] : [a, Math.max(v, a)]
        setDraft(next)
        onMove(next[which])
      }}
      {...commitOnRelease(commit)}
    />
  )
  const left = max > 0 ? (a / max) * 100 : 0
  const right = max > 0 ? (b / max) * 100 : 0
  return (
    <div className="field costume-part">
      <span>{t('costume.part')}</span>
      <div className="part-slider" style={{ '--from': `${left}%`, '--to': `${right}%` } as CSSProperties}>
        {handle(0, a)}
        {handle(1, b)}
      </div>
      <output>{a === b ? format(a) : `${format(a)} – ${format(b)}`}</output>
    </div>
  )
}

/** Whether the motion plays its part over and over or once. */
function OnceField({ once, onChange }: { once: boolean; onChange: (once: boolean) => void }) {
  return (
    <label className="field costume-pose">
      <span>{t('costume.ending')}</span>
      <select value={once ? 'once' : 'repeat'} onChange={(e) => onChange(e.target.value === 'once')}>
        <option value="repeat">{t('costume.repeat')}</option>
        <option value="once">{t('costume.once')}</option>
      </select>
    </label>
  )
}

/** A costume's keyframes, one chosen to turn its bones; each can be copied after itself or deleted. */
function KeyframeList({ motion, chosen, onChoose, onChange }: {
  motion: KeyframeMotion
  chosen: number
  onChoose: (i: number) => void
  onChange: (motion: KeyframeMotion, chosen: number) => void
}) {
  const n = motion.keyframes.length
  const add = (i: number) => {
    const keyframes = [...motion.keyframes.slice(0, i + 1), structuredClone(motion.keyframes[i]), ...motion.keyframes.slice(i + 1)]
    // Keyframes after it move along; one added after the last that plays plays too.
    const from = motion.from > i ? motion.from + 1 : motion.from
    const to = motion.to >= i ? motion.to + 1 : motion.to
    onChange({ ...motion, keyframes, from, to }, i + 1)
  }
  const remove = (i: number) => {
    const keyframes = motion.keyframes.filter((_, k) => k !== i)
    const last = keyframes.length - 1
    const from = Math.min(last, motion.from > i ? motion.from - 1 : motion.from)
    const to = Math.min(last, Math.max(from, motion.to >= i ? motion.to - 1 : motion.to))
    onChange({ ...motion, keyframes, from, to }, Math.min(i, last))
  }
  return (
    <div className="keyframe-list">
      <span>{t('costume.keyframes')}</span>
      <ol>
        {motion.keyframes.map((_, i) => (
          <li key={i} className={i === chosen ? 'chosen' : undefined}>
            <button className="keyframe-choose" aria-pressed={i === chosen} onClick={() => onChoose(i)}>
              {t('costume.keyframe', { n: String(i + 1) })}
            </button>
            <button title={t('costume.addKeyframe')} disabled={n >= MAX_KEYFRAMES} onClick={() => add(i)}>
              +
            </button>
            <button title={t('costume.removeKeyframe')} disabled={n === 1} onClick={() => remove(i)}>
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

const formatSeconds = (s: number) => t('costume.seconds', { n: String(Math.round(s * 100) / 100) })

/** Seconds on an animation's timeline: to a thirtieth of a second, as the stage samples it. */
const CLIP_STEP = 1 / 30

/**
 * How a model costume's bones move, and the pose the view shows: the
 * keyframe chosen, or where a handle is being moved. Keyframes have their
 * list and turn their bones; an animation can be turned into them.
 */
function MotionEditor({ store, index, costume, model, bones }: { store: ProjectStore; index: number; costume: Costume; model: Model; bones: string[] }) {
  const motion = modelMotion(costume.model!)
  const [chosen, setChosen] = useState(0)
  const [held, setHeld] = useState<number | null>(null)
  const set = (m: ModelMotion) => store.setModelMotion(index, m)
  if (isClipMotion(motion)) {
    const clip = findClip(model, motion.clip)
    const duration = clip?.duration ?? motion.to
    const at = held ?? motion.from
    return (
      <>
        <ModelView store={store} costume={costume} motion={{ ...motion, from: at, to: at }} />
        <div className="costume-model-pose">
          <div className="field costume-pose">
            <span>{t('costume.move')}</span>
            <strong>{clipLabel(motion.clip)}</strong>
            <button onClick={() => void store.convertToKeyframes(index)} disabled={!clip}>
              {t('costume.toKeyframes')}
            </button>
          </div>
          <PartSlider
            max={Math.round(duration * 1000) / 1000}
            step={CLIP_STEP}
            from={motion.from}
            to={motion.to}
            format={formatSeconds}
            onMove={setHeld}
            onChange={(from, to) => set({ ...motion, from, to })}
          />
          <OnceField once={motion.once === true} onChange={(once) => set({ ...motion, once })} />
          <p className="costume-note">{t('costume.toKeyframesNote')}</p>
          <MoveCostume store={store} index={index} model={model} />
          <p className="costume-note">{t('costume.modelNote')}</p>
        </div>
      </>
    )
  }
  const last = motion.keyframes.length - 1
  const keyframe = Math.min(chosen, last)
  const at = held ?? keyframe
  return (
    <>
      <ModelView store={store} costume={costume} motion={{ ...motion, from: at, to: at }} />
      <div className="costume-model-pose">
        {last > 0 && (
          <>
            <PartSlider
              max={last}
              step={1}
              from={motion.from}
              to={motion.to}
              format={(v) => String(v + 1)}
              onMove={setHeld}
              onChange={(from, to) => set({ ...motion, from, to })}
            />
            <div className="field costume-pose">
              <OnceField once={motion.once === true} onChange={(once) => set({ ...motion, once })} />
              <NumberField
                label={t('costume.interval')}
                value={motion.interval}
                onChange={(v) => set({ ...motion, interval: Math.min(MAX_KEYFRAME_INTERVAL, Math.max(MIN_KEYFRAME_INTERVAL, v)) })}
              />
            </div>
          </>
        )}
        <KeyframeList
          motion={motion}
          chosen={keyframe}
          onChoose={setChosen}
          onChange={(m, i) => {
            set(m)
            setChosen(i)
          }}
        />
        <PoseEditor
          key={`${index}:${keyframe}`}
          pose={motion.keyframes[keyframe]}
          bones={bones}
          onChange={(pose) => set({ ...motion, keyframes: motion.keyframes.map((p, i) => (i === keyframe ? pose : p)) })}
        />
        <p className="costume-note">{t('costume.poseNote')}</p>
        <MoveCostume store={store} index={index} model={model} />
        <p className="costume-note">{t('costume.modelNote')}</p>
      </div>
    </>
  )
}

/** Adding a costume of the model playing one of its animations. */
function MoveCostume({ store, index, model }: { store: ProjectStore; index: number; model: Model }) {
  const clips = modelClips(model).map((c) => c.name)
  // Walking first, if the model can.
  const [chosen, setChosen] = useState(clips.includes('walk') ? 'walk' : clips[0])
  if (clips.length === 0) return null
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
      <button onClick={() => void store.addClipCostume(index, clip)}>{t('costume.addMove')}</button>
    </div>
  )
}

/** The model drawn large, in a pose of its motion; the last picture stays while the next is drawn. */
function ModelView({ store, costume, motion }: { store: ProjectStore; costume: Costume; motion: ModelMotion }) {
  const url = modelThumbnail(store.rt.assets, costume.model!.asset, motion, costumeStretch(costume), 2)
  const shown = useRef<string | null>(null)
  if (url) shown.current = url
  return <span className="costume-model-view" style={shown.current ? { backgroundImage: `url("${shown.current}")` } : undefined} />
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

/**
 * A model costume: its name, width, depth and height and the model (which
 * can be taken off to leave the shape) above; the model drawn large, and
 * how its bones move if it has them, below.
 */
function ModelCostume({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const model = useModel(store.rt.assets, costume.model!.asset)
  const bones = model ? modelBones(model) : []
  return (
    <div className="costume-main">
      <div className="costume-header">
        <div className="costume-header-row">
          <NameField store={store} index={index} costume={costume} />
          <div className="field costume-picture">
            <span>{t('costume.model')}</span>
            <button className="face-picture-remove" title={t('costume.removeModel')} onClick={() => store.removeModel(index)}>
              ×
            </button>
          </div>
        </div>
        <div className="costume-header-row">
          <DimensionFields store={store} index={index} costume={costume} />
        </div>
      </div>
      <div className="costume-model">
        {model && bones.length > 0 ? (
          <MotionEditor key={index} store={store} index={index} costume={costume} model={model} bones={bones} />
        ) : (
          <>
            <ModelView store={store} costume={costume} motion={modelMotion(costume.model!)} />
            <div className="costume-model-pose">
              <p className="costume-note">{t('costume.modelNote')}</p>
            </div>
          </>
        )}
      </div>
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

/**
 * The picture being painted, as part of the tab: each change becomes the
 * costume's picture. It starts again from the costume's picture only when
 * that changes otherwise, or, while there is none,
 * when the size a new one would have changes.
 */
function CostumePaint({ store, index, costume, showGuide }: { store: ProjectStore; index: number; costume: Costume; showGuide: boolean }) {
  const id = costume.picture && assetFileName(costume.picture)
  // The sprite painted, kept for a change handed back after another is chosen.
  const [sprite] = useState(store.editing)
  const size = newCostumeSize(costume.shape, costume.layout)
  const sizeKey = size.join('x')
  /** The picture this editor last made, and how many it is saving. */
  const own = useRef<{ id: string | null; saving: number }>({ id, saving: 0 })
  const [start, setStart] = useState<{ id: string | null; source: Blob | null; size: [number, number] } | null>(null)
  useEffect(() => {
    if (own.current.saving > 0) return
    if (start && id === own.current.id && (id !== null || sizeKey === start.size.join('x'))) return
    let cancelled = false
    void (async () => {
      const source = costume.picture && (await store.pictureBlob(costume.picture))
      if (cancelled) return
      own.current.id = id
      setStart({ id, source, size })
    })()
    return () => {
      cancelled = true
    }
  }, [id, sizeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!start) return <div className="paint-editor" />
  return (
    <PaintEditor
      key={`${start.id}:${start.size.join('x')}`}
      source={start.source}
      size={start.size}
      guide={costumeGuide(costume.shape, costume.layout)}
      showGuide={showGuide}
      onChange={(picture) => {
        own.current.saving++
        void store
          .paintCostume(sprite, index, picture)
          .then((made) => (own.current.id = assetFileName(made)))
          .finally(() => own.current.saving--)
      }}
    />
  )
}

/**
 * A costume that is a shape: its settings above (name, shape, color, width,
 * depth and height, and how a picture wraps it), and the picture editor
 * below, as in Scratch (a picture is uploaded as a new costume).
 */
function ShapeCostume({ store, index, costume }: { store: ProjectStore; index: number; costume: Costume }) {
  const { shape } = costume
  const guide = costumeGuide(shape, costume.layout)
  const [showGuide, setShowGuide] = useState(true)
  return (
    <div className="costume-main">
      <div className="costume-header">
        <div className="costume-header-row">
          <NameField store={store} index={index} costume={costume} />
          <DimensionFields store={store} index={index} costume={costume} />
        </div>
        {/* A sphere wraps one way only, and some layouts have no guide: their places stay, so nothing moves. */}
        <div className="costume-header-row">
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
          <div className={`field${shape === 'sphere' ? ' unused' : ''}`} role="radiogroup" aria-label={t('costume.layout')} aria-hidden={shape === 'sphere'}>
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
                </button>
              )
            })}
          </div>
          <label className={`field checkbox${guide.length === 0 ? ' unused' : ''}`}>
            <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
            <span>{t('paint.guide')}</span>
          </label>
        </div>
      </div>
      <CostumePaint store={store} index={index} costume={costume} showGuide={showGuide} />
    </div>
  )
}

function CostumeView(props: { store: ProjectStore; index: number; costume: Costume }) {
  return props.costume.model ? <ModelCostume {...props} /> : <ShapeCostume {...props} />
}

export function CostumesTab({ store }: { store: ProjectStore }) {
  useTicker(250)
  const [library, setLibrary] = useState(false)
  const upload = useImagePicker((file) => store.uploadCostume(file), COSTUME_FILE_TYPES)
  const sprite = store.editing
  const current = sprite.costume
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
            { icon: 'paint', label: t('costume.paintNew'), onChoose: () => store.addCostume() },
            { icon: 'upload', label: t('costume.upload'), onChoose: upload.pick },
          ]}
        >
          {upload.element}
        </AddMenu>
      </div>
      <CostumeView key={`${sprite.id}:${current}`} store={store} index={current} costume={sprite.costumes[current]} />
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
