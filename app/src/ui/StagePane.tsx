import { useEffect, useState } from 'react'
import type { BackdropData } from '../engine/backdrop'
import { STAGE_ID } from '../engine/types'
import { t } from '../i18n'
import type { ProjectStore } from './store'

/** A CSS picture of a backdrop: the back wall (or the scenery) above the floor (or the scenery). */
export function backdropPreview(b: BackdropData): string {
  const wall = b.faces.back.color ?? b.scenery
  const floor = b.faces.floor.color ?? b.scenery
  return `linear-gradient(to bottom, ${wall} 0%, ${wall} 55%, ${floor} 55%, ${floor} 100%)`
}

/** Re-renders periodically so a backdrop switched by a script shows up. */
function useTicker(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** The stage beside the sprite list, as in Scratch: selecting it edits the stage's scripts and backdrops. */
export function StagePane({ store }: { store: ProjectStore }) {
  useTicker(250)
  const { list, backdrop } = store.rt.backdrops
  return (
    <div className={`stage-pane${store.editingStage ? ' selected' : ''}`} onClick={() => store.select(STAGE_ID)}>
      <div className="stage-pane-title">{t('stage.title')}</div>
      <span className="backdrop-thumb" style={{ background: backdropPreview(backdrop) }} title={backdrop.name} />
      <div className="stage-pane-count">{t('stage.backdropCount', { n: list.length })}</div>
    </div>
  )
}
