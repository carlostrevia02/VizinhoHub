import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../context/CatalogContext'
import { useAuth } from '../context/AuthContext'
import { useClientLocation } from './clientLocation'
import { matchDealToProduct } from './dealMatch'
import { listDeals } from './deals'
import { useDealBranches } from './useDealBranches'
import { useNearbyLocation } from './useNearbyLocation'

// Ofertas do bairro (supermercados de panfleto, GET /deals) DENTRO do cartão do produto, como o Tá Quentinho.
// Cada oferta é casada, por nome aproximado (lib/dealMatch), com um produto do catálogo; o cartão mostra o
// desconto, o preço da oferta e a filial mais próxima. Uma chamada para a página toda, renovada a cada 5 min.
// Não pede GPS: usa a localização que o site já tem. Falha de rede é silenciosa (cartões como sempre foram).
const REFRESH_MS = 5 * 60_000
const NONE = new Map()
const EMPTY = { index: NONE, branches: {}, pending: false, located: false }
const NeighborhoodDealsContext = createContext(null)

// Só os providers ligam: dentro deles, todo cartão reserva a faixa de oferta (altura igual com e sem oferta).
// Fora (Home, Ofertas, página do produto) o cartão não reserva nada.
const ReserveOfferRowContext = createContext(false)
export const useReserveOfferRow = () => useContext(ReserveOfferRowContext)

// Preço de referência = preço original da oferta ou, sem ele, o do produto. Sem desconto real (preço da oferta
// >= referência), a oferta não vale: nada de "desconto" falso.
export function dealPricing(deal, product) {
  const refPrice = deal.originalPrice ?? product.price
  if (!(deal.discountPrice < refPrice)) return null
  const pct = Math.max(1, deal.discountPct ?? Math.round((1 - deal.discountPrice / refPrice) * 100))
  return { refPrice, pct }
}

/** productId -> { deal, refPrice, pct }; a oferta de menor preço fica com o produto. Pura (testável). */
export function indexDeals(deals, products) {
  const map = new Map()
  for (const deal of deals) {
    const hit = matchDealToProduct(deal, products)
    if (!hit) continue
    const pricing = dealPricing(deal, hit.product)
    if (!pricing) continue
    const cur = map.get(hit.product.id)
    if (!cur || deal.discountPrice < cur.deal.discountPrice) map.set(hit.product.id, { deal, ...pricing })
  }
  return map
}

export function NeighborhoodDealsProvider({ children }) {
  const { user } = useAuth()
  const { neighborhood } = useNearbyLocation(user?.id)
  const { coords } = useClientLocation(user?.id)
  const { products } = useCatalog()
  const [deals, setDeals] = useState([])
  const params = { neighborhood, limit: 200 }
  const { branches, pending } = useDealBranches(params, coords)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const list = await listDeals({ neighborhood, limit: 200 })
        if (alive && Array.isArray(list)) setDeals(list)
      } catch {
        /* falha de rede: silenciosa, mantém o que já estava na tela */
      }
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [neighborhood])

  const index = useMemo(() => (deals.length && products.length ? indexDeals(deals, products) : NONE), [deals, products])
  const located = Boolean(coords)
  const value = useMemo(() => ({ index, branches, pending, located }), [index, branches, pending, located])

  return (
    <ReserveOfferRowContext.Provider value>
      <NeighborhoodDealsContext.Provider value={value}>{children}</NeighborhoodDealsContext.Provider>
    </ReserveOfferRowContext.Provider>
  )
}

/** { deal, branch, pending, refPrice, pct, located } da oferta do bairro casada com o produto, ou null (também fora do provider). */
export function useNeighborhoodDeal(productId) {
  const ctx = useContext(NeighborhoodDealsContext) ?? EMPTY
  const hit = ctx.index.get(productId)
  if (!hit) return null
  return {
    deal: hit.deal,
    branch: ctx.branches[hit.deal.id] ?? null,
    pending: ctx.pending,
    refPrice: hit.refPrice,
    pct: hit.pct,
    located: ctx.located,
  }
}
