import { Link } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { useAuth } from '../../context/AuthContext'
import { DONUT_COLORS, departments, donutStyle, useSummary, weekdayLabel } from '../../lib/analytics'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { customerName, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

function Dashboard() {
  useDocumentTitle('Dashboard — VizinhoHub Manager')
  const { user, token } = useAuth()
  const { orders, ordersError, reloadOrders } = useAdmin()
  // Os números vêm do servidor (todos os pedidos dos últimos 30 dias); `orders` só alimenta "Últimos pedidos" e avisa quando chega pedido novo.
  const { summary, error: summaryError, reload: reloadSummary } = useSummary(token, 30, 5, orders)

  if (ordersError || summaryError) {
    return (
      <>
        <h1 className="page-title">Dashboard</h1>
        <p className="sub">Não foi possível carregar os pedidos.</p>
        <button className="btn" type="button" onClick={() => (ordersError ? reloadOrders() : reloadSummary())}>Tentar de novo</button>
      </>
    )
  }
  if (!orders || !summary) return <p className="muted">Carregando painel…</p>

  // Hoje = último dia do resumo (sem cancelados); a semana = os 7 últimos dias.
  const today = summary.daily[summary.daily.length - 1]
  const ticket = today.orders ? today.revenue / today.orders : 0
  const week = summary.daily.slice(-7).map((d) => ({ key: d.date, label: weekdayLabel(d.date), total: d.revenue }))
  const weekMax = Math.max(...week.map((d) => d.total), 1)
  const depts = departments(summary.byCategory)
  const top = summary.topProducts
  const topMax = top[0]?.quantity ?? 1

  return (
    <>
      <div className="row" style={{ marginBottom: '6px' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="sub" style={{ margin: 0 }}>Resumo da operação de {user.store?.name ?? 'sua loja'} hoje.</p>
        </div>
        <Link className="btn" to="/manager">Abrir mural de pedidos</Link>
      </div>
      <p />
      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Pedidos hoje (sem cancelados)</span>
          <b>{today.orders}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 1 }}>
          <span className="muted">Faturamento</span>
          <b>{formatBRL(today.revenue)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 2 }}>
          <span className="muted">Ticket médio</span>
          <b>{formatBRL(ticket)}</b>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel sk sk-lines">
          <h3>Vendas da semana</h3>
          <div className="bars">
            {week.map((d, i) => (
              <div className="bar" style={{ '--k': i }} key={d.key}>
                <b>{formatBRL(Math.round(d.total)).replace(',00', '')}</b>
                <i style={{ '--h': `${d.total > 0 ? Math.max(4, Math.round((d.total / weekMax) * 100)) : 2}%` }} />
              </div>
            ))}
          </div>
          <div className="bars-x">{week.map((d) => <span key={d.key}>{d.label}</span>)}</div>
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 1 }}>
          <h3>Vendas por departamento <span className="muted">· 30 dias</span></h3>
          {depts.length === 0 ? (
            <p className="muted">Ainda não há vendas para mostrar.</p>
          ) : (
            <div className="donut-wrap">
              <div className="donut" style={donutStyle(depts)} role="img" aria-label="Gráfico de vendas por departamento" />
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

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 1.5fr' }}>
        <section className="panel">
          <h3>Mais vendidos <span className="muted">· 30 dias</span></h3>
          {top.length === 0 ? (
            <p className="muted">Sem vendas ainda.</p>
          ) : (
            <ul className="rank">
              {top.map((p, i) => (
                <li style={{ '--k': i }} key={p.productId}>
                  <img src={imgSrc({ img: p.image })} alt="" width="96" height="96" loading="lazy" />
                  <div className="grow">
                    <span>{p.name}</span>
                    <div className="hbar"><i style={{ '--w': `${Math.round((p.quantity / topMax) * 100)}%` }} /></div>
                  </div>
                  <b>{p.quantity} un</b>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3>Últimos pedidos</h3>
          {orders.length === 0 ? (
            <p className="muted">Nenhum pedido ainda.</p>
          ) : (
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 'auto' }}>Pedido</th>
                  <th style={{ width: 'auto' }}>Cliente</th>
                  <th style={{ width: 'auto' }}>Total</th>
                  <th style={{ width: 'auto' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 5).map((o, i) => {
                  const { tone, label } = statusInfo(o.status)
                  return (
                    <tr style={{ '--i': i }} key={o.id}>
                      <td><Link style={{ color: 'var(--green)', fontWeight: 700 }} to={`/pedido-detalhe?id=${o.id}`}>#{orderCode(o.id)}</Link></td>
                      <td>{customerName(o)}</td>
                      <td>{formatBRL(o.totalPrice)}</td>
                      <td><span className={`tag ${tone}`}>{label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}

export default Dashboard
