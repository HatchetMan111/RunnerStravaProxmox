import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ActivitySummary } from '../api/types'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { Icon } from '../components/Icon'
import { sportIcon } from './DashboardPage'
import {
  dateShort,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPace,
} from '../components/format'

export function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivitySummary[] | null>(null)
  const [sport, setSport] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), per_page: '30' })
    if (sport) params.set('sport_type', sport)
    if (query.trim()) params.set('q', query.trim())
    void api
      .get<ActivitySummary[]>(`/api/v1/activities?${params.toString()}`)
      .then(setActivities)
      .catch(() => setActivities([]))
  }, [sport, query, page])

  return (
    <div>
      <PageHeader title="Aktivitäten" />

      <div className="filter-row">
        <input
          placeholder="Name, Notizen …"
          value={query}
          onChange={(e) => {
            setPage(1)
            setQuery(e.target.value)
          }}
        />
      </div>
      <div className="chips">
        <button className={`chip ${sport === '' ? 'active' : ''}`} onClick={() => { setPage(1); setSport('') }}>
          <Icon name="list" size={13} /> Alle
        </button>
        {SPORT_TYPES.map((s) => (
          <button
            key={s}
            className={`chip ${sport === s ? 'active' : ''}`}
            onClick={() => { setPage(1); setSport(s) }}
          >
            <Icon name={sportIcon(s)} size={13} /> {SPORT_LABELS[s]}
          </button>
        ))}
      </div>

      <div style={{ height: '.8rem' }} />

      {!activities && <p className="muted">Lade …</p>}
      {activities?.length === 0 && (
        <EmptyState
          icon="route"
          title="Keine Aktivitäten gefunden"
          hint={query || sport ? 'Filter anpassen oder zurücksetzen.' : 'Erste Aufzeichnung starten oder Dateien importieren.'}
        />
      )}

      {activities && activities.length > 0 && (
        <ul className="activity-list">
          {activities.map((activity) => (
            <li key={activity.id}>
              <Link to={`/activities/${activity.id}`}>
                <span className="act-icon"><Icon name={sportIcon(activity.sport_type)} size={19} /></span>
                <span style={{ minWidth: 0 }}>
                  <span className="act-name">
                    {activity.name || '(ohne Namen)'}
                    {activity.source_file_type === 'recording' && ' 📍'}
                  </span>
                  <span className="act-meta">{formatDateTime(activity.start_time)}</span>
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

      <div className="row-buttons" style={{ justifyContent: 'center' }}>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          <Icon name="chevron-left" size={15} /> Zurück
        </button>
        <span className="muted" style={{ alignSelf: 'center', fontSize: '.85rem' }}>Seite {page}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={(activities?.length ?? 0) < 30}>
          Weiter <Icon name="chevron-right" size={15} />
        </button>
      </div>
      <p className="muted hint" style={{ textAlign: 'right', marginRight: '.3rem' }}>
        Sortiert nach {dateShort(new Date().toISOString())} · neueste zuerst
      </p>
    </div>
  )
}

export function ActivityListEmptyHint(): JSX.Element {
  return <Card title="Tipp" icon="upload"><p className="muted hint">Dateien mit GPX/TCX/FIT unter „Import“ laden.</p></Card>
}
