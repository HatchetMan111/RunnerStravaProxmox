import { useEffect, useState } from 'react'
import { api, clearToken } from '../api/client'
import type { HealthInfo } from '../api/client'

export function SettingsPage() {
  const [info, setInfo] = useState<HealthInfo | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void api.get<HealthInfo>('/api/v1/health').then(setInfo).catch(() => undefined)
  }, [])

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)
    try {
      await api.post('/api/v1/auth/change-password', {
        username: 'unused',
        password: newPassword,
      }, {
        'X-Current-Password': currentPassword,
      })
      clearToken()
      window.location.href = '/login'
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Fehler beim Passwortwechsel')
    }
  }

  const logout = async () => {
    try {
      await api.post('/api/v1/auth/logout')
    } catch {
      /* ignore */
    }
    clearToken()
    window.location.href = '/login'
  }

  return (
    <div>
      <h2>Einstellungen</h2>
      {info && (
        <table className="table settings-table">
          <tbody>
            <tr>
              <td>Server</td>
              <td>
                {window.location.origin} · LocalTrack v{info.version}
              </td>
            </tr>
            <tr>
              <td>Sicherer Kontext (PWA)</td>
              <td>{window.isSecureContext ? 'ja' : 'nein – Service Worker/Offline nur mit HTTPS oder localhost'}</td>
            </tr>
          </tbody>
        </table>
      )}

      <h3>Passwort ändern</h3>
      <form onSubmit={changePassword}>
        <label>
          Aktuelles Passwort
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Neues Passwort (min. 8 Zeichen)
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {message && <div className="form-error">{message}</div>}
        <button type="submit" className="primary">
          Passwort ändern (danach neu anmelden)
        </button>
      </form>

      <h3>Abmelden</h3>
      <button onClick={() => void logout()}>Abmelden</button>

      <h3>Datenschutz</h3>
      <p className="muted">
        LocalTrack überträgt Daten ausschließlich an deinen eigenen Server. Keine Telemetrie,
        keine externen Karten- oder Cloud-Dienste.
      </p>
    </div>
  )
}
