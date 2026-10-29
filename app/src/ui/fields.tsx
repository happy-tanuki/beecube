/** Fields shared by the editor's panes: numbers, and fields that pop up more while edited. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** A number, applied as it is typed (when it is one). */
export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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

/**
 * A field with a popup under it while anything in it has focus, as
 * Scratch's direction field pops up a dial. Escape closes it.
 */
export function PopupField({ className, field, children }: { className: string; field: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  // Moved left as far as it needs to stay inside what clips it (marked data-popup-bounds), or the window.
  useLayoutEffect(() => {
    const el = popup.current
    if (!el) return
    const right = el.closest('[data-popup-bounds]')?.getBoundingClientRect().right ?? window.innerWidth
    el.style.left = '0px'
    const over = el.getBoundingClientRect().right - (right - 8)
    if (over > 0) el.style.left = `${-over}px`
  }, [open])
  return (
    <div
      className={`popup-field ${className}`}
      ref={root}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {field}
      {open && (
        <div className="field-popup" ref={popup}>
          {children}
        </div>
      )}
    </div>
  )
}
