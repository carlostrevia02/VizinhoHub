import pg from 'pg'
import type { RealtimeServer } from '../../shared/realtime.js'

// Catálogo em tempo real: triggers de products/categories (migração 015) fazem pg_notify('catalog_changed');
// este módulo escuta o canal com uma conexão DEDICADA (LISTEN não funciona através do pool) e repassa a mudança
// ao namespace público /catalog do Socket.io (sem token: a vitrine é aberta a visitantes anônimos).
// O evento não carrega dados: quem recebe recarrega o catálogo pela API.
export const CATALOG_NAMESPACE = '/catalog'
export const CATALOG_CHANNEL = 'catalog_changed'

export interface CatalogLiveOptions {
  connectionString: string
  /** Janela de agrupamento: no máximo 1 emissão por janela (padrão 2 s). */
  windowMs?: number
  /** Backoff da reconexão do LISTEN (padrão 1 s → 30 s). */
  minRetryMs?: number
  maxRetryMs?: number
  log?: (msg: string) => void
}

export interface CatalogLive {
  /** Resolve quando a primeira tentativa de conexão do LISTEN termina (com sucesso ou não; nunca rejeita). */
  ready: Promise<void>
  stop(): Promise<void>
}

export function startCatalogLive(io: RealtimeServer, opts: CatalogLiveOptions): CatalogLive {
  const { connectionString, windowMs = 2000, minRetryMs = 1000, maxRetryMs = 30_000, log = (m) => console.warn(m) } = opts
  const namespace = io.of(CATALOG_NAMESPACE) // sem io.use(): público; só o servidor emite

  let stopped = false
  let client: pg.Client | null = null
  let retryDelay = minRetryMs
  let retryTimer: NodeJS.Timeout | null = null
  let connecting: Promise<void> = Promise.resolve()
  let everConnected = false

  // Leading + trailing: a primeira notificação emite na hora; as seguintes dentro da janela viram uma só, no fim dela.
  let windowTimer: NodeJS.Timeout | null = null
  let pending = false
  const emit = () => {
    namespace.emit('catalog:changed')
    windowTimer = setTimeout(endWindow, windowMs)
    windowTimer.unref()
  }
  const endWindow = () => {
    windowTimer = null
    if (pending && !stopped) {
      pending = false
      emit()
    }
  }
  const changed = () => {
    if (stopped) return
    if (windowTimer) pending = true
    else emit()
  }

  const discard = (c: pg.Client) => {
    c.removeAllListeners()
    c.on('error', () => {}) // erro tardio de uma conexão já descartada não pode derrubar o processo
    return c.end().catch(() => {})
  }

  const scheduleRetry = () => {
    if (stopped || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      connecting = connect()
    }, retryDelay)
    retryTimer.unref()
    retryDelay = Math.min(retryDelay * 2, maxRetryMs)
  }

  const connect = async () => {
    if (stopped) return
    const c = new pg.Client({ connectionString, keepAlive: true })
    let lost = false
    const onLost = (err?: Error) => {
      if (lost) return
      lost = true
      if (client === c) client = null
      if (!stopped) log(`Catálogo em tempo real: conexão LISTEN perdida${err ? ` (${err.message})` : ''}; reconectando.`)
      discard(c)
      scheduleRetry()
    }
    c.on('error', onLost)
    c.on('end', () => onLost())
    c.on('notification', (msg) => {
      if (msg.channel === CATALOG_CHANNEL) changed()
    })
    try {
      await c.connect()
      await c.query(`LISTEN ${CATALOG_CHANNEL}`)
      if (stopped) return discard(c)
      client = c
      retryDelay = minRetryMs
      // Depois de uma queda, notificações podem ter sido perdidas: manda os clientes recarregarem.
      if (everConnected) changed()
      everConnected = true
    } catch (err) {
      onLost(err instanceof Error ? err : new Error(String(err)))
    }
  }

  connecting = connect()

  return {
    ready: connecting,
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      if (windowTimer) clearTimeout(windowTimer)
      retryTimer = windowTimer = null
      await connecting
      if (client) {
        const c = client
        client = null
        await discard(c)
      }
    },
  }
}
