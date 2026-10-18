/**
 * The stage with its header (green flag, stop, views, full screen) and
 * overlays, shared by the editor and the player.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Runtime } from '../engine/runtime'
import { t } from '../i18n'
import { Stage3D, type ViewName } from '../stage/Stage3D'
import { MonitorOverlay } from './MonitorOverlay'

/** The stage box in the editor, in CSS pixels (as .stage in stage.css). Other sizes keep its aspect and scale the overlays. */
const STAGE_BOX = { width: 488, height: 366 }
/** Height of the header above the stage in full screen. */
const FULLSCREEN_HEADER = 44
/** Width of the button column beside the stage in full screen on short (landscape phone) windows. */
const FULLSCREEN_SIDEBAR = 56
/** Windows lower than this put the full-screen buttons beside the stage rather than above it. */
const SHORT_WINDOW = 500

const AXIS_VIEWS: ViewName[] = ['top', 'front', 'side']

const flagIcon = `${import.meta.env.BASE_URL}blocks-media/green-flag.svg`

function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M3 9.5 10 3.5l7 6M5.5 8v8h3.5v-4.5h2V16h3.5V8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Four corner brackets, pointing out (enter) or in (exit). */
function FullscreenIcon({ exit }: { exit?: boolean }) {
  const d = exit
    ? 'M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4'
    : 'M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4'
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface FullscreenBox {
  width: number
  height: number
  /** The buttons go in a column beside the stage (short windows, such as phones held sideways). */
  side: boolean
}

/**
 * The stage size filling the window, keeping the stage's aspect: below the
 * header, as in Scratch, or beside a button column when the window is short.
 */
function useFullscreenBox(active: boolean): FullscreenBox | null {
  const measure = (): FullscreenBox => {
    const side = window.innerHeight < SHORT_WINDOW
    const scale = side
      ? Math.min((window.innerWidth - 2 * FULLSCREEN_SIDEBAR) / STAGE_BOX.width, window.innerHeight / STAGE_BOX.height)
      : Math.min(window.innerWidth / STAGE_BOX.width, (window.innerHeight - FULLSCREEN_HEADER) / STAGE_BOX.height)
    return { width: Math.floor(STAGE_BOX.width * scale), height: Math.floor(STAGE_BOX.height * scale), side }
  }
  const [box, setBox] = useState(measure)
  useEffect(() => {
    if (!active) return
    const update = () => setBox(measure())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [active])
  return active ? box : null
}

interface Props {
  rt: Runtime
  /** Editor: sprites can be selected and dragged (outside full screen). */
  editing?: { selectedId: string; onGrab(spriteId: string): void }
  /** Player: the stage fills its container's width instead of the editor's fixed size. */
  fit?: boolean
  /** Player: a big green flag covers the stage until the project is started. */
  startOverlay?: boolean
  /** Editor: top, front and side view buttons besides home (not in full screen). */
  axisViews?: boolean
  /** Receives the Stage3D once created (and null when disposed). */
  onStage?(stage: Stage3D | null): void
  /** More overlays on the stage. */
  children?: ReactNode
}

export function StageView({ rt, editing, fit, startOverlay, axisViews, onStage, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage3D | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [started, setStarted] = useState(false)
  const box = useFullscreenBox(fullscreen)
  // Read by the stage's callbacks, which are bound once.
  const editingRef = useRef(editing)
  editingRef.current = editing
  const onStageRef = useRef(onStage)
  onStageRef.current = onStage

  useEffect(() => {
    const container = containerRef.current!
    const stage = new Stage3D(container, rt, {
      onEntityGrabbed: (entity) => editingRef.current?.onGrab(entity.original.id),
      onEntityClicked: (entity) => rt.entityClicked(entity.slot),
    })
    stageRef.current = stage
    onStageRef.current?.(stage)
    // Overlays (monitors, bubbles) scale with the stage.
    const observer = new ResizeObserver(() => setZoom(container.offsetWidth / STAGE_BOX.width))
    observer.observe(container)
    return () => {
      observer.disconnect()
      stage.dispose()
      stageRef.current = null
      onStageRef.current?.(null)
    }
  }, [rt])

  useEffect(() => {
    stageRef.current?.setSelected(editing?.selectedId ?? null)
  }, [editing?.selectedId])

  useEffect(() => {
    stageRef.current?.setEditable(!!editing && !fullscreen)
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, !!editing])

  const greenFlag = () => {
    setStarted(true)
    rt.greenFlag()
  }

  const viewButton = (v: ViewName) => (
    <button key={v} title={t(`stage.view.${v}`)} aria-label={t(`stage.view.${v}`)} onClick={() => stageRef.current?.setView(v)}>
      {v === 'home' ? <HomeIcon /> : t(`stage.view.${v}`)}
    </button>
  )
  const fullscreenLabel = fullscreen ? t('stage.exitFullscreen') : t('stage.fullscreen')
  const classes = ['stage-panel', fit && 'fit', fullscreen && 'fullscreen', box?.side && 'side'].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div className="stage-header">
        <button className="flag-button" title={t('stage.greenFlag')} onClick={greenFlag}>
          <img src={flagIcon} alt={t('stage.greenFlag')} />
        </button>
        <button className="stop-button" title={t('stage.stop')} onClick={() => rt.stopAll()}>
          <span className="stop-icon" />
        </button>
        <div className="view-buttons">
          {viewButton('home')}
          {axisViews && !fullscreen && AXIS_VIEWS.map(viewButton)}
        </div>
        <button
          className="fullscreen-button"
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
          onClick={() => setFullscreen((f) => !f)}
        >
          <FullscreenIcon exit={fullscreen} />
        </button>
      </div>
      <div className="stage-frame" style={{ '--stage-zoom': zoom } as CSSProperties}>
        <div className="stage" ref={containerRef} style={box ? { width: box.width, height: box.height } : undefined} />
        <MonitorOverlay rt={rt} />
        {children}
        {startOverlay && !started && (
          <button className="start-overlay" aria-label={t('stage.greenFlag')} onClick={greenFlag}>
            <img src={flagIcon} alt="" />
          </button>
        )}
      </div>
    </div>
  )
}
