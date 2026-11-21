import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClientLocation } from '../lib/clientLocation'
import { imgSrc } from '../lib/catalog'
import { listDeals } from '../lib/deals'
import { formatBRL } from '../lib/format'
import { useDealBranches } from '../lib/useDealBranches'
import { useNearbyLocation } from '../lib/useNearbyLocation'
import DealBranchLine from './DealBranchLine'

// Faixa "Ofertas do bairro" da aba Produtos: carrossel horizontal com as promoções dos supermercados do bairro.
// Com `query`, só as ofertas do termo buscado; sem termo (visão "Todos os produtos"), as de maior desconto.
// O bairro vem do local de entrega do cliente; sem local definido, mostra as ofertas de todos os bairros.
// Cada card leva a /ofertas-do-bairro (o cupom só é gerado lá). Se a API estiver fora do ar ou não houver oferta, não renderiza nada.
const LIMIT = 8
const UNIT = { un: 'un', kg: 'kg', g: 'g', l: 'L', ml: 'ml', pacote: 'pacote', bandeja: 'bandeja' }

function DealsStrip({ query = '' }) {
  const { user } = useAuth()
  const { neighborhood } = useNearbyLocation(user?.id)
  const { coords } = useClientLocation(user?.id)
  const [deals, setDeals] = useState([])
  // A lista aparece sem esperar a rota; a filial mais próxima entra quando a 2ª requisição (com lat/lng) responde.
  const { branches, pending } = useDealBranches({ search: query, neighborhood, limit: LIMIT }, coords)

  useEffect(() => {
    let alive = true
    const fetchDeals = async () => {
      try {
        const d = await listDeals({ search: query, neighborhood, limit: LIMIT })
        if (alive) setDeals(Array.isArray(d) ? d : [])
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
        <h2>Ofertas do bairro <span className="dcount">{deals.length}</span></h2>
        <Link to="/ofertas-do-bairro">Ver todas</Link>
      </div>
      <ul className="deal-rail">
        {deals.map((d) => (
          <li key={d.id}>
            <Link className="card deal-mini" to="/ofertas-do-bairro">
              {d.discountPct > 0 && <span className="disc">-{d.discountPct}%</span>}
              <div className="thumb">
                <img src={imgSrc({ img: d.image })} alt={d.productName} width="400" height="400" loading="lazy" />
              </div>
              <span className="deal-chain">{d.chain.name}</span>
              <h3>{d.productName}</h3>
              <div className="prices">
                {d.originalPrice ? <s>{formatBRL(d.originalPrice)}</s> : <s className="ghost">&nbsp;</s>}
                <span className="price">
                  {formatBRL(d.discountPrice)}
                  <small> / {UNIT[d.unit] ?? d.unit}</small>
                </span>
              </div>
              <DealBranchLine branch={branches[d.id]} located={Boolean(coords)} pending={pending} compact />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default DealsStrip
