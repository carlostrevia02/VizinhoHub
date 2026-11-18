import { Link } from 'react-router-dom'
import CatalogStatus from '../../components/CatalogStatus'
import ProductCard from '../../components/ProductCard'
import { useCatalog } from '../../context/CatalogContext'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

function Ofertas() {
  useDocumentTitle('VizinhoHub Store — Ofertas')
  return (
    <CatalogStatus>
      <OfertasContent />
    </CatalogStatus>
  )
}

function OfertasContent() {
  const { ofertas } = useCatalog()
  return (
    <main>
      <section className="page-hero red sk sk-img" style={{ '--i': 0 }}>
        <h1>Ofertas imperdíveis</h1>
        <p>
          {ofertas.length === 0
            ? 'Nenhum produto com desconto agora.'
            : `${ofertas.length} ${ofertas.length === 1 ? 'produto' : 'produtos'} com desconto — ordenados do maior para o menor desconto.`}
        </p>
      </section>
      {ofertas.length === 0 ? (
        <p className="sub">
          Os descontos são aplicados automaticamente a produtos próximos do vencimento.{' '}
          <Link to="/produtos" style={{ color: 'var(--green)', fontWeight: 700 }}>Ver todos os produtos</Link>
        </p>
      ) : (
        <div className="grid">
          {ofertas.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      )}
    </main>
  )
}

export default Ofertas
