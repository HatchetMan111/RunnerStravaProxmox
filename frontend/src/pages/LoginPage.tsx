import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api/client'
import type { HealthInfo } from '../api/client'
import { Icon } from '../components/Icon'

export function LoginPage() {
  const navigate = useNavigate()
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<HealthInfo>('/api/v1/health')
      .then((info) => setSetupComplete(info.setup_complete))
      .catch(() => setError('Server nicht erreichbar'))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (setupComplete) {
        const result = await api.post<{ token: string }>('/api/v1/auth/login', { username, password })
        setToken(result.token)
      } else {
        if (password.length < 8) throw new Error('Passwort braucht mindestens 8 Zeichen')
        const result = await api.post<{ token: string }>('/api/v1/auth/setup', { username, password })
        setToken(result.token)
      }
      navigate('/', { replace: true })
      window.location.reload()
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>
          <span className="brand-mark"><Icon name="activity" size={18} /></span>
          LocalTrack
        </h1>
        <p className="auth-sub">
          {setupComplete === false ? 'Ersten Benutzer anlegen (Einrichtung)' : 'Anmelden für deine Trainingsdaten'}
        </p>
        <label>Benutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} required autoComplete="username" />
        </label>
        <label>Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete={setupComplete ? 'current-password' : 'new-password'}
          />
        </label>
        {error && (
          <div className="form-error">
            <Icon name="alert" size={16} /> {error}
          </div>
        )}
        <button type="submit" className="primary big" disabled={busy || setupComplete === null}>
          {setupComplete ? 'Anmelden' : 'Einrichten & Starten'}
        </button>
        <p className="muted hint" style={{ textAlign: 'center', marginTop: '.9rem' }}>
          Lokale Sportdatenplattform · keine Cloud · keine Tracker
        </p>
      </form>
    </div>
  )
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('401') || message.includes('Invalid')) return 'Benutzername oder Passwort falsch'
  if (message.includes('429')) return 'Zu viele Versuche – kurz warten'
  return message || 'Unbekannter Fehler'
}
