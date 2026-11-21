import { useEffect } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import CatalogStatus from '../../components/CatalogStatus'
import DealsStrip from '../../components/DealsStrip'
import DeptSection from '../../components/DeptSection'
import LazyGrid from '../../components/LazyGrid'
import { useCatalog } from '../../context/CatalogContext'
import { FlashOffersProvider } from '../../lib/flashOffers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

function Produtos() {
  useDocumentTitle('VizinhoHub Store — Produtos')
  return (
    <CatalogStatus>
      <FlashOffersProvider>
        <ProdutosContent />
      </FlashOffersProvider>
    </CatalogStatus>
  )
}

function ProdutosContent() {
  const { productsByDepartment, totalProducts, search } = useCatalog()
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const query = params.get('q')?.trim() ?? ''
  const results = query ? search(query) : null

  // Links como /produtos#bebidas: rola até o departamento depois que ele é renderizado.
  // As seções acima do alvo montam depois do salto e mudam a altura da página:
  // reaplica o scroll a cada mudança de layout por ~2s, até o usuário interagir.
  useEffect(() => {
    if (!hash) return undefined
    const goto = () => document.getElementById(hash.slice(1))?.scrollIntoView()
    goto()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(goto)
    ro.observe(document.body)
    const stop = () => ro.disconnect()
    const timer = setTimeout(stop, 2000)
    const evts = ['wheel', 'touchstart', 'keydown', 'pointerdown']
    evts.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }))
    return () => {
      clearTimeout(timer)
      stop()
      evts.forEach((e) => window.removeEventListener(e, stop))
    }
  }, [hash])

  return (
    <>
      <span id="topo"></span>
      {!results && (
        <div className="dept-nav">
          <div className="chips">
            {productsByDepartment.map((d) => (
              <a key={d.slug} className="chip" href={`#${d.slug}`}>{d.nome}</a>
            ))}
          </div>
        </div>
      )}
      <main>
        {results ? (
          <>
            <h1 className="page-title">Resultados para “{query}”</h1>
            <DealsStrip query={query} />
            <p className="sub">
              {results.length === 0
                ? 'Nenhum produto encontrado. Tente outro termo ou navegue pelos departamentos.'
                : `${results.length} ${results.length === 1 ? 'produto encontrado' : 'produtos encontrados'}.`}{' '}
              <Link to="/produtos" style={{ color: 'var(--green)', fontWeight: 700 }}>Ver todos os produtos</Link>
            </p>
            <LazyGrid key={query} products={results} />
          </>
        ) : (
          <>
            <h1 className="page-title">Todos os produtos</h1>
            <p className="sub">
              {totalProducts} produtos em {productsByDepartment.length} departamentos — continue rolando para descobrir
              mais.
            </p>
            <DealsStrip />
            {productsByDepartment.map((d) => (
              <DeptSection key={d.slug} dept={d} />
            ))}
          </>
        )}
      </main>
    </>
  )
}

export default Produtos
