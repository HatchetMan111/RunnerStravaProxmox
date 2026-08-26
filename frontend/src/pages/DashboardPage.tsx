import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { StatsOverview, ActivitySummary } from '../api/types'
import { SPORT_LABELS } from '../api/types'
import { Card, PageHeader, StatTile, EmptyState } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { dateShort, formatDistance, formatDuration, formatPace } from '../components/format'

export function DashboardPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [recent, setRecent] = useState<ActivitySummary[] | null>(null)

  useEffect(() => {
    void api.get<StatsOverview>('/api/v1/stats/overview').then(setStats)
    void api.get<ActivitySummary[]>('/api/v1/activities?per_page=6').then(setRecent).catch(() => setRecent([]))
  }, [])

  if (!stats) return <p className="muted">Lade Statistiken …</p>

  const weeks = stats.weekly_last_12
  const lastWeek = weeks[weeks.length - 1]
  const maxWeekly = Math.max(1, ...weeks.map((w) => w.distance_m))
  const records = Object.entries(stats.records ?? {})

  return (
    <div>
      <PageHeader title="Übersicht" subtitle="Deine Trainingsdaten – komplett lokal" />

      <div className="stat-grid">
        <StatTile icon="route" label="Aktivitäten" value={String(stats.totals.count)} accent />
        <StatTile icon="trending-up" label="Distanz" value={formatDistance(stats.totals.distance_m)} />
        <StatTile icon="clock" label="Zeit bewegt" value={formatDuration(stats.totals.moving_time_s)} />
        <StatTile icon="activity" label="Höhen ↑" value={`${Math.round(stats.totals.elevation_gain_m)} m`} />
      </div>

      <Card title="Letzte 12 Wochen" icon="calendar">
        {weeks.length === 0 ? (
          <EmptyState icon="flag" title="Noch keine Aktivitäten" hint="Starte deine erste Aufzeichnung oder importiere eine Datei." />
        ) : (
          <>
            {lastWeek && (
              <div className="stat-grid" style={{ marginBottom: '0.9rem' }}>
                <StatTile
                  icon="zap"
                  label={`Woche ab ${lastWeek.week_start.slice(8)}.${lastWeek.week_start.slice(5, 7)}.`}
                  value={formatDistance(lastWeek.distance_m)}
                  accent
                />
                <StatTile icon="check" label="Einheiten" value={String(lastWeek.count)} />
              </div>
            )}
            <div className="bars">
              {weeks.map((week) => (
                <div
                  key={week.week_start}
                  className="bar-col"
                  title={`ab ${week.week_start}: ${formatDistance(week.distance_m)}`}
                >
                  <em>{Math.round((week.distance_m / maxWeekly) * 100) || 0}%</em>
                  <div className="bar" style={{ height: `${Math.max(4, (week.distance_m / maxWeekly) * 100)}px` }} />
                  <span className="bar-label">{week.week_start.slice(8)}.{week.week_start.slice(5, 7)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="two-col">
        <Card title="Nach Sportart" icon="list">
          {Object.keys(stats.by_sport).length === 0 ? (
            <p className="muted">–</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Sportart</th>
                  <th>Unit.</th>
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
          )}
        </Card>

        <Card title="Bestzeiten" icon="trophy">
          {records.every(([, rec]) => !rec) ? (
            <p className="muted">Sobald Läufe mit Splits vorliegen, erscheinen Bestzeiten hier.</p>
          ) : (
            <div>
              {RECORD_ROWS.map(([key, label]) => {
                const record = stats.records[key]
                if (!record) return null
                return (
                  <div key={key} className="record-item">
                    <span className="record-medal"><Icon name="trophy" size={17} /></span>
                    <div>
                      <strong style={{ fontSize: '.88rem' }}>{label}</strong>
                      <br />
                      <Link to={`/activities/${record.activity_id}`}>{record.name}</Link>
                    </div>
                    <span className="rec-value">{formatDuration(record.duration_s)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <Card title="Neueste Aktivitäten" icon="home" action={<Link to="/activities" className="button-link">Alle →</Link>}>
        {!recent ? (
          <p className="muted">Lade …</p>
        ) : recent.length === 0 ? (
          <EmptyState icon="route" title="Noch nichts aufgezeichnet" hint="Aufzeichnen-Tab drücken und loslaufen." />
        ) : (
          <ul className="activity-list">
            {recent.map((activity) => (
              <li key={activity.id}>
                <Link to={`/activities/${activity.id}`}>
                  <span className="act-icon"><Icon name={sportIcon(activity.sport_type)} size={19} /></span>
                  <span>
                    <span className="act-name">{activity.name}</span>
                    <span className="act-meta">
                      {dateShort(activity.start_time + '')} · {SPORT_LABELS[activity.sport_type] ?? activity.sport_type}
                    </span>
                  </span>
                  <span className="act-stats">
                    <div><strong>{formatDistance(activity.distance_m)}</strong><span>Distanz</span></div>
                    <div><strong>{formatDuration(activity.moving_time_s)}</strong><span>Zeit</span></div>
                    <div className="hide-xs"><strong>{formatPace(activity.avg_speed_ms)}</strong><span>Pace</span></div>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

const RECORD_ROWS: Array<[string, string]> = [
  ['fastest_1km_split', 'Schnellster km'],
  ['best_5km_activity', 'Bestes 5 km'],
  ['best_10km_activity', 'Bestes 10 km'],
]

export function sportIcon(sport: string): IconName {
  switch (sport) {
    case 'running':
      return 'route'
    case 'cycling':
      return 'zap'
    case 'hiking':
      return 'trending-up'
    case 'swimming':
      return 'activity'
    default:
      return 'map-pin'
  }
}
