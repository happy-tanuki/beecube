import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale } from '../i18n'
import { Player } from './Player'
import '../base.css'
import '../stage.css'
import './player.css'

document.documentElement.lang = getLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Player />
  </StrictMode>,
)
