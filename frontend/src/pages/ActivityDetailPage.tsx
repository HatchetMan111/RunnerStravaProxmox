import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ActivityDetailData } from '../api/types'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'
import { Card, StatTile } from '../components/ui'
import { Icon } from '../components/Icon'
import { ActivityMap } from '../components/ActivityMap'
import { SeriesChart } from '../components/SeriesChart'
import { sportIcon } from './DashboardPage'
import {
  formatBpm,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
} from '../components/format'

function tilesPrefEnabled(): boolean {
  return localStorage.getItem('lt_map_tiles') !== '0'
}

export function ActivityDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [activity, setActivity] = useState<ActivityDetailData | null>(null)
  const [tilesOn, setTilesOn] = useState(tilesPrefEnabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api
      .get<ActivityDetailData>(`/api/v1/activities/${id}`)
      .then(setActivity)
      .catch((err: Error) => setError(err.message))
  }, [id])

  useEffect(load, [load])

  function toggleTiles(value: boolean) {
    setTilesOn(value)
    localStorage.setItem('lt_map_tiles', value ? '1' : '0')
  }

  if (error) return <p className="form-error">{error}</p>
  if (!activity) return <p className="muted">Lade …</p>

  const stream = activity.stream ?? {}
  const distances = ((stream.distance ?? []) as number[]).map((d) => d / 1000)
  const locatedPoints: Array<{ lat: number; lon: number }> =
    (stream.lat ?? [])
      .map((lat, i) => ({ lat, lon: (stream.lon ?? [])[i] }))
      .filter((p): p is { lat: number; lon: number } => p.lat !== null && p.lon != null)

  async function deleteActivity() {
    if (!confirm('Aktivität wirklich löschen?')) return
    await api.delete(`/api/v1/activities/${id}`)
    navigate('/')
  }

  return (
    <div>
      <div className="detail-header">
        <Link to="/activities" className="back-link">
          <Icon name="chevron-left" size={15} /> Alle Aktivitäten
        </Link>
        <div className="row-buttons" style={{ marginTop: 0 }}>
          {activity.has_stream && locatedPoints.length > 1 && (
            <a className="button-link" href={`/api/v1/activities/${id}/export.gpx`} download>
              <Icon name="download" size={15} /> GPX
            </a>
          )}
          <button className="danger" onClick={() => void deleteActivity()}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
        <span className="act-icon"><Icon name={sportIcon(activity.sport_type)} size={18} /></span>
        {activity.name}
      </h2>
      <div style={{ margin: '.25rem 0 .9rem' }}>
        <span className="detail-typechip">{SPORT_LABELS[activity.sport_type] ?? activity.sport_type}</span>
        <span className="muted" style={{ fontSize: '.86rem' }}>
          {formatDateTime(activity.start_time)}
          {activity.source_file_type === 'recording' ? ' · direkt aufgezeichnet' : ` · Import (${activity.source_file_type})`}
          {activity.timezone_name ? ` · ${activity.timezone_name}` : ''}
        </span>
      </div>

      <div className="stat-grid">
        <StatTile icon="route" label="Distanz" value={formatDistance(activity.distance_m)} accent />
        <StatTile icon="clock" label="Zeit bewegt" value={formatDuration(activity.moving_time_s)} />
        <StatTile icon="zap" label="Ø Pace" value={formatPace(activity.avg_speed_ms)} />
        <StatTile icon="heart" label="ø HF" value={formatBpm(activity.avg_hr)} />
        <StatTile icon="heart" label="max HF" value={formatBpm(activity.max_hr)} />
        <StatTile icon="trending-up" label="Höhen ↑" value={formatElevation(activity.elevation_gain_m)} />
        {activity.avg_power ? <StatTile icon="zap" label="ø Leistung" value={`${Math.round(activity.avg_power)} W`} /> : null}
        {activity.avg_cadence ? <StatTile icon="refresh" label="ø Kadenz" value={String(Math.round(activity.avg_cadence))} /> : null}
      </div>

      {activity.notes && (
        <Card title="Notizen" icon="edit">
          <p style={{ margin: 0 }}>{activity.notes}</p>
        </Card>
      )}

      <EditSection activity={activity} onSaved={load} />

      {locatedPoints.length > 1 && (
        <Card
          title="Karte"
          icon="map-pin"
          action={
            <button
              className={`chip ${tilesOn ? 'active' : ''}`}
              onClick={() => toggleTiles(!tilesOn)}
              title="Online-Kartenkacheln ein-/ausschalten"
            >
              {tilesOn ? 'Karte online' : 'Nur Track'}
            </button>
          }
        >
          <ActivityMap points={locatedPoints} tilesEnabled={tilesOn} />
          <p className="muted hint" style={{ marginTop: '.5rem' }}>
            {tilesOn
              ? 'Kacheln werden live von openstreetmap.org geladen (nur Kartenbilder – keine Trainingsdaten). Offline bleibt die Karte als Track erhalten.'
              : 'Offline-Ansicht ohne externen Abruf. Schalter oben aktiviert Online-Kacheln.'}
          </p>
        </Card>
      )}

      {activity.has_stream && (
        <>
          {(stream.alt?.length ?? 0) > 0 && (
            <Card title="Höhenprofil" icon="trending-up">
              <SeriesChart label="Höhe" unit="m" xs={distances} ys={(stream.alt ?? []) as Array<number | null>} color="#0d9488" area />
            </Card>
          )}
          {(stream.speed?.length ?? 0) > 0 && (
            <Card title="Pace-Verlauf" icon="zap">
              <SeriesChart
                label="Pace"
                unit="min/km"
                xs={distances}
                ys={speedToPace((stream.speed ?? []) as Array<number | null>)}
                color="#f97316"
                invertYLabel
                area
                formatY={(v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`}
              />
            </Card>
          )}
          {(stream.hr?.length ?? 0) > 0 && (
            <Card title="Herzfrequenz" icon="heart">
              <SeriesChart label="HF" unit="bpm" xs={distances} ys={(stream.hr ?? []) as Array<number | null>} color="#dc2626" area />
            </Card>
          )}
          {(stream.power?.length ?? 0) > 0 && (
            <Card title="Leistung" icon="zap">
              <SeriesChart label="Leistung" unit="W" xs={distances} ys={(stream.power ?? []) as Array<number | null>} color="#ca8a04" area />
            </Card>
          )}
        </>
      )}

      {activity.splits.length > 0 && (
        <Card title="Kilometer-Splits" icon="flag">
          <table className="table">
            <thead>
              <tr>
                <th>km</th>
                <th>Zeit</th>
                <th>Pace</th>
                <th>Rundenvergleich</th>
                <th>ø HF</th>
                <th>↑ m</th>
              </tr>
            </thead>
            <tbody>
              {activity.splits.map((split) => {
                const ratio = paceRatio(split.avg_speed_ms, activity.splits)
                return (
                  <tr key={split.index}>
                    <td><strong>{split.index}</strong></td>
                    <td>{formatDuration(split.duration_s)}</td>
                    <td>{formatPace(split.avg_speed_ms)}</td>
                    <td>
                      <div className="split-bar" title="Länge relativ zur schnellsten Runde">
                        <span style={{ width: `${ratio}%` }} />
                      </div>
                    </td>
                    <td>{formatBpm(split.avg_hr)}</td>
                    <td>{split.elevation_gain_m !== null ? Math.round(split.elevation_gain_m) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function speedToPace(speeds: Array<number | null>): Array<number | null> {
  return speeds.map((speed) => {
    if (speed === null || speed <= 0.2) return null
    return 1000 / speed / 60
  })
}

function paceRatio(speed: number | null, splits: Array<{ avg_speed_ms: number | null }>): number {
  if (!speed || speed <= 0) return 5
  const speeds = splits
    .map((s) => s.avg_speed_ms)
    .filter((s): s is number => s !== null && s > 0)
  const fastest = Math.max(...speeds, speed)
  return Math.max(5, Math.round((speed / fastest) * 100))
}

function EditSection({ activity, onSaved }: { activity: ActivityDetailData; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(activity.name)
  const [notes, setNotes] = useState(activity.notes)
  const [sportType, setSportType] = useState(activity.sport_type)

  useEffect(() => {
    setName(activity.name)
    setNotes(activity.notes)
    setSportType(activity.sport_type)
  }, [activity])

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ marginBottom: '1rem' }}>
        <Icon name="edit" size={15} /> Bearbeiten
      </button>
    )
  }

  const save = async () => {
    await api.patch(`/api/v1/activities/${activity.id}`, { name, notes, sport_type: sportType })
    setOpen(false)
    onSaved()
  }

  return (
    <div className="card edit-form">
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Sportart
        <select value={sportType} onChange={(e) => setSportType(e.target.value)}>
          {SPORT_TYPES.map((sport) => (
            <option key={sport} value={sport}>{SPORT_LABELS[sport]}</option>
          ))}
        </select>
      </label>
      <label>Notizen<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></label>
      <div className="row-buttons">
        <button className="primary" onClick={() => void save()}><Icon name="check" size={15} /> Speichern</button>
        <button onClick={() => setOpen(false)}>Abbrechen</button>
      </div>
    </div>
  )
}

