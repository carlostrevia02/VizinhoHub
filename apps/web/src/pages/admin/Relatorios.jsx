import { useState } from 'react'
import { useAdmin } from '../../context/AdminContext'
import { useAuth } from '../../context/AuthContext'
import { DONUT_COLORS, departments, donutStyle, useSummary, weekdayLabel } from '../../lib/analytics'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const RANGES = [
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
]

// Períodos curtos mostram um dia por barra; o de 30 dias agrupa em 4 "semanas".
function bars(daily, days) {
  if (days <= 7) return daily.map((d) => ({ label: weekdayLabel(d.date), total: d.revenue }))
  const size = Math.ceil(daily.length / 4)
  return Array.from({ length: 4 }, (_, i) => ({
    label: `S${i + 1}`,
    total: Math.round(daily.slice(i * size, (i + 1) * size).reduce((s, d) => s + d.revenue, 0) * 100) / 100,
  }))
}

function Relatorios() {
  useDocumentTitle('Relatórios — VizinhoHub Manager')
  const { token } = useAuth()
  const { orders } = useAdmin()
  const [days, setDays] = useState(30)
  // Todos os números vêm do servidor (soma de todos os pedidos do período); `orders` só avisa quando chega pedido novo.
  const { summary, error, reload } = useSummary(token, days, 10, orders)

  if (error) {
    return (
      <>
        <h1 className="page-title">Relatórios</h1>
        <p className="sub">Não foi possível carregar os relatórios.</p>
        <button className="btn" type="button" onClick={reload}>Tentar de novo</button>
      </>
    )
  }
  if (!summary) return <p className="muted">Carregando relatórios…</p>

  const { revenue, orders: count, averageTicket: ticket } = summary
  const cancelRate = summary.cancelRate * 100
  const chart = bars(summary.daily, days)
  const chartMax = Math.max(...chart.map((b) => b.total), 1)
  const depts = departments(summary.byCategory)
  const top = summary.topProducts

  return (
    <>
      <div className="row" style={{ marginBottom: '10px' }}>
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="sub" style={{ margin: 0 }}>
            Desempenho de vendas. Soma os pedidos da loja (sem cancelados); as vendas por cupom das Ofertas do bairro entram só em Análises, por isso os totais podem diferir.
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={() => window.print()}>Imprimir / salvar PDF</button>
      </div>
      <div className="filters">
        {RANGES.map((r) => (
          <button key={r.days} type="button" className={days === r.days ? 'on' : undefined} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Faturamento ({RANGES.find((r) => r.days === days).label.toLowerCase()})</span>
          <b>{formatBRL(revenue)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 1 }}>
          <span className="muted">Pedidos</span>
          <b>{count}</b>
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
                {top.map((p, i) => (
                  <tr style={{ '--i': i }} key={p.productId}>
                    <td>
                      <img className="pimg" src={imgSrc({ img: p.image })} alt="" width="76" height="76" loading="lazy" />
                      {p.name}
                    </td>
                    <td>{p.category}</td>
                    <td>{p.quantity}</td>
                    <td>{formatBRL(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

export default Relatorios
