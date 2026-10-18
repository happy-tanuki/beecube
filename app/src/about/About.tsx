/**
 * The About page (about.html): what the site is, the privacy policy
 * (#privacy) and the terms of use (#terms), from src/i18n/pages/.
 */
import { Fragment, useEffect, type ReactNode } from 'react'
import { APP_NAME, CONTACT, SOURCE_URL, X_ACCOUNT } from '../brand'
import { pageContent, t } from '../i18n'
import type { PageContent } from '../i18n/pages/en'

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** A link target: absolute URLs as they are, others relative to the app. */
const href = (url: string) => (/^(https?:|mailto:)/.test(url) ? url : `${import.meta.env.BASE_URL}${url}`)

/** Sections that appear only when brand.ts sets what they point to. */
const OPTIONAL_SECTIONS: Record<string, unknown> = { contact: CONTACT, news: X_ACCOUNT }

/** Text with `{app}`, `{contact}` and `{x}` filled in and `[text](url)` made into links. */
function rich(text: string): ReactNode[] {
  const contact = CONTACT ? `[${CONTACT.replace(/^mailto:/, '')}](${CONTACT})` : ''
  const x = X_ACCOUNT ? `[@${X_ACCOUNT}](https://x.com/${X_ACCOUNT})` : ''
  const filled = text.replaceAll('{app}', APP_NAME).replaceAll('{contact}', contact).replaceAll('{x}', x)
  const parts: ReactNode[] = []
  let last = 0
  for (const m of filled.matchAll(LINK)) {
    parts.push(filled.slice(last, m.index))
    parts.push(
      <a key={m.index} href={href(m[2])} {...(/^https?:/.test(m[2]) ? { target: '_blank', rel: 'noopener' } : {})}>
        {m[1]}
      </a>,
    )
    last = m.index + m[0].length
  }
  parts.push(filled.slice(last))
  return parts
}

function Page({ id, page }: { id: string; page: PageContent }) {
  return (
    <section id={id} className="about-page">
      <h1>{rich(page.title)}</h1>
      {page.updated && <p className="about-updated">{page.updated}</p>}
      {page.sections
        .filter((s) => !(s.id in OPTIONAL_SECTIONS) || OPTIONAL_SECTIONS[s.id])
        .map((s) => (
          <Fragment key={s.id}>
            <h2>{rich(s.heading)}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i}>{rich(p)}</p>
            ))}
            {s.id === 'source' && SOURCE_URL && (
              <p>
                <a href={SOURCE_URL}>{t('footer.source')}</a>
              </p>
            )}
          </Fragment>
        ))}
    </section>
  )
}

export function About() {
  const pages = pageContent()
  useEffect(() => {
    document.title = pages.about.title.replaceAll('{app}', APP_NAME)
    // The browser looked for #privacy or #terms before this page had rendered.
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [pages])
  return (
    <div className="about">
      <header className="about-bar">
        <a className="about-logo brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {APP_NAME}
        </a>
        <nav>
          <a href="#about">{t('about.about')}</a>
          <a href="#privacy">{t('about.privacy')}</a>
          <a href="#terms">{t('about.terms')}</a>
        </nav>
      </header>
      <main className="about-main">
        <Page id="about" page={pages.about} />
        <Page id="privacy" page={pages.privacy} />
        <Page id="terms" page={pages.terms} />
      </main>
    </div>
  )
}
