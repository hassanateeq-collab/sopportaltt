import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// The .docx generator (@turbodocx/html-to-docx) embeds the SOP header logo via
// Node's Buffer and references `global`; neither exists in the browser, so we
// provide them before it runs (it's dynamically imported when saving an SOP).
const glb = globalThis as unknown as { Buffer?: unknown; global?: unknown }
if (!glb.Buffer) glb.Buffer = Buffer
if (!glb.global) glb.global = globalThis

// A lazily-imported chunk (e.g. the PDF libraries) 404s when the tab was opened
// before a redeploy — the old hashed filename no longer exists on the server.
// Reload once to pull the fresh index and asset hashes; the timestamp guard
// stops a reload loop if the asset is genuinely missing.
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('preload-reload-at') || 0)
  if (Date.now() - last < 10000) return
  sessionStorage.setItem('preload-reload-at', String(Date.now()))
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
