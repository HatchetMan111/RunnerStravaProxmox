import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrackMap } from '../components/TrackMap'
import { formatDistance } from '../components/format'
import { queueActivity } from '../sync/engine'
import { clearDraft } from '../db/idb'
import { useRecorder } from '../recorder/useRecorder'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'

export function RecordPage() {
  const navigate = useNavigate()
  const recorder = useRecorder()
  const [sportType, setSportType] = useState('running')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [queued, setQueued] = useState(false)

  const distanceM = useMemo(() => approxDistance(recorder.points), [recorder.points])

  const startRecording = () => {
    localStorage.setItem('lt_sport', sportType)
    recorder.start()
    setQueued(false)
  }

  const finishRecording = () => {
    const points = recorder.finish()
    if (points.length === 0) return
    const payload = {
      sport_type: sportType,
      name: name.trim(),
      notes: notes.trim(),
      timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      started_at: new Date(points[0].t * 1000).toISOString(),
      points,
    }
    void queueActivity(payload, `Aufzeichnung ${new Date().toLocaleString('de-DE')}`).then(() => {
      setQueued(true)
      setTimeout(() => navigate('/'), 1200)
    })
  }

  const discardAll = () => {
    void recorder.discard().then(() => void clearDraft())
  }

  if (recorder.status === 'idle' || recorder.status === 'finished') {
    return (
      <div>
        <h2>Aufzeichnen</h2>
        {recorder.resumableDraft && recorder.status === 'idle' && (
          <div className="notice">
            Es gibt eine nicht gespeicherte Aufzeichnung.{' '}
            <button onClick={() => void recorder.resumeDraft()}>Fortsetzen</button>{' '}
            <button className="danger" onClick={discardAll}>
              Verwerfen
            </button>
          </div>
        )}
        {recorder.status === 'finished' && (
          <p className="muted">
            {queued ? 'Gespeichert – wird synchronisiert …' : ''}
          </p>
        )}
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
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Abendlauf im Park" />
        </label>
        <label>
          Notizen (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <button className="primary big" onClick={startRecording} disabled={!!recorder.error}>
          ▶ Aufzeichnung starten
        </button>
        {recorder.error && <div className="form-error">{recorder.error}</div>}
        <p className="muted hint">
          Die Aufzeichnung läuft im Vordergrund des Browsers. Bildschirm eingeschaltet lassen;
          die App darf nicht geschlossen werden. Punkte werden laufend lokal gespeichert.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h2>Aufzeichnung läuft</h2>
      <div className={`recorder-timer ${recorder.status === 'paused' ? 'paused' : ''}`}>
        {formatClock(recorder.elapsedS)}
      </div>
      <div className="stat-grid">
        <StatCard label="Distanz" value={formatDistance(distanceM)} />
        <StatCard label="Punkte" value={String(recorder.points.length)} />
        <StatCard label="Status" value={recorder.status === 'paused' ? 'Pausiert' : 'Aufzeichnung'} />
      </div>
      {recorder.points.length > 1 && <TrackMap points={recorder.points} height={240} />}
      <div className="row-buttons">
        {recorder.status === 'recording' ? (
          <button onClick={recorder.pause}>⏸ Pause</button>
        ) : (
          <button onClick={recorder.resume}>▶ Weiter</button>
        )}
        <button className="danger" onClick={discardAll}>
          Verwerfen
        </button>
        <button className="primary" onClick={finishRecording} disabled={recorder.points.length < 2}>
          ⏹ Beenden & speichern
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function approxDistance(points: Array<{ lat: number | null; lon: number | null }>): number {
  const R = 6371000
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) continue
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLon = ((b.lon - a.lon) * Math.PI) / 180
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
    total += 2 * R * Math.asin(Math.sqrt(x))
  }
  return total
}
