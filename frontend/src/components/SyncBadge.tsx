import { useEffect, useState } from 'react'
import { subscribe, pendingCount, retryFailedNow } from '../sync/engine'
import { Icon } from './Icon'

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
      title={online ? 'Jetzt synchronisieren' : 'Offline – wird automatisch synchronisiert'}
    >
      {!online ? (
        <>
          <Icon name="cloud-off" size={14} /> {pending > 0 ? `${pending} lokal` : 'offline'}
        </>
      ) : (
        <>
          <Icon name="refresh" size={14} /> {pending} in Warteschlange
        </>
      )}
    </button>
  )
}
