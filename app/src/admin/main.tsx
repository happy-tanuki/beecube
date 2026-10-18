import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale } from '../i18n'
import { Admin } from './Admin'
import '../base.css'
import './admin.css'

document.documentElement.lang = getLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
)
