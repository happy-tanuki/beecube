import { useEffect, useState } from 'react'
import { FACES, type BackdropData, type FaceName } from '../engine/backdrop'
import { t } from '../i18n'
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

function BackdropForm({ store, index, backdrop }: { store: ProjectStore; index: number; backdrop: BackdropData }) {
  const update = (change: (b: BackdropData) => void) => store.updateBackdrop(index, change)
  return (
    <div className="backdrop-form">
      <NameField key={backdrop.id} store={store} index={index} backdrop={backdrop} />
      <label className="field">
        <span>{t('backdrop.scenery')}</span>
        <input type="color" value={backdrop.scenery} onChange={(e) => update((b) => (b.scenery = e.target.value))} />
      </label>
      <table className="backdrop-faces">
        <tbody>
          {FACES.map((name) => {
            const color = backdrop.faces[name].color
            return (
              <tr key={name}>
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
              </tr>
            )
          })}
        </tbody>
      </table>
      <label className="field checkbox">
        <input type="checkbox" checked={backdrop.grid} onChange={(e) => update((b) => (b.grid = e.target.checked))} />
        <span>{t('backdrop.grid')}</span>
      </label>
    </div>
  )
}

/** Re-renders periodically so a backdrop switched by a script shows up. */
function useTicker(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** The stage's Backdrops tab: the list (choosing one makes it current, as in Scratch) and the chosen one's look. */
export function BackdropsTab({ store }: { store: ProjectStore }) {
  useTicker(250)
  const { list, current, backdrop } = store.rt.backdrops
  return (
    <div className="backdrops-tab">
      <div className="backdrop-list">
        {list.map((b, i) => (
          <div key={b.id} className={`backdrop-tile${i === current ? ' selected' : ''}`} onClick={() => store.selectBackdrop(i)}>
            <span className="backdrop-number">{i + 1}</span>
            <span className="backdrop-thumb" style={{ background: backdropPreview(b) }} />
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
        <button className="add-sprite-button backdrop-add" title={t('backdrop.add')} onClick={() => store.addBackdrop()}>
          +
        </button>
      </div>
      <BackdropForm key={backdrop.id} store={store} index={current} backdrop={backdrop} />
    </div>
  )
}
