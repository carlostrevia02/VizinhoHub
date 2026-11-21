import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClientLocation } from '../lib/clientLocation'
import { listDeals } from '../lib/deals'
import { formatBRL } from '../lib/format'
import { useDealBranches } from '../lib/useDealBranches'
import { useNearbyLocation } from '../lib/useNearbyLocation'
import DealBranchLine from './DealBranchLine'

// "Leite em oferta no São Luiz": mostra, acima dos resultados da busca, as promoções dos supermercados
// do bairro para o mesmo termo. Se a API estiver fora do ar ou não houver oferta, não renderiza nada.
// O bairro vem do local de entrega do cliente; sem local definido, mostra as ofertas de todos os bairros.
function DealsStrip({ query }) {
  const { user } = useAuth()
  const { neighborhood } = useNearbyLocation(user?.id)
  const { coords } = useClientLocation(user?.id)
  const [deals, setDeals] = useState([])
  // A lista aparece sem esperar a rota; a filial mais próxima entra quando a 2ª requisição (com lat/lng) responde.
  const { branches, pending } = useDealBranches({ search: query, neighborhood, limit: 4 }, coords)

  useEffect(() => {
    let alive = true
    const fetchDeals = async () => {
      try {
        const d = await listDeals({ search: query, neighborhood, limit: 4 })
        if (alive) setDeals(d)
      } catch {
        if (alive) setDeals([])
      }
    }
    fetchDeals()
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
            <DealBranchLine branch={branches[d.id]} located={Boolean(coords)} pending={pending} compact />
          </li>
        ))}
      </ul>
    </section>
  )
}

export default DealsStrip
