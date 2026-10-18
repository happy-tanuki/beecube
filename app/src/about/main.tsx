import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale } from '../i18n'
import { About } from './About'
import '../base.css'
import './about.css'

document.documentElement.lang = getLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <About />
  </StrictMode>,
)
