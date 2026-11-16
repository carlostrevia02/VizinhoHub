import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { track } from '../lib/track'
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

// Oferta relâmpago no carrinho: id "flash:<offerId>" + um retrato da oferta (ela não existe no catálogo).
const FLASH_PREFIX = 'flash:'
export const isFlashId = (id) => id.startsWith(FLASH_PREFIX)
const offerLimit = (o) => Math.max(0, Math.min(o.maxPerCustomer ?? 1, o.qtyAvailable ?? 1))
const offerAlive = (o) => o && new Date(o.endsAt).getTime() > Date.now()

// Linha do carrinho com o mesmo formato de produto da vitrine (stock = o quanto o cliente ainda pode levar).
const offerAsProduct = (o) => ({
  id: FLASH_PREFIX + o.id,
  flashOfferId: o.id,
  productId: o.productId,
  name: o.productName,
  img: o.image,
  unit: o.unit,
  price: o.offerPrice,
  oldPrice: o.originalPrice,
  stock: offerLimit(o),
  merchantId: o.merchantId,
  store: { name: o.storeName },
  endsAt: o.endsAt,
})

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
        .map((i) => ({ ...i, product: i.offer ? (offerAlive(i.offer) ? offerAsProduct(i.offer) : null) : getProduct(i.id) }))
        .filter((i) => i.product && i.product.stock > 0)
        .map(({ id, qty, offer, product }) => ({ id, qty: Math.min(qty, product.stock), ...(offer && { offer }) }))
      return JSON.stringify(next) === JSON.stringify(cur) ? cur : next
    })
  }, [catalogLoading, catalogError, getProduct])

  const add = useCallback(
    (id, qty = 1) => {
      const product = getProduct(id)
      const stock = product?.stock ?? 0
      if (stock > 0) track('ADD_TO_CART', product.merchantId, id)
      setItems((cur) => {
        const found = cur.find((i) => i.id === id)
        const next = Math.min((found?.qty ?? 0) + qty, stock)
        if (next <= 0) return cur
        return found ? cur.map((i) => (i.id === id ? { ...i, qty: next } : i)) : [...cur, { id, qty: next }]
      })
    },
    [getProduct],
  )

  // Oferta relâmpago: o limite é o menor entre o saldo da oferta e o máximo por cliente.
  const addOffer = useCallback((offer, qty = 1) => {
    const id = FLASH_PREFIX + offer.id
    const limit = offerLimit(offer)
    setItems((cur) => {
      const found = cur.find((i) => i.id === id)
      const next = Math.min((found?.qty ?? 0) + qty, limit)
      if (next <= 0) return cur
      return found ? cur.map((i) => (i.id === id ? { ...i, qty: next, offer } : i)) : [...cur, { id, qty: next, offer }]
    })
  }, [])

  const setQty = useCallback(
    (id, qty) => {
      setItems((cur) =>
        qty <= 0
          ? cur.filter((i) => i.id !== id)
          : cur.map((i) => {
              if (i.id !== id) return i
              const stock = i.offer ? offerLimit(i.offer) : (getProduct(id)?.stock ?? 0)
              return { ...i, qty: Math.min(qty, stock) }
            }),
      )
    },
    [getProduct],
  )

  const clear = useCallback(() => setItems([]), [])

  const value = useMemo(() => {
    const lines = items.map((i) => ({ id: i.id, qty: i.qty, product: i.offer ? offerAsProduct(i.offer) : getProduct(i.id) })).filter((l) => l.product)
    // Um pedido só pode ter produtos de uma loja (regra da API).
    const stores = [...new Map(lines.map((l) => [l.product.merchantId, l.product.store.name])).values()]
    return {
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      total: Math.round(lines.reduce((s, l) => s + l.qty * l.product.price * 100, 0)) / 100,
      stores,
      add,
      addOffer,
      setQty,
      clear,
    }
  }, [items, getProduct, add, addOffer, setQty, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = () => {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart deve ser usado dentro de <CartProvider>')
  return ctx
}
