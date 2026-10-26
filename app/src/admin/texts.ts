/**
 * Every piece of text a person typed into a project: sprite, backdrop,
 * variable, list and message names, values, and text in blocks (say, ask,
 * custom block names, comments). Moderators read these to review a reported
 * project.
 */

/** Keys whose strings are machine data, not typed text. */
const SKIP_KEYS = new Set(['id', 'type', 'format', 'shape', 'color', 'languageVersion', 'argumentids', 'argumentdefaults', 'assetId', 'dataFormat', 'layout'])

const isMachineText = (s: string) => /^#[0-9a-f]{6}$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s) || s.trim() === ''

/** The distinct texts in a project, in the order they first appear. */
export function projectTexts(project: unknown): string[] {
  const found = new Set<string>()
  const walk = (value: unknown, key: string) => {
    if (SKIP_KEYS.has(key)) return
    if (typeof value === 'string') {
      if (!isMachineText(value)) found.add(value)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key)
    } else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) walk(v, k)
    }
  }
  const p = project as Record<string, unknown> | null
  if (!p) return []
  // Settings and extension ids are not typed by people; monitors are keys.
  for (const key of ['stage', 'sprites', 'backdrops', 'variables', 'lists', 'broadcasts']) walk(p[key], key)
  return [...found]
}
