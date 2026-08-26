export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '-'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '-'
  const km = meters / 1000
  if (km >= 10) return `${km.toFixed(1).replace('.', ',')} km`
  return `${km.toFixed(2).replace('.', ',')} km`
}

export function formatPace(speedMs: number | null | undefined): string {
  if (!speedMs || speedMs <= 0.1) return '-'
  const secondsPerKm = 1000 / speedMs
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)
  if (seconds === 60) return `${minutes + 1}:00`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const date = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
  return date.toLocaleString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function dateShort(iso: string): string {
  const date = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' })
}

export function formatElevation(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '-'
  return `${Math.round(meters)} m`
}

export function formatBpm(value: number | null | undefined): string {
  if (!value) return '-'
  return String(Math.round(value))
}
