import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshotVersion } from '../data/store'

/**
 * Re-render whenever the data layer commits. Screens read fresh values through
 * `read.*` on each render; this hook just tells React when to run again.
 */
export function useStore(): number {
  return useSyncExternalStore(subscribe, getSnapshotVersion, getSnapshotVersion)
}
