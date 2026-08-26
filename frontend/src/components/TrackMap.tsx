interface TrackMapProps {
  points: Array<{ lat: number | null; lon: number | null }>
  width?: number
  height?: number
}

export function TrackMap({ points, width = 600, height = 360 }: TrackMapProps) {
  const located = points.filter(
    (p): p is { lat: number; lon: number } => p.lat !== null && p.lon !== null
  )
  if (located.length < 2) {
    return <div className="trackmap-empty">Keine GPS-Punkte vorhanden</div>
  }

  const lats = located.map((p) => p.lat)
  const lons = located.map((p) => p.lon)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)

  const midLat = (minLat + maxLat) / 2
  const cosLat = Math.cos((midLat * Math.PI) / 180)
  const spanX = Math.max((maxLon - minLon) * cosLat, 1e-6)
  const spanY = Math.max(maxLat - minLat, 1e-6)

  const padding = 24
  const scaleX = (width - padding * 2) / spanX
  const scaleY = (height - padding * 2) / spanY
  const scale = Math.min(scaleX, scaleY)

  const projectX = (lon: number) =>
    padding + (lon - minLon) * cosLat * scale + (width - padding * 2 - spanX * scale) / 2
  const projectY = (lat: number) =>
    height - padding - (lat - minLat) * scale - (height - padding * 2 - spanY * scale) / 2

  const pathParts: string[] = []
  let previous: { lat: number; lon: number } | null = null
  for (const point of located) {
    if (
      previous &&
      Math.abs(point.lon - previous.lon) > 0.5
    ) {
      pathParts.push('M')
    } else {
      pathParts.push(previous ? 'L' : 'M')
    }
    pathParts.push(`${projectX(point.lon).toFixed(1)} ${projectY(point.lat).toFixed(1)}`)
    previous = point
  }

  const first = located[0]
  const last = located[located.length - 1]
  const distanceKm = approxDistanceKm(located)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trackmap" role="img" aria-label="GPS-Track">
      <rect x={0} y={0} width={width} height={height} rx={12} className="trackmap-bg" />
      <polyline
        points={pathToPoints(pathParts)}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={projectX(first.lon)} cy={projectY(first.lat)} r={7} fill="#22c55e" />
      <circle cx={projectX(last.lon)} cy={projectY(last.lat)} r={7} fill="#fbbf24" />
      <text x={padding} y={height - 8} className="trackmap-caption">
        Start ● grün · Ende ● gelb · ca. {distanceKm.toFixed(2)} km · schematische Darstellung ohne Kartenhintergrund
      </text>
    </svg>
  )
}

function pathToPoints(parts: string[]): string {
  const commands = parts.join(' ').split('M').filter(Boolean)
  return commands.map((segment) => 'M' + segment.trim()).join(' ')
}

function approxDistanceKm(points: Array<{ lat: number; lon: number }>): number {
  const R = 6371
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dLat = ((points[i].lat - points[i - 1].lat) * Math.PI) / 180
    const dLon = ((points[i].lon - points[i - 1].lon) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((points[i - 1].lat * Math.PI) / 180) *
        Math.cos((points[i].lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2
    total += 2 * R * Math.asin(Math.sqrt(a))
  }
  return total
}
