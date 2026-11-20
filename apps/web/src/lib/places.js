// Busca de endereços e geocodificação para o diálogo de endereços.
// Com VITE_GOOGLE_MAPS_API_KEY usa o Google Maps (Places API "New" + Maps JavaScript API).
// Sem a chave — ou se o Google recusar (chave inválida, API não habilitada) — cai para o
// OpenStreetMap (Nominatim), que não exige chave, para o fluxo continuar funcionando.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
export const DEFAULT_CENTER = { lat: -3.7319, lng: -38.5267 } // Fortaleza

let googleFailed = false
export const googleActive = () => Boolean(KEY) && !googleFailed

let loading = null
export function loadGoogle() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary) return resolve(window.google.maps)
      window.__vhGmapsReady = () => resolve(window.google.maps)
      // Chave recusada pelo Google (restrição de domínio, faturamento…): só o mapa/lookup do Google ficam inutilizáveis.
      window.gm_authFailure = () => {
        googleFailed = true
      }
      const s = document.createElement('script')
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&language=pt-BR&region=BR&callback=__vhGmapsReady`
      s.async = true
      s.onerror = () => reject(new Error('google-maps-load'))
      document.head.appendChild(s)
    }).catch((err) => {
      loading = null
      googleFailed = true
      throw err
    })
  }
  return loading
}

// ---- Normalização: tudo vira { street, number, neighborhood, city, state, zip, lat, lng } ----
const comp = (list, ...types) => list.find((c) => types.some((t) => c.types.includes(t)))

function fromGoogleComponents(raw, lat, lng) {
  const list = raw.map((c) => ({ long: c.longText ?? c.long_name, short: c.shortText ?? c.short_name, types: c.types }))
  return {
    street: comp(list, 'route')?.long ?? '',
    number: comp(list, 'street_number')?.long ?? '',
    neighborhood: comp(list, 'sublocality_level_1', 'sublocality', 'neighborhood')?.long ?? '',
    city: comp(list, 'locality', 'administrative_area_level_2')?.long ?? '',
    state: comp(list, 'administrative_area_level_1')?.short ?? '',
    zip: comp(list, 'postal_code')?.long ?? '',
    lat,
    lng,
  }
}

function fromNominatim(r) {
  const a = r.address ?? {}
  return {
    street: a.road ?? a.pedestrian ?? a.footway ?? '',
    number: a.house_number ?? '',
    neighborhood: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? '',
    city: a.city ?? a.town ?? a.municipality ?? a.village ?? '',
    state: (a['ISO3166-2-lvl4'] ?? '').replace(/^BR-/, ''),
    zip: a.postcode ?? '',
    lat: Number(r.lat),
    lng: Number(r.lon),
  }
}

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const nominatimParams = 'format=jsonv2&addressdetails=1&accept-language=pt-BR'

// ---- Busca com sugestões ----
let sessionToken = null // uma sessão de autocomplete por endereço escolhido (cobrança do Google)

async function searchGoogle(input) {
  const gm = await loadGoogle()
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await gm.importLibrary('places')
  sessionToken ??= new AutocompleteSessionToken()
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken,
    includedRegionCodes: ['br'],
    language: 'pt-BR',
    locationBias: { center: DEFAULT_CENTER, radius: 50000 },
  })
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction
      return {
        id: p.placeId,
        main: p.mainText?.text ?? p.text.text,
        secondary: p.secondaryText?.text ?? '',
        resolve: async () => {
          const place = p.toPlace()
          await place.fetchFields({ fields: ['addressComponents', 'location'] })
          sessionToken = null
          return fromGoogleComponents(place.addressComponents ?? [], place.location.lat(), place.location.lng())
        },
      }
    })
}

async function searchNominatim(input, signal) {
  const res = await fetch(`${NOMINATIM}/search?${nominatimParams}&countrycodes=br&limit=6&q=${encodeURIComponent(input)}`, { signal })
  if (!res.ok) throw new Error('nominatim')
  return (await res.json()).map((r) => {
    const [main, ...rest] = r.display_name.split(', ')
    return { id: String(r.place_id), main, secondary: rest.join(', '), resolve: async () => fromNominatim(r) }
  })
}

export async function searchPlaces(input, signal) {
  if (googleActive()) {
    try {
      return await searchGoogle(input)
    } catch {
      googleFailed = true // cai para o OpenStreetMap daqui em diante
    }
  }
  return searchNominatim(input, signal)
}

// ---- CEP → endereço (ViaCEP, com BrasilAPI de reserva) + coordenadas para o pin ----
export const isCep = (v) => /^\d{5}-?\d{3}$/.test(String(v).trim())

async function geocodeFirst(queries, signal) {
  for (const q of queries) {
    try {
      const res = await fetch(`${NOMINATIM}/search?${nominatimParams}&countrycodes=br&limit=1&q=${encodeURIComponent(q)}`, { signal })
      if (!res.ok) continue
      const [r] = await res.json()
      if (r) return { lat: Number(r.lat), lng: Number(r.lon) }
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
  }
  return null
}

// Devolve { street, neighborhood, city, state, zip, lat?, lng? } ou null se o CEP não existe.
// Lança erro se nenhum serviço de CEP respondeu.
export async function lookupCep(cep, signal) {
  const digits = String(cep).replace(/\D/g, '')
  if (digits.length !== 8) return null
  let found
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal })
    if (!res.ok) throw new Error('viacep')
    const d = await res.json()
    found = d.erro ? null : { street: d.logradouro ?? '', neighborhood: d.bairro ?? '', city: d.localidade ?? '', state: d.uf ?? '' }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`, { signal })
    if (res.status === 404) return null
    if (!res.ok) throw new Error('cep')
    const d = await res.json()
    found = { street: d.street ?? '', neighborhood: d.neighborhood ?? '', city: d.city ?? '', state: d.state ?? '' }
  }
  if (!found) return null
  const zip = `${digits.slice(0, 5)}-${digits.slice(5)}`
  const { street, neighborhood, city, state } = found
  const coords = await geocodeFirst(
    [
      [street, neighborhood, city, state].filter(Boolean).join(', '),
      [street, city, state].filter(Boolean).join(', '),
      [city, state].filter(Boolean).join(', '),
    ].filter(Boolean),
    signal,
  )
  return { ...found, zip, ...coords }
}

// ---- Coordenadas → endereço (pin arrastado ou "Usar minha localização") ----
export async function reverseGeocode(lat, lng) {
  if (googleActive()) {
    try {
      const gm = await loadGoogle()
      const { Geocoder } = await gm.importLibrary('geocoding')
      const { results } = await new Geocoder().geocode({ location: { lat, lng }, language: 'pt-BR' })
      if (results[0]) return fromGoogleComponents(results[0].address_components, lat, lng)
    } catch {
      googleFailed = true
    }
  }
  const res = await fetch(`${NOMINATIM}/reverse?${nominatimParams}&lat=${lat}&lon=${lng}`)
  if (!res.ok) throw new Error('nominatim')
  const r = await res.json()
  return r.address ? { ...fromNominatim(r), lat, lng } : null
}
