import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from '../db/idb'

export interface RecordedPoint {
  t: number
  lat: number | null
  lon: number | null
  alt: number | null
  speed: number | null
}

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'finished'
export type GpsPhase = 'off' | 'unsupported' | 'insecure' | 'denied' | 'locating' | 'locked'

const MAX_ACCURACY_LOCK_M = 30
const MAX_ACCURACY_KEEP_M = 75
const MAX_SPEED_MS = 60

interface WakeLockLike {
  release: () => Promise<void>
}

function isInsecureOrigin(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return false
  const host = window.location.hostname
  return host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('[::1]')
}

const INSECURE_HINT =
  'Der Browser blockiert GPS auf unsicheren Ursprüngen (http://IP). Für Aufzeichnung via https:// erreichbar machen (z. B. Reverse Proxy mit eigenem Zertifikat) oder über localhost/SSH-Tunnel testen.'

async function queryPermission(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions) return null
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return null
  }
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [gpsPhase, setGpsPhase] = useState<GpsPhase>('off')
  const [gpsMessage, setGpsMessage] = useState<string | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [points, setPoints] = useState<RecordedPoint[]>([])
  const [elapsedS, setElapsedS] = useState(0)
  const [resumableDraft, setResumableDraft] = useState(false)

  const watchIdRef = useRef<number | null>(null)
  const pointsRef = useRef<RecordedPoint[]>([])
  const lockedRef = useRef(false)
  const startedAtRef = useRef(0)
  const pausedTotalRef = useRef(0)
  const lastPauseStartRef = useRef(0)
  const lastSaveRef = useRef(0)
  const wakeLockRef = useRef<WakeLockLike | null>(null)

  useEffect(() => {
    void loadDraft().then((draft) => {
      if (draft && draft.points.length > 1) setResumableDraft(true)
    })
    return () => stopWatch()
  }, [])

  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return
    const timer = setInterval(() => setElapsedS(Math.floor(currentElapsedRaw())), 1000)
    return () => clearInterval(timer)
  }, [status])

  function currentElapsedRaw(): number {
    if (!startedAtRef.current) return 0
    const now = status === 'paused' ? lastPauseStartRef.current : Date.now() / 1000
    return Math.max(0, now - startedAtRef.current - pausedTotalRef.current)
  }

  const persistDraft = useCallback(() => {
    void saveDraft({
      points: pointsRef.current,
      started_at_epoch_s: startedAtRef.current,
      sport_type: localStorage.getItem('lt_sport') || 'running',
    }).catch(() => undefined)
  }, [])

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> }
      }
      wakeLockRef.current = (await nav.wakeLock?.request('screen')) ?? null
    } catch {
      /* wake lock optional */
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLockRef.current?.release()
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null
  }

  function stopWatch() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsPhase('unsupported')
      setGpsMessage('Dieses Gerät/Browser unterstützt kein GPS.')
      return
    }
    stopWatch()
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords
        setAccuracy(coords.accuracy)
        if (!lockedRef.current) {
          if (coords.accuracy > MAX_ACCURACY_LOCK_M) {
            setGpsPhase('locating')
            setGpsMessage(`Warte auf besseres Signal … Genauigkeit ${Math.round(coords.accuracy)} m`)
            return
          }
          lockedRef.current = true
          setGpsPhase('locked')
          setGpsMessage(null)
        } else if (coords.accuracy > MAX_ACCURACY_KEEP_M) {
          return
        }
        const point: RecordedPoint = {
          t: position.timestamp / 1000,
          lat: coords.latitude,
          lon: coords.longitude,
          alt: coords.altitude ?? null,
          speed: coords.speed !== null && coords.speed < MAX_SPEED_MS ? coords.speed : null,
        }
        pointsRef.current = [...pointsRef.current, point]
        setPoints(pointsRef.current)
        if (Date.now() - lastSaveRef.current > 3000) {
          lastSaveRef.current = Date.now()
          persistDraft()
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatch()
          setGpsPhase('denied')
          setGpsMessage(
            'Standortfreigabe verweigert. In den Browser-Einstellungen für diese Seite erlauben.'
          )
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsPhase((prev) => (prev === 'locked' ? prev : 'locating'))
          setGpsMessage('GPS-Signal unterbrochen – suche erneut …')
        } else {
          setGpsMessage('Noch kein GPS-Fix – draußen hält das Signal besser.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    )
  }, [persistDraft])

  const start = useCallback(() => {
    if (isInsecureOrigin()) {
      setGpsPhase('insecure')
      setGpsMessage(INSECURE_HINT)
      return
    }
    if (!('geolocation' in navigator)) {
      setGpsPhase('unsupported')
      setGpsMessage('Dieses Gerät/Browser unterstützt kein GPS.')
      return
    }
    void queryPermission().then((state) => {
      if (state === 'denied') {
        setGpsPhase('denied')
        setGpsMessage(
          'Standortfreigabe ist dauerhaft verweigert (Website-Berechtigungen prüfen).'
        )
        return
      }
      pointsRef.current = []
      setPoints([])
      lockedRef.current = false
      setAccuracy(null)
      startedAtRef.current = Date.now() / 1000
      pausedTotalRef.current = 0
      setStatus('recording')
      setGpsPhase('locating')
      setGpsMessage('Suche GPS-Signal …')
      startWatching()
      void requestWakeLock()
    })
  }, [startWatching])

  const pause = useCallback(() => {
    lastPauseStartRef.current = Date.now() / 1000
    setStatus('paused')
    stopWatch()
    persistDraft()
    void releaseWakeLock()
  }, [persistDraft])

  const resume = useCallback(() => {
    pausedTotalRef.current += Date.now() / 1000 - lastPauseStartRef.current
    setStatus('recording')
    if (lockedRef.current || gpsPhase === 'locked') {
      startWatching()
    } else {
      setGpsPhase('locating')
      startWatching()
    }
    void requestWakeLock()
  }, [gpsPhase, startWatching])

  const discard = useCallback(async () => {
    stopWatch()
    pointsRef.current = []
    setPoints([])
    setAccuracy(null)
    setElapsedS(0)
    setStatus('idle')
    setGpsPhase('off')
    setGpsMessage(null)
    await clearDraft()
    setResumableDraft(false)
    await releaseWakeLock()
  }, [])

  const finish = useCallback((): RecordedPoint[] => {
    stopWatch()
    setStatus('finished')
    void clearDraft().then(() => setResumableDraft(false))
    void releaseWakeLock()
    return pointsRef.current
  }, [])

  const resumeDraft = useCallback(async (): Promise<RecordedPoint[]> => {
    const draft = await loadDraft()
    if (!draft || draft.points.length === 0) return []
    if (isInsecureOrigin()) {
      setGpsPhase('insecure')
      setGpsMessage(INSECURE_HINT)
      return []
    }
    pointsRef.current = draft.points
    setPoints(draft.points)
    lockedRef.current = draft.points.some((p) => p.lat !== null)
    setAccuracy(null)
    startedAtRef.current = draft.started_at_epoch_s
    pausedTotalRef.current = 0
    lastPauseStartRef.current = 0
    setStatus('recording')
    setGpsPhase(lockedRef.current ? 'locked' : 'locating')
    startWatching()
    void requestWakeLock()
    return draft.points
  }, [startWatching])

  return {
    status,
    gpsPhase,
    gpsMessage,
    accuracy,
    points,
    elapsedS,
    resumableDraft,
    start,
    pause,
    resume,
    finish,
    discard,
    resumeDraft,
  }
}
