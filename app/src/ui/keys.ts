/** Keyboard input for "when key pressed" and "key pressed?", shared by the editor and the player. */
import type { Runtime } from '../engine/runtime'

const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  ArrowUp: 'up arrow',
  ArrowDown: 'down arrow',
  ArrowLeft: 'left arrow',
  ArrowRight: 'right arrow',
}

/** Maps a KeyboardEvent to Scratch's key names ("space", "up arrow", "a", ...). */
function scratchKey(e: KeyboardEvent): string | null {
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key]
  if (e.key.length === 1) return e.key.toLowerCase()
  return null
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    !!target.closest('.blocklyWidgetDiv, .blocklyDropDownDiv')
  )
}

/** Sends the page's key presses to the runtime. Returns a function that stops listening. */
export function listenKeys(rt: Runtime): () => void {
  const down = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const key = scratchKey(e)
    if (!key) return
    if (key === 'space' || key.endsWith('arrow')) e.preventDefault()
    if (!e.repeat) rt.keyPressed(key)
  }
  const up = (e: KeyboardEvent) => {
    const key = scratchKey(e)
    if (key) rt.keyReleased(key)
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
  }
}
