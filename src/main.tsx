import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

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
