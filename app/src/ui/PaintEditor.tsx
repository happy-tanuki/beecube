/**
 * The picture editor: a bitmap editor like Scratch's paint editor in bitmap
 * mode, for costumes' pictures and backdrops' faces. For a face it covers
 * the tab it is opened from, and hands back the picture as a PNG when done;
 * for a costume it is part of the tab, as in Scratch, and hands back the
 * picture each time it is changed (a moment after, so a burst of changes is
 * saved once). The caller re-encodes it as an uploaded picture.
 *
 * Tools: brush, eraser, fill, line, rectangle, ellipse, text and color
 * picker, with undo and redo. As in Scratch's vector mode, there is a fill
 * color (the brush, the fill, text, and filled rectangles and ellipses) and
 * an outline color (lines, and outlined rectangles and ellipses), each
 * chosen with the browser's color picker; for rectangles and ellipses,
 * their labels choose between filled and outlined, as Scratch's bitmap
 * mode does. The options bar stays as it is. A guide (paint.ts) shows where each part of a
 * shape goes; it is drawn over the picture, not into it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t, type MessageKey } from '../i18n'
import { showConfirm } from './dialogs'
import { NumberField, PopupField } from './fields'
import { floodFill, hexToRgba, rgbToHex, type GuidePart } from './paint'

type Tool = 'brush' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse' | 'text' | 'picker'

const TOOLS: [Tool, string, MessageKey][] = [
  ['brush', '🖌️', 'paint.brush'],
  ['eraser', '🧽', 'paint.eraser'],
  ['fill', '🪣', 'paint.fill'],
  ['line', '╱', 'paint.line'],
  ['rect', '▭', 'paint.rect'],
  ['ellipse', '◯', 'paint.ellipse'],
  ['text', 'T', 'paint.text'],
  ['picker', '💧', 'paint.picker'],
]

/** The tools that draw with the fill color (the color picker sets it) and those that draw with the outline color. */
const USES_FILL = new Set<Tool>(['brush', 'fill', 'rect', 'ellipse', 'text', 'picker'])
const USES_OUTLINE = new Set<Tool>(['line', 'rect', 'ellipse'])


/** The thinnest and thickest lines, in the picture's pixels. */
const MIN_WIDTH = 1
const MAX_WIDTH = 100
const clampWidth = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)))

/** Snapshots kept for undo. */
const UNDO_LIMIT = 40

interface Props {
  /** The picture to edit, or null for a new, transparent one of `size`. */
  source: Blob | null
  size: [number, number]
  guide: GuidePart[]
  /** Covering the tab, with a title and Cancel and Done (`onSave`, then `onClose`). */
  covering?: { title: string; onSave(picture: Blob): Promise<void>; onClose(): void }
  /** Part of the tab: each change is handed back (when `covering` is not given). */
  onChange?(picture: Blob): void
  /** Whether the guide shows (its switch is the caller's). */
  showGuide?: boolean
}

/** How long after a change the picture is handed back, in milliseconds. */
const CHANGE_DELAY = 400

interface Point {
  x: number
  y: number
}

export function PaintEditor({ source, size, guide, covering, onChange, showGuide = true }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const guideCanvas = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<[number, number] | null>(source ? null : size)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<Tool>('brush')
  const [fillColor, setFillColor] = useState('#e53935')
  const [outline, setOutline] = useState('#000000')
  /** Whether rectangles and ellipses are filled (with the fill color) or outlined (with the outline color), as Scratch's bitmap mode has them. */
  const [filled, setFilled] = useState(true)
  const isShape = tool === 'rect' || tool === 'ellipse'
  const [width, setWidth] = useState(12)
  const [text, setText] = useState<{ at: Point; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const undo = useRef<ImageData[]>([])
  const redo = useRef<ImageData[]>([])
  const [, setHistory] = useState(0)
  const changed = useRef(false)
  const drag = useRef<{ from: Point; last: Point } | null>(null)
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange

  /** Hands the picture back (to `onChange`) now. */
  const handBack = useCallback((c: HTMLCanvasElement | null) => {
    if (changeTimer.current) clearTimeout(changeTimer.current)
    changeTimer.current = null
    c?.toBlob((blob) => blob && latestOnChange.current?.(blob), 'image/png')
  }, [])

  /** The canvas changed, kept here as its ref is let go before the editor's effects are cleaned up. */
  const changedCanvas = useRef<HTMLCanvasElement | null>(null)

  /** After a change: hands the picture back a moment later, once nothing is being drawn. */
  const changedNow = useCallback(() => {
    changed.current = true
    if (!latestOnChange.current) return
    if (changeTimer.current) clearTimeout(changeTimer.current)
    changedCanvas.current = canvas.current
    changeTimer.current = setTimeout(() => (drag.current ? changedNow() : handBack(changedCanvas.current)), CHANGE_DELAY)
  }, [handBack])

  // A change not yet handed back is, when the editor goes (another costume is chosen).
  useEffect(
    () => () => {
      if (changeTimer.current) handBack(changedCanvas.current)
    },
    [handBack],
  )

  const ctx = () => canvas.current!.getContext('2d', { willReadFrequently: true })!

  // An existing picture sets the size and is drawn first.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    void createImageBitmap(source).then((bitmap) => {
      if (cancelled) return bitmap.close()
      setDims([bitmap.width, bitmap.height])
      requestAnimationFrame(() => {
        ctx().drawImage(bitmap, 0, 0)
        bitmap.close()
      })
    })
    return () => {
      cancelled = true
    }
  }, [source])

  // Fits the picture in the area.
  useLayoutEffect(() => {
    const el = area.current
    if (!el || !dims) return
    const fit = () => setScale(Math.min((el.clientWidth - 32) / dims[0], (el.clientHeight - 32) / dims[1], 2))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [dims])

  // The guide, in the editor's language, over the picture.
  useEffect(() => {
    const c = guideCanvas.current
    if (!c || !dims) return
    const g = c.getContext('2d')!
    const [w, h] = dims
    g.clearRect(0, 0, w, h)
    if (!showGuide) return
    g.lineWidth = Math.max(2, w / 400)
    g.setLineDash([w / 80, w / 120])
    g.font = `${Math.round(Math.max(14, w / 36))}px sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const part of guide) {
      const label = t(part.label)
      g.strokeStyle = 'rgba(40,90,200,0.75)'
      g.beginPath()
      if (part.kind === 'line') {
        g.moveTo(part.x * w, 0)
        g.lineTo(part.x * w, h)
        g.stroke()
        drawLabel(g, label, Math.min(Math.max(part.x * w, w * 0.06), w * 0.94), h * 0.06)
        continue
      }
      if (part.kind === 'rect') g.rect(part.x * w, part.y * h, part.w * w, part.h * h)
      else g.ellipse((part.x + part.w / 2) * w, (part.y + part.h / 2) * h, (part.w * w) / 2, (part.h * h) / 2, 0, 0, Math.PI * 2)
      g.stroke()
      drawLabel(g, label, (part.x + part.w / 2) * w, (part.y + part.h / 2) * h)
    }
  }, [guide, dims, showGuide])

  const remember = useCallback(() => {
    const c = canvas.current!
    undo.current.push(ctx().getImageData(0, 0, c.width, c.height))
    if (undo.current.length > UNDO_LIMIT) undo.current.shift()
    redo.current = []
    changed.current = true
    setHistory((n) => n + 1)
  }, [])

  const step = useCallback((from: ImageData[], to: ImageData[]) => {
    const snapshot = from.pop()
    if (!snapshot) return
    const c = canvas.current!
    to.push(ctx().getImageData(0, 0, c.width, c.height))
    ctx().putImageData(snapshot, 0, 0)
    changedNow()
    setHistory((n) => n + 1)
  }, [changedNow])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || text) return
      // Not while typing in a field (a costume's name).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (e.shiftKey) step(redo.current, undo.current)
      else step(undo.current, redo.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, text])

  const pointAt = (e: ReactPointerEvent): Point => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.current!.width, y: ((e.clientY - rect.top) / rect.height) * canvas.current!.height }
  }

  /** Lines, rectangles and ellipses from `a` to `b` (Shift: straight, square or round). */
  const drawShape = (g: CanvasRenderingContext2D, a: Point, b: Point, square: boolean) => {
    g.strokeStyle = outline
    g.fillStyle = fillColor
    g.lineWidth = width
    g.lineCap = g.lineJoin = 'round'
    let dx = b.x - a.x
    let dy = b.y - a.y
    if (square && tool !== 'line') {
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * d
      dy = Math.sign(dy || 1) * d
    } else if (square) {
      // Lines snap to every 45°.
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const d = Math.hypot(dx, dy)
      dx = Math.cos(angle) * d
      dy = Math.sin(angle) * d
    }
    g.beginPath()
    if (tool === 'line') {
      g.moveTo(a.x, a.y)
      g.lineTo(a.x + dx, a.y + dy)
      g.stroke()
      return
    }
    if (tool === 'rect') g.rect(a.x, a.y, dx, dy)
    else g.ellipse(a.x + dx / 2, a.y + dy / 2, Math.abs(dx / 2), Math.abs(dy / 2), 0, 0, Math.PI * 2)
    // Filled, its edge is drawn too, in the fill color, so it covers what the outlined one would (rounded corners and all).
    if (filled) {
      g.fill()
      g.strokeStyle = fillColor
    }
    g.stroke()
  }

  const stroke = (a: Point, b: Point) => {
    const g = ctx()
    g.save()
    g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    g.strokeStyle = fillColor
    g.lineWidth = width
    g.lineCap = g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x + 0.01, b.y)
    g.stroke()
    g.restore()
  }

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !dims) return
    const p = pointAt(e)
    if (tool === 'picker') {
      const [r, g, b, a] = ctx().getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data
      if (a > 0) setFillColor(rgbToHex(r, g, b))
      setTool('brush')
      return
    }
    if (tool === 'fill') {
      const c = canvas.current!
      const image = ctx().getImageData(0, 0, c.width, c.height)
      const before = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
      if (floodFill(image, p.x, p.y, hexToRgba(fillColor))) {
        undo.current.push(before)
        redo.current = []
        ctx().putImageData(image, 0, 0)
        changedNow()
        setHistory((n) => n + 1)
      }
      return
    }
    if (tool === 'text') {
      // Keeps the focus off the page, for the text field about to open.
      e.preventDefault()
      commitText()
      setText({ at: p, value: '' })
      return
    }
    remember()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { from: p, last: p }
    if (tool === 'brush' || tool === 'eraser') stroke(p, p)
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = pointAt(e)
    if (tool === 'brush' || tool === 'eraser') {
      stroke(d.last, p)
    } else {
      const g = preview.current!.getContext('2d')!
      g.clearRect(0, 0, dims![0], dims![1])
      drawShape(g, d.from, p, e.shiftKey)
    }
    d.last = p
  }

  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      preview.current!.getContext('2d')!.clearRect(0, 0, dims![0], dims![1])
      drawShape(ctx(), d.from, pointAt(e), e.shiftKey)
    }
    changedNow()
  }

  const fontSize = Math.max(16, width * 4)

  function commitText() {
    if (!text || !text.value.trim()) return setText(null)
    remember()
    const g = ctx()
    g.fillStyle = fillColor
    g.font = `bold ${fontSize}px sans-serif`
    g.textBaseline = 'top'
    g.fillText(text.value, text.at.x, text.at.y)
    setText(null)
    changedNow()
  }

  const clear = () => {
    remember()
    ctx().clearRect(0, 0, dims![0], dims![1])
    changedNow()
  }

  const close = async () => {
    if (changed.current && !(await showConfirm(t('paint.confirmDiscard')))) return
    covering?.onClose()
  }

  const save = async () => {
    if (!covering) return
    commitText()
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, 'image/png'))
      if (blob) await covering.onSave(blob)
      covering.onClose()
    } finally {
      setSaving(false)
    }
  }

  const shown = dims && { width: dims[0] * scale, height: dims[1] * scale }
  return (
    <div className={`paint-editor${covering ? ' covering' : ''}`}>
      {covering && (
        <div className="library-header">
          <span>{covering.title}</span>
          <span className="paint-header-buttons">
            <button onClick={() => void close()}>{t('paint.cancel')}</button>
            <button className="primary" disabled={saving || !dims} onClick={() => void save()}>
              {t('paint.save')}
            </button>
          </span>
        </div>
      )}
      <div className="paint-options">
        <ColorField
          label={t('paint.fillColor')}
          color={fillColor}
          onChange={setFillColor}
          disabled={isShape ? !filled : !USES_FILL.has(tool)}
          choice={{ shown: isShape, chosen: filled, onChoose: () => setFilled(true) }}
        />
        <ColorField
          label={t('paint.outline')}
          color={outline}
          onChange={setOutline}
          disabled={isShape ? filled : !USES_OUTLINE.has(tool)}
          choice={{ shown: isShape, chosen: !filled, onChoose: () => setFilled(false) }}
        />
        <PopupField className="paint-width" field={<NumberField label={t('paint.width')} value={width} onChange={(w) => setWidth(clampWidth(w))} />}>
          <input type="range" aria-label={t('paint.width')} min={MIN_WIDTH} max={MAX_WIDTH} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </PopupField>
        <span className="paint-history">
          <button disabled={undo.current.length === 0} title={t('paint.undo')} onClick={() => step(undo.current, redo.current)}>
            ↶
          </button>
          <button disabled={redo.current.length === 0} title={t('paint.redo')} onClick={() => step(redo.current, undo.current)}>
            ↷
          </button>
          <button onClick={clear}>{t('paint.clear')}</button>
        </span>
      </div>
      <div className="paint-body">
        <div className="paint-tools" role="toolbar">
          {TOOLS.map(([id, icon, label]) => (
            <button
              key={id}
              className={tool === id ? 'selected' : ''}
              title={t(label)}
              aria-label={t(label)}
              onClick={() => {
                commitText()
                setTool(id)
              }}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="paint-area" ref={area}>
          {dims && (
            <div className={`paint-canvas tool-${tool}`} style={shown!} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
              <canvas ref={canvas} width={dims[0]} height={dims[1]} />
              <canvas ref={preview} width={dims[0]} height={dims[1]} />
              <canvas ref={guideCanvas} width={dims[0]} height={dims[1]} />
              {text && (
                <input
                  className="paint-text"
                  autoFocus
                  value={text.value}
                  style={{ left: text.at.x * scale, top: text.at.y * scale, fontSize: fontSize * scale, color: fillColor }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setText({ ...text, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitText()
                    if (e.key === 'Escape') setText(null)
                  }}
                  onBlur={commitText}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A color: its label and the browser's color picker, opened directly.
 * While `choice.shown` (rectangles and ellipses), the label is a button
 * that chooses this color's way of drawing (filled, or outlined), lit
 * while chosen; otherwise it is the same size, so nothing moves. Dimmed
 * while the tool doesn't use the color.
 */
function ColorField({ label, color, onChange, disabled, choice }: {
  label: string
  color: string
  onChange: (color: string) => void
  disabled: boolean
  choice: { shown: boolean; chosen: boolean; onChoose: () => void }
}) {
  return (
    <span className={`paint-color${disabled ? ' disabled' : ''}`}>
      <button
        className={`paint-color-label${choice.shown ? ' choosable' : ''}${choice.shown && choice.chosen ? ' chosen' : ''}`}
        disabled={!choice.shown}
        aria-pressed={choice.shown ? choice.chosen : undefined}
        onClick={choice.onChoose}
      >
        {label}
      </button>
      <input type="color" value={color} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </span>
  )
}

/** A guide's label, on a pale backing so it reads over any picture. */
function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const w = g.measureText(text).width + 12
  const h = parseInt(g.font, 10) + 8
  g.save()
  g.setLineDash([])
  g.fillStyle = 'rgba(255,255,255,0.75)'
  g.fillRect(x - w / 2, y - h / 2, w, h)
  g.fillStyle = 'rgba(30,70,170,0.95)'
  g.fillText(text, x, y)
  g.restore()
}
