/**
 * On-screen keys for touch screens, so projects played with the keyboard
 * work on phones. Only the keys a project uses are shown: arrows as a pad on
 * the left, the others (space, letters) on the right.
 */
import type { PointerEvent } from 'react'
import type { ProjectFile } from '../engine/project'
import type { Runtime } from '../engine/runtime'
import { t } from '../i18n'

const ARROWS = ['up arrow', 'left arrow', 'right arrow', 'down arrow']
/** At most this many keys besides the arrows get a button. */
const MAX_OTHER_KEYS = 4

/**
 * The keys a project's "when key pressed" and "key pressed?" blocks name.
 * If a block computes its key, every key could matter: then the arrows and
 * space. "any" counts as space.
 */
export function usedKeys(project: ProjectFile): string[] {
  const keys = new Set<string>()
  let computed = false
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const node = value as Record<string, unknown>
    const fields = node.fields as Record<string, unknown> | undefined
    if (typeof fields?.KEY_OPTION === 'string') keys.add(fields.KEY_OPTION === 'any' ? 'space' : fields.KEY_OPTION)
    const input = (node.inputs as Record<string, { block?: unknown }> | undefined)?.KEY_OPTION
    if (node.type === 'sensing_keypressed' && input?.block) computed = true
    Object.values(node).forEach(walk)
  }
  for (const sprite of project.sprites) walk(sprite.blocks)
  if (computed) [...ARROWS, 'space'].forEach((k) => keys.add(k))
  const arrows = ARROWS.filter((k) => keys.has(k))
  const others = [...keys].filter((k) => !ARROWS.includes(k)).sort((a, b) => (a === 'space' ? -1 : b === 'space' ? 1 : a.localeCompare(b)))
  return [...arrows, ...others.slice(0, MAX_OTHER_KEYS)]
}

/** Whether the device's main pointer is a finger (phones and tablets). */
export const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const ARROW_LABELS: Record<string, string> = { 'up arrow': '▲', 'down arrow': '▼', 'left arrow': '◀', 'right arrow': '▶' }

function Key({ rt, name, className }: { rt: Runtime; name: string; className: string }) {
  const press = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    rt.keyPressed(name)
  }
  const release = () => rt.keyReleased(name)
  const label = ARROW_LABELS[name] ?? (name === 'space' ? t('touch.space') : name.toUpperCase())
  return (
    <button
      className={className}
      aria-label={name === 'space' ? t('touch.space') : name}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}

/** The keys over the stage; `keys` from usedKeys. */
export function TouchKeys({ rt, keys }: { rt: Runtime; keys: string[] }) {
  const arrows = keys.filter((k) => ARROWS.includes(k))
  const others = keys.filter((k) => !ARROWS.includes(k))
  if (keys.length === 0) return null
  return (
    <div className="touch-keys">
      {arrows.length > 0 && (
        <div className="touch-dpad">
          {arrows.map((k) => (
            <Key key={k} rt={rt} name={k} className={`touch-key ${k.split(' ')[0]}`} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="touch-actions">
          {others.map((k) => (
            <Key key={k} rt={rt} name={k} className={k === 'space' ? 'touch-key wide' : 'touch-key'} />
          ))}
        </div>
      )}
    </div>
  )
}
