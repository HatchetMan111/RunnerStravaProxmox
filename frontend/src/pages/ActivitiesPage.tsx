import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ActivitySummary } from '../api/types'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'
import { formatDateTime, formatDistance, formatDuration, formatPace } from '../components/format'

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
      <h2>Aktivitäten</h2>
      <div className="filter-row">
        <input
          placeholder="Suche in Name/Notizen …"
          value={query}
          onChange={(e) => {
            setPage(1)
            setQuery(e.target.value)
          }}
        />
        <select
          value={sport}
          onChange={(e) => {
            setPage(1)
            setSport(e.target.value)
          }}
        >
          <option value="">Alle Sportarten</option>
          {SPORT_TYPES.map((s) => (
            <option key={s} value={s}>
              {SPORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {!activities && <p className="muted">Lade …</p>}
      {activities?.length === 0 && <p className="muted">Keine Aktivitäten gefunden.</p>}

      <ul className="activity-list">
        {(activities ?? []).map((activity) => (
          <li key={activity.id}>
            <Link to={`/activities/${activity.id}`}>
              <span className="act-name">
                {activity.name || '(ohne Namen)'}
                {activity.source_file_type === 'recording' && ' 📍'}
              </span>
              <span className="act-meta">
                {formatDateTime(activity.start_time)} ·{' '}
                {SPORT_LABELS[activity.sport_type] ?? activity.sport_type} ·{' '}
                {formatDistance(activity.distance_m)} · {formatDuration(activity.moving_time_s)} ·{' '}
                {formatPace(activity.avg_speed_ms)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="row-buttons">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          ← Zurück
        </button>
        <button onClick={() => setPage((p) => p + 1)} disabled={(activities?.length ?? 0) < 30}>
          Weiter →
        </button>
      </div>
    </div>
  )
}
