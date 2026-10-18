import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { Stage3D } from '../stage/Stage3D'
import { StageView } from './StageView'
import type { ProjectStore } from './store'

interface Props {
  store: ProjectStore
  editingId: string
  /** Receives the Stage3D once created (and null when disposed). */
  onStage?(stage: Stage3D | null): void
}

/** Shown with `?perf` or `?bench=…` in the URL. */
const SHOW_PERF = typeof window !== 'undefined' && /[?&](perf|bench)\b/.test(window.location.search)

/** Logic and drawing times, for the performance scenarios. */
function PerfOverlay({ store, stage }: { store: ProjectStore; stage: () => Stage3D | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(id)
  }, [])
  const ms = (v: number) => v.toFixed(2)
  return (
    <div className="perf-overlay">
      <div>{t('perf.fps', { fps: (stage()?.fps ?? 0).toFixed(0) })}</div>
      <div>{t('perf.logic', { ms: ms(store.rt.tickMs) })}</div>
      <div>{t('perf.draw', { ms: ms(stage()?.renderMs ?? 0) })}</div>
      <div className="perf-detail">{t('perf.drawPrepare', { ms: ms(stage()?.prepareMs ?? 0) })}</div>
      <div className="perf-detail">{t('perf.drawSubmit', { ms: ms(stage()?.submitMs ?? 0) })}</div>
      <div>{t('perf.entities', { n: store.rt.store.count })}</div>
    </div>
  )
}

export function StagePanel({ store, editingId, onStage }: Props) {
  const stageRef = useRef<Stage3D | null>(null)
  return (
    <div className="stage-column">
      <StageView
        rt={store.rt}
        editing={{ selectedId: editingId, onGrab: (id) => store.select(id) }}
        axisViews
        onStage={(stage) => {
          stageRef.current = stage
          onStage?.(stage)
          if (import.meta.env.DEV && stage) Object.assign(window, { __beecube: { store, stage } })
        }}
      >
        {SHOW_PERF && <PerfOverlay store={store} stage={() => stageRef.current} />}
      </StageView>
      <div className="stage-hint">{t('stage.hint')}</div>
    </div>
  )
}
