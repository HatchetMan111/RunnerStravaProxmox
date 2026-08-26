import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Card({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string
  icon?: IconName
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-header">
          <h3>
            {icon && <Icon name={icon} size={16} />}
            <span>{title}</span>
          </h3>
          {action}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatTile({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: IconName
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className={`stat-tile ${accent ? 'accent' : ''}`}>
      <div className="stat-icon">
        <Icon name={icon} size={18} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
      <span className="switch-text">
        <strong>{label}</strong>
        {hint && <span className="muted">{hint}</span>}
      </span>
    </label>
  )
}
