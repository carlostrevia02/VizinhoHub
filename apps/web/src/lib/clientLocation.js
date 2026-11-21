import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useNearbyLocation } from './useNearbyLocation'

// Localização do cliente para calcular a filial mais próxima de cada oferta (lib/deals.js, ?lat=&lng=).
// Ordem: coordenadas do local de entrega (endereço/GPS que o site já usa) → localização que a pessoa
// liberou pelo botão "Usar minha localização" (guardada por poucas horas). Sem nenhuma, nada é enviado.
const KEY = 'vizinhohub:client-location'
export const LOCATION_TTL_MS = 6 * 60 * 60 * 1000

// 4 casas decimais (~11 m): suficiente para a rota e não envia a posição exata.
const round = (n) => Math.round(n * 1e4) / 1e4

export function validCoords(c) {
  return Boolean(c) && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180
}

// Lê o JSON guardado; devolve { lat, lng } ou null se estiver vazio, corrompido, inválido ou vencido.
export function parseStoredLocation(raw, now = Date.now()) {
  try {
    const v = JSON.parse(raw)
    if (!validCoords(v) || !Number.isFinite(v.at) || now - v.at > LOCATION_TTL_MS || v.at - now > 60000) return null
    return { lat: round(v.lat), lng: round(v.lng) }
  } catch {
    return null
  }
}

const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let memory = null // sem armazenamento disponível, vale até recarregar
const readRaw = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return memory
  }
}
const writeRaw = (raw) => {
  memory = raw
  try {
    raw ? localStorage.setItem(KEY, raw) : localStorage.removeItem(KEY)
  } catch {
    /* sem armazenamento */
  }
  emit()
}

// Só roda por um clique do usuário. Resolve { ok: true } ou { ok: false, message }.
export function requestDeviceLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return resolve({ ok: false, message: 'Seu navegador não permite usar a localização.' })
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const c = { lat: round(coords.latitude), lng: round(coords.longitude) }
        if (!validCoords(c)) return resolve({ ok: false, message: 'Não foi possível obter sua localização agora. Tente de novo.' })
        writeRaw(JSON.stringify({ ...c, at: Date.now() }))
        resolve({ ok: true })
      },
      (err) =>
        resolve({
          ok: false,
          message:
            err?.code === 1
              ? 'Localização bloqueada. Libere o acesso no navegador para ver a filial mais próxima.'
              : 'Não foi possível obter sua localização agora. Tente de novo.',
        }),
      { timeout: 10000, maximumAge: 300000 },
    )
  })
}

export const clearDeviceLocation = () => writeRaw(null)

// { coords: {lat,lng}|null, source: 'delivery'|'device'|null, label }
export function useClientLocation(userId) {
  const near = useNearbyLocation(userId)
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  const stored = useMemo(() => parseStoredLocation(raw), [raw])

  const fromDelivery = near.address && near.address.lat != null && near.address.lng != null ? { lat: near.address.lat, lng: near.address.lng } : near.position
  const delivery = validCoords(fromDelivery) ? { lat: round(fromDelivery.lat), lng: round(fromDelivery.lng) } : null

  const lat = delivery?.lat ?? stored?.lat
  const lng = delivery?.lng ?? stored?.lng
  const coords = useMemo(() => (lat == null || lng == null ? null : { lat, lng }), [lat, lng])
  const source = delivery ? 'delivery' : stored ? 'device' : null
  const request = useCallback(() => requestDeviceLocation(), [])
  return { coords, source, label: near.text, request, clear: clearDeviceLocation }
}
