/**
 * The picture editor: a bitmap editor like Scratch's paint editor in bitmap
 * mode, for costumes' pictures and backdrops' faces. It covers the tab it is
 * opened from, and hands back the picture as a PNG; the caller re-encodes it
 * as an uploaded picture.
 *
 * Tools: brush, eraser, fill, line, rectangle, ellipse, text and color
 * picker, with undo and redo. A guide (paint.ts) shows where each part of a
 * shape goes; it is drawn over the picture, not into it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t, type MessageKey } from '../i18n'
import { showConfirm } from './dialogs'
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

const SWATCHES = ['#000000', '#ffffff', '#9e9e9e', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f06292', '#8d6e63', '#00acc1']

/** Snapshots kept for undo. */
const UNDO_LIMIT = 40

interface Props {
  title: string
  /** The picture to edit, or null for a new, transparent one of `size`. */
  source: Blob | null
  size: [number, number]
  guide: GuidePart[]
  onSave(picture: Blob): Promise<void>
  onClose(): void
}

interface Point {
  x: number
  y: number
}

export function PaintEditor({ title, source, size, guide, onSave, onClose }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const guideCanvas = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<[number, number] | null>(source ? null : size)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#e53935')
  const [width, setWidth] = useState(12)
  const [filled, setFilled] = useState(true)
  const [showGuide, setShowGuide] = useState(true)
  const [text, setText] = useState<{ at: Point; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const undo = useRef<ImageData[]>([])
  const redo = useRef<ImageData[]>([])
  const [, setHistory] = useState(0)
  const changed = useRef(false)
  const drag = useRef<{ from: Point; last: Point } | null>(null)

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
    changed.current = true
    setHistory((n) => n + 1)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || text) return
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
    g.strokeStyle = g.fillStyle = color
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
    if (filled) g.fill()
    else g.stroke()
  }

  const stroke = (a: Point, b: Point) => {
    const g = ctx()
    g.save()
    g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    g.strokeStyle = color
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
      if (a > 0) setColor(rgbToHex(r, g, b))
      setTool('brush')
      return
    }
    if (tool === 'fill') {
      const c = canvas.current!
      const image = ctx().getImageData(0, 0, c.width, c.height)
      const before = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
      if (floodFill(image, p.x, p.y, hexToRgba(color))) {
        undo.current.push(before)
        redo.current = []
        changed.current = true
        ctx().putImageData(image, 0, 0)
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
  }

  const fontSize = Math.max(16, width * 4)

  function commitText() {
    if (!text || !text.value.trim()) return setText(null)
    remember()
    const g = ctx()
    g.fillStyle = color
    g.font = `bold ${fontSize}px sans-serif`
    g.textBaseline = 'top'
    g.fillText(text.value, text.at.x, text.at.y)
    setText(null)
  }

  const clear = () => {
    remember()
    ctx().clearRect(0, 0, dims![0], dims![1])
  }

  const close = async () => {
    if (changed.current && !(await showConfirm(t('paint.confirmDiscard')))) return
    onClose()
  }

  const save = async () => {
    commitText()
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.current!.toBlob(resolve, 'image/png'))
      if (blob) await onSave(blob)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const shown = dims && { width: dims[0] * scale, height: dims[1] * scale }
  return (
    <div className="paint-editor">
      <div className="library-header">
        <span>{title}</span>
        <span className="paint-header-buttons">
          <button onClick={() => void close()}>{t('paint.cancel')}</button>
          <button className="primary" disabled={saving || !dims} onClick={() => void save()}>
            {t('paint.save')}
          </button>
        </span>
      </div>
      <div className="paint-options">
        <span className="paint-swatches">
          <input type="color" value={color} aria-label={t('paint.color')} onChange={(e) => setColor(e.target.value)} />
          {SWATCHES.map((c) => (
            <button key={c} className={`paint-swatch${c === color ? ' selected' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
          ))}
        </span>
        <label className="paint-width">
          <span>{t('paint.width')}</span>
          <input type="range" min={1} max={100} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          <span className="paint-width-value">{width}</span>
        </label>
        {(tool === 'rect' || tool === 'ellipse') && (
          <label className="field checkbox">
            <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
            <span>{t('paint.filled')}</span>
          </label>
        )}
        <span className="paint-history">
          <button disabled={undo.current.length === 0} title={t('paint.undo')} onClick={() => step(undo.current, redo.current)}>
            ↶
          </button>
          <button disabled={redo.current.length === 0} title={t('paint.redo')} onClick={() => step(redo.current, undo.current)}>
            ↷
          </button>
          <button onClick={clear}>{t('paint.clear')}</button>
        </span>
        {guide.length > 0 && (
          <label className="field checkbox">
            <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
            <span>{t('paint.guide')}</span>
          </label>
        )}
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
                  style={{ left: text.at.x * scale, top: text.at.y * scale, fontSize: fontSize * scale, color }}
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
