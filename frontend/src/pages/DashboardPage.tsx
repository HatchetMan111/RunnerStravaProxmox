import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { StatsOverview, ActivitySummary } from '../api/types'
import { SPORT_LABELS } from '../api/types'
import { formatDistance, formatDuration } from '../components/format'

export function DashboardPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [recent, setRecent] = useState<ActivitySummary[]>([])

  useEffect(() => {
    void api.get<StatsOverview>('/api/v1/stats/overview').then(setStats)
    void api.get<ActivitySummary[]>('/api/v1/activities?per_page=5').then(setRecent)
  }, [])

  if (!stats) return <p className="muted">Lade Statistiken …</p>

  const maxWeekly = Math.max(1, ...stats.weekly_last_12.map((w) => w.distance_m))

  return (
    <div>
      <h2>Übersicht</h2>
      <div className="stat-grid">
        <StatCard label="Aktivitäten" value={String(stats.totals.count)} />
        <StatCard label="Distanz" value={formatDistance(stats.totals.distance_m)} />
        <StatCard label="Zeit (bewegt)" value={formatDuration(stats.totals.moving_time_s)} />
        <StatCard label="Höhenmeter" value={`${Math.round(stats.totals.elevation_gain_m)} m`} />
      </div>

      <h3>Wochen (12 Wochen)</h3>
      {stats.weekly_last_12.length === 0 && <p className="muted">Noch keine Aktivitäten.</p>}
      <div className="bars">
        {stats.weekly_last_12.map((week) => (
          <div key={week.week_start} className="bar-col" title={`KW ab ${week.week_start}: ${formatDistance(week.distance_m)}`}>
            <div
              className="bar"
              style={{ height: `${Math.max(4, (week.distance_m / maxWeekly) * 120)}px` }}
            />
            <span className="bar-label">{week.week_start.slice(5).replace('-', '/')}</span>
          </div>
        ))}
      </div>

      <div className="two-col">
        <section>
          <h3>Nach Sportart</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Sportart</th>
                <th>Anzahl</th>
                <th>Distanz</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.by_sport).map(([sport, row]) => (
                <tr key={sport}>
                  <td>{SPORT_LABELS[sport] ?? sport}</td>
                  <td>{row.count}</td>
                  <td>{formatDistance(row.distance_m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Bestzeiten</h3>
          {Object.entries(stats.records).length === 0 && <p className="muted">-</p>}
          <ul className="record-list">
            {RECORD_LABELS.map(([key, label]) => {
              const record = stats.records[key]
              if (!record) return null
              return (
                <li key={key}>
                  <strong>{label}:</strong> {formatDuration(record.duration_s)}{' '}
                  <Link to={`/activities/${record.activity_id}`}>{record.name}</Link>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <h3>Letzte Aktivitäten</h3>
      <ul className="activity-list">
        {recent.map((activity) => (
          <li key={activity.id}>
            <Link to={`/activities/${activity.id}`}>
              <span className="act-name">{activity.name}</span>
              <span className="act-meta">
                {new Date(activity.start_time + 'Z').toLocaleDateString('de-DE')} ·{' '}
                {SPORT_LABELS[activity.sport_type] ?? activity.sport_type} ·{' '}
                {formatDistance(activity.distance_m)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const RECORD_LABELS: Array<[string, string]> = [
  ['fastest_1km_split', 'Schnellster km'],
  ['best_5km_activity', 'Bestes 5 km'],
  ['best_10km_activity', 'Bestes 10 km'],
]

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
