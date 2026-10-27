/**
 * Names in 3D model files, for the page: the library's models (Kenney's)
 * have their animations' and bones' names translated; any other model's
 * show as its file has them.
 */
import { hasMessage, t } from '../i18n'

const translated = (prefix: string, name: string): string => {
  const key = `${prefix}.${name}`
  return hasMessage(key) ? t(key) : name
}

export const clipLabel = (name: string): string => translated('clip', name)
export const boneLabel = (name: string): string => translated('bone', name)
