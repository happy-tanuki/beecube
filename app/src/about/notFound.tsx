/**
 * The page Cloudflare Pages serves, with status 404, for any path that is
 * not a file or a function (404.html). Its being there also turns off Pages'
 * single-page-app fallback, which answered every path with the editor.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '../brand'
import { getLocale, t } from '../i18n'
import '../base.css'
import './about.css'

document.documentElement.lang = getLocale()
document.title = `${t('notFound.title')} - ${APP_NAME}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="about">
      <header className="about-bar">
        <a className="about-logo brand" href={import.meta.env.BASE_URL}>
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          {APP_NAME}
        </a>
      </header>
      <main className="about-main">
        <section className="about-page">
          <h1>{t('notFound.title')}</h1>
          <p>
            <a href={import.meta.env.BASE_URL}>{t('notFound.home', { app: APP_NAME })}</a>
          </p>
        </section>
      </main>
    </div>
  </StrictMode>,
)
