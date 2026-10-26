import { useEffect, useState } from 'react'
import type { Sprite } from '../engine/sprite'
import type { ShapeKind } from '../engine/types'
import { t } from '../i18n'
import { assetUrl } from './assetUrls'
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

/** The costume worn: its picture, or its shape in the sprite's color. */
function SpriteThumb({ store, sprite }: { store: ProjectStore; sprite: Sprite }) {
  const picture = sprite.costumes[sprite.costume]?.picture
  const url = picture && assetUrl(store.rt.assets, picture)
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(Math.round(value * 100) / 100)
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={shown}
        onFocus={() => setDraft(shown)}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value.trim() !== '' && !Number.isNaN(n)) onChange(n)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
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

function SpriteInfo({ store, sprite }: { store: ProjectStore; sprite: Sprite }) {
  useTicker(100)
  const set = (patch: Partial<Pick<Sprite, 'x' | 'y' | 'z' | 'direction' | 'pitch' | 'roll' | 'size' | 'width' | 'depth' | 'height' | 'shape' | 'color' | 'visible'>>) => {
    Object.assign(sprite, patch)
    store.notify()
  }
  return (
    <div className="sprite-info">
      <NameField key={sprite.id} store={store} sprite={sprite} />
      <NumberField label="x" value={sprite.x} onChange={(x) => set({ x })} />
      <NumberField label="y" value={sprite.y} onChange={(y) => set({ y })} />
      <NumberField label="z" value={sprite.z} onChange={(z) => set({ z })} />
      <NumberField label={t('sprite.direction')} value={sprite.direction} onChange={(direction) => set({ direction })} />
      <NumberField label={t('sprite.pitch')} value={sprite.pitch} onChange={(pitch) => set({ pitch })} />
      <NumberField label={t('sprite.roll')} value={sprite.roll} onChange={(roll) => set({ roll })} />
      <NumberField label={t('sprite.size')} value={sprite.size} onChange={(size) => set({ size })} />
      <NumberField label={t('sprite.width')} value={sprite.width} onChange={(width) => set({ width })} />
      <NumberField label={t('sprite.depth')} value={sprite.depth} onChange={(depth) => set({ depth })} />
      <NumberField label={t('sprite.height')} value={sprite.height} onChange={(height) => set({ height })} />
      <label className="field">
        <span>{t('sprite.shape')}</span>
        <select value={sprite.shape} onChange={(e) => set({ shape: e.target.value as ShapeKind })}>
          {SHAPES.map((s) => (
            <option key={s} value={s}>
              {shapeName(s)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('sprite.color')}</span>
        <input type="color" value={sprite.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      <label className="field checkbox">
        <span>{t('sprite.show')}</span>
        <input type="checkbox" checked={sprite.visible} onChange={(e) => set({ visible: e.target.checked })} />
      </label>
    </div>
  )
}

export function SpritePane({ store, editingId }: Props) {
  // Thumbnails show the costume worn, which scripts change, and pictures that arrive later.
  useTicker(250)
  const [menuOpen, setMenuOpen] = useState(false)
  const editing = store.rt.getSprite(editingId)
  return (
    <div className="sprite-pane">
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
      <div className="add-sprite">
        <button className="add-sprite-button" title={t('sprite.add')} onClick={() => setMenuOpen(!menuOpen)}>
          +
        </button>
        {menuOpen && (
          <div className="add-sprite-menu">
            {SHAPES.map((shape) => (
              <button
                key={shape}
                onClick={() => {
                  store.addSprite(shape)
                  setMenuOpen(false)
                }}
              >
                {SHAPE_ICONS[shape]} {shapeName(shape)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
