import { useEffect, useRef } from 'react'

/**
 * Make the browser Back button unwind in-app navigation.
 *
 * `depth` is how deep the current view is (0 = home). Each time it increases we
 * push a history entry; the browser Back button then fires popstate, and we call
 * `onPop` to step back one level. No history entry is popped programmatically, so
 * Back can never accidentally leave the app while there's depth to unwind.
 */
export function useBackNav(depth: number, onPop: () => void): void {
  const prev = useRef(0)
  const cb = useRef(onPop)
  cb.current = onPop

  useEffect(() => {
    if (depth > prev.current) {
      try {
        window.history.pushState({ hamsunNav: Date.now() }, '')
      } catch {
        /* history unavailable — Back just won't unwind */
      }
    }
    prev.current = depth
  }, [depth])

  useEffect(() => {
    const handler = () => cb.current()
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])
}
