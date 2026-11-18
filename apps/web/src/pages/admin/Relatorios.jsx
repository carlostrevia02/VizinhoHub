import { useState } from 'react'
import { useAdmin } from '../../context/AdminContext'
import { DONUT_COLORS, byDepartment, donutStyle, lastDays, sales, sum, topProducts } from '../../lib/analytics'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const RANGES = [
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
]

// Períodos curtos mostram um dia por barra; o de 30 dias agrupa em 4 "semanas".
function bars(orders, days) {
  const daily = lastDays(orders, days)
  if (days <= 7) return daily.map((d) => ({ label: d.label, total: d.total }))
  const size = Math.ceil(daily.length / 4)
  return Array.from({ length: 4 }, (_, i) => ({
    label: `S${i + 1}`,
    total: Math.round(daily.slice(i * size, (i + 1) * size).reduce((s, d) => s + d.total, 0) * 100) / 100,
  }))
}

function Relatorios() {
  useDocumentTitle('Relatórios — VizinhoHub Manager')
  const { orders, ordersError, reloadOrders, products } = useAdmin()
  const [days, setDays] = useState(30)

  if (ordersError) {
    return (
      <>
        <h1 className="page-title">Relatórios</h1>
        <p className="sub">Não foi possível carregar os pedidos.</p>
        <button className="btn" type="button" onClick={reloadOrders}>Tentar de novo</button>
      </>
    )
  }
  if (!orders) return <p className="muted">Carregando relatórios…</p>

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const inRange = orders.filter((o) => new Date(o.createdAt) >= start)
  const valid = sales(inRange)
  const cancelled = inRange.length - valid.length
  const revenue = sum(valid)
  const ticket = valid.length ? revenue / valid.length : 0
  const cancelRate = inRange.length ? (cancelled / inRange.length) * 100 : 0
  const chart = bars(orders, days)
  const chartMax = Math.max(...chart.map((b) => b.total), 1)
  const depts = byDepartment(inRange, products)
  const top = topProducts(inRange, 10)
  const catOf = new Map((products ?? []).map((p) => [p.id, p]))
  // A API devolve no máximo os 200 pedidos mais recentes; se o mais antigo é posterior ao início, o período pode estar incompleto.
  const truncated = orders.length >= 200 && new Date(orders[orders.length - 1].createdAt) > start

  return (
    <>
      <div className="row" style={{ marginBottom: '10px' }}>
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="sub" style={{ margin: 0 }}>Desempenho de vendas e estoque.</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => window.print()}>Imprimir / salvar PDF</button>
      </div>
      <div className="filters">
        {RANGES.map((r) => (
          <a
            key={r.days}
            href="#"
            className={days === r.days ? 'on' : undefined}
            onClick={(e) => {
              e.preventDefault()
              setDays(r.days)
            }}
          >
            {r.label}
          </a>
        ))}
      </div>
      {truncated && <p className="muted">Mostrando só os 200 pedidos mais recentes — o período pode estar incompleto.</p>}

      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Faturamento ({RANGES.find((r) => r.days === days).label.toLowerCase()})</span>
          <b>{formatBRL(revenue)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 1 }}>
          <span className="muted">Pedidos</span>
          <b>{valid.length}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 2 }}>
          <span className="muted">Ticket médio</span>
          <b>{formatBRL(ticket)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 3 }}>
          <span className="muted">Cancelamentos</span>
          <b>{cancelRate.toFixed(1).replace('.', ',')}%</b>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel sk sk-lines">
          <h3>{days <= 7 ? 'Faturamento por dia' : 'Faturamento por semana'}</h3>
          <div className="bars">
            {chart.map((b, i) => (
              <div className="bar" style={{ '--k': i }} key={`${b.label}-${i}`}>
                <b>{formatBRL(Math.round(b.total)).replace(',00', '')}</b>
                <i style={{ '--h': `${b.total > 0 ? Math.max(4, Math.round((b.total / chartMax) * 100)) : 2}%` }} />
              </div>
            ))}
          </div>
          <div className="bars-x">{chart.map((b, i) => <span key={`${b.label}-${i}`}>{b.label}</span>)}</div>
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 1 }}>
          <h3>Vendas por departamento</h3>
          {depts.length === 0 ? (
            <p className="muted">Sem vendas no período.</p>
          ) : (
            <div className="donut-wrap">
              <div className="donut" style={donutStyle(depts)} role="img" aria-label="Vendas por departamento" />
              <div className="legend">
                {depts.map((d, i) => (
                  <div style={{ '--k': i }} key={d.name}>
                    <i style={{ background: DONUT_COLORS[i] }} />
                    {d.name} <b>{d.pct}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h3>Produtos mais vendidos no período</h3>
        {top.length === 0 ? (
          <p className="muted">Sem vendas no período.</p>
        ) : (
          <div className="table-wrap">
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 'auto' }}>Produto</th>
                  <th style={{ width: 'auto' }}>Departamento</th>
                  <th style={{ width: 'auto' }}>Unidades</th>
                  <th style={{ width: 'auto' }}>Receita</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p, i) => {
                  const product = catOf.get(p.productId)
                  return (
                    <tr style={{ '--i': i }} key={p.productId}>
                      <td>
                        <img className="pimg" src={imgSrc({ img: product?.image })} alt="" width="76" height="76" loading="lazy" />
                        {p.name}
                      </td>
                      <td>{product?.category.name ?? '—'}</td>
                      <td>{p.qty}</td>
                      <td>{formatBRL(p.revenue)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

export default Relatorios
