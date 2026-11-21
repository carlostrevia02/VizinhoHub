import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, qs } from '../lib/api'
import { startAlarm, stopAlarm } from '../lib/alert'
import { autoPrintEnabled, runPrintJob } from '../lib/print'
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

  const { orders, error: ordersError, reload: reloadOrders, upsert, live } = useOrders(
    token,
    { limit: 200 },
    {
      onPrintJob: (job) => {
        if (autoPrintEnabled()) runPrintJob(job)
      },
      onCreated: (o) => {
        startAlarm() // toca em loop até alguém clicar em "Atender"
        const count = o.items.reduce((n, i) => n + i.quantity, 0)
        notify(
          `Novo pedido #${orderCode(o.id)}`,
          `${o.contact.name ?? o.customer?.name ?? 'Cliente'} · ${count} ${count === 1 ? 'item' : 'itens'} · ${formatBRL(o.totalPrice)}`,
        )
      },
    },
  )

  // Comandas que ficaram na fila enquanto o caixa estava fechado/offline.
  useEffect(() => {
    if (!token || !autoPrintEnabled()) return
    const printPending = async () => {
      try {
        const jobs = await api.get('/print-jobs/pending')
        jobs.forEach(runPrintJob)
      } catch {}
    }
    printPending()
  }, [token])

  // Sem pedido pendente, o alarme para sozinho (outro dispositivo atendeu, ou foi cancelado).
  const pendingCount = orders?.filter((o) => o.status === 'PENDING').length ?? 0
  useEffect(() => {
    if (pendingCount === 0) stopAlarm()
  }, [pendingCount])
  useEffect(() => stopAlarm, [])

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
    const fetchCategories = async () => {
      try {
        setCategories(await api.get('/categories'))
      } catch (err) {
        console.error('Não foi possível carregar os departamentos:', err)
      }
    }
    fetchCategories()
  }, [])

  // Muda o status no servidor; a resposta (e o evento em tempo real) atualizam a lista.
  const setStatus = useCallback(
    async (order, status) => {
      try {
        const updated = await api.patch(`/orders/${order.id}/status`, { status })
        upsert(updated)
        return updated
      } catch (err) {
        notify(`Pedido #${orderCode(order.id)}`, errorMessage(err), 'error')
        if (err instanceof ApiError && err.status === 409) reloadOrders() // alguém já mudou o status
        return null
      }
    },
    [upsert, notify, reloadOrders],
  )

  const value = useMemo(
    () => ({
      orders,
      ordersError,
      reloadOrders,
      live,
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
      pendingCount,
      activeOrders: orders?.filter((o) => o.status === 'PENDING' || o.status === 'IN_PREPARATION' || o.status === 'READY') ?? [],
    }),
    [orders, ordersError, live, pendingCount, reloadOrders, products, productsError, reloadProducts, categories, setStatus, toast, notify],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export const useAdmin = () => {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin deve ser usado dentro de <AdminProvider>')
  return ctx
}
