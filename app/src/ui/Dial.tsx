import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { wrapDirection } from '../engine/ops'

/**
 * How a dial is seen: from above (direction: 0 points up the dial, 90 to
 * its right, as Scratch's dial), from the sprite's right side (pitch: 0
 * points right, the sprite's front, and up is positive) or from behind
 * (roll: 0 points up, the sprite's top, and right is positive).
 */
export type DialView = 'above' | 'side' | 'behind'

/** The needle's angle on the dial, clockwise from up, for an angle seen this way. */
const toScreen = (view: DialView, angle: number) => (view === 'side' ? 90 - angle : angle)
const fromScreen = toScreen

const SIZE = 96
const C = SIZE / 2
const R = 38
const DEG = Math.PI / 180

/**
 * A round dial with a needle that is dragged round (by mouse, pen or
 * finger), as Scratch's direction popup. Arrow keys turn it by 1°, by 15°
 * with Shift. Angles are whole degrees in (-180, 180].
 */
export function Dial({ view, angle, label, onChange }: { view: DialView; angle: number; label: string; onChange: (angle: number) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const at = toScreen(view, angle) * DEG
  const tip = { x: C + Math.sin(at) * R, y: C - Math.cos(at) * R }
  const turnTo = (e: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect()
    const dx = e.clientX - (box.left + box.width / 2)
    const dy = e.clientY - (box.top + box.height / 2)
    if (dx === 0 && dy === 0) return
    onChange(wrapDirection(Math.round(fromScreen(view, Math.atan2(dx, -dy) / DEG))))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 15 : 1) * (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0)
    if (step === 0) return
    e.preventDefault()
    onChange(wrapDirection(Math.round(angle) + step))
  }
  return (
    <svg
      ref={svg}
      className="dial"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={-179}
      aria-valuemax={180}
      aria-valuenow={Math.round(angle)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.focus()
        turnTo(e)
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && turnTo(e)}
      onKeyDown={onKeyDown}
    >
      <circle className="dial-face" cx={C} cy={C} r={R + 6} />
      {/* The floor, seen from the side or from behind. */}
      {view !== 'above' && <line className="dial-floor" x1={C - R - 6} y1={C} x2={C + R + 6} y2={C} />}
      {[0, 90, 180, 270].map((a) => (
        <line key={a} className="dial-tick" x1={C + Math.sin(a * DEG) * (R + 1)} y1={C - Math.cos(a * DEG) * (R + 1)} x2={C + Math.sin(a * DEG) * (R + 6)} y2={C - Math.cos(a * DEG) * (R + 6)} />
      ))}
      <line className="dial-needle" x1={C} y1={C} x2={tip.x} y2={tip.y} />
      <circle className="dial-center" cx={C} cy={C} r={4} />
      <circle className="dial-knob" cx={tip.x} cy={tip.y} r={9} />
    </svg>
  )
}
