import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, qs } from '../lib/api'
import { beep } from '../lib/realtime'
import { orderCode, useOrders } from '../lib/useOrders'
import { formatBRL } from '../lib/format'
import { useAuth } from './AuthContext'

const AdminContext = createContext(null)
const PAGE = 500 // máximo por página na API

// PENDING → IN_PREPARATION → READY → COMPLETED (o cancelamento é uma ação à parte).
export const NEXT_STATUS = { PENDING: 'IN_PREPARATION', IN_PREPARATION: 'READY', READY: 'COMPLETED' }
export const ADVANCE_LABEL = { PENDING: 'Avançar Status', IN_PREPARATION: 'Avançar Status', READY: 'Marcar como Entregue' }

export const errorMessage = (err) => (err instanceof ApiError ? err.message : 'Algo deu errado. Tente novamente.')

async function fetchMyProducts() {
  const all = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await api.get(`/products/mine${qs({ limit: PAGE, offset })}`)
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

/** Dados do painel do comerciante: pedidos da loja (em tempo real), produtos da loja e avisos. */
export function AdminProvider({ children }) {
  const { token } = useAuth()
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const notify = useCallback((title, sub, tone = 'info') => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), title, sub, tone })
    timer.current = setTimeout(() => setToast(null), 6000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const { orders, error: ordersError, reload: reloadOrders, upsert } = useOrders(
    token,
    { limit: 200 },
    {
      onCreated: (o) => {
        beep()
        const count = o.items.reduce((n, i) => n + i.quantity, 0)
        notify(
          `Novo pedido #${orderCode(o.id)}`,
          `${o.contact.name ?? o.customer?.name ?? 'Cliente'} · ${count} ${count === 1 ? 'item' : 'itens'} · ${formatBRL(o.totalPrice)}`,
        )
      },
    },
  )

  const [products, setProducts] = useState(null) // null = carregando
  const [productsError, setProductsError] = useState(false)
  const reloadProducts = useCallback(async () => {
    setProductsError(false)
    try {
      setProducts(await fetchMyProducts())
    } catch (err) {
      console.error('Não foi possível carregar os produtos da loja:', err)
      setProductsError(true)
    }
  }, [])
  useEffect(() => {
    if (token) reloadProducts()
  }, [token, reloadProducts])

  // Departamentos (categorias globais) para os formulários e filtros.
  const [categories, setCategories] = useState([])
  useEffect(() => {
    api.get('/categories').then(setCategories).catch((err) => console.error('Não foi possível carregar os departamentos:', err))
  }, [])

  // Muda o status no servidor; a resposta (e o evento em tempo real) atualizam a lista.
  const setStatus = useCallback(
    async (order, status) => {
      try {
        const updated = await api.patch(`/orders/${order.id}/status`, { status })
        upsert(updated)
        if (status === 'IN_PREPARATION' || status === 'CANCELLED') reloadProducts() // estoque mudou
        return updated
      } catch (err) {
        notify(`Pedido #${orderCode(order.id)}`, errorMessage(err), 'error')
        if (err instanceof ApiError && err.status === 409) reloadOrders() // alguém já mudou o status
        return null
      }
    },
    [upsert, notify, reloadOrders, reloadProducts],
  )

  const value = useMemo(
    () => ({
      orders,
      ordersError,
      reloadOrders,
      products,
      productsError,
      reloadProducts,
      categories,
      setStatus,
      advance: (order) => NEXT_STATUS[order.status] && setStatus(order, NEXT_STATUS[order.status]),
      cancel: (order) => setStatus(order, 'CANCELLED'),
      toast,
      notify,
      dismissToast: () => setToast(null),
      activeOrders: orders?.filter((o) => o.status === 'PENDING' || o.status === 'IN_PREPARATION' || o.status === 'READY') ?? [],
    }),
    [orders, ordersError, reloadOrders, products, productsError, reloadProducts, categories, setStatus, toast, notify],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export const useAdmin = () => {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin deve ser usado dentro de <AdminProvider>')
  return ctx
}
