import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Icon, type IconName } from './icons'

export interface AddOption {
  icon: IconName
  label: string
  onChoose: () => void
}

/** While `open`, calls `close` on a press outside `root` (menus and popups). */
export function usePressAway(root: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    // Captured: the blocks editor stops presses on it from bubbling.
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [root, open, close])
}

/**
 * The round "+" button of a list (sprites, costumes, backdrops): it opens a
 * menu of the ways to add one, the same everywhere, choosing from a library
 * first. `extra` adds a row at the bottom, given a function that closes the
 * menu. The menu closes on choosing, or on a press elsewhere.
 */
export function AddMenu({
  className,
  title,
  options,
  extra,
  children,
}: {
  className: string
  title: string
  options: AddOption[]
  extra?: (close: () => void) => ReactNode
  /** Rendered beside the button (hidden file inputs). */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  usePressAway(root, open, close)
  return (
    <div className={className} ref={root}>
      {children}
      <button className={`add-sprite-button${open ? ' open' : ''}`} title={title} aria-expanded={open} onClick={() => setOpen(!open)}>
        +
      </button>
      {open && (
        <div className="add-sprite-menu">
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                close()
                o.onChoose()
              }}
            >
              <Icon name={o.icon} />
              <span>{o.label}</span>
            </button>
          ))}
          {extra?.(close)}
        </div>
      )}
    </div>
  )
}
