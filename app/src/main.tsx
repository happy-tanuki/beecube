import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { logicPlaceFromUrl, runLogicTrial } from './bench/logicTrial'
import { SCENARIOS } from './bench/scenarios'
import { applyBlocksLocale } from './blocks/setup'
import { getLocale } from './i18n'
import { App } from './ui/App'
import './base.css'
import './stage.css'
import './styles.css'

document.documentElement.lang = getLocale()
// Before App: the project store creates blocks' default text on load.
applyBlocksLocale()

const root = document.getElementById('root')!
const trialScenario = SCENARIOS.find((s) => s === new URLSearchParams(window.location.search).get('bench')?.toUpperCase())
const logicPlace = logicPlaceFromUrl()
if (trialScenario && logicPlace) {
  void runLogicTrial(root, trialScenario, logicPlace)
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
