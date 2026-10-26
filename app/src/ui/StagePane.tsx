import { useEffect, useState } from 'react'
import type { AssetRef, Assets } from '../engine/assets'
import type { BackdropData } from '../engine/backdrop'
import { STAGE_ID } from '../engine/types'
import { t } from '../i18n'
import { assetUrl } from './assetUrls'
import type { ProjectStore } from './store'

/**
 * A CSS picture of a backdrop: the back wall above the floor, each with its
 * picture, and the scenery where they are transparent.
 */
export function backdropPreview(b: BackdropData, assets: Assets): string {
  const url = (ref: AssetRef | null) => ref && assetUrl(assets, ref)
  const scenery = url(b.sceneryPicture)
  const sceneryColor = scenery ? 'transparent' : b.scenery
  const wall = b.faces.back.color ?? sceneryColor
  const floor = b.faces.floor.color ?? sceneryColor
  const layers: string[] = []
  const back = url(b.faces.back.picture)
  const ground = url(b.faces.floor.picture)
  if (back) layers.push(`url("${back}") top / 100% 55% no-repeat`)
  if (ground) layers.push(`url("${ground}") bottom / 100% 45% no-repeat`)
  layers.push(`linear-gradient(to bottom, ${wall} 0%, ${wall} 55%, ${floor} 55%, ${floor} 100%)`)
  // The middle of a 360° image, ahead.
  if (scenery) layers.push(`url("${scenery}") center / auto 200% no-repeat`)
  return layers.join(', ')
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
      <span className="backdrop-thumb" style={{ background: backdropPreview(backdrop, store.rt.assets) }} title={backdrop.name} />
      <div className="stage-pane-count">{t('stage.backdropCount', { n: list.length })}</div>
    </div>
  )
}
