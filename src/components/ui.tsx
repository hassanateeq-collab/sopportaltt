import type { ReactNode } from 'react'
import type { CertStatus } from '../types'
import { certStatusLabel } from '../lib/certs'

export function TopBar({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  actions?: ReactNode
}) {
  return (
    <header className="topbar">
      {onBack && (
        <button className="topbar__back" onClick={onBack} aria-label="Back">
          ‹
        </button>
      )}
      <div className="topbar__titles">
        <div className="topbar__title">{title}</div>
        {subtitle && <div className="topbar__sub">{subtitle}</div>}
      </div>
      {actions && <div className="topbar__actions">{actions}</div>}
    </header>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'brand' | 'accent'
  children: ReactNode
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function CertBadge({ status }: { status: CertStatus }) {
  const tone = status === 'valid' ? 'ok' : status === 'expiring_soon' ? 'warn' : status === 'expired' ? 'bad' : 'neutral'
  return <Badge tone={tone}>{certStatusLabel(status)}</Badge>
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok'
  children: ReactNode
}) {
  const icon = tone === 'bad' ? '⚠' : tone === 'warn' ? '⚠' : tone === 'ok' ? '✓' : 'ℹ'
  return (
    <div className={`notice notice--${tone}`}>
      <span aria-hidden>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export function Empty({ icon = '—', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <div style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>{title}</div>
      {children && <div className="tiny" style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && (
        <span className="tiny" style={{ display: 'block', marginTop: 5 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden />
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="iconbtn" style={{ background: 'var(--wash)', color: 'var(--ink)' }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
