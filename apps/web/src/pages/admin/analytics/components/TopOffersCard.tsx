import { useId } from 'react'
import { formatBRL, formatInt } from '../format'
import type { TopOffer } from '../types'

// Ofertas de supermercado mais lucrativas (compras confirmadas por cupom).
function TopOffersCard({ offers }: { offers: TopOffer[] }) {
  const id = useId()
  const first = offers[0]
  return (
    <section className="an-card an-span-2" aria-labelledby={id}>
      <header className="an-card-head">
        <div>
          <h2 id={id}>Ofertas que mais deram lucro</h2>
          <p className="an-insight">
            {first ? (
              <>
                <strong>{first.productName}</strong> ({first.chain.name}) lidera: {formatBRL(first.profit)} de lucro.
              </>
            ) : (
              'Ofertas de supermercado com compra confirmada, ordenadas por lucro.'
            )}
          </p>
        </div>
      </header>
      {offers.length === 0 ? (
        <p className="an-rank-empty">Nenhuma oferta teve compra confirmada neste período.</p>
      ) : (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption className="an-sr">Ofertas por lucro, com rede, compras, unidades e faturamento</caption>
            <thead>
              <tr>
                <th scope="col">Oferta</th>
                <th scope="col" className="num">Compras</th>
                <th scope="col" className="num">Unid.</th>
                <th scope="col" className="num">Faturamento</th>
                <th scope="col" className="num">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={`${o.chain.slug}-${o.productName}`}>
                  <th scope="row">
                    {o.productName}
                    <span className="an-cell-sub">{o.chain.name}</span>
                  </th>
                  <td className="num">{formatInt(o.purchases)}</td>
                  <td className="num">{formatInt(o.units)}</td>
                  <td className="num">{formatBRL(o.revenue)}</td>
                  <td className="num profit">{formatBRL(o.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default TopOffersCard
