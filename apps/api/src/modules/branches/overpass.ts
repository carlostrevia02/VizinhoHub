// Cliente da Overpass API (OpenStreetMap), gratuita e pública: tenta o servidor principal e depois os espelhos,
// com timeout por tentativa e espera crescente entre as rodadas. `fetch` e `sleep` são injetáveis para testar sem rede.
import { OVERPASS_QUERY, type OverpassElement } from './osm.js'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export const DEFAULT_USER_AGENT = 'VizinhoHub-import-branches/1.0 (projeto academico Unifor; importa filiais de supermercados de Fortaleza)'

export interface OverpassOptions {
  endpoints?: string[]
  userAgent?: string
  /** Tempo máximo de cada tentativa. */
  timeoutMs?: number
  /** Rodadas completas sobre a lista de servidores. */
  rounds?: number
  query?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Busca os elementos. Lança erro (nunca devolve resultado parcial) se nenhum servidor responder JSON completo. */
export async function fetchOverpass(opts: OverpassOptions = {}): Promise<OverpassElement[]> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS
  const timeoutMs = opts.timeoutMs ?? 70_000
  const rounds = opts.rounds ?? 3
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? wait
  const log = opts.log ?? (() => {})
  const body = new URLSearchParams({ data: opts.query ?? OVERPASS_QUERY })
  const failures: string[] = []

  for (let round = 1; round <= rounds; round++) {
    for (const url of endpoints) {
      const host = new URL(url).host
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': opts.userAgent ?? DEFAULT_USER_AGENT,
            accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { elements?: unknown; remark?: string }
        if (!Array.isArray(data.elements)) throw new Error('resposta sem "elements"')
        // O Overpass devolve 200 com um "remark" quando a consulta estoura tempo/memória e o resultado fica truncado.
        if (data.remark && /error|timed out|out of memory/i.test(data.remark)) throw new Error(`resultado incompleto: ${data.remark}`)
        log(`Overpass: ${data.elements.length} elementos de ${host}`)
        return data.elements as OverpassElement[]
      } catch (err) {
        const msg = `${host}: ${err instanceof Error ? err.message : String(err)}`
        failures.push(msg)
        log(`Overpass falhou (rodada ${round}/${rounds}) — ${msg}`)
      }
    }
    if (round < rounds) await sleep(5_000 * round)
  }
  throw new Error(`Overpass indisponível após ${rounds} rodadas: ${failures.slice(-endpoints.length).join('; ')}`)
}
