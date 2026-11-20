import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import featured from '../data/featured.json'
import { api, qs } from '../lib/api'
import { adaptProduct, norm, searchProducts, slugify } from '../lib/catalog'
import { useCatalogLive } from '../lib/realtime'

const CatalogContext = createContext(null)
const PAGE = 500 // máximo por página na API
const LIVE_DEBOUNCE_MS = 1000 // junta rajadas de avisos do servidor numa recarga só
const POLL_MS = 60_000 // plano B se o socket estiver indisponível

async function fetchAllProducts() {
  const all = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await api.get(`/products${qs({ limit: PAGE, offset })}`)
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

export function CatalogProvider({ children }) {
  const [state, setState] = useState({ products: [], departments: [], loading: true, error: false })

  // `silent`: recarga em segundo plano (tempo real/polling): não volta a `loading`, mantém os dados em erro.
  const load = useCallback(async (silent = false) => {
    try {
      const [products, categories] = await Promise.all([fetchAllProducts(), api.get('/categories')])
      const next = products.map(adaptProduct)
      // Só departamentos com produto vendável aparecem na vitrine.
      const nextDepartments = categories.filter((c) => c.productCount > 0).map((c) => ({ id: c.id, slug: slugify(c.name), nome: c.name }))
      setState((s) => {
        // Reaproveita o objeto de quem não mudou: os cards (React.memo) não re-renderizam a cada aviso do servidor.
        const before = new Map(s.products.map((p) => [p.id, p]))
        const products = next.map((p) => {
          const old = before.get(p.id)
          return old && JSON.stringify(old) === JSON.stringify(p) ? old : p
        })
        const sameDepartments = JSON.stringify(s.departments) === JSON.stringify(nextDepartments)
        return { products, departments: sameDepartments ? s.departments : nextDepartments, loading: false, error: false }
      })
    } catch (err) {
      if (silent) {
        console.warn('Não foi possível atualizar o catálogo em segundo plano:', err)
        return
      }
      console.error('Não foi possível carregar o catálogo:', err)
      setState((s) => ({ ...s, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tempo real: o servidor avisa quando produtos/categorias mudam; recarrega em silêncio, com debounce.
  const liveTimer = useRef(null)
  const refreshSoon = useCallback(() => {
    clearTimeout(liveTimer.current)
    liveTimer.current = setTimeout(() => load(true), LIVE_DEBOUNCE_MS)
  }, [load])
  useCatalogLive(refreshSoon)
  useEffect(() => () => clearTimeout(liveTimer.current), [])

  // Plano B: a cada 60 s, só com a aba visível, caso o socket esteja fora do ar.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const value = useMemo(() => {
    const { products, departments } = state
    const byId = new Map(products.map((p) => [p.id, p]))
    const byName = new Map(products.map((p) => [norm(p.name), p]))
    const byDept = new Map(departments.map((d) => [d.slug, d]))
    // Maior desconto primeiro (Salva-Estoque); só o que ainda tem estoque.
    const ofertas = products.filter((p) => p.discount > 0 && p.stock > 0).sort((a, b) => b.discount - a.discount || a.name.localeCompare(b.name))

    return {
      ...state,
      reload: () => load(),
      departments,
      totalProducts: products.length,
      getProduct: (id) => byId.get(id),
      getDepartment: (slug) => byDept.get(slug),
      productsByDepartment: departments.map((d) => ({ ...d, products: products.filter((p) => p.dept === d.slug) })),
      ofertas,
      homeOfertas: ofertas.slice(0, 14),
      // Seleção editorial (src/data/featured.json); o que não existir mais no catálogo é ignorado.
      homeMaisVendidos: featured.homeMaisVendidos.map((n) => byName.get(norm(n))).filter(Boolean),
      // "Quem viu também comprou": mesmo departamento, sem o próprio produto.
      related: (p, n = 6) => products.filter((x) => x.dept === p.dept && x.id !== p.id).slice(0, n),
      search: (q) => searchProducts(products, q),
    }
  }, [state, load])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export const useCatalog = () => {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog deve ser usado dentro de <CatalogProvider>')
  return ctx
}
