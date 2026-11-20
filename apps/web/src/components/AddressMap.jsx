import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { DEFAULT_CENTER, googleActive, loadGoogle } from '../lib/places'

// Mapa com pin arrastável. Google Maps quando há chave; senão Leaflet + OpenStreetMap.
// `position` ({lat,lng}) move o pin; arrastar chama onMove({lat,lng}).
function AddressMap({ position, onMove }) {
  const el = useRef(null)
  const api = useRef(null)
  const latest = useRef({ position, onMove })
  latest.current = { position, onMove }

  useEffect(() => {
    let dead = false
    const start = latest.current.position ?? DEFAULT_CENTER

    async function mountGoogle() {
      const gm = await loadGoogle()
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([gm.importLibrary('maps'), gm.importLibrary('marker')])
      if (dead) return null
      const map = new Map(el.current, { center: start, zoom: 17, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative' })
      const marker = new AdvancedMarkerElement({ map, position: start, gmpDraggable: true })
      marker.addListener('dragend', () => {
        const p = marker.position
        latest.current.onMove({ lat: p.lat, lng: p.lng })
      })
      return {
        move: (p) => {
          marker.position = p
          map.panTo(p)
        },
        destroy: () => {
          marker.map = null
        },
      }
    }

    function mountLeaflet() {
      const map = L.map(el.current, { zoomControl: true }).setView(start, 17)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)
      const icon = L.divIcon({ className: 'addr-pin', html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 31] })
      const marker = L.marker(start, { icon, draggable: true }).addTo(map)
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        latest.current.onMove({ lat, lng })
      })
      setTimeout(() => map.invalidateSize(), 0)
      return {
        move: (p) => {
          marker.setLatLng(p)
          map.setView(p, Math.max(map.getZoom(), 17))
        },
        destroy: () => map.remove(),
      }
    }

    ;(async () => {
      let impl = null
      if (googleActive()) impl = await mountGoogle().catch(() => null)
      if (dead) return impl?.destroy()
      impl ??= mountLeaflet()
      api.current = impl
      impl.move(latest.current.position ?? start)
    })()

    return () => {
      dead = true
      api.current?.destroy()
      api.current = null
    }
  }, [])

  useEffect(() => {
    if (position) api.current?.move(position)
  }, [position?.lat, position?.lng])

  return <div ref={el} className="addr-map" />
}

export default AddressMap
