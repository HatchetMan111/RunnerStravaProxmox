import { useEffect, useState } from 'react'
import { api, clearToken } from '../api/client'
import type { HealthInfo } from '../api/client'
import { Card, PageHeader, Switch } from '../components/ui'
import { Icon } from '../components/Icon'

export function SettingsPage() {
  const [info, setInfo] = useState<HealthInfo | null>(null)
  const [tiles, setTiles] = useState(() => localStorage.getItem('lt_map_tiles') !== '0')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void api.get<HealthInfo>('/api/v1/health').then(setInfo).catch(() => undefined)
  }, [])

  function toggleTiles(value: boolean) {
    setTiles(value)
    localStorage.setItem('lt_map_tiles', value ? '1' : '0')
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    try {
      await api.post('/api/v1/auth/change-password', { username: 'unused', password: newPassword }, {
        'X-Current-Password': currentPassword,
      })
      clearToken()
      window.location.href = '/login'
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Fehler beim Passwortwechsel')
    }
  }

  async function logout() {
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
      <PageHeader title="Einstellungen" />

      <Card title="Karte & Datenschutz" icon="map-pin">
        <Switch
          checked={tiles}
          onChange={toggleTiles}
          label="Online-Kartenkacheln laden"
          hint="Zeigt Deine Strecke auf echten Karten (openstreetmap.org). Es fließen keine Trainingsdaten; bei Aus bleibt alles komplett offline."
        />
        <p className="muted hint" style={{ marginTop: '.7rem' }}>
          Ohne Kacheln wird der Track als schematische Karte (Vektor-Zeichnung) dargestellt.
        </p>
      </Card>

      <Card title="Konto" icon="user">
        <form onSubmit={changePassword}>
          <label>Aktuelles Passwort
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </label>
          <label>Neues Passwort (min. 8 Zeichen)
            <input type="password" value={newPassword} minLength={8} required onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          {message && <div className="form-error">{message}</div>}
          <button type="submit" className="primary">
            Passwort ändern
          </button>
          <p className="muted hint">Danach wirst du zur Anmeldung geleitet.</p>
        </form>
        <div className="row-buttons">
          <button onClick={() => void logout()}><Icon name="x" size={15} /> Abmelden</button>
        </div>
      </Card>

      <Card title="Server & System" icon="sliders">
        {info && (
          <table className="table settings-table">
            <tbody>
              <tr><td>Server</td><td>{window.location.origin}</td></tr>
              <tr><td>LocalTrack</td><td>Version {info.version}</td></tr>
              <tr>
                <td>Sicherer Kontext</td>
                <td>{window.isSecureContext ? 'ja ✓ (PWA + GPS nutzbar)' : 'nein – GPS/PWA-Offline nur via HTTPS oder localhost'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Datenschutz" icon="check">
        <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
          LocalTrack überträgt Trainingsdaten ausschließlich an deinen eigenen Server. Keine Telemetrie,
          kein Cloud-Zwang. Die Kartenkacheln kommen nur bei aktivem Schalter von openstreetmap.org.
        </p>
      </Card>
    </div>
  )
}
