import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

// Mapa simples (Leaflet + OpenStreetMap) com loja, destino e entregador. Marcadores são círculos
// (nada de imagem de ícone, que quebra com bundler). Carregado sob demanda (React.lazy).
const POINTS = [
  ['store', 'Loja', '#2563eb'],
  ['dropoff', 'Destino', '#16a34a'],
  ['courier', 'Entregador', '#dc2626'],
]

export default function TrackMap({ store, dropoff, courier, height = 280 }) {
  const el = useRef(null)
  const state = useRef({ map: null, layers: {} })

  useEffect(() => {
    const map = L.map(el.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    state.current.map = map
    return () => {
      map.remove()
      state.current = { map: null, layers: {} }
    }
  }, [])

  useEffect(() => {
    const { map, layers } = state.current
    if (!map) return
    const given = { store, dropoff, courier }
    const bounds = []
    for (const [key, label, color] of POINTS) {
      const p = given[key]
      if (!p || p.lat == null || p.lng == null) {
        layers[key]?.remove()
        delete layers[key]
        continue
      }
      const at = [p.lat, p.lng]
      bounds.push(at)
      if (layers[key]) layers[key].setLatLng(at)
      else layers[key] = L.circleMarker(at, { radius: key === 'courier' ? 10 : 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(map)
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
  }, [store?.lat, store?.lng, dropoff?.lat, dropoff?.lng, courier?.lat, courier?.lng])

  return <div ref={el} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line, #e5e7eb)' }} role="img" aria-label="Mapa da entrega" />
}
