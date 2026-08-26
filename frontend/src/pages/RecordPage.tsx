import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrackMap } from '../components/TrackMap'
import { Icon } from '../components/Icon'
import { Card, PageHeader } from '../components/ui'
import { formatDistance } from '../components/format'
import { queueActivity } from '../sync/engine'
import { useRecorder } from '../recorder/useRecorder'
import { SPORT_LABELS, SPORT_TYPES } from '../api/types'

export function RecordPage() {
  const navigate = useNavigate()
  const recorder = useRecorder()
  const [sportType, setSportType] = useState('running')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')

  const distanceM = useMemo(() => approxDistance(recorder.points), [recorder.points])
  const { accuracy } = recorder
  const live = recorder.status === 'recording' || recorder.status === 'paused'

  const startRecording = () => {
    localStorage.setItem('lt_sport', sportType)
    recorder.start()
  }

  const finishRecording = () => {
    const pts = recorder.finish()
    if (pts.length < 2) return
    void queueActivity(
      {
        sport_type: sportType,
        name: name.trim(),
        notes: notes.trim(),
        timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        started_at: new Date(pts[0].t * 1000).toISOString(),
        points: pts,
      },
      `Aufzeichnung ${new Date().toLocaleString('de-DE')}`
    ).then(() => {
      setTimeout(() => navigate('/'), 1100)
    })
  }

  if (!live && recorder.status !== 'finished') {
    return (
      <div>
        <PageHeader title="Aufzeichnen" subtitle="GPS-Aufzeichnung direkt im Browser" />

        {recorder.gpsPhase === 'insecure' && (
          <div className="form-error">
            <Icon name="alert" size={18} />
            <div>
              <strong>GPS braucht HTTPS:</strong> {recorder.gpsMessage}
              <br />
              <span className="muted">
                Tipp: über einen Reverse Proxy mit Zertifikat oder via <code>ssh -L 8080:localhost:8080 host</code> und
                {' '}<code>http://localhost:8080</code> öffnen.
              </span>
            </div>
          </div>
        )}

        {recorder.resumableDraft && (
          <div className="notice">
            <Icon name="refresh" size={17} />
            <div>
              Ungespeicherte Aufzeichnung gefunden.{' '}
              <button onClick={() => void recorder.resumeDraft()}>Fortsetzen</button>{' '}
              <button className="danger" onClick={() => void recorder.discard()}>Verwerfen</button>
            </div>
          </div>
        )}

        <Card title="Sportart & Details" icon="sliders">
          <label>
            Sportart
            <select value={sportType} onChange={(e) => setSportType(e.target.value)}>
              {SPORT_TYPES.map((sport) => (
                <option key={sport} value={sport}>{SPORT_LABELS[sport]}</option>
              ))}
            </select>
          </label>
          <label>
            Name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Abendrunde im Park" />
          </label>
          <label>
            Notizen (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>

          {!(recorder.gpsPhase === 'insecure') && (
            <>
              <button className="energy big" onClick={startRecording}>
                <Icon name="record" size={18} /> Aufzeichnung starten
              </button>
              <p className="muted hint" style={{ marginTop: '.6rem' }}>
                Bildschirm sollte an bleiben; Punkte werden laufend lokal gespeichert – auch bei
                Verbindungsabbruch. Beim ersten Start fragt der Browser nach der Standortfreigabe.
              </p>
            </>
          )}
        </Card>
      </div>
    )
  }

  const lockProgress =
    recorder.gpsPhase === 'locked'
      ? 100
      : Math.max(8, Math.min(92, accuracy != null ? (30 / Math.max(accuracy, 31)) * 100 : 12))

  return (
    <div>
      <PageHeader title="Aufzeichnung läuft" />

      <div className={`recorder-hero ${recorder.status === 'paused' ? 'paused' : ''}`}>
        <div className="recorder-timer">{formatClock(recorder.elapsedS)}</div>
        <div className="recorder-status-row">
          {recorder.status === 'paused' ? (
            <><span className="dot pulse" /> Pausiert</>
          ) : (
            <><span className="dot pulse" /> Aufzeichnung · GPS&nbsp;
              {recorder.gpsPhase === 'locked' ? 'aktiv' : 'sucht'}
            </>
          )}
        </div>
        <div className="gps-meter">
          <span style={{ width: `${lockProgress}%`, background: recorder.gpsPhase === 'locked' ? '#5eead4' : 'rgba(255,255,255,.55)' }} />
        </div>
        {(recorder.gpsMessage || recorder.accuracy !== null) && (
          <div style={{ fontSize: '.78rem', marginTop: '.35rem', color: '#99f6e4' }}>
            {recorder.gpsMessage ?? ''}{' '}
            {recorder.accuracy !== null && `· Genauigkeit ±${Math.round(recorder.accuracy)} m`}
          </div>
        )}
      </div>

      <div className="stat-grid">
        <StatMini icon="route" label="Distanz" value={formatDistance(distanceM)} />
        <StatMini icon="map-pin" label="Punkte" value={String(recorder.points.length)} />
        <StatMini icon="zap" label="Ø Pace" value={paceLabel(distanceM, recorder.elapsedS)} />
        <StatMini icon="activity" label="Alt. ±" value={`${Math.round(approxElevation(recorder.points))} m`} />
      </div>

      {recorder.points.length > 1 && (
        <Card title="Live-Strecke" icon="map-pin">
          <TrackMap points={recorder.points} height={230} />
        </Card>
      )}

      <div className="row-buttons">
        {recorder.status === 'recording' ? (
          <button onClick={recorder.pause}><Icon name="clock" size={16} /> Pause</button>
        ) : (
          <button onClick={recorder.resume}><Icon name="record" size={16} /> Weiter</button>
        )}
        <button className="danger" onClick={() => void recorder.discard()}>
          <Icon name="x" size={16} /> Verwerfen
        </button>
        <button
          className="primary"
          onClick={finishRecording}
          disabled={recorder.points.length < 2}
        >
          <Icon name="check" size={16} /> Beenden & speichern
        </button>
      </div>
      <p className="muted hint" style={{ marginTop: '.7rem' }}>
        Die App muss während der Aufzeichnung geöffnet bleiben. Bei fehlender Freigabe wird kein
        Standort erfasst; die Zeit läuft erst mit „Start“.
      </p>
    </div>
  )
}

function StatMini({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-icon"><Icon name={icon} size={17} /></div>
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

function paceLabel(distanceM: number, elapsedS: number): string {
  if (distanceM < 50 || elapsedS < 10) return '-'
  const spm = elapsedS / (distanceM / 1000)
  const minutes = Math.floor(spm / 60)
  const seconds = Math.round(spm % 60)
  if (seconds === 60) return `${minutes + 1}:00`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
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

function approxElevation(points: Array<{ alt: number | null }>): number {
  let gain = 0
  for (let i = 1; i < points.length; i++) {
    const d = (points[i].alt ?? 0) - (points[i - 1].alt ?? 0)
    if (d > 0) gain += d
  }
  return gain
}
