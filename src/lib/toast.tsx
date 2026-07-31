/**
 * A single global toast, like the prototype's. Any module can call toast(msg);
 * the <Toaster/> mounted once at the app root renders it.
 */

import { useEffect, useState } from 'react'

type Listener = (msg: string) => void
const listeners = new Set<Listener>()

export function toast(message: string): void {
  listeners.forEach((fn) => fn(message))
}

export function Toaster() {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const listener: Listener = (m) => {
      setMsg(m)
      setShow(true)
      clearTimeout(timer)
      timer = setTimeout(() => setShow(false), 2800)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className={`toast ${show ? 'show' : ''}`} role="status" aria-live="polite">
      {msg}
    </div>
  )
}
