/**
 * Staff alert helpers: a soft bell chime (synthesised with the Web Audio API so
 * there's no asset to ship) plus the browser/OS notification banner. Both need a
 * one-time user gesture — sound because of the autoplay policy, banners because
 * the permission prompt must be user-initiated — so the portal wires them to a
 * "Turn on alerts" tap and the first touch anywhere.
 */

type WebkitWindow = typeof window & { webkitAudioContext?: typeof AudioContext }

let audioCtx: AudioContext | null = null

function ctx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
      if (!Ctx) return null
      audioCtx = new Ctx()
    }
    return audioCtx
  } catch {
    return null
  }
}

/** Unlock/resume the audio context on a user gesture (mobile autoplay policy). */
export function unlockAudio(): void {
  const c = ctx()
  if (c && c.state === 'suspended') void c.resume()
}

/** A gentle two-note "ding-dong" bell. */
export function playChime(): void {
  const c = ctx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const now = c.currentTime
  const notes = [784, 1046.5] // G5 → C6, a soft rising fourth
  notes.forEach((freq, i) => {
    const t = now + i * 0.16
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.9)
  })
}

/** True if the browser can show notification banners and permission is granted. */
export function notifyEnabled(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

/** True if the user has explicitly blocked notifications. */
export function notifyBlocked(): boolean {
  return 'Notification' in window && Notification.permission === 'denied'
}

/** Ask for notification permission (must be called from a user gesture). */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Show an OS/browser notification banner, if permitted. */
export function showBanner(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'hamsun-sop', renotify: true } as NotificationOptions)
    }
  } catch {
    /* some browsers throw if constructed outside a service worker — ignore */
  }
}
