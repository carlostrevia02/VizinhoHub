// Distância e tempo de deslocamento (moto/carro) entre o cliente e candidatas de filial.
// Módulo puro (sem banco): usa o serviço de TABELA do OSRM público, de graça, com
// fallback offline (haversine × fator) e cache em memória para respeitar o uso justo do demo.

export interface LatLng {
  lat: number
  lng: number
}

export interface RouteResult {
  distanceM: number
  durationS: number
  /** true quando veio da estimativa local (haversine), não do OSRM. */
  estimated: boolean
}

const EARTH_RADIUS_M = 6_371_000

/** Fator que converte distância em linha reta em distância aproximada de rota por vias urbanas. */
const ROUTE_FACTOR = 1.35

/** Velocidade média usada na estimativa: trânsito urbano de moto em Fortaleza. */
export const AVG_SPEED_KMH = 25

const DEFAULT_BASE_URL = 'https://router.project-osrm.org'
const DEFAULT_TIMEOUT_MS = 4000
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 500
/** Política de uso justo do OSRM demo: no máximo ~1 requisição por segundo. */
const DEFAULT_MIN_INTERVAL_MS = 1000

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Distância em linha reta (grande círculo) entre dois pontos, em metros. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Estimativa sem rede: distância de rota ≈ haversine × 1,35, tempo pela velocidade média. */
export function estimateRoute(a: LatLng, b: LatLng): { distanceM: number; durationS: number } {
  const distanceM = haversineM(a, b) * ROUTE_FACTOR
  const durationS = distanceM / ((AVG_SPEED_KMH * 1000) / 3600)
  return { distanceM, durationS }
}

function assertValidPoint(p: LatLng, label: string): void {
  const ok = p != null && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180
  if (!ok) throw new Error(`Coordenadas inválidas em ${label}: lat deve estar entre -90 e 90 e lng entre -180 e 180 (números finitos)`)
}

export interface RouterOptions {
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
  /** Intervalo mínimo entre chamadas reais ao OSRM (padrão 1000 ms). */
  minIntervalMs?: number
  /** Espera injetável (para teste); padrão é setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

export interface Router {
  route(origin: LatLng, destinations: LatLng[]): Promise<RouteResult[]>
}

interface CacheEntry {
  value: { distanceM: number; durationS: number }
  expiresAt: number
}

/** Arredonda a 4 casas (~11 m) para a chave de cache. */
const r4 = (n: number) => (Math.round(n * 1e4) / 1e4).toFixed(4)
const cacheKey = (o: LatLng, d: LatLng) => `${r4(o.lat)},${r4(o.lng)}>${r4(d.lat)},${r4(d.lng)}`

export function createRouter(opts: RouterOptions = {}): Router {
  const doFetch = opts.fetch ?? globalThis.fetch
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const now = opts.now ?? Date.now
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  // Map preserva a ordem de inserção: a primeira chave é a mais antiga.
  const cache = new Map<string, CacheEntry>()
  let lastCallAt = Number.NEGATIVE_INFINITY
  // Fila que serializa as chamadas reais, para o espaçamento valer também sob concorrência.
  let queue: Promise<unknown> = Promise.resolve()

  function cacheGet(key: string): CacheEntry['value'] | undefined {
    const hit = cache.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= now()) {
      cache.delete(key)
      return undefined
    }
    return hit.value
  }

  function cacheSet(key: string, value: CacheEntry['value']): void {
    cache.delete(key) // reinsere no fim (renova a ordem)
    cache.set(key, { value, expiresAt: now() + ttl })
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  /** Chamada real ao OSRM; devolve um item por destino (null = sem rota/falha naquele par). */
  async function callOsrm(origin: LatLng, dests: LatLng[]): Promise<Array<{ distanceM: number; durationS: number } | null>> {
    const failed = dests.map(() => null)
    try {
      // OSRM usa a ordem lng,lat.
      const coords = [origin, ...dests].map((p) => `${p.lng},${p.lat}`).join(';')
      const destIdx = dests.map((_, i) => i + 1).join(';')
      const url = `${baseUrl}/table/v1/driving/${coords}?sources=0&destinations=${destIdx}&annotations=duration,distance`
      const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.status !== 200) return failed
      const body = (await res.json()) as { code?: string; durations?: Array<Array<number | null>>; distances?: Array<Array<number | null>> }
      if (body.code !== 'Ok') return failed
      const durations = body.durations?.[0]
      const distances = body.distances?.[0]
      if (!durations || !distances) return failed
      return dests.map((_, i) => {
        const durationS = durations[i]
        const distanceM = distances[i]
        if (typeof durationS !== 'number' || typeof distanceM !== 'number' || !Number.isFinite(durationS) || !Number.isFinite(distanceM)) return null
        return { distanceM, durationS }
      })
    } catch {
      // Rede, timeout ou JSON inválido: nunca propaga, cai no fallback.
      return failed
    }
  }

  /** Executa a chamada real respeitando o espaçamento mínimo e a serialização. */
  function spacedCall(origin: LatLng, dests: LatLng[]): Promise<Array<{ distanceM: number; durationS: number } | null>> {
    const run = async () => {
      const wait = lastCallAt + minInterval - now()
      if (wait > 0) await sleep(wait)
      lastCallAt = now()
      return callOsrm(origin, dests)
    }
    const result = queue.then(run, run)
    queue = result.catch(() => undefined)
    return result
  }

  return {
    async route(origin, destinations) {
      assertValidPoint(origin, 'origin')
      destinations.forEach((d, i) => assertValidPoint(d, `destinations[${i}]`))
      if (destinations.length === 0) return []

      const results: Array<RouteResult | undefined> = new Array(destinations.length).fill(undefined)
      const missing: number[] = []
      destinations.forEach((d, i) => {
        const hit = cacheGet(cacheKey(origin, d))
        if (hit) results[i] = { ...hit, estimated: false }
        else missing.push(i)
      })

      if (missing.length > 0) {
        const fetched = await spacedCall(
          origin,
          missing.map((i) => destinations[i]!),
        )
        missing.forEach((destIdx, k) => {
          const dest = destinations[destIdx]!
          const got = fetched[k]
          if (got) {
            cacheSet(cacheKey(origin, dest), got)
            results[destIdx] = { ...got, estimated: false }
          } else {
            // Estimativas não entram no cache: a próxima chamada tenta o OSRM de novo.
            results[destIdx] = { ...estimateRoute(origin, dest), estimated: true }
          }
        })
      }
      return results as RouteResult[]
    },
  }
}
