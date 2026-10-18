/**
 * UI language. The locale is chosen once per page load (saved choice, then
 * the browser's languages, then English); changing it reloads the page, since
 * scratch-blocks reads its messages when blocks are created.
 *
 * To add a language: add a messages file like `ja.ts` and list it in LOCALES.
 * scratch-blocks ships its own translations for the built-in blocks.
 */
import { APP_ID } from '../brand'
import { en, type Messages } from './en'
import { ja } from './ja'
import { en as enPages, type Pages } from './pages/en'
import { ja as jaPages } from './pages/ja'

export const LOCALES = {
  en: { name: 'English', messages: en as Messages },
  ja: { name: '日本語', messages: ja },
} satisfies Record<string, { name: string; messages: Messages }>

export type Locale = keyof typeof LOCALES
export type MessageKey = keyof Messages['ui']

const STORAGE_KEY = `${APP_ID}.locale`

const isLocale = (s: string | null | undefined): s is Locale => !!s && Object.hasOwn(LOCALES, s)

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Storage unavailable (private mode, blocked site data): fall through.
  }
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

const current: Locale = detectLocale()

export function getLocale(): Locale {
  return current
}

/** Saves the choice and reloads; call `beforeReload` to flush unsaved state first. */
export function changeLocale(locale: Locale, beforeReload?: () => void): void {
  if (locale === current) return
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Without storage the choice can't survive the reload.
    return
  }
  beforeReload?.()
  location.reload()
}

/** Translates a UI message, filling `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = LOCALES[current].messages.ui[key] ?? en.ui[key]
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text
}

/** scratch-blocks messages for this project's own blocks, in the current locale. */
export function blockMessages(): Record<string, string> {
  return LOCALES[current].messages.blocks
}

const PAGES: Record<Locale, Pages> = { en: enPages, ja: jaPages }

/** The About page's text (about, privacy policy, terms of use) in the current locale. */
export function pageContent(): Pages {
  return PAGES[current]
}
