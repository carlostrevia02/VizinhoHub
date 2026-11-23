import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, qs } from './api'
import { useRealtime } from './realtime'

// Rótulos e cores (classe `tag`) de cada status do pedido na API.
export const ORDER_STATUS = {
  PENDING: { tone: 'new', label: 'Pendente' },
  IN_PREPARATION: { tone: 'prep', label: 'Em preparação' },
  READY: { tone: 'ok', label: 'Pronto' },
  COMPLETED: { tone: 'off', label: 'Entregue' },
  CANCELLED: { tone: 'low', label: 'Cancelado' },
}

export const statusInfo = (status) => ORDER_STATUS[status] ?? { tone: 'off', label: status }
export const orderCode = (id) => id.slice(0, 6).toUpperCase()

export const customerName = (o) => o.contact.name ?? o.customer?.name ?? (o.channel === 'POS' ? 'Venda de balcão' : 'Cliente')
export const itemCount = (o) => o.items.reduce((n, i) => n + i.quantity, 0)
export const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString()
export const formatTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export const formatWhen = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Data e hora com ano (exportações).
export const formatWhenFull = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Entrega pelo fluxo de logística (entregador ou frota própria, concluída com o PIN do cliente na tela Entregas). */
export const hasDeliveryFlow = (o) => o.fulfillment === 'DELIVERY' || o.fulfillment === 'FLASH'

/** Pedido de entrega. Usa `fulfillment`; o texto livre só vale para DTO antigo sem o campo. */
export const isDeliveryOrder = (o) => (o.fulfillment ? hasDeliveryFlow(o) : /entrega/i.test(o.contact.deliveryMethod ?? ''))

const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt)

const ORDERS_PAGE = 200 // máximo por página em GET /orders

/** Todos os pedidos (mais recentes primeiro): percorre as páginas de GET /orders (limit + offset) até acabar. */
export async function fetchAllOrders(params = {}) {
  const byId = new Map()
  for (let offset = 0; ; offset += ORDERS_PAGE) {
    const page = await api.get(`/orders${qs({ ...params, limit: ORDERS_PAGE, offset })}`)
    for (const o of page) byId.set(o.id, o) // pedido novo durante a carga desloca as páginas: o id evita repetir
    if (page.length < ORDERS_PAGE) return [...byId.values()].sort(byNewest)
  }
}

/**
 * Histórico completo da loja, sob demanda (Clientes, Pedidos): carrega todas as páginas uma vez e sobrepõe `live`
 * (os pedidos recentes do painel, atualizados em tempo real). `orders` é null enquanto carrega.
 */
export function useAllOrders(token, live) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      setHistory(await fetchAllOrders())
    } catch (err) {
      console.error('Não foi possível carregar o histórico de pedidos:', err)
      setError(true)
    }
  }, [])

  useEffect(() => {
    if (token) load()
  }, [token, load])

  const orders = useMemo(() => {
    if (!history) return null
    const byId = new Map(history.map((o) => [o.id, o]))
    for (const o of live ?? []) byId.set(o.id, o)
    return [...byId.values()].sort(byNewest)
  }, [history, live])

  return { orders, error, reload: load }
}

/**
 * Pedidos do usuário logado (cliente: os próprios; comerciante: os da loja), sempre atualizados pelo tempo real.
 * `orders` é null enquanto carrega. `handlers.onCreated/onUpdated` recebem o pedido do evento (toasts, bipes…).
 * `live` diz se o tempo real está conectado; ao reconectar depois de uma queda a lista é recarregada (eventos perdidos).
 * `params.withActive`: além da página pedida (mais recentes), traz TODOS os pedidos em andamento — um pedido antigo
 * ainda em preparação não pode sumir do mural só porque saiu dos 200 mais recentes.
 */
export function useOrders(token, params = {}, handlers = {}) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(false)
  const { withActive, ...apiParams } = params
  const query = qs(apiParams)

  const load = useCallback(async () => {
    setError(false)
    try {
      const [recent, active] = await Promise.all([api.get(`/orders${query}`), withActive ? fetchAllOrders({ active: 'true' }) : []])
      setOrders(withActive ? [...new Map([...recent, ...active].map((o) => [o.id, o])).values()].sort(byNewest) : recent)
    } catch (err) {
      console.error('Não foi possível carregar os pedidos:', err)
      setError(true)
    }
  }, [query, withActive])

  useEffect(() => {
    if (!token) return undefined
    load()
    return undefined
  }, [token, load])

  const upsert = useCallback((order) => {
    setOrders((cur) => {
      if (!cur) return cur
      const rest = cur.filter((o) => o.id !== order.id)
      return [order, ...rest].sort(byNewest)
    })
  }, [])

  const live = useRealtime(token, {
    'order:created': (order) => {
      upsert(order)
      handlers.onCreated?.(order)
    },
    'order:status_updated': (order) => {
      upsert(order)
      handlers.onUpdated?.(order)
    },
    'print:job': (job) => handlers.onPrintJob?.(job),
  })

  // Depois de uma queda, o que chegou enquanto estava offline só aparece recarregando.
  const dropped = useRef(false)
  const everLive = useRef(false)
  useEffect(() => {
    if (!live) {
      dropped.current = everLive.current
      return
    }
    everLive.current = true
    if (dropped.current) {
      dropped.current = false
      load()
    }
  }, [live, load])

  return { orders, error, reload: load, upsert, live }
}
