import { useCallback, useEffect, useState } from 'react'
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

const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt)

/**
 * Pedidos do usuário logado (cliente: os próprios; comerciante: os da loja), sempre atualizados pelo tempo real.
 * `orders` é null enquanto carrega. `handlers.onCreated/onUpdated` recebem o pedido do evento (toasts, bipes…).
 */
export function useOrders(token, params = {}, handlers = {}) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(false)
  const query = qs(params)

  const load = useCallback(async () => {
    setError(false)
    try {
      setOrders(await api.get(`/orders${query}`))
    } catch (err) {
      console.error('Não foi possível carregar os pedidos:', err)
      setError(true)
    }
  }, [query])

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

  useRealtime(token, {
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

  return { orders, error, reload: load, upsert }
}
