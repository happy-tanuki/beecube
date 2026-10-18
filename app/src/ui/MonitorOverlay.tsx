import { useEffect, useState } from 'react'
import { CATEGORY_COLOURS } from '../blocks/colours'
import type { Runtime } from '../engine/runtime'
import type { Value } from '../engine/types'
import { t } from '../i18n'
import { monitorView, type MonitorView } from './monitors'

const REFRESH_MS = 100

/** Scratch-style value chips in the stage's top-left corner. */
export function MonitorOverlay({ rt }: { rt: Runtime }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    const off = rt.onMonitorChange(() => setTick((t) => t + 1))
    return () => {
      clearInterval(id)
      off()
    }
  }, [rt])

  const views = [...rt.monitors].map((key) => monitorView(rt, key)).filter((v) => v !== null)
  if (views.length === 0) return null
  return (
    <div className="monitors">
      {views.map((v) =>
        v.items ? (
          <ListMonitor key={v.key} view={v} items={v.items} />
        ) : (
          <div className="monitor" key={v.key}>
            <span className="monitor-label">{v.label}</span>
            <span className="monitor-value" style={{ background: CATEGORY_COLOURS[v.category][0] }}>
              {String(v.value)}
            </span>
          </div>
        ),
      )}
    </div>
  )
}

/** A list's items, numbered, in a scrollable box. */
function ListMonitor({ view, items }: { view: MonitorView; items: readonly Value[] }) {
  return (
    <div className="list-monitor">
      <div className="list-monitor-label">{view.label}</div>
      <ol className="list-monitor-items">
        {items.length === 0 && <li className="list-monitor-empty">{t('monitor.empty')}</li>}
        {items.map((item, i) => (
          <li key={i}>
            <span className="list-monitor-index">{i + 1}</span>
            <span className="list-monitor-item" style={{ background: CATEGORY_COLOURS[view.category][0] }}>
              {String(item)}
            </span>
          </li>
        ))}
      </ol>
      <div className="list-monitor-length">{t('monitor.length', { n: items.length })}</div>
    </div>
  )
}
