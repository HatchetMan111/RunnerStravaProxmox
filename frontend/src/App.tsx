import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { getToken } from './api/client'
import { initEngine, scheduleDrain } from './sync/engine'
import { SyncBadge } from './components/SyncBadge'
import { Icon, type IconName } from './components/Icon'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { RecordPage } from './pages/RecordPage'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { ActivityDetailPage } from './pages/ActivityDetailPage'
import { ImportPage } from './pages/ImportPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV: Array<{ to: string; label: string; icon: IconName; record?: boolean }> = [
  { to: '/', label: 'Übersicht', icon: 'home' },
  { to: '/record', label: 'Start', icon: 'record', record: true },
  { to: '/activities', label: 'Läufe', icon: 'list' },
  { to: '/import', label: 'Import', icon: 'upload' },
  { to: '/settings', label: 'Mehr', icon: 'sliders' },
]

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
              <span className="brand-mark"><Icon name="activity" size={18} /></span>
              <span>
                LocalTrack
                <small>local first</small>
              </span>
            </Link>
            <SyncBadge />
          </header>
          <nav className="tabbar">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                <span className={item.record ? 'nav-circle' : undefined}>
                  <Icon name={item.icon} size={item.record ? 20 : 19} strokeWidth={item.record ? 2.2 : 2} />
                </span>
                <span>{item.label}</span>
              </NavLink>
            ))}
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
        <footer className="footer">LocalTrack v2 UI · Daten bleiben auf deinem Server</footer>
      )}
    </div>
  )
}
