import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { addressLine1, useAddresses } from './addresses'
import { reverseGeocode, searchPlaces } from './places'

// Local de entrega exibido na loja: a localização real do cliente (GPS do navegador) ou, se ela estiver
// a menos de SNAP_METERS de um endereço cadastrado, esse endereço. Sem permissão/GPS, usa o endereço principal.
export const SNAP_METERS = 200

// Distância em metros entre dois pontos (fórmula de haversine).
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

// A posição é pedida uma vez por carregamento da página (o navegador só pergunta uma vez ao usuário).
let gps = null
const getPosition = () =>
  (gps ??= new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 300000 },
    )
  }))

const reversed = new Map()
const reverseCached = (p) => {
  const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
  if (!reversed.has(key)) reversed.set(key, reverseGeocode(p.lat, p.lng).catch(() => null))
  return reversed.get(key)
}

const attempted = new Set() // endereços sem coordenadas já tentados (evita repetir a busca)

// Escolha manual ("entregar em…") feita no seletor; vence a localização. null = automático (GPS).
const choiceKey = (userId) => `vizinhohub:deliver-to:${userId ?? 'guest'}`
const choiceListeners = new Set()
const readChoice = (userId) => {
  try {
    return localStorage.getItem(choiceKey(userId))
  } catch {
    return null
  }
}
export function setDeliveryChoice(userId, id) {
  try {
    id ? localStorage.setItem(choiceKey(userId), id) : localStorage.removeItem(choiceKey(userId))
  } catch {
    /* sem armazenamento: a escolha vale até recarregar */
  }
  choiceListeners.forEach((fn) => fn())
}
const subscribeChoice = (fn) => {
  choiceListeners.add(fn)
  return () => choiceListeners.delete(fn)
}

// "Minha localização atual" no seletor: pede o GPS de novo (a 1ª tentativa pode ter sido negada ou estar velha).
let version = 0
export function refreshPosition() {
  gps = null
  version++
  choiceListeners.forEach((fn) => fn())
}

export function useNearbyLocation(userId) {
  const { list, primary, save } = useAddresses(userId)
  const chosenId = useSyncExternalStore(subscribeChoice, () => readChoice(userId))
  const chosen = list.find((a) => a.id === chosenId)
  const posVersion = useSyncExternalStore(subscribeChoice, () => version)
  const [pos, setPos] = useState(null)
  const [place, setPlace] = useState(null)

  // Com endereço escolhido à mão não precisamos (nem pedimos) a localização.
  useEffect(() => {
    if (chosen) return
    let on = true
    getPosition().then((p) => on && setPos(p))
    return () => {
      on = false
    }
  }, [Boolean(chosen), posVersion])

  // Endereços antigos não têm coordenadas: descobre uma vez (só quando há GPS para comparar) e guarda.
  useEffect(() => {
    if (!pos) return
    const a = list.find((x) => x.lat == null && !attempted.has(`${userId}:${x.id}`))
    if (!a) return
    attempted.add(`${userId}:${a.id}`)
    ;(async () => {
      try {
        // Da consulta mais precisa para a mais genérica: o número ou o bairro podem não existir no mapa.
        const queries = [
          `${a.street}, ${a.number} - ${a.neighborhood}, ${a.city} - ${a.state}`,
          `${a.street}, ${a.neighborhood}, ${a.city}`,
          `${a.street}, ${a.city} - ${a.state}`,
        ]
        let found = null
        for (const q of queries) {
          const [first] = await searchPlaces(q)
          if ((found = await first?.resolve())) break
          await new Promise((r) => setTimeout(r, 1100)) // política do Nominatim: no máx. 1 consulta por segundo
        }
        if (found) save({ ...a, lat: found.lat, lng: found.lng })
      } catch {
        /* sem coordenadas: esse endereço só não entra na comparação */
      }
    })()
  }, [pos, list, userId, save])

  const nearest = useMemo(() => {
    if (!pos) return null
    const hit = list
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({ a, d: distanceMeters(pos, a) }))
      .sort((x, y) => x.d - y.d)[0]
    return hit && hit.d <= SNAP_METERS ? hit.a : null
  }, [pos, list])

  // Fora do raio de qualquer endereço cadastrado: descobre o nome da rua/bairro onde a pessoa está.
  useEffect(() => {
    if (!pos || nearest) return
    let on = true
    reverseCached(pos).then((p) => on && setPlace(p))
    return () => {
      on = false
    }
  }, [pos, nearest])

  // `neighborhood` é o bairro do local atual (ou undefined): serve de filtro para as ofertas.
  if (chosen) return { source: 'chosen', text: `${chosen.label} · ${addressLine1(chosen)}`, address: chosen, neighborhood: chosen.neighborhood || undefined }
  if (nearest) return { source: 'saved', text: `${nearest.label} · ${addressLine1(nearest)}`, address: nearest, neighborhood: nearest.neighborhood || undefined }
  if (pos && place) {
    const where = place.street ? [place.street, place.neighborhood].filter(Boolean).join(', ') : [place.neighborhood, place.city].filter(Boolean).join(', ')
    if (where) return { source: 'gps', text: `Sua localização · ${where}`, position: pos, neighborhood: place.neighborhood || undefined }
  }
  if (primary) return { source: 'primary', text: addressLine1(primary), address: primary, neighborhood: primary.neighborhood || undefined }
  return { source: 'none', text: 'Escolha onde entregar', neighborhood: undefined }
}
