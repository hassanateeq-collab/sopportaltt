/** Line icons ported from the prototype. */

export function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  )
}

export function TestIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9 5h6M9 3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V5H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  )
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 9a6 6 0 1 1 12 0c0 4.6 1.8 5.6 2 6H4c.2-.4 2-1.4 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  )
}

/*
 * Duotone section icons for the collapsible panel headers: a soft-brass filled
 * shape, a pine outline, and a brass accent — the portal's pine-and-brass
 * palette. Colours are the theme's fixed hexes so the two tones read clearly.
 */
const PINE = '#1e4d3f'
const BRASS = '#a07e2c'
const BRASS_SOFT = '#f5eedb'

export function SopSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <path d="M6 3h7l5 5v13H6z" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 3v5h5" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 13h6M9 16.5h4" stroke={PINE} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function TestSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" />
      <rect x="9" y="2.6" width="6" height="3.6" rx="1.1" fill="#fff" stroke={PINE} strokeWidth="1.6" />
      <path d="M8.6 13.2l2.1 2.1 4.2-4.5" fill="none" stroke={BRASS} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StaffSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <circle cx="9" cy="8.5" r="3.2" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" />
      <path d="M3.7 19c0-3 2.4-4.7 5.3-4.7s5.3 1.7 5.3 4.7" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.6" cy="9" r="2.3" fill="none" stroke={BRASS} strokeWidth="1.6" />
      <path d="M15.2 14.4c2.8.3 4.6 1.9 4.6 4.5" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ManagerSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <circle cx="8.5" cy="9" r="4.6" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" />
      <circle cx="8.5" cy="9" r="1.5" fill={BRASS} />
      <path d="M11.9 12.4l6.4 6.4M15.6 16.1l1.7-1.7M17.4 17.9l1.4-1.4" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AddSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" />
      <path d="M12 8v8M8 12h8" stroke={BRASS} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export function BranchSectionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sec-ico" aria-hidden>
      <path d="M4 21V9.6l8-5 8 5V21z" fill={BRASS_SOFT} stroke={PINE} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="10" y="14.5" width="4" height="6.5" fill="#fff" stroke={BRASS} strokeWidth="1.4" />
      <path d="M2.5 21h19" stroke={PINE} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
