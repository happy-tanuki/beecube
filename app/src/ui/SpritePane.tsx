import { useEffect, useState } from 'react'
import type { Sprite } from '../engine/sprite'
import type { ShapeKind } from '../engine/types'
import { t } from '../i18n'
import { AddMenu } from './AddMenu'
import { Dial } from './Dial'
import { NumberField, PopupField } from './fields'
import { COSTUME_FILE_TYPES, Library, useImagePicker, type LibraryItem } from './BackdropsTab'
import { COSTUME_CATEGORIES, COSTUME_LIBRARY, libraryCostumeName, SPRITE_CATEGORIES } from './library'
import { costumeThumbnail, libraryThumbnail, shapeThumbnail } from './costumeThumbnails'
import { SHAPES, shapeName, type ProjectStore } from './store'

interface Props {
  store: ProjectStore
  editingId: string
}

export const SHAPE_ICONS: Record<ShapeKind, string> = {
  cube: '■',
  sphere: '●',
  cone: '▲',
  cylinder: '▮',
}

/** The costume worn: its picture or model, or its shape in the sprite's color. */
function SpriteThumb({ store, sprite }: { store: ProjectStore; sprite: Sprite }) {
  const costume = sprite.costumes[sprite.costume]
  const url = costume && costumeThumbnail(store.rt.assets, costume, sprite.color)
  if (url) return <div className="sprite-thumb picture" style={{ backgroundImage: `url("${url}")` }} />
  return (
    <div className="sprite-thumb" style={{ color: sprite.color }}>
      {SHAPE_ICONS[sprite.shape]}
    </div>
  )
}

/** Re-renders periodically so values changed by running scripts show up. */
function useTicker(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Applied on Enter or leaving the field, as in Scratch, so blocks that refer to the sprite follow once. */
function NameField({ store, sprite }: { store: ProjectStore; sprite: Sprite }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) store.renameSprite(sprite.id, draft)
    setDraft(null)
  }
  return (
    <label className="field name">
      <span>{t('sprite.name')}</span>
      <input
        value={draft ?? sprite.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            // Blurring after the reset leaves nothing to apply.
            setTimeout(() => (e.target as HTMLInputElement).blur())
          }
        }}
      />
    </label>
  )
}

type SetSprite = (patch: Partial<Pick<Sprite, 'direction' | 'pitch' | 'roll' | 'size' | 'width' | 'depth' | 'height'>>) => void

/**
 * The direction; while it is being edited, a popup shows dials for it (seen
 * from above), the pitch (seen from the side) and the roll (seen from
 * behind), the last two with their numbers.
 */
function DirectionField({ sprite, set }: { sprite: Sprite; set: SetSprite }) {
  return (
    <PopupField
      className="direction-field"
      field={<NumberField label={t('sprite.direction')} value={sprite.direction} onChange={(direction) => set({ direction })} />}
    >
      <div className="dial-column">
        <span>{t('sprite.direction')}</span>
        <Dial view="above" label={t('sprite.direction')} angle={sprite.direction} onChange={(direction) => set({ direction })} />
      </div>
      <div className="dial-column">
        <span>{t('sprite.pitch')}</span>
        <Dial view="side" label={t('sprite.pitch')} angle={sprite.pitch} onChange={(pitch) => set({ pitch })} />
        <NumberField label="" value={sprite.pitch} onChange={(pitch) => set({ pitch })} />
      </div>
      <div className="dial-column">
        <span>{t('sprite.roll')}</span>
        <Dial view="behind" label={t('sprite.roll')} angle={sprite.roll} onChange={(roll) => set({ roll })} />
        <NumberField label="" value={sprite.roll} onChange={(roll) => set({ roll })} />
      </div>
    </PopupField>
  )
}

/** What the size popup's sliders reach, in percent; the fields take more. */
const SLIDER_MIN = 5
const SLIDER_MAX = 500

/** A labeled slider, with the number beside it when `number` is given. */
function SliderRow({ label, value, onChange, number }: { label: string; value: number; onChange: (v: number) => void; number?: boolean }) {
  return (
    <div className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {number ? <NumberField label="" value={value} onChange={onChange} /> : <span />}
    </div>
  )
}

/**
 * The size; while it is being edited, a popup shows sliders for it and for
 * the sprite's width, depth and height, in percent of the size (as the
 * "set width to" blocks have them), so the size scales all three, keeping
 * their proportions, as "set size to" does.
 */
function SizeField({ sprite, set }: { sprite: Sprite; set: SetSprite }) {
  const axes = [
    ['width', 'sprite.width'],
    ['depth', 'sprite.depth'],
    ['height', 'sprite.height'],
  ] as const
  return (
    <PopupField className="size-field" field={<NumberField label={t('sprite.size')} value={sprite.size} onChange={(size) => set({ size })} />}>
      <SliderRow label={t('sprite.size')} value={sprite.size} onChange={(size) => set({ size })} />
      {axes.map(([axis, label]) => (
        <SliderRow
          key={axis}
          label={t(label)}
          value={sprite[axis]}
          onChange={(v) => set({ [axis]: v })}
          number
        />
      ))}
    </PopupField>
  )
}

function SpriteInfo({ store, sprite }: { store: ProjectStore; sprite: Sprite }) {
  useTicker(100)
  const set = (patch: Partial<Pick<Sprite, 'x' | 'y' | 'z' | 'direction' | 'pitch' | 'roll' | 'size' | 'width' | 'depth' | 'height' | 'visible'>>) => {
    Object.assign(sprite, patch)
    store.notify()
  }
  return (
    <div className="sprite-info">
      <div className="sprite-info-row">
        <NameField key={sprite.id} store={store} sprite={sprite} />
        <label className="field checkbox">
          <span>{t('sprite.show')}</span>
          <input type="checkbox" checked={sprite.visible} onChange={(e) => set({ visible: e.target.checked })} />
        </label>
      </div>
      {/* Labels above the fields; the position (x, y and z, together), direction and size spread across the row. */}
      <div className="sprite-info-row stacked">
        <div className="position-fields">
          <NumberField label="x" value={sprite.x} onChange={(x) => set({ x })} />
          <NumberField label="y" value={sprite.y} onChange={(y) => set({ y })} />
          <NumberField label="z" value={sprite.z} onChange={(z) => set({ z })} />
        </div>
        <DirectionField sprite={sprite} set={set} />
        <SizeField sprite={sprite} set={set} />
      </div>
    </div>
  )
}

/** The color plain shapes are shown in, in the sprite library. */
const PLAIN_COLOR = '#4c97ff'

/** Choosing a new sprite: one of the costume library's (characters first), or a plain shape. */
function SpriteLibrary({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const order = (key: string) => SPRITE_CATEGORIES.indexOf(COSTUME_CATEGORIES[key] ?? 'things')
  const items: LibraryItem[] = [
    ...[...COSTUME_LIBRARY]
      .sort((a, b) => order(a.key) - order(b.key))
      .map((entry) => ({
        key: entry.key,
        name: libraryCostumeName(entry),
        picture: libraryThumbnail(store.rt.assets, entry),
        category: COSTUME_CATEGORIES[entry.key] ?? 'things',
        choose: () => void store.addLibrarySprite(entry),
      })),
    ...SHAPES.map((shape) => ({
      key: `shape:${shape}`,
      name: shapeName(shape),
      picture: shapeThumbnail(store.rt.assets, shape, null, 'same', PLAIN_COLOR),
      icon: SHAPE_ICONS[shape],
      category: 'shapes',
      choose: () => store.addSprite(shape),
    })),
  ]
  const categories = SPRITE_CATEGORIES.map((key) => ({ key, label: t(`spriteCategory.${key}`) }))
  return <Library title={t('sprite.choose')} items={items} categories={categories} onClose={onClose} />
}

export function SpritePane({ store, editingId }: Props) {
  // Thumbnails show the costume worn, which scripts change, and pictures that arrive later.
  useTicker(250)
  const [library, setLibrary] = useState(false)
  const upload = useImagePicker((file) => store.uploadSprite(file), COSTUME_FILE_TYPES)
  const editing = store.rt.getSprite(editingId)
  return (
    <div className="sprite-pane" data-popup-bounds>
      {editing && <SpriteInfo store={store} sprite={editing} />}
      <div className="sprite-list">
        {store.rt.sprites.map((s) => (
          <div
            key={s.id}
            className={`sprite-tile${s.id === editingId ? ' selected' : ''}`}
            onClick={() => store.select(s.id)}
          >
            <SpriteThumb store={store} sprite={s} />
            <div className="sprite-name">{s.name}</div>
            {s.id === editingId && store.rt.sprites.length > 1 && (
              <button
                className="sprite-delete"
                title={t('sprite.delete')}
                onClick={(e) => {
                  e.stopPropagation()
                  store.removeSprite(s.id)
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <AddMenu
        className="add-sprite"
        title={t('sprite.add')}
        options={[
          { icon: 'choose', label: t('sprite.choose'), onChoose: () => setLibrary(true) },
          { icon: 'upload', label: t('sprite.upload'), onChoose: upload.pick },
        ]}
        extra={(close) => (
          <div className="add-menu-shapes">
            <span>{t('sprite.plainShape')}</span>
            {SHAPES.map((shape) => (
              <button
                key={shape}
                title={shapeName(shape)}
                onClick={() => {
                  close()
                  store.addSprite(shape)
                }}
              >
                {SHAPE_ICONS[shape]}
              </button>
            ))}
          </div>
        )}
      >
        {upload.element}
      </AddMenu>
      {library && <SpriteLibrary store={store} onClose={() => setLibrary(false)} />}
    </div>
  )
}
