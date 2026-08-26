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

interface GeolocationLike {
  watchPosition: (
    success: (position: GeolocationPosition) => void,
    error: (error: GeolocationPositionError) => void,
    options?: PositionOptions
  ) => number
  clearWatch: (id: number) => void
}

const MAX_ACCURACY_M = 50
const MAX_SPEED_MS = 60

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [points, setPoints] = useState<RecordedPoint[]>([])
  const [elapsedS, setElapsedS] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resumableDraft, setResumableDraft] = useState<boolean>(false)

  const watchIdRef = useRef<number | null>(null)
  const pointsRef = useRef<RecordedPoint[]>([])
  const startedAtRef = useRef<number>(0)
  const pausedTotalRef = useRef(0)
  const lastPauseStartRef = useRef<number>(0)
  const lastSaveRef = useRef(0)

  useEffect(() => {
    void loadDraft().then((draft) => {
      if (draft && draft.points.length > 0) setResumableDraft(true)
    })
  }, [])

  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return
    const interval = setInterval(() => setElapsedS(Math.floor(currentElapsed())), 1000)
    return () => clearInterval(interval)
  }, [status])

  const currentElapsed = useCallback((): number => {
    if (!startedAtRef.current) return 0
    const now =
      status === 'paused' ? lastPauseStartRef.current : Date.now() / 1000
    return Math.max(0, now - startedAtRef.current - pausedTotalRef.current)
  }, [status])

  const persistDraft = useCallback(() => {
    void saveDraft({
      points: pointsRef.current,
      started_at_epoch_s: startedAtRef.current,
      sport_type: localStorage.getItem('lt_sport') || 'running',
    }).catch(() => undefined)
  }, [])

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
      const coords = position.coords
      if (coords.accuracy > MAX_ACCURACY_M) return
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
    [persistDraft]
  )

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation wird von diesem Browser nicht unterstützt.')
      return false
    }
    const geo = navigator.geolocation as GeolocationLike
    watchIdRef.current = geo.watchPosition(handlePosition, (err) => {
      setError(
        err.code === err.PERMISSION_DENIED
          ? 'Standortfreigabe verweigert. Ohne GPS kann nicht aufgezeichnet werden.'
          : `GPS-Fehler: ${err.message}`
      )
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    })
    return true
  }, [handlePosition])

  const start = useCallback(() => {
    setError(null)
    pointsRef.current = []
    setPoints([])
    startedAtRef.current = Date.now() / 1000
    pausedTotalRef.current = 0
    setStatus('recording')
    startWatching()
  }, [startWatching])

  const pause = useCallback(() => {
    lastPauseStartRef.current = Date.now() / 1000
    setStatus('paused')
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    persistDraft()
  }, [persistDraft])

  const resume = useCallback(() => {
    pausedTotalRef.current += Date.now() / 1000 - lastPauseStartRef.current
    setStatus('recording')
    startWatching()
  }, [startWatching])

  const discard = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    pointsRef.current = []
    setPoints([])
    setElapsedS(0)
    setStatus('idle')
    await clearDraft()
    setResumableDraft(false)
  }, [])

  const finish = useCallback((): RecordedPoint[] => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setStatus('finished')
    void clearDraft()
    setResumableDraft(false)
    return pointsRef.current
  }, [])

  const resumeDraft = useCallback(async (): Promise<RecordedPoint[]> => {
    const draft = await loadDraft()
    if (!draft) return []
    pointsRef.current = draft.points
    setPoints(draft.points)
    startedAtRef.current = draft.started_at_epoch_s
    pausedTotalRef.current = 0
    setStatus('recording')
    startWatching()
    return draft.points
  }, [startWatching])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  return {
    status,
    points,
    elapsedS,
    error,
    resumableDraft,
    start,
    pause,
    resume,
    finish,
    discard,
    resumeDraft,
  }
}
