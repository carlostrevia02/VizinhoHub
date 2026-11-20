import { useId } from 'react'
import { formatBRL, formatInt } from '../format'
import type { TopCustomer } from '../types'

// Clientes que mais gastaram no período (pedidos online + cupons confirmados).
function TopCustomersCard({ customers }: { customers: TopCustomer[] }) {
  const id = useId()
  const first = customers[0]
  return (
    <section className="an-card an-span-3" aria-labelledby={id}>
      <header className="an-card-head">
        <div>
          <h2 id={id}>Clientes que mais compraram</h2>
          <p className="an-insight">
            {first ? (
              <>
                <strong>{first.name}</strong> é quem mais gastou: {formatBRL(first.spent)} em {formatInt(first.purchases)} {first.purchases === 1 ? 'compra' : 'compras'}.
              </>
            ) : (
              'Clientes ordenados pelo total gasto em compras confirmadas.'
            )}
          </p>
        </div>
      </header>
      {customers.length === 0 ? (
        <p className="an-rank-empty">Nenhum cliente comprou neste período.</p>
      ) : (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption className="an-sr">Clientes por total gasto, com número de compras e lucro gerado</caption>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col" className="num">Compras</th>
                <th scope="col" className="num">Total gasto</th>
                <th scope="col" className="num">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerId}>
                  <th scope="row">{c.name}</th>
                  <td className="num">{formatInt(c.purchases)}</td>
                  <td className="num">{formatBRL(c.spent)}</td>
                  <td className="num profit">{formatBRL(c.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default TopCustomersCard
