/**
 * Turnstile, Cloudflare's check that a person (not a script) is sharing or
 * reporting. The site key comes from the API, and Cloudflare's script is
 * loaded only when a form that needs it opens.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { getLocale } from '../i18n'

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string
      callback(token: string): void
      'expired-callback'(): void
      'error-callback'(): void
      language: string
      size: 'flexible'
    },
  ): string
  reset(id: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let siteKey: Promise<string | null> | null = null
let script: Promise<TurnstileApi> | null = null

function loadSiteKey(): Promise<string | null> {
  siteKey ??= fetch(`${import.meta.env.BASE_URL}api/config`)
    .then((res) => (res.ok ? (res.json() as Promise<{ turnstileSiteKey: string | null }>) : null))
    .then((config) => config?.turnstileSiteKey ?? null)
    .catch(() => null)
  return siteKey
}

function loadScript(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT
    el.async = true
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
    el.onerror = () => reject(new Error('Turnstile did not load'))
    document.head.appendChild(el)
  })
  script.catch(() => (script = null))
  return script
}

export interface TurnstileState {
  /** The token once the check passes; null before, and after it expires or is used. */
  token: string | null
  /** The check could not be shown (no site key, or the script failed). */
  unavailable: boolean
  /** Starts a new check; call after a token has been sent, since each works once. */
  reset(): void
}

/** Shows the Turnstile check in `container` while `active`. */
export function useTurnstile(container: RefObject<HTMLElement | null>, active = true): TurnstileState {
  const [token, setToken] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const key = await loadSiteKey()
        if (!key) throw new Error('no Turnstile site key')
        const api = await loadScript()
        if (cancelled || !container.current) return
        const id = api.render(container.current, {
          sitekey: key,
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
          language: getLocale(),
          size: 'flexible',
        })
        widget.current = { api, id }
      } catch (err) {
        console.warn('Turnstile is unavailable', err)
        if (!cancelled) setUnavailable(true)
      }
    })()
    return () => {
      cancelled = true
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
      setToken(null)
    }
  }, [active, container])

  return {
    token,
    unavailable,
    reset: () => {
      setToken(null)
      if (widget.current) widget.current.api.reset(widget.current.id)
    },
  }
}
