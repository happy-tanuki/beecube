import type { ExtensionSpec } from '../engine/extension'
import { physicsExtension } from './physics'

/** Extensions shipped with the editor, in the order the extension menu lists them. */
export const BUILTIN_EXTENSIONS: ExtensionSpec[] = [physicsExtension]

export function findExtension(id: string): ExtensionSpec | undefined {
  return BUILTIN_EXTENSIONS.find((e) => e.id === id)
}
