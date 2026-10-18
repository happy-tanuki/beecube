/**
 * "When I touch (sprite)" hats: after each tick, finds the contacts that
 * began in it and reports one per entity, so its script starts next tick
 * (docs/vm-design.md 7).
 *
 * Contacts are tracked per pair, so touching a second clone of the target
 * while still touching the first starts the script again. The edge is one
 * target: touching it starts the script when the entity was not touching it.
 */
import { shapesIntersect, touchable, touchingEdge } from './collision'
import type { Kind, ScriptRun } from './instances'
import type { EntityStore } from './store'

/** Called for each entity that began touching: `other` is the slot it touched, or -1 for the edge. */
export type TouchStart = (run: ScriptRun, slot: number, other: number) => void

/** What a watch remembers between ticks; kept across recompiles of the same script. */
class Contacts {
  /** Edge: per slot, the entity's handle + 1 while it touches the edge. */
  edge = new Float64Array(0)
  /** Pairs: (slot × SPAN + other slot) → handle of the other entity. */
  pairs = new Map<number, number>()
  next = new Map<number, number>()
}

interface Watch {
  run: ScriptRun
  target: Kind | 'edge'
  contacts: Contacts
}

const SPAN = 2 ** 22

export class TouchWatcher {
  private watches: Watch[] = []
  private contacts = new Map<string, Contacts>()

  get active(): boolean {
    return this.watches.length > 0
  }

  /** Replaces the watched scripts, keeping what each still-watched script remembered. */
  setWatches(list: { run: ScriptRun; target: Kind | 'edge' }[]): void {
    const kept = new Map<string, Contacts>()
    this.watches = list.map(({ run, target }) => {
      const key = `${run.kind.sprite.id}\n${run.topId}\n${target === 'edge' ? '' : target.sprite.id}`
      const contacts = kept.get(key) ?? this.contacts.get(key) ?? new Contacts()
      kept.set(key, contacts)
      return { run, target, contacts }
    })
    this.contacts = kept
  }

  detect(E: EntityStore, tick: number, start: TouchStart): void {
    for (const w of this.watches) {
      if (w.target === 'edge') this.detectEdge(w, E, start)
      else this.detectKind(w, w.target, E, tick, start)
    }
  }

  private detectEdge(w: Watch, E: EntityStore, start: TouchStart): void {
    const kind = w.run.kind
    const c = w.contacts
    if (c.edge.length < E.capacity) {
      const edge = new Float64Array(E.capacity)
      edge.set(c.edge)
      c.edge = edge
    }
    for (let m = 0; m < kind.count; m++) {
      const i = kind.members[m]
      const mark = E.handle(i) + 1
      const touching = touchable(E, i) && touchingEdge(E, i)
      if (touching && c.edge[i] !== mark) start(w.run, i, -1)
      c.edge[i] = touching ? mark : 0
    }
  }

  private detectKind(w: Watch, target: Kind, E: EntityStore, tick: number, start: TouchStart): void {
    const kind = w.run.kind
    const c = w.contacts
    const grid = target.grid
    if (grid.stale) grid.build(E, target.members, target.count, tick)
    const next = c.next
    next.clear()
    for (let m = 0; m < kind.count; m++) {
      const i = kind.members[m]
      if (!touchable(E, i)) continue
      grid.query(E, i, tick)
      const found = grid.found
      let first = -1
      for (let k = 0; k < grid.foundCount; k++) {
        const o = found[k]
        if (o === i || !touchable(E, o) || !shapesIntersect(E, i, o)) continue
        const key = i * SPAN + o
        const h = E.handle(o)
        next.set(key, h)
        if (first < 0 && c.pairs.get(key) !== h) first = o
      }
      if (first >= 0) start(w.run, i, first)
    }
    c.next = c.pairs
    c.pairs = next
  }
}
