import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import featured from '../data/featured.json'
import { api, qs } from '../lib/api'
import { adaptProduct, norm, searchProducts, slugify } from '../lib/catalog'

const CatalogContext = createContext(null)
const PAGE = 500 // máximo por página na API

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

  const load = useCallback(async () => {
    try {
      const [products, categories] = await Promise.all([fetchAllProducts(), api.get('/categories')])
      setState({
        products: products.map(adaptProduct),
        // Só departamentos com produto vendável aparecem na vitrine.
        departments: categories.filter((c) => c.productCount > 0).map((c) => ({ id: c.id, slug: slugify(c.name), nome: c.name })),
        loading: false,
        error: false,
      })
    } catch (err) {
      console.error('Não foi possível carregar o catálogo:', err)
      setState((s) => ({ ...s, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    load()
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
      reload: load,
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
