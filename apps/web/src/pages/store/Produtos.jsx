import { useEffect } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import CatalogStatus from '../../components/CatalogStatus'
import DealsStrip from '../../components/DealsStrip'
import ProductCard from '../../components/ProductCard'
import { useCatalog } from '../../context/CatalogContext'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export default function Produtos() {
  useDocumentTitle('VizinhoHub Store — Produtos')
  return (
    <CatalogStatus>
      <ProdutosContent />
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
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
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
            <div className="grid">
              {results.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          </>
        ) : (
          <>
            <h1 className="page-title">Todos os produtos</h1>
            <p className="sub">
              {totalProducts} produtos em {productsByDepartment.length} departamentos — continue rolando para descobrir
              mais.
            </p>
            {productsByDepartment.map((d) => (
              <section key={d.slug} className="dept-section" id={d.slug}>
                <div className="section-head">
                  <h2>{d.nome} <span className="dcount">{d.products.length}</span></h2>
                  <a href="#topo">Voltar ao topo</a>
                </div>
                <div className="grid">
                  {d.products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </>
  )
}
