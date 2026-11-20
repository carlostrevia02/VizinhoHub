import { useEffect, useState } from 'react'
import { api, qs } from './api'

// Tá Quentinho (ofertas relâmpago): chamadas à API + utilidades de tela.
// Sem GPS, o radar parte de um ponto de referência perto das lojas. O centro de Fortaleza
// ficava a ~3 km delas, fora do raio das ofertas, e o radar aparecia sempre vazio.
export const BAIRRO = { lat: -3.735, lng: -38.5 }

export const getRadar = ({ lat, lng, category, limit }) => api.get(`/flash/radar${qs({ lat, lng, category, limit })}`)
export const listMyFlash = () => api.get('/flash/mine')
export const createFlash = (body) => api.post('/flash', body)
export const cancelFlash = (id) => api.post(`/flash/${id}/cancel`)
export const listAlerts = () => api.get('/me/alerts')
export const createAlert = (body) => api.post('/me/alerts', body)
export const removeAlert = (id) => api.delete(`/me/alerts/${id}`)

/** Posição atual do aparelho; sem permissão ou sem suporte, rejeita (quem chama decide o plano B). */
export const getPosition = () =>
  new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolocalização indisponível.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
  })

export function formatRemaining(ms) {
  if (ms <= 0) return 'Encerrada'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${String(m).padStart(2, '0')}:${sec}`
}

/** Contagem regressiva até `endsAt` ("12:34", "1h 05min"); atualiza a cada segundo. */
export function useCountdown(endsAt) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(endsAt).getTime() - now
  return { expired: ms <= 0, text: formatRemaining(ms) }
}

export const formatDistance = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)
