import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap, Polyline as LeafletPolyline, TileLayer } from 'leaflet'

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'

export interface ActivityMapPoint {
  lat: number
  lon: number
}

export function ActivityMap({ points, tilesEnabled }: { points: ActivityMapPoint[]; tilesEnabled: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const lineRef = useRef<LeafletPolyline | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const leaflet = await import('leaflet')
      await Promise.resolve()
      if (cancelled || !containerRef.current) return
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: !!tilesEnabled,
      })
      mapRef.current = map
      setReady(true)
      if (points.length > 0) {
        const lats = points.map((p) => p.lat)
        const lons = points.map((p) => p.lon)
        map.fitBounds(
          [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
          ],
          { padding: [24, 24] }
        )
      }
    })()
    return () => {
      cancelled = true
      setReady(false)
      mapRef.current?.remove()
      mapRef.current = null
      lineRef.current = null
      tileLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready || !mapRef.current) return
    void (async () => {
      const leaflet = await import('leaflet')
      const latlngs = points.map((p) => [p.lat, p.lon] as [number, number])
      if (lineRef.current) {
        lineRef.current.setLatLngs(latlngs)
      } else {
        lineRef.current = leaflet.polyline(latlngs, {
          color: '#0d9488',
          weight: 4,
          opacity: 0.9,
          lineJoin: 'round',
        }).addTo(mapRef.current!)
        const first = latlngs[0]
        const last = latlngs[latlngs.length - 1]
        if (first && last) {
          leaflet.circleMarker(first, { radius: 6, color: '#065f46', fillColor: '#34d399', fillOpacity: 1, weight: 2 }).addTo(mapRef.current!)
          leaflet.circleMarker(last, { radius: 6, color: '#9a3412', fillColor: '#fb923c', fillOpacity: 1, weight: 2 }).addTo(mapRef.current!)
        }
      }
      if (tilesEnabled && navigator.onLine) {
        tileLayerRef.current ??= await Promise.resolve(
          import('leaflet').then((L) =>
            L.tileLayer(OSM_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(mapRef.current!)
          )
        )
      } else if (tileLayerRef.current) {
        mapRef.current!.removeLayer(tileLayerRef.current)
        tileLayerRef.current = null
      }
    })()
  }, [points, ready, tilesEnabled])

  return (
    <div className="map-wrap">
      {!ready && <div className="trackmap-empty">Karte wird geladen …</div>}
      <div ref={containerRef} style={{ minHeight: 380 }} />
    </div>
  )
}
