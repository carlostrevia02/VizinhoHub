import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useCatalog } from './CatalogContext'

const CartContext = createContext(null)
const STORAGE_KEY = 'vizinhohub:cart:v2' // v2: ids de produto são UUIDs da API (a v1 usava números do catálogo estático)

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return saved.filter((i) => typeof i.id === 'string' && i.qty > 0)
  } catch {
    return []
  }
}

export function CartProvider({ children }) {
  const { getProduct, loading: catalogLoading, error: catalogError } = useCatalog()
  const [items, setItems] = useState(load) // [{ id, qty }]

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      /* armazenamento indisponível: o carrinho vale só nesta sessão */
    }
  }, [items])

  // Depois que o catálogo carrega, descarta o que saiu da vitrine e limita a quantidade ao estoque atual.
  useEffect(() => {
    if (catalogLoading || catalogError) return
    setItems((cur) => {
      const next = cur
        .map((i) => ({ ...i, product: getProduct(i.id) }))
        .filter((i) => i.product && i.product.stock > 0)
        .map(({ id, qty, product }) => ({ id, qty: Math.min(qty, product.stock) }))
      return JSON.stringify(next) === JSON.stringify(cur) ? cur : next
    })
  }, [catalogLoading, catalogError, getProduct])

  const add = useCallback(
    (id, qty = 1) => {
      const stock = getProduct(id)?.stock ?? 0
      setItems((cur) => {
        const found = cur.find((i) => i.id === id)
        const next = Math.min((found?.qty ?? 0) + qty, stock)
        if (next <= 0) return cur
        return found ? cur.map((i) => (i.id === id ? { ...i, qty: next } : i)) : [...cur, { id, qty: next }]
      })
    },
    [getProduct],
  )

  const setQty = useCallback(
    (id, qty) => {
      const stock = getProduct(id)?.stock ?? 0
      setItems((cur) =>
        qty <= 0 ? cur.filter((i) => i.id !== id) : cur.map((i) => (i.id === id ? { ...i, qty: Math.min(qty, stock) } : i)),
      )
    },
    [getProduct],
  )

  const clear = useCallback(() => setItems([]), [])

  const value = useMemo(() => {
    const lines = items.map((i) => ({ ...i, product: getProduct(i.id) })).filter((l) => l.product)
    // Um pedido só pode ter produtos de uma loja (regra da API).
    const stores = [...new Map(lines.map((l) => [l.product.merchantId, l.product.store.name])).values()]
    return {
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      total: Math.round(lines.reduce((s, l) => s + l.qty * l.product.price * 100, 0)) / 100,
      stores,
      add,
      setQty,
      clear,
    }
  }, [items, getProduct, add, setQty, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = () => {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart deve ser usado dentro de <CartProvider>')
  return ctx
}
