import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDeals } from '../lib/deals'
import { formatBRL } from '../lib/format'

// "Leite em oferta no São Luiz": mostra, acima dos resultados da busca, as promoções dos supermercados
// do bairro para o mesmo termo. Se a API estiver fora do ar ou não houver oferta, não renderiza nada.
function DealsStrip({ query, neighborhood = 'Aldeota' }) {
  const [deals, setDeals] = useState([])

  useEffect(() => {
    let alive = true
    listDeals({ search: query, neighborhood, limit: 4 })
      .then((d) => alive && setDeals(d))
      .catch(() => alive && setDeals([]))
    return () => {
      alive = false
    }
  }, [query, neighborhood])

  if (deals.length === 0) return null
  return (
    <section className="deal-strip" aria-label="Ofertas nos supermercados do bairro">
      <div className="section-head">
        <h2>Em oferta nos mercados do bairro</h2>
        <Link to="/ofertas-do-bairro">Ver todas</Link>
      </div>
      <ul>
        {deals.map((d) => (
          <li key={d.id}>
            <Link to="/ofertas-do-bairro">
              {d.discountPct > 0 && <span className="tag low">-{d.discountPct}%</span>} <b>{d.productName}</b>
              <span className="muted"> · {d.chain.name} · {formatBRL(d.discountPrice)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default DealsStrip
