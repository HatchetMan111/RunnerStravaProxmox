import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ActivityDetailData } from '../api/types'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'
import { SeriesChart } from '../components/SeriesChart'
import { TrackMap } from '../components/TrackMap'
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
} from '../components/format'

export function ActivityDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [activity, setActivity] = useState<ActivityDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api
      .get<ActivityDetailData>(`/api/v1/activities/${id}`)
      .then(setActivity)
      .catch((err: Error) => setError(err.message))
  }, [id])

  useEffect(load, [load])

  if (error) return <p className="form-error">{error}</p>
  if (!activity) return <p className="muted">Lade …</p>

  const stream = activity.stream ?? {}
  const times = (stream.time ?? []) as number[]
  const distances = ((stream.distance ?? []) as number[]).map((d) => d / 1000)
  const startEpoch = times[0] ?? 0
  const minutesFromStart = times.map((t) => (t - startEpoch) / 60)

  const deleteActivity = async () => {
    if (!confirm('Aktivität wirklich löschen?')) return
    await api.delete(`/api/v1/activities/${id}`)
    navigate('/')
  }

  return (
    <div>
      <div className="detail-header">
        <Link to="/activities">← Alle Aktivitäten</Link>
        <div className="row-buttons">
          {activity.has_stream && (
            <a
              className="button-link"
              href={`/api/v1/activities/${id}/export.gpx`}
              download
            >
              GPX exportieren
            </a>
          )}
          <button className="danger" onClick={() => void deleteActivity()}>
            Löschen
          </button>
        </div>
      </div>

      <h2>{activity.name}</h2>
      <p className="muted">
        {formatDateTime(activity.start_time)} · {SPORT_LABELS[activity.sport_type] ?? activity.sport_type}
        {activity.source_file_type === 'recording' ? ' · direkt aufgezeichnet' : ` · Import (${activity.source_file_type})`}
        {activity.original_filename ? ` · ${activity.original_filename}` : ''}
        {activity.timezone_name ? ` · ${activity.timezone_name}` : ''}
      </p>

      <div className="stat-grid">
        <Stat label="Distanz" value={formatDistance(activity.distance_m)} />
        <Stat label="Zeit (bewegt)" value={formatDuration(activity.moving_time_s)} />
        <Stat label="Gesamtzeit" value={formatDuration(activity.elapsed_time_s)} />
        <Stat label="Ø Pace" value={formatPace(activity.avg_speed_ms)} />
        <Stat label="ø HF" value={activity.avg_hr ? `${Math.round(activity.avg_hr)} bpm` : '-'} />
        <Stat label="max HF" value={activity.max_hr ? `${Math.round(activity.max_hr)} bpm` : '-'} />
        <Stat label="↑ Höhenmeter" value={formatElevation(activity.elevation_gain_m)} />
        <Stat label="↓ Höhenmeter" value={formatElevation(activity.elevation_loss_m)} />
        {activity.avg_power ? <Stat label="ø Leistung" value={`${Math.round(activity.avg_power)} W`} /> : null}
        {activity.avg_cadence ? <Stat label="ø Kadenz" value={String(Math.round(activity.avg_cadence))} /> : null}
      </div>

      {activity.notes && (
        <p>
          <strong>Notizen:</strong> {activity.notes}
        </p>
      )}

      <EditForm activity={activity} onSaved={load} />

      {activity.has_stream && locatedCount(stream) > 1 && (
        <>
          <h3>Karte</h3>
          <TrackMap points={toPoints(stream)} />
        </>
      )}

      {activity.has_stream && (
        <>
          <h3>Höhenprofil</h3>
          <SeriesChart
            label="Höhe"
            unit="m"
            xs={distances}
            ys={(stream.alt ?? []) as Array<number | null>}
            color="#34d399"
          />
          <h3>Pace</h3>
          <SeriesChart
            label="Pace"
            unit="min/km"
            xs={distances}
            ys={speedToPace((stream.speed ?? []) as Array<number | null>)}
            color="#38bdf8"
            invertYLabel
            formatY={(v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`}
          />
          {(stream.hr?.length ?? 0) > 0 && (
            <>
              <h3>Herzfrequenz</h3>
              <SeriesChart
                label="HF"
                unit="bpm"
                xs={minutesFromStart.length === distances.length ? distances : minutesFromStart}
                ys={(stream.hr ?? []) as Array<number | null>}
                color="#f87171"
              />
            </>
          )}
          {(stream.power?.length ?? 0) > 0 && (
            <>
              <h3>Leistung</h3>
              <SeriesChart
                label="Leistung"
                unit="W"
                xs={distances}
                ys={(stream.power ?? []) as Array<number | null>}
                color="#fbbf24"
              />
            </>
          )}
        </>
      )}

      {activity.splits.length > 0 && (
        <>
          <h3>Kilometer-Splits</h3>
          <table className="table">
            <thead>
              <tr>
                <th>km</th>
                <th>Zeit</th>
                <th>Pace</th>
                <th>ø HF</th>
                <th>↑ m</th>
              </tr>
            </thead>
            <tbody>
              {activity.splits.map((split) => (
                <tr key={split.index}>
                  <td>{split.index}</td>
                  <td>{formatDuration(split.duration_s)}</td>
                  <td>{formatPace(split.avg_speed_ms)}</td>
                  <td>{split.avg_hr ? Math.round(split.avg_hr) : '-'}</td>
                  <td>{split.elevation_gain_m !== null ? Math.round(split.elevation_gain_m) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function EditForm({
  activity,
  onSaved,
}: {
  activity: ActivityDetailData
  onSaved: () => void
}) {
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
      <p>
        <button onClick={() => setOpen(true)}>Bearbeiten</button>
      </p>
    )
  }

  const save = async () => {
    await api.patch(`/api/v1/activities/${activity.id}`, {
      name,
      notes,
      sport_type: sportType,
    })
    setOpen(false)
    onSaved()
  }

  return (
    <div className="edit-form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Sportart
        <select value={sportType} onChange={(e) => setSportType(e.target.value)}>
          {SPORT_TYPES.map((sport) => (
            <option key={sport} value={sport}>
              {SPORT_LABELS[sport]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notizen
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
      <div className="row-buttons">
        <button className="primary" onClick={() => void save()}>
          Speichern
        </button>
        <button onClick={() => setOpen(false)}>Abbrechen</button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function locatedCount(stream: Record<string, Array<number | null>>): number {
  const lat = stream.lat ?? []
  return lat.filter((v) => v !== null).length
}

function toPoints(stream: Record<string, Array<number | null>>) {
  const lat = stream.lat ?? []
  const lon = stream.lon ?? []
  return lat.map((v, i) => ({ lat: v, lon: lon[i] ?? null }))
}

function speedToPace(speeds: Array<number | null>): Array<number | null> {
  return speeds.map((speed) => {
    if (speed === null || speed <= 0.2) return null
    return 1000 / speed / 60
  })
}
