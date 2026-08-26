import { useEffect, useState } from 'react'
import { subscribe, pendingCount, retryFailedNow } from '../sync/engine'

export function SyncBadge() {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const refresh = () => void pendingCount().then(setPending)
    const unsubscribe = subscribe(refresh)
    refresh()
    const interval = setInterval(refresh, 3000)
    const onlineHandler = () => setOnline(navigator.onLine)
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', onlineHandler)
    return () => {
      unsubscribe()
      clearInterval(interval)
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', onlineHandler)
    }
  }, [])

  if (online && pending === 0) return null

  return (
    <button
      className={`sync-badge ${online ? '' : 'offline'}`}
      onClick={() => (pending > 0 ? void retryFailedNow() : undefined)}
      title={online ? 'Synchronisierung starten' : 'Offline – wird automatisch synchronisiert'}
    >
      {!online && `Offline${pending ? ` · ${pending} lokal` : ''}`}
      {online && pending > 0 && `${pending} in Warteschlange`}
    </button>
  )
}
