import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { getToken } from './api/client'
import { initEngine, scheduleDrain } from './sync/engine'
import { SyncBadge } from './components/SyncBadge'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { RecordPage } from './pages/RecordPage'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { ActivityDetailPage } from './pages/ActivityDetailPage'
import { ImportPage } from './pages/ImportPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken())
  const location = useLocation()

  useEffect(() => {
    setAuthed(!!getToken())
    if (getToken()) {
      initEngine()
      scheduleDrain()
    }
  }, [])

  useEffect(() => {
    if (location.pathname === '/login') setAuthed(false)
    else setAuthed(!!getToken())
  }, [location])

  if (!authed && location.pathname !== '/login') {
    return <LoginPage />
  }

  return (
    <div className="app">
      {location.pathname !== '/login' && (
        <>
          <header className="topbar">
            <Link to="/" className="brand">
              LocalTrack
            </Link>
            <SyncBadge />
          </header>
          <nav className="tabbar">
            <NavLink to="/" end>
              Übersicht
            </NavLink>
            <NavLink to="/record">Aufzeichnen</NavLink>
            <NavLink to="/activities">Aktivitäten</NavLink>
            <NavLink to="/import">Import</NavLink>
            <NavLink to="/settings">Einstellungen</NavLink>
          </nav>
        </>
      )}
      <main className="content">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<DashboardPage />} />
          <Route path="/record" element={<RecordPage />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      {location.pathname !== '/login' && (
        <footer className="footer">
          Lokale Sportdatenplattform · keine Cloud · keine Tracker
        </footer>
      )}
    </div>
  )
}
